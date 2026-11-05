/**
 * 归档/笔记目录的「会话措辞」免排斥（2026-11-05）。
 *
 * 背景：`conv-*` 与 `documentation/comment-suspicious-detection` 原本按「公开文档只写做了什么」
 *   拦截「用户同意」「会话 ID」「对话记录」等措辞。但归档类目录（`开发者文档/`、`sessions/`、
 *   `worklogs/`、`会话/`）**本来就是**在记录决策与会话 ID —— 实测某归档仓命中 172 条，
 *   其中 138 条落在 `开发者文档/`，纯属误伤。
 *
 * 判据：这些规则声明 `exclude_paths` 后，归档目录整规则跳过；**普通文档与代码照旧拦截**。
 *   本测试同时锁：①归档目录不报；②普通文档报；③代码注释报（control，防「一刀切放开」）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { auditFull } from '../lib/audit/orchestrate.js';
import { listTools } from '../lib/app/tools.js';

const CONV = /^(conv-|documentation\/comment-suspicious)/;

async function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-archive-'));
  // 必须 await：否则 finally 会在异步用例跑完**之前**删掉目录，审计看到 0 个文件（假失败）
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('归档目录（开发者文档/sessions/worklogs）：会话措辞不再误报', async () => withRepo(async (dir) => {
  mkdirSync(join(dir, '开发者文档'), { recursive: true });
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  mkdirSync(join(dir, 'worklogs'), { recursive: true });
  writeFileSync(join(dir, '开发者文档', 'notes.md'), '- 用户确认了方案；会话ID: session-abcdef12\n', 'utf8');
  writeFileSync(join(dir, 'sessions', 'session-abcdef12-SUMMARY.md'), '- 会话ID: session-abcdef12\n- 本会话共 3 轮\n', 'utf8');
  writeFileSync(join(dir, 'worklogs', 'w1.md'), '- 我们讨论后约定：本对话完成\n', 'utf8');

  const r = await auditFull(dir, { maxScanFiles: 50 });
  const hits = r.findings.filter((f) => CONV.test(String(f.rule)));
  assert.deepEqual(hits.map((h) => h.rule + '@' + h.file), [], '归档目录不应命中 conv-* / 注释残留规则');
}));

test('普通文档照旧拦截（未被误放开）', async () => withRepo(async (dir) => {
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'public.md'), '- 用户确认了方案（会话 session-abcdef12）\n', 'utf8');
  const r = await auditFull(dir, { maxScanFiles: 50 });
  const hits = r.findings.filter((f) => CONV.test(String(f.rule)));
  assert.ok(hits.length > 0, '普通文档里的「用户确认/会话 ID」仍应被拦；实际 findings=' + JSON.stringify(r.findings.map(f=>f.rule+'@'+f.file)) + '，files=' + r.files);
}));

test('代码注释里的协作残留照旧拦截（blocker）', async () => withRepo(async (dir) => {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.js'), '// 用户说要改成异步，原话是「先这样」\nexport const a = 1;\n', 'utf8');
  const r = await auditFull(dir, { maxScanFiles: 50 });
  const hits = r.findings.filter((f) => f.rule === 'documentation/comment-suspicious-detection');
  assert.ok(hits.length > 0, '代码注释里的「用户说/原话」必须仍然拦；实际=' + JSON.stringify(r.findings.map(f=>f.rule+'@'+f.file)) + '，files=' + r.files);
}));

test('npm_publish 的工具描述写明「凭据由插件托管」', () => {
  const tool = listTools().find((t) => t.name === 'npm_publish');
  assert.ok(tool, 'npm_publish 工具应存在');
  assert.match(tool.description, /凭据由插件托管/, 'AI 只能看到 description，凭据口径必须写在这里');
  assert.match(tool.description, /无需 npm login/);
});
