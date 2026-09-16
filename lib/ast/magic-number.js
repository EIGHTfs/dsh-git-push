/**
 * AST 实现层 · 硬编码魔数检查
 *
 * 职责：token 级识别数字字面量，并豁免版本号/日期/HTTP 状态码/命名常量等合法常量。
 *   注释里的版本号、字符串里的 CSS 字号都不是 num token，天然不进入检查。
 */

import { tokenize } from './tokenizer.js';

/* ───────────────────────── 硬编码魔数检测（token 级，版本号豁免版） ───────────────────────── */

/** HTTP 常见状态码（魔数豁免清单：status/http 上下文里出现即豁免）。 */
const HTTP_STATUS_CODES = new Set([100, 101, 102, 103, 200, 201, 202, 203, 204, 205, 206, 207, 208, 226,
  300, 301, 302, 303, 304, 305, 307, 308, 400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410,
  411, 412, 413, 414, 415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451,
  500, 501, 502, 503, 504]);

/** 公认合法常量（进制/时间/容量等，无魔数上下文时豁免）。 */
const COMMON_NUM_CONSTANTS = new Set(['0', '1', '-1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '16',
  '24', '30', '31', '32', '60', '100', '128', '256', '365', '512', '1000', '1024', '2048', '3600', '4096', '86400', '65535']);

const DEFAULT_MAGIC_HINTS = ['timeout', 'retry', 'max', 'min', 'limit', 'size', 'count', 'port',
  'interval', 'delay', 'duration', 'threshold', 'buffer', 'chunk'];

const DEFAULT_LEGIT_HINTS = ['version', 'date', 'year', 'month', 'day', 'hour', 'minute', 'second', 'http', 'status'];

/**
 * 硬编码魔数检测（token 级，版本号豁免版）。
 *
 * 为什么是 token 级：逐行正则无法区分「代码里的数字」与「注释/字符串里的数字」——
 * 注释里的版本号（`// v1.8.0：数据升级`）、CSS 字号（'.x{font-weight:650}'）、
 * i18n 字典值都会误报。tokenizer 已把注释/字符串/模板串分类成独立 token 类型，
 * 只对 num token（真正的数字字面量）判定，从根上消除上述误报，无需任何「跳过行」补丁。
 *
 * 检测：num token 且形态为 ≥2 位整数 / 小数 / 十六进制（单数字与 0/1 边界天然不参与）。
 * 豁免（任一命中即不报）：
 *   · 公认合法常量（0/1/60/100/1000/1024/3600/86400 等），除非处于魔数上下文；
 *   · legit 上下文（version/date/year/month/day/hour/minute/second/http/status 词邻近）；
 *   · HTTP 状态码 + status/http 上下文；
 *   · 字符串/注释里的数字（tokenizer 层面即非 num，天然不进入检测）。
 * 强制报：邻近 token 命中魔数上下文（timeout/retry/max/min/limit/size/count/port/interval/
 *   delay/duration/threshold/buffer/chunk），或同一数字文件内出现 ≥ forceCount 次。
 *
 * @param {string} text 文件全文
 * @param {{magicHints?:string[], legitHints?:string[], forceCount?:number}} [opts]
 * @returns {Array<{line:number, raw:string, num:string, count:number, magicCtx:boolean}>}
 */
export function checkMagicNumberSmartAst(text = '', {
  magicHints = DEFAULT_MAGIC_HINTS, legitHints = DEFAULT_LEGIT_HINTS, forceCount = 3,
} = {}) {
  const tokens = tokenize(text);
  const hintTest = (hints) => {
    const regexes = hints.map((h) => new RegExp(`(^|[^a-z])${h}`, 'i'));
    return (ctx) => regexes.some((r) => r.test(ctx));
  };
  const isMagicCtx = hintTest(magicHints);
  const isLegitCtx = hintTest(legitHints);
  const hits = [];
  const counts = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'num') continue; // 注释/字符串/tmpl token 天然排除——本检查只认代码里的数字字面量
    const raw = String(t.value);
    const norm = raw.replace(/_/g, '').replace(/n$/, ''); // 60_000 → 60000、10n → 10
    if (!/^(?:0[xX][0-9a-fA-F]+|\d{2,}(?:\.\d+)?|\d+\.\d+)$/.test(norm)) continue; // 单数字不参与
    const numeric = /^0[xX]/.test(norm) ? parseInt(norm, 16) : Number(norm);
    if (!Number.isFinite(numeric)) continue;
    // 上下文 = 邻近 token 文本（前置 6 个看命名，后置 4 个看单位/参数位）
    const before = tokens.slice(Math.max(0, i - 6), i).map((x) => x.value).join(' ');
    const after = tokens.slice(i + 1, i + 5).map((x) => x.value).join(' ');
    const ctx = `${before} ${after}`;
    const magicCtx = isMagicCtx(before) || isMagicCtx(ctx);
    const legitCtx = isLegitCtx(ctx);
    // ── 2026-09-13 四类豁免（修 scoreboard 误报；规格表：版本号/日期/HTTP 状态码/
    //    常见合法常量自动豁免，无上下文裸数字仍报）──
    // ① 命名常量定义值：`const NAME = <数字>` / `const NAME = [<数字>, ...]`——
    //    数字就是该常量的定义值，报「建议提取为命名常量」自相矛盾
    //    （PAGE_SIZES = [10, 20, 50]、API_ROW_LIMIT = 200、TTL_MS = 5 * 60_000）。
    if (isNamedConstantValue(tokens, i)) continue;
    // ② HTTP 状态码：数字 ∈ HTTP_STATUS_CODES 且非魔数上下文即豁免——
    //    sendJson(res, 405, ...) 的 405、const code = 500 的 500 都是状态码不是魔数；
    //    不要求实参位置（状态码赋值给 code/status 类变量同样豁免）。
    if (!magicCtx && HTTP_STATUS_CODES.has(numeric)) continue;
    // ③ 函数参数默认值：`(e, max = 120)` —— 参数名 max 已说明含义，默认值不是硬编码
    if (/[,(]\s*[a-zA-Z_$][\w$]*\s*=\s*$/.test(before)) continue;
    // ④ 常见合法常量（1024/3600/86400 等进制、时间、容量单位）即使处于魔数上下文也豁免
    //    ——8 * 1024 * 1024 是 8MB 的容量表达，1024 是单位不是魔数。
    if (COMMON_NUM_CONSTANTS.has(norm)) continue;
    if (!magicCtx && legitCtx) continue;
    if (!magicCtx && HTTP_STATUS_CODES.has(numeric) && /status|http/i.test(ctx)) continue;
    counts.set(norm, (counts.get(norm) || 0) + 1);
    hits.push({ line: t.line, raw, num: norm, magicCtx });
  }
  // 输出：同一数字只报首次出现的行。
  // 2026-09-13 修：旧逻辑「count>=forceCount 或 magicCtx 才报」会把「单次出现且无
  //   魔数上下文的裸数字」过滤掉——规格表 ❌ 项（const x = 1.2 / if (score > 1.5) /
  //   const ratio = 1.2）全是这种情况，应报。豁免已在上面四类（命名常量值/HTTP 状态码
  //   实参/参数默认值/常见合法常量）处理完，能走到这里的数字就是该报的魔数；
  //   count 与 magicCtx 仅作 message 信息（forceCount 语义并入 message）。
  const out = [];
  const reported = new Set();
  for (const hit of hits) {
    if (reported.has(hit.num)) continue;
    reported.add(hit.num);
    out.push({ line: hit.line, raw: hit.raw, num: hit.num, count: counts.get(hit.num) || 1, magicCtx: hit.magicCtx });
  }
  return out;
}

