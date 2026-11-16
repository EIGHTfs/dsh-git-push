/**
 * 宿主如何消费审计结果（不依赖真预处理实现）。
 *
 * 为什么要这个文件：审计是可热插拔的扩展能力，宿主 CI 不安装它。
 *   于是「宿主拿到审计结论后怎么处理」这部分必须有守门，否则扩展一拔掉，
 *   拦截逻辑坏掉也没人发现。这里全部用假引擎（test/helpers/mock-preprocess.mjs）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { setSettingsFileOverride } from '../../lib/app/settings-bridge.js';

import { runAudit } from '../../lib/commit-push.js';
import { withMockPreprocess } from '../helpers/mock-preprocess.mjs';
import { hasPreprocessProvider } from '../helpers/provider-available.mjs';

test('假引擎报 blocker → 提交被拦（blocked=true + 拦截清单）', async () => {
  const r = await runAudit({ repoPath: tmpdir(), cfg: withMockPreprocess({ auditEnabled: true }, 'blocked'), visibility: 'public' });
  assert.equal(r.ok, false, '有 blocker 必须拦');
  assert.equal(r.blocked, true);
  assert.equal(r.audit.blocked.length, 1, '拦截清单应带上被拦的 finding');
  // 文案由扩展提供：有预处理实现时是「审计拦截：…」，无包时走宿主中性兜底「提交前检查拦截：…」。
  //   两种都必须能认出「这次是提交前检查拦的」，所以不能只认一种措辞。
  assert.match(String(r.error || ''), /审计拦截|提交前检查拦截/, '拦截文案要说清是提交前检查拦的');
});

test('假引擎无问题 → 提交放行', async () => {
  const r = await runAudit({ repoPath: tmpdir(), cfg: withMockPreprocess({ auditEnabled: true }, 'ok'), visibility: 'public' });
  assert.equal(r.ok, true);
  assert.equal(r.blocked ?? false, false);
  assert.equal(r.audit.blocked.length, 0);
});

test('假引擎执行失败（exit 2）→ fail-closed（引擎坏了不能当没问题）', async () => {
  const r = await runAudit({ repoPath: tmpdir(), cfg: withMockPreprocess({ auditEnabled: true }, 'fail') });
  assert.equal(r.ok, false, '引擎执行失败必须拦住，不能放行');
  assert.equal(r.audit, null);
  assert.match(String(r.error || ''), /预处理失败|失败/);
});

// 热插拔的关键一条：**没装预处理实现时主流程照常**（不是拦住要求装包）。
// 有包时这条无从验证（缺包场景不存在），故 skip；CI（不装包）会真正跑它。
test('预处理实现缺失 → 提交放行并标注 preprocessSkipped（热插拔）', {
  skip: hasPreprocessProvider ? '本机已安装预处理实现：缺包场景只在未装包的 CI 环境出现' : false,
}, async () => {
  // 必须隔离宿主真实 config.json：开发机可能显式配了 preCommit（指向本地预处理实现），
  //   那走的是「显式配置」分支，验不到「缺省解析 + 包缺失」这一档。
  const emptyDir = mkdtempSync(join(tmpdir(), 'dshgp-nopkg-'));
  const emptyCfg = join(emptyDir, 'config.json');
  writeFileSync(emptyCfg, '{}');
  setSettingsFileOverride(emptyCfg);
  try {
    // 必须显式开审计：cfg 里 auditEnabled 缺省为 false 时 runAudit 直接返回，走不到引擎解析
    const r = await runAudit({ repoPath: tmpdir(), cfg: { auditEnabled: true } });
  assert.equal(r.ok, true, '扩展不在位不该拦住主流程');
  assert.equal(r.audit, null);
  assert.equal(r.preprocessSkipped, 'package-not-found', '必须显式标注本次未审计，不能静默');
    assert.ok(r.skipReason, '要给出为什么没审计');
  } finally {
    setSettingsFileOverride(null);
    rmSync(emptyDir, { recursive: true, force: true });
  }
});
