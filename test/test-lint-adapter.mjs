/**
 * 外部 linter 委托层（方向 A）骨架测试 —— **不依赖真实 ruff**（本机未装，按「先写骨架」口径用假二进制）。
 *
 * 钉死四条契约（用户 2026-11-06 确立的两条硬约束 + D5）：
 *   ① 只进评分与报告、**绝不进拦截门禁**：外部 finding severity 恒 warning，
 *      isBlockerFinding 判 false，提交门禁的 blocked 过滤选不中它。
 *   ② 探不到/跑不动/崩溃/坏输出 **一律降级为空**，不抛错、不把「ruff 崩了」当「无问题」（假阴性）。
 *   ③ 探测：项目有 [tool.ruff] 配置且 tools/ 有可执行才委托；缺工具即不委托。
 *   ④ 适配映射：ruff 规则码 → 维度、相对路径口径、message 带来源。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import '../lib/rule/compilers.js';
import { detectLinters } from '../lib/lint-adapter/detect.js';
import { runLinter, ruffItemToFinding } from '../lib/lint-adapter/runner.js';
import { runLintAdapters } from '../lib/lint-adapter/index.js';
import { isBlockerFinding, summarize } from '../lib/audit/finding.js';
import { auditFull } from '../lib/audit/index.js';

/** 造一个带 [tool.ruff] 配置的临时项目，并可放置假 ruff 可执行。 */
function makeProject({ withRuff = false, script = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-lint-'));
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname="x"\nversion="1.0.0"\n\n[tool.ruff]\nline-length = 120\n');
  mkdirSync(join(dir, 'pkg'), { recursive: true });
  writeFileSync(join(dir, 'pkg', 'a.py'), 'def f(a,b):\n    return a+b\n');
  if (withRuff) {
    mkdirSync(join(dir, 'tools'), { recursive: true });
    const bin = join(dir, 'tools', 'ruff');
    writeFileSync(bin, `#!/bin/sh\n${script}\n`);
    chmodSync(bin, 0o755);
  }
  return dir;
}

// ───────────── ③ 探测 ─────────────
test('③ 探测：有 [tool.ruff] 配置 + tools/ruff 可执行 → 委托；缺工具/缺配置 → 不委托', async () => {
  const withBin = makeProject({ withRuff: true, script: 'echo "ruff 0.17.2"' });
  try {
    const found = detectLinters(withBin);
    assert.equal(found.length, 1, '有配置有工具应探测到一个 linter');
    assert.equal(found[0].key, 'ruff');
    assert.match(found[0].version, /ruff/, '应取到版本（拿不到也不阻断）');
  } finally { rmSync(withBin, { recursive: true, force: true }); }

  // 有配置、无可执行 → 空（降级）。用**子进程**跑并传干净 env（PATH 指向空目录、清掉 env 覆盖），
  //   不在本进程改 process.env.PATH —— run-tests 批内是并发的（node --test-concurrency），
  //   改共享 env 会污染同批其它用例。子进程法与 test-tree-first-credential 的无树对照同构，
  //   且这样在「装了 ruff 的机器/CI」上也不会假失败（原写法依赖本机恰好没装）。
  const cfgOnly = makeProject({ withRuff: false });
  const emptyBin = mkdtempSync(join(tmpdir(), 'dshgp-lint-nopath-'));
  try {
    const script = [
      `import { detectLinters } from ${JSON.stringify(join(import.meta.dirname, '..', 'lib', 'lint-adapter', 'detect.js'))};`,
      `console.log(JSON.stringify(detectLinters(${JSON.stringify(cfgOnly)})));`,
    ].join('\n');
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, PATH: emptyBin, DSH_GIT_PUSH_RUFF: '' },
      encoding: 'utf8', timeout: 60000,
    });
    assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), [], '缺工具必须不委托（降级回自研）');
  } finally {
    rmSync(emptyBin, { recursive: true, force: true });
    rmSync(cfgOnly, { recursive: true, force: true });
  }
});

// ───────────── ④ 适配映射 ─────────────
test('④ 适配：ruff JSON 条目 → finding（维度映射 / 相对路径 / 来源标记）', () => {
  const repo = '/tmp/proj';
  const mk = (code, msg, file, row) => ruffItemToFinding(
    { code, message: msg, filename: `${repo}/${file}`, location: { row, column: 1 } }, repo);

  const f1 = mk('F401', '`os` imported but unused', 'pkg/a.py', 3);
  assert.equal(f1.rule, 'ruff/F401');
  assert.deepEqual(f1.dimensions, ['健壮性', '可维护性'], 'Pyflakes 未用导入 → 健壮性+可维护性');
  assert.equal(f1.file, 'pkg/a.py', '必须转成相对仓库根路径（不外泄本机绝对路径）');
  assert.equal(f1.source, 'linter:ruff');

  assert.deepEqual(mk('S105', 'hardcoded password', 'a.py', 1).dimensions, ['安全性'], 'bandit → 安全性');
  assert.deepEqual(mk('E501', 'line too long', 'a.py', 1).dimensions, ['可读性'], 'pycodestyle → 可读性');
  assert.deepEqual(mk('XYZ9', 'unknown', 'a.py', 1).dimensions, ['可维护性'], '未知前缀兜底可维护性');
  assert.equal(ruffItemToFinding(null, repo), null, '空条目丢弃不抛');
});

