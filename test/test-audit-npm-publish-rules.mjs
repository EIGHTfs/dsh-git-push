/**
 * 回归：npm 发布清单类规则的 5 个新增结构化检查（依据 skill `npm-publish-checklist-NPM发布检查清单.md`）。
 *
 * 覆盖：license=UNLICENSED / files 夹带敏感内容或体积产物 / 元信息不全 / prepack 类脚本提示 / peer 无显式上界。
 * 全部走 checkNpmJson 的结构化判定（真实解析 package.json），并各配一个「合规不报」样例防误报。
 *
 * 断言口径：按**目标规则是否命中**判定（findings 里可能同时有其它规则的合理命中，
 *   例如极简 fixture 缺 author/keywords 会被 npm/meta-incomplete 一并命中），不做全量 deepEqual。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkNpmJson } from '../lib/checks/npm-json.js';

const RULES = [
  { id: 'npm/license-unlicensed', name: 'license 未授权', severity: 'warning' },
  { id: 'npm/files-risky-entry', name: 'files 含敏感/产物', severity: 'warning' },
  { id: 'npm/meta-incomplete', name: '元信息不全', severity: 'info' },
  { id: 'npm/prepack-script-present', name: '有发布脚本', severity: 'info' },
  { id: 'npm/peer-range-unbounded', name: 'peer 无上界', severity: 'info' },
];

/** 跑一次检查（只给这些规则，隔离其它规则干扰）。 */
const run = (text) => checkNpmJson({ file: '/repo/package.json', text, rules: RULES, repoPath: '' });
const hits = (text, rule) => run(text).filter((f) => f.rule === rule);
const has = (text, rule) => hits(text, rule).length > 0;
const msg = (text, rule) => hits(text, rule)[0]?.message || '';

test('license：UNLICENSED 报 warning，MIT 不报', () => {
  assert.equal(has('{"name":"a","license":"UNLICENSED"}', 'npm/license-unlicensed'), true);
  assert.match(msg('{"name":"a","license":"UNLICENSED"}', 'npm/license-unlicensed'), /UNLICENSED/);
  assert.equal(has('{"name":"a","license":"MIT"}', 'npm/license-unlicensed'), false);
  assert.equal(hits('{"name":"a","license":"PROPRIETARY"}', 'npm/license-unlicensed')[0]?.severity, 'warning');
});

test('files：敏感条目升级为 blocker（.env / credential / *.pem / node_modules）', () => {
  const text = '{"name":"a","files":["lib",".env","config/credentials.json","certs/key.pem","node_modules"]}';
  const f = hits(text, 'npm/files-risky-entry');
  assert.equal(f.length, 4, `应报 4 条敏感条目，实得 ${f.length}`);
  assert.ok(f.every((x) => x.severity === 'blocker'), '敏感条目应为 blocker（凭据随包发布不可逆）');
});

test('files：体积产物按规则严重度报（*.tgz / music / 字体）；普通白名单不报', () => {
  const text = '{"name":"a","files":["lib","dist/a.tgz","music","assets/x.woff2"]}';
  const f = hits(text, 'npm/files-risky-entry');
  assert.equal(f.length, 3, `应报 3 条产物条目，实得 ${f.length}`);
  assert.ok(f.every((x) => x.severity === 'warning'), '产物条目应为 warning');
  assert.equal(has('{"name":"a","files":["lib","skills","README.md"]}', 'npm/files-risky-entry'), false);
});

test('meta：缺 author/keywords/bugs/homepage 逐个列出，齐全不报', () => {
  const m = msg('{"name":"a"}', 'npm/meta-incomplete');
  for (const k of ['author', 'keywords', 'bugs', 'homepage']) assert.match(m, new RegExp(k), `应列出缺 ${k}`);
  const full = '{"name":"a","author":"x","keywords":["dsh"],"bugs":"https://x/y/issues","homepage":"https://x/y"}';
  assert.equal(has(full, 'npm/meta-incomplete'), false, '元信息齐全不应报');
});

test('prepack：有 prepack/prepare/publishOnly 提示，非发布脚本不报', () => {
  assert.equal(has('{"name":"a","scripts":{"prepack":"node build.mjs"}}', 'npm/prepack-script-present'), true);
  assert.match(msg('{"name":"a","scripts":{"prepare":"x","publishOnly":"y"}}', 'npm/prepack-script-present'), /prepare.*publishOnly/);
  assert.equal(has('{"name":"a","scripts":{"test":"node t.mjs"}}', 'npm/prepack-script-present'), false, '非发布脚本不应报');
});

test('peer：无显式上界提示；有上界 / * / 私有包不报', () => {
  assert.equal(hits('{"name":"a","peerDependencies":{"x":"^4.1.0"}}', 'npm/peer-range-unbounded').length, 1);
  assert.equal(has('{"name":"a","peerDependencies":{"x":">=0.1.6-0 <0.3.0-0"}}', 'npm/peer-range-unbounded'), false, '显式区间不应报');
  assert.equal(has('{"name":"a","peerDependencies":{"x":"*"}}', 'npm/peer-range-unbounded'), false, '* 交由 star 规则管辖');
  assert.equal(has('{"name":"a","private":true,"peerDependencies":{"x":"^4.1.0"}}', 'npm/peer-range-unbounded'), false, '私有包不报');
});

test('合规样例（本仓库形态）只命中 prepack 提示这一条', () => {
  const text = JSON.stringify({
    name: 'dsh-demo', version: '1.0.0', license: 'MIT', author: 'x', keywords: ['dsh'],
    bugs: 'https://x/y/issues', homepage: 'https://x/y#readme',
    files: ['lib', 'skills', 'scripts', 'cli.mjs', 'README.md', 'LICENSE', '.gitignore'],
    peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.1.6-0 <0.3.0-0' },
    scripts: { prepare: 'node scripts/build-client.mjs', test: 'node test/run-tests.mjs' },
  });
  const ids = run(text).map((f) => f.rule).sort();
  assert.deepEqual(ids, ['npm/prepack-script-present'], `应只命中 prepack，实得：${ids.join(', ')}`);
});
