/**
 * 审计误报防线回归（2026-10-17 · 由 ZipCalm 项目反馈驱动，三件事）
 *
 * ① button/unbound：Vue 的 `@click`/`v-on:click` 写在按钮元素上 = 已绑定（旧判据只认 React 的 onClick
 *    ⇒ ZipCalm 16 条全误报）；静态 `disabled` 按钮不可点 ⇒ 无绑定诉求；同一行多路提取只报一条（去重）
 * ② robustness/mkdir-before-write：写目标来自调用方（形参 / 形参成员 / 由形参派生的同目录临时路径）
 *    ⇒ 目录创建责任不在本函数 ⇒ 豁免；但 `join(dir,'sub','a.json')` 这类**新增路径段**仍须报 ✓
 * ③ 拦截级枚举口径统一：summary.blocker 与各处 blocked[] 枚举必须相等（error 也算拦截级）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { auditWithScope } from '../lib/audit/orchestrate.js';
import { hasMkdirInSameFunction, isBestEffortWrite } from '../lib/audit/file-context.js';
import { summarize, isBlockerFinding } from '../lib/audit/index.js';
import { hasForeignWriteTarget } from '../lib/audit/index.js';
import { runAuditApi } from '../lib/app/audit-api.js';
import { mkdtempTracked } from './helpers/tmp-dir.mjs';

/** 造一个含指定文件的临时仓库。 */
function repo(files) {
  const root = mkdtempTracked('fp-guard-');
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text, 'utf8');
  }
  return root;
}

test('button/unbound：Vue @click 与静态 disabled 按钮都不报；真正未绑定的仍报且只报一条', async () => {
  const root = repo({
    'web/Bound.vue': '<template>\n  <button class="x" @click="go()">有绑定</button>\n  <button class="y" v-on:click.stop="go2()">修饰符</button>\n</template>\n',
    'web/Disabled.vue': '<template>\n  <button type="button" disabled title="未结束">删除</button>\n</template>\n',
    'web/Unbound.js': 'export function render() {\n  const el = document.createElement("div");\n  el.innerHTML = `<button class="retry-btn">重试</button>`;\n  document.body.appendChild(el);\n}\n',
  });
  const r = await auditWithScope(root, { scope: 'full', maxScanFiles: 200, disabledSlots: [] });
  const hits = (r.findings || []).filter((f) => f.rule === 'button/unbound');
  assert.equal(hits.length, 1, `只应报 Unbound.js 那一个真未绑定按钮，实际 ${hits.length}：${JSON.stringify(hits.map((h) => h.file))}`);
  assert.match(String(hits[0].file), /Unbound\.js$/, '命中的必须是真的未绑定文件');
});

test('mkdir-before-write：写目标来自调用方 ⇒ 豁免；本地 join 新增子目录 ⇒ 仍报', async () => {
  const root = repo({
    'store.js': 'import fs from "node:fs";\nimport { join } from "node:path";\n'
      + 'export function save(dir) {\n  const out = join(dir, "sub", "a.json");\n  fs.writeFileSync(out, "{}");\n}\n'
      + 'export function saveForeign(ctx) {\n  fs.writeFileSync(ctx.outPath, "{}");\n}\n'
      + 'export function saveTmp(ctx) {\n  const p = `${ctx.base}.tmp`;\n  fs.writeFileSync(p, "x");\n}\n',
  });
  const r = await auditWithScope(root, { scope: 'full', maxScanFiles: 100, disabledSlots: [] });
  const hits = (r.findings || []).filter((f) => f.rule === 'robustness/mkdir-before-write');
  assert.equal(hits.length, 1, `应只报本地新增子目录那一处，实际 ${hits.length}`);
});

test('hasForeignWriteTarget：形参 / 形参成员 / 由形参派生的临时路径 = 外来目标', () => {
  const lines = [
    'export function write(ctx, name) {',            // 1
    '  fs.writeFileSync(ctx.out, "x");',              // 2 形参成员 ⇒ 外来
    '  fs.writeFileSync(name, "x");',                 // 3 形参 ⇒ 外来
    '  const p = `${ctx.base}.tmp`;',                 // 4
    '  fs.writeFileSync(p, "x");',                    // 5 由形参派生 ⇒ 外来
    '  const q = path.join(ctx.base, "sub", "a");',   // 6
    '  fs.writeFileSync(q, "x");',                    // 7 新增路径段 ⇒ 非外来（须报）
    '}',                                              // 8
  ];
  assert.equal(hasForeignWriteTarget(lines, 1), true, '形参成员应判外来');
  assert.equal(hasForeignWriteTarget(lines, 2), true, '形参本身应判外来');
  assert.equal(hasForeignWriteTarget(lines, 4), true, '由形参派生的同目录临时路径应判外来');
  assert.equal(hasForeignWriteTarget(lines, 6), false, 'join 新增路径段不算外来（仍需报）');
});

test('拦截级口径统一：summary.blocker == 各处枚举数（error 也属拦截级）', async () => {
  const root = repo({
    // 语法错误 ⇒ 产生 error 级 finding（error 归入拦截级，却曾被 blocked 枚举漏掉）
    'bad.js': 'export const a = ;\n',
    'ok.js': 'export const b = 1;\n',
  });
  const r = await auditWithScope(root, { scope: 'full', maxScanFiles: 100, disabledSlots: [] });
  const s = summarize(r.findings || []);
  assert.equal(s.blocker, (r.findings || []).filter(isBlockerFinding).length, 'summarize 与统一判据必须一致');
  const api = await runAuditApi(root, { scope: 'full' }, {});
  assert.equal(api.summary.blocker, (api.blocked || []).length,
    `上报面枚举数必须等于 summary.blocker（曾出现 10 vs 7：差的正是 error 级）`);
});

