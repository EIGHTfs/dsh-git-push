/**
 * CLI 命令 · 账号 / 凭据 / 远端（从 cli.mjs 抽出）
 *
 * 为什么拆出来：cli.mjs 802 行超单文件阈值（400 行代码），本组 5 个命令
 *   （account-check / cred-env / remote-create / set-visibility / gen-ssh-key）
 *   是独立的能力域（GitHub 账号与凭据操作），与审计/扫描/文档类命令无共享状态。
 *
 * 保持薄引用：命令只做「传参 + 格式化输出」，逻辑在 lib/git/*（与插件工具同源）。
 */

import { checkGithubAccount, formatGithubAccountBlock } from '../git/account.js';
import { ensureRemoteRepo, setVisibility } from '../git/remote.js';
import { generateSshKey } from '../git/credentials.js';
import { parseGithubOwnerRepo } from '../git/api.js';
import { execFileSync } from 'node:child_process';

/** 子命令失败输出前缀。 */
const FAIL_PREFIX = '❌ 失败:';
/** 子命令失败输出（统一格式：前缀 + 错误信息）。 */
const failOf = (r) => `${FAIL_PREFIX} ${r.error || ''}`;

/** 子命令：account-check — 校验 GitHub 账号与凭据（token 在线校验 + SSH 公钥指纹）。 */
export async function cmdAccountCheck(flags) {
  const r = await checkGithubAccount({ token: flags.token || '', checkSsh: flags.checkSsh !== false });
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return r.ok === false ? 1 : 0; }
  // 复用插件的格式化输出（保证 CLI 与侧边栏账号面板口径一致）
  console.log(formatGithubAccountBlock(r));
  if (r.sshPub) console.log(`\n公钥内容：\n${r.sshPub}`);
  return r.ok === false ? 1 : 0;
}

/**
 * 子命令：filemode — 查看/设置 `core.filemode`（忽略权限位变动）。
 *
 * 为什么需要它：CIFS/SMB 与容器卷上新文件权限是 755/777，仓库记录是 644，
 *   git 会把每个新文件都算成改动（内容一个字节没变）。设 `core.filemode=false` 即可。
 *   缺省只查看；`--apply` 才写。CIFS 上 `git config` 会因 config.lock 的 chmod EPERM 失败，
 *   实现里有退路（直接改写 .git/config 并回读验证）。
 * @param {string} root 仓库路径
 * @param {object} flags 解析后的参数
 * @returns {Promise<number>} 退出码
 */
export async function cmdFilemode(root, flags) {
  const { readFilemode, setFilemode, filemodeHint } = await import('../git/filemode.js');
  const repoPath = root || process.cwd();
  if (flags.apply !== true) {
    const r = readFilemode({ repoPath: repoPath });
    if (!r.ok) { console.error(r.error); return 1; }
    if (flags.json) { console.log(JSON.stringify(r, null, 2)); return 0; }
    console.log(`仓库：${repoPath}`);
    console.log(`core.filemode（生效）：${String(r.effective)}  （本地配置：${String(r.local)} / 全局：${String(r.global)}）`);
    console.log(`纯权限变动文件：${r.modeOnly.count} 个${r.modeOnly.count ? '（内容未变，忽略权限后即消失）' : ''}`);
    for (const f of r.modeOnly.files.slice(0, 10)) console.log(`  - ${f}`);
    console.log(filemodeHint(r.effective));
    if (r.effective !== false) console.log('修复：git-sluice filemode <repo> --apply');
    return 0;
  }
  const scope = flags.global === true ? 'global' : 'local';
  const value = flags.compare === true; // 缺省 false = 忽略权限位
  const w = setFilemode({ repoPath: repoPath, scope: scope, value: value });
  if (!w.ok) { console.error(w.error); return 1; }
  if (flags.json) { console.log(JSON.stringify(w, null, 2)); return 0; }
  console.log(`已写入 core.filemode=${String(w.effective)}（scope=${scope}，via=${w.via}）`);
  if (w.backup) console.log(`原文件已备份：${w.backup}`);
  console.log(`纯权限变动文件：${w.modeOnly.count} 个`);
  return 0;
}

