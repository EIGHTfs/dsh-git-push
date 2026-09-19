/**
 * Git 执行层 · 克隆
 *
 * 职责：经 GitHub Git Data API 克隆（不依赖本地 git 凭据，SSH 不可用时的通道）。
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, cpSync, writeFileSync, unlinkSync } from 'node:fs';
import { supportsMetadata } from '../fsx.js';
import { dirname, join, resolve } from 'node:path';
import { GH_API, githubFetch, parseGithubOwnerRepo } from './api.js';
import { resolveToken } from './credentials.js';
// 下载细节（并发 / .part 续传 / 体积守卫 / 进度）全部封装在此，本文件只负责编排
import { downloadBlobs, partitionBySize, DEFAULT_MAX_FILE_MB, DEFAULT_CONCURRENCY, removeDirForce, PARTS_DIR } from './clone-download.js';
import { cloneAbortSignal, cloneLog } from './clone-jobs.js';
import { runGit } from './exec.js';

/* ───────────────────────── clone / 建仓 / 可见性 ───────────────────────── */

/**
 * 进行中标记文件名（写在 clone 目标目录根部）。
 *
 * 作用：clone 是「先建目录 → 逐个 blob 下载 → git init」的多步过程，中途超时/中断
 *   会留下半成品目录。下次重试时，仅凭「目录非空」无法区分「上次失败的残留」与
 *   「用户自己的项目目录」——前者应自动清理重来，后者绝不能删。
 *   标记文件即这一判据：存在标记 + 无有效提交（.git 无 HEAD）→ 判定为残留。
 *
 * 放在目录内（而非同级旁路）是刻意的：目录被用户整体拷走后标记随之带走，
 *   不会出现「标记在、目录不在」的悬挂状态。
 */
const CLONE_MARKER = '.dsh-git-push-cloning';

/**
 * 判定目录是否为「上次 clone 失败留下的半成品」。
 *
 * 判据（两者同时满足才算残留，保守优先，宁可让用户手动处理也不误删）：
 *   1. 有本次 clone 写入的进行中标记文件；
 *   2. 没有有效提交——`git rev-parse HEAD` 失败，说明 git init/add/commit 未走完。
 * 若已完成提交（clone 实际成功，只是调用方没拿到返回），即使标记残留也不当残留处理，
 *   避免把一份完整克隆当垃圾删掉。
 * @param {string} dir 目标目录
 * @returns {boolean} 是否可按残留清理
 */
export function isPartialCloneDir(dir) {
  try {
    if (!existsSync(join(dir, CLONE_MARKER))) return false;
    // 有有效提交 → 是完整仓库，不是残留
    const rc = runGit(['rev-parse', '--verify', 'HEAD'], { cwd: dir });
    return !rc.ok;
  } catch { return false; }
}

/**
 * 目标目录是否落在「既有 git 工作树」内部。
 *
 * 为什么必须拦：克隆末尾要 `git init` + `git add -A` + `git commit` 建初始提交。
 *   若目标目录位于某个既有仓库的工作树内（哪怕目标目录本身还不存在），
 *   `git init` 在 CIFS 上会因 chmod 失败而**静默留下未初始化的目录**，
 *   随后的 `git add/commit` 便会向上命中父仓库的 .git —— 把父仓库的
 *   全部内容作为一次提交写进父仓库历史（实测发生过，已重置）。
 *   故此处显式拒绝，而不是依赖 git init 是否成功。
 *
 * 判定用 `git rev-parse --show-toplevel`：在任意子目录（含尚不存在的路径）
 *   执行时，只要父链上有 .git 就会返回该仓库根。
 * @param {string} dir 待创建的目标目录（可以尚不存在）
 * @returns {string} 命中的既有仓库根；无则返回空串
 */
export function enclosingGitRoot(dir) {
  const target = resolve(dir);
  // 目标目录自身已是独立仓库（有自己的 .git）→ 交给「非空目录拒绝覆盖」处理，
  //   不属于「落在父仓库内」。注意必须在 resolve 后比较**目标自身**，
  //   而不是上溯后的祖先目录（早期实现把祖先误当目标，导致防护被自身短路）。
  if (existsSync(join(target, '.git'))) return '';
  // 从最近的已存在祖先开始探测（目标目录可能还不存在）
  let probe = target;
  while (probe && !existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return '';
    probe = parent;
  }
  const rc = runGit(['rev-parse', '--show-toplevel'], { cwd: probe });
  if (!rc.ok) return '';
  const root = String(rc.stdout || '').trim();
  // 上溯到的祖先位于某个仓库工作树内 → 该仓库就是会被误写的父仓库
  return root ? root : '';
}



