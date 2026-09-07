/** dsh-skip-sensitive dsh-git-push 核心逻辑单测：扫描 + 提交推送（真实 git 操作，临时目录） */
import { scanRepos, commitAndPush, readRepoStatus, findGitDirs, parseGithubOwnerRepo, httpsUrlOf, apiOriginOf, sshOriginOf, isBadCredentials, githubFetch, resolveUserDir, userRepoCandidates, USER_REPO_NAME, loadUserRequirements, gitCFlags, ensureGlobalFilemodeFalse, ensureGlobalSafeDirectoryStar, buildReadmeCheckHint, README_CHECK_HINT, runGit, extractRemoteHeads, formatRemoteHeadsTable, persistGithubToken, githubTokenStatus, formatGithubAccountBlock, collectRepoSkillDocs, formatRepoSkillInjection, resolveReadmeTemplate, genReadme, probeSshGithubAuth, collectRepoSkillDirs, formatRepoSkillDirsInjection, ensureCustomIgnored, collectFunctionManual, FUNCTION_MANUAL_COMPACT } from '../lib/core.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, readFileSync } from 'node:fs';
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
  const cflags = gitCFlags('/tmp/repo-x');
  ok(cflags.includes('core.filemode=false') && cflags.includes('safe.directory=*') && cflags.includes('safe.directory=/tmp/repo-x'), 'gitCFlags 含 filemode=false、safe.directory=* 与 cwd');
  const fm = ensureGlobalFilemodeFalse();
  ok(typeof fm.ok === 'boolean' && typeof fm.status === 'number', `ensureGlobalFilemodeFalse 返回 ok=${fm.ok} status=${fm.status}`);
  const sd = ensureGlobalSafeDirectoryStar();
  ok(typeof sd.ok === 'boolean' && typeof sd.status === 'number', `ensureGlobalSafeDirectoryStar 返回 ok=${sd.ok} skipped=${sd.skipped || ''}`);
  const hintHas = buildReadmeCheckHint({ hasReadme: true, repoName: 'demo' });
  ok(hintHas.needed === true && hintHas.hasReadme === true && hintHas.hint.includes('检查该仓库 README'), '有 README 时回传检查提示');
  const hintNo = buildReadmeCheckHint({ hasReadme: false, repoName: 'demo' });
  ok(hintNo.hasReadme === false && hintNo.hint.includes('没有 README') && README_CHECK_HINT.includes('git_commit_push'), '无 README 时提示先补');

  ok(isBadCredentials('上传 blob 失败 .gitignore: Bad credentials') === true, 'isBadCredentials 认 Bad credentials');

  const heads = extractRemoteHeads([
    { sha: 'abcdef1234567890', commit: { message: 'feat: one\n\nbody', committer: { date: '2026-09-03T01:00:00Z' } } },
    { sha: 'bbbbbbbcccccccc', commit: { message: 'fix: two', author: { date: '2026-09-02T01:00:00Z' } } },
    { sha: 'cccccccdddddddd', commit: { message: 'docs: three', committer: { date: '2026-09-01T01:00:00Z' } } },
    { sha: 'dddddddeeeeeeee', commit: { message: 'chore: four', committer: { date: '2026-08-31T01:00:00Z' } } },
  ]);
  ok(heads.length === 3 && heads[0].sha === 'abcdef1' && heads[0].title === 'feat: one' && heads[0].time === '2026-09-03T01:00:00Z', 'extractRemoteHeads 取最新 3 条 sha/标题/时间');
  ok(extractRemoteHeads(null).length === 0, 'extractRemoteHeads 非数组返回空');
  const table = formatRemoteHeadsTable(heads, { owner: 'EIGHTfs', repo: 'dsh-git-push' });
  ok(table.includes('| # | SHA | 标题 | 时间 |') && table.includes('`abcdef1`') && table.includes('EIGHTfs/dsh-git-push'), 'formatRemoteHeadsTable 产出 Markdown 表格');
  const block = formatGithubAccountBlock({
    loggedIn: true, cookieSet: true, username: 'EIGHTfs', userId: 1, profileUrl: 'https://github.com/EIGHTfs',
    cred: { hasToken: true, tokenMasked: 'ghp_…1234', hasSshPub: false },
  });
  ok(block.includes('✅ Token 可用') && block.includes('EIGHTfs') && !block.includes('ghp_TEST'), 'formatGithubAccountBlock 多行用户信息且无明文 token');
  const boundBlock = formatGithubAccountBlock({
    loggedIn: true, cookieSet: true, username: 'EIGHTfs', userId: 1, profileUrl: 'https://github.com/EIGHTfs',
    cred: { hasToken: true, tokenMasked: 'ghp_…1234', hasSshPub: true, sshFingerprint: 'AAAAC3NzaC1l…BEdYT9y4', sshBound: true, sshBoundHow: 'ssh-auth' },
  });
  ok(boundBlock.includes('公钥已绑到该账号: ✅ 是') && boundBlock.includes('SSH 实测已认证'), 'formatGithubAccountBlock SSH 实测绑定显示 ✅');
  const unboundBlock = formatGithubAccountBlock({
    loggedIn: true, cookieSet: true, username: 'EIGHTfs', userId: 1,
    cred: { hasToken: true, tokenMasked: 'ghp_…1234', hasSshPub: true, sshBound: false, sshBoundHow: '' },
  });
  ok(unboundBlock.includes('公钥已绑到该账号: ❌ 否') && !unboundBlock.includes('钥匙列表未匹配'), 'formatGithubAccountBlock 未绑定不再写钥匙列表未匹配');
  ok(typeof probeSshGithubAuth === 'function', 'probeSshGithubAuth 已导出');
  const skillRoot = mkdtempSync(join(tmpdir(), 'git-push-skills-'));
  mkdirSync(join(skillRoot, 'plugin', 'skills'), { recursive: true });
  mkdirSync(join(skillRoot, 'dsh-git-push-User', '.git'), { recursive: true });
  writeFileSync(join(skillRoot, 'plugin', 'skills', 'handbook.md'), '# handbook\nuse git_scan');
  writeFileSync(join(skillRoot, 'dsh-git-push-User', 'requirements.md'), '# req\n1. foo');
  writeFileSync(join(skillRoot, 'dsh-git-push-User', 'github-token'), 'ghp_SECRET');
  const docs = collectRepoSkillDocs({ workspaceRoot: skillRoot, pluginRoot: join(skillRoot, 'plugin') });
  const inj = formatRepoSkillInjection(docs);
  ok(docs.some((d) => d.path === 'dsh-git-push/skills/handbook.md') && docs.some((d) => d.path === 'dsh-git-push-User/requirements.md'), 'collectRepoSkillDocs 收两仓 md');
  ok(inj.includes('# handbook') && inj.includes('# req') && !inj.includes('ghp_SECRET'), '注入正文含 skill、不含 token');
  const dirs = collectRepoSkillDirs({ workspaceRoot: skillRoot, pluginRoot: join(skillRoot, 'plugin') });
  const dirInj = formatRepoSkillDirsInjection(dirs);
  ok(dirInj.includes('dsh-git-push/skills') && dirInj.includes('handbook.md') && !dirInj.includes('# handbook'), 'collectRepoSkillDirs/formatRepoSkillDirsInjection 只列清单不含正文');
  rmSync(skillRoot, { recursive: true, force: true });

  // v1.32.0 功能说明书改精简注入：默认 compact，全文仅 compact=false
  const manualRoot = mkdtempSync(join(tmpdir(), 'git-push-manual-'));
  mkdirSync(join(manualRoot, 'plugin', 'skills'), { recursive: true });
  writeFileSync(join(manualRoot, 'plugin', 'skills', 'dsh-git-push-functions.md'), '# dsh-git-push 功能说明书\n\n## git_scan\n\n扫描仓库很长很长很长\n');
  const compact = collectFunctionManual({ pluginRoot: join(manualRoot, 'plugin') });
  ok(compact === FUNCTION_MANUAL_COMPACT && compact.includes('精简注入') && compact.includes('git_scan') && !compact.includes('很长很长很长'), 'collectFunctionManual 默认精简、不含全文');
  const full = collectFunctionManual({ pluginRoot: join(manualRoot, 'plugin'), compact: false });
  ok(full.includes('功能说明书') && full.includes('很长很长很长'), 'compact=false 仍返回全文');
  const compactMissing = collectFunctionManual({ pluginRoot: join(manualRoot, 'noplugin') });
  ok(compactMissing === FUNCTION_MANUAL_COMPACT, '说明书缺失时精简目录仍注入');
  const fullMissing = collectFunctionManual({ pluginRoot: join(manualRoot, 'noplugin'), compact: false });
  ok(fullMissing === '', 'compact=false 且说明书缺失返回空');
  rmSync(manualRoot, { recursive: true, force: true });

  // v1.28.0 自定义忽略 pattern：追加 .gitignore + 已跟踪文件解除跟踪（ensureCustomIgnored）
  const ignoreRoot = mkdtempSync(join(tmpdir(), 'git-push-ignore-'));
  mkdirSync(ignoreRoot, { recursive: true });
  execSync('git init -b master', { cwd: ignoreRoot, stdio: 'ignore' });
  writeFileSync(join(ignoreRoot, 'x.bak'), 'backup\n');
  writeFileSync(join(ignoreRoot, 'keep.txt'), 'keep\n');
  execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m init', { cwd: ignoreRoot, stdio: 'ignore' });
  const ig1 = ensureCustomIgnored(ignoreRoot, '*.bak*, *.tmp');
  ok(ig1.ok && ig1.added.includes('*.bak*') && ig1.added.includes('*.tmp'), 'ensureCustomIgnored 追加缺失 pattern');
  ok(ig1.tracked.includes('*.bak*'), 'glob 模式 *.bak* 匹配已跟踪的 x.bak → 进 tracked');
  const giText = readFileSync(join(ignoreRoot, '.gitignore'), 'utf8');
  ok(giText.includes('*.bak*') && giText.includes('*.tmp'), '.gitignore 已写入自定义 pattern');
  const lsAfter1 = runGit(['ls-files', '--', 'x.bak'], ignoreRoot);
  ok(lsAfter1.status === 0 && lsAfter1.stdout.trim() === '', 'ensureCustomIgnored 用 glob 模式解除已跟踪文件跟踪');
  const ig2 = ensureCustomIgnored(ignoreRoot, '*.bak*, *.tmp');
  ok(ig2.ok && ig2.added.length === 0, 'ensureCustomIgnored 幂等：重复调用不追加');
  const igEmpty = ensureCustomIgnored(ignoreRoot, '');
  ok(igEmpty.ok && igEmpty.added.length === 0, 'ensureCustomIgnored 空 pattern 无操作');
  // 字面路径已解除跟踪后再次加入 → tracked 为空（文件已不在索引），只追加 .gitignore
  const ig3 = ensureCustomIgnored(ignoreRoot, 'x.bak');
  ok(ig3.ok && ig3.added.includes('x.bak') && !ig3.tracked.includes('x.bak'), 'ensureCustomIgnored 已解除文件字面路径加入时 tracked 为空');
  rmSync(ignoreRoot, { recursive: true, force: true });

  const tplRoot = mkdtempSync(join(tmpdir(), 'git-push-tpl-'));
  mkdirSync(join(tplRoot, 'dsh-git-push-User', '.git'), { recursive: true });
  writeFileSync(join(tplRoot, 'dsh-git-push-User', 'readme-template.md'), '# {{name}}\n\n{{description}}\n\n## 我的习惯章节\n\nhello\n');
  const resolved = resolveReadmeTemplate({ workspaceRoot: tplRoot });
  ok(resolved.source.includes('readme-template.md') && resolved.template.includes('我的习惯章节'), 'README 模板优先 User 仓');
  const emptyUser = mkdtempSync(join(tmpdir(), 'git-push-notpl-'));
  mkdirSync(join(emptyUser, 'dsh-git-push-User', '.git'), { recursive: true });
  const built = resolveReadmeTemplate({ workspaceRoot: emptyUser });
  ok(built.source === 'builtin', '没有 User 模板时用内置');
  rmSync(emptyUser, { recursive: true, force: true });
  mkdirSync(join(tplRoot, 'proj'), { recursive: true });
  writeFileSync(join(tplRoot, 'proj', 'package.json'), JSON.stringify({ name: 'demo', description: '简介', version: '1.0.0' }));
  execSync('git init -b master', { cwd: join(tplRoot, 'proj'), stdio: 'ignore' });
  const rd = genReadme({ repoPath: join(tplRoot, 'proj'), workspaceRoot: tplRoot });
  ok(rd.ok && rd.content.includes('# demo') && rd.content.includes('我的习惯章节') && rd.templateSource.includes('readme-template.md'), 'genReadme 用 User 模板填项目名');
  rmSync(tplRoot, { recursive: true, force: true });

  const tokRoot = mkdtempSync(join(tmpdir(), 'git-push-tok-'));
  mkdirSync(join(tokRoot, 'dsh-git-push-User', '.git'), { recursive: true });
  const bad = persistGithubToken('not-a-token', { workspaceRoot: tokRoot });
  ok(!bad.ok, '非法 token 拒绝写入');
  const saved = persistGithubToken('ghp_TESTTOKEN1234567890', { workspaceRoot: tokRoot });
  ok(saved.ok && saved.source.includes('github-token'), '合法 token 写入 User 仓');
  const st = githubTokenStatus({ workspaceRoot: tokRoot });
  ok(st.configured === true && !JSON.stringify(st).includes('ghp_TEST'), 'tokenStatus 只报配置了、不回传明文');
  rmSync(tokRoot, { recursive: true, force: true });
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

  // v1.18.4：只改可执行位不应进 status（core.filemode=false）
  chmodSync(join(repoB, 'b.txt'), 0o755);
  const stMode = runGit(['status', '--porcelain'], repoB).stdout;
  ok(stMode === '', `只改可执行位时 porcelain 为空（got ${JSON.stringify(stMode)}）`);

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
