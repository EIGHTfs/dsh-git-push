/**
 * 「审计 × 提交推送」边界回归测试。
 *
 * 为什么单独一个文件：既有测试只覆盖 `runAudit` 本身拦不拦（test-audit-bad-file.mjs），
 *   却**从没验证「拦截之后，提交与推送绝对不能发生」**——而这条边界一旦破了，
 *   后果是「审计说拦了、文件其实已经提交/推上去了」（比不拦更糟：用户以为没入库）。
 *
 * 覆盖的边界（每条都断言**真实 git 状态**，不只看返回值）：
 *   ① 审计命中 blocker ⇒ 不提交、不推送（HEAD / 提交数 / 工作区三处都不许动，且返回里没有 push/commitSha 字段）
 *   ② 审计通过 + 零改动 ⇒ ok:true + committed:false（审计不会把「没改动」变成失败），文案不含「跳过」
 *   ③ audit:false ⇒ 跳过审计直接提交（audit 为 null）；push:false ⇒ 只提交不推送
 *   ④ dryRun ⇒ 不写盘（HEAD 不变、改动仍在）
 *   ⑤ 开发者要求门禁与「有没有改动 / 是否推送」**无关**：未确认时，零改动 + push:false 也被 USER_REQUIREMENTS 拦下且不提交
 *   ⑥ 门禁顺序：要求门禁先于推送门禁（未确认 + pushGate 同开 ⇒ 报 USER_REQUIREMENTS 而非 PUSH_GATE）
 *   ⑦ pushGate 已开启且未放行（要求已确认）⇒ commit 落本地、推送被挡（不产生远端变更）
 *   ⑧ 没有 GitHub remote 时 push:true ⇒ 如实报「推送失败」（**真错误**，与「无新提交」是两回事，不许混淆）
 *
 * 全部在临时 git 仓里跑（不碰真实仓库、不动真实配置）。
 * 注意：本机插件配置里存在开发者要求清单 ⇒ 除刻意测门禁的两例外，其余都要带 requirementsConfirmed:true。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { commitWithAudit } from '../lib/commit-push.js';

/** 建一个有一次提交的临时 git 仓（审计 diff 范围需要一个 HEAD 作基线）。 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-audit-bound-'));
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.name', 'test']);
  git(['config', 'user.email', 'test@example.com']);
  writeFileSync(join(dir, 'README.md'), '# base\n', 'utf8');
  git(['add', '-A']);
  git(['commit', '-qm', 'base']);
  return dir;
}
const head = (dir) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
const commits = (dir) => Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim());
const porcelain = (dir) => execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim();

/** 写入一个必然命中 blocker 的文件（硬编码密码；触发内容与 test-audit-bad-file.mjs 同源）。 */
function stageBlocker(dir) {
  writeFileSync(join(dir, 'bad.js'), [
    '// 故意包含硬编码密码（审计 blocker 触发器）',
    'const dbPassword = "MyS3cretP@ss!";',
    'const connStr = "mysql://root:abc123@localhost/mydb";',
  ].join('\n'), 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir });
}

test('边界①：审计命中 blocker ⇒ 不提交、不推送（三处 git 状态都不许动）', async () => {
  const dir = makeRepo();
  const before = head(dir);
  const n0 = commits(dir);
  stageBlocker(dir);
  const r = await commitWithAudit({
    repoPath: dir, message: 'should not happen', push: true, audit: true, requirementsConfirmed: true,
  });
  assert.equal(r.ok, false, '有 blocker 必须失败');
  assert.equal(r.blocked, true, '必须标记 blocked');
  assert.match(r.error, /审计拦截/, '错误信息应说明是审计拦截（不是推送失败）');
  assert.ok(r.audit && r.audit.summary.blocker > 0, '应带审计摘要且 blocker > 0');
  // 最强证据：返回对象里根本没有提交/推送阶段的产物
  assert.equal(r.commitSha, undefined, '拦截时绝不能产生 commitSha（说明没进提交阶段）');
  assert.equal(r.push, undefined, '拦截时绝不能进入推送阶段');
  assert.equal(r.pushed, undefined, '拦截时不该有 pushed 字段');
  // 真实 git 状态三连：HEAD 未动、提交数未增、改动仍在（没被提交走）
  assert.equal(head(dir), before, 'HEAD 不许变化');
  assert.equal(commits(dir), n0, '提交数不许增加');
  assert.match(porcelain(dir), /bad\.js/, '问题文件应仍留在工作区（没有被提交进历史）');
});

