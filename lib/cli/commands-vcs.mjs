/**
 * CLI 命令 · VCS 域（仓库扫描/索引/git 透传/提交/链接/克隆）（2026-10-05 从 cli.mjs 抽出）
 *
 * 为什么拆出来：cli.mjs 578 行代码超单文件阈值（400），本组 6 个命令是独立的
 *   「版本控制操作」域（repos/index/git/commit/link-check/clone），与审计/文档/账号域
 *   无共享状态（仅依赖 cliPluginConfig 读插件配置）。
 *
 * 保持薄引用：命令只做「传参 + 格式化输出」，逻辑在 lib/git/* 与 lib/commit-push.js
 * （与插件工具同源）。
 */

import { scanRepos } from '../git/repos.js';
import { updateRepoIndex } from '../git/repo-index.js';
import { runWrappedGit } from '../git/wrapped-git.js';
import { commitWithAudit } from '../commit-push.js';
import { checkLinks, sumLinkPenalty } from '../link-check/index.js';
import { collectTextFiles, readText } from '../audit/collector.js';
import { cloneViaApi, previewClone } from '../git/clone.js';
import { DEFAULT_MAX_FILE_MB } from '../git/clone-download.js';
import { resolveToken } from '../git/credentials.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { cliPluginConfig } from './commands-audit.mjs';

/** git-sluice repos 子命令默认列出上限。 */
const REPOS_DEFAULT_MAX = 200;
/** --json 输出截断长度（防大对象刷屏）。 */
const JSON_PRINT_SNIPPET = 2000;
/** cmdIndex 默认下钻深度。 */
const INDEX_DEPTH_DEFAULT = 20;

/** 路径是否存在（异步，避免在 async 命令里做同步 I/O）。 */
async function pathExists(p) {
  try { await access(p); return true; } catch { return false; }
}

/** 子命令：repos — 扫描本地 git 仓库（尊重 .gitignore）。 */
export function cmdRepos(root, flags) {
  const depth = flags.depth ?? 10;
  const max = flags.max ?? REPOS_DEFAULT_MAX;
  const list = scanRepos(root || '.', { depth, maxRepos: max });
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, root, count: list.length, repos: list }, null, 2));
    return;
  }
  console.log(`扫描 ${root || '.'}（depth=${depth}, max=${max}）→ ${list.length} 个仓库：`);
  for (const r of list) {
    const br = r.branch ? ` [${r.branch}]` : '';
    const remote = r.remote ? ` ← ${r.remote}` : ' （无远端）';
    const dirty = r.changed ? ` · 未提交 ${r.changed}` : '';
    console.log(`  ${r.name}${br}${dirty}${remote}`);
    console.log(`    ${r.path}`);
  }
  console.log(`（被 .gitignore 忽略的目录已整棵跳过，不当独立仓库）`);
}

/** 子命令：index — 重建仓库索引 dsh-repo-index.json。 */
export async function cmdIndex(root, flags) {
  const depth = flags.depth ?? INDEX_DEPTH_DEFAULT;
  const max = flags.max ?? REPOS_DEFAULT_MAX;
  const owner = flags.owner || 'EIGHTfs';
  // 2026-09-20：统一走 updateRepoIndex（mode='rebuild' 读-改-写合并不全量覆盖）
  const r = await updateRepoIndex({
    workspaceRoot: root || '.',
    owner,
    depth,
    maxRepos: max,
    offline: flags.offline === true, // --offline=纯离线（不查 GitHub API）
    mode: 'rebuild',
  });
  if (flags.json) { console.log(JSON.stringify({ ...r, root, owner, offline: !!flags.offline }, null, 2)); return r.ok ? 0 : 1; }
  if (!r.ok) { console.error(`❌ 索引重建失败: ${r.error || ''}`); return 1; }
  console.log(`✅ 索引已更新：${r.target || ''}（新增/更新 ${r.updated ?? 0} 条，indexUpdated=${r.indexUpdated === true}）`);
  console.log(`   扫描根 ${root || '.'}（owner=${owner}, depth=${depth}, max=${max}${flags.offline ? ', offline' : ''}）`);
  return 0;
}

/** 子命令：git <args> —— 浅包装 git（自动注入插件凭据：SSH 私钥 / HTTPS token），参数与 git 完全一致（1.9.0）。 */
export async function cmdGit(args = []) {
  if (!args.length || ['-h', '--help', 'help', '--version'].includes(args[0])) {
    console.log('用法: git-sluice git <git 参数>   例: git-sluice git pull / git clone owner/repo / git fetch --all');
    console.log('凭据自动注入（插件 SSH 私钥 / config.json token），无需传 token 参数；退出码与 git 一致。');
    return 0;
  }
  const r = runWrappedGit(args);
  return r.ok ? 0 : (typeof r.status === 'number' ? r.status : 1);
}

