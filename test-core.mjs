/** dsh-git-push 核心逻辑单测：扫描 + 提交推送（真实 git 操作，临时目录） */
import { scanRepos, commitAndPush, readRepoStatus, findGitDirs } from './lib/core.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

// 建临时 git 仓库
const root = mkdtempSync(join(tmpdir(), 'git-push-test-'));
const repoA = join(root, 'repo-a');
mkdirSync(repoA, { recursive: true });
execSync('git init -b master', { cwd: repoA, stdio: 'ignore' });
writeFileSync(join(repoA, 'a.txt'), 'hello\n');
execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m init', { cwd: repoA, stdio: 'ignore' });
const repoB = join(root, 'repo-b');
mkdirSync(repoB, { recursive: true });
execSync('git init -b master', { cwd: repoB, stdio: 'ignore' });
writeFileSync(join(repoB, 'b.txt'), 'world\n');
execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m init', { cwd: repoB, stdio: 'ignore' });

try {
  ok(findGitDirs(root, 2).length === 2, `findGitDirs 找到 ${findGitDirs(root, 2).length} 个仓库`);

  const repos = scanRepos({ root, depth: 2 });
  ok(repos.length === 2, `scanRepos 找到 ${repos.length} 个仓库`);
  ok(repos.every((r) => r.branch === 'master'), '分支识别为 master');
  ok(repos.every((r) => r.changes === 0), '初始无变更');

  // 改一个文件 → scan 应显示变更
  writeFileSync(join(repoA, 'a.txt'), 'hello world\n');
  const stA = readRepoStatus(repoA);
  ok(stA.changes === 1, `改动后 changes=${stA.changes}`);

  // commitAndPush 无 remote → push 报错但提交成功
  const r1 = commitAndPush({ repoPath: repoA, message: 'feat: 测试提交' });
  ok(r1.ok && r1.committed, 'commitAndPush 提交成功');
  ok(r1.commitId?.length >= 4, '返回 commitId');
  ok(r1.push?.pushed === false, '无 remote 时 push 未成功');
  ok(r1.push?.reason.includes('fetch') || r1.push?.reason.includes('无'), `push 原因: ${r1.push?.reason}`);

  // 再提交一次 → 无变更应跳过
  const r2 = commitAndPush({ repoPath: repoA, message: 'feat: 空提交' });
  ok(r2.committed === false, '无变更时跳过提交');

  // dryRun
  writeFileSync(join(repoB, 'b.txt'), 'world2\n');
  const r3 = commitAndPush({ repoPath: repoB, message: 'feat: dry-run', dryRun: true });
  ok(r3.dryRun === true && r3.committed === false, 'dryRun 不执行提交');

  // 缺 message / 非仓库
  const r4 = commitAndPush({ repoPath: repoA, message: '' });
  ok(!r4.ok && r4.error.includes('message'), '空 message 被拒绝');
  const r5 = commitAndPush({ repoPath: join(root, 'no-such'), message: 'x' });
  ok(!r5.ok && r5.error.includes('不是 git 仓库'), '非仓库被拒绝');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
