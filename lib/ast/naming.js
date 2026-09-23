/**
 * AST 实现层 · 命名与读取检查
 *
 * 职责：标识符长度、函数名是否过短（含 i18n 缩写豁免）、受控小文件读取判定。
 */

import { tokenize } from './tokenizer.js';

/**
 * 检查函数/变量命名长度不足（min-length kind，AST 级）。
 * 覆盖：function 声明名的长度、参数名单字母、变量声明名单字母。
 * @param {string} text 文件全文
 * @param {object} [opts] { min=2, allow=['i','j','k','x','y','z','e','_','$','a','b','n','p','s','v','f','t','r','id','ok','db','fs','os','el','cb','err','req','res','ctx','args' } }
 * @returns {Array<{line:number, name:string, type:string}>}
 */
export function checkNameLengthAst(text = '', { min = 2, allow = [] } = {}) {
  const tokens = tokenize(text);
  const out = [];
  const allowSet = new Set(['i', 'j', 'k', 'x', 'y', 'z', 'e', '_', '$', 'a', 'b', 'n', 'p', 's', 'v', 'f', 't', 'r',
    'id', 'ok', 'db', 'fs', 'os', 'el', 'cb', 'err', 'req', 'res', 'ctx', 'args', 'key', 'val', 'fn', 'ns', ...allow,
    // 2026-09-13：i18n/字典领域标准缩写——tr/L 是翻译与字典加载的通用命名（对标
    //   react-i18next 的 t、i18n 字典 dict），不是「无法猜出含义」的缩写。
    'tr', 'L', 'i18n', 'dict', 'locale']);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // 函数声明：function 后的 ident
    if (t.type === 'ident' && t.value === 'function') {
      const nx = tokens[i + 1];
      if (nx && nx.type === 'ident' && nx.value.length < min && !allowSet.has(nx.value)) {
        out.push({ line: nx.line, name: nx.value, type: 'function' });
      }
      continue;
    }
    // 参数列表内的短名（function f(a, b) / (a, b) => 的形参或调用实参位置）——短函数参数可接受（作用域 P2）
    if (t.type === 'ident' && t.value.length < min && !allowSet.has(t.value)) {
      const prevT = tokens[i - 1];
      const nextT = tokens[i + 1];
      const inParams = prevT && ((prevT.type === 'punct' && (prevT.value === '(' || prevT.value === ',')))
        && nextT && (nextT.type === 'punct' && (nextT.value === ',' || nextT.value === ')'));
      if (inParams) continue;
    }
    // 变量声明：const/let/var 后的 ident
    if (t.type === 'ident' && ['const', 'let', 'var'].includes(t.value)) {
      const nx = tokens[i + 1];
      if (nx && nx.type === 'ident' && nx.value.length < min && !allowSet.has(nx.value)) {
        out.push({ line: nx.line, name: nx.value, type: 'variable' });
      }
    }
  }
  return out;
}

/**
 * 检查函数名过短（function-name-too-short kind，AST 级，正则初筛后的精筛）。
 *
 * 与纯正则的差别：正则 `function\s+[A-Za-z_$][\w$]{0,1}\s*\(` 命中即报，会把
 * **i18n 领域标准缩写**（tr = translate、t、L = locale dict）当「无法猜出含义的缩写」
 * 误报。本实现按 token 定位 function 声明后的函数名，长度 ≤ max 且**不在公认缩写
 * 白名单**里才报。
 *
 * @param {string} text 文件全文
 * @param {{max?: number, allow?: string[]}} [opts] max 默认 2；allow 追加白名单
 * @returns {Array<{line:number, name:string}>} 命中列表
 */
export function checkShortFunctionNameAst(text = '', { max = 2, allow = [] } = {}) {
  const tokens = tokenize(text);
  const out = [];
  // 长度 ≤2 但有公认语义的缩写（不报）：i18n 的 tr/t、字典 L、常见工具名
  const ALLOW = new Set(['tr', 't', 'r', 'L', 'i18n', 'db', 'fs', 'os', 'el', 'cb', 'fn', 'ns',
    'id', 'ok', 'kv', 'ui', 'js', 'ts', 'is', 'to', 'of', 'in', 'no', 'op', 'up', 'un',
    'i', 'j', 'k', 'x', 'y', 'z', 'e', 'a', 'b', 'n', 'p', 's', 'v', 'f', ...allow]);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!(t.type === 'ident' && t.value === 'function')) continue;
    const nx = tokens[i + 1];
    if (!nx || nx.type !== 'ident') continue;
    if (nx.value.length <= max && !ALLOW.has(nx.value)) out.push({ line: nx.line, name: nx.value });
  }
  return out;
}

/**
 * 判定「全量读入文件」是否属于**受控小文件**读取（memory-bomb 精筛，AST 级）。
 *
 * 规则语义：`fs.readFile` 调用命中即报对「读本地小 JSON 配置/数据」的项目恒定误报。
 * 内存爆炸的真实风险在「读未知大小的大文件」；而读记分数据、标题缓存这类受控小文件
 * （通常紧跟 JSON.parse、或路径变量名含 data/cache/config/locale/store）不构成风险。
 *
 * 判定（满足任一即视为受控小文件读取 → 不报）：
 *   ① 同一行（或紧邻下一行）出现 JSON.parse —— 读 JSON 数据结构化的标准写法；
 *   ② 读取调用前后 6 个 token 内出现小文件语义标识符（data/cache/config/locale/settings/store/state）。
 *
 * @param {string} text 文件全文
 * @returns {Set<number>} 受控小文件读取的行号集合（这些行应从 memory-bomb 命中中剔除）
 */
export function checkSmallFileReadAst(text = '') {
  const tokens = tokenize(text);
  const out = new Set();
  const SMALL_HINTS = /(data|cache|config|locale|settings|store|state|manifest|package)/i;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // 找 readFile / readFileSync 调用
    if (!(t.type === 'ident' && /^readFile(Sync)?$/.test(t.value))) continue;
    // 邻近 token 文本（前后各 8 个）作为上下文
    const before = tokens.slice(Math.max(0, i - 8), i).map((x) => x.value).join(' ');
    const after = tokens.slice(i + 1, i + 9).map((x) => x.value).join(' ');
    const ctx = `${before} ${after}`;
    // 行级窗口：读入后常在下一行 JSON.parse（如读取文件后紧跟 migrate(JSON.parse(raw))），
    //   token 窗口不够，按源码行扩到 ±3 行。
    const srcLines = String(text).split('\n');
    const lineWindow = srcLines.slice(Math.max(0, t.line - 4), t.line + 3).join(' ');
    // ① 同语句/邻近行里出现 JSON.parse（读 JSON 数据）
    if (/JSON\s*\.\s*parse/.test(ctx) || /JSON\s*\.\s*parse/.test(lineWindow)) { out.add(t.line); continue; }
    // ② 上下文含小文件语义标识符
    if (SMALL_HINTS.test(before) || SMALL_HINTS.test(after) || SMALL_HINTS.test(lineWindow)) { out.add(t.line); continue; }
    // ③ 变量名/参数名为 file/raw 且同语句有 JSON 语义 —— 保守起见不豁免
  }
  return out;
}
