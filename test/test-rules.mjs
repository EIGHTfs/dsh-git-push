/**
 * lib/rules.js 单测：规则解析 / 合并 / 导出 / 装载 / 在线拉取 / 落盘
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_COMMENT_WORDING_PATTERNS,
  parseCommentWordingRules,
  mergeCommentWordingRules,
  exportCommentWordingRules,
  fetchCommentWordingRules,
  loadCommentWordingRulesSync,
  saveCommentWordingRulesFile,
} from '../lib/rules.js';

const root = mkdtempSync(join(tmpdir(), 'gprules-'));

test('内置规则：8 条代码注释措辞', () => {
  assert.ok(DEFAULT_COMMENT_WORDING_PATTERNS.length >= 8);
  const names = DEFAULT_COMMENT_WORDING_PATTERNS.map((r) => r.name);
  for (const n of ['用户要求', '用户原话', '用户说', '用户约定', '用户规定', '用户明确', '用户拍板', '用户：']) {
    assert.ok(names.includes(n), '内置规则应含 ' + n);
  }
});

test('parse：数组输入', () => {
  const r = parseCommentWordingRules([{ name: '老板说', pattern: '老板说' }]);
  assert.equal(r.ok, true);
  assert.equal(r.rules.length, 1);
  assert.equal(r.rules[0].name, '老板说');
});

test('parse：JSON 文本数组', () => {
  const r = parseCommentWordingRules('[{"name":"甲方要求","pattern":"甲方要求"}]');
  assert.equal(r.ok, true);
  assert.equal(r.rules[0].name, '甲方要求');
});

test('parse：{ rules: [...] } 包装', () => {
  const r = parseCommentWordingRules(JSON.stringify({ rules: [{ name: 'a', pattern: 'a' }] }));
  assert.equal(r.ok, true);
  assert.equal(r.rules.length, 1);
});

test('parse：非法 JSON → ok:false', () => {
  const r = parseCommentWordingRules('{not json');
  assert.equal(r.ok, false);
});

test('parse：非法正则 → ok:false 且指明规则名', () => {
  const r = parseCommentWordingRules([{ name: '坏规则', pattern: '([unclosed' }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /坏规则/);
});

test('parse：空条目被丢弃', () => {
  const r = parseCommentWordingRules([{ name: '', pattern: '' }, { name: 'x', pattern: 'x' }]);
  assert.equal(r.ok, true);
  assert.equal(r.rules.length, 1);
});

test('merge：同名覆盖、保序、保留新增', () => {
  const base = [{ name: '用户要求', pattern: '用户要求' }, { name: 'A', pattern: 'AA' }];
  const extra = [{ name: '用户要求', pattern: '新的用户要求表达' }, { name: 'B', pattern: 'BB' }];
  const m = mergeCommentWordingRules(base, extra);
  assert.deepEqual(m.map((r) => r.name), ['用户要求', 'A', 'B']);
  assert.equal(m[0].pattern, '新的用户要求表达');
});

test('export：输出 version/rules 结构，可被 parse 回读', () => {
  const ex = exportCommentWordingRules([{ name: 'x', pattern: 'x' }]);
  const parsed = JSON.parse(ex);
  assert.equal(parsed.version, 1);
  const back = parseCommentWordingRules(ex);
  assert.equal(back.ok, true);
  assert.equal(back.rules[0].name, 'x');
});

test('loadCommentWordingRulesSync：custom 优先', () => {
  const r = loadCommentWordingRulesSync({ custom: '[{"name":"自定义","pattern":"自定义"}]' });
  assert.equal(r.source, 'custom');
  assert.equal(r.rules[0].name, '自定义');
});

test('loadCommentWordingRulesSync：custom 非法回退 builtin', () => {
  const r = loadCommentWordingRulesSync({ custom: '{bad' });
  assert.equal(r.source, 'builtin');
  assert.ok(r.rules.length >= 8);
});

test('loadCommentWordingRulesSync：rulesFile 次优先', () => {
  const f = join(root, 'rules-custom.json');
  writeFileSync(f, exportCommentWordingRules([{ name: '文件规则', pattern: '文件规则' }]), 'utf8');
  const r = loadCommentWordingRulesSync({ rulesFile: f });
  assert.equal(r.source, 'file');
  assert.equal(r.rules[0].name, '文件规则');
});

test('saveCommentWordingRulesFile：写盘后可读回', () => {
  const f = join(root, 'saved.json');
  const s = saveCommentWordingRulesFile([{ name: '存盘', pattern: '存盘' }], f);
  assert.equal(s.ok, true);
  assert.ok(existsSync(f));
  const back = JSON.parse(readFileSync(f, 'utf8'));
  assert.equal(back.rules[0].name, '存盘');
});

test('fetchCommentWordingRules：本机 http 服务端到端', async () => {
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(exportCommentWordingRules([{ name: '在线规则', pattern: '在线规则' }]));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const r = await fetchCommentWordingRules('http://127.0.0.1:' + port + '/rules.json');
    assert.equal(r.ok, true);
    assert.equal(r.rules[0].name, '在线规则');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('fetchCommentWordingRules：404 → ok:false', async () => {
  const http = await import('node:http');
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const r = await fetchCommentWordingRules('http://127.0.0.1:' + port + '/nope');
    assert.equal(r.ok, false);
    assert.match(r.error, /404/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('fetchCommentWordingRules：超时 → ok:false', async () => {
  const http = await import('node:http');
  const server = http.createServer(() => { /* 永不响应 */ });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const r = await fetchCommentWordingRules('http://127.0.0.1:' + port + '/hang', { timeoutMs: 300 });
    assert.equal(r.ok, false);
    assert.match(r.error, /超时|abort/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// 清理临时目录（after 钩子：测试全部结束后再删，不能放模块顶层同步执行）
after(() => rmSync(root, { recursive: true, force: true }));
