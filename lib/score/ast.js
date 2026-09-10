// dsh-skip-func-length: 检查器主体为纯解析函数（tokenize/checkSyncFs），长而线性，拆分反损可读性
/**
 * dsh-git-push 评分总入口：AST(token) 级质量检查器
 *
 * 修旧项目逐行正则的假阴性（0.1.5）：
 *   1) sync-fs named import：旧项目只认 fs.*Sync 前缀，import { readFileSync } 后直调漏检
 *   2) empty-catch 多行：旧项目只看 catch 行+下一行，多行空块漏检
 *   3) func-lines 超长坏样本：旧项目行数启发式对单行海量语句漏检（v2 checks.js 已补）
 *
 * 实现：轻量 tokenizer（字符串/模板串/注释感知）→ 括号平衡区间 → 判定。
 * 零第三方依赖（Node 无内置 JS AST，token 级足够覆盖上述三类）。
 */
const SYNC_FS_FNS = new Set([
  'readFileSync', 'writeFileSync', 'readdirSync', 'existsSync', 'statSync', 'mkdirSync',
  'rmSync', 'unlinkSync', 'readlinkSync', 'lstatSync', 'renameSync', 'copyFileSync', 'appendFileSync',
]);

/**
 * 轻量 tokenizer：把文本切成 token 流，字符串/模板串/注释原样保留但标记类型。
 * @param {string} text 文件全文
 * @returns {Array<{type:string, value:string, line:number}>}
 * type: ident / punct / str / tmpl / comment / num / ws / other
 */
export function tokenize(text = '') {
  const tokens = [];
  const lines = String(text).split('\n');
  let line = 1;
  for (const raw of lines) {
    const src = raw;
    let i = 0;
    const n = src.length;
    const push = (type, value) => tokens.push({ type, value, line });
    while (i < n) {
      const ch = src[i];
      const next = src[i + 1];
      // 空白
      if (/\s/.test(ch)) { i++; continue; }
      // 行注释
      if (ch === '/' && next === '/') { push('comment', src.slice(i)); break; }
      // 块注释
      if (ch === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2);
        const seg = end === -1 ? src.slice(i) : src.slice(i, end + 2);
        push('comment', seg);
        i += seg.length;
        continue;
      }
      // 字符串（' "）
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        let str = ch;
        while (j < n) {
          if (src[j] === '\\') { str += src[j] + (src[j + 1] || ''); j += 2; continue; }
          str += src[j];
          if (src[j] === ch) { j++; break; }
          j++;
        }
        push('str', str);
        i = j;
        continue;
      }
      // 模板字符串（`）——嵌套 ${} 简化处理：遇未闭合 ` 归并到行尾
      if (ch === '`') {
        let j = i + 1;
        let str = ch;
        while (j < n && src[j] !== '`') {
          if (src[j] === '\\') { str += src[j] + (src[j + 1] || ''); j += 2; continue; }
          str += src[j];
          j++;
        }
        if (j < n) { str += '`'; j++; }
        push('tmpl', str);
        i = j;
        continue;
      }
      // 数字
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next || ''))) {
        let j = i;
        while (j < n && /[0-9._a-zA-Z]/.test(src[j])) j++;
        push('num', src.slice(i, j));
        i = j;
        continue;
      }
      // 标识符（含 $ _ 中文）
      if (/[A-Za-z_$\u4e00-\u9fa5]/.test(ch)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$\u4e00-\u9fa5]/.test(src[j])) j++;
        push('ident', src.slice(i, j));
        i = j;
        continue;
      }
      // 标点 / 其他
      push('punct', ch);
      i++;
    }
    line++;
  }
  return tokens;
}

/** 括号平衡扫描：从 startIdx 的 '{' 找匹配 '}'，返回 [openIdx, closeIdx] 或 null。 */
function matchBrace(tokens, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'punct') continue;
    if (t.value === '{') depth++;
    else if (t.value === '}') {
      depth--;
      if (depth === 0) return [openIdx, i];
    }
  }
  return null;
}

/**
 * 检查 async 路径中的 fs 同步调用（AST 级，修 named import 假阴性）。
 * @param {string} text 文件全文
 * @returns {Array<{line:number, call:string, via:string}>} via: 'named-import' | 'fs-prefix'
 */
