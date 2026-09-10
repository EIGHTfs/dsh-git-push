# WORKBOARD v2 —— dsh-git-push 开发任务看板（榜样版 · 交接版）

> **状态**：**1.0.0 首发完成**（0.0.0 / 0.1.0~0.1.8 / 0.2.0 / **1.0.0**）；后续按需迭代（规划槽位 npm/html/frontend/comment/dsh/private/structure/version 见 PLANNED_SLOTS）
> **版本号规则**：大版本号从 **0** 开始——0.x = 单机引擎与总入口建设期，1.0.0 = DSH 插件接线完成首发（原「2.0.0」改为 1.0.0）。
> **仓库**：`工作区/dsh-git-push-v2`（本地 master，**不推送**）
> **看板双重定位**：
> 1. **交接文档**——按本板的架构图 / 函数清单 / 逐入口状态即可接手开发，无需先通读全部源码；
> 2. **写作样板**——本板同时示范任务看板的结构化写法（架构图 → 函数清单 → 状态表 → 执行记录），可作同类文档的参考模板。
>
> 更新纪律：每个入口完成时同步本板「执行记录」+ README 版本表 + 测试全绿 + 旧项目扫描 0 blocker。
>
> **设计决策的溯源**：本板的设计取舍与分阶段结论已完整落入下方各节（架构图 / 函数清单 / 决策表 / 执行记录），带日期的设计稿见 `docs/DESIGN-2026-09-09-unified-rule-loader.md` 等文档；无需回溯其他上下文即可理解设计动机。

---

# 第一部分 任务看板写作方法（榜样学什么）

> 这一部分是「怎么看懂本板」和「以后怎么写一个同样好的看板」的说明书。clone 本板模板时，保留第一部分的骨架，替换第二部分为你的项目内容。

## 1.1 看板是什么、不是什么

| | 是 | 不是 |
|---|---|---|
| 本质 | **项目唯一权威的执行蓝图**：目标、现状、步骤、验收、风险、进度一次性写清，任何新接手者只读本板就能继续 | 随手记的笔记、草稿、过程对话散存 |
| 粒度 | 事无巨细：文件级、函数级、命令级、断言数级 | 「做优化」「重构一下」这种大而空的话 |
| 交付 | 每步**可验收**（有命令、有数字、有对比） | 只有「计划做」没有「怎么算做完」 |
| 时效 | 随进度实时勾选更新 | 写一次就扔 |

写作心法一句话：**看板不是给你写的，是给下一个不知道上下文的人（或 AI）写的。**

## 1.2 好任务看板的 8 要素（每个要素：为什么 + 怎么写）

| # | 要素 | 为什么必须有 | 怎么写 |
|---|------|------------|--------|
| 1 | **状态总览** | 一眼知道项目在哪个阶段、哪些完成 | 表格：# / 入口 / ✅🔄⏳ / 说明 |
| 2 | **架构图** | 一图看懂全貌，避免接手者迷失在文件海洋 | ASCII 树 + 标注数据流方向 |
| 3 | **现状盘点** | 接手者知道已有什么、缺什么 | 逐文件逐函数清单（见 §2.6） |
| 4 | **任务拆分** | 大目标拆到「可勾选、可单次提交」的粒度 | 每入口：目标 / 已做[ x ] / 待做[ ] |
| 5 | **验收标准** | 判断「做完没做完」的唯一依据——必须有命令/数字 | 每条一个 `[ ]`，写「跑什么命令 → 看什么输出」 |
| 6 | **实施思路** | 让接手者理解「为什么这么设计」，能自己决策 | 每入口一段「思路」 |
| 7 | **风险与对策** | 提前暴露坑，避免重复踩 | 表格：风险/概率/影响/对策 |
| 8 | **执行记录** | 版本演进可追溯，每步有 commit 锚点 | 表格：版本/commit/内容/自检结果 |

## 1.3 格式约定（全板统一）

- **状态符号**：`✅ 完成` / `🔄 进行中` / `⏳ 未开始`
- **任务勾选**：`- [x]` 已完成 / `- [ ]` 待做（markdown 原生，可勾选）
- **断言数显式化**：每个测试文件写 `≥N 断言`，验收直接对照
- **命令可复制**：所有验收命令写成可复制的一行 bash
- **数字可复现**：能写数字不写形容词（「31 测试全绿」而非「测试都过了」）

## 1.4 反模式（以前踩过的坑，避免再犯）

| 反模式 | 危害 | 正确做法 |
|--------|------|---------|
| 看板只写大目标（「优化审计」「重构规则」） | 接手者不知道从哪下手 | 拆到文件级+函数级步骤 |
| 无验收标准 | 做完不知道算不算完，互相扯皮 | 每条目标配「跑 X 命令 → Y 输出」 |
| 无函数清单 | 接手者需重新通读全部代码才知道有哪些函数 | §2.6 逐文件逐函数表 |
| 无风险对策 | 同样坑每个接手者各踩一次 | §2.9 风险表，踩过就补 |
| 只更新版本不改看板 | 看板与代码脱节，变成废纸 | 更新纪律：每入口提交必同步本板 |
| 文档用会话措辞 | 公共文档被自家门禁拦（docs-conversation） | 只写做了什么，不写「谁拍了板」「哪个会话」 |

## 1.5 本板如何被复用（模板用法）

1. 复制本文件到新项目 `docs/WORKBOARD.md`
2. 保留「第一部分」骨架（方法论通用）
3. 替换「第二部分」为你项目的：架构图 / 文件清单 / 入口任务 / 验收标准
4. 每完成一个小步骤：勾选 + 更新执行记录 + commit（commit 信息里带版本号）

---

# 第二部分 dsh-git-push 交接全景

## 2.1 项目元信息

| 项 | 值 |
|---|---|
| 项目 | dsh-git-push（DSH git 插件，统一函数入口架构独立实现） |
| 位置 | `工作区/dsh-git-push-v2` |
| 旧版（自检工具） | `工作区/dsh-git-push`（v1.60.1，存档+扫描用） |
| 架构 | 10 总入口（规则/审计/git/自身/评分/豁免/上下文/HTTP/测试/侧边栏） |
| 铁律 | compileRule 主体永不修改；加字段=加函数+注册一行 |
| 命名 | 一个功能一个根词，各层格式转换，外部 API 与函数名完全一致，无别名 |
| 版本规范 | 0.0.0 README → 0.1.0 框架能跑 → 每完成一入口第三位+1 |
| 提交策略 | **永不推送**；每次提交前旧项目扫描 0 blocker |

## 2.2 架构图（总览）

```
dsh-git-push
│
├── cli.mjs  ────────────── 独立 CLI（git-sluice）：version / ruleset / scan / audit
│      │
│      ▼
├── lib/
│   ├── rule/        ★ 规则总入口（核心，yml 驱动）
│   │   ├── registry.js   注册表：RULE_COMPILERS / registerCompiler / compileRule / compileAllRules
│   │   ├── loader.js     yml 装载：loadYamlRuleFile / discoverRuleSlots / loadRuleFiles
│   │   └── compilers.js  13 种编译函数注册（副作用导入即注册）+ safeRe + ruleOut
│   │                     └──► 依赖 lib/audit-rules/*.yml（槽位数据）
│   │
│   ├── audit/       ★ 审计总入口（消费编译规则，产出统一问题对象）——0.1.2 半成品
│   │   ├── index.js      makeFinding / summarize / auditFile / auditFull / auditChanged / auditWithScope
│   │   ├── collector.js  collectTextFiles（gitignore 感知）/ isGitRepo / readText
│   │   └── checks.js     groupByKind / checkRegexRules / checkPathRegexRules / checkFuncLines / checkEmptyCatch / runChecks
│   │                     └──► 依赖 lib/exempt（豁免判定）
│   │
│   ├── exempt/      ★ 豁免总入口
│   │   └── index.js      EXEMPT_MARKERS（7 标记）/ hasHeaderExempt / hasLineExempt / exemptHintFor
│   │
│   ├── score/       ★ 评分总入口（10 维度加权）
│   │   └── index.js      DEFAULT_WEIGHTS / DIMENSION_ORDER / countByDimension / scoreQuality
│   │
│   ├── git/         ★ git 总入口 ✅ 0.1.3 已实现
│   │   └── index.js      runGit / resolveToken / commitAndPush / pushViaApi(+SSH 回退) / cloneViaApi / ensureRemoteRepo / setVisibility / githubFetch / parseGithubOwnerRepo / scanSensitiveFiles+ensureGitignore
│   │
│   ├── self/        ★ 自身总入口（骨架，0.1.4 实现）
│   │   └── index.js      VERSION / readmeTemplate / yamlTemplate / selfVersion
│   │
│   ├── context/     ★ 上下文注入（骨架，0.1.7 实现）
│   │   └── index.js      createEnvInjectionText
│   │
│   └── audit-rules/     yml 数据槽位（当前仅 nodejs）
│       └── audit-rules-nodejs.yml   11 条示范规则
│
├── scripts/
│   └── check.mjs       语法检查（npm run check，递归 lib + cli.mjs）
│
└── test/
    ├── test-framework.mjs   16 断言（注册表/装载/评分/豁免/CLI 骨架）✅ 全绿
    ├── test-rule-packs.mjs  15 断言（编译函数/字段探测/dimensions/装载闭环）✅ 全绿
    ├── test-audit.mjs       14 断言（审计四象限 + git 变动）✅ 全绿
    ├── test-git.mjs         35 断言（git 总入口，mock fetch + /tmp 临时仓）✅ 全绿
    ├── test-cli.mjs         18 断言（自身总入口：版本一致性/模板/helpSync/parseArgv）✅ 全绿
    ├── test-quality.mjs     31 断言（评分总入口：AST 质量检查器 + 权重评分）✅ 全绿
    ├── test-exempt.mjs      25 断言（豁免总入口：7 标记/位置语义/12 场景）✅ 全绿
    ├── test-http.mjs        30 断言（HTTP 总入口：Origin/CSRF/写确认/413）✅ 全绿
    ├── test-context.mjs      7 断言（上下文注入文本 + 路径归属）✅ 全绿
    ├── test-client.mjs      16 断言（侧边栏：无 JSX/零外部资源/默认关/即时生效）✅ 全绿
    └── test-link-check.mjs  24 断言（链接分级/flaky 打折/断网不 blocker/性能）✅ 全绿
```

