# dsh-git-push

DSH（DeepSeek Harness）git 提交推送与代码审计插件——提交前自动审计门禁，提交推送全链路自动化。

![账号信息面板](assets/panel-account.png)

> **公开仓库**：EIGHTfs/dsh-git-push（2026-09-13 转 public）｜全量测试 479 全绿（`npm test` 一条命令可复现）
> **界面模拟页**：`assets/preview.html`（单文件自包含，双击即可打开；跑的是真实 `client.js` + 假数据，三选项卡全部可点）

## 目录

- [功能总览](#功能总览)
- [一、提交推送](#一提交推送)
- [二、代码审计](#二代码审计)
- [侧边栏设置](#侧边栏设置)
- [独立 CLI（git-sluice）](#独立-cligit-sluice)
- [安装与要求](#安装与要求)
- [版本列表](#版本列表)
- [注意事项](#注意事项)

## 功能总览

插件围绕 DSH 日常开发的两个高频动作，分为**提交推送**与**代码审计**两大块：

| 功能块 | 做什么 | 入口 |
|---|---|---|
| **提交推送** | token / SSH 密钥管理、提交、推送、clone、建仓、可见性切换、force 强推、版本历史 | `git_commit_push` 工具 / CLI / 侧边栏 |
| **代码审计** | 提交前自动审计门禁、14 个规则槽位 96+ 条规则、10 维度质量评分、豁免机制、链接检查 | `code_audit` 工具 / CLI / 侧边栏 |

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
| folder | 4 | 目录总数 / 单目录文件数 / 解包特征 / .gitignore |
| i18n | 3 | 硬编码文案 / 插值 / 语言包 |
| performance | 2 | memory-bomb / busy-wait |
| docs / robustness / structure / template / private | 各 0-4 | 链接检查 / 写前 mkdir / 循环依赖 / 规则模板 / 私密文件拦截 |

**加规则 = 放文件**；**加字段类型（新 kind）才需加函数**（compilers.js 注册制：`registerCompiler(kind, detect, compile)`，加字段=加函数+注册一行，`compileRule` 主体永不修改）。

### 代码架构：lib/ 各文件夹各司其职

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
| `index.js` | 统一出口（只做再导出，不含实现） |

#### ③ `lib/checks/`：调用包装

| 模块 | 职责 |
|---|---|
| `common.js` | 公共设施（豁免提示、severity 封顶、各 astConfirm 精筛集合的取值函数） |
| `dispatch.js` | **调度 `runChecks`——只写引用**：按 kind 依次调用各检查器并汇总，不含任何检查逻辑 |
| `filter.js` | 规则作用域过滤（`exts` / `exclude_paths`）——yml 声明的作用域唯一落地点 |
| `regex.js` | 正则类规则（含 astConfirm 精筛消费） |
| `structural.js` | 结构类（函数长度/复杂度/嵌套/文件行数/同步 fs/空 catch） |
| `semantic.js` | 语义类（yml 声明的语义检查、patch insert） |
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
| 纯 token 级（无需正则） | `lib/ast/`（各模块，见上表） | `checkMagicNumberSmartAst` / `checkSyncFs` / `checkEmptyCatchAst` / `checkComplexityAst` / `checkNestingDepthAst` / `checkNameLengthAst` / `checkFuncLinesAst` / `checkRepeatedStringsAst` |
| 纯正则（本质是文本特征） | `lib/checks/regex.js` 的 `checkRegexRules` | 凭据硬编码、路径穿越、对话残留、黑名单 |


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

`dsh-skip-*` 注册表（文件头=整文件 / 行内=单点），每个豁免类型声明「能豁免哪些维度」。安全红线不可豁免：`secret-*` / `cred*` / `security/*` 类规则即使标 disabled 也强制加载。

**`.test` 空文件豁免（目录级）**：在目录内放一个 0 字节的 `.test` 文件，该目录（含全部子目录）整目录跳过扫描——专为测试 fixture 目录设计。例如 `test/` 目录放 `.test` 空文件，整个测试目录不再被审计（测试用例里故意构造的样本不会被误拦）。

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
- **全部可点**：三选项卡切换 · 审计开关与「注入开发者要求清单」子开关（含置灰联动）· 规则包启停与 ↑↓ 调序 · 权重编辑 · token/SSH 保存 · 邮箱一键生成 SSH 并回填
- 所有改动只留在页面内（内存假数据），**不写任何文件、不调真实接口**

重新生成（改了 `client.js` 后同步）：

```
node assets/preview-gen.mjs
```

## 侧边栏设置

设置 → 侧边栏 → **Git 提交推送**，三选项卡（对齐插件市场样式）：

- **账号信息**：渐变卡片 + GitHub 图标 + 状态徽标（已连接/检测中/未连接）+ 检测结果块 + Token/SSH 凭据状态标签 + `⟳ 重新检测`
- **审计**：审计开关 + 代码禁用户沟通词开关 + 10 维度权重编辑 + 规则包列表
  - 子开关 **`↳ 注入开发者要求清单到系统提示词`**：挂在「提交前自动审计」下面，**必须先开审计才能开**（审计关闭时置灰不可点、且自动关闭）；开启后把开发者要求清单注入系统提示词，省掉每次提交推送时 AI 被门禁拦下再回读清单的一轮往返
  - 规则包行：↑↓ 调次序 · **按住行内信息区悬停显示详情浮层**（描述/作者/拦截·警告·通过 命中口径）· 启停**只点行尾按钮**
  - 状态底色一眼可辨：**启用 = 绿底 + 绿左条**，**禁用 = 红底 + 红左条**（按钮同为绿/红实色胶囊）
  - 拦截/警告/通过 三列显示**最近一次审计的实际命中数**（未审计时回落为规则条数口径）
- **设置**：GitHub token + SSH 公钥 + 邮箱 + 一键生成并复制

设置项以 `lib/app/schema.js` 的 `Config` 为单一事实源（`lib/index.js` 只再导出），`settingsScope` 读写。凭据保存**同时写插件配置目录**（见「凭据管理」）。

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

## 安装与要求

- **环境**：DSH（DeepSeek Harness）｜Node ≥18 ｜本机 git
- **安装**：`dsh plugin add EIGHTfs/dsh-git-push`（仓库已声明 `dsh.bundle`，可安装）
- **测试**：`npm test` 一条命令复现全绿（479 断言，0 失败）

## 版本列表

| 版本 | 说明 |
|---|---|
| **1.1.6**（当前） | **推送默认走 SSH（远端 sha 与本地一致）**：原先 `commitAndPush` 无条件先走 Git Data API，该通道经 blob → tree → commit **在远端重建提交**（父提交/作者/时间戳都是新造的），推完远端 sha 必然与本地不同、本地与远端从此分叉；SSH 通道 `git push HEAD:refs/heads/<branch>` 上传的是本地提交对象本身，sha 天然一致。新增 `dispatchPush` 单一决策点与 `pushMethod` 配置项（`ssh` 默认 / `api` / `auto`，侧边栏可选），SSH 无可用私钥或推送失败时回落 API 并把回落原因记进 `fallbackReason`；私钥探测扩展为 `resolveSshKeys` 返回全部候选（`id_rsa`/`id_ed25519`/`id_ecdsa`）并逐个尝试，避免配置目录里同时存在「已登记」与「未登记」两把密钥时选错导致 `Permission denied (publickey)`；SSH 通道成功后同样执行推送后增强（remote-tracking ref / aux remote / autoTag），修掉原先只有 API 分支做增强、走 SSH 时本地 `origin/<branch>` 引用不更新导致 ahead/behind 错位的问题。实测：SSH 推送后远端 sha 与本地 sha 逐字节相同（本地 `f5c1ddc2486735e24948051a797b1568c02125d4` == 远端同名 sha）。新增 10 条回归测试（含 host 自探测、三档语义、多密钥尝试、防退回 API 优先，以及「remote URL / .git/config 不得内嵌明文凭据」2 条安全断言）｜479 全绿；同时清理 6 个仓库 origin URL 里内嵌的明文 token（该 token 实测已失效 HTTP 401，推送凭据统一由凭据目录自探测提供） |
| **1.1.5** | **GitHub token 不再明文下发浏览器**：`/api/git-push/status` 原样回吐整个 `cfg`（含 `githubToken` 明文，局域网内一条 `curl` 即可取到）→ 改为回吐脱敏副本（`redactConfig`：删除密钥位、另给 `tokenConfigured`/`sshConfigured` 布尔位供界面渲染「已填写」）；同时 schema 的 `githubToken` 标注 `role('secret')`，浏览器读设置那条路径由 DSH 远端读的 `redactSecrets` 统一脱敏（host 侧 `scope.get/watch` 仍是明文，token 功能不受影响；`role()` 同时补进 fallback schema，缺 schemastery 的环境不会因链式调用崩）；顺带删掉声明了却从未派生/读取的死字段 `tokenConfigured`。**审计页子开关交互修正**：「注入开发者要求清单到系统提示词」原在父开关「提交前自动审计」关闭时带 `disabled` + `toggle` 直接 `return`（点了没反应，须先点父开关再点它＝两遍），且关父开关会把子开关勾选静默清掉 → 改为随时可勾选（一遍）、父关时只整行置灰表示暂不生效、勾选保留，实际是否注入仍由 host 侧 `cfg.auditEnabled && cfg.injectRequirements` 门控（父关时勾了也不注入）。新增 11 条回归测试（token 脱敏 4 条 + 子开关交互 6 条，含真实渲染读 input props 验证 `disabled`/`checked`；另加「`SYNC_ENTRIES` 必须覆盖 package.json files 白名单」1 条）｜470 全绿，并修复 `scripts/sync-plugin.mjs` 的 `SYNC_ENTRIES` 漏列仓库根 `client.js`（files 白名单有它、同步清单没有 → 同步到已安装副本时会漏掉前端主文件，前端改动装不进去） |
| **1.1.4** | **实现按职责拆分到各文件夹（六处）**：`lib/score/ast.js`（1029 行，AST 实现错放在评分目录）→ `lib/ast/*`（8 模块 + 出口）；`lib/audit/checks.js`（1259 行，25 个检查实现混在调用层）→ `lib/checks/*`（13 模块，含纯调度 `dispatch.js`）；`lib/git/index.js`（1036 行）→ `lib/git/*`（12 模块，最大 173 行）；`lib/rule/compilers.js`（459 行）→ `lib/rule/compilers/*`（10 模块）；`lib/audit/index.js`（482 行）→ `lib/audit/*`（6 模块：finding/slot/repo-level/file-context/audit-file/orchestrate）；`lib/index.js`（683 行，宿主 main 入口）→ `lib/app/*`（8 模块：schema/constants/slot-stats/tools/inject-text/tool-call/http-handlers/apply）——**六处入口文件全部退化为纯再导出（17-35 行），不含实现**，导出名与顺序逐项比对一致，调用方零改动；每处均做双态行为对比（还原原文件重跑同一探针、`diff` 为空）+ 全量测试 + 未受影响文件审计结果逐条一致 + 修复目录级审计两处误报（排除目录原只按目录名过滤、不剪枝递归 → `node_modules/pkg-a` 等子目录被计入源码目录数，任何带依赖的仓库恒定超阈值；`.trash` 回收站被计入目录数；+ 5 条回归测试锁住剪枝语义）+ **凭据明文规则误报修复**（`credref-plain-secret` 原先只有正则初筛：`[:：=]` 会命中 `token === 'string'` 的第 3 个 `=`，把被比较的 `'string'` 当成明文凭据，类型检查/字段透传/类型注解共 13 处误报全中；接入既有 `astConfirmKind: credential-value` 精筛（只认「凭据标识符 + 严格 `=` 或字段 `:` + 右侧非占位字符串字面量」）；同时补回该精筛带出的漏报——markdown 行内代码段的反引号被分词器当模板定界符、整段合成一个 token，导致 `` `password: "..."` `` 不再报，已在 `checkCredentialRefAst` 内加行内代码段兜底（判据仍是同一函数，不新增第二套）+ 1 条 7 项断言的回归测试）｜459 全绿 |
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
