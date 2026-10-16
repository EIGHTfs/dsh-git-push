/**
 * AST 层 · FS 热点抽取（**单一实现**，供两处消费）
 *
 *   ① 审计规则 `performance/multi-file-scanners`（仓库级：扫描实现 > 阈值 ⇒ notice）
 *   ② 独立 CLI `scripts/scan-fs-hotspots.mjs`（①stat 热点排序 + ④遍历入口 + ②③⑤ 明细）
 *
 * 【为什么要单独一个模块】同一份判据若在「审计规则」和「CLI」各写一套 ⇒ 必然漂移 ✗
 *   （本项目反复踩的坑）。这里只写一份，两边只做「取数 + 呈现」。
 *
 * 【口径来源】移植自 bench-template 的 scripts/scan-fs-hotspots.mjs（2026-10-16 交接），
 *   但**函数边界用插件自己的 collectFuncRanges**（真括号配对）⇒ 比原脚本的正则更准 ✓
 *
 * ⚠️ 计数纪律：每个调用**只计一次**（先整文件扫一遍，再按字符位置归属到所属函数）。
 *   反面教材（本文件第一版）：先整文件收一遍、再每个函数各收一遍 ⇒ 同一调用被计两次 ✗
 *   ⇒ CLI 打出来 stat 48 而基线是 25 ✗（实测发现的真 bug）。
 *
 * 判据（六类，与交接文档一致）：
 *   ① stat 调用点       —— 每个 stat 调用的 文件:行 + 所属函数 + 原始表达式（每条只出现一次）
 *   ② 重复 stat         —— 同一函数内**同一表达式** stat ≥2 次（可合并成一次）
 *   ③ 重复 readdir      —— 同一函数内同一表达式 readdir ≥2 次
 *   ④ 遍历入口          —— 函数体内有 readdir，且「自递归」或调用已知 walker 名
 *   ⑤ 逐文件扫描实现     —— 函数体内同时出现 readdir 与 stat ⇒ 一个「扫描器」实现
 *   ⑥ 汇总              —— 给调用方直接用的 totals
 */
import { collectFuncRanges } from './perf.js';

/** 统计类调用（① 热点排序 / ⑤ 扫描器判定）。 */
const STAT_RE = /(?:^|[^\w$.])(?:fs\s*\.\s*)?(statSync|stat|lstatSync|lstat)\s*\(([^()]*)\)/g;
/** 目录列举类调用（③⑤④）。 */
const READDIR_RE = /(?:^|[^\w$.])(?:fs\s*\.\s*)?(readdirSync|readdir)\s*\(([^()]*)\)/g;
/** 已知遍历入口名（交接文档 §四.3 明说：这是名字白名单，新命名需补进来）。 */
export const FS_WALKERS = ['recursiveScanAll', 'walkWithIndex', 'scanDirShallow', 'recursiveScan', 'walkDir'];

/** 同函数内「同一表达式」的键：`statSync(dir)` —— 实参去空白。 */
const callKey = (name, args) => `${name}(${String(args).replace(/\s+/g, '')})`;

