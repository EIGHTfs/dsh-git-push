// dsh-git-push v1.42.0 — git 命令执行基座（runGit/gitRaw/全局安全配置）（自 core.js 按功能拆分，行为零变化）

import { httpsUrlOf, pushViaApi } from './github-api.js';
import { resolveSshKey } from './token-credentials.js';
import { spawnSync } from 'node:child_process';

export function gitCFlags(cwd) {
  const flags = ['-c', 'safe.directory=*', '-c', 'core.filemode=false'];
  if (cwd) flags.push('-c', `safe.directory=${cwd}`);
  return flags;
}

/**
 * 启动时写全局 core.filemode=false。
 * 功能：NAS/CIFS 挂载上忽略文件可执行位，status/add 不再把权限噪声当变更。
 * 「新功能gitpush插件会git config --global core.filemode false」
 * AI 思路：幂等；失败只记返回值不抛（容器 HOME 只读时仍靠 gitCFlags）。
 */

export function ensureGlobalFilemodeFalse() {
  const r = spawnSync('git', ['config', '--global', 'core.filemode', 'false'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1' },
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

/**
 * 启动时把全局 safe.directory=* 写上（幂等）。
 * 功能：CIFS/跨用户挂载上忽略「可疑属主」噪声，裸 git 也不再被拦。
 * 已有 * 则不重复 add。
 */

export function ensureGlobalSafeDirectoryStar() {
  const get = spawnSync('git', ['config', '--global', '--get-all', 'safe.directory'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1' },
  });
  const values = (get.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (values.includes('*')) {
    return { ok: true, skipped: 'already-star', status: 0, stdout: '*', stderr: '' };
  }
  const r = spawnSync('git', ['config', '--global', '--add', 'safe.directory', '*'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1' },
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

/** 调用 git_commit_push 时注入的 README 检查提示（提交前必须核对 README 是否要更新）。 */

export function runGit(args, cwd, env = {}) {
  const { keyPath } = resolveSshKey();
  const sshEnv = keyPath ? {
    GIT_SSH_COMMAND: `ssh -i "${keyPath}" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`,
  } : {};
  try {
    const r = spawnSync('git', [...gitCFlags(cwd), ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'ignore'],
      // DSH_GIT_ENFORCE_PASS=1：插件内部 git 调用直通 git 包装器门禁（只拦 AI 裸 git）
      env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1', ...sshEnv, ...env },
    });
    return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), ...(r.error ? { error: String(r.error.message || r.error) } : {}) };
  } catch (e) {
    return { status: null, stdout: '', stderr: '', error: String(e?.message || e) };
  }
}

// 2026-09-02：httpsUrlOf 不再产出 github.com 网络 URL。
// 【原代码】SSH origin → HTTPS 等价 URL（https://github.com/<owner>/<repo>.git），仅用于 token 通道
// export function httpsUrlOf(originUrl) {
//   return (originUrl || '')
//     .replace(/^ssh:\/\/git@ssh\.github\.com:443\//, 'https://github.com/')
//     .replace(/^git@github\.com:/, 'https://github.com/');
// }
// 【改为】「修复此插件，使所有功能都默认api.github.com」
// 【思路】httpsUrlOf 曾给 git push HTTPS 回退用，回退已删除；改产出 api.github.com/repos/o/r
// （只作本地 origin 字符串，不发起 github.com 请求）。解析失败返回空串。

/** gitRaw：git 命令执行（stdout 保留 Buffer，供 blob 原始字节读取），供 github-api.js 复用。 */
export function gitRaw(args, cwd) {
  try {
    const r = spawnSync('git', [...gitCFlags(cwd), ...args], {
      cwd,
      encoding: 'buffer',
      maxBuffer: 128 * 1024 * 1024,
      timeout: 600_000,
      stdio: ['pipe', 'pipe', 'ignore'],
      // DSH_GIT_ENFORCE_PASS=1：插件内部 git 调用直通包装器门禁（与 runGit 一致）
      env: { ...process.env, DSH_GIT_ENFORCE_PASS: '1' },
    });
    return { status: r.status, stdout: r.stdout || Buffer.alloc(0), stderr: r.stderr || Buffer.alloc(0), ...(r.error ? { error: String(r.error.message || r.error) } : {}) };
  } catch (e) {
    return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: String(e?.message || e) };
  }
}

/**
 * v1.12.0 默认推送通道：走 api.github.com 的 Git Data API（blob → tree → commit → ref），
 * 完全不依赖 github.com 直连（本机 github.com 被网络阻断、api.github.com 可达时可用）。
 * 流程：取本地 HEAD tree → 逐 blob 上传（复用远端已有 sha 的跳过）→ 建 tree → 建 commit（parent=远端 HEAD）→ 更新 ref。
 * 返回 { ok, pushed, reason, commitSha, owner, repo }
 */
/** 构造 pushViaApi 用的 GitHub API 调用闭包。 */
