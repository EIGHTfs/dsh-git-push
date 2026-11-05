/**
 * 拼接产物的**作用域撞名检查**（通用：任何「多段 JS 拼进同一作用域」的产物都适用）。
 *
 * 要防的是什么：把多段 JS 拼进同一个作用域时，`var`/`function` 会被提升到函数顶部，
 *   同名声明**后者覆盖前者且完全不报错**——某一段依赖的函数被另一段的同名函数顶掉，
 *   运行时行为错乱却查不到任何异常。`const`/`let`/`class` 虽不提升，但同一块内重复声明
 *   同样会让先声明的那份失效（区别只是某些情形会抛 SyntaxError）。
 *
 * 典型落点（本插件是一个代表，不是特例）：
 *   · 浏览器端插件把多个分片拼成一个 `factory` 函数体（本插件 14 个分片）；
 *   · 用 `<script>` 直接引入多段脚本（共享全局作用域）；
 *   · 任何 `cat a.js b.js > bundle.js` 的土制打包。
 *
 * 判定方式（关键：**按真实作用域帧**而不是按缩进/深度）：
 *   遍历 token 维护一个花括号帧栈，每个 `{` 是一个**唯一帧**；声明绑定到
 *   「最近的外层作用域帧」——
 *     · `var` / `function` → 绑定到最近的**函数作用域帧**（函数体或顶层）；
 *     · `const` / `let` / `class` → 绑定到**当前帧**（块级作用域）；
 *     · `for (…)` 头部里的声明 → 绑定到该 for 语句的**专属帧**（每次迭代新绑定，
 *       兄弟循环同名合法；不这样处理会把 `for (const r of a)` + `for (const r of b)`
 *       误判成同帧重名——实测本项目 16 处误报全是这种写法）。
 *   于是「两个不同函数里的同名局部变量」天然分属不同帧 → 不算撞名（不会误报），
 *   而「同一函数体里两段各声明一次同名」会被抓住（这正是静默覆盖的触发条件）。
 *
 * 三条可选检查项（都能关，便于不同项目按自己的契约启用）：
 *   ① 顶层声明：`topLevelMustBeEmpty`（拼接产物常要求「文件顶层零声明」以免与别家撞名）；
 *   ② 命名前缀：`prefix`（如 `dshgp_`；留空则跳过），`allowlist` 放行宿主/契约名；
 *   ③ 同帧重名：始终启用（这是本检查存在的理由）。
 */
import { tokenize } from './tokenizer.js';

/** 会产生声明的关键字（其后第一个 ident 即声明名）。 */
const DECL_KEYWORDS = new Set(['function', 'const', 'let', 'var', 'class']);
/** 这些关键字后面跟的 `(`…`)` 是**控制语句条件**，其 `{` 是块而不是函数体。 */
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

/**
 * 扫描文本，找出「同一作用域内被声明多次」的名字，以及对顶层/前缀契约的违反。
 *
 * @param {string} text 待检查的 JS 文本
 * @param {{prefix?:string, allowlist?:string[], topLevelMustBeEmpty?:boolean,
 *          topLevelAllowlist?:string[]}} [opts]
 *   prefix：要求标识符带的前缀（如 `dshgp_`）；留空表示不检查前缀。
 *   allowlist：前缀例外（宿主注入或契约固定的名字）。
 *   topLevelMustBeEmpty：是否禁止文件顶层出现声明（默认 true）。
 * @returns {{ok:boolean, declarations:Array, duplicates:Array, topLevel:Array,
 *            missingPrefix:Array, violations:string[]}}
 */
