/**
 * 插件入口层 · 注入文本
 *
 * FUNCTION_USAGE_HINT（插件功能用法注入——每个工具怎么用 + 凭据由插件托管，见 2026-09-13 需求：
 *   「注入系统提示词可以注入插件每个功能怎么用，发现好多不用插件还到处找凭据的」）、
 *   buildRequirementsInjectionText（开发者要求清单注入，挂审计开关子开关）、
 *   formatAuditBlock（审计结果块）、README_CHECK_HINT（提交前 README 核对提醒）。
 * 这些是「写进系统提示词/工具返回」的文本，与业务逻辑分开便于单独校对措辞。
 */

import { join } from 'node:path';
import { loadRequirements } from '../git/index.js';

/**
 * 插件功能用法注入（systemPrompt 段，order 990）。
 *
 * 目的（2026-09-13）：把「插件有哪些功能、每个怎么用、凭据谁管」常驻系统提示词，
 *   避免 AI 不知道插件能力而绕开插件、甚至满盘检索 token/密钥文件。
 *
 * 三段：①工具清单与用途 ②凭据由插件托管（明确「不要到处找凭据」）③调用纪律。
 * 纯静态文本，无 IO，同步返回。
 */
export const FUNCTION_USAGE_HINT = [
  '【dsh-git-push 功能用法】本插件的 git 操作请直接调用下列工具，不要手敲 git/curl 绕过（插件自带审计门禁、凭据管理、推送通道选择）：',
  '· git_scan —— 列工作区（含额外路径）所有 git 仓库：分支/remote/未提交与未推送数/最近活动。找「哪个仓库要提交」先用它。',
  '· git_commit_push —— 一键提交并推送（先审计→再 commit→再 push；审计同步拦截，通过后 commit+push 走宿主官方后台 job，立即返回 async:true + jobId，可继续干别的）。参数：repo=仓库绝对路径、message=提交信息（必填）、audit、dryRun、push、force、ignorePatterns；调用前逐条核对开发者特殊要求，达标才传 requirementsConfirmed=true。用宿主自带 job_output <jobId> 查结果（job_list/job_kill 同理）。',
  '· code_audit —— 审计仓库（L0 静态检查 + 质量评分）：语法/敏感信息/凭据/大文件/文档措辞；scope=full 全量；可传 ruleset 自定规则目录、weights 覆盖权重。',
  '· git_account_check —— 校验 GitHub 账号与凭据（token 在线校验 + SSH 公钥指纹），返回登录态/用户名/公钥数/套餐。想知道「现在能不能推、以谁的身份」，用它，不要自己去翻 token 文件。',
  '· git_gen_ssh_key —— 生成 SSH 密钥对（按邮箱，写入插件配置目录；公钥整行回传，私钥不出本机）。',
  '· git_remote_create —— 按项目文件夹在 GitHub 建远端仓库（已存在则复用），并把 origin 指向它。',
  '· git_set_visibility —— 切换仓库 public/private。',
  '· git_clone —— 从 GitHub clone 到本地（走 GitHub API，不直连 github.com）。',
  '· git_gen_readme —— 按模板生成/更新 README（writePath 指定写入路径）。',
  '· link_check —— 检查文档内链接有效性（只报 warning，不拦截）。',
  '【凭据由插件托管，不要到处找凭据】GitHub token 与 SSH 私钥存放在插件配置目录（git-push/ 下 github-token、id_rsa；0600 权限），由插件的推送/校验流程自动读取与选择通道（默认 SSH，token 401 回退 SSH）。',
  '需要判断登录态 → 调 git_account_check；需要推送 → 调 git_commit_push。不要遍历用户目录找 token、不要把凭据抄进命令行或文档、不要在回复里明文输出凭据。',
  '【调用纪律】提交类操作先 git_scan 确认目标仓库；提交前核对 README（功能表/版本记录/用法）；审计拦截 blocker 时先修复再提交；用户未要求推送时不要 push。',
].join('\n');

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
