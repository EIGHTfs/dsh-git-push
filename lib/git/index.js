/**
 * Git 操作层 · 统一出口
 *
 * 分层位置：本目录是「执行层」——真正调 git / GitHub API / 读写凭据的地方。
 *   审计与评分在 lib/audit/ · lib/score/，规则在 lib/audit-rules/，本目录不管审计。
 *
 * 模块划分（按「对外做什么」而非按类型）：
 *   exec.js         进程执行（runGit/gitRaw，含超时与错误规整）
 *   config.js       插件根目录定位与开发者要求清单读取
 *   credentials.js  凭据解析与落盘（token / SSH 公钥 / 密钥生成）
 *   api.js          GitHub REST 调用（含 owner/repo 解析、可见性探测）
 *   sensitive.js    提交前敏感信息扫描
 *   ignore.js       .gitignore 兜底与产物忽略
 *   transport.js    推送通道（SSH / API）/ 远端 head 查询 / blob 上传
 *   push.js         提交推送编排（commitAndPush 及推送后增强）
 *   clone.js        经 API 克隆
 *   remote.js       远端仓库的创建与可见性切换
 *   repos.js        仓库扫描与展示（脱敏）
 *   account.js      GitHub 账号校验与结果格式化
 *
 * 本文件只做再导出：调用方继续 `from './git/index.js'` 导入，路径稳定。
 */

export { runGit, gitRaw } from './exec.js';
export { PLUGIN_ROOT, loadRequirements } from './config.js';
export { credentialsDir, resolveSshKey, resolveToken, maskToken, readSshPub, persistGithubToken, persistSshPub, generateSshKey } from './credentials.js';
export { GH_API, githubFetch, parseGithubOwnerRepo, isBadCredentials, detectRepoVisibility } from './api.js';
export { scanSensitiveFiles } from './sensitive.js';
export { DEFAULT_IGNORE_PATTERNS, ensureGitignore } from './ignore.js';
export { fetchRemoteHeads, pushViaSsh, pushViaApi } from './transport.js';
export { readmeCheckHint, commitAndPush } from './push.js';
export { cloneViaApi } from './clone.js';
export { ensureRemoteRepo, setVisibility } from './remote.js';
export { scanRepos, maskRemoteUrl } from './repos.js';
export { checkGithubAccount, formatGithubAccountBlock } from './account.js';
