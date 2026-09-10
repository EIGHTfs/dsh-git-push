---
name: dsh-git-push-functions
description: dsh-git-push 插件功能说明书——八个 agent 工具的完整参数/返回/失败处理（git_scan / git_commit_push / code_audit / git_gen_readme / git_clone / git_remote_create / git_set_visibility / link_check）、HTTP API 路由与鉴权、设置侧边栏配置项、上下文注入内容、规则包与豁免机制、10 总入口的源码定位（lib/ 下每个入口的文件与关键函数）。处理「插件某工具怎么调」「参数填什么」「报错怎么排查」「改插件源码从哪进」「规则包/豁免/评分怎么工作」类请求时加载。
whenToUse: 需要查工具参数细节、排查插件报错、或修改插件源码（定位到文件与函数）时加载；日常使用看 dsh-git-push 手册即可。
---

# dsh-git-push 插件功能说明书

> 架构：**10 总入口**（规则 / 审计 / git / 自身 / 侧边栏 / 评分 / 豁免 / 上下文 / HTTP / 测试），每个入口一个 `lib/` 子目录，入口内聚、互不越层。
> 本说明书面向「要调工具参数」或「要改插件源码」的场景。

## 一、agent 工具（会话内直接调用）

### 1. `git_scan` —— 扫描仓库状态

| 参数 | 类型 | 说明 |
|---|---|---|
| `root` | string? | 扫描根目录（默认 workspaceRoot） |
| `paths` | string? | 额外仓库绝对路径，逗号分隔（临时指定，无需改配置） |
| `extraReposFile` | string? | 配置文件路径，每行一个仓库绝对路径，`#` 注释，运行时实时读取 |

返回：每个仓库的分支 / remote / 未提交变更数 / 最近活动。**实现在 `lib/git/index.js` 的 `scanRepos`。**

### 2. `git_commit_push` —— 一键提交推送（带审计门禁）

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `repo` | string 必填 | — | 仓库绝对路径 |
| `message` | string 必填 | — | commit message |
| `audit` | bool | true | 提交前审计（有 blocker 时拦截） |
| `llmAudit` | bool | false | 追加 LLM 深度审查 |
| `push` | bool | true | 是否推送 |
| `dryRun` | bool | false | 只模拟不写入 |

流程：审计 → 敏感文件扫描（cookie/device/username/password/token 自动加 .gitignore）→ `git add -A` → commit → `git push origin <当前分支>`。
**推送前会 fetch 并检查 ahead/behind，远端领先时不推。实现在 `lib/git/index.js` 的 `commitAndPush`。**

### 3. `code_audit` —— 手动审计仓库

| 参数 | 类型 | 说明 |
|---|---|---|
| `repo` | string 必填 | 仓库绝对路径 |
| `scope` | string? | `full`=全量扫描 / 缺省=仅本次变动（非 git 目录自动退化为全量） |
| `llm` | bool? | 追加 LLM 深度审查（需配置 provider/model） |
| `ruleset` | string? | 自定规则目录（指向含 `audit-rules-<名>.yml` 的目录即整体替换内置规则包；空=内置） |
| `auditLevel` | string? | 审计强度：`quick`（跳 AST/语义重检查）/ `standard`（默认全量）/ `deep` |
| `weights` | string? | 权重覆盖 JSON（如 `{"安全性":100}`；非法 JSON 回退默认权重表） |

返回：问题清单（blocker 拦截级 / warning 提醒级）、quality 评分（0-100，A/B/C/D）、是否通过。
**实现在 `lib/audit/index.js` 的 `auditWithScope`（`auditFull` 全量 / `auditChanged` 仅变动）。**

### 4. `git_clone` —— 从 GitHub 克隆

| 参数 | 类型 | 说明 |
|---|---|---|
| `target` | string 必填 | `owner/repo` 或完整 URL |
| `dest` | string? | 目标目录（默认 workspaceRoot），已存在非空目录会拒绝防覆盖 |
| `branch` | string? | 指定分支（默认远端默认分支） |

只走 `api.github.com` Git Data API（`git/trees` + `git/blobs`），**不跟随 tarball 302、不直连 codeload**；在 `/tmp` 中转建仓后整拷回目标（兼容 CIFS 卷）。
**实现在 `lib/git/index.js` 的 `cloneViaApi`。**

