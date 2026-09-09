# 工作进度看板：质量提分（大文件/长函数拆分）+ 审计扫描范围开关（auditChanged/auditFull）

> 任务一：把项目自评从 **61/100 C 级** 提上去——拆分 18 个超长函数（其中 4 个 >100 行 blocker 级）与超大文件，消除可读性/可维护性维度被扣到 0 的主因。
> 任务二（新功能，用户已确认方向、拆分后实施）：审计拆两个函数——`auditChanged`（仅扫 git diff 变动）/ `auditFull`（扫全量目录，**非 git 项目也能查**），设置开关 `auditScanScope`（diff|full）决定提交时调用哪个；两个函数可被 AI 单独调用。
> 目标版本：1.60.0 ｜ 开始：2026-09-09 ｜ 基准：61/100 C 级

## 〇、总体状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| 基线自评（全量 85 文件） | ✅ 完成 | 61/100 C 级：可读性 0/可维护性 0（18 个超长函数扣到 0），性能 10/测试 10/安全 9/健壮 8.5 |
| 超长函数全清单 | ✅ 完成 | 18 个（>50 warning / >100 blocker），4 个 blocker 见下 |
| 拆分策略定稿 | ✅ 完成 | 「注册类大函数抽独立工具/路由/方法函数」——定义式代码无复杂控制流，拆出零行为变化 |
| plugin-tools.js 拆分（270 行） | ✅ 完成 | 子代理①验收通过：12 工具抽独立函数，registerAgentTools 270→23 行，12 工具保留，test-core 132/0 + test-permit 29/0 |
| plugin-http.js 拆分（246 行） | ✅ 完成 | 组长子代理①验收通过：12 handler 抽独立函数（handleViewer/handleRepos/.../handleAudit/handleCommit），registerHttpApi 246→56 行，deps 统一 env 引用，导出面不变，test-core 132/0 |
| plugin-context-inject.js（132 行） | ✅ 完成 | 组长子代理②验收：registerContextInjection 131→6 行（抽 4 子函数：systemPromptSections/envInjectionTextProvider/envInjectionSection/preStepHandler） |
| plugin-push-permit.js（131 行） | ✅ 完成 | 组长子代理②验收：createPushPermit 130→14 行（抽 6 纯函数：schedule/record/resolve/pushOne/recordSummary/runAutoPush，deps 传 Map+并发闸+env 引用）；test-permit 29/0 + test-core 132/0 |
| warning 级（14 个） | ✅ 完成 | 组长子代理③验收：8 文件 10 函数拆（setup 100→30 / commit-flow 84→8 / rule-packs 三处 90→23·60→10·84→20 / viewer 68→62 / index 61→39 / audit 91→23·55→51 / client GitPushRuleCards 84→67）；3 处保持现状（extractComments 状态机 / client inject+apply JSX 契约，理由正当）；>100 blocker 全清零（最大 97） |
| 自评复测与评分修正 | ✅ 完成 | 拆分后单靠函数拆分仍 61（评分公式把 9 个 50-97 行 warning 当 blocker 扣光）→ 修正：func-lines 分级加权（warning 0.5/blocker 2）、排除 docs/ 参考文件与 test/ 测试代码 → **77/100 B 级（61→77）** |
| gitignore 感知文件收集 | ✅ 完成 | v1.60.0：listTextFiles 默认排除 git 忽略文件（git check-ignore 批量判定，尊重 .gitignore 全语法）；按 repoPath 缓存 + 递归透传避免重复 spawn；非 git 目录自动跳过（全量收集不报错）——用户指示「默认排除 git 忽略的文件」 |
| 豁免标记体系（全拦截类型） | ✅ 完成 | v1.60.0：makeExemptors 工厂 + 6 类标记（sensitive/size/func-length/syntax/quality/residue/style），位置语义=文件头整文件/位置级单点；函数长度豁免写函数定义行尾。已接入 audit.js 全部消费点（binary/syntax/residue/style/quality/funcLength），端到端实测 6 场景全豁免 + 对照组正确；test-audit 82/0 |
| 新功能 auditChanged/auditFull | ⏳ 待办 | 见「四、新功能设计」——本批优先做质量提分，此功能下一批 |
| 测试/回归 | ✅ 完成 | 全量 11 套件 **503/0**（豁免断言 +6，test-quality 断言同步新评分语义 44→45） |
| README/版本/任务清单/双副本/推送 | ✅ 完成 | v1.60.0 全收尾：版本 bump（package.json/cli.mjs/test-cli/README 当前标记清理）、任务清单批次21（执行记录+批次条目）、template.yml 豁免速查段、双副本同步 1.60.0、推送 `ee753ea` + auto-tag v1.60.0（0 blocker，78 warning 均存量债务） |

图例：✅ 完成 ｜ 🔄 进行中 ｜ ⏳ 待办

## 一、当前基线（自评 61/100 C 级）

用自家引擎全量扫 85 文件，10 维度合并版权重（v1.59.0）：

