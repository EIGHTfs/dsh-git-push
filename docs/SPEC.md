# SPEC：当前有效规格

> 本文件是插件的**契约规格唯一入口**：写清对外接口（工具 / HTTP / 设置键 / 数据文件）与不变量。
> 面向使用者的功能介绍在 `docs/功能-审计引擎.md`（审计侧）与 `docs/功能-发布与工具链.md`（git / 发布侧）；
> 规则字段与豁免全录见 `docs/DETAILS-EXEMPT-AND-RULES.md`。设计过程的方案与诊断不在本仓库维护。
> 规格以**代码为准**；本文件与代码不符时以代码为准并回来修正本文件。

## 一、身份

| 项 | 值 |
|---|---|
| 插件名 | `dsh-git-push` |
| 入口 | `lib/index.js`（导出 `name` / `Config` / `apply` / `callTool` / `handleHttp` / `listTools` / `listRuleSlots` …） |
| 依赖 | `js-yaml` / `web-tree-sitter` / `tree-sitter-wasms`（规则解析与语法树）；`lib/client.js` 由 `scripts/build-client.mjs` 拼接生成 |
| 装载声明 | `package.json` 的 `dsh.bundle.patch` → `./cordis.patch.yml`；`dsh.client` 声明 web 端注入；`dsh.skills` 列出随包发布的 skill |
| 配置目录 | `<DSH_HOME>/git-push/`（凭据与状态文件都落在这里） |

## 二、工具（21 个，宿主可见公开面）

| 工具 | CLI 名 | 用途 |
|---|---|---|
| `git_scan` | `scan` | 扫描工作区 git 仓库（分支/远端/未提交/未推送/活动） |
| `git_commit_push` | `commit` | 一键提交+推送（先审计，blocker 拦截） |
| `code_audit` | `audit` | 全量/变动审计（规则包/权重可传） |
| `git_clone` | `clone` | 从 GitHub 克隆（Git Data API，走认证通道） |
| `git_remote_create` | `remote-create` | 按项目目录建远端仓库并设 origin |
| `git_set_visibility` | `set-visibility` | 切换仓库 public/private |
| `io_scan` | `file-io` | I/O 风险扫描（四级分级） |
| `git_clone_preview` | `clone-preview` | 克隆预演（不落盘，报告将拉什么） |
| `link_check` | `link-check` | 文档链接有效性检查 |
| `scope_check` | `scope-check` | 拼接产物作用域撞名（按真实作用域帧；同帧重名 → 后者静默顶掉前者）。`files` 空 = 读项目 `dshScopeCheck.files`；`prefix`/`topLevelMustBeEmpty` 空 = 按项目契约；被审项目没声明 ⇒ 只查同帧重名 |
| `module_splitter` | `module-splitter` | 巨型单文件按顶层块拆分 |
| `git_account_check` | `account-check` | 账号与凭据在线校验 |
| `git_cred_env` | `cred-env` | 输出凭据环境变量前缀（不含明文） |
| `git_gen_ssh_key` | `gen-ssh-key` | 生成 SSH 密钥对（私钥不出本机） |
| `git_identity_rewrite` | `git-sluice identity-rewrite` | 提交身份历史改写（默认 dry-run；`--write` 才改，先建备份引用；`--push` 用 force-with-lease） |
| `git_sluice` | `git` | git 命令透传（凭据自动注入） |
| `npm_publish` | `npm-publish` | npm 发包（**后台 job** + dryRun）：默认只体检并跑 `npm publish --dry-run`（不写 registry ✗）；真发必须同时 `confirm=true` 与 `dryRun=false`；前置体检 `private:true` / 同名版本占用 / `npm pack` 清单 |
| `exempt` | —（无 CLI） | 注释豁免工具（add/remove/list/check：按 rule 自动选标记、写前校验、多文件原子、check 识别死标记） |
| `git_api` | `api` | **直接调用本插件 36 条 HTTP API**（内部走 `handleHttp` 同一条代码路径）；`path` 传接口名（不传则列出全部接口），`method`/`query`/`body` 可选 |

