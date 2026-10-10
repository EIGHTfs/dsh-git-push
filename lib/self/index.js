/**
 * dsh-git-push 自身总入口
 * dsh-skip-i18n: 插件为中文零依赖 CLI（无 i18n 框架需求），用户可见文案硬编码为产品设计
 *
 * 版本控制（单一事实源）/ README 模板（独立，不走拦截 yml）/ yml 模板 / 独立运行能力（CLI）。
 * 版本一致性：VERSION（本文件）≡ package.json version ≡ cli.mjs HELP 的 v${VERSION}，
 * 由 scripts/scan-version.mjs 机器校验（0.1.4）。
 * CLI 一致性：HELP 文本与 parseArgv 白名单机器比对（cli-help-sync），防 --depth 类回归。
 */


export const VERSION = '2.6.7'; // 2.6.7：压平后的单次发布——分叉治理（版本真源归正/项目类型自动识别/安全闸/dry-run/计数校验）+ dsh 槽位 2 条规则 + 部署与文档治理
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
