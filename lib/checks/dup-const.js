/**
 * 检查层 · 同名常量跨文件重复定义（DRY）
 *
 * 为什么是「跨文件」检查：runChecks 逐文件调用只能发现文件内重复，
 *   而「同一阈值/长度/窗口常量散落多个模块」正是改一处漏多处的维护坑——
 *   因此与 dup-code 一样在 auditFiles 层（拿到全部文件文本后）统一执行一次。
 *
 * 判定（用户建议「加规则」——MAX_MSG_PREVIEW=80 三处重复实测驱动）：
 *   · 提取每个代码文件的 `const NAME = <num|str>` 定义（token 级，剥离字符串/注释）
 *   · 跨文件按 (name, value) 聚合：**同名校同值 ≥2 个文件** → 报「应统一单一来源」
 *   · 排除：test/fixtures（测试夹具各自常量合理）、0/1/-1/2/3 等基础值（循环/布尔语境常见）
 *   · severity 恒 warning（只提示不拦截）
 */
import { tokenize } from '../ast/tokenizer.js';
import { detectLang } from '../ast/lang.js';
import { makeFinding } from '../audit/index.js';
import { HINT_QUALITY } from './common.js';

/** 基础值跳过（循环计数/布尔/简单算术——不是「应配置化」的阈值常量）。 */
const SKIP_VALUES = new Set(['0', '1', '-1', '2', '3']);
// 「脚本自解析自己的根」惯用名：这些名字出现在多个脚本里是设计预期（各脚本独立解析自己的根），
//   不算重复定义。注意：本检查器只取 `=` 后的**第一个 token** 作为 value（如 `resolve(...)` 记成
//   `resolve`），所以下面的值判定只能按首 token 匹配，不能写 `resolve\(` 这类带括号的写法。
const ROOT_IDIOM_NAMES = new Set(['HERE', 'ROOT', 'SCRIPT_DIR', 'SELF', 'DIR', 'BASE', 'BASE_DIR']);
const ROOT_IDIOM_VALUE = /^(dirname|fileURLToPath|__dirname|resolve|join|process|argv)$/;
// 这两个是「每脚本一份」的命令行/环境对象，无条件豁免（与是不是路径无关）
const PER_SCRIPT_NAMES = new Set(['args', 'env', 'argv', 'flags', 'opts']);

/**
 * 提取 `const NAME = 值` / `const NAME: T = 值`（Rust 类型标注）/ Kotlin `const val NAME = 值`
 *   中的常量定义。仅模块级（atTopLevel 校验由调用方传闭包）；返回 true=已消费该 const token。
 */
function extractFromConst(tokens, i, atTopLevel, push) {
  if (!atTopLevel(tokens[i].line)) return true; // 函数内 const 是局部变量，跳过
  let k = i + 1;
  const end = Math.min(tokens.length, i + 7);
  while (k < end) {
    const nm = tokens[k];
    if (!nm || nm.type !== 'ident') { k++; continue; }
    const eq = tokens[k + 1];
    if (eq?.type === 'punct' && eq.value === '=') { push(nm.value, tokens[k + 2], nm.line); return true; }
    if (eq?.type === 'punct' && eq.value === ':') {
      // Rust `NAME: T = 值`——NAME 后 `:` 再向后找 `=`
      for (let m = k + 2; m < Math.min(tokens.length, k + 5); m++) {
        if (tokens[m]?.type === 'punct' && tokens[m].value === '=') { push(nm.value, tokens[m + 1], nm.line); return true; }
      }
      return true;
    }
    // 非 `NAME =` 的 ident（Kotlin const 后的 val）→ 继续找下一个
    k++;
  }
  return true;
}

/**
 * 提取 Java `static final TYPE NAME = 值` 类常量字段（final 前须有 static——方法内局部 final 不算常量）。
 * 返回 true=已消费该 final token。
 */
function extractFromJavaFinal(tokens, i, push) {
  const prev = tokens[i - 1];
  if (!(prev?.type === 'ident' && prev.value === 'static')) return true; // 仅 static final 类常量
  for (let k = i + 1; k < Math.min(tokens.length, i + 5); k++) {
    const nm = tokens[k], eq = tokens[k + 1], val = tokens[k + 2];
    if (nm?.type === 'ident' && eq?.type === 'punct' && eq.value === '=') { push(nm.value, val, nm.line); return true; }
  }
  return true;
}

/**
 * 提取文件内「命名常量定义」（token 级，剥离字符串/注释），按语言分派：
 *   js/ts/tsx/jsx：`const NAME = <num|str>`
 *   kotlin：`const 声明 + NAME = <值>` / 顶层 `val NAME = <值>`
 *   java：`[static] final [类型] NAME = <值>;`（final 后 3 token 内的 NAME =）
 *   go/rust：`const NAME = <值>`（const 后）
 *   python：**行首无缩进** `NAME = <num|str>`（模块级常量惯例）
 * 统一返回 {name, value, line}；value 归一（num 原样、str 去引号）。
 * @param {string} text 文件全文
 * @returns {Array<{name:string, value:string, line:number}>}
 */
