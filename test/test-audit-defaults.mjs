// 审计默认值单一来源回归：同一默认阈值不得在检查层与规则编译层各写一份。
//
// 事故背景：FUNC_LINES_DEFAULT = 50 曾在 lib/checks/structural.js 与 lib/rule/compilers/func.js
//   各写一份（自审 maintainability/duplicate-constant-def 报的真重复）——两处必须永远相等，
//   漏改一处就会出现「编译器按 50 收口、检查器按别的值判定」这类静默不一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FUNC_LINES_DEFAULT, HEALTH_BASE_SCORE, HEALTH_MIN_SCORE, HEALTH_WARN_SCORE, HEALTH_BLOCK_SCORE } from '../lib/audit-defaults.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('审计默认值是单一来源：两处都 import，不再各自定义', () => {
  assert.equal(FUNC_LINES_DEFAULT, 50, '默认值本身应为 50');
  const checker = read('lib/checks/structural.js');
  const compiler = read('lib/rule/compilers/func.js');
  assert.match(checker, /import \{[^}]*FUNC_LINES_DEFAULT[^}]*\} from '\.\.\/audit-defaults\.js'/, '检查层应从公共模块导入');
  assert.match(compiler, /import \{[^}]*FUNC_LINES_DEFAULT[^}]*\} from '\.\.\/\.\.\/audit-defaults\.js'/, '编译层应从公共模块导入');
  assert.ok(!/^const FUNC_LINES_DEFAULT = 50/m.test(checker), '检查层不得再本地定义');
  assert.ok(!/^const FUNC_LINES_DEFAULT = 50/m.test(compiler), '编译层不得再本地定义');
});

test('健康度分档常量已收口到公共模块（供后续接入 file-health 两处）', () => {
  assert.deepEqual(
    [HEALTH_BASE_SCORE, HEALTH_MIN_SCORE, HEALTH_WARN_SCORE, HEALTH_BLOCK_SCORE],
    [10, 0.1, 9, 5],
    '分档默认值应与既有实现一致（10 / 0.1 / 9 / 5）',
  );
});
