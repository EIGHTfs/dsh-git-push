/**
 * dsh-git-push — 两个此前零行为测试的树化判据（2026-11-13 补）
 *
 * 为什么补：`paths/hardcoded-absolute-path` 与 `performance/loop-full-rewrite-call` 这两个
 *   astConfirmKind 在规则 yml 里声明了，但**没有任何测试断言它们「真命中会报 / 误报不会报」**。
 *   零覆盖状态下调整判定逻辑不会变红，将来若把审计引擎重写，也没有等价性标尺。
 *
 * 每个判据都给「真命中」与「不该报」两侧，且都覆盖实现里明确写到的排除条件。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hardcodedAbsPathHits, hardcodedAbsPathLines } from '../../lib/checks/hardcoded-path.js';
import { loopFullRewriteCallLines } from '../../lib/ast/perf.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------- hardcoded-abs-path ----------

test('hardcoded-abs-path：Linux 绝对路径字面量真命中（4 种形态都识别）', () => {
  // 用 String.raw 避免 JS 转义与实现里的反斜杠语义互相干扰（首版就栽在这上面）
  const text = [
    String.raw`const a = '/volume1/data/x.json';`,
    String.raw`const b = 'C:\Users\me\y.json';`,
    String.raw`const c = '\\server\share\z.json';`,
    String.raw`const d = 'file:///tmp/w.json';`,
  ].join('\n');
  const hits = hardcodedAbsPathHits(text);
  assert.ok(hits.length >= 4, `四种形态都应命中（实际 ${hits.length} 条：${hits.map((h) => h.os).join(',')}）`);
  // 一行可能被两个正则同时命中（`C:\\server` 既像盘符又像 UNC），所以断言「行号集合」而非「每条 os」
  assert.deepEqual([...hardcodedAbsPathLines(text)].sort((x, y) => x - y), [1, 2, 3, 4]);
  const kinds = new Set(hits.map((h) => h.os));
  for (const k of ['posix', 'windows', 'unc', 'file-url']) assert.ok(kinds.has(k), `应识别 ${k} 形态`);
});

test('hardcoded-abs-path：相对路径 / path.join 写法不该报', () => {
  const text = [
    "const a = './x.json';",
    "const b = '../y.json';",
    "const c = path.join(base, 'z.json');",
    "const d = join(os.tmpdir(), 'w.json');",
  ].join('\n');
  assert.equal(hardcodedAbsPathHits(text).length, 0, '相对路径与 path.join 都不含绝对路径字面量');
});

test('hardcoded-abs-path：散文举例（混入中文/全角标点）不该报 —— 实现里 PROSE_MIXED 的守点', () => {
  // 实测两类误报都由它兜掉：规则描述被夹具引用、截图路径后紧跟全角括号
  const text = [
    "// 规则说明：/volume1/data/x.json，换机即失效）",
    "// 日志输出：/tmp/iwara-login-shots）",
  ].join('\n');
  assert.equal(hardcodedAbsPathHits(text).length, 0, '含 CJK / 全角标点的命中应直接丢弃，不是「只警告」');
});

test('hardcoded-abs-path：accessible 区分本机可访问与不可访问（前者附相对路径，后者不换算）', () => {
  // 必须用**真实存在**的路径才能测「可访问」分支 —— 首版我用了不存在的 /tmp/xxx 却断言 true，属测试逻辑错
  const realDir = mkdtempSync(join(tmpdir(), 'dsh-hcp-'));
  // 必须真的建出那个文件：existsSync 查的是**完整文件路径**，只建目录会判不可访问
  writeFileSync(join(realDir, 'x.json'), '');
  try {
    // PATH_RES 要求 /tmp/ 后仍有内容，所以拿 mkdtemp 出来的真实目录路径
    const text = [
      `const here = '${realDir}/x.json';`,
      "const gone = '/volume1/definitely-not-exists-xyz/q.json';",
    ].join('\n');
    const hits = hardcodedAbsPathHits(text, join(realDir, 'sample.mjs'), realDir);
    const here = hits.find((h) => h.raw.startsWith(realDir));
    const gone = hits.find((h) => h.raw.startsWith('/volume1/definitely-not-exists-xyz'));
    assert.equal(here?.accessible, true, '真实存在的目录应判可访问');
    assert.ok(here?.relative, '可访问时应换算相对路径');
    assert.equal(gone?.accessible, false, '不存在的路径判不可访问');
    assert.equal(gone?.relative, '', '不可访问时不换算（无基准）');
  } finally { rmSync(realDir, { recursive: true, force: true }); }
});

// ---------- loop-full-rewrite-call ----------

test('loop-full-rewrite-call：循环里调用「整份重写文件」的函数真命中', () => {
  const text = [
    'function saveAll(list) {',
    "  writeFileSync('index.json', JSON.stringify(list));",
    '}',
    'for (const item of items) {',
    '  saveAll(item);',
    '}',
  ].join('\n');
  const lines = loopFullRewriteCallLines(text);
  assert.equal(lines.size, 1, '循环体内那次调用应命中');
  assert.ok(lines.has(5), `命中行应为 5（实际 ${[...lines]})`);
});

test('loop-full-rewrite-call：同样的调用在循环外不该报', () => {
  const text = [
    'function saveAll(list) {',
    "  writeFileSync('index.json', JSON.stringify(list));",
    '}',
    'saveAll(items);',
  ].join('\n');
  assert.equal(loopFullRewriteCallLines(text).size, 0, '不在循环里不算「每轮重写」');
});

test('loop-full-rewrite-call：循环里调的函数不含整份重写（无 writeFileSync+JSON.stringify）不该报', () => {
  const text = [
    'function pushOne(item) {',
    '  list.push(item);',
    '}',
    'for (const item of items) {',
    '  pushOne(item);',
    '}',
  ].join('\n');
  assert.equal(loopFullRewriteCallLines(text).size, 0, '只改内存不落盘，不是本规则的目标形态');
});
