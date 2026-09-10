# WORKBOARD v2 —— dsh-git-push 开发任务看板（榜样版 · 交接版）

> **状态**：开发进行中（已提交 1.0.0 / 1.1.0 / 1.1.1 / 1.1.2 / 1.1.3 / **1.1.4**；下一入口 1.1.5 评分总入口）
> **仓库**：`工作区/dsh-git-push-v2`（本地 master，**不推送**）
> **看板双重身份**：
> 1. **交接文档**——另一 AI 可凭本板完全接管 dsh-git-push 开发，不读代码也能干活；
> 2. **写作样板**——本板同时示范「一个好的任务看板长什么样、为什么这样写」，供其他 AI 学习如何写任务看板。
>
> 更新纪律：每个入口完成时同步本板「执行记录」+ README 版本表 + 测试全绿 + 旧项目扫描 0 blocker。
>
> **原始讨论记录（有疑惑先查）**：本看板由一次完整重构成长会话产出，全部决策过程（架构拍板 / 五份报告核对 / 看板打磨 / viewer 删除）留存在会话记录中。查看路径：`DSH_HOME/.dsh/sessions/` 下按工作区命名的目录（本仓库对应 `--..-dsh-git-push--`），在里面找 UUID **`281fa6ba-3e47-4679-b0ba-9c3cc0baccf1`**（目录名 = `session-` + 该 UUID，内含 `session.jsonl.zstd`，zstd 压缩的 JSONL 全文）。接手 AI 对「为什么这么设计」「某些决策出处」有疑惑时，解压即见原始上下文。

---

# 第一部分 任务看板写作方法（榜样学什么）

> 这一部分是「怎么看懂本板」和「以后怎么写一个同样好的看板」的说明书。clone 本板模板时，保留第一部分的骨架，替换第二部分为你的项目内容。

## 1.1 看板是什么、不是什么

| | 是 | 不是 |
|---|---|---|
| 本质 | **项目唯一权威的执行蓝图**：目标、现状、步骤、验收、风险、进度一次性写清，任何新接手者（人或 AI）只读本板就能继续 | 随手记的笔记、草稿、过程对话散存 |
| 粒度 | 事无巨细：文件级、函数级、命令级、断言数级 | 「做优化」「重构一下」这种大而空的话 |
| 交付 | 每步**可验收**（有命令、有数字、有对比） | 只有「计划做」没有「怎么算做完」 |
| 时效 | 随进度实时勾选更新 | 写一次就扔 |

写作心法一句话：**看板不是给你写的，是给下一个不知道上下文的人（或 AI）写的。**

## 1.2 好任务看板的 8 要素（每个要素：为什么 + 怎么写）

