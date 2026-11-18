# 函数列表

> 由 `scripts/doc-func.mjs` 维护：`gen` 打印 / `apply` 更新本节 / `check` 查漂移（扫描 lib/scripts/test 函数）。

<!-- dshgp-functions:start -->
## 函数列表

### lib/app/apply.js（303 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `apply` | 44-302 | 259 | `export async function apply(ctx, config = {}) {` |
| `envInjectText` | 110-149 | 40 | `const envInjectText = (cwdOverride) => {` |

### lib/app/command-registry.js（380 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `preprocessAvailable` | 12-16 | 5 | `function preprocessAvailable(cfg = {}, hasBuiltinEngine) {` |
| `resolveEntryParams` | 27-31 | 5 | `export function resolveEntryParams(entry, cfg, hasBuiltinEngine) {` |
| `applyFlagToken` | 318-334 | 17 | `function applyFlagToken(args, tok, rest, i, byFlag) {` |
| `validateParamConstraints` | 337-343 | 7 | `function validateParamConstraints(args, params) {` |
| `parseRegistryArgs` | 345-365 | 21 | `export function parseRegistryArgs(rest = [], params = []) {` |
| `registryByName` | 368-370 | 3 | `export function registryByName(name) {` |
| `registryByCli` | 373-375 | 3 | `export function registryByCli(cli) {` |
| `buildToolsListText` | 378-380 | 3 | `export function buildToolsListText() {` |

### lib/app/handlers/account.js（166 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `formatLastLoginAt` | 14-20 | 7 | `function formatLastLoginAt(iso) {` |
| `p` | 18-18 | 1 | `const p = (n) => String(n).padStart(2, '0');` |
| `readCredentialFlags` | 23-29 | 7 | `function readCredentialFlags(env) {` |
| `toCredStatus` | 32-40 | 9 | `function toCredStatus(st = {}) {` |
| `renderCredentialBlock` | 58-85 | 28 | `function renderCredentialBlock(snap, { fileHasToken, fileHasSsh }) {` |
| `quotaSuffix` | 61-65 | 5 | `const quotaSuffix = (() => {` |
| `handleAccountStatus` | 88-109 | 22 | `export function handleAccountStatus(ctx) {` |
| `handleApiQuota` | 119-146 | 28 | `export async function handleApiQuota(ctx) {` |
| `handleAccountCheck` | 149-158 | 10 | `export async function handleAccountCheck(ctx) {` |
| `handleGenSshKey` | 161-166 | 6 | `export function handleGenSshKey(ctx) {` |

### lib/app/handlers/clone.js（177 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseCloneRequest` | 23-31 | 9 | `function parseCloneRequest(body) {` |
| `busyResponse` | 38-53 | 16 | `function busyResponse(target, dest) {` |
| `handleRepoClone` | 56-126 | 71 | `export async function handleRepoClone(ctx) {` |
| `handleCloneLogs` | 129-133 | 5 | `export function handleCloneLogs(ctx) {` |
| `handleCloneAbort` | 136-139 | 4 | `export function handleCloneAbort() {` |
| `handleClonePreview` | 142-160 | 19 | `export async function handleClonePreview(ctx) {` |
| `handleCloneProgress` | 170-177 | 8 | `export function handleCloneProgress(ctx) {` |

### lib/app/handlers/identity-rewrite.js（95 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `bool` | 19-21 | 3 | `function bool(v) {` |
| `callIdentityRewrite` | 28-94 | 67 | `export async function callIdentityRewrite(args = {}, env = {}, cfg = {}) {` |

### lib/app/handlers/meta.js（79 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `currentCommitIdentity` | 23-37 | 15 | `function currentCommitIdentity() {` |
| `handleStatus` | 40-54 | 15 | `export function handleStatus(ctx) {` |
| `handleScan` | 57-60 | 4 | `export function handleScan(ctx) {` |
| `handleBrowse` | 63-67 | 5 | `export function handleBrowse(ctx) {` |
| `handleTools` | 70-73 | 4 | `export function handleTools(ctx = {}) {` |
| `handleToolProbes` | 76-78 | 3 | `export function handleToolProbes() {` |

### lib/app/handlers/npm.js（189 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `npmAccountState` | 18-45 | 28 | `function npmAccountState(ctx) {` |
| `handleNpmAccount` | 48-50 | 3 | `export function handleNpmAccount(ctx) {` |
| `handleNpmCheck` | 53-73 | 21 | `export function handleNpmCheck(ctx) {` |
| `handleNpmOwned` | 76-86 | 11 | `export async function handleNpmOwned(ctx) {` |
| `handleNpmPackages` | 92-116 | 25 | `export function handleNpmPackages(ctx) {` |
| `handleNpmInstall` | 122-146 | 25 | `export function handleNpmInstall(ctx) {` |
| `handleNpmInstallProgress` | 162-167 | 6 | `export function handleNpmInstallProgress(ctx) {` |
| `handleNpmPublish` | 169-188 | 20 | `export async function handleNpmPublish(ctx) {` |

### lib/app/handlers/preprocess.js（105 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withHostApi` | 14-21 | 8 | `async function withHostApi(handler) {` |
| `listRuleSlots` | 30-33 | 4 | `export async function listRuleSlots(order, disabledSlots = [], hitStats = null) {` |
| `handleRuleSlots` | 36-46 | 11 | `export async function handleRuleSlots(ctx) {` |
| `handleRuleDetail` | 49-57 | 9 | `export async function handleRuleDetail(ctx) {` |
| `handleAudit` | 60-76 | 17 | `export async function handleAudit(ctx) {` |
| `handleToggleRule` | 79-86 | 8 | `export async function handleToggleRule(ctx) {` |
| `handleExemptHint` | 89-104 | 16 | `export async function handleExemptHint(ctx) {` |

### lib/app/handlers/repo-actions.js（144 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `handleRepoVisibility` | 17-22 | 6 | `export async function handleRepoVisibility(ctx) {` |
| `handleVisibilityGet` | 25-34 | 10 | `async function handleVisibilityGet({ query, env }) {` |
| `handleVisibilityPost` | 37-46 | 10 | `async function handleVisibilityPost({ body, env }) {` |
| `handleRepoPush` | 49-93 | 45 | `export async function handleRepoPush(ctx) {` |
| `handleRepoCommit` | 96-144 | 49 | `export async function handleRepoCommit(ctx) {` |

### lib/app/handlers/repos.js（383 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildLocalList` | 23-68 | 46 | `function buildLocalList(indexMap, root, deadline, options) {` |
| `isProbeOverBudget` | 79-81 | 3 | `export function isProbeOverBudget(deadline, now = Date.now()) {` |
| `applyLiveRemote` | 84-147 | 64 | `async function applyLiveRemote(list, deadline) {` |
| `mergeCachedRemote` | 160-185 | 26 | `function mergeCachedRemote(list) {` |
| `scheduleLiveRefresh` | 199-214 | 16 | `function scheduleLiveRefresh(list, env) {` |
| `handleReposLocal` | 217-269 | 53 | `export async function handleReposLocal(ctx) {` |
| `handleReposLocalScan` | 271-280 | 10 | `export function handleReposLocalScan(ctx) {` |
| `handleReposLocalScanWait` | 283-288 | 6 | `export async function handleReposLocalScanWait(ctx) {` |
| `refreshOneTarget` | 294-344 | 51 | `async function refreshOneTarget(t, env) {` |
| `handleReposLocalRefresh` | 347-356 | 10 | `export async function handleReposLocalRefresh(ctx) {` |
| `handleReposCloud` | 359-383 | 25 | `export async function handleReposCloud(ctx) {` |

### lib/app/handlers/settings.js（89 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `handleSettingsGet` | 13-17 | 5 | `export function handleSettingsGet(ctx) {` |
| `handleSettingsSet` | 48-89 | 42 | `export async function handleSettingsSet(ctx) {` |

### lib/app/handlers/workspace-paths.js（108 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pathsFromBody` | 24-28 | 5 | `function pathsFromBody(body) {` |
| `handleWorkspacePathsGet` | 31-49 | 19 | `export function handleWorkspacePathsGet() {` |
| `handleWorkspacePathsSet` | 52-107 | 56 | `export function handleWorkspacePathsSet(ctx) {` |

### lib/app/http-handlers.js（185 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `adaptHttpHandler` | 45-67 | 23 | `export async function adaptHttpHandler(req, res, env, cfg) {` |
| `readBody` | 70-84 | 15 | `function readBody(req) {` |
| `buildCtx` | 87-89 | 3 | `function buildCtx(req, method, env, cfg, query, body, path) {` |
| `handleHttp` | 105-184 | 80 | `export async function handleHttp(req = {}, env = {}, cfg = defaultConfig()) {` |

### lib/app/inject-text.js（185 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildIdentityInjectionText` | 72-82 | 11 | `export function buildIdentityInjectionText() {` |
| `detectHostIp` | 104-115 | 12 | `function detectHostIp() {` |
| `buildAuditApiGuide` | 121-155 | 35 | `export function buildAuditApiGuide(repo = '', opts = {}) {` |
| `formatAuditBlock` | 157-184 | 28 | `export function formatAuditBlock(r = {}) {` |

### lib/app/ownership.js（47 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `classifyOwnership` | 27-32 | 6 | `export function classifyOwnership(login = '', owner = '') {` |
| `privacyRulesEnabled` | 39-41 | 3 | `export function privacyRulesEnabled(ownership) {` |
| `isPrivacyRule` | 44-46 | 3 | `export function isPrivacyRule(ruleId) {` |

### lib/app/preprocess-client.js（137 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolvePreprocessProviderRoot` | 30-34 | 5 | `export function resolvePreprocessProviderRoot() {` |
| `loadPreprocessProvider` | 41-63 | 23 | `export async function loadPreprocessProvider() {` |
| `preprocessProviderRoot` | 66-68 | 3 | `export function preprocessProviderRoot() {` |
| `resetPreprocessProviderCache` | 71-75 | 5 | `export function resetPreprocessProviderCache() {` |
| `hostApi` | 82-90 | 9 | `export async function hostApi() {` |
| `auditReport` | 97-100 | 4 | `export async function auditReport(options = {}) {` |
| `auditHistory` | 103-106 | 4 | `export async function auditHistory(options = {}) {` |
| `ioScan` | 109-112 | 4 | `export async function ioScan(options = {}) {` |
| `linkCheck` | 115-118 | 4 | `export async function linkCheck(options = {}) {` |
| `scopeCheck` | 121-124 | 4 | `export async function scopeCheck(options = {}) {` |
| `exemptAction` | 127-130 | 4 | `export async function exemptAction(options = {}) {` |
| `groupByKeys` | 133-136 | 4 | `export async function groupByKeys() {` |

### lib/app/repo-ownership.js（66 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `localLogin` | 26-34 | 9 | `export function localLogin() {` |
| `remoteOwner` | 37-47 | 11 | `export function remoteOwner(repoPath) {` |
| `probeRepoOwnership` | 54-60 | 7 | `export function probeRepoOwnership(repoPath = '') {` |
| `resetRepoOwnershipCache` | 63-65 | 3 | `export function resetRepoOwnershipCache() {` |

### lib/app/scan-root.js（23 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `getDefaultScanRoot` | 13-23 | 11 | `export function getDefaultScanRoot(env = {}, cfg = {}) {` |

### lib/app/schema.js（161 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFallbackSchema` | 31-76 | 46 | `function makeFallbackSchema() {` |
| `fn` | 33-33 | 1 | `const fn = (v) => (v === undefined ? meta.default : v);` |
| `redactConfig` | 152-160 | 9 | `export function redactConfig(cfg = {}) {` |

### lib/app/settings-bridge.js（270 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `applyPreCommitBlock` | 64-78 | 15 | `function applyPreCommitBlock(cfg, patch) {` |
| `applyTypedKeys` | 86-93 | 8 | `function applyTypedKeys(cfg, patch) {` |
| `applyClampedNumbers` | 96-104 | 9 | `function applyClampedNumbers(cfg, patch) {` |
| `applySettingsToCfg` | 106-114 | 9 | `export function applySettingsToCfg(cfg, patch) {` |
| `setSettingsFileOverride` | 118-120 | 3 | `export function setSettingsFileOverride(path) {` |
| `settingsFilePath` | 123-126 | 4 | `export function settingsFilePath({ workspaceRoot = '' } = {}) {` |
| `settingsLogFilePath` | 134-137 | 4 | `export function settingsLogFilePath({ workspaceRoot = '' } = {}) {` |
| `appendSettingsLog` | 144-168 | 25 | `export function appendSettingsLog(entry, env = {}) {` |
| `httpRejectLogFilePath` | 176-178 | 3 | `export function httpRejectLogFilePath({ workspaceRoot = '' } = {}) {` |
| `appendHttpRejectLog` | 188-219 | 32 | `export function appendHttpRejectLog(entry = {}, env = {}) {` |
| `readSettings` | 226-228 | 3 | `export function readSettings(env = {}) {` |
| `writeSettingsKey` | 237-246 | 10 | `export async function writeSettingsKey(key, jsonValue, env = {}) {` |
| `writePreCommitEnabled` | 258-270 | 13 | `export async function writePreCommitEnabled(enabled, env = {}) {` |

### lib/app/severity.js（15 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isBlockerSeverity` | 11-14 | 4 | `export function isBlockerSeverity(finding) {` |

### lib/app/slash-commands.js（237 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `sessionCwdOf` | 29-32 | 4 | `export function sessionCwdOf(invocation) {` |
| `findGitRoot` | 44-54 | 11 | `export function findGitRoot(dir) {` |
| `resolveTargetPath` | 61-67 | 7 | `export function resolveTargetPath(rawPath, { sessionCwd = '' } = {}) {` |
| `parseCommandInput` | 77-93 | 17 | `export function parseCommandInput(raw = '', flags = [], usage = '') {` |
| `rejectRepo` | 96-98 | 3 | `function rejectRepo(usage, example, detail) {` |
| `formatGitScanCommandText` | 106-123 | 18 | `export function formatGitScanCommandText(r = {}) {` |
| `runGitScanCommand` | 125-139 | 15 | `export async function runGitScanCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {` |
| `runGitAccountCommand` | 145-149 | 5 | `export async function runGitAccountCommand({ env = {}, cfg = {}, log = null } = {}) {` |
| `formatClonePreviewCommandText` | 159-181 | 23 | `export function formatClonePreviewCommandText(r = {}) {` |
| `runGitClonePreviewCommand` | 183-194 | 12 | `export async function runGitClonePreviewCommand({ rawInput = '', env = {}, cfg = {}, log = null } = {}) {` |
| `registerSlashCommands` | 212-236 | 25 | `export function registerSlashCommands(ctx, { env = {}, cfg = {}, log = null } = {}) {` |