// ───────────── ① 只评分不拦截 ─────────────
test('① 硬约束：外部 finding severity 恒 warning，即便 ruff 判 error 级规则也不进拦截', async () => {
  // 假 ruff：输出含 E902（ruff 的真错误级语法错误）——委托层仍必须只记 warning
  const dir = makeProject({ withRuff: true });
  const bin = join(dir, 'tools', 'ruff');
  writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n[{"code":"E902","message":"syntax error","filename":"pkg/bad.py","location":{"row":1,"column":1}}]\nEOF\nexit 2\n`);
  chmodSync(bin, 0o755);
  try {
    const res = await runLinter({ key: 'ruff', bin }, dir);
    // 退出码 2 是 ruff 真错误 → 降级空（不能把崩溃产出当判定结果）
    assert.deepEqual(res.findings, [], '退出码 2（真错误）必须降级');
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // 直接构造 ruff 的 error 级输出走适配：severity 仍必须是 warning
  const f = ruffItemToFinding({ code: 'E902', message: 'syntax error', filename: '/p/a.py', location: { row: 1 } }, '/p');
  assert.equal(f.severity, 'warning', 'ruff 判 error 级规则也封顶 warning（别人的规则集不裁决本仓提交）');
  assert.equal(isBlockerFinding(f), false);
});

// ───────────── ② 降级：崩溃不当「无问题」 ─────────────
test('② 降级：ruff 崩溃(退出码≥2)/非 JSON/可执行缺失 → 空 + note，绝不抛错', async () => {
  // 退出码 2 且 stdout 空 —— 最危险的情形：若被当「无问题」就是假阴性
  const crash = makeProject({ withRuff: true, script: 'echo "error: invalid config" >&2\nexit 2' });
  try {
    const r = await runLinter({ key: 'ruff', bin: join(crash, 'tools', 'ruff') }, crash);
    assert.deepEqual(r.findings, [], '崩溃必须产出空');
    assert.match(r.note, /降级|跳过/, 'note 要说明降级原因');
    assert.doesNotMatch(r.note, /无问题/, '不得表述成「外部判定无问题」（假阴性最隐蔽）');
  } finally { rmSync(crash, { recursive: true, force: true }); }

  // 退出码 1 + 合法 JSON = 正常有 lint 问题（不能当崩溃）
  const hit = makeProject({ withRuff: true, script: `cat <<'EOF'\n[{"code":"F401","message":"unused","filename":"a.py","location":{"row":2}}]\nEOF\nexit 1` });
  try {
    const r = await runLinter({ key: 'ruff', bin: join(hit, 'tools', 'ruff') }, hit);
    assert.equal(r.findings.length, 1, '退出码1是「有 lint 问题」，JSON 必须被采纳');
    assert.equal(r.findings[0].rule, 'ruff/F401');
  } finally { rmSync(hit, { recursive: true, force: true }); }

  // 可执行缺失（ENOSPC 之外的 ENOENT）
  const missing = await runLinter({ key: 'ruff', bin: '/nonexistent-ruff-bin' }, '/tmp');
  assert.deepEqual(missing.findings, []);
  assert.match(missing.note, /缺失|降级/);

  // 非 JSON 输出
  const junk = makeProject({ withRuff: true, script: 'echo not-json-at-all' });
  try {
    const r = await runLinter({ key: 'ruff', bin: join(junk, 'tools', 'ruff') }, junk);
    assert.deepEqual(r.findings, [], '坏输出降级为空');
    assert.match(r.note, /JSON|降级/);
  } finally { rmSync(junk, { recursive: true, force: true }); }
});

// ───────────── 端到端：编排接入 + 不抬 blocker ─────────────
test('端到端：auditFull 并入外部 finding 后计入评分与报告，但 blocker 不因委托增加', async () => {
  const dir = makeProject({ withRuff: true, script: `cat <<'EOF'\n[{"code":"F401","message":"unused import","filename":"pkg/a.py","location":{"row":1,"column":1}},{"code":"E501","message":"line too long","filename":"pkg/a.py","location":{"row":2,"column":1}}]\nEOF\nexit 1` });
  try {
    const la = await runLintAdapters(dir);
    assert.equal(la.findings.length, 2, '委托层产出两条');

    const before = await auditFull(dir, { lintAdapters: false });
    const after = await auditFull(dir, { lintAdapters: true, linters: [{ key: 'ruff', lang: 'py', bin: join(dir, 'tools', 'ruff'), version: '' }] });

    const rulesAfter = new Set(after.findings.map((f) => f.rule));
    assert.ok([...rulesAfter].some((r) => r.startsWith('ruff/')), '外部 finding 必须进报告');
    // linted（防静默空转）：委托了 ruff、产出条数、来源都应可见
    assert.ok(Array.isArray(after.linted) && after.linted.length === 1, '审计结果应带 linted 委托状态');
    assert.equal(after.linted[0].key, 'ruff');
    assert.equal(after.linted[0].count, 2, '本次委托产出 2 条应如实记录');
    const bBefore = summarize(before.findings).blocker;
    const bAfter = summarize(after.findings).blocker;
    assert.equal(bAfter, bBefore, `blocker 数不得因委托增加（before=${bBefore} after=${bAfter}）`);
    // 外部计入评分维度：after 的可维护性/健壮性计数应 ≥ before
    assert.ok(after.findings.length > before.findings.length, '外部 finding 应并入 findings');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
