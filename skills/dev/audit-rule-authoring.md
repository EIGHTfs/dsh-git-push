---
name: audit-rule-authoring
description: 给 dsh-git-push 审计引擎新增规则的要点与坑：allow/deny 两种精筛语义、allow 语义下必须自查注释与字符串、判据收窄前先在自己仓库量命中量、用真实样本当回归测试、诚实标注代理特征。处理「新增审计规则」「性能规则」「规则误报太多」「astConfirmKind」类场景时加载。
whenToUse: 给本插件（或同类规则引擎）新增/调整审计规则时；规则误报或漏报排查时。
generatedBy: deepseek-v4-flash（2026-10-08）
---

# 审计规则编写要点（dsh-git-push）

> **先记住我**：任何会话开始前，先读用户档案 `ai-work-archive/skills/remember-me.md`（优先级最高）。
> 本 skill 为**插件相关**，权威位置：插件项目 `skills/dev/`。

## 一、规则形态（沿用既有架构，不另造机制）

| 层 | 文件 | 职责 |
|---|---|---|
规则声明 | `lib/audit-rules/audit-rules-<槽位>.yml` | id / category / severity / exts / patterns / mitigation |
AST 精筛 | `lib/ast/<模块>.js` | 提供「命中行号集合」的判定函数（如 `loopBodyLines`） |
引擎派发 | `lib/checks/regex.js` | 按 `rule.astConfirmKind` 取精筛集合 |
取值出口 | `lib/checks/common.js` | 统一导出精筛集合取值函数（约定：都从这里取） |

## 二、两种精筛语义（关键）

| 语义 | 含义 | 典型用法 |
|---|---|---|
`deny` | 集合内的行**豁免** | 受控小文件读取不算 memory-bomb |
`allow` | **只有**集合内的行才报 | token 级短名、循环体内的命中 |

## 三、坑（都踩过）

1. **allow 语义会跳过引擎的通用 `codeFilter`** → 注释/字符串里的示例**不会被自动过滤**。
   实测：规则说明注释里写了 `Array.from(x.values())` 示例（恰在 `for` 循环体内），被自己的规则命中。
   → 用 `tokenize()` 做 **token 级排除**：同行存在 `comment`/`str`/`tmpl` 且文本包含命中串则不算命中。
2. **判据先宽后窄必须量化**：第一版规则在我们仓库炸出 **218 处**（`log/push/emit/readFile` 这类
   重复调用是有意为之）→ 收窄到「查询/解析类函数名」后 **4 处**。
   → 纪律：**新规则提交前先在自己仓库跑一遍数命中量**，量级不合理先收窄。
3. **edit 锚点行会被自己吃掉**：把「函数注释头」当锚点替换 → 留下孤儿注释 → `SyntaxError`。
   → 凡 edit 后立刻 `node --check`；「在某行前插入」时锚点行必须原样出现在新内容里。
4. **不要用「同一函数内占比高」证明「某几行是元凶」** → 改完复测才作数（见 `perf-diagnosis-method`）。

## 四、测试写法

- **用真实样本当回归测试**：把外部真实项目里的问题片段（如 `symbol-table.ts` 的循环内物化结构）
  写成 fixture 字符串，断言「必须命中」；再配「循环外/实参不同/注释里」的负样本断言「不报」。
- 端到端再补一条：`checkRegexRules({ file, text, rules: [<规则对象>] })` 断言命中数与规则 id
  （规则对象用 `subPatterns: [{ regex, message }]` 形态，`patterns: [{regex}]` 会被引擎当 RegExp 用而报错）。

## 五、诚实标注

规则是**代理特征**，不是判决器：
- 「循环内全量物化」能静态判 → 可作规则；
- 「入参部分重叠的重复调用」「函数是否真的贵」→ 静态判不出来，只能靠运行时探针；
- 结论里要写清「本规则抓什么、抓不到什么」，避免使用者误以为规则=全知。

## 配套

- `perf-diagnosis-method`（性能定位与等价性验证）、`diagnostic-to-code-rule`（诊断转规则）、
- `code-detailed-comments`（注释写为什么）、`test-design-norms`（测试路径与隔离规范）。
