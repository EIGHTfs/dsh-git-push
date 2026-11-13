/**
 * test-git-core.mjs —— 同族测试合并（test-git-bin-plan.mjs · test-git-hooks.mjs · test-git-identity-rewrite.mjs · test-git-path-args.mjs · test-git-rename.mjs · test-git-stream.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { collectChangedFiles } from '../../lib/audit/collector.js';
import { GIT_GLOBAL_ARGS, runGitStream } from '../../lib/core/exec.js';
import { cloneWithGitFetch } from '../../lib/git/clone-history-mode.js';
import { gitSearchPlan, runGit } from '../../lib/git/exec.js';
import { describeHooks, probeHooks } from '../../lib/git/hooks.js';
import { buildLegacyIdentityHint, identityHits, legacyIdentityReport, parseGithubRepo, rewriteRepoIdentity, wrongIdentityEmails } from '../../lib/git/identity-rewrite.js';
import { remotesPointingTo, renameRepo, scanOldName } from '../../lib/git/rename.js';
import { mkdtempTracked } from '../helpers/tmp-dir.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// ── 原 test-git-bin-plan.mjs ──
{
  /**
   * git 可执行文件解析的跨平台回归测试（lib/git/exec.js 的 gitSearchPlan）。
   *
   * 背景（真缺陷）：旧实现写死 `PATH.split(':')` 且候选名只试 `git` —— 在 Windows 上
   *   PATH 用 `;` 分隔、可执行名是 `git.exe`，于是**永远找不到 git**，报出
   *   「找不到 git 可执行文件」这种看似环境问题的误导结论。本测试钉住平台差异。
   */


  test('[git-bin-plan] gitSearchPlan：Windows 用 ";" 切分且候选名为 git.exe', () => {
    const win = 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd;D:\\tools';
    const plan = gitSearchPlan(win, { delimiter: ';', platform: 'win32' });
    assert.deepEqual(plan.dirs, ['C:\\Windows\\system32', 'C:\\Program Files\\Git\\cmd', 'D:\\tools'], '必须按 ; 切分');
    assert.equal(plan.names[0], 'git.exe', 'Windows 首选 git.exe');
    assert.ok(plan.names.includes('git.cmd'), '还应兜底 git.cmd/git.bat');
    // 反例：用 ':' 切 Windows PATH 会被**盘符的冒号**切坏（旧实现的行为）→ 目录全不对、找不到 git
    const wrong = gitSearchPlan(win, { delimiter: ':', platform: 'win32' });
    assert.notDeepEqual(wrong.dirs, plan.dirs, '用错分隔符的切分结果必然不同');
    assert.ok(!wrong.dirs.includes('C:\\Program Files\\Git\\cmd'), '用错分隔符时该目录被切坏（这正是旧缺陷：永远找不到 git）');
  });

  test('[git-bin-plan] gitSearchPlan：POSIX 用 ":" 切分且候选名为 git', () => {
    // 夹具用**合成目录名**（/opt-a、/opt-b）而非真实 /usr/...：本用例只验证"按 : 切分"，
    //   写死真实绝对路径既无必要、换机后又失效、还会被硬编码路径规则报出。
    const plan = gitSearchPlan('/opt-a/bin:/opt-b/bin:/plain', { delimiter: ':', platform: 'linux' });
    assert.deepEqual(plan.dirs, ['/opt-a/bin', '/opt-b/bin', '/plain']);
    assert.deepEqual(plan.names, ['git']);
  });

  test('[git-bin-plan] gitSearchPlan：去掉目录尾部分隔符、跳过空段', () => {
    const posix = gitSearchPlan('/opt-a/bin/::/opt-b/git/', { delimiter: ':', platform: 'linux' });
    assert.deepEqual(posix.dirs, ['/opt-a/bin', '/opt-b/git'], '尾部 / 去掉、空段跳过');
    const win = gitSearchPlan('C:\\Git\\cmd\\;', { delimiter: ';', platform: 'win32' });
    assert.deepEqual(win.dirs, ['C:\\Git\\cmd'], '尾部 \\ 去掉');
    assert.deepEqual(gitSearchPlan('', { delimiter: ':', platform: 'linux' }).dirs, [], '空 PATH → 无目录');
    assert.deepEqual(gitSearchPlan(undefined, { delimiter: ':', platform: 'linux' }).dirs, [], 'undefined 安全');
  });
}