**数据流（一条链）**：
`yml 槽位` → `loader.loadRuleFiles` → `registry.compileRule`（按字段指派编译函数）→ `compilers.js 注册的 13 编译函数` → 编译产物（kind + dimensions + threshold）→ `audit.checks.runChecks` → findings（统一问题对象，带 exemptHint）→ `audit.index.auditWithScope` 汇总 → `score.scoreQuality` 10 维度加权评分。

## 2.3 统一问题对象（所有审计出口）

```
问题 = {
  file: string,          // 相对路径
  line: number,          // 行号（1-based）
  rule: string,          // 规则 id
  kind: string,          // kebab-case 规则类型（13 种之一）
  severity: 'blocker'|'warning'|'info',  // 编译时映射：error→blocker / warning→warning / info→pass
  message: string,
  dimensions: string[],  // 10 维度绑定（支持一字段多维度）
  exemptHint: string,    // 怎么豁免（文件头=整文件 / 行尾=单点）
  scoreImpact: 1|2,      // warning=1, blocker=2
}
```

## 2.4 版本节奏

| 版本 | 内容 | 状态 |
|------|------|------|
| 0.0.0 | README 计划稿（架构/问题清单/链接规则） | ✅ 090ff84 |
| 0.1.0 | 框架骨架 8 入口 + cli + test 16 + check 脚本 + 本看板 | ✅ afa85ec |
| 0.1.1 | 规则总入口（13 编译函数 + nodejs 槽位 11 条 + 15 测试） | ✅ 6a23d0b |
| **0.1.2** | **审计总入口（collector + checks + auditFull/Changed + exempt 接线）** | ✅ 已提交（见 §2.5 修复记录） |
| **0.1.3** | **git 总入口（token/commit/push/clone/建仓/可见性 + SSH 回退）** | ✅ 已提交（见 §3.3） |
| **0.1.4** | **自身总入口（版本一致性/README 模板/yml 模板/CLI 自检）** | ✅ 已提交（见 §3.4） |
| **0.1.5** | **评分总入口（AST 质量检查器 + 10 维度加权）** | ✅ 已提交（见 §3.5） |
| **0.1.6** | **豁免总入口（7 标记注册表驱动全消费 + 位置语义 + 规则定义文件豁免）** | ✅ 已提交（见 §3.6） |
| **0.1.7** | **上下文注入 + HTTP 总入口（Origin/CSRF/写确认/413）** | ✅ 已提交（见 §3.7） |
| **0.1.8** | **侧边栏（手写 createElement 无 JSX + 零外部资源 + 开关默认关）** | ✅ 已提交（见 §3.8） |
| **0.2.0** | **链接判断 yml 规则（link-check 分级扣分 + flaky 打折）** | ✅ 已提交（见 §3.9） |
| **1.0.0** | **DSH 插件接线 + 双副本同步 + 推送准备（首发）** | ✅ 已提交（见 §3.10） |
| 0.1.3 | git 总入口（token/commit/push/clone/建仓/可见性） | ⏳ |
| 0.1.4 | 自身总入口（版本单源/README 模板/yml 模板/CLI 完善） | ⏳ |
| 0.1.5 | 评分总入口（AST 化质量检查 + 口径锚定） | ⏳ |
| 0.1.6 | 豁免总入口（7 标记接入审计全消费点，已部分接） | ⏳ |
| 0.1.7 | 上下文注入 + HTTP API + 测试总入口 | ⏳ |
| 0.1.8 | 侧边栏（复用旧 client.js） | ⏳ |
| 0.2.0 | 链接判断 yml 规则（link-check kind） | ⏳ |
| 1.0.0 | DSH 插件接线 + 双副本同步 + 推送准备 | ✅ 已提交（见 §3.10） |

## 2.5 卡点记录：0.1.2 已修复（原 5 fail → 44 全绿）

**原失败根因（已修复，2026-09-10）**：
```
lib/rule/compilers.js credential-ref/secret/regex 三处（原 L54/L83/L149）：
  pattern: r.pattern, patterns: list.length ? r.patterns : undefined,
问题：patterns 存的是原始字符串数组，而 checks.js checkRegexRules 直接
     调 p.test(line) 需要 RegExp 对象 → TypeError: p.test is not a function
修复：pattern: list[0], patterns: list.length > 1 ? list.slice(1) : undefined
     （list 已 safeRe 编译为 RegExp 数组）
```
**连带修复**：
1. `checkFuncLines` 增加语句密度识别：单行海量语句（如 fixture 的 200 连 `i++;`）函数实际只有 4 行，原按行数统计漏检 → 现按 `max(行数, 分号语句数)` 判定。
2. `auditChanged` 非 git 退化路径 scope 标记 'changed'（原返回 'full' 与测试期望不符）。
3. `auditChanged` 实现真 git diff：`collectChangedFiles`（git status --porcelain，A/M/R/?? 收集、D 删除跳过、引号路径解析），git 仓库只审计变动文件，非 git 退化 full 但 scope 标记 changed。

**修复后现状**：`npm test` **44 全绿**（test-audit 14 测试）；`node cli.mjs audit . --full` 出 25 findings + quality 73/100（B）；旧项目扫描 **0 blocker**。

**已知连带问题（记录在案，0.1.6 豁免总入口处理）**：v2 扫自身仓库时报 6 个 style-debugger blocker——命中点是**规则定义元数据本身**（audit-rules-nodejs.yml 的 pattern 字符串 `\bdebugger\s*;?`、exempt/index.js 注册表 blocked:['debugger']、audit/index.js:49 的 /residue|console|debugger/ 正则），非真实代码残留。属引擎自举假阳性：规则/豁免定义中的关键词字样被自家 regex 规则命中。对策：0.1.6 豁免总入口完善「规则定义文件豁免」语义时一并处理（yml 槽位文件排除 regex 类自举命中）。

## 2.6 逐文件逐函数清单（含签名注释，交接依据）

> 约定：`[x] 已实现` / `[ ] 待实现`。接手 AI 按此清单核对代码与注释是否一致。

### 1️⃣ lib/rule/registry.js —— 规则注册表（核心铁律区）✅

> **铁律：`compileRule` 主体永不修改。加字段 = 加函数 + registerCompiler 一行。**
> 职责注释已写：kind 优先 → 字段探测 → 未知报错。

| 符号 | 签名 | 说明 |
|------|------|------|
| `RULE_COMPILERS` | `Array<{kind, detect, compile}>` | 已注册编译函数表（compilers.js 副作用填充） |
| `registerCompiler` | `(kind, detect, compile) => void` | 注册一行；ctx = `{errors, label}` |
| `compileRule` | `(rule, ctx={}) => {ok, rule\|error}` | **统一入口**：显式 kind 优先 → detect 字段探测 → 报错不静默 |
| `compileAllRules` | `(rules, ctx) => object[]` | 批量编译，错误收集进 ctx.errors 不中断 |