### 5. `git_remote_create` —— 按项目文件夹创建远程仓库

| 参数 | 类型 | 说明 |
|---|---|---|
| `repo` | string 必填 | 本地仓库绝对路径（取目录名做仓库名） |
| `visibility` | `public`/`private`? | 默认 private |
| `dryRun` | bool? | 只探测预演不创建 |

检查同名仓库是否已存在 → 不存在则创建 → 设 origin 为 `https://api.github.com/repos/{owner}/{name}`。
**实现在 `lib/git/index.js` 的 `ensureRemoteRepo`。**

### 6. `git_set_visibility` —— 切换公开/私有

| 参数 | 类型 | 说明 |
|---|---|---|
| `repo` | string 必填 | 本地仓库绝对路径 |
| `visibility` | `public`/`private` 必填 | 改 public 前须确认无凭据暴露 |

调 `PATCH /repos/{owner}/{repo}` 的 `private` 字段，**实现在 `lib/git/index.js` 的 `setVisibility`。**

### 7. `link_check` —— 文档链接检查

| 参数 | 类型 | 说明 |
|---|---|---|
| `path` | string? | 文件或目录（缺省 workspaceRoot） |

分级扣分：404/403 → −3，DNS 失败 → −2，超时/5xx → −1；flaky 域名（github 等）网络错误 ×0.2。
**只 warning，永不 blocker**；并发 10，100 链接 ≤30 秒。
**实现在 `lib/link-check/index.js` 的 `checkLinks` / `probeLinks`。**

### 8. `git_gen_readme` —— 按模板生成仓库 README（1.0.4 迁移）

| 参数 | 类型 | 说明 |
|---|---|---|
| `repo` | string 必填 | 仓库绝对路径 |
| `writePath` | string? | 写入路径（默认只返回内容不写文件） |

模板优先级：插件 `template/README.md`（用户可改整份章节）> 内置 `lib/readme-templates/readme.yml`（章节模板）> 代码兜底骨架。占位符 `{{name}}` `{{description}}` `{{version}}` `{{toc}}` `{{versionTable}}`；版本表由 `git log --reverse` 提交标题里的 X.Y.Z 聚合（补丁并入主版本，最新→最旧）。
**实现在 `lib/readme-gen/index.js` 的 `genReadme` / `buildReadmeVersionTable` / `listVersionCommits`。**

---

## 一.5、接线层（lib/plugin/index.js，1.0.4 起）

Host 侧注册统一走独立接线层，四段真实 API（对照运行中插件实证）：
- 工具：`ctx.inject(['tools'])` → `get('tools').register(defineTool(spec))`；`output.render` **必须返回块数组** `[{type:'text',text}]`（否则会话日志损坏）
- 提示词注入：`ctx.inject(['systemPrompt'])` → `section({name, order, text:()=>同步文本})`（callback 返回值不是注册）
- HTTP：`ctx.inject(['webServer'])` → `register({kind:'prefix', path, handler})`（handler 返回 undefined 放行）
- 客户端：**不在此注册**，由 package.json `dsh.client` + `exports["./client"]` 自动发现

---

## 二、HTTP API

| 方法 | 路由 | 说明 |
|---|---|---|
| GET | `/api/git-push/scan` | 扫描仓库 |
| POST | `/api/git-push/audit` | 审计（body: `{repo, scope?, llm?}`） |
| POST | `/api/git-push/commit` | 提交推送（body: `{repo, message, push?, confirm?}`） |
| POST | `/api/git-push/clone` | 克隆 |
| POST | `/api/git-push/remote-create` | 建仓 |
| POST | `/api/git-push/visibility` | 切可见性（需 `confirm: true`） |
| POST | `/api/git-push/rebuild-history` | 重建历史（需 `confirm: true`） |
| GET | `/api/git-push/link-check` | 链接检查 |

### 鉴权（`lib/http/index.js` 的 `authPipeline`）

