# SPEC：当前有效规格

> 本文件是插件的**契约规格唯一入口**：写清对外接口（工具 / HTTP / 设置键 / 数据文件）与不变量。
> 面向使用者的功能介绍：git / 发布侧见 `docs/功能-发布与工具链.md`；
> 审计侧（规则体系、评分、豁免）属独立包 `audit-sluice`，见它仓库的 `docs/`。
> 设计过程的方案与诊断不在本仓库维护。
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
| `git_filemode` | `filemode` | 查看/写入 `core.filemode`：忽略「文件权限变动」（CIFS 上新建文件是 755/777、仓库记录 644 时，git 会把每个新文件都算成改动）。缺省只查看；`apply:true` 才写；默认只改当前仓库，`scope:'global'` 才写 `~/.gitconfig` |
| `git_identity_rewrite` | `git-sluice identity-rewrite` | 提交身份历史改写（默认 dry-run；`--write` 才改，先建备份引用；`--push` 用 force-with-lease） |
| `git_sluice` | `git` | git 命令透传（凭据自动注入） |
| `npm_publish` | `npm-publish` | npm 发包（**后台 job** + dryRun）：默认只体检并跑 `npm publish --dry-run`（不写 registry ✗）；真发必须同时 `confirm=true` 与 `dryRun=false`；前置体检 `private:true` / 同名版本占用 / `npm pack` 清单 |
| `exempt` | —（无 CLI） | 注释豁免工具（add/remove/list/check：按 rule 自动选标记、写前校验、多文件原子、check 识别死标记） |
| `git_api` | `api` | **直接调用本插件 36 条 HTTP API**（内部走 `handleHttp` 同一条代码路径）；`path` 传接口名（不传则列出全部接口），`method`/`query`/`body` 可选 |

**`git_filemode` 的代价（必须知道）**：设成 `core.filemode=false` 后，**真实的 `chmod +x` 变更也不再被 git 记录**。
所以它适合「整个仓库的权限位本来就不可信」的挂载盘；如果你确实需要跟踪可执行位变更（例如提交脚本的 +x），
就别开它，或改完权限后再 `value:true` 恢复比较。
CIFS 上 `git config --local` 会因 `config.lock` 的 chmod 报 EPERM 而写不进去 ——
实现有退路：直接改写 `.git/config` 文本、**先备份**、写完回读验证（`via` 字段会标明走了哪条路）。

**`repos-local` 的默认语义（重要）**：默认**只读索引快照**（不联网、不逐仓 spawn git），
响应带 `stale`/`liveAt`；远端状态（`remoteHead`/`ahead`/`behind`）由**后台补查**写回索引，
前端在 `stale=true` 时自动重拉一次。`?live=1` 才是「请求内同步探测」（排障/手动刷新），
默认路径不走它 —— 27 仓内联探测实测 87s，必然打爆前端 30s 超时。

**不变量**：工具名唯一且匹配 `^[a-zA-Z0-9_-]+$`；CLI 名唯一；宿主注册面（`listTools`）与注册表（`TOOL_REGISTRY`）同名同数——由 `test/test-tool-contract.mjs` 门禁。增删工具必须同步该测试与 README 工具表。

## 三、HTTP 接口（git/共享前缀 `/api/git-push/`，预处理前缀 `/api/preprocess/`）

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

## 四、设置键（14 个，`settings-set` 白名单）

真源 = `lib/app/handlers/settings.js` 的 `ALLOWED_SETTING_KEYS`（引用见下），本文只列分类：

```
预处理：preCommitEnabled        （前端扁平键；落盘为 config.json 的 preCommit.enabled）
克隆：  maxCloneFileMB  cloneConcurrency
推送：  pushMethod  pushGate
凭据：  githubToken  sshPub  npmToken  npmRegistry
注入：  injectSystemPrompt
自动推送：autoPushEnabled  autoPushTriggerText  autoPushScope  autoPushMessage
```

**边界**：「怎么审」（扫描范围 / 权重 / 规则包 / 文件数上限）不是本插件的设置项 ——
它们归预处理实现（`audit-sluice`）自己的配置文件。宿主只知道「提交前预处理开不开」。

**不变量**：只有白名单内的键可写（其余拒绝）；`preCommitEnabled` 写盘走键级合并
（`writePreCommitEnabled`），不得覆盖同块的 `command` / `args` / `timeoutMs`；
设置持久化走宿主 HTTP（反代访问下 client 侧 scope 快照恒为 memory，不能用它判可用/可写）。

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

