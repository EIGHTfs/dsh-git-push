    /* ─── 第 4/14 片 · UI 状态工厂（单一真相源 + 读回早于首帧 + 重建重放） ─────────────────── */
    // 这一层存在的原因：数据读取此前散在各处各写一份状态（controller 字段 + 组件 useState），
    //   于是「没读到」与「读到了但是空」在界面上无法区分（实测：npm 从未被请求，界面却显示
    //   「未配置 npm token」）；读取还都是一次性 fire-and-forget，面板重建后既不重读也不重放。
    //
    // 六条契约（对齐 ui-state 参考实现）：
    //   R1 单一真相源：一个资源只存这里一份；控制器字段是**派生投影**，组件只读投影，禁止各留副本
    //   R2 读回早于首次渲染：loadAll() 完成前 UI 只渲染骨架（由 uiReady 门禁），不渲染"像数据的空值"
    //   R3 apply/render 分离：renderer 只把当前值刷到已挂载的显示态，幂等、可重放
    //   §三 面板重建后：markRebuilt() → 所有 renderer 按当前值重放一次
    //   §四 读失败/不支持 ⇒ **保留上次值**并标 stale/error，绝不回落默认值
    //   §五 默认值唯一来源 = SETTINGS_SCHEMA / 后端返回；本模块只派生，不另写一份
    const dshgp_UI_DEFAULT_TIMEOUT_MS = 10_000;   // 单资源读超时（列表另有预算，由后端保证）
    const dshgp_UI_RETRY_BACKOFF_MS = 800;        // 失败重试退避（一次就够：网络抖动可救，真坏不硬耗）
    const dshgp_UI_DEFAULT_RETRY = 1;

    /**
     * 工厂内部上下文（不对外：调用方只拿 api 对象）。
     * @param {Function} onChange 任一资源状态/值变化时回调（用于 publish）
     * @returns {{onChange: Function, resources: Map, renderers: Map, inflight: Map}}
     */
    function dshgp_uiCtx(onChange) {
      return {
        onChange: onChange || function () {},
        resources: new Map(),   // name → {load, timeoutMs, retry, staleAfterMs, value, at, state, error}
        renderers: new Map(),   // name → 幂等渲染函数
        inflight: new Map(),    // name → 进行中的 Promise（单飞）
      };
    }

    /** 取资源声明；未注册立即抛（拼错的资源名必须当场可见，不能静默无数据）。 */
    function dshgp_uiEnsure(ctx, name) {
      const res = ctx.resources.get(String(name));
      if (!res) throw new Error('未注册的 UI 资源：' + name);
      return res;
    }

    /** 通知订阅者（订阅者异常不得打断状态机）。 */
    function dshgp_uiEmit(ctx) {
      try { ctx.onChange(); } catch (e) { /* 订阅者异常忽略 */ }
    }

    /**
     * 某资源的状态快照。界面**必须按 state 分支渲染**，不能只看 value 真假：
     *   idle/loading ⇒ 还没读到（渲染占位，别说"未配置"）
     *   ready        ⇒ 有值且新鲜
     *   stale        ⇒ 有值但过期（照常显示 + 标"同步中"）
     *   error        ⇒ 读失败；value 可能是上一次成功值（§四：不清空）
     */
    function dshgp_uiStatusOf(ctx, name) {
      const r = ctx.resources.get(String(name));
      if (!r) return { state: 'idle', loading: false, error: '', at: 0, hasValue: false };
      let state = r.state;
      if (state === 'ready' && r.staleAfterMs > 0 && r.at && (Date.now() - r.at) > r.staleAfterMs) state = 'stale';
      return { state: state, loading: state === 'loading', error: r.error, at: r.at, hasValue: r.value !== undefined };
    }

    /** 把某个资源的当前值刷到显示态（R3；渲染异常不影响状态位）。 */
    function dshgp_uiRenderOne(ctx, name, payload) {
      const fn = ctx.renderers.get(String(name));
      if (!fn) return false;
      try { fn(payload); return true; } catch (e) { return false; }
    }

    /**
     * 按当前值重放渲染（R3/§三），幂等。面板重建后反复调是安全的。
     * @returns {{rendered: string[], skipped: string[]}}
     */
    function dshgp_uiApplyAll(ctx, names) {
      const only = Array.isArray(names) ? new Set(names.map(String)) : null;
      const rendered = [];
      const skipped = [];
      for (const [name, r] of ctx.resources) {
        if (only && !only.has(name)) continue;
        if (r.value === undefined || !ctx.renderers.has(name)) { skipped.push(name); continue; }
        if (dshgp_uiRenderOne(ctx, name, r.value)) rendered.push(name); else skipped.push(name);
      }
      return { rendered: rendered, skipped: skipped };
    }

    /** 带超时的单次读取（超时用 Promise.race，不依赖 fetch 自身的 signal 语义）。 */
    function dshgp_uiReadOnce(resource, arg) {
      return Promise.race([
        Promise.resolve(resource.load(arg)),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('超时（>' + resource.timeoutMs + 'ms）')), resource.timeoutMs,
        )),
      ]);
    }

    /**
     * 读一个资源（含一次退避重试）。失败**保留旧值**，只改状态位（§四）。
     * @returns {Promise<{ok: boolean, name: string, value?: unknown, error?: string}>}
     */
    async function dshgp_uiLoadOne(ctx, name, arg, attempt) {
      const r = dshgp_uiEnsure(ctx, name);
      const tries = Number.isFinite(attempt) ? attempt : 0;
      r.state = 'loading';
      r.error = '';
      dshgp_uiEmit(ctx);
      try {
        const payload = await dshgp_uiReadOnce(r, arg);
        r.value = payload;
        r.at = Date.now();
        r.state = 'ready';
        r.error = '';
        dshgp_uiRenderOne(ctx, name, payload);   // 读到就立刻刷一次显示（与重放同一条路径）
        dshgp_uiEmit(ctx);
        return { ok: true, name: String(name), value: payload };
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (tries < r.retry) {
          await new Promise((resolve) => setTimeout(resolve, dshgp_UI_RETRY_BACKOFF_MS));
          ctx.inflight.delete(String(name));
          return dshgp_uiLoadOne(ctx, name, arg, tries + 1);
        }
        // §四：不清空 value —— 有上一次成功值就继续显示，仅状态降级
        r.state = 'error';
        r.error = msg;
        dshgp_uiEmit(ctx);
        return { ok: false, name: String(name), error: msg };
      } finally {
        ctx.inflight.delete(String(name));
      }
    }

    /** 单飞重读：进行中则复用同一个 Promise（防切 tab/多组件同时触发造成请求风暴）。 */
    function dshgp_uiReload(ctx, name, arg) {
      const key = String(name);
      if (ctx.inflight.has(key)) return ctx.inflight.get(key);
      const p = dshgp_uiLoadOne(ctx, key, arg).finally(() => { ctx.inflight.delete(key); });
      ctx.inflight.set(key, p);
      return p;
    }

    /**
     * 并发读多个资源（R2 的落点：调用方在首帧前等它读完，再放开渲染门禁）。
     * @returns {Promise<{ok: boolean, failed: string[], loaded: string[]}>}
     */
    async function dshgp_uiLoadAll(ctx, opts) {
      const o = opts || {};
      const names = Array.isArray(o.names) ? o.names.map(String) : [...ctx.resources.keys()];
      const results = await Promise.all(names.map((name) => {
        const r = ctx.resources.get(name);
        if (!r) return Promise.resolve({ ok: false, name: name, error: '未注册' });
        if (!o.force && r.state === 'ready' && r.value !== undefined) return Promise.resolve({ ok: true, name: name, cached: true });
        return dshgp_uiReload(ctx, name);
      }));
      return {
        ok: results.every((x) => x.ok),
        failed: results.filter((x) => !x.ok).map((x) => x.name),
        loaded: results.filter((x) => x.ok).map((x) => x.name),
      };
    }

    /**
     * 按需补读（面板挂载/切 tab 用）：只读「没读过」或「已过期/上次失败」的资源。
     * 幂等且不制造请求风暴 —— 这正是"切 tab 就重挂载"场景需要的语义。
     */
    function dshgp_uiEnsureFresh(ctx, names) {
      const list = Array.isArray(names) ? names.map(String) : [String(names)];
      const todo = list.filter((name) => {
        const r = ctx.resources.get(name);
        if (!r) return false;
        if (r.state === 'ready' && r.value !== undefined) return false;   // 有新鲜值：不读
        return !ctx.inflight.has(name);
      });
      if (!todo.length) return Promise.resolve({ ok: true, failed: [], loaded: [] });
      return dshgp_uiLoadAll(ctx, { names: todo, force: true });
    }

    /** 是否所有指定资源都已"有值可用"（ready/stale/error 但留有旧值都算）。 */
    function dshgp_uiAllReady(ctx, names) {
      const list = Array.isArray(names) ? names.map(String) : [...ctx.resources.keys()];
      return list.every((name) => {
        const r = ctx.resources.get(name);
        return !!r && r.value !== undefined;
      });
    }

    /** 是否还有资源在首次读取中（骨架期判断）。 */
    function dshgp_uiAnyLoading(ctx) {
      for (const r of ctx.resources.values()) if (r.state === 'loading') return true;
      return false;
    }

    /**
     * 建一个 UI 状态仓库（对外唯一入口）。
     *
     * 用法（装配期注册资源，运行期读）：
     *   const ui = dshgp_createUiState({ onChange: () => this.publish() });
     *   ui.register('npm', { load: () => dshgp_getJson('/api/git-push/npm-account') });
     *   ui.setRenderer('npm', (payload) => this.applyNpmPayload(payload));
     *   await ui.loadAll();          // R2：读完再放开首帧
     *   ui.markRebuilt();            // §三：面板重建后重放
     *
     * @param {{onChange?: Function}} [options] onChange：任一资源状态/值变化时回调（用于 publish）
     * @returns {object} 仓库实例
     */
    function dshgp_createUiState(options) {
      const ctx = dshgp_uiCtx(options && options.onChange);
      const api = {
        register: function (name, spec) {
          if (typeof (spec && spec.load) !== 'function') throw new Error('资源 ' + name + ' 缺少 load()');
          ctx.resources.set(String(name), {
            name: String(name),
            load: spec.load,
            timeoutMs: Number(spec.timeoutMs) > 0 ? Number(spec.timeoutMs) : dshgp_UI_DEFAULT_TIMEOUT_MS,
            retry: Number.isFinite(Number(spec.retry)) ? Number(spec.retry) : dshgp_UI_DEFAULT_RETRY,
            staleAfterMs: Number(spec.staleAfterMs) > 0 ? Number(spec.staleAfterMs) : 0,
            value: undefined,
            at: 0,
            state: 'idle',
            error: '',
          });
          return api;
        },
        setRenderer: function (name, render) {
          if (typeof render !== 'function') throw new Error('renderer 必须是函数：' + name);
          ctx.renderers.set(String(name), render);
          return api;
        },
        value: function (name) { return ctx.resources.has(String(name)) ? ctx.resources.get(String(name)).value : undefined; },
        values: function () { const out = {}; for (const [k, r] of ctx.resources) out[k] = r.value; return out; },
        status: function (name) { return dshgp_uiStatusOf(ctx, name); },
        reload: function (name, arg) { return dshgp_uiReload(ctx, name, arg); },
        loadAll: function (opts) { return dshgp_uiLoadAll(ctx, opts); },
        ensureFresh: function (names) { return dshgp_uiEnsureFresh(ctx, names); },
        applyAll: function (opts) { return dshgp_uiApplyAll(ctx, opts && opts.names); },
        // §三：面板重建完成 ⇒ 按当前值重放全部显示态（不触发任何请求）
        markRebuilt: function () { const r = dshgp_uiApplyAll(ctx, null); dshgp_uiEmit(ctx); return r; },
        allReady: function (names) { return dshgp_uiAllReady(ctx, names); },
        anyLoading: function () { return dshgp_uiAnyLoading(ctx); },
        has: function (name) { return ctx.resources.has(String(name)); },
      };
      return api;
    }
