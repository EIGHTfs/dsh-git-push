/**
 * dsh-git-push — I/O 风险分级（AST 层，2026-09-17）
 *
 * 职责：找出文件里的全部 fs 调用（同步 + 异步），判定每个调用的上下文
 *   （异步路径 / 循环内 / 请求处理路径 / 启动路径）与操作类别（读 / 写 / 删 / 改名），
 *   据此给出四级风险，供审计 findings 与 scripts/scan-file-io.mjs 共用。
 *
 * 分层约定（README「正则初筛 → AST 精筛」）：本文件属 `lib/ast/` 实现层，
 *   只把判定结果交出去；调用方（lib/checks/）只做「转 finding / 转报表」。
 *
 * 四级风险（写类操作加权一档；2026-09-20 循环内 I/O 改多维分级，不再一刀切 high）：
 *   high   —— 异步路径中的同步 I/O；或循环内「同步阻塞 + 边界不可控」落在请求路径；
 *             或请求路径上循环内逐个 await（响应时间线性增长）
 *   medium —— 请求处理路径上的 I/O；循环内同步 I/O（阻塞事件循环，边界不可控但非关键路径）
 *   low    —— 启动路径上的同步 I/O（模块顶层 / apply() 等一次性初始化）；
 *             循环内异步串行 await（只慢不阻塞）；固定小数组循环内的 I/O；
 *             循环内异步 I/O 已 Promise.all 并行
 *   safe   —— 异步 + 无循环 + 非关键路径
 *
 * 模块划分（原单文件按职责拆分，对外出口不变）：
 *   io-risk-const.js —— 常量与档位工具
 *   io-risk-fn.js    —— 函数边界识别与 token 配对
 *   io-risk-loop.js  —— 循环判定
 *   本文件           —— 判定与评分，并再导出上述模块的公共符号
 */
import { tokenize } from './tokenizer.js';
import {
  LOOP_KEYWORDS, LOOP_METHODS, RISK_BADGE, RISK_LABEL,
  SYNC_FS_FNS, ASYNC_FS_FNS, KIND_BY_FN, REQUEST_PATTERNS, LEVELS, raise,
} from './io-risk-const.js';
import { collectRanges } from './io-risk-loop.js';
import { enclosingLoop } from './io-risk-fn.js';
import { isSmallFixedLoop } from './io-risk-loop.js';


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
/** 模块顶层/初始化的判定常量（魔数具名化，说明取值理由）。 */

/**
 * 判断 token 位置是否是一个真实的 fs 调用。
 *   三个条件：① 标识符是已知 fs 函数名 ② 后一个 token 是 '('（调用形态）
 *   ③ 同步/异步归类。拆自 judgeIoTokend（原函数圈复杂度 12，超阈值 10）。
 * @returns {{token: object, isSync: boolean}|null}
 */
function classifyIoCall(tokens, idx) {
  const t = tokens[idx];
  if (t.type !== 'ident') return null;
  const isSync = SYNC_FS_FNS.has(t.value);
  const isAsync = !isSync && ASYNC_FS_FNS.has(t.value);
  if (!isSync && !isAsync) return null;
  // 必须是调用形态：名字后紧跟 '('（允许 fs.promises.readFile 的点号形态）
  const next = tokens[idx + 1];
  if (!next || next.type !== 'punct' || next.value !== '(') return null;
  return { token: t, isSync };
}

/**
 * 判定单条 I/O token 的上下文与风险等级。
 *   从 scanIoRiskAst 抽出（原函数圈复杂度 27 / 嵌套 4，超阈值），
 *   使主循环只负责遍历与筛形，判定逻辑可独立测试。
 *
 * @param {object} ctx { tokens, lines, idx, asyncFns, loops, within, enclosingFnText }
 * @returns {object|null} 命中项；非 I/O 调用返回 null
 */