### lib/app/slot-stats.js（36 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setLastSlotHitStats` | 20-25 | 6 | `export function setLastSlotHitStats(stats, repo = '') {` |
| `getLastSlotHitStats` | 28-30 | 3 | `export function getLastSlotHitStats() {` |
| `getLastSlotHitMeta` | 33-35 | 3 | `export function getLastSlotHitMeta() {` |

### lib/app/tool-call.js（836 行 · 24 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pushWithPostSteps` | 62-130 | 69 | `async function pushWithPostSteps(args, env, cfg) {` |
| `pushJobOutcome` | 151-183 | 33 | `export function pushJobOutcome(r = {}) {` |
| `short` | 153-153 | 1 | `const short = (sha) => String(sha \|\| '').slice(0, 8);` |
| `cloneJobOutcome` | 191-196 | 6 | `export function cloneJobOutcome(r = {}) {` |
| `buildCommitPushJobSpec` | 199-216 | 18 | `function buildCommitPushJobSpec(repo, doPush) {` |
| `done` | 204-212 | 9 | `const done = (async () => {` |
| `startHostJob` | 229-236 | 8 | `function startHostJob(jobs, spec, owner) {` |
| `callCloneJob` | 250-282 | 33 | `async function callCloneJob(args, jobs, exec, log, env = {}, cfg = {}) {` |
| `callNpmPublishJob` | 290-373 | 84 | `async function callNpmPublishJob(args = {}, jobs, exec, log, env = {}, cfg = {}) {` |
| `outcome` | 324-348 | 25 | `const outcome = (r) => {` |
| `done` | 357-359 | 3 | `const done = (async () => {` |
| `buildCloneJobSpec` | 376-393 | 18 | `function buildCloneJobSpec(target, dest, doClone) {` |
| `done` | 381-389 | 9 | `const done = (async () => {` |
| `callCommitPush` | 400-449 | 50 | `async function callCommitPush(args, env, cfg, log, jobs, exec) {` |
| `doPush` | 422-422 | 1 | `const doPush = () => pushWithPostSteps(args, env, cfg);` |
| `buildAuditOpts` | 460-473 | 14 | `function buildAuditOpts(args, cfg, scope) {` |
| `runHistoryAuditTool` | 479-507 | 29 | `async function runHistoryAuditTool(args, env, cfg, jobs, exec, weights) {` |
| `doHistory` | 484-490 | 7 | `const doHistory = async () => {` |
| `callCodeAudit` | 509-521 | 13 | `async function callCodeAudit(args, env, cfg, log, jobs, exec) {` |
| `runStandardAuditTool` | 524-541 | 18 | `async function runStandardAuditTool(args, env, cfg, log, weights) {` |
| `callTool` | 543-836 | 294 | `export async function callTool(toolName, args = {}, env = {}, cfg = defaultConfig(), log = null, jobs = null, exec = null, fsCtx = null) {` |
| `withAuditPackage` | 801-807 | 7 | `async function withAuditPackage(call) {` |
| `shellSplit` | 810-828 | 19 | `function shellSplit(input) {` |
| `readTextSafe` | 831-835 | 5 | `function readTextSafe(path = '') {` |

### lib/app/tools.js（41 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `paramsToParameters` | 16-30 | 15 | `function paramsToParameters(params = [], cfg) {` |
| `listTools` | 33-41 | 9 | `export function listTools(cfg, hasBuiltinEngine) {` |

### lib/cli/commands-account.mjs（198 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `cmdAccountCheck` | 25-32 | 8 | `export async function cmdAccountCheck(flags) {` |
| `cmdFilemode` | 45-69 | 25 | `export async function cmdFilemode(root, flags) {` |
| `cmdCredEnv` | 72-86 | 15 | `export async function cmdCredEnv(flags) {` |
| `cmdRemoteCreate` | 89-104 | 16 | `export async function cmdRemoteCreate(repo, flags) {` |
| `cmdSetVisibility` | 107-121 | 15 | `export async function cmdSetVisibility(repo, flags) {` |
| `cmdIssue` | 124-144 | 21 | `export async function cmdIssue(repo, flags) {` |
| `cmdPr` | 147-172 | 26 | `export async function cmdPr(repo, flags) {` |
| `cmdGenSshKey` | 175-186 | 12 | `export async function cmdGenSshKey(flags) {` |
| `resolveRepoOwnerName` | 189-197 | 9 | `async function resolveRepoOwnerName(repoPath) {` |

### lib/cli/commands-preprocess.mjs（75 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `describePreprocessCapabilities` | 19-35 | 17 | `export async function describePreprocessCapabilities() {` |
| `cmdPreprocess` | 42-74 | 33 | `export async function cmdPreprocess(positional = []) {` |

### lib/cli/commands-tool.mjs（95 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readPkgJson` | 24-28 | 5 | `export function readPkgJson() {` |
| `cmdYamlTemplate` | 31-33 | 3 | `export function cmdYamlTemplate() {` |
| `cmdReadmeTemplate` | 36-38 | 3 | `export function cmdReadmeTemplate() {` |
| `checkEntries` | 44-72 | 29 | `export function checkEntries() {` |
| `cmdSelfCheck` | 75-94 | 20 | `export function cmdSelfCheck() {` |

### lib/cli/commands-vcs.mjs（211 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pathExists` | 35-37 | 3 | `async function pathExists(p) {` |
| `cmdRepos` | 40-57 | 18 | `export function cmdRepos(root, flags) {` |
| `cmdIndex` | 60-78 | 19 | `export async function cmdIndex(root, flags) {` |
| `cmdGit` | 81-89 | 9 | `export async function cmdGit(args = []) {` |
| `parsePreprocessStagesFlag` | 99-118 | 20 | `function parsePreprocessStagesFlag(raw) {` |
| `cmdCommit` | 121-156 | 36 | `export async function cmdCommit(root, flags) {` |
| `cmdLinkCheck` | 159-169 | 11 | `export async function cmdLinkCheck(root = '.') {` |
| `runClonePreview` | 172-185 | 14 | `async function runClonePreview(target, flags) {` |
| `printCloneResult` | 188-200 | 13 | `function printCloneResult(r, flags, target, dest) {` |
| `cmdClone` | 203-210 | 8 | `export async function cmdClone(flags, positional) {` |

### lib/cli/shared.mjs（483 行 · 20 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `commandOwner` | 70-76 | 7 | `export function commandOwner(command) {` |
| `allCommands` | 79-81 | 3 | `export function allCommands() {` |
| `cliPluginConfig` | 94-103 | 10 | `export function cliPluginConfig() {` |
| `versionLine` | 106-108 | 3 | `export function versionLine(cliName) {` |
| `buildCrossCliHint` | 115-125 | 11 | `export function buildCrossCliHint({ command = '', argvRest = [], fromCli = '' } = {}) {` |
| `defaultFlags` | 179-188 | 10 | `function defaultFlags() {` |
| `applyBoolFlag` | 191-196 | 6 | `function applyBoolFlag(flags, token) {` |
| `applyValueFlag` | 199-202 | 4 | `function applyValueFlag(flags, token, rawValue) {` |
| `parseArgv` | 211-229 | 19 | `export function parseArgv(argv = []) {` |
| `parseVia` | 232-245 | 14 | `export function parseVia(run) {` |
| `printToolResult` | 253-260 | 8 | `export function printToolResult(result, asJson) {` |
| `readableResultLines` | 268-276 | 9 | `function readableResultLines(result) {` |
| `printVersion` | 279-281 | 3 | `export function printVersion(cliName) {` |
| `resolveDispatch` | 291-333 | 43 | `export function resolveDispatch({ cliName = CLI_GIT, argv = [], commands = new Map() } = {}) {` |
| `normalizeRegistryArgv` | 347-361 | 15 | `export function normalizeRegistryArgv(rest = [], params = []) {` |
| `runCli` | 374-422 | 49 | `export async function runCli({` |
| `isDirectRun` | 432-440 | 9 | `export function isDirectRun(moduleUrl) {` |
| `runAsEntry` | 447-458 | 12 | `export function runAsEntry(moduleUrl, main) {` |
| `readEntrySource` | 467-469 | 3 | `export function readEntrySource(relPath) {` |
| `parseEntrySourceMeta` | 476-482 | 7 | `export function parseEntrySourceMeta(sourceText = '') {` |

### lib/client-parts/git/account.js（93 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_AcctHead` | 3-17 | 15 | `function dshgp_AcctHead(props) {` |
| `dshgp_AccountCard` | 20-75 | 56 | `function dshgp_AccountCard(props) {` |
| `dshgp_AccountTab` | 78-91 | 14 | `function dshgp_AccountTab(props) {` |

### lib/client-parts/git/apply.js（79 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `apply` | 2-72 | 71 | `function apply(ctx) {` |
| `useCardState` | 46-49 | 4 | `const useCardState = (selector) => {` |
| `SectionPage` | 52-59 | 8 | `function SectionPage() {` |

### lib/client-parts/git/browser.js（107 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_browseEnsureDom` | 9-37 | 29 | `function dshgp_browseEnsureDom() {` |
| `dshgp_browseGuess` | 38-40 | 3 | `function dshgp_browseGuess() {` |
| `dshgp_browseRemember` | 41-43 | 3 | `function dshgp_browseRemember(p) {` |
| `dshgp_browseLoad` | 44-77 | 34 | `async function dshgp_browseLoad(p) {` |
| `dshgp_browseOpen` | 78-86 | 9 | `function dshgp_browseOpen(input, onPick) {` |
| `dshgp_browseClose` | 87-93 | 7 | `function dshgp_browseClose() {` |
| `dshgp_browseAttach` | 94-104 | 11 | `function dshgp_browseAttach(inputEl) {` |

### lib/client-parts/git/controller.js（1104 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `tick` | 485-503 | 19 | `const tick = async () => {` |
| `renderResult` | 1028-1041 | 14 | `const renderResult = (res) => {` |
| `poll` | 1044-1069 | 26 | `const poll = async () => {` |

### lib/client-parts/git/npm.js（404 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_NpmAccountCard` | 10-71 | 62 | `function dshgp_NpmAccountCard(props) {` |
| `dshgp_NpmInstallForm` | 74-137 | 64 | `function dshgp_NpmInstallForm(props) {` |
| `dshgp_NpmPanel` | 140-301 | 162 | `function dshgp_NpmPanel(props) {` |
| `doInstall` | 167-183 | 17 | `const doInstall = async () => {` |
| `dshgp_AccountSwitcher` | 307-350 | 44 | `function dshgp_AccountSwitcher(props) {` |
| `dshgp_NpmCredFields` | 353-402 | 50 | `function dshgp_NpmCredFields() {` |
| `save` | 365-381 | 17 | `const save = async () => {` |

### lib/client-parts/git/page.js（99 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_ResourceNotice` | 11-29 | 19 | `function dshgp_ResourceNotice(props) {` |
| `dshgp_LoadingSkeleton` | 38-52 | 15 | `function dshgp_LoadingSkeleton() {` |
| `dshgp_GitPushPage` | 54-97 | 44 | `function dshgp_GitPushPage(props) {` |

### lib/client-parts/git/repo.js（382 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_RepoManagerCard` | 2-35 | 34 | `function dshgp_RepoManagerCard(props) {` |
| `dshgp_RepoLocalRow` | 38-116 | 79 | `function dshgp_RepoLocalRow(props) {` |
| `dshgp_RepoLocalPane` | 119-163 | 45 | `function dshgp_RepoLocalPane(props) {` |
| `dshgp_RepoCloudRow` | 166-213 | 48 | `function dshgp_RepoCloudRow(props) {` |
| `dshgp_VisConfirmDialog` | 219-247 | 29 | `function dshgp_VisConfirmDialog(props) {` |
| `dshgp_RepoCloudPane` | 250-301 | 52 | `function dshgp_RepoCloudPane(props) {` |
| `dshgp_CloneProgress` | 312-329 | 18 | `function dshgp_CloneProgress(props) {` |
| `mb` | 314-314 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |
| `dshgp_ClonePreview` | 337-380 | 44 | `function dshgp_ClonePreview(props) {` |
| `mb` | 339-339 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |

### lib/client-parts/git/settings.js（159 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_CredentialBlock` | 2-69 | 68 | `function dshgp_CredentialBlock(props) {` |
| `dshgp_PushDefaultsBlock` | 72-144 | 73 | `function dshgp_PushDefaultsBlock(props) {` |
| `dshgp_SettingsTab` | 146-157 | 12 | `function dshgp_SettingsTab(props) {` |

### lib/client-parts/git/state.js（238 行 · 14 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_uiCtx` | 22-29 | 8 | `function dshgp_uiCtx(onChange) {` |
| `dshgp_uiEnsure` | 32-36 | 5 | `function dshgp_uiEnsure(ctx, name) {` |
| `dshgp_uiEmit` | 39-41 | 3 | `function dshgp_uiEmit(ctx) {` |
| `dshgp_uiStatusOf` | 50-56 | 7 | `function dshgp_uiStatusOf(ctx, name) {` |
| `dshgp_uiRenderOne` | 59-63 | 5 | `function dshgp_uiRenderOne(ctx, name, payload) {` |
| `dshgp_uiApplyAll` | 69-79 | 11 | `function dshgp_uiApplyAll(ctx, names) {` |
| `dshgp_uiReadOnce` | 82-89 | 8 | `function dshgp_uiReadOnce(resource, arg) {` |
| `dshgp_uiLoadOne` | 95-125 | 31 | `async function dshgp_uiLoadOne(ctx, name, arg, attempt) {` |
| `dshgp_uiReload` | 128-134 | 7 | `function dshgp_uiReload(ctx, name, arg) {` |
| `dshgp_uiLoadAll` | 140-154 | 15 | `async function dshgp_uiLoadAll(ctx, opts) {` |
| `dshgp_uiEnsureFresh` | 160-170 | 11 | `function dshgp_uiEnsureFresh(ctx, names) {` |
| `dshgp_uiAllReady` | 173-179 | 7 | `function dshgp_uiAllReady(ctx, names) {` |
| `dshgp_uiAnyLoading` | 182-185 | 4 | `function dshgp_uiAnyLoading(ctx) {` |
| `dshgp_createUiState` | 200-237 | 38 | `function dshgp_createUiState(options) {` |

### lib/client-parts/git/utils.js（63 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_ensureCss` | 2-10 | 9 | `function dshgp_ensureCss() {` |
| `dshgp_getJson` | 13-16 | 4 | `async function dshgp_getJson(url) {` |
| `dshgp_postJson` | 18-27 | 10 | `async function dshgp_postJson(url, payload, timeoutMs) {` |
| `dshgp_tokenConfigured` | 35-39 | 5 | `function dshgp_tokenConfigured(value) {` |
| `dshgp_localGet` | 46-48 | 3 | `function dshgp_localGet(key) {` |
| `dshgp_localSet` | 51-53 | 3 | `function dshgp_localSet(key, value) {` |
| `dshgp_copyText` | 56-61 | 6 | `function dshgp_copyText(text) {` |

