import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { collectTextFiles, readText, isGitRepo, collectChangedFiles, isTextFile } from './collector.js';
import { groupByKind, HINT_QUALITY, checkFolderRules, checkPrivateFiles } from './checks.js';
import { loadRuleFiles } from '../rule/loader.js';
import { compileAllRules } from '../rule/registry.js';
import { auditFile } from './audit-file.js';
import { detectRepoJsYamlImport } from './file-context.js';
import { decorateTestExemptHint, makeFinding, summarize } from './finding.js';
import { pickRepoLevelAnchorFile, repoLevelSemanticRuleIds } from './repo-level.js';
import { checkDocsScore } from '../score/docs-score.js';
import { buildRuleSlotMap, countRulesBySlot, slotStatsFromFindings } from './slot.js';
import { findingsToYaml } from './report-yaml.js';
import { checkDrift } from '../../scripts/tree-doc.mjs';
import { detectIgnoreBlindSpot } from './ignore-blind.js';

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

/**
 * 审计静默失明告警：本地 git 排除配置（.git/info/exclude）把整仓判成忽略时提醒。
 *
 * 为什么必须报：这种情形下审计**不报错、退出正常**，只是几乎扫不到文件——调用方
 *   看到的是「仓库很干净」。实测一个写有 `*` 的 info/exclude 让 26 个跟踪文件里
 *   21 个被静默跳过（只扫到 5 个），而当时的审计结论是「0 拦截 / 98.6 分 A」。
 *   该文件是**本机私有配置**，不随仓库分发，因此同一份代码在不同机器上结论不同。
 * @param {Array} findings
 * @param {string} repoPath
 * @param {number} scanned 实际收集到的文件数
 */
function appendIgnoreBlindSpot(findings, repoPath, scanned) {
  try {
    const hit = detectIgnoreBlindSpot(repoPath);
    if (!hit) return;
    const detail = hit.broad.length
      ? `.git/info/exclude 含全仓通配 ${JSON.stringify(hit.broad)}`
      : `跟踪文件中 ${(hit.ignoreRatio * 100).toFixed(0)}% 被判定为忽略（${hit.tracked} 个）`;
    findings.push(makeFinding({
      file: '.git/info/exclude', line: 1, rule: 'robustness/audit-blind-spot', kind: 'max-depth',
      severity: 'warning',
      message: `审计可能「静默失明」：${detail}——本次仅收集到 ${scanned} 个文件。`
        + '该文件属本机私有排除配置（不随仓库分发），会使审计扫不到大部分文件却不报错。'
        + '请清空 .git/info/exclude 后重跑，或确认确实有意排除本机文件。',
      dimensions: ['健壮性'], scoreImpact: 1,
    }));
  } catch { /* 检测失败不影响审计主流程 */ }
}

/** 全量审计：目录递归扫描，非 git 项目可查，默认排除 git 忽略文件。 */
/**
 * 公共审计核心（2026-09-26 重构）：full/changed 只差「扫描文件范围」。
 * 文件收集（collectTextFiles 全仓 / collectChangedFiles 变动）由调用方完成，
 * 其余环节（规则编译、repoLevel、逐文件审计、locale/folder、private、收尾、
 * slotStats、docsScore、yaml）统一走本函数，消除两套重复实现。
 * @param {string} repoPath 仓库根
 * @param {Array<{path?:string, rel?:string, full:string, status?:string}>} files 待审计文件（path 优先，rel 兜底）
 * @param {object} opts { scope, compiled, slots, rulesetDir, disabledSlots, auditLevel, privateFiles, visibility, truncated }
 */
