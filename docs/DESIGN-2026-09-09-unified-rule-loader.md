# 重构设计稿：统一 YAML 规则加载器 + fullScan 更名

> 状态：**设计定稿（未实施）**——本文档记录 2026-09-09 与用户的架构讨论结论，作为后续实施（拟 v1.61.0）的依据。
> 参与者：用户（决策方）× AI（方案整理）
> 关联看板：docs/WORKBOARD-2026-09-09-quality-split-and-audit-scope.md

---

## 一、背景与动机

`lib/rule-packs.js` 是审计规则的装载/校验/编译中枢，但目前存在三个结构性问题：

1. **规则类型判定靠「字段探测」，无显式声明**——`compileRuleBuckets` 里 7 个编译函数靠互不相同的启发式猜类型（id 前缀 / 字段有无 / 名字含关键词），用户写 yml 时无法预知规则会落到哪个分支。
2. **编译函数命名与判定依据脱节**——`compileNumericRule` 一个函数内部 if 拆出 6 种类型（min-length/max-lines/max-complexity/max-depth/min-occurrences/repeated-string），新规则类型要插进 if/else 链，改动风险高。
3. **`fullScan` 命名严重误导**——实际功能是「AI 对话残留注释扫描」，却叫 fullScan（易被误认为全量审计），且与「全量审计」规划中的 `auditFull` 撞名。

用户核心诉求（原话归纳）：
- **统一 yml 规则加载器**：一个统一入口解析所有 yml 规则。
- **统一函数名与 yml 字段名一致**：编译函数按 kind/字段命名，用户写 yml 能反推函数。
- **「加字段 = 加函数，统一函数不用改动」**：新增规则类型只注册新编译器，`compileRule` 主体永不修改。
- **fullscan 改名**：消除命名误导。
- **命名格式统一，外部 API 和函数名完全一致**：一个功能一个根词，各层（函数/服务字段/工具/路由/yml 段）只做格式转换，不保留旧名别名。

---

## 二、现状盘点（实施依据）

### 2.1 全部 yml 文件与顶层段

| yml 文件 | 专项顶层段 | 说明 |
|---|---|---|
| audit-rules-comment.yml | `commentScoring`（黑/白名单评分）、`rules` | 注释措辞 + 评分规则 |
| audit-rules-nodejs.yml | `quality`（质量阈值）、`rules`、`severity_map`/`thresholds`/`ignore`/`output` | 最大规则集 |
| audit-rules-frontend.yml | `dynamic_detection`（预留，引擎不消费） | HTML/CSS 规则 |
| audit-rules-dsh.yml | `rules` | 插件结构与依赖规则 |
| audit-rules-npm.yml | `rules`（含 `exts` 限定） | npm 发布规则 |
| audit-rules-version.yml | `rules`（含 `exts` 限定） | 版本号规则 |
| audit-rules-structure.yml | `decisions`/`principles`/`naming`/`directory_roles`/`dependency_rules`（文档型），`rules`（含 `kind`） | 目录结构规范；唯一显式 kind 示例 |
| audit-rules-private.yml | `private_files`（私密拦截，独立机制） | 强制槽位 |
| audit-rules-template.yml | `rules`（模板） | 自定义规则入口 |

### 2.2 规则条目字段总清单（9 文件合并去重）

**通用字段**（86 条规则基本都有）：
`id`、`name`、`category`、`severity`（error/warning/info）、`description`、`fixable`

**匹配模式字段**：

| 字段 | 形态 | 现有用途 |
|---|---|---|
| `pattern` | 字符串正则 | 单正则 |
| `patterns` | 数组 | 多正则 |
| `path_pattern` | glob | path-regex |
| `exts` | 数组 | 扩展名限定（version/npm） |
| `detection_method` | 字符串 | frontend 语义规则 |

**数值阈值字段**：

| 字段 | 用途 | 现有 kind 值 |
|---|---|---|
| `min_length` | 标识符最短长度 | min-length |
| `max_lines` / `min_lines` | 函数/文件行数 | max-lines |
| `max_complexity` | 圈复杂度 | max-complexity |
| `max_depth` | 嵌套深度 | max-depth |
| `min_occurrences` | 重复次数 | min-occurrences / repeated-string |
| `max_occurrences` | （引擎读取，暂未排布） | — |

**豁免/辅助字段**：`ignore_patterns`（正则白名单）、`ignore_values`（字面值白名单）、`exceptions`（例外名单）、`mitigation`（修复建议，展示用）、`examples`{bad,good}（展示用）、`suggestions`（comment 建议）、`blacklist`/`whitelist`（comment 词表）、`scoring`（comment 阈值）、`additional_features`、`action`、`kind`（**显式类型声明，目前仅 structure.yml 使用**）

### 2.3 现有 7 个编译函数及其探测依据（问题根源）

