/**
 * dsh-git-push — I/O 风险分级（AST 层，2026-09-17）
 *
 * 职责：找出文件里的**全部** fs 调用（同步 + 异步），判定每个调用的上下文
 *   （异步路径 / 循环内 / 请求处理路径 / 启动路径）与操作类别（读 / 写 / 删 / 改名），
 *   据此给出四级风险，供审计 findings 与 scripts/scan-file-io.mjs 共用。
 *
 * 分层约定（README「正则初筛 → AST 精筛」）：本文件属 `lib/ast/` 实现层，
 *   只把**判定结果**交出去；调用方（lib/checks/）只做「转 finding / 转报表」。
 *
 * 四级风险（写类操作加权一档）：
 *   🔴 high   —— 异步路径中的同步 I/O；或循环内的 I/O（含异步，逐次 await 放大阻塞）
 *   🟠 medium —— 请求处理路径上的 I/O；或写/删类操作落在并发路径
 *   🟡 low    —— 启动路径上的同步 I/O（模块顶层 / apply() 等一次性初始化）
 *   🟢 safe   —— 异步 + 无循环 + 非关键路径
 *
 * 写/删优先：`write`/`delete`/`rename` 在同一上下文下**提升一档**
 *   （safe → low，low → medium，medium → high），因为写错/删错不可逆。
 */
import { tokenize } from './tokenizer.js';
import { matchBrace } from './brace.js';

/** 同步 fs 调用名（带 Sync 后缀）→ 统一视为阻塞调用。 */
const SYNC_FS_FNS = new Set([
  'readFileSync', 'writeFileSync', 'appendFileSync', 'existsSync', 'statSync', 'lstatSync',
  'readdirSync', 'mkdirSync', 'rmdirSync', 'rmSync', 'unlinkSync', 'renameSync',
  'copyFileSync', 'chmodSync', 'chownSync', 'openSync', 'closeSync', 'readSync',
  'writeSync', 'truncateSync', 'realpathSync', 'symlinkSync', 'linkSync', 'accessSync',
]);

/** 异步 fs 调用名（无 Sync 后缀的常见形态）。 */
const ASYNC_FS_FNS = new Set([
  'readFile', 'writeFile', 'appendFile', 'stat', 'lstat', 'readdir', 'mkdir', 'rmdir',
  'rm', 'unlink', 'rename', 'copyFile', 'chmod', 'chown', 'open', 'close', 'read',
  'write', 'truncate', 'realpath', 'symlink', 'link', 'access', 'createReadStream',
  'createWriteStream', 'watch', 'opendir',
]);

/** 操作类别：写 / 删 / 改名 涉及数据安全，风险加权。 */
const KIND_BY_FN = {
  writeFileSync: 'write', writeFile: 'write', appendFileSync: 'write', appendFile: 'write',
  createWriteStream: 'write', writeSync: 'write', write: 'write', truncateSync: 'write',
  truncate: 'write',
  unlinkSync: 'delete', unlink: 'delete', rmSync: 'delete', rm: 'delete',
  rmdirSync: 'delete', rmdir: 'delete',
  renameSync: 'rename', rename: 'rename', copyFileSync: 'rename', copyFile: 'rename',
};

/** 循环体识别：for/while/do 关键字与数组迭代方法。 */
const LOOP_KEYWORDS = new Set(['for', 'while', 'do']);
const LOOP_METHODS = new Set(['forEach', 'map', 'filter', 'reduce', 'flatMap', 'some', 'every']);

