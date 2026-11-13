/**
 * test-dataflow.mjs —— 同族测试合并（test-dataflow.mjs · test-dataflow-clear-fp.mjs · test-dataflow-py-bodies.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { checkClearAccessAst } from '../../lib/ast/dataflow.js';
import { checkDataflow, filterRulesByFileText, runChecks } from '../../lib/audit/checks.js';
import { loadRuleFiles } from '../../lib/rule/loader.js';
import { compileAllRules } from '../../lib/rule/registry.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// ── 原 test-dataflow.mjs ──
{
  // dsh-skip-sensitive: 测试 fixture 仅演示代码，无真实凭据
  /**
   * 三层审计（L1 正则初筛 / L2 AST 数据流 / 空规则守卫）测试。
   *
   * 场景对照（用户 2026-09-14 三层设计）：
   *   L1 正则：file_patterns 只筛「可能含清空+访问」的候选文件，未命中剔除规则（成本极低）
   *   L2 AST：同函数内清空（clear()/=[]/=null/length=0/splice(0)）后访问（.get()/[0]）才报
   *   L3 运行时：跨文件/闭包/异步盲区（scripts/audit-runtime-check.mjs，此处测 L2 侧判定）
   * 守卫：规则被 L1 剔除/excludes 过滤为空时检查器短路（防 rule.severity 崩溃——修 iwara 触发的崩）
   */

  const RULE = { id: 'dataflow/clear-then-access', kind: 'dataflow', severity: 'warning' };

  function hits(text) {
    return checkDataflow({ file: 'dataflow-test.js', text, rules: [RULE] });
  }

  // ---------- L2：同函数清空后访问 ----------
  test('[dataflow] dataflow：clear() 后 get()（同函数）命中', () => {
    const text = 'function f() { cache.clear(); return cache.get(id); }';
    const r = hits(text);
    assert.equal(r.length, 1);
    assert.match(r[0].message, /cache/);
    assert.match(r[0].message, /\.clear\(\)/);
  });

  test('[dataflow] dataflow：=[] 后 [0] 命中；=null 后 [0] 命中', () => {
    assert.equal(hits('function f() { list = []; return list[0]; }').length, 1);
    assert.equal(hits('function f() { q = null; return q[0]; }').length, 1);
    assert.equal(hits('function f() { q.length = 0; return q[0]; }').length, 1);
  });

  test('[dataflow] dataflow：声明初始化（var x = []）不算清空', () => {
    const text = 'var allVideos = []; function f() { return allVideos[0]; }';
    assert.equal(hits(text).length, 0);
  });

  test('[dataflow] dataflow：清空后写回（push/set/重新赋值）撤销', () => {
    assert.equal(hits('function f() { cache.clear(); cache.set("a", 1); return cache.get("a"); }').length, 0);
    assert.equal(hits('function f() { list = []; list = [1, 2]; return list[0]; }').length, 0);
  });

  test('[dataflow] dataflow：引用传参填充撤销（walkVideos(root, files, 0)）', () => {
    const text = 'function f() { files = []; walkVideos(root, files, 0); return files.length; }';
    assert.equal(hits(text).length, 0);
  });

  test('[dataflow] dataflow：跨函数不连（顶层清空 → 函数内访问）', () => {
    const text = 'resultsByIndex = new Map(); function skipItem() { resultsByIndex.set(i, x); }';
    assert.equal(hits(text).length, 0);
  });

  test('[dataflow] dataflow：先访问后清空不命中', () => {
    const text = 'function f() { const x = cache.get("a"); cache.clear(); return x; }';
    assert.equal(hits(text).length, 0);
  });

  test('[dataflow] dataflow：shift/pop 消费式访问不报（while len 保护模式）', () => {
    const text = 'function pump() { while (queue.length) { const it = queue.shift(); use(it); } }';
    assert.equal(hits(text).length, 0);
  });

  // ---------- L1：file_patterns 文件内容初筛 ----------
  test('[dataflow] L1：file_patterns 命中候选保留，未命中剔除', () => {
    const rule = {
      id: 'dataflow/clear-then-access', kind: 'dataflow', severity: 'warning',
      filePatterns: ['clear\\(', '=\\s*\\[\\]'],
    };
    const grouped = { dataflow: [rule] };
    assert.equal(filterRulesByFileText(grouped, 'cache.clear();').dataflow.length, 1);
    assert.equal(filterRulesByFileText(grouped, 'just a normal file').dataflow.length, 0);
  });

  test('[dataflow] L1：非法正则退回子串包含（保守放行）', () => {
    const rule = { id: 'x', kind: 'dataflow', filePatterns: ['(unclosed'] };
    const grouped = { dataflow: [rule] };
    assert.equal(filterRulesByFileText(grouped, '(unclosed [').dataflow.length, 1);
    assert.equal(filterRulesByFileText(grouped, 'nothing here').dataflow.length, 0);
  });

  // ---------- 空规则守卫（防 rule.severity 崩溃） ----------
  test('[dataflow] 守卫：rules 为空数组检查器短路（不崩）', () => {
    assert.deepEqual(checkDataflow({ file: 'x.js', text: 'cache.clear(); cache.get(1);', rules: [] }), []);
    assert.deepEqual(checkDataflow({ file: 'x.js', text: 'cache.clear();', rules: undefined }), []);
  });

  test('[dataflow] 守卫：runChecks 全链路空规则不崩（L1 剔除 dataflow）', () => {
    const rule = { id: 'dataflow/clear-then-access', kind: 'dataflow', severity: 'warning', filePatterns: ['zzz-not-present'] };
    const grouped = { dataflow: [rule] };
    // L1 剔除 → dataflow 规则空 → 检查器短路；文件不崩
    const out = runChecks({ file: 't.js', relPath: 't.js', text: 'cache.clear(); cache.get(1);', grouped }, { level: 'standard' });
    assert.ok(Array.isArray(out));
  });

  // ---------- 编译集成：yml 规则能编译成 dataflow kind ----------
  test('[dataflow] 集成：yml dataflow/clear-then-access 编译成功且带 filePatterns', () => {
    const loaded = loadRuleFiles(['nodejs'], { dir: '', disabledSlots: [] });
    const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
    const df = compiled.filter((r) => r.kind === 'dataflow');
    assert.equal(df.length, 1);
    assert.equal(df[0].id, 'dataflow/clear-then-access');
    assert.ok(Array.isArray(df[0].filePatterns) && df[0].filePatterns.length > 0);
  });

  // ---------- AST 层直接验证（跨语言/跨扩展不误入由 gitignore 层管） ----------
  test('[dataflow] ast：checkClearAccessAst 空文本/无函数安全返回空', () => {
    assert.deepEqual(checkClearAccessAst(''), []);
    assert.deepEqual(checkClearAccessAst('const a = 1;'), []);
  });
}

