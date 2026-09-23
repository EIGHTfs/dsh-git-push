/**
 * 浅包装 git（2026-09-23，最小版）——自动注入插件凭据，参数与 git 完全一致。
 *
 * 用法：git-sluice git <任意 git 参数>（例：git-sluice git pull / git clone owner/repo）
 * 凭据自动注入（无需调用方传 token/私钥参数）：
 *   · SSH 通道：GIT_SSH_COMMAND 指向插件私钥（与 git_cred_env 同口径：路径直通、私钥明文不经手）
 *   · HTTPS 通道：GIT_ASKPASS 指向 git-askpass.sh（从 config.json 读 token 回显）
 */

import { execFileSync } from 'node:child_process';
import { buildCredEnv } from './cred-env.js';

/** 组装注入凭据后的 git 环境（在 process.env 基础上叠加插件凭据通道）。 */
export function buildWrappedGitEnv({ workspaceRoot = '' } = {}) {
  const env = { ...process.env };
  const cred = buildCredEnv({ workspaceRoot });
  if (cred.ssh?.keyPath) {
    // 与 cred-env 的 buildSshEnvPrefix 同口径（443 端口 + IdentitiesOnly + accept-new）
    env.GIT_SSH_COMMAND = `ssh -i '${cred.ssh.keyPath}' -p 443 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5`;
  }
  if (cred.https?.askpass) {
    env.GIT_ASKPASS = cred.https.askpass;
    env.GIT_TERMINAL_PROMPT = '0';
  }
  return env;
}

/** 透传执行 git（参数原样传给 git，凭据自动注入；stdio 直连调用方）。 */
export function runWrappedGit(args = [], { workspaceRoot = '' } = {}) {
  const env = buildWrappedGitEnv({ workspaceRoot });
  try {
    execFileSync('git', args, { stdio: 'inherit', env });
    return { ok: true, status: 0 };
  } catch (e) {
    return { ok: false, status: typeof e.status === 'number' ? e.status : 1 };
  }
}