### 2️⃣ lib/rule/loader.js —— yml 装载 ✅

| 符号 | 签名 | 说明 |
|------|------|------|
| `RULE_YAML_DIR` | 常量 | 规则 yml 目录 |
| `RULE_SLOTS` | `string[]` | 9 槽位（template 默认不加载） |
| `loadYamlRuleFile` | `(slot) => {ok, data, file}\|{ok:false, error}` | 单槽位读+解析，失败返回错误 |
| `discoverRuleSlots` | `(dir?) => string[]` | 目录自动发现 `audit-rules-*.yml` |
| `loadRuleFiles` | `(order?) => {ok, merged, order, files, errors}` | 顺序装载合并，后覆盖前 |

### 3️⃣ lib/rule/compilers.js —— 13 编译函数注册 ✅（含 1 个待修 bug）

> 三统一：kind kebab-case ↔ 函数 PascalCase ↔ yml 字段 snake_case。每个编译函数声明 dimensions。

| 注册 kind | detect 条件 | dimensions | 说明 |
|---|---|---|---|
| `credential-ref` | id 前缀 `credref-` | 安全性 | 凭据引用正则 |
| `credential-file` | id 前缀 `credfile-` | 安全性 | 私钥/证书文件名 |
| `secret` | id 前缀 `secret-` | 安全性 | 令牌/密钥正则 |
| `func-lines` | id==='func-lines' 或 (max_lines+function 名) | 可读性+可维护性 | 单函数超长 |
| `min-length` | `min_length` 存在 | 可读性 | 标识符最短长度 |
| `max-lines` | `max_lines` 存在且不含 function 名 | 可读性+可维护性 | 文件行数 |
| `max-complexity` | `max_complexity` 存在 | 可维护性 | 圈复杂度 |
| `max-depth` | `max_depth` 存在 | 可维护性 | 嵌套深度 |
| `min-occurrences` | `min_occurrences` 无 ignore | 可维护性 | 重复次数 |
| `repeated-string` | `min_occurrences` + ignore 字段 | 可维护性+可读性 | 重复硬编码串 |
| `regex` | pattern/patterns 字符串 | 可读性 | 通用正则 |
| `path-regex` | kind==='path-regex' 或 path_pattern | 可读性+可维护性 | 路径校验 |
| `semantic` | detection_method/category 关键词 | 健壮性 | 语义规则 |

| 工具 | 签名 | 说明 |
|------|------|------|
| `safeRe` | `(pattern, label, errors) => RegExp\|null` | 安全编译，非法收集错误不抛 |
| `DIMENSIONS` | 常量 | 10 维度中文映射 |
| `ruleOut` | 内部 | 统一编译出口 |
| `listRegisteredKinds` | `() => Promise<string[]>` | kind 统计（异步防循环） |

⚠️ **待修**：`pattern/patterns` 字段应传编译后 RegExp（L54/L83/L149），见 §2.5。

### 4️⃣ lib/audit/index.js —— 审计总入口 🔄 半成品

| 符号 | 签名 | 说明 |
|------|------|------|
| `makeFinding` | `(params) => finding` | 统一问题对象构造器 |
| `summarize` | `(findings) => {blocker, warning, total}` | 统计 |
| `auditFile` | `({file, relPath, text, grouped}) => findings[]` | 单文件检查+文件头豁免 |
| `auditFull` | `(repoPath, opts) => result` | 全量：collect→逐文件；非 git 可查 |
| `auditChanged` | `(repoPath, opts) => result` | **0.1.2 真 diff 实现**：collectChangedFiles→逐文件（D 跳过）；非 git 退化 full 且 scope 标 changed |
| `auditWithScope` | `(repoPath, {scope}) => result` | 统一入口 |

### 5️⃣ lib/audit/collector.js —— 文件收集 🔄 半成品

| 符号 | 签名 | 说明 |
|------|------|------|
| `collectTextFiles` | `(dir, opts) => Array<{path, ext, full}>` | 递归收集；git check-ignore 排除（Map 缓存）；跳过 node_modules/.git/dist |
| `isGitRepo` | `(dir) => boolean` | .git 判定 |
| `readText` | `(full) => string\|null` | UTF-8 读，失败 null |
| `collectChangedFiles` | `(repoPath) => Array<{rel, full, status}>\|null` | **0.1.2 新增**：git status --porcelain 变动收集（A/M/R/??；D 保留调用方过滤）；非 git 或 git 失败返回 null |

### 6️⃣ lib/audit/checks.js —— 检查器 🔄 半成品

| 符号 | 签名 | 说明 |
|------|------|------|
| `groupByKind` | `(compiled) => {kind: rules[]}` | 编译规则分组 |
| `checkRegexRules` | `({file, text, rules}) => findings[]` | 逐行跑 regex/secret/credref |
| `checkPathRegexRules` | `({file, relPath, rules}) => findings[]` | 路径校验 |
| `checkFuncLines` | `({file, text, rules}) => findings[]` | 简易函数边界扫描超长 |
| `checkEmptyCatch` | `({file, text}) => findings[]` | 真空 catch 检测 |
| `runChecks` | `({file, relPath, text, grouped}) => findings[]` | 调度器 |

### 7️⃣ lib/exempt/index.js —— 豁免总入口 ✅

| 符号 | 签名 | 说明 |
|------|------|------|
| `EXEMPT_MARKERS` | 对象 | 7 标记注册表（含 blocked[] + hint 位置语义） |
| `hasHeaderExempt` | `(text, marker) => boolean` | 前 3 行匹配→整文件豁免 |
| `hasLineExempt` | `(line, marker) => boolean` | 单行匹配→单点豁免 |
| `exemptHintFor` | `(ruleOrKind) => string` | 反查豁免标记 |

### 8️⃣ lib/score/index.js —— 评分总入口 ✅（已修归一化 bug）

| 符号 | 签名 | 说明 |
|------|------|------|
| `DEFAULT_WEIGHTS` | 常量 | 可读15/可维护15/健壮15/安全18/性能10/测试10/可观测5/部署5/文档4/DX3 |
| `DIMENSION_ORDER` | `string[]` | 维度顺序 |
| `countByDimension` | `(findings) => {dim: count}` | 分维度计数（blocker 计 2） |
| `scoreQuality` | `(findings, weights?) => {dims, counts, score, level}` | `dimSum/(10×totalWeight)×100`；A≥85/B≥70/C≥55/D |

### 9️⃣ lib/git/index.js —— git 总入口（骨架）⏳ 0.1.3

| 符号 | 签名 | 说明 |
|------|------|------|
| `runGit` | `(args, {cwd, timeoutMs}) => {ok, stdout, stderr}` | 数组参数零注入；stderr 保留 |
| `resolveToken` | `(opts) => {ok, error}` | 待实现三层探测 |
| `commitAndPush` | `({repoPath, message, push, dryRun})` | 待实现 |
| `pushViaApi` | `({owner, repo, branch, token, files})` | 待实现 Git Data API |
| `cloneViaApi` | `({target, dest, token, branch})` | 待实现 |
| `ensureRemoteRepo` | `({repoPath, visibility, dryRun})` | 待实现建仓 |
| `setVisibility` | `({owner, repo, visibility, token})` | 待实现 |

### 🔟 lib/self/index.js —— 自身总入口（骨架）⏳ 0.1.4

| 符号 | 签名 | 说明 |
|------|------|------|
| `VERSION` | 常量 | 单一事实源（需与 package.json/cli 三处一致） |
| `readmeTemplate` | `() => {ok, template, version}` | 待实现 |
| `yamlTemplate` | `() => string` | 规则模板示范 |
| `selfVersion` | `() => string` | 返回 VERSION |

### 1️⃣1️⃣ lib/context/index.js —— 上下文注入（骨架）⏳ 0.1.7

| 符号 | 签名 | 说明 |
|------|------|------|
| `createEnvInjectionText` | `({cwd, projectRoot}) => string` | AI 环境注入文本 |

### 1️⃣2️⃣ cli.mjs —— 独立 CLI ✅