1. **写方法**（POST/PUT/PATCH/DELETE）必须带 `Origin`，且需与 Host 同源（仅比 scheme://host，忽略端口与路径）；缺失 → 403，跨域 → 403
2. **破坏性操作**（重建历史 / 切可见性）需 body 带 `confirm: true`，否则 400
3. **body > 5 MB** → 413
4. GET / OPTIONS 免鉴权（只读探测）

---

## 三、设置侧边栏（`lib/client/index.js`）

- `SETTINGS_SCHEMA` 定义配置项；`defaultConfig()` / `resolveConfig()` 负责默认值与归一
- `createSettingsCard()` 生成卡片（**手写 `createElement`，无 JSX，零外部资源**）
- 审计开关 / 推送开关 **默认关闭**
- `collectExternalRefs()` 供「零外部资源」自检

**设置项三处同源**（新增项必须三处同加，`test-client.mjs` 断言一致性）：
`lib/index.js` 的 `Config`（服务端 schema）+ `lib/client/index.js` 的 `SETTINGS_SCHEMA`（纯逻辑，可单测）+ `client.js` 的 `SCHEMA`/`zh`（浏览器侧内联，无法 import 服务端 ESM）。

**11 项设置**：`auditEnabled` / `pushPermitEnabled` / `llmAudit` / `hardcodeFullScan` / `injectFullSkill` / `injectRepoIndexFull`（boolean，均默认 false）、`auditScanScope`（diff|full）、`auditLevel`（quick|standard|deep）、`auditRuleset`（自定规则目录）、`weightOverrides`（权重 JSON）、`commitMessage`（string）。

**审计强度三档**（`auditLevel`，透传链 配置/工具参数 → `auditWithScope` → `auditFull`/`auditChanged` → `auditFile(…, {level})` → `runChecks({…}, {level})`）：
`quick` 跳过 AST/语义重检查（func-lines / max-complexity / max-depth / max-lines / repeated-string / min-occurrences / semantic / credential-file / min-length），保留正则、凭据、路径、黑名单、空 catch、同步 IO——基础安全不随强度降级；`standard` 全量；`deep` 当前与 standard 等效（预留扩展位）。

**自定规则包**（`auditRuleset` / 工具 `ruleset` 参数）：目录里每个 `audit-rules-<名>.yml` 即一个槽位，放文件即生效、删文件即移除（导入/导出/删除 = 对该目录的文件操作）；装载走 `loadRuleFiles(order, { dir })`，指向空/不存在目录会装载 0 条规则（`errors` 有记录），不静默沿用内置包。

**权重覆盖**（`weightOverrides` / 工具 `weights` 参数）：JSON 与默认 10 维度权重表合并（未指定维度保持默认）→ `scoreQuality(findings, weights)` → `quality.dims` 与总分随之变化；JSON 非法回退默认权重，不中断审计。

---

## 四、上下文注入（`lib/context/index.js`）

`createEnvInjectionText({cwd, projectRoot, tools})` 生成注入文本：工作目录映射 / 项目根 / skills 目录存在性 / 工具安装路径。
`parseEnvInjection(text)` 反向解析为结构（字段预置空串，缺行返回 `''` 而非 `undefined`）。
`isWithinRoot(root, target)` 路径归属判定（防目录穿越；尾斜杠归一，根 `/` 包含一切绝对路径）。
`DEFAULT_TOOLS` 是默认工具清单。

---

## 五、规则包与豁免

### 规则包（`lib/rule/`）

- `loader.js`：`discoverRuleSlots(dir)` 扫 `audit-rules-*.yml` 动态发现槽位；`resolveSlotOrder(order, {dir})` 定顺序（配置 > 环境变量 `DSH_GIT_PUSH_RULE_SLOTS` > `SLOT_ORDER_HINT` 偏好）；`loadRuleFiles(order, {dir})` 合并多槽位并返回 `{ok, merged, order, files, errors}`（`dir` 可指向自定规则目录 = 整体替换规则包；`merged.private_files` 汇总各槽位顶层私密清单）
- `registry.js`：`compileRule()` 是统一入口（**永不修改**），`registerCompiler(kind, detect, compile)` 是扩展点
- `compilers.js`：各 kind 的 `detect` + `compile` 实现；`safeRe()` 默认大小写不敏感（驼峰/大写凭据不漏检）

