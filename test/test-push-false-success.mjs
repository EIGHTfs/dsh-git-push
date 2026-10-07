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
const toolSrc = readFileSync(join(ROOT, 'lib/app/tool-call.js'), 'utf8');

// 后台 job 状态映射（可单测的纯函数，见 tool-call.js）
const { cloneJobOutcome, pushJobOutcome } = await import('../lib/app/tool-call.js');

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

// ---------- 后台 job 状态：不许无条件报「完成」----------
// 事故：job spec 原先无论结果如何都返回 completed/detail:'commit+push done'，于是推送失败、
//   被推送门禁拦截、远端 sha 与本地不一致、甚至「无变更」全被显示成「commit+push done」——
//   push.js 里的 verified 防线被 job 状态盖住，AI/用户据此以为推成功了。
test('后台 job 状态：失败/未推送/核验不一致都不许报「完成」', () => {
  // 真失败
  assert.equal(pushJobOutcome({ ok: false, error: '推送失败（ssh）：远端拒绝' }).status, 'failed');
  assert.equal(pushJobOutcome({ ok: false, blocked: true, error: '推送门禁已开启' }).status, 'failed');
  // 假成功：推送动作没报错，但远端 sha 与本地不一致
  assert.equal(pushJobOutcome({ ok: true, pushed: true, commitSha: 'abcdef12', push: { verified: false, remoteSha: 'deadbeef' } }).status, 'failed');
  // 正常推送（已核验）
  const ok = pushJobOutcome({ ok: true, pushed: true, commitSha: 'abcdef12', push: { verified: true } });
  assert.equal(ok.status, 'completed');
  assert.match(ok.detail, /核验一致/);
  // 核验未完成（网络/权限）：可以算完成，但必须说清「未核验」
  const unverified = pushJobOutcome({ ok: true, pushed: true, push: { verified: null, verifyError: 'API 超时' } });
  assert.equal(unverified.status, 'completed');
  assert.match(unverified.detail, /核验未完成/);
  // 无变更：如实说无变更，不谎称推送成功
  assert.match(pushJobOutcome({ ok: true, committed: false, message: '无变更，跳过提交', push: { pushed: false, reason: '无变更' } }).detail, /无变更/);
  // 已提交但未推送：必须写明「未推送」及原因
  const notPushed = pushJobOutcome({ ok: true, committed: true, pushed: false, push: { pushed: false, reason: '远端已是最新' } });
  assert.match(notPushed.detail, /未推送/);
});

test('后台 job 状态：不再有硬编码的成功文案（commit+push done / clone done）', () => {
  // 只看**代码行**：注释里保留旧写法作为事故说明是允许的（JSDoc/行注释行排除）
  const codeLines = toolSrc.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
  assert.ok(!codeLines.some((l) => /detail: 'commit\+push done'/.test(l)), 'job 不许硬编码成功文案');
  assert.ok(!codeLines.some((l) => /detail: 'clone done'/.test(l)), 'clone job 同样不许硬编码');
  assert.match(toolSrc, /pushJobOutcome\(r\)/, 'commit+push job 必须走如实映射');
  assert.match(toolSrc, /cloneJobOutcome\(r\)/, 'clone job 必须走如实映射');
  assert.equal(cloneJobOutcome({ ok: false, error: '网络失败' }).status, 'failed');
  assert.equal(cloneJobOutcome({ ok: true }).status, 'completed');
});
