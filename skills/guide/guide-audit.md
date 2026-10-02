---
name: guide-audit
description: dsh-git-push 代码审计：三个入口、审计范围、10 维度评分、规则包槽位、豁免机制、严重级与报告聚合。处理代码审计/质量评分类请求时加载。
whenToUse: 要审计仓库、看质量分与问题明细、加停审计规则、豁免误报、查审计 API 时。
updated: 2026-10-02
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-10-02
---

# 代码审计（guide-audit）

> 三条入口（工具 / HTTP API / CLI）跑同一套「静态初筛 + AST 语义审计」，输出 10 维度质量分与问题明细。

## 一、规则（场景 → 必须做的）

| 场景 | 必须做的 |
|---|---|
| 要审计一个仓库 | 会话内用工具 `code_audit`；只看聚合明细用 HTTP `/api/git-push/audit`；脱离 DSH 用 `git-sluice audit` |
| 判断能否提交 | 门禁只认 `blocker`，命中即拦；`warning` / `notice` 只提示不拦 |
| 遇到误报 | 先按判定类型选已有豁免机制；结构性误报优先修审计判定，不靠注释掩盖 |
| 新增 / 停用规则 | 只改规则 yml（放文件即生效、删文件即移除），不改代码 |
| 私有仓库 | 远端可见性 `private` 时审计只报告不拦截；`public` / `unknown` 保守拦截 |

## 二、怎么做 / 命令 / 实例

### 1. 三个入口（同一套引擎，结果一致）

| 入口 | 调用方式 | 特点 |
|---|---|---|
| 工具 | `code_audit` | 默认精简输出（评分 / 各级数量 / 豁免统计 / API 指引）；`includeFindings=true` 出全量 |
| HTTP | `GET/POST /api/git-push/audit` | 请求时聚合：分组 / 严重级过滤 / 条数截断；默认全量范围 |
| CLI | `git-sluice audit <目录>` | 独立运行（零第三方依赖，Node ≥18 + 本机 git），`--json` 出全量 |

### 2. 工具 `code_audit` 参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `repo` | string | ✅ | 仓库根目录 |
| `scope` | string | — | `full`（全量）/ `diff`（变动范围）；不传按变动范围；非 git 目录自动全量 |
| `rulesetDir` | string | — | 自定规则目录 |
| `includeIgnored` | boolean | — | 连 `.gitignore` 忽略的文件也扫 |
| `includeFindings` | boolean | — | `true` 追加全量 `findings` 与 `yaml` |
| `history` | boolean | — | 历史提交审计（逐提交快照全量审计并落盘报告） |
| `since` / `until` / `outDir` | string | — | history 起止提交（皆缺省 = 全部历史，含两端）/ 报告目录（缺省 `<仓库>/audit-history/`） |

返回字段：`ok`、`scope`、`files`、`summary{blocker,warning,notice,total}`、`quality{score,level}`、`exemptStats{types,total}`、`blocked[]`（blocker 明细）、`groupByTypes`、`slotStats`、`apiGuide`；`includeFindings=true` 追加 `findings` + `yaml`。
`history=true` 返回 `async:true` + `jobId`（宿主后台 job，完成自动回传）或 `result`（无 job 控制器时同步降级）。

### 3. HTTP 审计 API

`GET/POST /api/git-push/audit`（参数放 query 或 JSON body，body 覆盖 query）。

| 参数 | 默认 | 说明 |
|---|---|---|
| `repo` | 配置的默认扫描根 | 缺省且推断不出 → 400 `REPO_REQUIRED` |
| `scope` | `full` | `full` / `diff` |
| `groupBy` | `rule` | 聚合维度：`rule` / `file` / `severity` / `slot`（非法值回落 `rule`） |
| `severity` | 不过滤 | 逗号白名单，如 `blocker,warning` |
| `top` | `0` | 每组最多列前 N 条，`0` = 全部 |
| `withFindings` / `withYaml` | `false` | `true` 时附全量 `findings` / `yaml` 报告 |
| `includeIgnored` / `rulesetDir` / `maxScanFiles` / `weights` | — | 同工具 / CLI 语义（`includeIgnored` 连忽略文件也扫、`weights` 覆盖权重） |

返回：`ok`、`repo`、`scope`、`files`、`summary`、`quality{score,level}`、`groups[]`（按条数降序，每组含一条 `sample`）、`total`、`filtered`、`exemptStats`、`groupByTypes`、`blocked[]`。

### 4. CLI（`git-sluice audit`）