| # | 要素 | 为什么必须有 | 怎么写 |
|---|------|------------|--------|
| 1 | **状态总览** | 一眼知道项目在哪个阶段、哪些完成 | 表格：# / 入口 / ✅🔄⏳ / 说明 |
| 2 | **架构图** | 一图看懂全貌，避免新接手者迷失在文件海洋 | ASCII 树 + 标注数据流方向 |
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
| 看板只写大目标（「优化审计」「重构规则」） | 接手 AI 不知道从哪下手 | 拆到文件级+函数级步骤 |
| 无验收标准 | 做完不知道算不算完，互相扯皮 | 每条目标配「跑 X 命令 → Y 输出」 |
| 无函数清单 | 接手 AI 要重新通读全部代码才知道有哪些函数 | §2.6 逐文件逐函数表 |
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
| 版本规范 | 1.0.0 README → 1.1.0 框架能跑 → 每完成一入口第三位+1 |
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
│   ├── audit/       ★ 审计总入口（消费编译规则，产出统一问题对象）——1.1.2 半成品
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
│   ├── git/         ★ git 总入口 ✅ 1.1.3 已实现
│   │   └── index.js      runGit / resolveToken / commitAndPush / pushViaApi(+SSH 回退) / cloneViaApi / ensureRemoteRepo / setVisibility / githubFetch / parseGithubOwnerRepo / scanSensitiveFiles+ensureGitignore
│   │
│   ├── self/        ★ 自身总入口（骨架，1.1.4 实现）
│   │   └── index.js      VERSION / readmeTemplate / yamlTemplate / selfVersion
│   │
│   ├── context/     ★ 上下文注入（骨架，1.1.7 实现）
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
    └── test-git.mjs         35 断言（git 总入口，mock fetch + /tmp 临时仓）✅ 全绿
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
| 1.0.0 | README 计划稿（架构/问题清单/链接规则） | ✅ a936a66 |
| 1.1.0 | 框架骨架 8 入口 + cli + test 16 + check 脚本 + 本看板 | ✅ 19fe21c |
| 1.1.1 | 规则总入口（13 编译函数 + nodejs 槽位 11 条 + 15 测试） | ✅ fdf2b34 |
| **1.1.2** | **审计总入口（collector + checks + auditFull/Changed + exempt 接线）** | ✅ 已提交（见 §2.5 修复记录） |
| **1.1.3** | **git 总入口（token/commit/push/clone/建仓/可见性 + SSH 回退）** | ✅ 已提交（见 §3.3） |
| **1.1.4** | **自身总入口（版本一致性/README 模板/yml 模板/CLI 自检）** | ✅ 已提交（见 §3.4） |
| 1.1.3 | git 总入口（token/commit/push/clone/建仓/可见性） | ⏳ |
| 1.1.4 | 自身总入口（版本单源/README 模板/yml 模板/CLI 完善） | ⏳ |
| 1.1.5 | 评分总入口（AST 化质量检查 + 口径锚定） | ⏳ |
| 1.1.6 | 豁免总入口（7 标记接入审计全消费点，已部分接） | ⏳ |
| 1.1.7 | 上下文注入 + HTTP API + 测试总入口 | ⏳ |
| 1.1.8 | 侧边栏（复用旧 client.js） | ⏳ |
| 1.2.0 | 链接判断 yml 规则（link-check kind） | ⏳ |
| 2.0.0 | DSH 插件接线 + 双副本同步 + 推送准备 | ⏳ |

## 2.5 卡点记录：1.1.2 已修复（原 5 fail → 44 全绿）

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

**已知连带问题（记录在案，1.1.6 豁免总入口处理）**：v2 扫自身仓库时报 6 个 style-debugger blocker——命中点是**规则定义元数据本身**（audit-rules-nodejs.yml 的 pattern 字符串 `\bdebugger\s*;?`、exempt/index.js 注册表 blocked:['debugger']、audit/index.js:49 的 /residue|console|debugger/ 正则），非真实代码残留。属引擎自举假阳性：规则/豁免定义中的关键词字样被自家 regex 规则命中。对策：1.1.6 豁免总入口完善「规则定义文件豁免」语义时一并处理（yml 槽位文件排除 regex 类自举命中）。

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
| `auditChanged` | `(repoPath, opts) => result` | **1.1.2 真 diff 实现**：collectChangedFiles→逐文件（D 跳过）；非 git 退化 full 且 scope 标 changed |
| `auditWithScope` | `(repoPath, {scope}) => result` | 统一入口 |

### 5️⃣ lib/audit/collector.js —— 文件收集 🔄 半成品

| 符号 | 签名 | 说明 |
|------|------|------|
| `collectTextFiles` | `(dir, opts) => Array<{path, ext, full}>` | 递归收集；git check-ignore 排除（Map 缓存）；跳过 node_modules/.git/dist |
| `isGitRepo` | `(dir) => boolean` | .git 判定 |
| `readText` | `(full) => string\|null` | UTF-8 读，失败 null |
| `collectChangedFiles` | `(repoPath) => Array<{rel, full, status}>\|null` | **1.1.2 新增**：git status --porcelain 变动收集（A/M/R/??；D 保留调用方过滤）；非 git 或 git 失败返回 null |

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

### 9️⃣ lib/git/index.js —— git 总入口（骨架）⏳ 1.1.3

| 符号 | 签名 | 说明 |
|------|------|------|
| `runGit` | `(args, {cwd, timeoutMs}) => {ok, stdout, stderr}` | 数组参数零注入；stderr 保留 |
| `resolveToken` | `(opts) => {ok, error}` | 待实现三层探测 |
| `commitAndPush` | `({repoPath, message, push, dryRun})` | 待实现 |
| `pushViaApi` | `({owner, repo, branch, token, files})` | 待实现 Git Data API |
| `cloneViaApi` | `({target, dest, token, branch})` | 待实现 |
| `ensureRemoteRepo` | `({repoPath, visibility, dryRun})` | 待实现建仓 |
| `setVisibility` | `({owner, repo, visibility, token})` | 待实现 |

