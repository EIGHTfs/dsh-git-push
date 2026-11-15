/**
 * 审计中间层 · 豁免编排（**唯一调用 `exemptForFinding` 的地方**）
 *
 * 分层后职责：
 *   引擎：产出 findings（可自带「我豁免了哪些」= 声明式 suppressed）
 *   本层：把「引擎声明式豁免 + 源码标记读取式豁免 + 内置 dsh-skip 语义」编排成统一判定
 *   底层（lib/exempt）：纯函数原语（marker 解析、行内/文件头语义、示例目录判定），**不在这里重写**
 *
 * 为什么需要第三方映射：换引擎后豁免写法完全不同——
 *   ESLint 用 `eslint-disable-next-line`、Semgrep 用 `nosemgrep`、Bandit 用 `# nosec`、
 *   gitleaks 用 `.gitleaksignore` 文件。中间层若不认这些，用户写的豁免在新引擎下**静默失效**
 *   （问题照报、用户以为标注无效），这是换引擎最容易踩的坑。
 *
 * 两种策略（文档 §4.3）：
 *   B 声明式：引擎自己报「哪些 finding 被它豁免了」⇒ 直接采信（语义最准，但要求引擎支持）
 *   A 读取式：中间层自己扫源码里的第三方标记 ⇒ 转成自己的判定（通用，任何引擎都能用）
 *   适配器用 `supportsSuppressed` 声明是否支持 B；B 优先、A 兜底。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { exemptForFinding } from '../exempt/index.js';

/**
 * 引擎豁免适配器表（**新增一个引擎只加一行**）。
 *
 * 字段：
 *   id                 引擎标识（与 cfg.preCommit 的自定义引擎命名对齐）
 *   supportsSuppressed 是否支持「声明式」（引擎自报 suppressed 列表）
 *   sourceMarkers      读取式要认的源码标记（用于说明与测试断言；匹配逻辑见 sourceMarkerExempts）
 *   ignoreFiles        读取式要认的忽略文件（相对仓库根）
 *   native             是否内置引擎（内置引擎的语义完全交给 lib/exempt，不再叠第三方标记）
 */
export const EXEMPT_ENGINE_ADAPTERS = Object.freeze([
  { id: 'builtin', supportsSuppressed: true, sourceMarkers: ['dsh-skip-*'], ignoreFiles: ['.auditignore'], native: true },
  {
    id: 'eslint',
    supportsSuppressed: true,
    // `eslint-disable-next-line` 作用下一行；`eslint-disable` 作用「此处到文件尾」
    sourceMarkers: ['eslint-disable-next-line', 'eslint-disable-line', 'eslint-disable'],
    ignoreFiles: ['.eslintignore'],
  },
  { id: 'semgrep', supportsSuppressed: false, sourceMarkers: ['nosemgrep'], ignoreFiles: ['.semgrepignore'] },
  { id: 'bandit', supportsSuppressed: false, sourceMarkers: ['nosec'], ignoreFiles: ['.banditignore'] },
  { id: 'gitleaks', supportsSuppressed: false, sourceMarkers: [], ignoreFiles: ['.gitleaksignore'] },
]);

/**
 * 取引擎适配器。
 * 未知引擎返回「只有读取式、无标记」的空适配器：不猜它的语义，也不因此崩掉审计。
 * @param {string} engineId
 * @returns {{id: string, supportsSuppressed: boolean, sourceMarkers: string[], ignoreFiles: string[], native: boolean}}
 */
export function getEngineAdapter(engineId = 'builtin') {
  const id = String(engineId || 'builtin');
  return EXEMPT_ENGINE_ADAPTERS.find((adapter) => adapter.id === id)
    || { id, supportsSuppressed: false, sourceMarkers: [], ignoreFiles: [], native: false };
}

/** 源码按行切分（保留原始行，缺行返回空数组）。 */
function linesOf(text = '') {
  return String(text || '').split('\n');
}

/**
 * 读取式判定：源码标记是否豁免了这条 finding。
 *
 * 语义（按各引擎真实行为，不要想当然统一成「同行」）：
 *   - eslint-disable-next-line：标记在**上一行**时豁免本行
 *   - eslint-disable-line：标记在**本行**时豁免本行
 *   - eslint-disable（无 -next-line/-line 后缀）：从标记行起**到文件尾**全部豁免
 *   - nosemgrep / nosec：标记在**本行**时豁免本行（Semgrep/Bandit 都是行级）
 * @param {string} engineId
 * @param {string} text 文件全文
 * @param {{line?: number}} finding
 * @returns {boolean}
 */
