    /* ─────────────────── [10] Controller（状态机 + 数据加载 + 动作注入） ─────────────────── */
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
        this.auditEnabled = false;
        this.injectRequirements = false;
 // 注入总开关（默认开；新增， 扩展为系统提示词+上下文）
        this.injectSystemPrompt = true;
        // 审计扫描范围（diff|full）——设置持久化走 host HTTP，前端本地字段镜像
        this.auditScanScope = 'diff';
        this.ruleOrder = [];
        this.slotMeta = {};
        this.weightValues = {};
        // 补齐：以下键此前只有 schema 声明与 HTTP 白名单，前端**没有 UI 控件**
        //   （只能看不能改）→ 设置「基本都没真正保存」的根源。这里补状态镜像 + 提交 + 回读。
        this.maxScanFiles = 3000;           // 全量审计文件数上限（0=不限）
        this.pushMethod = 'ssh';            // ssh | api | auto
        this.pushGate = false;              // 推送门禁（开启后 push 需显式放行）
        // defaultScanRoot/commitMessage 设置移除——默认扫描路径复用本地仓库
        //   列表选择路径（localStorage dshgp-scan-path），提交信息留空由调用方/AI 生成。
        // 禁用态不再前端变量存储，以 yml 顶层 disabled 为准（listRuleSlots 解析）
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
        this.maxCloneFileMB = 10;    // clone 单文件体积上限(MB)；0=不限
        this.cloneConcurrency = 6;   // clone 并发下载数
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
            // 修复「规则包统计全是 0」：slotMeta 与 ruleOrder 同理，也不再从 scope 覆盖。
            //   snap.value.ruleSlotMeta 是 schema 里声明为「host 启动填充」的字段，但**宿主从未写入**，
            //   于是每次 scope 发布都把它（空对象）赋给 slotMeta，刚由 loadSlots() 拉到的真实统计被清空，
            //   所有规则包行回退到 {blocker:0,warning:0,pass:0,total:0} 兜底值 → 列表里数字全是 0。
            //   权威来源 = loadSlots() 的后端结果（动态发现全部 yml 并带 stats）；启停的即时反馈由
            //   toggleDisabled 自己改 slotMeta、随后 loadSlots 对账。
          }
          this.publish();
        });
        // 重构：scope 快照只作「无 HTTP 时的初值兜底」（typeof 守卫保证 yaml 零写入
        //   时 undefined 不会覆盖；仅单测显式传值才生效）。凭据标志 tokenConfigured/sshConfigured
        //   不再从快照取——公共 yaml 已零写入，snap 里恒缺省只会种出 false，统一由
        //   refreshAccount（/account-check 读凭据文件真源）与 loadSettingsFromHttp 刷新。
        const snap0 = this.scope.getSnapshot();
        if (snap0 && snap0.value) {
          if (typeof snap0.value.auditEnabled === 'boolean') this.auditEnabled = snap0.value.auditEnabled;
          if (typeof snap0.value.injectRequirements === 'boolean') this.injectRequirements = snap0.value.injectRequirements;
          if (typeof snap0.value.injectSystemPrompt === 'boolean') this.injectSystemPrompt = snap0.value.injectSystemPrompt;
          if (typeof snap0.value.auditScanScope === 'string') this.auditScanScope = snap0.value.auditScanScope;
          const wo0 = String(snap0.value.weightOverrides || '');
          if (wo0.trim()) { try { this.weightValues = JSON.parse(wo0) || {}; } catch { /* 忽略 */ } }
        }
        // 若 loadSlots 尚未返回，先用已发现的槽位做占位显示（不含 private/template）
        if (!this.ruleOrder.length && Object.keys(this.slotMeta).length) {
          this.ruleOrder = Object.keys(this.slotMeta).filter((s) => s !== 'private' && s !== 'template');
        }
        // 改走统一刷新入口（一次调用刷设置与槽位；账号仍按需在页面 mount 时刷）
        void this.refresh(['settings', 'slots']);
        // 账号状态改由「首次打开账号信息页」时（dshgp_AccountTab 的 mount effect）
        //   触发 refreshAccount，避免构造阶段与页面打开重复拉取；此处不再自动刷新。
        // 设置持久化走 HTTP 读宿主 scope（绕开 client isLoopback=memory 陷阱——
        //   反代访问时 scope 快照恒 unavailable，从宿主侧读已落盘设置，重启后开关保持勾选）
        // 该读取已并入上方 this.refresh(['settings','slots'])，此处不再重复请求。
      }
      project() {
        // 恒可用/恒可写：数据与写入全走 HTTP（settings-get/settings-set/account-check/rule-slots），
        //   client scope 快照只作初值兜底（见构造处注释）。宿主按 isLoopback 决定 scope 的
        //   persistence——反代/非 loopback 访问时恒 memory 模式、status 恒 unavailable、
        //   writable 恒 false（isLoopback=memory 陷阱）。若仍以快照判 available，设置侧边栏
        //   在反代访问下会整页空白（SectionPage return null）且输入框全禁用，故绕开快照判定。
        return {
          available: true,
          writable: true,
          text: this.text,
          sshPub: this.sshPub,
          sshEmail: this.sshEmail,
          auditEnabled: this.auditEnabled,
          injectRequirements: this.injectRequirements,
          injectSystemPrompt: this.injectSystemPrompt,
          auditScanScope: this.auditScanScope,
          ruleOrder: this.ruleOrder,
          slotMeta: this.slotMeta,
          weightValues: this.weightValues,
          // 补齐：审计进阶 / 推送默认值状态镜像（供 UI 渲染）
          maxScanFiles: this.maxScanFiles,
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
          slotLoading: this.slotLoading,
          slotError: this.slotError,
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
       *   · 'repos'    —— 本地仓库列表（/repos-local 读 dsh-repo-index.json；可配 path/rebuild）
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
        const PARTS = ['settings', 'account', 'repos', 'cloud', 'slots'];
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
            else if (p === 'repos') await this.scanLocalRepos(opts.path, opts.rebuild, { silent: opts.silent });
            else if (p === 'cloud') await this.loadCloudRepos({ silent: opts.silent });
            else if (p === 'slots') await this.loadSlots({ silent: opts.silent });
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
          st = await dshgp_postJson('/api/git-push/clone-progress', {});
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
            const s2 = await dshgp_postJson('/api/git-push/clone-progress', {});
            if (s2 && s2.state === 'running' && s2.progress) {
              this.cloneProgress = s2.progress;
              this.publish();
              return;
            }
            if (s2 && s2.state === 'done') {
              const fin = await dshgp_postJson('/api/git-push/clone-progress', { consume: true });
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

      async loadSettingsFromHttp() {
        try {
          const settingsRes = await dshgp_getJson('/api/git-push/settings-get');
          if (!settingsRes || !settingsRes.ok || !settingsRes.settings) return;
          const v = settingsRes.settings;
          if (typeof v.auditEnabled === 'boolean' && !this.editedKeys.has('auditEnabled')) this.auditEnabled = v.auditEnabled;
          if (typeof v.injectRequirements === 'boolean' && !this.editedKeys.has('injectRequirements')) this.injectRequirements = v.injectRequirements;
          if (typeof v.injectSystemPrompt === 'boolean' && !this.editedKeys.has('injectSystemPrompt')) this.injectSystemPrompt = v.injectSystemPrompt;
          if (typeof v.auditScanScope === 'string' && !this.editedKeys.has('auditScanScope')) this.auditScanScope = v.auditScanScope;
          // 补齐回读：新增 UI 的 7 键（advanced），重启后从 config.json 恢复勾选/取值
          if (typeof v.maxScanFiles === 'number' && !this.editedKeys.has('maxScanFiles')) this.maxScanFiles = v.maxScanFiles;
          if (typeof v.maxCloneFileMB === 'number' && !this.editedKeys.has('maxCloneFileMB')) this.maxCloneFileMB = v.maxCloneFileMB;
          if (typeof v.cloneConcurrency === 'number' && !this.editedKeys.has('cloneConcurrency')) this.cloneConcurrency = v.cloneConcurrency;
          if (typeof v.pushMethod === 'string' && !this.editedKeys.has('pushMethod')) this.pushMethod = v.pushMethod;
          // 补漏：pushGate（推送门禁）此前**不在回读列表**——构造函数默认 false，
          //   打开/刷新设置页时不被宿主真值覆盖，界面永远显示未勾选（实测：勾了门禁、重开页面又变未勾选）。
          if (typeof v.pushGate === 'boolean' && !this.editedKeys.has('pushGate')) this.pushGate = v.pushGate;
          // defaultScanRoot/commitMessage 不再作为设置键回读（已在 UI/白名单移除）
          if (typeof v.weightOverrides === 'string' && v.weightOverrides.trim() && !this.editedKeys.has('weightOverrides')) {
            try { this.weightValues = JSON.parse(v.weightOverrides) || {}; } catch { /* 忽略 */ }
          }
          // 凭据布尔位不受编辑守卫影响：只读派生标记，无回弹风险
          if (typeof v.tokenConfigured === 'boolean') this.tokenConfigured = v.tokenConfigured;
          if (typeof v.sshConfigured === 'boolean') this.sshConfigured = v.sshConfigured;
          this.publish();
        } catch (_e) { /* 端点不可用/未注册时沿用 scope 兜底 */ }
      }

      /** 加载规则包清单（/rule-slots，动态发现 yml）。 */
      // 重构：原 loadCredentialFlags（/status 只刷 tokenConfigured）删除——
      //   凭据标志统一由 refreshAccount（/account-check，读凭据文件真源）刷新，避免第三条链路打架。
      async loadSlots({ silent = false } = {}) {
        if (!silent) { this.slotLoading = true; }
        this.slotError = '';
        this.publish();
        try {
          const slotsRes = await dshgp_getJson('/api/git-push/rule-slots');
          if (slotsRes && slotsRes.ok && slotsRes.slots) {
            const meta = slotsRes.slots.meta || {};
            // 用后端返回的生效顺序；private 恒末尾
            const list = Array.isArray(slotsRes.slots.order) ? slotsRes.slots.order : [];
            const order = list.filter((s) => s !== 'template');
            const forced = Array.isArray(slotsRes.slots.forced) ? slotsRes.slots.forced : [];
            this.slotMeta = meta;
            this.ruleOrder = order;
            if (forced.includes('private') && !this.ruleOrder.includes('private')) this.ruleOrder.push('private');
          } else {
            this.slotError = (slotsRes && slotsRes.message) || '规则包加载失败';
          }
        } catch (e) {
          this.slotError = '规则包加载失败: ' + (e && e.message || e);
        }
        this.slotLoading = false;
        this.publish();
      }

      /** 刷新账号信息（/account-check，读凭据文件真源；同时刷新凭据徽标）。 */
      /** 离线读账号状态（秒级，不触发任何网络）：读 account-status.json 快照 + 凭据文件。
       *   插件启动 / push 后重读 / 账号卡片渲染全用它。「重新检测」才走在线（recheckAccount）。 */
      async refreshAccount({ silent = false } = {}) {
        if (!silent) { this.accountLoading = true; }
        this.publish();
        try {
          const accountRes = await dshgp_getJson('/api/git-push/account-status');
          this.accountBlock = (accountRes && accountRes.block) || '（无账号状态记录，点击「重新检测」在线校验）';
          this.accountLoggedIn = !!(accountRes && accountRes.loggedIn);
          this.tokenConfigured = !!(accountRes && accountRes.tokenConfigured);
          this.sshConfigured = !!(accountRes && accountRes.sshConfigured);
          this.tokenStatus = (accountRes && accountRes.tokenStatus) || null;
          this.sshStatus = (accountRes && accountRes.sshStatus) || null;
          this.apiQuota = (accountRes && accountRes.apiQuota) || null;
        } catch (e) {
          this.accountBlock = '读取失败: ' + (e && e.message || e);
          this.accountLoggedIn = false;
        }
        this.accountLoading = false;
        this.publish();
        // token 配额刷新（异步、不阻塞凭据显示）：查 /api-quota（后端写回快照）→ 按
        //   statusUpdated 标志重读 account-status，使凭据块 Token 行出现「（配额剩余 N/h）」。
        //   查询本身失败不影响凭据展示；落盘失败由 quotaError 记录（不再静默）。
        this.refreshApiQuota();
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

      /** 扫描本地仓库（列表只从 dsh-repo-index.json 读取）。
       * rebuild=true：**离线重建索引**（扫描本地 .git，author 与离线账号 json 一致的登记，
       *   含本地新增，全程不联网）后再读回；缺省：直接读索引返回（不复扫、不联网）。 */
      async scanLocalRepos(path, rebuild, { silent = false } = {}) {
        if (!silent) { this.localLoading = true; }
        this.localMsg = '';
        this.publish();
        try {
          const p = String(path || '').trim();
          dshgp_localSet('dshgp-scan-path', p);
          const qs = '?rebuild=' + (rebuild ? '1' : '0') + (p ? '&path=' + encodeURIComponent(p) : '');
          const localRes = await dshgp_getJson('/api/git-push/repos-local' + qs);
          if (localRes && localRes.ok) {
            this.localPath = localRes.root || p;
            this.localRepos = Array.isArray(localRes.repos) ? localRes.repos : [];
            this.localMsg = this.localRepos.length
              ? (rebuild ? '已重建索引，读取到 ' : '读取到 ') + this.localRepos.length + ' 个仓库（' + (localRes.root || '') + '）'
              : '索引中没有本账号仓库: ' + (localRes.root || '');
          } else {
            this.localRepos = [];
            this.localMsg = '❌ ' + ((localRes && localRes.error) || '读取失败');
          }
        } catch (e) {
          this.localRepos = [];
          this.localMsg = '❌ 读取失败: ' + (e && e.message || e);
        }
        this.localLoading = false;
        this.publish();
        // 读取/扫描收尾后**自动补查未知远端状态**——列表里 liveSkipped（本地列表预算/
        //   熔断导致 SSH 探测跳过）的仓库，串行向后端补查（SSH 真源），结果追加写回索引，
        //   同时刷新本地列表的远端状态（remoteHead/ahead/behind/remoteHeadAt/synced）。
        void this.refreshUnknownRemote();
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
        try {
          const started = await dshgp_postJson('/api/git-push/repos-local-scan', { path: p });
          if (started && started.running && started.ok === false) {
            this.localMsg = '⚠️ ' + (started.error || '扫描进行中，不能重复扫描');
            return;
          }
          // 循环等待新增：每次 wait 挂起直到独立进程写了新进度（非轮询）
          for (let i = 0; i < dshgp_SCAN_WAIT_MAX_ROUNDS; i += 1) {
            const waitRes = await dshgp_postJson('/api/git-push/repos-local-scan-wait', { from: seen });
            const newest = (waitRes && waitRes.newest) || [];
            if (newest.length) {
              // 只追加新增：从索引取这几条详情（不全量重读列表）
              await this.appendScannedRepos(newest);
              seen += newest.length;
              this.localMsg = '⏳ 扫描中… 已发现 ' + seen + ' 个仓库';
              this.publish();
            }
            if (waitRes && waitRes.done) break;
            if (!waitRes || waitRes.running === false) break;
          }
        } catch (e) {
          this.localMsg = '❌ 扫描失败: ' + (e && e.message || e);
        }
        this.localScanning = false;
        // 收尾：按索引读一次对齐（保证领先/落后等字段完整）
        await this.scanLocalRepos(p, false);
        this.localMsg = '✅ 扫描完成，读取到 ' + this.localRepos.length + ' 个仓库';
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
            //   defaultBranch/pushedAt/visibility 云端真源）写进 dsh-repo-index.json，
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
            const st = await dshgp_postJson('/api/git-push/clone-progress', {});
            if (st && st.state === 'running' && st.progress) {
              this.cloneProgress = st.progress;
              this.publish();
            } else if (st && st.state === 'done') {
              // 任务已结束：先取终态再 consume 清掉（顺序反了会读到空）
              const fin = await dshgp_postJson('/api/git-push/clone-progress', { consume: true });
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

 /** 单击规则包行：切换禁用/启用（改为写 yml 顶层 disabled，不存 scope 变量）。 */
      async toggleDisabled(slot) {
        if (slot === 'nodejs' || slot === 'private') {
          this.setStatus('⚠️ nodejs/private 安全红线槽位不可禁用');
          return;
        }
        const meta = (this.slotMeta && this.slotMeta[slot]) || {};
        const nowDisabled = !!(meta.disabled);
        // 即时反馈：先本地翻转（行绿/红 + 顶部提示），不等后端响应
        this.slotMeta = { ...(this.slotMeta || {}), [slot]: { ...meta, disabled: !nowDisabled } };
        this.setStatus(!nowDisabled ? '✅ 已禁用 ' + slot + '（该槽位规则不再加载）' : '✅ 已启用 ' + slot);
        this.publish();
        try {
          const toggleRes = await dshgp_postJson('/api/git-push/toggle-rule', { slot, disabled: !nowDisabled });
          if (toggleRes && toggleRes.ok) {
            void this.loadSlots(); // 后台重载对账（yml 解析结果）
          } else {
            this.setStatus('❌ 切换失败：' + ((toggleRes && toggleRes.error) || '未知错误'));
            this.loadSlots();
          }
        } catch (e) {
          this.setStatus('❌ 切换失败：' + (e && e.message || e));
          void this.loadSlots(); // 恢复 yml 真实状态
        }
      }

      /** 审计 tab 顶部即时反馈（区别于设置 tab 的 flashSaved）。 */
