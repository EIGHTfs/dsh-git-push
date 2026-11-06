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
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { statSync } from 'node:fs';
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
  // 注意：**不要**在这里写仓库级 [safe] directory —— 实测（git 2.55）所有权检查发生在
  //   读取该仓库 config **之前**，被检查的目录无法自证可信，写了也不生效。
  //   对外可用由 registerTrustedRepo() 走 global 配置解决，见该函数说明。
  writeFileSync(join(g, 'config'), lines.join('\n') + '\n');
}

/**
 * 把仓库登记进**用户 global** 的 safe.directory，使这个目录对裸 git（用户/外部工具/CI）也可用。
 *
 * 为什么必须走 global 而不是仓库 config（三条实测事实，git 2.55.0）：
 *   ① 仓库级 `[safe] directory` **不生效**——所有权检查发生在读取该仓库 config 之前，
 *      被检查目录无法自证可信（实测：仓库 config 含该段，裸 git status 仍 fatal）。
 *   ② `-c safe.directory=<绝对路径>` 生效；global 写同一条同样生效（实测通过）。
 *   ③ 需要它的场景真实存在：CIFS/SMB 挂载带 forceuid 时目录属主被映射成挂载用户
 *      （本机 `杜渊`(1026)）而进程 uid 是套件用户（284371），于是 git 对**任何**命令报
 *      `detected dubious ownership`。插件内部走 runGit（GIT_GLOBAL_ARGS 已带 safe.directory=*）
 *      感觉不到，但建完仓交出去，用户一敲 git 就挂 ——「建仓成功、仓库不可用」是历史事故同型。
 *
 * 只登记**这一个具体路径**（不是 `*`）：范围最小，不改用户对所有仓库的信任策略。
 * 幂等：已在列表里就不重复追加。同 uid 的本地盘不需要登记，跳过以免污染用户配置。
 * @param {string} dir 仓库目录（会归一成绝对路径）
 * @param {(args: string[], opts: object) => {ok:boolean, stdout?:string, stderr?:string}} [exec] 注入点（测试用）
 * @returns {{registered: boolean, needed: boolean, skipped?: string, stderr?: string}}
 */
