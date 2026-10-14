/**
 * 提交信息组装测试（message 参数改为「可传数组」）。
 *
 * 覆盖：三种入参形态（字符串 / 数组混用 / 显式 subject）、可空字段缺省行为、
 *       无效条目的处理（不臆造内容）、以及**向后兼容**（字符串原样透传逐字节不变）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildCommitMessage, titleOf, COMMIT_TYPES, describeMessageForms } from '../lib/git/commit-message.js';

test('形态①：字符串原样透传（向后兼容，逐字节不变）', () => {
  const raw = 'fix(push): 推送失败不再断言「仓库不存在」\n\n为什么改：GitHub 返回同一句\n验证：505 例 0 失败';
  const r = buildCommitMessage(raw);
  assert.equal(r.ok, true);
  assert.equal(r.message, raw, '字符串必须一个字符都不改');
  assert.equal(r.subject, 'fix(push): 推送失败不再断言「仓库不存在」');
});

test('形态①：空字符串/纯空白 ⇒ 明确报「必填」，不是静默通过', () => {
  for (const bad of ['', '   ', '\n\t ']) {
    const r = buildCommitMessage(bad);
    assert.equal(r.ok, false);
    assert.match(r.error, /必填/);
  }
});

test('形态②：字符串数组 ⇒ 首条当标题，其余成正文要点', () => {
  const r = buildCommitMessage(['fix p0 崩溃', '补一个回归测试']);
  assert.equal(r.ok, true);
  assert.equal(r.subject, 'fix p0 崩溃');
  assert.equal(r.message, 'fix p0 崩溃\n\n- 补一个回归测试');
});

test('形态②：对象条目 ⇒ 组装 type(scope): what + 为什么改段 + 验证段 + 脚注', () => {
  const r = buildCommitMessage([{
    type: 'fix', scope: 'push',
    what: '推送失败不再断言「仓库不存在」',
    why: 'GitHub 对「不存在」与「无权限」返回同一句',
    verify: '全量测试 505 例 0 失败',
    refs: 'Closes #45',
  }]);
  assert.equal(r.ok, true);
  assert.equal(r.subject, 'fix(push): 推送失败不再断言「仓库不存在」');
  assert.match(r.message, /^fix\(push\): 推送失败不再断言「仓库不存在」\n\n为什么改：\n- GitHub 对「不存在」与「无权限」返回同一句\n\n验证：\n- 全量测试 505 例 0 失败\n\nCloses #45$/);
});

test('形态②：混用（对象 + 字符串）⇒ 首条为标题，字符串条目进要点', () => {
  const r = buildCommitMessage([
    { type: 'feat', scope: 'npm', what: '新增发包回执分类', why: '403 与 401 要分开提示' },
    '文档补一节参数说明',
    { what: '注入文案同步', verify: '门禁四项绿' },
  ]);
  assert.equal(r.subject, 'feat(npm): 新增发包回执分类');
  assert.match(r.message, /- 文档补一节参数说明/);
  assert.match(r.message, /- 注入文案同步/);
  assert.match(r.message, /为什么改：\n- 403 与 401 要分开提示/);
  assert.match(r.message, /验证：\n- 门禁四项绿/);
});

test('形态③：显式 subject ⇒ 标题用它，**所有** items 都进要点', () => {
  const r = buildCommitMessage({ subject: 'chore(2.8.3): 收口几处小修', items: ['改 A', { what: '改 B', why: '因为 C' }] });
  assert.equal(r.subject, 'chore(2.8.3): 收口几处小修');
  assert.match(r.message, /- 改 A\n- 改 B/);
  assert.match(r.message, /为什么改：\n- 因为 C/);
});

test('可空字段：只给 what 也能成文（不写前缀、不加空段）', () => {
  const r = buildCommitMessage([{ what: '把日志里的错别字改掉' }]);
  assert.equal(r.ok, true);
  assert.equal(r.message, '把日志里的错别字改掉', '无 type/why/verify/refs 时不应出现多余段落');
});

test('无效条目：缺 what 的对象被忽略；全无效 ⇒ 报必填（不臆造内容）', () => {
  const r1 = buildCommitMessage([{ type: 'fix', why: '只有 why 没有 what' }, '有效的一条']);
  assert.equal(r1.ok, true);
  assert.equal(r1.itemCount, 1, '缺 what 的条目必须被忽略');
  assert.equal(r1.subject, '有效的一条');
  for (const bad of [[], [{}], [{ type: 'fix' }], { items: [] }, null, 42, undefined]) {
    const r = buildCommitMessage(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} 应报错`);
    assert.match(r.error, /必填/);
  }
});

test('容错：单条目对象可直接传；title/desc 作为 what 别名', () => {
  const a = buildCommitMessage({ type: 'docs', what: '直接传条目对象' });
  assert.equal(a.ok, true);
  assert.equal(a.subject, 'docs: 直接传条目对象');
  const b = buildCommitMessage([{ title: '用 title 当 what' }]);
  assert.equal(b.message, '用 title 当 what');
  const c = buildCommitMessage([{ desc: '用 desc 当 what' }]);
  assert.equal(c.message, '用 desc 当 what');
});

test('多条 why/verify 去重聚合，保留首次出现顺序', () => {
  const r = buildCommitMessage([
    { what: '甲', why: '同一原因', verify: '跑 A' },
    { what: '乙', why: '同一原因', verify: '跑 B' },
  ]);
  assert.equal((r.message.match(/同一原因/g) || []).length, 1, 'why 应去重');
  assert.match(r.message, /验证：\n- 跑 A\n- 跑 B/);
});

test('titleOf：未知 type 也原样带前缀（不吞、不改写），无 type 只给 what', () => {
  assert.equal(titleOf({ type: 'fix', scope: 'x', what: 'w' }), 'fix(x): w');
  assert.equal(titleOf({ type: 'team-custom', what: 'w' }), 'team-custom: w');
  assert.equal(titleOf({ what: 'w' }), 'w');
  assert.ok(COMMIT_TYPES.includes('fix') && COMMIT_TYPES.includes('feat'), 'type 白名单应含 fix/feat');
});

test('describeMessageForms：说明三种形态与可空字段', () => {
  const d = describeMessageForms();
  assert.match(d, /字符串/);
  assert.match(d, /数组/);
  assert.match(d, /subject/);
  assert.match(d, /what 必填/);
});
