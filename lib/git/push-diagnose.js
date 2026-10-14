/**
 * Git 执行层 · 推送失败的**结构化诊断**（把「事实」与「推断」分开）。
 *
 * 为什么需要这个模块（实测缺陷）：
 *   推送失败时插件此前只返回一句自由文本 `reason`（例如
 *   `id_rsa: ERROR: Repository not found. fatal: Could not read from remote repository. Please make
 *    sure you have the correct access rights and the repository exists.`），
 *   读它的人（AI 或人都一样）只能**脑补** ✗ —— 实测就被脑补成「上游仓库不存在」，
 *   而这句话在 Git/GitHub 语义下**根本不足以支撑该结论**：
 *
 *   ⚠️ 关键事实：GitHub 对「仓库不存在」与「当前凭据没有访问权限」**故意返回同一句**
 *      `Repository not found.`（私有库不泄露存在性）⇒ 只能得出
 *      「**不存在 或 无权限，二者不可区分**」，**不能**断言「不存在」。
 *
 *   本模块把失败拆成三个层次，杜绝过度推断：
 *     · code        —— 机器可判的分类码（枚举，调用方可 switch）
 *     · fact        —— **原文证据**（远端/ git 到底说了什么，不做解释）
 *     · inference   —— 人话解释 + `confidence`（当分类本身有歧义时，明确写「不可区分」并降置信度）
 *     · nextSteps   —— 可执行的下一步（配 token / 校验公钥 / 核对仓库名或权限 …）
 *
 * 设计约束：
 *   · 纯函数、零 IO（可单测、可在任意通道复用）；
 *   · 规则按**真实样本**写（见 test/test-push-diagnose.mjs 的样本表），不凭想象加规则；
 *   · 分类器**只做归类**，不产生「不存在」这类否定性断言（由调用方按 code 措辞）。
 */

/** 失败分类码 → 人话解释（inference 的基底）。 */
export const PUSH_FAILURE_CODES = {
  'no-remote': '本地没有可用的 GitHub remote（或 remote 指向的仓库与目标不一致）',
  'auth-missing': '本机没有可用于该远端的凭据（没配 token / https 无凭据 / SSH 未启用密钥）',
  'auth-denied': '凭据存在但被远端拒绝（SSH 公钥未登记到该账号，或 token 无效/过期/无该仓库权限）',
  'repo-not-found-or-no-access': '远端拒绝了这次推送：仓库**不存在**，**或** 当前凭据**没有访问权限**'
    + '（GitHub 对两种情况返回同一句，二者不可区分 ⇒ 不能据此断定「仓库不存在」）',
  dns: '域名解析失败（DNS 或网关问题）',
  network: '网络不可达或超时（连接被拒 / 超时 / 路由不通）',
  'host-key': 'SSH 主机密钥校验失败（known_hosts 缺少该主机，或远端指纹变了）',
  diverged: '本地与远端已分叉（non-fast-forward）：远端有本地没有的提交',
  protected: '目标分支受保护或被远端策略拒绝',
  'rate-limited': '被远端限流（429 / rate limit）',
  'server-error': '远端服务端错误（5xx / RPC failed）',
  unknown: '未能归类（现有信息不足，需要完整 stderr 才能判断）',
};

/** 分类 → 下一步建议（可执行、少废话）。 */
const NEXT_STEPS = {
  'no-remote': ['用 git_remote_create 建/复用远端仓库并把 origin 指过去', '或手动 git remote add origin <ssh://git@ssh.github.com:443/<owner>/<repo>.git>'],
  'auth-missing': ['在插件「设置 → 凭据与密钥」配 GitHub token（或改用 SSH 形态 remote）', '调用 git_account_check 确认凭据可用'],
  'auth-denied': ['用 git_account_check 看当前账号与公钥指纹，确认这把公钥已登记到该账号', '确认 token 未过期且对该仓库有权限（私有库需授权）'],
  'repo-not-found-or-no-access': [
    '核对 owner/repo 拼写（本机可用 git remote -v 看实际地址）',
    '确认当前账号对该仓库有访问权限（私有库需要被授权）',
    '用 git_account_check 看登录账号是否是仓库所有者',
    '⚠️ 不要据这句话断定「仓库不存在」——它与「无权限」不可区分',
  ],
  dns: ['检查 DNS/网关：curl -I --connect-timeout 4 https://api.github.com'],
  network: ['测连通性：curl -I https://api.github.com 与 ssh -p 443 -T git@ssh.github.com'],
  'host-key': ['先手动验证主机：ssh -p 443 -T git@ssh.github.com（插件推送用临时 known_hosts）'],
  diverged: ['先 git fetch 并整合远端提交再推；确认要覆盖远端历史时再显式 force（谨慎）'],
  protected: ['确认分支保护规则（是否禁止直接推 main）', '或改推到特性分支再走 PR'],
  'rate-limited': ['稍后重试（限流窗口通常几分钟）'],
  'server-error': ['稍后重试；持续失败查 GitHub Status'],
  unknown: ['保留完整 stderr 人工判断；先确认到远端的连通性（api.github.com / ssh.github.com:443）'],
};

