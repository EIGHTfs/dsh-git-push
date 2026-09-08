/** dsh-skip-sensitive dsh-git-push 核心逻辑单测（E1 重写）：纯函数 + 真实临时 git 仓 + DSH_HOME/HOME 隔离
 * v1.40.0 废除同级仓 dsh-git-push-User：resolveUserDir / userRepoCandidates / USER_REPO_NAME /
 * loadUserRequirements / inspectUserRepo / scoreUserRepo / pickBestUserRepo / createUserRepoTemplate
 * 用例随功能删除。凭据/要求清单改走 credentialsDir()（DSH_HOME/git-push）——测试全程把
 * DSH_HOME/HOME 指向临时目录隔离，绝不写真实配置目录，结束后恢复环境变量并清理全部临时目录。
 * 函数不存在（导出变动）→ 打印 ⏭ 跳过并说明，不猜签名。
 */
import * as core from '../lib/core.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };
/** 导出探测：不存在则跳过该函数用例（v1.40.0 前后导出清单变动，以 lib/core.js 实际导出为准） */
const need = (name) => {
  const v = core[name];
  if (v === undefined) { console.log(`  ⏭ 跳过：core.${name} 未导出（可能已废除）`); return null; }
  return v;
};
/** fixture token 补足 40 位（ghp_ 开头格式合法；纯本地假值，只测解析链不联网使用） */
const tok40 = (t) => { const base = String(t || ''); return base.length >= 40 ? base : base + 'X'.repeat(40 - base.length); };
/** 建临时 git 仓（master + N 提交 + 可选 origin + 可选初始文件） */
const makeGit = (dir, { commits = 1, origin = '', files = {} } = {}) => {
  mkdirSync(dir, { recursive: true });
  execSync('git init -b master', { cwd: dir, stdio: 'ignore' });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  // 零文件仓用 --allow-empty（纯 .git-push-token / 敏感扫描 fixture 不需要占位文件）
  const emptyFlag = Object.keys(files).length ? '' : '--allow-empty';
  execSync(`git add -A && git -c user.email=t@t -c user.name=t commit ${emptyFlag} -m init`, { cwd: dir, stdio: 'ignore' });
  for (let i = 1; i < commits; i++) {
    writeFileSync(join(dir, `c${i}.txt`), `${i}\n`);
    execSync(`git add -A && git -c user.email=t@t -c user.name=t commit -m c${i}`, { cwd: dir, stdio: 'ignore' });
  }
  if (origin) execSync(`git remote add origin ${origin}`, { cwd: dir, stdio: 'ignore' });
};

const roots = [];
const tmp = (pfx) => { const d = mkdtempSync(join(tmpdir(), pfx)); roots.push(d); return d; };
const origDshHome = process.env.DSH_HOME;
const origHome = process.env.HOME;

