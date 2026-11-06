/**
 * dsh-git-push 自身总入口
 * dsh-skip-i18n: 插件为中文零依赖 CLI（无 i18n 框架需求），用户可见文案硬编码为产品设计
 *
 * 版本控制（单一事实源）/ README 模板（独立，不走拦截 yml）/ yml 模板 / 独立运行能力（CLI）。
 * 版本一致性：VERSION（本文件）≡ package.json version ≡ cli.mjs HELP 的 v${VERSION}，
 * 由 scripts/scan-version.mjs 机器校验（0.1.4）。
 * CLI 一致性：HELP 文本与 parseArgv 白名单机器比对（cli-help-sync），防 --depth 类回归。
 */


export const VERSION = '2.20.14'; // 2.20.14：收口硬编码路径规则——删除全部场景豁免（isReasonableAbsolutePath 整段移除），只保留文档类降级 warning，其余一律 blocker；误报以行级临时豁免注释逐处标注，规则不设白名单。删除我加的坏测试 test-hardcoded-path-blocker、既有 test-scan-hardcoded-paths 及其唯一实现脚本 scripts/scan-hardcoded-paths.mjs；清理死目录 assets/（预览整套已废弃，含被我误写坏头部的 start.sh）与文档/索引中的悬空引用。教训固化进 tool-self-detection skill：自探测 ≠ 硬编码一堆绝对路径候选，候选应由 PATH 段与平台根常量派生。历史：2.20.13：① 精确化硬编码路径的排除面——/var/packages/ 不再整体排除，只排除含 bin/sbin/lib 段的可执行与库目录（套件的数据/配置路径写死同样换机失效，属真问题；简化排除会把它们一起放过，也让 scan-hardcoded-paths 的相对路径换算用例失败）。② npm registry 空串防护：未配置时传 undefined 不传空串，并在 npmrcText 加 effectiveRegistry 归一化——空串会写出 `registry=`，npm 构建 nerf-dart 时 new URL('') 直接抛 ERR_INVALID_URL，所有 npm 子命令不可用。历史：2.20.12：① paths/hardcoded-absolute-path 提为 blocker（写死本机数据目录换机即失效，属真实故障）；同时精筛排除两类合理写法（临时目录 /tmp·/var/tmp·/dev/shm；系统工具目录 /usr/bin·/usr/local/bin·/opt/*/bin·/var/packages·C:/Windows·Program Files·ProgramData），文档与 docs/ 下文件降级 warning（示例路径属说明内容）——否则简单提级会在本仓立刻误伤 35 条（全是 CI 的 /tmp 与 node 路径探测）。② code_audit/审计输出默认反转：默认返回 findings+yaml 详细，传 includeFindings=false 或 summaryOnly=true 才精简。历史：2.20.11：修 CI 真因——test-cifs-init 直接 execFileSync 读 `git config --global --get-all safe.directory`，而该键**不存在时退出码为 1**，execFileSync 抛错；CI 是全新 HOME（无该键）必炸，本地开发机早有该键所以一直绿。改用无键容错的 readGlobalSafeDirs()（无键即空列表）。以「全新 HOME」模拟 CI 条件验证 7/7 通过。历史：2.20.10：敏感文件扫描不再享「强制全仓」特权——改为与审计同一开关同一范围：审计关闭（audit=false）时不扫，审计开启时只扫「本次将提交的文件」（按 auditScanScope 的 diff 语义）。新增 scanSensitive 参数贯通 tool-call → commitAndPush → ensureGitignore；缺省 true 仅为兼容直接调用方（CLI/测试）。历史：2.20.9：修「有改动提交卡分钟级」——scanSensitiveFiles 递归读全仓每个文件内容，在 CIFS/SMB 上每文件一次网络往返；724 文件的仓库实测单文件改动卡满 15 分钟仍未返回（0 改动秒回，因为零改动整段跳过）。改为提交路径只扫「本次将提交的文件」（paths 精确模式用 pathList，否则解析 git status --porcelain 的变更集）；实测同一仓库从 60 秒跑不完降到 26 毫秒。缺省不传 onlyPaths 时保持原全仓行为（兼容其它调用方）。历史：2.20.8：修 CI 假红——test-cifs-init 的幂等断言把 skipped 文案写死成「已登记」，但这是 CIFS 环境分支；CI 是本地盘、属主与进程同 uid，走的是「属主一致」分支，断言因此恒失败（run 57~61 全红而本地一直绿）。改为按环境分支匹配 /已登记|一致/，并在本地盘条件（/tmp + 同 uid）完整复刻验证通过。历史：2.20.7：修 dataflow/clear-then-access 第六类误报——reset() 被当清空方法。业务代码里 reset() 绝大多数是「恢复默认值/重置状态」，重置后对象仍有内容、读取安全（实测：某配置类 reset()->bool，测试断言 cfg.reset() 后 get("general.theme")=="dark" 取得有效默认值）；同语料 13 条命中里 12 条源于此。已从 CLEAR_METHODS 移除，真正的容器清空用 clear()（保留）。历史：2.20.6：修 dataflow/clear-then-access 第五类系统性误报——Python 缩进式函数体从未被识别（区间收集只认 function 关键字与 ') {'），fnRanges 为空导致 mergeFnRanges 退化成「整个文件一个区间」，同文件内任意位置的 clear 与 access 都配成一对（实测 clear 在 invalidate()、访问在 build_index()，相距 177 行仍被报）。新增 collectPythonDefBodies 按缩进解析 def/async def 块并独立成体；闭包（嵌套 def 捕获外层变量）仍合并为一个体（是同一数据流，不该拆）。真实语料 13→1，剩余 1 条属 D3 边界内的合理提示（reset 后另有 _load_settings 重填，跨方法推断不做）。历史：2.20.5：修 dataflow/clear-then-access 四类系统性误报（真实语料实测 11 条命中里 8 条是误报）——①.empty() 被当清空（实为查询，从 CLEAR_METHODS 移除）②写目标 obj[k]=v 被当读访问（配对 ] 后跟 = 即按写回撤销）③类型注解位参与（PEP526 `x: list = []` 的 list 被当对象名、`-> list[str]` 被当访问；`:` 前须为标识符以区分 Python 函数定义冒号）④多目标解包错位（`a, b = [], {}` 把 [] 算给 b）。修复后同批文件 11→3 且剩余 3 条经人工核实均为真命中，真缺陷未被压制（正样本断言）。历史：2.20.4：树化迁移第二条 short-func-name——类方法/对象方法短名此前完全查不到（token 级只认 function 关键字），现走 method_definition 等定义节点判定；get/set 访问器显式排除（name 是属性名非函数名）；初筛补方法形态 pattern（allow 精筛前 pattern 必须先命中候选，否则树化无效）；TREE_FIRST_KINDS 登记 short-func-name。历史：2.20.3：修 CIFS/SMB 上「建仓成功但仓库对外不可用」——forceuid 挂载把目录属主映射成挂载用户（本机 杜渊/1026）而进程 uid 是套件用户（284371），git 2.55 对所有命令报 dubious ownership；插件内部带 -c safe.directory=* 感觉不到，交出去的仓库用户一敲 git 就挂。实测仓库级 [safe] directory 不生效（所有权检查先于读仓库 config），故新增 registerTrustedRepo/unregisterTrustedRepo 走 global 具体路径登记（只登记该目录，不用 *，同 uid 自动跳过），ensureUsableLocalRepo 三条路径（keep/create/repair）统一补齐。历史：2.20.2：修委托层自身灯下黑——tools/ruff 缺可执行位时旧行为静默返回空，与「项目没配 ruff」在报告里完全无法区分（部署副本迁移实测踩中：cp/同步不保 mode）。新增 detectLinterStatus 输出 unavailable（含具体成因与修复动作），并接进 linted；候选路径四律清单合并为 binCandidates 单一来源（原 resolveBin 与 resolveBinDetailed 各写一份，改一处漏一处会自相矛盾）。历史：2.20.1：新增外部 linter 委托层（方向 A 骨架，lib/lint-adapter/）——探测被审项目自带官方 linter（[tool.ruff] 配置 + tools/·PATH 可执行自探测）→ 调用 ruff --output-format json → 适配成统一 finding（规则码→维度映射、路径转相对、来源标记 linter:ruff）。两条硬约束落地：①外部 finding severity 恒封顶 warning，**只进评分与报告、绝不进拦截门禁**（别人的规则集不裁决本仓能否提交）；②探不到/崩溃/超时/坏输出一律降级空（含退出码≥2 不得被当成「外部判定无问题」的假阴性）。仅 full 范围委托；linted 委托状态进审计结果（防静默空转）；lint-adapter 纳入层边界门禁 AUDIT_DIRS。历史：2.20.0：评分「零规则维度记 0」——本次生效规则集里一条规则都没绑定的维度（无检测能力）权重记 0 剔出分母，并回传 uncoveredDimensions 显式标注「测不到≠质量高」；编排层新增 computeDimRuleCounts，五个评分调用点统一接 dimRuleCounts，含全塌保护与向后兼容。历史：2.19.0：审计「有树走树」（方向 E1-E3）——凭据精筛 credential-value 改吃 tree-sitter 语法树（参数默认值/复合右值/三元不再误报、bytes/raw 前缀真凭据不再漏报、凭据名强弱分级+值置信度），建树触发与 astConfirmSpan 解耦（TREE_FIRST_KINDS），treeUsage 状态进审计结果（防静默回退）。历史：2.18.3：新增 scope_check 工具与 kind=scope-collision 审计规则（拼接产物作用域撞名）。
//   实测后果：该目录有 package.json ⇒ npm 去打包整棵 DSH 树、输出 2.1MB > spawnSync 默认 maxBuffer 1MB ⇒ ENOBUFS（npm_publish 的体检与真发全部失败）；
//   该目录没有 package.json 时报 ENOENT。现 publish 的两个调用点显式传 cwd=目标包目录，并给 runNpm 加 16MB maxBuffer。
// 2.8.3：文案修正——「零改动 / 无新提交」明确为**正常成功路径**（注入用法、工具描述、README、skill 同批改），并修 job 输出自相矛盾（cleanSkipCommit 路径补 committed:false，不再显示「已提交，未推送」）
//   不再判「推送未落地」，改为如实标「推送已完成但未核验」（只有 404 才算远端真的没有该分支）。
// 2.6.2：克隆「已存在且不完整」时可续传/重来——预览端点回报 partial（有进行中标记且无有效提交），
//   前端预览框在不完整时给出「重来」（只清 .dsh-parts 分片、不动已下文件与用户内容）；忙碌键前缀（clone:/vis:/push:）统一到单一出处。
// 2.6.1：git_clone 新增 history 参数（真实历史）——用 git fetch --depth 取回原始对象，
//   克隆结果与远端 HEAD 逐字节一致（可推回远端、可 git log 读演进）；默认关，仍走整树快照快路径（行为不变）。
// 2.6.0：新增热路径探针 scripts/hot-path-probe.mjs（ESM/CJS 双格式自动判断；
//   统计指定函数的耗时 + 调用次数，并统计 fs 调用次数，用于区分「CPU 重复计算」与「I/O 等待」）。
// 2.5.7：审计评分保留**三位小数**（lib/score/index.js 的 decimalPlaces 10 → 1000），
//   便于对照「改一处代码后分数动了多少」；level 档位用同一分值判定。
// 2.5.5：审计新增「分析覆盖率」**信息项**（lib/audit/analysis-coverage.js）——
//   覆盖率 = 连边 / 可解析调用（成员调用排除并单独计数）、未解析按原因与按文件归类；
//   **不参与评分**（同一仓库开/关该信息项，summary 与 quality 逐字节一致，有回归测试）；
//   只有完整文件集才可信（diff 范围返回 skipped），args.coverage:false 可整体关闭
// 2.5.4：新增跨文件符号索引（lib/ast/symbol-index.js + scripts/symbol-index.mjs）——
//   稳定符号 ID（路径+符号，不含行号）、import 解析到工程内文件（含 TS 的 `./x.js`→`x.ts` 回退）、
//   跨文件调用三级落地（本地→导入→全工程唯一，歧义不连边）、未使用导出候选、分析覆盖率指标
// 2.5.3：修「假成功」——后台 job 原先无论结果都返回 completed/'commit+push done'，
//   把 push.js 的 verified 防线盖住了（推送失败/门禁拦截/远端 sha 不一致/无变更 全显示成「完成」）。
//   现在 job 状态由 pushJobOutcome / cloneJobOutcome 如实映射（失败报失败、未推送写明未推送、核验不一致报 failed）
// 2.5.2：新增 git_identity_rewrite 工具/CLI（提交身份历史改写：默认 dry-run，
//   先建备份引用、自检「提交数/工作树/身份全规范」通过才改写，push 用 force-with-lease 且只在远端 sha
//   等于改写前本地 sha 时执行；只处理 origin 属于登录账号的仓库），并在提交返回里带 legacyIdentity
//   提醒「该仓库历史还有多少条非规范身份」——只提醒不擅自改历史
// 2.5.1：提交身份自动用登录账号（仓库已配→尊重；未配→账号身份并写入仓库局部配置；
//   账号不可用→兜底 DSH Agent 且不落盘），并把身份暴露给 AI（工具返回 identity + 状态端点 commitIdentity +
//   提示词注入一行），修掉「AI 不知道该用什么身份、只能自己编」的问题
// 2.5.0 起：架构图生成器按 archify 作者契约重做——抽象层级自适应（细粒度/归并双档）、
//   网格 row/col 放置（不再手算坐标）、质量档 quality_profile=showcase；版本兼容性同 2.4.x（client 不依赖 settingsScope，特性检测 0.1.6 真 scope / 0.2.0 fallback）
// 2.4.2：契约与文档加固（不新增功能）——工具公开面契约门禁（含 4 个反向用例验证）、
//   版本化回归测试（regression-2.4.1.mjs）与工具层端到端测法（test-tools-e2e.mjs）、
//   版本表量化对比（version-metrics.json）、SECURITY.md + CONTRIBUTING.md、docs/SPEC.md 规格唯一入口、
//   docs/ 重组（设计稿转写为 4 篇功能介绍、11 份开发者文档移入技能仓库归档）、
//   复杂度长尾：≥20 高风险函数由 20 降到 15（findConstDefs 32 / downloadBlobs 29 / applySettingsToCfg 26 /
//   scanSensitiveFiles 25 / codeCommentRanges 30→12 / stripLiterals 25→12 逐个收口）
// 2.4.1：纯优化（不新增功能）——误报修复（多行模板跨行 tokenize、duplicate-constant 三类误报豁免）、
//   审计默认值/常量收口到公共模块（lib/audit-defaults.js、lib/ast/consts.js）、
//   module-splitter 既存 blocker 清理、豁免提示与实际行为一致性修复、4 个高复杂度函数拆分（28/22/21/15 全部达标）
// 2.4.0：clone 链路三修——① git_clone 工具补传 token（此前漏传走匿名 API，私有库失败/公开库吃 60次/h 限流）
//   + 统一体积上限 ② 工作树内防护前移到联网之前（此前被 HTTP 403 抢先返回，防护形同虚设）
//   ③ 「占用中」互斥判定前移到预览之前并改用全局 snapshot（此前换目录即可绕过互斥）
// 1.11.4：侧边栏设置页反代空白修复（绕开 isLoopback=memory 陷阱：available/writable 与 scope 快照解耦恒可用恒可写）+ git_sluice 工具化（浅包装 git 透传注册为 AI 直接调用工具，凭据自动注入，返回 status+stdout/stderr）+ 软链安装依赖解析回归测试
// 1.11.3：新增审计规则 comment/no-date-in-comment——注释禁止写日期（日期属 git commit，注释只解释为什么）；@since/@deprecated/@version/@date 白名单豁免
// 1.11.1：审计误报批量修复（KToolBox/Pawchive 实测驱动）——tokenizer 支持 Python 三引号/`#` 行注释；magic-number 枚举/参数默认/HTTP 状态码/datetime/Field 豁免；repeated i18n/配置键 snake_case 豁免；混淆构建产物自动豁免（单行 >5000 字符）；评审①②③④：comment-density 注释密度检测 + 序列化函数长度豁免
// 1.11.0：审计新增重复代码检测规则（maintainability/no-duplicate-code，激活原死规则）——跨文件 AST 归一化哈希找「同一函数结构 ≥3 处 + ≥5 行」提示抽公共函数；排除参数>5/布尔 flag/test 夹具/纯语法糖；severity 恒 warning
// 1.10.5：拆分 http-handlers.js 巨型 switch（923→122 行）到 lib/app/handlers/（meta/repos/repo-actions/clone/account/settings 6 模块），file-health L3 清零
// 1.10.4：工具探测补 node 兜底（execPath）+ 新增 /api/git-push/tool-probes 探测 API + 短变量改名（history/context/button-bind）
// 1.10.3：魔数规则再修 3 类误报（对象字面量常量定义/rgba 色值/CLI console.log(JSON.stringify) 输出豁免）
// 1.10.2：审计误报专项优化（重复规则去重/exs 文档豁免/vague 词表剔 res/循环变量豁免）
// 1.10.1：audit-api 变量命名清理（result→auditResult）+ sync-plugin fileContentEqual 异步化（existsSync→access）
// 1.10.0：审计结果 API 化 + 自定义聚合（/api/git-push/audit，groupBy=rule/file/severity/slot）+ sync-plugin 补同步 .auditignore
// 1.9.5：全量审计低风险优化（重复硬编码常量/短变量改名/魔数常量/真高风险 I/O 异步化）
// 1.9.4：自动推送范围下拉渲染修复（jsx 第三参数是 key 不是 children）
// 1.9.2：移除伪 peerDependencies（dsh-tools/schemastery 宿主条件提供）——修复市场软链安装误报缺依赖
// 1.9.1：系统提示词注入配置化（config.json injectUsageText 覆盖）+ 浅包装 git 用法入注入文本
// 1.9.0：浅包装 git（未知命令透传 + git 子命令 + 自动凭据）——major/minor 另行指定