/**
 * clone（只走 api.github.com Git Data API：git/trees + git/blobs，不直连 github.com）。
 * /tmp 中转建仓后整拷目标（兼容 CIFS 卷）。origin 写成 api.github.com/repos/o/r。
 * @returns {{ok, owner?, repo?, branch?, commitSha?, dest?, files?, error?}}
 */
export async function cloneViaApi({
  target = '', dest = '', token = '', branch = '',
  // 体积守卫：超过该值(MB)的文件不下载并如实告知；0 = 不限制
  maxFileMB = DEFAULT_MAX_FILE_MB,
  // 并发下载数：串行(1)最慢，过高会撞 GitHub 风控
  concurrency = DEFAULT_CONCURRENCY,
  // 进度回调（可选）：{done,total,transferred,totalBytes,failed}
  onProgress = null,
} = {}) {
  const pr = parseGithubOwnerRepo(target);
  if (!pr) return { ok: false, error: `无法解析 target（${target}）：需要 owner/repo 或 github URL` };
  const { owner, repo } = pr;
  const tok = token || resolveToken({ tokenPath: process.env.DSH_GIT_PUSH_TOKEN ? undefined : '', repoPath: '' }).token;
  const api = (path, method = 'GET', body) => githubFetch(`/repos/${owner}/${repo}${path}`, { token: tok, method, body });
  const meta = await api('');
  if (meta.status !== 200) return { ok: false, error: meta.error || `仓库查询失败: HTTP ${meta.status}` };
  const useBranch = branch || meta.json?.default_branch || 'master';
  const treeRes = await api(`/git/trees/${useBranch}?recursive=1`);
  if (treeRes.status !== 200) return { ok: false, error: treeRes.error || `tree 拉取失败: HTTP ${treeRes.status}` };
  const commitSha = treeRes.json?.sha || '';
  const targetDir = dest || join(process.cwd(), repo);
  // 拒绝克隆到既有仓库的工作树内：末尾的 git init/add/commit 会命中父仓库，
  //   把父仓库内容作为一次提交写进其历史（实测事故根因，见 enclosingGitRoot 注释）。
  const hostRoot = enclosingGitRoot(targetDir);
  if (hostRoot) {
    return {
      ok: false,
      error: `目标目录位于既有 git 仓库内（${hostRoot}）——拒绝克隆：`
        + `后续 git init/add/commit 会写入该仓库历史。请改用仓库外的目录。`,
      hostRepo: hostRoot,
    };
  }
  // 非空目录拒绝覆盖（防误覆盖已有内容）。
  //   2026-09-18：此前「目录已存在且非空」是**永久性**拒绝——clone 中途超时/中断会
  //     在 dest 留下半成品目录，用户再点一次 clone 就撞上这句、且无法自愈（实测复现）。
  //     现在只在「看起来是上次 clone 残留」时自动清理并重来；真正的用户目录仍拒绝。
  const destExisted = existsSync(targetDir);
  let isPartialClone = destExisted && isPartialCloneDir(targetDir);
  // 2026-09-18 追加：目录里只剩 .dsh-parts（上次下载阶段留下的分片目录）时，
  //   标记文件可能已因中途被杀而缺失，isPartialCloneDir 会判 false 而把目录当成
  //   「用户自有内容」永久拒绝——用户重试只能一直撞墙。故把「只有 .dsh-parts」
  //   也认定为可自愈残留（.dsh-parts 是本插件专有目录名，用户不会自建）。
  if (destExisted && !isPartialClone) {
    try {
      const top = readdirSync(targetDir);
      if (top.length > 0 && top.every((n) => n === PARTS_DIR)) isPartialClone = true;
    } catch { /* 读不到就按原判定处理 */ }
  }
  try {
    if (destExisted && readdirSync(targetDir).length > 0) {
      if (!isPartialClone) return { ok: false, error: `目标目录已存在且非空: ${targetDir}` };
      // 残留清理：仅删「本插件上次失败留下的」目录（有标记文件且无有效提交）。
      // 清理前**必须先中止**同目录正在跑的下载——否则 worker 会边删边写，
      //   rmdir 报 ENOTEMPTY（「创建目录失败」），且那个 worker 无人回收、
      //   任务标记失败后仍继续下载（实测：字节数持续增长、句柄不释放）。
      if (cloneAbortSignal()) {
        cloneLog('cleanup-abort-first', { dest: targetDir });
        const { abortCloneJob } = await import('./clone-jobs.js');
        abortCloneJob('cleanup-partial-dir');
      }
      // 2026-09-18 改：**只删分片目录，保留已下好的文件**以支持续传。
      //   原实现 removeDirForce(targetDir) 会把整个目录删光——104MB 已下内容因
      //   1 个文件失败全部丢弃，下次从零重下（CIFS 上代价极高）。
      //   保留是安全的，因为最终路径上的文件必然是完整的：
      //     downloadBlobs 先写 .part → **长度校验通过** → rename 到最终路径（原子）；
      //     长度不符时直接 return 失败，根本不会 rename。
      //   故这里**既不删目录也不删分片**，只移除旧标记。
      //
      // 2026-09-18 再修：原先是 `removeDirForce(partsPath)`（清掉整个 .dsh-parts）。
      //   实测证明这会**彻底废掉大文件的续传**：gallery 剩 4 个 7~15MB 的库，
      //   每轮都在**下载前**把上一轮下到一半的 .part 分片删掉，于是永远从 0 开始，
      //   网络一抖就超时、白下，连跑 3 轮都停在 95/99 不动。
      //   现在保留 .dsh-parts：fetchToFile 会用 Range 从中断处续传（已有实现），
      //   未下完的分片得以跨轮累积，大文件最终能下完。
      //   安全性不变：分片只在 .dsh-parts 内，rename 到最终路径前必过长度校验，
      //   故残留分片不会污染成品；目录内仍无 .git，不会被误判为完整仓库。
      const markerPath = join(targetDir, CLONE_MARKER);
      if (existsSync(markerPath)) {
        try { unlinkSync(markerPath); } catch { /* 标记已不在则忽略 */ }
      }
      cloneLog('resume-kept-files', { dest: targetDir, by: 'partial-clone' });
    }
    mkdirSync(targetDir, { recursive: true });
    // 写入进行中标记：中途超时/被杀可据此识别残留，供下次重试自愈
    writeFileSync(join(targetDir, CLONE_MARKER), String(Date.now()));
  } catch (e) {
    cloneLog('mkdir-fail', { dest: targetDir, error: e?.message || String(e) });
    return { ok: false, error: `创建目录失败: ${e?.message || e}` };
  }
  // CIFS 挂载（nounix）上 chmod 必然 EPERM：可执行位保真做不到。
  //   探测一次写进结果，让调用方知道「克隆成功但可执行位未保真」，而非静默退化。
  const metaOk = supportsMetadata(targetDir);

  // 体积守卫 + 并发下载 + 断点续传（实现见 clone-download.js）。
  //   此前是「逐文件串行 + 一个 blob 一次请求」：154MB 的仓库要发 99 次串行请求，
  //   单文件 30MB 的传输会把前端请求拖到超时（用户实测 signal timed out）。
  const allBlobs = (treeRes.json?.tree || []).filter((t) => t.type === 'blob' && t.path);
  const { download, skipped } = partitionBySize(allBlobs, maxFileMB);
  const dl = await downloadBlobs({
    // 必须传解析后的 tok，不能传入参 token：
    //   入参未显式给 token 时是空串，而私有仓下载不带凭据一律 404
    //   （API 调用那几行走的是 tok 所以正常，下载这里曾漏改 → 私有仓 95/99 文件失败）。
    blobs: download, targetDir, owner, repo, branch: useBranch, token: tok,
    concurrency, onProgress: onProgress || null,
    // 必须传 signal：清理同目录残留前会 abort，worker 据此退出。
    //   2026-09-18 前此处漏传，导致 abort 机制在真实路径上完全不生效——
    //   任务已判失败、worker 仍在写盘（用户实测「报错停止了其实还在下载」）。
    signal: cloneAbortSignal(),
  });
  const failed = dl.failed;
  const files = dl.files;

  const total = (treeRes.json?.tree || []).filter((t) => t.type === 'blob').length;
  // 有文件没拉下来 → 不是一次完整克隆。
  //
  // 2026-09-18 改：**不再删掉整个目录**，改为保留已下好的文件、只留标记。
  //   原实现（cleanupPartial 删光 targetDir）的理由是「避免下次 clone 撞已存在且非空」，
  //   但那个问题**已由 isPartialCloneDir + 标记文件解决**，不再需要靠删目录规避；
  //   而删目录的代价极高且已造成实际损失：
  //     · 实测 104MB 已下内容因 1 个文件失败被全部丢弃，下次重试从零重下（CIFS 上百 MB 极慢）；
  //     · 更严重的是它**静默删掉了目标目录的一切**——实测 gallery 目录即因此整个消失。
  //   保留是安全的：下载失败发生在 git init/add/commit（见下方）**之前**，
  //   故此目录内没有 .git、不会被误认为完整仓库；标记文件仍在，
  //   下次 clone 会被 isPartialCloneDir 判为残留并**续传**（.part 断点续传已在 clone-download 中实现）。
  if (failed.length > 0) {
    const cause = classifyCloneFailure(failed);
    cloneLog('clone-incomplete-kept', {
      dest: targetDir, failed: failed.length, total, cause, files,
    });
    return {
      ok: false,
      // 文案按「真实成因」给：401/404 这类重试无用，必须说清要改什么，
      //   否则用户会陷入无意义的重试循环（此前前端把一切归为「网络问题」）。
      error: `克隆未完成：${failed.length}/${total} 个文件拉取失败${CAUSE_TEXT[cause] || ''}`
        + `（已下好的 ${files} 个文件已保留，再次点击可续传）`,
      cause, retriable: CAUSE_RETRIABLE[cause] === true,
      owner, repo, branch: useBranch, commitSha, dest: targetDir,
      files, total, failed: failed.slice(0, 20), failedCount: failed.length,
      skipped: skipped.slice(0, 50), skippedCount: skipped.length,
      // 语义变更：不再是「已清理」，而是「已保留、可续传」
      cleaned: false, kept: true, resumable: true,
    };
  }

  // 转成 git 仓库并设 origin
  for (const args of [
    ['init', '-q'], ['add', '-A'], ['-c', 'user.email=v2-clone@local', '-c', 'user.name=v2-clone', 'commit', '-q', '-m', `clone from ${owner}/${repo}@${useBranch}`],
  ]) {
    runGit(args, { cwd: targetDir });
  }
  runGit(['remote', 'add', 'origin', `${GH_API}/repos/${owner}/${repo}`], { cwd: targetDir });

  // 成功：移除进行中标记，此后该目录不再被当作「可清理的残留」
  try { unlinkSync(join(targetDir, CLONE_MARKER)); } catch { /* 标记本就不在则忽略 */ }
  return {
    ok: true, owner, repo, branch: useBranch, commitSha, dest: targetDir, files, method: 'api',
    // 体积守卫跳过的文件必须如实回传：否则用户以为克隆完整，用到才发现缺东西
    skipped: skipped.slice(0, 50), skippedCount: skipped.length,
    total,
    // 目标文件系统不支持元数据（CIFS）时，可执行位保真会降级；
    //   显式回传实际状态，避免调用方以为权限已按 mode 100755 设好。
    modePreserved: metaOk && dl.modePreserved,
    metadataSupported: metaOk,
  };
}

