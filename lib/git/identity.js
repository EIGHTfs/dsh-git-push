/**
 * dsh-git-push — 提交身份（author/committer）解析
 *
 * 【为什么单独成文件】提交必须带身份，仓库没配时 git 直接以 "Author identity unknown" 拒提交。
 *   旧实现只兜底一个写死的 `DSH Agent <agent@dsh.local>`，从不问「正在登录的 GitHub 账号是谁」，
 *   也不告诉 AI 该用什么身份 —— 实测后果：本机 8 个仓库里混着 DSH Agent / eightfs@local /
 *   v2-clone@local / 小写 noreply 等多种身份（如 dsh-git-push 226 个提交里 21 个是 DSH Agent），
 *   AI 每次还得自己猜或手敲 -c user.name=…。
 *
 * 【解析优先级】（本文件是纯函数，可单测；落盘动作在 push.js 里做）
 *   ① 仓库已配 `user.name` + `user.email` → **原样尊重**（用户/项目的选择优先，插件不覆盖）
 *   ② 只差一部分或都没配 → 用**登录的 GitHub 账号**：name = login，
 *      email = `<id>+<login>@users.noreply.github.com`（GitHub 官方 noreply 形式：
 *      不暴露真实邮箱、提交能关联到账号；拿不到数字 id 时退化为 `<login>@users.noreply…`）
 *   ③ 账号不可用（未登录 / 离线 / 没探测过）→ 退化 `DSH Agent <agent@dsh.local>`（保证仍能提交）
 *
 * 【落地策略】账号身份会自动写进仓库**局部**配置（只改该仓库 .git/config、不入库、不动全局），
 *   于是 AI 手敲 git、插件提交、用户提交都带同一身份 —— 一次落盘，之后无需每次传 -c。
 */

/** 兜底身份：账号不可用时用（保持与历史默认一致，避免行为突变）。 */
export const FALLBACK_IDENTITY = { name: 'DSH Agent', email: 'agent@dsh.local' };

/** 身份来源的可读标签（给 AI/用户看的，判断身份是哪来的）。 */
export const IDENTITY_SOURCE_LABELS = {
  'repo-config': '仓库已有配置',
  'github-account': 'GitHub 登录账号',
  fallback: '兜底通用身份（账号不可用）',
};

/**
 * GitHub noreply 邮箱：`<id>+<login>@users.noreply.github.com`（无 id 时省略前缀）。
 * @param {string} login GitHub 登录名
 * @param {string|number} [id] 账号数字 id（/user 响应的 id）
 * @returns {string} 邮箱；login 为空时返回空串
 */
export function noreplyEmail(login, id) {
  const name = String(login || '').trim();
  if (!name) return '';
  const num = Number(id);
  return Number.isFinite(num) && num > 0
    ? `${num}+${name}@users.noreply.github.com`
    : `${name}@users.noreply.github.com`;
}

/**
 * 由 GitHub 账号状态得到提交身份（账号不可用时返回 null）。
 * @param {object} account 账号信息 `{ login?, username?, id? }`
 * @returns {{name:string, email:string, source:'github-account'}|null}
 */
export function identityFromAccount(account = {}) {
  const login = String(account?.login || account?.username || '').trim();
  if (!login) return null;
  return { name: login, email: noreplyEmail(login, account?.id), source: 'github-account' };
}

/**
 * 解析某仓库该用的提交身份（纯函数）。
 * @param {{configName?:string, configEmail?:string, account?:object}} [input]
 *   configName/configEmail：仓库 `git config user.name/user.email` 的当前值（可能为空）
 *   account：账号信息 `{ login, id }`
 * @returns {{name:string, email:string, source:string, complete:boolean, missing:{name:boolean, email:boolean}}}
 *   complete=true 表示 name/email 都已齐（可用仓库配置直接提交）；false 表示需在 commit 上补 -c
 */
export function resolveCommitIdentity({ configName = '', configEmail = '', account = null } = {}) {
  const name = String(configName || '').trim();
  const email = String(configEmail || '').trim();
  if (name && email) {
    return { name, email, source: 'repo-config', complete: true, missing: { name: false, email: false } };
  }
  const missing = { name: !name, email: !email };
  const fromAccount = identityFromAccount(account || {});
  if (fromAccount) {
    return {
      // 已配置的一侧优先保留（例如仓库只差 email：名字仍用仓库的）
      name: name || fromAccount.name,
      email: email || fromAccount.email,
      source: fromAccount.source,
      complete: false,
      missing,
      accountLogin: fromAccount.name,
    };
  }
  return {
    name: name || FALLBACK_IDENTITY.name,
    email: email || FALLBACK_IDENTITY.email,
    source: 'fallback',
    complete: false,
    missing,
  };
}

/** 人类/AI 可读的身份行：`EIGHTfs <38984640+EIGHTfs@users.noreply.github.com>`。 */
export function identityLabel(identity = {}) {
  const name = String(identity.name || '').trim();
  const email = String(identity.email || '').trim();
  return email ? `${name} <${email}>` : name;
}

/**
 * 给 AI 看的身份说明（一句话），明确「该用哪个身份、别自己编」。
 * @param {object} identity resolveCommitIdentity 的结果
 * @returns {string}
 */
export function identityHintText(identity = {}) {
  const label = identityLabel(identity);
  const src = IDENTITY_SOURCE_LABELS[identity.source] || identity.source || '未知';
  if (identity.source === 'repo-config') return `${label}（来源：${src}）`;
  if (identity.source === 'github-account') return `${label}（来源：${src}；未配身份的仓库由插件自动写入局部配置）`;
  return `${label}（来源：${src}——账号不可用时才用它，不要手写这个身份）`;
}

/**
 * 解析仓库该用的身份，并在未配时把账号身份写进仓库**局部**配置（`git config --local`）。
 *
 * 只在 `source === 'github-account'` 时落盘：仓库已配 → 一个字节都不动；
 * 账号不可用 → 只返回兜底身份、不写（避免把 DSH Agent 固化进仓库配置）。
 * git 执行器由参数注入，便于单测用临时仓库跑真实 git。
 *
 * @param {string} repoPath 仓库路径
 * @param {{runGit:Function, account?:object|null}} opts runGit(args,{cwd}) → {ok,stdout,stderr}
 * @returns {{name:string,email:string,source:string,complete:boolean,written:string[],label:string}}
 */
export function ensureRepoIdentity(repoPath, { runGit, account = null } = {}) {
  if (typeof runGit !== 'function') throw new TypeError('ensureRepoIdentity 需要注入 runGit');
  const readCfg = (key) => {
    const r = runGit(['config', key], { cwd: repoPath });
    return r && r.ok ? String(r.stdout || '').trim() : '';
  };
  const id = resolveCommitIdentity({
    configName: readCfg('user.name'),
    configEmail: readCfg('user.email'),
    account,
  });
  const written = [];
  if (id.source === 'github-account') {
    // 只补缺的那一侧（仓库已有的一半保持不动）
    if (id.missing.name) {
      const r = runGit(['config', '--local', 'user.name', id.name], { cwd: repoPath });
      if (r && r.ok) written.push(`user.name=${id.name}`);
    }
    if (id.missing.email) {
      const r = runGit(['config', '--local', 'user.email', id.email], { cwd: repoPath });
      if (r && r.ok) written.push(`user.email=${id.email}`);
    }
  }
  const stillMissing = (id.missing.name && !written.some((w) => w.startsWith('user.name=')))
    || (id.missing.email && !written.some((w) => w.startsWith('user.email=')));
  return { ...id, complete: !stillMissing, written, label: identityLabel(id) };
}