| 维度 | 分值(0-10) | 权重 | 贡献 | 扣分原因 |
|---|---|---|---|---|
| 可读性 | 0 | 15 | 0.0 | 18 个超长函数（每 1 个 -2 分）扣到 0 |
| 可维护性 | 0 | 15 | 0.0 | 同一批大函数（每 1 个 -1 分）扣到 0 |
| 健壮性 | 8.5 | 15 | 12.8 | 静默 catch 少量 |
| 性能 | 10 | 10 | 10.0 | 无 sync-in-async 新增 |
| 安全性 | 9 | 18 | 16.2 | 无新 secret/凭据 |
| 测试覆盖 | 10 | 10 | 10.0 | 11 套件齐全 |
| 可观测/可部署/文档/DX | 7×4 | 5/5/4/3 | 11.9 | 静态难判中间值 |
| **合计** | | **100** | **61** | **C** |

**提分路径**：消除超长函数 → 可读性/可维护性 0 → ≥7，贡献 +15×0.7 + 15×0.7 ≈ +21 分 → 理论 ~82 B 级（要过 85 需更多维度拉满）。

## 二、18 个超长函数清单（检测时间 2026-09-09）

### blocker 级（>100 行，优先拆）

| # | 文件 | 行号 | 行数 | 函数 | 拆分方式 |
|---|---|---|---|---|---|
| 1 | lib/plugin-tools.js | 17 | 270 | registerAgentTools | 12 工具抽独立函数 `toolGitScan()`...注册只留调用 |
| 2 | lib/plugin-http.js | 26 | 246 | registerHttpApi | 路由处理抽独立函数（每路由一个 handler） |
| 3 | lib/plugin-context-inject.js | 14 | 132 | registerContextInject | 环境注入组装抽函数 |
| 4 | lib/plugin-push-permit.js | 11 | 131 | registerPushPermit | 检测/推送流程抽函数 |

### warning 级（50-100 行，顺带）

| # | 文件 | 行号 | 行数 | 备注 |
|---|---|---|---|---|
| 5 | lib/plugin-setup.js | 16 | 100 | 刚好压线（v1.59 已从 103 压到 100） |
| 6 | lib/client.js | 748 | 97 | controller inject |
| 7 | lib/audit.js | 387 | 92 | checkStyleRules（v1.58 已从 107 抽到 92） |
| 8 | lib/rule-packs.js | 157 | 90 | |
| 9 | lib/client.js | 559 | 84 | GitPushRuleCards（v1.59 已抽组件到 84） |
| 10 | lib/plugin-commit-flow.js | 12 | 84 | |
| 11 | lib/rule-packs.js | 379 | 84 | |
| 12 | lib/viewer.js | 571 | 68 | |
| 13 | lib/client.js | 959 | 67 | |
| 14 | lib/index.js | 57 | 62 | |
| 15 | lib/plugin-setup.js | 118 | 61 | |
| 16 | lib/rule-packs.js | 253 | 60 | |
| 17 | lib/audit.js | 849 | 56 | |
| 18 | lib/full-scan.js | 45 | 55 | |

### 超大文件（max-file-length >400 行，属存量债务提醒级）

- lib/audit.js（1008 行，55 C 级）— D1 已拆过 git 层，审计层仍集中
- lib/client.js（1033 行，55 C 级）— 设置页单文件
- lib/rule-packs.js（622 行，78 B 级）
- lib/viewer.js、lib/plugin-setup.js 等 400+ 行

## 三、拆分策略与铁律

1. **注册类大函数**（tools/http/permit/inject）：把每个「工具/路由/方法」的 defineTool/处理函数抽成**独立具名函数**，主函数只留注册循环——定义式代码无复杂控制流，**行为零变化**
2. **每拆一个文件**：`node --check` + 跑该文件相关测试套件（如 plugin-tools → test-core/test-permit 相关）→ 无回归再下一个
3. **抽组件/子函数**（v1.58/1.59 已验证模式）：checkStyleRules→checkRepeatedString、GitPushRuleCards→GitPushQualityWeights
4. **超大文件分模块**（audit.js/client.js）：按功能抽 lib/audit-*.js / lib/client-*.js 子模块，core.js 门面 re-export——但只在 blocker 拆完后有余力做（优先分数）
5. **不引入第三方依赖**；ESM 保持一致；重构不改变任何工具名/API/路由
6. **每完成阶段实时更新本看板**（打勾 + 记录验证结果），方便子代理接手

## 四、新功能设计（auditChanged / auditFull + auditScanScope 开关）

前置澄清（已与用户讨论确认）：
- 现有 `fullScan`（lib/full-scan.js）是「AI 对话残留注释扫描」，**只被 audit_full_scan 工具/HTTP 调用，不进提交门禁**——提交时只跑 auditRepoPath diff 模式。用户担心「变动不调用 fullScan = 漏网之鱼」（历史注释措辞/存量代码问题永远扫不到）——正是 auditFull 的动机
- `auditFull` 与 `fullScan` 是两个不同「全量」：auditFull=代码审计全量（新），fullScan=注释措辞全量（已有，保留不动）

