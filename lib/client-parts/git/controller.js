    /* ─── 第 12/14 片 · Controller（状态机 + 数据加载 + 动作注入） ─────────────────── */
    class dshgp_Controller {
      constructor(scope) {
        this.scope = scope;
        this.text = '';
        this.sshPub = '';
        this.sshEmail = '';
        this.saving = false;
        this.failed = false;
        this.savedMsg = '';
        this.savedTimer = null;
        // 设置类字段的默认值统一来自 dshgp_DEFAULT_SETTINGS（§五：默认值只有一个来源），
        //   这里不再逐行手写 —— 手写就等于在分片里又存了一份默认值。
        Object.assign(this, dshgp_DEFAULT_SETTINGS);
        this.statusMsg = '';
        this.statusTimer = null;
        // 账号信息（纯展示）
        this.tokenConfigured = false;
        this.sshConfigured = false;
        // 凭据有效性快照（token/ssh 各自 valid/login/checkedAt）——来自 account-status.json
        this.tokenStatus = null;
        this.sshStatus = null;
        this.accountBlock = '';
        this.accountLoggedIn = false;
        this.accountLoading = false;
        // 凭据来源（account-status 的 authMode/authLogin/authorizedAt/authHint）：空串 = 服务端
        //   还没给这几个字段。**不预设成 'none'**——「不知道」与「确实没有任何来源」是两件事，
        //   预设默认值会把前者显示成后者（来源徽标因此整体不渲染，见 account.js）。
        this.authMode = '';
        this.authLogin = '';
        this.authorizedAt = '';
        this.authHint = '';
        // GitHub 授权（Device Flow）面板：null = 面板关闭；否则是归一后的展示视图（含 phase）
        this.deviceAuth = null;
        // start/poll 在飞标记：连点会连发上游请求，GitHub 会判 slow_down（间隔永久 +5s）
        this.deviceAuthBusy = false;
        // 下一拍轮询的定时器句柄。**不用固定间隔的 setInterval**：Device Flow 的节奏由服务端
        //   给的 nextPollAtEpochMs 决定，见 scheduleDeviceAuthPoll。
        this._deviceAuthTimer = null;
        // 授权/撤销的结果提示（面板关闭后也要能看见结果，故不放 panel 内部）
        this.deviceAuthNotice = '';
        this.deviceAuthNoticeOk = false;
        this._deviceAuthNoticeTimer = null;
        // 动作包**在构造期创建一次**（身份固定）：卡片里的按钮直接用它。
        //   为什么放在快照里而不加进 inject()：inject() 在 actions.js 分片，不在本次改动范围；
        //   身份固定可保证每次 publish 重建快照时按钮不因函数引用变化而重挂载。
        this.deviceAuthActions = {
          start: () => { void this.startDeviceAuth(); },
          cancel: () => { this.cancelDeviceAuth(); },
          revoke: () => { void this.revokeDeviceAuth(); },
        };
        // npm 账号态（与 GitHub 账号态**同构**：离线快照 + 在线校验两段式；包列表同源刷新）
        this.npmAccountBlock = '';
        this.npmAccountLoggedIn = false;
        this.npmAccountLoading = false;
        this.npmAccountUser = '';
        this.npmConfigured = false;   // 后端返回的「凭据文件里有没有 npm token」（唯一真源，不从块文案反推）
        this.npmOwned = [];
        this.npmOwnedLoading = false;
        this.npmOwnedError = '';
        this.npmInstallBusy = '';      // 正在安装的包名（'' = 空闲）
        this.npmInstallResult = null;  // 最近一次安装回执（含日志路径与输出摘要）
        // 安装流程（照 GitHub 克隆四段）：选择对话框 + 进度轮询
        this.npmInstallDialog = null;  // { name } = 正在选安装位置
        this.npmInstallProgress = null;// 轮询到的进度（state/lines/tail）
        this.npmInstallTimer = null;   // 轮询定时器（终态后清理）
        // API 配额（token 的 /rate_limit 快照）：quotaLoading 防重复请求；quotaError 记后端
        //   写快照失败的原因（此前该失败被静默丢弃，UI 看不出「查了但没落盘」）
        this.apiQuota = null;
        this.quotaLoading = false;
        this.quotaError = '';
        // 账号卡片：本地/云端（本地扫描 / 云端列表）
        this.localPath = '';
        this.localRepos = [];
        this.localLoading = false;
        this.localScanning = false; // 独立进程扫描进行中（按钮禁用，不可重复扫描）
        this.localMsg = '';
        this.cloudRepos = [];
        this.cloudLoading = false;
        this.cloudMsg = '';
        this.repoBusy = '';
        this.cloneProgress = null;   // 进行中的 clone 进度（轮询填充）
        this._cloneResumeTimer = null; // 后台克隆接续轮询句柄（后台化配套）
        this.clonePreview = null;    // 待确认的 clone 预览
        this.cloneHistory = null;    // 预览框「带真实历史」勾选：null=未表态（跟随后端默认 true）、true/false=用户显式选择
        this.clonePending = { repo: '', dir: '' };  // 预览后待确认的上下文
        this.visConfirm = null;      // 1.5.4：待确认的可见性切换（{fullName, target, cur}，命中则弹独立确认面板）
        this.repoFeedback = {}; // { path: {ok, msg} } push 结果反馈（成功绿/失败红）
        // 规则包加载
        this.slotLoading = false;
        this.slotError = '';
        // 统一刷新入口 refresh() 的部分级错误记录（单个部分失败不阻断其余部分）
        this.refreshError = '';
        this.genKeying = false;
        this.genKeyError = '';
        // 本次编辑会话已触达的设置键集合——loadSettingsFromHttp 的异步 GET
        //   返回旧值时跳过这些键，防止「点开关被初始化响应弹回」（回弹根因：GET 发出后
        //   点击发生，POST 未落盘前 GET 旧值先把本地覆盖回去）
        this.editedKeys = new Set();
        this.store = store.createSnapshotStore(this.project());
        this.unsubscribe = scope.subscribe(() => {
          const snap = this.scope.getSnapshot();
          if (snap && snap.value) {
            // 重构：设置/凭据状态全链路统一走 HTTP（settings-get + account-check，
            //   真源 = config.json + 凭据文件），**scope 快照不再参与任何状态判定**——
            //   公共 settings.yaml 已零写入（scope.set 全移除），snap.value 里这些键恒缺省，
            //   此前把 sshConfigured 覆盖成 !!snap.value.sshPub（恒 false）导致「配置了却显示
            //   未配置」，且每次 scope 发布都弹回，与 loadSettingsFromHttp 拉回的真值互相打架。
          }
          this.publish();
        });
        // 重构：scope 快照只作「无 HTTP 时的初值兜底」（typeof 守卫保证 yaml 零写入
        //   时 undefined 不会覆盖；仅单测显式传值才生效）。凭据标志 tokenConfigured/sshConfigured
        //   不再从快照取——公共 yaml 已零写入，snap 里恒缺省只会种出 false，统一由
        //   refreshAccount（/account-check 读凭据文件真源）与 loadSettingsFromHttp 刷新。
        const snap0 = this.scope.getSnapshot();
        if (snap0 && snap0.value) {
          if (typeof snap0.value.injectSystemPrompt === 'boolean') this.injectSystemPrompt = snap0.value.injectSystemPrompt;
        }
        // ── UI 状态工厂（单一真相源）──
        //   读、状态、重放都收在这一层；本类的同名字段只是它的**派生投影**（R1）。
        //   注册顺序 = 首屏依赖顺序：设置/账号/npm 决定首屏，列表自己带加载态。
        this.uiState = dshgp_createUiState({ onChange: () => this.publish() });
        this.uiState
          .register('settings', { load: () => dshgp_getJson('/api/git-push/settings-get') })
          .register('account', { load: () => dshgp_getJson('/api/git-push/account-status') })
          .register('npm', { load: () => dshgp_getJson('/api/git-push/npm-account') })
          // 列表：后端已改为「只读索引快照（毫秒级）」，远端状态由后台补（见 task-23 M3）
          .register('repos', { load: (arg) => this.loadReposPayload(arg), timeoutMs: 15_000 })
          // npm 子页的「已装依赖」也是数据（曾由组件自己 useState + fetch，形成第二份真相）
          .register('npmPackages', { load: (arg) => this.loadNpmPackagesPayload(arg) });
        // 渲染器 = 幂等的「按值刷显示」（R3）；面板重建后由 markRebuilt 重放（§三）
        this.uiState
          .setRenderer('settings', (payload) => this.applySettingsPayload(payload))
          .setRenderer('account', (payload) => this.applyAccountPayload(payload))
          .setRenderer('npm', (payload) => this.applyNpmPayload(payload))
          .setRenderer('repos', (payload) => this.applyReposPayload(payload));
        // 首屏门禁只等「快的三个」：列表自己显示加载态，不能把首屏拖成 30s 空白
        this.uiFirstPaintNames = ['settings', 'account', 'npm'];
        // R2：读回早于首次渲染 —— 由 apply.js 的 loadAll() 驱动，读完才放开骨架
      }

      /**
       * 首屏是否已可渲染真实内容（R2 门禁）。
       * 只判断首屏必需资源：settings/account/npm。**不是**「全都读完」——
       *   列表可能仍在读，它自己有加载态；把列表并进门禁会让首屏退化成骨架。
       * @returns {{ready: boolean, pending: string[]}}
       */
      uiReadyInfo() {
        // 构造期 project() 先于状态工厂创建（store 的初始快照就是在构造里取的）⇒ 这里必须容忍
        if (!this.uiState) return { ready: false, pending: (this.uiFirstPaintNames || []).slice() };
        const pending = (this.uiFirstPaintNames || []).filter((name) => this.uiState.status(name).state === 'loading'
          || (this.uiState.value(name) === undefined && this.uiState.status(name).state !== 'error'));
        return { ready: pending.length === 0, pending: pending };
      }

      /** 某资源的界面状态（组件按它分支渲染占位/错误/内容，不再靠值真假猜）。 */
      uiStatus(name) {
        if (!this.uiState) return { state: 'idle', loading: false, error: '', at: 0, hasValue: false };
        return this.uiState.status(name);
      }
      project() {
        // 恒可用/恒可写：数据与写入全走 HTTP（settings-get/settings-set/account-check/rule-slots），
        //   client scope 快照只作初值兜底（见构造处注释）。宿主按 isLoopback 决定 scope 的
        //   persistence——反代/非 loopback 访问时恒 memory 模式、status 恒 unavailable、
        //   writable 恒 false（isLoopback=memory 陷阱）。若仍以快照判 available，设置侧边栏
        //   在反代访问下会整页空白（SectionPage return null）且输入框全禁用，故绕开快照判定。
        const readyInfo = this.uiReadyInfo();
        return {
          available: true,
          writable: true,
          text: this.text,
          sshPub: this.sshPub,
          sshEmail: this.sshEmail,
          preCommitEnabled: this.preCommitEnabled,
          injectSystemPrompt: this.injectSystemPrompt,
          pushMethod: this.pushMethod,
          pushGate: this.pushGate, // 推送门禁（开启后 push 需显式放行）
          // defaultScanRoot/commitMessage 状态镜像移除（设置已删除）
          tokenConfigured: this.tokenConfigured,
          sshConfigured: this.sshConfigured,
          // 凭据有效性快照（account-check → account-status.json 的 token/ssh 分项），
          //   供账号卡片渲染各自 ✅有效/❌无效 徽标 + 登录名。
          tokenStatus: this.tokenStatus,
          sshStatus: this.sshStatus,
          accountBlock: this.accountBlock,
          accountLoggedIn: this.accountLoggedIn,
          accountLoading: this.accountLoading,
          // 凭据来源（徽标用）：字段缺席即 undefined/空串 ⇒ 徽标整体不渲染，不编造来源
          authMode: this.authMode,
          authLogin: this.authLogin,
          authorizedAt: this.authorizedAt,
          authHint: this.authHint,
          // GitHub 授权面板：视图 + 在飞标记 + 动作包 + 结果提示
          deviceAuth: this.deviceAuth,
          deviceAuthBusy: this.deviceAuthBusy,
          deviceAuthActions: this.deviceAuthActions,
          deviceAuthNotice: this.deviceAuthNotice,
          deviceAuthNoticeOk: this.deviceAuthNoticeOk,
          npmAccountBlock: this.npmAccountBlock,
          npmAccountLoggedIn: this.npmAccountLoggedIn,
          npmAccountLoading: this.npmAccountLoading,
          npmAccountUser: this.npmAccountUser,
          npmConfigured: this.npmConfigured,
          npmOwned: this.npmOwned,
          npmOwnedLoading: this.npmOwnedLoading,
          npmOwnedError: this.npmOwnedError,
          npmInstallBusy: this.npmInstallBusy,
          npmInstallResult: this.npmInstallResult,
          npmInstallDialog: this.npmInstallDialog,
          npmInstallProgress: this.npmInstallProgress,
          refreshError: this.refreshError, // 统一刷新入口的部分级错误
          statusMsg: this.statusMsg,
          genKeying: this.genKeying,
          genKeyError: this.genKeyError,
          localPath: this.localPath,
          localRepos: this.localRepos,
          localLoading: this.localLoading,
          localScanning: this.localScanning, // 独立进程扫描中（按钮禁用）
          localMsg: this.localMsg,
          cloudRepos: this.cloudRepos,
          cloudLoading: this.cloudLoading,
          cloudMsg: this.cloudMsg,
          repoBusy: this.repoBusy,
          cloneProgress: this.cloneProgress,
          clonePreview: this.clonePreview,
          cloneHistory: this.cloneHistory,
          visConfirm: this.visConfirm,
          maxCloneFileMB: this.maxCloneFileMB,
          cloneConcurrency: this.cloneConcurrency,
          repoFeedback: this.repoFeedback,
          // UI 状态工厂门禁与状态位（组件据此分支：骨架 / 内容 / 失败可重试）
          uiReady: readyInfo.ready,
          uiPending: readyInfo.pending,
          uiStatus: {
            settings: this.uiStatus('settings'),
            account: this.uiStatus('account'),
            npm: this.uiStatus('npm'),
            repos: this.uiStatus('repos'),
            npmPackages: this.uiStatus('npmPackages'),
          },
          // npm 子页「已装依赖」数据：单一真相在状态工厂，组件只读这里（禁止再自己 useState 一份）
          npmPackages: this.uiState ? this.uiState.value('npmPackages') : null,
          dirty: this.text.trim().length > 0 || this.sshPub.trim().length > 0,
          saving: this.saving,
          failed: this.failed,
          savedMsg: this.savedMsg,
        };
      }
      flashSaved(msg) {
        this.savedMsg = String(msg || '');
        if (this.savedTimer) clearTimeout(this.savedTimer);
        this.savedTimer = setTimeout(() => {
          this.savedMsg = '';
          this.publish();
        }, dshgp_SAVED_MSG_MS);
        this.publish();
      }
      publish() { this.store.set(this.project()); }

      /**
       * 从宿主读已落盘设置（/settings-get，host scope.get 快照）。
       * 背景：非 loopback 访问（反代）时 client settingsScope 恒 unavailable（memory 模式），
       *   插件直读 scope 拿不到任何已保存值 → 打开设置页时开关全回默认（现象：重启后勾选丢失，
       *   需重新打开）。host 侧 scope 才是真源，经 HTTP 读回后覆盖前端字段、保持勾选状态。
       * 追加：**用户已编辑过的键跳过**（this.editedKeys）——本请求是异步的，
       *   若用户在响应回来前点了开关，GET 返回的是 host 旧值，直接覆盖会把刚点的勾选弹回。
       */
      /**
 * 统一刷新入口：**一个函数 + 一个参数**控制刷新设置侧边栏的哪部分，
       * 取代此前散落在多个 useEffect / 按钮回调里各自 fetch 的写法。
       *
       * @param {string|string[]} [parts='all'] 要刷新的部分，可传单个字符串、数组、或 'all'：
       *   · 'settings' —— 设置（/settings-get 读宿主 scope 已落盘值，覆盖前端字段）
       *   · 'account'  —— 账号信息（/account-status 离线读凭据真源 + 徽标）
       *   · 'repos'    —— 本地仓库列表（/repos-local 读 dsh-repo-index.jsonl；可配 path/rebuild）
       *   · 'cloud'    —— 云端仓库列表（/repos-cloud 走 token 列账号名下仓库）
       *   · 'slots'    —— 规则槽位（/rule-slots 动态发现 yml + 统计）
       *   · 'all'      —— 以上全部（默认）
       * @param {object} [opts]
       *   · path    —— 仅 'repos' 用：扫描根路径（空=沿用上次）
       *   · rebuild —— 仅 'repos' 用：true 先离线重建索引再读回
       *   · silent  —— true 时不置 loading 态（用于后台静默刷新，避免界面闪烁）
       * @returns {Promise<void>}
       *
       * 用法：
       *   await this.refresh();                      // 全部刷新
       *   await this.refresh('account');             // 只刷账号信息
       *   await this.refresh(['settings','slots']);  // 只刷设置与槽位
       *   await this.refresh('repos', { rebuild: true });  // 重建索引后刷本地列表
       */
      async refresh(parts = 'all', opts = {}) {
        const PARTS = ['settings', 'account', 'npm', 'repos', 'cloud'];
        let list;
        if (parts === 'all' || parts === undefined || parts === null) list = PARTS.slice();
        else list = (Array.isArray(parts) ? parts : [parts])
          .map((p) => String(p || '').trim().toLowerCase())
          .filter((p) => PARTS.includes(p));
        if (!list.length) return;

        // 顺序执行而非并行：repos 依赖索引、account 影响徽标，串行可保证先后关系稳定，
        // 也避免多个请求同时 publish 造成界面连续重排。
        for (const p of list) {
          try {
            if (p === 'settings') await this.loadSettingsFromHttp();
            else if (p === 'account') await this.refreshAccount({ silent: opts.silent });
            else if (p === 'npm') {
              // npm 与 GitHub 同构：先读离线账号态，再拉账号名下的包列表（未登录时列表给可读提示）
              await this.refreshNpmAccount({ silent: opts.silent });
              await this.loadNpmOwned({ silent: opts.silent });
            }
            else if (p === 'repos') await this.scanLocalRepos(opts.path, opts.rebuild, { silent: opts.silent });
            else if (p === 'cloud') await this.loadCloudRepos({ silent: opts.silent });
          } catch (e) {
            // 单个部分失败不影响其余部分：记录到统一错误位，继续刷下一个
            this.refreshError = `${p}: ` + (e && e.message || e);
          }
        }
        // 克隆改为后台 job 后，任务不再随 HTTP 请求存活——
        //   刷新/重开页面时后端可能仍在下载。这里主动探一次，把「正在跑的克隆」
        //   重新接回进度条与轮询，避免用户以为任务没了而重复发起（会被互斥拒绝）。
        void this.resumeCloneIfRunning();
      }

      /**
 * 页面加载/刷新后接续**仍在后台跑的克隆**（克隆后台化配套）。
       *
       * 只在 idle/done 之外做动作：running → 恢复进度条并重启轮询；
       *   done → 如实回显终态（说明上次任务已结束）；idle → 什么都不做。
       */
      async resumeCloneIfRunning() {
        if (this.repoBusy) return; // 已有交互在进行（含本页面自己发起的 clone），不抢
        let st;
        try {
          st = await dshgp_getJson('/api/git-push/clone-progress');
        } catch { return; /* 探测失败静默：下次刷新再试 */ }
        if (!st || st.state !== 'running' || !st.progress) return;
        const p = st.progress;
        this.cloneProgress = p;
        this.repoBusy = dshgp_BUSY_CLONE + (p.target || '');
        this.cloudMsg = '⏳ 后台克隆进行中：' + (p.target || '') + ' → ' + (p.dest || '');
        this.publish();
        // 重启轮询直到终态（与 cloneConfirmed 同一收敛逻辑，故此处只做等待）
        if (this._cloneResumeTimer) clearInterval(this._cloneResumeTimer);
        this._cloneResumeTimer = setInterval(async () => {
          try {
            const s2 = await dshgp_getJson('/api/git-push/clone-progress');
            if (s2 && s2.state === 'running' && s2.progress) {
              this.cloneProgress = s2.progress;
              this.publish();
              return;
            }
            if (s2 && s2.state === 'done') {
              const fin = await dshgp_getJson('/api/git-push/clone-progress?consume=1');
              const res = (fin && fin.result) || (s2 && s2.result) || null;
              this.cloudMsg = res && res.ok
                ? '✅ 已克隆 ' + (p.target || '') + ' → ' + (res.dest || p.dest || '')
                : '❌ ' + ((res && res.error) || '克隆失败');
            } else if (s2 && s2.state === 'idle') {
              this.cloudMsg = '⚠️ 克隆任务已不存在（可能插件进程重启过），请重新发起';
            } else {
              return; // 未知态：继续轮询，不误判
            }
            clearInterval(this._cloneResumeTimer);
            this._cloneResumeTimer = null;
            this.cloneProgress = null;
            this.repoBusy = '';
            this.publish();
          } catch { /* 轮询失败不中断 */ }
        }, 1000);
      }

      /** 设置读回：**薄壳**（读与状态由 UI 状态工厂负责，本方法只保留"重读"语义）。 */
      async loadSettingsFromHttp() {
        return this.uiState.reload('settings');
      }

      /**
       * 把 /settings-get 的返回投影到本类字段（幂等）。
       * 用户正在编辑的键跳过（editedKeys）：GET 是异步的，回来的是旧值，
       *   直接覆盖会把刚点的勾选弹回默认。
       */
      applySettingsPayload(payload) {
        const v = (payload && payload.settings) || null;
        if (!v) return;
        {
          // 预处理开关在 config.json 里是嵌套的 preCommit.enabled（与引擎 command/args 同块）
          if (v.preCommit && typeof v.preCommit.enabled === 'boolean' && !this.editedKeys.has('preCommitEnabled')) {
            this.preCommitEnabled = v.preCommit.enabled;
          }
          if (typeof v.injectSystemPrompt === 'boolean' && !this.editedKeys.has('injectSystemPrompt')) this.injectSystemPrompt = v.injectSystemPrompt;
          // 补齐回读：advanced 键，重启后从 config.json 恢复勾选/取值
          if (typeof v.maxCloneFileMB === 'number' && !this.editedKeys.has('maxCloneFileMB')) this.maxCloneFileMB = v.maxCloneFileMB;
          if (typeof v.cloneConcurrency === 'number' && !this.editedKeys.has('cloneConcurrency')) this.cloneConcurrency = v.cloneConcurrency;
          if (typeof v.pushMethod === 'string' && !this.editedKeys.has('pushMethod')) this.pushMethod = v.pushMethod;
          // 补漏：pushGate（推送门禁）此前**不在回读列表**——构造函数默认 false，
          //   打开/刷新设置页时不被宿主真值覆盖，界面永远显示未勾选（实测：勾了门禁、重开页面又变未勾选）。
          if (typeof v.pushGate === 'boolean' && !this.editedKeys.has('pushGate')) this.pushGate = v.pushGate;
          // 凭据布尔位不受编辑守卫影响：只读派生标记，无回弹风险
          if (typeof v.tokenConfigured === 'boolean') this.tokenConfigured = v.tokenConfigured;
          if (typeof v.sshConfigured === 'boolean') this.sshConfigured = v.sshConfigured;
        }
        // 读失败不再被 try/catch 吞掉：状态工厂会把它记成 error 状态，
        //   界面按 uiStatus('settings') 渲染"读取失败（可重试）"，而不是照常显示默认值却像"已保存"。
      }

      /**
       * npm 账号态：**薄壳**（读由 UI 状态工厂负责，本方法只保留"重读"语义与加载标记）。
       *
       * 为什么必须薄：此前 npm 与 GitHub 两套各写字段、各吞错误，于是「没读到」与「读到了但为空」
       * 在界面上长得一样（实测：从未请求过 /npm-account，界面却断言「未配置 npm token」）。
       * 现在值只存在状态工厂里，本类的 npm* 字段是它的派生投影（R1）。
       */
      async refreshNpmAccount({ silent = false } = {}) {
        if (!silent) { this.npmAccountLoading = true; this.publish(); }
        const r = await this.uiState.reload('npm');
        this.npmAccountLoading = false;
        this.publish();
        return r;
      }

      /** 把 /npm-account 的返回投影到本类字段（幂等；只读 payload，不做任何默认值编造）。 */
      applyNpmPayload(payload) {
        const p = (payload && typeof payload === 'object') ? payload : null;
        if (!p) return;
        // 后端 block 是"人话结论"（含 ✅/⚠️ 与原因）；为空就保持为空 ——
        //   界面按 uiStatus('npm') 分支渲染"读取中/读取失败"，绝不把"没读"写成"未配置"。
        this.npmAccountBlock = String(p.block || '');
        this.npmAccountLoggedIn = !!p.loggedIn;
        this.npmAccountUser = String(p.user || '');
        this.npmConfigured = !!p.configured;
      }

      /** 在线校验 npm 登录态并写快照（/npm-check）；与 recheckAccount 完全同构。 */
      async recheckNpmAccount() {
        if (this.npmAccountLoading) return;
        this.npmAccountLoading = true;
        this.publish();
        try {
          const res = await dshgp_postJson('/api/git-push/npm-check', {});
          if (res && res.block) this.npmAccountBlock = res.block;
          this.npmAccountLoggedIn = !!(res && res.loggedIn);
          this.npmAccountUser = (res && res.user) || '';
          this.npmConfigured = !!(res && res.configured);
        } catch (e) {
          // 只报事实：在线校验没成功、原因是什么。不在没证据时断言「未配置」。
          this.npmAccountBlock = '⏳ 在线校验未完成（可稍后重试）：' + ((e && e.message) || e);
          this.npmAccountLoggedIn = false;
        }
        this.npmAccountLoading = false;
        this.publish();
        // 校验成功后顺带刷新「账号名下的包」列表（与 GitHub push 后重读云端列表同一节奏）
        if (this.npmAccountLoggedIn) await this.loadNpmOwned({ silent: true });
      }

      /** 安装流程第一段（入口）：点列表行「安装」⇒ 弹选择（目录 / 全局），与 GitHub 克隆同款入口。 */
      openInstallFlow(pkg) {
        const name = String(pkg || '').trim();
        if (!name) return;
        this.npmInstallDialog = { name };
        this.npmInstallResult = null;
        this.publish();
      }

      /** 取消选择对话框。 */
      cancelInstallDialog() {
        this.npmInstallDialog = null;
        this.publish();
      }

      /** 选择段①：打开目录选择器（与 clone 同款 dshgp_browseOpen(input, onPick)），选完即开始安装。 */
      chooseInstallDir() {
        const name = (this.npmInstallDialog && this.npmInstallDialog.name) || '';
        if (!name) return;
        if (typeof dshgp_browseOpen !== 'function') {
          this.npmInstallResult = { ok: false, error: '目录选择器不可用' };
          this.npmInstallDialog = null;
          this.publish();
          return;
        }
        dshgp_browseOpen(null, (picked) => { void this.startInstallTo({ name, dir: String(picked || '') }); });
      }

      /** 选择段②：确认全局安装（-g，会影响宿主 node 环境）。 */
      confirmInstallGlobal() {
        const name = (this.npmInstallDialog && this.npmInstallDialog.name) || '';
        if (!name) return;
        void this.startInstallTo({ name, global: true });
      }

      /** 起安装（异步）+ 开始轮询进度；启动失败直接落回执。 */
      async startInstallTo({ name = '', dir = '', global = false } = {}) {
        const pkg = String(name || '').trim();
        if (!pkg) return;
        this.npmInstallDialog = null;
        this.npmInstallBusy = pkg;
        this.npmInstallProgress = { state: 'running', name: pkg, lines: [], startedAt: Date.now() };
        this.publish();
        try {
          const res = await dshgp_postJson('/api/git-push/npm-install', {
            names: [pkg], dest: global ? '' : dir, global, ignoreScripts: true, confirm: true, async: true,
          });
          if (!res || res.ok === false || res.started !== true) {
            this.npmInstallResult = res || { ok: false, error: '启动安装失败' };
            this.npmInstallBusy = '';
            this.npmInstallProgress = null;
            this.publish();
            return;
          }
          this.pollInstallProgress();
        } catch (e) {
          this.npmInstallResult = { ok: false, error: String((e && e.message) || e) };
          this.npmInstallBusy = '';
          this.npmInstallProgress = null;
        }
        this.publish();
      }

      /** 进度段：轮询 /npm-install-progress（对应 clone 的轮询），终态取回执并清表。 */
      pollInstallProgress() {
        if (this.npmInstallTimer) return;
        const tick = async () => {
          try {
            const st = await dshgp_postJson('/api/git-push/npm-install-progress', {});
            const p = st && st.progress;
            if (!p) return;
            this.npmInstallProgress = p;
            if (p.state !== 'running') {
              this.clearInstallTimer();
              this.npmInstallBusy = '';
              this.npmInstallResult = {
                ok: p.state === 'done', state: p.state, tail: p.tail || '',
                lines: p.lines || [], logPath: p.logPath || '', error: p.error || '',
              };
              await this.loadNpmOwned({ silent: true }); // 安装后同源刷新（与 clone 完成后重读同一节奏）
              await this.refresh('repos');
            }
            this.publish();
          } catch { /* 单次轮询失败不致命，下一拍重试 */ }
        };
        this.npmInstallTimer = setInterval(() => { void tick(); }, 1200);
        void tick();
      }

      /** 清理进度轮询定时器（终态必须调，防定时器泄漏）。 */
      clearInstallTimer() {
        if (this.npmInstallTimer) {
          clearInterval(this.npmInstallTimer);
          this.npmInstallTimer = null;
        }
      }

      /**
       * 安装一个包（/npm-install）。二次确认由 UI 负责；此处固定安全默认：
       *   默认不执行安装脚本（ignoreScripts）、默认非全局（除非 UI 显式传 global:true）。
       * 失败不抛错，回执写进 npmInstallResult 供 UI 展示（含日志路径）。
       */
      async installNpmPackage({ name = '', dest = '', global = false, ignoreScripts = true } = {}) {
        const pkg = String(name || '').trim();
        if (!pkg || this.npmInstallBusy) return;
        this.npmInstallBusy = pkg;
        this.publish();
        try {
          const res = await dshgp_postJson('/api/git-push/npm-install', {
            names: [pkg], dest: String(dest || ''), global: !!global, ignoreScripts: !!ignoreScripts, confirm: true,
          }, 320000);
          this.npmInstallResult = res || null;
          // 包安装到工作区依赖后，本地面板同源重读（与 GitHub push 后重读云端列表同一节奏）
          if (res && res.ok) await this.refresh('repos');
        } catch (e) {
          this.npmInstallResult = { ok: false, error: String((e && e.message) || e) };
        }
        this.npmInstallBusy = '';
        this.publish();
      }

      /** 拉取登录账号名下的包（/npm-owned）；未登录或失败 ⇒ 空列表 + 可读提示（不抛错）。 */
      async loadNpmOwned({ silent = false } = {}) {
        if (!silent) { this.npmOwnedLoading = true; this.publish(); }
        try {
          const res = await dshgp_getJson('/api/git-push/npm-owned');
          this.npmOwned = (res && Array.isArray(res.results)) ? res.results : [];
          this.npmOwnedError = (res && res.error) || '';
        } catch (e) {
          this.npmOwned = [];
          this.npmOwnedError = String((e && e.message) || e);
        }
        this.npmOwnedLoading = false;
        this.publish();
      }

      /** 刷新账号信息（/account-check，读凭据文件真源；同时刷新凭据徽标）。 */
      /** 离线读账号状态（秒级，不触发任何网络）：读 account-status.json 快照 + 凭据文件。
       *   插件启动 / push 后重读 / 账号卡片渲染全用它。「重新检测」才走在线（recheckAccount）。 */
      async refreshAccount({ silent = false } = {}) {
        if (!silent) { this.accountLoading = true; this.publish(); }
        const r = await this.uiState.reload('account');
        this.accountLoading = false;
        this.publish();
        // token 配额刷新（异步、不阻塞凭据显示）：查 /api-quota（后端写回快照）→ 按
        //   statusUpdated 标志重读 account-status，使凭据块 Token 行出现「（配额剩余 N/h）」。
        //   只在账号态读成功时做：失败时连发配额请求只会把错误面搅浑。
        if (r && r.ok) this.refreshApiQuota();
        return r;
      }

      /** 把 /account-status 的返回投影到本类字段（幂等；失败路径**不调用**它 ⇒ 旧值保留，§四）。 */
      applyAccountPayload(payload) {
        const p = (payload && typeof payload === 'object') ? payload : null;
        if (!p) return;
        this.accountBlock = String(p.block || '');
        this.accountLoggedIn = !!p.loggedIn;
        this.tokenConfigured = !!p.tokenConfigured;
        this.sshConfigured = !!p.sshConfigured;
        this.tokenStatus = p.tokenStatus || null;
        this.sshStatus = p.sshStatus || null;
        if (p.apiQuota) this.apiQuota = p.apiQuota;
        // 凭据来源字段：**只在服务端真的给了才覆盖**。缺字段时保留旧值 → 首帧是空串（徽标不渲染），
        //   而不是被写成 'none'（那等于把「还没读到」说成「没有来源」）。
        if (typeof p.authMode === 'string') this.authMode = p.authMode;
        if (typeof p.authLogin === 'string') this.authLogin = p.authLogin;
        if (typeof p.authorizedAt === 'string') this.authorizedAt = p.authorizedAt;
        if (typeof p.authHint === 'string') this.authHint = p.authHint;
      }

      // 刷新 token 的 GitHub API 配额（异步）：查 /api/git-push/api-quota → 按收口标志重读快照。
      //   后端 60 秒缓存 + 进行中防抖，避免打开设置页时反复打 GitHub。
      // 收口约定：后端写 account-status 成功后回 statusUpdated=true；命中缓存回 cached=true
      //   （表示此前已落盘）——只有这两种情况才重读 account-status（不再无条件拉）。
      //   写失败回 statusError 时如实记到 quotaError，同时仍用本次返回值渲染（配额是增强信息，
      //   不因落盘失败就不显示，但也不再静默吞掉失败原因）。
      async refreshApiQuota() {
        if (this.quotaLoading) return;
        this.quotaLoading = true;
        try {
          const quotaResp = await dshgp_getJson('/api/git-push/api-quota');
          if (quotaResp && quotaResp.ok) {
            // 本次响应就是最新配额（落盘失败也照常展示）
            this.apiQuota = { core: quotaResp.core, search: quotaResp.search, graphql: quotaResp.graphql, codeSearch: quotaResp.codeSearch, checkedAt: quotaResp.fetchedAt };
            this.quotaError = quotaResp.statusError ? String(quotaResp.statusError) : '';
            if (quotaResp.statusUpdated || quotaResp.cached) {
              const res = await dshgp_getJson('/api/git-push/account-status');
              if (res && res.block) this.accountBlock = res.block;
            }
            this.publish();
          }
        } catch { /* 配额查询失败静默（凭据块仍正常显示） */ }
        this.quotaLoading = false;
      }

      /** 「重新检测」：在线校验 token/SSH → 写 account-status.json → 再离线读回最新。
       *   仅手动点按钮触发（在线有网络耗时 1~4s），读取端仍走离线 refreshAccount。 */
      async recheckAccount() {
        // 防抖：连点会连发在线请求（GitHub /user 有速率限制），
        //   触发限流后反而更容易超时，表现为「点了没反应」。进行中直接忽略重复点击。
        if (this.accountLoading) return;
        this.accountLoading = true;
        this.publish();
        try {
          const res = await dshgp_postJson('/api/git-push/account-check', { checkSsh: true, confirm: false });
          // 超时 ≠ 失效：网络没测成时如实说明可重试，不写成「检测失败」吓人
          const ts = (res && res.tokenStatus) || {};
          const ss = (res && res.sshStatus) || {};
          if (!ts.valid && ts.timeout) {
            this.accountBlock = '⏳ 在线校验未完成（网络超时，可稍后重试）；SSH 状态：' + (ss.valid ? '✅ 可用' : '未验证');
          }
        } catch (e) {
          this.accountBlock = '在线检测失败: ' + (e && e.message || e);
        }
        await this.refreshAccount(); // 离线读回在线校验落盘的 json
      }

      /* ── GitHub 授权（Device Flow）：面板状态 + 按服务端节拍轮询 ─────────────────
       * 这条链路有三件事**必须**做对，否则表现为「一直等不到授权」而不是报错：
       *   ① 节拍只认服务端给的 nextPollAtEpochMs（快轮询会被 GitHub 判 slow_down，间隔永久 +5s）；
       *   ② 倒计时只认 expiresAtEpochMs（用 expiresInMs 现算会让刷新后的倒计时错位）；
       *   ③ 打开面板先尝试接回服务端仍在进行中的会话（重开就换短码 = 用户刚输入的旧码作废）。
       */

      /**
       * 打开授权面板：先尝试接回服务端仍在进行中的会话，没有才申请新的设备码。
       * @returns {Promise<void>}
       */
      async startDeviceAuth() {
        if (this.deviceAuthBusy) return;
        this.deviceAuthBusy = true;
        // 立刻切到 starting 态：点按钮后若几百毫秒没反应，用户会以为没点上而反复点
        this.deviceAuth = Object.assign(dshgp_normalizeAuthView({}), { phase: 'starting' });
        this.publish();
        try {
          const resumed = await this.resumeDeviceAuthSession();
          if (resumed) { this.deviceAuthBusy = false; return; }
          const res = await dshgp_postJson('/api/git-push/auth/device/start', {});
          this.deviceAuthBusy = false;
          this.applyDeviceAuthView(res);
        } catch (e) {
          this.deviceAuthBusy = false;
          // 网络异常也要留在面板里给「重新开始授权」，不能静默关掉让用户不知道为什么没反应
          this.applyDeviceAuthView({ state: 'failed', reason: '申请授权失败：' + dshgp_describeAuthError(e) });
        }
      }

      /**
       * 接回服务端仍在等用户授权的会话（GET auth/status 的 inProgress 分支）。
       * @returns {Promise<boolean>} true = 已接回（调用方不必再申请新设备码）
       */
      async resumeDeviceAuthSession() {
        let status;
        try {
          status = await dshgp_getJson('/api/git-push/auth/status');
        } catch {
          return false; // status 读不到不阻断：直接走 start 申请新码
        }
        if (!status || status.inProgress !== true || !status.userCode) return false;
        // status 只回展示字段（没有 state/tokenGranted），补一个 awaiting_user 走同一套归一，
        //   这样「接回来的会话」与「刚申请的会话」渲染路径完全一致。
        this.applyDeviceAuthView({
          state: 'awaiting_user',
          userCode: status.userCode,
          verificationUri: status.verificationUri,
          verificationUriComplete: status.verificationUriComplete,
          expiresAtEpochMs: status.expiresAtEpochMs,
          intervalMs: status.intervalMs,
          nextPollAtEpochMs: status.nextPollAtEpochMs,
        });
        return true;
      }

      /**
       * 把一次 start/poll 的服务端视图投影到面板，并按**服务端给的节拍**排下一拍。
       * @param {object} view 服务端响应（两端口同结构）
       */
      applyDeviceAuthView(view) {
        const normalized = dshgp_normalizeAuthView(view);
        // 服务端明确回 ok:false 且带 code（如「授权成功但凭据落盘失败」）⇒ 即便 state 已是
        //   authorized 也按失败显示：token 没落盘等于没授权成功，显示成功会让人以为能推送了。
        if (view && view.ok === false && normalized.code) normalized.phase = 'failed';
        // 兜底到期判定：服务端若在有效期过后仍回 awaiting_user（时钟偏差/旧实现），本地按过期处理，
        //   否则会对着一个已作废的设备码无限轮询，面板永远停在「等待授权中」。
        if (normalized.phase === 'waiting' && normalized.expiresAtEpochMs > 0 && Date.now() > normalized.expiresAtEpochMs) {
          normalized.phase = 'expired';
          if (!normalized.reason) normalized.reason = '授权超时：短码已过期，请重新开始授权';
        }
        this.deviceAuth = normalized;
        this.publish();
        if (normalized.phase === 'waiting') {
          this.scheduleDeviceAuthPoll(normalized.nextPollAtEpochMs);
          return;
        }
        this.clearDeviceAuthTimer();
        if (normalized.phase === 'granted') {
          this.setDeviceAuthNotice(normalized.warning
            ? '✅ GitHub 授权成功（' + normalized.warning + '）'
            : '✅ GitHub 授权成功：凭据已保存，来源已切换为 GitHub 授权', true);
          // 授权把 token 写进了 config.json：重读账号卡，让来源徽标与凭据块立刻反映新凭据
          void this.refreshAccount({ silent: true });
        }
      }

      /**
       * 排下一次轮询。**唯一依据是服务端给的绝对时刻** nextPollAtEpochMs。
       *
       * 为什么不能照抄 clone/npm 那种固定 1s 定时器：Device Flow 有 interval 限制，
       *   轮询过快 GitHub 回 slow_down 并把间隔**永久** +5s —— 越急越慢，
       *   而服务端已经把节流算进 nextPollAt，前端只需照着等。
       * @param {number} nextPollAtEpochMs 服务端给的下一拍时刻（ms epoch）
       */
      scheduleDeviceAuthPoll(nextPollAtEpochMs) {
        this.clearDeviceAuthTimer();
        const at = Number(nextPollAtEpochMs) || 0;
        const now = Date.now();
        // 字段缺席/已过期 ⇒ 用 GitHub 默认 interval 兜底；下限挡住 0 与负数（否则忙等打爆上游）
        const delay = at > 0
          ? Math.min(dshgp_AUTH_POLL_MAX_MS, Math.max(dshgp_AUTH_POLL_MIN_MS, at - now))
          : dshgp_AUTH_POLL_FALLBACK_MS;
        this._deviceAuthTimer = setTimeout(() => {
          this._deviceAuthTimer = null;
          void this.pollDeviceAuthOnce();
        }, delay);
      }

      /** 停掉轮询定时器：终态/取消/成功后必须清，否则面板关了还在打上游。 */
      clearDeviceAuthTimer() {
        if (this._deviceAuthTimer) clearTimeout(this._deviceAuthTimer);
        this._deviceAuthTimer = null;
      }

      /**
       * 一次轮询。**自己不再排下一拍**：结果统一交给 applyDeviceAuthView
       *   （等待态按新的 nextPollAtEpochMs 重排，终态清定时器）——一处排期，
       *   避免两条路径各算一套节奏。
       */
      async pollDeviceAuthOnce() {
        const current = this.deviceAuth;
        // 面板已关闭或已到终态：这一拍作废（取消是本地动作，服务端会话会自然过期）
        if (!current || current.phase !== 'waiting') return;
        if (this.deviceAuthBusy) {
          this.scheduleDeviceAuthPoll(current.nextPollAtEpochMs);
          return;
        }
        this.deviceAuthBusy = true;
        try {
          const res = await dshgp_postJson('/api/git-push/auth/device/poll', {});
          this.deviceAuthBusy = false;
          this.applyDeviceAuthView(res);
        } catch (e) {
          this.deviceAuthBusy = false;
          // 轮询失败给「重新开始授权」入口：静默停轮会让面板永远停在「等待授权中」，
          //   把网络不通伪装成「你还没去点授权」。
          this.applyDeviceAuthView({ state: 'failed', reason: '轮询授权状态失败：' + dshgp_describeAuthError(e) });
        }
      }

      /** 关闭授权面板（本地动作）：停轮询、丢弃展示态。
       *   不销毁服务端会话——设备码会自然过期，而留着它才能让刷新页面后用 status 接回来。 */
      cancelDeviceAuth() {
        this.clearDeviceAuthTimer();
        this.deviceAuth = null;
        this.deviceAuthBusy = false;
        this.publish();
      }

      /** 撤销本地凭据（POST auth/revoke）：清 token + 授权元数据，随后重读账号卡。 */
      async revokeDeviceAuth() {
        if (this.deviceAuthBusy) return;
        this.deviceAuthBusy = true;
        this.publish();
        try {
          // confirm:true 是服务端写确认门禁的硬要求（缺了直接 400 NEED_CONFIRM，
          //   界面会变成一句没头没脑的「撤销失败」）
          const res = await dshgp_postJson('/api/git-push/auth/revoke', { confirm: true });
          if (res && res.ok) {
            this.clearDeviceAuthTimer();
            this.deviceAuth = null;
            this.setDeviceAuthNotice('✅ 已撤销本地凭据（GitHub 侧的授权记录需到 Settings → Applications 删除）', true);
            this.authMode = '';
            this.authLogin = '';
            this.authorizedAt = '';
          } else {
            this.setDeviceAuthNotice('❌ 撤销失败：' + ((res && (res.error || res.message)) || '未知原因'), false);
          }
        } catch (e) {
          this.setDeviceAuthNotice('❌ 撤销失败：' + ((e && e.message) || e), false);
        }
        this.deviceAuthBusy = false;
        // 无论成败都重读账号卡：成功要显示已无凭据，失败也要如实反映当前真值
        void this.refreshAccount({ silent: true });
      }

      /**
       * 设授权结果提示（面板关闭后也能看见「刚才那一下成了没有」）。
       * @param {string} text 提示文案
       * @param {boolean} ok true=成功样式
       */
      setDeviceAuthNotice(text, ok) {
        this.deviceAuthNotice = String(text || '');
        this.deviceAuthNoticeOk = ok === true;
        if (this._deviceAuthNoticeTimer) clearTimeout(this._deviceAuthNoticeTimer);
        this._deviceAuthNoticeTimer = setTimeout(() => {
          this._deviceAuthNoticeTimer = null;
          this.deviceAuthNotice = '';
          this.publish();
        }, dshgp_SAVED_MSG_MS);
        this.publish();
      }

      /** 扫描本地仓库（列表只从 dsh-repo-index.jsonl 读取）。
       * rebuild=true：**离线重建索引**（扫描本地 .git，author 与离线账号 json 一致的登记，
       *   含本地新增，全程不联网）后再读回；缺省：直接读索引返回（不复扫、不联网）。 */
      async scanLocalRepos(path, rebuild, { silent = false } = {}) {
        if (!silent) { this.localLoading = true; this.publish(); }
        const r = await this.uiState.reload('repos', { path: path, rebuild: rebuild === true });
        this.localLoading = false;
        this.publish();
        // 列表先出（毫秒级快照），远端状态由后端后台补 —— 这里按 stale 自动重拉一次，
        //   用户不必手动刷新。只在 stale 时排一次，且同一时刻只排一个（防轮询风暴）。
        const payload = (r && r.ok) ? r.value : null;
        if (payload && payload.stale === true) this.scheduleReposReload();
        // 读取/扫描收尾后**自动补查未知远端状态**——列表里 liveSkipped（本地列表预算/
        //   熔断导致 SSH 探测跳过）的仓库，串行向后端补查（SSH 真源），结果追加写回索引，
        //   同时刷新本地列表的远端状态（remoteHead/ahead/behind/remoteHeadAt/synced）。
        void this.refreshUnknownRemote();
      }

      /**
       * 远端状态过期时，约一个后台补查周期后再拉一次列表（拿到 ahead/behind/分支）。
       * 只排一次：后端补查是单飞的，前端多排几次只会重复请求同一份快照。
       * @param {number} [delayMs] 延迟（默认 8s：覆盖一次 27 仓后台补查的常见耗时）
       */
      scheduleReposReload(delayMs) {
        if (this._reposReloadTimer) return;
        const wait = Number.isFinite(Number(delayMs)) && Number(delayMs) >= 0 ? Number(delayMs) : 8000;
        this._reposReloadTimer = setTimeout(() => {
          this._reposReloadTimer = null;
          void this.uiState.reload('repos');
        }, wait);
      }

      /** 读「已装依赖」面板数据（供状态工厂调用；组件不再自己 fetch）。 */
      loadNpmPackagesPayload(arg) {
        const dir = String((arg && arg.dir) || '').trim();
        return dshgp_getJson('/api/git-push/npm-packages' + (dir ? '?dir=' + encodeURIComponent(dir) : ''));
      }

      /** 读本地仓库列表（供状态工厂调用；不做字段写入，字段由 applyReposPayload 投影）。 */
      loadReposPayload(arg) {
        const a = arg || {};
        const p = String(a.path || '').trim();
        dshgp_localSet('dshgp-scan-path', p);
        const qs = '?rebuild=' + (a.rebuild ? '1' : '0') + (p ? '&path=' + encodeURIComponent(p) : '');
        return dshgp_getJson('/api/git-push/repos-local' + qs);
      }

      /**
       * 把 /repos-local 的返回投影到本类字段（幂等）。
       * 失败路径**不调用**它 ⇒ 上一次的列表继续显示（§四：失败不清空）。
       * 文案也只描述"读到了什么"，不再把失败写成 `❌ 读取失败: …` 塞进同一个字段 ——
       *   失败由 uiStatus('repos') 表达，界面据此渲染可重试的错误条。
       */
      applyReposPayload(payload) {
        const p = (payload && typeof payload === 'object') ? payload : null;
        if (!p) return;
        if (!p.ok) return;                       // 后端明确失败：保留旧列表，状态位由工厂记 error
        this.localPath = String(p.root || this.localPath || '');
        this.localRepos = Array.isArray(p.repos) ? p.repos : [];
        this.localMsg = this.localRepos.length
          ? (p.stale ? '读取到 ' : '读取到 ') + this.localRepos.length + ' 个仓库（' + (p.root || '') + '）'
            + (p.stale ? '；远端状态同步中…' : '')
          : '索引中没有本账号仓库: ' + (p.root || '');
      }

      /** 自动补查 liveSkipped（未知远端状态）仓库：串行走 /repos-local-refresh，更新列表条目。 */
      async refreshUnknownRemote() {
        if (this.refreshingRemote) return; // 防重入
        const skips = (this.localRepos || []).filter((r) => r.liveSkipped === true && r.path);
        if (!skips.length) return;
        this.refreshingRemote = true;
        try {
          const body = { repos: skips.map((r) => ({ name: r.name, path: r.path, branch: r.branch || '' })) };
          const res = await dshgp_postJson('/api/git-push/repos-local-refresh', body);
          const refreshed = (res && Array.isArray(res.refreshed)) ? res.refreshed : [];
          if (refreshed.length) {
            // 把补查结果合并进本地列表（按 name 匹配）
            const byName = new Map(refreshed.filter((r) => r.ok).map((r) => [r.name, r.remoteState || {}]));
            if (byName.size) {
              this.localRepos = (this.localRepos || []).map((r) => {
                const st = byName.get(r.name);
                if (!st) return r;
                return Object.assign({}, r, {
                  remoteHead: st.remoteHead ?? r.remoteHead,
                  ahead: st.ahead ?? r.ahead,
                  behind: st.behind ?? r.behind,
                  remoteHeadAt: st.remoteHeadAt ?? r.remoteHeadAt,
                  synced: st.synced ?? r.synced,
                  liveSkipped: false, // 补查完成，不再是未知
                });
              });
              this.publish();
            }
          }
        } catch { /* 补查失败静默（下次读取再补） */ }
        this.refreshingRemote = false;
      }

 /** 手动「扫描」= 独立进程后台离线扫描 + 只读新增 diff。
       *   流程：① POST repos-local-scan 让后端 spawn 独立进程（扫描中按钮禁用，不可重复点）；
       *        ② 循环 POST repos-local-scan-wait 等待「有新仓库」（非轮询，文件变化才唤醒）；
       *        ③ 每次只把新增仓库**追加**进列表（不全量重读），直到扫描 done；
       *        ④ done 后恢复按钮，最后按索引读一次对齐（收尾）。 */
      async startScan(path) {
        if (this.localScanning) return; // 扫描中不可重复点
        const p = String(path || '').trim();
        dshgp_localSet('dshgp-scan-path', p);
        this.localScanning = true;
        this.localMsg = '⏳ 扫描中…（后台独立进程，扫到一个追加一个）';
        this.publish();
        let seen = this.localRepos.length;
        let scanFinished = false; // 是否**真的收到**结束事件（轮次耗尽不算）
        try {
          const started = await dshgp_postJson('/api/git-push/repos-local-scan', { path: p });
          if (started && started.running && started.ok === false) {
            this.localMsg = '⚠️ ' + (started.error || '扫描进行中，不能重复扫描');
            return;
          }
          // 循环等待新增：每次 wait 挂起直到独立进程写了新进度（非轮询）。
          //   单请求超时显式给 dshgp_SCAN_WAIT_FETCH_MS（> 服务端挂起上限、≤ 默认超时），
          //   否则服务端还在挂起、前端先 abort，长轮询就成了假失败。
          for (let i = 0; i < dshgp_SCAN_WAIT_MAX_ROUNDS; i += 1) {
            const waitRes = await dshgp_postJson('/api/git-push/repos-local-scan-wait', { from: seen }, dshgp_SCAN_WAIT_FETCH_MS);
            const newest = (waitRes && waitRes.newest) || [];
            if (newest.length) {
              // 只追加新增：从索引取这几条详情（不全量重读列表）
              await this.appendScannedRepos(newest);
              seen += newest.length;
              this.localMsg = '⏳ 扫描中… 已发现 ' + seen + ' 个仓库';
              this.publish();
            }
            // 推进只由「结束」这件事驱动：done 事件，或独立进程已退出（running=false）
            if (waitRes && waitRes.done) { scanFinished = true; break; }
            if (!waitRes || waitRes.running === false) { scanFinished = true; break; }
            // waitRes.timeout && running → 服务端到点返回，属于正常「还没结束」，继续下一轮
          }
        } catch (e) {
          this.localMsg = '❌ 扫描失败: ' + (e && e.message || e);
          this.localScanning = false;
          this.publish();
          return;
        }
        this.localScanning = false;
        // 收尾：按索引读一次对齐（保证领先/落后等字段完整）
        await this.scanLocalRepos(p, false);
        // **轮次耗尽 != 扫描完成**：只等到循环上限却没收到 done/退出事件，必须如实报「未结束」
        //   而不是报「✅ 完成」（那是把超时当成功，等于把「事件永远不来」这个 bug 藏起来）。
        this.localMsg = scanFinished
          ? '✅ 扫描完成，读取到 ' + this.localRepos.length + ' 个仓库'
          : '⚠️ 扫描未收到结束事件（已等 ' + dshgp_SCAN_WAIT_MAX_ROUNDS + ' 轮），进度见 scan-live.json；可稍后刷新查看';
        this.publish();
      }

      /** 只把「新增仓库名」对应的条目追加进列表（增量，不全量重建）。 */
      async appendScannedRepos(names) {
        try {
          const indexRes = await dshgp_getJson('/api/git-push/repos-local');
          const all = (indexRes && Array.isArray(indexRes.repos)) ? indexRes.repos : [];
          const have = new Set(this.localRepos.map((r) => r.name));
          for (const n of names) {
            if (have.has(n)) continue;
            const hit = all.find((r) => r.name === n);
            if (hit) { this.localRepos = this.localRepos.concat([hit]); have.add(n); }
          }
        } catch { /* 读取失败保留已追加 */ }
      }

      /** 拉取云端仓库列表（/repos-cloud，token 列账号名下仓库）。 */
      async loadCloudRepos({ silent = false } = {}) {
        if (!silent) { this.cloudLoading = true; }
        this.cloudMsg = '';
        this.publish();
        try {
          const cloudRes = await dshgp_getJson('/api/git-push/repos-cloud');
          if (cloudRes && cloudRes.ok) {
            this.cloudRepos = Array.isArray(cloudRes.repos) ? cloudRes.repos : [];
            // 云端扫描同时写索引（后端 mergeCloudReposIntoIndex），提示已刷新条数
            const idxHint = cloudRes.indexUpdated ? '，索引已刷新 ' + cloudRes.indexUpdated + ' 条' : '';
            this.cloudMsg = '共 ' + this.cloudRepos.length + ' 个仓库（按最近更新排序）' + idxHint;
            // 云端获取后**重新读索引刷新本地列表**——后端已把云端仓库（含
            //   defaultBranch/pushedAt/visibility 云端真源）写进 dsh-repo-index.jsonl，
            //   侧边栏本地面板的远端状态（默认分支/云端更新/仅云端标记）随之更新。
            void this.scanLocalRepos(this.localPath, false);
          } else {
            this.cloudRepos = [];
            this.cloudMsg = '❌ ' + ((data && data.error) || '拉取失败');
          }
        } catch (e) {
          this.cloudRepos = [];
          this.cloudMsg = '❌ 拉取失败: ' + (e && e.message || e);
        }
        this.cloudLoading = false;
        this.publish();
      }

      /** 本地仓库手动 push（领先 + 工作树干净才允许，后端校验）。 */
      async pushLocalRepo(path) {
        this.repoBusy = dshgp_BUSY_PUSH + path;
        this.publish();
        let ok = false;
        let msg = '';
        try {
          const pushRes = await dshgp_postJson('/api/git-push/repo-push', { path, confirm: true });
          ok = !!(pushRes && pushRes.ok);
          if (ok) {
            msg = '✅ 推送成功 ' + path;
          } else {
            // 显示详细错误信息（含 ahead/behind）
            const err = (pushRes && (pushRes.error || (pushRes.push && pushRes.push.reason))) || '推送失败';
            const extra = [];
            if (pushRes && pushRes.ahead > 0) extra.push('领先 ' + pushRes.ahead);
            if (pushRes && pushRes.behind > 0) extra.push('落后 ' + pushRes.behind);
            msg = '⚠️ ' + err + (extra.length ? '（' + extra.join('，') + '）' : '');
          }
          this.localMsg = msg;
        } catch (e) {
          msg = '❌ 推送失败: ' + (e && e.message || e);
          this.localMsg = msg;
        }
        // push 反馈：行内绿/红醒目提示（成功/失败）
        this.repoFeedback = Object.assign({}, this.repoFeedback, { [path]: { ok, msg } });
        this.repoBusy = '';
        // 推送后自动刷新——本地仓库索引（后端维护 + 前列回读）与账号状态
        //   （推送到云端后凭据有效性/登录关系可能变化，一并刷新）。
        void this.scanLocalRepos(this.localPath); // 刷新领先/落后状态
        if (ok) void this.refresh('account'); // push 后刷新账号信息
        this.publish();
      }

      /** 本地仓库手动 commit（只提交不推送）——复用提交推送的本地提交审计。
       *  弹窗输入 commit message → POST /repo-commit → commitWithAudit(push:false)。
       *  精简返回：blocker → 「审计拦截」；warning → 附警告数；成功 → 「已提交 sha」。
       *  @param {string} path 仓库绝对路径
       */
      async commitLocalRepo(path) {
        const message = window.prompt('输入 commit message（本地提交；审计门禁通过才提交）：', '');
        if (message === null || !String(message).trim()) return; // 用户取消
        this.repoBusy = 'commit:' + path;
        this.publish();
        let ok = false;
        let msg = '';
        try {
          const res = await dshgp_postJson('/api/git-push/repo-commit', { path, message: String(message).trim(), confirm: true });
          // post 封装返回 {data, msg...} 或直出 body；data.ok 为准
          const resp = (res && res.ok !== undefined) ? res : (res && res.data ? res.data : res);
          if (resp && resp.ok) {
            ok = true;
            const warnCount = resp.warningCount || 0;
            msg = '✅ 已提交' + (resp.commitSha ? ' ' + resp.commitSha : '') + (warnCount ? '（⚠️ ' + warnCount + ' 条 warning，见审计）' : '');
          } else if (resp && resp.blocked) {
            const list = (resp.blockers && resp.blockers.length ? resp.blockers.slice(0, 2).join('；') : (resp.error || '审计拦截'));
            msg = '🚫 审计拦截：' + list;
          } else {
            msg = '⚠️ ' + (resp && resp.error ? resp.error : '提交失败');
          }
          this.localMsg = msg;
        } catch (e) {
          msg = '❌ 提交失败: ' + (e && e.message || e);
          this.localMsg = msg;
        }
        this.repoFeedback = Object.assign({}, this.repoFeedback, { [path]: { ok, msg } });
        this.repoBusy = '';
        void this.scanLocalRepos(this.localPath); // 提交后未提交数变化，刷新列表
        this.publish();
      }

      /**
       * 1.5.4：请求切换可见性——只记录待确认目标并弹**独立确认面板**（不直接调用后端）。
       * 真正切由 confirmVisSwitch 在用户点了「确认切换」后执行。
       * @param {string} fullName owner/repo
       * @param {string} target public | private
       */
      requestVisSwitch(fullName, target) {
        if (this.repoBusy) return; // 已有交互（clone/push/切换）进行中，不弹
        const cur = this.cloudRepos.find((x) => String(x.fullName || '') === fullName);
        this.visConfirm = { fullName, target, cur: cur && cur.private ? 'private' : 'public' };
        this.publish();
      }

      /** 1.5.4：弹窗「确认切换」——按 visConfirm 记录执行切换，结束后关闭面板。 */
      async confirmVisSwitch() {
        const v = this.visConfirm;
        if (!v) return { ok: false, error: '无待确认的切换' };
        const res = await this.switchVisibility(v.fullName, v.target);
        this.visConfirm = null;
        this.publish();
        return res;
      }

      /** 1.5.4：弹窗「取消 / 关闭」——丢弃待确认目标。 */
      cancelVisSwitch() {
        if (this.visConfirm) {
          this.visConfirm = null;
          this.publish();
        }
      }

      /**
       * 云端仓库私有/公开切换：POST repo-visibility（confirm 前置后端校验）。
       * 成功后就地更新列表该项（云端真源返回值）。
       * @param {string} fullName owner/repo
       * @param {string} target public | private
       * @returns {Promise<object>} 后端响应（{ok, visibility} 或 {ok:false, error}）
       */
      async switchVisibility(fullName, target) {
        const parts = String(fullName || '').split('/');
        const owner = (parts[0] || '').trim();
        const repo = (parts[1] || '').trim();
        if (!owner || !repo) return { ok: false, error: '仓库名格式应为 owner/repo' };
        this.repoBusy = dshgp_BUSY_VIS + fullName;
        this.publish();
        let res;
        try {
          res = await dshgp_postJson('/api/git-push/repo-visibility', { owner, repo, visibility: target, confirm: true });
        } catch (e) {
          res = { ok: false, error: (e && e.message) || '请求失败' };
        }
        this.repoBusy = '';
        if (res && res.ok) {
          // 就地更新列表该项（新数组引用触发订阅重渲染）
          const arr = Array.isArray(this.cloudRepos) ? this.cloudRepos.slice() : [];
          for (const repo of arr) {
            if (String(repo.fullName || '') === fullName) repo.private = res.visibility === 'private';
          }
          this.cloudRepos = arr;
          this.cloudMsg = '✅ 已切换为' + (res.visibility === 'private' ? '私有' : '公开') + '：' + fullName;
        } else {
          this.cloudMsg = '❌ 切换失败：' + ((res && res.error) || '未知错误') + '（' + fullName + '）';
        }
        this.publish();
        return res;
      }

      /** 云端仓库 clone：先弹目录选择器选目标目录，再预览，确认后才真正开始。 */
      cloneFlow(repo) {
        dshgp_browseOpen(null, (dir) => { void this.cloneCloudRepo(repo, dir); });
      }

      /**
       * 第一步：预览（不下载任何文件）。
       *
       * 此前点 clone 直接开下：用户既不知道总量（无从判断要等多久），也不知道
       * 体积守卫会跳过哪些文件。改为先预览、再确认。
       */
      async cloneCloudRepo(repo, dir) {
        this.clonePending = { repo, dir };
        this.cloudMsg = '正在读取仓库信息…';
        this.repoBusy = dshgp_BUSY_CLONE + repo;
        this.publish();
        try {
          // 把目标目录一并交给后端：后端据此回报 partial（「已存在且不完整」= 有进行中标记且无有效提交），
          //   前端才能在确认框里提示「续传 / 重来」。不传 dir 时 partial 恒为 false（后端不猜目录）。
          const pv = await dshgp_postJson('/api/git-push/clone-preview', { target: repo, dir });
          if (pv && pv.ok) {
            this.cloudMsg = '';
            this.clonePreview = pv;
          } else {
            this.cloudMsg = '❌ ' + ((pv && pv.error) || '预览失败');
            this.clonePending = null;
          }
        } catch (e) {
          this.cloudMsg = '❌ 预览失败: ' + (e && e.message || e);
          this.clonePending = null;
        }
        this.repoBusy = '';
        this.publish();
      }

      /** 第二步：点「开始克隆」后真正下载，并轮询进度直到结束。 */
      /**
       * 取消 clone 预览确认框（点「取消」）。
       *
       * 只清预览态与待办态，不做任何远端/磁盘操作——此时尚未开始下载。
       * 放在 Controller 而非组件里，是为了让「取消」也能顺带清 clonePending，
       *   否则残留的 clonePending 会让「确认其它仓库」拿到上一次的目标目录。
       */
      cancelPreview() {
        this.clonePreview = null;
        this.clonePending = null;
        this.publish();
      }

      async cloneConfirmed(restart = false) {
        const pend = this.clonePending;
        if (!pend) return;
        this.clonePreview = null;
        const { repo, dir } = pend;
        this.repoBusy = dshgp_BUSY_CLONE + repo;
        this.publish();
        // 克隆改为**后台 job**——repo-clone 立即返回 202 {async:true, jobId}，
        //   下载在后端继续跑。故此处不再 await 整个克隆，而是：
        //     ① 提交任务（拿 jobId；预检/互斥失败会同步回错，照实显示）
        //     ② 轮询 /clone-progress 驱动进度，直到 state 变 done 取终态
        //   判「卡死」仍看进度是否停滞（大文件慢传不该被杀），不用绝对超时。
        let pollTimer = null;
        const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
        // 终态收敛：把后端 cloneJobStatus() 的 done.result 转成用户文案。
        //   成败与成因仍由后端结构化给出（clone.js 的 cause/retriable），前端不猜文案。
        const renderResult = (res) => {
          if (res && res.ok) {
            // 如实报告被跳过的文件：否则用户以为克隆完整
            const skipped = res.skippedCount || 0;
            this.cloudMsg = '✅ 已克隆 ' + repo + ' → ' + (res.dest || dir)
              + (skipped > 0 ? '（已跳过 ' + skipped + ' 个超大文件）' : '');
          } else {
            const msg = (res && res.error) || '克隆失败';
            const extra = res && res.cleaned && res.retriable === true
              ? '（半成品已自动清理，可直接重试）'
              : '';
            this.cloudMsg = '❌ ' + msg + extra;
          }
        };
        // 轮询：① 更新进度条 ② 检测终态（running → done）后收尾。
        //   consume=true 让后端取走终态，避免下次打开面板读到上次结果。
        const poll = async () => {
          try {
            const st = await dshgp_getJson('/api/git-push/clone-progress');
            if (st && st.state === 'running' && st.progress) {
              this.cloneProgress = st.progress;
              this.publish();
            } else if (st && st.state === 'done') {
              // 任务已结束：先取终态再 consume 清掉（顺序反了会读到空）
              const fin = await dshgp_getJson('/api/git-push/clone-progress?consume=1');
              stopPoll();
              renderResult(fin && fin.result ? fin.result : (st.result || null));
              this.cloneProgress = null;
              this.clonePending = null;
              this.repoBusy = '';
              this.publish();
            } else if (st && st.state === 'idle') {
              // 既非 running 也非 done：任务已消失（进程重启等）——不能永远转圈
              stopPoll();
              this.cloudMsg = '⚠️ 克隆任务已不存在（可能插件进程重启过），请重新发起';
              this.cloneProgress = null;
              this.clonePending = null;
              this.repoBusy = '';
              this.publish();
            }
          } catch { /* 轮询失败不中断克隆本身 */ }
        };
        pollTimer = setInterval(() => { void poll(); }, 1000);
        void poll();
        try {
          // 提交即返回（很快）；超时不必再放到 30 分钟——提交本身不下载。
          // SUBMIT_TIMEOUT_MS 是「提交请求」的超时（不是下载超时）：提交只建后台任务，
          //   故远小于下载/轮询类超时；提取为命名常量以免被当作裸魔数。
          const SUBMIT_TIMEOUT_MS = 60_000;
          // history：勾选框的值（null=未表态则不传字段，跟随后端默认 true；取消勾选 ⇒ 显式传 false 退回整树快照）
          const submit = await dshgp_postJson('/api/git-push/repo-clone', { target: repo, dir, confirm: true, history: this.cloneHistory === false ? false : true, restart: restart === true }, SUBMIT_TIMEOUT_MS);
          if (submit && submit.async === true) {
            // 已转后台：进度与终态交给轮询，这里只提示「已开始」
            this.cloudMsg = '⏳ 克隆已在后台运行：' + repo + ' → ' + (submit.dest || dir);
            this.publish();
          } else {
            // 未转后台 = 提交阶段就失败（预检/互斥/参数）——同步回错，照实显示并收尾。
            //   兼容后端降级为同步返回（老版本/未来改动）的情形。
            stopPoll();
            renderResult(submit);
            this.cloneProgress = null;
            this.clonePending = null;
            this.repoBusy = '';
            this.publish();
          }
        } catch (e) {
          stopPoll();
          this.cloudMsg = '❌ 克隆失败: ' + (e && e.message || e) + '（可直接重试——半成品已自动清理）';
          this.cloneProgress = null;
          this.clonePending = null;
          this.repoBusy = '';
          this.publish();
        }
      }

      /** 审计 tab 顶部即时反馈（区别于设置 tab 的 flashSaved）。 */
