/** dsh-skip-sensitive dsh-git-push 核心逻辑单测：扫描 + 提交推送（真实 git 操作，临时目录） */
import { scanRepos, commitAndPush, readRepoStatus, findGitDirs, parseGithubOwnerRepo, httpsUrlOf, apiOriginOf, sshOriginOf, isBadCredentials, githubFetch, resolveUserDir, userRepoCandidates, USER_REPO_NAME, loadUserRequirements, gitCFlags, ensureGlobalFilemodeFalse, ensureGlobalSafeDirectoryStar, buildReadmeCheckHint, README_CHECK_HINT, runGit, extractRemoteHeads, formatRemoteHeadsTable, persistGithubToken, githubTokenStatus, formatGithubAccountBlock, collectRepoSkillDocs, formatRepoSkillInjection, resolveReadmeTemplate, genReadme, probeSshGithubAuth, collectRepoSkillDirs, formatRepoSkillDirsInjection, ensureCustomIgnored, collectFunctionManual, FUNCTION_MANUAL_COMPACT, resolveGitToken, resolveValidGitToken, rebuildHistory, previewRebuildHistory, inspectUserRepo, scoreUserRepo, pickBestUserRepo, createUserRepoTemplate } from '../lib/core.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

// 建临时 git 仓库（User 仓通用构造）：requirements.md + 可选 token + N 个提交 + 可选 origin
// v1.36.2：fixture token 自动补足到 40 位——tokenValid 启发式要求 classic token 为 40 字符，
// 短 token（截断/占位）会判「不可用」，fixture 模拟真实有效 token 避免选仓误判。
const tok40 = (t) => {
  const base = String(t || '').replace(/\s+$/, '');
  return base.length >= 40 ? base : base + 'X'.repeat(40 - base.length);
};
const makeUserGit = (dir, origin, commits, extra = {}) => {
  mkdirSync(dir, { recursive: true });
  execSync('git init -b master', { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'requirements.md'), extra.req || '1. item\n');
  if (extra.token) writeFileSync(join(dir, 'github-token'), tok40(extra.token) + '\n');
  // v1.36.2：tokenRaw = 原样写入不 pad（模拟失效/截断的旧副本 token）
  if (extra.tokenRaw) writeFileSync(join(dir, 'github-token'), extra.tokenRaw);
  execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m init', { cwd: dir, stdio: 'ignore' });
  for (let i = 1; i < commits; i++) {
    writeFileSync(join(dir, `c${i}.txt`), `${i}\n`);
    execSync(`git add -A && git -c user.email=t@t -c user.name=t commit -m c${i}`, { cwd: dir, stdio: 'ignore' });
  }
  if (origin) execSync(`git remote add origin ${origin}`, { cwd: dir, stdio: 'ignore' });
};
// 造「与远程一致」的 User 仓：本地 HEAD 记成 origin/master ref（模拟 fetch 过且同步）
const makeSyncedUser = (dir, origin, commits, extra = {}) => {
  makeUserGit(dir, origin, commits, extra);
  const head = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
  execSync(`git update-ref refs/remotes/origin/master ${head}`, { cwd: dir, stdio: 'ignore' });
};

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
  makeSyncedUser(join(skillRoot, 'dsh-git-push-User'), 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 1, { req: '# req\n1. foo', token: 'ghp_SKILLROOTTOKENSKILLROOTTOKENSKILL00' });
  writeFileSync(join(skillRoot, 'plugin', 'skills', 'handbook.md'), '# handbook\nuse git_scan');
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

  // v1.33.0：设置页写入的 User 仓 token 优先于项目内残留 .git-push-token
  const prioRoot = mkdtempSync(join(tmpdir(), 'git-push-token-prio-'));
  const prioWs = join(prioRoot, 'ws');
  const prioUser = join(prioWs, USER_REPO_NAME);
  const prioRepo = join(prioWs, 'proj');
  makeSyncedUser(prioUser, 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 1, { token: 'ghp_NEWTOKENNEWTOKENNEWTOKENNEWTOKEN00\n' });
  mkdirSync(prioRepo, { recursive: true });
  writeFileSync(join(prioRepo, '.git-push-token'), 'ghp_OLDTOKENOLDTOKENOLDTOKENOLDTOKEN00\n');
  const picked = resolveGitToken({ repoPath: prioRepo, workspaceRoot: prioWs });
  ok(picked.source === join(prioUser, 'github-token') && picked.token.includes('NEWTOKEN'), 'resolveGitToken 优先同级仓 github-token 而不是仓内 .git-push-token');
  rmSync(prioRoot, { recursive: true, force: true });

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
  makeSyncedUser(join(tplRoot, 'dsh-git-push-User'), 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 1, { token: 'ghp_TPLROOTTOKENTPLROOTTOKENTPLROOTTOK0X' });
  writeFileSync(join(tplRoot, 'dsh-git-push-User', 'readme-template.md'), '# {{name}}\n\n{{description}}\n\n## 我的习惯章节\n\nhello\n');
  const resolved = resolveReadmeTemplate({ workspaceRoot: tplRoot });
  ok(resolved.source.includes('readme-template.md') && resolved.template.includes('我的习惯章节'), 'README 模板优先 User 仓');
  const emptyUser = mkdtempSync(join(tmpdir(), 'git-push-notpl-'));
  makeSyncedUser(join(emptyUser, 'dsh-git-push-User'), 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 1, { token: 'ghp_EMPTYUSERTOKENEMPTYUSERTOKENEMPTYTOKX' });
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
  makeSyncedUser(join(tokRoot, 'dsh-git-push-User'), 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 1);
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
  makeSyncedUser(sib, 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 1, { req: '1. 测试条目\n', token: 'ghp_SIBTOKENSIBTOKENSIBTOKENSIBTOKENSIB' });
  const ud = resolveUserDir({ workspaceRoot: tmpWs });
  ok(ud.dir === sib, `resolveUserDir 命中同级仓 dir=${ud.dir}`);
  const reqs = loadUserRequirements({ workspaceRoot: tmpWs });
  ok(reqs.found && reqs.files.some((f) => f.items.includes('测试条目')), 'loadUserRequirements 读同级仓');
  rmSync(tmpWs, { recursive: true, force: true });

  // v1.36.0：User 仓搬家仍能找到；多个候选按 git remote / 提交数比对
  const moveRoot = mkdtempSync(join(tmpdir(), 'git-push-user-move-'));
  const moved = join(moveRoot, 'elsewhere', USER_REPO_NAME);
  makeSyncedUser(moved, 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 3, { token: 'ghp_MOVEDTOKENMOVEDTOKENMOVEDTOKEN00\n' });
  const candsMoved = userRepoCandidates({ workspaceRoot: moveRoot });
  ok(candsMoved.some((p) => p === moved), `搬家后候选含 elsewhere/dsh-git-push-User got=${candsMoved.filter((p)=>p.includes(USER_REPO_NAME)).slice(0,4).join(',')}`);
  const udMoved = resolveUserDir({ workspaceRoot: moveRoot });
  ok(udMoved.dir === moved && udMoved.matchesTarget === true, `搬家后仍命中 dir=${udMoved.dir} matches=${udMoved.matchesTarget}`);

  const fake = join(moveRoot, USER_REPO_NAME);
  makeUserGit(fake, 'https://api.github.com/repos/other/not-user', 1);
  const udPick = resolveUserDir({ workspaceRoot: moveRoot });
  ok(udPick.dir === moved, `多个候选按 git 比对选官方仓 got=${udPick.dir}`);
  const fakeInfo = inspectUserRepo(fake);
  const realInfo = inspectUserRepo(moved);
  ok(scoreUserRepo(realInfo) > scoreUserRepo(fakeInfo), `官方仓分数 ${scoreUserRepo(realInfo)} > 假仓 ${scoreUserRepo(fakeInfo)}`);
  const bestUser = pickBestUserRepo([fakeInfo, realInfo]);
  ok(bestUser && bestUser.dir === moved, 'pickBestUserRepo 选 remote 匹配的仓');

  const outsideRoot = mkdtempSync(join(tmpdir(), 'git-push-user-out-'));
  const emptyWs = join(outsideRoot, 'ws');
  const parked = join(outsideRoot, 'parked', USER_REPO_NAME);
  mkdirSync(emptyWs, { recursive: true });
  makeSyncedUser(parked, 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 2, { token: 'ghp_PARKEDTOKENPARKEDTOKENPARKEDTOK00\n' });
  const udParked = resolveUserDir({ workspaceRoot: emptyWs, extraRepos: [parked] });
  ok(udParked.dir === parked && udParked.matchesTarget === true, `extraRepos 搬家后仍命中 dir=${udParked.dir}`);
  rmSync(outsideRoot, { recursive: true, force: true });
  rmSync(moveRoot, { recursive: true, force: true });

  // v1.36.0：排除 NAS 旧副本 —— 纯探测不硬编码路径，默认选「更接近远程」的仓
  const nasRoot = mkdtempSync(join(tmpdir(), 'git-push-user-nas-'));
  const wsDir = join(nasRoot, 'ws');
  const nasCopy = join(nasRoot, 'nas', USER_REPO_NAME); // 模拟 NAS 旧副本：同 remote、提交数多但没拉过 origin refs、作者文件散在仓根
  const localCopy = join(wsDir, USER_REPO_NAME);        // 本地新仓：origin refs 与 HEAD 一致、作者挂钩文件在 EIGHTfs/ 子目录
  mkdirSync(wsDir, { recursive: true });
  mkdirSync(nasRoot, { recursive: true });
  makeUserGit(nasCopy, 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 5, { tokenRaw: 'ghp_NASOLDTOKENNASOLDTOKENNASOLDTK00\n' });
  makeUserGit(localCopy, 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 1);
  // 本地仓：作者文件夹 EIGHTfs/ 放 token / requirements / 索引；把 HEAD 记成 origin refs（模拟已与远程同步）
  const authorDir = join(localCopy, 'EIGHTfs');
  mkdirSync(authorDir, { recursive: true });
  writeFileSync(join(authorDir, 'github-token'), tok40('ghp_LOCALTOKENLOCALTOKENLOCALTOKEN00') + '\n');
  writeFileSync(join(authorDir, 'requirements.md'), '1. 本地要求\n');
  writeFileSync(join(authorDir, 'dsh-repo-index.json'), '{"repos":[]}\n');
  execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m author-layout', { cwd: localCopy, stdio: 'ignore' });
  const localHead = execSync('git rev-parse HEAD', { cwd: localCopy, encoding: 'utf8' }).trim();
  execSync(`git update-ref refs/remotes/origin/master ${localHead}`, { cwd: localCopy, stdio: 'ignore' });
  // NAS 旧副本：只有 origin URL，没有拉过 origin refs（remoteHeadSha 为空）→ isSynced=false
  const udNoNas = resolveUserDir({ workspaceRoot: wsDir });
  ok(udNoNas.dir === localCopy, `排除 NAS 旧副本选本地新仓 got=${udNoNas.dir}`);
  const nasInfo = inspectUserRepo(nasCopy);
  const localInfo = inspectUserRepo(localCopy);
  ok(nasInfo && localInfo && localInfo.isSynced === true && nasInfo.isSynced === false, `isSynced 探测：本地 ${localInfo?.isSynced} / NAS ${nasInfo?.isSynced}`);
  ok(scoreUserRepo(localInfo) > scoreUserRepo(nasInfo), `更接近远程的仓分数高（本地 ${scoreUserRepo(localInfo)} > NAS ${scoreUserRepo(nasInfo)}）`);
  const bestNas = pickBestUserRepo([nasInfo, localInfo]);
  ok(bestNas && bestNas.dir === localCopy, 'pickBestUserRepo 选与远程一致 + 作者文件夹完整的仓');
  // 作者挂钩文件在作者文件夹也能被读取
  const reqsAuthor = loadUserRequirements({ workspaceRoot: wsDir });
  ok(reqsAuthor.files.some((f) => f.file === 'requirements.md' && f.items.includes('本地要求')), 'loadUserRequirements 读作者文件夹 requirements.md');
  const tokAuthor = resolveGitToken({ workspaceRoot: wsDir });
  ok(tokAuthor.token.includes('LOCALTOKEN'), 'resolveGitToken 读作者文件夹 github-token');
  rmSync(nasRoot, { recursive: true, force: true });

  // v1.36.2：双副本 token 失效修复——树内副本 isSynced=true 但 token 失效（<40 截断），
  // 树外副本 token 有效 → 应选树外（tokenValid +800 压过 isSynced 假象）
  const dupRoot = mkdtempSync(join(tmpdir(), 'git-push-user-dup-'));
  const dupWs = join(dupRoot, 'ws');
  const dupStale = join(dupWs, USER_REPO_NAME);        // 树内：isSynced=true 但 token 截断失效
  const dupGood = join(dupRoot, 'nas', USER_REPO_NAME); // 树外：token 有效（40 位）
  mkdirSync(dupWs, { recursive: true });
  mkdirSync(dupRoot, { recursive: true });
  // 树内失效副本：tokenRaw 截断（19 位，明显失效）
  makeSyncedUser(dupStale, 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 3, { tokenRaw: 'ghp_STALESTALE00\n' });
  // 树外有效副本：isSynced=false（无 origin refs），但 token 40 位有效。显式指定（与 parked 同款）
  makeUserGit(dupGood, 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 5, { token: 'ghp_GOODTOKENGOODTOKENGOODTOKENGOODTOKEN00' });
  const dupPick = resolveUserDir({ workspaceRoot: dupWs, extraRepos: [dupGood] });
  ok(dupPick.dir === dupGood, `双副本：树内 isSynced假象+失效token被排除，显式树外有效仓胜出 got=${dupPick.dir}`);
  const staleInfo = inspectUserRepo(dupStale);
  const goodInfo = inspectUserRepo(dupGood);
  ok(staleInfo.isSynced === true && staleInfo.tokenValid === false, `树内副本 isSynced=${staleInfo.isSynced} tokenValid=${staleInfo.tokenValid}`);
  ok(goodInfo.tokenValid === true && staleInfo.tokenValid === false, 'tokenValid：有效 40 位 true / 截断 false');
  ok(scoreUserRepo(goodInfo) > scoreUserRepo(staleInfo), `有效 token 仓分数高（好事 ${scoreUserRepo(goodInfo)} > 假象 ${scoreUserRepo(staleInfo)}）`);
  rmSync(dupRoot, { recursive: true, force: true });

  // v1.36.2：resolveValidGitToken 异步真校验版——无 token 时返回空（结构正确）；有格式匹配 token 时返回源
  const noTokRoot = mkdtempSync(join(tmpdir(), 'gp-notok-'));
  const noTok = await resolveValidGitToken({ workspaceRoot: noTokRoot });
  ok(typeof noTok.token === 'string' && typeof noTok.source === 'string', 'resolveValidGitToken 无 token 返回空结构');
  rmSync(noTokRoot, { recursive: true, force: true });
  const withTokRoot = mkdtempSync(join(tmpdir(), 'gp-withtok-'));
  makeSyncedUser(join(withTokRoot, USER_REPO_NAME), 'https://api.github.com/repos/EIGHTfs/dsh-git-push-User', 1, { token: 'ghp_WITHTOKENWITHTOKENWITHTOKENWITHTOK0' });
  const withTok = await resolveValidGitToken({ workspaceRoot: withTokRoot });
  ok(typeof withTok.token === 'string' && withTok.token.length > 0, 'resolveValidGitToken 有 token 时返回 token');
  rmSync(withTokRoot, { recursive: true, force: true });

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

  // v1.34.0：fresh 重建历史不改版本号、不删 .git、force=false 不推远端
  const repoFresh = join(root, 'repo-fresh');
  mkdirSync(repoFresh, { recursive: true });
  execSync('git init -b main', { cwd: repoFresh, stdio: 'ignore' });
  writeFileSync(join(repoFresh, 'package.json'), JSON.stringify({ name: 'demo', version: '2.6.0' }, null, 2) + '\n');
  writeFileSync(join(repoFresh, 'a.txt'), 'one\n');
  execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m "feat: 2.6.0 first"', { cwd: repoFresh, stdio: 'ignore' });
  writeFileSync(join(repoFresh, 'a.txt'), 'two\n');
  execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m "fix: second"', { cwd: repoFresh, stdio: 'ignore' });
  const beforeCount = Number(execSync('git rev-list --count HEAD', { cwd: repoFresh, encoding: 'utf8' }).trim());
  ok(beforeCount === 2, `fresh 前提交数=${beforeCount}`);
  const preview = previewRebuildHistory({ repoPath: repoFresh, mode: 'fresh' });
  ok(preview.ok && preview.after === 1 && /版本号/.test(preview.plan), `fresh dryRun plan=${preview.plan}`);
  const rebuilt = await rebuildHistory({ repoPath: repoFresh, mode: 'fresh', force: false });
  ok(rebuilt.ok === true, `fresh ok error=${rebuilt.error || ''}`);
  const afterCount = Number(execSync('git rev-list --count HEAD', { cwd: repoFresh, encoding: 'utf8' }).trim());
  ok(afterCount === 1, `fresh 后提交数=${afterCount}`);
  const pkgAfter = JSON.parse(readFileSync(join(repoFresh, 'package.json'), 'utf8'));
  ok(pkgAfter.version === '2.6.0', `fresh 不改版本号 got=${pkgAfter.version}`);
  ok(rebuilt.version === '2.6.0', `fresh 返回 version=${rebuilt.version}`);
  ok(rebuilt.push?.pushed === false, `force=false 不推远端 reason=${rebuilt.push?.reason}`);
  ok(existsSync(join(repoFresh, '.git')), 'fresh 保留 .git（不 git rm .git）');

  // v1.36.3：User 仓内置模板自动创建——无远端/无 token 时落模板，README+.gitignore+作者夹+git 仓齐全
  const usertplRoot = mkdtempSync(join(tmpdir(), 'git-push-usertpl-'));
  const tplDest = join(usertplRoot, USER_REPO_NAME);
  const tplR = createUserRepoTemplate({ dest: tplDest });
  ok(tplR.ok === true && tplR.created === 'template' && tplR.template === true, `模板落地成功 ${JSON.stringify(tplR)}`);
  ok(existsSync(join(tplDest, 'README.md')) && existsSync(join(tplDest, '.gitignore')), '模板含 README + .gitignore');
  const tplOwner = tplR.owner || 'EIGHTfs';
  ok(existsSync(join(tplDest, tplOwner)), `作者文件夹 <owner>/ 已创建 owner=${tplOwner}`);
  ok(existsSync(join(tplDest, '.git')), '模板仓 git init 有效');
  const tplCommits = runGit(['rev-list', '--all', '--count'], tplDest).stdout.trim();
  ok(tplCommits === '1', `初始 commit 1 条 got=${tplCommits}`);
  // 写 token 到作者夹 → git status 仍干净（.gitignore 生效）
  writeFileSync(join(tplDest, tplOwner, 'github-token'), 'ghp_TESTTESTTESTTESTTESTTESTTESTTEST\n');
  const tplSt = runGit(['status', '--porcelain'], tplDest).stdout.trim();
  ok(tplSt === '', `模板 .gitignore 忽略作者夹 github-token（status=${JSON.stringify(tplSt)}）`);
  // 幂等：已存在非空目录不覆盖
  const tplAgain = createUserRepoTemplate({ dest: tplDest });
  ok(tplAgain.ok === true && tplAgain.skipped === 'dest-nonempty', '已存在目录跳过不覆盖');
  rmSync(usertplRoot, { recursive: true, force: true });
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
