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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkClearAccessAst } from '../../lib/ast/dataflow.js';

const n = (src) => checkClearAccessAst(src).length;

test('① 跨方法不连：A 方法 clear、B 方法读取，不得报', () => {
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

test('② 同方法内仍必须连（收紧要刚好，不能一并压制）', () => {
  const py = [
    'class S:',
    '    def refresh(self):',
    '        self._cache.clear()',
    '        item = self._cache.get(1)',
    '        return item',
  ].join('\n');
  assert.equal(n(py), 1, '同一个方法体内 clear 后 get 必须报');
});

test('③ 嵌套函数是**闭包**：共享外层变量，必须连（与兄弟方法区分开）', () => {
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

test('④ 花括号语言不受影响（回归）', () => {
  assert.equal(n('function f() { c.clear(); return c.get(1); }'), 1);
  assert.equal(n('function f() { c.clear(); }\nfunction g() { return c.get(1); }'), 0, '两函数各自成体');
});
