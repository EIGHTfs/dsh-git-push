// dsh-skip-residue: 审计引擎实现含 debugger/console/todo 匹配正则（规则定义一部分，非真实残留）
/**
 * dsh-git-push 审计总入口
 *
 * 统一入口：auditWithScope(repo, { scope }) —— 变动 / 全量。
 * - auditChanged：git diff HEAD（仅 git 项目）
 * - auditFull：目录全量扫描（非 git 项目也可查；默认排除 .gitignore 忽略文件）
 * - 统一问题对象：{ file, line, rule, kind, dimensions[], severity, exemptHint, scoreImpact }
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectTextFiles, readText, isGitRepo, collectChangedFiles } from './collector.js';
import { runChecks, groupByKind, HINT_QUALITY, checkFolderRules, checkPrivateFiles } from './checks.js';
import { exemptForFinding } from '../exempt/index.js';
import { loadRuleFiles } from '../rule/loader.js';
import { compileAllRules } from '../rule/registry.js';
import '../rule/compilers.js'; // 副作用：注册 13 种编译函数

/** 统一问题对象构造器（所有审计检查的出口）。 */
export function makeFinding({ file, line, rule, kind, severity = 'warning', message, dimensions = [], exemptHint = '', scoreImpact = 0 }) {
  return { file, line, rule, kind, severity, message, dimensions, exemptHint, scoreImpact };
}

/**
 * 汇总 findings 统计。
 *
 * 1.1.0 修复：原实现只累加 blocker/warning，但规则 severity 实际有三档
 * （blocker / error / warning）。error 级问题（凭据泄露等）既不进 blocker
 * 也不进 warning，却计入 total → 产生「0 blocker 0 warning 但 total=3」的
 * 矛盾统计，且上层按 blocker 数判断门禁时会**漏放** error 级问题。
 * 现统一语义：error 归入 blocker（拦截级），notice/info 单列，其余为 warning。
 * @param {Array} findings 统一问题对象列表
 * @returns {{blocker:number, warning:number, notice:number, total:number}}
 */
export function summarize(findings = []) {
  let blocker = 0, warning = 0, notice = 0;
  for (const f of findings) {
    const sev = f.severity || 'warning';
    if (sev === 'blocker' || sev === 'error') blocker++; // error=拦截级（凭据泄露/语法错误等）
    else if (sev === 'notice' || sev === 'info') notice++;
    else warning++;
  }
  return { blocker, warning, notice, total: findings.length };
}

/** 代码文件扩展名（residue/style 类检查只对代码生效，修规则定义/文档自举假阳性）。 */
export const CODE_EXTS = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'php', 'rb', 'sh', 'bash']);

/**
 * 单文件审计：读文件 → 跑检查 → 豁免过滤（注册表驱动，7 标记全消费）。
 * 豁免判定：exemptForFinding 统一处理「文件头整文件 / 行内单点」两种位置语义；
 * 外加两类语义豁免：
 *   1) residue/style 检查只对代码文件生效（md/yml 文档里出现 debugger 字样是写作/定义，非残留）
 *   2) 规则定义文件（audit-rules-*.yml）自动豁免规则驱动命中（pattern 字符串被自家 regex 自举命中）
 */
export function auditFile({ file, relPath, text, grouped }, opts = {}) {
  if (!text) return [];
  const ext = String(relPath || file || '').split('.').pop().toLowerCase();
  const isCode = CODE_EXTS.has(ext);
  // 文档/配置（md/yml 等）不做重复串检查：反引号代码段、版本号、路径引用重复属正常书写，
  // 按「硬编码文本」报会造成大面积噪音（maintainability 规则只对代码文件生效）
  // 测试目录同理：fixture 会故意构造重复样本与 mock 值，重复是测试语义的一部分
  const isTestFile = /(^|[/\\])(test|tests|__tests__|spec)[/\\]|\.(test|spec)\.(js|mjs|cjs|ts)$/i.test(String(relPath || file));
  const maintainabilityScoped = !isCode || isTestFile;
  const scopedGrouped = maintainabilityScoped ? { ...grouped, 'repeated-string': undefined, 'min-occurrences': undefined } : grouped;
  let findings = runChecks({ file, relPath, text, grouped: scopedGrouped }, { level: opts?.level });
  const isRuleDefFile = /(^|[/\\])audit-rules-[a-z0-9-]+\.ya?ml$/i.test(String(relPath || file));
  // 豁免过滤（dsh-skip-* 注册表统一消费，覆盖 sensitive/size/func-length/syntax/quality/residue/style）
  findings = findings.filter((f) => {
    // 规则定义文件：规则驱动命中（secret/regex/path-regex/func-lines 等 yml 规则）全豁免
    if (isRuleDefFile && f.rule !== 'quality/empty-catch' && f.rule !== 'quality/sync-fs') return false;
    // residue/style：非代码文件豁免（文档/配置里的 debugger/console/风格字样非残留）
    if (!isCode && (f.kind === 'regex')) {
      const residueLike = /debugger|console|todo/i.test(f.rule);
      if (residueLike) return false;
    }
    return !exemptForFinding(f, text);
  });
  return findings;
}