| 现有函数 | 探测依据 | 输出 | 命名问题 |
|---|---|---|---|
| `compileCredRefRule` | id 前缀 `credref-` | credentialRefPatterns | 函数名 ≠ id 前缀规范 |
| `compileCredFileRule` | id 前缀 `credfile-` | credentialFileRes | 同上 |
| `compileSecretRule` | id 前缀 `secret-` | secretPatterns | 基本对应 |
| `compileFuncLinesRule` | id 是 func-lines 或 max_lines+名字含 function | func-lines | 探测含语义猜 |
| `compileNumericRule` | 有数值字段 | 6 种 kind 内部 if 拆 | **一个函数吞 6 类型** |
| `compileRegexRule` | 有 pattern(s) | regex 或 path-regex | path-regex 靠 kind 字段特殊处理 |
| `compileSemanticRule` | detection_method / category 语义 | semantic | 语义猜测有误报风险 |

---

## 三、目标架构：统一 YAML 规则加载器（定稿）

### 3.1 核心设计决策（已定）

> **「统一函数就可以不写复杂的指定，直接根据字段指派函数，加字段，加函数，统一函数不用改动」**

即：
- ❌ 不强制用户写 `kind` 字段（不增加 yml 心智负担）
- ✅ `compileRule()` 是唯一入口，**根据字段自动指派**编译函数
- ✅ 新规则类型 = 加字段 + 加函数 + 注册一行，**compileRule 主体永不修改**

### 3.2 结构

```
lib/rule-packs.js
  ├── RULE_COMPILERS = []                     // 有序注册表：{ kind, detect(rule), compile(rule, ctx) }
  ├── registerCompiler(kind, detect, compile) // 扩展点：新类型一行注册
  ├── compileRule(rule, ctx)                  // 统一入口：遍历注册表，detect 命中 → compile
  ├── resolveRuleKind(rule)                   // （可选）显式 kind 优先，字段探测回退
  ├── compileYamlRuleSet(merged, opts)        // 阶段3 编译：for (r of rules) compileRule(r)
  └── （保留）compileCommentScoring / compileDocConvAndIgnore / compilePrivateFiles / compileQualitySection
       —— 非 rules[] 的段，维持现有专用编译，不做强行归一
```

### 3.3 统一入口（伪代码）

```js
const RULE_COMPILERS = [];

export function registerCompiler(kind, detect, compile) {
  RULE_COMPILERS.push({ kind, detect, compile });
}

export function compileRule(rule, ctx) {
  // 显式 kind 优先（若有），否则字段探测
  if (rule?.kind) {
    const byKind = RULE_COMPILERS.find((e) => e.kind === rule.kind);
    if (byKind) return byKind.compile(rule, ctx);
    return { ok: false, error: `未知规则类型 kind=${rule.kind}（${rule?.id || rule?.name}）` };
  }
  for (const entry of RULE_COMPILERS) {
    if (entry.detect(rule)) return entry.compile(rule, ctx);
  }
  return { ok: false, error: `无法识别规则类型: ${rule?.id || rule?.name || '?'}` };
}
```

### 3.4 规则类型注册表（函数名 = kind = 字段，三统一）

**「三统一」原则**：`kind` 值（kebab-case）↔ 编译函数名（PascalCase 后缀）↔ 认领字段（snake_case）一一对应。

| kind 值 | 编译函数名 | 认领字段（detect 条件） | 备注 |
|---|---|---|---|
| `credential-ref` | `compileCredentialRefRule` | id 前缀 `credref-` | 现 compileCredRefRule 改名 |
| `credential-file` | `compileCredentialFileRule` | id 前缀 `credfile-` | 现 compileCredFileRule 改名 |
| `secret` | `compileSecretRule` | id 前缀 `secret-` | 保持 |
| `func-lines` | `compileFuncLinesRule` | id 是 func-lines 或 name 含 function 且 max_lines | 保持探测 |
| `min-length` | `compileMinLengthRule` | 有 `min_length` | **从 compileNumericRule 拆出** |
| `max-lines` | `compileMaxLinesRule` | 有 `max_lines` | **拆出** |
| `max-complexity` | `compileMaxComplexityRule` | 有 `max_complexity` | **拆出** |
| `max-depth` | `compileMaxDepthRule` | 有 `max_depth` | **拆出** |
| `min-occurrences` | `compileMinOccurrencesRule` | 有 `min_occurrences` 且无 ignore 字段 | **拆出** |
| `repeated-string` | `compileRepeatedStringRule` | 有 `min_occurrences` 且有 `ignore_patterns`/`ignore_values` | **拆出** |
| `regex` | `compileRegexRule` | 有 `pattern`/`patterns` 非上述 | 保持 |
| `path-regex` | `compilePathRegexRule` | 有 `path_pattern` | 现靠 kind 特判 → 字段探测 |
| `semantic` | `compileSemanticRule` | 有 `detection_method` / category 语义 | 保持（探测条件后续可收敛） |

