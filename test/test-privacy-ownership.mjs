/**
 * 隐私/凭据类规则的**仓库归属门禁**回归。
 *
 * 规则由来（2026-10-28 用户确立）：隐私规则的目的是防止**自己的仓库**把隐私推到远端；
 *   克隆来的他人公开仓库里有什么邮箱/密钥与本次提交无关，报出来是纯噪声
 *   （实测：某第三方 Unity 项目 3 条 blocker 全是 LICENSE/ReadMe 里的作者邮箱——
 *   版权文件含作者邮箱是法律要求，根本不是隐私泄漏）。
 *   故：他人仓库 ⇒ 隐私规则关闭；判不出归属 ⇒ 照旧生效（保守，宁可多报不可漏报）。
 *
 * 架构约束：`lib/audit/**` 不得依赖 `lib/git/**`（审计按独立包设计）⇒ 归属**探测**放在装配层
 *   `lib/app/repo-ownership.js`，审计层 `lib/audit/ownership.js` 只有纯函数、只消费注入的字符串。
 *   本文件因此对两层分别验证：纯判定分支 + 端到端接线 + 装配层探测。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { classifyOwnership, privacyRulesEnabled, isPrivacyRule } from '../lib/audit/ownership.js';
import { probeRepoOwnership, resetRepoOwnershipCache, localLogin } from '../lib/app/repo-ownership.js';

test('classifyOwnership：三态与边界', () => {
  assert.equal(classifyOwnership('EIGHTfs', 'EIGHTfs'), 'own');
  assert.equal(classifyOwnership('EIGHTfs', 'someone'), 'foreign');
  assert.equal(classifyOwnership('', 'someone'), 'unknown', '本机 login 未知 → 不可判为他人仓库');
  assert.equal(classifyOwnership('EIGHTfs', ''), 'unknown', '仓库无 GitHub remote → 不可判为他人仓库');
  assert.equal(classifyOwnership('eightfs', 'EIGHTFS'), 'own', '归属比对必须大小写不敏感');
  // 已知局限：组织仓库的 owner 是组织名 ⇒ 判 foreign（保守方向：少报而非漏报）
  assert.equal(classifyOwnership('EIGHTfs', 'EIGHTfs-org'), 'foreign');
});

test('privacyRulesEnabled：仅他人仓库关闭，未知照旧生效', () => {
  assert.equal(privacyRulesEnabled('own'), true);
  assert.equal(privacyRulesEnabled('foreign'), false);
  assert.equal(privacyRulesEnabled('unknown'), true, '判不出归属时必须照旧生效（保守）');
});

test('isPrivacyRule：只认隐私/凭据类，不误伤其它规则', () => {
  for (const id of ['secret-email', 'secret-github-pat', 'credfile-common', 'credref-plain-secret']) {
    assert.equal(isPrivacyRule(id), true, `${id} 应属隐私类`);
  }
  for (const id of ['security/no-hardcoded-credentials', 'paths/hardcoded-absolute-path', 'max-lines', '']) {
    assert.equal(isPrivacyRule(id), false, `${id} 不应被当隐私类规则关掉`);
  }
});

test('端到端：他人仓库不报隐私，自有/未知照报', async () => {
  // 走完整入口 auditFull（自带规则加载与文件收集）：只测纯函数不够，
  //   接线层没接上会完全静默失效，必须端到端跑一遍。归属由装配层注入。
  const { auditFull } = await import('../lib/audit/orchestrate.js');
  const dir = mkdtempSync(join(tmpdir(), 'own-e2e-'));
  writeFileSync(join(dir, 'a.txt'), 'contact: someone@qq.com\n');
  try {
    const hits = async (ownership) => {
      const r = await auditFull(dir, { scope: 'full', maxScanFiles: 20, ownership });
      return (r.findings || []).filter((f) => /^secret-|^cred/.test(String(f.rule || '')));
    };
    const inForeign = await hits('foreign');
    const inOwn = await hits('own');
    const inUnknown = await hits('unknown');
    assert.equal(inForeign.length, 0, `他人仓库不应报隐私（实际：${JSON.stringify(inForeign.map((f) => f.rule))}）`);
    assert.ok(inOwn.length > 0, '自有仓库必须照报隐私（否则等于把自家隐私检查整个关掉了）');
    assert.ok(inUnknown.length > 0, '判不出归属时也必须照报（保守方向）');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('装配层 probeRepoOwnership：真实仓库能判出归属', async (t) => {
  if (!localLogin()) return t.skip('本机 GitHub login 未知（账号状态快照缺失），跳过装配层探测');
  resetRepoOwnershipCache();
  const dir = mkdtempSync(join(tmpdir(), 'own-probe-'));
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  try {
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/someone-else/demo.git'], { cwd: dir, stdio: 'ignore' });
    assert.equal(probeRepoOwnership(dir), 'foreign');
    execFileSync('git', ['remote', 'set-url', 'origin', `https://github.com/${localLogin()}/demo.git`], { cwd: dir, stdio: 'ignore' });
    resetRepoOwnershipCache();
    assert.equal(probeRepoOwnership(dir), 'own');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    resetRepoOwnershipCache();
  }
});
