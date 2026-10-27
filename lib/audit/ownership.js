/**
 * 审计层 · 隐私规则的生效范围（按仓库归属）
 *
 * 为什么需要（2026-10-28 用户确立的口径）：
 *   隐私/凭据类规则（secret-email、credfile-*、credref-* …）的**目的**是防止**自己的仓库**
 *   把隐私推到远端。克隆来的第三方公开仓库里有什么邮箱/密钥，与你无关：报出来是纯粹噪声，
 *   而且常常成片出现（实测：克隆一个 Unity 项目直接 3 条 blocker，全是第三方 LICENSE 里的
 *   作者邮箱——版权文件含作者邮箱是法律要求，根本不是隐私泄漏）。
 *   故：**隐私类规则只在「自己的仓库」生效；别人的 git 仓库等同关闭。**
 *
 * 为什么这里只放纯函数（架构约束）：
 *   `lib/audit/**` 不得依赖 `lib/git/**`（边界门禁 test-audit-git-boundary.mjs：审计按独立包
 *   设计，要能脱离宿主使用）。而「取本机账号 + 读 remote」必然依赖 git 层 ⇒ 探测放在**装配层**
 *   `lib/app/repo-ownership.js`，结果以**字符串**经 opts 注入进来（依赖倒置）。
 *   本模块因此零 import、零副作用，可在任何环境下单测。
 *
 * 判据语义：'own'=自有（生效）｜'foreign'=他人（关闭）｜'unknown'=判不出（**照旧生效**——
 *   保守方向：宁可多报，不可漏掉自家隐私）。
 */

/**
 * 纯函数：由「本机 login」与「仓库 owner」判归属。
 * @param {string} login 本机 GitHub 登录名（空串 = 未知）
 * @param {string} owner 仓库 remote 解析出的 owner（空串 = 未知）
 * @returns {'own'|'foreign'|'unknown'}
 */
export function classifyOwnership(login = '', owner = '') {
  const me = String(login || '').trim().toLowerCase();
  const them = String(owner || '').trim().toLowerCase();
  if (!me || !them) return 'unknown';
  return them === me ? 'own' : 'foreign';
}

/**
 * 隐私/凭据类规则是否应在该仓库生效。
 * @param {'own'|'foreign'|'unknown'} [ownership] 归属（缺省/undefined 按 unknown 处理 ⇒ 生效）
 * @returns {boolean} true = 生效；false = 他人仓库，关闭
 */
export function privacyRulesEnabled(ownership) {
  return ownership !== 'foreign';
}

/** 规则 id 是否属隐私/凭据类（这类规则受归属限制）。 */
export function isPrivacyRule(ruleId) {
  return /^(secret-|credfile-|credref-)/.test(String(ruleId || ''));
}
