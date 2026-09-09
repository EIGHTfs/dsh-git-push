/**
 * dsh-git-push — git 核心逻辑（纯函数，可独立单测，不依赖 ctx）
 *
 * 2026-09-02：GitHub 网络操作默认走 api.github.com（Git Data API / REST）。
 * 禁止 git clone/push/fetch 直连 github.com、raw.githubusercontent.com、
 * codeload.github.com。v1.18.3：token 无效（401 Bad credentials）时允许回退
 * ssh.github.com:443（本机 github.com:443 不通，SSH over 443 通）。
 * 「token无效应该能用其他方法啊」；顺序确认：先改插件回退 SSH。
 *
 * 【原代码】依赖系统 git：认证默认 HTTPS+PAT；remote 格式
 * https://<user>:<token>@github.com/<owner>/<repo>.git；SSH remote 仍兼容。
 * 关键坑（来自 git-commits-viewer 实测）：
 *   1. 每次命令带 `-c safe.directory=<cwd>`（CIFS 只读卷 doubtful ownership）
 *   2. stdio 用 pipe/ignore，防止 git 报错刷屏
 *   3. 本地分支可能是 master 而非 main —— push 前取 branch --show-current，不硬编码
 *   4. push 前 fetch + rev-list 检查 ahead/behind，远端领先时不推
 *   5. CIFS/trimafs 上可执行位不可靠：git 会把 100644↔100755 当成变更。
 *      「新功能gitpush插件会git config --global core.filemode false」
 *      AI 思路：启动时写全局；每次 git 再带 `-c core.filemode=false`（无 HOME 写权限时仍生效）。
 *
 * v1.42.0（D1 文件级拆分）：按功能拆为 git-core / github-api / repo-scan / ignore-scan /
 * commit-push / token-credentials / workspace-context / version-history / readme-gen /
 * remote-repo / plugin-paths 共 11 个模块；本文件保留为兼容门面，re-export 全部原导出，
 * 导出面与拆分前完全一致，行为零变化。
 */
export { gitCFlags, ensureGlobalFilemodeFalse, ensureGlobalSafeDirectoryStar, runGit } from './git-core.js';
export { GH_API, README_CHECK_HINT, buildReadmeCheckHint, httpsUrlOf, apiOriginOf, sshOriginOf, isBadCredentials, pushViaSsh, parseGithubOwnerRepo, githubFetch, detectRepoVisibility, setRepoVisibility, autoTagDSHProject, pushViaApi, ensureAuxSshRemote, extractRemoteHeads, formatRemoteHeadsTable, fetchRemoteHeads, ownerFromRemote } from './github-api.js';
export { readPkgVersion, findGitDirs, readRepoStatus, readExtraReposFile, scanRepos, parseDiff, getDiff, isBinaryOrLarge } from './repo-scan.js';
export { ensureNpmIgnored, ensureCustomIgnored, SENSITIVE_EXEMPT_MARKER, hasLineExempt, hasFileHeaderExempt, SIZE_EXEMPT_MARKER, sizeExempt, FUNC_LENGTH_EXEMPT_MARKER, funcLengthExempt, SYNTAX_EXEMPT_MARKER, syntaxExempt, QUALITY_EXEMPT_MARKER, qualityExempt, RESIDUE_EXEMPT_MARKER, residueExempt, STYLE_EXEMPT_MARKER, styleExempt, scanSensitiveFiles, ensureSensitiveIgnored } from './ignore-scan.js';
export { commitAndPush, commitMany } from './commit-push.js';
export { persistGithubToken, persistSshPub, githubTokenStatus, generateSshKey, probeSshGithubAuth, checkGithubAccount, formatGithubAccountBlock, resolveGitToken, resolveValidGitToken, credentialsDir, resolveSshKey, maskRemoteUrl, DEFAULT_GITHUB_OWNER, setDefaultGithubOwner, getDefaultGithubOwner, probeTokenValid, clearTokenValidCache } from './token-credentials.js';
export { collectRepoSkillDocs, collectRepoSkillDirs, FUNCTION_MANUAL_COMPACT, collectFunctionManual, formatRepoSkillDirsInjection, formatRepoSkillInjection, resolveSkillRepoDirs, loadRequirements } from './workspace-context.js';
export { parseVersion, listVersionCommits, rebuildCoverageGuard, previewRebuildHistory, rebuildHistory } from './version-history.js';
export { DEFAULT_README_TEMPLATE, resolveReadmeTemplate, genReadme } from './readme-gen.js';
export { ensureRemoteRepo, cloneViaApi } from './remote-repo.js';
export { PLUGIN_ROOT } from './plugin-paths.js';
export { readdirSync } from 'node:fs';