```bash
git-sluice audit .                            # 变动范围（非 git 目录自动全量）
git-sluice audit . --full                     # 全量
git-sluice audit . --ruleset <规则目录>        # 自定规则目录
git-sluice audit . --weights '{"安全性":25}'   # 权重覆盖 JSON
git-sluice audit . --include-ignored          # 连 .gitignore 忽略的文件也扫
git-sluice audit . --json                     # 全量 findings + yaml
git-sluice audit . --history --since <提交> --until <提交> --out <目录>
```

CLI 读与插件同一份配置（`$DSH_HOME/git-push/config.json`）；权重优先级：显式 `--weights` > 配置 `weightOverrides` > 默认权重表。CLI 与插件用同一实现、同一配置，同一仓库同一参数结果一致。

### 5. 审计范围（full / changed / diff）

| 叫法 | 含义 |
|---|---|
| `full` | 全量扫描（非 git 目录也能查） |
| `diff` / `changed` | 变动范围（未提交改动）；`diff` 是入口写法，内部 scope 记为 `changed`，同一实现 |

默认范围：提交前自动审计取配置 `auditScanScope`（默认 `diff`）；工具不传 `scope` 按变动范围；HTTP 不传按 `full`；CLI 默认变动范围。每次审计都跑完整流程（静态初筛 + AST 语义检查），没有可调强度档位。

### 6. 规则包与槽位

- 规则目录里每个 `audit-rules-<名>.yml` = 一个槽位：放文件即生效、删文件即移除；yml 顶层 `disabled: true` = 整槽位默认不加载，`template` 槽位默认不加载。
- `nodejs` / `private` 是安全红线强制槽位，不可禁用。
- 启停方式：侧边栏「审计」选项卡规则包开关；HTTP `POST /api/git-push/toggle-rule`（body `{slot, disabled}`）；脚本 `node scripts/rule-switch.mjs list|status|disable|enable <槽位>`（默认改安装版本，`--workspace` 指工作区，`--target <目录>` 任意指定）。
- 规则装载每次审计实时读 yml，改完立即生效、无需重启实例；规则可声明 `astConfirmKind`：正则初筛拿候选行 → AST 语义确认，减少误报。

### 7. 10 维度质量评分

| 维度 | 可读性 | 可维护性 | 健壮性 | 安全性 | 性能 | 测试覆盖 | 可观测性 | 可部署性 | 文档 | 开发者体验 |
|---|---|---|---|---|---|---|---|---|---|---|
| 默认权重 | 15 | 15 | 15 | 18 | 10 | 10 | 5 | 5 | 4 | 3 |

- 单维度：`max(0.1, 10 - k×ln(1+问题数))`，k 按维度分级（安全性衰减最快），下限 0.1 防零分塌陷。
- 总分：`Σ(维度分×权重)/Σ权重×10`，保留一位小数；等级 A ≥ 85、B ≥ 70、C ≥ 55、D ≥ 40，其余 E。
- 权重可调：侧边栏 `weightOverrides`（JSON）/ HTTP `weights` / CLI `--weights`；`scoreImpact: 0` 的纯提醒不计入评分，0 文件不评分。

### 8. 严重级（severity）与评分影响

| severity | 含义 | 门禁行为 |
|---|---|---|
| `blocker` | 拦截级（`error` 归一为 blocker） | 拦截提交；private 仓库只报告不拦 |
| `warning` | 警告级 | 只提示 |
| `notice` | 提示级（`info` 归一为 notice） | 只提示 |

`scoreImpact` = 单条问题对评分的影响：`0` 纯提醒不扣分、`1` 常规、`2` 高危（如 blocker 凭据类）；`summary` 汇总为 `{blocker, warning, notice, total}`。

### 9. 豁免机制

| 机制 | 位置 / 写法 | 效果 |
|---|---|---|
| `.auditignore` | 仓库根，gitignore 语法 | 仓库级：声明不审计但照常入库；与 `.gitignore` 独立叠加；非 git 目录同样生效；`!` 前缀恢复 |
| `dsh-skip-*` 文件头注释 | 前 3 行内注释 | 整文件豁免对应拦截类型 |
| `dsh-skip-*` 行尾注释 | 对应行 / 函数定义行 | 单点豁免（仅 `sensitive` / `residue` / `func-length` / `complexity` / `i18n` 支持行级） |
| `.test` / `.samples` 空文件 | 目录内放 0 字节标记文件 | `.test` = 该目录（含子目录）整棵跳过扫描、不出任何结果；`.samples` = 照常出结果但不拦截（示例目录豁免） |
| 路径类别 | `test/`、`scripts/`、`cli.mjs` | 残留 / console / 同步 fs / 空 catch 等自动豁免 |
| 私有库 / 技能文档 | 远端 `private`；`skills/`、`rules/` 下 md | private 时私密文件与拦截降级为只报告；文档里的沟通措辞不触发沟通词规则 |