**审计侧的采集与豁免规则**（`.auditignore` 四种通道、`dsh-skip-*` 标记、`git ls-files` 采集口径、
`DSH_AUDIT_NO_GIT_FASTPATH` 等）属审计实现，见独立包 `audit-sluice` 的
`docs/DETAILS-EXEMPT-AND-RULES.md`，本仓库不重复维护。

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

## 六、审计规则体系（归属：独立包）

审计的规则、引擎、评分、豁免**不在本仓库**：它们随审计实现一起迁到独立包 `audit-sluice`。
本仓库只保留两件与规则相关的宿主侧行为：

- **提交门禁**：把「仓库 / 可见性 / 本次临时豁免」交给预处理实现，拿回 `blocked` 结论（契约见第十章）；
- **HTTP / 工具转发**：`/api/preprocess/*` 与 `code_audit` / `io_scan` / `link_check` / `scope_check` / `exempt`
  都经 `lib/app/preprocess-client.js` 调包的公开面，宿主不持有实现副本。

规则条数、槽位、评分公式、豁免标记这些「实现内的事实」一律以包自己的文档为准（不要在本仓库重复写死，
写死就必然与包的发版漂移）。

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

## 十一、UI 归属

审计 UI 不属于本插件：审计 Tab 已移出构建，前端分片目录也随审计能力一起迁出。
本插件的设置页只有「账号信息」与「设置」两个页签；审计的实现与配置住在独立包里，
UI 侧将来若要接回，按「谁的实现谁提供 UI」处理，不在本仓库定义契约。

## 十二、命令行入口（本仓库两个 bin）

审计 CLI 随审计实现一起独立成包（`audit-sluice` 自己的 bin），**本仓库只提供两个入口**。
真源 = `lib/cli/shared.mjs` 的 `CLI_ENTRIES` + 各入口的 HELP。

| CLI | bin | 入口 | 定位 |
|---|---|---|---|
| git 侧 | `git-sluice` | `cli.mjs` | 提交/推送/克隆/账号/仓库扫描，外加通用 `preprocess <action>` 转发 |
| 工具链 | `tool-sluice` | `cli-tool.mjs` | 模板打印 / 自检等工具链命令 |

两个入口都有 `version` / `help`。`package.json` 的 `bin` 两条，`files` 含两个入口。
各入口命令清单**不在这里重复**：`<bin> help` 是唯一权威（每行写的参数就是该命令真实接受的写法）。

**跨侧命令（重要）**：敲别侧命令 → **明确报错并给出可照抄的替代命令**，**不做静默转发**。
`git` 侧的未知命令仍透传给 git（`git-sluice status` = `git status`）；`tool` 侧必须报错（不得悄悄执行 git 命令）。

```
$ git-sluice audit .
命令 "audit" 已随能力迁到独立包 audit-sluice（宿主不再内置）。
请改用：git-sluice preprocess audit .（等价：audit-sluice audit …）
```

## 十三、测试结构

> 测试按「被测代码所在的层」分区，与 CLI 三入口 + 装配层对齐；回归入口递归扫描，不再只扫顶层。

```
test/
├── git/      git / 推送 / 克隆 / 发布 / 账户 / 仓库索引
├── audit/    规则 / 判定 / 检查器 / 评分 / 豁免 / 审计 CLI / 审计结果 API
│   └── _archived/   归档：不参与回归，可手动跑（断言当前不成立，例：已移出构建的审计 UI）
├── tool/     工具链：module-splitter / 文档与目录树工具 / 模板 / self-check / CLI 三分
├── app/      插件本体：HTTP 路由 / 设置读写 / 上下文注入 / 斜杠命令 / 工具契约 / 工作区路径
├── fixtures/ 共享夹具（永不当测试）
├── helpers/  共享辅助（test-scan.mjs 扫描器、test-cache.mjs 缓存，永不当测试）
└── run-tests.mjs  回归入口（不属于测试）
```

**硬规则**：
1. 顶层**不得**出现 `test-*.mjs`——新旧结构并存会让同一测试跑两遍、缓存键互相覆盖；`run-tests.mjs` 检测到即 `exit 1`。
2. `_archived/` 下任意层级的测试**一律不参与回归**；`--stats` 必须列出它们与手动跑命令（不允许静默排除）。
3. `helpers/`、`fixtures/` 里的 `*.mjs` 永不被当测试。

