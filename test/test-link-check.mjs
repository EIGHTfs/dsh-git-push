/**
 * 链接判断测试（0.2.0）：分级扣分 / flaky 打折 / 断网不 blocker / 100 链接 ≤30 秒。
 * 全部用注入 fetcher（fake server 语义），不发真实网络请求。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LINK_SEVERITY_SCORE, FLAKY_HOSTS, DEAD_STATUSES, TRANSIENT_STATUSES,
  isFlakyHost, extractLinks, gradeResult, probeLink, probeLinks, checkLinks, sumLinkPenalty,
} from '../lib/link-check/index.js';

/** fake fetcher：按 URL → 响应/错误映射。 */
function fakeFetch(map = {}) {
  return async (url) => {
    const hit = map[url];
    if (!hit) return { status: 200 };
    if (hit.throw) throw new Error(hit.throw);
    return { status: hit.status };
  };
}

// ---------- 分级扣分 ----------
test('分级：404 → 大扣分（dead, -3）', () => {
  const r = gradeResult('https://example.com/x', { status: 404 });
  assert.equal(r.level, 'dead');
  assert.equal(r.score, LINK_SEVERITY_SCORE.dead);
});

test('分级：403 → 大扣分（dead）', () => {
  const r = gradeResult('https://example.com/x', { status: 403 });
  assert.equal(r.level, 'dead');
  assert.equal(r.score, -3);
});

test('分级：DNS 失败 → 中扣分（-2）', () => {
  const r = gradeResult('https://example.com/x', { error: 'dns' });
  assert.equal(r.level, 'dns');
  assert.equal(r.score, -2);
});

test('分级：超时/连接失败 → 小扣分（-1）', () => {
  assert.equal(gradeResult('https://example.com/x', { error: 'timeout' }).score, -1);
  assert.equal(gradeResult('https://example.com/x', { error: 'conn' }).score, -1);
});

test('分级：5xx → 小扣分（-1）', () => {
  assert.equal(gradeResult('https://example.com/x', { status: 503 }).level, 'transient');
  assert.equal(gradeResult('https://example.com/x', { status: 503 }).score, -1);
});

test('分级：2xx/3xx → 不扣分', () => {
  assert.equal(gradeResult('https://example.com/x', { status: 200 }).score, 0);
  assert.equal(gradeResult('https://example.com/x', { status: 301 }).score, 0);
});

// ---------- flaky 打折 ----------
test('flaky：github/npmjs 系识别（含子域/www）', () => {
  assert.equal(isFlakyHost('github.com'), true);
  assert.equal(isFlakyHost('api.github.com'), true);
  assert.equal(isFlakyHost('raw.githubusercontent.com'), true);
  assert.equal(isFlakyHost('registry.npmjs.org'), true);
  assert.equal(isFlakyHost('www.github.com'), true);
  assert.equal(isFlakyHost('example.com'), false);
});

test('flaky：网络错误扣分 ×0.2（DNS -2 → -0.4）', () => {
  const r = gradeResult('https://api.github.com/repos/x/y', { error: 'dns' });
  assert.equal(r.flaky, true);
  assert.equal(r.score, -0.4);
});

test('flaky：超时 -1 → -0.2', () => {
  const r = gradeResult('https://raw.githubusercontent.com/a/b', { error: 'timeout' });
  assert.equal(r.score, -0.2);
});

test('flaky：非 flaky 域名不打折（-2 保持）', () => {
  const r = gradeResult('https://example.com/x', { error: 'dns' });
  assert.equal(r.flaky, false);
  assert.equal(r.score, -2);
});

// ---------- 链接提取 ----------
test('提取：去重 + 去尾部标点 + 跳过占位符', () => {
  const links = extractLinks([
    '见 https://a.com/x 和 https://a.com/x 。',
    '模板 https://${HOST}/y 跳过',
    '行三 https://b.com/z).',
  ].join('\n'));
  const urls = links.map((l) => l.url);
  assert.deepEqual(urls, ['https://a.com/x', 'https://b.com/z']);
  assert.equal(links[0].line, 1);
  assert.equal(links[1].line, 3);
});

// ---------- probeLink（注入 fetcher） ----------
test('probeLink：2xx 正常', async () => {
  const r = await probeLink('https://ok.com', { fetcher: fakeFetch({ 'https://ok.com': { status: 200 } }) });
  assert.equal(r.level, 'ok');
});

test('probeLink：超时异常识别', async () => {
  const r = await probeLink('https://slow.com', { fetcher: fakeFetch({ 'https://slow.com': { throw: 'The operation timed out' } }) });
  assert.equal(r.error, 'timeout');
  assert.equal(r.level, 'transient');
});

test('probeLink：DNS 异常识别', async () => {
  const r = await probeLink('https://gone.com', { fetcher: fakeFetch({ 'https://gone.com': { throw: 'getaddrinfo ENOTFOUND gone.com' } }) });
  assert.equal(r.error, 'dns');
});