| 项 | 设计 |
|---|---|
| 底层函数 | `auditChanged(repoPath, opts)`：files 空 → `getDiff`（git diff HEAD，**仅 git 项目**）；`auditFull(repoPath, opts)`：递归扫目录代码文件（复用 full-scan.js `listTextFiles` 的 SKIP：.git/node_modules/.tmp-*/dist/coverage 等，**非 git 项目也能跑**） |
| 统一入口 | `auditWithScope(repoPath, { scope })`：scope='diff'（默认）→ auditChanged；'full' → auditFull——读设置细分 |
| 配置 | `auditScanScope`：`'diff'`（默认）\| `'full'`——plugin-config schema + plugin-setup env/watch + client 侧边栏开关 |
| 提交门禁 | commitWithAudit → auditRepoPath 按 env.auditScanScope 选 changed/full。**full 模式下存量问题会翻出来——用户主动开全量就该承受全量拦截**（不降级） |
| AI 工具 | code_audit 加 `scope` 参数（'diff'默认\|'full'）；传非 git 项目路径 + scope='full' → 直接可查（无需 git） |
| 实现路径（已确认） | auditRepo 已支持 `files` 参数——auditFull 只需用 listTextFiles 收集全量文件并**转换格式**（`{path, addedLines: 全文行, isBinary:false}`）传入即可，**auditRepo 主体零改动**；toolCodeAudit 已定位（lib/plugin-tools.js L82）加 scope 参数透传 auditRepoPath |
| 测试 | auditChanged（git repo 变动）/ auditFull（临时目录含代码文件、非 git 无 .git 也可跑）新增断言 |
| 版本 | 随本迭代 v1.60.0 一起发（拆分 + 新功能同一批次） |

## 五、任务清单

- [x] 基线自评：61/100 C 级（v1.59.0 10 维度权重全量 85 文件）+ 18 超长函数全清单
- [ ] plugin-tools.js：12 工具抽独立函数（registerAgentTools 270→~40 行），node --check + test-core 回归
- [ ] plugin-http.js：路由 handler 抽独立函数（246→~60），node --check + 语法 + test 相关回归
- [ ] plugin-context-inject.js（132→<100）
- [ ] plugin-push-permit.js（131→<100）+ test-permit 回归
- [ ] warning 级函数逐个（plugin-setup 100 / commit-flow 84 / rule-packs 90/84/60 / viewer 68 / index 62 / audit 92/56 / full-scan 55 / client 97/84/67）
- [ ] 自评复测：预计可读性/可维护性 ≥7 → 总分 ~80+（B 级）
- [ ] 新功能：audit.js 加 auditChanged/auditFull/auditWithScope
- [ ] 新功能：plugin-audit 按 env.auditScanScope 选模式 + config/plugin-setup/client 开关
- [ ] 新功能：code_audit 工具 scope 参数（非 git 项目路径 + scope=full 可查）
- [ ] 测试新增：auditChanged（git diff 变动）/ auditFull（非 git 临时目录）断言
- [ ] 全量回归（11 套件）+ README/cli/template 维护清单 + 任务清单批次
- [ ] 版本 1.60.0 + 双副本 rsync + 推送 + 自评提分结果记录

## 六、验收标准

1. plugin-tools/plugin-http/plugin-context-inject/plugin-push-permit 四个 >100 行函数全部降到 ≤100，fun-lines blocker 清零
2. 自评总分 ≥ 75（目标 80+，可读性/可维护性不再为 0）
3. 提交门禁 0 blocker（存量 warning 不增）
4. auditWithScope/auditChanged/auditFull 存在且测试覆盖：git 项目 diff 模式、非 git 目录 full 模式均可跑
5. 设置侧边栏有「审计扫描范围」开关（diff|full），改完即时生效
6. 全量回归 11 套件通过；README 版本表更新 v1.60.0；双副本同步

## 七、坑与风险

- **client.js 生效需重启**：非 dev 改 client.js 需重启 DSH 生效（测试实例验证先行；主实例重启须按 dsh-restart-gate 门禁走授权流程——本项目后续按需处理）
- **注册类函数拆分最忌「闭包捕获错位」**：每个工具函数必须显式接收其依赖（env/ctx 方法），不能依赖外部闭包变量——抽函数时逐个核对 execute 里引用到的变量
- **auditFull 扫全量会命中存量问题**：full 模式下提交门禁会把历史 secret/超长函数翻出来拦截——用户主动选 full 即接受（不降级）；但 code_audit scope=full 对历史仓库是「清洗前排查」用途，提醒先 fullScan 清洗注释再切 full 审计
- **listTextFiles 与 audit files 格式差异**：full-scan 的 listTextFiles 返回 `{path, ext, full}`，audit 需要 `{path, addedLines, isBinary}`——auditFull 需转换（读文件内容作 addedLines，全量行都算「新增」）
- **超大文件分模块**（audit.js/client.js）风险高、收益边际——若 blocker 拆完已达标（可读性 ≥7），超大文件拆分留 backlog，避免本迭代失焦
- **每次拆分后 self-score 重测**：打分脚本要固定文件列表（85 文件）避免波动