**不变量**：工具名唯一且匹配 `^[a-zA-Z0-9_-]+$`；CLI 名唯一；宿主注册面（`listTools`）与注册表（`TOOL_REGISTRY`）同名同数——由 `test/test-tool-contract.mjs` 门禁。增删工具必须同步该测试与 README 工具表。

## 三、HTTP 接口（36 条，前缀 `/api/git-push/`）

> npm 相关 7 条：`npm-account`（离线快照）/ `npm-check`（在线校验）/ `npm-owned`（账号名下包）/
> `npm-packages`（目录依赖）/ `npm-install`（安装，可 `async:true`）/ `npm-install-progress`（安装进度轮询）/
> `npm-publish`（发包，默认 dry-run）

```
status  scan  browse
repos-local  repos-local-scan  repos-local-scan-wait  repos-local-refresh  repos-cloud
repo-visibility  repo-push  repo-commit  repo-clone
clone-logs  clone-abort  clone-preview  clone-progress
tools  tool-probes  rule-slots  rule-detail  audit  toggle-rule
account-status  account-check  api-quota  gen-ssh-key
settings-get  settings-set
```

**不变量**：

- 写类方法必须带**同源 Origin**（缺了返回 403 `NO_ORIGIN`，防 CSRF）。唯一的例外通道：**无 Origin 时**，
  若 `Content-Type` 是 `application/json` **且** 请求来自本机则放行。**「本机」以 TCP 对端地址
  （`req.socket.remoteAddress`）为准，Host 头只在拿不到 socket 地址时兜底**——Host 可被客户端伪造
  （`Host: 127.0.0.1` 即可伪造本机），socket 地址由内核给出、不可伪造
  —— 桌面端（`dsh-app://app`）的壳转发会显式剥离 Origin，不放行则桌面版所有保存失效。
  安全性依据：浏览器跨站写请求必带 Origin（走既有跨源拒绝）；跨站表单设不出 JSON CT；
  fetch/XHR 设 JSON CT 触发 CORS 预检而本 API 不回 CORS 头；非回环 Host（局域网直连）不放行。
- **每次 403 拒绝都写 `http-rejects.log`**（与 `settings-ui.log` 同级、0600），
  记 method / url / origin / host / code，query 里键名疑似凭据的值替换为 `(已省略)`
  —— 拒绝发生在 handler 之前，不留痕则用户与排查者都无从下手；
- **凭据类设置键不回显明文**：`settings-set` 写 `githubToken` / `sshPub` / `npmToken` 成功后
  回显 `(已保存)`（与 schema `role('secret')` + `redactConfig` 同一口径）；
- 破坏性操作（`repo-clone` / `repo-push` / `repo-commit` / `repo-visibility` / `rebuild` / `rollback`）需 body 显式 `confirm: true`，否则 400 `NEED_CONFIRM`；
- 请求体大小有上限（超限拒绝）；
- 返回统一为 `{ ok, … }` 形状；错误带 `code` 与 `message`。

## 四、设置键（18 个，`settings-set` 白名单）

```
审计：auditEnabled  auditScanScope  maxScanFiles  weightOverrides  auditRuleOrder  auditDisabledSlots
克隆：maxCloneFileMB  cloneConcurrency
推送：pushMethod  pushGate
凭据：githubToken  sshPub
注入：injectRequirements  injectSystemPrompt
自动推送：autoPushEnabled  autoPushTriggerText  autoPushScope  autoPushMessage
```

**不变量**：只有白名单内的键可写（其余拒绝）；设置持久化走宿主 HTTP（反代访问下 client 侧 scope 快照恒为 memory，不能用它判可用/可写）。

**例外：`preCommit` 不在上述白名单里**，而是 `config.json` 直读（键名 `preCommit`）。
原因：它属于「换引擎的部署级开关」，不是 UI 可编辑项。解析顺序 **`cfg.preCommit` → `config.json` → 内置默认**——
将来若把它加进 UI 的设置白名单，第一档会自动接管，引擎侧代码不用改。

## 五、数据文件（配置目录内）

