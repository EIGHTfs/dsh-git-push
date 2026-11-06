/**
 * CIFS/SMB 挂载上的本地仓库初始化与 origin 设置（2026-11-02）。
 *
 * 背景：smb2 挂载上 `git init` 会在写 `.git/config` 时 `chmod config.lock` 失败而**半途退出**，
 *   留下没有 HEAD/objects 的残缺 `.git`。老实现只判 `existsSync('.git')` 就去 `git remote add`，
 *   于是 `remote add` 报「not a git repository」，而函数仍返回成功 —— 用户看到「建仓成功」但本地不可用。
 *
 * 现在统一走 `ensureUsableLocalRepo`（复用 clone 已在用的 CIFS 安全 init）：
 *   已可用 → keep；残缺 → repair；没有 → create；并如实回报 origin 结果。
 * 本测试用**仓库内的临时目录**（本机即 CIFS 挂载），因此跑的就是真实挂载条件。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureUsableLocalRepo, isUsableRepo, registerTrustedRepo, unregisterTrustedRepo } from '../lib/git/init-compat.js';
import { prepareLocalRepoForRemote } from '../lib/git/remote.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
// 临时目录放在**仓库的父目录**（工作区根，同样是 CIFS 挂载）：放仓库内会被 git 向上当成父仓库的一部分
const WORKSPACE_ROOT = join(REPO_ROOT, '..');

/**
 * 在仓库的父目录（真实 CIFS 挂载）建临时目录跑用例，收尾**两件事都必须做**：
 *   ① 注销 global safe.directory 里该目录那一条 —— ensureUsableLocalRepo 为让「外部裸 git
 *      可用」会登记它（CIFS forceuid 卷的必需动作）；只删目录不注销就会在**用户真实 gitconfig**
 *      里堆死条目（实测踩过：跑一轮 5 条）。测试不许污染真实配置。
 *   ② 删临时目录。
 * 顺序：先注销再删（注销需要目录还在才能算出同一绝对路径）。
 */