test('probeLinks：并发探测保持顺序', async () => {
  const links = [{ url: 'https://a.com', line: 1 }, { url: 'https://b.com', line: 2 }, { url: 'https://c.com', line: 3 }];
  const fetcher = fakeFetch({ 'https://a.com': { status: 404 }, 'https://b.com': { status: 200 }, 'https://c.com': { status: 403 } });
  const res = await probeLinks(links, { concurrency: 2, fetcher });
  assert.deepEqual(res.map((r) => r.line), [1, 2, 3]);
  assert.equal(res[0].level, 'dead');
  assert.equal(res[1].level, 'ok');
});

// ---------- checkLinks（统一问题对象） ----------
test('checkLinks：坏链接产出 warning（永不 blocker）', async () => {
  const findings = await checkLinks({
    file: 'README.md',
    text: 'https://dead.com/a\nhttps://ok.com/b',
    fetcher: fakeFetch({ 'https://dead.com/a': { status: 404 }, 'https://ok.com/b': { status: 200 } }),
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warning');
  assert.notEqual(findings[0].severity, 'blocker');
  assert.equal(findings[0].kind, 'link-check');
  assert.equal(findings[0].linkLevel, 'dead');
  assert.ok(findings[0].exemptHint.includes('dsh-skip-doc'));
});

test('checkLinks：全好链接 → 无 finding', async () => {
  const findings = await checkLinks({
    file: 'a.md', text: 'https://ok.com', fetcher: fakeFetch({ 'https://ok.com': { status: 200 } }),
  });
  assert.equal(findings.length, 0);
});

test('checkLinks：无链接 → 不发探测', async () => {
  let called = 0;
  const findings = await checkLinks({
    file: 'a.md', text: '# 没有链接',
    fetcher: async () => { called++; return { status: 200 }; },
  });
  assert.equal(findings.length, 0);
  assert.equal(called, 0);
});

// ---------- 断网不 blocker ----------
test('断网：全部网络错误 → 只 warning，无 blocker', async () => {
  const offline = async () => { throw new Error('fetch failed: network is unreachable'); };
  const findings = await checkLinks({
    file: 'docs.md',
    text: 'https://a.com\nhttps://b.com\nhttps://api.github.com/x',
    fetcher: offline,
  });
  assert.ok(findings.length > 0);
  assert.equal(findings.filter((f) => f.severity === 'blocker').length, 0, '断网绝不产生 blocker');
  assert.equal(findings.every((f) => f.severity === 'warning'), true);
});

test('断网：flaky 域名打折后扣分显著更低', async () => {
  const offline = async () => { throw new Error('fetch failed'); };
  const findings = await checkLinks({
    file: 'docs.md',
    text: 'https://example.com\nhttps://api.github.com/x',
    fetcher: offline,
  });
  const nonFlaky = findings.find((f) => !f.flaky);
  const flaky = findings.find((f) => f.flaky);
  assert.ok(flaky.scoreImpact < nonFlaky.scoreImpact, 'flaky 扣分应更低');
});

test('sumLinkPenalty：扣分汇总（保留两位小数）', async () => {
  const findings = await checkLinks({
    file: 'a.md',
    text: 'https://example.com/a\nhttps://api.github.com/b',
    fetcher: async (url) => { if (url.includes('github')) throw new Error('fetch failed'); return { status: 404 }; },
  });
  const total = sumLinkPenalty(findings);
  assert.ok(total > 0 && total < 4);
});

// ---------- 100 链接 ≤30 秒 ----------
test('性能：100 链接并发探测 ≤30 秒', async () => {
  const links = Array.from({ length: 100 }, (_, i) => `https://host${i}.com/p`);
  const text = links.join('\n');
  const t0 = Date.now();
  const findings = await checkLinks({
    file: 'big.md', text, concurrency: 10,
    fetcher: async () => { await new Promise((r) => setTimeout(r, 50)); return { status: 404 }; },
  });
  const cost = Date.now() - t0;
  assert.equal(findings.length, 100);
  assert.ok(cost <= 30_000, `100 链接应 ≤30 秒，实际 ${cost}ms`);
});

// ---------- 常量 ----------
test('常量：分级表与 flaky 清单非空且语义正确', () => {
  assert.ok(DEAD_STATUSES.includes(404) && DEAD_STATUSES.includes(403));
  assert.ok(TRANSIENT_STATUSES.includes(503));
  assert.ok(FLAKY_HOSTS.includes('api.github.com'));
  assert.equal(LINK_SEVERITY_SCORE.dead, -3);
  assert.equal(LINK_SEVERITY_SCORE.dns, -2);
  assert.equal(LINK_SEVERITY_SCORE.transient, -1);
});
// ---------- CLI 集成（cmdLinkCheck） ----------
test('CLI：cmdLinkCheck 在无链接目录不报错', async () => {
  const { cmdLinkCheck } = await import('../cli.mjs');
  const prev = console.log;
  let out = '';
  console.log = (s) => { out += String(s) + '\n'; };
  try { await cmdLinkCheck('docs'); } finally { console.log = prev; }
  assert.ok(out.includes('链接检查'));
  assert.ok(out.includes('只 warning'));
});

test('CLI：HELP 含 link-check 子命令', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../cli.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('git-sluice link-check'));
});
