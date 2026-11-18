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