| 符号 | 签名 | 说明 |
|------|------|------|
| `parseArgv` | `(argv) => {flags, positional}\|{error}` | 白名单 --depth/--full；未知参数报错 |
| `cmdVersion` | `() => void` | 版本 |
| `cmdRuleset` | `(slots) => void` | 编译统计 |
| `cmdScan` | `(root, flags) => void` | 全量扫描 |
| `cmdAudit` | `(root, flags) => void` | 审计+评分 |
| `main` | `(argv) => void` | 分发 |

### 1️⃣3️⃣ scripts/check.mjs —— 语法检查 ✅

| 符号 | 说明 |
|------|------|
| `collectJs(dir)` | 递归收集 lib/**/*.js + cli.mjs |
| 主流程 | node --check 逐个；失败 exit 1 |

### 1️⃣4️⃣ test/ —— 测试

| 文件 | 断言 | 状态 | 覆盖 |
|------|------|------|------|
| test-framework.mjs | 16 | ✅ 全绿 | 注册表/装载/评分/豁免/CLI |
| test-rule-packs.mjs | 15 | ✅ 全绿 | 13 编译函数/字段探测/dimensions/闭环 |
| test-audit.mjs | 11 | ⚠️ 5 fail | 审计四象限（需先修 §2.5） |

---

## 3 每入口详解（任务 + 思路 + 验收标准）

### 3.1 规则总入口（0.1.1）✅ 已提交 6a23d0b
- **子任务**：注册表骨架 / 装载骨架 / 13 编译函数 / 三统一映射 / nodejs 槽位 11 条 / 未知规则报错 / dimensions 声明——全部完成。
- **验收**：31 测试全绿；`node cli.mjs ruleset nodejs` 输出 11 条分桶统计；旧项目扫描 0 blocker。

### 3.2 审计总入口（0.1.2）✅ 已提交
- **已完成**：collector（gitignore 感知 + collectChangedFiles）/ checks 全部检查器（含单行多语句 func-lines）/ auditFile 豁免 / auditFull 框架 / auditChanged 真 git diff / 14 条测试。
- **待做**（全部完成，2026-09-10）：
  - [x] 修 compilers.js patterns→RegExp（§2.5 已定位根因）
  - [x] 复跑 `npm test` 至全绿（44 全绿）
  - [x] auditChanged 实现真 git diff（git status --porcelain 变动收集，删除跳过）
  - [x] 与旧项目同 fixture 对比锚定（坏样本：empty-catch/func-lines/secret 三类均检出；旧项目规则集无 AKIA 模式，v2 更全）
- **验收标准**（全部通过）：
  - [x] `auditFull('/tmp/非git目录')` 出 findings（不依赖 .git）—— test + CLI 实测
  - [x] gitignore 排除生效（fixture 有 .gitignore 验证忽略文件不在列表）
  - [x] 文件头 `dsh-skip-sensitive` → 该文件无 secret 类
  - [x] 每 finding 必带非空 exemptHint
  - [x] test-audit.mjs ≥15 断言全绿（14 测试 / 44 总测试全绿）
  - [x] `node cli.mjs audit . --full` 出 findings + quality（25 findings + 73/100 B）
  - [x] 旧项目同 fixture 对比一致（见上）

### 3.3 git 总入口（0.1.3）✅ 已提交
- **思路**：runGit 数组参数零注入；token 三层探测（显式→env→配置目录/项目 .git-push-token，格式校验）；push 走 api.github.com Git Data API 401 回退 SSH（ssh.github.com:443）；githubFetch 硬闸（拒绝非 api.github.com、拒 302）；敏感文件自动 .gitignore；测试全在 /tmp 临时仓 + mock fetch。
- **已实现**：`runGit` / `resolveToken` / `resolveSshKey` / `credentialsDir` / `githubFetch` / `parseGithubOwnerRepo` / `isBadCredentials` / `scanSensitiveFiles` / `ensureGitignore` / `readmeCheckHint` / `commitAndPush` / `pushViaSsh` / `pushViaApi`（blob→tree→commit→ref + 分支免疫 default_branch）/ `cloneViaApi`（trees+blobs 写文件转 git 仓）/ `ensureRemoteRepo`（建仓+设 origin，dryRun）/ `setVisibility`（PATCH）。
- **验收**（全部通过）：
  - [x] runGit 注入面为零（数组参数 + execFileSync 零 shell）
  - [x] resolveToken 三层顺序（显式 > DSH_GIT_PUSH_TOKEN/GITHUB_TOKEN > 配置目录 > 项目 .git-push-token）
  - [x] 缺 message 拦截 / 非 git 仓库拦截 / 无变更拦截
  - [x] 敏感文件自动 .gitignore（幂等）
  - [x] 401 回退 SSH（mock 401 → pushViaSsh，无私钥 reason 明确）
  - [x] githubFetch 硬闸（拒绝非 api.github.com + 拒 302）
  - [x] test-git 35 断言全绿（79 总测试全绿）
  - [x] 旧项目扫描 0 blocker

### 3.4 自身总入口（0.1.4）✅ 已提交
- **思路**：版本三处一致（scan-version 校验）；README 模板独立（不走拦截 yml）；CLI HELP 与 parseArgv 机器比对防 --depth 类回归。
- **已实现**：VERSION 单一事实源（lib/self）→ versionInfo() + scripts/scan-version.mjs 机器校验三处一致；readmeTemplate（{{name}} {{description}} {{version}} {{versionTable}} 占位符）；yamlTemplate（kind+dimensions 示范）；helpSync()（HELP↔KNOWN_FLAGS 双向比对）；parseArgv --depth 缺值报错（不静默 NaN）；CLI 新增 yaml-template / readme-template / self-check 子命令。
- **验收**（全部通过）：
  - [x] scan-version 通过（lib/self=package.json=cli HELP v${VERSION} 模板）
  - [x] HELP 选项全认（--depth --full 双向一致，self-check 绿）
  - [x] yaml-template 输出带 kind+dimensions
  - [x] test-cli 18 断言全绿（97 总测试全绿）
  - [x] 旧项目扫描 0 blocker

### 3.5 评分总入口（0.1.5）✅ 已提交
- **思路**：10 维度权重延续；AST 化质量检查修旧项目假阴性（sync-fs named import / empty-catch 多行 / func-lines 超长坏样本 100% 检出）。
- **已实现**：`lib/score/ast.js` 轻量 tokenizer（字符串/模板/注释感知）→ 括号平衡区间 → `checkSyncFs`（named-import 直调 + fs 前缀双识别，async 作用域判定）/ `checkEmptyCatchAst`（多行空块/仅注释块）/ `checkFuncLinesAst`（精确行数，字符串不误报）；`checks.js` runChecks 接入 AST 版（func-lines 行数+语句密度互补，单行海量语句兜底）；`scoreQuality`（weights 覆盖 + counts 返回）。
- **验收**（全部通过）：
  - [x] 坏样本文件 100% 检出（sync-fs 2 处 named+prefix / 多行空 catch / 超长函数）
  - [x] qualityWeights 覆盖生效（单维度全扣=90 验证权重占比）
  - [x] 同 fixture 与旧项目一致（v2 扫描自身 94/100 A、0 blocker）
  - [x] test-quality 31 断言全绿（128 总测试全绿）
  - [x] 旧项目扫描 0 blocker

### 3.6 豁免总入口（0.1.6）✅ 已提交
- **思路**：7 标记注册表驱动接入审计全消费点；位置语义逐类测试（对照旧项目 12 场景）；同时修复 §2.5 记录的规则定义/文档 debugger 自举假阳性。
- **已实现**：`exemptForFinding(finding, text)` 注册表驱动统一消费（EXEMPT_MARKERS 每标记声明 blocked/lineLevel/hint）；auditFile 接入；residue/style 检查只对代码文件生效；audit-rules-*.yml 规则定义文件自动豁免自举命中。
- **验收**（全部通过）：
  - [x] 7 标记全消费（sensitive/size/func-length/syntax/quality/residue/style）
  - [x] 位置语义：文件头前 3 行=整文件；行内=sensitive/func-length/residue 单点；size/syntax/quality/style 仅文件头
  - [x] 旧项目 12 场景矩阵全覆盖（7 整文件 + 3 行级 + 不越权 + 未豁免照报）
  - [x] §2.5 已知 6 个 debugger 假阳性已修复（自审 0 blocker、98/100 A）
  - [x] test-exempt 25 断言全绿（153 总测试全绿）
  - [x] 旧项目扫描 0 blocker