**回归入口参数**：`--all`（忽略缓存全跑）、`--stats`（逐文件「所属侧 + 跑/跳过原因」、按侧汇总）、`--dry-run`、`--only=<子串>`、`--batch-size=N`、`--no-cache`。

**缓存语义**（`test/helpers/test-cache.mjs`）：
- key = `sha256(测试文件自身 + 其 import 传递闭包 + node 版本 + 缓存格式版本)` —— **不是 mtime**；
- 命中条件 = key 相同 **且** 上次 `passed === true`（失败过的必重跑）；
- `--stats` 的四类原因：`缓存命中` / `内容变（测试文件自身被改）` / `依赖变（import 闭包里有文件被改）` / `不缓存（含网络·服务调用或整仓不变式测试）`；
- 条目另存 `selfHash`（仅用于区分后两类原因，**不参与 key**）。

**基线**：`node test/run-tests.mjs --all` 必须 `# fail 0`；`# tests` 基准值随测试增删同步维护。

### 测试合并记录（2026-11-13，四批）

**成果**：174 → **125** 个测试文件（-49），`# tests` 始终 1591（零用例丢失）。

**合并方式**（`test/helpers/merge-tests.mjs` 的 `check` / `merge` / `verify`）：
1. 提取各文件 import 块（tokenizer 定位真语句行范围，不是正则）
2. 文件体**按原顺序平铺**，`test()` 仍在模块顶层——**不用 `describe()`**
3. 每个原文件体包一层 `{}` **块级作用域**，只为隔离同名顶层声明（不影响 test 注册时机）
4. import 按模块路径去重、同名具名导入取并集
5. 每个 `test()` 名加 `[原文件名]` 前缀做溯源

**为什么不用 `describe()`**：实测过一次，`describe()` 回调是 async 作用域，把顶层 `test()` /
`const` / `await` 全挪进回调后语义就变了 → **54 失败、少 17 条用例**，已整体回滚。

**五项前置检查**（不满足就跳过该文件，不硬合）：顶层 `await` / 顶层 `process.env` 或
`process.exitCode` 赋值 / `before*`·`after*` 钩子 / 顶层声明命名冲突 / **顶层 `export`**
（`export` 只在模块顶层合法，包进 `{}` 直接 SyntaxError）。

**20 个文件受阻未合并**（`check` 命令按 5 项判定；不是遗漏，是边界）：

| 目录 | 文件 | 卡点 |
|---|---|---|
| git | test-account-refresh-on-push | await(19) + env(17) + after(23) |
| git | test-audit-bad-file | before(25) + after(37) |
| git | test-git-api-tool | await(31,37,42,46) |
| git | test-git-identity | env(24) |
| git | test-git.mjs | before(30) + after(48) |
| git | test-persist-credentials | await(9) |
| git | test-push-false-success | await(19) |
| git | test-quota-write | await(15) + env(13) + after(24) |
| app | test-plugin | env(17) |
| app | test-settings-roundtrip | await(16,17) + env(14) + after(26) |
| app | test-tools-e2e | after(23) |
| app | test-workspace-paths | before(15) + after(22) |
| audit | test-audit.mjs | before(29) + after(57) |
| audit | test-false-positive-fixes | before(29) |
| audit | test-gitignore-nongit-dir | after(26) |
| audit | test-audit-git-boundary | 顶层 export(36,43) |
| tool | test-npm-tab-render | await(18) |
| tool | test-picker-layout | await(30) |
| tool | test-tree-doc | after(157) |
| tool | test-version-metrics | after(15) |

**为什么这些卡点不能绕过**：`await` / `export` 在块级作用域里是**语法错误**（合并直接编译不过）；
`process.env` 赋值与 `before`/`after` 钩子合并后**执行时机改变**（钩子从「紧跟本文件」变成「整文件末尾」），
属明令禁止的语义变化。要把它们合进来需先重写各自内部结构（静态 import / env 移入 `before` /
钩子改 `try-finally`），那是**独立议题**，不与结构合并混做。

### 合并的真实收益（实测，2026-11-13）

**结论：合并不提速。价值在「减少文件数 / 扫描与分批开销 / 结构集中」，不是速度。**

