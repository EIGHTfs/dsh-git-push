/**
 * 宿主如何消费审计结果（不依赖真审计包）。
 *
 * 为什么要这个文件：审计是可热插拔的扩展能力，宿主 CI 不安装它。
 *   于是「宿主拿到审计结论后怎么处理」这部分必须有守门，否则扩展一拔掉，
 *   拦截逻辑坏掉也没人发现。这里全部用假引擎（test/helpers/mock-audit.mjs）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';

import { runAudit } from '../../lib/commit-push.js';
import { withMockAudit } from '../helpers/mock-audit.mjs';
import { hasAuditPackage } from '../helpers/audit-available.mjs';

test('假引擎报 blocker → 提交被拦（blocked=true + 拦截清单）', async () => {
  const r = await runAudit({ repoPath: tmpdir(), cfg: withMockAudit({ auditEnabled: true }, 'blocked'), visibility: 'public' });
  assert.equal(r.ok, false, '有 blocker 必须拦');
  assert.equal(r.blocked, true);
  assert.equal(r.audit.blocked.length, 1, '拦截清单应带上被拦的 finding');
  assert.match(String(r.error || ''), /审计拦截/, '拦截文案要说清是审计拦的');
});

test('假引擎无问题 → 提交放行', async () => {
  const r = await runAudit({ repoPath: tmpdir(), cfg: withMockAudit({ auditEnabled: true }, 'ok'), visibility: 'public' });
  assert.equal(r.ok, true);
  assert.equal(r.blocked ?? false, false);
  assert.equal(r.audit.blocked.length, 0);
});

test('假引擎执行失败（exit 2）→ fail-closed（引擎坏了不能当没问题）', async () => {
  const r = await runAudit({ repoPath: tmpdir(), cfg: withMockAudit({ auditEnabled: true }, 'fail') });
  assert.equal(r.ok, false, '引擎执行失败必须拦住，不能放行');
  assert.equal(r.audit, null);
  assert.match(String(r.error || ''), /预处理失败|失败/);
});

// 热插拔的关键一条：**没装审计包时主流程照常**（不是拦住要求装包）。
// 有包时这条无从验证（缺包场景不存在），故 skip；CI（不装包）会真正跑它。
test('审计包缺失 → 提交放行并标注 auditSkipped（热插拔）', {
  skip: hasAuditPackage ? '本机已安装审计包：缺包场景只在未装包的 CI 环境出现' : false,
}, async () => {
  const r = await runAudit({ repoPath: tmpdir(), cfg: {} });
  assert.equal(r.ok, true, '扩展不在位不该拦住主流程');
  assert.equal(r.audit, null);
  assert.equal(r.auditSkipped, 'package-not-found', '必须显式标注本次未审计，不能静默');
  assert.ok(r.skipReason, '要给出为什么没审计');
});