/** 字符偏移 → 行号（1-based）。 */
function lineAt(text, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * 扫描单个文件的 FS 热点（每个调用只计一次）。
 * @param {string} text 文件全文
 * @param {string} [relPath] 相对路径（回填进结果，便于上层聚合与展示）
 * @returns {{file:string, stats:Array, readdirs:Array, dupStats:Array, dupReaddirs:Array, walkers:Array, scanners:Array}}
 */
export function scanFsHotspotsText(text = '', relPath = '') {
  const s = String(text || '');
  const out = {
    file: relPath, stats: [], readdirs: [], dupStats: [], dupReaddirs: [], walkers: [], scanners: [],
  };
  const fns = collectFuncRanges(s);

  /** 整文件扫一遍（**只此一次**）：返回 {name,args,line,at,expr}。 */
  const collect = (re) => {
    const res = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const at = m.index + (m[0].length - m[0].trimStart().length);
      res.push({ name: m[1], args: m[2] || '', line: lineAt(s, at), at, expr: callKey(m[1], m[2] || '') });
    }
    return res;
  };
  /** 归属函数名（不在任何函数内 ⇒ '' = 顶层）。 */
  const fnNameAt = (at) => {
    const hit = fns.find((f) => at >= f.a && at <= f.b);
    return hit ? hit.name : '';
  };

  for (const c of collect(STAT_RE)) out.stats.push({ ...c, fn: fnNameAt(c.at) });
  for (const c of collect(READDIR_RE)) out.readdirs.push({ ...c, fn: fnNameAt(c.at) });

  /** 同一组内「同一表达式出现 ≥2 次（且不同行）」⇒ 可合并。 */
  const dups = (calls) => {
    const seen = new Map();
    const res = [];
    for (const c of calls) {
      if (seen.has(c.expr)) {
        if (seen.get(c.expr) !== c.line) res.push(c);
      } else seen.set(c.expr, c.line);
    }
    return res;
  };

  // 按「所属函数」分组（顶层同名归一组 ''），一次算出 ②③④⑤
  const groups = new Map();
  const groupOf = (fn, at) => {
    const k = fn || '';
    if (!groups.has(k)) groups.set(k, { fn: k, stats: [], readdirs: [], start: at });
    return groups.get(k);
  };
  for (const c of out.stats) groupOf(c.fn, c.at).stats.push(c);
  for (const c of out.readdirs) groupOf(c.fn, c.at).readdirs.push(c);

  for (const g of groups.values()) {
    out.dupStats.push(...dups(g.stats).map((c) => ({ ...c, fn: g.fn })));
    out.dupReaddirs.push(...dups(g.readdirs).map((c) => ({ ...c, fn: g.fn })));
    if (g.fn && g.readdirs.length && g.stats.length) {
      out.scanners.push({ fn: g.fn, line: g.readdirs[0].line, readdir: g.readdirs[0].line, stat: g.stats[0].line });
    }
    // ④ 遍历入口：有 readdir，且（自递归 或 调用了已知 walker）
    if (g.fn && g.readdirs.length) {
      const r = fns.find((f) => f.name === g.fn);
      if (r) {
        const body = s.slice(r.a, r.b + 1);
        const selfRe = new RegExp(`(?:^|[^\\w$.])${String(g.fn).replace(/\$/g, '\\$')}\\s*\\(`);
        const walker = FS_WALKERS.find((w) => new RegExp(`(?:^|[^\\w$.])${w}\\s*\\(`).test(body));
        if (selfRe.test(body) || walker) {
          out.walkers.push({ fn: g.fn, line: lineAt(s, r.a), calls: walker || '(self)' });
        }
      }
    }
  }
  return out;
}

/**
 * 仓库级聚合：把每个文件的结果合并成「仓库视角」的汇总。
 * @param {Array<{path:string, text:string}>} fileTexts
 * @returns {{totals:object, files:Array, scanners:Array, dupStats:Array, dupReaddirs:Array, walkers:Array, hot:Array}}
 */
export function scanFsHotspots(fileTexts = []) {
  const files = [];
  const scanners = [];
  const dupStats = [];
  const dupReaddirs = [];
  const walkers = [];
  const totals = { files: 0, stats: 0, readdirs: 0, dupStats: 0, dupReaddirs: 0, walkerCalls: 0, scanners: 0 };
  for (const { path, text } of fileTexts) {
    const r = scanFsHotspotsText(text, path);
    files.push(r);
    totals.files += 1;
    totals.stats += r.stats.length;
    totals.readdirs += r.readdirs.length;
    totals.walkerCalls += r.walkers.length;
    for (const x of r.scanners) scanners.push({ file: path, ...x });
    for (const x of r.dupStats) dupStats.push({ file: path, ...x });
    for (const x of r.dupReaddirs) dupReaddirs.push({ file: path, ...x });
    for (const x of r.walkers) walkers.push({ file: path, ...x });
  }
  totals.scanners = scanners.length;
  totals.dupStats = dupStats.length;
  totals.dupReaddirs = dupReaddirs.length;
  // ① stat 热点排序：按 stat 调用点数降序（CLI 用；审计规则不用）
  const hot = files
    .map((f) => ({ file: f.file, stats: f.stats.length, readdirs: f.readdirs.length }))
    .filter((x) => x.stats > 0 || x.readdirs > 0)
    .sort((a, b) => (b.stats - a.stats) || (b.readdirs - a.readdirs));
  return { totals, files, scanners, dupStats, dupReaddirs, walkers, hot };
}
