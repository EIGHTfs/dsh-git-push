// 克隆体积上限「两入口一致」回归：工具路径与 HTTP 路径必须共用同一个默认值。
//
// 事故：工具路径把未设值交给 previewClone（落到 50），HTTP 路径自己回落 10
//   → 同一仓库两个入口克隆结果不同：实测同一仓库工具预览 753 文件 / HTTP 预览 707 文件，
//   44 个 >10MB 的文件在 HTTP 路径被静默跳过，用户以为克隆完成（实际缺 46 个文件）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveMaxCloneFileMB } from '../lib/git/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('resolveMaxCloneFileMB：未设/非法回落 schema 默认 10，显式值照用（0 = 不限制）', () => {
  assert.equal(resolveMaxCloneFileMB({}), 10, '未设应回落 schema 默认 10');
  assert.equal(resolveMaxCloneFileMB({ maxCloneFileMB: 50 }), 50, '显式值照用');
  assert.equal(resolveMaxCloneFileMB({ maxCloneFileMB: 0 }), 0, '0 = 不限制，不能被当成未设');
  assert.equal(resolveMaxCloneFileMB({ maxCloneFileMB: 'x' }), 10, '非法值回落默认');
});

test('结构契约：工具路径与 HTTP 路径都经统一解析，不得各自写默认值', () => {
  const cases = [
    ['lib/app/tool-call.js', readFileSync(join(ROOT, 'lib/app/tool-call.js'), 'utf8')],
    ['lib/app/handlers/clone.js', readFileSync(join(ROOT, 'lib/app/handlers/clone.js'), 'utf8')],
  ];
  for (const [name, src] of cases) {
    assert.match(src, /resolveMaxCloneFileMB\(/, `${name} 必须走统一解析 resolveMaxCloneFileMB`);
    assert.ok(!/Number\.isFinite\(cfg\.maxCloneFileMB\)\s*\?\s*cfg\.maxCloneFileMB\s*:\s*10/.test(src),
      `${name} 不得自带默认值 10（会与工具路径不一致）`);
    assert.ok(!/maxCloneFileMB\)\s*\|\|\s*undefined/.test(src),
      `${name} 不得把「未设 / 0=不限制」混成 undefined`);
  }
});