/** 分类码 → 置信度。带歧义的分类**必须**降级为 low（防过度推断）。 */
const CONFIDENCE = {
  'repo-not-found-or-no-access': 'low',
  unknown: 'low',
};

/** 规则表：命中即归类（顺序敏感：越具体的越靠前）。 */
const RULES = [
  // ① 无凭据（git/curl 拿不到用户名密码）——这是「事实」，不是「仓库不存在」
  ['auth-missing', /could not read Username|could not read Password|terminal prompts disabled|fatal: Authentication failed for 'https/i],
  // ② SSH 主机密钥
  ['host-key', /host key verification failed|remote host identification has changed|no matching host key/i],
  // ③ 凭据存在但被拒（公钥未登记 / token 无效）
  ['auth-denied', /permission denied \(publickey\)|publickey|invalid username or (password|token)|bad credentials|401 unauthorized/i],
  // ④ 仓库不存在**或**无权限（GitHub 同一句）——绝不断言「不存在」
  ['repo-not-found-or-no-access', /repository not found|repository .{0,40}not found|does not exist|not accessible|could not read from remote repository|remote: not found|403 forbidden/i],
  // ⑤ DNS / 网络
  ['dns', /could not resolve host|temporary failure in name resolution|getaddrinfo|name or service not known/i],
  ['network', /connection timed out|connection refused|network is unreachable|operation timed out|failed to connect|connection reset|no route to host/i],
  // ⑥ 分叉 / 保护分支 / 限流 / 服务端
  ['diverged', /non-fast-forward|fetch first|updates were rejected|远程仓库包含您本地尚不存在的提交/i],
  ['protected', /protected branch|gh006|refusing to allow|push declined due to repository rule/i],
  ['rate-limited', /\b429\b|rate limit|secondary rate/i],
  ['server-error', /internal server error|rpc failed|remote end hung up|\b50[0-9]\b|\b5\d\d\b/i],
];

/** 由 HTTP 状态码辅助归类（API 通道用；文本规则已含 401/403 时以文本优先）。 */
function byHttpStatus(status) {
  const s = Number(status);
  if (!Number.isFinite(s) || s < 400) return null;
  if (s === 401) return 'auth-denied';
  if (s === 403) return 'protected';
  if (s === 404) return 'repo-not-found-or-no-access';
  if (s === 429) return 'rate-limited';
  if (s >= 500) return 'server-error';
  return null;
}

/**
 * 归类推送失败。
 * @param {string} text 失败原文（git stderr / API message / 组合 reason）
 * @param {{httpStatus?:number, method?:string, noRemote?:boolean}} [opts]
 * @returns {{code:string, fact:string, inference:string, confidence:'high'|'low', nextSteps:string[]}}
 */
export function classifyPushFailure(text = '', opts = {}) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  let code = null;
  // 显式标记优先（调用方已知「没有可用 remote」，无需从文本猜）
  if (opts.noRemote === true) code = 'no-remote';
  if (!code) {
    for (const [c, re] of RULES) {
      if (re.test(raw)) { code = c; break; }
    }
  }
  if (!code && opts.httpStatus !== undefined && opts.httpStatus !== null) code = byHttpStatus(opts.httpStatus);
  if (!code) code = 'unknown';
  const confidence = CONFIDENCE[code] || 'high';
  return {
    code,
    fact: raw.slice(0, 400),
    inference: PUSH_FAILURE_CODES[code] || PUSH_FAILURE_CODES.unknown,
    confidence,
    nextSteps: NEXT_STEPS[code] || NEXT_STEPS.unknown,
  };
}

/**
 * 把诊断渲染成一行可读文本（工具回执 / 日志用）。
 * 措辞纪律：`fact` 在前（原文证据），`inference` 只作解释；带歧义的分类必须带「不可区分」提示。
 * @param {object} dg classifyPushFailure 的返回
 * @returns {string}
 */
export function describePushDiagnosis(dg = {}) {
  const code = dg.code || 'unknown';
  const conf = dg.confidence === 'low' ? '（推断，置信度低）' : '（依据充分）';
  const steps = Array.isArray(dg.nextSteps) && dg.nextSteps.length ? `｜下一步：${dg.nextSteps[0]}` : '';
  return `分类 ${code}${conf}：${dg.inference || ''}${steps}`;
}
