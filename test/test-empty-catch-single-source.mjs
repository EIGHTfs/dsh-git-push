// 空 catch 规则收口回归：同一语义不得由「yml 正则规则」与「内置 AST 检查器」各报一遍。
//
// 事故：robustness/no-empty-catch（yml 正则，kind=regex）与 quality/empty-catch
//   （lib/checks/structural.js 的 checkEmptyCatchAst，kind=empty-catch）重复报同一批位置——
//   实测在 archify（641 文件）上分别报 1902 / 1926 条，(file:line) 交集 1899 条，
//   合计占该仓库总命中 24.6%。按架构（yml 只声明、判定落 lib/ast）保留 AST 版，撤销正则版。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('yml 不再声明 robustness/no-empty-catch（改由 AST 检查器统一报）', () => {
  const yml = read('lib/audit-rules/audit-rules-nodejs.yml');
  // 必须是「注释里保留痕迹、但不再是生效的规则条目」——以 `- id:` 形式出现才算复活
  assert.ok(!/^\s*-\s*id:\s*robustness\/no-empty-catch\s*$/m.test(yml),
    '不得再以生效规则条目声明 robustness/no-empty-catch（会与 AST 版重复报同一批位置）');
  assert.match(yml, /【已撤销】robustness\/no-empty-catch/, '应保留撤销说明与恢复方式（便于回退）');
});

test('AST 版仍生效：structural.js 仍发 quality/empty-catch', () => {
  const src = read('lib/checks/structural.js');
  assert.match(src, /rule:\s*'quality\/empty-catch'/, 'AST 检查器必须继续发 quality/empty-catch');
  assert.match(src, /checkEmptyCatchAst/, '应调用 AST 判定函数 checkEmptyCatchAst');
});
