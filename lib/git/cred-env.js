/**
 * git_cred_env —— 凭据传递工具（2026-09-21）。
 *
 * 目标：插件保管凭据（config.json 的 githubToken + 配置目录 SSH 私钥），把凭据转成
 * 「可直接粘贴的环境变量前缀」供 AI 执行**任意外部 git 命令**时使用，AI 全程不接触明文：
 *   · SSH 通道：GIT_SSH_COMMAND 指向插件私钥**路径**（AI 只接触路径，私钥明文不经手）
 *   · HTTPS 通道：GIT_ASKPASS 指向生成的 askpass 脚本（脚本从 config.json 读 token 回显；
 *     AI 只接触脚本路径，token 明文仅存在于 config.json 与 git 进程内存）
 * 本模块只做凭据传递，不覆盖 git 功能（git 操作仍由 AI 用任意命令执行）。
 * 复用存量：resolveSshKey（私钥解析）/ resolveToken（token 探测）/ credentialsDir（配置目录）。
 */
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { credentialsDir, resolveSshKey, resolveToken } from './credentials.js';

/** 宿主 node 绝对路径（askpass 脚本自包含，不依赖 PATH）。 */
const NODE = process.execPath;

/** 组装 SSH 通道的 GIT_SSH_COMMAND（插件内部 buildLsRemoteSshCmd 是 ls-remote 专用，
 *  含 ControlMaster/临时 known_hosts，不适合粘贴给外部 git——这里组装简洁可粘贴版本）。 */
function buildSshEnvPrefix(keyPath) {
  return `GIT_SSH_COMMAND="ssh -i '${keyPath}' -p 443 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5"`;
}

/**
 * 构建凭据环境变量输出（不输出 token/私钥明文）。
 * @param {{workspaceRoot?: string}} [opts]
 * @returns {{provided: string[], hasSshKey: boolean, hasToken: boolean, ssh: object|null, https: object|null, hint: string}}
 */
export function buildCredEnv({ workspaceRoot = '' } = {}) {
  const dir = credentialsDir({ workspaceRoot });
  const sshKey = resolveSshKey({ workspaceRoot });
  // 存量约定：resolveSshKey 无密钥时返回 { keyPath: '', kind: '' } 占位对象（非 null）——
  //   判据用 keyPath 非空，不能 !!obj（占位对象恒真，会把「无私钥」误判成有）
  const hasKey = !!(sshKey && sshKey.keyPath);
  const tok = resolveToken({ workspaceRoot });
  const out = {
    provided: [],
    hasSshKey: hasKey,
    hasToken: !!(tok && tok.token),
    ssh: null,
    https: null,
    hint: '',
  };
  // SSH 通道：传私钥路径（路径非明文）
  if (hasKey) {
    const envPrefix = buildSshEnvPrefix(sshKey.keyPath);
    out.ssh = {
      channel: 'ssh',
      keyPath: sshKey.keyPath,
      envPrefix,
      example: `${envPrefix} git clone git@github.com:<owner>/<repo>.git`,
    };
    out.provided.push('ssh');
  }
  // HTTPS 通道：askpass 脚本（配置目录 git-askpass.sh，从 config.json 读 token 回显）
  if (tok && tok.token) {
    const askpass = join(dir, 'git-askpass.sh');
    const script = [
      '#!/bin/sh',
      '# dsh-git-push git-askpass：从插件 config.json 读 githubToken 回显（AI 不经手明文；token 只在 config.json 与 git 进程内存）',
      `CFG='${dir}/config.json'`,
      `TOKEN=$(${NODE} -e "const fs=require('fs');const m=fs.readFileSync(process.argv[1],'utf8').match(/\\"githubToken\\"\\s*:\\s*\\"([^\\"]+)\\"/);process.stdout.write(m?m[1]:'')" "$CFG")`,
      'case "$1" in',
      '  *[Uu]sername*) echo "git" ;;', // GitHub 个人访问 token 认证时用户名可为任意非空
      '  *) echo "$TOKEN" ;;',
      'esac',
      '',
    ].join('\n');
    try {
      writeFileSync(askpass, script, { mode: 0o600 });
      chmodSync(askpass, 0o755);
      out.https = {
        channel: 'https',
        askpass,
        envPrefix: `GIT_ASKPASS="${askpass}" GIT_TERMINAL_PROMPT=0`,
        example: `GIT_ASKPASS="${askpass}" git clone https://github.com/<owner>/<repo>.git`,
      };
      out.provided.push('https');
    } catch { /* 写 askpass 失败 → 无 HTTPS 通道（SSH 若可用仍提供） */ }
  }
  if (!out.provided.length) {
    out.hint = '插件未保管可用凭据：config.json 无 githubToken 且配置目录无 SSH 私钥——先 git_gen_ssh_key 生成私钥，或在设置侧边栏保存 token 后再试。';
  } else {
    out.hint = '凭据由插件保管，上方只有路径/命令串（无明文）；把 envPrefix 直接粘到 git 命令前即可执行。';
  }
  return out;
}