function judgeIoTokend(ctx) {
  const { tokens, lines, idx, asyncFns, loops, within, enclosingFnText, promiseAllRanges } = ctx;
  const callKind = classifyIoCall(tokens, idx);
  if (!callKind) return null;
  const { token: t, isSync } = callKind;

  const line = t.line;
  const inAsync = within(asyncFns, line);
  const loopHit = enclosingLoop(loops, line);
  // 迭代器表达式内的 I/O 只执行一次（进入循环前），不算「循环内」：
  //   `for (const line of readFileSync(f).split('\n'))` —— readFileSync 在头部括号内。
  //   同行代码无法靠行号区分，故按 token 下标判定。
  const inLoopHead = Boolean(loopHit && loopHit[3] && idx > loopHit[3][0] && idx < loopHit[3][1]);
  const inLoop = Boolean(loopHit) && !inLoopHead;
  // 只遍历固定小字面量数组的循环：I/O 次数确定且极少，不按「逐次阻塞放大耗时」计
  const inSmallFixedLoop = Boolean(loopHit && loopHit[2]);
  // 2026-09-20：Promise.all(...) 表达式内的 I/O = 并行执行（不串行放大），
  //   循环内逐次 await 才是串行放大；并行形态降级为可接受
  const inParallelAll = Boolean(promiseAllRanges && promiseAllRanges.some(([s, e]) => idx > s && idx < e));
  const inRequest = detectRequestContext(lines, enclosingFnText(line));
  const inStartup = !inAsync && !inLoop && !inRequest;
  const type = isSync ? 'sync' : 'async';
  const kind = KIND_BY_FN[t.value] || 'read';

  const { risk, reason } = gradeRisk({ isSync, inAsync, inLoop, inSmallFixedLoop, inRequest, inParallelAll, kind });
  return { line, call: t.value, via: '', type, kind, inAsync, inLoop, inRequest, inStartup, risk, reason };
}

/** 请求路径判定：所在函数体内出现 HTTP 特征即算（文本回溯，回溯上限见常量）。 */
function detectRequestContext(lines, fnRange) {
  if (!fnRange) return false;
  const from = Math.max(0, fnRange[0] - 1);
  const body = lines.slice(from, fnRange[1]).join('\n');
  return REQUEST_PATTERNS.some((re) => re.test(body));
}

/**
 * 四级判定：上下文 + 操作类别。
 *   基础档由上下文决定，写/删/改名再按「数据不可逆」加权一档。
 *   2026-09-20 循环内 I/O 多维分级（不再一刀切 high）：
 *     风险不取决于「在不在循环里」，而取决于「循环次数可不可控 + I/O 同不同步 +
 *     在不在请求路径上」——三者同时满足才是真正高风险；只满足一个或两个降级为提醒。
 *     同步阻塞 + 边界不可控：medium（非关键路径）/ high（请求路径）
 *     异步串行 await：low（只慢不阻塞）/ high（请求路径，响应时间线性增长）
 *     异步并行（Promise.all）：low（可接受）
 * @returns {{risk: string, reason: string}}
 */
function gradeRisk({ isSync, inAsync, inLoop, inSmallFixedLoop, inRequest, inParallelAll, kind }) {
  let risk = 'safe';
  let reason = '异步 + 无循环 + 非关键路径';
  // 「会重复执行」= 循环内（逐次执行）或请求路径（每次请求执行一次）。
  //   只有这类上下文才存在「反复 + 不可逆」的叠加；异步路径的同步 I/O 本身已是最高档，
  //   且它的风险来自「阻塞事件循环」而非重复，不参与加权。
  const repeated = (inLoop && !inSmallFixedLoop) || inRequest;
  if (isSync && inAsync) { risk = 'high'; reason = '异步路径中的同步 I/O（阻塞事件循环）'; }
  else if (inLoop && inSmallFixedLoop) { risk = 'low'; reason = '固定小数组循环内的 I/O（次数确定且极少，开销可忽略）'; }
  else if (inLoop && isSync) {
    // 循环内同步 I/O（边界不可控，已排除 smallFixed）：阻塞事件循环；
    //   落在请求路径再升一档（不可控 + 同步 + 关键路径三条件齐）
    risk = inRequest ? 'high' : 'medium';
    reason = inRequest
      ? '请求路径上循环内同步 I/O（阻塞事件循环 + 次数不可控，逐次放大）'
      : '循环内同步 I/O（阻塞事件循环；边界不可控时逐次放大耗时）';
  }
  else if (inLoop && inParallelAll) { risk = 'low'; reason = '循环内异步 I/O 已 Promise.all 并行（不串行放大）'; }
  else if (inLoop && inRequest) { risk = 'high'; reason = '请求处理路径上循环内逐个 await I/O（响应时间线性增长）'; }
  else if (inLoop) { risk = 'low'; reason = '循环内异步 I/O（串行 await 只慢不阻塞事件循环）'; }
  else if (inRequest) { risk = 'medium'; reason = '请求处理路径上的 I/O'; }
  else if (isSync) { risk = 'low'; reason = '启动路径上的同步 I/O（一次性初始化）'; }

  // 写/删/改名加权一档（数据不可逆）——**仅当该次 I/O 会重复执行时**。
  //   加权要表达的是「反复执行 + 不可逆」的叠加风险：循环内逐次写盘、请求路径并发写。
  //   启动路径的一次性落盘（含 `.tmp` + rename 的标准原子写）执行一次即结束，
  //   不存在重复放大；对它加权会把这套**正确做法**报成「中风险」，
  //   实测 25 条 atomic-json/account-status/scan-repos 等原子写全被误升档。
  if (repeated && (kind === 'write' || kind === 'delete' || kind === 'rename')) {
    const raised = raise(risk, 1);
    if (raised !== risk) { reason += `；${kind} 类操作加权`; risk = raised; }
  }
  return { risk, reason };
}

