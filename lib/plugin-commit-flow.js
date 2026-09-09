/**
 * dsh-git-push — 提交流程编排（v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * previewReadme：提交前 README 预览（md 直渲 → 文本渲染 → 纯文本三级回退）。
 * commitWithAudit：带审计门禁的一键提交推送；推送成功后自动维护 dsh-repo-index。
 */
import { statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitAndPush } from './core.js';

/** 本实例 HTTP 基地址（image-preview 同实例调用）。 */
function selfHost() {
  const port = process.env.DSH_PORT || process.env.TEST_DSH_PORT || 3081;
  return `http://127.0.0.1:${port}`;
}

/**
 * 提交前 README 预览（2026-08-20）：把仓库 README 发到会话，逐级回退——
 *   1. 插件直接渲染 md（image-preview render md=true，README 直渲成图）
 *   2. 图（image-preview render 文本模式）
 *   3. 纯文本（返回 README 内容，由调用方展示）
 * 返回 { mode, content?, imageUrl?, file?, error? }——mode ∈ md-image|text-image|text|none
 */
async function previewReadme(repoPath) {
  const candidates = ['README.md', 'README.MD', 'Readme.md', 'readme.md'];
  let readmePath = null;
  for (const name of candidates) {
    const p = join(repoPath, name);
    try { if (statSync(p).isFile()) { readmePath = p; break; } } catch { /* 不存在 */ }
  }
  if (!readmePath) return { mode: 'none', error: '仓库无 README' };
  let text = '';
  try { text = readFileSync(readmePath, 'utf8').slice(0, 20000); } catch (e) { return { mode: 'none', error: `读 README 失败: ${e.message}` }; }
  if (!text.trim()) return { mode: 'none', error: 'README 为空' };

  // 三级回退：md 直渲 → 图 → 文本
  // 1) image-preview render（md=true 直渲；不可用时降级纯文本渲染）
  try {
    const base = selfHost(); // 本实例地址
    const renderRes = await fetch(`${base}/api/image-preview/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, title: 'README 预览（提交前）', md: true, absUrl: true, outPath: `gitpush-readme-${Date.now()}.png` }),
      signal: AbortSignal.timeout(15000),
    });
    if (renderRes.ok) {
      const data = await renderRes.json();
      if (data?.ok && data.absUrl) return { mode: 'md-image', imageUrl: data.absUrl, file: data.file };
    }
    // 2) 纯文本渲染（md 直渲失败则用普通文本渲染）
    const renderRes2 = await fetch(`${base}/api/image-preview/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 8000), title: 'README 预览（提交前）', md: false, absUrl: true, outPath: `gitpush-readme-${Date.now()}.png` }),
      signal: AbortSignal.timeout(15000),
    });
    if (renderRes2.ok) {
      const data = await renderRes2.json();
      if (data?.ok && data.absUrl) return { mode: 'text-image', imageUrl: data.absUrl, file: data.file };
    }
  } catch { /* image-preview 不可用，降级文本 */ }
  // 3) 纯文本
  return { mode: 'text', content: text.slice(0, 4000) };
}

/** 审计通过结果的展开映射（findings/summary/visibility/llm 等可选字段原样带出）。 */
function formatAuditOk(auditResult) {
  return { ok: true, audited: true, blocked: false, findings: auditResult.findings, summary: auditResult.summary, ...(auditResult.visibility ? { visibility: auditResult.visibility } : {}), ...(auditResult.userRepoAutoFixed ? { userRepoAutoFixed: true } : {}), ...(auditResult.visibilityRisk ? { visibilityRisk: auditResult.visibilityRisk } : {}), ...(auditResult.llmError ? { llmError: auditResult.llmError } : {}), ...(auditResult.llmRoute ? { llmRoute: auditResult.llmRoute } : {}) };
}

/** 单次 commitAndPush + 推送成功后维护 dsh-repo-index。 */
async function commitAndPushWithIndex({ repoPath, message, push, dryRun, requirementsConfirmed, workspaceRoot, customIgnorePatterns, maintainRepoIndex }) {
  const result = await commitAndPush({ repoPath, message, push, dryRun, requirementsConfirmed, workspaceRoot, customIgnorePatterns });
  if (result.ok && result.push?.pushed) result.repoIndex = await maintainRepoIndex();
  return result;
}

/** 带审计门禁的提交推送主体。deps 传引用：auditRepoPath/maintainRepoIndex 为服务实例；env 字段值由调用方注入。
 * 注：customIgnorePatterns 参数语义与拆分前一致——调用方显式传入（工具/HTTP/自动推送均传 env 值），参数名遮蔽外层。 */
async function runCommitWithAudit(opts, deps) {
  const { repo, message, push, dryRun, audit, llmAudit: llm, showReadme = true, requirementsConfirmed = false, customIgnorePatterns = '' } = opts;
  const { workspaceRoot, auditEnabled, blockOn, auditRepoPath, maintainRepoIndex } = deps;
  // 2026-08-20：提交前 README 预览（默认开，showReadme=false 可关）——把仓库 README 发到会话
  let readmePreview = null;
  if (showReadme && !dryRun) {
    try { readmePreview = await previewReadme(repo); } catch (e) { readmePreview = { mode: 'none', error: String(e?.message ?? e) }; }
  }
  const wantAudit = audit !== false && auditEnabled;
  if (wantAudit) {
    const auditResult = await auditRepoPath(repo, { forceLlm: !!llm });
    if (auditResult.blocked && !dryRun) {
      return { ok: false, blocked: true, error: `审计未通过，拦截提交（${auditResult.summary.total} 个问题，blockOn=${blockOn}）`, findings: auditResult.findings, summary: auditResult.summary, ...(readmePreview ? { readmePreview } : {}) };
    }
    const result = await commitAndPushWithIndex({ repoPath: repo, message, push: push !== false, dryRun: !!dryRun, requirementsConfirmed, workspaceRoot, customIgnorePatterns, maintainRepoIndex });
    return { ...result, audit: formatAuditOk(auditResult), ...(readmePreview ? { readmePreview } : {}) };
  }
  const result = await commitAndPushWithIndex({ repoPath: repo, message, push: push !== false, dryRun: !!dryRun, requirementsConfirmed, workspaceRoot, customIgnorePatterns, maintainRepoIndex });
  return { ...result, audit: { ok: true, audited: false, note: '审计已关闭或 dryRun' }, ...(readmePreview ? { readmePreview } : {}) };
}

/** 创建提交流程：返回 { selfHost, previewReadme, commitWithAudit }。 */
export function createCommitFlow(env, { auditRepoPath, maintainRepoIndex }) {
  const { workspaceRoot, auditEnabled, blockOn } = env;
  const deps = { workspaceRoot, auditEnabled, blockOn, auditRepoPath, maintainRepoIndex };
  return {
    selfHost,
    previewReadme,
    commitWithAudit: (opts) => runCommitWithAudit(opts, deps),
  };
}