/** 子命令：commit — 审计门禁 → 提交（默认只 commit 不 push；--push 推远端；--force 强推）。 */
export async function cmdCommit(root, flags) {
  const repo = root || '';
  if (!repo || !(await pathExists(join(repo, '.git')))) { console.error(`不是 git 仓库: ${repo || '(空)'}`); return 1; }
  if (!String(flags.message || '').trim()) { console.error('缺少 -m <commit message>'); return 1; }
  // 推送门禁开关取插件配置（config.json pushGate，与侧边栏同一真源）；CLI 未确认时会被拦截
  const cfg = cliPluginConfig();
  // 审计门禁：blocker 拦截（v2 审计独立调用——与 DSH 工具 git_commit_push 同一实现 commitWithAudit）
  const commitOutcome = await commitWithAudit({
    repoPath: repo,
    message: flags.message,
    push: flags.push === true,
    dryRun: flags.dryRun === true,
    requirementsConfirmed: flags.reqConfirm === true,
    force: flags.force === true,
    // 2026-09-17：推送门禁（设置侧边栏开关）——CLI 对应 --push-gate-confirmed（用户已确认）
    pushGate: cfg.pushGate === true,
    pushConfirmed: flags.pushGateConfirmed === true,
    // 2026-09-21：精确 add 路径（逗号分隔，相对 repo）；空 = git add -A
    paths: String(flags.paths || ''),
  });
  if (commitOutcome.blocked) {
    console.error(`审计拦截（${commitOutcome.error || 'blocker'}），提交中止：`);
    if (commitOutcome.audit) console.error(`  summary: ${JSON.stringify(commitOutcome.audit.summary)}`);
    return 2;
  }
  if (flags.json) console.log(JSON.stringify(commitOutcome, null, 2));
  else {
    if (!commitOutcome.ok && commitOutcome.error) console.error(`提交失败: ${typeof commitOutcome.error === 'string' ? commitOutcome.error : JSON.stringify(commitOutcome.error)}`);
    console.log(JSON.stringify(commitOutcome, null, 2).slice(0, JSON_PRINT_SNIPPET));
  }
  return commitOutcome.ok ? 0 : 2;
}

/** 子命令：link-check — 检查文本文件的链接有效性（只 warning，不拦提交）。 */
export async function cmdLinkCheck(root = '.') {
  const files = (await collectTextFiles(root, { depth: 5 })).filter((f) => /\.(md|markdown|txt)$/i.test(f.path));
  const all = [];
  for (const f of files) {
    const findings = await checkLinks({ file: f.path, text: readText(f.full) });
    if (findings.length) all.push(...findings);
  }
  console.log(`链接检查 ${root}（${files.length} 个文档）`);
  for (const x of all) console.log(`  ${x.file}:${x.line} [${x.linkLevel}${x.flaky ? '/flaky' : ''}] ${x.message}`);
  console.log(`共 ${all.length} 个问题，扣分合计 ${sumLinkPenalty(all)}（只 warning，不拦提交）`);
}

/** clone --preview 预演下载清单（不写盘）。2026-09-23 拆分自 cmdClone（降圈复杂度）。 */
async function runClonePreview(target, flags) {
  // previewClone 不自己解析 token（内部无 resolveToken），私有仓不传就是 404
  const tk = flags.token || resolveToken({ tokenPath: process.env.DSH_GIT_PUSH_TOKEN ? undefined : '', repoPath: '' }).token;
  const pr = await previewClone({ target, token: tk, branch: flags.branch || '' });
  if (flags.json) { console.log(JSON.stringify(pr, null, 2)); return pr.ok ? 0 : 1; }
  if (!pr.ok) { console.error(`❌ 预演失败: ${pr.error || ''}`); return 1; }
  console.log(`预演 ${target}（分支 ${pr.branch || '(默认)'}）`);
  // 字段名以 previewClone 实际返回为准：totalFiles/downloadCount/downloadBytes/skipped
  console.log(`  共 ${pr.totalFiles ?? 0} 个文件，将下载 ${pr.downloadCount ?? 0} 个`
    + `（${((pr.downloadBytes || 0) / 1048576).toFixed(1)} MB）`);
  if (pr.skipped?.length) console.log(`  ⚠️ 超限跳过 ${pr.skipped.length} 个（> ${flags.maxFileMB ?? DEFAULT_MAX_FILE_MB} MB）`);
  if (pr.empty) console.log('  ⚠️ 全部文件均超限，无内容可下载');
  return 0;
}

/** clone 结果输出（成功/失败/跳过清单）。2026-09-23 拆分自 cmdClone（降圈复杂度）。 */
function printCloneResult(r, flags, target, dest) {
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return r.ok ? 0 : 1; }
  if (!r.ok) {
    console.error(`\n❌ 克隆未完成：${r.error || ''}`);
    if (r.notFound) console.error('  目标仓库不存在或无权限（检查 owner/repo 拼写与 token）');
    return 1;
  }
  console.log(`✅ 克隆完成：${target} → ${dest}`);
  if (r.totalFiles != null) console.log(`   文件 ${r.totalFiles} 个（${((r.totalBytes || 0) / 1048576).toFixed(1)} MB）`);
  if (Array.isArray(r.skipped) && r.skipped.length) console.log(`   ⚠️ 超限跳过 ${r.skipped.length} 个（> ${flags.maxFileMB ?? DEFAULT_MAX_FILE_MB} MB）`);
  if (r.warnings?.length) for (const w of r.warnings) console.log(`   ⚠️ ${w}`);
  return 0;
}

/** 子命令：clone — 从 GitHub 克隆仓库（Git Data API 通道，不直连 github.com）。 */
export async function cmdClone(flags, positional) {
  const target = String(positional[0] || '').trim();
  if (!target) { console.error('缺少 <owner/repo>（用法: git-sluice clone <owner/repo> [--dest <dir>] [--branch <b>]）'); return 1; }
  const dest = flags.dest ? String(flags.dest) : '';
  if (flags.preview === true) return runClonePreview(target, flags);
  const r = await cloneViaApi({ target, dest, branch: flags.branch || '', maxFileMB: flags.maxFileMB ?? DEFAULT_MAX_FILE_MB, concurrency: flags.concurrency });
  return printCloneResult(r, flags, target, dest);
}