/**
 * Promise.all(...) 表达式的 token 区间。
 * 循环内 I/O 若落在 Promise.all 参数里 = 并行执行（不串行放大）→ 降级可接受。
 * 判定依据：`Promise` `.` `all` `(` 四连 token，配对其括号区间 [开, 闭]。
 * @param {Array} tokens tokenize 产物
 * @returns {Array<[number, number]>} token 下标区间（含开闭括号）
 */
function findPromiseAllRanges(tokens) {
  const ranges = [];
  for (let i = 0; i < tokens.length - 3; i++) {
    const a = tokens[i], b = tokens[i + 1], c = tokens[i + 2], d = tokens[i + 3];
    if (a.type === 'ident' && a.value === 'Promise'
      && b.type === 'punct' && b.value === '.'
      && c.type === 'ident' && c.value === 'all'
      && d.type === 'punct' && d.value === '(') {
      let depth = 0;
      for (let j = i + 3; j < tokens.length; j++) {
        if (tokens[j].type === 'punct' && tokens[j].value === '(') depth++;
        else if (tokens[j].type === 'punct' && tokens[j].value === ')') {
          depth--;
          if (depth === 0) { ranges.push([i + 3, j]); break; }
        }
      }
    }
  }
  return ranges;
}

/**
 * 扫描源码里的文件 I/O，按上下文与操作类别给出四级风险。
 * @param {string} text 源码全文
 * @returns {Array<object>} 命中项数组（见文件头字段说明）
 */
export function scanIoRiskAst(text = '') {
  const src = String(text);
  const tokens = tokenize(src);
  const { asyncFns, allFns, loops } = collectRanges(tokens);
  const promiseAllRanges = findPromiseAllRanges(tokens);
  const lines = src.split('\n');
  const out = [];

  const within = (ranges, line) => ranges.some(([s, e]) => line >= s && line <= e);
  /**
   * 取最近函数体范围（含区间嵌套时取最内层，用于请求路径特征匹配）。
   *   必须用 allFns（含同步函数/箭头函数/方法简写）—— 请求路径判定看的是
   *   「这段函数体里有没有 HTTP 特征」，与函数是否 async 无关。
   *   早先误用 asyncFns，导致同步 handler（`function h(req,res){ res.end() }`）
   *   识别不到请求上下文，其中的 I/O 被降格成「启动路径一次性」→ 低估风险。
   */
  const enclosingFnText = (line) => {
    let best = null;
    for (const [s, e] of allFns) if (line >= s && line <= e) best = [s, e];
    return best;
  };

  const ctx = { tokens, lines, asyncFns, loops, within, enclosingFnText, promiseAllRanges };
  for (let i = 0; i < tokens.length; i++) {
    const hit = judgeIoTokend({ ...ctx, idx: i });
    if (!hit) continue;
    out.push(hit);
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
  for (const hit of list) {
    byRisk[hit.risk] = (byRisk[hit.risk] || 0) + 1;
    byKind[hit.kind] = (byKind[hit.kind] || 0) + 1;
    if (hit.file) fileMap.set(hit.file, (fileMap.get(hit.file) || 0) + 1);
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
  const sorted = [...list].sort(compareFixPriority);
  return sorted.map((hit, idx) => ({ ...hit, rank: idx + 1 }));
}

/**
 * 改造优先级排序：风险 > 写类 > 同步 > 文件 > 行号。
 *   从 rankIoFixList 的比较器抽出（原为内联多级比较，变量名过短且难读）。
 * @returns {number} 负数 = a 优先
 */
function compareFixPriority(a, b) {
  const byRisk = LEVELS.indexOf(b.risk) - LEVELS.indexOf(a.risk);
  if (byRisk) return byRisk;
  const byKind = isWriteLike(b.kind) - isWriteLike(a.kind);
  if (byKind) return byKind;
  const byType = isSync(b.type) - isSync(a.type);
  if (byType) return byType;
  const byFile = String(a.file || '').localeCompare(String(b.file || ''));
  if (byFile) return byFile;
  return (a.line || 0) - (b.line || 0);
}

/** 写/删/改名优先于读（数据不可逆，改造收益更高）。 */
function isWriteLike(kind) {
  return kind === 'read' ? 0 : 1;
}

/** 同步调用优先于异步（阻塞事件循环，收益直接）。 */
function isSync(type) {
  return type === 'sync' ? 1 : 0;
}

// ── 对外出口：保持与原单文件一致，调用方无需改动 ──
export { RISK_BADGE, RISK_LABEL };