### 豁免（`lib/exempt/index.js`）

`EXEMPT_MARKERS` 注册 `dsh-skip-*` 标记（各自的 `blocked` 列表 = 能豁免哪些 kind、`lineLevel` = 是否支持行级）；
`CATEGORY_EXEMPT` + `isCategoryExempt()` 处理文件类别豁免（test/、scripts/ 的 console-log / sync-fs / 空 catch）；
`exemptForFinding()` 判定单条问题是否豁免；`exemptHintFor()` 生成提示。

### 审计执行（`lib/audit/`）

`index.js`：`makeFinding` / `summarize`（error 归拦截级，notice 单列）/ `auditFile(src, {level})` / `auditFull` / `auditChanged` / `auditWithScope`
`checks.js`：`runChecks({...}, {level})` 按 kind 分发（正则类 / 路径类 / AST 质量类 / 凭据文件 / 语义；`quick` 档跳重检查）；`checkPrivateFiles({root, visibility, privateFiles})` 私密文件强制检查
`glob.js`：`globToRegex(glob, anchored)` / `globMatch(glob, path)` 零依赖 glob→RegExp（`**` 跨层 / `*` 单层 / `{}` 分支 / `[类]`；`anchored=false` 供 `{}` 内部递归）
`collector.js`：`collectTextFiles`（gitignore 感知）、`collectChangedFiles`（git status --porcelain）

### 评分（`lib/score/`）

`ast.js`：`tokenize` + 各 AST 检查器（`checkFuncLinesAst` / `checkNameLengthAst` / `checkComplexityAst` / `checkNestingDepthAst` / `checkFileLines` / `checkRepeatedStringsAst` / `checkSyncFs` / `checkEmptyCatchAst`）
`index.js`：`DEFAULT_WEIGHTS`（10 维度加权合计 100）、`countByDimension`、`scoreQuality(findings, weights)`（weights 覆盖默认表，未指定维度保持默认）

---

## 六、自身能力（`lib/self/index.js` + `cli.mjs`）

- `VERSION` 是版本号**单一事实源**（`scripts/scan-version.mjs` 校验与 package.json 一致）
- `readmeTemplate()` / `yamlTemplate()` 提供模板
- `selfVersion()` / `versionInfo()` / `helpSync()` 供自检
- **独立运行**：`cli.mjs` 子命令 `version` / `ruleset` / `scan` / `audit` / `link-check` / `readme-template` / `yaml-template` / `self-check`；`bin.git-sluice` 指向它
- **CLI 选项**（白名单 `KNOWN_FLAGS` 必须与 HELP 文本一致，`self-check` 机器比对）：`--depth N`（scan）/ `--full` / `--level quick|standard|deep`（非法取值直接报错）/ `--ruleset <目录>`（自定规则目录）/ `--weights <JSON>`（非法回退默认权重表并提示）——`audit` 子命令与服务端设置项一一对应

---

## 七、坑速查

| 现象 | 原因 / 处理 |
|---|---|
| 插件改动刷新看不到 | 真实加载源是 `<profile>/local-plugins/<插件名>`，只同步 `node_modules/` 无效；用 `scripts/sync-plugin.mjs --write` 同步两处 |
| 规则不生效 | 槽位动态发现，确认文件名 `audit-rules-<名>.yml` 且在 `lib/audit-rules/` |
| 新规则被宽规则抢走 | 注册表**有序匹配**：宽泛 detect 必须排在专用 detect 之后 |
| 统计数字矛盾（0 blocker 0 warning 但 total > 0） | error 级计入拦截级，看 findings 的 `severity` |
| 豁免写了没用 | 整文件豁免须在前 3 行；行级豁免须写在命中行 |
| 函数/复杂度问题被报为 blocker | 规则 `severity` 是上限，检查器不会越级；若报 blocker 说明 yml 里写的就是 error/blocker |
| 推送被拒 | push 前会 fetch 检查 ahead/behind，远端领先时不推（先 pull） |
| 克隆失败 | 只走 api.github.com Git Data API；网络受限时确认 token 可用 |
| 链接检查报错但不拦截 | 设计如此（链接问题只 warning） |
