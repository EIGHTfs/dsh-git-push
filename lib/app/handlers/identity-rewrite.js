/**
 * 工具/CLI 处理层 · git_identity_rewrite（提交身份历史改写）
 *
 * 三条面（工具 / CLI / 后续 HTTP）共用同一份实现：真正的识别→改写→自检→安全强推在
 *   lib/git/identity-rewrite.js，本文件只做参数归一化 + 「只处理本人远端仓库」的过滤 + 报告文本。
 *
 * 默认 dryRun（只报告，不写任何东西）；要真改写必须显式 dryRun:false 或 write:true；
 *   push 再叠加一层（默认 false，改写自检通过后才 force-with-lease 推）。
 */
import { runGit } from '../../git/exec.js';
import { scanRepos } from '../../git/repos.js';
import { readAccountStatus, refreshAccountStatus } from '../../git/account-status.js';
import { resolveCommitIdentity } from '../../git/identity.js';
import { buildWrappedGitEnv } from '../../git/wrapped-git.js';
import { formatIdentityRewriteReport, parseGithubRepo, rewriteIdentities, wrongIdentityEmails } from '../../git/identity-rewrite.js';
import { getDefaultScanRoot } from '../scan-root.js';

/** 布尔归一化（工具层可能传 true/false 字符串；CLI 传 --write/--push）。 */
function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

/**
 * @param {object} args `{ paths?, root?, dryRun?, write?, push?, extraEmails? }`
 * @param {object} env 运行环境 `{ workspaceRoot, extraRepos?, extraReposFile? }`
 * @param {object} cfg 插件配置
 */
export async function callIdentityRewrite(args = {}, env = {}, cfg = {}) {
  const workspaceRoot = env.workspaceRoot || '';
  let st = readAccountStatus({ workspaceRoot });
  // 老快照可能没存数字 id（拼 noreply 邮箱要用 `<id>+<login>@…`）：刷一次账号状态补齐（约 1~4s，一次性）。
  if (st?.token?.valid && !st.token.id) {
    try { await refreshAccountStatus({ workspaceRoot }); } catch { /* 刷新失败就用现有信息，下面按 id 缺失处理 */ }
    st = readAccountStatus({ workspaceRoot });
  }
  const account = st?.token?.valid
    ? { login: st.token.login || st.username || '', id: st.token.id || '' }
    : null;
  if (!account?.login) {
    return {
      ok: false,
      error: '账号未登录/未探测到：先跑 git_account_check（需要登录账号作为规范身份，改写才有依据）',
    };
  }
  const canonical = resolveCommitIdentity({ account });
  const extra = String(args.extraEmails || cfg?.identityRewrite?.extraEmails || '')
    .split(/[,\s]+/).filter(Boolean);
  const wrongEmails = wrongIdentityEmails({ account, extra });
  // 默认预演：dryRun 未显式给 false、且没开 write 时，一律只报告
  const dryRun = !(args.dryRun === false || args.dryRun === 'false' || bool(args.write));
  const push = bool(args.push);

  let paths = String(args.paths || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!paths.length) {
    const root = args.root || getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
    paths = scanRepos(root, {
      extraRepos: env.extraRepos || [],
      extraReposFile: env.extraReposFile || '',
    }).map((r) => r.path).filter(Boolean);
  }

  // 只处理 origin 属于登录账号的仓库（别人的仓库一个都不碰）；其余如实报告跳过原因
  const mine = [];
  const notMine = [];
  for (const p of paths) {
    const url = String((runGit(['remote', 'get-url', 'origin'], { cwd: p }) || {}).stdout || '').trim();
    const g = parseGithubRepo(url);
    if (g && g.owner.toLowerCase() === account.login.toLowerCase()) mine.push(p);
    else notMine.push({ repo: p, reason: url ? `origin 不属于 ${account.login}` : '无 origin 远端' });
  }

  const summary = rewriteIdentities(mine, {
    runGit,
    canonical: { name: canonical.name, email: canonical.email },
    wrongEmails,
    dryRun,
    push,
    credEnv: buildWrappedGitEnv({ workspaceRoot }),
  });
  const text = formatIdentityRewriteReport(summary)
    + (notMine.length
      ? `\n跳过非本人远端仓库 ${notMine.length} 个：${notMine.map((x) => `${x.repo.split('/').pop()}（${x.reason}）`).join('、')}`
      : '');
  return {
    ok: true,
    dryRun,
    canonical: { name: canonical.name, email: canonical.email, source: canonical.source },
    wrongEmails,
    totals: summary.totals,
    repos: summary.repos,
    skippedNotMine: notMine,
    text,
  };
}
