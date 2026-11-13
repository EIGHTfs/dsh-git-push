/**
 * test-empty-catch.mjs —— 同族测试合并（test-empty-catch-promise.mjs · test-empty-catch-single-source.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { checkEmptyCatchAst } from '../../lib/ast/control-flow.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// ── 原 test-empty-catch-promise.mjs ──
{
  // 空 catch 误报回归：Promise 的 `.catch(...)` 方法调用不是 try/catch 块，不该按「空 catch」报。
  //
  // 事故（dsh-session-conductor 实测）：12 条 empty-catch 里 6 条是 Promise 链式调用——
  //   `await res.json().catch(() => ({}))`（取默认值）、`p.catch(() => {})`（故意静默兜底）。
  //   它们既不是错误处理块，也无「静默吞错」语义；旧实现只要 token 里出现 ident `catch`
  //   且后面 10 token 内有 `{` 就判空块 ⇒ 成员调用被误报。修法：向前跳过空白/注释，
  //   前一 token 是 `.` 即判为成员调用并跳过。


  test('[empty-catch-promise] Promise 的 .catch(...) 不算空 catch（两种真实形态）', () => {
    assert.equal(checkEmptyCatchAst('const b = await res.json().catch(() => ({}));').length, 0,
      'Promise 默认值形态不该报');
    assert.equal(checkEmptyCatchAst('await fs.mkdir(p).catch(() => {});').length, 0,
      'Promise 静默兜底形态不该报');
    assert.equal(checkEmptyCatchAst('fs.chmod(f, 0o600).catch(function () {});').length, 0,
      '函数表达式形态也不该报');
  });

  test('[empty-catch-promise] 真·空 catch 仍要报（不得因修复而漏报）', () => {
    assert.equal(checkEmptyCatchAst('try { x(); } catch {}').length, 1, 'try/catch 空块仍应报');
    assert.equal(checkEmptyCatchAst('try { x(); } catch (e) {}').length, 1, '带参数的 try/catch 空块仍应报');
  });

  test('[empty-catch-promise] 有语句或有注释交代的 catch 不报', () => {
    assert.equal(checkEmptyCatchAst('try { x(); } catch (e) { log(e); }').length, 0, '有语句不报');
    assert.equal(checkEmptyCatchAst('try { x(); } catch { /* 尽力而为 */ }').length, 0, '注释交代了原因不报');
  });

  test('[empty-catch-promise] 短 CJK 注释算交代（汉字信息量折算），但单字符占位仍要报', () => {
    // 实测误报：项目里写 `catch { /* 尽力 */ }`（2 个汉字），按「≥4 字符」的 ASCII 门槛被判「没交代」
    assert.equal(checkEmptyCatchAst('try { x(); } catch { /* 尽力 */ }').length, 0, '2 个汉字的注释应算交代');
    assert.equal(checkEmptyCatchAst('try { x(); } catch { /* 忽略 */ }').length, 0, '词表命中同样算交代');
    // 防过度豁免：单字符占位不是交代
    assert.equal(checkEmptyCatchAst('try { x(); } catch { // e\n}').length, 1, '`// e` 这类占位仍应报');
    assert.equal(checkEmptyCatchAst('try { x(); } catch { /* x */ }').length, 1, '单字母注释仍应报');
  });
}

// ── 原 test-empty-catch-single-source.mjs ──
{
  // 空 catch 规则收口回归：同一语义不得由「yml 正则规则」与「内置 AST 检查器」各报一遍。
  //
  // 事故：robustness/no-empty-catch（yml 正则，kind=regex）与 quality/empty-catch
  //   （lib/checks/structural.js 的 checkEmptyCatchAst，kind=empty-catch）重复报同一批位置——
  //   实测在 archify（641 文件）上分别报 1902 / 1926 条，(file:line) 交集 1899 条，
  //   合计占该仓库总命中 24.6%。按架构（yml 只声明、判定落 lib/ast）保留 AST 版，撤销正则版。

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');

  test('[empty-catch-single-source] yml 不再声明 robustness/no-empty-catch（改由 AST 检查器统一报）', () => {
    const yml = read('lib/audit-rules/audit-rules-nodejs.yml');
    // 必须是「注释里保留痕迹、但不再是生效的规则条目」——以 `- id:` 形式出现才算复活
    assert.ok(!/^\s*-\s*id:\s*robustness\/no-empty-catch\s*$/m.test(yml),
      '不得再以生效规则条目声明 robustness/no-empty-catch（会与 AST 版重复报同一批位置）');
    assert.match(yml, /【已撤销】robustness\/no-empty-catch/, '应保留撤销说明与恢复方式（便于回退）');
  });

  test('[empty-catch-single-source] AST 版仍生效：structural.js 仍发 quality/empty-catch', () => {
    const src = read('lib/checks/structural.js');
    assert.match(src, /rule:\s*'quality\/empty-catch'/, 'AST 检查器必须继续发 quality/empty-catch');
    assert.match(src, /checkEmptyCatchAst/, '应调用 AST 判定函数 checkEmptyCatchAst');
  });
}
