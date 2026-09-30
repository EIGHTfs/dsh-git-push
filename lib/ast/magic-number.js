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
 // Python 枚举成员行（class X(Enum) 体内的大写 NAME = 数字）——支持
  const pythonEnumLines = collectPythonEnumAssignLines(text);
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
    // ── Python 枚举成员豁免（修复 KToolBox 等 Python 项目评估失真）──
    //    `class Status(IntEnum):` 体内的 `PENDING = 1001` 是枚举成员定义值，
    //    不是「散落魔数」——枚举码就是有意设计的标识符。识别：枚举类体内
    //    缩进层的大写 `NAME = <数字>` 赋值行。
    if (pythonEnumLines.has(t.line)) continue;
    // ── 四类豁免（修 scoreboard 误报；规格表：版本号/日期/HTTP 状态码/
    //    常见合法常量自动豁免，无上下文裸数字仍报）──
    // ① 命名常量定义值：`const NAME = <数字>` / `const NAME = [<数字>, ...]`——
    //    数字就是该常量的定义值，报「建议提取为命名常量」自相矛盾
    //    （PAGE_SIZES = [10, 20, 50]、API_ROW_LIMIT = 200、TTL_MS = 5 * 60_000）。
    if (isNamedConstantValue(tokens, i)) continue;
    // ② HTTP 状态码：数字 ∈ HTTP_STATUS_CODES 即豁免——sendJson(res, 405, ...) 的 405、
    //    `status_code == 429` 的 429 都是状态码不是魔数；**不要求 !magicCtx**（
    //    变量名带 retry/limit 等魔数关键词（retryable_status）会被 isMagicCtx 误判为
    //    「魔数上下文」，但状态码语义本身合法，应先豁免——状态码 > 上下文提示）。
    if (HTTP_STATUS_CODES.has(numeric)) continue;
    // ④ 配置兜底默认值（2026-09-30，Pawchive 核对 8 处误报中的 4 处）：
    //    `Number(env) || 3000` / `process.env.X ?? 10000`——||/?? 右侧是配置缺失时的默认值，
    //    不是散落魔数（兜底写法本身说明语义）。
    if (tokens[i - 1] && (tokens[i - 1].value === '||' || tokens[i - 1].value === '??')) continue;
    // 2026-10-05 修（Pawchive）：比较阈值——`n < 1048576` / `> 65536`——比较运算符后的数字
    //   是界限/阈值语义（比较即声明边界），不是散落魔数
    if (tokens[i - 1] && ['<', '>', '<=', '>='].includes(tokens[i - 1].value)) continue;
    // 2026-10-05 修（Pawchive）：超时 API 配置参数——`AbortSignal.timeout(5000)`（超时上限语义；
    //   普通 setTimeout(fn, N) 回调用时长是「真魔数上下文」仍报——见 test-magic 魔数上下文用例）
    if (/AbortSignal\s*\.\s*timeout\s*\(/.test(before)) continue;
    // ⑤ 配置字段/属性赋值默认值（2026-09-30，Pawchive 核对：CONFIG.pageSize=50 /
    //    { pageSize: 50 } 等配置字段）：属性名/成员名已说明含义，值即默认值非散落魔数
    //    （`obj.prop = N` member 赋值 / `{ prop: N }` 对象属性值——CSS 样式属性同形态）。
    const prev2 = tokens[i - 2];
    const prev3 = tokens[i - 3];
    const isPropAssign = Boolean(tokens[i - 1] && tokens[i - 1].value === '=' && prev3 && prev3.value === '.'); // obj.prop = N：= 在 i-1，. 在 i-3
    // 对象属性值仅豁免「配置语义属性名」（pageSize/apiTimeoutMs/apiRetryIntervalMs 等——
    //    Pawchive 核对），普通对象数字（{ width: 1400 } 布局/样式属性）照报。
    const isObjPropVal = Boolean(tokens[i - 1] && tokens[i - 1].value === ':' && prev2
      && /(size|ms|bytes|kb|mb|gb|timeout|interval|retry|limit|port|count|delay|duration|threshold|max|min|buffer|chunk|ttl|backoff|window)$/i.test(String(prev2.value)));
    if (isPropAssign || isObjPropVal) continue;
    // ③ 函数参数默认值：`(e, max = 120)` —— 参数名 max 已说明含义，默认值不是硬编码
 // Python 形态 `timeout: float = 5.0`（含类型注解，：KToolBox
    //    api/client.py 的 timeout/retry_interval 默认值此前误报）。
    if (/[,(]\s*[a-zA-Z_$][\w$]*\s*(:\s*[A-Za-z_$][\w$.\[\]]*\s*)?=\s*$/.test(before)) continue;
    // ④ 常见合法常量（1024/3600/86400 等进制、时间、容量单位）即使处于魔数上下文也豁免
    //    ——8 * 1024 * 1024 是 8MB 的容量表达，1024 是单位不是魔数。
    if (COMMON_NUM_CONSTANTS.has(norm)) continue;
 // ④b CSS 色值豁免：rgba(255,255,255,.08) / #fff 的 255 是 RGB 通道上限，
    //    不是「散落魔数」——前文 token 含 rgba/rgb/color 语义即豁免（0-255 通道值）。
    if (!magicCtx && /rgba?\s*\(|color/i.test(before)) continue;
 // ④c 日期时间构造豁免：datetime(2024, 1, 1, 0, 0, 0) / date(2026, 9, 1)
    //    的年/月/日/时/分/秒参数是日期语义，不是散落魔数（KToolBox 断言用 datetime 构造
    //    具体时刻，数字全是时间组成部分）。
    if (!magicCtx && /datetime|date\s*\(|time\s*\(/i.test(before)) continue;
 // ④d pydantic Field 参数豁免：Field(default=30 * 60, ge=1, le=3600)
    //    的 default/ge/le/gt/lt/multiple_of 是字段约束声明，数字是约束值不是魔数。
    if (!magicCtx && /field\s*\(|default\s*=|ge\s*=|le\s*=|gt\s*=|lt\s*=|multiple_of\s*=/i.test(before)) continue;
    if (!magicCtx && legitCtx) continue;
    if (!magicCtx && HTTP_STATUS_CODES.has(numeric) && /status|http/i.test(ctx)) continue;
    counts.set(norm, (counts.get(norm) || 0) + 1);
    hits.push({ line: t.line, raw, num: norm, magicCtx });
  }
  // 输出：同一数字只报首次出现的行。
  // 修：旧逻辑「count>=forceCount 或 magicCtx 才报」会把「单次出现且无
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
  // 从数字往回：先跳过「值表达式」部分——运算符（* / + - %）、其他数字、数组/对象分隔符
  // （[ ] , { } :）都属于赋值右侧表达式；然后找 `=`，`=` 前一个标识符是常量名，
  // 再前一个是 const/let/var。命中 `const NAME = <expr>` 即视为命名常量定义值。
  //   const PAGE_SIZES = [10, 20, 50]  → 50 往回跳 , 20 , 10 [ 后遇 =
  //   const TTL_MS = 5 * 60_000       → 60000 往回跳 * 5 后遇 =
  //   const SHOT_VIEWPORT = { width: 1400, height: 900 }  → 1400 往回跳 : width { 后遇 =
 // （补 { } :——对象字面量常量定义此前不识别，仍报「建议提取常量」自相矛盾）
  const SKIP = new Set(['*', '/', '+', '-', '%', '[', ']', ',', '(', ')', '{', '}', ':']);
  let eqIdx = -1;
  for (let j = numIdx - 1; j >= Math.max(0, numIdx - 40); j--) {
    const tj = tokens[j];
    if (tj.type === 'ws' || tj.type === 'comment') continue;
    if (tj.type === 'num' || SKIP.has(tj.value)) continue; // 值表达式/数组对象分隔符
    if (tj.value === '=') { eqIdx = j; break; }
    if (tj.value === ';') return false; // 越出语句
    if (tj.type === 'ident') {
      // 对象字面量属性名（{ width: 1400 } 的 width）是常量定义的一部分，
      //   往回跳时允许经过——但只在「该 ident 后跟 ':'」时（属性名 ≠ 其他表达式标识符）。
      const nextT = tokens[j + 1];
      if (nextT && nextT.value === ':') continue; // 属性名：{ width: 1400 } 的 width
      return false;
    }
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
  if (!constName) return false;
  // declKw 放宽——Python 无 const/let/var，`API_VERSION = 2023` 是命名常量
  //   但 declKw 是行首/其他标识符。放宽：declKw 为 const/let/var → 常规路径；
  //   否则（Python 或 JS 裸赋值）仅当 constName **全大写**（PEP8 常量惯例）才豁免——
  //   小写裸赋值（x = 42）是普通变量赋值，值 42 仍算魔数（该报）。
  const hasDeclKw = declKw && ['const', 'let', 'var'].includes(declKw.value);
  const allCaps = /^[A-Z][A-Z0-9_]*$/.test(constName.value);
  if (!hasDeclKw && !allCaps) return false;
  // 2026-10-05 修（Pawchive）：`const barW = 18`——const 声明且**表意名**（≥3 字符）即命名常量
  //   （规则本意「提取为命名常量」——已是 const 声明即达标）；单字母（const a = 777）仍报
  if (hasDeclKw && declKw.value === 'const' && constName.value.length >= 3) return true;
  // 常量名：全大写（PAGE_SIZES/API_ROW_LIMIT/TTL_MS）、常见前缀驼峰（dshgp_FETCH_TIMEOUT_MS、
  //   DEFAULT_WEIGHTS、MAX_SCAN_FILES、LIST_LIVE_BUDGET_MS——带语义词尾 timeout/limit/size/count/
 // ms 等也是命名常量），或含 version/date 等语义。修：此前只认全大写——
  //   项目自己的 `dshgp_*` 前缀常量被误报成魔数（建议提取为命名常量，自相矛盾）。
  const constNameStr = constName.value;
  const semanticTail = /(timeout|retry|max|min|limit|size|count|interval|delay|duration|threshold|buffer|chunk|version|date|year|month|day|hour|minute|second|total|ms|kb|mb|rounds|levels|weight|score|price|ratio|percent|budget|lookahead)/i;
  return /^[A-Z][A-Z0-9_]*$/.test(constNameStr)
    || /^[a-z]+_[A-Z][A-Z0-9_]*$/.test(constNameStr)   // 小写前缀_全大写尾（dshgp_FETCH_TIMEOUT_MS）
    || semanticTail.test(constNameStr)
    || /version|date|year|month|day|hour|minute|second|total|count|limit|size/i.test(constNameStr);
}

/**
 * 收集 Python 枚举成员赋值行。
 *
 * 为什么需要：Python 无 const/let/var，`class Status(IntEnum):` 体内（乃至普通类体内）
 * `PENDING = 1001` 过不了 isNamedConstantValue（它要求 const/let/var 前缀），
 * 枚举码被当魔数误报（KToolBox `_enum.py` 的 1001/1002/2001、配置里的版本号
 * 2023/2024 全中招）。枚举成员值是有意设计的标识符，不是散落魔数。
 *
 * 识别规则：
 *   · **任意类体**内（class X(...): 或 class X:）的 `^<缩进>NAME = <数字>`
 * ——NAME 全大写（Python 常量/枚举成员惯例）。二次修：不限于
 *     Enum/IntEnum 基类——KToolBox `_enum.py` 用**普通类**（`class Error:` 无括号）
 *     定义错误码枚举（NetWorkError = 1001），此前只认 Enum 基类导致漏豁免。
 *   · 缩进 > 类定义缩进（排除 def 方法签名/类外的顶层行）。
 *   · 收紧面：仅「全大写 NAME = 数字」豁免；类体内小写属性（port = 8080）不豁免
 *     （仍是散落魔数）。
 *
 * @param {string} text 文件全文
 * @returns {Set<number>} 命中的行号集合（1-based）
 */
function collectPythonEnumAssignLines(text) {
  const out = new Set();
  const lines = String(text).split('\n');
  let inEnum = false;
  let enumIndent = -1;
  // 任意类：class X(...): 或 class X:（基类可省略——Python 枚举常用普通类）
  const CLASS_RE = /^(\s*)class\s+[A-Za-z_]\w*(?:\s*\([^)]*\))?\s*:/;
  // 类成员赋值：全大写（PENDING）或驼峰（NetWorkError）开头 + = 数字——Python 枚举/
 // 常量惯例（二次修：KToolBox `_enum.py` 用驼峰成员 NetWorkError/JsonDecodeError）。
  // 收紧面：首字符大写（排除小写属性 port = 8080）；数字值（排除字符串成员）。
  const MEMBER_RE = /^(\s*)([A-Z][A-Za-z0-9_]*)\s*=\s*\d+(?:\s*#.*)?$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cls = CLASS_RE.exec(line);
    if (cls) {
      inEnum = true;
      enumIndent = cls[1].length;
      continue;
    }
    if (!inEnum) continue;
    // 缩进回到类定义级或更浅 → 枚举类结束
    const indent = (line.match(/^\s*/) || [''])[0].length;
    if (line.trim() && indent <= enumIndent) { inEnum = false; continue; }
    if (MEMBER_RE.test(line)) out.add(i + 1);
  }
  return out;
}
