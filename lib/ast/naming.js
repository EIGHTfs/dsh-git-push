/**
 * AST 实现层 · 命名与读取检查
 *
 * 职责：标识符长度、函数名是否过短（含 i18n 缩写豁免）、受控小文件读取判定。
 */

import { tokenize } from './tokenizer.js';

/** 声明/控制流关键字（Java「类型 短名」分支须排除的常见语言关键字前缀）——
 *   prevT 是这些时不是「类型名」，`短名` 属各语言声明/流程语境而非 Java 变量声明。
 *   const/let/var=JS、val=Kotlin、return=流程、function/def/class=声明、import/from=导入、
 *   for/in/of=循环头、case=switch、new=构造、throw=抛错。 */
const DECL_KEYWORDS = new Set([
  'const', 'let', 'var', 'val', 'return', 'function', 'def', 'class', 'import', 'from',
  'for', 'in', 'of', 'case', 'new', 'throw', 'while', 'if', 'else', 'switch', 'catch',
  'typeof', 'void', 'delete', 'yield', 'await', 'extends', 'super', 'this', 'static',
]);

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
    // i18n/字典领域标准缩写——tr/L 是翻译与字典加载的通用命名（对标
    //   react-i18next 的 t、i18n 字典 dict），不是「无法猜出含义」的缩写。
    // 小写 l 与大写 L 同语义（line/字典加载），此前只列了大写 → 同一写法两种待遇（自审实测命中）。
    'tr', 'L', 'l', 'i18n', 'dict', 'locale']);
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
      // 循环迭代变量豁免（for (const d of densityHits) / for (let i in obj) 的
      //   单字母是强语义局部变量——作用域仅循环体、语义由被遍历集合决定，不属「看不懂含义」。
      if (nx && nx.type === 'ident' && nx.value.length < min && !allowSet.has(nx.value)) {
        // token 序列：for (const d of ... —— const 前一 token 是 '('，再前是 'for'
        const prevP = tokens[i - 1];
        const prev2 = tokens[i - 2];
        const inForHead = prevP && prevP.type === 'punct' && prevP.value === '('
          && prev2 && prev2.type === 'ident' && prev2.value === 'for';
        if (!inForHead) out.push({ line: nx.line, name: nx.value, type: 'variable' });
      }
    }
    // ── Python 语法支持（python/variable-min-length 等规则生效）──
    //   Python 无 const/let/var/function：函数声明是 `def name(`，变量声明是 `name = 值`。
    //   a) def 后的函数名（ident 'def' 下一个非空白 ident 且后跟 '('）
    if (t.type === 'ident' && t.value === 'def') {
      const nx = tokens[i + 1];
      const after = tokens[i + 2];
      if (nx && nx.type === 'ident' && nx.value.length < min && !allowSet.has(nx.value)
        && after && after.type === 'punct' && after.value === '(') {
        out.push({ line: nx.line, name: nx.value, type: 'function' });
      }
      continue;
    }
    //   b) `name = ` 变量声明（等号前是短 ident；排除 import/from/def/class/return/
    //      for/if/elif/else/while 关键字语境——这些不是「变量声明」；
    //      并排除 const/let/var 前缀——JS 声明已由上方 JS 分支处理，避免二次报）
    if (t.type === 'ident' && t.value.length < min && !allowSet.has(t.value)) {
      const prevT = tokens[i - 1];
      const prev2 = tokens[i - 2];
      const nextT = tokens[i + 1];
      if (nextT && nextT.type === 'punct' && nextT.value === '=') {
        // 排除：import x / from x / return x / for x in / class x / def x / const x =
        //   （const/let/var 前缀的 JS 声明由 JS 分支管；这里是 Python 无关键字声明）
        const KW = new Set(['import', 'from', 'return', 'for', 'class', 'def', 'if', 'elif', 'else', 'while', 'in', 'as', 'with', 'lambda', 'del', 'pass', 'not', 'and', 'or', 'global', 'nonlocal', 'yield', 'assert', 'raise', 'is', 'None', 'True', 'False']);
        const prevIsDecl = prevT && prevT.type === 'ident' && ['const', 'let', 'var'].includes(prevT.value);
        const prev2IsDecl = prev2 && prev2.type === 'ident' && ['const', 'let', 'var'].includes(prev2.value);
        if (!KW.has(t.value) && !prevIsDecl && !prev2IsDecl
          && prevT && !(prevT.type === 'punct' && prevT.value === '.')) {
          out.push({ line: t.line, name: t.value, type: 'variable' });
        }
      }
    }
    // ── Java/Kotlin 语法支持（java/variable-min-length 等规则生效）──
    //   Java/Kotlin 无 const/let/var/function/def：变量声明是「类型 短名」形态
    //   （int x / String s / int[] arr / List<String> list），方法参数、字段、局部变量
    //   都如此。识别：短 ident 后跟 `=` 或 `;` 或 `,` 或 `)`，且前一是「类型段末尾」
    //   （ident / `>` 泛型尾 / `]` 数组尾）——即 `类型 短名` 声明形态。
    if (t.type === 'ident' && t.value.length < min && !allowSet.has(t.value)) {
      const prevT = tokens[i - 1];
      const nextT0 = tokens[i + 1];
      const nextT1 = tokens[i + 2];
      // 声明判定：前一是类型段（ident/`>`/`]`），后一可能是 `=`（初始化）、
      //   `;`（纯声明）、`,`（多声明/参数）、`)`（参数尾）、`]`（数组长度）
      const prevIsTypeEnd = prevT && (
        prevT.type === 'ident'
        || (prevT.type === 'punct' && (prevT.value === '>' || prevT.value === ']'))
      );
      const nextIsDecl = nextT0 && (
        (nextT0.type === 'punct' && ['=', ';', ',', ')', ']', ':'].includes(nextT0.value))
        || (nextT0.type === 'ident' && nextT1 && nextT1.type === 'punct' && nextT1.value === '=')
      );
      if (prevIsTypeEnd && nextIsDecl && !(prevT.type === 'ident' && prevT.value === 'fun')) {
 // 排除声明/控制流关键字前缀（修复 Java 分支误伤 JS）：
        //   `const c = 1`（JS）、`val/var x =`（Kotlin）、`return q`、`function`、
        //   Python `def`/`import` 后接短名等——prevT 是 ident 但非「类型名」，
        //   前一是这些关键字时是各语言声明/流程语境，不是「类型 短名」声明。
        //   实测误伤：Pawchive test/tools 大量 `const c/h/m = …` 被 Java 分支当
        //   Java 变量报短名（内置 min-length 27 条 + ext 部分全为此根因）。
        if (prevT.type === 'ident' && DECL_KEYWORDS.has(prevT.value)) continue;
        out.push({ line: t.line, name: t.value, type: 'variable' });
      }
    }
    //   Kotlin 函数声明：fun name( —— name 前的 `fun` 是声明关键字
    if (t.type === 'ident' && t.value === 'fun') {
      const nx = tokens[i + 1];
      const after = tokens[i + 2];
      if (nx && nx.type === 'ident' && nx.value.length < min && !allowSet.has(nx.value)
        && after && after.type === 'punct' && after.value === '(') {
        out.push({ line: nx.line, name: nx.value, type: 'function' });
      }
      continue;
    }
  }
  // 多语言分支可能对同一标识符重复命中（如 Java `int w = 5` 的 w 同时命中
  // 「类型+短名」Java 分支与「短名=」Python 分支）——按行+名+类型去重
  const seen = new Set();
  return out.filter((x) => {
    const k = `${x.line}:${x.name}:${x.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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

/**
 * memory-bomb 的 json-stringify-large 精筛：`console.log(JSON.stringify(大对象))`
 * 是一次性输出模式——CLI `--json` 出口序列化一次立即打印并退出，字符串不会常驻内存，
 * 与「长期运行进程里大对象序列化」的真实风险不同。此类行豁免。
 * @param {string} text 文件全文
 * @returns {Set<number>} 豁免行号集合
 */
export function checkConsoleLogJsonAst(text = '') {
  const tokens = tokenize(text);
  const out = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!(t.type === 'ident' && t.value === 'JSON')) continue;
    // JSON 后应跟 .stringify
    const nx = tokens[i + 1];
    if (!nx || nx.type !== 'punct' || nx.value !== '.') continue;
    const nx2 = tokens[i + 2];
    if (!nx2 || nx2.type !== 'ident' || nx2.value !== 'stringify') continue;
    // 行内窗口：JSON.stringify 之前 12 个 token 内是否有 console.log / console.error 输出调用
    const before = tokens.slice(Math.max(0, i - 12), i).map((x) => x.value).join(' ');
    if (/console\s*\.\s*(log|error|warn|info)\s*\(/.test(before)) out.add(t.line);
  }
  return out;
}