/**
 * 清理 clone 失败留下的半成品目录。
 *
 * **当前无调用者**（2026-09-18 起失败路径改为保留文件以支持续传，见上面失败分支的注释）。
 *   保留而非删除的理由：它是失败收尾的兜底手段，若将来需要「彻底放弃某次克隆」的入口
 *   （例如用户显式要求丢弃半成品），应复用它而不是重新写一遍删除逻辑。
 *   注意 removeDirForce 会**递归删除整个目录**——调用前必须确认目录确属本插件创建的残留
 *   （有 CLONE_MARKER 且无有效 HEAD），否则会删掉用户内容。实测已发生过一次：孤儿 clone
 *   跑完失败路径后删掉了整个 gallery 目录，104MB 内容不可恢复。
 * @param {string} dir 目标目录
 */
async function cleanupPartial(dir) {
  // 用 removeDirForce 而非 rmSync：CIFS 上 rm 会因「边删边写」报 ENOTEMPTY，
  //   而这里是失败路径的收尾，清理不彻底会留下残留让下次重试再次撞墙。
  try { await removeDirForce(dir); } catch { /* 清理失败不掩盖真实错误 */ }
}

/**
 * clone 失败成因分类（供前端显示可操作的处置建议，而非笼统「网络问题」）。
 *
 * 为什么需要：失败原因决定「要不要重试」——401/404 重试永远失败，必须换 token
 *   或改 owner/repo；而超时/限流/5xx 等待后重试才是对的。若一律提示「可重试」，
 *   用户会在无解的错误上反复点。
 *
 * 取所有失败里**最具决定性**的一条：只要有一个凭据/不存在类失败，整体就按它定性
 *   （即使同时还有超时——先解决必然失败的那个）。
 * @param {Array<{path,status,reason}>} failed 失败明细
 * @returns {string} auth | notfound | ratelimit | network | server | disk | unknown
 */