export function sourceMarkerExempts(engineId, text = '', finding = {}) {
  const adapter = getEngineAdapter(engineId);
  if (adapter.native) return false; // 内置引擎语义交给 lib/exempt（避免与 dsh-skip 混淆）
  const lineNo = Number(finding?.line) || 0;
  if (lineNo <= 0) return false;
  const lines = linesOf(text);
  const at = (idx) => String(lines[idx] || '');
  const current = at(lineNo - 1);
  const previous = at(lineNo - 2);

  if (adapter.sourceMarkers.includes('eslint-disable-line') && /eslint-disable-line\b/.test(current)) return true;
  if (adapter.sourceMarkers.includes('eslint-disable-next-line') && /eslint-disable-next-line\b/.test(previous)) return true;
  if (adapter.sourceMarkers.includes('eslint-disable')) {
    // 文件级：本行之前（含本行）出现过不带 -next-line/-line 的 eslint-disable ⇒ 本行被豁免
    for (let index = 0; index < lineNo; index += 1) {
      const line = at(index);
      if (/eslint-disable\b(?!-)/.test(line)) return true;
    }
  }
  for (const marker of adapter.sourceMarkers) {
    if (marker === 'nosemgrep' && /nosemgrep\b/.test(current)) return true;
    if (marker === 'nosec' && /#\s*nosec\b/.test(current)) return true;
  }
  return false;
}

/**
 * 声明式判定：引擎自报的 suppressed 列表里是否包含这条 finding。
 *
 * 支持的两种形态（引擎作者自己选，中间层都认）：
 *   - 位置形态：`{ file, line }` 或 `{ file, line, rule }`（file 相对仓库根）
 *   - 指纹形态：`{ fingerprint }`（gitleaks 风格；与 finding.fingerprint 直接比对）
 * @param {Array<object>} suppressed
 * @param {{file?: string, line?: number, rule?: string, fingerprint?: string}} finding
 * @returns {boolean}
 */
export function declaredExempts(suppressed = [], finding = {}) {
  if (!Array.isArray(suppressed) || suppressed.length === 0) return false;
  const normalize = (value) => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  return suppressed.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.fingerprint && finding.fingerprint && String(entry.fingerprint) === String(finding.fingerprint)) return true;
    if (entry.file === undefined) return false;
    if (normalize(entry.file) !== normalize(finding.file)) return false;
    if (entry.line !== undefined && Number(entry.line) !== Number(finding.line)) return false;
    if (entry.rule !== undefined && String(entry.rule) !== String(finding.rule)) return false;
    return true;
  });
}

/**
 * 单条 finding 是否被豁免（编排入口）。
 *
 * 优先级：声明式（B）> 读取式（A）> 内置原生（native，仅 builtin 引擎）。
 *   为什么 B 优先：引擎自己最清楚它豁免了什么（含规则别名、配置继承等中间层看不见的因素）；
 *   只有在引擎不支持声明式时，才退回到「中间层自己扫标记」。
 * @param {object} finding
 * @param {object} [opts] `{ engine, text, suppressed, textOf }`
 *   text  = 该 finding 所在文件的全文（可选；给了才做读取式）
 *   textOf = 函数 (file) => text，findings 来自多个文件时用它按需取
 * @returns {{exempted: boolean, reason?: string}}
 */
export function exemptionOf(finding = {}, opts = {}) {
  const engineId = opts.engine || 'builtin';
  const adapter = getEngineAdapter(engineId);

  // ① 声明式（B）：引擎自报
  if (adapter.supportsSuppressed && declaredExempts(opts.suppressed, finding)) {
    return { exempted: true, reason: `${engineId}:declared` };
  }
  // ② 内置引擎：交给 lib/exempt 的原生语义（dsh-skip-* / .auditignore 等由上层处理）
  if (adapter.native) {
    const text = typeof opts.text === 'string' ? opts.text : (typeof opts.textOf === 'function' ? opts.textOf(finding.file) : '');
    return exemptForFinding(finding, text) === true ? { exempted: true, reason: 'builtin:native' } : { exempted: false };
  }
  // ③ 读取式（A）：中间层扫源码标记
  const text = typeof opts.text === 'string' ? opts.text : (typeof opts.textOf === 'function' ? opts.textOf(finding.file) : '');
  if (text && sourceMarkerExempts(engineId, text, finding)) {
    return { exempted: true, reason: `${engineId}:marker` };
  }
  return { exempted: false };
}

/**
 * 编排入口：标注（不改底层、不过滤）整批 findings。
 *
 * 返回值是**新数组**（finding 已带 `exempted`），调用方决定是过滤掉还是保留可追溯
 *   ——这与现有语义一致：`scoreQuality` 的 `countByDimension` 会跳过 `f.exempted`，
 *   报告里仍能看到「这条被豁免了」（可追溯）。
 * @param {Array<object>} findings
 * @param {object} [opts] 见 exemptionOf
 * @returns {Array<object>}
 */
export function resolveExemptions(findings = [], opts = {}) {
  return findings.map((finding) => {
    const verdict = exemptionOf(finding, opts);
    if (!verdict.exempted) return finding;
    return { ...finding, exempted: true, exemptReason: verdict.reason };
  });
}

/**
 * 只要「没被豁免的那些」（`lib/audit/audit-file.js` 的既有形态）。
 * @param {Array<object>} findings
 * @param {object} [opts]
 * @returns {Array<object>}
 */
export function filterExempted(findings = [], opts = {}) {
  return findings.filter((finding) => exemptionOf(finding, opts).exempted === false);
}

/**
 * 读取忽略文件（`.gitleaksignore` 等）的指纹集合。
 *
 * 文件不存在 / 读失败一律返回空集合：忽略文件缺省是常态，不能因此中断审计。
 * 每行一个指纹；`#` 开头为注释；空行跳过。
 * @param {string} repoPath
 * @param {string} fileName 相对仓库根的文件名
 * @returns {Set<string>}
 */
export function loadIgnoreFingerprints(repoPath = '.', fileName = '.gitleaksignore') {
  try {
    const text = readFileSync(join(repoPath, fileName), 'utf8');
    return new Set(text.split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')));
  } catch {
    return new Set();
  }
}