/**
 * README 模板渲染（{{name}} {{description}} {{version}} {{versionTable}} 占位符）。
 * 独立于规则 yml（README 生成不是规则拦截，故不走 audit-rules 槽位）。
 * @returns {{ok: true, template: string, version: string}}
 */
export function readmeTemplate({ name = 'dsh-git-push', description = 'DSH git 自动提交推送插件——统一函数入口架构', version = VERSION, versionTable = '' } = {}) {
  const table = versionTable || [
    `| 版本 | 说明 |`,
    `|---|---|`,
    `| **${version}**（当前） | 当前版本：见 [WORKBOARD](docs/WORKBOARD-v2.md) 执行记录与 git log |`,
  ].join('\n');
  const template = [
    `# ${name}`,
    ``,
    `${description}。`,
    ``,
    `> **状态**：开发中（当前 v${version}）`,
    `> **CI**：\`npm test\` 一条命令全绿；\`npm run check\` 全量语法检查`,
    ``,
    `## 目录`,
    ``,
    `- [架构设计](#架构设计)`,
    `- [总入口清单](#总入口清单)`,
    `- [统一问题对象](#统一问题对象)`,
    `- [版本列表](#版本列表)`,
    `- [注意事项](#注意事项)`,
    ``,
    `## 架构设计`,
    ``,
    `**核心思想：统一函数入口 + 注册表扩展，加能力不破坏主入口。**`,
    ``,
    `- **规则总入口**（\`lib/rule/\`）：yml 规则槽位统一装载→解析→编译；加字段=加函数+注册一行，\`compileRule\` 主体永不修改`,
    `- **审计总入口**（\`lib/audit/\`）：\`auditChanged\`（git 变动，git status --porcelain）/ \`auditFull\`（全量，非 git 目录可查）`,
    `- **git 总入口**（\`lib/git/\`）：token / 提交 / 推送（api.github.com Git Data API，401 回退 SSH）/ clone / 建仓 / 可见性`,
    `- **自身总入口**（\`lib/self/\`）：版本单一事实源 / README 模板 / yml 模板 / CLI`,
    `- **评分总入口**（\`lib/score/\`）：10 维度加权（可读/可维护/健壮/安全/性能/测试/可观测/部署/文档/DX）`,
    `- **豁免总入口**（\`lib/exempt/\`）：\`dsh-skip-*\` 注册表 + exemptHint`,
    `- **上下文注入**（\`lib/context/\`）：给 AI 会话注入环境`,
    ``,
    `## 总入口清单`,
    ``,
    `| # | 入口 | 职责 |`,
    `|---|------|------|`,
    `| 1 | 规则总入口 | yml 字段解析 + 字段驱动编译函数指派 |`,
    `| 2 | 审计总入口 | 变动/全量/非 git 目录扫描 |`,
    `| 3 | git 总入口 | token/提交/推送/clone/建仓/可见性 |`,
    `| 4 | 自身总入口 | 版本/README 模板/yml 模板/CLI |`,
    `| 5 | 评分总入口 | 10 维度加权评分 |`,
    `| 6 | 豁免总入口 | dsh-skip-* 注册表 + exemptHint |`,
    `| 7 | 上下文注入 | AI 会话环境注入 |`,
    `| 8 | 测试总入口 | npm test 可复现 |`,
    ``,
    `## 统一问题对象`,
    ``,
    '```',
    `问题 = { file, line, rule, kind, severity, message, dimensions[], exemptHint, scoreImpact }`,
    '```',
    ``,
    `## 版本列表`,
    ``,
    table,
    ``,
    `## 注意事项`,
    ``,
    `- **开发中不推送、不发布**；每次提交前用 \`../dsh-git-push\`（存档版）扫描本目录自检`,
    `- **规则加载器铁律**：加字段 = 加函数 + 注册一行，\`compileRule\` 主体永不修改`,
    `- **命名格式统一**：一个功能一个根词，各层只做格式转换，对外 API 与函数名完全一致`,
    ``,
  ].join('\n');
  return { ok: true, template, version };
}

