/**
 * 回归测试：`auditRuleOrder`（规则槽位**加载顺序**）不得被当成槽位白名单 ✗。
 *
 * 历史缺陷（实测）：lib/commit-push.js 把 cfg.auditRuleOrder 当 slots 传给 loadRuleFiles，
 *   而后者把 slots 当「只加载列出的包」⇒ 清单外的包（python/cpp/go/java/php/rust/swift/template）
 *   被**静默丢弃** ✗ —— 一个 105 个 .py 的项目上 7 条 python/* 规则零命中、连 python 槽位都没有；
 *   把该字段置空后同一项目 60 条 → 197 条、python/* 命中 0 → 5 ✓。
 *
 * 测试策略（为什么不用临时仓库夹具 ✗）：
 *   实测临时仓库（已 init/add/commit + full 范围）**任何规则都不命中**（files 未定义、总发现 0）——
 *   审计不采集那种裸仓库的文件，用它当夹具会得出「修复无效」的**假红** ✗。
 *   故改为：① 源码级断言（4 个调用点不再把顺序当白名单）+ ② 真实项目守卫式断言（克隆缺失则跳过）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAudit } from '../lib/commit-push.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('源码级：commit-push.js 的 slotOrder 不得再取 cfg.auditRuleOrder', () => {
  const src = read('lib/commit-push.js');
  assert.match(src, /const slotOrder = Array\.isArray\(slots\) && slots\.length \? slots : undefined;/,
    'slotOrder 只能取显式传入的 slots（配置里的顺序不是白名单）');
  assert.ok(!/: Array\.isArray\(cfg\.auditRuleOrder\)/.test(src),
    '不得把 cfg.auditRuleOrder 当作 slots 的来源 ✗');
});

test('源码级：工具与 API 两条路也不再把 auditRuleOrder 当 slots', () => {
  for (const f of ['lib/app/tool-call.js', 'lib/app/audit-api.js']) {
    const src = read(f);
    assert.ok(!/slots:\s*cfg\.auditRuleOrder/.test(src), `${f} 仍在把 auditRuleOrder 当白名单 ✗`);
    assert.match(src, /slots: undefined,/, `${f} 应显式传 slots: undefined（全加载）`);
  }
});

test('源码级：禁用机制仍走 auditDisabledSlots（不能一起删掉）', () => {
  assert.match(read('lib/commit-push.js'), /disabledSlots: Array\.isArray\(cfg\.auditDisabledSlots\)/,
    'auditDisabledSlots 才是禁用机制，必须保留');
});

// ── 守卫式真实项目回归：克隆存在才跑（缺失则跳过，不阻塞他人）──
const REAL = '/volume1/VirtualDSM/DeepSeekHarness/工作区/d3dxSkinManage';

test('真实项目回归：105 个 .py 的项目上 python/* 规则必须命中（修复前为 0）',
  { skip: !existsSync(REAL) ? '未找到 d3dxSkinManage 克隆，跳过真实项目回归' : false },
  async () => {
    const r = await runAudit({
      repoPath: REAL,
      audit: true,
      cfg: { auditEnabled: true, auditScanScope: 'full', maxScanFiles: 500000, auditRuleOrder: [], auditDisabledSlots: [] },
    });
    const a = r.audit || {};
    const all = [...(a.blocked || []), ...(a.warnings || []), ...(a.notices || [])];
    const py = all.filter((f) => /^python\//.test(String(f.rule || '')));
    assert.ok(py.length > 0,
      `python/* 规则必须命中（该字段为「顺序」不是白名单 ✗）——实得 ${py.length} 条，总发现 ${all.length} 条`);
  });