try {
  /* ===== 环境隔离：DSH_HOME/HOME → 临时目录（credentialsDir / resolveGitToken / loadRequirements / skill 注入全部隔离）===== */
  const envRoot = tmp('git-push-env-');
  process.env.DSH_HOME = envRoot;
  process.env.HOME = envRoot;
  const credDir = join(envRoot, 'git-push'); // credentialsDir() 应解析到这里

  /* ================= 纯函数：origin 解析 / URL 产出 / 凭据判定 / git 参数 ================= */
  const parseGithubOwnerRepo = need('parseGithubOwnerRepo');
  if (parseGithubOwnerRepo) {
    const p1 = parseGithubOwnerRepo('https://api.github.com/repos/EIGHTfs/dsh-git-push');
    ok(p1?.owner === 'EIGHTfs' && p1?.repo === 'dsh-git-push', 'parseGithubOwnerRepo 认 api.github.com');
    const p2 = parseGithubOwnerRepo('https://github.com/EIGHTfs/dsh-git-push.git');
    ok(p2?.owner === 'EIGHTfs' && p2?.repo === 'dsh-git-push', 'parseGithubOwnerRepo 认历史 github.com URL');
    const p3 = parseGithubOwnerRepo('ssh://git@ssh.github.com:443/EIGHTfs/dsh-git-push.git');
    ok(p3?.owner === 'EIGHTfs' && p3?.repo === 'dsh-git-push', 'parseGithubOwnerRepo 认 SSH 443');
    ok(parseGithubOwnerRepo('git@github.com:EIGHTfs/x.git')?.repo === 'x', 'parseGithubOwnerRepo 认 SCP 写法');
    ok(parseGithubOwnerRepo('') === null, 'parseGithubOwnerRepo 空串返回 null');
  }

  const httpsUrlOf = need('httpsUrlOf');
  if (httpsUrlOf) {
    ok(httpsUrlOf('git@github.com:EIGHTfs/x.git') === 'https://api.github.com/repos/EIGHTfs/x', 'httpsUrlOf 产出 api.github.com/repos/o/r');
    ok(httpsUrlOf('ssh://git@ssh.github.com:443/EIGHTfs/y.git') === 'https://api.github.com/repos/EIGHTfs/y', 'httpsUrlOf 认 SSH 443');
    ok(httpsUrlOf('not-a-url') === '', 'httpsUrlOf 解析失败返回空串');
  }

  const apiOriginOf = need('apiOriginOf');
  if (apiOriginOf) ok(apiOriginOf('EIGHTfs', 'x') === 'https://api.github.com/repos/EIGHTfs/x', 'apiOriginOf');
  const sshOriginOf = need('sshOriginOf');
  if (sshOriginOf) ok(sshOriginOf('EIGHTfs', 'x') === 'ssh://git@ssh.github.com:443/EIGHTfs/x.git', 'sshOriginOf 走 ssh.github.com:443');

  const isBadCredentials = need('isBadCredentials');
  if (isBadCredentials) {
    ok(isBadCredentials('上传 blob 失败 .gitignore: Bad credentials') === true, 'isBadCredentials 认 Bad credentials');
    ok(isBadCredentials('HTTP 401') === true, 'isBadCredentials 认 401');
    ok(isBadCredentials('无新提交可推送') === false, 'isBadCredentials 不误伤普通失败');
  }

  const gitCFlags = need('gitCFlags');
  if (gitCFlags) {
    const cflags = gitCFlags('/tmp/repo-x');
    ok(Array.isArray(cflags) && cflags.includes('core.filemode=false') && cflags.includes('safe.directory=*') && cflags.includes('safe.directory=/tmp/repo-x'), 'gitCFlags 含 filemode=false、safe.directory=* 与 cwd');
    ok(gitCFlags('').length === 4, 'gitCFlags 无 cwd 时只有两个 -c 键值对');
  }

  const ensureGlobalFilemodeFalse = need('ensureGlobalFilemodeFalse');
  if (ensureGlobalFilemodeFalse) {
    // HOME 已指向临时目录：写的是临时 .gitconfig，不污染真实全局配置
    const fm = ensureGlobalFilemodeFalse();
    ok(typeof fm.ok === 'boolean' && typeof fm.status === 'number', `ensureGlobalFilemodeFalse 返回 ok=${fm.ok} status=${fm.status}（写临时 HOME/.gitconfig）`);
  }
  const ensureGlobalSafeDirectoryStar = need('ensureGlobalSafeDirectoryStar');
  if (ensureGlobalSafeDirectoryStar) {
    const sd = ensureGlobalSafeDirectoryStar();
    ok(typeof sd.ok === 'boolean' && typeof sd.status === 'number', `ensureGlobalSafeDirectoryStar 返回 ok=${sd.ok} skipped=${sd.skipped || ''}`);
  }

  /* ================= README 检查提示 ================= */
  if (typeof core.README_CHECK_HINT === 'string') {
    ok(core.README_CHECK_HINT.includes('git_commit_push') && core.README_CHECK_HINT.includes('README'), 'README_CHECK_HINT 常量');
  } else console.log('  ⏭ 跳过：core.README_CHECK_HINT 未导出');
  const buildReadmeCheckHint = need('buildReadmeCheckHint');
  if (buildReadmeCheckHint) {
    const hintHas = buildReadmeCheckHint({ hasReadme: true, repoName: 'demo' });
    ok(hintHas.needed === true && hintHas.hasReadme === true && hintHas.hint.includes('检查该仓库 README'), '有 README 时回传检查提示');
    const hintNo = buildReadmeCheckHint({ hasReadme: false, repoName: 'demo' });
    ok(hintNo.hasReadme === false && hintNo.hint.includes('没有 README'), '无 README 时提示先补');
  }

  /* ================= remote heads / 账号块展示（纯函数） ================= */
  const extractRemoteHeads = need('extractRemoteHeads');
  const formatRemoteHeadsTable = need('formatRemoteHeadsTable');
  if (extractRemoteHeads && formatRemoteHeadsTable) {
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
  }

  const formatGithubAccountBlock = need('formatGithubAccountBlock');
  if (formatGithubAccountBlock) {
    const block = formatGithubAccountBlock({
      loggedIn: true, cookieSet: true, username: 'EIGHTfs', userId: 1, profileUrl: 'https://github.com/EIGHTfs',
      cred: { hasToken: true, tokenMasked: 'ghp_…1234', hasSshPub: false },
    });
    ok(block.includes('✅ Token 可用') && block.includes('EIGHTfs') && !block.includes('ghp_TEST'), 'formatGithubAccountBlock 多行用户信息且无明文 token');
    const boundBlock = formatGithubAccountBlock({
      loggedIn: true, cookieSet: true, username: 'EIGHTfs', userId: 1,
      cred: { hasToken: true, tokenMasked: 'ghp_…1234', hasSshPub: true, sshFingerprint: 'AAAAC3NzaC1l…BEdYT9y4', sshBound: true, sshBoundHow: 'ssh-auth' },
    });
    ok(boundBlock.includes('公钥已绑到该账号: ✅ 是') && boundBlock.includes('SSH 实测已认证'), 'formatGithubAccountBlock SSH 实测绑定显示 ✅');
    const unboundBlock = formatGithubAccountBlock({
      loggedIn: true, cookieSet: true, username: 'EIGHTfs', userId: 1,
      cred: { hasToken: true, tokenMasked: 'ghp_…1234', hasSshPub: true, sshBound: false, sshBoundHow: '' },
    });
    ok(unboundBlock.includes('公钥已绑到该账号: ❌ 否'), 'formatGithubAccountBlock 未绑定显示 ❌');
  }

  /* ================= origin 脱敏（maskRemoteUrl） ================= */
  const maskRemoteUrl = need('maskRemoteUrl');
  if (maskRemoteUrl) {
    const m1 = maskRemoteUrl('https://EIGHTfs:ghp_SECRETTOKEN123@github.com/EIGHTfs/x.git');
    ok(!m1.includes('ghp_SECRETTOKEN123') && m1.includes(':****@') && m1.includes('EIGHTfs:'), 'maskRemoteUrl 抹掉 user:token@ 内嵌凭据');
    const m2 = maskRemoteUrl('https://ghp_SECRETTOKEN123@github.com/x/y.git');
    ok(m2.startsWith('https://****@') && !m2.includes('ghp_'), 'maskRemoteUrl 抹掉裸 token@');
    const m3 = maskRemoteUrl('https://api.github.com/repos/a/b?token=SECRETTOK&x=1');
    ok(m3.includes('token=****') && !m3.includes('SECRETTOK'), 'maskRemoteUrl 抹掉 query token');
    ok(maskRemoteUrl('ssh://git@ssh.github.com:443/a/b.git') === 'ssh://git@ssh.github.com:443/a/b.git', 'maskRemoteUrl SSH URL 原样');
    ok(maskRemoteUrl('') === '', 'maskRemoteUrl 空串返回空');
  }

  /* ================= 默认 owner 可配置（setDefaultGithubOwner / getDefaultGithubOwner） ================= */
  if (typeof core.setDefaultGithubOwner === 'function' && typeof core.getDefaultGithubOwner === 'function') {
    const orig = core.getDefaultGithubOwner();
    ok(orig === (core.DEFAULT_GITHUB_OWNER || 'EIGHTfs'), `getDefaultGithubOwner 初始=${orig}`);
    core.setDefaultGithubOwner('SomeoneElse');
    ok(core.getDefaultGithubOwner() === 'SomeoneElse', 'setDefaultGithubOwner 覆盖默认 owner');
    core.setDefaultGithubOwner('');
    ok(core.getDefaultGithubOwner() === 'SomeoneElse', 'setDefaultGithubOwner 空串不覆盖');
    core.setDefaultGithubOwner(orig);
    ok(core.getDefaultGithubOwner() === orig, 'setDefaultGithubOwner 测后恢复');
  }

  /* ================= githubFetch 硬闸（不联网，仅域名/URL 校验路径） ================= */
  const githubFetch = need('githubFetch');
  if (githubFetch) {
    const denied = await githubFetch('https://github.com/EIGHTfs/x', {});
    ok(denied.status === 0 && /拒绝非 api.github.com/.test(denied.error || ''), 'githubFetch 拒绝 github.com');
    // 相对 path 会被拼到 GH_API（不算非法），只有绝对 URL 的 host 硬闸拦截——用 codeload 域名验证（不联网）
    const denied2 = await githubFetch('https://codeload.github.com/EIGHTfs/x/tarball/master', {});
    ok(denied2.status === 0 && /拒绝非 api.github.com/.test(denied2.error || ''), 'githubFetch 拒绝 codeload 等非 API 域名');
  }
  if (typeof core.probeSshGithubAuth === 'function') {
    ok(true, 'probeSshGithubAuth 已导出（不实测 SSH 网络）');
  }

  /* ================= credentialsDir（v1.40.0 插件配置目录） ================= */
  const credentialsDir = need('credentialsDir');
  if (credentialsDir) {
    ok(credentialsDir() === credDir, `credentialsDir() 解析 DSH_HOME/git-push → ${credDir}`);
    ok(credentialsDir({ workspaceRoot: '/somewhere/ws' }) === credDir, 'credentialsDir DSH_HOME 优先于 workspaceRoot 参数');
  }

  /* ================= persistGithubToken / githubTokenStatus（写入临时 credentialsDir，验证 0600） ================= */
  const persistGithubToken = need('persistGithubToken');
  const githubTokenStatus = need('githubTokenStatus');
  if (persistGithubToken && githubTokenStatus) {
    ok(persistGithubToken('not-a-token').ok === false, 'persistGithubToken 拒绝非法格式 token');
    ok(persistGithubToken('').ok === false, 'persistGithubToken 拒绝空 token');
    const t40 = 'ghp_' + 'A'.repeat(36);
    const saved = persistGithubToken(t40);
    ok(saved.ok === true && saved.source === join(credDir, 'github-token'), 'persistGithubToken 写入 credentialsDir/github-token');
    ok(existsSync(saved.source) && readFileSync(saved.source, 'utf8') === `${t40}\n`, 'token 文件已写入（本地临时文件）');
    const mode = statSync(saved.source).mode & 0o777;
    ok(mode === 0o600, `token 文件权限 0600（实际 ${mode.toString(8)}）`);
    const st = githubTokenStatus();
    ok(st.configured === true && st.source === join(credDir, 'github-token'), 'githubTokenStatus 报已配置 + 来源');
    ok(!JSON.stringify(st).includes('ghp_'), 'githubTokenStatus 不回传明文');
  }

  /* ================= resolveGitToken 解析链（credentialsDir → repoPath/.git-push-token → 空） ================= */
  const resolveGitToken = need('resolveGitToken');
  const repoTok = tmp('git-push-tokrepo-');
  if (resolveGitToken) {
    makeGit(repoTok, {});
    writeFileSync(join(repoTok, '.git-push-token'), `${tok40('ghp_REPOTOKENREPOTOKENREPOTOKENREPO')}\n`);
    const pick1 = resolveGitToken({ repoPath: repoTok });
    ok(pick1.source === join(credDir, 'github-token') && pick1.token.startsWith('ghp_'), 'resolveGitToken credentialsDir/github-token 优先于仓内 .git-push-token');
    rmSync(join(credDir, 'github-token'));
    const pick2 = resolveGitToken({ repoPath: repoTok });
    ok(pick2.source === join(repoTok, '.git-push-token'), 'resolveGitToken 回退仓内 .git-push-token');
    writeFileSync(join(repoTok, '.git-push-token'), 'garbage-token\n');
    const pick3 = resolveGitToken({ repoPath: repoTok });
    ok(pick3.token === '' && pick3.source === '', 'resolveGitToken 格式不符的候选被跳过');
    rmSync(join(repoTok, '.git-push-token'));
    ok(resolveGitToken({ repoPath: repoTok }).token === '', 'resolveGitToken 无候选返回空 token');
    // 此处保持凭据目录 / 仓内均无 token，供下方 resolveValidGitToken「无 token」用例
  }

  /* ================= resolveValidGitToken（异步真校验：失效 token 回退同步结果） ================= */
  const resolveValidGitToken = need('resolveValidGitToken');
  if (resolveValidGitToken) {
    core.clearTokenValidCache?.();
    const v1 = await resolveValidGitToken({ repoPath: repoTok });
    ok(v1.token === '' && v1.source === '', 'resolveValidGitToken 无 token 返回空结构');
    const fake40 = tok40('ghp_FAKEVALIDTOKENFAKEVALIDTOKEN00');
    persistGithubToken?.(fake40);
    core.clearTokenValidCache?.();
    const v2 = await resolveValidGitToken({});
    ok(v2.token === fake40 && v2.source === join(credDir, 'github-token'), 'resolveValidGitToken 40 位假 token 校验失败后回退同步结果（source 指向 credentialsDir）');
  }

  /* ================= loadRequirements（credentialsDir 覆盖 → 坏 JSON 回退 → 内置兜底） ================= */
  const loadRequirements = need('loadRequirements');
  const reqFile = join(credDir, 'requirements.json');
  if (loadRequirements) {
    writeFileSync(reqFile, JSON.stringify({ user: 'Tester', items: ['1. 测试要求A', '2. 测试要求B'] }));
    const ov = loadRequirements();
    ok(ov.found === true && ov.user === 'Tester' && ov.items.length === 2 && ov.items.some((i) => i.includes('测试要求A')), 'loadRequirements 读 credentialsDir/requirements.json 覆盖');
    writeFileSync(reqFile, '{broken json');
    const fbBad = loadRequirements();
    ok(fbBad.found === true && fbBad.user === 'EIGHTfs' && fbBad.items.length > 0, '覆盖文件坏 JSON 时回退内置要求清单');
    rmSync(reqFile);
    const builtin = loadRequirements();
    ok(builtin.found === true && builtin.user === 'EIGHTfs' && builtin.items.length === 7, `内置兜底 ${builtin.items.length} 条要求（lib/user-requirements.json）`);
    ok(builtin.files.some((f) => String(f.file).includes('user-requirements.json')), '内置清单来源为插件 lib/user-requirements.json');
  }

  /* ================= findGitDirs / scanRepos / readRepoStatus（真实临时仓） ================= */
  const coreRoot = tmp('git-push-core-');
  const repoA = join(coreRoot, 'repo-a');
  const repoB = join(coreRoot, 'repo-b');
  makeGit(repoA, { files: { 'a.txt': 'hello\n' } });
  makeGit(repoB, { files: { 'b.txt': 'world\n' } });
  const repoEmpty = join(coreRoot, 'repo-empty');
  mkdirSync(repoEmpty, { recursive: true });
  execSync('git init -b master', { cwd: repoEmpty, stdio: 'ignore' }); // 空仓（无提交）应被 scanRepos 跳过
  const nmRepo = join(coreRoot, 'node_modules', 'nest');
  makeGit(nmRepo, { files: { 'x.txt': 'x\n' } }); // node_modules 下应被 findGitDirs 过滤

  const runGit = need('runGit');
  const findGitDirs = need('findGitDirs');
  const scanRepos = need('scanRepos');
  const readRepoStatus = need('readRepoStatus');
  if (findGitDirs) {
    const dirs = findGitDirs(coreRoot, 3);
    ok(Array.isArray(dirs) && dirs.includes(repoA) && dirs.includes(repoB) && !dirs.some((d) => d.includes('node_modules')), `findGitDirs 返回数组，找到 ${dirs.length} 个仓且过滤 node_modules`);
  }
  if (scanRepos) {
    const repos = scanRepos({ root: coreRoot, depth: 3 });
    ok(repos.length === 2, `scanRepos 找到 ${repos.length} 个仓库（空仓与 node_modules 被跳过）`);
    ok(repos.every((r) => r.branch === 'master' && r.changes === 0 && r.name && r.path), 'scanRepos 分支 master / 初始无变更 / name+path');
    // readExtraReposFile / extraRepos 补充扫描
    const readExtraReposFile = need('readExtraReposFile');
    if (readExtraReposFile) {
      const f = join(coreRoot, 'extra.txt');
      writeFileSync(f, `# 注释行\n${repoA}\n\n  ${repoB}  \n`);
      const parsed = readExtraReposFile(f);
      ok(parsed.length === 2 && parsed[0] === repoA, 'readExtraReposFile 解析路径/注释/空行');
      ok(readExtraReposFile('/no/such/extra-file').length === 0, 'readExtraReposFile 文件不存在返回空数组');
      const emptyDir = join(coreRoot, 'scan-empty');
      mkdirSync(emptyDir, { recursive: true });
      const repos2 = scanRepos({ root: emptyDir, extraRepos: [repoB], extraReposFile: f });
      ok(repos2.some((r) => r.path === repoA) && repos2.some((r) => r.path === repoB), 'scanRepos extraRepos/extraReposFile 补充生效（同名去重）');
    }
  }
  if (readRepoStatus) {
    writeFileSync(join(repoA, 'a.txt'), 'hello world\n');
    const stA = readRepoStatus(repoA);
    ok(stA.changes === 1 && stA.changeLines.length === 1, `改动后 changes=${stA.changes}`);
    const repoMask = tmp('git-push-mask-');
    makeGit(repoMask, { origin: 'https://EIGHTfs:ghp_STATUSSECRETTOK123@github.com/EIGHTfs/x.git' });
    const stMask = readRepoStatus(repoMask);
    ok(!stMask.remote.includes('ghp_STATUSSECRETTOK123') && stMask.remote.includes('****@'), `readRepoStatus origin 内嵌凭据脱敏（${JSON.stringify(stMask.remote)}）`);
    ok(stMask.shortId.length >= 4 && typeof stMask.lastActivity === 'string', 'readRepoStatus shortId/lastActivity 返回');
  }
  if (runGit) {
    const r = runGit(['rev-parse', '--is-inside-work-tree'], repoA);
    ok(r.status === 0 && r.stdout === 'true', 'runGit 真实仓内执行成功');
    const bad = runGit(['nonexistent-subcmd-xyz'], repoA);
    ok(bad.status !== 0, `runGit 失败命令返回非零 status=${bad.status}`);
    // v1.18.4：只改可执行位不应进 status（core.filemode=false）
    chmodSync(join(repoB, 'b.txt'), 0o755);
    const stMode = runGit(['status', '--porcelain'], repoB).stdout;
    ok(stMode === '', `只改可执行位时 porcelain 为空（got ${JSON.stringify(stMode)}）`);
  }

  /* ================= commitAndPush（真实仓 + 开发者要求门禁） ================= */
  const commitAndPush = need('commitAndPush');
  if (commitAndPush && loadRequirements) {
    // 覆盖清单仍在（Tester 2 条）：不带 requirementsConfirmed 必须拦截
    writeFileSync(join(repoA, 'a.txt'), 'hello world v2\n');
    const blocked = await commitAndPush({ repoPath: repoA, message: 'feat: 测试提交' });
    ok(blocked.ok === false && blocked.blocked === true && blocked.code === 'USER_REQUIREMENTS', 'commitAndPush 未核对开发者要求时拦截（USER_REQUIREMENTS）');
    const r1 = await commitAndPush({ repoPath: repoA, message: 'feat: 测试提交', requirementsConfirmed: true });
    ok(r1.ok === true && r1.committed === true, 'commitAndPush 核对要求后提交成功');
    ok(r1.commitId?.length >= 4, `返回 commitId=${r1.commitId || ''}`);
    ok(r1.push?.pushed === false && typeof r1.push?.reason === 'string', `无 remote 时 push 未成功 reason=${r1.push?.reason}`);
    const r2 = await commitAndPush({ repoPath: repoA, message: 'feat: 空提交', requirementsConfirmed: true });
    ok(r2.committed === false, '无变更时跳过提交');
    writeFileSync(join(repoB, 'b.txt'), 'world2\n');
    const r3 = await commitAndPush({ repoPath: repoB, message: 'feat: dry-run', dryRun: true, requirementsConfirmed: true });
    ok(r3.dryRun === true && r3.committed === false, 'dryRun 不执行提交');
    const r4 = await commitAndPush({ repoPath: repoA, message: '', requirementsConfirmed: true });
    ok(r4.ok === false && r4.error.includes('message'), '空 message 被拒绝');
    const r5 = await commitAndPush({ repoPath: join(coreRoot, 'no-such'), message: 'x', requirementsConfirmed: true });
    ok(r5.ok === false && r5.error.includes('不是 git 仓库'), '非仓库被拒绝');
  }

  /* ================= ensureCustomIgnored（真实仓：追加 pattern + 解除跟踪 + 幂等） ================= */
  const ensureCustomIgnored = need('ensureCustomIgnored');
  if (ensureCustomIgnored) {
    const igRoot = tmp('git-push-ignore-');
    makeGit(igRoot, { files: { 'x.bak': 'backup\n', 'keep.txt': 'keep\n' } });
    const ig1 = ensureCustomIgnored(igRoot, '*.bak*, *.tmp');
    ok(ig1.ok && ig1.added.includes('*.bak*') && ig1.added.includes('*.tmp'), 'ensureCustomIgnored 追加缺失 pattern');
    ok(ig1.tracked.includes('*.bak*'), 'glob 模式 *.bak* 匹配已跟踪的 x.bak → 进 tracked');
    ok(readFileSync(join(igRoot, '.gitignore'), 'utf8').includes('*.bak*'), '.gitignore 已写入自定义 pattern');
    const lsAfter1 = runGit?.(['ls-files', '--', 'x.bak'], igRoot);
    ok(lsAfter1 && lsAfter1.status === 0 && lsAfter1.stdout.trim() === '', 'ensureCustomIgnored 解除已跟踪文件跟踪');
    const ig2 = ensureCustomIgnored(igRoot, '*.bak*, *.tmp');
    ok(ig2.ok && ig2.added.length === 0, 'ensureCustomIgnored 幂等：重复调用不追加');
    ok(ensureCustomIgnored(igRoot, '').ok && ensureCustomIgnored(igRoot, '').added.length === 0, 'ensureCustomIgnored 空 pattern 无操作');
    const ig3 = ensureCustomIgnored(igRoot, 'x.bak');
    ok(ig3.ok && ig3.added.includes('x.bak') && !ig3.tracked.includes('x.bak'), 'ensureCustomIgnored 已解除文件字面路径加入时 tracked 为空');
  }

  /* ================= 敏感字段扫描 / 豁免 / 自动 gitignore ================= */
  const scanSensitiveFiles = need('scanSensitiveFiles');
  if (scanSensitiveFiles) {
    const repoSens = tmp('git-push-sens-');
    makeGit(repoSens, {});
    writeFileSync(join(repoSens, 'secret.js'), 'const password = "hunter2pass";\nconst username = "aliceuser";\n');
    const hits = scanSensitiveFiles(repoSens);
    const hitSecret = hits.find((h) => h.path === 'secret.js');
    ok(!!hitSecret && hitSecret.fields.includes('password') && hitSecret.fields.includes('username'), 'scanSensitiveFiles 检出 password/username 字面量');
    writeFileSync(join(repoSens, 'ok.js'), [
      'const password = "changeme";',
      'const password = getPassword();',
      'const password = "realpass1"; // dsh-skip-sensitive',
      'const cookie = "a=b;c=d";',
    ].join('\n') + '\n');
    writeFileSync(join(repoSens, 'exempt.js'), '// dsh-skip-sensitive 整文件豁免\nconst password = "realpass2";\n');
    const hits2 = scanSensitiveFiles(repoSens);
    ok(!hits2.some((h) => h.path === 'ok.js'), '占位符 / 表达式 / 行内豁免不误报');
    ok(!hits2.some((h) => h.path === 'exempt.js'), '文件头 dsh-skip-sensitive 整文件豁免');
    if (typeof core.hasLineExempt === 'function') {
      ok(core.hasLineExempt('x = 1 // dsh-skip-sensitive') === true && core.hasLineExempt('x = 1') === false, 'hasLineExempt 行内豁免判定');
    }
    if (typeof core.hasFileHeaderExempt === 'function') {
      ok(core.hasFileHeaderExempt('// dsh-skip-sensitive\nx=1') === true && core.hasFileHeaderExempt('a\nb\nx=1') === false, 'hasFileHeaderExempt 文件头（前 3 行）豁免判定');
    }
    if (typeof core.SENSITIVE_EXEMPT_MARKER === 'string') {
      ok(core.SENSITIVE_EXEMPT_MARKER === 'dsh-skip-sensitive', 'SENSITIVE_EXEMPT_MARKER 常量');
    }
    const ensureSensitiveIgnored = need('ensureSensitiveIgnored');
    if (ensureSensitiveIgnored) {
      const s1 = ensureSensitiveIgnored(repoSens);
      ok(s1.ok === true && s1.added.includes('secret.js'), 'ensureSensitiveIgnored 命中文件追加 .gitignore');
      ok(readFileSync(join(repoSens, '.gitignore'), 'utf8').includes('secret.js'), '.gitignore 已写入命中文件');
      const s2 = ensureSensitiveIgnored(repoSens);
      ok(s2.ok === true && s2.added.length === 0, 'ensureSensitiveIgnored 幂等');
      const s3 = ensureSensitiveIgnored(repoSens, { skipWrite: true });
      ok(s3.ok === true && s3.added.length === 0 && s3.skipped === 'private-repo-exempt', 'skipWrite=true 只报告不写（私有库豁免）');
    }
  }

  /* ================= rebuildHistory / previewRebuildHistory（真实临时仓，force=false 不联网） ================= */
  const previewRebuildHistory = need('previewRebuildHistory');
  const rebuildHistory = need('rebuildHistory');
  if (previewRebuildHistory && rebuildHistory) {
    // fresh：当前文件树作为唯一提交，版本号保持 package.json 不变
    const repoFresh = tmp('git-push-fresh-');
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
    ok(preview.ok === true && preview.after === 1 && /版本号/.test(preview.plan), `fresh 预览 plan=${preview.plan}`);
    const rebuilt = await rebuildHistory({ repoPath: repoFresh, mode: 'fresh', force: false });
    ok(rebuilt.ok === true, `fresh 重建 ok error=${rebuilt.error || ''}`);
    const afterCount = Number(execSync('git rev-list --count HEAD', { cwd: repoFresh, encoding: 'utf8' }).trim());
    ok(afterCount === 1, `fresh 后提交数=${afterCount}`);
    ok(JSON.parse(readFileSync(join(repoFresh, 'package.json'), 'utf8')).version === '2.6.0', 'fresh 不改 package.json 版本号');
    ok(rebuilt.version === '2.6.0', `fresh 返回 version=${rebuilt.version}`);
    ok(rebuilt.push?.pushed === false, `force=false 不推远端 reason=${rebuilt.push?.reason}`);
    ok(existsSync(join(repoFresh, '.git')), 'fresh 保留 .git');

    // squash-bugfixes：补丁版本并入主版本 + dryRun 不落盘 + backup tag
    // 注：临时 HOME 无全局 user.name，lib rebuildHistory 的 squash 分支 commit 无 identity 兜底（fresh 有）
    // → fixture 先写局部 git 身份，聚焦验证 squash 逻辑本身
    const repoSquash = tmp('git-push-squash-');
    mkdirSync(repoSquash, { recursive: true });
    execSync('git init -b master', { cwd: repoSquash, stdio: 'ignore' });
    execSync('git config user.name t && git config user.email t@t', { cwd: repoSquash, stdio: 'ignore' });
    writeFileSync(join(repoSquash, 'package.json'), JSON.stringify({ name: 'sq', version: '1.1.0' }));
    writeFileSync(join(repoSquash, 'f0.txt'), '0\n');
    execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m "feat: 1.0.0 初始"', { cwd: repoSquash, stdio: 'ignore' });
    writeFileSync(join(repoSquash, 'f1.txt'), '1\n');
    execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m "fix: 1.0.1 补丁"', { cwd: repoSquash, stdio: 'ignore' });
    writeFileSync(join(repoSquash, 'f2.txt'), '2\n');
    execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m "feat: 1.1.0 功能"', { cwd: repoSquash, stdio: 'ignore' });
    const pv = previewRebuildHistory({ repoPath: repoSquash, mode: 'squash-bugfixes' });
    ok(pv.ok === true && pv.before === 3 && pv.after === 2 && pv.dropped === 1, `squash 预览 3→2（dropped=${pv.dropped}）`);
    ok(pv.keepGroups?.[0]?.mergedFixes?.includes('1.0.1'), '1.0.1 补丁并入 1.0.0 主版本组');
    const pvDrop = previewRebuildHistory({ repoPath: repoSquash, mode: 'drop-versions', dropFrom: '1.0.1', dropTo: '1.0.9' });
    ok(pvDrop.ok === true && pvDrop.after === 2, `drop-versions 预览删除 1.0.1 后剩 ${pvDrop.after} 组`);
    ok(previewRebuildHistory({ repoPath: repoSquash, mode: 'no-such' }).ok === false, '未知模式拒绝');
    const rbDry = await rebuildHistory({ repoPath: repoSquash, mode: 'squash-bugfixes', dryRun: true });
    ok(rbDry.ok === true && rbDry.dryRun === true && rbDry.before === 3 && rbDry.after === 2, 'squash dryRun 只预演');
    ok(Number(execSync('git rev-list --count HEAD', { cwd: repoSquash, encoding: 'utf8' }).trim()) === 3, 'dryRun 后提交数不变');
    const rb = await rebuildHistory({ repoPath: repoSquash, mode: 'squash-bugfixes', force: false });
    ok(rb.ok === true && rb.after === 2, `squash 执行 after=${rb.after}`);
    const afterSquash = Number(execSync('git rev-list --count HEAD', { cwd: repoSquash, encoding: 'utf8' }).trim());
    ok(afterSquash === 2, `squash 后提交数=${afterSquash}`);
    ok(!!rb.backupTag && runGit?.(['rev-parse', '--verify', '--quiet', rb.backupTag], repoSquash).status === 0, `backup tag ${rb.backupTag || ''} 已打`);
    ok(rb.version === '1.1.0', `squash 返回 version=${rb.version}`);
    ok(rb.push?.pushed === false, 'squash force=false 不推远端');
  }

  /* ================= resolveReadmeTemplate / genReadme（真实临时仓 + 模板只认插件 template/README.md） ================= */
  const resolveReadmeTemplate = need('resolveReadmeTemplate');
  const genReadme = need('genReadme');
  if (resolveReadmeTemplate && genReadme) {
    // v1.40.0：模板只读插件 template/README.md（当前仓无该文件 → 内置骨架），原同级仓模板废除
    const built = resolveReadmeTemplate({});
    const srcOk = built.source === 'builtin' || String(built.source).includes('README.md');
    ok(srcOk && built.template.includes('{{name}}'), `resolveReadmeTemplate 模板可用（source=${built.source}）`);
    const repoReadme = tmp('git-push-readme-');
    mkdirSync(repoReadme, { recursive: true });
    execSync('git init -b master', { cwd: repoReadme, stdio: 'ignore' });
    writeFileSync(join(repoReadme, 'package.json'), JSON.stringify({ name: 'demo', description: '简介文本', version: '1.2.0' }));
    writeFileSync(join(repoReadme, 'doc.txt'), 'one\n');
    execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m "feat: 1.2.0 初始功能"', { cwd: repoReadme, stdio: 'ignore' });
    const rd = genReadme({ repoPath: repoReadme });
    ok(rd.ok === true && rd.content.includes('# demo') && rd.content.includes('简介文本'), 'genReadme 填项目名/描述');
    ok(rd.templateSource === built.source, 'genReadme 模板来源与 resolveReadmeTemplate 一致');
    ok(rd.versionTable.some((l) => l.includes('1.2.0')), 'genReadme 版本表含 git log 版本组');
    const out = join(repoReadme, 'README-gen.md');
    const rd2 = genReadme({ repoPath: repoReadme, writePath: out });
    ok(rd2.written === true && existsSync(out), 'genReadme writePath 落盘');
    ok(genReadme({ repoPath: '' }).ok === false, 'genReadme 缺 repoPath 拒绝');
  }

  /* ================= skill 注入（真实只读：插件 skills/；v1.40.0 不再有同级仓来源） ================= */
  const collectRepoSkillDocs = need('collectRepoSkillDocs');
  const collectRepoSkillDirs = need('collectRepoSkillDirs');
  const formatRepoSkillInjection = need('formatRepoSkillInjection');
  const formatRepoSkillDirsInjection = need('formatRepoSkillDirsInjection');
  if (collectRepoSkillDocs && collectRepoSkillDirs && formatRepoSkillInjection && formatRepoSkillDirsInjection) {
    // DSH_HOME/HOME 已隔离（临时目录无技能仓）→ 注入源只剩插件 skills/
    const docs = collectRepoSkillDocs({ pluginRoot: core.PLUGIN_ROOT });
    ok(Array.isArray(docs) && docs.length > 0 && docs.every((d) => d.path && typeof d.text === 'string'), `collectRepoSkillDocs 收 ${docs.length} 份插件 skill md`);
    ok(docs.some((d) => d.path === 'dsh-git-push/skills/dsh-git-push-functions.md'), 'collectRepoSkillDocs 含插件功能说明书');
    ok(docs.every((d) => d.path.startsWith('dsh-git-push/skills/')), 'v1.40.0 注入源只有插件 skills/（同级仓废除）');
    const inj = formatRepoSkillInjection(docs);
    ok(inj.includes('## dsh-git-push/skills/dsh-git-push-functions.md') && inj.includes('强制 skill'), 'formatRepoSkillInjection 含路径与正文');
    ok(formatRepoSkillInjection([]) === '', 'formatRepoSkillInjection 空数组返回空');
    const dirs = collectRepoSkillDirs({ pluginRoot: core.PLUGIN_ROOT });
    ok(dirs.some((d) => d.base === 'dsh-git-push/skills' && d.files.includes('dsh-git-push-functions.md')), 'collectRepoSkillDirs 列目录与文件清单');
    const dirInj = formatRepoSkillDirsInjection(dirs);
    ok(dirInj.includes('dsh-git-push/skills') && dirInj.includes('dsh-git-push-functions.md') && !dirInj.includes('## dsh-git-push/skills/'), 'formatRepoSkillDirsInjection 只列清单不含正文');
    ok(formatRepoSkillDirsInjection([]) === '', 'formatRepoSkillDirsInjection 空数组返回空');
  }

  /* ================= collectFunctionManual / FUNCTION_MANUAL_COMPACT ================= */
  const collectFunctionManual = need('collectFunctionManual');
  if (collectFunctionManual && typeof core.FUNCTION_MANUAL_COMPACT === 'string') {
    ok(core.FUNCTION_MANUAL_COMPACT.includes('精简注入') && core.FUNCTION_MANUAL_COMPACT.includes('git_scan'), 'FUNCTION_MANUAL_COMPACT 精简目录常量');
    ok(collectFunctionManual({ pluginRoot: core.PLUGIN_ROOT }) === core.FUNCTION_MANUAL_COMPACT, 'collectFunctionManual 默认精简');
    const full = collectFunctionManual({ pluginRoot: core.PLUGIN_ROOT, compact: false });
    ok(full.includes('dsh-git-push') && full.length > core.FUNCTION_MANUAL_COMPACT.length, 'compact=false 返回全文说明书');
    const noRoot = join(tmp('git-push-noplugin-'), 'no');
    ok(collectFunctionManual({ pluginRoot: noRoot }) === core.FUNCTION_MANUAL_COMPACT, '说明书缺失时精简目录仍注入');
    ok(collectFunctionManual({ pluginRoot: noRoot, compact: false }) === '', 'compact=false 且说明书缺失返回空');
  }
} catch (e) {
  fail++;
  console.log(`  ❌ 测试执行异常: ${e?.stack || e?.message || e}`);
} finally {
  // 恢复真实环境变量，清理全部临时目录（绝不留真实配置目录半点痕迹）
  if (origDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = origDshHome;
  if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
  for (const d of roots) { try { rmSync(d, { recursive: true, force: true }); } catch { /* 清理失败不影响退出码 */ } }
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
