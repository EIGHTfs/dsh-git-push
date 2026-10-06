// 推送「假成功」防线回归：远端 sha 与本地不一致（或远端为空仓）时，必须返回 ok:false。
//
// 事故（用户实测）：远端仓库为空（API 409 Conflict）时，git_commit_push 仍回
//   「commit+push done」，用户去查远端才发现仓库是空的——成功判定只看「推送动作有没有报错」，
//   没看「远端到底有没有这个提交」。
// 修法：enhanceAfterPushSuccess 里用 API 查远端 branch 的真实 sha，写入 push.verified；
//   commitAndPush 在 verified===false 时返回 ok:false 并带上远端实际状态。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'lib/git/push.js'), 'utf8');

test('推送后做远端 sha 硬校验（verified 三态：true/false/null）', () => {
  assert.match(src, /pushSlot\.verified\s*=/, '必须把校验结果写进 push.verified');
  assert.match(src, /\/repos\/\$\{pr\.owner\}\/\$\{pr\.repo\}\/branches\//, '必须查远端 branch 的真实 sha');
  assert.match(src, /推送未落地/, '校验失败时要有明确文案（远端可能为空仓库）');
});

test('verified===false 必须返回 ok:false（不得谎报成功）', () => {
  assert.match(src, /enhanced\.push\?\.verified\s*===\s*false/, '成功返回前必须判 verified===false');
  assert.match(src, /ok:\s*false,\s*steps,\s*commitSha,\s*pushed:\s*false/, 'verified===false 分支必须返回 ok:false');
});

test('githubFetch 必须被导入（否则校验分支运行时 ReferenceError）', () => {
  assert.match(src, /import \{[^}]*githubFetch[^}]*\} from '\.\/api\.js'/, 'push.js 必须导入 githubFetch');
});
