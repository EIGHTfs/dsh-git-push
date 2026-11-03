/**
 * npm 撤包（npm_unpublish）预检测试。
 *
 * 为什么预检必须做对：撤包**不可逆**——同版本号撤了也永久作废，撤掉 latest 会让人 `npm i` 拿到空。
 *   所以默认 dryRun，且预检要如实回答：版本是否存在、是否被 dist-tag 指向、发布距今多久（72h 政策窗口）、
 *   是否该包唯一版本（撤光会冷却 24h）。
 *   本测试注入假的 registry 响应，不联网。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTarget, preflightUnpublish } from '../lib/npm/unpublish.js';

/** 造一个 registry packument 响应。 */
function fakeFetch(doc) {
  return async () => ({ status: 200, json: async () => doc });
}

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 3600 * 1000).toISOString();

function doc({ versions = ['1.0.0'], tags = { latest: '1.0.0' }, ageHours = 10 } = {}) {
  const time = {};
  for (const v of versions) time[v] = hoursAgo(ageHours);
  return {
    name: 'demo',
    'dist-tags': tags,
    versions: Object.fromEntries(versions.map((v) => [v, { name: 'demo', version: v }])),
    time,
  };
}

test('parseTarget：缺版本 / 版本非法 / 缺包名', () => {
  assert.equal(parseTarget({ name: 'a' }).ok, false);
  assert.match(parseTarget({ name: 'a' }).error, /wholePackage/);
  assert.equal(parseTarget({ name: 'a', version: 'not-a-version' }).ok, false);
  assert.equal(parseTarget({ name: '', version: '1.0.0' }).ok, false);
  assert.equal(parseTarget({ name: 'a', wholePackage: true }).ok, true);
});

test('预检：72h 窗口内 → withinWindow 且提示可撤', async () => {
  const r = await preflightUnpublish({ name: 'demo', version: '1.0.0', fetchImpl: fakeFetch(doc({ ageHours: 10 })) });
  assert.equal(r.ok, true);
  assert.equal(r.withinWindow, true);
  assert.match(r.policyHint, /窗口内/);
  assert.match(r.irreversible, /永久不能/);
});

test('预检：超出 72h → 提示只能 deprecate 或需三条件', async () => {
  const r = await preflightUnpublish({ name: 'demo', version: '1.0.0', fetchImpl: fakeFetch(doc({ ageHours: 100 })) });
  assert.equal(r.withinWindow, false);
  assert.match(r.policyHint, /deprecate/);
});

test('预检：dist-tag 指向该版本 → 警告（撤掉会悬空）', async () => {
  const r = await preflightUnpublish({
    name: 'demo', version: '1.0.0',
    fetchImpl: fakeFetch(doc({ versions: ['1.0.0', '1.0.1'], tags: { latest: '1.0.0' } })),
  });
  assert.deepEqual(r.tagsPointingHere, ['latest']);
  assert.match(r.warnings.join('\n'), /dist-tag latest/);
});

test('预检：唯一版本 → 提示包名冷却 24h', async () => {
  const r = await preflightUnpublish({ name: 'demo', version: '1.0.0', fetchImpl: fakeFetch(doc({ versions: ['1.0.0'] })) });
  assert.match(r.warnings.join('\n'), /冷却 24 小时/);
});

test('预检：版本不存在 → 报错并列出已有版本', async () => {
  const r = await preflightUnpublish({ name: 'demo', version: '9.9.9', fetchImpl: fakeFetch(doc({ versions: ['1.0.0', '1.0.1'] })) });
  assert.equal(r.ok, false);
  assert.match(r.error, /版本不存在/);
  assert.match(r.error, /1\.0\.0/);
});

test('预检：包不存在（404）→ 明确报错', async () => {
  const r = await preflightUnpublish({ name: 'nope', version: '1.0.0', fetchImpl: async () => ({ status: 404, json: async () => ({}) }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /不存在该包/);
});