test('边界②：真·零改动 ⇒ ok:true + committed:false（且文案不再用「跳过」）', async () => {
  const dir = makeRepo();
  // 先让插件把「自动补的 .gitignore」落地（见边界②b）——之后才是真正的「工作区干净」
  writeFileSync(join(dir, 'seed.js'), 'export const seed = 1;\n', 'utf8');
  const first = await commitWithAudit({ repoPath: dir, message: 'chore: 基线', push: false, audit: false, requirementsConfirmed: true });
  assert.equal(first.ok, true, '基线提交应成功');
  assert.equal(porcelain(dir), '', '基线后工作区应为干净');
  const before = head(dir);
  const r = await commitWithAudit({
    repoPath: dir, message: 'nothing to commit', push: false, audit: true, requirementsConfirmed: true,
  });
  assert.equal(r.ok, true, '零改动 + 审计通过 = 成功路径，不是失败');
  assert.equal(r.committed, false, '不应产生新提交');
  assert.equal(head(dir), before, 'HEAD 不许变化');
  assert.match(String(r.message || ''), /无变更/, '文案要说明是「无变更」');
  assert.doesNotMatch(String(r.message || ''), /跳过/, '成功路径文案不应再用「跳过」这种否定式措辞');
});

test('边界②b：仓库没有 .gitignore 时，零改动也不写 .gitignore、不产生提交（修复后行为）', async () => {
  const dir = makeRepo();
  const before = head(dir);
  const n0 = commits(dir);
  assert.equal(porcelain(dir), '', '起始工作区是干净的');
  const r = await commitWithAudit({ repoPath: dir, message: 'nothing', push: false, audit: false, requirementsConfirmed: true });
  // 修复前：steps 里先出现「敏感文件 .gitignore」⇒ .gitignore 被创建 ⇒ add 后不再干净 ⇒ 凭空一个提交 ✗
  // 修复后：工作区判定前置到写 .gitignore 之前 ⇒ 零改动直接走 clean-worktree，不写、不提交 ✓
  assert.equal(r.ok, true, '零改动是成功路径');
  assert.equal(r.committed, false, '不许凭空产生提交');
  assert.equal(head(dir), before, 'HEAD 不许变化');
  assert.equal(commits(dir), n0, '提交数不许增加');
  assert.doesNotMatch(String((r.steps || []).join(',')), /gitignore/i, 'steps 不该出现 .gitignore 写入');
  assert.ok(!existsSync(join(dir, '.gitignore')), '零改动时不该创建 .gitignore');
  assert.equal(porcelain(dir), '', '调用后工作区仍应干净');
});

test('边界②c：有真实改动时，.gitignore 自动补规则照常生效（修复没有砍掉该功能）', async () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'real.js'), 'export const real = 1;\n', 'utf8');
  const r = await commitWithAudit({ repoPath: dir, message: 'feat: 真实改动', push: false, audit: false, requirementsConfirmed: true });
  assert.equal(r.ok, true, '有改动应正常提交');
  assert.equal(r.committed, true, '应产生提交');
  assert.ok(existsSync(join(dir, '.gitignore')), '有改动时应照常补 .gitignore');
  assert.match(String((r.steps || []).join(',')), /gitignore/i, 'steps 应显示补了 .gitignore');
});

test('边界③：audit:false 跳过审计直接提交；push:false 只提交不推送', async () => {
  const dir = makeRepo();
  const n0 = commits(dir);
  writeFileSync(join(dir, 'ok.js'), 'export const ok = true;\n', 'utf8');
  const r = await commitWithAudit({ repoPath: dir, message: 'feat: 正常提交', push: false, audit: false, requirementsConfirmed: true });
  assert.equal(r.ok, true, '审计关闭时应正常提交');
  assert.equal(r.audit, null, '跳过审计时 audit 应为 null');
  assert.equal(r.committed, true, '应产生新提交');
  assert.equal(r.pushed, false, 'push:false 不许推送');
  assert.equal(commits(dir), n0 + 1, '提交数应 +1');
});