// ── 原 test-dataflow-clear-fp.mjs ──
{
  /**
   * dataflow/clear-then-access 四类系统性误报回归（2026-11-06，来源真实语料实测）。
   *
   * 在外部 Python 仓库（约 1300 文件）上实测该规则 11 条命中里 7~9 条是误报，
   * 四类根因各不相同，且**都不是"规则思路错"，是判据缺口**：
   *
   *   A. `.empty()` 被当作清空方法 —— CLEAR_METHODS 含 'empty'，但 empty() 在各语言都是
   *      **查询**（Python Queue.empty() / C++ vector.empty() 返回 bool）。实测：
   *      `while not self._queue.empty():` 之后的 `.get()` 被当成"清空后访问"。
   *   B. 写目标被当读访问 —— `self._status[mid] = X` 里 `[mid]` 是**写入下标**不是读；
   *      applyAccessAfterClear 只看 `obj[` 就报，没看配对 `]` 后面是不是 `=`。
   *   C. 类型注解位参与判定 —— PEP 526 `self._x: list = []` 让注解里的 `list` 被当对象名
   *      记入清空表，随后 `-> list[str]` 返回注解里的 `list[str]` 被当读访问。
   *   D. 多目标解包错位 —— `result, last = [], {}` 中 `last` 后面紧跟 `=`，
   *      规则把 `[]` 算到 last 头上（实际 last 拿到的是 `{}`），后续 `last.get()` 误报。
   *
   * 正样本（真缺陷）必须保住：`.clear()` 后无写回就 `.get()` / `[k]` 仍要报。
   */

  const n = (src) => checkClearAccessAst(src).length;

  test('[dataflow-clear-fp] A. .empty() 是查询不是清空 —— 之后的读取不报', () => {
    const py = [
      'def f(q):',
      '    while not q.empty():',
      '        task = q.get(timeout=0.05)',
    ].join('\n');
    assert.equal(n(py), 0, 'q.empty() 返回 bool，不是清空动作');
    // JS 侧同理：arr.empty()（某些库的谓词）不该当清空
    assert.equal(n('function f(a) { if (a.empty()) { return a.get(0); } }'), 0);
  });

  test('[dataflow-clear-fp] B. 写目标不是读访问 —— obj[k] = v 不报', () => {
    const py = [
      'def f(s):',
      '    s.clear()',
      '    s[mid] = 1',
    ].join('\n');
    assert.equal(n(py), 0, 's[mid] = 1 是写入下标，不是"清空后读取已清空容器"');
    assert.equal(n('function f(m) { m.clear(); m[key] = 1; }'), 0);
  });

  test('[dataflow-clear-fp] C. 类型注解位不参与 —— PEP526 注解与返回注解都不报', () => {
    const py = [
      'class A:',
      '    def __init__(self):',
      '        self._listeners: list = []',
      '',
      '    def ids(self) -> list[str]:',
      '        return []',
    ].join('\n');
    assert.equal(n(py), 0, '注解里的 list 不是被清空的容器对象');
  });

  test('[dataflow-clear-fp] D. 多目标解包不透支 —— a, b = [], {} 不把 [] 算给 b', () => {
    const py = [
      'def f(ev):',
      '    result, last = [], {}',
      '    for e in ev:',
      '        p = last.get(e)',
    ].join('\n');
    assert.equal(n(py), 0, 'last 拿到的是 {}（非空字面量），不是 []');
  });

  test('[dataflow-clear-fp] 正样本保住：真清空后无写回就读取，仍必须报', () => {
    assert.equal(n('def f(c):\n    c.clear()\n    return c.get(1)'), 1, 'clear() 后 get() 必须报');
    assert.equal(n('function f(c) { c.clear(); return c.get(1); }'), 1, 'JS：clear() 后 get() 必须报');
    assert.equal(n('def f(c):\n    c = []\n    return c[0]'), 1, '=[] 后读下标必须报');
    assert.equal(n('def f(c):\n    c = {}\n    c.clear()\n    return c[k]'), 1, 'clear() 后读下标必须报');
  });

  test('[dataflow-clear-fp] 正样本：写回撤销后不报（既有能力不许回退）', () => {
    assert.equal(n('function f(c) { c.clear(); c.set("a",1); return c.get("a"); }'), 0);
    assert.equal(n('function f(c) { c.clear(); c.push(1); return c.get(0); }'), 0);
  });

  test('[dataflow-clear-fp] A2. .reset() 是「恢复默认值」不是清空 —— 之后的读取不报（2026-11-06 实测追加）', () => {
    // 现场证据：某配置类 reset() -> bool，测试断言 cfg.reset() 后 cfg.get(...) 得到的是**有效默认值**
    const py = [
      'def f(cfg):',
      '    cfg.reset()',
      '    return cfg.get("general.theme")',
    ].join('\n');
    assert.equal(n(py), 0, 'reset() 后对象仍有内容，读取安全');
    // 真正的容器清空仍必须报（clear 保留在 CLEAR_METHODS）
    assert.equal(n('def f(c):\n    c.clear()\n    return c.get(1)'), 1, 'clear() 仍是清空，必须报');
  });
}