### lib/client.js（3256 行 · 60 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_ensureCss` | 286-294 | 9 | `function dshgp_ensureCss() {` |
| `dshgp_getJson` | 297-300 | 4 | `async function dshgp_getJson(url) {` |
| `dshgp_postJson` | 302-311 | 10 | `async function dshgp_postJson(url, payload, timeoutMs) {` |
| `dshgp_tokenConfigured` | 319-323 | 5 | `function dshgp_tokenConfigured(value) {` |
| `dshgp_localGet` | 330-332 | 3 | `function dshgp_localGet(key) {` |
| `dshgp_localSet` | 335-337 | 3 | `function dshgp_localSet(key, value) {` |
| `dshgp_copyText` | 340-345 | 6 | `function dshgp_copyText(text) {` |
| `dshgp_uiCtx` | 368-375 | 8 | `function dshgp_uiCtx(onChange) {` |
| `dshgp_uiEnsure` | 378-382 | 5 | `function dshgp_uiEnsure(ctx, name) {` |
| `dshgp_uiEmit` | 385-387 | 3 | `function dshgp_uiEmit(ctx) {` |
| `dshgp_uiStatusOf` | 396-402 | 7 | `function dshgp_uiStatusOf(ctx, name) {` |
| `dshgp_uiRenderOne` | 405-409 | 5 | `function dshgp_uiRenderOne(ctx, name, payload) {` |
| `dshgp_uiApplyAll` | 415-425 | 11 | `function dshgp_uiApplyAll(ctx, names) {` |
| `dshgp_uiReadOnce` | 428-435 | 8 | `function dshgp_uiReadOnce(resource, arg) {` |
| `dshgp_uiLoadOne` | 441-471 | 31 | `async function dshgp_uiLoadOne(ctx, name, arg, attempt) {` |
| `dshgp_uiReload` | 474-480 | 7 | `function dshgp_uiReload(ctx, name, arg) {` |
| `dshgp_uiLoadAll` | 486-500 | 15 | `async function dshgp_uiLoadAll(ctx, opts) {` |
| `dshgp_uiEnsureFresh` | 506-516 | 11 | `function dshgp_uiEnsureFresh(ctx, names) {` |
| `dshgp_uiAllReady` | 519-525 | 7 | `function dshgp_uiAllReady(ctx, names) {` |
| `dshgp_uiAnyLoading` | 528-531 | 4 | `function dshgp_uiAnyLoading(ctx) {` |
| `dshgp_createUiState` | 546-583 | 38 | `function dshgp_createUiState(options) {` |
| `dshgp_AcctHead` | 598-612 | 15 | `function dshgp_AcctHead(props) {` |
| `dshgp_AccountCard` | 615-670 | 56 | `function dshgp_AccountCard(props) {` |
| `dshgp_AccountTab` | 673-686 | 14 | `function dshgp_AccountTab(props) {` |
| `dshgp_browseEnsureDom` | 696-724 | 29 | `function dshgp_browseEnsureDom() {` |
| `dshgp_browseGuess` | 725-727 | 3 | `function dshgp_browseGuess() {` |
| `dshgp_browseRemember` | 728-730 | 3 | `function dshgp_browseRemember(p) {` |
| `dshgp_browseLoad` | 731-764 | 34 | `async function dshgp_browseLoad(p) {` |
| `dshgp_browseOpen` | 765-773 | 9 | `function dshgp_browseOpen(input, onPick) {` |
| `dshgp_browseClose` | 774-780 | 7 | `function dshgp_browseClose() {` |
| `dshgp_browseAttach` | 781-791 | 11 | `function dshgp_browseAttach(inputEl) {` |
| `dshgp_RepoManagerCard` | 795-828 | 34 | `function dshgp_RepoManagerCard(props) {` |
| `dshgp_RepoLocalRow` | 831-909 | 79 | `function dshgp_RepoLocalRow(props) {` |
| `dshgp_RepoLocalPane` | 912-956 | 45 | `function dshgp_RepoLocalPane(props) {` |
| `dshgp_RepoCloudRow` | 959-1006 | 48 | `function dshgp_RepoCloudRow(props) {` |
| `dshgp_VisConfirmDialog` | 1012-1040 | 29 | `function dshgp_VisConfirmDialog(props) {` |
| `dshgp_RepoCloudPane` | 1043-1094 | 52 | `function dshgp_RepoCloudPane(props) {` |
| `dshgp_CloneProgress` | 1105-1122 | 18 | `function dshgp_CloneProgress(props) {` |
| `mb` | 1107-1107 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |
| `dshgp_ClonePreview` | 1130-1173 | 44 | `function dshgp_ClonePreview(props) {` |
| `mb` | 1132-1132 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |
| `dshgp_NpmAccountCard` | 1184-1245 | 62 | `function dshgp_NpmAccountCard(props) {` |
| `dshgp_NpmInstallForm` | 1248-1311 | 64 | `function dshgp_NpmInstallForm(props) {` |
| `dshgp_NpmPanel` | 1314-1475 | 162 | `function dshgp_NpmPanel(props) {` |
| `doInstall` | 1341-1357 | 17 | `const doInstall = async () => {` |
| `dshgp_AccountSwitcher` | 1481-1524 | 44 | `function dshgp_AccountSwitcher(props) {` |
| `dshgp_NpmCredFields` | 1527-1576 | 50 | `function dshgp_NpmCredFields() {` |
| `save` | 1539-1555 | 17 | `const save = async () => {` |
| `dshgp_CredentialBlock` | 1579-1646 | 68 | `function dshgp_CredentialBlock(props) {` |
| `dshgp_PushDefaultsBlock` | 1649-1721 | 73 | `function dshgp_PushDefaultsBlock(props) {` |
| `dshgp_SettingsTab` | 1723-1734 | 12 | `function dshgp_SettingsTab(props) {` |
| `dshgp_ResourceNotice` | 1746-1764 | 19 | `function dshgp_ResourceNotice(props) {` |
| `dshgp_LoadingSkeleton` | 1773-1787 | 15 | `function dshgp_LoadingSkeleton() {` |
| `dshgp_GitPushPage` | 1789-1832 | 44 | `function dshgp_GitPushPage(props) {` |
| `tick` | 2318-2336 | 19 | `const tick = async () => {` |
| `renderResult` | 2861-2874 | 14 | `const renderResult = (res) => {` |
| `poll` | 2877-2902 | 26 | `const poll = async () => {` |
| `apply` | 3179-3249 | 71 | `function apply(ctx) {` |
| `useCardState` | 3223-3226 | 4 | `const useCardState = (selector) => {` |
| `SectionPage` | 3229-3236 | 8 | `function SectionPage() {` |

### lib/client/index.js（157 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `defaultConfig` | 49-53 | 5 | `export function defaultConfig() {` |
| `resolveConfig` | 61-73 | 13 | `export function resolveConfig(patch = {}, base = defaultConfig()) {` |
| `createSettingsCard` | 81-123 | 43 | `export function createSettingsCard(react, { config = defaultConfig(), onChange = () => {}, labels = {} } = {}) {` |
| `collectExternalRefs` | 131-136 | 6 | `export function collectExternalRefs(css = '') {` |
| `clientModuleInfo` | 146-157 | 12 | `export function clientModuleInfo() {` |

### lib/commit-push.js（281 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `defaultPreprocessRender` | 40-55 | 16 | `export function defaultPreprocessRender(ctx = {}) {` |
| `runPreprocess` | 69-234 | 166 | `export async function runPreprocess({` |
| `commitWithAudit` | 244-267 | 24 | `export async function commitWithAudit({` |
| `commitMany` | 275-281 | 7 | `export async function commitMany({ repos = [], message = '', push = true, dryRun = false, customIgnorePatterns = '' } = {}) {` |

### lib/commit-push/pre-commit-engine.js（1003 行 · 32 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pluginRootDir` | 69-71 | 3 | `export function pluginRootDir() {` |
| `stderrTail` | 78-81 | 4 | `export function stderrTail(text) {` |
| `resolvePreCommitConfig` | 94-117 | 24 | `export function resolvePreCommitConfig(cfg = {}) {` |
| `resolveStages` | 140-151 | 12 | `export function resolveStages(cfg = {}, paramStages = null) {` |
| `normalizeStageItem` | 165-188 | 24 | `function normalizeStageItem(stage, index) {` |
| `resolveStageOnFail` | 208-214 | 7 | `export function resolveStageOnFail(stage, manifest) {` |
| `resolvePreCommitEnabled` | 229-247 | 19 | `export function resolvePreCommitEnabled(cfg = {}) {` |
| `readPreCommitBlock` | 254-267 | 14 | `function readPreCommitBlock(cfg = {}) {` |
| `isExecutableFile` | 274-283 | 10 | `function isExecutableFile(absPath) {` |
| `searchCommandOnPath` | 290-306 | 17 | `function searchCommandOnPath(commandName) {` |
| `resolvePathLikeCommand` | 313-317 | 5 | `function resolvePathLikeCommand(pathLike) {` |
| `resolveEngineCommand` | 327-333 | 7 | `export function resolveEngineCommand(command) {` |
| `resolveEngineArgs` | 344-352 | 9 | `export function resolveEngineArgs(args = []) {` |
| `buildEngineArgs` | 368-391 | 24 | `export function buildEngineArgs({` |
| `formatCommandLine` | 399-401 | 3 | `export function formatCommandLine(command, args = []) {` |
| `failClosed` | 410-412 | 3 | `function failClosed(message) {` |
| `parseEngineStdout` | 421-439 | 19 | `export function parseEngineStdout(stdout) {` |
| `runEngineProcess` | 449-497 | 49 | `function runEngineProcess({ command, args, timeoutMs, env }) {` |
| `finish` | 459-464 | 6 | `const finish = (result) => {` |
| `runPreCommitEngine` | 510-582 | 73 | `export async function runPreCommitEngine({` |
| `runPreCommitPipeline` | 599-621 | 23 | `export async function runPreCommitPipeline(opts = {}) {` |
| `fileFingerprint` | 624-631 | 8 | `function fileFingerprint(absPath) {` |
| `snapshotWorktree` | 646-668 | 23 | `export function snapshotWorktree(repoPath) {` |
| `diffSnapshots` | 681-696 | 16 | `export function diffSnapshots(before, after) {` |
| `runChain` | 712-849 | 138 | `async function runChain(stages, opts = {}, chainSource = 'config') {` |
| `buildStageEnv` | 863-879 | 17 | `export function buildStageEnv({ repoPath = '.', provider = '', changed = [], envDir = '' } = {}) {` |
| `blockedSummaryOf` | 887-894 | 8 | `function blockedSummaryOf(res) {` |
| `withStageOverride` | 906-917 | 12 | `function withStageOverride(cfg, cliPath, timeoutMs) {` |
| `commandLabelOf` | 920-923 | 4 | `function commandLabelOf(command) {` |
| `splitCommandLine` | 934-959 | 26 | `export function splitCommandLine(text) {` |
| `substitutePlaceholders` | 962-965 | 4 | `export function substitutePlaceholders(value, ctx = {}) {` |
| `withCommandStage` | 980-1002 | 23 | `function withCommandStage(cfg, stage, ctx, timeoutMs) {` |

### lib/context/index.js（366 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadToolProbeTemplate` | 105-123 | 19 | `export function loadToolProbeTemplate(file = TEMPLATE_FILE) {` |
| `probeToolPath` | 134-165 | 32 | `export function probeToolPath(name, versionArgs = []) {` |
| `collectToolPaths` | 175-189 | 15 | `export function collectToolPaths(probes = null, { templateFile = TEMPLATE_FILE, resultFile = '' } = {}) {` |
| `writeToolResult` | 197-204 | 8 | `export function writeToolResult(file = '', results = []) {` |
| `mapWorkspaceDirs` | 211-242 | 32 | `export function mapWorkspaceDirs({ workspaceRoot = '', cwd = process.cwd(), maxChildren = 40 } = {}) {` |
| `detectLocalHost` | 263-278 | 16 | `export function detectLocalHost() {` |
| `createEnvInjectionText` | 280-310 | 31 | `export function createEnvInjectionText({ cwd = '', projectRoot = '', tools = DEFAULT_TOOLS, workspace = null, host = null } = {}) {` |
| `isWithinRoot` | 318-330 | 13 | `export function isWithinRoot(root = '', target = '') {` |
| `norm` | 319-324 | 6 | `const norm = (p) => {` |
| `parseEnvInjection` | 337-366 | 30 | `export function parseEnvInjection(text = '') {` |

### lib/core/atomic-json.js（99 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readJson` | 19-27 | 9 | `export function readJson(file) {` |
| `readJsonAny` | 34-41 | 8 | `export function readJsonAny(file) {` |
| `writeJsonAtomic` | 50-63 | 14 | `export function writeJsonAtomic(file, data, { mode = 0o600, pretty = true } = {}) {` |
| `updateJsonAtomic` | 72-76 | 5 | `export function updateJsonAtomic(file, updater, { mode = 0o600 } = {}) {` |
| `writeTextAtomic` | 86-98 | 13 | `export function writeTextAtomic(file, text, { mode = 0o600 } = {}) {` |

### lib/core/credentials.js（275 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `credentialsDir` | 27-32 | 6 | `export function credentialsDir({ workspaceRoot = '' } = {}) {` |
| `ensureCredentialsDir` | 35-39 | 5 | `function ensureCredentialsDir(workspaceRoot) {` |
| `resolveSshKeys` | 47-57 | 11 | `export function resolveSshKeys({ workspaceRoot = '' } = {}) {` |
| `resolveSshKey` | 60-69 | 10 | `export function resolveSshKey({ workspaceRoot = '' } = {}) {` |
| `resolveToken` | 82-110 | 29 | `export function resolveToken({ token = '', tokenPath = '', repoPath = '', workspaceRoot = '' } = {}) {` |
| `maskToken` | 115-119 | 5 | `export function maskToken(token = '') {` |
| `readSshPub` | 122-134 | 13 | `export function readSshPub({ workspaceRoot = '' } = {}) {` |
| `isMaskedValue` | 140-143 | 4 | `export function isMaskedValue(v = '') {` |
| `persistGithubToken` | 153-164 | 12 | `export function persistGithubToken(token, { workspaceRoot = '' } = {}) {` |
| `persistSshPub` | 173-186 | 14 | `export function persistSshPub(pub, { workspaceRoot = '' } = {}) {` |
| `persistNpmToken` | 199-210 | 12 | `export function persistNpmToken(token, { workspaceRoot = '' } = {}) {` |
| `readNpmToken` | 217-226 | 10 | `export function readNpmToken({ workspaceRoot = '' } = {}) {` |
| `generateSshKey` | 235-274 | 40 | `export function generateSshKey(email, { workspaceRoot = '', force = false } = {}) {` |