| 项 | 数据 |
|---|---|
| 热跑（125 文件，缓存已填充） | 缓存命中 80 / 真跑 45 / **159.5s** |
| 省下的进程启动 | ≈ 0.2s × 47 文件 ≈ **9.4s** / 次冷跑 |
| 代价 | 大单元把多用例塞进同一进程串行跑（`node --test` 的并发单位是**文件**），并行粒度变粗 |
| 净效应 | 冷跑基本持平或略慢；热跑无差别 |

**关键判读**（实测，非估算）：
- 125 个文件里**只有 6 个不可缓存**：4 个整仓不变式测试（`doc-func` / `doc-version` /
  `func-doc-drift` / `tree-doc`）+ 2 个含语句级网络调用的 npm 测试（`npm-install` / `npm-publish`）。
  判定依据是 `isCacheableTest`：`ALWAYS_RUN_TESTS` 命中 或 `NETWORK_CALL_RE` 命中。
- **装配层 / HTTP 类测试是可缓存的**（`test-http` / `test-plugin` / `test-settings-persistence` /
  `test-tools` / `test-slash-commands` 实测均 `cacheable: true`）。
- 热跑 159.5s / 真跑 45 个那次，是**改名导致缓存条目大面积失效**，不是「装配层不可缓存」。
- **稳态暖跑：12.6s（命中 119 / 真跑 6）** —— 已接近理论下限（那 6 个本来每次必跑）。
  所以**不存在「改造装配层测试使其可缓存」这个优化空间**。

**耗时数据的引用纪律**（防止再出现不可复现的数字）：
- 引用任何耗时前必须标注测量状态：**缓存冷/暖 · 有无改名 · 有无并发**；
- **冷跑（`--all`，缓存空）不写固定值**：实测随 NAS 负载在 250–690s 区间波动，不可作为基准；
- **暖跑（无改动、缓存命中 119/125）：真跑 6 个 / ≈12.6s** —— 这是唯一可复现的基准。

**一处超限记录**：`test/tool/test-cli.mjs` **994 行**，超过合并时定的「单文件 ≤800 行」。
原因：4 个文件合并（466 + 522 + import 差额），块级作用域只消命名冲突、不压行数。
判断：接受（拆开等于部分回退合并成果；且仓库本就有 878 行的 `test-git.mjs` 单例）。
若将来要严格守 800：把 client 那 522 行拆回独立文件（125 → 126）。

**合并工具**：`test/helpers/merge-tests.mjs` 是**常驻基础设施**（非测试、不以 `test-` 开头、不进缓存统计），
三子命令：`check <dir>`（逐文件 5 项前置检查表）/ `merge <dir> '<groups-json>'`（合并前再查一次，任一成员受阻即整体拒绝）/
`verify <dir> <file> <期望用例数>`。将来做同类整理直接复用，不必重新摸索前置条件。

**整仓不变式测试**（`test-cache.mjs` 的 `ALWAYS_RUN_TESTS`，按文件名登记、每次必跑）：
改名或合并这些文件时**必须同步改登记清单**，否则它们会从「每次必跑」退化成「可缓存」，
让「新增文件未登记 README / FUNCTIONS」这类漂移变成假通过。

## 十四、参数动态注册

> 同一个工具/命令的参数表，要能随**运行期配置**变化：某个能力不可用时，它的参数**不出现在签名里**，
> 传了就是「未知参数」而不是被静默忽略。首个落地场景是「提交前审计预处理」——
> 审计引擎不可用时，`git_commit_push` 不该还宣称自己有 `audit` 系列参数。

### 14.1 `params` 的两种形态

`lib/app/command-registry.js` 的注册表条目里，`params` 可以是：

| 形态 | 写法 | 求值时机 | 适用 |
|---|---|---|---|
| **数组** | `params: [{ flag: 'repo', ... }]` | 静态 | 参数与配置无关（绝大多数条目） |
| **函数** | `params: (cfg, hasBuiltinEngine) => [...]` | 每次按当前 cfg 求值 | 参数依赖运行期能力（如审计预处理是否可用） |

**唯一取值入口**：`resolveEntryParams(entry, cfg, hasBuiltinEngine)` ——
数组原样返回、函数调用求值。**任何消费方都不得直读 `entry.params`**，
否则函数形态会被当成数组（拿到函数对象），表现为「参数全丢」或「签名错乱」。

当前三个消费方都已走该入口：

