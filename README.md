# dsh-git-push

DSH（DeepSeek Harness）git 提交推送与代码审计插件——提交前自动审计门禁，提交推送全链路自动化。

![账号信息面板](assets/panel-account.png)

审计面板（14 个规则包 + 按包命中数，上下调次序、单击启停）：

![审计面板](assets/panel-audit.png)

设置面板（凭据 / SSH 公钥 / 审计开关与 10 维度权重）：

![设置面板](assets/panel-settings.png)

> **公开仓库**：EIGHTfs/dsh-git-push（2026-09-13 转 public）｜全量测试 490 全绿（`npm test` 一条命令可复现）
> **界面模拟页**：`assets/preview.html`（单文件自包含，双击即可打开；跑的是真实 `client.js` + 假数据，三选项卡全部可点）
> **截图声明**：`screenshots.json`（仓库根、与 `package.json` 同级，列出 `assets/panel-*.png`）——DSH 插件榜单按此文件自动收录截图，作者推自己的仓库即生效，无需到榜单仓库提 PR

## 目录

- [功能总览](#功能总览)
- [一、提交推送](#一提交推送)
- [二、代码审计](#二代码审计)
- [三、系统提示词注入](#三系统提示词注入)
- [侧边栏设置](#侧边栏设置)
- [独立 CLI（git-sluice）](#独立-cligit-sluice)
- [独立脚本：清洗用户沟通措辞](#独立脚本清洗用户沟通措辞)
- [独立脚本：运行时检测（三层审计 L3）](#独立脚本运行时检测三层审计-l3)
- [安装与要求](#安装与要求)
- [版本列表](#版本列表)
- [注意事项](#注意事项)

## 功能总览

插件围绕 DSH 日常开发的两个高频动作，分为**提交推送**与**代码审计**两大块：

| 功能块 | 做什么 | 入口 |
|---|---|---|
| **提交推送** | token / SSH 密钥管理、提交、推送、clone、建仓、可见性切换、force 强推、版本历史 | `git_commit_push` 工具 / CLI / 侧边栏 |
| **代码审计** | 提交前自动审计门禁、14 个规则槽位 107 条规则、10 维度质量评分、豁免机制、链接检查、**三层审计管线（L1 正则初筛 / L2 AST 数据流 / L3 运行时检测）** | `code_audit` 工具 / CLI / 侧边栏 |

## 一、提交推送

Git 全链路自动化，token / SSH 凭据管理 + 提交推送，无需手动敲 git 命令。

### 凭据管理

- **Token**：GitHub token（`ghp_` / `github_pat_` 开头），保存即写入插件配置目录 `credentialsDir()/github-token`（**0600 权限**），不落 settings.yaml 明文
- **SSH 公钥**：保存写入 `credentialsDir()/*.pub`（按类型 id_rsa.pub / id_ed25519.pub）；**一键生成密钥对**（邮箱 → `ssh-keygen` 4096 位，公钥自动填入并复制剪贴板，私钥只落本机）
- **账号检测**：`GET /api/git-push/account-check` 在线校验（token 调 api.github.com + SSH 指纹 + 绑定关系），侧边栏账号面板实时显示登录态

### 提交推送能力

| 能力 | 说明 |
|---|---|
| `git_commit_push` | 一键提交+推送（审计门禁默认开启；敏感文件自动 .gitignore；`--push/--no-push/--dry-run/--force/--req-confirm/--json`） |
| 推送通道 | **api 通道**（Git Data API，blob→tree→commit→ref，分支免疫）优先，401 自动回退 **SSH 通道**（ssh.github.com:443） |
| force 强推 | API 通道重建 commit 去旧 parent / SSH 通道 `git push --force` |
| clone / 建仓 | `cloneViaApi`（trees+blobs 写文件转 git 仓）/ `ensureRemoteRepo`（建仓+设 origin） |
| 可见性 | `setVisibility` PATCH 切换 public/private |
| 网络硬闸 | 只允许 api.github.com（`githubFetch` 拒绝非该域名，不跟随 302） |

### 提交前自动门禁

提交推送前自动跑代码审计（见下节）：**有 blocker 拦截提交**（退出码 2），warning 只提示不拦截。审计通过才执行 commit + push。

## 二、代码审计

提交前自动审计 + 独立全量扫描，规则可扩展，质量可评分。

### 审计入口

- `auditChanged`：变动范围（git diff）——提交前默认
- `auditFull`：全量扫描（非 git 目录可查）
- `code_audit` 工具 / `git-sluice audit` CLI：强度、规则包、权重全覆盖

### 规则引擎（yml 管理）

规则槽位由目录文件驱动：目录里每个 `audit-rules-<名>.yml` 即一个槽位，**放文件即生效、删文件即移除**，无需改代码。内置 14 个槽位：

| 槽位 | 规则数 | 检查内容 |
|---|---|---|
| nodejs | 36 | 凭据硬编码 / 路径穿越 / 魔数 / 依赖 / 异步等 |
| frontend | 19 | 前端安全 / a11y / 依赖 |
| npm | 10 | 依赖声明 / npmrc 凭据 / 测试入口 |
| version | 8 | 版本号规范 |
| dsh | 7 | DSH 插件契约 / 注入通道 |
| comment | 6 | 注释措辞 / 对话残留 |
| folder | 6 | 目录总数 / 单目录文件数 / 解包特征 / .gitignore / cd 到可能不存在的目录 / 写文件到 .gitignore 忽略目录 |
| i18n | 3 | 硬编码文案 / 插值 / 语言包 |
| performance | 2 | memory-bomb / busy-wait |
| docs / robustness / structure / template / private | 各 0-4 | 链接检查 / 写前 mkdir / 循环依赖 / 规则模板 / 私密文件拦截 |

**加规则 = 放文件**；**加字段类型（新 kind）才需加函数**（compilers.js 注册制：`registerCompiler(kind, detect, compile)`，加字段=加函数+注册一行，`compileRule` 主体永不修改）。

### 目录结构（自动生成）

> 由 `scripts/tree-doc.mjs` 维护：`gen` 生成 / `check` 查漂移 / `apply` 覆盖本节。
> 注释来源 `tree-doc.json`（路径 → 一句话介绍），新增文件标「（待注释）」由 AI 补。

<!-- dshgp-tree:start -->
```text
dsh-git-push/
├── lib/ — 核心实现（10 总入口 + 审计引擎 + git 执行层 + 规则编译层）
│   ├── ARCHITECTURE.md — 架构说明文档
│   ├── commit-push.js — 审计提交总入口（commitWithAudit + runAudit 同步审计）
│   ├── index.js — 插件入口（DSH 接线，再导出全部能力）
│   ├── user-requirements.json — 开发者特殊要求清单（提交推送前逐条核对）
│   ├── app/ — 插件入口层（apply/HTTP 处理/工具调用分发/注入文本/默认扫描根）
│   │   ├── apply.js — 插件装载入口（注册 schema/工具/HTTP/注入钩子）
│   │   ├── constants.js — 插件名与设置命名空间常量
│   │   ├── http-handlers.js — HTTP 路由分发（全部 /api/git-push/* 端点）
│   │   ├── index.js — 插件入口再导出（宿主 main 指向）
│   │   ├── inject-text.js — 注入文本（工具用法提示 FUNCTION_USAGE_HINT）
│   │   ├── scan-root.js — 默认扫描根解析（配置优先→DSH 家根自动识别）
│   │   ├── schema.js — 配置 schema（宿主导出缺失时兜底）
│   │   ├── slot-stats.js — 规则槽位命中统计（模块级状态）
│   │   ├── tool-call.js — 工具调用分发（git_scan/commit_push/audit/status 等全部工具）
│   │   ├── tools.js — 工具定义清单（名称/描述/参数 schema）
│   ├── ast/ — AST 实现层（token 级判定：括号/控制流/数据流/凭据/魔数/命名/规模/分词）
│   │   ├── brace.js — 括号配对与区间包含工具
│   │   ├── code-lines.js — 代码行判定（真代码 vs 注释/字符串）+ 字符串字面量提取
│   │   ├── control-flow.js — 控制流检查（同步 fs/空 catch/圈复杂度/嵌套深度）
│   │   ├── credential.js — 凭据标识符判定（硬编码/引用/类型检查）
│   │   ├── dataflow.js — 数据流检查（清空后访问，三层审计 L2）
│   │   ├── index.js — AST 层统一出口
│   │   ├── magic-number.js — 硬编码魔数识别（豁免版本号/日期/状态码）
│   │   ├── naming.js — 命名检查（标识符长度/函数名过短/受控小文件读取）
│   │   ├── shell.js — shell 精筛（cd 动态路径/写操作命中 .gitignore）
│   │   ├── size.js — 规模检查（函数长度/文件长度/重复字符串）
│   │   ├── tokenizer.js — 分词器（token 流 + LRU 缓存）
│   ├── audit/ — 审计编排层（文件收集/逐文件检查/槽位聚合/审计出口）
│   │   ├── audit-file.js — 单文件审计执行（跑检查+豁免）
│   │   ├── checks.js — 检查器入口（纯引用表）
│   │   ├── collector.js — 文件收集（gitignore 感知）
│   │   ├── file-context.js — 文件上下文豁免（外部调用超时/mkdir 同函数/版本路径）
│   │   ├── finding.js — 统一问题对象构造器（makeFinding）
│   │   ├── glob.js — glob→RegExp 转换（**/*/? 子集）
│   │   ├── index.js — 审计层统一出口（auditFull/auditChanged）
│   │   ├── orchestrate.js — 审计编排（收集→检查→汇总）
│   │   ├── repo-level.js — 仓库级语义规则
│   │   ├── slot.js — 按规则包聚合审计命中（拦截/警告/通过）
│   ├── audit-rules/ — 规则包 yml（nodejs/npm/frontend/comment/dsh/private/structure 等动态槽位）
│   │   ├── audit-rules-comment.yml — 注释类规则（黑名单措辞/对话残留）（规则包 comment）
│   │   ├── audit-rules-docs.yml — 文档类规则（README/文档措辞）（规则包 docs）
│   │   ├── audit-rules-dsh.yml — DSH 生态规则（宿主/插件约定）（规则包 dsh）
│   │   ├── audit-rules-filehealth.yml — 文件健康度规则（三维分级）（规则包 filehealth）
│   │   ├── audit-rules-folder.yml — 目录级规则（目录数/单目录文件数）（规则包 folder）
│   │   ├── audit-rules-frontend.yml — 前端规则（按钮绑定/魔数）（规则包 frontend）
│   │   ├── audit-rules-i18n.yml — i18n 规则（文案硬编码检查）（规则包 i18n）
│   │   ├── audit-rules-nodejs.yml — Node.js 规则（同步 fs/空 catch）（规则包 nodejs）
│   │   ├── audit-rules-npm.yml — npm 规则（package.json 规范）（规则包 npm）
│   │   ├── audit-rules-performance.yml — 性能规则（规则包 performance）
│   │   ├── audit-rules-private.yml — 私密文件规则（凭据/私密清单）（规则包 private）
│   │   ├── audit-rules-robustness.yml — 健壮性规则（规则包 robustness）
│   │   ├── audit-rules-structure.yml — 结构规则（命名/规模/复杂度）（规则包 structure）
│   │   ├── audit-rules-template.yml — 规则模板（新规则包起点）（规则包 template）
│   │   ├── audit-rules-version.yml — 版本规则（版本一致性）（规则包 version）
│   ├── backend/ — 后端服务（后台任务队列——方案 B：审计同步、推送后台化）
│   │   ├── task-queue.js — 后台任务队列（submitTask/getTask，方案 B）
│   ├── checks/ — 检查层（按 kind 调用检查器：正则/语义/结构/文件健康/按钮绑定/私密文件）
│   │   ├── button-bind.js — 按钮事件绑定交叉比对（声明了但没绑定）
│   │   ├── common.js — 检查器公共设施（豁免提示/severity 封顶/分组）
│   │   ├── credential-file.js — 凭据文件检查（.env/密钥文件）
│   │   ├── dataflow.js — 数据流规则包装（L2 token 级→finding）
│   │   ├── dispatch.js — 调度（runChecks 按 kind 分发汇总）
│   │   ├── file-health.js — 文件健康度（行数/字节/行长三维打分）
│   │   ├── filter.js — 规则作用域过滤（exts/exclude_paths）
│   │   ├── folder.js — 目录级检查（文件夹数/单目录文件数/解包特征）
│   │   ├── index.js — 检查层统一出口
│   │   ├── magic-number.js — 魔数检查包装（token 判定→finding）
│   │   ├── npm-json.js — package.json 检查（依赖版本/私有包豁免）
│   │   ├── private.js — 私密文件检查（私有仓可见性核对）
│   │   ├── regex.js — 正则类规则执行（regex/path-regex/blacklist）
│   │   ├── semantic.js — 语义类规则执行（patch insert/仓库级语义）
│   │   ├── structural.js — 结构类规则（函数长度/复杂度/嵌套/同步 fs）
│   ├── client/ — 客户端配置（DEFAULT_CONFIG + SETTINGS_SCHEMA 侧边栏设置项定义）
│   │   ├── index.js — 侧边栏设置 UI 总入口（DEFAULT_CONFIG + SETTINGS_SCHEMA）
│   ├── context/ — 上下文注入（给 AI 会话注入环境：目录映射/工具路径/skill 入口）
│   │   ├── index.js — 上下文注入入口（环境注入文本）
│   ├── exempt/ — 豁免机制（dsh-skip-* 注释标记解析与文件头/行内语义）
│   │   ├── index.js — 豁免注册表（dsh-skip-* 全标记消费）
│   ├── git/ — Git 执行层（runGit/账号/API/克隆/凭据/推送/扫描/索引维护/敏感扫描/传输通道）
│   │   ├── account.js — 账号校验（token 在线 + SSH 公钥指纹，输出账号状态块）
│   │   ├── api.js — GitHub REST 调用（githubFetch 统一 token/错误识别）
│   │   ├── browse.js — 目录浏览（账号卡片路径选择器后端）
│   │   ├── clone.js — 克隆（Git Data API，不依赖本地凭据）
│   │   ├── cloud.js — 云端仓库列表（/user/repos 供手动 clone）
│   │   ├── config.js — 路径与配置（PLUGIN_ROOT + 开发者要求清单读取）
│   │   ├── credentials.js — 凭据解析（token/SSH 私钥：环境变量→凭据文件→settings）
│   │   ├── exec.js — git 进程调用（runGit 统一超时/错误规整 + gitRaw 原始字节）
│   │   ├── ignore.js — .gitignore 兜底（DEFAULT_IGNORE_PATTERNS 补齐）
│   │   ├── index.js — Git 执行层统一出口
│   │   ├── post-push.js — 推送后增强（remote-tracking ref/aux remote/tag）
│   │   ├── push.js — 提交推送编排（commitAndPush 全流程：敏感扫描→add/commit→推送）
│   │   ├── remote.js — 远端仓库管理（建仓默认 private/可见性切换）
│   │   ├── repo-index.js — dsh-repo-index 自动维护（扫描 workspace 生成索引 JSON）
│   │   ├── repos.js — 仓库扫描与展示（describeRepo 分支/远端/领先落后/未提交）
│   │   ├── sensitive.js — 敏感信息扫描（提交前拦截密钥/凭据/私密文件）
│   │   ├── transport.js — 推送通道（dispatchPush 决策：SSH/API/auto + 结果核对）
│   ├── http/ — HTTP 总入口（鉴权中间件 + 端点处理器骨架）
│   │   ├── index.js — HTTP 总入口（Origin/CSRF/写确认/413/路由分发）
│   ├── link-check/ — 链接判断（文档链接有效性，只 warning 永不 blocker）
│   │   ├── index.js — 链接判断总入口（分级扣分，断网不拦）
│   ├── plugin/ — Host 侧接线层（插件注册到 DSH：工具/HTTP/配置 schema）
│   │   ├── index.js — Host 侧接线（插件注册：工具/HTTP/配置注入宿主）
│   ├── readme-gen/ — README 生成（git_gen_readme 工具模板渲染）
│   │   ├── index.js — README 生成总入口（git_gen_readme 模板渲染）
│   ├── readme-templates/ — README 模板 yml
│   │   ├── readme.yml — README 章节模板（git_gen_readme 用）
│   ├── rule/ — 规则引擎（yml 装载/编译注册表/同形字符检测/槽位启停）
│   │   ├── compilers.js — 规则编译器注册表（纯引用文件）
│   │   ├── homoglyph.js — 同形字符检测（yml kind/id 防 ASCII 混淆）
│   │   ├── loader.js — 规则总入口（yml 装载/解析/槽位启停）
│   │   ├── registry.js — 规则编译注册表核心（compileRule 主体）
│   │   └── …（12 个更深文件）
│   ├── score/ — 10 维度加权评分总入口
│   │   ├── index.js — 评分总入口（10 维度加权）
│   ├── self/ — 插件自身总入口（VERSION/versionInfo/CLI 帮助）
│   │   ├── index.js — 自身总入口（VERSION 一致性/versionInfo）
├── scripts/ — 开发工具脚本（版本校验/双副本同步/预览服务/README 目录树维护）
│   ├── audit-runtime-check.mjs — 三层审计 L3 运行时检测脚本
│   ├── check.mjs — 语法检查脚本（npm run check）
│   ├── preview-server.mjs — 本地真实后端测试服务（preview.html 接真实 handleHttp）
│   ├── rule-switch.mjs — 规则槽位手动启停 CLI
│   ├── scan-version.mjs — 版本一致性校验脚本
│   ├── scrub-user-wording.mjs — 清理「用户沟通措辞」独立脚本
│   ├── sync-plugin.mjs — 双副本同步脚本（源仓库 → 部署安装副本）
│   ├── tree-doc.mjs — README 目录结构维护脚本（gen/check/apply）
│   ├── watch-preview.mjs — preview.html 自动重生成监听（源码变更即重建）
├── assets/ — 预览页与配图（preview.html 交互模拟页 + 面板截图）
│   ├── panel-account.png — 账号卡片面板截图（README 配图）
│   ├── panel-audit.png — 审计面板截图（README 配图）
│   ├── panel-settings.png — 设置面板截图（README 配图）
│   ├── preview-gen.mjs — 生成 preview.html（真 client.js + 假数据垫片）
│   ├── preview.html — 侧边栏交互模拟页（可点，支持 ?backend= 接真实后端）
├── test/ — node:test 全量单元测试（541+ 条，覆盖审计/推送/账号/HTTP/后台任务）
│   ├── .test — 空文件豁免标记（目录级豁免 .test 目录）
│   ├── test-account-ssh.mjs — 账号检查 + SSH 密钥测试
│   ├── test-audit-scope.mjs — 审计作用域/凭据占位符回归测试
│   ├── test-audit.mjs — 审计总入口测试（auditFull/changed/豁免/gitignore）
│   ├── test-client.mjs — 侧边栏测试（手写 DOM/零外部资源/开关默认）
│   ├── test-context.mjs — 上下文注入测试
│   ├── test-dataflow.mjs — 三层审计 L2 数据流测试
│   ├── test-exempt.mjs — 豁免总入口测试（7 标记 + 位置语义）
│   ├── test-false-positive-fixes.mjs — 误报修复回归测试
│   ├── test-file-health.mjs — 文件健康度矩阵评分测试
│   ├── test-folder-scope.mjs — 目录级审计作用域回归测试
│   ├── test-git.mjs — git 总入口测试（runGit/commitAndPush/凭据/克隆）
│   ├── test-http.mjs — HTTP 总入口测试（Origin/CSRF/413/路由）
│   ├── test-inject-switch.mjs — 注入开发者要求清单子开关回归
│   ├── test-inject-system-prompt.mjs — 注入系统提示词回归
│   ├── test-link-check.mjs — 链接判断测试（分级扣分/断网不拦）
│   ├── test-magic-number.mjs — 硬编码魔数检测测试
│   ├── test-persist-credentials.mjs — 凭据持久化测试
│   ├── test-plugin.mjs — 插件接线测试（入口导出/工具清单/双副本同步）
│   ├── test-push-transport.mjs — 推送通道回归（SSH 优先/一致性语义）
│   ├── test-quality.mjs — 评分总入口测试（AST 质量检查器）
│   ├── test-readme-gen.mjs — README 生成测试（模板渲染/版本表）
│   ├── test-rule-packs.mjs — 规则总入口测试（编译注册/字段指派）
│   ├── test-rule-slots-render.mjs — 规则包列表统计渲染回归
│   ├── test-self.mjs — 自身总入口测试（VERSION/CLI/help 比对）
│   ├── test-sidebar-interaction.mjs — 侧边栏规则包列表交互自检
│   ├── test-smart-hint.mjs — 扫描智能提示 + 评分对数衰减测试
│   ├── test-status-secret.mjs — token 明文不下发安全回归
│   ├── test-task-queue.mjs — 后台任务队列测试（状态机/HTTP 端点/后台化形态）
│   ├── test-tree-doc.mjs — README 目录树脚本测试（gen/check/apply 闭环）
├── docs/ — 开发文档
│   ├── DETAILS-EXEMPT-AND-RULES.md — 细节补充：豁免注释与规则 yml 用法全录
├── skills/ — 插件权威 skill（功能手册/规则/使用说明，安装副本的 skills/ 同步）
│   ├── dsh-git-push-functions.md — 插件功能说明书（工具参数/HTTP API/源码定位）
│   ├── dsh-git-push.md — 插件手册（工具/规则包/设置 UI/安装实录）
│   ├── dsh-repo-index.md — dsh-repo-index skill（源码索引权威说明）
│   ├── git-push-live-fix.md — git-push 工具问题当场提出并改插件的规则
│   ├── task-completion-report.md — 任务收尾汇报规则（✅+交付/验证/遗留）
│   ├── git-workflow-gitpush/ — 
│   │   ├── README.md — git 工作流 skill 子目录说明
│   │   ├── commit-checkpoint-before-push-reorg.md — 推送重组前提交检查点规则
│   │   ├── file-organize-git-first.md — 文件整理前先 git 提交规则
│   │   ├── git-collab-conflict.md — git 协作冲突审查规则
│   │   ├── git-commit-before-batch-ops.md — 批量操作前先 git 提交规则
│   │   ├── git-commit-feature-progress.md — 功能进度三态提交规则
│   │   ├── git-project-read-history.md — 进项目先读提交历史规则
│   │   ├── git-rebuild-process.md — git 重建流程规则
│   │   ├── git-remote-align-first.md — 远端对齐优先规则
│   │   ├── github-api-only.md — 只走 GitHub API 规则
│   │   ├── github-fallback-restore.md — GitHub 回退恢复规则
│   │   ├── github-pin-repos.md — GitHub 固定仓库规则
│   │   ├── move-delete-git-checkpoint.md — 移动删除前 git 检查点规则
│   │   ├── readme-sync-git-md.md — README 同步 git 提交规则
│   │   ├── skill-every-change-commit-repo.md — 每次变更提交仓库规则
│   │   ├── versioning-rule.md — 版本规范规则
├── .gitignore — 忽略规则（node_modules/产物/备份/回收站等）
├── README.md — 插件 README（功能总览/用法/版本记录）
├── cli.mjs — 独立 CLI（git-sluice，不依赖宿主可独立运行）
├── client.js — 侧边栏设置 UI 源码（账号卡片/审计/规则包三选项卡，零依赖手写 DOM）
├── cordis.patch.yml — DSH 插件组合 patch（loader 注入定义）
├── package.json — 包声明（零依赖、files 白名单、scripts）
├── screenshots.json — 截图清单（README 配图引用）
├── tree-doc.json — 目录结构注释映射（路径→一句话介绍，AI 维护）
```
<!-- dshgp-tree:end -->

### 代码架构：lib/ 各文件夹各司其职

> 分层速查文档：`lib/ARCHITECTURE.md`（三层审计架构四层落地位置：规则声明 → AST 实现 → 检查包装 → 编排调度）

`lib/` 下**每个文件夹只负责一件事**，改审计逻辑前先分清所属层，避免在错误的层里打补丁
（尤其不要用「跳过某类行」的补丁去修误报）：

| 层 | 位置 | 职责 |
|---|---|---|
| ① 规则声明 | `lib/audit-rules/*.yml` | 阈值 / severity / 豁免清单 / 上下文关键字 / `astConfirm` 开关——**改阈值先改 yml，不改代码** |
| ② 具体实现（AST） | `lib/ast/*.js` | **token 级精准判断**：轻量 tokenizer（区分 ident / num / str / tmpl / comment）→ 括号平衡 → 判定 |
| ③ 调用包装 | `lib/checks/*.js` | **把判定转成 finding**：统一 `file/line/rule/severity/message/dimensions/exemptHint/scoreImpact`，不重复造检查逻辑 |
| ④ 编排调度 | `lib/audit/*.js` | 采集文件（`collector.js`）、glob 转换（`glob.js`）、单文件审计（`audit-file.js`）、豁免消费与汇总（`finding.js`/`slot.js`）、入口编排（`orchestrate.js`）；`index.js` 只做再导出 |
| — 插件入口 | `lib/app/*.js` | 宿主接线：配置 schema（含 schemastery 兜底）、工具声明、注入文本、工具与 HTTP 处理、`apply` 注册编排（`lib/index.js` 只做再导出） |
| — 规则编译器 | `lib/rule/compilers/*.js` | yml 字段类型 → 编译函数（注册制，按维度分模块；`compilers.js` 只做引用） |
| — git 能力 | `lib/git/*.js` | 命令执行 / 凭据 / GitHub API / 传输（SSH+API）/ 提交推送 / 克隆 / 仓库与可见性 / 账号校验 |
| — 规则装载 | `lib/rule/*.js` | 规则加载 / 编译 / 注册（yml → 编译后规则对象） |
| — 评分 | `lib/score/index.js` | 10 维度对数衰减评分 + 权重（**本目录只放评分，不含 AST**） |
| — 呈现 / 交互 | `lib/client/` | 侧边栏 UI、审计面板、规则包列表 |

**为什么拆这么细**：原先 `lib/score/ast.js`（1029 行）与 `lib/audit/checks.js`（1259 行）把「评分」「实现」「调用」「调度」全混在一起——
`lib/score/` 本应只管评分权重，却装着全部 AST 实现；`checks.js` 本应只做调用，却塞了 25 个检查实现。拆分后每个文件只做一件事，
新增检查时「实现写哪、调用写哪、调度写哪」一眼可见。

1.1.4 把这套「实现归位到各文件夹」的规则推广到另外五处同类问题：`lib/git/index.js`（1036 行）
拆成 12 个能力模块 + 35 行出口，`lib/rule/compilers.js`（459 行）拆成 10 个编译器模块 + 17 行出口，
`lib/audit/index.js`（482 行）拆成 6 个编排模块 + 32 行出口，`lib/index.js`（683 行）拆成 `lib/app/` 8 个模块 + 24 行出口。
**入口文件从此只做再导出、不含实现**——新增能力改对应模块即可，入口不再随功能增长而膨胀。

⛔ **替代手改的硬约束**：这类拆分靠人眼搬运极易静默丢代码（实测踩过：注册表类文件里大量匿名
`registerCompiler('kind', ...)` 语句被误并进上一个声明的正文；`Schema = makeFallbackSchema()` 这类
顶层语句被排到使用它的 `Config` 之后导致运行期崩溃）。拆分后有四项必查，缺一不可：

1. **导出面逐项比对**——拆前后 `Object.keys(module)` 集合与顺序必须一致；
2. **双态行为对比**——用同一探针先跑拆分后、再把原文件还原跑一次，`diff` 必须为空；
3. **裸副作用 import 保留**——如 `lib/audit/index.js` 的 `import '../rule/compilers.js'` 是编译器注册的
   唯一触发点，丢了不报错但检查项全不出，属于「静默失效」，比崩溃更难查；
4. **全量测试**——测试数不能变少（变少即说明有测试文件加载失败）。

#### ② `lib/ast/`：具体实现（token 级）

| 模块 | 职责 |
|---|---|
| `tokenizer.js` | 分词器 + 按文本内容的 LRU 缓存（全部 token 级检查的公共底座） |
| `brace.js` | 括号配对、区间包含判定（供复杂度/嵌套/函数行数复用） |
| `control-flow.js` | 同步 fs 调用、空 catch、圈复杂度、嵌套深度 |
| `size.js` | 函数长度、文件长度、重复字符串 |
| `naming.js` | 标识符长度、函数名过短（含 i18n 缩写豁免）、受控小文件读取 |
| `code-lines.js` | 判断某行是否「真在代码里」、取出代码中的字符串字面量 |
| `magic-number.js` | 硬编码魔数（豁免版本号/日期/HTTP 状态码/命名常量） |
| `credential.js` | 凭据值判定、前缀型密钥串的占位符精筛 |
| `dataflow.js` | **三层审计 L2**：同函数「清空后访问」数据流（clear()/=[]/=null/length=0/splice(0) 后 .get()/[0]） |
| `index.js` | 统一出口（只做再导出，不含实现） |

#### ③ `lib/checks/`：调用包装

| 模块 | 职责 |
|---|---|
| `common.js` | 公共设施（豁免提示、severity 封顶、各 astConfirm 精筛集合的取值函数） |
| `dispatch.js` | **调度 `runChecks`——只写引用**：按 kind 依次调用各检查器并汇总，不含任何检查逻辑 |
| `filter.js` | 规则作用域过滤（`exts` / `exclude_paths` / **`file_patterns`**）——yml 声明的作用域唯一落地点 |
| `regex.js` | 正则类规则（含 astConfirm 精筛消费） |
| `structural.js` | 结构类（函数长度/复杂度/嵌套/文件行数/同步 fs/空 catch） |
| `semantic.js` | 语义类（yml 声明的语义检查、patch insert） |
| `dataflow.js` | **三层审计 L2 包装**：`checkDataflow` → `lib/ast/dataflow.js`（空规则短路防崩） |
| `npm-json.js` · `folder.js` · `credential-file.js` · `private.js` · `button-bind.js` · `magic-number.js` · `file-health.js` | 各自对象的检查器 |
| `index.js` | 统一出口（只做再导出） |

`lib/audit/checks.js` 已退化为**纯引用文件**（`export * from '../checks/index.js'`，17 行），保留它只为让原有调用方
（`lib/audit/index.js` 与各测试）导入路径稳定。

**检查器标准样式 = 薄包装**（`checkEmptyCatch` → 调 `checkEmptyCatchAst`、`checkMagicNumberSmart` → 调 `checkMagicNumberSmartAst`）。

⛔ **反模式**：在检查器里自己写正则/逐行扫描重新实现一遍检查逻辑。逐行文本无法区分代码与注释/字符串，必然误报——
历史教训：magic-number 曾在调用层逐行扫，导致注释里的版本号（`// v1.8.0`）、CSS 字号、i18n 字典值全被误报为魔数。
**新检查一律写在 `lib/ast/`**（token 级实现），再在 `lib/checks/` 加薄包装，最后在 `dispatch.js` 加一行调度。

#### 两层判定：正则初筛 → AST 精准判断

文本型检查统一采用两段式（`astConfirm: true` 开启）：

```
正则初筛（快）         AST 精筛（准）
pattern 扫全文          makeCodeLineFilter(text, 候选行)
→ 得到候选行号列表   →   token 级确认「命中行确实是代码行」
                        注释 / 字符串 / 模板串行 → 丢弃（不是硬编码）
```

- **为什么两段式**：正则快但无法区分代码与注释/字符串（单用必然误报）；tokenizer 准但全量 token 化成本高于正则。两段式 = 正则筛候选行 → 只对候选行做 token 判定。
- **典型收益**：注释里的版本号/日期（`// v1.8.0`、`2026-09-13`）、字符串里的 CSS 字号（`'.x{font-weight:650}'`）、i18n 字典值不再报——无需任何「跳过注释行」的补丁。
- **不适用**：凭据/敏感/对话残留类规则**不**加 `astConfirm`（这些恰恰要查注释里的内容，例如注释里贴的 token、`// TODO 修复`）。

| 实现方式 | 位置 | 例子 |
|---|---|---|
| 正则初筛 + AST 精筛 | yml 的 `astConfirm: true` + `makeCodeLineFilter` | `readability/magic-number` |
| 纯 token 级（无需正则） | `lib/ast/`（各模块，见上表） | `checkMagicNumberSmartAst` / `checkSyncFs` / `checkEmptyCatchAst` / `checkComplexityAst` / `checkNestingDepthAst` / `checkNameLengthAst` / `checkFuncLinesAst` / `checkRepeatedStringsAst` / `checkClearAccessAst` |
| 纯正则（本质是文本特征） | `lib/checks/regex.js` 的 `checkRegexRules` | 凭据硬编码、路径穿越、对话残留、黑名单 |

#### 三层审计管线（2026-09-14：L1 正则初筛 → L2 AST 数据流 → L3 运行时）

按**检测模式的成本**分层，解决「正则命中面宽但 AST 精判成本高」的取舍：

| 层 | 工具 | 管什么 | 成本 | 产出 |
|---|---|---|---|---|
| **L1 正则初筛** | `filter.js` 的 `filterRulesByFileText` | 规则声明 `file_patterns`（正则数组）时，先对**文件文本**做一次纯正则扫描——命中任一 = 候选文件，才进 L2；未命中 = 该规则剔除（检查器空规则短路，顺带防 rule.severity 崩溃） | 极低（每文件一次正则） | 候选文件集合 |
| **L2 AST+YAML 数据流** | `lib/ast/dataflow.js` + `lib/checks/dataflow.js` | 只对候选文件做**同函数内**数据流判定：清空（`clear()`/`reset()`/`=[]`/`=null`/`length=0`/`splice(0)`）后访问（`.get()`/`.at()`/`[下标]`）——`dataflow/clear-then-access` 规则 | 中（只扫候选，非全量 tokenize） | 真实发现（文件:行 + 清空/访问证据） |
| **L3 运行时检测** | `scripts/audit-runtime-check.mjs`（独立 CLI） | 兜住**跨文件、闭包、异步时序**静态盲区：动态 import 被测模块，先调清空方法再调访问方法，实测是否拿到 undefined/空 | 高（要跑代码，按需触发） | 运行时确认（退出码 1 = 命中） |

**L2 判定保守（宁漏不误报）**：
- 清空与访问必须命中**同一函数体区间**（顶层作用域排除函数体，防「模块级清空 → 另一函数访问」跨函数误连）
- 清空后**写回撤销**：`push`/`set`/重新赋值/引用传参填充（`walkVideos(root, files, 0)`）→ 撤销清空标记，其后访问不算
- `var x = []` **声明初始化**不算清空；`.length` 读、`shift`/`pop` 消费式访问不报（`while (len) { shift() }` 保护模式）
- 真实跨分支/异步时序无法静态确定 → 交给 L3 运行时确认

**yml 声明示例**（`audit-rules-nodejs.yml` 的 `dataflow/clear-then-access`）：

```yaml
- id: dataflow/clear-then-access
  kind: "dataflow"
  severity: "warning"
  file_patterns:   # L1：命中任一才进 L2（纯正则，成本极低）
    - "\\b(?:clear|reset|flush|purge|splice)\\(0?\\s*\\)"
    - "\\b\\w+\\s*=\\s*(?:\\[\\]|null|undefined)"
    - "\\b\\w+\\.length\\s*=\\s*0"
    - "\\b(?:get|at|first|last|peek|head)\\(0?"
```

**L3 用法**：

```
node scripts/audit-runtime-check.mjs <被测 js 文件> [--obj 对象名] [--verbose]
node scripts/audit-runtime-check.mjs --all <目录>
```

退出码：0=全部通过（无运行时命中）；1=存在运行时命中（L3 确认的 bug）；2=无法检测。


### 10 维度质量评分

可读性 / 可维护性 / 健壮性 / 安全性 / 性能 / 测试覆盖 / 可观测性 / 可部署性 / 文档 / 开发者体验，默认合计 100，可在侧边栏调权重（`weightOverrides` JSON）。

- 单维度评分对数衰减防零分塌陷：`max(0.1, 10 - k*ln(1+errorCount))`，k 按维度分级（安全性 1.8 衰减最快）
- 总分 = Σ(维度得分×权重)/Σ权重×10；A/B/C/D/E 五档

### 审计强度三档

| 档位 | 检查范围 |
|---|---|
| `quick` | 正则 / 凭据 / 路径 / 黑名单 / 空 catch / 同步 IO（跳 AST 与语义重检查） |
| `standard` | 全量（默认） |
| `deep` | 当前与 standard 等效，为深度检查预留 |

### 豁免机制

审计豁免按作用粒度分**四大类**：文件/行注释标记（`dsh-skip-*`）、目录标记（`.test` 空文件）、路径类别（test/scripts 刻意用法）、私有库级别（私密文件降级）。安全红线不可豁免：`secret-*` / `cred*` / `security/*` 类规则即使标 disabled 也强制加载（`lib/exempt/index.js` 为豁免总注册表，`lib/audit-rules/audit-rules-private.yml` 为强制加载清单）。

#### ① `dsh-skip-*` 注释标记（文件头=整文件 / 行内=单点）

| 标记 | 位置 | 豁免内容 |
|---|---|---|
| `dsh-skip-sensitive` | 文件头=整文件 / 行尾=本行 | 凭据/私密类（`[FUNC]`/`credential-file`/`credential-ref`/`path-regex` 及 `security`、`secret`、`password`、`hardcoded` 等安全词规则） |
| `dsh-skip-size` | 只能文件头 | 大文件/二进制（`large-file`） |
| `dsh-skip-func-length` | 文件头=全文件 / **函数定义行行尾=单函数** | 函数超长（`func-lines`） |
| `dsh-skip-syntax` | 只能文件头 | 语法类（`syntax`/`json-parse`/`yaml-parse`） |
| `dsh-skip-quality` | 只能文件头 | 质量评分（`func-lines`/`empty-catch`/`sync-fs`） |
| `dsh-skip-residue` | 行尾=本行 / 文件头=整文件 | 残留类（`debugger`/`todo`/`console` 规则，按规则名前缀细分） |
| `dsh-skip-style` | 只能文件头 | 数值风格规则（`min-length`/`max-lines`/`max-complexity`/`max-depth`/`min-occurrences`/`repeated-string`） |
| `dsh-skip-i18n` | 行尾=本行 / 文件头=整文件 | i18n 硬编码文案审计 |

写法（文件头前 3 行内注释 → 整文件豁免；行尾注释 → 本行豁免，仅支持 `sensitive`/`residue`/`func-length`/`i18n`）：

```js
// dsh-skip-sensitive: 文件含 mock 凭据字面量（仅占位示例，非真实凭据）
const t = "AKIA—占位示例（示例刻意避开密钥检测正则的 16 位字母形态）";

// dsh-skip-func-length: 故意构造的超长函数样本
function longFn() { /* ... */ }

console.log(x); // dsh-skip-residue: 本行为刻意保留的调试输出样本
```

#### ② `.test` 空文件目录豁免（目录级，最强）

在目录内放一个 **0 字节 `.test` 文件**，该目录（含全部子目录）**整目录跳过扫描、不出任何结果**——比 `.samples`（照常出结果但不拦截）更强。专为测试 fixture 目录设计：`test/` 目录放 `.test` 空文件后，整个测试目录不再被审计（测试用例里故意构造的黑名单词样本/超长函数样本不会被误拦）。**全仓收集与变更审计（diff/changed scope）同样生效**——以前者为准，改动若涉及 `test/` 下文件（如新增测试用例），整个 test 目录自动不进变更审计，不会因样本词被误拦提交。

#### ③ 路径类别豁免（test / scripts 刻意用法）

- `test/` 目录下文件：`residue` / `console-log` / `sync-fs` / `empty-catch` / `performance` 类问题自动豁免
- `scripts/` 目录与 `cli.mjs`：`residue` / `console-log` / `sync-fs` 自动豁免

#### ④ 私有库豁免（private 槽位按远端可见性分级）

仓库跟踪到私密文件（清单见 `audit-rules-private.yml`：`**/id_ed25519`、`**/.ssh/**`、`**/.env`、`**/.npmrc` 等）时按**远端可见性**分级：

- **public** → `blocker` 拦截提交（私钥/凭据已可被任何人获取，必须移除或转私有）
- **private / unknown** → `warning` 仅提醒（私有边界内放行，转公开前须先移除）——即「私有库豁免」：私密文件与工作留痕（会话记录/凭据/留痕）在**私有仓库可正常提交推送**，不需要额外豁免标记；单文件想彻底不报再用 `dsh-skip-sensitive` 注释

**技能/规则文档豁免**：`skills/` 与 `rules/` 目录下的 md 文档里的沟通措辞（如触发场景描述）是设计文本而非代码残留，不触发用户沟通词规则。

### 代码禁用户沟通词（Block 拦截）

侧边栏 → 审计选项卡开关「代码禁用户沟通词」，默认开启：代码注释/文档出现「用户说/用户要求/用户原话」等沟通残留措辞（黑名单见 `audit-rules-comment.yml`）→ **blocker 拦截提交**；白名单业务词（用户ID/用户登录/用户角色等）命中则整行豁免。规则文档与测试目录按上述豁免机制自动放行。

### 链接检查

扫描 md/文本中的 URL 并访问验证（404/403→-3、DNS→-2、超时→-1 分级扣分），只 warning 永不 blocker（网络不可靠防假阳性拦截）。

### 正则初筛 → AST 精筛（`astConfirmKind`）

审计的每条规则（`lib/audit-rules/*.yml`）先跑**正则初筛**拿到候选行，再由 `lib/ast/` 里的 **AST 实现**做语义确认——正则快但看的是字符，AST 慢但看的是结构，两层配合才能既不漏报又不误报。

规则通过 `astConfirmKind` 声明「这条规则命中后还要精筛什么」，`lib/checks/regex.js` 按名字分派到对应 AST 实现（yml 是规则、`lib/ast/` 是实现、`lib/checks/` 是调用，各层各司其职）：

| `astConfirmKind` | AST 实现 | 精筛语义 | 豁免（不报）的例子 |
|---|---|---|---|
| `small-file-read` | `checkSmallFileReadAst` | 读文件是否属受控小文件（配置/缓存/字典） | 读 `package.json`、locale 字典、cache 文件 |
| `short-func-name` | `checkShortFunctionNameAst` | 函数名是否真过短且非公认缩写 | `tr`/`t`/`L`（i18n）、`el`/`cb`/`fn` |
| `credential-value` | `checkCredentialRefAst` | 凭据标识符右侧**是否直接是有效字面量** | 类型检查 `typeof cfg.token === 'string'`、透传 `cfg.token = init.token`、`process.env.KEY`、占位符 |
| `shell-cd-dynamic` | `shellCdDynamicLines` | cd 目标是否动态路径（含 `$VAR`/`$()`）且无失败兜底（同行无 `\|\|`、非 `&&` 链、非注释/字符串） | `cd "$(dirname "$0")"` 自我定位（目录必然存在）、`cd "$X" \|\| exit 1` 有兜底、`cd dist` 字面量路径 |
| `write-into-gitignored` | `writeIntoGitignoredLines` | 写操作（writeFile/mkdir 等）目标路径是否命中仓库 `.gitignore`（需 repoPath 上下文；单文件审计无上下文不报、不臆测） | `node_modules` 内写入（安装产物）、`/tmp` 临时目录、`.gitignore` 里 `!` 取反的路径 |

两种模式：`mode: 'deny'` 把 AST 判定出的行加入豁免集（集合内不报）；`mode: 'allow'` 要求只有 AST 判定出的行才报（集合外不报）。`credential-value` 用 allow 模式——只有当「凭据变量右侧直接跟着非占位字符串字面量」才算硬编码。

**为什么必须这么做**：正则 `token\s*[=:]+\s*['"]...` 会把 `typeof cfg.githubToken === 'string'`（类型检查）当成硬编码凭据报出来；`function\s+\w{1,2}\(` 会把 i18n 的 `tr()` 报成「函数名无法猜出含义」。这些都是真实误报——修的是审计代码（把判定从字符级提升到 token 级），而不是给业务代码加豁免注释。

## 大仓库性能降级

全量审计按文件逐个跑检查，单文件约 40ms；文件数上万时（实测某检出目录 29921 个文件）总耗时会到分钟级，弱 CPU 机器上表现为「提交推送卡住不动」。降级策略：

| 环节 | 做法 | 效果 |
|---|---|---|
| 分词结果缓存 | `lib/ast/tokenizer.js` 对 `tokenize()` 结果做 LRU 缓存（上限 512 份） | 同一文件被 5 处检查重复分词 → 只算 1 次；单文件 139ms → 42ms |
| 文件数上限 | 新增配置 `maxScanFiles`（默认 3000，`0` = 不限） | 29921 文件不再全量硬扫 |
| 变动文件优先 | 截断时先纳入 `git status` 里的变动文件，再按顺序补足到上限 | 正要提交的内容**不会被截断漏审** |
| 截断告知 | 超限时产出一条 `audit/scan-truncated` 说明（`severity: notice`、`scoreImpact: 0`） | 明确告知「只审了多少 / 总数多少」，且**不扣分** |

配置入口：侧边栏 → 审计 → `全量扫描文件上限`，或 `git-sluice audit <root> --full` 时由插件配置读取。

> 截断只影响 `scope: 'full'` 的全量扫描；默认的 `scope: 'diff'`（只审本次变动）不受影响——日常提交推送走的就是 diff。

## 界面模拟页（assets/preview.html）

`assets/preview.html` 是**单文件自包含**的侧边栏模拟页：双击用浏览器打开即可，无需 DSH、无需起服务、离线可用。

- **跑的是真实 `client.js`**（由 `assets/preview-gen.mjs` 内联注入），只垫片宿主环境（`window.__ModuleLoader__`、`react`、`settingsScope`、`fetch`），所以界面与真实插件一致，能发现真实渲染/交互缺陷
- **假数据**：账号信息（已登录 EIGHTfs）、6 个规则包、10 维度权重、凭据状态
- **全部可点**：三选项卡切换 · 审计开关 · **注入系统提示词开关** · 「注入开发者要求清单」子开关（含置灰联动）· 规则包启停与 ↑↓ 调序 · 权重编辑 · token/SSH 保存 · 邮箱一键生成 SSH 并回填
- 所有改动只留在页面内（内存假数据），**不写任何文件、不调真实接口**

重新生成（改了 `client.js` 后同步）：

```
node assets/preview-gen.mjs
```

## 三、系统提示词注入

插件在宿主装配系统提示词时注入四段（`ctx.inject(['systemPrompt'], …).section({ name, order, text })`；**`text` 必须同步返回**——async 会让模型读到 `[object Promise]`）。总开关在 **设置 → 侧边栏 → Git 提交推送 → 审计 → 注入系统提示词**，**默认开**。

| 段名 | order | 注入内容 | 生效条件 |
|---|---|---|---|
| `dsh-git-push-usage` | 990 | 插件功能用法：10 个工具各做什么、参数要点、调用纪律 | `injectSystemPrompt` |
| `dsh-git-push-env` | 980 | 当前 cwd · 项目 git 根 · **skills 总入口一行** · 工作区根 + 直接子目录 · 工具安装路径（实测探测） | `injectSystemPrompt` |
| `dsh-git-push-readme-check` | 991 | 提交前必须核对 README（功能表/版本记录/用法）的提醒 | `injectSystemPrompt` |
| `dsh-git-push-requirements` | 992 | 开发者特殊要求清单正文 | `injectSystemPrompt` + 审计开关 + `injectRequirements` |

### 内容只到「目录级」

环境段只给路径、不给正文：**skill 只注入总入口一行**（`<projectRoot>/skills（存在：true/false）`），不列 skill 文件清单、不注入 skill 正文——正文由 AI 按需读取，避免每步烧 token。工作区段给「根目录 + 直接子目录」（子目录跳过 `.git` / `node_modules` / `dist` / `build` / 隐藏目录），便于直接定位项目。

### 功能用法段（解决「AI 不知道插件有什么、绕开插件自己找凭据」）

把 10 个工具的一句话用法连同**凭据归属**一起常驻：

```
· git_scan —— 列工作区（含额外路径）所有 git 仓库：分支/remote/未提交与未推送数/最近活动
· git_commit_push —— 一键提交并推送（审计同步拦截，通过后 commit+push **后台化**：立即返回 async:true+taskId，AI 继续干别的，稍后 git_push_status 查结果）
· git_push_status —— 查询后台提交推送任务：taskId → status(pending/running/done/error) + 完成后 result/error
· code_audit —— 审计仓库（L0 静态检查 + 质量评分），scope=full 全量，可传 ruleset / weights
· git_account_check —— 校验 GitHub 账号与凭据（token 在线校验 + SSH 公钥指纹）
· git_gen_ssh_key / git_remote_create / git_set_visibility / git_clone / git_gen_readme / link_check
【凭据由插件托管，不要到处找凭据】GitHub token 与 SSH 私钥存放在插件配置目录
（git-push/ 下 github-token、id_rsa；0600 权限），由插件的推送/校验流程自动读取与选择通道
（默认 SSH，token 401 回退 SSH）。判断登录态 → 调 git_account_check；推送 → 调 git_commit_push。
【调用纪律】提交类操作先 git_scan 确认目标仓库；提交前核对 README；审计 blocker 先修复再提交。
```

### 环境段的工具路径是实测探测的

`collectToolPaths()` 用 `which`（Windows 走 `where`）逐项探测 git / node / npm / python3 / curl / ssh / unzip / rsync / 7z 的**实际安装路径**，只把探测到的工具写进注入文本；结果**惰性缓存**（首次注入算一次，避免每次装配系统提示词都 spawn 一轮）。探测异常时降级为静态兜底清单，注入不中断。

### 关闭开关的行为

关掉「注入系统提示词」→ 四段**全部返回空串**（段仍注册、内容为空）：AI 不再看到功能用法与环境目录，插件工具本身照常可用。切换开关会清掉环境注入缓存，下一轮装配即按新状态生效，**无需重启实例**。

### 已废弃的两个开关

`injectFullSkill`（注入全部 skill 正文）与 `injectRepoIndexFull`（注入 `dsh-repo-index.json` 全文）**已移除**：注入固定为目录级，不提供全量正文注入档位——长文正文交给 skill 按需加载。

## 侧边栏设置

设置 → 侧边栏 → **Git 提交推送**，三选项卡（对齐插件市场样式）：

- **账号信息**：渐变卡片 + GitHub 图标 + 状态徽标（已连接/检测中/未连接）+ 检测结果块 + Token/SSH 凭据状态标签 + `⟳ 重新检测`
  - 卡片下方为**仓库管理卡片**（本地 / 云端 两子选项卡，2026-09-14）：
    - **本地**：默认扫描根 = **DSH 家根**（由 DSH_HOME / workspaceRoot **动态推导**，非写死）——覆盖 工作区 / 用户 / profiles / workspace 下全部 **git 仓库（遍历所有 `.git` 文件夹，含嵌套子仓库、depth 20）**；可手动指定路径（文本框 + 📂 目录选择器弹窗浏览），**浏览器路径与扫描路径都记住**（localStorage，刷新后恢复）。列表显示 路径 / 分支 · 远端子状态 / 未提交数 / 最近提交 + **索引登记**；**只显示登录同作者的仓库**（有远端则 owner=登录账号；无远端按索引归属判定；无登录态时不过滤）。仓库「有远端 + 工作树干净」即可点 `push`，**点击后行内绿/红反馈**（✅ 推送成功 / ⚠️ 失败原因）；领先/未设上游由后端精确判定（未设 `@{u}` 但有远端仍可推，比较 `origin/<分支>` 或 ls-remote；远端无同名分支=首次推送创建）。仓库路径长时自动省略号截断
    - **云端**：`加载仓库列表` 用 token 拉账号名下所有 GitHub 仓库（GET /user/repos，按最近更新），显示 名称 / 私有·公开 / 默认分支 / 最近更新；点行尾 `clone` 弹出目录选择器选目标目录后克隆（走 Git Data API，不直连 github.com）
- **审计**：审计开关 + 注入系统提示词开关 + 代码禁用户沟通词开关 + 10 维度权重编辑 + 规则包列表
  - **`注入系统提示词`**（默认开）：控制整组注入段启停——功能用法（每个工具怎么用 + 凭据由插件托管）· 环境（工作区目录映射 + 工具安装路径 + skill 总入口一行）· 提交前 README 核对提醒；关闭后这些段全部返回空串，工具本身照常可用。详见 [三、系统提示词注入](#三系统提示词注入)
  - 子开关 **`↳ 注入开发者要求清单到系统提示词`**：挂在「提交前自动审计」下面，**随时可勾选（一遍即可）**；审计关闭时该行只置灰表示「暂不生效」、勾选保留，实际是否注入由 host 侧 `injectSystemPrompt && auditEnabled && injectRequirements` 三重门控（省掉每次提交推送时 AI 被门禁拦下再回读清单的一轮往返）
  - 规则包行：↑↓ 调次序 · **按住行内信息区悬停显示详情浮层**（描述/作者/拦截·警告·通过 命中口径）· 启停**只点行尾按钮**
  - 状态底色一眼可辨：**启用 = 绿底 + 绿左条**，**禁用 = 红底 + 红左条**（按钮同为绿/红实色胶囊）
  - 拦截/警告/通过 三列显示**最近一次审计的实际命中数**（未审计时回落为规则条数口径）
- **设置**：GitHub token + SSH 公钥 + 邮箱 + 一键生成并复制

设置项以 `lib/app/schema.js` 的 `Config` 为单一事实源（`lib/index.js` 只再导出），`settingsScope` 读写。凭据保存**同时写插件配置目录**（见「凭据管理」）。

## 仓库索引联动（dsh-repo-index.json）

账号卡片与「自动生成的仓库索引」双向联动（2026-09-14，移植 v1 的 `lib/repo-index.js` 全量生成实现进 v2 `lib/git/repo-index.js`）：

- **读取（标注）**：本地扫描为每个仓库附 `indexed`（索引登记的 owner/repo/可见性）——即使本地未设 remote/上游，也能一眼看出它在 GitHub 的归属；未登记显示无
- **更新（自动生成）**：`git_commit_push` 手动推送 与 账号卡片的 `repo-push` **推送成功后全量重建**索引——可见性走 GitHub API（并发 4，token 缺失回退既有标注/未知）、skills 从 package.json `dsh.skills` / `skills/*.md` frontmatter 收集、`localOnly` 维护 workspace 顶层无远端目录；索引写入 `工作区/dsh-git-push-User/<owner>/dsh-repo-index.json`（权威源，dsh-repo-index skill 一致），版本+1、generatedAt 刷新、DO NOT EDIT
- 索引缺失/损坏全链路静默降级，不阻塞扫描与推送

## 独立脚本：规则启用/禁用（scripts/rule-switch.mjs）

侧边栏 UI 的规则包启停（写规则 yml 顶层 `disabled: true` / 删除该行）以命令行方式复用同一套实现（`lib/rule/loader.js setSlotDisabled`），**不依赖 GUI**。规则装载每次审计实时读 yml——改完**立即生效、无需重启实例**。

**目标目录**：默认操作**安装版本**（部署副本 `<DSH>/.dsh-home/.dsh/profiles/web/node_modules/dsh-git-push/lib/audit-rules`，即 GUI 实际加载的规则）；`--workspace` 指工作区 `lib/audit-rules`；`--target <目录>` 任意指定。

用法：

```bash
node scripts/rule-switch.mjs list                      # 列出全部槽位状态（✔ 启用 / ✖ 禁用）
node scripts/rule-switch.mjs status <槽位>             # 单槽位状态
node scripts/rule-switch.mjs disable <槽位>            # 禁用（yml 顶层写入 disabled: true）
node scripts/rule-switch.mjs enable <槽位>             # 启用（删除 disabled 行）
```

示例：

```bash
node scripts/rule-switch.mjs disable comment    # 禁用安装版本的 comment 槽位（用户沟通词审计）
node scripts/rule-switch.mjs enable comment     # 重新启用
```

边界：`nodejs` / `private` 属安全红线强制槽位，禁用会被拦截（返回错误、不写 yml），与 UI 行为一致。注意与 `scripts/sync-plugin.mjs --write` 的协作：同步会按工作区规则文件覆盖部署副本的 disabled 状态（工作区文件里没有 disabled 行则同步后恢复启用）。

## 独立 CLI（git-sluice）

脱离 DSH 独立运行（零第三方依赖，仅需 Node ≥18 与本机 git）。

```
git-sluice version              查看版本
git-sluice ruleset [槽位...]    编译规则包并输出统计
git-sluice scan <root> [--depth N]   全量扫描目录（非 git 目录可查）
git-sluice audit <root> [--full] [--level quick|standard|deep] [--ruleset <目录>] [--weights <JSON>]
git-sluice commit <repo> -m <msg> [--push|--no-push] [--dry-run] [--force] [--req-confirm] [--json]
git-sluice link-check <路径>    检查 md/文本中的链接有效性（只 warning）
git-sluice yaml-template        输出规则 yml 模板
git-sluice readme-template      输出 README 模板
git-sluice self-check           版本一致性 + HELP↔parseArgv 机器比对
```

`audit` 参数与服务端设置对应：`--full` ↔ `auditScanScope=full`、`--level` ↔ `auditLevel`、`--ruleset` ↔ `auditRuleset`、`--weights` ↔ `weightOverrides`。

## 独立脚本：清洗用户沟通措辞（scrub-user-wording.mjs）

v1.27~v1.44 曾内置 `autoCleanCommentWording`（提交前自动改写代码注释里的沟通残留措辞为中性描述），
v1.45.0 因「commentStartOf 字符串不感知」**三次静默篡改事故**（把测试夹具字符串里的 `# 用户说…` 当注释改掉）废除，
确立「只警告、不删改」总原则。本脚本按**同一张改写规则表**（`WORDING_REWRITES`，含日期保留规则）独立复活：
**插件不注册任何入口**（不进 lib/、不注册工具/API/设置项），仅作为可执行脚本，供 AI / 用户手动调用；
脚本随插件发布，在安装副本目录里同样可跑（见「安装与要求」）。

```
node scripts/scrub-user-wording.mjs <路径...>                  # dry-run 报告（默认）
node scripts/scrub-user-wording.mjs <路径...> --apply           # 逐条预览确认后写盘（每文件 .bak）
node scripts/scrub-user-wording.mjs <路径...> --apply --yes     # 非交互强制全改（AI/CI 用）
node scripts/scrub-user-wording.mjs --repo <git仓库路径> [--apply [--yes]]   # 只处理未提交 diff 涉及文件
```

退出码：0=无命中或已处理；2=dry-run 有命中；3=非交互环境未带 `--yes` 拒绝写盘。

相比旧实现的关键修复（三次事故根因）：

- **词法感知**：逐字符扫描区分「字符串字面量 / 注释 / 代码」，只改写注释段——字符串里的 `'# 用户说…'`、`"// 用户要求"` 不会被误伤
- **md 文档跳过 ``` 围栏代码块**：测试夹具/示例代码里的措辞是数据，不是沟通残留；且 md 措辞可能是来源署名/名词用法（如「是否符合用户要求」），交互确认时会标注风险提示
- **先预览再删改**：`--apply` 逐条 `y/n/a/q` 确认后才写盘（a=改余下跨文件、q=退出），每文件先写 `.bak` 备份
- **豁免与审计同规则**：文件头前 3 行含 `dsh-skip-sensitive`/`dsh-skip-residue` 整文件跳过；行尾含 `dsh-skip-sensitive` 本行跳过

AI 调用建议：先跑 dry-run 看报告 → 人工/审计核对命中是否真是沟通残留（private 仓库的工作留痕措辞通常**不需要**清洗）→ 需要清洗时 `--apply --yes`。

## 独立脚本：运行时检测（三层审计 L3）

三层审计管线的**第三层**——兜住静态盲区（跨文件引用、闭包捕获、异步时序），用运行时实测确认 L2 报告的「清空后访问」是否真的拿到 undefined/空。独立脚本，插件不注册入口
（脚本随插件发布，在安装副本目录里同样可跑，见「安装与要求」）：

```
node scripts/audit-runtime-check.mjs <被测 js 文件> [--obj 对象名] [--verbose]
node scripts/audit-runtime-check.mjs --all <目录>
```

原理：动态 import 被测模块 → 找到导出的容器对象（对象/数组/Map/Set）→ 依次调用其清空方法（clear/reset/flush/purge）再调用访问方法（get/first/peek/at/shift/pop）→ 返回值是 undefined/null/空数组即命中。

退出码：0=全部通过（无运行时命中）；1=存在运行时命中（L3 确认的 bug）；2=无法检测（文件不可 import / 无导出对象 / 用法错误）。

局限（如实标注）：只能测模块**导出**的入口（内部闭包需测试钩子）；依赖被测文件能安全 import（副作用不能炸进程）；异步时序建议用 `node:test` 写专门用例。

## 安装与要求

- **环境**：DSH（DeepSeek Harness）｜Node ≥18 ｜本机 git
- **安装**：`dsh plugin add EIGHTfs/dsh-git-push`（仓库已声明 `dsh.bundle`，可安装）
- **随插件发布的脚本**：`scripts/` 在发布白名单内（`package.json` 的 `files` 与 `scripts/sync-plugin.mjs` 的 `SYNC_ENTRIES` 两处一致，由 `test-self.mjs` 的「SYNC_ENTRIES 覆盖 files 白名单」测试守住），装好插件后 5 个脚本在**安装副本目录内**同样可直接运行（零外部依赖，只用 node 内置模块）：
  - `scripts/scan-version.mjs`：版本一致性自检（lib/self 的 VERSION ↔ `package.json` `version` ↔ README 版本列表 ↔ cli HELP 模板），不一致 exit 1
  - `scripts/audit-runtime-check.mjs`：三层审计的 L3 运行时检测（见「独立脚本：运行时检测」）
  - `scripts/scrub-user-wording.mjs`：清洗注释里的沟通残留措辞（见「独立脚本：清洗用户沟通措辞」）
  - `scripts/check.mjs`：全仓语法检查（`node --check` 批量）
  - `scripts/sync-plugin.mjs`：源码仓库 → 安装副本的双副本同步（默认 dry-run，`--write` 才写）
- **测试**：`npm test` 一条命令复现全绿（524 断言，0 失败）

## 版本列表

| 版本 | 说明 |
|---|---|
| **1.2.0**（当前） | **账号信息新增仓库管理卡片（本地/云端）+ folder 槽位两条新规则 + 仓库索引联动 + 遍历全部 `.git` + 「未跟踪上游」放宽 + 远端状态 bug 修复 + 推送分叉检查 + 审计配置传递修复 + tree-doc 目录树维护脚本** \
本地/云端卡片：本地=扫描工作区 git 仓库（可手动指定路径 + 目录选择器浏览弹窗，领先且干净可手动 push，未设上游也可推）；云端=token 拉账号名下仓库可手动 clone（Git Data API）；5 新端点（browse/repos-local/repos-cloud/repo-push/repo-clone） \
folder 槽位 +2（1.0.1）：`cd 到可能不存在的目录`（shell-cd-dynamic）、`写入 .gitignore 忽略目录`（write-into-gitignored），yml→AST→checks 三段落地 `lib/ast/shell.js` \
**仓库索引联动**：移植 v1 的 dsh-repo-index.json 自动维护（`lib/git/repo-index.js`）——推送成功后全量重建（可见性走 GitHub API、skills 从 package.json/skills 收集、localOnly 维护）；本地扫描为每个仓库附 「索引登记」标注（无 remote 也能显示 GitHub 归属） \
`.test` 空文件目录豁免扩展到变更审计；本地扫描遍历**所有 `.git` 文件夹**（含嵌套子仓库，depth 提到 20） \
新增 `scripts/rule-switch.mjs`（复用 UI 规则启停：改 yml 顶层 disabled，命令行开关安装版本槽位，立即生效无需重启） \
**远端状态 bug 修复**：`runGit()` 返回 `{ok, stdout, stderr}` 无 `status` 字段，describeRepo/push.js 用 `rc.status === 0` 判断 → 永远 `undefined === 0` = false → ahead 永远 null → 全部显示「远端状态未知」；改为 `rc.ok`（5 处），14 个仓库里 13 个正确显示同步/领先/落后 \
**推送分叉检查**：`pushCurrentBranch` 新增 `behind > 0` 检查——本地与远端分叉时直接拒绝并返回清晰错误（`本地与远端分叉（本地领先 X，远端领先 Y）——先 pull 合并远端提交再推送`），不再让 git 报含糊的 non-fast-forward \
**审计配置传递修复**：`runAudit()` 新增 `cfg` 参数——宿主传入的插件配置（含 `auditEnabled`）能正确传递到审计门禁，不再被 `defaultConfig()` 硬编码 `false` 覆盖 \
**tree-doc 目录树维护脚本**：`scripts/tree-doc.mjs`（gen/check/apply 三子命令）+ `tree-doc.json`（206 条路径→一句话注释映射）——自动生成两层折叠目录树（含注释）、检查 README 树与真实文件漂移、覆盖 README 标记块 \
**preview-server 静态 serve**：`scripts/preview-server.mjs` 改造——GET `/` 自动 serve preview.html 并注入 `__DSHGP_BACKEND__` 指向本服务（免手动拼 `?backend=`），preview-gen 支持 fallback 读注入变量 \
修复：dispatch 批量替换语法、preview-gen 模板正则转义、AccountTab 动作注入缺失（props 链）；README 豁免机制文档化四类 | 548 全绿 |
| **1.1.11** | **修：开发期备份被同步进安装副本**（承接 1.1.10 把 `scripts/` 纳入同步清单）：`scripts/sync-plugin.mjs` 的 `SYNC_EXCLUDE` 原先只排 `.git` / `node_modules` / `WORKBOARD` / `test` / `.tmp`，**未排 `.bak`** ——开发期备份 `scripts/sync-plugin.mjs.bak` 被当成发布文件复制进安装副本的 `scripts/` 目录（安装副本混入非发布内容，且该备份含旧版白名单，易误读为「同步没生效」）；现补排 `.bak`（子串匹配，含 `.bak-<后缀>`）与 `.trash`（回收站），新增 1 条回归测试并扩充 1 条（`listSyncFiles` 实测返回集不含 `.bak`/`.trash`；`SYNC_EXCLUDE` 常量声明加 `.bak`/`.trash` 断言），并清理已进入安装副本的残留备份 | 524 全绿 |
| **1.1.10** | **scripts/ 随插件发布（同步白名单补齐）**：`scripts/` 同时加入 `package.json` 的 `files` 与 `scripts/sync-plugin.mjs` 的 `SYNC_ENTRIES`（两处必须一致，由 `test-self.mjs` 的「SYNC_ENTRIES 覆盖 files 白名单」测试守住）。此前 scripts 只在源码仓库、不进安装副本，导致 README 专门章节承诺的独立脚本入口（`node scripts/scrub-user-wording.mjs`、`node scripts/audit-runtime-check.mjs`、`npm run scan-version`）在**装好的插件里并不存在**（发布有、安装副本无）。补齐后安装副本内 5 个脚本（scan-version / audit-runtime-check / scrub-user-wording / check / sync-plugin）均可用，仍为零外部依赖（只用 node 内置模块）；README「安装与要求」补该说明与逐脚本用途，并更正过时的测试断言数（490 → 523）｜523 全绿 |
| **1.1.9** | **系统提示词注入改造 + README 版本校验**：①侧边栏「审计」选项卡新增 **「注入系统提示词」总开关**（默认开），控制整组注入段启停（关闭 = 全部返回空串，段仍注册）；②注入内容收敛为目录级并新增 **功能用法段**（order 990：10 个工具各怎么用 + 「凭据由插件托管，不要到处找凭据」+ 调用纪律），解决 AI 绕开插件自行检索 token 的问题；③环境段（order 980）由静态 5 项清单改为 **`which` 实测探测**（只列探测到的工具、惰性缓存、异常降级静态清单），并新增 **工作区根 + 直接子目录** 映射，skill 只注总入口一行；④**移除** `injectFullSkill` / `injectRepoIndexFull` 两个全量注入开关（不再提供全文注入档位）；⑤`scripts/scan-version.mjs` 新增 **第 4 项校验：README 版本号 vs `package.json` version**（优先认「（当前）」标记行、无标记则取版本列表章节最高版本，不一致 exit 1，`--json` 输出 `readmeVersion`/`readmeSource`）；⑥`assets/preview-gen.mjs` 路径改为按脚本位置推导（不再写死本机路径，支持 `DSH_ROOT` 等覆盖）并同步新开关，重新生成 `assets/preview.html` 与 `assets/panel-audit.png`；⑦新增 19 条回归测试（开关渲染/门控与缓存/内容覆盖/废弃开关清除/README 版本提取），并修正「子开关必须先开审计才能开」的过时描述（1.1.5 起已改为随时可勾选）｜523 全绿 |
| **1.1.8** | **三层审计管线**（用户 2026-09-14 设计）：L1 正则初筛（`filterRulesByFileText` 消费 yml `file_patterns`，命中候选文件才进 L2，未命中剔除规则——检查器空规则短路，成本极低）→ L2 AST 数据流（新 kind `dataflow`：`lib/ast/dataflow.js` 同函数「清空后访问」判定 + `lib/checks/dataflow.js` 包装，规则 `dataflow/clear-then-access` 入 `audit-rules-nodejs.yml`）→ L3 运行时检测（独立脚本 `scripts/audit-runtime-check.mjs`：动态 import 被测模块，实测清空后访问是否拿 undefined，退出码 1=命中）。L2 判定保守（宁漏不误报）：同函数区间互斥（顶层排除函数体，修跨函数误连）、清空后写回撤销（push/set/引用传参填充）、声明初始化（`var x = []`）不算清空、`.length` 读与 shift/pop 消费式访问不报｜**修 gitignore 感知静默失效**（collector.js `sep is not defined`——`tryLoadGitIgnoreSet` 每仓库必抛异常走 catch 返回 null，git 忽略文件从未被排除：iwara 审计从 2795 个文件（含 Node vendor v8 头文件）降到 53 个真实源码文件）｜**修检查器空规则崩溃**（structural.js 的 checkComplexity/checkDepth/checkMaxLines 在规则被 exts/file_patterns 过滤为空时 `rule.severity` 崩溃——iwara 触发，统一加空规则短路）｜504 全绿 |
| **1.1.7** | **推送失败语义修正（承接 1.1.6 的 SSH 默认通道）**：SSH 因远端分叉被拒（`non-fast-forward`）时**不再回落 API**——API 通道会在远端重建提交、本地与远端再分一条叉，每推一次多分一次，且成因被「推送成功」掩盖；改为返回 `diverged: true` 与本地/远端 sha，如实说明「请确认后 force 强推或先整合远端」。**remote-tracking 引用不再说谎**：API 通道在远端新建的提交本地无对象，旧实现用「本地 HEAD sha 代理」写入`refs/remotes/origin/<branch>`，一旦两侧已分叉就让 `git status` / ahead-behind 谎报 `0/0`、把分叉仓库显示成同步；改为先以 `+refs/heads/<b>:refs/remotes/origin/<b>` 取回远端真实对象再写真实 sha，取回失败才退回代理并显式标注「代理 sha」与远端实际值。**SSH 报错不再被噪音淹没**：`sshReason` 剥掉 known_hosts 告警与 git 的「提示：」建议段，原先只截前 120 字符、常被告警占满，真正原因（如 non-fast-forward）反被截掉。新增 6 条回归测试（分叉识别中英文、分叉不回落、噪音过滤、引用真实性 2 条）｜**规则包列表统计不再被清空**：客户端在 settings scope 订阅回调里用 `snap.value.ruleSlotMeta` 覆盖 `slotMeta`，而该字段在 schema 里声明为「host 启动填充、只读」却**从无写入方**，于是每次 scope 发布（保存设置、切换开关等）都把它（空对象）赋给 `slotMeta`，刚由 `loadSlots()` 拉到的真实统计与显示名被整体清空——规则包名退化成原始槽位名（`nodejs`/`comment`/`npm`…），三个统计数字全部回退成 0。改为与 `ruleOrder` 同规则：`loadSlots()` 为唯一权威源，并删除该无人读写的死字段；预览工装原先把该字段放进快照，正是这一点掩盖了缺陷，已同步改为只作为接口假数据。新增 4 条回归测试（复现须在数据到位后再发布一次 scope；仅在挂载时渲染看不到该缺陷）｜**预览工装不再与真实脱节**：槽位/显示名/规则条数改为直接调用 `listRuleSlots()` 读真实规则文件（原先手写清单只造了 6 个，预览里就只显示 6 个槽位，与真实实例的 14 个不一致，易被误认为回归），并加 1 条测试比对生成物与真实槽位集合，锁死两者一致；预览横幅同时标明哪些是真实数据｜**新增独立脚本 `scripts/scrub-user-wording.mjs`（非插件入口）**：v1.27~1.44 内置的 autoCleanCommentWording（提交前自动改写注释沟通措辞）因字符串不感知三次静默篡改事故于 v1.45.0 废除；按同一张改写规则表独立复活——默认 dry-run 只报告、`--apply` 逐条预览确认后才写盘（每文件 .bak）、`--apply --yes` 供 AI/非交互强制全改；词法感知只清注释段（字符串字面量里的措辞不碰，修复事故根因），md 跳过围栏代码块且交互标注名词用法风险，豁免与审计同规则｜490 全绿 |
| **1.1.6** | **推送默认走 SSH（远端 sha 与本地一致）**：原先 `commitAndPush` 无条件先走 Git Data API，该通道经 blob → tree → commit **在远端重建提交**（父提交/作者/时间戳都是新造的），推完远端 sha 必然与本地不同、本地与远端从此分叉；SSH 通道 `git push HEAD:refs/heads/<branch>` 上传的是本地提交对象本身，sha 天然一致。新增 `dispatchPush` 单一决策点与 `pushMethod` 配置项（`ssh` 默认 / `api` / `auto`，侧边栏可选），SSH 无可用私钥或推送失败时回落 API 并把回落原因记进 `fallbackReason`；私钥探测扩展为 `resolveSshKeys` 返回全部候选（`id_rsa`/`id_ed25519`/`id_ecdsa`）并逐个尝试，避免配置目录里同时存在「已登记」与「未登记」两把密钥时选错导致 `Permission denied (publickey)`；SSH 通道成功后同样执行推送后增强（remote-tracking ref / aux remote / autoTag），修掉原先只有 API 分支做增强、走 SSH 时本地 `origin/<branch>` 引用不更新导致 ahead/behind 错位的问题。实测：SSH 推送后远端 sha 与本地 sha 逐字节相同（本地 `f5c1ddc2486735e24948051a797b1568c02125d4` == 远端同名 sha）。新增 10 条回归测试（含 host 自探测、三档语义、多密钥尝试、防退回 API 优先，以及「remote URL / .git/config 不得内嵌明文凭据」2 条安全断言）｜479 全绿；同时清理 6 个仓库 origin URL 里内嵌的明文 token（该 token 实测已失效 HTTP 401，推送凭据统一由凭据目录自探测提供） |
| **1.1.5** | **GitHub token 不再明文下发浏览器**：`/api/git-push/status` 原样回吐整个 `cfg`（含 `githubToken` 明文，局域网内一条 `curl` 即可取到）→ 改为回吐脱敏副本（`redactConfig`：删除密钥位、另给 `tokenConfigured`/`sshConfigured` 布尔位供界面渲染「已填写」）；同时 schema 的 `githubToken` 标注 `role('secret')`，浏览器读设置那条路径由 DSH 远端读的 `redactSecrets` 统一脱敏（host 侧 `scope.get/watch` 仍是明文，token 功能不受影响；`role()` 同时补进 fallback schema，缺 schemastery 的环境不会因链式调用崩）；顺带删掉声明了却从未派生/读取的死字段 `tokenConfigured`。**审计页子开关交互修正**：「注入开发者要求清单到系统提示词」原在父开关「提交前自动审计」关闭时带 `disabled` + `toggle` 直接 `return`（点了没反应，须先点父开关再点它＝两遍），且关父开关会把子开关勾选静默清掉 → 改为随时可勾选（一遍）、父关时只整行置灰表示暂不生效、勾选保留，实际是否注入仍由 host 侧 `cfg.auditEnabled && cfg.injectRequirements` 门控（父关时勾了也不注入）。新增 11 条回归测试（token 脱敏 4 条 + 子开关交互 6 条，含真实渲染读 input props 验证 `disabled`/`checked`；另加「`SYNC_ENTRIES` 必须覆盖 package.json files 白名单」1 条）｜470 全绿，并修复 `scripts/sync-plugin.mjs` 的 `SYNC_ENTRIES` 漏列仓库根 `client.js`（files 白名单有它、同步清单没有 → 同步到已安装副本时会漏掉前端主文件，前端改动装不进去） |
| **1.1.4** | **实现按职责拆分到各文件夹（六处）**：`lib/score/ast.js`（1029 行，AST 实现错放在评分目录）→ `lib/ast/*`（8 模块 + 出口）；`lib/audit/checks.js`（1259 行，25 个检查实现混在调用层）→ `lib/checks/*`（13 模块，含纯调度 `dispatch.js`）；`lib/git/index.js`（1036 行）→ `lib/git/*`（12 模块，最大 173 行）；`lib/rule/compilers.js`（459 行）→ `lib/rule/compilers/*`（10 模块）；`lib/audit/index.js`（482 行）→ `lib/audit/*`（6 模块：finding/slot/repo-level/file-context/audit-file/orchestrate）；`lib/index.js`（683 行，宿主 main 入口）→ `lib/app/*`（8 模块：schema/constants/slot-stats/tools/inject-text/tool-call/http-handlers/apply）——**六处入口文件全部退化为纯再导出（17-35 行），不含实现**，导出名与顺序逐项比对一致，调用方零改动；每处均做双态行为对比（还原原文件重跑同一探针、`diff` 为空）+ 全量测试 + 未受影响文件审计结果逐条一致 + 修复目录级审计两处误报（排除目录原只按目录名过滤、不剪枝递归 → `node_modules/pkg-a` 等子目录被计入源码目录数，任何带依赖的仓库恒定超阈值；`.trash` 回收站被计入目录数；+ 5 条回归测试锁住剪枝语义）+ **凭据明文规则误报修复**（`credref-plain-secret` 原先只有正则初筛：`[:：=]` 会命中「凭据标识符与类型名字符串做严格比较」那一行的第 3 个 `=`，把被比较的字符串常量误判成明文凭据，类型检查/字段透传/类型注解共 13 处误报全中；接入既有 `astConfirmKind: credential-value` 精筛（只认「凭据标识符 + 严格 `=` 或字段 `:` + 右侧非占位字符串字面量」）；同时补回该精筛带出的漏报——markdown 行内代码段的反引号被分词器当模板定界符、整段合成一个 token，导致「行内代码段里写的凭据字段示例」不再被报，已在 `checkCredentialRefAst` 内加行内代码段兜底（判据仍是同一函数，不新增第二套）+ 1 条 7 项断言的回归测试）｜459 全绿 |
| **1.1.3** | **规则作用域字段统一收口**（`exts` 与 `astConfirmKind` 原先各编译器手抄透传，16 个里 10 个漏传 → yml 声明被静默忽略；改为 `compileAllRules` 单点收口，新增编译器自动具备）+ **规则包作用域修复**（`frontend` 包 20 条 HTML 规则、`comment` 包 6 条声明 `exts`：HTML 规则不再跑在 `.mjs`/`.json` 上——正文里生成网页的 HTML 模板字符串曾被当真实网页报「内联脚本」）+ **前缀型密钥占位符精筛**（新增 `astConfirmKind: placeholder-credential`：剥掉 `ghp_`/`sk-`/`AKIA` 前缀后判占位符，文档示例与演示假数据不再被报成凭据泄漏；真密钥形状照报）+ **大仓性能降级**（`maxScanFiles` 默认 3000 + 变动文件优先截断 + `audit/scan-truncated` 说明不扣分；29921 文件不再硬扫）+ **分词 LRU 缓存**（单文件 139ms → 42ms，`lib/ast/tokenizer.js`）+ **注入开发者要求清单子开关**（挂审计开关下、审计关时置灰并自动关闭）+ **界面模拟页 `assets/preview.html`**（单文件自包含、跑真实 client.js、全部可点）+ 修复审计页规则行列表缺 `key` 告警与子开关动作未在 `inject()` 暴露导致的点击报错｜453 全绿 |
| **1.1.2** | **规则包列表交互改版**（悬停浮层显示详情、启停只点行尾按钮、启用绿底/禁用红底 + 左侧色条）+ **8 类审计误报修复**（npm license/repository/files 结构化判定、gitignore 只报实际存在产物、memory-bomb 受控小文件豁免、function-name-too-short i18n 缩写豁免、**嵌套函数复杂度不再累加外层**、**单行海量语句改用密度判定**、**凭据类型检查/字段透传不再算硬编码**、**私有包 peer 写 `*` 不再报**）+ 新增 `astConfirmKind` 具名精筛机制（small-file-read / short-func-name / credential-value）+ tokenizer 补多字符运算符切分（`?.` 不再被当三元、`\|\|`/`??` 正确计入分支）｜446 全绿 |
| **1.1.1** | 用户沟通词 blocker 规则（取消分数制 / 白名单豁免 / 黑名单直拦）+ 审计选项卡开关 + 测试目录豁免 + k 系数 5 档调低｜439 全绿 |
| **1.1.0** | **侧边栏三选项卡**（账号信息 / 审计 / 设置）+ **账号面板美化**（渐变卡片 + GitHub 图标 + 状态徽标，设计稿 doc/account-panel-design.html）+ **凭据落盘修复**（persistGithubToken 写插件配置目录 0600 + persistSshPub 写 *.pub，不再只靠 settings.yaml 明文）+ 审计规则包列表（rule-slots meta author + rule-detail 端点）｜438 全绿 |
| **1.0.14** | 客户端重构（Controller + hooks + 独立 section 页）；修复 scope.use 渲染 TypeError 与 Host 缺 settings.register 两根因；双语取消（纯中文）｜430 全绿 |
| **1.0.13** | 文件健康度矩阵评分规则（kind=file-health，三维分级加权）｜429 全绿 |
| **1.0.12** | client.js 结构拆分 ≤400 行（消除 max-function/file-length）｜421 全绿 |
| **1.0.11** | 修复设置侧边栏空白（apply 崩溃根因）｜421 全绿 |
| **1.0.10** | 规则 disabled 机制 + 安全红线强制加载 + 缺失兜底｜420 全绿 |
| **1.0.9** | 8 类真实误报语义修复（npm-json 全仓证据 / timeout 同调用识别 / loader 契约 / exts 过滤等）+ 10 条回归｜418 全绿 |
| **1.0.8** | 扫描智能提示 + 评分对数衰减（防零分塌陷）｜408 全绿 |
| **1.0.7** | 硬编码魔数检测（版本号/日期/状态码豁免版）｜— |
| **1.0.6** | .test 空文件豁免 + button-bind 按钮事件交叉比对｜— |
| **1.0.5** | 侧边栏账号卡（账号检查/SSH 密钥生成）+ Origin 同源放行 + 评分公式定稿｜394 全绿 |
| **1.0.4** | 规则引擎加固 + 侧边栏配置面：regex 子模式 / performance 槽位 / private 槽位 / 审计强度三档 / 真实接线修复（apply 四段 API 全错→真实 API）｜373 全绿 |
| **1.0.3** | 规则包扩充：9 槽位 86 条 + robustness/folder/i18n 新槽位｜320 全绿 |
| **1.0.2** | 审计健壮性加固（G9-G12：匹配器空值 / 重复串死检测等）｜315 全绿 |
| **1.0.1** | 六个真实缺陷修复（死桶 / 豁免失效 / 槽位半硬编码等）｜278 全绿 |
| **1.0.0** | DSH 插件接线完成（apply + 7 工具 + HTTP 鉴权 + client）｜263 全绿 |
| **0.2.0** | 链接判断落地（link-check kind，分级扣分，flaky 域名打折）｜233 全绿 |
| **0.1.7** | 上下文注入 + HTTP 总入口（Origin 校验 / CSRF / 5MB 限制）｜190 全绿 |
| **0.1.6** | 豁免总入口（dsh-skip-* 注册表驱动全消费）｜153 全绿 |
| **0.1.5** | 评分总入口（AST 质量检查器 + 权重覆盖）｜128 全绿 |
| **0.1.4** | 自身总入口（VERSION 单一事实源 / README 模板 / helpSync）｜97 全绿 |
| **0.1.3** | git 总入口（resolveToken 三层探测 / pushViaApi / cloneViaApi / 建仓）｜79 全绿 |
| **0.1.2** | 审计总入口（auditChanged / auditFull / 豁免接线）｜44 全绿 |
| **0.1.1** | 规则总入口（13 编译函数 + 首个 yml 槽位）｜31 全绿 |
| **0.1.0** | 功能框架搭建完毕能跑（8 入口骨架 + CLI + 测试）｜16 全绿 |
| **0.0.0** | README 文档（开发计划） |

## 注意事项

- **审计默认关闭**：提交前自动审计默认不开，由侧边栏开启
- **规则加载器铁律**：加字段 = 加函数 + 注册一行，`compileRule` 主体永不修改
- **命名格式统一**：一个功能一个根词，各层只做格式转换，对外 API 与函数名完全一致
- **npm 发布完整性**：dependencies（js-yaml 等）显式声明，files 白名单含 cli.mjs，npm test 一条命令可复现
- **凭据卫生**：token 只写插件配置目录 0600；测试用占位符（`ghp_testtokenplaceholder123`），无真实凭据入库
