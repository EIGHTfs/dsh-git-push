import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectTextFiles, readText, isGitRepo, collectChangedFiles, isTextFile } from './collector.js';
import { groupByKind, HINT_QUALITY, checkFolderRules, checkPrivateFiles } from './checks.js';
import { loadRuleFiles } from '../rule/loader.js';
import { compileAllRules } from '../rule/registry.js';
import { auditFile } from './audit-file.js';
import { detectRepoJsYamlImport } from './file-context.js';
import { decorateTestExemptHint, makeFinding, summarize } from './finding.js';
import { pickRepoLevelAnchorFile, repoLevelSemanticRuleIds } from './repo-level.js';
import { buildRuleSlotMap, countRulesBySlot, slotStatsFromFindings } from './slot.js';
import { findingsToYaml } from './report-yaml.js';
import { checkDrift } from '../../scripts/tree-doc.mjs';

/**
 * 大仓库扫描上限（性能降级，2026-09-13）。
 *
 * 动机：弱 CPU 机器上「全量扫几万文件」会把提交推送卡死——实测 3 万文件 × ~42ms/文件
 *   约 21 分钟，用户侧表现为「提交推送一直不动」。超上限时截断扫描，并**优先保留本次
 *   变动文件**（git status）：正要提交的东西必须被审到，不能因为截断而漏审。
 *
 * 语义：cap <= 0（或未配置）时完全不限制，行为与旧版一致（向后兼容）。
 *
 * @param {Array<{path:string, full:string}>} files 全量收集结果
 * @param {string} root 仓库根
 * @param {number|string} maxFiles 上限（0/空 = 不限）
 * @returns {{files: Array, truncated: null|{total:number, scanned:number, cap:number}}}
 */
export function capScanFiles(files, root, maxFiles) {
  const cap = Number(maxFiles) || 0;
  if (cap <= 0 || files.length <= cap) return { files, truncated: null };
  const changed = collectChangedFiles(root);
  const changedSet = new Set((changed || []).map((c) => String(c.rel || '').replace(/\\/g, '/')));
  const priority = [];
  const rest = [];
  for (const f of files) (changedSet.has(f.path) ? priority : rest).push(f);
  const out = priority.concat(rest).slice(0, cap);
  return { files: out, truncated: { total: files.length, scanned: out.length, cap } };
}

