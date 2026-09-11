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
 * 扫描智能提示（1.0.8）：对 warning/blocker 且文件路径或文件名带 test 特征的 finding，
 * 在 message 末尾附加「测试文件夹可用 .test 空文件豁免」提示（告知而非自动豁免——
 * 是否豁免由用户在对应目录放 0 字节 .test 空文件决定，防逃逸语义与 1.0.6 isTestExemptDir 一致）。
 * test 特征：路径含 `test|tests|__tests__|spec` 目录段，或文件名 `.test.js`/`-spec.js` 等。
 * 重复提示幂等：message 已含「.test」则跳过。
 * @param {Array} findings 统一问题对象数组（原地补 message，返回同一数组）
 */
export function decorateTestExemptHint(findings = []) {
  const testPathRe = /(^|[/\\])(test|tests|__tests__|spec)[/\\]|\.(test|spec)(\.[a-z]+)?$/i;
  const HINT = '（提示：测试目录/文件可在对应目录放 0 字节 .test 空文件整目录豁免扫描）';
  for (const f of findings) {
    if (!f || !['warning', 'blocker', 'error'].includes(f.severity)) continue;
    const file = String(f.file || '');
    if (!testPathRe.test(file)) continue;
    if (String(f.message || '').includes('.test')) continue;
    f.message = `${f.message || ''}${HINT}`;
  }
  return findings;
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
 * 写文件前 mkdir 语义豁免（v1.1.1 修复）：
 * robustness/mkdir-before-write 用纯 regex 匹配 `fs.writeFile(...)` 等写语句，
 * 看不到同函数内先执行的 mkdir/ensureDataDir 调用 → 把「先建目录再写」的
 * 常规安全写法误报成 ENOENT 风险。
 * 判定：命中行向上找最近函数体边界（前一个 `){`/`=>{` 或 `function` 行），
 * 该函数体内（往后至函数闭括号前，保守取命中行前 40 行 + 命中行后 20 行）
 * 若出现 mkdirSync/mkdir(/ensureDataDir 调用则视为已确保目录存在。
 * @param {string[]} lines 文件全部行
 * @param {number} lineIdx 命中行索引（0 基）
 * @returns {boolean} true=同一函数内已建目录（应豁免）
 */
export function hasMkdirInSameFunction(lines, lineIdx) {
  const MKDIR_RE = /mkdir(Sync)?\s*\(|ensureDataDir\s*\(|recursive:\s*true/;
  const FUNC_START_RE = /(function|=>)\s*\{|\)\s*(async\s*)?\{/;
  // 向上找函数起点（最多 60 行），命中即记下作用域起点
  let scopeStart = 0;
  for (let i = Math.max(0, lineIdx - 60); i < lineIdx; i++) {
    if (FUNC_START_RE.test(String(lines[i] || ''))) scopeStart = i;
  }
  // 向后找闭括号粗略平衡点（保守取 20 行），期间出现 mkdir 即豁免
  const scopeEnd = Math.min(lines.length, lineIdx + 20);
  for (let i = scopeStart; i < scopeEnd; i++) {
    if (i === lineIdx) continue;
    if (MKDIR_RE.test(String(lines[i] || ''))) return true;
  }
  return false;
}

/**
 * 外部 API 调用超时语义豁免（v1.1.1 修复）：
 * robustness/timeout-on-external-api 规则用纯 regex 匹配 `fetch(`/`axios.(` 等调用，
 * 无法看到同一调用表达式内的超时参数 → 把「已设置 AbortSignal.timeout / AbortController /
 * timeout 选项」的调用误报成无超时。
 * 判定：命中行内联有超时设置（单行调用），或命中行后（最多 12 行、括号未闭合区间）
 * 出现 AbortSignal.timeout / AbortController / timeout: / timeout = 即视为已设超时。
 * @param {string} line 命中的行文本
 * @param {string[]} lines 文件全部行
 * @param {number} lineIdx 命中行索引（0 基）
 * @returns {boolean} true=调用已设超时（应豁免）
 */
export function hasExternalCallTimeout(line, lines, lineIdx) {
  const INLINE_RE = /AbortSignal\.timeout|AbortController|timeout\s*[:=]/;
  if (INLINE_RE.test(line)) return true; // 单行内联超时
  let depth = 0;
  const LIMIT = 12;
  for (let i = lineIdx + 1; i < Math.min(lines.length, lineIdx + 1 + LIMIT); i++) {
    const s = String(lines[i] || '');
    depth += (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
    if (INLINE_RE.test(s)) return true;
    if (depth <= 0 && /\);|},|}\);/.test(s)) break; // 调用表达式已闭合
  }
  return false;
}

/**
 * 全仓 js-yaml 引用检测（v1.1.1）：扫描所有文本文件的 import/require 语句，
 * 判断仓库是否真的引用了 js-yaml 包。npm/undeclared-js-yaml 规则需要这个
 * 全仓语义证据——零依赖插件（lib 不 import js-yaml）不应被报「未声明 js-yaml 依赖」。
 * @param {Array<{path:string, full:string}>} files 收集的文件清单
 * @returns {boolean} true=全仓存在 js-yaml import/require
 */
export function detectRepoJsYamlImport(files) {
  const RE = /(?:from\s+['"]js-yaml['"]|require\s*\(\s*['"]js-yaml['"]\s*\)|import\s*\(\s*['"]js-yaml['"]\s*\))/;
  for (const f of files || []) {
    try {
      const t = readText(f.full);
      if (RE.test(t)) return true;
    } catch { /* 读失败跳过（collector 已保证可读） */ }
  }
  return false;
}

/**
 * 版本号「路径/文件名上下文」豁免（v1.1.1 修复）：
 * version/embedded-major-zero 与 version/readme-zero-title 用 pattern 匹配任意
 * `v0.x.y` 字符串，会误伤「安装路径/文件名里的版本号」——如 README 数据示例
 * `Path('/vol2/.../dsh-v0.1.2-alpha.4/.dsh-home/...')` 里的 dsh-v0.1.2 是
 * DSH runtime 目录名（第三方环境路径），不是本项目版本标记，不应报。
 * 判定：v0.x.y 前一个字符是路径/文件名分隔符（/ - . _ 或字母数字），
 * 且整行含路径分隔符 / → 视为路径上下文，豁免。
 * @param {string} line 命中行文本
 * @returns {boolean} true=版本号处于路径/文件名上下文（应豁免）
 */
export function isVersionInPathContext(line) {
  const m = /[vV]0\.\d+\.\d+/.exec(String(line || ''));
  if (!m) return false;
  if (!String(line || '').includes('/')) return false; // 无路径分隔符 = 不是路径上下文
  const before = String(line || '')[m.index - 1] || '';
  return /[/\-._A-Za-z0-9]/.test(before);
}

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
  let findings = runChecks({ file, relPath, text, grouped: scopedGrouped }, { level: opts?.level, repoHasJsYamlImport: opts?.repoHasJsYamlImport });
  const isRuleDefFile = /(^|[/\\])audit-rules-[a-z0-9-]+\.ya?ml$/i.test(String(relPath || file));
  const fileLines = String(text || '').split('\n');
  // 语义级豁免（v1.1.1）：纯 regex 规则看不到的上下文在此兜底——
  // 1) timeout-on-external-api：命中调用内已设 AbortSignal.timeout/AbortController/timeout
  // 2) client-module-loader-id：文件已按 window.__ModuleLoader__.load({id, factory}) 契约注册
  //    （pattern 匹配到的是契约调用本身；规则本意是「缺契约才报」，已用契约即通过）
  const hasLoaderContract = /window\.__ModuleLoader__\.load\s*\(\s*\{\s*id\s*:/.test(text);
  // 豁免过滤（dsh-skip-* 注册表统一消费，覆盖 sensitive/size/func-length/syntax/quality/residue/style）
  findings = findings.filter((f) => {
    // 规则定义文件：规则驱动命中（secret/regex/path-regex/func-lines 等 yml 规则）全豁免
    if (isRuleDefFile && f.rule !== 'quality/empty-catch' && f.rule !== 'quality/sync-fs') return false;
    // residue/style：非代码文件豁免（文档/配置里的 debugger/console/风格字样非残留）
    if (!isCode && (f.kind === 'regex')) {
      const residueLike = /debugger|console|todo/i.test(f.rule);
      if (residueLike) return false;
    }
    // timeout 语义豁免：外部调用已设超时
    if (f.rule === 'robustness/timeout-on-external-api') {
      const idx = Math.max(0, (Number(f.line) || 1) - 1);
      if (hasExternalCallTimeout(fileLines[idx] || '', fileLines, idx)) return false;
    }
    // mkdir 语义豁免：写文件前同函数已建目录（ensureDataDir 模式）
    if (f.rule === 'robustness/mkdir-before-write') {
      const idx = Math.max(0, (Number(f.line) || 1) - 1);
      if (hasMkdirInSameFunction(fileLines, idx)) return false;
    }
    // 版本号路径上下文豁免：v0.x.y 出现在安装路径/文件名（如 dsh-v0.1.2 目录）而非版本标记
    if ((f.rule === 'version/embedded-major-zero' || f.rule === 'version/readme-zero-title')
      && isVersionInPathContext(fileLines[Math.max(0, (Number(f.line) || 1) - 1)] || '')) return false;
    // loader 契约语义豁免：已按统一 ModuleLoader 契约注册
    if (f.rule === 'dsh/client-module-loader-id' && hasLoaderContract) return false;
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
    testExemptRoot: root,
  });
  // 编译规则：调用方可传 compiled；未传时默认加载 nodejs 槽位（含 npm/html 等槽位建好后自动扩展）
  let compiled = opts.compiled;
  if (!compiled) {
    const loaded = loadRuleFiles(opts.slots, opts.rulesetDir ? { dir: opts.rulesetDir } : undefined);
    compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  }
  const grouped = groupByKind(compiled);
  // v1.1.1：全仓 js-yaml import 证据——npm/undeclared-js-yaml 规则语义是
  // 「lib import 了 js-yaml 但未声明依赖」；全仓没有任何 import/require 时
  // （零依赖项目）不报。先扫一遍全部文件文本收集证据，再逐文件审计。
  const repoHasJsYamlImport = detectRepoJsYamlImport(files);
  const findings = [];
  for (const f of files) {
    const text = readText(f.full);
    findings.push(...auditFile({ file: f.path, relPath: f.path, text, grouped }, { level: opts.auditLevel, repoHasJsYamlImport }));
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
  decorateTestExemptHint(findings);
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
  // v1.1.1：npm/undeclared-js-yaml 需全仓 import 证据（变动审计也能扫到未变动的
  // lib 文件里的 js-yaml 引用）；用收集器扫全仓文本做判定。
  const repoHasJsYamlImport = detectRepoJsYamlImport(collectTextFiles(repoPath, {
    depth: opts.depth ?? 10,
    gitIgnoreRoot: repoPath,
    testExemptRoot: repoPath,
  }));
  const findings = [];
  for (const f of targets) {
    const text = readText(f.full);
    findings.push(...auditFile({ file: f.rel, relPath: f.rel, text, grouped }, { level: opts.auditLevel, repoHasJsYamlImport }));
  }
  // 私密文件拦截（强制槽位，scope 无关）：变动审计同样跑 git ls-files 全量匹配
  const privateFiles = opts.privateFiles
    ?? (() => { try { return loadRuleFiles(opts.slots, opts.rulesetDir ? { dir: opts.rulesetDir } : undefined).merged.private_files || []; } catch { return []; } })();
  if (privateFiles.length) {
    findings.push(...checkPrivateFiles({ root: repoPath, visibility: opts.visibility || 'unknown', privateFiles }));
  }
  decorateTestExemptHint(findings);
  return { ok: true, scope: 'changed', repo: repoPath, findings, summary: summarize(findings), files: targets.length };
}

/** 统一审计入口（设置项 auditScanScope 决定默认走哪个）。 */
export function auditWithScope(repoPath, { scope = 'diff', ...opts } = {}) {
  return scope === 'full' ? auditFull(repoPath, opts) : auditChanged(repoPath, opts);
}