// dsh-git-push — 远端可见性解析（统一收口）
//
// 抽出原因：同一职责（可见性判定）此前在
//   push.js 与 commit-push.js 各写一份，违反「同一职责单一入口」的设计，故抽成独立模块。
//
// 为什么独立成模块：可见性判定有**两个消费方**，此前各自实现（`resolveToken` +
//   `detectRepoVisibility` 两处复制）会造成口径漂移（token 来源、探测失败兜底不一致）：
//   ① `lib/git/push.js`     —— 私有库敏感文件豁免（private → 只扫描报告、不写 .gitignore）
//   ② `lib/commit-push.js`  —— 审计门禁豁免（private → 审计只报告不拦截）
//   统一走本入口后，两处拿到同一形状、同一兜底口径。
import { detectRepoVisibility } from './api.js';
import { resolveToken } from './credentials.js';

// 解析仓库远端可见性（统一收口）。
//
// 兜底口径：token 缺失 / 非 GitHub origin / API 失败 → 一律 `unknown`
//   （调用方对 unknown 按保守处理：push 不豁免、审计门禁仍拦截）。
// 边界：resolveToken 自身抛错也吞成「无 token」（探测失败不该中断调用方流程）。
//
// @param {string} repoPath 仓库绝对路径
// @param {string} [token] 显式 token（缺省按仓库解析：仓库 token 文件 → 插件配置）
// @returns {Promise<{visibility: 'private'|'public'|'unknown', owner?: string, repo?: string, reason?: string}>}
//   可见性结果；`unknown` 时带 `reason` 说明原因
export async function resolveRepoVisibility(repoPath, token = '') {
  let tok = token;
  if (!tok) {
    try { tok = resolveToken({ repoPath }).token; } catch { tok = ''; }
  }
  if (!tok) return { visibility: 'unknown', reason: '无可用 token' };
  try {
    return await detectRepoVisibility({ repoPath, token: tok });
  } catch (e) {
    return { visibility: 'unknown', reason: String((e && e.message) || e) };
  }
}