async function auditFiles(repoPath, files, opts = {}) {
  // 归一化：full 收集项用 path，changed 用 rel → 统一取 path
  const normFiles = files.map((f) => ({ path: f.path ?? f.rel, full: f.full, status: f.status }));
  // 编译规则：调用方可传 compiled；未传时默认加载 nodejs 槽位（含 npm/html 等槽位建好后自动扩展）
  let compiled = opts.compiled;
  if (!compiled) {
    const loaded = loadRuleFiles(opts.slots, { dir: opts.rulesetDir, disabledSlots: opts.disabledSlots });
    compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  }
  const grouped = groupByKind(compiled);
  // 全仓 js-yaml import 证据——范围由传入 files 决定（full=全仓、changed=本次变动）
  const repoHasJsYamlImport = detectRepoJsYamlImport(normFiles);
  const findings = [];
  if (opts.truncated) {
    findings.push(makeFinding({
      file: `${repoPath}/`, line: 1, rule: 'audit/scan-truncated', kind: 'semantic',
      severity: 'notice',
      message: `仓库文件过多（${opts.truncated.total} 个），本次只审计了 ${opts.truncated.scanned} 个（已优先纳入变动文件）；如需全量可调大 maxScanFiles，或改用 scope:'diff'`,
      dimensions: ['性能'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 0,
    }));
  }
  // 2026-09-13：仓库级 semantic 占位规则（npm audit / 路径穿越人工核查 / a11y）只在
  //   一个代表文件上报一次——它们是「整个仓库」的属性，逐文件报会在 N 个文件上产出
  //   N 条同义提示，淹没真实问题。代表文件 = 路径字典序最小者。
  const repoLevelRules = repoLevelSemanticRuleIds(grouped);
  const repoLevelAnchor = pickRepoLevelAnchorFile(normFiles);
  for (const f of normFiles) {
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
  appendIgnoreBlindSpot(findings, repoPath, normFiles.length);
  // 2026-09-13：按规则包聚合命中数（侧边栏规则包列表的「拦截/警告/通过」= 实际命中数）
  const slotStats = slotStatsFromFindings(findings, buildRuleSlotMap(compiled), countRulesBySlot(compiled));
  // 2026-09-21：文档加分制（0 分起、上限 10）——结构信号 + 交叉验证，**不进 findings**
  //   （不进扣分维度/门禁/问题计数），由 scoreQuality 的 context.docsScore 单独加分。
  const docsScore = checkDocsScore(repoPath);
  return {
    ok: true, scope: opts.scope || 'full', repo: repoPath, findings, summary: summarize(findings), slotStats, files: normFiles.length,
    docsScore,
    // 2026-09-16：层级聚合 YAML（summary → 拦截级别 → 目录 → 文件 → 规则明细）
    yaml: findingsToYaml(findings),
  };
}

export async function auditFull(repoPath, opts = {}) {
  const root = repoPath;
  // 2026-09-18：`.auditignore` 原先仅在 git 仓库生效（内部走 git check-ignore），
  //   非 git 目录下该文件形同不存在。现在非 git 但**存在 .auditignore** 时也把 root 传下去，
  //   由 collector 切换到纯 JS 匹配器兜底（lib/audit/gitignore-match.js），
  //   两种路径返回同构的忽略集，调用方无感知。不存在该文件时仍传 null，避免无谓遍历。
  const isGit = isGitRepo(root);
  const hasAuditIgnore = existsSync(join(root, '.auditignore'));
  const gitIgnoreRoot = opts.gitIgnoreRoot !== false && (isGit || hasAuditIgnore) ? root : null;
  const collected = await collectTextFiles(root, {
    depth: opts.depth ?? 10,
    gitIgnoreRoot,
    includeIgnored: opts.includeIgnored,
    testExemptRoot: root,
  });
  // 大仓库降级：超上限按「变动优先」截断，避免弱 CPU 上扫几万文件卡死（见 capScanFiles）
  const { files, truncated } = capScanFiles(collected, root, opts.maxScanFiles);
  return auditFiles(repoPath, files, { ...opts, scope: 'full', truncated });
}

/** 把 README 目录树漂移（tree-doc checkDrift）并入审计 findings（2026-09-16）。 */
function appendTreeDocDrift(findings, repoPath) {
  try {
    const readme = join(repoPath, 'README.md');
    if (!existsSync(readme)) return; // 无 README 不检查
    const r = checkDrift({ readmePath: readme, root: repoPath });
    if (!r || !Array.isArray(r.issues)) return;
    const real = (r.issues || []).filter((i) => i.type !== 'no-block'); // 无树块=未启用，非漂移
    if (real.length) {
      // 2026-09-23：missing（新增未更新）= 提交中间态——未跟踪新文件提交前 gitLsFiles 计入
      //   而 README 树未及 apply，提交后 sync/apply 自动消除 → 降 notice 不扣分；
      //   stale/orphan（树列已删文件 / 索引映射不存在）= 真漂移 → warning 保持。
      const missing = real.filter((i) => i.type === 'missing');
      const bad = real.filter((i) => i.type !== 'missing');
      if (missing.length) {
        findings.push(makeFinding({
          file: 'README.md', line: 1, rule: 'structure/tree-doc-drift', kind: 'max-depth',
          severity: 'notice',
          message: `README 目录树待更新：${missing.map((i) => i.msg).join('；')}（新增文件，git 提交后运行 tree-doc.mjs sync/apply 登记）`,
          dimensions: ['可维护性'], scoreImpact: 0,
        }));
      }
      if (bad.length) {
        findings.push(makeFinding({
          file: 'README.md', line: 1, rule: 'structure/tree-doc-drift', kind: 'max-depth',
          severity: 'warning', message: `README 目录树漂移：${bad.map((i) => i.msg).join('；')}（运行 tree-doc.mjs sync/apply 修复）`,
          dimensions: ['可维护性'], scoreImpact: 1,
        }));
      }
    }
    // 2026-09-23：工作区未提交变动文件 → notice 提示「注释可能需更新」（tree-doc 已记录 mtime）。
    //   只提示不拦（scoreImpact 0 不进扣分维度）；工作区干净时无此提示。
    const wt = (r.worktreeChanges && Object.entries(r.worktreeChanges)) || [];
    if (wt.length) {
      const by = (code) => wt.filter(([, v]) => v?.status === code).length;
      findings.push(makeFinding({
        file: 'README.md', line: 1, rule: 'structure/tree-doc-worktree-change', kind: 'max-depth',
        severity: 'notice',
        message: `工作区 ${wt.length} 个文件有未提交变动（M ${by('M')} / A ${by('A')} / D ${by('D')}）——tree-doc 已记录修改时间，相关文件注释可能需更新；git 提交后重新 tree-doc sync 清除提示`,
        dimensions: ['可维护性'], scoreImpact: 0,
      }));
    }
  } catch { /* README 缺失/非 git 目录：跳过（不因漂移检查失败干扰审计） */ }
}

/**
 * 变动审计：git status --porcelain 取工作区变动文件 → 逐文件审计（仅 git 项目）。
 * 非 git 项目退化为 auditFull，但 scope 仍标记 changed（调用方语义一致）。
 */
export async function auditChanged(repoPath, opts = {}) {
  const changed = collectChangedFiles(repoPath);
  if (changed === null) {
    const auditRes = await auditFull(repoPath, opts);
    auditRes.scope = 'changed';
    return auditRes;
  }
  // 删除的没有可读内容；非文本文件（png/jpg 等二进制扩展名、>1MB）跳过——
  // 1.0.13 修复：PNG 等图片改动进 diff 审计会被 readText 以 UTF-8 读入 → 二进制乱码触发 regex 误报
  // 2026-09-26 修复：.auditignore 目录豁免对 changed 扫描生效（此前仅 full 扫描生效——
  //   collectChangedFiles 只过滤了 .test 空文件目录，.auditignore 声明「不审计但入库」的
  //   文件/目录（如油猴脚本 scripts/）在 diff 审计里仍被扫，函数长度等规则误拦提交）。
  //   判定复用 git check-ignore（core.excludesFile=.auditignore，与 full 扫描同一语义）。
  const auditIgnorePath = join(repoPath, '.auditignore');
  const hasAuditIgnore = existsSync(auditIgnorePath);
  const ignoreExtraArgs = hasAuditIgnore ? ['-c', `core.excludesFile=${auditIgnorePath}`] : [];
  const isAuditIgnored = (rel) => {
    if (!hasAuditIgnore) return false;
    try {
      execFileSync('git', ['-C', repoPath, ...ignoreExtraArgs, 'check-ignore', '-q', '--', rel], {
        encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      return true; // exit 0 = 命中忽略
    } catch { return false; } // exit 1 = 未忽略；异常保守视为不忽略
  };
  const targets = changed.filter((f) => f.status !== 'D' && isTextFile(f.full) && !isAuditIgnored(f.rel));
  // 2026-09-26 重构：与 full 共用 auditFiles 公共核心——规则编译/逐文件审计/仓库级
  //   检查（locale/folder）/private/收尾/slotStats/docsScore/yaml 全部统一，范围天然由
  //   targets 决定（repoHasJsYamlImport 与 repoLevel 代表文件按本次变动取，同旧语义）。
  return auditFiles(repoPath, targets, { ...opts, scope: 'changed' });
}

/** 统一审计入口（设置项 auditScanScope 决定默认走哪个）。 */
export async function auditWithScope(repoPath, { scope = 'diff', ...opts } = {}) {
  return scope === 'full' ? await auditFull(repoPath, opts) : auditChanged(repoPath, opts);
}