### 3.5 行为与兼容性

- **存量 86 条规则零改动**：所有现有 yml 规则靠字段探测自然落入对应编译器，输出结构与现状完全一致。
- **`kind` 字段成为「推荐扩展点」**：模板 yml 示范显式 kind 写法；显式 kind 优先于字段探测（防歧义）。
- **未知规则类型**：`compileRule` 返回 `{ok:false, error}`，错误汇总进 `errors`——现状 `compileRuleBuckets` 静默跳过未知规则，新架构统一报错提示（可能改变个别边缘行为，实施时用测试锁定）。
- **`compileRuleBuckets` 的 if/else 链删除**，替换为循环调 `compileRule`。

---

## 四、fullScan 更名方案（定稿）

### 4.1 命名格式统一原则（已定）

> **「名字命名格式统一，外部 API 和函数名完全一致」**

**一个功能，一个根词，各层只做格式转换**（同一语义，杜绝同名异义 / 异名同义）：

| 层 | 格式 | 根词示例（comment-residue-scan） |
|---|---|---|
| yml 段名 | kebab-case | `comment-residue-scan` |
| 函数名 | PascalCase 前缀 + camelCase | `compileCommentResidueScan` / `commentResidueScanRepo` |
| 服务字段 | camelCase | `commentResidueScan` |
| 工具名 | snake_case | `scan_comment_residue` |
| HTTP 路由 | kebab-case | `/api/git-push/scan-comment-residue` |
| 规则 kind 值 | kebab-case | `repeated-string` / `max-depth`（现有约定不变） |

**格式转换规则**（同一根词 `comment-residue-scan`）：
- camelCase：`commentResidueScan`
- snake_case：`comment_residue_scan`
- kebab-case：`comment-residue-scan`
- PascalCase：`CommentResidueScan`

### 4.2 更名映射（全链路，无别名）

**新名**：`comment-residue-scan`（注释残留扫描）——准确描述「扫 AI 交流残留注释」，与「全量审计 auditFull」彻底区分。**对外 API 与函数名完全一致，不保留任何旧名别名**。

| 现状 | 更名后 | 位置 |
|---|---|---|
| `fullScanRepo` | `commentResidueScanRepo` | lib/full-scan.js |
| `compileFullScan` | `compileCommentResidueScan` | lib/full-scan.js |
| `FULLSCAN_DEFAULTS` | `COMMENT_RESIDUE_DEFAULTS` | lib/full-scan.js |
| 服务字段 `fullScan` | `commentResidueScan` | lib/plugin-audit.js 返回对象 |
| yml 段 `fullScan` | `comment-residue-scan` | rule-packs.js 编译 |
| import 名 `fullScan` | `commentResidueScan` | lib/audit.js / plugin-audit.js / plugin-http.js / plugin-tools.js / index.js |
| 工具 `audit_full_scan` | `scan_comment_residue` | plugin-tools.js registerAgentTools |
| 路由 `GET /api/git-push/full-scan` | `GET /api/git-push/scan-comment-residue` | plugin-http.js handleScan |
| 规则包 `rs.fullScan` 字段读取 | `rs['comment-residue-scan']` | audit.js / plugin-audit.js |

### 4.3 外部 API 兼容策略（破坏性更名）

- **工具 `audit_full_scan` → `scan_comment_residue`**：对外工具名是**破坏性变更**——旧调用方（AI 会话/外部脚本）会失效。对策：随 v1.61.0 发布，README 变更说明 + 工具 description 明示新名；旧名不设别名（命名完全一致）。
- **路由 `/full-scan` → `/scan-comment-residue`**：同上，破坏性；README API 表同步。
- **内部字段读取兼容**：`rs['comment-residue-scan']` 为空时回退读旧 `rs.fullScan`（**仅数据兼容，不提供函数/工具别名**）——保证已配 yml 老用户升级不炸，但新代码一律用新名。

---

## 五、外部审计报告辩证核对（2026-09-09，来源 docs/code-quality-audit-2026-09-09.md）

> 第三方针对方（Agnes-2.5-Flash）出具的 v1.59.0 质量审计报告，逐条实测核对。
> **决策：不做即时清理，核对结论全部列入本重构计划实施。**

### 5.1 核对结论总表（实测 vs 报告）