/* ───────── mkdir-before-write：封装命名 + 一层间接 + 远距离 mkdir（2026-11-01 外部样本） ───────── */

test('mkdir-before-write：ensureDir 封装（同模块导出的 helper）视为已建目录', () => {
  // 样本结构取自外部会话的逐行实证（atomic-json.mjs）：写语句上一行就是 ensureDir(...)，
  //   而 ensureDir 的函数体里有 mkdirSync ⇒ 一层间接，应豁免。
  const lines = [
    'export function ensureDir(dir) { return fs.mkdirSync(dir, { recursive: true, mode: 0o755 }); }',
    '',
    'export function writeJsonAtomic(file, data) {',
    '  ensureDir(path.dirname(file));',
    '  fs.writeFileSync(file, JSON.stringify(data));',
    '}',
  ];
  assert.equal(hasMkdirInSameFunction(lines, 4), true, 'ensureDir 调用应视为已建目录');
});

test('mkdir-before-write：mkdir 在函数更早处（相距 70+ 行）仍视为已建目录', () => {
  const lines = ['function big(dir, file) {', '  fs.mkdirSync(dir, { recursive: true });'];
  for (let i = 0; i < 70; i++) lines.push(`  const v${i} = ${i};`);
  lines.push('  fs.writeFileSync(file, "x");');
  lines.push('}');
  const idx = lines.length - 2;
  assert.equal(hasMkdirInSameFunction(lines, idx), true, '远距离 mkdir 不应因为窗口小而被忽略');
});

test('mkdir-before-write：真的没有 mkdir ⇒ 仍要报（不能靠放宽判据把真问题洗掉）', () => {
  const lines = [
    'export function save(file, data) {',
    '  const text = JSON.stringify(data);',
    '  fs.writeFileSync(file, text);',
    '}',
  ];
  assert.equal(hasMkdirInSameFunction(lines, 2), false, '无任何建目录迹象时必须继续报');
});

test('mkdir-before-write：别的函数里有 mkdir 不算（作用域必须是本函数体）', () => {
  const lines = [
    'function other(dir) {',
    '  fs.mkdirSync(dir, { recursive: true });',
    '}',
    'export function save(file, data) {',
    '  fs.writeFileSync(file, data);',
    '}',
  ];
  assert.equal(hasMkdirInSameFunction(lines, 4), false, '不得跨函数借用 mkdir');
});

/* ───────── mkdir-before-write：三个真实样本（2026-11-01 复测反馈） ───────── */

test('mkdir 紧邻上一行、实参是 path.dirname(临时名) ⇒ 视为已建目录', () => {
  const lines = [
    'export function saveConfig(roots) {',
    "  const header = '// cfg';",
    '  const body = JSON.stringify({ roots }, null, 2);',
    "  fs.mkdirSync(path.dirname(CONFIG_FILE + '.tmp'), { recursive: true });",
    "  fs.writeFileSync(CONFIG_FILE + '.tmp', header + body + '\\n', 'utf8');",
    '}',
  ];
  assert.equal(hasMkdirInSameFunction(lines, 4), true);
});

test('同文件**私有** ensureDir + 调用在 for 循环体内 ⇒ 视为已建目录', () => {
  const lines = [
    'function ensureDir(dir) {',
    '  fs.mkdirSync(dir, { recursive: true });',
    '}',
    '',
    'export async function writeResult({ res }) {',
    '  try {',
    '    for (const { path: relPath } of res.files.entries) {',
    '      const dst = path.join(tmpDir, "files", relPath);',
    '      ensureDir(path.dirname(dst));',
    '      fs.writeFileSync(dst, bytes);',
    '    }',
    '  } catch (e) { throw e; }',
    '}',
  ];
  assert.equal(hasMkdirInSameFunction(lines, 9), true);
});

test('写在 try 内、catch 兜底 ⇒ 判为 best-effort（可降级为提示）', () => {
  const lines = [
    'export function touch(fp, index) {',
    '  try {',
    '    fs.writeFileSync(indexPath(fp), JSON.stringify(index), "utf8");',
    '  } catch { /* 只影响 LRU 精度 */ }',
    '}',
  ];
  assert.equal(isBestEffortWrite(lines, 2), true);
  assert.equal(isBestEffortWrite(lines, 0), false, '函数签名行不在任何 try 块内');
});

test('normal write（无 try）⇒ 不算 best-effort', () => {
  const lines = ['export function save(f, d) {', '  fs.writeFileSync(f, d);', '}'];
  assert.equal(isBestEffortWrite(lines, 1), false);
});

test('mkdir 在**另一个**顶层函数里 ⇒ 不借用（跨函数静态证明不了，仍需报）', () => {
  const lines = [
    'function prepare(dir) {',
    '  fs.mkdirSync(dir, { recursive: true });',
    '}',
    'function write(f, d) {',
    '  fs.writeFileSync(f, d);',
    '}',
  ];
  assert.equal(hasMkdirInSameFunction(lines, 4), false);
});
