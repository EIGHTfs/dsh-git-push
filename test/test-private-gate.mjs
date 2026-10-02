/**
 * 私有库豁免回归检测（README「④ 私有库豁免（private 槽位按远端可见性分级）」）。
 *
 * 回归现场：GitHub private 仓库（ai-work-archive）被 192 条 conv-* blocker 拦下——
 *   runAudit 的拦截判定只看「示例目录」，**没有任何可见性分级**；而 comment 槽位（conv-*）、
 *   docs 槽位、security 槽位等规则不受 private 槽位（凭据 glob）的可见性分级约束，于是
 *   「工作留痕（会话记录）」在私有仓库里照样被拦。README 明确承诺：
 *   「私密文件与工作留痕（会话记录/凭据/留痕）在私有仓库可正常提交推送，不需要额外豁免标记」。
 *
 * 本测试用 visibility 注入（免网络、免真实远端、免 git 仓库）验证三档行为：
 *   private → 只报告不拦截；public / unknown → 保守拦截（不误放公开库）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAudit } from '../lib/commit-push.js';

/** 审计配置：全量 + 不限文件数，确保扫到 fixture（不走 diff 范围）。 */
const CFG = { auditEnabled: true, auditScanScope: 'full', maxScanFiles: 0, auditDisabledSlots: [] };

/**
 * 造一个含 blocker 触发点的临时目录。
 * 触发词运行时拼接：避免测试源码自身命中 documentation/comment-suspicious-detection 黑名单。
 * 不建 git 仓库——audit collector 对非 git 目录有兜底（`.auditignore` 同源实现）。
 * @returns {string} 临时目录绝对路径
 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'gitpush-private-gate-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  const trigger = `${['用户', '原话'].join('')}：该注释命中 comment-suspicious-detection`;
  writeFileSync(join(dir, 'src', 'sample.js'), `// ${trigger}\nexport const a = 1;\n`);
  return dir;
}

test('私有库豁免：visibility=private 时 blocker 只报告不拦截', async () => {
  const dir = fixture();
  try {
    const r = await runAudit({ repoPath: dir, audit: true, cfg: CFG, visibility: 'private' });
    assert.equal(r.ok, true, '私有库不得被 blocker 拦截（README ④ 私有库豁免）');
    assert.equal(r.blocked, undefined, '不得返回 blocked 标记');
    assert.ok(r.audit?.privateExempt, '应带 privateExempt 标记（可见性 + 被降级的拦截数）');
    assert.ok((r.audit.blocked || []).length > 0, '明细仍须保留——只报告不拦截，不能连报告一起丢');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('公开库：visibility=public 时 blocker 仍拦截（红线不放松）', async () => {
  const dir = fixture();
  try {
    const r = await runAudit({ repoPath: dir, audit: true, cfg: CFG, visibility: 'public' });
    assert.equal(r.ok, false, '公开库必须拦截');
    assert.equal(r.blocked, true);
    assert.match(String(r.error), /审计拦截/, '错误信息应说明拦截原因');
    assert.ok(!r.audit?.privateExempt, '公开库不得出现 privateExempt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('不可判定：visibility=unknown 时保守拦截', async () => {
  const dir = fixture();
  try {
    const r = await runAudit({ repoPath: dir, audit: true, cfg: CFG, visibility: 'unknown' });
    assert.equal(r.ok, false, '可见性不可判定时保守拦截（不得误放公开库）');
    assert.equal(r.blocked, true);
    assert.ok(!r.audit?.privateExempt, 'unknown 不得被当作 private 放行');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