### lib/core/endpoints.js（120 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mirrorPrefix` | 32-45 | 14 | `export function mirrorPrefix() {` |
| `withMirror` | 66-75 | 10 | `export function withMirror(url, { method = 'GET', mode = 'read', noMirror = false } = {}) {` |
| `mirrorGitConfigEnv` | 88-97 | 10 | `export function mirrorGitConfigEnv(env, { mode = 'read' } = {}) {` |
| `blobApiUrl` | 107-109 | 3 | `export function blobApiUrl(owner, repo, sha) {` |
| `contentsApiUrl` | 112-114 | 3 | `export function contentsApiUrl(owner, repo, encodedPath, encodedRef) {` |
| `rawFileUrl` | 117-119 | 3 | `export function rawFileUrl(owner, repo, encodedRef, encodedPath) {` |

### lib/core/exec.js（264 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `gitSearchPlan` | 36-43 | 8 | `export function gitSearchPlan(pathValue, { delimiter = pathDelimiter, platform = process.platform } = {}) {` |
| `resolveGitBin` | 46-62 | 17 | `export function resolveGitBin() {` |
| `runGit` | 78-100 | 23 | `export function runGit(args, { cwd = '', timeoutMs = 120_000, env = {}, noMirror = false } = {}) {` |
| `gitRaw` | 108-124 | 17 | `export function gitRaw(args, { cwd = '', timeoutMs = 600_000 } = {}) {` |
| `runGitAsync` | 134-155 | 22 | `export function runGitAsync(args, { cwd = '', timeoutMs = 120_000, env = {}, noMirror = false } = {}) {` |
| `runGitStream` | 179-263 | 85 | `export function runGitStream(args, { cwd = '', env = {}, noMirror = false, stallMs, onProgress } = {}) {` |
| `feed` | 213-228 | 16 | `const feed = (chunk, isErr) => {` |
| `signal` | 234-241 | 8 | `const signal = (sig) => {` |
| `finish` | 250-259 | 10 | `const finish = (code, errMsg) => {` |

### lib/core/mirror-store.js（244 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `normalizeMirror` | 51-55 | 5 | `export function normalizeMirror(raw) {` |
| `statePath` | 61-66 | 6 | `export function statePath({ configDir = '' } = {}) {` |
| `readSeed` | 69-77 | 9 | `export function readSeed(path = SEED_PATH) {` |
| `readState` | 80-99 | 20 | `export function readState(path = statePath()) {` |
| `writeState` | 102-111 | 10 | `export function writeState(state, path = statePath()) {` |
| `listCandidates` | 117-131 | 15 | `export function listCandidates({ seedPath = SEED_PATH, stateFile = statePath() } = {}) {` |
| `pickMirror` | 134-145 | 12 | `export function pickMirror({ seedPath, stateFile } = {}) {` |
| `invalidateMirrorCache` | 148-151 | 4 | `export function invalidateMirrorCache() {` |
| `recordOutcome` | 162-193 | 32 | `export function recordOutcome(mirror, { ok, error = '', stateFile = statePath() } = {}) {` |
| `probeMirror` | 204-228 | 25 | `export async function probeMirror({` |
| `probeAll` | 234-243 | 10 | `export async function probeAll({ seedPath, stateFile = statePath(), fetchImpl, timeoutMs, expectedBytes } = {}) {` |

### lib/core/workspace-paths.js（109 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `workspacePathsFile` | 28-30 | 3 | `export function workspacePathsFile() {` |
| `loadWorkspacePaths` | 36-47 | 12 | `export function loadWorkspacePaths() {` |
| `saveWorkspacePaths` | 55-81 | 27 | `export function saveWorkspacePaths(paths, { by = 'ai' } = {}) {` |
| `workspacePathsInjectionText` | 94-108 | 15 | `export function workspacePathsInjectionText(sep = '\n') {` |

### lib/fsx.js（88 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `copyFileCompat` | 30-48 | 19 | `export function copyFileCompat(from, to, opts = {}) {` |
| `chmodBestEffort` | 56-63 | 8 | `export function chmodBestEffort(fn, mode) {` |
| `supportsMetadata` | 75-87 | 13 | `export function supportsMetadata(dirPath) {` |

### lib/git/account-status.js（141 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `accountStatusFile` | 25-27 | 3 | `export function accountStatusFile({ workspaceRoot = '' } = {}) {` |
| `readAccountStatus` | 33-39 | 7 | `export function readAccountStatus({ workspaceRoot = '' } = {}) {` |
| `writeAccountStatus` | 44-57 | 14 | `export function writeAccountStatus(status, { workspaceRoot = '' } = {}) {` |
| `buildAccountStatus` | 63-79 | 17 | `export function buildAccountStatus(result = {}) {` |
| `writeAccountStatusFromResult` | 93-96 | 4 | `export function writeAccountStatusFromResult(result, { workspaceRoot = '' } = {}) {` |
| `refreshAccountStatus` | 104-111 | 8 | `export async function refreshAccountStatus({ workspaceRoot = '', token = '' } = {}) {` |
| `updateAccountStatusQuota` | 127-140 | 14 | `export function updateAccountStatusQuota(apiQuota, { workspaceRoot = '' } = {}) {` |

### lib/git/account.js（234 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `testSshAuth` | 26-48 | 23 | `export function testSshAuth({ workspaceRoot = '' } = {}) {` |
| `checkGithubAccount` | 56-158 | 103 | `export async function checkGithubAccount({ workspaceRoot = '', token = '', checkSsh = true } = {}) {` |
| `formatGithubAccountBlock` | 161-196 | 36 | `export function formatGithubAccountBlock(r = {}) {` |
| `fmtAt` | 168-173 | 6 | `const fmtAt = (iso) => {` |
| `line` | 174-182 | 9 | `const line = (label, present, item, masked) => {` |
| `quotaChannel` | 198-206 | 9 | `function quotaChannel(resources, key) {` |
| `fetchApiQuota` | 218-233 | 16 | `export async function fetchApiQuota({ workspaceRoot = '', token = '' } = {}) {` |

### lib/git/api.js（137 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `githubFetch` | 22-93 | 72 | `export async function githubFetch(path, { token = '', method = 'GET', body, timeout = 60_000, headers: extraHeaders } = {}) {` |
| `attempt` | 54-77 | 24 | `const attempt = async (target) => {` |
| `parseGithubOwnerRepo` | 96-110 | 15 | `export function parseGithubOwnerRepo(originUrl) {` |
| `isBadCredentials` | 113-115 | 3 | `export function isBadCredentials(reason = '') {` |
| `detectRepoVisibility` | 122-136 | 15 | `export async function detectRepoVisibility({ repoPath = '', token = '' } = {}) {` |

### lib/git/browse.js（39 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `browseDir` | 17-38 | 22 | `export function browseDir(p = '', { root = '' } = {}) {` |

### lib/git/ci.js（136 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveRepoIdentity` | 27-38 | 12 | `export function resolveRepoIdentity(repoPath) {` |
| `fetchRunsForSha` | 44-60 | 17 | `export async function fetchRunsForSha({ owner, repo, sha, token = '', fetchImpl = githubFetch, perPage = 50 } = {}) {` |
| `summarizeRuns` | 67-80 | 14 | `export function summarizeRuns(runs = []) {` |
| `waitForCi` | 92-135 | 44 | `export async function waitForCi({` |

### lib/git/clone-download.js（524 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `partitionBySize` | 56-67 | 12 | `export function partitionBySize(blobs = [], maxFileMB = DEFAULT_MAX_FILE_MB) {` |
| `downloadSymlinkEntry` | 94-106 | 13 | `async function downloadSymlinkEntry(entry, { owner, repo, token, out, rel }) {` |
| `posixModeOf` | 120-122 | 3 | `function posixModeOf(gitMode) {` |
| `downloadRegularEntry` | 130-144 | 15 | `async function downloadRegularEntry(entry, { owner, repo, branch, token, out, partPath, signal, rel, onBytes }) {` |
| `runDownloadPool` | 152-163 | 12 | `async function runDownloadPool(blobs, one, concurrency, signal) {` |
| `worker` | 154-161 | 8 | `const worker = async () => {` |
| `cleanupPartsIfAllSucceeded` | 175-178 | 4 | `async function cleanupPartsIfAllSucceeded(partsDir, failed, signal) {` |
| `downloadOneEntry` | 190-216 | 27 | `async function downloadOneEntry(entry, ctx) {` |
| `downloadBlobs` | 218-249 | 32 | `export async function downloadBlobs(o) {` |
| `emit` | 229-233 | 5 | `const emit = () => {` |
| `one` | 240-240 | 1 | `const one = (entry) => downloadOneEntry(entry, ctx);` |
| `fetchBlobJson` | 254-269 | 16 | `async function fetchBlobJson(owner, repo, sha, token) {` |
| `removeDirForce` | 295-314 | 20 | `export async function removeDirForce(dir, attempts = 3) {` |
| `mirrorOf` | 322-327 | 6 | `function mirrorOf(url) {` |
| `noteMirror` | 334-338 | 5 | `function noteMirror(url, ok, error) {` |
| `totalFromResponse` | 341-350 | 10 | `function totalFromResponse(resp) {` |
| `fetchToFile` | 352-523 | 172 | `async function fetchToFile({ owner, repo, branch, relPath, token, out, partPath, size, onBytes, signal = null, mode = 0o644, expectSha = '' }) {` |
| `altMirrors` | 392-400 | 9 | `const altMirrors = (() => {` |
| `mkHeaders` | 401-408 | 8 | `const mkHeaders = (raw, withRange) => {` |

### lib/git/clone-history-mode.js（197 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveBranchHead` | 29-39 | 11 | `export async function resolveBranchHead({ owner = '', repo = '', branch = '', token = '', deps = {} } = {}) {` |
| `cloneWithHistory` | 54-89 | 36 | `export async function cloneWithHistory({` |
| `cloneWithGitFetch` | 110-196 | 87 | `export async function cloneWithGitFetch({` |
| `run` | 131-135 | 5 | `const run = (args) => {` |

### lib/git/clone-history.js（176 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `gitDateOf` | 33-45 | 13 | `export function gitDateOf(iso) {` |
| `commitEnvOf` | 56-67 | 12 | `export function commitEnvOf(c) {` |
| `topoSort` | 79-109 | 31 | `export function topoSort(commits) {` |
| `fetchCommitChain` | 123-157 | 35 | `export async function fetchCommitChain({ owner, repo, head, depth = DEFAULT_HISTORY_DEPTH, apiGet } = {}) {` |
| `planReplay` | 168-175 | 8 | `export function planReplay(commits) {` |

### lib/git/clone-jobs.js（251 行 · 15 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `cloneLog` | 52-61 | 10 | `export function cloneLog(event, detail = {}) {` |
| `cloneLogs` | 64-66 | 3 | `export function cloneLogs(limit = LOG_MAX) {` |
| `isCloneInFlight` | 73-75 | 3 | `export function isCloneInFlight(dest) {` |
| `startCloneJob` | 86-112 | 27 | `export function startCloneJob(meta) {` |
| `cloneAbortSignal` | 118-121 | 4 | `export function cloneAbortSignal() {` |
| `abortCloneJob` | 132-141 | 10 | `export function abortCloneJob(why = 'unspecified') {` |
| `updateCloneJob` | 147-158 | 12 | `export function updateCloneJob(p) {` |
| `setCloneJobPhase` | 161-163 | 3 | `export function setCloneJobPhase(phase) {` |
| `finishCloneJob` | 166-188 | 23 | `export function finishCloneJob(result) {` |
| `snapshot` | 194-212 | 19 | `export function snapshot() {` |
| `cloneJobStatus` | 217-222 | 6 | `export function cloneJobStatus() {` |
| `clearCloneJobResult` | 225-227 | 3 | `export function clearCloneJobResult() {` |
| `getPreview` | 230-235 | 6 | `export function getPreview(key) {` |
| `setPreview` | 237-245 | 9 | `export function setPreview(key, data) {` |
| `__resetCloneJobs` | 248-250 | 3 | `export function __resetCloneJobs() {` |

### lib/git/clone-replay-io.js（179 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `createReplayIo` | 48-178 | 131 | `export function createReplayIo({` |

### lib/git/clone-replay.js（276 行 · 18 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `blobEntriesOf` | 29-41 | 13 | `export function blobEntriesOf(treeJson) {` |
| `planTreeDiff` | 56-73 | 18 | `export function planTreeDiff(prevEntries = [], curEntries = []) {` |
| `byPath` | 68-68 | 1 | `const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);` |
| `replayMarkerPath` | 85-87 | 3 | `export function replayMarkerPath(gitDir) {` |
| `canResumeFrom` | 99-106 | 8 | `export function canResumeFrom(marker, { branch = '', shas = [] } = {}) {` |
| `replayHistory` | 130-186 | 57 | `export async function replayHistory({ commits = [], branch = '', io } = {}) {` |
| `initArgs` | 195-197 | 3 | `export function initArgs() {` |
| `setRemoteArgs` | 200-202 | 3 | `export function setRemoteArgs(name, url) {` |
| `configFileModeArgs` | 205-207 | 3 | `export function configFileModeArgs(enabled = false) {` |
| `addAllArgs` | 217-219 | 3 | `export function addAllArgs() {` |
| `writeTreeArgs` | 222-224 | 3 | `export function writeTreeArgs() {` |
| `commitTreeArgs` | 235-240 | 6 | `export function commitTreeArgs({ tree = '', parents = [], message = '' } = {}) {` |
| `updateRefArgs` | 246-250 | 5 | `export function updateRefArgs(ref, sha, { oldValue = '' } = {}) {` |
| `setUpstreamArgs` | 253-255 | 3 | `export function setUpstreamArgs(branch, remote = 'origin') {` |
| `revParseArgs` | 258-260 | 3 | `export function revParseArgs(rev) {` |
| `remoteTrackingRef` | 263-265 | 3 | `export function remoteTrackingRef(remote, branch) {` |
| `localBranchRef` | 268-270 | 3 | `export function localBranchRef(branch) {` |
| `markerJson` | 273-275 | 3 | `export function markerJson({ branch = '', replayedSha = '', at = '' } = {}) {` |

### lib/git/clone.js（452 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isPartialCloneDir` | 49-56 | 8 | `export function isPartialCloneDir(dir) {` |
| `resolveMaxCloneFileMB` | 69-72 | 4 | `export function resolveMaxCloneFileMB(cfg = {}) {` |
| `enclosingGitRoot` | 89-107 | 19 | `export function enclosingGitRoot(dir) {` |
| `cloneViaApi` | 116-350 | 235 | `export async function cloneViaApi({` |
| `cleanupPartial` | 363-367 | 5 | `async function cleanupPartial(dir) {` |
| `classifyCloneFailure` | 381-394 | 14 | `export function classifyCloneFailure(failed = []) {` |
| `previewClone` | 422-451 | 30 | `export async function previewClone({ target = '', token = '', branch = '', maxFileMB = DEFAULT_MAX_FILE_MB } = {}) {` |

