/**
 * AST 实现层 · 凭据检查
 *
 * 职责：凭据标识符右侧值判定（硬编码/引用/类型检查）、前缀型密钥串的占位符精筛。
 *
 * 占位符判据（CRED_PLACEHOLDER / CRED_SCHEME_PREFIX / isMeaningfulCredentialValue）
 *   必须只有一份：两处检查共用，否则判据漂移会出现「同一串值 A 规则放行、
 *   B 规则拦截」的自相矛盾。
 */

import { tokenize } from './tokenizer.js';

/**
 * 检查「凭据类标识符是否真的被赋了字面量值」（no-hardcoded-credentials kind 的 AST 精筛）。
 *
 * 正则 `token\s*[=:]+\s*['"][^'"]+['"]` 命中即报，会把下列**非硬编码**场景误报：
 *  - 类型/存在性检查：`typeof cfg.githubToken === 'string'`、`next.apiKey.trim()`
 *  - 字段透传/引用：`cfg.githubToken = init.githubToken`（右侧是变量，不是字面量）
 *  - 默认值取自配置：`token = options.token || ''`（右侧是表达式/空串）
 * 本实现在 token 级确认：只有当「凭据标识符」右侧的赋值/初始化**直接是字符串字面量**
 * 且该字面量**非空、非占位符**时才判定为硬编码。
 *
 * @param {string} text 文件全文
 * @param {object} [opts] { literalOnly=true } 是否只认「右侧直接是字面量」
 * @returns {Set<number>} 判定为「确实硬编码凭据」的行号集合
 */
/**
 * 凭据占位符判据（模块级共用）——2026-09-13。
 *
 * 为什么不写在单个检查里：占位符识别被两处用到，必须**同一套判据**——
 *   ① checkCredentialRefAst（凭据标识符右侧字面量）
 *   ② checkPlaceholderCredentialAst（前缀型密钥串，如 ghp_/sk-/AKIA）
 *   各写一份必然漂移，出现「同一串值 A 规则放行、B 规则拦截」的矛盾。
 */

/** 明显不是真凭据的值：空、掩码、占位文案、演示/测试数据。 */
const CRED_PLACEHOLDER = /^(|\s*|x+|\*+|<[^>]*>|your[-_ ]?.*|change[-_ ]?me|todo|placeholder|example.*|demo.*|sample.*|test.*|dummy.*|fake.*|xxx.*|redacted|masked|none|null|undefined)$/i;

/** 单段文本是否占位符文案。 */
function isPlaceholderText(text) {
  return CRED_PLACEHOLDER.test(String(text));
}

/**
 * 常见凭据 scheme 前缀：判占位符前先剥掉再判一次。
 *   否则带前缀的演示值会漏判——`ghp_` + 「Example…」开头的演示值，其首个词不是 example，
 *   匹配不到 `example.*`，就被当成真凭据报拦截（演示数据/夹具里的常见写法）。
 *   剥前缀不会放过真凭据：真实随机串剥完仍非占位符，照样报。
 */
const CRED_SCHEME_PREFIX = /^(gh[pousr]_|github_pat_|sk-[a-z]*-?|xox[baprs]-|glpat-|AKIA)/i;

/**
 * 运行时求值形态：值不是「写死的字面量」，而是运行期由 shell/模板求出来的。
 *
 *   背景（真实误报）：`TOKEN="$(read_token)"` 被 security/no-hardcoded-credentials
 *   报为硬编码凭据——分词器把整个 `"$(read_token)"` 当成一个 str token，本模块
 *   只看「是不是占位符文案」，看不出值是命令替换，于是照报。
 *   这类写法值来自函数/shell，代码里并没有凭据内容，属误报。
 *
 *   只认三种明确形态（刻意收紧）：
 *     ① `$(cmd)` 命令替换
 *     ② `${VAR}` 花括号插值
 *     ③ 以 `$` 开头：纯变量引用 `$TOKEN` / `$1`
 *   **不**认「含 $ 即可」——`my$ecret`、`pass$word!` 这类带 $ 的真密码必须照报，
 *   否则规则出现后门（实测按「含 $」判会放过 4 类真凭据）。
 */