test('边界④：dryRun ⇒ 不写盘（HEAD 不变、改动仍在）', async () => {
  const dir = makeRepo();
  const before = head(dir);
  writeFileSync(join(dir, 'wip.js'), 'export const wip = 1;\n', 'utf8');
  const r = await commitWithAudit({ repoPath: dir, message: 'feat: 预演', push: false, dryRun: true, audit: false, requirementsConfirmed: true });
  assert.equal(r.ok, true, '预演应成功');
  assert.equal(head(dir), before, 'dryRun 不许产生提交');
  assert.match(porcelain(dir), /wip\.js/, 'dryRun 后改动应仍在工作区');
});

test('边界⑤：要求门禁与「有没有改动 / 是否推送」无关（零改动 + push:false 也拦，且不提交）', async () => {
  const dir = makeRepo();
  const before = head(dir);
  const n0 = commits(dir);
  const r = await commitWithAudit({ repoPath: dir, message: 'x', push: false, audit: false }); // 刻意不带 requirementsConfirmed
  assert.equal(r.ok, false, '存在要求清单且未核对 ⇒ 必须拦');
  assert.equal(r.code, 'USER_REQUIREMENTS', '应给出 USER_REQUIREMENTS 码');
  assert.match(r.error, /开发者特殊要求未核对/, '错误信息要指明是要求未核对');
  assert.equal(head(dir), before, '拦截时不许产生提交');
  assert.equal(commits(dir), n0, '提交数不许增加');
});

test('边界⑥：门禁顺序 —— 要求门禁先于推送门禁', async () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'x.js'), 'export const x = 1;\n', 'utf8');
  const r = await commitWithAudit({
    repoPath: dir, message: 'x', push: true, audit: false, pushGate: true, pushConfirmed: false, // 两个门禁同时开，且未确认要求
  });
  assert.equal(r.code, 'USER_REQUIREMENTS', '要求门禁在前：未核对要求时不该先报 PUSH_GATE');
});

test('边界⑦：pushGate 开启且未放行（要求已确认）⇒ commit 落本地、推送被挡', async () => {
  const dir = makeRepo();
  const n0 = commits(dir);
  writeFileSync(join(dir, 'b.js'), 'export const b = 1;\n', 'utf8');
  const r = await commitWithAudit({
    repoPath: dir, message: 'feat: 门禁测试', push: true, audit: false, requirementsConfirmed: true, pushGate: true, pushConfirmed: false,
  });
  assert.equal(r.ok, false, '推送被门禁挡住 ⇒ ok:false');
  assert.equal(r.code, 'PUSH_GATE', '应给出 PUSH_GATE 码');
  assert.equal(r.push && r.push.pushed, false, '不许推送');
  assert.equal(r.push && r.push.reason, 'push-gate', '原因应为 push-gate');
  assert.equal(commits(dir), n0 + 1, 'commit 应已落本地（门禁只挡推送，不重复提交）');
});

test('边界⑧：没有 GitHub remote 时 push:true ⇒ 如实报「推送失败」（区别于「无新提交」）', async () => {
  const dir = makeRepo();
  writeFileSync(join(dir, 'c.js'), 'export const c = 1;\n', 'utf8');
  const r = await commitWithAudit({ repoPath: dir, message: 'feat: 无远端', push: true, audit: false, requirementsConfirmed: true });
  assert.equal(r.ok, false, '没有可推的远端 ⇒ 必须如实失败，不许谎报成功');
  assert.match(String(r.error || ''), /推送失败/, '要说明是推送失败');
  assert.notEqual(r.pushed, true, '不许标记为已推送');
  assert.doesNotMatch(String(r.error || ''), /无新提交/, '「没有远端」与「无新提交」是两回事，文案不许混淆');
});