### lib/git/cloud.js（47 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `listCloudRepos` | 21-46 | 26 | `export async function listCloudRepos({ token = '', perPage = 100 } = {}) {` |

### lib/git/commit-message.js（142 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `str` | 35-37 | 3 | `function str(v) {` |
| `uniq` | 40-50 | 11 | `function uniq(list) {` |
| `normalizeItem` | 56-75 | 20 | `function normalizeItem(el) {` |
| `titleOf` | 78-87 | 10 | `export function titleOf(item) {` |
| `buildCommitMessage` | 94-136 | 43 | `export function buildCommitMessage(input) {` |
| `describeMessageForms` | 139-141 | 3 | `export function describeMessageForms() {` |

### lib/git/cred-env.js（88 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildSshEnvPrefix` | 21-23 | 3 | `function buildSshEnvPrefix(keyPath) {` |
| `buildCredEnv` | 30-88 | 59 | `export function buildCredEnv({ workspaceRoot = '' } = {}) {` |

### lib/git/exempt-markers.js（354 行 · 14 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hasHeaderExempt` | 133-137 | 5 | `export function hasHeaderExempt(text, marker) {` |
| `hasLineExempt` | 140-142 | 3 | `export function hasLineExempt(line, marker) {` |
| `isCategoryExempt` | 160-168 | 9 | `export function isCategoryExempt(finding = {}) {` |
| `markerCovers` | 177-196 | 20 | `function markerCovers(meta, kind, rule) {` |
| `has` | 180-180 | 1 | `const has = (a) => Array.isArray(a) && a.length > 0;` |
| `exemptMarkerCovers` | 199-201 | 3 | `export function exemptMarkerCovers(marker, finding = {}) {` |
| `exemptHintForFinding` | 209-219 | 11 | `export function exemptHintForFinding(finding = {}) {` |
| `exemptForFinding` | 230-247 | 18 | `export function exemptForFinding(finding, text = '') { // dsh-skip-complexity: 豁免判定器本体（9 标记 × blocked/细分规则多条件链，职责单一）` |
| `exemptHintFor` | 250-255 | 6 | `export function exemptHintFor(ruleOrKind) {` |
| `cacheGet` | 271-272 | 2 | `function cacheGet(cache, dir) { return cache.has(dir) ? cache.get(dir) : undefined; }` |
| `dirHasEmptyMarker` | 274-286 | 13 | `function dirHasEmptyMarker(dir, name, cache) {` |
| `clearExemptMarkerCache` | 289-292 | 4 | `export function clearExemptMarkerCache() {` |
| `isSampleExemptDir` | 303-323 | 21 | `export function isSampleExemptDir(repoPath, relPath = '') {` |
| `isTestExemptDir` | 333-353 | 21 | `export function isTestExemptDir(repoPath, relPath = '') {` |

### lib/git/filemode.js（182 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveGitDir` | 18-28 | 11 | `function resolveGitDir(repoPath) {` |
| `readConfigValue` | 31-42 | 12 | `function readConfigValue(repoPath, scope) {` |
| `modeOnlyChanges` | 50-64 | 15 | `export function modeOnlyChanges(repoPath) {` |
| `readFilemode` | 72-81 | 10 | `export function readFilemode({ repoPath = '' } = {}) {` |
| `writeFilemodeToConfigText` | 89-119 | 31 | `function writeFilemodeToConfigText(configFile, value) {` |
| `setFilemode` | 130-160 | 31 | `export function setFilemode({ repoPath = '', scope = 'local', value = false } = {}) {` |
| `defaultRepoPath` | 163-165 | 3 | `export function defaultRepoPath() {` |
| `filemodeHint` | 168-172 | 5 | `export function filemodeHint(value) {` |
| `configFileOf` | 175-178 | 4 | `export function configFileOf(repoPath) {` |

### lib/git/hooks.js（92 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `inspectHook` | 31-52 | 22 | `function inspectHook(path) {` |
| `probeHooks` | 61-84 | 24 | `export function probeHooks(repoPath) {` |
| `describeHooks` | 87-91 | 5 | `export function describeHooks(probe) {` |

### lib/git/identity-rewrite.js（298 行 · 14 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `wrongIdentityEmails` | 31-43 | 13 | `export function wrongIdentityEmails({ account = null, extra = [] } = {}) {` |
| `shq` | 46-48 | 3 | `function shq(s) {` |
| `parseGithubRepo` | 55-62 | 8 | `export function parseGithubRepo(url) {` |
| `identityHits` | 65-80 | 16 | `export function identityHits(repoPath, { runGit, wrongEmails, branch = '' } = {}) {` |
| `buildEnvFilter` | 83-92 | 10 | `function buildEnvFilter(canonicalName, canonicalEmail, wrongEmails) {` |
| `rewriteRepoIdentity` | 108-139 | 32 | `export function rewriteRepoIdentity(repoPath, opts = {}) {` |
| `countCommits` | 142-144 | 3 | `function countCommits(repoPath, branch, runGit) {` |
| `preflightRepo` | 150-165 | 16 | `function preflightRepo(repoPath, { runGit }) {` |
| `rewriteBranch` | 172-193 | 22 | `function rewriteBranch(repoPath, branch, { runGit, canonical, wrongEmails, timestamp, hits, before }) {` |
| `pushRewrittenBranch` | 200-217 | 18 | `function pushRewrittenBranch(repoPath, branch, { runGit, pushUrl, oldSha, credEnv }) {` |
| `rewriteIdentities` | 225-236 | 12 | `export function rewriteIdentities(repoPaths = [], opts = {}) {` |
| `legacyIdentityReport` | 247-256 | 10 | `export function legacyIdentityReport(repoPath, { runGit, wrongEmails = [], branch = '' } = {}) {` |
| `buildLegacyIdentityHint` | 264-271 | 8 | `export function buildLegacyIdentityHint(report = {}, canonical = null) {` |
| `formatIdentityRewriteReport` | 278-297 | 20 | `export function formatIdentityRewriteReport(summary = {}) {` |

### lib/git/identity.js（151 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `noreplyEmail` | 37-44 | 8 | `export function noreplyEmail(login, id) {` |
| `identityFromAccount` | 51-55 | 5 | `export function identityFromAccount(account = {}) {` |
| `resolveCommitIdentity` | 65-91 | 27 | `export function resolveCommitIdentity({ configName = '', configEmail = '', account = null } = {}) {` |
| `identityLabel` | 94-98 | 5 | `export function identityLabel(identity = {}) {` |
| `identityHintText` | 105-111 | 7 | `export function identityHintText(identity = {}) {` |
| `ensureRepoIdentity` | 124-150 | 27 | `export function ensureRepoIdentity(repoPath, { runGit, account = null } = {}) {` |
| `readCfg` | 126-129 | 4 | `const readCfg = (key) => {` |
| `stillMissing` | 147-147 | 1 | `const stillMissing = (id.missing.name && !written.some((w) => w.startsWith('user.name=')))` |

### lib/git/ignore.js（72 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ensureGitignore` | 29-71 | 43 | `export async function ensureGitignore(repoPath, { customIgnorePatterns = '', onlyPaths = null, scanSensitive = true } = {}) {` |

### lib/git/index-format.js（183 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `serializeIndex` | 37-62 | 26 | `export function serializeIndex(index) {` |
| `parseIndex` | 65-183 | 119 | `export function parseIndex(text) {` |
| `readIndexFile` | 114-124 | 11 | `export function readIndexFile(dir) {` |
| `writeIndexFile` | 133-151 | 19 | `export function writeIndexFile(dir, index) {` |
| `indexFileExists` | 154-156 | 3 | `export function indexFileExists(dir) {` |
| `findIndexPath` | 159-165 | 7 | `export function findIndexPath(dir) {` |
| `indexAsJsonText` | 168-170 | 3 | `export function indexAsJsonText(index) {` |
| `listIndexFiles` | 173-177 | 5 | `export function listIndexFiles(dir) {` |
| `indexDirOf` | 180-182 | 3 | `export function indexDirOf(filePath) {` |

### lib/git/init-compat.js（242 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fsSupportsChmod` | 38-52 | 15 | `export function fsSupportsChmod(dir) {` |
| `writeMinimalGitDir` | 65-87 | 23 | `export function writeMinimalGitDir(dir, { branch = 'master', remoteName = 'origin', remoteUrl = '' } = {}) {` |
| `registerTrustedRepo` | 107-128 | 22 | `export function registerTrustedRepo(dir, exec) {` |
| `initRepoCompat` | 142-158 | 17 | `export function initRepoCompat(dir, { branch = 'master', remoteUrl = '', chmodOk, gitInit } = {}) {` |
| `unregisterTrustedRepo` | 169-184 | 16 | `export function unregisterTrustedRepo(dir, exec) {` |
| `isUsableRepo` | 194-204 | 11 | `export function isUsableRepo(dir) {` |
| `ensureUsableLocalRepo` | 221-236 | 16 | `export function ensureUsableLocalRepo(dir, { branch = 'master', remoteUrl = '', remoteName = 'origin', chmodOk, gitInit } = {}) {` |
| `hasGitDir` | 239-241 | 3 | `export function hasGitDir(dir) {` |

### lib/git/issues.js（283 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseRepoSlug` | 24-29 | 6 | `function parseRepoSlug(repo = '') {` |
| `normalizeResponse` | 37-45 | 9 | `function normalizeResponse(res) {` |
| `requireText` | 48-52 | 5 | `function requireText(value, fieldName) {` |
| `guardBody` | 55-61 | 7 | `function guardBody(body) {` |
| `slimIssue` | 67-81 | 15 | `function slimIssue(item) {` |
| `slimPull` | 84-100 | 17 | `function slimPull(item) {` |
| `issueAction` | 119-178 | 60 | `export async function issueAction({` |
| `pullAction` | 198-282 | 85 | `export async function pullAction({` |

### lib/git/post-push.js（102 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readPkgVersion` | 21-28 | 8 | `export function readPkgVersion(repoPath) {` |
| `updateRemoteTrackingRef` | 34-43 | 10 | `export function updateRemoteTrackingRef(repoPath, branchRef, refTarget) {` |
| `ensureAuxSshRemote` | 49-65 | 17 | `export function ensureAuxSshRemote(repoPath, owner, repo, result = {}) {` |
| `autoTagDSHProject` | 72-101 | 30 | `export async function autoTagDSHProject({ repoPath = '', version = '', commitSha = '', owner = '', repo = '', token = '' } = {}) {` |

### lib/git/push-diagnose.js（143 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `byHttpStatus` | 92-101 | 10 | `function byHttpStatus(status) {` |
| `classifyPushFailure` | 109-129 | 21 | `export function classifyPushFailure(text = '', opts = {}) {` |
| `describePushDiagnosis` | 137-142 | 6 | `export function describePushDiagnosis(dg = {}) {` |

### lib/git/push.js（543 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveRepoIdentity` | 38-44 | 7 | `function resolveRepoIdentity(repoPath) {` |
| `commitAndPush` | 58-287 | 230 | `export async function commitAndPush({` |
| `legacyIdentity` | 180-189 | 10 | `const legacyIdentity = (() => {` |
| `collectCi` | 233-240 | 8 | `const collectCi = async () => {` |
| `fetchRemoteBranchRef` | 300-313 | 14 | `async function fetchRemoteBranchRef(repoPath, branch, owner, repo) {` |
| `enhanceAfterPushSuccess` | 321-471 | 151 | `async function enhanceAfterPushSuccess({ repoPath, pr, token, steps, commitSha, remote = '' }) {` |
| `lsRemoteProbe` | 380-401 | 22 | `const lsRemoteProbe = () => {` |
| `lsRemoteSha` | 403-403 | 1 | `const lsRemoteSha = () => lsRemoteProbe().sha;` |
| `readmeCheckHint` | 476-481 | 6 | `export function readmeCheckHint(repoPath) {` |
| `pushCurrentBranch` | 490-542 | 53 | `export async function pushCurrentBranch({ repoPath = '', pushMethod = 'ssh', remote = '' } = {}) {` |

### lib/git/remote-resolve.js（147 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseGithubUrl` | 22-30 | 9 | `export function parseGithubUrl(url = '') {` |
| `ssh443Url` | 33-35 | 3 | `export function ssh443Url(owner, repo) {` |
| `httpsUrl` | 38-40 | 3 | `export function httpsUrl(owner, repo) {` |
| `listRemotes` | 43-54 | 12 | `export function listRemotes(repoPath = '') {` |
| `scoreRemote` | 57-80 | 24 | `export function scoreRemote(cand = {}, { owner = '', repo = '', preferSsh443 = true } = {}) {` |
| `resolveGithubRemote` | 87-146 | 60 | `export function resolveGithubRemote({ repoPath = '', owner = '', repo = '', preferSsh443 = true, dryRun = false } = {}) {` |

### lib/git/remote.js（164 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isApiFormOrigin` | 20-22 | 3 | `function isApiFormOrigin(url) {` |
| `prepareLocalRepoForRemote` | 51-75 | 25 | `export function prepareLocalRepoForRemote(repoPath, ownerName, name, { branch = 'main' } = {}) {` |
| `ensureRemoteRepo` | 78-134 | 57 | `export async function ensureRemoteRepo({ repoPath = '', owner = '', visibility = 'private', dryRun = false, token = '' } = {}) {` |
| `parseOwnerRepoFromRemote` | 137-144 | 8 | `export function parseOwnerRepoFromRemote(remoteUrl) {` |
| `setVisibility` | 147-163 | 17 | `export async function setVisibility({ owner = '', repo = '', visibility = '', token = '', repoPath = '' } = {}) {` |

### lib/git/rename.js（138 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `scanOldName` | 27-54 | 28 | `export function scanOldName(repoPath, oldName, { limit = 60, timeoutMs = 20000 } = {}) {` |
| `remotesPointingTo` | 57-69 | 13 | `export function remotesPointingTo(repoPath, owner, repo) {` |
| `renameRepo` | 76-137 | 62 | `export async function renameRepo({` |