| 报告声明 | 实测结果 | 判定 |
|---|---|---|
| 超长函数 9 处（行号/函数名全列） | ✅ 9/9 精确命中（inject 97 / attachQualityScore 59 / renderViewerPage 63 / apply 67 / GitPushRuleCards 66 / registerSettings 61 / registerHttpApi 57 / extractComments 55 / auditRepo 52） | **属实，高可信**（证明报告确实通读了代码） |
| `repo-index.js:291` 导出未使用 `execSync` | ✅ import 后仅 re-export，内部无调用 | **属实，行动项** |
| `readme-gen.js:166` 真空 `catch {}` | ✅ 确认（quality.js:167 是注释示例非真 catch，真真空仅此 1 处） | **属实，行动项** |
| `plugin-http.js:24` `execSync('git --version')` | ✅ 确认 | **属实，行动项（低）** |
| 空 catch **42 处** | ⚠️ **实测 84 处**（`catch {` 全量）——**报告少报一半** | **数字错误，实际更严重** |
| core.js 拆分前 **2714 行** | ⚠️ 任务清单 v1.42.0 记录 **2511 行** | **数字错误，来源不可考** |
| test-rule-packs 正文 **27 项** | ⚠️ 表格写 66 项，实测 66 项——**报告自身前后矛盾** | **数字错误** |
| 测试总数 **529 项** | ⚠️ **实测 528 项**（14 套含 rules 16 + env-inject 9；full-scan 实 28 报告 29、cli 实 8 报告 9） | **数字错误（差 1）** |
| README 版本表停在 v1.53.0 | ❌ **v1.60.0 已更新至 1.60.0**（7 条补齐 + 当前标记清理） | **过时项，已解决** |
| docs/ 多份重复质量报告 | ✅ 确认 4 份中文/英文质量报告并存（代码评估-…/代码质量分析-…-glm/代码质量分析报告/CODE-QUALITY-ANALYSIS-…08） | **属实，行动项** |
| docs/1.js「疑似误入库应删除」 | ⚠️ 它是历史参考工具（15KB JS），**被审计排除是有意设计**（docs/ 过滤），非误入库 | **判断不采纳** |

### 5.2 口径差异说明（报告 88 vs 引擎 77）

- **报告综合 88**：人工主观 10 维度打分（可读 88/可维护 90/健壮 85/性能 83/安全 90/测试 82/可观测 78/部署 88/文档 85/DX 90）——**不可复现**
- **引擎自评 77**：自家 scoreQuality 自动评分（func-lines 分级加权 + docs/test 排除，listTextFiles 103 文件全量）——**可复现**
- 差异根源：报告给「可读性 88」，引擎因 10 个 50-97 行函数只给 5/10；报告「文档 85」，引擎扣 README 硬编码路径
- **结论：两份都是「估」，引擎口径可复现、报告口径主观——以后统一用引擎口径作为自评基准**

### 5.3 纳入本重构计划的行动项（按优先级，用户已定不做即时清理）

| # | 行动项 | 来源 | 纳入实施步骤 |
|---|---|---|---|
| 1 | 移除 `repo-index.js:291` 未使用 `execSync` 导出 | 报告属实 | 阶段 B-9 |
| 2 | `readme-gen.js:166` 真空 catch 加 log | 报告属实 | 阶段 B-9 |
| 3 | `plugin-http.js:24` execSync→spawnSync（一致性） | 报告属实 | 阶段 B-9 |
| 4 | docs/ 4 份重复质量报告清理（并 1 份保留 code-quality-audit-2026-09-08.md） | 报告属实 | 阶段 B-11 |
| 5 | 空 catch 83 处分级策略（真空必加 log；防御性注释 catch 保留或 debug 级，防噪声） | **报告数字修正**（42→83） | 阶段 B-11，需先讨论策略 |
| 6 | 后续「可观测性指标」：/api/git-push/metrics 端点（audit/push/blocked/ssh_fallback 计数） | 报告属实 | 后续版本（v1.62.0+），不在本批 |

### 5.4 不采纳项（记录原因）

| 报告建议 | 不采纳原因 |
|---|---|
| 删除 docs/1.js | 历史参考工具，审计排除是有意设计（docs/ 过滤），非误入库 |
| README 版本表补齐 | v1.60.0 已补齐至 1.60.0，报告基于旧快照 |
| 空 catch 42 处全加 log.warn | 数字本身不准（实为 84），且防御性 catch 全加 log 产生海量噪声——需分级策略（见 5.3 #5） |

---

## 五B、外部报告 B 辩证核对（docs/code-analysis-2026-09-09.md，三个子代理并行分析）

> **决策：与报告 A 同处理——不做即时清理，核对结论列入重构计划。**

### 5B.1 核对结论总表（实测 vs 报告 B）