export function registerTrustedRepo(dir, exec) {
  const run = typeof exec === 'function' ? exec : (args, opts) => runGit(args, opts);
  // 无 getuid 的平台（Windows）git 不做所有权检查，直接跳过
  if (typeof process.getuid !== 'function') {
    return { registered: false, needed: false, skipped: '该平台无 uid 概念，git 不做所有权检查' };
  }
  const abs = resolve(String(dir || ''));
  if (!abs) return { registered: false, needed: false, skipped: '空路径' };
  let ownerUid = null;
  try { ownerUid = statSync(abs).uid; } catch { /* 拿不到属主时保守当作需要登记 */ }
  if (ownerUid !== null && ownerUid === process.getuid()) {
    return { registered: false, needed: false, skipped: '属主与当前进程一致，git 不会判 dubious' };
  }
  // safe.directory 是可重复键：读现有列表判幂等，避免每次建仓堆一条
  const cur = run(['config', '--global', '--get-all', 'safe.directory'], {});
  const list = String(cur && cur.stdout || '').split('\n').map((x) => x.trim()).filter(Boolean);
  if (list.includes(abs)) return { registered: false, needed: true, skipped: '已登记' };
  const r = run(['config', '--global', '--add', 'safe.directory', abs], {});
  return r && r.ok
    ? { registered: true, needed: true }
    : { registered: false, needed: true, stderr: (r && r.stderr) || '写 global safe.directory 失败' };
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

/**
 * 撤销 registerTrustedRepo 的登记（删除 global 里**该具体路径**那一条，不动其它条目）。
 *
 * 为什么成对提供：registerTrustedRepo 写的是用户 global 配置，仓库被删/迁移后条目会变死路径。
 *   不自动清理别人的条目（用户可能有意保留暂时未挂载的路径），只把「谁登记谁注销」的能力交出去——
 *   测试用它做到零污染（不留死条目在真实配置里），运维也可用它收拾残留。
 * @param {string} dir 之前登记过的目录
 * @returns {{removed: boolean, stderr?: string}}
 */
export function unregisterTrustedRepo(dir, exec) {
  const run = typeof exec === 'function' ? exec : (args, opts) => runGit(args, opts);
  const abs = resolve(String(dir || ''));
  if (!abs) return { removed: false, stderr: '空路径' };
  // git config --unset-all 的 value 参数按**正则**匹配：路径里的 . \ 等须转义，否则会过宽命中他项
  const pattern = abs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const r = run(['config', '--global', '--unset-all', 'safe.directory', pattern], {});
  // 键不存在/无匹配时 git 返回非 0：语义上是「本来就没登记」，视为成功
  if (!r?.ok && !/invalid section|key does not match|no section/i.test(String(r?.stderr || ''))) {
    const cur = run(['config', '--global', '--get-all', 'safe.directory'], {});
    if (String(cur?.stdout || '').split('\n').map((x) => x.trim()).includes(abs)) {
      return { removed: false, stderr: r?.stderr || '注销失败' };
    }
  }
  return { removed: true };
}

/**
 * 现有 .git 是否**真的可用**（不是"目录存在"就算）。
 *
 * 为什么必须实测：CIFS/SMB 上 `git init` 会在写 config 时 chmod 失败而**半途退出**——
 *   留下 `.git/{config,description,hooks,info}` 却**没有 HEAD/objects/refs**。
 *   此时 `existsSync('.git')` 为真，但 `git remote add` 直接报「not a git repository」。
 *   历史实现正是拿 existsSync 当判据，于是「建仓成功、origin 没设上」还报成功。
 */
export function isUsableRepo(dir) {
  const r = runGit(['rev-parse', '--git-dir'], { cwd: dir });
  if (!r || !r.ok) return false;
  // 必须确认「这个目录本身」就是仓库根：git 会向上层目录找仓库，
  //   若目标目录位于某个父仓库内部（如插件里的临时目录），
  //   `rev-parse --git-dir` 同样成功 —— 会把它误判成"已有仓库"从而跳过初始化（实测踩过）。
  const top = runGit(['rev-parse', '--show-toplevel'], { cwd: dir });
  if (!top || !top.ok) return false;
  const real = (p) => { try { return realpathSync.native(p); } catch { return p; } };
  return real(String(top.stdout || '').trim() || dir) === real(dir);
}

/**
 * 确保目录里有一个**可用**的本地 git 仓库（CIFS 安全）。
 *
 * 三种情形：
 *   · 已可用 → action:'keep'（不动它，避免覆盖用户既有配置）
 *   · 有残缺 .git（半途而废）→ action:'repair'（走 initRepoCompat 补全/重写）
 *   · 没有 .git → action:'create'
 *
 * @param {string} dir 工作树目录
 * @param {{branch?:string, remoteUrl?:string, remoteName?:string, chmodOk?:boolean,
 *          gitInit?:Function}} [opts]
 *   remoteUrl 给出时，降级路径会把 remote 段一并写进 config —— 因为 `git remote add`
 *   同样是写 config，在 CIFS 上一样会 chmod 失败（实测）。
 * @returns {{ok:boolean, action:'keep'|'repair'|'create'|'failed', via:string, filemode:?boolean, stderr?:string}}
 */
export function ensureUsableLocalRepo(dir, { branch = 'master', remoteUrl = '', remoteName = 'origin', chmodOk, gitInit } = {}) {
  const exec = typeof gitInit === 'function' ? gitInit : (args, opts) => runGit(args, opts);
  if (isUsableRepo(dir)) {
    // keep：不动用户既有仓库结构，但「对外可用」该登记还得登记——
    //   历史建仓与标准 git init 都没写过 global safe.directory，CIFS 卷上外部 git 一直不可用。
    const trusted = registerTrustedRepo(dir, exec);
    return { ok: true, action: 'keep', via: 'existing', filemode: null, trusted };
  }
  const hadPartial = hasGitDir(dir);
  const r = initRepoCompat(dir, { branch, remoteUrl, remoteName, chmodOk, gitInit: exec });
  if (!r.ok) return { ok: false, action: 'failed', via: r.via, filemode: r.filemode, stderr: r.stderr };
  // 两条 init 路径（标准 git init / 手写降级）都不保证外部裸 git 可用：
  //   CIFS forceuid 卷上属主 uid 与进程 uid 不一致，需登记 global safe.directory 才交得出可用仓库。
  const trusted = registerTrustedRepo(dir, exec);
  return { ok: true, action: hadPartial ? 'repair' : 'create', via: r.via, filemode: r.filemode, trusted };
}

/** .git 目录是否已存在（续跑判断：已 init 过就不再重复写）。 */
export function hasGitDir(dir) {
  return existsSync(join(dir, '.git'));
}
