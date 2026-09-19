/**
 * 上下文注入测试（0.1.7）：环境注入文本生成/解析、路径归属判定。
 * 2026-09-20：追加工具清单 json 模板（lib/tool-probes.json）读取与运行目录落盘测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createEnvInjectionText, parseEnvInjection, isWithinRoot, DEFAULT_TOOLS,
  loadToolProbeTemplate, writeToolResult, collectToolPaths,
} from '../lib/context/index.js';

test('环境注入：生成含 cwd/项目根/工具清单', () => {
  const t = createEnvInjectionText({ cwd: '/work', projectRoot: '/work/proj' });
  assert.ok(t.includes('当前工作目录 cwd：/work'));
  assert.ok(t.includes('项目实际目录（git 根）：/work/proj'));
  assert.ok(t.includes('git=/usr/bin/git'));
});

test('环境注入：解析回键值结构', () => {
  const t = createEnvInjectionText({ cwd: '/work', projectRoot: '/work/proj', tools: { node: '/usr/bin/node', git: '/usr/bin/git' } });
  const p = parseEnvInjection(t);
  assert.equal(p.cwd, '/work');
  assert.equal(p.projectRoot, '/work/proj');
  assert.equal(p.tools.node, '/usr/bin/node');
  assert.equal(p.tools.git, '/usr/bin/git');
});

test('环境注入：自定义工具覆盖默认', () => {
  const t = createEnvInjectionText({ cwd: '/x', tools: { python3: '/opt/py' } });
  assert.ok(t.includes('python3=/opt/py'));
});

test('环境注入：skills 目录存在性标记', () => {
  const t = createEnvInjectionText({ cwd: '/x', projectRoot: '/no-such-dir-xyz' });
  assert.ok(t.includes('存在：false'));
});

test('路径归属：target 在 root 内/等于 root → true', () => {
  assert.equal(isWithinRoot('/a/b', '/a/b'), true);
  assert.equal(isWithinRoot('/a/b', '/a/b/c.js'), true);
});

// ---------- 2026-09-20 工具清单 json 化（模板只 key，值运行时生成） ----------

test('工具清单模板：只取 key 作探测范围（值为空），.exe key 归一化查版本参数', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ctx-probes-'));
  const tpl = join(tmp, 'tool-probes.json');
  writeFileSync(tpl, JSON.stringify({ git: '', '7z.exe': '' }, null, 2));
  const list = loadToolProbeTemplate(tpl);
  assert.equal(list.length, 2, '模板 key 即探测范围');
  assert.deepEqual(list[0].versionArgs, ['--version'], 'git 应带版本参数');
  assert.equal(list[1].name, '7z.exe', '.exe 名原样保留（探测时自动补后缀）');
  assert.deepEqual(list[1].versionArgs, ['-version'], '7z.exe 应归一化后查到版本参数');
});

test('工具清单模板：文件缺失/空对象回退内置清单', () => {
  const list = loadToolProbeTemplate('/no-such-template.json');
  assert.ok(list.length >= 9, '缺失应回退内置清单');
  assert.ok(list.some((p) => p.name === 'git'), '内置清单应含 git');
  const tmp = mkdtempSync(join(tmpdir(), 'ctx-probes-empty-'));
  const tpl = join(tmp, 'tool-probes.json');
  writeFileSync(tpl, '{}');
  const empty = loadToolProbeTemplate(tpl);
  assert.ok(empty.length >= 9, '空对象也应回退内置清单');
});

test('探测结果落盘：只写 found 且有路径的工具（{key: path} 原子写）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ctx-res-'));
  const file = join(tmp, 'tools.json');
  const w = writeToolResult(file, [
    { name: 'git', path: '/usr/bin/git', found: true },
    { name: '7z', path: '', found: false },
    { name: 'node', path: '', found: false },
  ]);
  assert.equal(w.ok, true);
  assert.equal(w.tools, 1, '只统计探测到的工具');
  const obj = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(obj, { git: '/usr/bin/git' });
});

test('collectToolPaths：默认模板探测 + resultFile 落盘（本机 git 应命中）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ctx-collect-'));
  const file = join(tmp, 'tools.json');
  const out = collectToolPaths(null, { resultFile: file });
  const git = out.find((r) => r.name === 'git');
  assert.ok(git && git.found && git.path, 'git 应探测到实际路径');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(typeof saved.git === 'string' && saved.git.length > 0, '落盘 json 应有 git 实测路径');
});

test('路径归属：target 在 root 外/空 → false', () => {
  assert.equal(isWithinRoot('/a/b', '/a/c.js'), false);
  assert.equal(isWithinRoot('/a/b', '/a'), false);
  assert.equal(isWithinRoot('', '/x'), false);
  assert.equal(isWithinRoot('/x', ''), false);
});

test('路径归属：前缀相似但不同目录 → false（防目录穿越）', () => {
  assert.equal(isWithinRoot('/a/b', '/a/bc'), false);
});
// ---------- 边界与健壮性（入口全功能覆盖） ----------

test('环境注入：空入参不崩溃（cwd/projectRoot 缺省为空串）', () => {
  const text = createEnvInjectionText();
  assert.equal(typeof text, 'string');
  assert.ok(text.includes('当前工作目录 cwd：'));
  const parsed = parseEnvInjection(text);
  assert.equal(parsed.cwd, '');
  assert.equal(parsed.projectRoot, '');
});

test('环境注入：项目根为空时跳过 skills 行（不产生 "undefined/skills"）', () => {
  const text = createEnvInjectionText({ cwd: '/tmp/x', projectRoot: '' });
  assert.ok(!text.includes('undefined'), '不应出现 undefined');
  assert.ok(!text.includes('skills'), '根为空时不输出 skills 行');
});

test('环境注入：非 ASCII 与空格路径原样保留', () => {
  const text = createEnvInjectionText({
    cwd: '/workspace/DeepSeek 运行/带空格 目录',
    projectRoot: '/workspace/中文根',
  });
  const parsed = parseEnvInjection(text);
  assert.equal(parsed.cwd, '/workspace/DeepSeek 运行/带空格 目录');
  assert.equal(parsed.projectRoot, '/workspace/中文根');
});

test('环境注入：工具清单完整回读（多工具键值对不丢）', () => {
  const tools = { git: '/usr/bin/git', ffmpeg: '/usr/bin/ffmpeg', '7z': '/usr/bin/7z' };
  const text = createEnvInjectionText({ cwd: '/a', projectRoot: '/b', tools });
  const parsed = parseEnvInjection(text);
  assert.deepEqual(parsed.tools, tools);
});

test('环境注入：默认工具清单含 git/node/npm（关键工具不缺失）', () => {
  for (const k of ['git', 'node', 'npm']) {
    assert.ok(DEFAULT_TOOLS[k], `默认清单应含 ${k}`);
  }
});

test('环境注入：projectRoot 有 skills 目录 → 标记 true；无 → false', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ctx-skills-'));
  mkdirSync(join(tmp, 'skills'));
  const withSkills = createEnvInjectionText({ cwd: tmp, projectRoot: tmp });
  assert.ok(withSkills.includes('存在：true'), '建有 skills/ 应标记 true');
  const parsed = parseEnvInjection(withSkills);
  assert.equal(parsed.skillsDir, join(tmp, 'skills'), 'skills 路径应正确回读');

  const empty = mkdtempSync(join(tmpdir(), 'ctx-noskills-'));
  const without = createEnvInjectionText({ cwd: empty, projectRoot: empty });
  assert.ok(without.includes('存在：false'), '无 skills/ 应标记 false');
});

test('路径归属：尾部斜杠归一化（/a/b/ 与 /a/b 等价）', () => {
  assert.equal(isWithinRoot('/a/b/', '/a/b'), true);
  assert.equal(isWithinRoot('/a/b', '/a/b/'), true);
  assert.equal(isWithinRoot('/a/b/', '/a/b/c/'), true);
});

test('路径归属：多重尾斜杠归一化', () => {
  assert.equal(isWithinRoot('/a/b///', '/a/b/c'), true);
});

test('路径归属：相对路径与绝对路径混用不误判', () => {
  // 相对路径不以 / 开头，不应被判为绝对路径的子路径
  assert.equal(isWithinRoot('/a/b', 'b/c'), false);
  assert.equal(isWithinRoot('relative', 'relative/c'), true);
});

test('路径归属：空串与 null 输入返回 false（不崩溃）', () => {
  assert.equal(isWithinRoot('', ''), false);
  assert.equal(isWithinRoot('/a', ''), false);
  assert.equal(isWithinRoot('', '/a'), false);
  assert.equal(isWithinRoot(null, null), false);
  assert.equal(isWithinRoot(undefined, '/a'), false);
});

test('路径归属：根自身判定为 true（等于根）', () => {
  assert.equal(isWithinRoot('/a/b', '/a/b'), true);
  assert.equal(isWithinRoot('/', '/'), true);
});

test('路径归属：同名前缀但不同目录 → false（/a/bc 不属于 /a/b）', () => {
  assert.equal(isWithinRoot('/a/b', '/a/bc'), false);
  assert.equal(isWithinRoot('/a/b', '/a/b-c'), false);
  assert.equal(isWithinRoot('/a/b', '/a/b.c'), false);
});

test('解析：非法输入返回空结构不抛异常', () => {
  for (const bad of ['', '   ', 'random text', null, undefined, 123]) {
    const parsed = parseEnvInjection(bad);
    assert.equal(typeof parsed, 'object');
    assert.equal(parsed.cwd, '');
  }
});

test('解析：往返一致（生成 → 解析 → 关键字段相同）', () => {
  const opts = { cwd: '/w/c', projectRoot: '/w', tools: { git: '/g', node: '/n' } };
  const parsed = parseEnvInjection(createEnvInjectionText(opts));
  assert.equal(parsed.cwd, opts.cwd);
  assert.equal(parsed.projectRoot, opts.projectRoot);
  assert.deepEqual(parsed.tools, opts.tools);
});

test('环境注入：运行主机名 + 局域网 IP（默认探测 / host 覆盖）', () => {
  // 默认：真实探测（本机必有主机名；IP 可能为空但不报错）
  const t = createEnvInjectionText({ cwd: '/work' });
  const hostLine = t.split('\n').find((l) => l.startsWith('- 运行主机'));
  assert.ok(hostLine && hostLine.includes('：'), '应输出「运行主机：主机名（IP）」行');
  const p = parseEnvInjection(t);
  assert.ok(p.host && typeof p.host.hostname === 'string' && p.host.hostname.length > 0, '解析出主机名');
  assert.ok(Array.isArray(p.host.ips), 'ips 为数组');
  // host 参数注入覆盖（测试可控）
  const t2 = createEnvInjectionText({ cwd: '/x', host: { hostname: 'testhost', ips: ['10.0.0.8', '192.168.1.5'] } });
  assert.ok(t2.includes('运行主机：testhost（10.0.0.8 / 192.168.1.5）'));
  const p2 = parseEnvInjection(t2);
  assert.equal(p2.host.hostname, 'testhost');
  assert.deepEqual(p2.host.ips, ['10.0.0.8', '192.168.1.5']);
});
