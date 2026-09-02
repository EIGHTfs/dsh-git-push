/** dsh-git-push 核心逻辑单测：扫描 + 提交推送（真实 git 操作，临时目录） */
import { scanRepos, commitAndPush, readRepoStatus, findGitDirs, parseGithubOwnerRepo, httpsUrlOf, apiOriginOf, sshOriginOf, isBadCredentials, githubFetch, resolveUserDir, userRepoCandidates, USER_REPO_NAME, loadUserRequirements } from './lib/core.js';
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
  // v1.17.0：origin 解析兼容 api.github.com / 历史 github.com / SSH，产出 API URL
  const p1 = parseGithubOwnerRepo('https://api.github.com/repos/EIGHTfs/dsh-git-push');
  ok(p1?.owner === 'EIGHTfs' && p1?.repo === 'dsh-git-push', 'parseGithubOwnerRepo 认 api.github.com');
  const p2 = parseGithubOwnerRepo('https://github.com/EIGHTfs/dsh-git-push.git');
  ok(p2?.owner === 'EIGHTfs' && p2?.repo === 'dsh-git-push', 'parseGithubOwnerRepo 认历史 github.com URL');
  const p3 = parseGithubOwnerRepo('ssh://git@ssh.github.com:443/EIGHTfs/dsh-git-push.git');
  ok(p3?.owner === 'EIGHTfs' && p3?.repo === 'dsh-git-push', 'parseGithubOwnerRepo 认 SSH 443');
  ok(httpsUrlOf('git@github.com:EIGHTfs/x.git') === 'https://api.github.com/repos/EIGHTfs/x', 'httpsUrlOf 产出 api.github.com');
  ok(apiOriginOf('EIGHTfs', 'x') === 'https://api.github.com/repos/EIGHTfs/x', 'apiOriginOf');
  ok(sshOriginOf('EIGHTfs', 'x') === 'ssh://git@ssh.github.com:443/EIGHTfs/x.git', 'sshOriginOf 走 ssh.github.com:443');
  ok(isBadCredentials('上传 blob 失败 .gitignore: Bad credentials') === true, 'isBadCredentials 认 Bad credentials');
  ok(isBadCredentials('无新提交可推送') === false, 'isBadCredentials 不误伤普通失败');
  const denied = await githubFetch('https://github.com/EIGHTfs/x', {});
  ok(denied.status === 0 && /拒绝非 api.github.com/.test(denied.error || ''), 'githubFetch 拒绝 github.com');

  // v1.18.0：User 仓在插件同级，不在插件目录内
  ok(USER_REPO_NAME === 'dsh-git-push-User', 'USER_REPO_NAME');
  const cands = userRepoCandidates({ workspaceRoot: '/tmp/ws-x' });
  ok(cands.some((p) => p.endsWith('/dsh-git-push-User')), 'userRepoCandidates 含同级仓名');
  ok(!cands.some((p) => /\/dsh-git-push\/User$/.test(p)) || cands.some((p) => p.endsWith('/dsh-git-push-User')), '候选优先同级仓');
  const tmpWs = mkdtempSync(join(tmpdir(), 'git-push-user-'));
  const sib = join(tmpWs, 'dsh-git-push-User');
  mkdirSync(sib, { recursive: true });
  writeFileSync(join(sib, 'requirements.md'), '1. 测试条目\n');
  const ud = resolveUserDir({ workspaceRoot: tmpWs });
  ok(ud.dir === sib, `resolveUserDir 命中同级仓 dir=${ud.dir}`);
  const reqs = loadUserRequirements({ workspaceRoot: tmpWs });
  ok(reqs.found && reqs.files.some((f) => f.items.includes('测试条目')), 'loadUserRequirements 读同级仓');
  rmSync(tmpWs, { recursive: true, force: true });

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
  const r1 = await commitAndPush({ repoPath: repoA, message: 'feat: 测试提交', requirementsConfirmed: true });
  ok(r1.ok && r1.committed, 'commitAndPush 提交成功');
  ok(r1.commitId?.length >= 4, '返回 commitId');
  ok(r1.push?.pushed === false, '无 remote 时 push 未成功');
  // v1.12.0 起推送默认走 API 通道：无 remote 时 reason 可为空串（不抛错即可）
  ok(r1.push?.pushed === false && typeof r1.push?.reason === 'string', `push 未成功 reason=${r1.push?.reason}`);

  // 再提交一次 → 无变更应跳过
  const r2 = await commitAndPush({ repoPath: repoA, message: 'feat: 空提交', requirementsConfirmed: true });
  ok(r2.committed === false, '无变更时跳过提交');

  // dryRun
  writeFileSync(join(repoB, 'b.txt'), 'world2\n');
  const r3 = await commitAndPush({ repoPath: repoB, message: 'feat: dry-run', dryRun: true, requirementsConfirmed: true });
  ok(r3.dryRun === true && r3.committed === false, 'dryRun 不执行提交');

  // 缺 message / 非仓库
  const r4 = await commitAndPush({ repoPath: repoA, message: '', requirementsConfirmed: true });
  ok(!r4.ok && r4.error.includes('message'), '空 message 被拒绝');
  const r5 = await commitAndPush({ repoPath: join(root, 'no-such'), message: 'x', requirementsConfirmed: true });
  ok(!r5.ok && r5.error.includes('不是 git 仓库'), '非仓库被拒绝');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
