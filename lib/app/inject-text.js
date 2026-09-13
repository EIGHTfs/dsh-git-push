/**
 * 插件入口层 · 注入文本
 *
 * buildRequirementsInjectionText（开发者要求清单注入，挂审计开关子开关）、
 *   formatAuditBlock（审计结果块）、README_CHECK_HINT（提交前 README 核对提醒）。
 * 这些是「写进系统提示词/工具返回」的文本，与业务逻辑分开便于单独校对措辞。
 */

import { join } from 'node:path';
import { loadRequirements } from '../git/index.js';

/** 提交前提醒（systemPrompt 注入段，对照旧版 dsh-git-push-readme-check）。 */
export const README_CHECK_HINT = [
  '【dsh-git-push 提交前提醒】每次调用 git_commit_push 前必须检查该仓库 README：',
  '功能表 / 版本记录 / 用法是否与本次改动一致。需要更新则先改 README 再提交。',
  '不要把过时 README 推进远端。',
].join('');

/**
 * 构造「开发者特殊要求」注入正文（systemPrompt 段，需开启提交前审计 + 本子开关）。
 *
 * 价值：清单常驻系统提示词，AI 一次读到即可持续遵守，不必走「提交被门禁拦截 →
 * 读拦截信息里的清单 → 带 requirementsConfirmed 重试」的失败往返（每次省一轮工具调用）。
 * 清单为空/未找到时返回空串（空段不注入）。
 *
 * @returns {string} 注入正文；无清单时返回空串
 */
export function buildRequirementsInjectionText() {
  const req = loadRequirements();
  if (!req.found || !req.items.length) return '';
  const L = [
    `【dsh-git-push 开发者要求（${req.user}）】调用 git_commit_push / git_remote_create 前逐条核对，全部达标才传 requirementsConfirmed: true：`,
  ];
  req.items.forEach((it, i) => L.push(`${i + 1}. ${it}`));
  L.push('（未核对即调用会被门禁拦截；清单可用插件配置目录的 requirements.json 外挂覆盖）');
  return L.join('\n');
}

/**
 * 审计结果格式化为可直接说给用户的总结块（对齐 git_account_check 的 block 模式）。
 * code_audit 返回时附带，AI 拿到后直接转述——不依赖 systemPrompt/pre-step 注入。
 * @param {object} r { scope, summary, quality, repo }
 * @returns {string} 多行可读文本
 */
export function formatAuditBlock(r = {}) {
  const q = r.quality || {};
  const s = r.summary || {};
  const L = [];
  L.push(`【dsh-git-push 审计】${r.repo || ''}（${r.scope === 'full' ? '全量' : '变动'}扫描）`);
  L.push(`评分 ${q.score ?? '?'}/${q.level ?? '?'}（满分 100）`);
  L.push(`问题 ${s.blocker ?? 0} 拦截 / ${s.warning ?? 0} 警告 / ${s.notice ?? 0} 提示（共 ${s.total ?? 0} 条）`);
  // 维度短板 TOP3（分最低的三个维度，用户最关心扣分来源）
  const dims = q.dims || {};
  const weak = Object.entries(dims).sort((a, b) => a[1] - b[1]).slice(0, 3);
  if (weak.length) {
    const parts = weak.map(([d, v]) => `${d} ${(Number(v) || 0).toFixed(1)}`).join(' / ');
    L.push(`短板维度：${parts}`);
  }
  if ((s.blocker || 0) > 0) L.push('存在拦截级问题，建议先修复 blocker 再提交/推送。');
  return L.join('\n');
}
