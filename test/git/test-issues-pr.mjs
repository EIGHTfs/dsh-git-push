// GitHub Issue / PR 域（lib/git/issues.js）
//
// 覆盖两件事：
//   ① 参数校验与动作白名单（离线可测，不发真请求）
//   ② **刻意不提供的动作**必须被明确拒绝（merge / review / 删除）——
//      这是安全边界，不是「还没实现」，所以要有测试钉住
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DSH_GIT_PUSH_OFFLINE = '1';

import { issueAction, pullAction } from '../../lib/git/issues.js';
import { TOOL_REGISTRY } from '../../lib/app/command-registry.js';

test('issue：repo 必须是 owner/repo 形式', async () => {
  const r = await issueAction({ action: 'list', repo: 'bad' });
  assert.equal(r.ok, false);
  assert.match(r.error, /owner\/repo/);
});

test('issue：create 缺 title ⇒ 报错（不发请求）', async () => {
  const r = await issueAction({ action: 'create', repo: 'a/b' });
  assert.equal(r.ok, false);
  assert.match(r.error, /title 必填/);
});

test('issue：comment 缺 body ⇒ 报错', async () => {
  const r = await issueAction({ action: 'comment', repo: 'a/b', number: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /body/);
});

test('issue：未知动作 ⇒ 报错并列出允许值', async () => {
  const r = await issueAction({ action: 'delete', repo: 'a/b' });
  assert.equal(r.ok, false);
  assert.match(r.error, /不支持的 action/);
  assert.match(r.error, /list \/ create \/ comment \/ close/);
});

test('issue：body 超长 ⇒ 报错（不让 GitHub 返回 422 让人猜）', async () => {
  const r = await issueAction({ action: 'create', repo: 'a/b', title: 'x', body: 'a'.repeat(70000) });
  assert.equal(r.ok, false);
  assert.match(r.error, /过长/);
});

test('issue：close 缺 number ⇒ 报错', async () => {
  const r = await issueAction({ action: 'close', repo: 'a/b' });
  assert.equal(r.ok, false);
  assert.match(r.error, /number/);
});

test('pr：create 缺 head ⇒ 报错', async () => {
  const r = await pullAction({ action: 'create', repo: 'a/b', title: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /head 必填/);
});

test('pr：merge 必须被拒绝（不可逆远端状态，刻意不提供）', async () => {
  const r = await pullAction({ action: 'merge', repo: 'a/b', number: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /不支持的 action/);
  assert.match(r.error, /list \/ create \/ comment \/ files \/ commits/);
});

test('pr：review 必须被拒绝（代行审批，刻意不提供）', async () => {
  const r = await pullAction({ action: 'review', repo: 'a/b', number: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /不支持的 action/);
});

test('pr：files / commits 缺 number ⇒ 报错', async () => {
  for (const action of ['files', 'commits']) {
    const r = await pullAction({ action, repo: 'a/b' });
    assert.equal(r.ok, false);
    assert.match(r.error, /number/);
  }
});

test('工具注册：github_issue / github_pr 的动作白名单与实现一致', () => {
  const issue = TOOL_REGISTRY.find((t) => t.name === 'github_issue');
  const pr = TOOL_REGISTRY.find((t) => t.name === 'github_pr');
  assert.ok(issue, 'github_issue 必须已注册');
  assert.ok(pr, 'github_pr 必须已注册');
  const issueActionParam = issue.params.find((p) => p.flag === 'action');
  const prActionParam = pr.params.find((p) => p.flag === 'action');
  assert.deepEqual(issueActionParam.enum, ['list', 'create', 'comment', 'close']);
  assert.deepEqual(prActionParam.enum, ['list', 'create', 'comment', 'files', 'commits']);
  // 安全边界：enum 里绝不能出现 merge / review
  assert.ok(!issueActionParam.enum.includes('merge'), 'issue 不应有 merge');
  assert.ok(!prActionParam.enum.includes('merge'), 'pr 刻意不提供 merge');
  assert.ok(!prActionParam.enum.includes('review'), 'pr 刻意不提供 review');
});

// ── dryRun：写操作默认只预览，一行都不碰远端 ──
// 教训：没有它的时候，验证接口能否使用只能在真仓库上真建真改 —— 在别人的仓库里留下的测试
//   issue 只能事后手工关闭。下面几条钉住「预览给出 method/path/body 且不发请求」。

test('issue create 的 dryRun 预览：给出 POST 端点与 body', async () => {
  const r = await issueAction({ action: 'create', repo: 'owner/repo', title: 't', body: 'b', dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.equal(r.would.method, 'POST');
  assert.equal(r.would.path, '/repos/owner/repo/issues');
  assert.deepEqual(r.would.body, { title: 't', body: 'b' });
});

test('issue comment / close 的 dryRun 预览：端点与状态正确', async () => {
  const c = await issueAction({ action: 'comment', repo: 'owner/repo', number: 7, body: 'hi', dryRun: true });
  assert.equal(c.would.path, '/repos/owner/repo/issues/7/comments');
  assert.deepEqual(c.would.body, { body: 'hi' });

  const closed = await issueAction({ action: 'close', repo: 'owner/repo', number: 7, dryRun: true });
  assert.equal(closed.would.method, 'PATCH');
  assert.deepEqual(closed.would.body, { state: 'closed' });
});

test('dryRun 预览不发请求（离线环境下同样成功）', async () => {
  // DSH_GIT_PUSH_OFFLINE=1 时任何真实请求都会带回 offline 错误；
  //   dryRun 若走到了网络层就会有 error，这里断言它压根没发请求。
  const r = await issueAction({ action: 'create', repo: 'owner/repo', title: 't', body: 'b', dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.error, undefined);
});

test('comment 缺 number 时 dryRun 也如实报错', async () => {
  const r = await issueAction({ action: 'comment', repo: 'owner/repo', body: 'hi', dryRun: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /number/);
});

test('github_issue 的 dryRun 参数默认 true（写操作默认预览）', async () => {
  const entry = TOOL_REGISTRY.find((one) => one.name === 'github_issue');
  const dryRunParam = entry?.params?.find((one) => one.flag === 'dryRun');
  assert.ok(dryRunParam, 'github_issue 应有 dryRun 参数');
  assert.equal(dryRunParam.default, true, 'dryRun 必须默认开启，避免误改真仓库');
});