const CRED_INTERPOLATED = /\$\(|\$\{|^\$[A-Za-z0-9_]/;

/** 去掉字符串字面量外层引号。 */
function stripQuotes(raw) {
  return String(raw).replace(/^(\'|"|`)([\s\S]*)\1$/, '$2').trim();
}

/**
 * 判断一个字面量值是否算「真凭据」（非空、非掩码、非占位/演示）。
 *
 * @param raw 原始字面量（可带引号）
 * @returns true = 像真凭据（应报）；false = 占位符/空值（豁免）
 */
export function isMeaningfulCredentialValue(raw) {
  const v = stripQuotes(raw);
  if (!v) return false;
  if (isPlaceholderText(v)) return false;
  // 运行时求值（$(cmd) / ${VAR} / $VAR）→ 值不在代码里，不是硬编码
  if (CRED_INTERPOLATED.test(v)) return false;
  return !isPlaceholderText(v.replace(CRED_SCHEME_PREFIX, ''));
}

/*
 * 刻意不做「按 -/_ 拆段逐段判占位符」：试过并撤回。
 *   拆段会把「sk- + test + 随机串」形状的值（scheme 段里带 test）整体豁免——
 *   但这类值是真检出：仓库自身测试夹具正是用它证明「非豁免目录的 blocker 会拦截提交」，
 *   放宽后门禁形同虚设。占位符豁免必须取最小面：只认「整串/剥掉 scheme 前缀后即以
 *   占位词开头」，不认藏在中间段里的演示词。
 */

/**
 * astConfirmKind: "placeholder-credential" 的精筛集合（mode: deny）。
 *
 * 场景：`secret-github-pat` / `secret-openai-key` / `secret-aws-access-key` 这类
 *   **前缀形状匹配**的规则（`\\bghp_[A-Za-z0-9]{20,}\\b`），只看形状不看语义——
 *   文档里写「测试用占位符 + ghp_ 前缀」、演示页假数据
 *   `ghp_ExampleToken…` 都会被判成真泄漏（error 级，摘要计入拦截数）。
 *
 * 判定：把命中的密钥串剥掉 scheme 前缀后套占位符判据；命中即加入豁免集。
 *   只看「该串本身是不是占位符」，不做路径/文件级豁免——真 token 无论写在哪个文件都照报。
 *
 * @param text 文件全文
 * @returns Set<number> 命中「占位符凭据」的行号（1 起始）
 */
export function checkPlaceholderCredentialAst(text = '') {
  const out = new Set();
  const SCAN = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16})\b/g;
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    SCAN.lastIndex = 0;
    let match;
    while ((match = SCAN.exec(lines[i])) !== null) {
      if (isMeaningfulCredentialValue(match[1]) === false) { out.add(i + 1); break; }
    }
  }
  return out;
}

/** 凭据语义标识符（命名含这些词的变量/字段才纳入判断）。 */
const CRED_IDENT = /(password|passwd|pwd|secret|token|apikey|api_key|accesskey|access_key|cookie|credential|privatekey|private_key)/i;

/**
 * 在一段 token 序列上判「凭据标识符右侧是否直接是有效字符串字面量」，命中行号写入 out。
 *
 * @param {Array} tokens tokenize() 结果
 * @param {Set<number>} out 命中行号集合（调用方传入，可累加）
 * @param {number} [lineOffset=0] 行号偏移（子文本从第 1 行重新计数时用）
 */
function scanCredentialTokens(tokens, out, lineOffset = 0) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || !CRED_IDENT.test(t.value)) continue;
    // 向后找该标识符所在语句的赋值/比较运算符（遇到语句边界就放弃）
    let opIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 8); j++) {
      const tj = tokens[j];
      if (tj.type !== 'punct') continue;
      if ([';', '{', '}'].includes(tj.value)) break;      // 语句结束，本标识符未被赋值
      if (['=', ':', '==', '===', '!='].includes(tj.value)) { opIdx = j; break; }
      if (['.', '(', ')', ','].includes(tj.value)) continue;
    }
    if (opIdx === -1) continue;
    // 只看严格赋值 `=`（`==`/`===` 是判断、`:` 是对象字面量字段声明，另判）
    const opTok = tokens[opIdx];
    const next = tokens[opIdx + 1];
    if (!next) continue;
    if (opTok.value === '=') {
      // 右侧直接是字符串字面量 → 真硬编码
      if (next.type === 'str' && isMeaningfulCredentialValue(next.value)) out.add(t.line + lineOffset);
      continue;
    }
    if (opTok.value === ':') {
      // 对象字面量 `token: 'abc'` → 真硬编码；`token: cfg.token` 是引用，不报
      if (next.type === 'str' && isMeaningfulCredentialValue(next.value)) out.add(t.line + lineOffset);
    }
  }
}

export function checkCredentialRefAst(text = '') {
  const raw = String(text);
  const out = new Set();
  scanCredentialTokens(tokenize(raw), out);
  // markdown 行内代码段兜底：`token: "abc"` 里的反引号被分词器当成模板字面量定界符，
  //   整段合并成一个 tmpl token，内部**不产生** ident/punct/str，直接扫原始 token 会漏报。
  //   而「文档里用行内代码段写配置示例」恰恰是最常见的写法——实测漏报：同一行写法在 .js 里
  //   报、放进 .md 的行内代码段就不报。故把 tmpl 内部文本单独再分词扫一遍。
  //   判据仍是同一个 scanCredentialTokens，不新增第二套判定。
  for (const t of tokenize(raw)) {
    if (t.type !== 'tmpl') continue;
    const inner = String(t.value).replace(/^`+/, '').replace(/`+$/, '');
    if (!inner.trim()) continue;
    scanCredentialTokens(tokenize(inner), out, t.line - 1);
  }
  return out;
}
