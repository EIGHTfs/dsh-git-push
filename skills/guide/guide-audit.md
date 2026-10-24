---
name: guide-audit
description: dsh-git-push 代码审计：三个入口、审计范围、10 维度评分、规则包槽位、豁免机制、严重级与报告聚合，以及低成本整改（提取公共函数一次动作多规则清零）。处理代码审计/质量评分/整改提分类请求时加载。
whenToUse: 要审计仓库、看质量分与问题明细、加停审计规则、豁免误报、查审计 API 时；要把审计分从 B 提到 A、低成本消 warning、规划重构整改时。
updated: 2026-10-18
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

### 13. 低成本整改：提取公共函数 = 一次动作多规则清零

**先看计分口径（决定性价比）**

| 口径 | 事实 | 含义 |
|---|---|---|
| 计数去重 | warning/info 按「规则 × 维度 × 文件」每文件每规则只计 1 次（blocker 每次计 2） | 同一文件同类问题修**一个代表点**，该文件对该规则的扣分即清零；warning 列表条数不受去重影响（想清空列表要逐条修或逐条豁免） |
| scoreImpact | `0` 的 finding 不计分（魔数、嵌套深度、重复字面量、低风险 io-risk 等） | 冲分先修 `scoreImpact=1` 的规则；`0` 的只影响 warning 条数 |
| 豁免等价 | 豁免标记会让 finding 直接消失、不计数 | 「修代码」与「加豁免」在**计分上等价**；区别只在代码质量本身与列表展示 |
| 对数衰减 | 单维度 `max(0.1, 10 - k·ln(1+问题数))`（k：安全 1.5 / 可读·可维护·健壮 1.3 / 性能 1.1） | 计数从 20 降到 10 的收益远大于 10 降到 0；先处理计数高的维度 |

**为什么提取公共函数最划算**

函数太长 / 嵌套太深 / 圈复杂度高 / 重复调用 / 重复代码，根因都是「没抽出公共函数」。抽一次，多条规则同时消失：

| 规则 | 覆盖方式 |
|---|---|
| max-cyclomatic-complexity、max-nesting-depth、max-function-length | 直接：拆成子函数 + 早返回 |
| repeat-identical-call | 直接：重复调用合并进一个 helper |
| vague-function-name、variable-min-length、vague-variable-name | 顺带：提取时给函数/参数/局部变量起具名；契约要求导出名不变时用 `export { 具名实现 as run }`（模块仍只导出约定名） |
| magic-number-smart、duplicate-constant-def、no-repeated-hardcoded-literals | 顺带：提取时把字面量提成命名常量 |
| mkdir-before-write | 顺带：写操作移进公共函数后，写目标来自形参 ⇒ 规则语义豁免 |
| comment/no-date、hardcoded-absolute-path、io-risk、memory-bomb | **不覆盖**：需单独处理（删日期 / 提候选常量+行级豁免 / 异步化或行级豁免 / 接受） |

实测（一次全量整改，29 文件）：评分 83.0/B → 97.9/A，warning 99 → 5；其中「提取函数 + 顺带命名/常量化」覆盖约 55/99 条，其余 44 条是注释/路径/IO/内存类。

**危险级不高的前提（照做才安全）**

1. 只搬运结构、不改行为：判断、异常、短路 return、错误处理边界保持原样。
2. 三类**不拆、改豁免**：
   - 跨回调共享闭包状态（如子进程 stdout/stderr/error/close/超时五路共享 settled 标志）；
   - 字符级扫描器（字符串/注释/括号三态一次遍历，拆开反而割裂状态机）；
   - 单调用点且拆完没有更清楚（过度抽象）。