// ── 原 test-dataflow-py-bodies.mjs ──
{
  /**
   * Python 缩进式函数体区间（2026-11-06，第五类系统性误报回归）。
   *
   * 真实现场：某 Python 仓库 clear-then-access 报 13 条，抽样 3 条全是**跨方法误连**：
   *   · clear 在 `invalidate()` (L126)、access 在 `build_index()` (L303)
   *   · clear 在 `clear()` (L95)、access 在 `tools_page()` (L116)
   *   · clear 在 `prepare_for_open()` (L566)、access 在 `_schedule_retirement()` (L614)
   *
   * 根因（结构性，不是判据微调）：函数体区间收集只认 **JS 风格**
   *   —— `collectDeclaredFnBodies` 找 `function` 关键字、`collectArrowMethodBodies` 找 `) {`。
   *   Python 用 `def f():` + 缩进，两者都不命中 ⇒ fnRanges 为空 ⇒ mergeFnRanges
   *   退化成「整个文件一个区间」⇒ 同文件内**任意位置**的清空与访问都会被配成一对。
   *   这不是「宁漏不误」能辩护的，是把不相关代码当数据流。
   *
   * 修法：按缩进解析 `def`/`async def` 块范围，与花括号语言并存。
   */

  const n = (src) => checkClearAccessAst(src).length;

  test('[dataflow-py-bodies] ① 跨方法不连：A 方法 clear、B 方法读取，不得报', () => {
    const py = [
      'class S:',
      '    def invalidate(self):',
      '        self._cache.clear()',
      '',
      '    def build(self):',
      '        return self._cache.get(1)',
    ].join('\n');
    assert.equal(n(py), 0, 'clear 在 invalidate()、访问在 build()，属不同函数体，不该配成一对');
  });

  test('[dataflow-py-bodies] ② 同方法内仍必须连（收紧要刚好，不能一并压制）', () => {
    const py = [
      'class S:',
      '    def refresh(self):',
      '        self._cache.clear()',
      '        item = self._cache.get(1)',
      '        return item',
    ].join('\n');
    assert.equal(n(py), 1, '同一个方法体内 clear 后 get 必须报');
  });

  test('[dataflow-py-bodies] ③ 嵌套函数是**闭包**：共享外层变量，必须连（与兄弟方法区分开）', () => {
    // 关键区分（我第一版断言写错过，实测纠正）：
    //   · **兄弟**方法（都挂在同一个 class 下）互不共享局部变量 ⇒ 不连
    //   · **嵌套**函数通过闭包捕获外层变量 ⇒ 是同一份数据流，应当连
    //     本例 inner() 被调用时真的会读到已清空的 buf[0] → IndexError，报它是对的
    const outer = [
      'def outer():',
      '    buf = []',
      '    def inner():',
      '        return buf[0]',
      '    return inner',
    ].join('\n');
    assert.equal(n(outer), 1, '闭包捕获外层 buf：outer 清空、inner 读取，属同一数据流，必须报');
    const same = [
      'def f():',
      '    buf = []',
      '    return buf[0]',
    ].join('\n');
    assert.equal(n(same), 1, '同函数内 =[] 后读下标必须报');
  });

  test('[dataflow-py-bodies] ④ 花括号语言不受影响（回归）', () => {
    assert.equal(n('function f() { c.clear(); return c.get(1); }'), 1);
    assert.equal(n('function f() { c.clear(); }\nfunction g() { return c.get(1); }'), 0, '两函数各自成体');
  });
}