/** 请求处理路径特征（在函数体内出现任一即认定）。 */
const REQUEST_PATTERNS = [
  /\b(?:req|request)\.(?:headers|method|url|body|on)\b/,
  /\bres\.(?:writeHead|write|end|setHeader|statusCode)\b/,
  /\b(?:handle|route|onRequest)[A-Za-z_$]*\s*\(/,
  /\bcreateServer\s*\(\s*(?:async\s*)?\(?\s*(?:req|request)\s*,/,
  /\(\s*(?:req|request)\s*,\s*(?:res|response)\s*\)/,
];

/** 风险档位（数值越大越高）。 */
const LEVELS = ['safe', 'low', 'medium', 'high'];

/** 徽标。 */
export const RISK_BADGE = { high: '🔴', medium: '🟠', low: '🟡', safe: '🟢' };

/** 风险中文名。 */
export const RISK_LABEL = { high: '高', medium: '中', low: '低', safe: '安全' };

/** 档位提升 n 级（用于写/删加权）。 */
function raise(level, n = 1) {
  const i = LEVELS.indexOf(level);
  return LEVELS[Math.min(LEVELS.length - 1, i + n)];
}

/** 收集所有函数体范围（含 async 标记）与循环体范围，用于上下文归属判断。 */
function collectRanges(tokens) {
  const asyncFns = [];
  const loops = [];
  /** 从 openIdx 处配对花括号，登记函数体；isAsync 决定是否进 asyncFns。 */
  const pushFn = (openIdx, isAsync) => {
    const range = matchBrace(tokens, openIdx);
    if (!range) return -1;
    const span = [tokens[openIdx].line, tokens[range[1]].line];
    if (isAsync) asyncFns.push(span);
    return range[1];
  };
  /** 从 from 起找函数体 '{'（限 40 token，遇 ';' 放弃）。 */
  const findBody = (from) => {
    for (let j = from; j < Math.min(tokens.length, from + 40); j++) {
      if (tokens[j].type === 'punct' && tokens[j].value === '{') return j;
      if (tokens[j].type === 'punct' && tokens[j].value === ';') return -1;
    }
    return -1;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident') continue;
    if (t.value === 'async') {
      // async function f() {} / async () => {} / async x => {}
      let open = -1;
      const nx = tokens[i + 1];
      if (nx && nx.type === 'ident' && nx.value === 'function') open = findBody(i + 2);
      else {
        // async (...) => {  或  async x => {
        for (let j = i + 1; j < Math.min(tokens.length, i + 40); j++) {
          if (tokens[j].type === 'punct' && tokens[j].value === '=>') { open = findBody(j + 1); break; }
          if (tokens[j].type === 'punct' && tokens[j].value === ';') break;
        }
      }
      // 不跳过函数体：函数内还嵌着循环/内层函数，跳过会漏收内层范围
      if (open !== -1) pushFn(open, true);
      continue;
    }
    if (t.value === 'function') {
      const open = findBody(i + 1);
      if (open !== -1) pushFn(open, false);
      continue;
    }
    // 循环：for/while/do 关键字，或 .forEach/.map( 等方法调用
    const isLoop = LOOP_KEYWORDS.has(t.value) || LOOP_METHODS.has(t.value);
    if (!isLoop) continue;
    let open = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 30); j++) {
      const tj = tokens[j];
      if (tj.type === 'punct' && tj.value === '{') { open = j; break; }
      if (tj.type === 'punct' && tj.value === ';') break;
      // 单语句循环体（for (...) x++;）：括号配对完成却没 '{' → 认到该语句结束
      if (tj.type === 'punct' && tj.value === ')' && tokens[j + 1]
        && !(tokens[j + 1].type === 'punct' && tokens[j + 1].value === '{')) {
        loops.push([tokens[i].line, tj.line]);
        open = -2;
        break;
      }
    }
    if (open === -1 || open === -2) continue;
    const range = matchBrace(tokens, open);
    if (range) loops.push([tokens[i].line, tokens[range[1]].line]);
  }
  return { asyncFns, loops };
}

/**
 * 扫描文件内全部 fs 调用并分级。
 *
 * @param {string} text 文件全文
 * @returns {Array<{
 *   line:number, call:string, via:string, type:'sync'|'async', kind:'read'|'write'|'delete'|'rename',
 *   inAsync:boolean, inLoop:boolean, inRequest:boolean, inStartup:boolean,
 *   risk:'high'|'medium'|'low'|'safe', reason:string
 * }>}
 */
export function scanIoRiskAst(text = '') {
  const src = String(text);
  const tokens = tokenize(src);
  const { asyncFns, loops } = collectRanges(tokens);
  const lines = src.split('\n');
  const out = [];

  /** 判定某行是否落在任一区间内。 */
  const within = (ranges, line) => ranges.some(([s, e]) => line >= s && line <= e);
  /** 取最近函数体文本（用于请求路径特征匹配）。 */
  const enclosingFnText = (line) => {
    let best = null;
    for (const [s, e] of asyncFns.concat([])) if (line >= s && line <= e) best = [s, e];
    return best;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident') continue;
    const isSync = SYNC_FS_FNS.has(t.value);
    const isAsync = !isSync && ASYNC_FS_FNS.has(t.value);
    if (!isSync && !isAsync) continue;
    // 必须是调用形态：名字后紧跟 '('（允许 fs.promises.readFile 的点号形态）
    const next = tokens[i + 1];
    if (!next || next.type !== 'punct' || next.value !== '(') continue;
    // 排除把同步函数名当值传递的写法（无括号已被上面挡掉）；排除 .Sync 自定义方法误报：
    //   仅当同文件出现过 fs / node:fs 引用，或调用名带 Sync 后缀时才认（Sync 后缀已足够特异）。
    const line = t.line;

    const inAsync = within(asyncFns, line);
    const inLoop = within(loops, line);
    // 请求路径：在含 HTTP 特征的函数体内
    const fnRange = enclosingFnText(line);
    let inRequest = false;
    if (fnRange) {
      const body = lines.slice(fnRange[0] - 1, fnRange[1]).join('\n');
      inRequest = REQUEST_PATTERNS.some((re) => re.test(body));
    }
    const inStartup = !inAsync && !inLoop && !inRequest;

    const type = isSync ? 'sync' : 'async';
    const kind = KIND_BY_FN[t.value] || 'read';

    // ── 四级判定 ──
    let risk = 'safe';
    let reason = '异步 + 无循环 + 非关键路径';
    if (isSync && inAsync) { risk = 'high'; reason = '异步路径中的同步 I/O（阻塞事件循环）'; }
    else if (inLoop) { risk = 'high'; reason = '循环内的 I/O（逐次阻塞，放大耗时）'; }
    else if (inRequest) { risk = 'medium'; reason = '请求处理路径上的 I/O'; }
    else if (isSync) { risk = 'low'; reason = '启动路径上的同步 I/O（一次性初始化）'; }

    // 写/删/改名加权一档（数据不可逆）
    if (kind === 'write' || kind === 'delete' || kind === 'rename') {
      const raised = raise(risk, 1);
      if (raised !== risk) { reason += `；${kind} 类操作加权`; risk = raised; }
    }

    out.push({
      line, call: t.value, via: '', type, kind,
      inAsync, inLoop, inRequest, inStartup, risk, reason,
    });
    i += 1;
  }
  return out;
}

/**
 * 统计 I/O 分布（供报表与审计摘要用）。
 * @param {Array} hits scanIoRiskAst 的结果
 * @returns {{total:number, sync:number, async:number, syncRatio:number, byRisk:object, byKind:object, byFile:Array}}
 */
export function summarizeIoRisk(hits = []) {
  const list = Array.isArray(hits) ? hits : [];
  const sync = list.filter((h) => h.type === 'sync').length;
  const byRisk = { high: 0, medium: 0, low: 0, safe: 0 };
  const byKind = { read: 0, write: 0, delete: 0, rename: 0 };
  const fileMap = new Map();
  for (const h of list) {
    byRisk[h.risk] = (byRisk[h.risk] || 0) + 1;
    byKind[h.kind] = (byKind[h.kind] || 0) + 1;
    if (h.file) fileMap.set(h.file, (fileMap.get(h.file) || 0) + 1);
  }
  const byFile = [...fileMap.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
  return {
    total: list.length,
    sync,
    async: list.length - sync,
    syncRatio: list.length ? sync / list.length : 0,
    byRisk, byKind, byFile,
  };
}

/**
 * 生成改造优先级清单：按风险级别排序（同级内写/删优先、同步优先）。
 * @param {Array} hits 每条需带 file 字段
 * @returns {Array} 排序后的清单（含 rank 序号）
 */
export function rankIoFixList(hits = []) {
  const list = Array.isArray(hits) ? hits : [];
  const rankOf = (h) => LEVELS.indexOf(h.risk);
  const sorted = [...list].sort((a, b) => {
    const r = rankOf(b) - rankOf(a);           // 风险高在前
    if (r) return r;
    const w = (b.kind === 'read' ? 0 : 1) - (a.kind === 'read' ? 0 : 1); // 写/删优先
    if (w) return w;
    const s = (b.type === 'sync' ? 1 : 0) - (a.type === 'sync' ? 1 : 0);  // 同步优先
    if (s) return s;
    const f = String(a.file || '').localeCompare(String(b.file || ''));
    if (f) return f;
    return (a.line || 0) - (b.line || 0);
  });
  return sorted.map((h, i) => ({ ...h, rank: i + 1 }));
}