| 消费方 | 位置 | 用途 |
|---|---|---|
| 宿主工具 schema | `lib/app/tools.js` 的 `listTools(cfg, hasBuiltinEngine)` | `parameters` 下发（AI 看到的工具签名） |
| 插件装载 | `lib/app/apply.js` | `listTools(cfg)` 注册工具 |
| CLI 参数校验 | `lib/cli/shared.mjs` | `parseRegistryArgs(rest, resolveEntryParams(entry, cfg))` |

### 14.2 可用性判据（**可用性 ≠ 开关**）

```js
auditPreprocessAvailable(cfg = {}, hasBuiltinEngine) {
  if (cfg?.preCommit?.command) return true;   // 显式配了引擎 ⇒ 参数就该在
  return typeof hasBuiltinEngine === 'boolean' ? hasBuiltinEngine : resolveGateProvider().ok;
}
```

判据看的是「**能不能**跑」（预处理实现的入口文件在不在），与「**默认跑不跑**」
（`preCommit.enabled` 这个开关）是两件事：用户关掉开关之后仍可能想临时传 `--audit` 跑一次，
此时参数必须还在。

`hasBuiltinEngine` 第二参**只为测试注入**（生产不传 ⇒ 走 `resolveGateProvider()` 的真实解析）；
`resolveEntryParams` / `listTools` 都必须把它**透传下去**，否则「不可用态」根本测不出来。

### 14.3 未启用时的语义

| 层 | 行为 |
|---|---|
| 工具 schema（`listTools`） | `git_commit_push.parameters` 里**没有** `audit` / `auditExemptPaths` / `auditExemptReason` |
| CLI 参数校验 | 传 `--audit` → 报 `未知参数 --audit`（**不是**静默忽略） |
| 基础参数 | `repo` / `message` / `messageItems` / `push` / `dryRun` / `force` … 一律不受影响 |

**审计专属参数清单**（`AUDIT_COMMIT_PARAMS`）只此三条，全部由审计预处理贡献：
`audit`（boolean）、`auditExemptPaths`（array）、`auditExemptReason`（string）。

### 14.4 HELP 与动态参数的关系

`params` 是动态的，但 `git-sluice help` 的文本是**手写快照**（`cli.mjs` 的 `const HELP` 模板字面量）。
两者不联动就会在审计剥离后宣传一个不存在的参数。做法：

- `cli.mjs` 导出 `AUDIT_HELP_SNIPPETS`（与审计绑定、需要条件剔除的**精确片段**）
  与 `renderHelp(cfg, hasBuiltinEngine)`：审计不可用时把片段从渲染结果里剔掉；
- `runCli({ helpText })` 支持 **字符串或函数**：git 侧传 `() => renderHelp(cliPluginConfig())`，
  另两个入口仍传静态字符串；
- **漂移防护**：`test/tool/test-cli.mjs` 断言「`AUDIT_HELP_SNIPPETS` 里每一项都真的出现在 HELP 里」——
  改了 HELP 忘改片段表会**变红**，而不是静默失效。

判定标准：审计不可用时，`git-sluice help` 的 commit 行**不再出现 `--audit`**，
但 `--push|--no-push` / `--dry-run` / `--force` / `--message-items` 等基础参数照常显示。

### 14.5 将来加第二种「可剥离的预处理」要做什么

1. 在 `command-registry.js` 定义该能力的 `available` 判定（**只看能力可用性，不看开关**）；
2. 把它的参数收进一个 `XXX_PARAMS` 常量（与 `AUDIT_COMMIT_PARAMS` 同款）；
3. 在对应条目的 `params` 函数里条件拼接：`...(xxxAvailable(cfg, hasBuiltinEngine) ? XXX_PARAMS : [])`；
4. 在 `cli.mjs` 的 `AUDIT_HELP_SNIPPETS` 旁边加 `XXX_HELP_SNIPPETS`，并在 `renderHelp` 里按同一判据剔除；
5. 端到端测试三条：`listTools(cfg, false)` 无该参数 / 传该参数报未知参数 / 可用态三条齐全；
6. 若该能力有开关（如 `preCommit.enabled`），**不要**用开关做可用性判据（见 14.2）。

### 14.6 端到端验证（回归基线）

`test/tool/test-cli.mjs` 覆盖：
- `[动态参数] 审计专属参数由预处理贡献：可用时出现、不可用时不在签名里`
- `[动态参数] 端到端：不可用态下 listTools 无 audit 参数、CLI 传 --audit 报未知参数`
  （含对照组：同一串参数在可用态被接受，证明差异来自参数表而非解析器）
