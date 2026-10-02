// 可见性解析「统一收口」回归（设计：同一职责只留一个入口，不重复实现）。
//
// 背景：远端可见性判定有两个消费方——
//   本用例即锁「同一职责单一入口」。
//   ① `lib/git/push.js`    —— 私有库敏感文件豁免（private → 只扫描报告、不写 .gitignore）
//   ② `lib/commit-push.js` —— 审计门禁豁免（private → 审计只报告不拦截）
// 此前两处各自 `resolveToken` + `detectRepoVisibility`（复制实现，口径可漂移：token 来源、
// 探测失败兜底可能不一致）；现统一走 `lib/git/visibility.js#resolveRepoVisibility`。
// 本测试锁两件事：兜底口径（unknown + 原因）+ 结构契约（消费方不得绕过收口）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRepoVisibility } from '../lib/git/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('resolveRepoVisibility：非 git 目录 → unknown（不抛，且带原因）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-vis-'));
  try {
    const vis = await resolveRepoVisibility(dir);
    assert.equal(vis.visibility, 'unknown', '非 git / 非 GitHub origin 必须 unknown（保守口径）');
    assert.ok(typeof vis.reason === 'string' && vis.reason.length > 0, 'unknown 应带 reason 说明');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('统一收口契约：push.js 与审计门禁都经 resolveRepoVisibility，不得各自探测', () => {
  const cases = [
    ['lib/git/push.js', readFileSync(join(ROOT, 'lib', 'git', 'push.js'), 'utf8')],
    ['lib/commit-push.js', readFileSync(join(ROOT, 'lib', 'commit-push.js'), 'utf8')],
  ];
  for (const [name, src] of cases) {
    assert.match(src, /resolveRepoVisibility/, `${name} 必须走统一收口 resolveRepoVisibility`);
    assert.ok(
      !/import\s*\{[^}]*\bdetectRepoVisibility\b[^}]*\}\s*from/.test(src),
      `${name} 不得直接 import detectRepoVisibility（应经收口，避免两处口径漂移）`,
    );
  }
});