/** 子命令：cred-env — 输出插件保管凭据的环境变量前缀（AI 执行外部 git 时粘贴使用，无明文）。 */
export async function cmdCredEnv(flags) {
  const { buildCredEnv } = await import('../git/cred-env.js');
  const r = buildCredEnv({});
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return 0; }
  if (!r.provided.length) { console.log(`❌ ${r.hint}`); return 1; }
  console.log('凭据传递（插件保管，以下只有路径/命令串，无 token/私钥明文）：');
  for (const ch of r.provided) {
    const chCfg = r[ch];
    console.log(`\n[${ch === 'ssh' ? 'SSH 通道' : 'HTTPS 通道'}]`);
    console.log(`  envPrefix: ${chCfg.envPrefix}`);
    console.log(`  用法示例: ${chCfg.example}`);
  }
  console.log(`\n提示：${r.hint}`);
  return 0;
}

/** 子命令：remote-create — 按项目文件夹在 GitHub 建远端仓库（已存在则复用）。 */
export async function cmdRemoteCreate(repo, flags) {
  if (!repo) { console.error('缺少 <repo>（用法: git-sluice remote-create <repo> [--visibility public|private]）'); return 1; }
  const r = await ensureRemoteRepo({
    repoPath: repo,
    owner: flags.owner || '',
    visibility: flags.visibility || 'private',
    dryRun: flags.dryRun === true,
  });
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1; }
  if (!r.ok) { console.error(failOf(r)); return 1; }
  if (r.dryRun) { console.log(`预演：将创建 ${r.owner}/${r.name}（${r.visibility}）`); return 0; }
  if (r.exists) { console.log(`✅ 远端已存在，直接复用：${r.owner}/${r.name}（${r.visibility}）`); return 0; }
  console.log(`✅ 已创建远端仓库：${r.owner}/${r.name}（${r.visibility}）`);
  console.log(`   origin → ${r.origin || ''}`);
  return 0;
}

/** 子命令：set-visibility — 切换仓库公开/私有。 */
export async function cmdSetVisibility(repo, flags) {
  const vis = String(flags.visibility || '').toLowerCase();
  if (!repo || (vis !== 'public' && vis !== 'private')) {
    console.error('用法: git-sluice set-visibility <repo> --visibility public|private');
    return 1;
  }
  // 用 local remote 反推 owner/repo（与插件 git_set_visibility 同一路径）
  const pr = await resolveRepoOwnerName(repo);
  if (!pr.ok) { console.error(`❌ ${pr.error}`); return 1; }
  const r = await setVisibility({ owner: pr.owner, repo: pr.name, visibility: vis });
  if (flags.json) { console.log(JSON.stringify({ ...r, owner: pr.owner, repo: pr.name }, null, 2)); return r.ok ? 0 : 1; }
  if (!r.ok) { console.error(failOf(r)); return 1; }
  console.log(`✅ ${pr.owner}/${pr.name} 可见性已切换为 ${vis}`);
  return 0;
}

/** 子命令：gen-ssh-key — 生成 SSH 密钥对（公钥回传，私钥不出本机）。 */
export async function cmdGenSshKey(flags) {
  const email = flags.email || '';
  if (!email) { console.error('缺少 --email <x@y.z>（用法: git-sluice gen-ssh-key --email you@example.com [--force]）'); return 1; }
  const r = await generateSshKey(email, { force: flags.force === true });
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1; }
  if (!r.ok) { console.error(failOf(r)); return 1; }
  console.log(`✅ SSH 密钥已生成（${email}）`);
  if (r.pubPath) console.log(`   公钥文件：${r.pubPath}`);
  if (r.privPath) console.log(`   私钥文件：${r.privPath}（权限 0600，不上传）`);
  if (r.pub) console.log(`\n公钥（整行复制到 GitHub → Settings → SSH keys）：\n${r.pub}`);
  return 0;
}

/** 从本地 remote 反推 owner/repo（set-visibility 用）。 */
async function resolveRepoOwnerName(repoPath) {
  let url = '';
  try {
    url = execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  } catch { return { ok: false, error: `读不到 origin：${repoPath}` }; }
  const pr = parseGithubOwnerRepo(url);
  if (!pr) return { ok: false, error: `无法从 origin 解析 owner/repo：${url}` };
  return { ok: true, owner: pr.owner, name: pr.repo };
}