export function findConstDefs(text = '') {
  const tokens = tokenize(String(text));
  const lang = detectLang(String(text));
  const out = [];
  // 行首是否无缩进（模块级顶层）——函数内 const/let/var/val 是局部变量，不是「命名常量」
  const atTopLevel = (line) => {
    const srcLine = String(text).split('\n')[line - 1] || '';
    return /^\S/.test(srcLine);
  };
  const push = (name, val, line) => {
    if (!name || !val) return;
    const raw = val.type === 'num' ? val.value : String(val.value).replace(/^(['"])([\s\S]*)\1$/, '$2');
    if (SKIP_VALUES.has(raw)) return;
    // 「脚本自解析自己的根」是**独立运行**的设计前提（脚本随插件发布、在安装副本目录里同样要能跑，
    //   见 scripts/ 各脚本的零依赖约定）——每个脚本各写一份 HERE / ROOT / SCRIPT_DIR / args / env
    //   不是「重复定义」，合并成公共常量反而让脚本依赖 lib 而失去独立性。
    //   此前这类惯用法被当 DRY 问题报出来：自审 22 条里大半是它（误报，实测）。
    //   判定要同时满足「通用名 + 路径/argv 惯用值」两个条件，避免误伤 PLUGIN_ROOT 这类真重复。
    if (PER_SCRIPT_NAMES.has(name)) return; // 每脚本一份的命令行/环境对象，不是共享常量
    if (ROOT_IDIOM_NAMES.has(name) && ROOT_IDIOM_VALUE.test(raw)) return;
    out.push({ name, value: raw, line });
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident') continue;
    // const NAME = 值 / Kotlin const 声明 + NAME = 值 / Rust const NAME: T = 值（类型标注）
    //   ——仅**模块级**（行首无缩进）才算命名常量；函数内 const 是局部变量（r/args/out 等
    //   常见名跨文件同名纯属巧合，不是 DRY 信号——实测误爆 338 条修正）
    if (t.value === 'const' && lang !== 'java' && extractFromConst(tokens, i, atTopLevel, push)) continue;
    // Kotlin：val NAME = val（顶层，无 const 前缀）
    if (t.value === 'val' && lang === 'kotlin' && atTopLevel(t.line)) {
      const nm = tokens[i + 1], eq = tokens[i + 2], val = tokens[i + 3];
      if (nm?.type === 'ident' && eq?.type === 'punct' && eq.value === '=') push(nm.value, val, nm.line);
      continue;
    }
    // Java：`static final TYPE NAME = val`（类常量字段；final 前须有 static——方法内局部 final 不算常量）
    if (t.value === 'final' && lang === 'java' && extractFromJavaFinal(tokens, i, push)) continue;
    // Python：行首无缩进且**全大写** `NAME = val`（Python 模块级常量惯例 PEP8；
    //   不依赖 detectLang——单行常量样本无 def/class 时 detectLang 落 js，直接用形态判定）
    if (atTopLevel(t.line) && /^[A-Z][A-Z0-9_]*$/.test(t.value)) {
      const eq = tokens[i + 1], val = tokens[i + 2];
      if (eq?.type === 'punct' && eq.value === '=' && val && (val.type === 'num' || val.type === 'str')) {
        push(t.value, val, t.line);
      }
    }
  }
  // 多分支可能对同一常量重复提取（JS const 分支 + 全大写分支 / Java final 分支 + 全大写分支
  //   都可能命中同一 `NAME = 值`）——按行名去重，保证同一条只留一份
  const seen = new Set();
  return out.filter((d) => {
    const k = `${d.line}:${d.name}:${d.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 跨文件同名常量重复定义检测。
 * @param {Array<{path:string, text:string}>} fileTexts 全部代码文件
 * @param {Array} [rules] 规则定义（取 id/dimensions）
 * @returns {Array} findings（severity 恒 warning）
 */
export function checkDuplicateConst(fileTexts = [], rules = null) {
  const findings = [];
  if (!Array.isArray(fileTexts) || fileTexts.length < 2) return findings;
  const rule = Array.isArray(rules) && rules.length ? rules[0] : null;

  // 逐文件提取（跳过 test/fixtures——测试夹具常量各自定义是正常形态）
  const perFile = [];
  for (const { path, text } of fileTexts) {
    if (!text) continue;
    if (/(^|[\\/])(test|tests|__tests__|fixtures?|mocks?)([\\/]|$)/.test(path)) continue;
    if (!/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(path)) continue;
    try {
      perFile.push({ path, defs: findConstDefs(text) });
    } catch { /* 单文件解析异常不影响整体 */ }
  }

  // 聚合：key = name|value → {name, value, files: [{path, line}]}
  const groups = new Map();
  for (const { path, defs } of perFile) {
    for (const d of defs) {
      const key = `${d.name}|${d.value}`;
      if (!groups.has(key)) groups.set(key, { name: d.name, value: d.value, files: [] });
      groups.get(key).files.push({ path, line: d.line });
    }
  }

  for (const g of groups.values()) {
    if (g.files.length < 2) continue;
    const [first, ...rest] = g.files;
    const others = rest.map((f) => `${f.path}:${f.line}`).join('，');
    findings.push(makeFinding({
      file: first.path,
      line: first.line,
      rule: rule?.id || 'maintainability/duplicate-constant-def',
      kind: 'duplicate-const',
      severity: 'warning',
      message: `常量「${g.name} = ${g.value}」在 ${g.files.length} 个文件重复定义（${first.path}:${first.line}、${others}）——阈值/长度/窗口应统一到公共常量模块或配置文件单处定义（DRY，改一处即可全局生效）`,
      dimensions: rule?.dimensions || ['可维护性'],
      exemptHint: HINT_QUALITY,
      scoreImpact: 1,
    }));
  }
  return findings;
}