标记清单：`dsh-skip-sensitive`（凭据/私密）、`dsh-skip-size`（大文件/二进制）、`dsh-skip-func-length`（函数超长）、`dsh-skip-complexity`（圈复杂度/嵌套）、`dsh-skip-syntax`（语法 / JSON / YAML 解析）、`dsh-skip-quality`（质量评分类）、`dsh-skip-residue`（debugger / todo / console）、`dsh-skip-style`（数值风格）、`dsh-skip-i18n`（硬编码文案）。

```js
// dsh-skip-sensitive: 文件含 mock 凭据字面量（占位示例，非真实凭据）
console.log(x); // dsh-skip-residue: 本行为刻意保留的调试输出样本
```

`secret-*` / `cred*` / `security/*` 类规则即使标 `disabled` 也强制加载——安全红线不可豁免。

### 10. 链接检查（link_check）

工具 `link_check`（`path` = 文件或目录，默认工作区）、CLI `git-sluice link-check <路径>`、斜杠命令 `/link-check [文件或目录]`。扫描 md / 文本内 URL 并访问验证：404 / 403 / 410 / 451 → 扣 3，DNS 失败 → 扣 2，超时 / 连接失败 / 5xx → 扣 1；只 warning，永不 blocker。配置 `linkCheckEnabled` 默认关（需要网络）。

### 11. 文档漂移检查（函数列表 / 目录树 / 版本表）

`node scripts/doc-func.mjs check`（函数列表）、`node scripts/doc-tree.mjs check`（目录树）、`node scripts/doc-version.mjs check`（版本表）分别比对宿主 md 标记块与最新内容并报漂移。三个脚本都有 `gen`（只打印）/ `apply`（覆盖标记块）/ `check`（报漂移）；函数列表由 AST 真实扫描生成，避免手工维护漂移。

### 12. 报告聚合与 YAML 输出

- `groupBy` 四维度：`rule`（规则类型，默认）/ `file` / `severity` / `slot`（规则包）；`groups` 按条数降序，每组带一条 `sample`；`severity` 白名单过滤 + `top` 截断（`0` = 全部），过滤后条数见 `filtered`。
- `exemptStats` 输出本次被豁免的类型与数量；`blocked` 直接列出 blocker 明细（文件 / 行 / 规则 / 消息）；YAML 报告：HTTP `withYaml=true` → `yaml` 字段，工具 `includeFindings=true` 时含 `yaml`。

## 三、边界与坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 结果里出现 `audit/scan-truncated` | 文件数超 `maxScanFiles`（默认 3000，`0` = 不限） | 调大上限或设 0；截断会优先纳入变动文件，该条 `scoreImpact: 0` 不扣分 |
| `quality` 为 null | 0 文件（空目录 / 0 变动） | 属正常「未评分」，不是满分 |
| 分数与预期差很多 | 权重被 `weightOverrides` 覆盖 | 核对侧边栏权重 / `weights` / `--weights` 三处来源 |
| 改了规则包不生效 | 改的是工作区文件，GUI 实际读安装版本 | 用 `scripts/rule-switch.mjs`（默认安装版本）或 `--workspace` 明确目标 |
| 想靠豁免消掉误报 | 豁免是逃生门，不是修误报 | 判定类误报修 AST 精筛；豁免只用于刻意样本 |
| 私有库被大量拦截 | 可见性探测失败按 `unknown` 保守拦截 | 确认 `origin` 指向；`private` 才只报告 |
| `.auditignore` 不生效 | 写法不是 gitignore 语义 | 用 gitignore 语法；`*.sh` 匹配任意层级，只根目录用 `/*.sh` |
| 自定规则目录参数名三端不同 | CLI 用 `--ruleset`，HTTP 用 `rulesetDir`，工具用法提示写作 `ruleset` | 以 CLI / HTTP 为准 |

## 四、配套 skill

| skill | 用途 |
|---|---|
| skills/guide/guide-commit-push.md | 提交前审计门禁、拦截与放行字段、私有库豁免 |
| skills/guide/guide-cli-scripts.md | 独立 CLI 与脚本（含 `git-sluice`、`rule-switch`） |
| skills/guide/guide-slash-completion.md | 输入框斜杠命令（`/git-audit`、`/link-check`） |
| skills/guide/guide-clone-repos.md | 克隆仓库与本地仓库扫描 |
