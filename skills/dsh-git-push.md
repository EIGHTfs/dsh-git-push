---
name: dsh-git-push
description: dsh-git-push 插件手册（10 总入口 + 7 工具 + YAML 规则包 + 客户端设置 UI）。说明 git_scan / git_commit_push / code_audit / git_clone / git_remote_create / git_set_visibility / link_check 七个工具的调用方法，审计规则包（lib/audit-rules/*.yml 动态槽位）、豁免标记（dsh-skip-*）、质量评分（10 维度加权）、HTTP API 鉴权（Origin + confirm）、独立运行（git-sluice CLI）、官方 CLI 安装与客户端 UI 修复实录（2026-09-12：Controller+hooks+独立 section 页，修复 scope.use 崩溃与 Host 缺 settings.register 两个根因）。处理「提交推送代码」「扫描仓库状态」「审计代码」「规则包怎么加规则」「被审计拦截怎么豁免」「链接检查」「插件装了不生效」「设置侧边栏空白」「配置卡不出」「侧边栏没有 git-push」类请求时加载。
whenToUse: 需要用插件做 git 提交推送 / 代码审计 / 规则包定制 / 报错排查时。
---

# dsh-git-push 插件手册

> 定位：把「扫描仓库 → 审计门禁 → 一键 commit+push」固化为代码管道（零 token、确定性）。
> 本手册是使用说明；正常情况优先直接调用插件工具。

## 一、七个工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `git_scan` | `root?`, `paths?`, `extraReposFile?` | 扫描全部 git 仓库 → 分支/remote/未提交变更数/最近活动 |
| `git_commit_push` | `repo`(必填), `message`(必填), `push?`, `dryRun?`, `audit?`(默认 true), `requirementsConfirmed?` | **先审计** → `git add -A` → commit → push；审计有 blocker 时拦截 |
| `code_audit` | `repo`, `scope?`, `llm?`, `ruleset?`, `auditLevel?`, `weights?` | 审计仓库：L0 静态检查 + 10 维度质量评分；`scope=full` 全量；`ruleset` 指向自定规则目录（整体替换规则包）；`auditLevel=quick/standard/deep` 控强度；`weights` JSON 覆盖权重 |
| `git_clone` | `target`(必填), `dest?`, `branch?` | 经 `api.github.com` Git Data API 克隆（不跟随 302、不直连 codeload） |
| `git_remote_create` | `repo`, `visibility?`(默认 private), `dryRun?` | 按目录名建远程仓库并设 origin（走 api.github.com） |
| `git_set_visibility` | `repo`, `visibility`(必填) | 切换仓库公开/私有（改 public 前先确认无凭据泄露） |
| `link_check` | `repo?`, `paths?` | 检查文档链接：404/403→-3、DNS→-2、超时/5xx→-1；只 warning，永不 blocker |

典型流程：`git_scan` 看改动 → `code_audit` 自查 → `git_commit_push`（审计通过才推）。

## 二、审计规则包（YAML 槽位）

- **位置**：`lib/audit-rules/audit-rules-<槽位名>.yml`
- **槽位全动态**：**放一个 yml 进目录就自动成为槽位**，删除即失效，无需改代码
- **排序偏好**：`lib/rule/loader.js` 的 `SLOT_ORDER_HINT` 只决定加载顺序，不决定「有哪些槽位」
- **环境变量**：`DSH_GIT_PUSH_RULE_SLOTS=nodejs,docs` 可临时指定（脱离 DSH 时用）
- **template**：`audit-rules-template.yml` 是空模板，默认不加载（供自定义参照）

已建槽位：`nodejs`（代码规则）、`docs`（链接与文档规则）。

### 规则字段 → 编译函数（加字段 = 加函数 + 注册一行）

`lib/rule/registry.js` 的 `compileRule` 是统一入口，**永不需要修改**。新增一种规则类型只需：

1. 在 yml 里加字段（如 `max_lines: 50`）
2. 在 `lib/rule/compilers.js` 写一个编译函数
3. `registerCompiler(kind, detect, compile)` 注册一行

`detect` 是认领条件（看 id 前缀或字段存在性），注册表有序匹配。

### 支持的规则字段

| 字段 | kind | 含义 |
|---|---|---|
| `pattern` / `patterns` + id 前缀 `secret-` | `[FUNC]` | 凭据正则（大小写不敏感，驼峰/大写不漏检） |
| id 前缀 `credfile-` / `path_pattern` | `credential-file` | 凭据类文件路径 |
| id 前缀 `credref-` | `credential-ref` | 凭据引用模式 |
| `max_lines` | `func-lines` | 单函数行数上限 |
| `max_lines`(文件级) | `max-lines` | 单文件行数上限 |
| `min_length` | `min-length` | 命名最短长度 |
| `max_complexity` | `max-complexity` | 圈复杂度上限 |
| `max_depth` | `max-depth` | 嵌套深度上限 |
| `min_occurrences` | `repeated-string` / `min-occurrences` | 重复硬编码串/数值 |
| `path_pattern`(非 credfile) | `path-regex` | 文件路径正则 |
| `pattern`(普通) | `regex` | 通用正则 |
| `kind: link-check` | `link-check` | 链接有效性 |
| `semantic` | `semantic` | 语义提示（需人工确认，notice 级） |

**severity 上限规则**：yml 里声明的 `severity` 是上限——规则写 warning，检查器就不会把它升为 blocker。

## 三、豁免标记（dsh-skip-*）

写注释即可豁免，**位置决定范围**：

| 标记 | 豁免什么 | 位置语义 |
|---|---|---|
| `dsh-skip-sensitive` | 凭据/敏感信息（`[FUNC]`/credential-*） | 文件头前 3 行=整文件；行尾=本行 |
| `dsh-skip-func-length` | 函数过长 | 文件头=整文件；函数定义行=该函数 |
| `dsh-skip-residue` | 残留注释措辞 | 文件头=整文件；行尾=本行 |
| `dsh-skip-quality` | 质量类（命名/复杂度/嵌套/重复串） | 文件头=整文件 |
| `dsh-skip-size` | 文件过大 | 只能写文件头（文件大小是整文件属性） |

豁免**只免扫描告警，不免审计门禁本身**——不放行任何凭据入库。

## 四、质量评分

10 维度加权（合计 100）：可读性 15 / 可维护性 15 / 健壮性 15 / 安全性 18 / 性能 10 / 测试覆盖 10 / 可观测性 5 / 可部署性 5 / 文档 4 / 开发者体验 3。

分档：A ≥ 85，B ≥ 70，C ≥ 55，其余 D。问题按 `dimensions` 归属到维度后扣分。

## 五、HTTP API 鉴权

- **写方法**（POST/PUT/PATCH/DELETE）必须带 `Origin` 头，且需与 Host 同源；缺失或跨域 → 403
- **破坏性操作**（重建历史/切可见性/删仓）需 body 带 `confirm: true`，否则 400
- **body > 5 MB** → 413
- GET/OPTIONS 免鉴权（只读探测）

## 六、独立运行（脱离 DSH）

```bash
node cli.mjs version          # 版本
node cli.mjs ruleset          # 编译规则包并输出统计
node cli.mjs scan             # 扫描仓库
node cli.mjs audit . --full   # 全量审计（--full 全量，默认只扫变动）
node cli.mjs link-check       # 链接检查
node cli.mjs self-check       # 自身完整性
```

`package.json` 的 `bin.git-sluice` 指向 `cli.mjs`。

## 七、安装与客户端 UI（官方 CLI + 2026-09-12 修复实录）

### 7.1 安装（官方 CLI，不再手动三步曲）

```bash
export DSH_HOME="<你的 DSH 实例 .dsh 目录>"
# 开发期（改码重启即生效，node_modules 是软链）
dsh plugin --profile web add link:/绝对/路径/dsh-git-push-v2
# 用户要求实体安装（怀疑软链 / 换机分发）——pnpm 目录源都是软链，唯一实体是 .tgz
dsh plugin --profile web remove dsh-git-push && rm -f node_modules/dsh-git-push
cd <源码> && pnpm pack --pack-destination /tmp/
dsh plugin --profile web add /tmp/dsh-git-push-<版本>.tgz
```

验证：`ls -la node_modules/dsh-git-push`（drwx=实体，lrwx=软链）+ `--dump-config` 应有 `id: dsh-git-push / enabled: true`。装完重启 DSH 才生效（dsh-restart-gate）。

### 7.2 客户端 UI 修复实录（2026-09-12）

**症状**：设置侧边栏有「Git 提交推送」入口，但点击无内容；插件配置无卡片。排查确认两个根因 + 一个隐藏坑：

1. **根因① Host 缺 `settings.register`**——官方契约：配置卡 = Host 注册命名空间 ∩ client 卡片 key 的交集。Host 没 `settingsCtx.settings.register('git-push', Config)` 时交集为空 → 不出卡。修复：apply() 里 `ctx.inject(['settings'])` + `settings.register('git-push', Config, { base: defaultConfig() })` + `scope.watch` 同步。
2. **根因② `scope.use()` 不存在**——官方 `SettingsScope` 契约只有 `getSnapshot()/subscribe()/set()/mutate()/unset()`，无 `use()`。v2 曾误用 `scope.use()` → 渲染 TypeError → 侧边栏空白。修复：uSES 桥 `useSyncExternalStore(scope.subscribe, () => scope.getSnapshot())` 读 `snap.value`。
3. **隐藏坑：pnpm 目录源=软链**——用户「重启后还是不行」→ 要求重装。实测 `add 目录` / `add file:目录` 装出来都是软链；`.tgz` 才是实体。重装为实体后正常。

**最终修复 = 客户端重构（Controller + hooks + 独立 section 页）**：
- client.js 换用 v1 验证过的实现：`GitPushCardController`（scope 订阅 → `store.createSnapshotStore(project())` → publish）+ `inject()` 返回 `{ hooks: { gitPushCard: store }, edit/toggle/save... }`（槽系统把 store 转成 `useGitPushCard` hook 注入卡片）
- `settings.section` 用**独立 `GitPushSectionPage`**（平铺 UI：登录只读 + 高级设置即时保存），不复用折叠卡（复用是反模式）
- `settings.plugin.item`：`key: SETTINGS_NS`（'git-push'）+ `inject: () => card.inject()`
- Host Config 合并 v1 全量字段（githubToken/sshPub/injectFullSkill/hardcodeFullScan/injectRepoIndexFull/customIgnorePatterns/yamlCheckMode/auditRuleWeights/qualityWeights/ruleSlotMeta）+ 保留 v2 特有字段
- 双语设计取消：去 en 表 + locale 依赖，只留中文
- 测试适配 v1 结构（jsx-runtime 断言反转、Controller 默认值、槽系统 hooks 模拟渲染）；fallback schema 补 dict/any

**验证**：`npm test` 430 全绿；真实 React 元素树卡片+section 均构建成功；GUI 实测设置侧边栏出现「Git 提交推送」。

### 7.3 客户端 UI 三选项卡重写（2026-09-12）

**用户决策**：删设置配置卡（`settings.plugin.item`），只保留侧边栏独立页（`settings.section`），页面重写为**三个大选项卡**（对齐插件市场 .tabs/.tab/.on，参考 skill 记分板）：

1. **账号信息**（纯展示）：`GET /api/git-push/account-check` → GitHub 登录态/用户名/公钥指纹/套餐，`block` 文本直接展示。
2. **审计**：① 审计开关（`auditEnabled`，settingsScope.set 即时保存）② 审计权重 10 维度（可读性/可维护性/健壮性/安全性/性能/测试覆盖/可观测性/可部署性/文档/开发者体验，默认合计 100；改即写 `weightOverrides` JSON）③ 规则包列表（`GET /api/git-push/rule-slots` 动态发现；↑↓ 调次序写 `auditRuleOrder`（下覆盖上）；单击展开 → `GET /api/git-push/rule-detail?slot=<名>` 显示拦截/警告/通过数量统计 + 规则表格（规则名/简介/级别/作者））。
3. **设置**：GitHub token（写 `githubToken`）+ SSH 公钥（写 `sshPub`）+ 邮箱 + 一键生成（`POST /api/git-push/gen-ssh-key`，公钥填入 SSH 框并复制剪贴板）。

**配套后端**：
- `GET /api/git-push/rule-slots`：meta 增加 `author`（读 yml metadata）。
- `GET /api/git-push/rule-detail?slot=<名>`：读单个 `audit-rules-<名>.yml` 的 rules 数组 → `{ meta, stats: { blocker, warning, pass, total }, rules: [{ id, name, category, severity, description, author }] }`。拦截=blocker|error，警告=warning，通过=其余（含无 severity）。

**结构要点**：
- 纯中文：删 zh/en 键值对字典，文案硬编码中文（产品设计）。
- 只注册 `settings.section`；`settings.plugin.item` 已删除（`clientModuleInfo().slots` 同步为 `['settings.section']`）。
- Controller 命名 `dshgp_*` 前缀防 combo 撞名；组件 `dshgp_AccountTab` / `dshgp_AuditTab` / `dshgp_SettingsTab` + `dshgp_GitPushPage` 装配。
- 文件顶层零声明 + `load` 顶部（client-modules 聚合 bundle 兼容），详见 7.2 形态铁律。
- 测试适配：`clientModuleInfo().slots` 断言删 plugin.item；`审计相关开关默认关` 改断言 `this.auditEnabled = false`；CSS 变量名 `dshgp_css`。

**验证**：`npm test` 430 全绿；combo 拼接解析通过；apply 只注册 section（plugin.item=0）。

## 八、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 设置了侧边栏没有「Git 提交推送」 | ① `--dump-config` 确认插件节点 enabled: true；② client.js 不得调用 `scope.use()`（官方 SettingsScope 无此方法，渲染 TypeError 致空白）；③ Host 必须 `settings.register('git-push', Config)`（配置卡=交集）；见 7.2 |
| 规则改了不生效 | 槽位是动态发现，确认 yml 文件名是 `audit-rules-<名>.yml` 且放在 `lib/audit-rules/` |
| 新规则被更宽的规则抢走 | 注册表**有序匹配**，宽泛的 detect（如 `regex`）要排在专用 detect 之后，或把 detect 条件写精确 |
| 审计报「0 blocker 0 warning 但 total > 0」 | error 级问题也计入拦截级；看 findings 的 severity 字段 |
| 豁免写了没用 | 标记必须在前 3 行（整文件豁免）或写在**命中那一行**（行级豁免） |
| 链接检查报错 | 链接问题只 warning 不拦截；flaky 域名（github 等）网络错误扣分 ×0.2 |