| 文件 | 内容 | 写入时机 |
|---|---|---|
| `config.json` | 设置与凭据真源 | `settings-set` / 凭据工具 |
| `account-status.json` | 凭据校验快照（有效性/登录名/时间/配额） | **每次推送/提交验证账号时刷新**；侧边栏打开只读 |
| `dsh-repo-index.jsonl` | 工作区仓库索引（JSONL，每行一个仓库；旧 `dsh-repo-index.json` 只读兼容并自动迁移） | 扫描/刷新；推送成功后先全量重建再精确回写 |
| `scan-live.json` | 扫描进度 | 扫描进行中 |
| `mirror-state.json` | 镜像健康度学习结果（每个镜像 failures/disabled/lastOkAt/lastError） | 下载数据校验失败/成功时；可用 `DSH_GIT_MIRROR_STATE` 覆盖位置 |

**豁免的四条通道（各司其职，不要混用）**：

| 通道 | 语法/位置 | 力度 | 可见性 |
|---|---|---|---|
| `.auditignore` 整文件 | `.auditignore` 路径行 | 该文件全部规则不审 | 采集期就不收 ⇒ 报告里看不到 |
| `.auditignore` 细粒度 | `路径 : 规则[,规则]  # 理由` | 只免指定规则（支持 `slot/*`） | **报告单列「已确认豁免 N 条」**，不扣分 |
| `dsh-skip-*` 标记 | 文件头前 3 行 / 行尾 | 按标记覆盖的 kind/规则 | 静默丢弃（历史语义） |
| 规则声明降级 | 规则 yml 的 `scope_rules: … → downgrade` | 仍报、不扣分 | 可见 |

细粒度规则段必须形如 `slot/rule`，否则整行按文件模式处理（防 `C:\`、`https://`、`a:b` 误判）。
命中后 finding 标记 `exempted: true / exemptBy: 'auditignore' / exemptReason`，**标记而非丢弃**。

**采集来源**：git 仓库里用 `git ls-files --cached --others --exclude-standard` 枚举（挂载盘上比 FS 遍历快三个数量级），
非 git 目录仍走目录遍历；两条路径共用同一套过滤，`DSH_AUDIT_NO_GIT_FASTPATH=1` 可强制回退。

**按包形态验证**：发布前冒烟与彩排都先 `classifyPackageForm` 判形态——有库入口（`main`/`exports`）验 import；只有 `bin` 验「真跑 bin --version（比对版本）+ --help（退出码 0）」；两者皆无则明确报「没有可验证入口」。

**本地 registry 彩排**：`npm_publish({ localPreview: true })` 会在发布前真实 publish 到本机 registry、再从它安装并加载公开面，失败即拦（`blocked: local-preview-failed`）；独立自检脚本 `node scripts/local-registry.mjs --selftest` 起一个零依赖 registry 跑同样的 publish → install → 加载公开面，结束即清理，未知包透传公有 registry 当镜像。两者都不写公共 registry。

**推送后等 CI**：`commitAndPush({ waitCi: true, ciTimeoutSec })` 按**推到远端的那个 sha** 查 GitHub Actions，全绿=通过；任一 workflow 失败= `ci.conclusion:'failure'` + `ciFailed:true`；grace 期内没有 run 判「未触发 CI」（不算失败）；超时给 `timeout`（不算失败）。默认不等。

**npm 凭据**：由插件托管（配置目录 `config.json` 的 `npmToken`），发布/撤包时自动注入 npmrc；**无需 `npm login`，也无需向用户索要 token**。缺凭据时工具直接报错（不静默降级到匿名）。

**npm 撤包**：`npm_unpublish` 默认 dryRun 预检（版本存在/ dist-tag 指向 / 72h 窗口 / 唯一版本冷却），真撤需 `dryRun:false` + `confirm:true`；整包撤需 `wholePackage:true`。超 72h 只能满足三条件或改用 `deprecate`。

**npm 发布门禁**：dryRun 与真发前都会跑发布前冒烟——`npm pack` → 干净目录 `npm i <tgz>` → 按 `exports` 公开面逐个 import → 校验 dependencies 已装入；失败即拦（`blocked: smoke-failed`）。浏览器端入口（`./client`）不参与 Node import 校验。