function withDir(fn) {
  const dir = mkdtempSync(join(WORKSPACE_ROOT, '.tmp-cifs-init-'));
  try { return fn(dir); } finally {
    try { unregisterTrustedRepo(dir); } catch { /* 尽力清理，失败不掩盖用例结果 */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 读 global safe.directory 列表。
 * ⚠️ `git config --global --get-all <key>` 在**键不存在**时退出码为 1，execFileSync 会直接抛错 ——
 *   CI 是全新 HOME（没有该键），本地开发机往往早有该键，于是同一断言在 CI 炸、本地过。
 *   这正是本测试在 CI 上失败（run 237）的原因：测试隐含依赖「本机已经配过 safe.directory」。
 *   统一用本函数读，无键即空列表。
 */
const readGlobalSafeDirs = () => {
  try {
    return execFileSync('git', ['config', '--global', '--get-all', 'safe.directory'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((x) => x.trim()).filter(Boolean);
  } catch { return []; }
};

const gitOk = (dir, args) => {
  try { execFileSync('git', args, { cwd: dir, stdio: 'ignore' }); return true; } catch { return false; }
};

test('全新目录：ensureUsableLocalRepo 建出可用仓库', () => withDir((dir) => {
  writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
  const r = ensureUsableLocalRepo(dir, { branch: 'main', remoteUrl: 'https://github.com/x/y.git' });
  assert.equal(r.ok, true, `初始化失败：${r.stderr || ''}`);
  assert.equal(r.action, 'create');
  assert.equal(isUsableRepo(dir), true, 'git 必须能识别这个仓库');
  assert.equal(gitOk(dir, ['status', '--short']), true, '工作区可用');
  // 注意：**不要**在这里断言 origin —— 只有降级路径（手写 .git）才会顺带把 remote 写进 config；
  //   正常文件系统上 `git init` 可用，remote 由 `prepareLocalRepoForRemote` 随后补 add。
  //   早期版本在这里断言了 origin，于是本地 CIFS 通过、GitHub runner（ext4）失败。
  assert.equal(r.action, 'create');
}));

test('残缺 .git（CIFS 上 git init 半途而废的形态）：应被修复', () => withDir((dir) => {
  // 复刻真实残缺形态：有 .git 与 config，但没有 HEAD/objects
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  assert.equal(isUsableRepo(dir), false, '残缺 .git 不应被当成可用仓库');
  const r = ensureUsableLocalRepo(dir, { branch: 'main' });
  assert.equal(r.ok, true, `修复失败：${r.stderr || ''}`);
  assert.equal(r.action, 'repair');
  assert.equal(isUsableRepo(dir), true);
  assert.ok(existsSync(join(dir, '.git', 'HEAD')), '应补上 HEAD');
}));

test('已可用的仓库：再次调用保持不动（keep）', () => withDir((dir) => {
  ensureUsableLocalRepo(dir, { branch: 'main' });
  const again = ensureUsableLocalRepo(dir, { branch: 'main' });
  assert.equal(again.ok, true);
  assert.equal(again.action, 'keep');
}));

test('prepareLocalRepoForRemote：建仓后本地可用且 origin 指向该仓库', () => withDir((dir) => {
  const r = prepareLocalRepoForRemote(dir, 'EIGHTfs', 'demo-proj');
  assert.equal(r.ok, true, `准备失败：${r.error || ''}`);
  assert.equal(r.url, 'https://github.com/EIGHTfs/demo-proj');
  assert.equal(isUsableRepo(dir), true);
  const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.equal(origin, 'https://github.com/EIGHTfs/demo-proj');
}));

test('CIFS 上「本地提交」可行（首推的前提）', () => withDir((dir) => {
  writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
  ensureUsableLocalRepo(dir, { branch: 'main' });
  assert.equal(gitOk(dir, ['add', '-A']), true, 'git add 应可写 index');
  const committed = gitOk(dir, ['-c', 'user.name=t', '-c', 'user.email=t@e.f', 'commit', '-m', 'init']);
  assert.equal(committed, true, '本地提交应成功（否则首推无从下手）');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  assert.match(head, /^[0-9a-f]{40}$/);
}));

// ─────────── CIFS 所有权登记（对外可用）专项 ───────────
//   背景实测（git 2.55，本机 CIFS forceuid 卷）：目录属主被映射成挂载用户（杜渊/1026），
//   进程 uid 是套件用户 → 裸 git 对任何命令报 dubious ownership；插件内部带 -c 参数感觉不到，
//   交出去的仓库却对用户不可用。仓库级 [safe] directory **不生效**（所有权检查先于读仓库 config），
//   只有 global/命令行级有效。因此建仓后必须登记 global，且要能注销以免残留。
test('登记后外部裸 git 可用；注销后恢复；重复登记幂等', () => withDir((dir) => {
  writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
  // 先真建一个仓库（走被测链路：ensureUsableLocalRepo 内部会登记 global）——
  //   否则裸 git 失败原因是「not a git repository」而非 ownership，断言会测错东西（上一版栽在这）。
  const made = ensureUsableLocalRepo(dir, { branch: 'main' });
  assert.equal(made.ok, true, `建仓失败：${made.stderr || ''}`);
  const bare = (args) => { try { execFileSync('git', args, { cwd: dir, stdio: 'pipe' }); return true; } catch { return false; } };
  // CIFS 卷上裸 git 现在应可用：global 已登记（或本机同 uid 本就可信）。
  //   这是「对外可用」的正向性质，跨平台都成立，故硬断言。
  assert.equal(bare(['status', '--short']), true, '建仓走被测链路后，裸 git 必须能识别工作区');

  // 幂等：同一路径不得堆第二条
  const r2 = registerTrustedRepo(dir);
  assert.equal(r2.registered, false, '重复登记不得再加一条');
  // 原因文案必须按**环境分支**判，不能写死一种（CI 是本地盘、属主与进程同 uid ⇒ 走「一致」分支；
  //   本地 CIFS 卷属主是挂载用户 ⇒ 走「已登记」分支。写死任一分支都会在另一种环境里假红——
  //   2026-11-06 CI 实测因此变红：run 57~61 全失败，而本地一直绿）。
  assert.match(String(r2.skipped || ''), /已登记|一致/,
    '两种环境都应给出明确跳过原因（同 uid ⇒「一致」；已登记过 ⇒「已登记」）');

  const listRaw = readGlobalSafeDirs();
  const hits = listRaw.filter((x) => x === dir || x === resolve(dir));
  assert.ok(hits.length <= 1, `该路径在 global 里最多一条，实得 ${hits.length}`);

  // 注销：登记与注销必须成对，否则死条目留在用户真实 gitconfig 里
  const u = unregisterTrustedRepo(dir);
  assert.equal(u.removed, true, '注销应报告成功');
  const after = readGlobalSafeDirs().filter((x) => x === dir || x === resolve(dir));
  assert.equal(after.length, 0, `注销后不应残留该路径，实得 ${JSON.stringify(after)}`);
}));

test('同 uid 目录不登记（不污染用户配置）', () => {
  // 本地盘（/tmp 所在卷）属主与进程一致 → 不该往 global 里加东西
  const local = mkdtempSync(join('/tmp', 'dshgp-own-local-'));
  try {
    mkdirSync(join(local, '.git'), { recursive: true });
    const r = registerTrustedRepo(local);
    assert.equal(r.registered, false, '属主一致时不得登记');
    assert.match(String(r.skipped || ''), /一致|无 uid/, '应给出跳过原因');
  } finally { rmSync(local, { recursive: true, force: true }); }
});
