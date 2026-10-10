    function apply(ctx) {
      // 【常驻诊断 · 前端接线失败可见化】apply 整体包一层 try/catch，把真实异常打到控制台。
      //   背景：cordis 只把失败的 client entry 标成 failed（页面仅显示
      //   `web boot: 1 entry did not activate` / `dsh-git-push: failed`），真实异常既不进页面、
      //   也不进宿主日志——本次 0.2.0 适配就是靠这层 console.error 才定位到
      //   `cannot get property "settingsScope" without inject`（读未 inject 的服务属性会抛）。
      //   保留为常驻诊断（不是临时探针）：任何未来的接线异常都会直接出现在浏览器控制台。
      try {
      // 版本兼容自动切换（2.3.0）：DSH 0.2.0 移除了 client 注入服务 settingsScope，
      //   声明依赖会导致 entry pending（waiting for service: settingsScope）→ 插件不激活。
      //   git-push 设置/凭据真源早已全链路走 HTTP（settings-bridge → config.json），
      //   scope 仅剩「订阅 + 初值兜底」（零 scope.set），故特性检测自动切换：
      //   有真 scope（0.1.6）用它；没有（0.2.0）用空 fallback（快照空 → 全走 HTTP，行为一致）。
      // 【2.3.0 修复】必须用 ctx.get() 防御式读取：cordis 里「读未 inject 的服务属性」会直接抛
      //   `cannot get property "settingsScope" without inject`（实测：直接写 ctx.settingsScope
      //   会让 0.2.0 上 client entry 激活失败 → 页面报 web boot: dsh-git-push: failed）。
      //   外面再包一层 try/catch：ctx.get 本身在个别宿主实现里也可能抛（1.0.10 回归不变量：
      //   「ctx.get 抛错不崩」），两层防护保证任何宿主形态下 apply 都不因此中断。
      let settingsScope;
      try {
        settingsScope = typeof ctx.get === 'function' ? ctx.get('settingsScope') : undefined;
      } catch {
        settingsScope = undefined;
      }
      const scope = settingsScope
        ? settingsScope.bind({ namespace: SETTINGS_NS })
        : { subscribe: () => () => {}, getSnapshot: () => ({ value: undefined }) };
      const controller = new dshgp_Controller(scope);
      const store = controller.store;
      // （修复「重启后不预读」）：**每次进设置页都预读**账号信息 + 本地仓库列表
      //   （读 account-status.json / dsh-repo-index.json，本地文件幂等便宜）——此前的模块级
      //   `dshgp_startupLoaded` 标记在 DSH bundle 常驻（浏览器不刷新）时保持 true，
      //   导致「第一次预读后，重启/重进设置页不再预读」。改为每次 apply 都读，跟随最新 json。
      //   后续仍可手动「重新检测 / 扫描」在线刷新。
      // 读取复用「本地仓库列表选择的路径」（localStorage dshgp-scan-path，本地面板扫描时写入）；
      //   没选过则空 → 后端自动识别 DSH 家根。
      let savedPath = dshgp_localGet('dshgp-scan-path');
      void controller.refreshAccount();
      void controller.scanLocalRepos(savedPath, false); // 只读索引（不重建，读 json）
      // uSES 桥：SnapshotStore 是裸 observable，用 useSyncExternalStore 自建 selector hook
      const useCardState = (selector) => {
        const snap = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
        return selector ? selector(snap) : snap;
      };
      // 统一 props：组件层不感知 controller，全走 store + 动作注入
      const makeProps = (state) => Object.assign({ state, useGitPushCard: useCardState }, controller.inject());
      function SectionPage() {
        const state = useCardState((s) => s);
        if (!state.available) return null;
        const props = makeProps(state);
        return jsx.jsx(dshgp_GitPushPage, props);
      }
      // 只注册 settings.section（独立侧边栏页）；settings.plugin.item（插件配置卡）已删除
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-git-push',
        order: 40,
        label: () => 'Git 提交推送',
      }, () => react.createElement(SectionPage, null)));
      } catch (e) {
        // 【常驻诊断】真实异常进控制台（页面只显示 "dsh-git-push: failed"，看不出原因）
        console.error('[dsh-git-push] client apply 失败：', (e && (e.stack || e.message)) || String(e));
        throw e;
      }
    }

    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});