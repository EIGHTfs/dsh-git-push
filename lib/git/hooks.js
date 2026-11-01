/**
 * git 钩子探针：提交/推送前告诉用户「本次会触发哪些钩子」，并识别**坏钩子**。
 *
 * 为什么需要（2026-11-01 同机会话实测移交）：CIFS 挂载上的仓库里存在一个从旧机器
 *   随 `.git/` 一起迁过来的 `prepare-commit-msg` 垫片，里面写死了上一台机器的
 *   pnpm 绝对路径（`/volume13/...`）。插件对此**零感知**：既不在回执里说明会跑钩子，
 *   也不知道这个钩子一执行就失败。用户只能看到"提交很慢/失败"而没有任何线索。
 *
 * 处置口径（刻意保守）：
 *   · 默认**照常运行**钩子 —— 很多仓库靠 pre-commit 做 lint/格式化，插件不能替用户关掉；
 *   · 只有当钩子**可证明是坏的**（解释器不存在 / 脚本里引用的绝对路径不存在）时，
 *     才为该次提交加 `LEFTHOOK=0`（lefthook 官方跳过开关）+ 在回执里说明原因；
 *   · 探针结果始终随回执返回，dryRun 预览里也会列出。
 *
 * 不做 `git config core.hooksPath` 之类的绕法：实测本机对 `.git/config.lock` 的
 *   chmod 会 EPERM（`Operation not permitted`），写配置这条路在 CIFS 上根本走不通。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 与提交/推送生命周期相关的钩子（顺序即执行顺序）。 */
export const HOOK_NAMES = ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-push'];

/** 脚本里出现的绝对路径（用于判断「引用的是不是一台不存在的机器上的路径」）。 */
const ABS_PATH_RE = /(?:^|[\s'"`=])(\/[A-Za-z0-9._\-/]{3,})/g;

/**
 * 判断单个钩子是否「可证明坏掉」。
 * @returns {{broken:boolean, reason:string}}
 */
function inspectHook(path) {
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return { broken: false, reason: '' }; }
  // ① 解释器不存在（shebang 指向的绝对路径）
  const shebang = /^#!\s*(\S+)/.exec(text);
  if (shebang) {
    const interp = shebang[1];
    if (interp.startsWith('/') && !existsSync(interp)) {
      return { broken: true, reason: `解释器不存在：${interp}` };
    }
  }
  // ② 脚本里引用了一个不存在的绝对路径，且该路径带明显的机器前缀（/volume..、/home/..、/Users/..）
  //   只认这类「机器相关」前缀，避免把 `/bin/sh`、`/usr/bin/env` 之类正常路径误判。
  const machineish = /^\/(?:volume\d+|home|Users|Volumes|mnt|opt\/[^/]+\/target)\b/;
  for (const m of text.matchAll(ABS_PATH_RE)) {
    const p = m[1];
    if (!machineish.test(p)) continue;
    if (existsSync(p)) continue;
    return { broken: true, reason: `脚本引用的路径不存在：${p}` };
  }
  return { broken: false, reason: '' };
}

/**
 * 探针：列出该仓库当前会触发的钩子。
 * @param {string} repoPath 仓库根
 * @returns {{items:Array<{name:string, path:string, broken:boolean, reason:string}>,
 *            active:string[], broken:string[], env:object}}
 *   env = 需要附加到 git 调用的环境变量（仅在存在坏钩子时给 LEFTHOOK=0）
 */
export function probeHooks(repoPath) {
  const dir = join(repoPath, '.git', 'hooks');
  const items = [];
  for (const name of HOOK_NAMES) {
    const path = join(dir, name);
    let st = null;
    try { st = statSync(path); } catch { continue; }
    if (!st.isFile()) continue;
    const executable = (st.mode & 0o111) !== 0;
    if (!executable) continue;   // 不可执行的钩子 git 不会跑，不必列
    const { broken, reason } = inspectHook(path);
    items.push({ name, path, broken, reason });
  }
  const active = items.map((it) => it.name);
  const broken = items.filter((it) => it.broken).map((it) => it.name);
  return {
    items,
    active,
    broken,
    // 只有**存在坏钩子**时才跳过（LEFTHOOK=0 对非 lefthook 钩子无副作用，但这里语义上
    //   只承诺"坏钩子不阻断提交"；正常钩子一律照跑）
    env: broken.length ? { LEFTHOOK: '0' } : {},
  };
}

/** 人读的一行摘要（回执/dryRun 用）。 */
export function describeHooks(probe) {
  if (!probe || !probe.items.length) return '本次不触发任何 git 钩子';
  const parts = probe.items.map((it) => (it.broken ? `${it.name}（坏：${it.reason}，已跳过）` : it.name));
  return `本次会触发的 git 钩子：${parts.join(', ')}`;
}