/** 全量审计：目录递归扫描，非 git 项目可查，默认排除 git 忽略文件。 */
export function auditFull(repoPath, opts = {}) {
  const root = repoPath;
  const gitIgnoreRoot = opts.gitIgnoreRoot !== false && isGitRepo(root) ? root : null;
  const collected = collectTextFiles(root, {
    depth: opts.depth ?? 10,
    gitIgnoreRoot,
    includeIgnored: opts.includeIgnored,
    testExemptRoot: root,
  });
  // 大仓库降级：超上限按「变动优先」截断，避免弱 CPU 上扫几万文件卡死（见 capScanFiles）
  const { files, truncated } = capScanFiles(collected, root, opts.maxScanFiles);
  // 编译规则：调用方可传 compiled；未传时默认加载 nodejs 槽位（含 npm/html 等槽位建好后自动扩展）
  let compiled = opts.compiled;
  if (!compiled) {
    const loaded = loadRuleFiles(opts.slots, { dir: opts.rulesetDir, disabledSlots: opts.disabledSlots });
    compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  }
  const grouped = groupByKind(compiled);
  // 全仓 js-yaml import 证据——npm/undeclared-js-yaml 规则语义是
  // 「lib import 了 js-yaml 但未声明依赖」；全仓没有任何 import/require 时
  // （零依赖项目）不报。先扫一遍全部文件文本收集证据，再逐文件审计。
  const repoHasJsYamlImport = detectRepoJsYamlImport(files);
  const findings = [];
  if (truncated) {
    findings.push(makeFinding({
      file: `${repoPath}/`, line: 1, rule: 'audit/scan-truncated', kind: 'semantic',
      severity: 'notice',
      message: `仓库文件过多（${truncated.total} 个），本次只审计了 ${truncated.scanned} 个（已优先纳入变动文件）；如需全量可调大 maxScanFiles，或改用 scope:'diff'`,
      dimensions: ['性能'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0,
    }));
  }
  // 2026-09-13：仓库级 semantic 占位规则（npm audit / 路径穿越人工核查 / a11y）只在
  //   一个代表文件上报一次——它们是「整个仓库」的属性，逐文件报会在 N 个文件上产出
  //   N 条同义提示（实测 4 文件 × 4 规则 = 16 条），淹没真实问题。
  //   代表文件 = 代码文件中路径字典序最小的那个（稳定可复现，不随遍历顺序变）。
  const repoLevelRules = repoLevelSemanticRuleIds(grouped);
  const repoLevelAnchor = pickRepoLevelAnchorFile(files);
  for (const f of files) {
    const text = readText(f.full);
    const skipRepoLevel = repoLevelRules.size > 0 && f.path !== repoLevelAnchor;
    findings.push(...auditFile({ file: f.path, relPath: f.path, text, grouped }, {
      level: opts.auditLevel, repoHasJsYamlImport, repoPath,
      repoLevelRules: skipRepoLevel ? repoLevelRules : null,
    }));
  }
  // 目录级审计（folder 槽位）：仓库结构规则在文件行级之外统一跑一次
  // 仓库级 i18n 检查：语言包文件（zh-CN.json / en-US.json）缺失只在仓库根判定一次
  if (grouped['semantic']) {
    const localeRules = grouped['semantic'].filter((r) => r.detectionMethod === 'locale-file-exists' || /locale-file/i.test(r.id || ''));
    for (const rule of localeRules) {
      const hasZh = existsSync(join(repoPath, 'zh-CN.json')) || existsSync(join(repoPath, 'locales', 'zh-CN.json'));
      const hasEn = existsSync(join(repoPath, 'en-US.json')) || existsSync(join(repoPath, 'locales', 'en-US.json'));
      if (!hasZh || !hasEn) {
        findings.push(makeFinding({
          file: `${repoPath}/package.json`, line: 1, rule: rule.id, kind: 'semantic',
          severity: 'notice',
          message: `${rule.message || rule.name}（缺 ${!hasZh ? 'zh-CN.json' : ''} ${!hasEn ? 'en-US.json' : ''}）`,
          dimensions: rule.dimensions || ['文档'],
          exemptHint: HINT_QUALITY,
          scoreImpact: 0,
        }));
      }
    }
  }
  if (grouped['folder']) {
    let gitignoreText = '';
    try { gitignoreText = existsSync(join(repoPath, '.gitignore')) ? readFileSync(join(repoPath, '.gitignore'), 'utf8') : ''; } catch { /* 忽略 */ }
    findings.push(...checkFolderRules({ root: repoPath, rules: grouped['folder'], gitignoreText }));
  }
  // 私密文件拦截（private 槽位，1.0.4，T1-T33 考古验收）：git ls-files × private_files glob × 远端可见性分级
  const privateFiles = opts.privateFiles
    ?? (() => { try { return loadRuleFiles(opts.slots, { dir: opts.rulesetDir, disabledSlots: opts.disabledSlots }).merged.private_files || []; } catch { return []; } })();
  if (privateFiles.length) {
    findings.push(...checkPrivateFiles({ root: repoPath, visibility: opts.visibility || 'unknown', privateFiles }));
  }
  decorateTestExemptHint(findings);
  // 2026-09-16：README 目录树漂移并入审计——仓库根有 README + dshgp-tree 标记块时，
  //   检查真实文件树与 README 树是否一致（新增未列/已删未清/映射孤儿），漂移产生
  //   structure/tree-doc-drift finding（warning，不拦提交但提示维护 README 树）。
  appendTreeDocDrift(findings, repoPath);
  // 2026-09-13：按规则包聚合命中数（侧边栏规则包列表的「拦截/警告/通过」= 实际命中数）
  const slotStats = slotStatsFromFindings(findings, buildRuleSlotMap(compiled), countRulesBySlot(compiled));
  return {
    ok: true, scope: 'full', repo: repoPath, findings, summary: summarize(findings), slotStats, files: files.length,
    // 2026-09-16：层级聚合 YAML（summary → 拦截级别 → 目录 → 文件 → 规则明细）
    yaml: findingsToYaml(findings),
  };
}

/** 把 README 目录树漂移（tree-doc checkDrift）并入审计 findings（2026-09-16）。 */
function appendTreeDocDrift(findings, repoPath) {
  try {
    const readme = join(repoPath, 'README.md');
    if (!existsSync(readme)) return; // 无 README 不检查
    const r = checkDrift({ readmePath: readme, root: repoPath });
    if (!r || !Array.isArray(r.issues)) return;
    const real = (r.issues || []).filter((i) => i.type !== 'no-block'); // 无树块=未启用，非漂移
    if (!real.length) return;
    findings.push(makeFinding({
      file: 'README.md', line: 1, rule: 'structure/tree-doc-drift', kind: 'max-depth',
      severity: 'warning', message: `README 目录树漂移：${real.map((i) => i.msg).join('；')}（运行 tree-doc.mjs sync/apply 修复）`,
      dimensions: ['可维护性'], scoreImpact: 1,
    }));
  } catch { /* README 缺失/非 git 目录：跳过（不因漂移检查失败干扰审计） */ }
}

/**
 * 变动审计：git status --porcelain 取工作区变动文件 → 逐文件审计（仅 git 项目）。
 * 非 git 项目退化为 auditFull，但 scope 仍标记 changed（调用方语义一致）。
 */
export function auditChanged(repoPath, opts = {}) {
  const changed = collectChangedFiles(repoPath);
  if (changed === null) {
    const auditRes = auditFull(repoPath, opts);
    auditRes.scope = 'changed';
    return auditRes;
  }
  // 删除的没有可读内容；非文本文件（png/jpg 等二进制扩展名、>1MB）跳过——
  // 1.0.13 修复：PNG 等图片改动进 diff 审计会被 readText 以 UTF-8 读入 → 二进制乱码触发 regex 误报
  const targets = changed.filter((f) => f.status !== 'D' && isTextFile(f.full));
  // 编译规则：与 auditFull 相同的默认装载
  let compiled = opts.compiled;
  if (!compiled) {
    const loaded = loadRuleFiles(opts.slots, { dir: opts.rulesetDir, disabledSlots: opts.disabledSlots });
    compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  }
  const grouped = groupByKind(compiled);
  // npm/undeclared-js-yaml 需「js-yaml 已引用但未声明」证据。2026-09-14 bugfix：
  //   原来无条件 collectTextFiles 全仓扫（遍历 + 逐个读全文），实测 0 变动文件的大
  //   仓库也扫 2 万多文件花 3-5s（8 万文件仓库更久），runAudit 同步卡住 AI，且用户
  //   的「审计变动文件（diff）」设置看起来没生效。改为只在「本次变动文件」里检测
  //   js-yaml 引用——diff 审计语义就是本次变动，引用证据同理按变动范围取；全仓
  //   证据（npm 规则的历史遗留引用）由 auditFull 负责，不在 diff 里重扫。
  const repoHasJsYamlImport = detectRepoJsYamlImport(targets);
  const findings = [];
  // 2026-09-13：仓库级 semantic 占位规则在变动范围内只报一次（代表文件 = 变动的
  //   代码文件中路径字典序最小者）。全仓扫描时代表文件取自全仓，语义一致。
  const repoLevelRules = repoLevelSemanticRuleIds(grouped);
  const repoLevelAnchor = pickRepoLevelAnchorFile(targets.map((f) => ({ path: f.rel })));
  for (const f of targets) {
    const text = readText(f.full);
    const skipRepoLevel = repoLevelRules.size > 0 && f.rel !== repoLevelAnchor;
    findings.push(...auditFile({ file: f.rel, relPath: f.rel, text, grouped }, {
      level: opts.auditLevel, repoHasJsYamlImport, repoPath,
      repoLevelRules: skipRepoLevel ? repoLevelRules : null,
    }));
  }
  // 私密文件拦截（强制槽位，scope 无关）：变动审计同样跑 git ls-files 全量匹配
  const privateFiles = opts.privateFiles
    ?? (() => { try { return loadRuleFiles(opts.slots, { dir: opts.rulesetDir, disabledSlots: opts.disabledSlots }).merged.private_files || []; } catch { return []; } })();
  if (privateFiles.length) {
    findings.push(...checkPrivateFiles({ root: repoPath, visibility: opts.visibility || 'unknown', privateFiles }));
  }
  decorateTestExemptHint(findings);
  // 2026-09-16：README 目录树漂移并入审计（与 auditFull 同语义——diff 审计同样提示树漂移）
  appendTreeDocDrift(findings, repoPath);
  // 2026-09-13：按规则包聚合命中数（与 auditFull 同语义）
  const slotStats = slotStatsFromFindings(findings, buildRuleSlotMap(compiled), countRulesBySlot(compiled));
  return {
    ok: true, scope: 'changed', repo: repoPath, findings, summary: summarize(findings), slotStats, files: targets.length,
    yaml: findingsToYaml(findings),
  };
}

/** 统一审计入口（设置项 auditScanScope 决定默认走哪个）。 */
export function auditWithScope(repoPath, { scope = 'diff', ...opts } = {}) {
  return scope === 'full' ? auditFull(repoPath, opts) : auditChanged(repoPath, opts);
}