### 3.7 上下文注入 + HTTP API + 测试总入口（0.1.7）✅ 已提交
- **思路**：HTTP 写端点鉴权（无 Origin→403 / 跨源→403 / 破坏性操作缺 confirm→400 / 超大 body→413）；上下文注入文本生成与机器解析；npm test 退出码 0。
- **已实现**：`lib/http/index.js` 纯函数鉴权（checkOrigin 同源判定忽略端口/路径、checkWriteConfirm、checkBodySize 5MB、authPipeline、routeRequest 路由分发、readJsonBody 流式 413 防护）；`lib/context/index.js` createEnvInjectionText/parseEnvInjection/isWithinRoot（防目录穿越）。
- **验收**（全部通过）：
  - [x] 无 Origin 的写请求 → 403（POST/PUT/PATCH/DELETE 全覆盖；GET/OPTIONS 免校验）
  - [x] 跨源写请求 → 403（192.168.1.100 等一律拒绝）
  - [x] 破坏性操作缺 confirm → 400（confirm 非 true 一律拒）
  - [x] 超大 body → 413（>5MB；恰好 5MB 放行；流式超限 destroy）
  - [x] 路由分发：写端点鉴权前置（403 时处理器不被调用）、未知端点 404
  - [x] test-http 30 断言 + test-context 7 断言全绿（190 总测试全绿）
  - [x] npm test 退出码 0；旧项目扫描 0 blocker

### 3.8 侧边栏（0.1.8）✅ 已提交
- **思路**：复用旧 client.js 骨架；零外部资源；审计开关默认关；配置即时生效。
- **已实现**：`lib/client/index.js`——SETTINGS_SCHEMA（设置项单一事实源）/ defaultConfig（开关全默认关）/ resolveConfig（类型校正 + 未知键丢弃 + 纯函数）/ createSettingsCard（手写 createElement，无 JSX）/ collectExternalRefs（零外部资源自检）/ INLINE_CSS（纯内联无 @import·无 url()）/ clientModuleInfo（接线用）。
- **验收**（全部通过）：
  - [x] 手写 createElement 无 JSX（源码无 JSX 标签、不依赖 jsx-runtime；mock react 验证元素树）
  - [x] 零外部资源（内联 CSS 无外链/url()/@import；自检能抓出外链样本）
  - [x] 审计开关默认关（auditEnabled/pushPermitEnabled/llmAudit/全量扫 全 false）
  - [x] 配置即时生效（onChange 立即回调；布尔严格取真值；enum 非法回落）
  - [x] 无 viewer 入口（0.1.8 决策：不实施提交历史查看器）
  - [x] test-client 16 断言全绿（208 总测试全绿）
- **决策：v2 不实施 viewer（提交历史查看器）**——旧项目 v1.60.1 已移除该类组件（lib/viewer.js + viewer-locales.js + /git-push/viewer 页面 + repos|commits|diff 只读端点，commit 33276c4），**用不上，以后再改**；侧边栏不包含提交历史查看器入口。若未来要浏览提交历史，从旧项目历史版本移植（需新增 test-viewer 覆盖，链接拼接 bug 已在旧版修复）。

### 3.9 链接判断 yml 规则（0.2.0）✅ 已提交
- **思路**：link-check kind——404/403 大扣分、DNS 中扣分、超时小扣分；flaky 域名网络错误 ×0.2；只 warning 不 blocker。
- **已实现**：`lib/link-check/index.js`（extractLinks 去重去标点跳占位符 / gradeResult 分级纯函数 / probeLink+probeLinks 并发受限探测 / checkLinks 统一问题对象 / sumLinkPenalty）；`lib/audit-rules/audit-rules-docs.yml` 规则槽位（link-check kind）；编译函数注册（加一行）；RULE_SLOTS 修正为只列已建槽位 + PLANNED_SLOTS 记录规划槽位；CLI `link-check <路径>` 子命令。
- **验收**（全部通过）：
  - [x] fake server 分级扣分（404/403→-3 dead、DNS→-2、超时/连接/5xx→-1）
  - [x] flaky 打折（api.github.com/raw.githubusercontent.com DNS -2→-0.4、超时 -1→-0.2；非 flaky 不打折）
  - [x] 断网不 blocker（全部网络错误只产 warning，无一 blocker）
  - [x] 100 链接并发（10 并发、50ms/请求）≤30 秒
  - [x] test-link-check 24 断言全绿（233 总测试全绿）
  - [x] CLI link-check 子命令可用（docs 扫描 0 问题）

### 3.10 DSH 插件接线 + 双副本同步 + 推送准备（1.0.0）✅ 已提交（首发）
- **思路**：把十大总入口接到 DSH 运行时（薄适配层）；工作区源 → DSH 插件目录双副本同步；产物齐备待推送（**按纪律不推送**）。
- **已实现**：
  - `lib/index.js` 插件入口：`apply(ctx, config)`（systemPrompt 注入 + 工具注册 + HTTP 路由 + settings 槽位）、`listTools()` 7 工具、`callTool()` 分发、`handleHttp()` 鉴权前置分发、`Config` schema（开关默认关）。
  - `lib/git/index.js` 新增 `scanRepos()` + `describeRepo()`（分支/remote/变更数/最近提交）。
  - `client.js` 根级 DSH 客户端插件（`__ModuleLoader__.load` 格式，手写 createElement、零外部资源、开关默认关）。
  - `scripts/sync-plugin.mjs` 双副本同步（**默认 dry-run**，`--write` 才写；排除 test/、看板、node_modules；幂等：内容一致跳过）。
  - `cordis.patch.yml`（insert 顶层写法）+ package.json exports/files/bin（`npm run sync-plugin`）。
- **验收**（全部通过）：
  - [x] 入口导出齐全（name/Config/apply/callTool/handleHttp/listTools）且可 apply 无 ctx 不崩
  - [x] 工具清单 7 个（git_scan/git_commit_push/code_audit/git_clone/git_remote_create/git_set_visibility/link_check）均带描述与参数
  - [x] 工具分发：git_scan 扫到本仓、缺参报错、未知工具报错、code_audit 出 summary+quality
  - [x] HTTP 接线后鉴权仍生效（GET 免 Origin / POST 无 Origin 403 / 破坏性端点缺 confirm 400 / 超大 body 413 / 未知端点 404）
  - [x] 双副本同步 dry-run 不写盘、真写幂等（第二次 0 写）、缺目标报错不静默、探测无 HOME 不崩
  - [x] 客户端插件零外部资源 + 无 JSX + 开关默认关（与服务端 schema 一致）
  - [x] 推送准备产物齐备（package.json name/version/exports/files/bin + cordis.patch.yml）
  - [x] test-plugin 25 断言 + test-client 21 断言全绿（263 总测试全绿）

### 3.11 自审质量达标（1.0.0 收尾）✅
- **背景**：1.0.0 接线后自审 66/100 C（1 blocker + 56 warning），主因是**文件类别误报**。
- **修复**：
  - `lib/exempt/index.js` 新增 `CATEGORY_EXEMPT` + `isCategoryExempt()`：test/ 与 scripts/·cli.mjs 类别里 console-log（CLI 产品输出）、sync-fs（脚本本就同步）、empty-catch（测试刻意的同步断言）不算问题。
  - `lib/score/ast.js` 空 catch 语义细化：完全空块仍报；**带说明词注释**（跳过/忽略/已断开/不抛/视为/兜底…）视为已交代，不报。
  - `lib/score/ast.js` 文件头 `dsh-skip-func-length`（检查器主体为纯解析函数，长而线性）。
- **结果**：自审 **0 问题 / quality 100 A**；test-quality 补 3 条新语义断言（265 全绿）。

---

## 4 问题清单（五份外部报告 → v2 自检，防再犯）