**CIFS 挂载**：本地 git 仓库一律经 `init-compat.ensureUsableLocalRepo` 初始化/修复（`git init` 在 smb2 上会因 `chmod config.lock` 半途失败）。建仓（`git_remote_create`）因此可在挂载盘上工作；`pushInitial:true` 会先本地提交（身份用 `-c` 传入、不写 config）再走 Git Data API 上传，全程不依赖 `git remote add/config`。

**远程仓库改名**：`git_remote_rename`（PATCH name）。dryRun 默认开，报告当前名→新名、本地 remote 改动、以及旧名在仓库内的出现位置（`git grep`，URL 形态与文字分开统计、URL 优先展示）；真改后同步 remote。

**git 钩子**：提交/预演回执列出本次会触发的钩子；只有「可证明坏掉」（解释器不存在 / 引用不存在的机器路径）才注入
`LEFTHOOK=0`，正常钩子照跑。不依赖 `core.hooksPath` 绕行——挂载盘上写 `.git/config` 会 EPERM。

**镜像选择**：`DSH_GIT_MIRROR_PREFIX` 显式值 > 出厂清单 `lib/core/mirror-candidates.json` 首个**未停用**候选 > 全部停用则直连；停用判据为**数据校验**（声明总长 / blob sha 不符），连续 3 次停用、一次成功清零。

**不变量**：写只走收口函数（账号状态 `writeAccountStatusFromResult` / `updateAccountStatusQuota`；索引走索引维护模块）；落盘走**原子写**；「是否已配置凭据」一律查凭据真源，不看快照。

## 六、审计规则体系

- **23 个槽位 / 169 条规则**（默认实际加载 165 条：`i18n` 槽位顶层 `disabled: true` 默认关闭占 3 条，`template` 槽位需显式开启占 1 条），声明在 `lib/audit-rules/audit-rules-<槽位>.yml`；判定在 `lib/ast/*`；产出 finding 在 `lib/checks/*`；调度汇总在 `lib/audit/*`。
- 作用域字段：`exts` / `include_paths`（路径白名单，按文件名或路径前后缀）/ `exclude_paths` / `file_patterns`（**内容**初筛）。
- **规则不自带项目契约**：`kind: scope-collision`（拼接产物作用域撞名）只声明「查不查」；命名前缀、顶层零声明、产物文件清单一律从被审项目自己的 `package.json` → `dshScopeCheck` 读（`lib/audit/scope-policy.js`）。规则包跨仓库共享，把 `dshgp_` 写进 yml 会让所有被审项目收到「缺少 dshgp_ 前缀」。
- 分级：`blocker` / `warning` / `info`；评分 10 维度加权得 0-100 + 等级。**动态权重**：`维度得分 = max(0.1, 10 − k × ln(1 + 命中次数))`、`动态权重 = 命中文件数 ÷ 该维度可作用文件数`（按文件去重；分母由编排层 `computeDimFileCounts` 按规则 `exts` 声明统计——未声明 `exts` 的规则按代码文件 CODE_EXTS 计，缺统计时回退扫描文件总数）、`实际权重 = 设定权重 × 动态权重`、`总分 = Σ(维度得分 × 实际权重) ÷ Σ实际权重 × 10`；口径：无命中的维度不缩放（用设定权重）、分母用 Σ实际权重、文档维度的命中文件数取 `docsScore.files ÷ 总文件数`（无文档文件信息时回退不缩放）、不设下限；`files` 未提供时全部不缩放（静态口径）。
- 豁免标记 9 个（`dsh-skip-*`），判定入口 `lib/exempt/index.js`；finding 的 `exemptHint` 必须与实际生效的标记一致。
- 面向使用者的总览见 `docs/功能-审计引擎.md`；规则字段速查见 `docs/功能-审计规则体系.md`；豁免与规则字段全录见 `docs/DETAILS-EXEMPT-AND-RULES.md`。

