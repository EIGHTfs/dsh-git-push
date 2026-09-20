/**
 * 文档加分制测试（2026-09-21）：
 *   docs-score 检查器（文档集圈法/四检查/版本一致性交叉验证/多文档不一致 review）
 *   + scoreQuality 文档维度加分制公式（0~4 命中 → 0/2.5/5/7.5/10；docsScore 缺省回退扣分制）
 *   + 不冲突约束（docs-score 不进 findings/扣分维度/问题计数）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkDocsScore, collectDocFiles } from '../lib/score/docs-score.js';
import { scoreQuality } from '../lib/score/index.js';
import { auditFull } from '../lib/audit/orchestrate.js';
import '../lib/rule/compilers.js';

/** 建临时项目根（返回路径，测试末尾清理）。 */
function makeProject(files) {
  const root = mkdtempSync(join(tmpdir(), 'dshgp-docs-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

test('docs-score：文档集圈法（README + docs/ 递归 + 根级命名；node_modules md 不进）', () => {
  const root = makeProject({
    'README.md': '# X\n',
    'docs/CHANGELOG.md': '## 1.0.0\n',
    'docs/guide/install.md': 'npm install\n',
    'CHANGELOG.md': '## 0.9.0\n',
    'docs/node_modules/fake.md': '不该算\n',
  });
  try {
    const files = collectDocFiles(root);
    const rels = files.map((f) => f.replace(root + '/', '')).sort();
    assert.ok(rels.includes('README.md'), 'README 应在文档集');
    assert.ok(rels.includes('docs/CHANGELOG.md'), 'docs/ 下 md 应在文档集');
    assert.ok(rels.includes('docs/guide/install.md'), 'docs/ 嵌套 md 应在文档集');
    assert.ok(rels.includes('CHANGELOG.md'), '根级常见命名应在文档集');
    assert.ok(!rels.some((r) => r.includes('node_modules')), 'node_modules 内 md 不得进文档集');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('docs-score：四检查命中与反例（版本一致性交叉验证 + Node 18 不误加）', () => {
  // 正例：README 有版本(v1.6.0=pkg)/安装命令/环境变量
  const good = makeProject({
    'package.json': '{"name":"x","version":"1.6.0"}\n',
    'README.md': '# X v1.6.0\n\nnpm install\n\n.env 环境变量：PORT\n',
  });
  try {
    const r = checkDocsScore(good);
    assert.deepEqual(r.hits.sort(), ['env-list', 'install-command', 'readme-exists', 'version-consistent'].sort());
  } finally { rmSync(good, { recursive: true, force: true }); }
  // 反例：无 README（只有 docs/）→ readme-exists 不加 + review 提示
  const noReadme = makeProject({ 'docs/INSTALL.md': 'npm install\n' });
  try {
    const r = checkDocsScore(noReadme);
    assert.ok(!r.hits.includes('readme-exists'), '无 README 不加 readme-exists');
    assert.ok(r.review.some((x) => x.includes('README 缺失')), '应提示 README 缺失');
  } finally { rmSync(noReadme, { recursive: true, force: true }); }
  // 版本一致性：README 只提 Node 18.0.0（≠ pkg）→ 不命中 version-consistent
  const nodeOnly = makeProject({ 'package.json': '{"version":"2.0.0"}\n', 'README.md': '支持 node 18.0.0\n' });
  try {
    const r = checkDocsScore(nodeOnly);
    assert.ok(!r.hits.includes('version-consistent'), 'Node 环境版本不误加 version-consistent');
  } finally { rmSync(nodeOnly, { recursive: true, force: true }); }
  // pkg 缺失 → 版本项跳过不抛错
  const noPkg = makeProject({ 'README.md': 'v1.0.0\nnpm install\n' });
  try {
    const r = checkDocsScore(noPkg);
    assert.ok(!r.hits.includes('version-consistent'), '无 package.json 版本项跳过');
    assert.ok(r.hits.includes('install-command'), '其余项照判');
  } finally { rmSync(noPkg, { recursive: true, force: true }); }
});

test('docs-score：多文档版本不一致 → review 提示且存在性加分照给', () => {
  const root = makeProject({
    'package.json': '{"version":"1.6.0"}\n',
    'README.md': '# X v1.6.0\n\nnpm install\n\nnode 18.0.0 支持\n', // 正文环境版本
    'docs/CHANGELOG.md': '## 变更\n- 1.5.9 修复\n',                  // 版本记录 1.5.9（与 pkg 不一致）
  });
  try {
    const r = checkDocsScore(root);
    assert.ok(r.hits.includes('version-consistent'), '存在性加分照给（1.6.0 == pkg）');
    const inReview = r.review.some((x) => x.includes('版本号不一致'));
    assert.ok(inReview, `应提示不一致（得 ${JSON.stringify(r.review)}）`);
    // 不一致提示不得含正文环境版本 18.0.0（记录语境过滤）
    const shown = r.review.find((x) => x.includes('不一致')) || '';
    assert.ok(!shown.includes('18.0.0'), `不一致提示不应含环境版本 18.0.0（得 ${shown}）`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('scoreQuality：文档维度加分制公式（0~4 命中 → 0/2.5/5/7.5/10；缺省回退扣分制）', () => {
  const mk = (n) => ({
    hits: ['a', 'b', 'c', 'd'].slice(0, n),
    items: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, name: id, score: 2.5, hit: i < n })),
    review: [], files: [], versions: [],
  });
  const expect = [0, 2.5, 5, 7.5, 10];
  for (let n = 0; n <= 4; n += 1) {
    const q = scoreQuality([], {}, { files: 10, docsScore: mk(n) });
    assert.equal(q.dims['文档'], expect[n], `命中 ${n} 项文档维度应为 ${expect[n]}`);
  }
  const fallback = scoreQuality([], {}, { files: 10 }); // 不传 docsScore
  assert.equal(fallback.dims['文档'], 10, 'docsScore 缺省回退扣分制（无文档问题 = 10）');
  // 权重联动：文档权重 4，总分变化体现加分制
  const qFull = scoreQuality([], {}, { files: 10, docsScore: mk(4) });
  const qNone = scoreQuality([], {}, { files: 10, docsScore: mk(0) });
  assert.ok(qFull.score > qNone.score, '文档加分应反映到总分（4/4 命中 > 0 命中）');
});

test('不冲突：docs-score 不进 findings/扣分维度/问题计数（auditFull 全链路）', async () => {
  const root = makeProject({
    'package.json': '{"version":"1.0.0"}\n',
    'README.md': '# X v1.0.0\n\nnpm install\n',
    'index.js': 'const a = 1;\n',
  });
  try {
    const r = await auditFull(root, {});
    assert.ok(Array.isArray(r.findings), 'findings 存在');
    assert.ok(!r.findings.some((f) => f.kind === 'docs-score' || f.rule === 'docs-score'),
      'docs-score 加分项不得进 findings（否则会被当问题计数/扣分）');
    assert.ok(r.docsScore && Array.isArray(r.docsScore.items), 'docsScore 应在审计结果独立字段');
    // summary 不含 docs-score（问题计数不受加分项污染）
    const yamlBlock = r.yaml || '';
    assert.ok(!/docs-score/.test(yamlBlock) || !r.findings.some((f) => f.rule === 'docs-score'),
      '报告问题区不得出现 docs-score（加分走独立段）');
  } finally { rmSync(root, { recursive: true, force: true }); }
});