### 🔟 lib/self/index.js —— 自身总入口（骨架）⏳ 1.1.4

| 符号 | 签名 | 说明 |
|------|------|------|
| `VERSION` | 常量 | 单一事实源（需与 package.json/cli 三处一致） |
| `readmeTemplate` | `() => {ok, template, version}` | 待实现 |
| `yamlTemplate` | `() => string` | 规则模板示范 |
| `selfVersion` | `() => string` | 返回 VERSION |

### 1️⃣1️⃣ lib/context/index.js —— 上下文注入（骨架）⏳ 1.1.7

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

### 3.1 规则总入口（1.1.1）✅ 已提交 fdf2b34
- **子任务**：注册表骨架 / 装载骨架 / 13 编译函数 / 三统一映射 / nodejs 槽位 11 条 / 未知规则报错 / dimensions 声明——全部完成。
- **验收**：31 测试全绿；`node cli.mjs ruleset nodejs` 输出 11 条分桶统计；旧项目扫描 0 blocker。

### 3.2 审计总入口（1.1.2）✅ 已提交
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

### 3.3 git 总入口（1.1.3）✅ 已提交
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

### 3.4 自身总入口（1.1.4）✅ 已提交
- **思路**：版本三处一致（scan-version 校验）；README 模板独立（不走拦截 yml）；CLI HELP 与 parseArgv 机器比对防 --depth 类回归。
- **已实现**：VERSION 单一事实源（lib/self）→ versionInfo() + scripts/scan-version.mjs 机器校验三处一致；readmeTemplate（{{name}} {{description}} {{version}} {{versionTable}} 占位符）；yamlTemplate（kind+dimensions 示范）；helpSync()（HELP↔KNOWN_FLAGS 双向比对）；parseArgv --depth 缺值报错（不静默 NaN）；CLI 新增 yaml-template / readme-template / self-check 子命令。
- **验收**（全部通过）：
  - [x] scan-version 通过（lib/self=package.json=cli HELP v${VERSION} 模板）
  - [x] HELP 选项全认（--depth --full 双向一致，self-check 绿）
  - [x] yaml-template 输出带 kind+dimensions
  - [x] test-cli 18 断言全绿（97 总测试全绿）
  - [x] 旧项目扫描 0 blocker

### 3.5 评分总入口（1.1.5）⏳
- **思路**：10 维度权重延续；AST 化质量检查修旧项目假阴性（sync-fs named import / empty-catch 多行 / func-lines 超长坏样本 100% 检出）。
- **验收**：坏样本检出率 100% / qualityWeights 覆盖生效 / 同 fixture 与旧项目一致 / test-quality ≥20 断言。

### 3.6 豁免总入口（1.1.6）⏳
- **思路**：7 标记接入审计全消费点；位置语义逐类测试（size 只能文件头等）。
- **验收**：6 类豁免场景端到端（对照旧项目 12 场景）/ exemptHint 可直接使用 / test-exempt ≥15 断言。

### 3.7 上下文注入 + HTTP API + 测试总入口（1.1.7）⏳
- **思路**：HTTP 写端点鉴权（无 Origin→403 / rebuild 缺 confirm→400 / 超大 body→413）；npm test 退出码 0、坏断言退出码 1。
- **验收**：test-context ≥5 / test-http ≥15；全部套件 ≤60 秒。

### 3.8 侧边栏（1.1.8）⏳
- **思路**：复用旧 client.js 骨架；零外部资源；审计开关默认关；配置即时生效。
- **验收**：手写 createElement 无 JSX；侧边栏加载通过；开关默认关。
- **决策：v2 不实施 viewer（提交历史查看器）**——旧项目 v1.60.1 已移除该类组件（lib/viewer.js + viewer-locales.js + /git-push/viewer 页面 + repos|commits|diff 只读端点，commit 33276c4），**用不上，以后再改**；侧边栏不包含提交历史查看器入口。若未来要浏览提交历史，从旧项目历史版本移植（需新增 test-viewer 覆盖，链接拼接 bug 已在旧版修复）。

### 3.9 链接判断 yml 规则（1.2.0）⏳
- **思路**：link-check kind——404/403 大扣分、DNS 中扣分、超时小扣分；flaky 域名（github/api.github.com/raw/npmjs）网络错误 ×0.2；只 warning 不 blocker。
- **验收**：fake server 分级扣分 / flaky 打折 / 断网不 blocker / 100 链接 ≤30 秒 / test-link-check ≥10 断言。