| 报告 B 声明 | 实测结果 | 判定 |
|---|---|---|
| 空 catch `catch {` **84 处** | ⚠️ **83 处**（差 1，口径接近；报告 A 说 42 是错的，B 更准） | **基本属实** |
| `catch (e)` **3 处** | ⚠️ **54 处**（报告 B 少报 51 处——大量 catch(e) 被漏计） | **数字错误** |
| 同步 fs **133 处** | ⚠️ **201 处**（六类文件全量 grep 计数）——**报告少报 68 处** | **数字错误，实际更严重** |
| 分文件同步 fs：token-credentials 12 / ignore-scan 15 / audit 14 / repo-scan 7 / workspace 12 / full-scan 6 | ⚠️ 实测 27 / 17 / 14 / 9 / 14 / 7 | **分文件数字偏低**（audit 14 恰好对，其余全低） |
| 死导入 `ignore-scan.js:4` commitAndPush 未使用 | ✅ 确认 import 但未见调用 | **属实，行动项** |
| `core.js:37` 意外重导出 `readdirSync` | ✅ 确认（门面 re-export fs 函数，非模块职责） | **属实，行动项** |
| `plugin-config.js:44-45` auditRuleWeights **重复定义** | ✅ 确认（L33 + L45 两处 `z.dict(z.any()).default({})`） | **属实，行动项** |
| `/tmp` 路径可预测（token-credentials.js:128 PID 拼接） | ✅ 确认（`dsh-git-push-known-hosts-probe-${process.pid}`） | **属实，低风险** |
| `commitMany` 串行（commit-push.js:293-299） | ✅ 确认 for 循环 await 串行 | **属实，可改 allSettled 并行** |
| `viewer.js` 逐 commit 逐文件调 `git diff --numstat` | ✅ 确认（viewer.js:68 在循环内 runGit） | **属实，性能点** |
| 测试文件 **16 个 mjs** | ❌ **实测 14 个**（report B 多报 2；14 套含 rules 16 断言 + env-inject 9 断言） | **数字错误** |
| 覆盖率「**60% 模块有测试**」（12/20） | ⚠️ lib/ 实为 36 个 JS 文件，有直接测试约 12 个模块——**覆盖率口径模糊**（很多模块经 core.js 门面间接覆盖） | **口径问题** |
| 测试 mock「仅 test-apply」 | ✅ 确认（grep mock 仅 test-apply.mjs 命中） | **属实** |
| README **219 行** | ✅ 精确命中 | **属实（行数准）** |
| LICENSE / CONTRIBUTING.md / CHANGELOG.md 缺失 | ✅ 确认三文件均不存在 | **属实，行动项** |
| skills **21 个 skill 文件** | ✅ 实为 **22 个**（find 全量含子目录） | **基本属实（差 1）** |
| github-api 495 / audit 1066 / token-credentials 462 / client 1039 行 | ✅ **全部精确命中** | **属实（行数准）** |

### 5B.2 报告 B 独有、值得纳入计划的新行动项

| # | 行动项 | 来源 | 判定 |
|---|---|---|---|
| B1 | 死导入清理：ignore-scan.js:4 commitAndPush / core.js:37 readdirSync 重导出 | 报告 B P1 #4/#6 | ✅ 属实，纳入 |
| B2 | 重复定义修复：plugin-config.js auditRuleWeights（L33/L45 合并） | 报告 B P1 #5 | ✅ 属实，纳入 |
| B3 | 缺失标准文件：LICENSE / CONTRIBUTING.md / CHANGELOG.md / docs/README.md | 报告 B P4 | ✅ 属实，需决策（是否开源许可、采用何种） |
| B4 | commitMany 并行（Promise.allSettled） | 报告 B P2 #9 | ✅ 属实，低风险 |
| B5 | viewer.js 逐 commit 逐文件 numstat 合并批量 diff | 报告 B P0 #3 类 | ⚠️ 属实但改动中（viewer 数据层），列入后续 |
| B6 | 同步 fs 201 处（非报告 133）改 fs.promises 关键路径 | 报告 B P0 #1 | ⚠️ **数字修正后**：关键路径（commitAndPush/auditRepo/scanRepos）优先改异步，其余分级 |
| B7 | 测试框架统一 node:test + mock 补充 | 报告 B P3 | 中/大工作量，列入后续版本评估 |
| B8 | 14 个无直接测试模块（git-core/github-api/token-credentials/commit-push 等核心）补测 | 报告 B P3 #11 | 中/大工作量，列入后续 |

### 5B.3 不采纳/待议项

| 报告 B 建议 | 判定 |
|---|---|
| `client.js` 考虑 JSX 编译（P5 #20） | 不采纳：手写 createElement 是 DSH 客户端无 bundler 约束下的正确选择（已评估） |
| `audit.js` 拆到 audit-checks/（P5 #19） | 部分采纳：本设计稿第 3 节统一加载器已含 checkStyleRules 拆分路径，audit.js 拆分并入 v1.62.0 评估 |
| LICENSE 采用开源许可 | **待确认**（仓库私有，是否开源、MIT/Apache 2.0） |

---

## 五C、外部报告 C 辩证核对（docs/代码不足分析报告-2026-09-09-实测版.md，独立实测版）