/**
 * 判定数字 token 是否为「命名常量定义值」：向前看是否有 `const/let/var NAME = ` 模式
 * （NAME 为大写常量名或含 version/date 语义），数组字面量 [10, 20, 50] 内同样算。
 * 规则本意是「把散落的数字提取为命名常量」——数字已经是命名常量的定义值时不报。
 * @param {Array} tokens token 流
 * @param {number} numIdx 数字 token 下标
 * @returns {boolean}
 */
function isNamedConstantValue(tokens, numIdx) {
  // 从数字往回：先跳过「值表达式」部分——运算符（* / + - %）、其他数字、数组分隔符
  // （[ ] ,）都属于赋值右侧表达式；然后找 `=`，`=` 前一个标识符是常量名，
  // 再前一个是 const/let/var。命中 `const NAME = <expr>` 即视为命名常量定义值。
  //   const PAGE_SIZES = [10, 20, 50]  → 50 往回跳 , 20 , 10 [ 后遇 =
  //   const TTL_MS = 5 * 60_000       → 60000 往回跳 * 5 后遇 =
  const SKIP = new Set(['*', '/', '+', '-', '%', '[', ']', ',', '(', ')']);
  let eqIdx = -1;
  for (let j = numIdx - 1; j >= Math.max(0, numIdx - 12); j--) {
    const tj = tokens[j];
    if (tj.type === 'ws' || tj.type === 'comment') continue;
    if (tj.type === 'num' || SKIP.has(tj.value)) continue; // 值表达式/数组分隔符
    if (tj.value === '=') { eqIdx = j; break; }
    if (tj.value === ';') return false; // 越出语句
    if (tj.type === 'ident') return false; // 遇到别的标识符（如 return data.x + 1）
    return false;
  }
  if (eqIdx === -1) return false;
  // `=` 前一个非空白 token 应为常量名，再前一个应为 const/let/var
  let constName = null;
  let declKw = null;
  for (let j = eqIdx - 1; j >= 0; j--) {
    const tj = tokens[j];
    if (tj.type === 'ws' || tj.type === 'comment') continue;
    if (!constName) { if (tj.type !== 'ident') return false; constName = tj; continue; }
    declKw = tj;
    break;
  }
  if (!constName || !declKw || !['const', 'let', 'var'].includes(declKw.value)) return false;
  // 常量名：全大写（PAGE_SIZES/API_ROW_LIMIT/TTL_MS）、常见前缀驼峰（dshgp_FETCH_TIMEOUT_MS、
  //   DEFAULT_WEIGHTS、MAX_SCAN_FILES、LIST_LIVE_BUDGET_MS——带语义词尾 timeout/limit/size/count/
  //   ms 等也是命名常量），或含 version/date 等语义。2026-09-16 修：此前只认全大写——
  //   项目自己的 `dshgp_*` 前缀常量被误报成魔数（建议提取为命名常量，自相矛盾）。
  const constNameStr = constName.value;
  const semanticTail = /(timeout|retry|max|min|limit|size|count|interval|delay|duration|threshold|buffer|chunk|version|date|year|month|day|hour|minute|second|total|ms|kb|mb|rounds|levels|weight|score|price|ratio|percent|budget|lookahead)/i;
  return /^[A-Z][A-Z0-9_]*$/.test(constNameStr)
    || /^[a-z]+_[A-Z][A-Z0-9_]*$/.test(constNameStr)   // 小写前缀_全大写尾（dshgp_FETCH_TIMEOUT_MS）
    || semanticTail.test(constNameStr)
    || /version|date|year|month|day|hour|minute|second|total|count|limit|size/i.test(constNameStr);
}
