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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkClearAccessAst } from '../lib/ast/dataflow.js';

const n = (src) => checkClearAccessAst(src).length;

test('A. .empty() 是查询不是清空 —— 之后的读取不报', () => {
  const py = [
    'def f(q):',
    '    while not q.empty():',
    '        task = q.get(timeout=0.05)',
  ].join('\n');
  assert.equal(n(py), 0, 'q.empty() 返回 bool，不是清空动作');
  // JS 侧同理：arr.empty()（某些库的谓词）不该当清空
  assert.equal(n('function f(a) { if (a.empty()) { return a.get(0); } }'), 0);
});

test('B. 写目标不是读访问 —— obj[k] = v 不报', () => {
  const py = [
    'def f(s):',
    '    s.clear()',
    '    s[mid] = 1',
  ].join('\n');
  assert.equal(n(py), 0, 's[mid] = 1 是写入下标，不是"清空后读取已清空容器"');
  assert.equal(n('function f(m) { m.clear(); m[key] = 1; }'), 0);
});

test('C. 类型注解位不参与 —— PEP526 注解与返回注解都不报', () => {
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

test('D. 多目标解包不透支 —— a, b = [], {} 不把 [] 算给 b', () => {
  const py = [
    'def f(ev):',
    '    result, last = [], {}',
    '    for e in ev:',
    '        p = last.get(e)',
  ].join('\n');
  assert.equal(n(py), 0, 'last 拿到的是 {}（非空字面量），不是 []');
});

test('正样本保住：真清空后无写回就读取，仍必须报', () => {
  assert.equal(n('def f(c):\n    c.clear()\n    return c.get(1)'), 1, 'clear() 后 get() 必须报');
  assert.equal(n('function f(c) { c.clear(); return c.get(1); }'), 1, 'JS：clear() 后 get() 必须报');
  assert.equal(n('def f(c):\n    c = []\n    return c[0]'), 1, '=[] 后读下标必须报');
  assert.equal(n('def f(c):\n    c = {}\n    c.clear()\n    return c[k]'), 1, 'clear() 后读下标必须报');
});

test('正样本：写回撤销后不报（既有能力不许回退）', () => {
  assert.equal(n('function f(c) { c.clear(); c.set("a",1); return c.get("a"); }'), 0);
  assert.equal(n('function f(c) { c.clear(); c.push(1); return c.get(0); }'), 0);
});

test('A2. .reset() 是「恢复默认值」不是清空 —— 之后的读取不报（2026-11-06 实测追加）', () => {
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

