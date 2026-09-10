/**
 * dsh-git-push 自身总入口
 *
 * 版本控制（单一事实源）/ README 模板（独立，不走拦截 yml）/ yml 模板 / 独立运行能力（CLI）。
 * 版本一致性：VERSION（本文件）≡ package.json version ≡ cli.mjs HELP 的 v${VERSION}，
 * 由 scripts/scan-version.mjs 机器校验（0.1.4）。
 * CLI 一致性：HELP 文本与 parseArgv 白名单机器比对（cli-help-sync），防 --depth 类回归。
 */
export const VERSION = '1.0.3'; // 单一事实源：package.json 由 scan-version 校验一致性

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