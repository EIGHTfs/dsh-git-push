/**
 * 边界门禁：审计侧（lib/audit）与中立层（lib/core）不得依赖 git 层 / 装配层 / 脚本层 / 宿主包。
 *
 * 背景：审计↔git 边界澄清 + 「审计按独立包设计」（2026-10-13）。
 *   · 第一期（已完成）：把中立工具下沉到 lib/core，lib/audit 不再 import ../git/*
 *   · 本期（第二期前半）：lib/audit 不再 import scripts/**（文档漂移检查器改为宿主注入，见 lib/app/host-doc-checks.js）；
 *     并禁止任何宿主包（@deepseek-ai/* / cordis / schemastery）出现在审计子图里——否则它无法脱离 DSH 使用。
 *
 * 自证：第二个用例用**合成输入**验证 checker 能变红（越界依赖、宿主包、注释里的路径分别验证），
 *   因为"不会红的门禁等于摆设"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 递归收集 .js/.mjs 文件（返回相对 ROOT 的 posix 风格路径）。 */
function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

/** 去掉注释，避免注释里提到的路径/包名造成误报。 */
function stripComments(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 提取源码里的模块说明符（from '…' / import '…' / import('…')）。 */
export function specifiersOf(text) {
  const out = [];
  for (const m of stripComments(text).matchAll(/(?:from\s*|import\s*|import\(\s*)['"]([^'"]+)['"]/g)) out.push(m[1]);
  return out;
}

/** 给定 { 文件路径: 源码文本 } 与规则，返回越界记录（空数组=合规）。 */
export function findViolations(files, rules) {
  const bad = [];
  for (const [file, text] of Object.entries(files)) {
    const rule = rules.find((r) => file.startsWith(`${r.dir}/`));
    if (!rule) continue;
    for (const spec of specifiersOf(text)) {
      if (rule.forbidden.some((p) => spec.startsWith(p))) bad.push(`${file} → ${spec}（${rule.why}）`);
      else if ((rule.packages || []).some((p) => spec === p || spec.startsWith(p))) bad.push(`${file} → ${spec}（${rule.why}）`);
    }
  }
  return bad;
}

/** 边界规则：审计侧只许依赖自己 + 中立层 + 内置；中立层不许回头依赖任何上层；两者都不许依赖宿主包。 */
const HOST_PACKAGES = ['@deepseek-ai/', 'cordis', '@cordisjs/', 'schemastery'];
const RULES = [
  {
    dir: 'lib/audit',
    forbidden: ['../git/', './git/', '../app/', '../plugin/', '../cli/', '../client', '../../scripts/'],
    packages: HOST_PACKAGES,
    why: '审计侧不得依赖 git 层 / 装配层 / 仓库脚本 / 宿主包',
  },
  {
    dir: 'lib/core',
    forbidden: ['../git/', '../audit/', '../app/', '../plugin/', '../checks/', '../cli/', '../../scripts/'],
    packages: HOST_PACKAGES,
    why: 'lib/core 必须保持中立（不依赖 git/审计/装配/脚本/宿主包）',
  },
];

test('边界：lib/audit 与 lib/core 不依赖 git 层 / 装配层 / 脚本层 / 宿主包', () => {
  const files = {};
  for (const dir of ['lib/audit', 'lib/core']) {
    for (const f of walk(dir)) files[f] = readFileSync(join(ROOT, f), 'utf8');
  }
  const bad = findViolations(files, RULES);
  assert.deepEqual(bad, [], `边界被打破：\n${bad.join('\n')}`);
});

test('边界门禁自证：越界依赖/宿主包必须被抓到，合规引用与注释必须放行', () => {
  const caught = findViolations({ 'lib/audit/fake.js': "import { runGit } from '../git/exec.js';" }, RULES);
  assert.equal(caught.length, 1, `应抓到 1 条越界，实得 ${caught.length}：${caught.join(' / ')}`);
  const scripts = findViolations({ 'lib/audit/fake1.js': "import { checkDrift } from '../../scripts/doc-tree.mjs';" }, RULES);
  assert.equal(scripts.length, 1, `应抓到 scripts 越界，实得 ${scripts.length}`);
  const host = findViolations({ 'lib/audit/fake2.js': "import { defineTool } from '@deepseek-ai/dsh-tools';" }, RULES);
  assert.equal(host.length, 1, `应抓到宿主包依赖，实得 ${host.length}`);
  const neutral = findViolations({ 'lib/core/fake.js': "import { runGit } from '../core/exec.js';" }, RULES);
  assert.deepEqual(neutral, [], 'core 内部引用应放行');
  const commented = findViolations({ 'lib/audit/fake3.js': "// import { x } from '../git/exec.js';\nimport { y } from '../core/exec.js';" }, RULES);
  assert.deepEqual(commented, [], '注释里的路径不应误报');
});