### lib/git/repo-index.js（529 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `locateRepoIndex` | 40-43 | 4 | `export function locateRepoIndex(workspaceRoot) {` |
| `readRepoIndexMap` | 46-81 | 36 | `export function readRepoIndexMap(workspaceRoot) {` |
| `indexEntryForRepo` | 84-88 | 5 | `export function indexEntryForRepo(localPath, indexMap) {` |
| `parseMdFrontmatterName` | 93-98 | 6 | `export function parseMdFrontmatterName(content) {` |
| `collectProjectSkills` | 101-131 | 31 | `export async function collectProjectSkills(projectPath) {` |
| `exists` | 134-136 | 3 | `async function exists(p) {` |
| `parseManualVisibility` | 139-151 | 13 | `export function parseManualVisibility(existingContent) {` |
| `queryGitHubVisibility` | 154-165 | 12 | `async function queryGitHubVisibility(repoName, token, owner = 'EIGHTfs') {` |
| `remoteToRepoInfo` | 168-177 | 10 | `function remoteToRepoInfo(remote, visibility) {` |
| `buildRepoIndexVisibility` | 180-196 | 17 | `async function buildRepoIndexVisibility({ repos, token, manualVisibility, owner }) {` |
| `buildRepoIndexLocalOnly` | 199-212 | 14 | `async function buildRepoIndexLocalOnly({ workspaceRoot, repos, localOnlyExtra }) {` |
| `buildRepoIndex` | 219-265 | 47 | `export async function buildRepoIndex({ workspaceRoot, depth = 20, extraRepos = [], extraReposFile = '', token = '', manualVisibility = {}, localOnlyExtra = [], owner = 'EIGHTfs', offline = false, maxRepos = 200 } = {}) {` |
| `repoList` | 236-243 | 8 | `const repoList = (await Promise.all(ownedRepos.map(async (r) => {` |
| `syncRepoIndex` | 271-295 | 25 | `export function syncRepoIndex({ content, workspaceRoot = '', owner = 'EIGHTfs', syncTarget = '' } = {}) {` |
| `mergeFreshIntoExisting` | 310-357 | 48 | `function mergeFreshIntoExisting(existing, freshContent) {` |
| `updateRepoIndex` | 374-404 | 31 | `export async function updateRepoIndex({ workspaceRoot = '', token = '', owner = 'EIGHTfs', depth = 20, extraRepos = [], extraReposFile = '', syncTarget = '', offline = false, maxRepos = 200, mode = 'rebuild', cloudRepos = [], repoName = '', remoteState = {}, localState = null } = {}) {` |
| `maintainRepoIndex` | 411-414 | 4 | `export async function maintainRepoIndex({ workspaceRoot = '', token = '', owner = 'EIGHTfs', depth = 20, extraRepos = [], extraReposFile = '', syncTarget = '', offline = false, maxRepos = 200 } = {}) {` |
| `mergeCloudReposIntoIndex` | 429-482 | 54 | `export function mergeCloudReposIntoIndex({ workspaceRoot = '', owner = 'EIGHTfs', cloudRepos = [], syncTarget = '' } = {}) {` |
| `updateRepoRemoteStateInIndex` | 499-528 | 30 | `export function updateRepoRemoteStateInIndex({ workspaceRoot = '', repoName = '', remoteState = {}, localState = null, syncTarget = '' } = {}) {` |

### lib/git/repos.js（236 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `scanRepos` | 29-31 | 3 | `export function scanRepos(root = '.', opts = {}) {` |
| `scanReposAsync` | 43-47 | 5 | `export async function scanReposAsync(root = '.', opts = {}) {` |
| `mapLimit` | 50-62 | 13 | `async function mapLimit(items, limit, fn) {` |
| `collectRepoPaths` | 69-139 | 71 | `export function collectRepoPaths(root = '.', { depth = DEFAULT_SCAN_DEPTH, extraRepos = [], extraReposFile = '', maxRepos = 200 } = {}) {` |
| `loadIgnoredDirs` | 78-92 | 15 | `const loadIgnoredDirs = (repoRoot) => {` |
| `isIgnored` | 94-102 | 9 | `const isIgnored = (abs) => {` |
| `walk` | 103-120 | 18 | `const walk = (dir, level) => {` |
| `maskRemoteUrl` | 145-154 | 10 | `export function maskRemoteUrl(url = '') {` |
| `parseRepoInfo` | 164-184 | 21 | `function parseRepoInfo(repoPath, raw) {` |
| `describeRepo` | 190-207 | 18 | `export function describeRepo(repoPath = '') {` |
| `describeRepoAsync` | 216-235 | 20 | `export async function describeRepoAsync(repoPath = '') {` |

### lib/git/scan-runner.js（159 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `scanLiveFile` | 39-41 | 3 | `export function scanLiveFile({ workspaceRoot = '' } = {}) {` |
| `emptyLive` | 44-46 | 3 | `function emptyLive() {` |
| `readScanLive` | 49-61 | 13 | `export function readScanLive({ workspaceRoot = '' } = {}) {` |
| `resetScanLive` | 64-71 | 8 | `export function resetScanLive({ workspaceRoot = '' } = {}) {` |
| `runScan` | 78-113 | 36 | `export function runScan({ root = '', owner = 'EIGHTfs', workspaceRoot = '' } = {}) {` |
| `notifyWaiters` | 116-121 | 6 | `function notifyWaiters() {` |
| `waitScanDelta` | 127-153 | 27 | `export async function waitScanDelta({ from = 0, timeoutMs = 60_000, workspaceRoot = '' } = {}) {` |
| `collect` | 130-139 | 10 | `const collect = () => {` |
| `stopScanWatch` | 156-159 | 4 | `export function stopScanWatch({ workspaceRoot = '' } = {}) {` |

### lib/git/sensitive.js（164 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `escapeRegExp` | 43-45 | 3 | `function escapeRegExp(s) {` |
| `sensitiveLineMatch` | 48-67 | 20 | `function sensitiveLineMatch(line) {` |
| `scanOneSensitiveFile` | 84-110 | 27 | `async function scanOneSensitiveFile(dir, it, relPath) {` |
| `scanSensitiveFiles` | 122-163 | 42 | `export async function scanSensitiveFiles(repoPath, { onlyPaths = null } = {}) {` |
| `walk` | 145-160 | 16 | `const walk = async (dir, rel) => {` |

### lib/git/transport.js（520 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `sshUrlOf` | 34-36 | 3 | `function sshUrlOf(pr) {` |
| `knownHostsPath` | 39-41 | 3 | `function knownHostsPath() {` |
| `fetchRemoteHeads` | 48-61 | 14 | `export async function fetchRemoteHeads({ owner = '', repo = '', branch = '', token = '', count = 3 } = {}) {` |
| `dispatchPush` | 79-123 | 45 | `export async function dispatchPush({ repoPath = '', branch = '', token = '', force = false, pushMethod = 'ssh', remote = '' } = {}) {` |
| `sshReason` | 130-139 | 10 | `export function sshReason(stderr = '') {` |
| `isNonFastForward` | 146-148 | 3 | `export function isNonFastForward(text = '') {` |
| `sshMuxCtlPath` | 162-176 | 15 | `function sshMuxCtlPath() {` |
| `buildLsRemoteSshCmd` | 179-185 | 7 | `function buildLsRemoteSshCmd(keyPath, known, { mux = true } = {}) {` |
| `liveRemoteHead` | 192-233 | 42 | `export function liveRemoteHead({ repoPath = '', branch = '', remote = '' } = {}) {` |
| `resolveRemoteTarget` | 237-241 | 5 | `export function resolveRemoteTarget(repoPath = '', remote = '') {` |
| `pushViaSsh` | 243-282 | 40 | `export function pushViaSsh({ repoPath = '', branch = '', force = false, remote = '' }) {` |
| `sshFallback` | 285-288 | 4 | `async function sshFallback(repoPath, branch) {` |
| `apiOrFallback` | 291-296 | 6 | `async function apiOrFallback(api, repoPath, branch, res) {` |
| `pushInitialContent` | 314-336 | 23 | `export async function pushInitialContent({` |
| `readCfg` | 320-323 | 4 | `const readCfg = (key) => {` |
| `pushViaApi` | 338-436 | 99 | `export async function pushViaApi({ repoPath = '', branch = '', token = '', force = false, remote = '' } = {}) {` |
| `uploadBlobsAndBuildTree` | 442-459 | 18 | `async function uploadBlobsAndBuildTree({ repoPath, entries, remoteBlobShas, api }) {` |
| `liveRemoteHeadAsync` | 469-519 | 51 | `export async function liveRemoteHeadAsync({ repoPath = '', branch = '', remote = '', budgetMs = 0 } = {}) {` |
| `stepTimeout` | 482-487 | 6 | `const stepTimeout = (capMs) => {` |

### lib/git/visibility.js（120 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `clearVisibilityCache` | 21-23 | 3 | `export function clearVisibilityCache() {` |
| `cachedVisibility` | 26-29 | 4 | `export function cachedVisibility(repoPath = '') {` |
| `accessPlan` | 39-42 | 4 | `export function accessPlan(visibility = 'unknown') {` |
| `sshGitUrl` | 45-47 | 3 | `export function sshGitUrl(owner = '', repo = '') {` |
| `ownerRepoOf` | 50-57 | 8 | `export function ownerRepoOf(repoPath = '') {` |
| `resolveOwnerVisibility` | 64-90 | 27 | `export async function resolveOwnerVisibility({ owner = '', repo = '', token = '', ttlMs = DEFAULT_TTL_MS } = {}) {` |
| `resolveRepoVisibility` | 102-119 | 18 | `export async function resolveRepoVisibility(repoPath, token = '', { ttlMs = DEFAULT_TTL_MS } = {}) {` |

### lib/git/wrapped-git.js（68 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildWrappedGitEnv` | 16-31 | 16 | `export function buildWrappedGitEnv({ workspaceRoot = '' } = {}) {` |
| `runWrappedGit` | 34-47 | 14 | `export function runWrappedGit(args = [], { workspaceRoot = '' } = {}) {` |
| `runWrappedGitCapture` | 53-68 | 16 | `export function runWrappedGitCapture(args = [], { workspaceRoot = '' } = {}) {` |

### lib/http/index.js（242 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hostNameOf` | 29-38 | 10 | `export function hostNameOf(value = '') {` |
| `isLoopbackHost` | 47-59 | 13 | `export function isLoopbackHost(value = '') {` |
| `isJsonContentType` | 67-69 | 3 | `export function isJsonContentType(contentType = '') {` |
| `checkOrigin` | 89-134 | 46 | `export function checkOrigin(method = '', origin = '', allowed = ALLOWED_ORIGINS, host = '', contentType = '', remoteAddress = '') {` |
| `checkWriteConfirm` | 142-148 | 7 | `export function checkWriteConfirm(body = {}) {` |
| `checkBodySize` | 156-164 | 9 | `export function checkBodySize(byteLength = 0, limit = MAX_BODY_BYTES) {` |
| `httpOk` | 172-174 | 3 | `export function httpOk(ok = true, extra = {}) {` |
| `authPipeline` | 182-192 | 11 | `export function authPipeline({ method = '', origin = '', host = '', contentType = '', contentLength = 0, isWriteConfirmOp = false } = {}, opts = {}) {` |
| `readJsonBody` | 200-217 | 18 | `export function readJsonBody(req, resolve = () => {}, limit = MAX_BODY_BYTES) {` |
| `done` | 203-206 | 4 | `const done = () => {` |
| `routeRequest` | 226-242 | 17 | `export function routeRequest(req = {}, handlers = {}) {` |

### lib/npm/account.js（65 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `npmAccountStatusFile` | 17-19 | 3 | `export function npmAccountStatusFile({ workspaceRoot = '' } = {}) {` |
| `readNpmAccountStatus` | 22-28 | 7 | `export function readNpmAccountStatus({ workspaceRoot = '' } = {}) {` |
| `writeNpmAccountStatus` | 31-37 | 7 | `export function writeNpmAccountStatus(status = {}, { workspaceRoot = '' } = {}) {` |
| `buildNpmAccountStatus` | 40-42 | 3 | `export function buildNpmAccountStatus({ user = '', registry = '', ok = false, error = '' } = {}) {` |
| `renderNpmAccountBlock` | 50-64 | 15 | `export function renderNpmAccountBlock(snap = {}, { configured = false, maskedToken = '', registry = '' } = {}) {` |

### lib/npm/install.js（238 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeTempNpmrc` | 37-47 | 11 | `function makeTempNpmrc({ workspaceRoot = '', registry }) {` |
| `installingKeys` | 50-52 | 3 | `export function installingKeys() {` |
| `validatePackageNames` | 55-65 | 11 | `export function validatePackageNames(names = []) {` |
| `validateDest` | 68-78 | 11 | `export function validateDest(dest = '') {` |
| `buildInstallArgs` | 81-87 | 7 | `export function buildInstallArgs({ names = [], global = false, dest = '', ignoreScripts = true } = {}) {` |
| `appendInstallLog` | 90-98 | 9 | `function appendInstallLog(line, { workspaceRoot = '' } = {}) {` |
| `installPackages` | 106-144 | 39 | `export function installPackages({` |
| `startInstall` | 159-220 | 62 | `export function startInstall({` |
| `push` | 191-198 | 8 | `const push = (buf) => {` |
| `installProgress` | 226-237 | 12 | `export function installProgress({ consume = false } = {}) {` |

### lib/npm/local-registry.js（243 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `run` | 34-44 | 11 | `function run(cmd, args, { cwd, env, timeoutMs = 300000 } = {}) {` |
| `startLocalRegistry` | 51-243 | 193 | `export async function startLocalRegistry({ storeDir, port = 0 } = {}) {` |
| `json` | 57-61 | 5 | `const json = (res, code, obj) => {` |
| `proxyToUpstream` | 75-92 | 18 | `async function proxyToUpstream(req, res) {` |
| `runLocalPreview` | 174-242 | 69 | `export async function runLocalPreview({` |

### lib/npm/npmrc.js（74 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `effectiveRegistry` | 25-28 | 4 | `function effectiveRegistry(registry) {` |
| `registryAuthPrefix` | 31-38 | 8 | `export function registryAuthPrefix(registry = '') {` |
| `npmrcText` | 41-50 | 10 | `export function npmrcText({ registry = DEFAULT_REGISTRY, token = '' } = {}) {` |
| `writeNpmrc` | 56-64 | 9 | `export function writeNpmrc({ workspaceRoot = '', registry = 'https://registry.npmjs.org/', token = '' } = {}) {` |
| `npmArgs` | 67-73 | 7 | `export function npmArgs({ npmrcFile = '', registry = DEFAULT_REGISTRY } = {}) {` |

### lib/npm/publish.js（315 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `sleep` | 27-29 | 3 | `function sleep(ms) {` |
| `publishingKeys` | 35-37 | 3 | `export function publishingKeys() {` |
| `readPackageInfo` | 40-55 | 16 | `export function readPackageInfo(dir = '') {` |
| `fetchPublishedVersions` | 58-78 | 21 | `export async function fetchPublishedVersions({ name, registry = DEFAULT_REGISTRY, timeoutMs = NPM_TIMEOUT_MS } = {}) {` |
| `parsePackOutput` | 93-315 | 223 | `export function parsePackOutput(text = '', { maxCandidates = 200 } = {}) {` |
| `packDryRun` | 110-148 | 39 | `export function packDryRun({ dir, registry = DEFAULT_REGISTRY, workspaceRoot = '', token = '', timeoutMs = PUBLISH_TIMEOUT_MS } = {}) {` |
| `appendPublishLog` | 151-159 | 9 | `function appendPublishLog(line, { workspaceRoot = '' } = {}) {` |
| `publishPackage` | 166-314 | 149 | `export async function publishPackage({` |