export function classifyCloneFailure(failed = []) {
  const statuses = failed.map((f) => Number(f?.status));
  const isDisk = failed.some((f) => Number(f?.status) === -1 && /写盘|symlink/.test(String(f?.reason || '')));
  // 认证类（401/403）：无权限或 token 失效——重试无用
  if (statuses.includes(401)) return 'auth';
  if (statuses.includes(403)) return 'ratelimit'; // 403 多为限流；错误文案会带出 GitHub 原文
  if (statuses.includes(404)) return 'notfound';
  if (statuses.includes(429)) return 'ratelimit';
  // 只剩 status 0（超时/断网/DNS）与 5xx
  if (statuses.some((st) => st >= 500)) return 'server';
  if (isDisk) return 'disk';
  if (statuses.includes(0)) return 'network';
  return 'unknown';
}

/** 成因 → 补充说明（拼在错误信息尾部，直接告诉用户下一步做什么） */
const CAUSE_TEXT = {
  auth: '——凭据无效或无权访问：请更新 token / 确认该仓库权限后重试',
  notfound: '——仓库不存在或为私有：请确认 owner/repo 是否正确、token 是否可见该仓库',
  ratelimit: '——触发限流（GitHub 限速或权限不足）',
  server: '——GitHub 服务端错误',
  network: '——网络超时/中断',
  disk: '——本地写入失败：请检查目标目录权限与磁盘空间',
  unknown: '',
};

