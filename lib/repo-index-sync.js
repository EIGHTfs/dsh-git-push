/**
 * dsh-git-push — dsh-repo-index.json 自动维护（v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * v1.27.0：dsh-repo-index 改为 JSON；v1.40.0：唯一目标 = 插件配置目录 credentialsDir()/dsh-repo-index.json。
 * 推送成功后由 commitWithAudit 调用，重建索引并落盘。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { credentialsDir, getDefaultGithubOwner, resolveValidGitToken } from './core.js';
import { parseManualVisibility, buildRepoIndex, syncRepoIndex } from './repo-index.js';

/** 创建 maintainRepoIndex：扫描仓库生成 JSON 索引并写入插件配置目录。 */
export function createRepoIndexMaintainer(env) {
  const { log, workspaceRoot, depth, extraRepos, extraReposFile, repoIndexEnabled, repoIndexTokenPath, repoIndexSyncTarget, repoIndexLocalOnly } = env;
  /** v1.27.0：dsh-repo-index 改为 JSON；v1.40.0：唯一目标 = 插件配置目录 credentialsDir()/dsh-repo-index.json */
  return async function maintainRepoIndex() {
    if (!repoIndexEnabled) return { ok: false, skipped: 'repoIndexEnabled=false' };
    try {
      // owner 是变量：D7 可配置（config.githubOwner），默认 EIGHTfs（只入 JSON 字段，不再决定路径）
      const owner = getDefaultGithubOwner();
      // 手工可见性基线：从现有 JSON 解析，GitHub API 查不到时回退
      let existing = '';
      const defaultTarget = join(credentialsDir({ workspaceRoot }), 'dsh-repo-index.json');
      for (const p of [repoIndexSyncTarget || defaultTarget, defaultTarget]) {
        try { if (existsSync(p)) { existing = readFileSync(p, 'utf8'); break; } } catch { /* 跳过 */ }
      }
      const manualVisibility = parseManualVisibility(existing);
      // v1.36.1：可见性全「未知」修复——索引生成必须带 GitHub token。
      // 【原代码】只传可选的 repoIndexTokenPath 配置，未配置时 API 查询全部无 token → 回退「未知」。
      // 【改为】配置缺失时用 resolveGitToken 自动探测（v1.40.0：插件配置目录 token 等），保证能查到真实可见性。
      // v1.36.2：改用异步真校验版，跳过失效 token（双副本场景）
      const tokenInfo = await resolveValidGitToken({ workspaceRoot });
      const effectiveTokenPath = repoIndexTokenPath || tokenInfo?.source || '';
      const content = await buildRepoIndex({
        workspaceRoot, depth, extraRepos, extraReposFile,
        tokenPath: effectiveTokenPath,
        manualVisibility,
        localOnlyExtra: repoIndexLocalOnly,
        owner,
      });
      const res = syncRepoIndex({ content, owner, syncTarget: repoIndexSyncTarget });
      log.info(`dsh-repo-index.json 已更新: ${res.written.join(', ') || '无写入'}`);
      return { ok: true, ...res, target: res.written[0] || defaultTarget };
    } catch (error) {
      log.warn(`dsh-repo-index 维护失败: ${String(error?.message ?? error)}`);
      return { ok: false, error: String(error?.message ?? error) };
    }
  };
}