### lib/npm/registry.js（172 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `normalizeRegistry` | 15-23 | 9 | `export function normalizeRegistry(v = '') {` |
| `resolveNpmBin` | 32-54 | 23 | `export function resolveNpmBin({ env = process.env } = {}) {` |
| `probe` | 35-37 | 3 | `const probe = (p) => {` |
| `runNpm` | 74-107 | 34 | `export function runNpm(args = [], { timeoutMs = NPM_TIMEOUT_MS, env = {}, cwd = '', maxBuffer } = {}) {` |
| `parseWhoami` | 110-113 | 4 | `export function parseWhoami(text = '') {` |
| `whoami` | 116-121 | 6 | `export function whoami({ npmArgs = [], timeoutMs = NPM_TIMEOUT_MS, env = {} } = {}) {` |
| `listOwnedPackages` | 129-142 | 14 | `export async function listOwnedPackages(user, { registry = DEFAULT_REGISTRY, timeoutMs = NPM_TIMEOUT_MS, size = 50 } = {}) {` |
| `searchPackages` | 143-171 | 29 | `export async function searchPackages(q, { registry = DEFAULT_REGISTRY, timeoutMs = NPM_TIMEOUT_MS, size = 20 } = {}) {` |

### lib/npm/smoke.js（273 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `selectImportSpecs` | 50-70 | 21 | `export function selectImportSpecs(pkg) {` |
| `isModuleTarget` | 82-98 | 17 | `function isModuleTarget(value) {` |
| `isBrowserEntry` | 100-103 | 4 | `export function isBrowserEntry(key) {` |
| `binEntriesOf` | 106-117 | 12 | `export function binEntriesOf(pkg, packageName = '') {` |
| `classifyPackageForm` | 128-135 | 8 | `export function classifyPackageForm(pkg) {` |
| `entrySpecsOf` | 137-153 | 17 | `export function entrySpecsOf(pkg) {` |
| `smokeTestPackage` | 156-272 | 117 | `export async function smokeTestPackage({ dir = '', workspaceRoot = '', registry = '', timeoutMs = SMOKE_TIMEOUT_MS } = {}) {` |

### lib/npm/unpublish.js（156 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseTarget` | 27-35 | 9 | `export function parseTarget({ name = '', version = '', wholePackage = false } = {}) {` |
| `preflightUnpublish` | 42-88 | 47 | `export async function preflightUnpublish({ name = '', version = '', wholePackage = false, registry = DEFAULT_REGISTRY, timeoutMs = NPM_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {` |
| `unpublishPackage` | 95-155 | 61 | `export async function unpublishPackage({` |

### lib/plugin/auto-detect.js（92 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `extractLastAssistantText` | 25-39 | 15 | `export function extractLastAssistantText(events) {` |
| `compileTriggerPattern` | 48-55 | 8 | `export function compileTriggerPattern(text) {` |
| `detectCompletion` | 65-76 | 12 | `export function detectCompletion(text, { trigger = DEFAULT_TRIGGER_PATTERN, block = DEFAULT_BLOCK_PATTERN } = {}) {` |
| `shouldAutoPush` | 85-92 | 8 | `export function shouldAutoPush({ text, permitted, opts } = {}) {` |

### lib/plugin/auto-push.js（151 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `registerAutoPush` | 41-151 | 111 | `export function registerAutoPush(ctx, { cfg = {}, onPushAfterCommit } = {}) {` |
| `schedule` | 55-68 | 14 | `function schedule(session, event) {` |
| `runCheck` | 70-87 | 18 | `async function runCheck(session, turn) {` |
| `resolveTargets` | 90-105 | 16 | `function resolveTargets(session) {` |
| `gateCommit` | 108-115 | 8 | `async function gateCommit(repoPath) {` |
| `runAutoPush` | 117-137 | 21 | `async function runAutoPush(session, turn, log2) {` |

### lib/plugin/index.js（251 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `textRender` | 52-54 | 3 | `export function textRender(_args, value) {` |
| `normalizeParameters` | 62-73 | 12 | `export function normalizeParameters(parameters = {}) {` |
| `buildToolSpecs` | 81-94 | 14 | `export function buildToolSpecs(tools = [], invoke) {` |
| `warn` | 97-99 | 3 | `function warn(log, msg) {` |
| `registerTools` | 105-128 | 24 | `export function registerTools(ctx, { defineTool, tools, invoke, log } = {}) {` |
| `registerContext` | 135-158 | 24 | `export function registerContext(ctx, { sections = [], log } = {}) {` |
| `registerPreStepInjection` | 176-208 | 33 | `export function registerPreStepInjection(ctx, { envInjectText, log } = {}) {` |
| `registerHttp` | 214-231 | 18 | `export function registerHttp(ctx, { path = '/api/git-push', handler, log } = {}) {` |
| `setDefineToolOverride` | 240-250 | 11 | `export function setDefineToolOverride(fn) { defineToolOverride = fn; }` |
| `loadDefineTool` | 241-250 | 10 | `export async function loadDefineTool(log) {` |

### lib/preprocess/providers.js（238 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `getProviderDefinition` | 49-51 | 3 | `export function getProviderDefinition(providerId = DEFAULT_PROVIDER_ID) {` |
| `providerEnvName` | 54-56 | 3 | `export function providerEnvName(providerId) {` |
| `resolveProvider` | 63-93 | 31 | `export function resolveProvider(providerId = DEFAULT_PROVIDER_ID) {` |
| `resolveGateProvider` | 100-102 | 3 | `export function resolveGateProvider() {` |
| `listProviderManifests` | 118-143 | 26 | `export async function listProviderManifests() {` |
| `findActionProvider` | 152-162 | 11 | `export async function findActionProvider(action) {` |
| `findEndpointProvider` | 170-180 | 11 | `export async function findEndpointProvider(subPath, method) {` |
| `listDeclaredCapabilities` | 183-194 | 12 | `export async function listDeclaredCapabilities() {` |
| `primeCommitContributions` | 212-229 | 18 | `export async function primeCommitContributions() {` |
| `getCommitContributions` | 235-237 | 3 | `export function getCommitContributions() {` |

### lib/self/index.js（197 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readmeTemplate` | 77-142 | 66 | `export function readmeTemplate({ name = 'dsh-git-push', description = 'DSH git 自动提交推送插件——统一函数入口架构', version = VERSION, versionTable = '' } = {}) {` |
| `yamlTemplate` | 145-157 | 13 | `export function yamlTemplate() {` |
| `selfVersion` | 160-162 | 3 | `export function selfVersion() {` |
| `versionInfo` | 169-181 | 13 | `export function versionInfo(pkgJson = '') {` |
| `helpSync` | 190-196 | 7 | `export function helpSync(helpText = '', knownFlags = []) {` |

### lib/skip-dirs.js（27 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `getSkipSet` | 24-26 | 3 | `export function getSkipSet() {` |

### scripts/build-client.mjs（135 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readParts` | 69-75 | 7 | `export function readParts(order = PART_ORDER, dir = PARTS_DIR) {` |
| `buildClient` | 80-83 | 4 | `export function buildClient(order = PART_ORDER, dir = PARTS_DIR) {` |
| `checkShape` | 86-95 | 10 | `export function checkShape(code) {` |
| `main` | 99-130 | 32 | `function main(argv = process.argv.slice(2)) {` |

### scripts/bump-version.mjs（179 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseArgs` | 39-50 | 12 | `function parseArgs(argv) {` |
| `cmpVer` | 55-60 | 6 | `function cmpVer(a, b) {` |
| `bumpPatch` | 63-66 | 4 | `function bumpPatch(v) {` |
| `readJson` | 68-70 | 3 | `function readJson(p) {` |
| `buildVersionLine` | 83-100 | 18 | `function buildVersionLine(oldLine, newVer, oldVer, message, commentOverride = '') {` |

### scripts/check.mjs（207 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectJs` | 22-31 | 10 | `function collectJs(dir, acc = []) {` |
| `collectJson` | 34-42 | 9 | `function collectJson(dir, acc = []) {` |

### scripts/doc-func.mjs（213 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `escapeReg` | 30-31 | 2 | `function escapeReg(s) { return s.replace(/[.*+?^${}()\|[\]\\]/g, '\\$&'); }` |
| `stripComment` | 32-34 | 3 | `function stripComment(line) {` |
| `findBlockEnd` | 37-49 | 13 | `function findBlockEnd(lines, startIdx) {` |
| `detectFunction` | 51-60 | 10 | `function detectFunction(lines, i) {` |
| `scanFileFuncs` | 63-213 | 151 | `export function scanFileFuncs(file, textOverride) {` |
| `collectFuncFiles` | 111-126 | 16 | `export function collectFuncFiles(root, includeDirs = DEFAULT_SCAN_DIRS) {` |
| `walk` | 113-123 | 11 | `const walk = (dir, depth) => {` |
| `buildFuncListText` | 129-148 | 20 | `export function buildFuncListText(root, includeDirs = DEFAULT_SCAN_DIRS) {` |
| `findBlock` | 151-156 | 6 | `function findBlock(text) {` |
| `applyFuncBlock` | 159-163 | 5 | `export function applyFuncBlock(text, newContent) {` |
| `checkFuncDrift` | 166-178 | 13 | `export function checkFuncDrift({ hostPath, root, includeDirs = DEFAULT_SCAN_DIRS } = {}) {` |
| `out` | 188-188 | 1 | `const out = (msg) => console.log(msg);` |

### scripts/doc-tree.mjs（458 行 · 20 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectMdFiles` | 52-68 | 17 | `function collectMdFiles(root) {` |
| `walk` | 55-65 | 11 | `const walk = (dir, depth) => {` |
| `findMarkedHostMd` | 78-87 | 10 | `export function findMarkedHostMd(root, marker = 'dshgp-tree') {` |
| `resolveTargetMd` | 90-93 | 4 | `export function resolveTargetMd(root, explicit = '', marker = 'dshgp-tree') {` |
| `gitLsFiles` | 101-114 | 14 | `function gitLsFiles(root = ROOT) {` |
| `loadMapping` | 118-122 | 5 | `function loadMapping(root = ROOT) {` |
| `writeMapping` | 124-126 | 3 | `function writeMapping(map, root = ROOT) {` |
| `gitWorktreeChanges` | 134-156 | 23 | `function gitWorktreeChanges(root = ROOT) {` |
| `syncIndex` | 166-211 | 46 | `export function syncIndex({ write = true, files = gitLsFiles(), map = loadMapping(), root = ROOT } = {}) {` |
| `buildGroups` | 216-232 | 17 | `function buildGroups(files) {` |
| `groupLines` | 235-261 | 27 | `function groupLines(name, paths, map, prefix = '') {` |
| `note` | 249-249 | 1 | `const note = (p) => (map[p] ? map[p] : '（待注释）');` |
| `buildTreeText` | 264-276 | 13 | `export function buildTreeText(files = gitLsFiles(), map = loadMapping(), rootLabel = basename(ROOT)) {` |
| `findBlock` | 281-288 | 8 | `function findBlock(text, marker = 'dshgp-tree') {` |
| `readReadme` | 290-293 | 4 | `function readReadme(path) {` |
| `applyBlock` | 295-299 | 5 | `function applyBlock(text, newTree) {` |
| `checkDrift` | 303-383 | 81 | `export function checkDrift({ readmePath = '', root = ROOT } = {}) {` |
| `isToolGenerated` | 354-354 | 1 | `const isToolGenerated = (p) => p === 'functions-index.json' \|\| p === '_meta'` |
| `filesOf` | 402-402 | 1 | `const filesOf = (r) => gitLsFiles(r);` |
| `mapOf` | 403-403 | 1 | `const mapOf = (r) => loadMapping(r);` |

### scripts/doc-version.mjs（150 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `packageVersionOf` | 40-42 | 3 | `export function packageVersionOf(root) {` |
| `buildVersionListText` | 46-51 | 6 | `export function buildVersionListText(root, _opts = {}) {` |
| `findBlock` | 54-59 | 6 | `function findBlock(text) {` |
| `applyVersionBlock` | 62-66 | 5 | `export function applyVersionBlock(text, newContent) {` |
| `checkVersionDrift` | 69-77 | 9 | `export function checkVersionDrift({ hostPath, root, versionSource = '' } = {}) {` |
| `out` | 94-94 | 1 | `const out = (msg) => console.log(msg);` |

### scripts/scan-repos.mjs（167 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `arg` | 30-33 | 4 | `function arg(name, def) {` |
| `liveFile` | 35-36 | 2 | `function liveFile(wr) { return join(cfgDir(wr), 'scan-live.json'); }` |
| `indexFile` | 36-37 | 2 | `function indexFile(wr) { return join(cfgDir(wr), 'dsh-repo-index.json'); }` |
| `cfgDir` | 37-38 | 2 | `function cfgDir(wr) { return credentialsDir({ workspaceRoot: wr \|\| REPO_ROOT }); }` |
| `tmpPathOf` | 39-40 | 2 | `function tmpPathOf(p) { return `${p}.${process.pid}.tmp`; }` |
| `main` | 47-104 | 58 | `async function main() {` |
| `pruneIndex` | 107-131 | 25 | `function pruneIndex({ workspaceRoot, owner, scanned }) {` |
| `pushLive` | 134-145 | 12 | `function pushLive({ workspaceRoot, found, done }) {` |
| `appendIndexEntry` | 148-162 | 15 | `function appendIndexEntry({ workspaceRoot, entry, owner }) {` |

### scripts/scan-version.mjs（127 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readmeVersion` | 36-66 | 31 | `export function readmeVersion(text = '') {` |
| `cmp` | 56-63 | 8 | `const cmp = (a, b) => {` |
| `main` | 68-124 | 57 | `function main() {` |

### scripts/version-source.mjs（188 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runGit` | 16-23 | 8 | `function runGit(args, { cwd = '' } = {}) {` |
| `parseVersion` | 30-34 | 5 | `export function parseVersion(str) {` |
| `listVersionCommits` | 39-53 | 15 | `export function listVersionCommits(repoPath) {` |
| `scrubConvWording` | 60-74 | 15 | `export function scrubConvWording(label) {` |
| `readVersionMetrics` | 85-92 | 8 | `export function readVersionMetrics(repoPath) {` |
| `detectVersionSource` | 105-110 | 6 | `export function detectVersionSource(root) {` |
| `projectVersionOf` | 113-123 | 11 | `export function projectVersionOf(root, source = '') {` |
| `readReleases` | 126-133 | 8 | `export function readReleases(repoPath) {` |
| `buildReadmeVersionTable` | 151-185 | 35 | `export function buildReadmeVersionTable(repoPath) {` |

### test/app/test-plugin.mjs（522 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeCtx` | 34-43 | 10 | `function makeCtx(overrides = {}) {` |
| `fileMode` | 46-48 | 3 | `function fileMode(file) {` |