## 七、文档产物（生成物，勿手改）

| 产物 | 生成脚本 | 校验测试 |
|---|---|---|
| README 目录结构块 | `scripts/doc-tree.mjs` | `test/test-tree-doc.mjs` |
| `docs/FUNCTIONS.md` | `scripts/doc-func.mjs` | `test/test-doc-func.mjs` |
| `docs/CHANGELOG.md` | `scripts/doc-version.mjs`（数据源含 `version-metrics.json`） | `test/test-doc-version.mjs` |

三个脚本统一 `gen` / `apply` / `check`；`check` 有漂移即非零退出。

## 八、版本纪律

- 三处版本号一致：`lib/self/index.js` 的 `VERSION` ≡ `package.json` 的 `version` ≡ 版本表；
- 推送前自动判定 remote：归属（owner/repo 与登录账号一致）+ 本机可用形态（优先 `ssh://git@ssh.github.com:443/…`）+ 名字优先级（`origin` > `github-ssh` > 其它）；形态不推荐时自动 `remote set-url`，没有可用 remote 时新建；**归属不符的 `origin` 绝不覆盖**（改走 `github-ssh`）；`dryRun` 只报告不写盘；推送回执带 `remote` / `remoteAction` / `remoteReasons`；
- 纯优化不升版本（多次本地提交 → 收尾压缩一次推送）；
- 发版在 `version-metrics.json` 补量化对比，版本表会带上。

## 九、测试基线

- 全量 `test/*.mjs` **必须 0 失败**；新增/修改行为必须带回归；
- 执行器 `test/run-tests.mjs` **分批**跑（默认 40 文件/批，每批独立 `node --test` 进程 + 1GB 堆上限）：单进程跑完全部文件时堆只涨不还，8GB 机器（宿主常驻 5GB+）上会挤爆内存；`--batch-size` / `DSH_TEST_HEAP_MB` 可调，`--only=<子串>` 只跑命中文件；
- 公开面由 `test/test-tool-contract.mjs` 门禁；版本行为基线由 `test/regression-<版本>.mjs` 汇总；
- 工具层端到端见 `test/test-tools-e2e.mjs`（最小 env/cfg 直接驱动 `callTool`）。

## 十、提交前预处理引擎契约

> 提交前的检查不再由插件代码直接调审计函数，而是**调用可配置的引擎子进程**。
> 换引擎（含换语言重写）只改配置，git 侧代码零改动。设计全文见
> `docs/2026-11-13-提交前预处理与审计引擎解耦方案.MD`。

**配置**（`config.json`，缺省不写 = 内置）：

```jsonc
{ "preCommit": { "command": "", "args": [], "timeoutMs": 600000 } }
```

`command` 空 + `args` 空 → 内置 `node scripts/audit-gate.mjs`；
`command` 有值 + `args` 空 → 视作独立二进制（Go/Rust 单文件形态）；
`args` 里的相对路径相对**插件根**解析。

**调用形态**（`--repo/--scope/--json` 等由插件统一追加，引擎只负责解析）：

```
<command> <args...> --repo <绝对路径> --scope diff|full
  [--ruleset <dir>] [--weights <json>] [--max-scan-files <n>]
  [--slots a,b] [--disabled-slots a,b] [--blockers-only] --json
```

**输出与退出码**：

```
stdout 单行 JSON : { ok, scope, summary:{blocker,warning,notice,total}, quality:{score,level,...}, findings:[...], files }
exit 0           : 无 blocker
exit 1           : 存在 blocker（**事实**，不等于判拦截——示例目录/临时豁免/私有库豁免由 git 侧最终判）
exit 2           : 执行失败
```

**失败语义（fail-closed）**：命令不存在 / 超时 / stdout 不合契约 / 退出码 2 → **拒绝提交且不执行任何 git 操作**，
错误信息含「命令、退出码、stderr 尾部」。引擎没跑起来不算「审计通过」。