> 第三份外部报告，自称「独立实测——运行测试/CLI/审计工具、逐文件读关键模块、grep 统计」，基线 v1.60.0（commit 9d1c9bf）。
> **用户决策：与报告 A/B 同处理——核对结论列入重构计划。**

### 5C.1 核对结论总表（实测 vs 报告 C）

**报告 C 是三份里最扎实的：P0 全中、P2 全中、仅 P1-1 同步 fs 数字偏低。**

| 报告 C 声明 | 实测结果 | 判定 |
|---|---|---|
| **P0-1** js-yaml 幽灵依赖：3 处静态 import、package.json 无 dependencies 段 | ✅ 确认：audit.js:23 / readme-gen.js:10 / rule-packs.js:36 三处 `import { load } from 'js-yaml'`；package.json 只有 peerDependencies，无 dependencies/devDependencies | **属实，P0 真问题**——npm 安装即 ERR_MODULE_NOT_FOUND |
| **P0-2** `npm test` 失败（`node --test test/` 目录模式不匹配 test-* 前缀） | ✅ 确认：实测 `npm test` 报 `Cannot find module '…/test'` / 'test failed' | **属实，P0 真问题**——CI/新环境不可复现 |
| **P0-3** CLI `--depth` 帮助文本承诺、实现缺失 | ✅ 确认：`node cli.mjs scan --depth 2` 报「未知参数」；parseArgv L32-52 无 --depth 白名单 | **属实，P0 真问题**——功能虚假宣传 |
| **P0-4** 自家审计规则拦自家文档（docs-conversation 6 blocker 积压） | ✅ 确认：实测 9 个 blocker（report C 写 6 个，数字略偏但问题真实） | **属实，已亲历并修复** |
| **P1-1** 同步 fs 130 处 | ⚠️ **实测 204 处**（报告少报 74）；spawnSync 9 文件精确命中；gitRaw 超时 600s/maxBuffer 128MB 确认 | **数字偏低，问题更严重** |
| **P1-2** HTTP 写操作端点无鉴权（commit/rebuild/remote-create/gen-ssh-key/permit-config） | ✅ 确认：plugin-http.js 5 个写端点无 token/session/Origin 校验 | **属实，P1 安全短板** |
| **P1-3** 插件接线层 1606 行零测试（22/35 文件无测试 import） | ✅ 确认：plugin-http/tools/setup/commit-flow/push-permit/client/llm 等无直接测试 | **属实，P1 覆盖断层** |
| **P1-4** 静默 catch 21 处无日志 | ⚠️ catch { 实测 **83 处**、带 log 的 0 处——报告 C 的 21 是「清单摘录」，实际更广 | **数字偏低，问题更严重** |
| **P1-5** 超大文件（audit.js 1066/client.js 1039）+ **正则应试化**（client.js:2-4 自述参数去括号迁就 fnStart 正则） | ✅ 确认：audit.js 1066 行；client.js:2-4 注释确实自述「纯语法等价改写迁就函数行数计数」 | **属实——「应试改写」是重要洞察** |
| **P2-3** check 脚本硬编码 11 个文件漏 24 个 | ✅ 确认：scripts.check 硬编码 11 个 lib 文件，lib/ 共 34 个 | **属实，P2** |
| **P2-4** docs/1.js 杂物入库 | ⚠️ 确认被 git 跟踪，但它是历史参考工具——**与报告 A 同判定：不采纳删除**（保留待议） | **不采纳** |
| **P2-7** .git/config origin URL 内嵌明文 token | ✅ 确认 git remote -v 显示 `https://ghp_…@github.com/…` | **属实，P2 凭据卫生**（不入库但会泄漏） |
| **P2-8** README 66737 字节巨型单文件 | ✅ 精确命中 | **属实，P2** |
| **P2-9** skip-sensitive 豁免整文件免疫盲区 | ✅ 确认：test-audit.mjs 等文件头带标记整文件豁免 | **属实，P2 设计盲区** |

### 5C.2 报告 C 独有、纳入计划的新行动项（P0 级优先！）

| # | 行动项 | 等级 | 实测证据 | 修复成本 |
|---|---|---|---|---|
| C1 | **package.json 补 `dependencies: { js-yaml: '^4.1.0' }`**（消除 P0-1） | 🔴 P0 | 3 处 import / 0 声明 | 5 分钟 |
| C2 | **`npm test` 脚本修 `node --test test/*.mjs`**（消除 P0-2） | 🔴 P0 | 实测 MODULE_NOT_FOUND | 5 分钟 |
| C3 | **CLI parseArgv 补 `--depth` 解析**（消除 P0-3）+ test-cli 补断言 | 🔴 P0 | 实测「未知参数」 | 10 分钟 |
| C4 | **HTTP 写端点鉴权**：Origin 校验 / X-DSH-CSRF 头 / 高危端点确认参数 | 🟠 P1 | 5 个写端点裸奔 | 中 |
| C5 | **check 脚本 glob 化**：`for f in lib/*.js cli.mjs; do node --check $f; done` | 🟡 P2 | scripts.check 硬编码 11/34 | 5 分钟 |
| C6 | **静默 catch 补日志**（83 处分级：凭据/规则/注入类 warn，其余 debug） | 🟠 P1 | grep 清单 | 低 |
| C7 | **origin remote 去 token 化**（改 SSH remote 或 credential.helper） | 🟡 P2 | git remote -v 实测 | 10 分钟 |
| C8 | **README 巨型化**：版本表拆 HISTORY.md，README 只留最近 3-5 条 | 🟡 P2 | 66737 字节 | 低 |
| C9 | **skip-sensitive 豁免粒度**：整文件豁免改按行/按规则 | 🟡 P2 | test-audit.mjs:1 | 低 |
| C10 | **测试框架统一 node:test**（2 个 node:test + 12 个手写双轨） | 🟡 P2 | 2 vs 12 | 中（持续） |
| C11 | **正则应试化修正**：client.js 语法迁就说明 + 函数计数改 AST 解析 | 🟠 P1 | client.js:2-4 自述 | 中 |

### 5C.3 不采纳项

| 报告 C 建议 | 判定 |
|---|---|
| 删除 docs/1.js（P2-4） | 与报告 A 同：历史参考工具，审计排除是有意设计，保留待议 |
| P1-5「WORKBOARD 未勾选项全未完成」 | 部分不实：看板多数项已勾选完成（子代理串行验收），仅 warning 级 10+ 函数有意保持现状 |

---

## 六、实施步骤（定稿后执行顺序）

> 每步独立可测。**P0 确定性缺陷（报告 C 实测复现）最先修**，随 v1.61.0 一起发布。

### 阶段 0：P0 确定性缺陷修复（报告 C 实测复现，「现在就会坏」）

0.1. **js-yaml 依赖声明**（C1）：package.json 补 `"dependencies": { "js-yaml": "^4.1.0" }`（peerDeps 保持）；cli.mjs 帮助文本「零第三方依赖」改为「仅 js-yaml 一个第三方依赖」
0.2. **npm test 脚本修复**（C2）：`"test": "node --test test/"` → `"node --test test/*.mjs"`（实测 Node 24 目录模式不匹配 test-* 前缀）
0.3. **CLI --depth 补全**（C3）：parseArgv 加 `else if (a === '--depth') flags.depth = argv[++i]`；test-cli 补断言
0.4. **文档积压处理**（C4/P0-4）：DESIGN-2026-09-09 等文档措辞已改写中性表述（已完成），随本批提交

### 阶段 A：统一规则加载器 + fullScan 更名（核心重构）

1. **注册表骨架**：新增 `RULE_COMPILERS` / `registerCompiler` / `compileRule`（纯新增，不碰现有函数）
2. **7 函数改名 + 注册**：CredRef→CredentialRef 等 4 个改名；detect 条件从现有函数逐行提取；`compileRuleBuckets` 换循环
3. **numeric 拆 6**：`compileNumericRule` 按字段拆成 6 个独立函数（min-length/max-lines/max-complexity/max-depth/min-occurrences/repeated-string），各自注册
4. **path-regex 字段化**：`compileRegexRule` 的 kind 特判改为 `path_pattern` 字段探测（新增 compilePathRegexRule）
5. **测试**：test-rule-packs 66 断言应全过（行为不变）；新增断言——未知字段组合报错、显式 kind 优先、repeated-string 双分支（有无 ignore）
6. **fullScan 更名**：内部函数/变量/服务字段/工具名/路由**全链路更名**（comment-residue-scan 根词各层格式），无别名；仅内部数据读取兼容旧 yml 段名
7. **文档**：模板 yml 示范显式 kind；README 版本表 v1.61.0；任务清单批次 22；看板更新
8. **回归**：全量 14 套（不含 test-apply 跳过）+ 提交门禁自审计（0 blocker）+ 双副本同步 + 推送

### 阶段 B：外部报告行动项（A/B/C 三份报告的属实项，低风险清理）

9. **低风险清理（报告 A 行动项 1-3）**：repo-index.js 未用 execSync 移除 / readme-gen.js:166 catch 加 log / plugin-http.js execSync→spawnSync——各自补断言或至少 node --check
10. **死代码清理（报告 B B1-B2）**：ignore-scan.js:4 死导入 commitAndPush 删除 / core.js:37 readdirSync 重导出移除 / plugin-config.js auditRuleWeights 重复定义合并（L33/L45）
11. **docs 清理 + 空 catch 策略（报告 A/B/C 行动项）**：4 份重复质量报告并入保留 1 份；空 catch 分级策略**先讨论后实施**（真空加 log / 防御性 catch 分级 / catch(e) 54 处排查 / 报告 C：83 处分级 凭据/规则/注入类 warn 其余 debug）
12. **check 脚本 glob 化（报告 C C5）**：`"check"` 脚本硬编码 11 个文件 → `for f in lib/*.js cli.mjs; do node --check $f; done`——消除漏 24 个文件盲区
13. **package.json 元数据补全（报告 B B3 + C C1 延伸）**：license / repository / author / keywords + dependencies.js-yaml

### 阶段 C：鉴权 + 并行优化（待确认后实施）

14. **HTTP 写端点鉴权（报告 C C4）**：Origin 校验 / X-DSH-CSRF 头 / 高危端点（rebuild/gen-ssh-key/commit）加确认参数
15. **standard 文件（报告 B B3）**：LICENSE / CONTRIBUTING.md / CHANGELOG.md / docs/README.md——**需先确认开源策略**
16. **commitMany 并行（报告 B B4）**：for 串行改 Promise.allSettled，补测试
17. **同步 fs 204 处分级（报告 B B6 / C C-P1-1，数字修正 133→204）**：关键路径（commitAndPush/auditRepo/scanRepos）优先改 fs.promises，其余分级——**先讨论后实施**
18. **origin remote 去 token 化（报告 C C7）**：git remote 改 SSH（github-ssh 已就绪）或 credential.helper——防 .git/config 明文 PAT 泄漏

### 阶段 D：后续版本（v1.62.0+ 评估）

19. viewer.js 批量 numstat 合并（B5）/ 核心模块补测（B7-B8）/ audit.js 拆分 audit-checks/（见 5B.3 部分采纳）/ metrics 端点（A #6 → 阶段 D）/ 测试框架统一 node:test（C10）/ 正则应试化 AST 修正（C11）/ 测试覆盖断层补测（C-P1-3）/ skip-sensitive 豁免粒度（C9）/ README 拆 HISTORY.md（C8）

---

## 七、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| numeric 拆 6 改变某规则编译结果 | 中 | 中 | 拆时逐条对照原 compileNumericRule 输出；test-rule-packs 66 断言锁定 |
| 未知规则从「静默跳过」变「报错」影响存量 | 低 | 中 | 实施前跑全量 findings 对比，确认无存量未知规则 |
| fullScan 更名漏改触点 | 中 | 中 | 更名前 grep 全触点（已盘点 15+ 处）；node --check + 全量测试兜底 |
| semantics 探测条件误报 | 低 | 低 | 保持现逻辑不变，仅收敛为注册表条目 |
| 工具/路由破坏性更名影响旧调用方 | 中 | 中 | **已决策对外 API 与函数名完全一致（无别名）**——随 v1.61.0 发布，README 变更说明 + description 明示新名；数据层（yml 段名）回退兼容兜底升级不炸 |

---

## 八、待办确认（实施前需确认）

1. ~~kind 三方案~~ ✅ 已定：不写 kind，字段探测指派
2. ~~fullScan 新名~~ ✅ 已定：`comment-residue-scan`（根词，各层格式转换），**对外 API 与函数名完全一致、无别名**（工具 → `scan_comment_residue`，路由 → `/scan-comment-residue`）
3. **numeric 拆 6 确认**：6 个独立函数（推荐）——待最终确认
4. **实施节奏**：随 v1.61.0 一次性落地，还是拆两个版本（先统一加载器、后 fullScan 更名）？
5. **根词确认**：`comment-residue-scan` 作为根词可以吗？还是偏好 `residue-scan`（更短）？
6. **空 catch 分级策略**（外部报告 A/B/C 行动项）：真空 catch 必加 log；83 处 `catch {` + 54 处 `catch (e)` 如何处理——统一加 warn（有噪声）/ 保留现状 / debug 级——实施前需确认
7. **docs 清理范围**（外部报告 A 行动项）：4 份重复质量报告并 1 份（保留 code-quality-audit-2026-09-08.md），确认后执行
8. **标准文件补建**（外部报告 B B3）：LICENSE / CONTRIBUTING.md / CHANGELOG.md / docs/README.md——**需确认开源策略**（仓库私有：MIT/Apache 2.0/暂不加 LICENSE？）
9. **同步 fs 204 处分级**（外部报告 B B6 + C P1-1，数字修正 133→204）：关键路径优先改 fs.promises，其余分级——改造范围需确认（先关键路径 or 全量）
10. **HTTP 写端点鉴权**（报告 C C4）：Origin 校验 / X-DSH-CSRF 头 / 高危端点确认参数——实施范围需确认（全端点 or 仅写操作）
11. **origin remote 去 token 化**（报告 C C7）：改 SSH remote（github-ssh 已就绪）或 credential.helper——执行方式需确认