/** 全量审计：目录递归扫描，非 git 项目可查，默认排除 git 忽略文件。 */
export function auditFull(repoPath, opts = {}) {
  const root = repoPath;
  const gitIgnoreRoot = opts.gitIgnoreRoot !== false && isGitRepo(root) ? root : null;
  const files = collectTextFiles(root, {
    depth: opts.depth ?? 10,
    gitIgnoreRoot,
    includeIgnored: opts.includeIgnored,
  });
  // 编译规则：调用方可传 compiled；未传时默认加载 nodejs 槽位（含 npm/html 等槽位建好后自动扩展）
  let compiled = opts.compiled;
  if (!compiled) {
    const loaded = loadRuleFiles(opts.slots, opts.rulesetDir ? { dir: opts.rulesetDir } : undefined);
    compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  }
  const grouped = groupByKind(compiled);
  const findings = [];
  for (const f of files) {
    const text = readText(f.full);
    findings.push(...auditFile({ file: f.path, relPath: f.path, text, grouped }, { level: opts.auditLevel }));
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
    ?? (() => { try { return loadRuleFiles(opts.slots, opts.rulesetDir ? { dir: opts.rulesetDir } : undefined).merged.private_files || []; } catch { return []; } })();
  if (privateFiles.length) {
    findings.push(...checkPrivateFiles({ root: repoPath, visibility: opts.visibility || 'unknown', privateFiles }));
  }
  return { ok: true, scope: 'full', repo: repoPath, findings, summary: summarize(findings), files: files.length };
}

/**
 * 变动审计：git status --porcelain 取工作区变动文件 → 逐文件审计（仅 git 项目）。
 * 非 git 项目退化为 auditFull，但 scope 仍标记 changed（调用方语义一致）。
 */
export function auditChanged(repoPath, opts = {}) {
  const changed = collectChangedFiles(repoPath);
  if (changed === null) {
    const res = auditFull(repoPath, opts);
    res.scope = 'changed';
    return res;
  }
  const targets = changed.filter((f) => f.status !== 'D'); // 删除的没有可读内容
  // 编译规则：与 auditFull 相同的默认装载
  let compiled = opts.compiled;
  if (!compiled) {
    const loaded = loadRuleFiles(opts.slots, opts.rulesetDir ? { dir: opts.rulesetDir } : undefined);
    compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  }
  const grouped = groupByKind(compiled);
  const findings = [];
  for (const f of targets) {
    const text = readText(f.full);
    findings.push(...auditFile({ file: f.rel, relPath: f.rel, text, grouped }, { level: opts.auditLevel }));
  }
  // 私密文件拦截（强制槽位，scope 无关）：变动审计同样跑 git ls-files 全量匹配
  const privateFiles = opts.privateFiles
    ?? (() => { try { return loadRuleFiles(opts.slots, opts.rulesetDir ? { dir: opts.rulesetDir } : undefined).merged.private_files || []; } catch { return []; } })();
  if (privateFiles.length) {
    findings.push(...checkPrivateFiles({ root: repoPath, visibility: opts.visibility || 'unknown', privateFiles }));
  }
  return { ok: true, scope: 'changed', repo: repoPath, findings, summary: summarize(findings), files: targets.length };
}

/** 统一审计入口（设置项 auditScanScope 决定默认走哪个）。 */
export function auditWithScope(repoPath, { scope = 'diff', ...opts } = {}) {
  return scope === 'full' ? auditFull(repoPath, opts) : auditChanged(repoPath, opts);
}