/**
 * 浅包装 git（最小版）——自动注入插件凭据，参数与 git 完全一致。
 *
 * 用法：git-sluice git <任意 git 参数>（例：git-sluice git pull / git clone owner/repo）
 * 凭据自动注入（无需调用方传 token/私钥参数）：
 *   · SSH 通道：GIT_SSH_COMMAND 指向插件私钥（与 git_cred_env 同口径：路径直通、私钥明文不经手）
 *   · HTTPS 通道：GIT_ASKPASS 指向 git-askpass.sh（从 config.json 读 token 回显）
 */

import { execFileSync } from 'node:child_process';
import { buildCredEnv } from './cred-env.js';
import { resolveGitBin, GIT_MISSING_MSG, GIT_GLOBAL_ARGS } from './exec.js';

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
  // 可选快通道（默认关）：DSH_GIT_MIRROR_PREFIX=https://gh-proxy.com/
  //   用 git 自带的 url.<base>.insteadOf 把 github 的 https 访问改走镜像；
  //   不写全局配置、不内置任何第三方镜像（代理会看到流量，必须显式开启）。
  //   实测（群晖 193，2026-10-03）：codeload.github.com 21KB/s → gh-proxy.com 12MB/s。
  const mirror = process.env.DSH_GIT_MIRROR_PREFIX;
  if (mirror) {
    const base = mirror.endsWith("/") ? mirror : mirror + "/";
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = `url.${base}https://github.com/.insteadOf`;
    env.GIT_CONFIG_VALUE_0 = "https://github.com/";
  }
  return env;
}

/** 透传执行 git（参数原样传给 git，凭据自动注入；stdio 直连调用方）。 */
export function runWrappedGit(args = [], { workspaceRoot = '' } = {}) {
  const env = buildWrappedGitEnv({ workspaceRoot });
  // 显式解析 git 可执行文件：服务用户的 PATH 里往往没有 git（见 exec.js resolveGitBin 说明）
  const bin = resolveGitBin();
  if (!bin) { console.error(GIT_MISSING_MSG); return { ok: false, status: 127 }; }
  try {
    // 与 runGit 同口径带上 GIT_GLOBAL_ARGS（safe.directory=* 等），避免透传通道
    // 在「仓库属主 ≠ 当前用户」时被 git 以 dubious ownership 拒绝
    execFileSync(bin, GIT_GLOBAL_ARGS.concat(args), { stdio: 'inherit', env });
    return { ok: true, status: 0 };
  } catch (e) {
    return { ok: false, status: typeof e.status === 'number' ? e.status : 1 };
  }
}

/**
 * 捕获输出的透传执行（工具调用用：返回 stdout/stderr 文本，AI 直接读结果）。
 * 与 runWrappedGit 同凭据注入（SSH 私钥 / HTTPS askpass），不直连 stdio。
 */
export function runWrappedGitCapture(args = [], { workspaceRoot = '' } = {}) {
  const env = buildWrappedGitEnv({ workspaceRoot });
  const bin = resolveGitBin();
  if (!bin) return { ok: false, status: 127, stdout: '', stderr: GIT_MISSING_MSG };
  try {
    const r = execFileSync(bin, GIT_GLOBAL_ARGS.concat(args), { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, status: 0, stdout: String(r), stderr: '' };
  } catch (e) {
    return {
      ok: false,
      status: typeof e.status === 'number' ? e.status : 1,
      stdout: String(e.stdout || ''),
      stderr: String(e.stderr || e.message || ''),
    };
  }
}