export function analyzeScopeCollisions(text = '', {
  prefix = '', allowlist = [], topLevelMustBeEmpty = true, topLevelAllowlist = [],
} = {}) {
  const tokens = tokenize(String(text));
  const allowed = new Set(allowlist);
  const topAllowed = new Set(topLevelAllowlist);

  // 帧栈：{ id, isFunction }。id=0 表示文件顶层（虚拟帧，永远在栈底）。
  const frames = [{ id: 0, isFunction: true }];
  let nextFrameId = 1;
  /** 上一个「有效」token 的形态标记，用于判断 `{` 是否为函数体。 */
  let prevSignificant = '';
  /**
   * for 头部作用域：`for (const r of …)` 的绑定属于该 for 语句自己的作用域，
   *   每次迭代都是新绑定 ⇒ 兄弟循环里同名合法。把这类声明绑到**专属虚拟帧**
   *   （负 id，与花括号帧号不冲突），否则两个兄弟 for 循环的 `const r`/`let i`
   *   会被误判成同帧重名（本项目自审计实测 16 处误报，全是这种写法）。
   *   覆盖 `for await (…)`：token 流是 for → await → (。
   */
  const parenStack = [];   // { inFor, id } —— 当前打开的括号（只关心是否 for 头部）
  let nextForFrameId = -1;
  let forPending = false;  // 刚读到 for（其后可能跟 await），下一个 ( 即 for 头部

  const declarations = [];
  const duplicates = [];
  /** `${frameId}|${name}` → { count, firstLine }（firstLine 用于「哪两行撞了」的可定位文案）。 */
  const seen = new Map();
  /**
   * 共享作用域帧＝**最外层的函数体**（拼接后各段共同落入的那一个）。
   * 前缀检查只针对它：函数内部的局部变量各属自己的帧、彼此不可能撞名，
   *   要求它们也带前缀属过度约束（实测把 244 个局部变量误判成「缺前缀」）。
   * 用「第一个函数帧」而非固定深度 ⇒ 包装形态变了也不用改判定。
   */
  let sharedFrameId = -1;

  /** 找最近的外层函数作用域帧（var/function 绑定到它）。 */
  const nearestFunctionFrame = () => {
    for (let i = frames.length - 1; i >= 0; i -= 1) if (frames[i].isFunction) return frames[i].id;
    return 0;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const value = String(token.value);

    // ── `for` 头部识别：for [await] ( → 该括号里的声明归 for 自己的作用域 ──
    if (value === 'for') {
      forPending = true;
      prevSignificant = value;
      continue;
    }
    if (value === 'await' && forPending) {
      prevSignificant = value;
      continue; // 保持 pending：`for await (…)`
    }
    if (value === '(') {
      parenStack.push(forPending ? { inFor: true, id: nextForFrameId-- } : { inFor: false, id: 0 });
      forPending = false;
      prevSignificant = value;
      continue;
    }
    if (value === ')') {
      parenStack.pop();
      forPending = false;
      prevSignificant = value;
      continue;
    }
    forPending = false;

    if (value === '{') {
      // 判断这个 `{` 是不是函数体：紧跟在 `=>` 后，或紧跟在函数参数表 `)` 后，
      //   且该 `)` 不是 if/for/while/switch/catch 的控制条件。
      let isFunction = false;
      if (prevSignificant === '=>') isFunction = true;
      else if (prevSignificant === ')') {
        // 往回找与这个 `)` 配对的 `(`，看它前面是不是控制关键字
        let depthParen = 0;
        let openIdx = -1;
        for (let k = i - 1; k >= 0; k -= 1) {
          const v = String(tokens[k].value);
          if (v === ')') depthParen += 1;
          else if (v === '(') {
            depthParen -= 1;
            if (depthParen === 0) { openIdx = k; break; }
          }
        }
        const beforeParen = openIdx > 0 ? String(tokens[openIdx - 1].value) : '';
        isFunction = !CONTROL_KEYWORDS.has(beforeParen);
      }
      frames.push({ id: nextFrameId, isFunction });
      if (isFunction && sharedFrameId < 0) sharedFrameId = nextFrameId;
      nextFrameId += 1;
      prevSignificant = '{';
      continue;
    }
    if (value === '}') {
      if (frames.length > 1) frames.pop();
      prevSignificant = '}';
      continue;
    }

    if (DECL_KEYWORDS.has(value)) {
      // 跳过修饰符后取声明名
      let j = i + 1;
      while (j < tokens.length && ['*', 'async', 'export', 'default'].includes(String(tokens[j].value))) j += 1;
      const nameToken = tokens[j];
      if (nameToken && nameToken.type === 'ident') {
        const name = String(nameToken.value);
        const blockScoped = value === 'const' || value === 'let' || value === 'class';
        const inForHeader = Boolean(parenStack.length && parenStack[parenStack.length - 1].inFor);
        // for 头部里的声明（含 var）绑到该 for 的专属帧：兄弟循环同名合法，不算撞名
        const frameId = inForHeader
          ? parenStack[parenStack.length - 1].id
          : (blockScoped ? frames[frames.length - 1].id : nearestFunctionFrame());
        // frameDepth 只对花括号帧有意义；for 头部（虚拟帧）记为 -1，既不会误入「顶层声明」，
        //   也不会参与共享作用域（sharedFrameId ≥1）的前缀判定。
        const frameDepth = inForHeader ? -1 : frames.length - 1;
        declarations.push({ name, keyword: value, line: token.line, frameId, frameDepth });
        const key = `${frameId}|${name}`;
        const prev = seen.get(key);
        const count = (prev?.count || 0) + 1;
        const keywords = prev ? [...prev.keywords, value] : [value];
        seen.set(key, { count, firstLine: prev ? prev.firstLine : token.line, keywords });
        // 只报一次：第 3 次及以后的同名声明不再重复入列（同一个名字一条命中，避免刷屏）
        if (count === 2) {
          duplicates.push({
            name,
            frameId,
            scope: blockScoped ? 'block' : 'function',
            line: token.line,          // 后来者（静默覆盖的那份）
            firstLine: prev.firstLine, // 先声明的那份
            keywords,                  // 两次声明用的关键字（决定这条命中算不算真缺陷，见检查器）
          });
        }
      }
      prevSignificant = value;
      continue;
    }

    prevSignificant = value;
  }

  const topLevel = declarations.filter((d) => d.frameDepth === 0);
  // 前缀只约束**共享作用域帧**（最外层函数体）：各函数内部的局部变量分属自己的帧、
  //   彼此不可能撞名，要求它们也带前缀属过度约束（实测会把片段里的局部变量全判成缺前缀）。
  const missingPrefix = !prefix ? [] : declarations.filter(
    (d) => d.frameId === sharedFrameId && !d.name.startsWith(prefix) && !allowed.has(d.name),
  );

  // 三类命中都带上 message：violations 直接由它们汇总而成 —— **单一措辞源**。
  //   审计检查器（lib/checks/scope-collision.js）出 finding 时直接用 item.message，
  //   不再各自重写一遍文案（两处措辞必然漂移）。
  const topLevelHits = !topLevelMustBeEmpty ? [] : topLevel
    .filter((d) => !topAllowed.has(d.name))
    .map((d) => ({
      ...d,
      message: `顶层声明 ${d.name}（第 ${d.line} 行）：拼接产物应保持文件顶层零声明，避免与其它脚本/插件撞名`,
    }));
  const prefixHits = !prefix ? [] : missingPrefix.map((d) => ({
    ...d,
    message: `声明 ${d.name}（第 ${d.line} 行）缺少 ${prefix} 前缀：拼接分片共用同一作用域，裸名易被别段覆盖`,
  }));
  const duplicateHits = duplicates.map((d) => ({
    ...d,
    message: `「${d.scope === 'function' ? '同一函数作用域' : '同一代码块'}」内 ${d.name} 被声明 2 次以上`
      + `（第 ${d.firstLine} 行与第 ${d.line} 行）：var/function 会静默覆盖，后者顶掉前者且不报错`,
  }));

  const violations = [...topLevelHits, ...prefixHits, ...duplicateHits].map((d) => d.message);

  return {
    ok: violations.length === 0,
    declarations,
    duplicates: duplicateHits,
    topLevel: topLevelHits,
    missingPrefix: prefixHits,
    violations,
    sharedFrameId,
  };
}