### test/app/test-settings-persistence.mjs（243 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `clientSubmitKeys` | 29-39 | 11 | `function clientSubmitKeys() {` |
| `allowlistKeys` | 42-44 | 3 | `function allowlistKeys() {` |
| `cfgMappingKeys` | 47-243 | 197 | `function cfgMappingKeys() {` |
| `isolatedEnv` | 64-71 | 8 | `function isolatedEnv() {` |

### test/app/test-slash-commands.mjs（129 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `inv` | 16-18 | 3 | `function inv(cwd) {` |

### test/app/test-symlink-resolution.mjs（104 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildFixture` | 25-41 | 17 | `function buildFixture() {` |
| `runNode` | 43-45 | 3 | `function runNode(args, env) {` |

### test/app/test-task-queue.mjs（208 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkRepo` | 20-27 | 8 | `function mkRepo() {` |
| `mkDirtyRepo` | 35-39 | 5 | `function mkDirtyRepo() {` |
| `wait` | 40-41 | 2 | `function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }` |
| `mockJobs` | 43-61 | 19 | `function mockJobs() {` |

### test/app/test-tools-e2e.mjs（67 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 26-32 | 7 | `function makeRepo(name) {` |

### test/app/test-workspace-paths.mjs（139 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mod` | 28-28 | 1 | `const mod = () => import('../../lib/core/workspace-paths.js');` |
| `h` | 29-29 | 1 | `const h = () => import('../../lib/app/handlers/workspace-paths.js');` |

### test/git/test-account-ssh.mjs（149 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isolatedEnv` | 17-24 | 8 | `function isolatedEnv() {` |

### test/git/test-ci-wait.mjs（99 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeFetch` | 38-48 | 11 | `function fakeFetch(sequence) {` |
| `impl` | 41-46 | 6 | `const impl = async (path) => {` |
| `noSleep` | 50-51 | 2 | `const noSleep = async () => {};` |
| `fakeNow` | 52-52 | 1 | `const fakeNow = () => clock;` |

### test/git/test-cifs-init.mjs（158 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withDir` | 34-40 | 7 | `function withDir(fn) {` |
| `readGlobalSafeDirs` | 49-55 | 7 | `const readGlobalSafeDirs = () => {` |
| `gitOk` | 57-59 | 3 | `const gitOk = (dir, args) => {` |

### test/git/test-clone-concurrency.mjs（459 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `probe` | 130-154 | 25 | `const probe = async (useNew) => {` |
| `writer` | 135-141 | 7 | `const writer = (async () => {` |
| `call` | 436-436 | 1 | `const call = async (body) => (await handleHttp(` |

### test/git/test-clone-history.mjs（328 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `stubApi` | 40-50 | 11 | `function stubApi(chain) {` |
| `fakeApi` | 168-178 | 11 | `function fakeApi({ headSha = 'c', trees = {}, commits = {}, refStatus = 200 } = {}) {` |
| `fakeGit` | 181-192 | 12 | `function fakeGit() {` |
| `runGit` | 184-190 | 7 | `const runGit = (args) => {` |
| `read` | 294-294 | 1 | `const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');` |

### test/git/test-clone-mirror.mjs（316 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `stubChannels` | 37-64 | 28 | `function stubChannels({ rawBroken = true, apiBroken = false } = {}) {` |
| `blobSha` | 68-70 | 3 | `function blobSha(content, size) {` |
| `newDir` | 75-76 | 2 | `function newDir() { return mkdtempSync(join(tmpdir(), 'dshgp-trunc-')); }` |
| `partOf` | 76-77 | 2 | `function partOf(dir) { return join(dir, PARTS_DIR, `${blob.sha}.part`); }` |
| `makeJsx` | 173-181 | 9 | `function makeJsx() {` |
| `createElement` | 174-179 | 6 | `const createElement = (type, props) => {` |
| `extractFunction` | 184-316 | 133 | `function extractFunction(src, signature) {` |
| `walk` | 198-203 | 6 | `function walk(node, out = []) {` |
| `renderPreview` | 206-316 | 111 | `function renderPreview(handlers = {}) {` |

### test/git/test-clone-replay.mjs（506 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeIo` | 128-146 | 19 | `function fakeIo({ trees = {}, failDownloadAt = -1, marker = null } = {}) {` |
| `fakeGit` | 260-506 | 247 | `function fakeGit({ hasOrigin = false, failAt = '' } = {}) {` |
| `runGit` | 262-272 | 11 | `const runGit = (args) => {` |
| `stubFetch` | 417-427 | 11 | `function stubFetch() {` |
| `blobSha` | 430-435 | 6 | `function blobSha(content, size) {` |

### test/git/test-filemode.mjs（110 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 18-27 | 10 | `function makeRepo(prefix) {` |
| `prevGlobal` | 90-94 | 5 | `const prevGlobal = (() => {` |

### test/git/test-git-core.mjs（606 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withRepo` | 78-82 | 5 | `function withRepo(fn) {` |
| `writeHook` | 84-89 | 6 | `function writeHook(root, name, body, mode = 0o755) {` |
| `makeRepo` | 171-178 | 8 | `function makeRepo() {` |
| `commit` | 181-185 | 5 | `function commit(dir, msg, { author = null, committer = { name: 'DSH Agent', email: 'agent@dsh.local' } } = {}) {` |
| `identities` | 188-190 | 3 | `function identities(dir) {` |
| `repoWrongEmails` | 192-194 | 3 | `function repoWrongEmails() {` |
| `setupRepo` | 357-373 | 17 | `function setupRepo() {` |
| `commitAll` | 376-379 | 4 | `function commitAll(dir, msg = 'init') {` |
| `withRepo` | 437-441 | 5 | `function withRepo(fn) {` |
| `runFetchCase` | 555-570 | 16 | `async function runFetchCase(streamResult) {` |

### test/git/test-git-identity.mjs（123 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 31-35 | 5 | `function makeRepo() {` |
| `repoConfig` | 38-40 | 3 | `function repoConfig(dir, key) {` |

### test/git/test-git.mjs（865 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mockFetch` | 63-80 | 18 | `function mockFetch(routes) {` |
| `gitBlobSha` | 87-90 | 4 | `function gitBlobSha(content) {` |
| `mockRawRoutes` | 97-107 | 11 | `function mockRawRoutes(files) {` |

### test/git/test-index-jsonl.mjs（135 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `sampleIndex` | 26-135 | 110 | `function sampleIndex() {` |

### test/git/test-init-compat.mjs（118 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `tmpRepo` | 31-35 | 5 | `function tmpRepo() {` |
| `git` | 38-40 | 3 | `function git(dir, args) {` |

### test/git/test-mirror.mjs（299 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withMirror` | 34-42 | 9 | `const withMirror = async (value, fn) => {` |
| `withEnv` | 79-87 | 9 | `const withEnv = (v, fn) => {` |
| `withStateFile` | 169-183 | 15 | `function withStateFile(fn) {` |

### test/git/test-multi-remote.mjs（47 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 12-21 | 10 | `function makeRepo() {` |

### test/git/test-npm-install.mjs（416 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `publishBody` | 105-114 | 10 | `function publishBody({ name = 'demo-pkg', version = '1.2.3', tag = 'beta', bytes = 'FAKE-TARBALL' } = {}) {` |
| `withRegistry` | 116-119 | 4 | `async function withRegistry(fn) {` |
| `makePackage` | 364-382 | 19 | `function makePackage({ name, version = '1.0.0', main, bin, binBody }) {` |

### test/git/test-npm-publish.mjs（381 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFixture` | 48-57 | 10 | `function makeFixture() {` |
| `fakeFetch` | 170-172 | 3 | `function fakeFetch(doc) {` |
| `hoursAgo` | 175-175 | 1 | `const hoursAgo = (h) => new Date(now - h * 3600 * 1000).toISOString();` |
| `doc` | 177-186 | 10 | `function doc({ versions = ['1.0.0'], tags = { latest: '1.0.0' }, ageHours = 10 } = {}) {` |

### test/git/test-persist-credentials.mjs（93 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withIsolatedDshHome` | 19-30 | 12 | `function withIsolatedDshHome(fn) {` |

### test/git/test-pre-commit-engine.mjs（861 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeEngineSource` | 49-82 | 34 | `function fakeEngineSource(mode) {` |
| `makeFakeEngines` | 85-94 | 10 | `function makeFakeEngines(dir) {` |
| `runWithFake` | 97-104 | 8 | `function runWithFake(engines, mode, extra = {}) {` |
| `makeBlockerRepo` | 107-119 | 13 | `function makeBlockerRepo() {` |
| `writeFakeEngine` | 454-471 | 18 | `function writeFakeEngine(dir, name, { exitCode = 0, body = null, marker = '' } = {}) {` |
| `writeTouchEngine` | 558-570 | 13 | `function writeTouchEngine(dir, name, content) {` |
| `makeTempRepo` | 573-582 | 10 | `function makeTempRepo(prefix) {` |
| `writeEnvProbeEngine` | 650-669 | 20 | `function writeEnvProbeEngine(dir, logPath) {` |

### test/git/test-push.mjs（321 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `tempRepo` | 150-160 | 11 | `function tempRepo() {` |

### test/git/test-remote-resolve.mjs（128 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 25-29 | 5 | `function makeRepo() {` |
| `addRemote` | 30-32 | 3 | `function addRemote(dir, name, url) {` |
| `getUrl` | 33-39 | 7 | `function getUrl(dir, name) {` |

### test/git/test-repo-list.mjs（592 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 38-49 | 12 | `function makeRepo(dir, { remote = '', commit = true } = {}) {` |
| `sandbox` | 52-64 | 13 | `function sandbox(fn) {` |
| `pick` | 504-504 | 1 | `const pick = (push) => String(push?.commitSha \|\| '').slice(0, 40) \|\| localHead;` |
| `sandboxAsync` | 534-546 | 13 | `async function sandboxAsync(fn) {` |

### test/git/test-repos-live-budget.mjs（116 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readMs` | 61-65 | 5 | `const readMs = (name) => {` |

### test/helpers/merge-tests.mjs（263 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `importLineRanges` | 34-53 | 20 | `function importLineRanges(text) {` |
| `parseImport` | 56-81 | 26 | `function parseImport(stmt) {` |
| `inspectFile` | 91-115 | 25 | `export function inspectFile(absPath) {` |
| `mergeability` | 118-126 | 9 | `export function mergeability(absPath) {` |
| `prefixTestNames` | 129-144 | 16 | `function prefixTestNames(body, prefix) {` |
| `mergeGroup` | 147-224 | 78 | `export function mergeGroup(dir, { out, members }) {` |
| `runTestFile` | 227-236 | 10 | `export function runTestFile(absPath) {` |

### test/helpers/test-cache.mjs（231 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `stripCommentsAndStrings` | 55-80 | 26 | `export function stripCommentsAndStrings(text) {` |
| `isCacheableTest` | 88-92 | 5 | `export function isCacheableTest(sourceText, fileName = '') {` |
| `relativeSpecifiers` | 95-108 | 14 | `export function relativeSpecifiers(sourceText) {` |
| `importClosure` | 116-135 | 20 | `export function importClosure(entryAbs, exists = existsSync) {` |
| `cacheKeyFor` | 143-154 | 12 | `export function cacheKeyFor(absFiles, nodeVersion = process.version) {` |
| `selfHashOf` | 166-173 | 8 | `export function selfHashOf(absPath, nodeVersion = process.version) {` |
| `loadTestCache` | 176-183 | 8 | `export function loadTestCache(root) {` |
| `saveTestCache` | 186-199 | 14 | `export function saveTestCache(root, cache) {` |
| `planTestRun` | 208-230 | 23 | `export function planTestRun(files, cache, exists = existsSync) {` |

### test/helpers/test-scan.mjs（123 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `scanTestTree` | 43-97 | 55 | `export function scanTestTree(testDir) {` |
| `noteSide` | 49-52 | 4 | `const noteSide = (side, kind, absPath) => {` |
| `walk` | 55-91 | 37 | `const walk = (dirAbs, depth, insideArchived) => {` |
| `structureViolations` | 104-106 | 3 | `export function structureViolations(scan) {` |
| `sideOf` | 114-117 | 4 | `export function sideOf(testDir, absPath) {` |
| `isDirectory` | 120-122 | 3 | `export function isDirectory(dirPath) {` |

### test/helpers/tmp-dir.mjs（117 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `installExitHook` | 25-33 | 9 | `function installExitHook() {` |
| `removeTempDir` | 36-39 | 4 | `export function removeTempDir(dir) {` |
| `mkdtempTracked` | 51-57 | 7 | `export function mkdtempTracked(prefixPath) {` |
| `tempDir` | 65-71 | 7 | `export function tempDir(label = 'tmp', { t = null } = {}) {` |
| `tempRepo` | 79-85 | 7 | `export function tempRepo(label = 'repo', { t = null, name = '', email = '' } = {}) {` |
| `sweepStaleTempDirs` | 93-116 | 24 | `export function sweepStaleTempDirs({ maxAgeMs = 60 * 60 * 1000, log = null } = {}) {` |

### test/run-tests.mjs（201 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runBatch` | 118-150 | 33 | `function runBatch(files) {` |
| `emit` | 134-145 | 12 | `const emit = (chunk) => {` |

### test/tool/test-cli.mjs（1020 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `usageLines` | 60-70 | 11 | `function usageLines(helpText, cliName, command) {` |
| `helpOf` | 73-77 | 5 | `function helpOf(cliName) {` |
| `runCliFile` | 162-171 | 10 | `async function runCliFile(cliName, argv, opts = {}) {` |
| `runInWaves` | 174-180 | 7 | `async function runInWaves(tasks, waveSize = 4) {` |
| `run` | 385-390 | 6 | `const run = (file, args) => {` |
| `mockReact` | 504-510 | 7 | `function mockReact() {` |
| `req` | 824-841 | 18 | `const req = (name) => {` |
| `req` | 902-921 | 20 | `const req = (name) => {` |
| `req` | 970-988 | 19 | `const req = (name) => {` |

### test/tool/test-npm-tab-render.mjs（95 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `read` | 19-19 | 1 | `const read = (p) => readFileSync(join(ROOT, p), 'utf8');` |

### test/tool/test-picker-layout.mjs（111 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ruleBody` | 35-36 | 2 | `function ruleBody(cls) {` |

### test/tool/test-scan-and-cache.mjs（339 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFakeTree` | 42-64 | 23 | `function makeFakeTree() {` |
| `write` | 44-49 | 6 | `const write = (rel) => {` |
| `dryRunStats` | 145-152 | 8 | `function dryRunStats() {` |
| `keyOf` | 191-191 | 1 | `const keyOf = (abs) => cacheKeyFor(importClosure(abs));` |
| `makeProject` | 240-247 | 8 | `function makeProject() {` |

<!-- dshgp-functions:end -->