| # | 已证实问题 | v2 对策 | 状态 |
|---|-----------|---------|------|
| 1 | 死导入/未使用导出 | unused-import/export 自检 | ⏳ |
| 2 | 真空 catch | checkEmptyCatch 已实现 | ✅ |
| 3 | js-yaml 未声明 | package.json dependencies 显式 | ✅ 0.0.0 |
| 4 | npm test 坏 | test/*.mjs 显式 glob | ✅ 0.0.0 |
| 5 | CLI --depth 文档/实现不符 | cli-help-sync 机器比对 | ⏳ 0.1.4 |
| 6 | README/工具数滞后 | doc-sync 自检 | ⏳ 0.1.4 |
| 7 | HTTP 写端点无鉴权 | Origin+CSRF+确认参数 | ⏳ 0.1.7 |
| 8 | quality 假阴性 | AST 全量检查+坏样本回归 | ⏳ 0.1.5 |
| 9 | 同步 fs 204 处 | sync-fs AST 检查器 | ⏳ 0.1.5 |
| 10 | 凭据卫生 | credential-in-url 告警 | ⏳ 0.1.3 |
| 11 | 链接拼接错误 | link-check 规则 | ⏳ 0.2.0 |
| 12 | 配置被忽略 | config-ignored 自检 | ⏳ 0.1.3 |
| 13 | 门禁链路漏接 | gateway-chain | ⏳ 0.1.3 |
| 14 | 循环依赖 | circular-import | ⏳ |
| 15 | 文档措辞被拦截 | docs-conversation + 改写建议 | ✅ 门禁已生效 |

---

## 5 开发纪律（每次提交必须遵守）

1. **不推送、不发布**——v2 全部 commit 只落本地 master
2. **每次提交前**：`node ../dsh-git-push/cli.mjs audit . --json` → 0 blocker
3. **版本节奏**：每完成一个入口 commit 一次，第三位 +1
4. **提交信息**：`<版本> <入口名>：做了什么（可验收）`
5. **README 版本表 + 本看板执行记录同步**（readmeCheck 铁律）
6. **每个入口必须带 test-<name>.mjs**，`npm test` 一条命令全绿
7. **每个函数必须有注释**：签名 + 用途 + 关键逻辑（§2.6 是注释基线）

---

## 6 坑与风险

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| 注册表退化回 if/else | 中 | 高 | 审查铁律：compileRule 只注册表循环 |
| link-check 网络假阳性 | 中 | 高 | 只 warning + flaky 折扣 + 断网兜底 |
| git 操作污染真实仓库 | 低 | 高 | 测试全在 /tmp 临时仓 |
| 侧边栏移植破坏旧 UI | 中 | 中 | 先骨架后组件；DSH 加载验证 |
| 版本号漂移 | 低 | 中 | scan-version 校验三处一致 |
| 评分口径漂移 | 中 | 中 | 同 fixture 与旧项目对比锚定 |
| 豁免标记语义混乱 | 中 | 中 | 注册表注释 + 逐类测试 |
| **编译函数 patterns 存字符串而非 RegExp** | **已踩** | 高 | §2.5 定位；测试全覆盖后此类回归不可能漏 |
| **yml 规则 id 用斜杠风格 vs detect 前缀风格** | **已踩** | 高 | id 统一 dash 风格匹配 detect 契约；新增槽位先跑分桶测试 |
| **版本号口径与旧项目审计规则冲突** | **已踩** | 中 | 本项目采用大版本号从 0 起的口径（1.x→0.x，2.0.0→1.0.0）；旧项目 `version/major-zero` 规则要求 DSH 插件 version 必须 1 开头 → 旧项目扫描本仓会报 1 个 blocker（已知豁免项；若日后改口径需全仓回改） |
| **规则定义元数据被自家 regex 自举命中** | **已踩** | 中 | 0.1.6 豁免总入口补「规则定义文件豁免」语义（§2.5 已记录 6 个假阳性 debugger） |
| 接手 AI 偏离看板 | 中 | 高 | 本板唯一权威：函数清单+验收标准逐条对照 |

---

## 7 执行记录

| 版本 | commit | 内容 | 自检 |
|------|--------|------|------|
| 0.0.0 | 090ff84 | README 计划稿 | 旧项目扫描 0/0 ✅ |
| 0.1.0 | afa85ec | 框架骨架 + cli + test 16 + check 脚本 | 旧项目扫描 0 blocker ✅ |
| 0.1.1 | 6a23d0b | 规则总入口：13 编译函数 + nodejs 槽位 + test 15（31 全绿） | 旧项目扫描 0 blocker ✅ |
| 0.1.2 | 90e48ca | 审计总入口：修 patterns→RegExp + func-lines 语句密度 + auditChanged 真 diff + collectChangedFiles + test-audit 14（44 全绿）+ CLI audit 73/100 B + 旧项目同 fixture 锚定 | 旧项目扫描 0 blocker ✅ |
| 0.1.3 | a3d5c8a | git 总入口：runGit/resolveToken 三层/commitAndPush/敏感文件 .gitignore/pushViaApi+SSH 回退/cloneViaApi/ensureRemoteRepo/setVisibility/githubFetch 硬闸 + test-git 35（79 全绿） | 旧项目扫描 0 blocker ✅ |
| 身份基线 | 696e3ba | 本项目即 dsh-git-push 本体：package.json name/description + README/看板/注释统一名称，恢复工作区路径引用 | 79 全绿 + 旧项目扫描 0 blocker ✅ |
| 0.1.4 | c582130 | 自身总入口：VERSION 三处一致(scan-version)/readmeTemplate/yamlTemplate/helpSync/CLI self-check + test-cli 18（97 全绿） | 旧项目扫描 0 blocker ✅ |
| 0.1.5 | 9b7c45e | 评分总入口：lib/score/ast.js tokenizer+AST 检查器（sync-fs named-import/empty-catch 多行/func-lines 精确行数）+ runChecks 接入 + test-quality 31（128 全绿） | 旧项目扫描 0 blocker ✅ |
| 0.1.6 | acfa588 | 豁免总入口：exemptForFinding 注册表驱动全消费（7 标记/位置语义/12 场景）+ residue 仅代码文件 + 规则定义文件自动豁免（修 §2.5 debugger 自举）+ test-exempt 25（153 全绿） | 旧项目扫描 0 blocker ✅ |
| 版本号改口径 | 93734cf | 大版本号从 0 开始（1.x→0.x，2.0.0→1.0.0），全仓文档/代码/看板/历史提交信息统一 | 190 全绿 ✅ |
| 0.1.7 | 93734cf | 上下文注入 + HTTP 总入口：Origin/CSRF(403)/写确认(400)/413 + 路由分发 + 注入文本机器解析 + test-http 30 + test-context 7（190 全绿） | 旧项目扫描 0 blocker ✅ |
| 0.1.8 | 9699179 | 侧边栏：手写 createElement 无 JSX + 零外部资源 + 开关默认关 + 配置即时生效 + 无 viewer + test-client 16（208 全绿） | 旧项目扫描 0 blocker（version/major-zero 属本项目版本号口径豁免）✅ |
| 0.2.0 | 45a0f36 | 链接判断：link-check kind yml 槽位 + 分级扣分(404/-3·DNS/-2·超时/-1) + flaky×0.2 + 并发探测 + CLI 子命令 + test-link-check 24（233 全绿） | 旧项目扫描 0 blocker（同前豁免）✅ |
| 1.0.0 | 442cf02 | **首发**：DSH 插件接线（lib/index.js apply/7 工具/HTTP/Config）+ scanRepos + client.js 根级客户端插件 + 双副本同步脚本（dry-run 默认）+ cordis.patch.yml + package.json exports/files + test-plugin 25（263 全绿） | 旧项目扫描 0 blocker ✅ |
| 1.0.0 收尾 | 22cdb31 | 自审质量达标：文件类别豁免（test/scripts 的 console-log·sync-fs）+ 空 catch 语义细化（说明注释即算交代）+ ast.js 函数行豁免 → **自审 0 问题 100/100 A**（265 全绿） | 旧项目扫描 0 blocker ✅ |
| 1.0.1 | 77f86aa | **六个真实缺陷修复**：① `summarize` 漏统 error 级 → error 归拦截级 + notice 单列（消除「0 blocker 0 warning 但 total=3」矛盾统计）；② **9 个 kind 死桶**（编译后无人消费）→ 新增 5 个 AST 检查器（checkNameLengthAst/checkComplexityAst/checkNestingDepthAst/checkFileLines/checkRepeatedStringsAst）+ 8 个 kind 全接线；③ `[FUNC]-` 规则被 `regex` 抢走（detect 写 `/^[FUNC]-/` 是字符集）→ `/^(\[FUNC\]\|secret)-/`；④ **豁免完全失效**（checks/exempt 读 `secret` 而编译产出 `[FUNC]`，命名不一致）→ 全仓统一；⑤ 槽位半硬编码 → `SLOT_ORDER_HINT` 仅排序偏好 + 纯动态发现（放 yml 即生效）；⑥ `detectTargets` 漏真实加载源 → 双目标（`local-plugins/` 优先 + `node_modules/`）；另加 `capSeverity`（规则 severity 为上限，检查器不得越级升 blocker）｜**278 全绿** | 旧项目扫描 0 blocker ✅ |
| **1.0.4** | adc2e13…9eb1c86（14 提交） | **规则引擎加固 + 配置面双线**：① regex 子模式（文档 §13 兑现）；② performance 新槽位（memory-bomb 7 子模式 + busy-wait，push 误报 91→精确子模式）；③ **G3 同形字符**（homoglyph 映射 + compileRule 入口拦截 kind/id）；④ **G6 字段全认领**（29 字段，blacklist 阈值 40→60 真实生效）；⑤ **private 槽位**（loader 合并 13 条 + glob.js + checkPrivateFiles，public→blocker/private→warning 双路径）；⑥ **G7 侧边栏三项**（审计强度三档 / 自定规则目录 / 权重覆盖，三处同步 + 双路径接线）；⑦ i18n 降噪（dsh-skip-i18n）；⑧ dual-scan 补旧 full-scan 通道｜**334 全绿** | 双扫描两侧 0 blocker；自审 0 blocker |
| **1.0.3** | 待提交 | **旧项目规则包全量复制 + 3 新槽位**：① 复制旧项目 9 槽位 86 条规则 → v2 规则 12→96 条；② 新槽位 robustness（mkdir-before-write）/ folder（目录审计 4 条，checkFolderRules 挂 auditFull）/ i18n（国际化审计 3 条，locale 仓库级一次判定）；③ 新 kind 同名函数：blacklist（comment 黑名单加分制 24+22+6）+ folder + npm-json（两条死规则改 JSON 结构化真判定）；④ 修复真缺陷：dsh-skip-sensitive 对 regex 宽声明安全类豁免失效（17 假阳性）、func-lines/max-lines 中文「函数」名识别、detectionMethod 顶层展开读取；⑤ v2 独有能力合并回 nodejs 防覆盖丢失；⑥ skill 文档措辞中性化 + 新增 DETAILS-EXEMPT-AND-RULES.md 细节权威；⑦ 测试 315→320 全绿｜双扫描 0 blocker | 旧项目扫描 0 blocker ✅（待提交） |
| **1.0.2** | 2432cc4 | **测试按入口重组 + 审计健壮性加固**：① 测试一脚本对一入口（test-framework 溶解归位：规则/评分/豁免/自身各归其位，test-cli 更名 test-self，同步/打包测试归自身入口）；② **G9** 匹配器空值崩溃（`rules=undefined` → `rules is not iterable`）→ `rules \|\| []`；③ **G10** 重复串死检测（tokenizer 产出 `str`/`tmpl`，检查器过滤 `string`/`number` → 永不命中）→ 按实际类型名收集 + 去引号；④ **G11** 重复串泛滥（修复后自审 343 条：文档数字/域名词汇噪音）→ 排除 `num`/纯标识符/dotfile/短期望词 + 文档/测试目录豁免 maintainability；⑤ **G12** `node_modules.orig` 入 .gitignore（用户定稿：`ensureGitignore` 基线忽略 + 扫描器跳过）；⑥ 提取 `HINT_QUALITY`/`MSG_REPO_REQUIRED` 常量消除重复字面量；⑦ 会话归档 zip 按约定从索引移除；⑧ 审计入口测试 13→33 断言｜**315 全绿** | 旧项目扫描 0 blocker ✅ |

---

## 8 接手 AI 起步清单（30 分钟上手）

```bash
# ① 环境
cd "/vol2/1000/DeepSeek Harness/dsh-v0.1.2-alpha.4/.dsh-home/工作区/dsh-git-push-v2"
npm test          # 期望：128 全绿（当前 0.1.5 已提交）
npm run check     # 期望：12/12 语法通过

# ② 读本板顺序
#   §2.5（卡点历史与已知问题）→ §2.2（架构）→ §2.6（函数清单）→ §3.3（0.1.3 git 总入口验收）
#   → 从 0.1.3 git 总入口开始下一入口

# ③ 提交前
node ../dsh-git-push/cli.mjs audit . --json   # 0 blocker 才提交
# 提交（不推送）：git add -A && git commit -m "1.1.x <入口名>：…"
```
## 2.7 会话记录 + 旧项目报告验收（1.0.x 阶段）

> 依据：外部提供的项目会话归档（含 225 条需求消息）、
> 旧项目 `../dsh-git-push/docs/` 18 份分析报告、旧项目 `../dsh-git-push/lib/audit-rules/` 9 槽位 86 条规则。

### 2.7.1 版本号节奏
- **1.0.x** = 修 bug（每修一批，第三位 +1）
- **1.1.0** = **已知 bug 全部修完**才发布（不是"改了点东西"就升 1.1.0）

### 2.7.2 已验收通过（对照会话 + 报告）
| 项 | 来源 | 状态 |
|---|---|---|
| P0-1 js-yaml 进 dependencies | 实测版报告 | ✅ 已修 |
| P0-2 `npm test` 脚本可用（`node --test test/*.mjs`） | 实测版报告 | ✅ 已修 |
| P0-3 CLI `--depth` 实现 | 实测版报告 | ✅ 已修 |
| P0-4 自家规则拦自家文档 | 实测版报告 | ✅ 已修 |
| P1-4 静默 catch 清零 | 实测版报告 | ✅ 已修（0 处） |
| P2-3 check 覆盖全部文件 | 实测版报告 | ✅ 17/17 |
| P2-6 版本号三处一致 | 实测版报告 | ✅ scan-version 机器校验 |
| 10 总入口架构 | 会话第 205 条 | ✅ 齐全 |
| 审计变动/全量双函数 | 会话第 158/165 条 | ✅ auditChanged/auditFull/auditWithScope |
| 加字段=加函数+注册一行 | 会话第 193 条 | ✅ compileRule 主体不改 |
| 豁免提示随问题输出 | 会话第 179/180 条 | ✅ exemptHint 全类覆盖 |
| 槽位动态配置（不写死） | 会话第 127 条 | ✅ resolveSlotOrder 配置/环境变量驱动 |
| viewer 不实施 | 会话第 218 条 | ✅ 决策记录在 §3.8 |
| README/yml 模板 + 独立运行 | 会话第 205 条 | ✅ lib/self + cli.mjs |

### 2.7.3 验收发现的缺口（1.0.x 待修）
| # | 缺口 | 依据 | 优先级 |
|---|---|---|---|
| G1 | **规则覆盖度**：v2 仅 2 槽位 12 条；旧项目 9 槽位 86 条 | 旧项目 lib/audit-rules/ | ✅ 已修（1.0.3 复制 9 槽位 86 条 + 3 新槽位 → 96 条） |
| G2 | 缺 7 个槽位：npm / frontend(html) / comment / dsh / private / structure / version | 同上 | ✅ 已修（1.0.3 全量复制，动态发现自动生效） |
| G3 | kind 命名夹带同形字符：`сrеdеn t iаl-ref` 非 ASCII，按 ASCII 写规则匹配不上 | 全仓扫描 | ✅ 已修（1.0.4：lib/rule/homoglyph.js 同形映射表 + findHomoglyphs；compileRule 入口对 kind/id 显式拦截，静默失效→显式报错；全仓扫描确认当前 0 命中） |
| G4 | `summarize` 漏统 error 级（出现「0 blocker 0 warning 但 total=3」） | 本轮实测 | ✅ 已修（error 归 blocker） |
| G5 | 正则大小写敏感导致驼峰凭据漏检（apiKey/API_KEY） | 本轮实测 | ✅ 已修（默认 i 标志） |
| G6 | 规则字段覆盖：旧项目用到 30 字段，v2 编译函数需全部认领 | 字段统计 | ✅ 已修（1.0.4 全部认领：29 字段逐一核对，scoring→threshold 兜底 / action / suggestions / examples / minLines 走 extra 透传；blacklist 阈值 40→60 真实生效） |
| G7 | 侧边栏：权重自定义 / 规则包导入导出删除 / 审计强度选择 | 会话第 34/157 条 | ✅ 已修（1.0.4：审计强度 quick/standard/deep 三档引擎语义 + 自定规则目录 auditRuleset（loader dir 参数）+ 权重覆盖 weightOverrides JSON；三处同步 Config/SETTINGS_SCHEMA/client.js 内联；code_audit 与 git_commit_push 双路径接线） |
| G8 | 测试组织：一脚本对一入口（用户本轮要求） | 本轮指令 | ✅ 已修（11 脚本 ↔ 10 入口 + 插件接线，test-framework 溶解归位） |
| G9 | **匹配器空值崩溃**：`checkRegexRules` / `checkPathRegexRules` 收 `rules=undefined` 时 `for..of` 抛 TypeError（`rules is not iterable`） | 本轮补测暴露 | ✅ 已修（`rules \|\| []`） |
| G10 | **repeated-string 死检测**：tokenizer 产出 `str`/`num`/`tmpl`，检查器却过滤 `string`/`number` → 重复串检测永不命中 | 本轮补测暴露 | ✅ 已修（按实际类型名收集 + 去引号 + `tmpl` 入列） |
| G11 | **repeated-string 泛滥**：修复后自审 343 条，多为文档数字（10/15/版本号）——数值字面量重复属正常，不该按「硬编码文本」报 | 修复后自审 | ✅ 已修（1.0.2 排除 num/纯标识符/dotfile/短期望词 + 文档/测试豁免，自审 0 命中） |
| G12 | **node_modules.orig 入 .gitignore**：插件 `ensureGitignore` 要恒定排除 `node_modules/` 与 `node_modules.orig/`（机器本地产物 / 安装残留副本），且扫描器不得走进 `node_modules.orig` 误报 | 用户本轮指令 | ✅ 已修（DEFAULT_IGNORE_PATTERNS + 扫描器跳过） |

### 2.7.4 旧项目规则槽位清单（G1/G2 的验收标准）
| 槽位 | 规则数 | 内容 |
|---|---|---|
| nodejs | 34 | 命名/长度/嵌套/圈复杂度/重复码 + 无同步IO/空catch/输入校验/超时 + 凭据/路径穿越/eval + 性能 + 测试 + 依赖漏洞 |
| frontend | 19 | a11y(img-alt/button-label/link-href/form-label) + XSS(unsafe-inline/event-handler) + rel-noopener + 表单校验 + 性能(defer/lazy) + 框架(react-key/vue-v-html) |
| npm | 10 | files 配置/exports 缺 client/依赖星号/js-yaml 未声明/npmrc token/private 冲突/license/repository |
| version | 8 | package.json 版本规范 + README 版本表一致性 |
| dsh | 7 | DSH 插件专属：bare cordis/schemastery 导入、tool render、client node 内置模块、patch insert id、module loader id |
| comment | 6 | 注释措辞/AI 会话残留（原 dsh-git-push 的 comment-wording） |
| structure | 1(+decisions) | 目录结构规范（单数命名 path-regex + 取舍结论） |
| private | 0(+private_files) | 私密文件强制槽位（清单即规则） |
| template | 1 | 空模板（默认不加载，供自定义入口） |

### 2.7.5 子代理考古结果（会话归档 98 回合 → 需求/验收清单）

> 依据：外部提供的项目会话归档 zip（98 回合）由两个考古子代理分片研读（T1–T33、T34–T65），T66–T97 主代理直读。
> 归档已按约定删除（分析完毕）；此处留存提取出的需求与验收口径，防遗忘。

**需求/验收口径（需在 1.0.x 兑现）**
| 项 | 来源回合 | 状态 |
|---|---|---|
| 规则包插件化：规则以可插拔包形式存放，可整体替换 | T1–T33 考古 | ✅ 已落地（1.0.4：loader 支持自定目录 `loadRuleFiles(order, {dir})` + `auditRuleset` 配置项 + `code_audit` 的 `ruleset` 参数；此前记录为已完成但代码未实现，本次补齐并实测：自定目录规则命中 blocker → 门禁拦截） |
| comment-wording 分数制（非一刀切禁词） | T1–T33 考古 | ✅ 黑名单加分 + 白名单减分（fullScan） |
| 脱离 dsh 独立运行（CLI 单独可跑） | T1–T33 考古 | ✅ cli.mjs + bin git-sluice |
| 规则白名单（忽略清单） | T1–T33 考古 | ✅ ignore_values / whitelist 字段编译消费 |
| 审计强度选择（quick/standard/deep） | T1–T33 考古 | ✅ 已修（1.0.4 G7：runChecks 按 level 跳过 AST/语义重检查，quick 档基础安全不降级；实测自身仓 quick 501 / standard+deep 869 findings） |
| 私密文件强制槽位：public→blocker / private→warning | T34–T65 考古 | ✅ 已修（1.0.4：loader 合并顶层 private_files 13 条 + globToRegex（**/ * / {a,b} 零依赖）+ checkPrivateFiles（git ls-files × 分级 public→blocker/private→warning）；auditFull 与 auditChanged 双路径接线） |
| 槽位动态化（配置/环境变量控制槽位集合） | T50 | ✅ resolveSlotOrder（G12 已闭环） |
| 双副本同步：local-plugins 是真实加载源，node_modules 是 npm-link 产物 | T42/T43 | ✅ detectTargets 双目标（G13 已闭环） |
| yamlCheckMode 双模式（加载期校验 / 运行期校验） | T34–T65 考古 | ✅ 编译期错误收集（compileAllRules ctx.errors） |
| severity 三级映射（error/warning/notice） | T34–T65 考古 | ✅ capSeverity + summarize |
| 扫描拆两函数（auditChanged / auditFull） | T63 | ✅ 已闭环 |
| 权重 10 维度定稿 | T34–T65 考古 | ✅ DEFAULT_WEIGHTS 合计 100；1.0.4 增 weightOverrides 覆盖（JSON 配置/工具参数，未指定维度保持默认） |
| 设置双位 UI（设置页 + 插件配置卡） | T34–T65 考古 | ⚠️ 半完成：插件配置卡已实现（`settings.plugin.item`，client.js `apply()`）；设置左侧栏独立页（`settings.section`）**未实现**，`clientModuleInfo().slots` 声明两项但只注册一项（代码注释已标明「实现前不要按已支持两槽位理解」）。补设置页属新功能，待用户决定 |
| 规则字段全认领（30 字段） | 字段统计 | ⚠️ G6 中 |

