/**
 * git 仓库初始化兼容层（CIFS/SMB 等不支持 chmod 的文件系统）。
 *
 * 为什么需要（实测根因，2026-10-28）：
 *   `git init` 末尾要把探测到的 `core.filemode` **写入** `.git/config`。写 config 走的是
 *   `config.lock` → chmod(继承原权限) → rename，而 CIFS 挂载带 `nounix` 时 chmod 一律
 *   `EPERM`，于是 git 直接 fatal：
 *     `error: chmod on .../.git/config.lock failed: Operation not permitted`
 *     `fatal: could not set 'core.filemode' to 'false'`
 *   结果是在目标目录留下一个**未初始化的空 .git**，后续 add/commit 还会向上命中父仓库
 *   （把父仓库整棵树写进错误的历史，历史事故）。
 *   同样的 chmod 也会让 `git config core.fileMode false` 失效——所以「先 git init 再关
 *   filemode」这条自救路线在 CIFS 上根本不成立。
 *
 * 实测结论（这三条是设计依据，改动前请重跑确认）：
 *   ① `git init` / `git config` 写 config → 必然失败（chmod）；
 *   ② **手工搭最小 .git 结构**后，`git add -A` / `git commit` / `git log` / `git reset`
 *      全部正常——index.lock 与 refs 的写入不受影响，只有 config 的 chmod 是死穴；
 *   ③ `core.filemode = false` 写进 config 后，`git status` 才不再把所有文件报成 M
 *      （CIFS 上文件 mode 恒为 777，与 index 里记录的 100644 不符）。
 *
 * 因此降级路径 = 手写 `.git/{HEAD,config}` + 空 `objects/refs/info` 目录，绕开 git 的
 *   config 写入流程；config 里预先写死 `filemode = false`。
 */
import { existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from './exec.js';

/**
 * 探测目录所在文件系统是否支持 chmod。
 *
 * 判据就是真去 chmod 一个临时文件——比看 mount 类型可靠（同类挂载的选项可能不同，
 *   而且同一台机器上 NFS/CIFS/本地盘混合）。用完即删，不留残余。
 * @param {string} dir 目标目录（不存在会先创建——clone 的目标目录本来就是新建的）
 * @returns {boolean} true = 支持 chmod（可走标准 git init）
 */
export function fsSupportsChmod(dir) {
  const probe = join(dir, `.dshgp-chmod-probe-${process.pid}-${Date.now()}`);
  try {
    // 先确保目录存在：目标目录可能还没建，此时 writeFile 会 ENOENT，
    //   若把 ENOENT 误判成「不支持 chmod」就会让所有全新目标目录都走降级分支（实测踩过）
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, '');
    chmodSync(probe, 0o600);
    return true;
  } catch {
    return false;
  } finally {
    try { rmSync(probe, { force: true }); } catch { /* 探测文件残留无所谓 */ }
  }
}

/**
 * 手工搭最小可用的 .git 结构（不经 git init）。
 *
 * 只写 git 真正必需的四样：HEAD（指分支）、config（含 filemode=false）、
 *   objects/（对象库）、refs/heads（提交后放分支引用）；info/ 是配套惯例目录。
 * 不写 index —— 交给首次 `git add` 自动生成（实测可行）。
 * @param {string} dir 仓库工作树目录
 * @param {{branch?: string, remoteName?: string, remoteUrl?: string}} [opts]
 *   branch 为目标分支名（HEAD 指向它）；给了 remoteUrl 就把 remote 段一并写进 config
 *   —— 因为 `git remote add` 同样是写 config，在 CIFS 上一样会 chmod 失败
 */
export function writeMinimalGitDir(dir, { branch = 'master', remoteName = 'origin', remoteUrl = '' } = {}) {
  const g = join(dir, '.git');
  for (const d of ['objects', 'refs/heads', 'refs/tags', 'info']) {
    mkdirSync(join(g, d), { recursive: true });
  }
  // HEAD 指向分支名而不是具体 sha：首次 commit 后 git 会把 refs/heads/<branch> 建好
  writeFileSync(join(g, 'HEAD'), `ref: refs/heads/${branch}\n`);
  // filemode=false 是关键项：不加则 CIFS 上所有文件因 777 vs 100644 恒被报为已修改
  const lines = [
    '[core]',
    '\trepositoryformatversion = 0',
    '\tfilemode = false',
    '\tbare = false',
    '\tlogallrefupdates = true',
  ];
  if (remoteUrl) {
    lines.push(`[remote "${remoteName}"]`, `\turl = ${remoteUrl}`, `\tfetch = +refs/heads/*:refs/remotes/${remoteName}/*`);
  }
  writeFileSync(join(g, 'config'), lines.join('\n') + '\n');
}

/**
 * 初始化 git 仓库（自动适配不支持 chmod 的文件系统）。
 *
 * 能 chmod → 走标准 `git init -q`（行为与之前完全一致）；
 * 不能 chmod → 手写最小 .git 结构，等价于「已 init 完成」的仓库。
 * @param {string} dir 目标目录（必须已存在）
 * @param {{branch?: string, remoteUrl?: string, chmodOk?: boolean, gitInit?: (args: string[], opts: object) => object}} [opts]
 *   branch: 目标分支（降级路径写进 HEAD）；remoteUrl: 降级路径一并写进 config 的 remote 段；
 *   chmodOk: 强制指定 chmod 能力（测试用，省略则真去探测目标卷）；
 *   gitInit: 可注入的 git 执行器（测试用，缺省走 runGit）
 * @returns {{ok: boolean, via: 'git-init'|'manual', filemode: boolean, stderr?: string}}
 */
export function initRepoCompat(dir, { branch = 'master', remoteUrl = '', chmodOk, gitInit } = {}) {
  const exec = typeof gitInit === 'function' ? gitInit : (args, opts) => runGit(args, opts);
  const canChmod = typeof chmodOk === 'boolean' ? chmodOk : fsSupportsChmod(dir);
  if (canChmod) {
    const r = exec(['init', '-q'], { cwd: dir });
    return { ok: !!r?.ok, via: 'git-init', filemode: true, stderr: r?.stderr };
  }
  try {
    writeMinimalGitDir(dir, { branch, remoteUrl });
    // 自检：结构搭好后 git 必须能识别出工作树，否则等于静默失败（历史事故的形态）
    const rc = exec(['rev-parse', '--git-dir'], { cwd: dir });
    if (!rc?.ok) return { ok: false, via: 'manual', filemode: false, stderr: rc?.stderr || '自检失败：git 未识别出新仓库' };
    return { ok: true, via: 'manual', filemode: false };
  } catch (e) {
    return { ok: false, via: 'manual', filemode: false, stderr: String((e && e.message) || e) };
  }
}

/** .git 目录是否已存在（续跑判断：已 init 过就不再重复写）。 */
export function hasGitDir(dir) {
  return existsSync(join(dir, '.git'));
}