export function checkSyncFs(text = '') {
  const tokens = tokenize(text);
  // 1) 收集 named import 的 fs 同步函数：import { readFileSync, X } from 'node:fs'
  const namedSync = new Set();
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].type === 'ident' && tokens[i].value === 'import'
      && tokens[i + 1].type === 'punct' && tokens[i + 1].value === '{') {
      let j = i + 2;
      const names = [];
      while (j < tokens.length && !(tokens[j].type === 'punct' && tokens[j].value === '}')) {
        if (tokens[j].type === 'ident') names.push(tokens[j].value);
        j++;
      }
      // 找 from 'node:fs' / 'fs'
      let k = j + 1;
      let from = '';
      while (k < tokens.length && k < j + 8) {
        if (tokens[k].type === 'ident' && tokens[k].value === 'from') {
          const strTok = tokens[k + 1];
          if (strTok && strTok.type === 'str') {
            from = strTok.value.replace(/['"]/g, '');
            if (/^(node:)?fs$/.test(from)) {
              for (const nm of names) if (SYNC_FS_FNS.has(nm)) namedSync.add(nm);
            }
          }
          break;
        }
        k++;
      }
      i = j;
    }
  }
  // 2) 定位所有 async 函数边界（async function / async X( / async (）
  const asyncRanges = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ident' && t.value === 'async') {
      // 向后找函数体 '{'（跳过函数名/参数，限 20 token）
      for (let j = i + 1; j < Math.min(tokens.length, i + 20); j++) {
        const tj = tokens[j];
        if (tj.type === 'punct' && tj.value === '{') {
          const range = matchBrace(tokens, j);
          if (range) asyncRanges.push([tokens[j].line, tokens[range[1]].line, j, range[1]]);
          break;
        }
        if (tj.type === 'punct' && (tj.value === ';' || tj.value === '}')) break;
      }
    }
  }
  // 3) 找同步调用：named 直调 或 fs.XSync( 前缀
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident') continue;
    let call = '';
    let via = '';
    if (namedSync.has(t.value)) {
      const nx = tokens[i + 1];
      if (nx && nx.type === 'punct' && nx.value === '(') { call = t.value; via = 'named-import'; }
    } else if (t.value === 'fs') {
      const nx = tokens[i + 1];
      if (nx && nx.type === 'punct' && nx.value === '.') {
        const nn = tokens[i + 2];
        if (nn && nn.type === 'ident' && SYNC_FS_FNS.has(nn.value)) {
          const after = tokens[i + 3];
          if (after && after.type === 'punct' && after.value === '(') { call = nn.value; via = 'fs-prefix'; }
        }
      }
    }
    if (!call) continue;
    // 判定是否在 async 函数区间内（token 索引区间）
    const inAsync = asyncRanges.some(([, , oi, ci]) => i > oi && i < ci);
    if (inAsync) out.push({ line: t.line, call, via });
  }
  return out;
}

/**
 * 检查静默吞错 catch（AST 级，括号平衡 → 块内去注释/空白后为空即报）。
 * @param {string} text 文件全文
 * @returns {Array<{line:number}>}
 */
export function checkEmptyCatchAst(text = '') {
  const tokens = tokenize(text);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || t.value !== 'catch') continue;
    // 找 catch 后的 '{'（跳过 (param) 与空白，限 10 token）
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 10); j++) {
      const tj = tokens[j];
      if (tj.type === 'punct' && tj.value === '{') { openIdx = j; break; }
      if (tj.type === 'punct' && tj.value === '}') break; // catch (e) 无块 → 不是本类
    }
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    const [, closeIdx] = range;
    // 块内判定：有实质语句 → 正常；仅有说明性注释 → 视为「已说明的静默」（不算问题）；
    // 真正空块（无语句也无注释）→ 报问题（静默吞错且无任何交代）。
    let hasBody = false;
    let hasNote = false;
    for (let k = openIdx + 1; k < closeIdx; k++) {
      const tk = tokens[k];
      if (tk.type === 'ws') continue;
      if (tk.type === 'comment') {
        // 注释需含说明语（跳过/忽略/已断开/不抛/按空/raw 等）才算交代清楚
        if (/跳过|忽略|已断开|不抛|按空|不阻断|无需|降级|兜底|视为|不回滚|非\s*JSON|raw|空仓|best-effort/i.test(tk.value || '')) hasNote = true;
        continue;
      }
      hasBody = true;
      break;
    }
    if (!hasBody && !hasNote) out.push({ line: t.line });
  }
  return out;
}

/**
 * 检查单函数超长（AST 级：括号平衡精确统计函数体行数）。
 * @param {string} text 文件全文
 * @param {{warn?: number, block?: number}} [opts]
 * @returns {Array<{line:number, len:number, level:'warning'|'blocker'}>}
 */
export function checkFuncLinesAst(text = '', { warn = 50, block = 100 } = {}) {
  const tokens = tokenize(text);
  const out = [];
  const fnStart = new Set(['function']);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || !fnStart.has(t.value)) continue;
    // function 关键字后找 '{'（限 20 token：name( params ) {）
    let openIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 20); j++) {
      const tj = tokens[j];
      if (tj.type === 'punct' && tj.value === '{') { openIdx = j; break; }
      if (tj.type === 'punct' && tj.value === ';') break;
    }
    if (openIdx === -1) continue;
    const range = matchBrace(tokens, openIdx);
    if (!range) continue;
    const startLine = tokens[openIdx].line;
    const endLine = tokens[range[1]].line;
    const len = endLine - startLine + 1;
    if (len > warn) {
      out.push({ line: startLine, len, level: len > block ? 'blocker' : 'warning' });
    }
    i = range[1];
  }
  return out;
}
