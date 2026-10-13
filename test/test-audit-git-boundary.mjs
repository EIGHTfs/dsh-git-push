/**
 * 边界门禁：审计侧（lib/audit）与中立层（lib/core）不得依赖 git 层 / 装配层 / 脚本层。
 *
 * 背景：审计↔git 边界澄清第一期（2026-10-13）。此前 lib/audit 反向 import 了
 * `../git/{atomic-json,config,exec}.js`（双向耦合），导致「审计」无法独立成包。
 * 本期把中立工具下沉到 lib/core 并改引用，本测试把这条边界钉死。
 *
 * 自证：第二个用例用**合成输入**验证 checker 能变红（把引用改回 ../git/ 会被立刻抓到），
 * 因为"不会红的门禁等于摆设"。
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

/** 去掉注释，避免注释里提到的路径造成误报。 */
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
    }
  }
  return bad;
}

/** 边界规则：审计侧只许依赖自己 + 中立层 + 内置；中立层不许回头依赖任何上层。 */
const RULES = [
  { dir: 'lib/audit', forbidden: ['../git/', './git/'], why: '审计侧不得依赖 git 层' },
  {
    dir: 'lib/core',
    forbidden: ['../git/', '../audit/', '../app/', '../plugin/', '../checks/', '../cli/', '../../scripts/'],
    why: 'lib/core 必须保持中立（不依赖 git/审计/装配/脚本）',
  },
];

test('边界：lib/audit 与 lib/core 不依赖 git 层 / 装配层 / 脚本层', () => {
  const files = {};
  for (const dir of ['lib/audit', 'lib/core']) {
    for (const f of walk(dir)) files[f] = readFileSync(join(ROOT, f), 'utf8');
  }
  const bad = findViolations(files, RULES);
  assert.deepEqual(bad, [], `边界被打破：\n${bad.join('\n')}`);
});

test('边界门禁自证：合成输入里的越界依赖必须被抓到，合规引用必须放行', () => {
  const caught = findViolations({ 'lib/audit/fake.js': "import { runGit } from '../git/exec.js';" }, RULES);
  assert.equal(caught.length, 1, `应抓到 1 条越界，实得 ${caught.length}：${caught.join(' / ')}`);
  const neutral = findViolations({ 'lib/core/fake.js': "import { runGit } from '../core/exec.js';" }, RULES);
  assert.deepEqual(neutral, [], 'core 内部引用应放行');
  const commented = findViolations({ 'lib/audit/fake2.js': "// import { x } from '../git/exec.js';\nimport { y } from '../core/exec.js';" }, RULES);
  assert.deepEqual(commented, [], '注释里的路径不应误报');
});
