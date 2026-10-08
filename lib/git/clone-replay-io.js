/**
 * 克隆·真实历史：把 replayHistory 的 io 契约接到**真实** git / GitHub API / 下载器上。
 *
 * 【分工】clone-replay.js 负责「算什么」（纯逻辑，已单测）；本文件负责「怎么跑」（接线）。
 *   所有外部动作默认走真实实现，但都可用 deps 覆盖 ⇒ 接线层本身也能离线单测。
 *
 * 【真实签名（已逐个核对，非猜测）】
 *   · runGit(args, { cwd, timeoutMs, env })                —— lib/git/exec.js:84（支持 env，故 GIT_AUTHOR_* 可传）
 *   · githubFetch(path, { token, method, body, timeout, headers }) —— lib/git/api.js:22
 *   · downloadBlobs({ blobs, targetDir, owner, repo, branch, token, concurrency, onProgress, signal })
 *        → { files, failed, modePreserved }                —— lib/git/clone-download.js:217
 *
 * 【两个容易踩的点，已在实现里处理】
 *   ① exec.js 的 GIT_GLOBAL_ARGS 已含 `-c core.filemode=false`（仅作用于插件自己的 git 调用）；
 *      克隆出来的仓库是**给用户用的**，其 config 里没有这一项 ⇒ 本适配器在 prepare 时显式写一次
 *      （不支持 mode 的卷上，避免用户 `git diff` 满屏 mode 变更）。
 *   ② `git remote add` 在已有 origin 时会失败 ⇒ prepare 先探测再 add，不改动已有 origin。
 */

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';

import { githubFetch } from './api.js';
import { runGit } from './exec.js';
import { downloadBlobs } from './clone-download.js';
import {
  blobEntriesOf, initArgs, setRemoteArgs, configFileModeArgs, addAllArgs, writeTreeArgs,
  commitTreeArgs, updateRefArgs, setUpstreamArgs, localBranchRef, remoteTrackingRef, markerJson,
} from './clone-replay.js';

/** 标记文件名（放在 .git 内，不进工作区、不被 git 跟踪）。 */
export const REPLAY_MARKER_FILE = 'dsh-clone-history.json';

/**
 * 建一个 replayHistory 可用的 io。
 *
 * @param {object} o
 * @param {string} o.repoPath 目标仓库工作区路径
 * @param {string} o.gitDir  仓库的 .git 目录路径（标记写在这里面）
 * @param {string} o.owner/o.repo/o.branch GitHub 坐标
 * @param {string} [o.token] 私有仓下载所需
 * @param {Function} [o.onProgress] 透传给 downloadBlobs 的进度回调
 * @param {object} [o.signal] 中止信号
 * @param {object} [o.deps] 覆盖真实实现（测试用）：{ runGit, githubFetch, downloadBlobs }
 * @returns {object} io：与 replayHistory 约定一致
 */