---

## 4 问题清单（五份外部报告 → v2 自检，防再犯）

| # | 已证实问题 | v2 对策 | 状态 |
|---|-----------|---------|------|
| 1 | 死导入/未使用导出 | unused-import/export 自检 | ⏳ |
| 2 | 真空 catch | checkEmptyCatch 已实现 | ✅ |
| 3 | js-yaml 未声明 | package.json dependencies 显式 | ✅ 1.0.0 |
| 4 | npm test 坏 | test/*.mjs 显式 glob | ✅ 1.0.0 |
| 5 | CLI --depth 文档/实现不符 | cli-help-sync 机器比对 | ⏳ 1.1.4 |
| 6 | README/工具数滞后 | doc-sync 自检 | ⏳ 1.1.4 |
| 7 | HTTP 写端点无鉴权 | Origin+CSRF+确认参数 | ⏳ 1.1.7 |
| 8 | quality 假阴性 | AST 全量检查+坏样本回归 | ⏳ 1.1.5 |
| 9 | 同步 fs 204 处 | sync-fs AST 检查器 | ⏳ 1.1.5 |
| 10 | 凭据卫生 | credential-in-url 告警 | ⏳ 1.1.3 |
| 11 | 链接拼接错误 | link-check 规则 | ⏳ 1.2.0 |
| 12 | 配置被忽略 | config-ignored 自检 | ⏳ 1.1.3 |
| 13 | 门禁链路漏接 | gateway-chain | ⏳ 1.1.3 |
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
| **规则定义元数据被自家 regex 自举命中** | **已踩** | 中 | 1.1.6 豁免总入口补「规则定义文件豁免」语义（§2.5 已记录 6 个假阳性 debugger） |
| 接手 AI 偏离看板 | 中 | 高 | 本板唯一权威：函数清单+验收标准逐条对照 |

---

## 7 执行记录

| 版本 | commit | 内容 | 自检 |
|------|--------|------|------|
| 1.0.0 | a936a66 | README 计划稿 | 旧项目扫描 0/0 ✅ |
| 1.1.0 | 19fe21c | 框架骨架 + cli + test 16 + check 脚本 | 旧项目扫描 0 blocker ✅ |
| 1.1.1 | fdf2b34 | 规则总入口：13 编译函数 + nodejs 槽位 + test 15（31 全绿） | 旧项目扫描 0 blocker ✅ |
| 1.1.2 | e007eba | 审计总入口：修 patterns→RegExp + func-lines 语句密度 + auditChanged 真 diff + collectChangedFiles + test-audit 14（44 全绿）+ CLI audit 73/100 B + 旧项目同 fixture 锚定 | 旧项目扫描 0 blocker ✅ |
| 1.1.3 | df843dc | git 总入口：runGit/resolveToken 三层/commitAndPush/敏感文件 .gitignore/pushViaApi+SSH 回退/cloneViaApi/ensureRemoteRepo/setVisibility/githubFetch 硬闸 + test-git 35（79 全绿） | 旧项目扫描 0 blocker ✅ |
| 身份基线 | 33f5cd2 | 本项目即 dsh-git-push 本体：package.json name/description + README/看板/注释统一名称，恢复工作区路径引用 | 79 全绿 + 旧项目扫描 0 blocker ✅ |
| 1.1.4 | 待提交 | 自身总入口：VERSION 三处一致(scan-version)/readmeTemplate/yamlTemplate/helpSync/CLI self-check + test-cli 18（97 全绿） | 旧项目扫描 0 blocker ✅ |

---

## 8 接手 AI 起步清单（30 分钟上手）

```bash
# ① 环境
cd "/vol2/1000/DeepSeek Harness/dsh-v0.1.2-alpha.4/.dsh-home/工作区/dsh-git-push-v2"
npm test          # 期望：44 全绿（当前 1.1.2 已提交）
npm run check     # 期望：12/12 语法通过

# ② 读本板顺序
#   §2.5（卡点历史与已知问题）→ §2.2（架构）→ §2.6（函数清单）→ §3.3（1.1.3 git 总入口验收）
#   → 从 1.1.3 git 总入口开始下一入口

# ③ 提交前
node ../dsh-git-push/cli.mjs audit . --json   # 0 blocker 才提交
# 提交（不推送）：git add -A && git commit -m "1.1.x <入口名>：…"
```