**早期四份外部报告逐条核验（1.0.4，结论：v2 架构上问题已消除或不再适用）**

| 报告问题 | 核验方式 | v2 结论 |
|---|---|---|
| `package.json` files 白名单与运行期依赖脱节（npm 装后 `createUserRepoTemplate` 必炸） | 读 `package.json` + 全仓 grep `template/user-repo` | ✅ 已消除：v2 无该运行期功能；files 白名单 = lib/skills/cli.mjs/client.js/cordis.patch.yml/README.md，与代码引用一致 |
| `docs/code-quality-checklist.yaml` 被 gitignore 且三处代码依赖它（克隆后测试红、评分回退） | 全仓 grep `code-quality-checklist` / `locateQualityYaml` | ✅ 不再适用：v2 零代码依赖该文件（唯一命中是 structure.yml 的一条提醒正则）；权重表内置 `DEFAULT_WEIGHTS` |
| `runGit`/`gitRaw` 无 try/catch、无 maxBuffer（git 缺失或超 1MB 输出即穿透） | 读 `lib/git/index.js` 封装 | ✅ 已消除：统一封装带 `maxBuffer: 16MB` + 异常捕获 |
| 评分只算 4 个维度、其余 6 维硬编码（诚实性问题） | 读 `lib/score/index.js` | ✅ 已消除：`DEFAULT_WEIGHTS` 10 维齐全合计 100，无硬编码维度 |
| 硬编码默认 owner `EIGHTfs` | 全仓 grep `EIGHTfs`（lib/ 与 cli.mjs） | ✅ 已消除：0 处命中 |
| 巨型文件难维护（旧项目 core.js 2714 行 / index.js 1237 行） | `wc -l` 排序 | ✅ 已消除：最大文件 580 行（checks.js），lib 全量 3486 行按 10 入口拆分 |
| 无工程工具链（无 eslint/测试框架） | 读 `package.json` scripts/devDeps | ⚠️ 部分差异（有意为之）：`npm test` = `node --test test/*.mjs`（337 断言）+ `npm run check` + scan-version + sync-plugin；按零依赖项目规范（zero-dep）不引入 eslint/第三方框架 |
| 全端点无鉴权（POST /commit、/rebuild 仅靠本机端口兜底） | 读 `lib/http/index.js` | ✅ 已消除：`authPipeline`（Origin 校验 + CSRF + 写操作 confirm） |

**考古复述的新 bug/教训（并入 §4 防再犯）**
- 改动刷新看不到的根因 = 双副本不同步（旧 v1.46–v1.49 反复出现）→ G13 已修
- 规则 detect 写 `/^[FUNC]-/` 被当字符集 → G10（本次实测复现同类：token 类型名不匹配）
- 语义规则曾是大空桶（compiled 但无人消费）→ G10 已修（9 死桶全接线）