/** yml 规则模板（新规则示范：显式 kind + dimensions 绑定）。 */
export function yamlTemplate() {
  return [
    `# 规则模板示范`,
    `- id: category/rule-name`,
    `  kind: regex            # 可省略：按字段自动指派`,
    `  name: "规则显示名称"`,
    `  category: "readability"`,
    `  severity: "warning"    # error→blocker / warning→提醒 / info→pass`,
    `  pattern: "..."`,
    `  dimensions: ["可读性", "可维护性"]  # 10 维度绑定，支持一字段多维度`,
    ``,
  ].join('\n');
}

/** 独立运行能力：CLI 版本自检（cli.mjs 调用）。 */
export function selfVersion() {
  return VERSION;
}

/**
 * 版本一致性校验（scan-version.mjs 调用）：本文件 VERSION ≡ package.json version。
 * @param {string|object} pkgJson package.json 的 JSON 文本或含 version 的对象
 * @returns {{ok: boolean, selfVersion: string, pkgVersion: string, error?: string}}
 */
export function versionInfo(pkgJson = '') {
  let pkgVersion = '';
  if (typeof pkgJson === 'object' && pkgJson !== null) {
    pkgVersion = String(pkgJson.version || '');
  } else {
    try { pkgVersion = String(JSON.parse(String(pkgJson || '{}')).version || ''); } catch { /* 解析失败按空 */ }
  }
  if (!pkgVersion) return { ok: false, selfVersion: VERSION, pkgVersion: '', error: 'package.json 无 version 字段' };
  if (pkgVersion !== VERSION) {
    return { ok: false, selfVersion: VERSION, pkgVersion, error: `版本不一致：lib/self=${VERSION} vs package.json=${pkgVersion}` };
  }
  return { ok: true, selfVersion: VERSION, pkgVersion };
}

/**
 * CLI HELP 与 parseArgv 白名单机器比对（cli-help-sync）。
 * 从 HELP 文本提取 --xxx 选项，对照 parseArgv 认识的选项集合，两边不一致即报。
 * @param {string} helpText CLI HELP 全文
 * @param {string[]} knownFlags parseArgv 认识的选项名（含 -- 前缀，如 ['--depth','--full']）
 * @returns {{ok: boolean, missingInHelp: string[], missingInParse: string[], helpFlags: string[]}}
 */
export function helpSync(helpText = '', knownFlags = []) {
  const helpFlags = [...new Set([...(String(helpText).match(/--[\w-]+/g) || [])])].sort();
  const known = [...new Set(knownFlags.map((f) => (String(f).startsWith('--') ? String(f) : `--${f}`)))].sort();
  const missingInHelp = known.filter((f) => !helpFlags.includes(f)); // parseArgv 认但 HELP 没写
  const missingInParse = helpFlags.filter((f) => !known.includes(f)); // HELP 写了但 parseArgv 不认
  return { ok: missingInHelp.length === 0 && missingInParse.length === 0, missingInHelp, missingInParse, helpFlags };
}