**不变量**：
- 拦截判定始终在 git 侧（引擎只报事实）；因此 exit 1 不得直接映射成「已拦截」；
- 可选参数**缺省不传**等价于「引擎用自己的默认值」，不得退化成 `0`（0 = 不限，语义相反）；
- 引擎失败时 `blocked:false`（工具侧显示「未完成：<原因>」而不是「被推送门禁拦截」），但 `ok:false` 保证不提交。

## 十一、审计 UI 契约

> 审计 Tab 已于 2.20.15 移出构建（分片归档在 `lib/client-parts/audit/`）。本契约用于**将来接回时**按可插拔方式实现，
> 使 UI 不绑定任何一个引擎的实现细节。本阶段**只定义契约，不实施 UI**。

```
lib/audit-ui-sdk/
├── contract.js   AUDIT_UI_CONTRACT_VERSION + defineAuditPanel() 校验（构建期用）
└── index.js      唯一导出面（实现只能从这里 import）
```

**契约形状**：`meta:{id,name,contractVersion}`（`id` 形如 `/^[a-z][a-z0-9-]{1,31}$/`）+
`Panel:(props)=>vnode` + 可选 `styles?:string`、`setup?:(ctx)=>void|(()=>void)`。

**props**：`data:{summary,quality,findings,ruleSlots}`、`actions:{reload,toggleRule,editWeight,toggleDisabled}`、
`state:{loading,error,auditEnabled,auditScanScope}`。

**字段语义**：`data` 里的字段与**引擎返回同名同构，不做二次改名或裁剪**（如 `quality` 是引擎返回的整个对象，不是只留 `{score,level}`）——契约负责说清结构，不替引擎裁剪；否则引擎加字段就要动契约版本。

**三条硬约束**：① 实现只能从 `lib/audit-ui-sdk` 唯一入口 import；② 校验只覆盖构建期一定能判的部分（形状与版本），
不猜作者意图；③ 契约破坏性改动 `contractVersion +1`，构建期拒绝按旧契约写的实现。

## 十二、命令行入口（三侧拆分）

> 与「审计引擎解耦」同构：审计侧不再与 git 侧共用入口。三个 bin，各自只注册本侧命令。

| CLI | bin | 入口 | 命令 |
|---|---|---|---|
| git 侧 | `git-sluice` | `cli.mjs` | `scan` `commit` `clone` `clone-preview` `remote-create` `rename` `set-visibility` `identity-rewrite` `account-check` `cred-env` `gen-ssh-key` `git` `api` `repos` `index` `npm-publish` `unpublish` |
| 审计侧 | `audit-sluice` | `cli-audit.mjs` | `audit` `ruleset` `file-io` `link-check` `scope-check` `functions` `tree-doc` |
| 工具链 | `tool-sluice` | `cli-tool.mjs` | `module-splitter` `yaml-template` `readme-template` `self-check` |

三个入口都有 `version` / `help`；`package.json` 的 `bin` 有三条，`files` 含两个新入口（否则包内缺文件）。

**跨侧命令（重要）**：在某一侧敲别侧的命令 → **明确报错并给出可照抄的替代命令**，`exit 1`，**不做静默转发**：

```
$ git-sluice audit .
✗ "audit" 属于 audit-sluice，不在 git-sluice 里。
  请改用：audit-sluice audit .
  三入口：git-sluice / audit-sluice / tool-sluice；各自 help 看本侧全部命令
```

**不变量**：
- 公共层 `lib/cli/shared.mjs` 是三个入口的唯一实现来源（参数解析、结果打印、HELP 渲染、版本、跨侧指引），**不得复制成三份**；
- 每个 HELP 只列本侧命令，并附「其它 CLI」小节；`HELP ↔ KNOWN_FLAGS ↔ 命令集`三者一致由 `test/test-cli-split.mjs` 与 `tool-sluice self-check` 双门禁；
- **副作用型 import 按侧归属**：`lib/app/host-doc-checks.js`（文档漂移检查器）与 `lib/rule/compilers.js`（规则编译）只在 `cli-audit.mjs` 顶部——它们删了不报错、只会让功能**静默失效**，故有行为级测试兜底（漂移 fixture 必须报 finding、`ruleset` 编译数必须 > 50）。