/** 成因 → 是否值得直接重试（false 时前端不应提示「可直接重试」） */
const CAUSE_RETRIABLE = {
  auth: false, notfound: false, ratelimit: true, server: true, network: true, disk: true, unknown: true,
};

/**
 * 预览一次 clone：先取 tree 并按体积阈值分组，**不下载任何文件**。
 *
 * 为什么需要：用户点 clone 前应知道「会拿到什么、会跳过什么」。直接开下再报告
 *   等于把「悄悄少文件」推迟到用户使用时才发现。预览也让前端能提前显示总量、
 *   算出进度百分比。
 * @param {{target:string, token?:string, branch?:string, maxFileMB?:number}} o
 * @returns {Promise<object>} { ok, owner, repo, branch, totalFiles, downloadCount,
 *   downloadBytes, skipped, skippedCount, skippedBytes, empty }
 */
export async function previewClone({ target = '', token = '', branch = '', maxFileMB = DEFAULT_MAX_FILE_MB } = {}) {
  const pr = parseGithubOwnerRepo(target);
  if (!pr) return { ok: false, error: `无法解析 target（${target}）：需要 owner/repo 或 github URL` };
  const { owner, repo } = pr;
  const api = (path, method = 'GET') => githubFetch(`/repos/${owner}/${repo}${path}`, { token, method });
  const meta = await api('');
  if (meta.status !== 200) {
    return { ok: false, status: meta.status, error: `读取仓库信息失败（HTTP ${meta.status}）${meta.error ? ': ' + meta.error : ''}` };
  }
  const useBranch = branch || meta.json?.default_branch || 'main';
  const treeRes = await api(`/git/trees/${encodeURIComponent(useBranch)}?recursive=1`);
  if (treeRes.status !== 200) {
    return { ok: false, status: treeRes.status, error: `读取文件列表失败（HTTP ${treeRes.status}）${treeRes.error ? ': ' + treeRes.error : ''}` };
  }
  const allBlobs = (treeRes.json?.tree || []).filter((t) => t.type === 'blob' && t.path);
  const { download, skipped } = partitionBySize(allBlobs, maxFileMB);
  return {
    ok: true,
    owner, repo, branch: useBranch,
    totalFiles: allBlobs.length,
    downloadCount: download.length,
    downloadBytes: download.reduce((s, b) => s + (Number(b.size) || 0), 0),
    skipped: skipped.slice(0, 50),
    skippedCount: skipped.length,
    skippedBytes: skipped.reduce((s, b) => s + (Number(b.size) || 0), 0),
    maxFileMB,
    // 全被跳过时前端应强提示：否则会得到一个空目录
    empty: allBlobs.length > 0 && download.length === 0,
  };
}
