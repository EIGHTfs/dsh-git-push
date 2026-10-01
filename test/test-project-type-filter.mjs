/**
 * 项目类型规则适配测试（2026-10-02，Pawchive 误报消除驱动）：
 * ① dsh 槽位只对 dsh 插件项目加载（package.json name dsh- 前缀）——非 dsh 项目
 *   require('fs'/'node:sqlite') 是 Node 后端正常用法，不再误报（Pawchive 7 条实测）
 * ② versioning 0.x 两条只对 dsh 插件查——0.x 独立工具 v0.x 合法（Pawchive 18 条实测）
 * ③ timeout-on-external-api 限 js 系——md 文档不再被正则命中（Pawchive docs md 实测）
 * ④ folder 遍历尊重 .gitignore——被忽略目录（上游克隆）不计入 total-count（Pawchive 76 目录实测）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditFull } from '../lib/audit/index.js';
import { checkFolderRules } from '../lib/checks/index.js';

function mkRepo({ name = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-ptype-'));
  if (name) writeFileSync(join(root, 'package.json'), JSON.stringify({ name, version: '1.0.0' }) + '\n');
  return root;
}

test('非 dsh 项目：dsh/* 规则不加载（require node 内置不误报）', async () => {
  const root = mkRepo(); // 无 package.json = 非 dsh 插件
  try {
    writeFileSync(join(root, 'core.js'), 'const fs = require("fs");\nconst path = require("path");\nconst { DatabaseSync } = require("node:sqlite");\n');
    const res = await auditFull(root);
    const dshHits = (res.findings || []).filter((f) => String(f.rule).startsWith('dsh/'));
    assert.equal(dshHits.length, 0, `非 dsh 项目不应有 dsh/* 命中：${dshHits.map((f) => f.rule).join(',')}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('非 dsh 项目：version 0.x 规则放行（v0.x 合法）', async () => {
  const root = mkRepo({ name: 'my-tool' }); // 独立工具（非 dsh 插件）
  try {
    writeFileSync(join(root, 'README.md'), '# My Tool\n\n## v0.2.0\n- first release\n\n## v0.1.0\n- init\n');
    writeFileSync(join(root, 'lib.js'), 'const VERSION = "v0.2.0";\n');
    const res = await auditFull(root);
    const v0 = (res.findings || []).filter((f) => /version\/(embedded-major-zero|readme-zero-title)/.test(String(f.rule)));
    assert.equal(v0.length, 0, `非 dsh 独立工具的 v0.x 不应报：${v0.map((f) => f.rule).join(',')}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('dsh 插件项目：dsh/* 规则仍加载（crx client require node 内置拦截）', async () => {
  const root = mkRepo({ name: 'dsh-test-plugin' });
  try {
    mkdirSync(join(root, 'crx'));
    writeFileSync(join(root, 'crx', 'content.js'), 'const fs = require("fs");\n');
    const res = await auditFull(root);
    const dshHits = (res.findings || []).filter((f) => String(f.rule).startsWith('dsh/'));
    assert.ok(dshHits.length >= 1, `dsh 插件项目的 client require(fs) 应被 dsh/* 拦截（得 ${dshHits.map((f) => f.rule).join(',')}）`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('timeout-on-external-api：限 js 系——md 文档不扫', async () => {
  const root = mkRepo({ name: 'dsh-test-timeout' });
  try {
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'note.md'), '外部请求示例：fetch("https://example.com") 无超时会导致挂起\n');
    mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'lib', 'api.js'), 'export async function call() { const r = await fetch("https://example.com"); return r; }\n');
    const res = await auditFull(root);
    const mdHits = (res.findings || []).filter((f) => f.rule === 'robustness/timeout-on-external-api' && /\.md$/.test(f.file));
    const jsHits = (res.findings || []).filter((f) => f.rule === 'robustness/timeout-on-external-api' && /\.js$/.test(f.file));
    assert.equal(mdHits.length, 0, 'md 文档不应被 timeout 规则扫（exts 限定 js 系）');
    assert.ok(jsHits.length >= 1, 'js 代码的裸 fetch 应仍提示');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('folder 遍历尊重 .gitignore：被忽略目录（上游克隆）不计入 total-count', () => {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-fgit-'));
  try {
    // .gitignore：docs/* 忽略 + !docs/*.md 保留（模拟 .probe-ktoolbox 上游克隆形态）
    writeFileSync(join(root, '.gitignore'), 'docs/*\n!docs/*.md\n');
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'README.md'), 'docs 说明\n');
    mkdirSync(join(root, 'docs', '.probe-ktoolbox', 'webui'), { recursive: true });
    writeFileSync(join(root, 'docs', '.probe-ktoolbox', 'webui', 'app.js'), 'x\n');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'main.js'), 'y\n');
    const rules = [{ id: 'folder/total-count', threshold: 2, severity: 'warning', message: '{count}/{threshold}', excludeDirs: [] }];
    const gitignoreText = 'docs/*\n!docs/*.md\n';
    const f = checkFolderRules({ root, rules, gitignoreText });
    // src 计 1（docs 被 .gitignore 忽略、.probe-ktoolbox 不计）→ 阈值 2 下不报
    assert.equal(f.length, 0, '被 .gitignore 忽略的 docs/ 与 .probe-ktoolbox 不应计入（阈值 2 下 1 目录不报）');
    // 对照：无 gitignoreText 时 .probe-ktoolbox 计入 → 3 目录超阈值 2 → 报
    const fNoGi = checkFolderRules({ root, rules, gitignoreText: '' });
    assert.ok(fNoGi.length >= 1, '无 gitignore 感知时上游克隆目录计入 → 应报（对照验证）');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