// ── 原 test-git-hooks.mjs ──
{
  /**
   * git 钩子探针测试（2026-11-01，同机会话实测移交驱动）。
   *
   * 背景：CIFS 仓库里存在从旧机器随 `.git/` 迁过来的 `prepare-commit-msg`，
   *   里面写死了上一台机器的 pnpm 路径（/volume13/...）。插件此前对钩子零感知：
   *   既不说明"本次会触发哪些钩子"，也不知道这个钩子一跑就失败。
   *
   * 处置口径（本测试锁死）：**正常钩子一律照跑**（很多仓库靠 pre-commit 做 lint），
   *   只有「可证明坏掉」（解释器不存在 / 引用的机器路径不存在）才给 LEFTHOOK=0 并说明原因。
   */


  /** 造一个带 .git/hooks 的临时仓库。 */
  function withRepo(fn) {
    const root = mkdtempSync(join(tmpdir(), 'dshgp-hooks-'));
    mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
    try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
  }

  function writeHook(root, name, body, mode = 0o755) {
    const p = join(root, '.git', 'hooks', name);
    writeFileSync(p, body, 'utf8');
    chmodSync(p, mode);
    return p;
  }

  test('[git-hooks] 无钩子 ⇒ 空清单、不注入 env', () => withRepo((root) => {
    const r = probeHooks(root);
    assert.deepEqual(r.items, []);
    assert.deepEqual(r.env, {});
    assert.match(describeHooks(r), /不触发任何 git 钩子/);
  }));

  test('[git-hooks] 正常钩子 ⇒ 照跑（不给 LEFTHOOK=0）', () => withRepo((root) => {
    writeHook(root, 'pre-commit', '#!/bin/sh\nnpm run lint\n');
    const r = probeHooks(root);
    assert.deepEqual(r.active, ['pre-commit']);
    assert.deepEqual(r.broken, []);
    assert.deepEqual(r.env, {}, '正常钩子不能被插件擅自关掉');
  }));

  test('[git-hooks] 坏解释器 ⇒ 标记 broken 并注入 LEFTHOOK=0', () => withRepo((root) => {
    writeHook(root, 'prepare-commit-msg', '#!/volume13/dead/node/bin/node\nconsole.log(1)\n');
    const r = probeHooks(root);
    assert.deepEqual(r.broken, ['prepare-commit-msg']);
    assert.deepEqual(r.env, { LEFTHOOK: '0' });
    assert.match(describeHooks(r), /坏：解释器不存在/);
  }));

  test('[git-hooks] 脚本引用不存在的机器路径 ⇒ 标记 broken', () => withRepo((root) => {
    writeHook(root, 'pre-commit', '#!/bin/sh\nexec /volume13/old/pnpm exec lefthook run pre-commit\n');
    const r = probeHooks(root);
    assert.deepEqual(r.broken, ['pre-commit']);
    assert.match(r.items[0].reason, /路径不存在/);
  }));

  test('[git-hooks] 引用系统路径（/bin/sh 等）不算坏', () => withRepo((root) => {
    writeHook(root, 'commit-msg', '#!/bin/sh\n/bin/grep -q . "$1"\n');
    const r = probeHooks(root);
    assert.deepEqual(r.broken, []);
  }));

  test('[git-hooks] 不可执行的钩子不列（git 本来就不会跑它）', () => withRepo((root) => {
    writeHook(root, 'pre-push', '#!/bin/sh\necho hi\n', 0o644);
    const r = probeHooks(root);
    assert.deepEqual(r.items, []);
  }));

  test('[git-hooks] 多个钩子：只跳过坏的，好的照跑', () => withRepo((root) => {
    writeHook(root, 'pre-commit', '#!/bin/sh\necho lint\n');
    writeHook(root, 'prepare-commit-msg', '#!/volume13/dead/node\n');
    const r = probeHooks(root);
    assert.deepEqual(r.active.sort(), ['pre-commit', 'prepare-commit-msg']);
    assert.deepEqual(r.broken, ['prepare-commit-msg']);
    const text = describeHooks(r);
    assert.match(text, /pre-commit/);
    assert.match(text, /prepare-commit-msg（坏/);
  }));

  test('[git-hooks] .git 不存在 ⇒ 不抛、返回空', () => {
    const root = mkdtempSync(join(tmpdir(), 'dshgp-nogit-'));
    try {
      const r = probeHooks(root);
      assert.deepEqual(r.items, []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

// ── 原 test-git-identity-rewrite.mjs ──
{
  /**
   * 提交身份历史改写（lib/git/identity-rewrite.js）回归测试。
   *
   * 钉子（都是安全属性，不能只测 happy path）：
   *   ① dryRun 报告命中数但**一个字节都不写**（HEAD 不变、没有备份引用）
   *   ② 真改写：身份全规范、提交数不变、工作树内容不变、备份引用存在
   *   ③ 未命中的提交（别人的身份）**sha 完全不变**——证明只动了该动的
   *   ④ 已跟踪文件有改动 → 拒绝改写（不把未保存的工作卷进历史重写）
   *   ⑤ 只有未跟踪文件 → 不该被拦（很多仓库有大量未跟踪产物）
   */


  const CANON = { name: 'EIGHTfs', email: '38984640+EIGHTfs@users.noreply.github.com' };
  const OTHER = { name: 'Other', email: 'other@example.com' };
  const TS = '20990101'; // 固定时间戳 → 备份引用路径可预期

  function makeRepo() {
    const dir = mkdtempTracked(join(tmpdir(), 'dshgp-idnrw-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    // 仓库局部身份：故意用非规范身份，模拟「没配身份的仓库」
    execFileSync('git', ['config', '--local', 'user.name', 'DSH Agent'], { cwd: dir });
    execFileSync('git', ['config', '--local', 'user.email', 'agent@dsh.local'], { cwd: dir });
    return dir;
  }

  /** 造一个提交（committer 用给定身份，author 可另指）。 */
  function commit(dir, msg, { author = null, committer = { name: 'DSH Agent', email: 'agent@dsh.local' } } = {}) {
    const args = ['-c', `user.name=${committer.name}`, '-c', `user.email=${committer.email}`, 'commit', '-q', '--allow-empty', '-m', msg];
    if (author) args.push(`--author=${author.name} <${author.email}>`);
    execFileSync('git', args, { cwd: dir });
  }

  /** 当前 HEAD 的全部身份（去重）。 */
  function identities(dir) {
    return execFileSync('git', ['log', '--format=%ae|%ce'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').sort();
  }

  function repoWrongEmails() {
    return wrongIdentityEmails({ account: { login: 'EIGHTfs' }, extra: ['862434889@qq.com'] });
  }

  test('[git-identity-rewrite] wrongIdentityEmails：含工具身份 + 账号 noreply 变体 + 额外邮箱（小写去重）', () => {
    const list = repoWrongEmails();
    for (const e of ['agent@dsh.local', 'eightfs@local', 'v2-clone@local', '862434889@qq.com',
      'eightfs@users.noreply.github.com']) {
      assert.ok(list.includes(e), `应包含 ${e}`);
    }
    assert.equal(new Set(list).size, list.length, '不得重复');
    assert.ok(list.every((e) => e === e.toLowerCase()), '统一小写比较');
  });

  test('[git-identity-rewrite] parseGithubRepo：ssh / https / api 三种写法都认', () => {
    assert.deepEqual(parseGithubRepo('ssh://git@ssh.github.com:443/EIGHTfs/dsh-git-push.git'), { owner: 'EIGHTfs', repo: 'dsh-git-push' });
    assert.deepEqual(parseGithubRepo('https://github.com/EIGHTfs/dsh-git-push.git'), { owner: 'EIGHTfs', repo: 'dsh-git-push' });
    assert.deepEqual(parseGithubRepo('https://api.github.com/repos/EIGHTfs/spine-multi-viewer'), { owner: 'EIGHTfs', repo: 'spine-multi-viewer' });
    assert.equal(parseGithubRepo('/volume1/local/repo'), null);
    assert.equal(parseGithubRepo(''), null);
  });

  test('[git-identity-rewrite] dryRun：报命中数但不写任何东西', () => {
    const dir = makeRepo();
    try {
      commit(dir, 'c1 agent');
      commit(dir, 'c2 other', { author: OTHER, committer: OTHER });
      commit(dir, 'c3 old noreply', { author: { name: 'EIGHTfs', email: 'EIGHTfs@users.noreply.github.com' } });
      const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      const r = rewriteRepoIdentity(dir, { runGit, canonical: CANON, wrongEmails: repoWrongEmails(), dryRun: true, timestamp: TS });
      assert.equal(r.skipped, undefined);
      assert.equal(r.branches.length, 1);
      assert.equal(r.branches[0].hits, 2, 'c1（committer 命中）+ c3（author 命中）= 2 条');
      assert.equal(r.branches[0].dryRun, true);
      assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(), headBefore, 'dryRun 不得动 HEAD');
      const backup = runGit(['rev-parse', '--verify', `refs/backup/identity-rewrite/${TS}/master`], { cwd: dir });
      assert.equal(backup.ok, false, 'dryRun 不得建备份引用');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[git-identity-rewrite] apply：身份全规范、提交数/树不变、未命中提交的字段与树一模一样', () => {
    const dir = makeRepo();
    try {
      commit(dir, 'c1 agent');
      commit(dir, 'c2 other', { author: OTHER, committer: OTHER });
      commit(dir, 'c3 old noreply', { author: { name: 'EIGHTfs', email: 'EIGHTfs@users.noreply.github.com' } });
      const before = execFileSync('git', ['log', '--format=%H %ae %ce %s'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
      const otherBefore = before.find((l) => l.includes('other@example.com'));

      const r = rewriteRepoIdentity(dir, { runGit, canonical: CANON, wrongEmails: repoWrongEmails(), dryRun: false, timestamp: TS });
      const b = r.branches[0];
      assert.equal(b.hits, 2);
      assert.equal(b.before, b.after, '提交数必须不变');
      assert.equal(b.stillWrong, 0, '不得残留非规范身份');
      assert.equal(b.treeChanged, false, '工作树内容不得变');
      assert.ok(b.backupRef, '必须留下备份引用');
      assert.equal(b.push, undefined, 'push=false 时不做推送动作');

      const after = execFileSync('git', ['log', '--format=%H %ae %ce %s'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
      const otherAfter = after.find((l) => l.includes('other@example.com'));
      // 未命中身份的提交：**字段（作者/committer/标题）与树原样保留**；
      //   sha 会随祖先改写而变化（git 提交对象哈希包含父提交 sha），这是改写语义的必然结果。
      assert.equal(otherAfter.split(' ').slice(1).join(' '), otherBefore.split(' ').slice(1).join(' '),
        '未命中身份的提交字段必须原样保留');
      const otherShaBefore = otherBefore.split(' ')[0];
      const otherShaAfter = otherAfter.split(' ')[0];
      const treeOld = execFileSync('git', ['rev-parse', `${otherShaBefore}^{tree}`], { cwd: dir, encoding: 'utf8' }).trim();
      const treeNew = execFileSync('git', ['rev-parse', `${otherShaAfter}^{tree}`], { cwd: dir, encoding: 'utf8' }).trim();
      assert.equal(treeNew, treeOld, '未命中身份的提交树内容必须一致');
      const ids = identities(dir);
      assert.ok(ids.every((l) => l.includes(CANON.email) || l.includes(OTHER.email)), `身份应只剩规范身份与他人身份：${ids.join(' / ')}`);
      // 备份引用指向改写前 HEAD，可回滚
      const backupHead = execFileSync('git', ['rev-parse', `refs/backup/identity-rewrite/${TS}/master`], { cwd: dir, encoding: 'utf8' }).trim();
      assert.notEqual(backupHead, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(), '备份引用应指向改写前的提交');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[git-identity-rewrite] 已跟踪文件有改动 → 拒绝改写（不碰未保存的工作）', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'a.txt'), 'v1\n');
      execFileSync('git', ['add', 'a.txt'], { cwd: dir });
      commit(dir, 'c1 agent');
      appendFileSync(join(dir, 'a.txt'), 'v2\n'); // 已跟踪文件被改动
      const r = rewriteRepoIdentity(dir, { runGit, canonical: CANON, wrongEmails: repoWrongEmails(), dryRun: false, timestamp: TS });
      assert.equal(r.skipped, true);
      assert.match(r.reason, /已跟踪文件改动/);
      assert.equal(r.branches.length, 0, '跳过时不得做任何分支级动作');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[git-identity-rewrite] 只有未跟踪文件 → 不该被拦（大量未跟踪产物是常态）', () => {
    const dir = makeRepo();
    try {
      commit(dir, 'c1 agent');
      writeFileSync(join(dir, 'untracked.bin'), 'x'); // 未跟踪
      const r = rewriteRepoIdentity(dir, { runGit, canonical: CANON, wrongEmails: repoWrongEmails(), dryRun: true, timestamp: TS });
      assert.equal(r.skipped, undefined, '未跟踪文件不该让改写停摆');
      assert.equal(r.branches[0].hits, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[git-identity-rewrite] identityHits：作者/committer 命中都能识别，且区分命中侧', () => {  const dir = makeRepo();
    try {
      commit(dir, 'c1'); // committer 命中（author 同）
      commit(dir, 'c2', { author: { name: 'X', email: 'x@example.com' } }); // 仅 committer 命中
      const hits = identityHits(dir, { runGit, wrongEmails: repoWrongEmails() });
      assert.equal(hits.length, 2);
      assert.ok(hits.every((h) => h.side === 'both' || h.side === 'committer'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[git-identity-rewrite] legacyIdentityReport / buildLegacyIdentityHint：提交时提醒「以前」的遗留身份', () => {
    const dir = makeRepo();
    try {
      commit(dir, 'c1 agent');
      commit(dir, 'c2 other', { author: OTHER, committer: OTHER });
      const rep = legacyIdentityReport(dir, { runGit, wrongEmails: repoWrongEmails() });
      assert.equal(rep.count, 1, '只统计命中身份的那条');
      assert.deepEqual(rep.emails, ['agent@dsh.local']);

      const hint = buildLegacyIdentityHint(rep, CANON);
      assert.match(hint, /还有 1 条非规范身份提交/);
      assert.ok(hint.includes(CANON.email), '提醒里要写明本次已用规范身份');
      assert.match(hint, /由你决定|dry-run/i, '提醒要说明历史改写由用户决定、可先预演');

      assert.equal(buildLegacyIdentityHint({ count: 0 }, CANON), '', '没有遗留就不要打扰');
      assert.equal(buildLegacyIdentityHint({}, CANON), '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// ── 原 test-git-path-args.mjs ──
{
  /**
   * git 调用参数回归：非 ASCII 路径不被转义 + 权限位变化不产生噪声。
   *
   * 背景（2026-10-22 讨论后落地）：
   *   git 的 `core.quotepath` 默认 true —— 非 ASCII 字节在输出里被包成双引号 +
   *   八进制转义（`"\345\214\277"`），而插件的解析端只解 `\\` 与 `\"`，不认 `\ooo`。
   *   后果不只是「显示乱码」：join(repoPath, rel) 出来的 full 指向一个**不存在的路径**，
   *   文件读不到 ⇒ diff 审计漏审、中文路径下的私密文件 glob 匹配失效（安全漏检）。
   *
   *   同时 `core.filemode` 默认 true —— 权限位变化（CIFS/NFS 跨机同步、挂载差异）
   *   会被 git 算成 modified，审计范围被无关文件污染。
   *
   * 修法：所有 git 调用统一带 lib/core/exec.js 的 GIT_GLOBAL_ARGS
   *   （safe.directory=* + core.filemode=false + core.quotepath=false）。
   *   本文件用真实 git 仓库锁死这两件事，防回归。
   */


  /** 搭一个含中文文件名 + 子目录的 git 仓库，返回 dir。git 不可用时返回 null。 */
  function setupRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'git-path-args-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    // 中文 + 空格 + 三层嵌套：这三类都是 git 默认会加引号转义的情形
    writeFileSync(join(dir, 'src', '配置说明.js'), '// cfg\n');
    writeFileSync(join(dir, 'src', 'my file.js'), '// spaced\n');
    writeFileSync(join(dir, 'src', 'app.js'), '// app\n');
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 't@example.invalid'], { cwd: dir, stdio: 'ignore' });
    } catch {
      rmSync(dir, { recursive: true, force: true });
      return null;
    }
    return dir;
  }

  /** 提交当前全部改动（首次提交仓库用）。 */
  function commitAll(dir, msg = 'init') {
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir, stdio: 'ignore' });
  }

  test('[git-path-args] GIT_GLOBAL_ARGS 含 quotepath=false 与 filemode=false', () => {
    // 这是判据的「真源」：一旦有人从 GIT_GLOBAL_ARGS 里删掉这两项，本测试立刻红
    assert.ok(GIT_GLOBAL_ARGS.includes('core.quotepath=false'), '必须禁用路径转义（中文/空格文件名原样输出）');
    assert.ok(GIT_GLOBAL_ARGS.includes('core.filemode=false'), '必须忽略权限位（防跨机同步刷出一堆 M）');
    assert.ok(GIT_GLOBAL_ARGS.includes('safe.directory=*'), '必须放行 safe.directory（防 dubious ownership）');
  });

  test('[git-path-args] status --porcelain 输出中文路径为原样（非八进制转义）', () => {
    const dir = setupRepo();
    if (!dir) return;
    try {
      commitAll(dir);
      writeFileSync(join(dir, 'src', '配置说明.js'), '// cfg changed\n');
      // 关键：**带前缀**跑 git，模拟插件内部调用的实际参数
      const out = execFileSync('git', [...GIT_GLOBAL_ARGS, '-C', dir, 'status', '--porcelain'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.ok(out.includes('配置说明.js'), `应原样输出中文路径，实际：${JSON.stringify(out)}`);
      assert.ok(!out.includes('\\3'), `不应出现八进制转义（\\ooo），实际：${JSON.stringify(out)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[git-path-args] collectChangedFiles：中文路径可解析出真实存在的 full', () => {
    const dir = setupRepo();
    if (!dir) return;
    try {
      commitAll(dir);
      writeFileSync(join(dir, 'src', '配置说明.js'), '// cfg changed\n');
      const files = collectChangedFiles(dir);
      assert.ok(Array.isArray(files), 'git 仓库应返回数组');
      const hit = files.find((f) => f.rel.endsWith('配置说明.js'));
      assert.ok(hit, `应收集到中文文件，实际：${JSON.stringify(files)}`);
      // 核心断言：rel 是**可读的中文**，且 full 指向真实文件（转义没解时这里必然失败）
      assert.ok(!hit.rel.includes('\\3'), `rel 不应含八进制转义，实际：${hit.rel}`);
      assert.ok(existsSync(hit.full), `full 应指向真实文件：${hit.full}`);
      // 带空格的文件名同样要正确
      writeFileSync(join(dir, 'src', 'my file.js'), '// spaced changed\n');
      const files2 = collectChangedFiles(dir);
      const hit2 = files2.find((f) => f.rel.endsWith('my file.js'));
      assert.ok(hit2, `应收集到带空格的文件，实际：${JSON.stringify(files2)}`);
      assert.ok(existsSync(hit2.full), `full 应指向真实文件：${hit2.full}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('[git-path-args] 权限位变化不算 modified（core.filemode=false 生效）', () => {
    const dir = setupRepo();
    if (!dir) return;
    try {
      commitAll(dir);
      // 只改权限位、不改内容：默认配置下 git 会报 M，filemode=false 时应干净
      chmodSync(join(dir, 'src', 'app.js'), 0o755);
      const out = execFileSync('git', [...GIT_GLOBAL_ARGS, '-C', dir, 'status', '--porcelain'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.equal(out.trim(), '', `仅权限位变化不应产生改动，实际：${JSON.stringify(out)}`);
      const files = collectChangedFiles(dir);
      assert.equal(files.length, 0, `审计范围不应被权限位噪声污染，实际：${JSON.stringify(files)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// ── 原 test-git-rename.mjs ──
{
  /**
   * 远程仓库改名（git_remote_rename）测试。
   *
   * 设计要点：改名不可逆，故 dryRun 默认开，且必须先把「旧名散落在哪」列清楚——
   *   package.json 的 repository/homepage、README 的克隆地址、CI 配置……
   *   改完还要把本地 remote 同步过去，否则就会出现「远端改了、本地还指着旧的」。
   *
   * 本测试只覆盖**不触网**的部分：参数校验、旧名扫描（含 URL 形态分类）、remote 识别；
   *   真正的 PATCH 由 GitHub API 完成，联调靠 dryRun 人工核。
   */


  function withRepo(fn) {
    const root = mkdtempSync(join(tmpdir(), 'dshgp-rename-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
  }

  test('[git-rename] 非法新名 → 直接拒绝（不触网）', async () => {
    for (const bad of ['', 'has space', 'a/b', 'x'.repeat(101), '名字']) {
      const r = await renameRepo({ repoPath: '/tmp', newName: bad });
      assert.equal(r.ok, false, `应拒绝：${bad}`);
      assert.match(r.error, /不合法/);
    }
  });

  test('[git-rename] 新名与当前名相同 → 拒绝', () => withRepo(async (root) => {
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:EIGHTfs/demo.git'], { cwd: root });
    const r = await renameRepo({ repoPath: root, newName: 'demo' });
    assert.equal(r.ok, false);
    assert.match(r.error, /相同/);
  }));

  test('[git-rename] 缺 repo → 报错', async () => {
    const r = await renameRepo({ repoPath: '', newName: 'ok-name' });
    assert.equal(r.ok, false);
    assert.match(r.error, /repo 必填/);
  });

  test('[git-rename] scanOldName：能扫到名字与 URL 两种形态，且 URL 优先展示', () => withRepo((root) => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'demo',
      repository: { url: 'git+https://github.com/EIGHTfs/demo.git' },
    }, null, 2));
    writeFileSync(join(root, 'README.md'), '# demo\n\n克隆：git clone https://github.com/EIGHTfs/demo.git\n');
    execFileSync('git', ['add', '.'], { cwd: root });
    const r = scanOldName(root, 'demo');
    assert.equal(r.scanned, true);
    assert.ok(r.total >= 3, `至少要扫到 3 处，实际 ${r.total}`);
    assert.ok(r.urlLike >= 2, `URL 形态至少 2 处，实际 ${r.urlLike}`);
    assert.equal(r.samples[0].kind, 'url', 'URL 形态必须排在样例最前面（改名后必须改的就是它们）');
    assert.ok(Object.keys(r.byFile).includes('package.json'));
  }));

  test('[git-rename] remotesPointingTo：只列出指向该仓库的 remote，带 URL', () => withRepo((root) => {
    execFileSync('git', ['remote', 'add', 'origin', 'ssh://git@ssh.github.com:443/EIGHTfs/demo.git'], { cwd: root });
    execFileSync('git', ['remote', 'add', 'github-ssh', 'ssh://git@ssh.github.com:443/EIGHTfs/demo.git'], { cwd: root });
    execFileSync('git', ['remote', 'add', 'other', 'git@github.com:EIGHTfs/unrelated.git'], { cwd: root });
    const list = remotesPointingTo(root, 'EIGHTfs', 'demo');
    assert.deepEqual(list.map((r) => r.name).sort(), ['github-ssh', 'origin']);
    assert.ok(list.every((r) => r.url.includes('/demo')));
  }));

  test('[git-rename] remotesPointingTo：没有匹配时返回空（不误报）', () => withRepo((root) => {
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:someone/other.git'], { cwd: root });
    assert.deepEqual(remotesPointingTo(root, 'EIGHTfs', 'demo'), []);
  }));
}

// ── 原 test-git-stream.mjs ──
{
  /**
   * 流式 git 执行（runGitStream）与 fetch 停摆判据的回归测试。
   *
   * 背景：runGit 是 execFileSync + 死超时（默认 120s），大仓库 `git fetch` 要跑十几分钟
   *   但一直在正常下载，固定超时必然半途而废（实测 6.9GB / 7374 文件的仓库报 ETIMEDOUT）。
   *   runGitStream 改成「只判有没有进展」：只要有输出就把看门狗往后推，
   *   连续 stallLimit 完全无输出才结束进程；已下载对象留在 .git 里，重试即续传。
   *
   * 本文件锁四件事：
   *   ① 正常命令：ok + stdout + ms，且 stalled=false；
   *   ② 真失败（git 自己报错）：ok=false 且 **stalled=false** —— 不能把仓库/网络错误说成停摆；
   *   ③ 进度回调抛错不能影响执行（回调来自调用方，抛错会变成 data 事件的未捕获异常，
   *      常驻宿主进程会被一个进度回调带走）；
   *   ④ 消费方文案分流：stalled ⇒ 「停摆/可重试续传」，否则 ⇒ 「失败」。
   */


  test('[git-stream] runGitStream：正常命令 → ok，stalled=false，带耗时与 stdout', async () => {
    const r = await runGitStream(['--version']);
    assert.equal(r.ok, true, `git --version 应成功：${r.stderr}`);
    assert.equal(r.stalled, false);
    assert.match(r.stdout, /git version/i);
    assert.ok(r.ms >= 0, 'ms 应为非负数');
  });

  test('[git-stream] runGitStream：git 自身报错 → ok=false 且 stalled=false（不能误报成停摆）', async () => {
    const r = await runGitStream(['rev-parse', '--verify', 'definitely-not-a-ref-xyz']);
    assert.equal(r.ok, false);
    assert.equal(r.stalled, false, '这是 git 报错，不是停摆');
    assert.ok(r.stderr.length > 0, '失败时必须带回 stderr 供排错');
  });

  test('[git-stream] runGitStream：进度回调抛错不影响执行（不得把宿主进程带走）', async () => {
    const r = await runGitStream(['--version'], {
      onProgress: () => { throw new Error('回调故意抛错'); },
    });
    assert.equal(r.ok, true, '回调异常必须被吞掉，命令本身照常成功');
    assert.match(r.stdout, /git version/i);
  });

  test('[git-stream] runGitStream：进度回调按行收到 stderr 输出', async () => {
    const lines = [];
    // 让 git 往 stderr 写内容：--version 走 stdout，故用一条会告警的命令
    const r = await runGitStream(['rev-parse', '--verify', 'no-such-ref'], {
      onProgress: (l) => lines.push(l),
    });
    assert.equal(r.ok, false);
    assert.ok(lines.length > 0, '失败信息应以进度行形式回调，便于上层实时展示');
  });

  test('[git-stream] runGitStream：stallLimit 环境变量可放宽阈值（不影响正常命令）', async () => {
    process.env.DSH_GIT_FETCH_STALL_MS = '1000';
    try {
      const r = await runGitStream(['--version']);
      assert.equal(r.ok, true, '阈值只影响停摆判定，不应影响正常执行');
    } finally { delete process.env.DSH_GIT_FETCH_STALL_MS; }
  });

  /** 在临时目录跑 cloneWithGitFetch，deps 全注入（不碰网络、不依赖真实 git 权限）。 */
  async function runFetchCase(streamResult) {
    const dir = mkdtempSync(join(tmpdir(), 'gitstream-'));
    try {
      return await cloneWithGitFetch({
        owner: 'octocat', repo: 'Hello-World', branch: 'main', repoPath: dir,
        depth: 1,
        deps: {
          visibility: 'public',          // 跳过网络可见性探测
          chmodOk: false,                // 强制走手工 .git 降级，避开 CIFS/chmod 差异
          sshKeyPath: '',
          runGit: () => ({ ok: true, stdout: 'deadbeef', stderr: '' }),
          runGitStream: async () => streamResult,
        },
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  test('[git-stream] cloneWithGitFetch：fetch 停摆 → 文案说明可重试续传，且 steps 标记 stalled', async () => {
    const r = await runFetchCase({ ok: false, stalled: true, stderr: '连续 300s 无任何进展', ms: 300100 });
    assert.equal(r.ok, false);
    assert.match(r.error, /停摆/, `应为停摆文案，实际：${r.error}`);
    assert.match(r.error, /续传/, '必须告诉调用方可重试续传（已下载部分不丢）');
    const step = r.steps.find((s) => s.stalled === true);
    assert.ok(step, 'steps 里该记录 stalled=true，便于事后判定是停摆而非仓库错误');
    assert.equal(step.ms, 300100, 'steps 应记录耗时');
  });

  test('[git-stream] cloneWithGitFetch：停摆但上游 stderr 为空 → 消费方仍给出续传提示', async () => {
    // 上游换了实现/文案时，这条保证「已下载部分不丢」不会从提示里消失
    const r = await runFetchCase({ ok: false, stalled: true, stderr: '', ms: 300000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /停摆/);
    assert.match(r.error, /续传/, 'stderr 为空时也必须带续传提示');
  });

  test('[git-stream] cloneWithGitFetch：fetch 真失败 → 仍走「失败」文案（不能混成停摆）', async () => {
    const r = await runFetchCase({ ok: false, stalled: false, stderr: 'Could not resolve host', ms: 1200 });
    assert.equal(r.ok, false);
    assert.match(r.error, /git fetch 失败/);
    assert.doesNotMatch(r.error, /停摆/, '真网络/仓库错误不能报成停摆');
  });

  test('[git-stream] cloneWithGitFetch：fetch 成功 → 不新增失败分支，steps 记录 lastProgress', async () => {
    const r = await runFetchCase({ ok: true, stdout: '', stderr: '', stalled: false, ms: 8000 });
    // 成功时后续要读 rev-parse 的 sha（runGit mock 给 deadbeef），应拿到 headSha
    assert.equal(r.ok, true, `fetch 成功后应继续建分支，实际错误：${r.error}`);
    assert.equal(r.headSha, 'deadbeef');
    const step = r.steps.find((s) => String(s.cmd || '').includes('fetch'));
    assert.ok(step && step.ok, 'steps 应记录 fetch 成功');
  });
}