3. 同步改异步会外溢：io-risk 真修成 async 会波及整条同步调用链（CLI/测试），多数场景行级 `dsh-skip-residue` 更划算。
4. 拆完必须复跑审计：新函数名/变量名可能触发新规则（实测：`handleXxxCommand` 被 io-risk 判成「请求处理路径」，把整文件同步 IO 从 low 升到 medium/high；局部变量取通用词名（如 result）会触发 vague-variable-name）。改名（如 `dispatchXxxCommand` / `actionResult`）后恢复。
5. 验证闭环：`node --test` + 重新全量审计，确认分数只升不降、无新 blocker。

**操作顺序**：`groupBy=rule` 看明细 → 按「文件 × 规则」挑代表点 → 提取函数/常量/改名 → 复跑审计 → 只剩 `scoreImpact=1` 的顽固项时才逐条修或逐条豁免。

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

## 14. 按插件架构修订规则，且按性价比取舍误报

规则不是通用前端 linter：它主要服务于 **DSH 插件**这种架构，判定要贴合插件真实形态，
否则「按通用项目写的判据」在插件上系统性失真。

**已按插件架构落地的适配**

| 插件架构事实 | 通用判据为何失真 | 规则怎么改 |
|---|---|---|
| 客户端是**构建产物**（`dsh.client` 指向单文件） | 产物行数天然超阈值 | `dsh-client-entry` 作用域降级为 info（仍报不扣分，不用 exempt 藏掉事实） |
| 源码按**分片**维护（`lib/client-parts/**` → 拼接） | 分片是片段，单文件语法都不成立；创建元素与绑定事件可能在不同分片 | 标准 `client-parts/` 由 exclude_dirs 跳过且规模规则按 `dsh-client-fragment` 降级；自定义分片目录由 button-bind 降级 info（完整判定交给产物） |
| 插件 UI 常用**事件委托** + 原生触发（label.click() 开文件框） | 只认 `addEventListener('click')` ⇒ 表单控件/文件框全被判未绑 | 按元素类型分流：button 要 click 类；input 接受 change/input/submit 等；`type=file` 有程序化触发即视为原生接好 |
| 测试聚合文件（每条 `rec(...)` 一个用例） | 「文件长」被判臃肿，且只认 `function` ⇒ 箭头用例全部计 0 行 | 识别箭头/方法简写/asynс 体；最大函数≤阈值 → 聚合型 info；无函数时文案改成「顶层语句堆叠」而不是「藏着超大函数」 |

**性价比取舍（不追求零误报）**

先算「修判定的成本 vs 这类误报的出现频率与危害」，再决定：

- **值得修**：判定明确、可静态判定、且形态高频——如上面四类（事件类型、函数形态、产物/分片、聚合型文案）。
  这类修一次，整类消失。
- **不值得修（用豁免兜底）**：需要数据流/跨文件调用图才能证伪的判定——例如「事件委托是否真的覆盖某个
  `createElement` 出来的按钮」、跨文件（非分片）绑定、运行时动态注入。做精确分析的成本远超收益，
  保留启发式判定 + `dsh-skip-quality` 文件头豁免。
- **不算误报**：规则判对了事实、只是不想改（如自包含 151 行组件、静态自检页的装饰按钮）——
  走豁免，不要改判定逻辑（否则会连带放过真问题）。

**豁免的前提**：标记必须**真能生效**。历史上多次出现「规则 exemptHint 写着 `dsh-skip-quality`，
但该 kind 不在任何标记的 blocked 里」⇒ 用户按提示写了完全不生效（button-bind 就是 2026-10-24 补上的）。
新增 kind 时同步检查 `exemptHintForFinding({kind})` 是否返回标记。

**判定引用范围时 grep 要 `-i`**：同一概念会以 `camelCase`/`PascalCase`/`SCREAMING_CASE`/`snake_case`
多种形态出现，小写搜会漏（实测：搜 `partFilter` 漏掉 `setPartFilter`，误判「零引用」而删掉底层实现）。
注意这只针对「人工核查引用」；规则内部的**标识符匹配必须保持大小写敏感**（JS/Python 本身区分大小写，
放宽只会引入新误报）。