- `[动态参数] HELP 与参数表对齐：不可用态 help 里不再出现 --audit`（含片段表漂移防护）

### 14.7 预处理第三项能力：`renderResult`（结果文案由实现方渲染）

预处理实现除贡献**参数**（14.1）与**可用性**（14.2），还可贡献**结果文案**（拦截原因、结果查询指引、
豁免说明）。git 侧只保留中性兜底文案，具体形状见[十六、与 audit-sluice 的耦合面](#十六与-audit-sluice-的耦合面)。

## 十五、HTTP 前缀分侧

预处理侧端点位于 **`/api/preprocess/*`**（当前 provider 声明 5 条：`audit` / `rule-slots` /
`rule-detail` / `toggle-rule` / `exempt-hint`），git 与共享端点继续在 `/api/git-push/*`。

**两条前缀由同一个 `handleHttp` 入口服务**（`apply.js` 用同一 handler 函数注册两次）⇒ 鉴权
（Origin/CSRF、body 上限、写确认）对两条前缀完全一致。**禁止为新前缀另写 handler 入口**——
那会是一个无门禁的裸端点；`test/app/test-plugin.mjs`（`handlers.size === 1` 断言）用
`routes[0].handler === routes[1].handler` 钉住这条。

**`git_api` 工具的 `path` 三种写法**（不加 `side` 参数，AI 面契约零变更）：
短名（`rule-slots`）/ 前缀相对（`preprocess/rule-slots`，推荐）/ 完整路径。

**共享端点（有意留 `/api/git-push/*`）**：`status`、`settings-get/set`、`workspace-paths`、`tools`、`tool-probes`。
理由：它们要么是「插件整体状态」、要么被多侧共用，强行二分会造成两次请求或语义混淆。

## 十六、与 audit-sluice 的耦合面

> 这一节是**书面契约**：宿主与审计实现之间只允许存在下面三处耦合面。
> 想加第四处，先改这一节并说明理由——代码门禁也会拦（见本节末）。

### 16.1 三处耦合面（唯一允许的文件）

| 文件 | 职责 | 允许做什么 |
|---|---|---|
| `lib/preprocess/providers.js` | provider 声明与入口解析 | 声明 provider（id/label/包名/CLI 相对路径）；按 环境变量 → 插件 `node_modules` → 平级目录 解析出 CLI 绝对路径；读各 provider 的 `lib/manifest.js` |
| `lib/commit-push/pre-commit-engine.js` | 提交门禁的子进程调用 | 拼参数、spawn、按退出码判拦截、超时 fail-closed、解析 stdout 单行 JSON |
| `lib/app/preprocess-client.js` | 工具/HTTP 的进程内调用 | 动态 `import` 实现的公开面（`lib/index.js` / `lib/capabilities.js` / `lib/manifest.js`），把结果转成工具/HTTP 形状 |

除这三个文件外，宿主 `lib/` 内**不得出现实现包的模块说明符**（`from 'audit-sluice…'` / `import('audit-sluice…')`），
也不得出现审计实现目录（`lib/{ast,audit,audit-rules,checks,exempt,rule,score,lint-adapter,link-check}`）。
两条都由 `scripts/check.mjs` 的「解耦」「耦合面」两项机器校验守住。

### 16.2 CLI 契约（与语言无关）

实现方提供一个可执行入口（当前 `audit-sluice` 的 `cli.mjs`）：

```
stdout : 一行 JSON { ok, scope, summary:{blocker,warning,notice,total}, quality, blocked, findings, files, … }
exit 0 : 无 blocker（放行）
exit 1 : 存在 blocker（**事实**，不等于判拦截——最终判拦截在 git 侧）
exit 2 : 执行失败（参数错、内部异常）
stderr : 仅诊断信息，不参与判定
```

**fail-closed**：找不到入口 / 超时 / 退出码非 0|1 / stdout 不合契约 ⇒ 拒绝提交且不执行任何 git 操作。
**例外**：实现包"不在位"（可选依赖没装）⇒ 跳过预处理并如实标注（`preprocessSkipped`），不拦提交。

### 16.3 传给实现的参数（配置归谁）

宿主只传**调用上下文**：`--repo`、`--visibility`（private|public|unknown）、
`--exempt-paths` / `--exempt-reason`（本次临时豁免）、`--ruleset`（调用方显式指定）、`--blockers-only`、`--json`。

**不传**实现自己的配置（扫描范围 / 权重 / 规则槽位 / 文件数上限）——那些归实现包的配置文件，
宿主替它传就等于两个包共享一份配置。宿主侧只有「提交前预处理开不开」（`preCommit.enabled`）。

### 16.4 manifest 声明（能力真相）

实现包的 `lib/manifest.js` 导出 `preprocessManifest`：

```js
{ id, label, version,
  endpoints: [{ path, method, desc }],   // HTTP 子端点（挂到 /api/preprocess/）
  actions:   [{ action, params, desc }] } // 动作（CLI `preprocess <action>` / HTTP 同名）
```

宿主的 HTTP 路由、CLI 转发、工具参数都按这份声明查"谁提供了什么"，不写死具体实现的能力清单。
可选能力：`params`（给工具签名贡献参数）、`enabled`（可用性判据，≠ 开关）、`renderResult`（结果文案）。

### 16.5 实现方自己的文档

审计实现的规则体系 / 评分 / 豁免 / 性能基线属实现包，见 `audit-sluice` 仓库的 `docs/`：
`功能-审计引擎.md`、`功能-审计规则体系.md`、`DETAILS-EXEMPT-AND-RULES.md`、`PERF-BASELINE.md`。

## 十七、预处理阶段链（`preCommit.stages`）

> 把「提交前跑一个命令」升级成「按顺序跑几件事」：典型是「先格式化，再审计」。
> **向后兼容是硬约束**：不配 `stages` 时，回执与拦截决策与升级前逐字段一致（只多一个 additive 的 `stagesSource`）。

### 17.1 配置与执行形态

```jsonc
{
  "preCommit": {
    "enabled": true,
    "stages": [                                  // 数组顺序 = 执行顺序
      { "command": "node", "args": ["fmt.mjs", "{filesFile}"], "onFail": "warn", "timeoutMs": 60000 },
      { "provider": "audit", "onFail": "block", "timeoutMs": 600000 }
    ],
    "command": "", "args": [], "timeoutMs": 600000   // 旧单命令模式（stages 为空时生效）
  }
}
```

| 写法 | 含义 |
|---|---|
| `{ provider: 'audit' }` | 走 provider 注册表解析（已有通道） |
| `{ command: 'node', args: [...] }` | 跑任意脚本，**不要求**对方声明是插件扩展；**不走 shell**（文件名含空格也安全，推荐） |
| `{ command: 'node x.mjs --mode staged' }` | 单字符串形态：按 shell-like 规则**切词**（不启动真 shell，`;`/`$( )` 只当普通参数） |

条目必须**且只能**给 `provider` 或 `command` 之一；两者都给/都不给 ⇒ **解析期直接报错**（跑任何 git 操作之前）。

### 17.2 优先级（调用参数 > 配置）

```
调用参数 preprocessStages  >  preCommit.stages（配置）  >  preCommit.command 单命令  >  单 provider 默认
```

`preprocessStages` 是工具参数（`git_commit_push`）与 CLI flag（`git-sluice commit --preprocess-stages '<JSON|@file>'`）：
元素形态与配置里的 stage 一致。它表达的是**调用语义**（"这一次提交我想额外跑什么"），配置表达的是**环境语义**
（"这个项目默认怎么检查"）。回执里的 `stagesSource` 会如实标出来源：`param` / `config` / `command` / `default`。

### 17.3 失败语义（宿主不按 provider 名字判断）

```
onFail = 用户配置的 stage.onFail  >  provider manifest 的 defaultOnFail  >  'block'
```

| 值 | 行为 |
|---|---|
| `block`（**缺省**） | 中断整条链并拒绝提交（fail-closed：没声明就等于没承诺"失败没关系"） |
| `warn` | 记警告并继续下一阶段（回执 `preprocessWarnings`） |
| `skip` | 静默跳过该阶段 |

provider 可在自己的 `preprocessManifest` 里声明 `defaultOnFail`（见 16.4）；**宿主不写任何"谁是审计谁是格式化"的分支**。
实现方"不在位"（包没装）不算失败 ⇒ 记 `skipped` + 警告并继续（热插拔语义）。

### 17.4 交给实现方的上下文（环境变量 + 占位符，两套并存）

| 环境变量 | 内容 |
|---|---|
| `PREPROCESS_REPO` | 仓库绝对路径 |
| `PREPROCESS_CHANGED_FILES` | 本次改动文件清单（**换行**分隔；文件名可含逗号） |
| `PREPROCESS_CHANGED_FILES_COUNT` | 条数 |
| `PREPROCESS_CHANGED_FILES_FILE` | 同一份清单的落盘路径（文件多时不撞 128KB 单变量上限） |
| `PREPROCESS_STAGE_PROVIDER` | 当前阶段标识（provider id 或命令名） |

`args` / 单字符串里可用占位符（宿主替换）：`{repo}` `{filesFile}` `{filesCount}` `{stage}`。
两者不冲突：脚本可以只读环境变量，也可以从 argv 拿。

### 17.5 改动可见（快照差集）

每个阶段**前后各拍一次**工作树快照（`git status --porcelain -z` + 路径的**内容指纹**），差集即该阶段改动：

```jsonc
{
  "preprocessStages": [
    { "provider": "fmt", "kind": "command", "ok": true, "ms": 1200,
      "changed": { "added": 0, "modified": 5, "deleted": 0, "files": ["a.js", "b.js"] } },
    { "provider": "audit", "ok": true, "ms": 8000 }
  ],
  "preprocessChanges": { "total": 5, "files": ["a.js", "b.js"] },
  "stagesSource": "config"
}
```

- 用**内容指纹**而不是 mtime/大小：跑两次格式化、第二次内容相同 ⇒ 必须报 0 改动（幂等可验证）。
- 为什么由宿主拍快照而不是要求实现方上报：任何"会改文件的实现"（格式化/自动修复/锁文件更新）都通用，
  不需要扩 CLI 契约。
- 阶段改的文件在本次提交里会被后续 `git add` 一并纳入（引擎在 add **之前**跑，位置天然正确）。

## 十八、格式化 provider：设计分析（**本插件不内置**）

> 本节是**设计分析**，不是待实现功能：`dsh-git-push` 里**没有任何格式化逻辑**，也不会内置
> `.go`/`gofmt`/`prettier` 这类常量。要落地请做成独立 provider 包（如 `format-sluice`），
> 由它自己决定映射与配置；宿主只负责「按序跑 + 拍快照 + 报改动 + 按 onFail 决策」。

### 18.1 映射与分组（性能关键）

| 扩展名 | 命令 |
|---|---|
| `.go` | `gofmt -w <files…>` |
| `.rs` | `rustfmt <files…>` |
| `.js` / `.ts` | `npx prettier --write <files…>` |

**按扩展名分组，一次带多个文件**：100 个 `.js` 逐个 `npx prettier` 会启动 100 次 npx（每次 1–2s 解析，
合计分钟级）；分组一次调用是秒级。范围仍限**本次改动文件**（`git diff --name-only`），不做全仓。

### 18.2 三条设计原则（从参考实现提炼）

| 原则 | 依据 | 含义 |
|---|---|---|
| **绝不下载工具** | `stigmer/format-on-edit`（Apache-2.0，只在项目已装对应格式化器时才跑） | 只调用项目**已安装**的格式化器；没装 ⇒ 跳过该扩展名 + 汇总警告（禁静默跳过） |
| **尊重项目原有配置** | `ucf`（Universal Code Formatter，会自动读取 `.prettierrc` / `rustfmt.toml`） | 调用时不传自己的 `--config`，让工具自己找项目配置 |
| **路由是纯函数** | `hjkl-mangler`（Rust 库）的 `formatter_for_path(filePath) → formatter` | 写成 `formatterForPath(filePath) → { command, args } \| null`，无副作用、可单测；不要散在 if-else 里 |

其它可参考：Claude Code 的钩子脚本用最简 `case "$file" in *.ts\|*.tsx) npx prettier --write "$file" ;; esac` 做路由，
只适合单文件、无分组的场景。

### 18.3 按组记账（多语言混装仓库）

各扩展名分组**独立成败**，不是"格式化阶段整体成功/失败"：
`.go` 成功（改 3 个）、`.js` 因 prettier 未装跳过（警告）、`.rs` 失败（rustfmt 报语法错）——
回执要能同时表达这三种状态（`changed` / `skipped` + `warnings` / `error`），而不是一个布尔值。

### 18.4 幂等性是硬要求

同一批文件跑两次，第二次改动数必须为 0；否则每次提交都在改文件，还可能形成
「格式化 → 审计发现变动 → 再格式化」的循环。宿主的快照差集（17.5）已能直接验证这一点。
