// 空 catch 误报回归：Promise 的 `.catch(...)` 方法调用不是 try/catch 块，不该按「空 catch」报。
//
// 事故（dsh-session-conductor 实测）：12 条 empty-catch 里 6 条是 Promise 链式调用——
//   `await res.json().catch(() => ({}))`（取默认值）、`p.catch(() => {})`（故意静默兜底）。
//   它们既不是错误处理块，也无「静默吞错」语义；旧实现只要 token 里出现 ident `catch`
//   且后面 10 token 内有 `{` 就判空块 ⇒ 成员调用被误报。修法：向前跳过空白/注释，
//   前一 token 是 `.` 即判为成员调用并跳过。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkEmptyCatchAst } from '../lib/ast/control-flow.js';

test('Promise 的 .catch(...) 不算空 catch（两种真实形态）', () => {
  assert.equal(checkEmptyCatchAst('const b = await res.json().catch(() => ({}));').length, 0,
    'Promise 默认值形态不该报');
  assert.equal(checkEmptyCatchAst('await fs.mkdir(p).catch(() => {});').length, 0,
    'Promise 静默兜底形态不该报');
  assert.equal(checkEmptyCatchAst('fs.chmod(f, 0o600).catch(function () {});').length, 0,
    '函数表达式形态也不该报');
});

test('真·空 catch 仍要报（不得因修复而漏报）', () => {
  assert.equal(checkEmptyCatchAst('try { x(); } catch {}').length, 1, 'try/catch 空块仍应报');
  assert.equal(checkEmptyCatchAst('try { x(); } catch (e) {}').length, 1, '带参数的 try/catch 空块仍应报');
});

test('有语句或有注释交代的 catch 不报', () => {
  assert.equal(checkEmptyCatchAst('try { x(); } catch (e) { log(e); }').length, 0, '有语句不报');
  assert.equal(checkEmptyCatchAst('try { x(); } catch { /* 尽力而为 */ }').length, 0, '注释交代了原因不报');
});