export function createReplayIo({
  repoPath = '', gitDir = '', owner = '', repo = '', branch = '', token = '',
  onProgress = null, signal = null, deps = {},
} = {}) {
  const git = deps.runGit || runGit;
  const api = deps.githubFetch || githubFetch;
  const download = deps.downloadBlobs || downloadBlobs;
  const markerFile = join(gitDir, REPLAY_MARKER_FILE);
  const gitOpts = { cwd: repoPath };

  return {
    /** 读续跑标记；不存在/损坏一律回 null（当作从头开始，绝不让坏标记影响重放）。 */
    async readMarker() {
      try {
        if (!existsSync(markerFile)) return null;
        return JSON.parse(readFileSync(markerFile, 'utf8'));
      } catch {
        return null;
      }
    },

    /** 写续跑标记：先写临时文件再 rename（避免半截 JSON 被当成有效标记）。 */
    async writeMarker({ branch: b = '', replayedSha = '' } = {}) {
      try {
        const tmp = `${markerFile}.tmp`;
        writeFileSync(tmp, markerJson({ branch: b, replayedSha }), 'utf8');
        renameSync(tmp, markerFile);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    },

    /**
     * 取某提交的树条目：`/git/trees/{sha}?recursive=1` → blobEntriesOf。
     * 树过大被截断时 blobEntriesOf 会返回 ok:false（绝不能当完整树用，否则重放出的 sha 与远端不同）。
     */
    async fetchTreeEntries(treeSha) {
      const r = await api(`/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`, { token });
      // githubFetch 无 ok 字段（返回 {status,json,text,buffer,rateLimit}）⇒ 必须按 status 判定，
      //   否则 HTTP 200 也会被当成失败（真仓库 e2e 曾因此一步都跑不动）。
      if (!(r?.status === 200 || r?.ok === true)) return { ok: false, entries: [], error: `取树 HTTP ${r?.status ?? '?'}` };
      const parsed = blobEntriesOf(r.json);
      return { ok: parsed.ok, entries: parsed.entries, error: parsed.error || '' };
    },

    /** 落地本轮要下载/更新的文件（复用现有并发下载 + .part 续传 + 体积守卫）。 */
    async applyDownload(entries) {
      const r = await download({
        blobs: entries, targetDir: repoPath, owner, repo, branch, token,
        onProgress, signal,
      });
      if (r?.failed?.length) {
        const first = r.failed[0];
        return { ok: false, failed: r.failed, error: `${r.failed.length} 个文件失败（如 ${first.path}: ${first.reason}）` };
      }
      return { ok: true, files: r?.files ?? entries.length, modePreserved: r?.modePreserved !== false };
    },

    /** 删掉本轮从树上消失的路径（目录变文件等情形也由此覆盖）。 */
    async applyRemove(paths = []) {
      const failed = [];
      for (const p of paths) {
        try {
          rmSync(join(repoPath, p), { recursive: true, force: true });
        } catch (e) {
          failed.push({ path: p, reason: e?.message || String(e) });
        }
      }
      return failed.length ? { ok: false, failed, error: `${failed.length} 个路径删除失败` } : { ok: true };
    },

    /**
     * 建一条提交：暂存全部变更 → write-tree → commit-tree（多父由 -p 逐个给出）。
     * 为什么不用 `git commit`：commit-tree 原生支持多父，且结果只由 tree+parents+env+message 决定。
     */
    async commit({ env = {}, message = '', parentShas = [] } = {}) {
      const add = git(addAllArgs(), gitOpts);
      if (!add?.ok) return { ok: false, error: `git add 失败：${add?.stderr || add?.stdout || '未知'}` };
      const wt = git(writeTreeArgs(), gitOpts);
      const tree = String(wt?.stdout || '').trim();
      if (!wt?.ok || !tree) return { ok: false, error: `git write-tree 失败：${wt?.stderr || '无 tree'}` };
      const ct = git(commitTreeArgs({ tree, parents: parentShas, message }), { ...gitOpts, env });
      const sha = String(ct?.stdout || '').trim();
      if (!ct?.ok || !sha) return { ok: false, error: `git commit-tree 失败：${ct?.stderr || '无 sha'}` };
      return { ok: true, sha };
    },

    /** 重放前准备：init → 显式写 core.fileMode=false → 设 origin（已有 origin 则不覆盖）。 */
    async prepare() {
      const init = git(initArgs(), gitOpts);
      if (!init?.ok) return { ok: false, error: `git init 失败：${init?.stderr || '未知'}` };
      const cfg = git(configFileModeArgs(false), gitOpts);
      const hasOrigin = git(['remote', 'get-url', 'origin'], gitOpts);
      let originSet = true;
      if (!hasOrigin?.ok) {
        const url = `https://github.com/${owner}/${repo}.git`;
        const add = git(setRemoteArgs('origin', url), gitOpts);
        originSet = !!add?.ok;
      }
      return { ok: true, fileModeSet: !!cfg?.ok, originSet };
    },

    /** 重放收尾：把分支与远端跟踪引用指到重放结果，并设上游（标准 git 命令随即可用）。 */
    async finish({ headSha = '' } = {}) {
      const out = { branchRef: false, remoteRef: false, upstream: false };
      if (!headSha) return { ok: false, ...out, error: '缺少 headSha' };
      out.branchRef = !!git(updateRefArgs(localBranchRef(branch), headSha), gitOpts)?.ok;
      out.remoteRef = !!git(updateRefArgs(remoteTrackingRef('origin', branch), headSha), gitOpts)?.ok;
      out.upstream = !!git(setUpstreamArgs(branch), gitOpts)?.ok;
      const okAll = out.branchRef;
      return { ok: okAll, ...out, error: okAll ? '' : '分支引用更新失败（重放结果未挂到分支上）' };
    },
  };
}
