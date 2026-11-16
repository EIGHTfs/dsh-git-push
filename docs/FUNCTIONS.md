# 函数列表

> 由 `scripts/doc-func.mjs` 维护：`gen` 打印 / `apply` 更新本节 / `check` 查漂移（扫描 lib/scripts/test 函数）。

<!-- dshgp-functions:start -->
## 函数列表

### lib/app/apply.js（296 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `apply` | 44-295 | 252 | `export async function apply(ctx, config = {}) {` |
| `envInjectText` | 106-145 | 40 | `const envInjectText = (cwdOverride) => {` |

### lib/app/command-registry.js（344 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditPreprocessAvailable` | 11-16 | 6 | `function auditPreprocessAvailable(cfg = {}, hasBuiltinEngine) {` |
| `resolveEntryParams` | 28-32 | 5 | `export function resolveEntryParams(entry, cfg, hasBuiltinEngine) {` |
| `applyFlagToken` | 282-298 | 17 | `function applyFlagToken(args, tok, rest, i, byFlag) {` |
| `validateParamConstraints` | 301-307 | 7 | `function validateParamConstraints(args, params) {` |
| `parseRegistryArgs` | 309-329 | 21 | `export function parseRegistryArgs(rest = [], params = []) {` |
| `registryByName` | 332-334 | 3 | `export function registryByName(name) {` |
| `registryByCli` | 337-339 | 3 | `export function registryByCli(cli) {` |
| `buildToolsListText` | 342-344 | 3 | `export function buildToolsListText() {` |

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

### lib/app/handlers/preprocess.js（108 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withHostApi` | 14-21 | 8 | `async function withHostApi(handler) {` |
| `listRuleSlots` | 30-33 | 4 | `export async function listRuleSlots(order, disabledSlots = [], hitStats = null) {` |
| `handleRuleSlots` | 36-49 | 14 | `export async function handleRuleSlots(ctx) {` |
| `handleRuleDetail` | 52-60 | 9 | `export async function handleRuleDetail(ctx) {` |
| `handleAudit` | 63-79 | 17 | `export async function handleAudit(ctx) {` |
| `handleToggleRule` | 82-89 | 8 | `export async function handleToggleRule(ctx) {` |
| `handleExemptHint` | 92-107 | 16 | `export async function handleExemptHint(ctx) {` |

### lib/app/handlers/repo-actions.js（145 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `handleRepoVisibility` | 17-22 | 6 | `export async function handleRepoVisibility(ctx) {` |
| `handleVisibilityGet` | 25-34 | 10 | `async function handleVisibilityGet({ query, env }) {` |
| `handleVisibilityPost` | 37-46 | 10 | `async function handleVisibilityPost({ body, env }) {` |
| `handleRepoPush` | 49-93 | 45 | `export async function handleRepoPush(ctx) {` |
| `handleRepoCommit` | 96-145 | 50 | `export async function handleRepoCommit(ctx) {` |

### lib/app/handlers/repos.js（256 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildLocalList` | 23-55 | 33 | `function buildLocalList(indexMap, root, deadline) {` |
| `isProbeOverBudget` | 66-68 | 3 | `export function isProbeOverBudget(deadline, now = Date.now()) {` |
| `applyLiveRemote` | 71-134 | 64 | `async function applyLiveRemote(list, deadline) {` |
| `handleReposLocal` | 137-158 | 22 | `export async function handleReposLocal(ctx) {` |
| `handleReposLocalScan` | 160-169 | 10 | `export function handleReposLocalScan(ctx) {` |
| `handleReposLocalScanWait` | 172-177 | 6 | `export async function handleReposLocalScanWait(ctx) {` |
| `refreshOneTarget` | 183-217 | 35 | `async function refreshOneTarget(t, env) {` |
| `handleReposLocalRefresh` | 220-229 | 10 | `export async function handleReposLocalRefresh(ctx) {` |
| `handleReposCloud` | 232-256 | 25 | `export async function handleReposCloud(ctx) {` |

### lib/app/handlers/settings.js（70 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `handleSettingsGet` | 13-19 | 7 | `export function handleSettingsGet(ctx) {` |
| `handleSettingsSet` | 25-70 | 46 | `export async function handleSettingsSet(ctx) {` |

### lib/app/handlers/workspace-paths.js（108 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pathsFromBody` | 24-28 | 5 | `function pathsFromBody(body) {` |
| `handleWorkspacePathsGet` | 31-49 | 19 | `export function handleWorkspacePathsGet() {` |
| `handleWorkspacePathsSet` | 52-107 | 56 | `export function handleWorkspacePathsSet(ctx) {` |

### lib/app/http-handlers.js（214 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `adaptHttpHandler` | 45-67 | 23 | `export async function adaptHttpHandler(req, res, env, cfg) {` |
| `readBody` | 70-84 | 15 | `function readBody(req) {` |
| `buildCtx` | 87-89 | 3 | `function buildCtx(req, method, env, cfg, query, body, path) {` |
| `withDeprecation` | 111-120 | 10 | `function withDeprecation(result, successorPath) {` |
| `handleHttp` | 130-213 | 84 | `export async function handleHttp(req = {}, env = {}, cfg = defaultConfig()) {` |

### lib/app/inject-text.js（200 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildIdentityInjectionText` | 74-84 | 11 | `export function buildIdentityInjectionText() {` |
| `buildRequirementsInjectionText` | 86-98 | 13 | `export function buildRequirementsInjectionText() {` |
| `detectHostIp` | 119-130 | 12 | `function detectHostIp() {` |
| `buildAuditApiGuide` | 136-170 | 35 | `export function buildAuditApiGuide(repo = '', opts = {}) {` |
| `formatAuditBlock` | 172-199 | 28 | `export function formatAuditBlock(r = {}) {` |

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

### lib/app/schema-preprocess.js（43 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditConfigShape` | 23-42 | 20 | `export function auditConfigShape(Schema) {` |

### lib/app/schema.js（151 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFallbackSchema` | 33-78 | 46 | `function makeFallbackSchema() {` |
| `fn` | 35-35 | 1 | `const fn = (v) => (v === undefined ? meta.default : v);` |
| `redactConfig` | 142-150 | 9 | `export function redactConfig(cfg = {}) {` |

### lib/app/settings-bridge.js（218 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `applyTypedKeys` | 57-66 | 10 | `function applyTypedKeys(cfg, patch) {` |
| `applyClampedNumbers` | 69-77 | 9 | `function applyClampedNumbers(cfg, patch) {` |
| `applySettingsToCfg` | 79-86 | 8 | `export function applySettingsToCfg(cfg, patch) {` |
| `setSettingsFileOverride` | 90-92 | 3 | `export function setSettingsFileOverride(path) {` |
| `settingsFilePath` | 95-98 | 4 | `export function settingsFilePath({ workspaceRoot = '' } = {}) {` |
| `settingsLogFilePath` | 106-109 | 4 | `export function settingsLogFilePath({ workspaceRoot = '' } = {}) {` |
| `appendSettingsLog` | 116-140 | 25 | `export function appendSettingsLog(entry, env = {}) {` |
| `httpRejectLogFilePath` | 148-150 | 3 | `export function httpRejectLogFilePath({ workspaceRoot = '' } = {}) {` |
| `appendHttpRejectLog` | 160-191 | 32 | `export function appendHttpRejectLog(entry = {}, env = {}) {` |
| `readSettings` | 198-200 | 3 | `export function readSettings(env = {}) {` |
| `writeSettingsKey` | 209-218 | 10 | `export async function writeSettingsKey(key, jsonValue, env = {}) {` |

### lib/app/severity.js（15 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isBlockerSeverity` | 11-14 | 4 | `export function isBlockerSeverity(finding) {` |

### lib/app/slash-commands.js（396 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `sessionCwdOf` | 25-28 | 4 | `export function sessionCwdOf(invocation) {` |
| `findGitRoot` | 41-51 | 11 | `export function findGitRoot(dir) {` |
| `resolveTargetPath` | 58-64 | 7 | `export function resolveTargetPath(rawPath, { sessionCwd = '' } = {}) {` |
| `parseCommandInput` | 74-90 | 17 | `export function parseCommandInput(raw = '', flags = [], usage = '') {` |
| `rejectRepo` | 93-95 | 3 | `function rejectRepo(usage, example, detail) {` |
| `parseGitAuditInput` | 105-109 | 5 | `export function parseGitAuditInput(raw = '') {` |
| `resolveAuditRepo` | 112-114 | 3 | `export function resolveAuditRepo(rawPath, opts) {` |
| `formatGitAuditCommandText` | 120-140 | 21 | `export function formatGitAuditCommandText(r = {}) {` |
| `runGitAuditCommand` | 143-167 | 25 | `export async function runGitAuditCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {` |
| `formatGitScanCommandText` | 175-192 | 18 | `export function formatGitScanCommandText(r = {}) {` |
| `runGitScanCommand` | 194-208 | 15 | `export async function runGitScanCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {` |
| `formatIoScanCommandText` | 219-246 | 28 | `export function formatIoScanCommandText(r = {}) {` |
| `runGitIoScanCommand` | 253-265 | 13 | `export async function runGitIoScanCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {` |
| `formatLinkCheckCommandText` | 273-284 | 12 | `export function formatLinkCheckCommandText(r = {}) {` |
| `runLinkCheckCommand` | 286-295 | 10 | `export async function runLinkCheckCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {` |
| `runGitAccountCommand` | 301-305 | 5 | `export async function runGitAccountCommand({ env = {}, cfg = {}, log = null } = {}) {` |
| `formatClonePreviewCommandText` | 315-337 | 23 | `export function formatClonePreviewCommandText(r = {}) {` |
| `runGitClonePreviewCommand` | 339-350 | 12 | `export async function runGitClonePreviewCommand({ rawInput = '', env = {}, cfg = {}, log = null } = {}) {` |
| `registerSlashCommands` | 371-395 | 25 | `export function registerSlashCommands(ctx, { env = {}, cfg = {}, log = null } = {}) {` |

### lib/app/slot-stats.js（36 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setLastSlotHitStats` | 20-25 | 6 | `export function setLastSlotHitStats(stats, repo = '') {` |
| `getLastSlotHitStats` | 28-30 | 3 | `export function getLastSlotHitStats() {` |
| `getLastSlotHitMeta` | 33-35 | 3 | `export function getLastSlotHitMeta() {` |

### lib/app/tool-call.js（782 行 · 24 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pushWithPostSteps` | 53-121 | 69 | `async function pushWithPostSteps(args, env, cfg) {` |
| `pushJobOutcome` | 142-174 | 33 | `export function pushJobOutcome(r = {}) {` |
| `short` | 144-144 | 1 | `const short = (sha) => String(sha \|\| '').slice(0, 8);` |
| `cloneJobOutcome` | 182-187 | 6 | `export function cloneJobOutcome(r = {}) {` |
| `buildCommitPushJobSpec` | 190-207 | 18 | `function buildCommitPushJobSpec(repo, doPush) {` |
| `done` | 195-203 | 9 | `const done = (async () => {` |
| `startHostJob` | 220-227 | 8 | `function startHostJob(jobs, spec, owner) {` |
| `callCloneJob` | 241-273 | 33 | `async function callCloneJob(args, jobs, exec, log, env = {}, cfg = {}) {` |
| `callNpmPublishJob` | 281-364 | 84 | `async function callNpmPublishJob(args = {}, jobs, exec, log, env = {}, cfg = {}) {` |
| `outcome` | 315-339 | 25 | `const outcome = (r) => {` |
| `done` | 348-350 | 3 | `const done = (async () => {` |
| `buildCloneJobSpec` | 367-384 | 18 | `function buildCloneJobSpec(target, dest, doClone) {` |
| `done` | 372-380 | 9 | `const done = (async () => {` |
| `callCommitPush` | 391-437 | 47 | `async function callCommitPush(args, env, cfg, log, jobs, exec) {` |
| `doPush` | 410-410 | 1 | `const doPush = () => pushWithPostSteps(args, env, cfg);` |
| `buildAuditOpts` | 448-462 | 15 | `function buildAuditOpts(args, cfg, scope) {` |
| `runHistoryAuditTool` | 468-496 | 29 | `async function runHistoryAuditTool(args, env, cfg, jobs, exec, weights) {` |
| `doHistory` | 473-479 | 7 | `const doHistory = async () => {` |
| `callCodeAudit` | 498-510 | 13 | `async function callCodeAudit(args, env, cfg, log, jobs, exec) {` |
| `runStandardAuditTool` | 513-533 | 21 | `async function runStandardAuditTool(args, env, cfg, log, weights) {` |
| `callTool` | 535-782 | 248 | `export async function callTool(toolName, args = {}, env = {}, cfg = defaultConfig(), log = null, jobs = null, exec = null, fsCtx = null) {` |
| `withAuditPackage` | 747-753 | 7 | `async function withAuditPackage(call) {` |
| `shellSplit` | 756-774 | 19 | `function shellSplit(input) {` |
| `readTextSafe` | 777-781 | 5 | `function readTextSafe(path = '') {` |

### lib/app/tools.js（41 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `paramsToParameters` | 16-30 | 15 | `function paramsToParameters(params = [], cfg) {` |
| `listTools` | 33-41 | 9 | `export function listTools(cfg, hasBuiltinEngine) {` |

### lib/cli/commands-account.mjs（108 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `cmdAccountCheck` | 23-30 | 8 | `export async function cmdAccountCheck(flags) {` |
| `cmdCredEnv` | 33-47 | 15 | `export async function cmdCredEnv(flags) {` |
| `cmdRemoteCreate` | 50-65 | 16 | `export async function cmdRemoteCreate(repo, flags) {` |
| `cmdSetVisibility` | 68-82 | 15 | `export async function cmdSetVisibility(repo, flags) {` |
| `cmdGenSshKey` | 85-96 | 12 | `export async function cmdGenSshKey(flags) {` |
| `resolveRepoOwnerName` | 99-107 | 9 | `async function resolveRepoOwnerName(repoPath) {` |

### lib/cli/commands-doc.mjs（79 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `cmdTreeDoc` | 20-32 | 13 | `export async function cmdTreeDoc(sub, flags) {` |
| `cmdFunctions` | 35-57 | 23 | `export async function cmdFunctions(op, target, flags) {` |
| `cmdModuleSplitter` | 60-78 | 19 | `export async function cmdModuleSplitter(positional = [], flags = {}) {` |

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

### lib/cli/commands-vcs.mjs（177 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pathExists` | 34-36 | 3 | `async function pathExists(p) {` |
| `cmdRepos` | 39-56 | 18 | `export function cmdRepos(root, flags) {` |
| `cmdIndex` | 59-77 | 19 | `export async function cmdIndex(root, flags) {` |
| `cmdGit` | 80-88 | 9 | `export async function cmdGit(args = []) {` |
| `cmdCommit` | 91-122 | 32 | `export async function cmdCommit(root, flags) {` |
| `cmdLinkCheck` | 125-135 | 11 | `export async function cmdLinkCheck(root = '.') {` |
| `runClonePreview` | 138-151 | 14 | `async function runClonePreview(target, flags) {` |
| `printCloneResult` | 154-166 | 13 | `function printCloneResult(r, flags, target, dest) {` |
| `cmdClone` | 169-176 | 8 | `export async function cmdClone(flags, positional) {` |

### lib/cli/shared.mjs（478 行 · 20 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `commandOwner` | 70-76 | 7 | `export function commandOwner(command) {` |
| `allCommands` | 79-81 | 3 | `export function allCommands() {` |
| `cliPluginConfig` | 94-103 | 10 | `export function cliPluginConfig() {` |
| `versionLine` | 106-108 | 3 | `export function versionLine(cliName) {` |
| `buildCrossCliHint` | 115-125 | 11 | `export function buildCrossCliHint({ command = '', argvRest = [], fromCli = '' } = {}) {` |
| `defaultFlags` | 174-183 | 10 | `function defaultFlags() {` |
| `applyBoolFlag` | 186-191 | 6 | `function applyBoolFlag(flags, token) {` |
| `applyValueFlag` | 194-197 | 4 | `function applyValueFlag(flags, token, rawValue) {` |
| `parseArgv` | 206-224 | 19 | `export function parseArgv(argv = []) {` |
| `parseVia` | 227-240 | 14 | `export function parseVia(run) {` |
| `printToolResult` | 248-255 | 8 | `export function printToolResult(result, asJson) {` |
| `readableResultLines` | 263-271 | 9 | `function readableResultLines(result) {` |
| `printVersion` | 274-276 | 3 | `export function printVersion(cliName) {` |
| `resolveDispatch` | 286-328 | 43 | `export function resolveDispatch({ cliName = CLI_GIT, argv = [], commands = new Map() } = {}) {` |
| `normalizeRegistryArgv` | 342-356 | 15 | `export function normalizeRegistryArgv(rest = [], params = []) {` |
| `runCli` | 369-417 | 49 | `export async function runCli({` |
| `isDirectRun` | 427-435 | 9 | `export function isDirectRun(moduleUrl) {` |
| `runAsEntry` | 442-453 | 12 | `export function runAsEntry(moduleUrl, main) {` |
| `readEntrySource` | 462-464 | 3 | `export function readEntrySource(relPath) {` |
| `parseEntrySourceMeta` | 471-477 | 7 | `export function parseEntrySourceMeta(sourceText = '') {` |

### lib/client-parts/git/account.js（84 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_AcctHead` | 3-17 | 15 | `function dshgp_AcctHead(props) {` |
| `dshgp_AccountCard` | 20-64 | 45 | `function dshgp_AccountCard(props) {` |
| `dshgp_AccountTab` | 67-82 | 16 | `function dshgp_AccountTab(props) {` |

### lib/client-parts/git/apply.js（73 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `apply` | 2-66 | 65 | `function apply(ctx) {` |
| `useCardState` | 42-45 | 4 | `const useCardState = (selector) => {` |
| `SectionPage` | 48-53 | 6 | `function SectionPage() {` |

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

### lib/client-parts/git/controller.js（1105 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `tick` | 492-510 | 19 | `const tick = async () => {` |
| `renderResult` | 1003-1016 | 14 | `const renderResult = (res) => {` |
| `poll` | 1019-1044 | 26 | `const poll = async () => {` |

### lib/client-parts/git/npm.js（385 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_NpmAccountCard` | 10-59 | 50 | `function dshgp_NpmAccountCard(props) {` |
| `dshgp_NpmInstallForm` | 62-125 | 64 | `function dshgp_NpmInstallForm(props) {` |
| `dshgp_NpmPanel` | 128-287 | 160 | `function dshgp_NpmPanel(props) {` |
| `doInstall` | 160-176 | 17 | `const doInstall = async () => {` |
| `dshgp_AccountSwitcher` | 293-331 | 39 | `function dshgp_AccountSwitcher(props) {` |
| `dshgp_NpmCredFields` | 334-383 | 50 | `function dshgp_NpmCredFields() {` |
| `save` | 346-362 | 17 | `const save = async () => {` |

### lib/client-parts/git/page.js（47 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_GitPushPage` | 2-45 | 44 | `function dshgp_GitPushPage(props) {` |

### lib/client-parts/git/repo.js（375 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_RepoManagerCard` | 2-35 | 34 | `function dshgp_RepoManagerCard(props) {` |
| `dshgp_RepoLocalRow` | 38-116 | 79 | `function dshgp_RepoLocalRow(props) {` |
| `dshgp_RepoLocalPane` | 119-156 | 38 | `function dshgp_RepoLocalPane(props) {` |
| `dshgp_RepoCloudRow` | 159-206 | 48 | `function dshgp_RepoCloudRow(props) {` |
| `dshgp_VisConfirmDialog` | 212-240 | 29 | `function dshgp_VisConfirmDialog(props) {` |
| `dshgp_RepoCloudPane` | 243-294 | 52 | `function dshgp_RepoCloudPane(props) {` |
| `dshgp_CloneProgress` | 305-322 | 18 | `function dshgp_CloneProgress(props) {` |
| `mb` | 307-307 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |
| `dshgp_ClonePreview` | 330-373 | 44 | `function dshgp_ClonePreview(props) {` |
| `mb` | 332-332 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |

### lib/client-parts/git/settings.js（147 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_CredentialBlock` | 2-69 | 68 | `function dshgp_CredentialBlock(props) {` |
| `dshgp_PushDefaultsBlock` | 72-134 | 63 | `function dshgp_PushDefaultsBlock(props) {` |
| `dshgp_SettingsTab` | 136-145 | 10 | `function dshgp_SettingsTab(props) {` |

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

### lib/client.js（2937 行 · 44 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_ensureCss` | 254-262 | 9 | `function dshgp_ensureCss() {` |
| `dshgp_getJson` | 265-268 | 4 | `async function dshgp_getJson(url) {` |
| `dshgp_postJson` | 270-279 | 10 | `async function dshgp_postJson(url, payload, timeoutMs) {` |
| `dshgp_tokenConfigured` | 287-291 | 5 | `function dshgp_tokenConfigured(value) {` |
| `dshgp_localGet` | 298-300 | 3 | `function dshgp_localGet(key) {` |
| `dshgp_localSet` | 303-305 | 3 | `function dshgp_localSet(key, value) {` |
| `dshgp_copyText` | 308-313 | 6 | `function dshgp_copyText(text) {` |
| `dshgp_AcctHead` | 329-343 | 15 | `function dshgp_AcctHead(props) {` |
| `dshgp_AccountCard` | 346-390 | 45 | `function dshgp_AccountCard(props) {` |
| `dshgp_AccountTab` | 393-408 | 16 | `function dshgp_AccountTab(props) {` |
| `dshgp_browseEnsureDom` | 418-446 | 29 | `function dshgp_browseEnsureDom() {` |
| `dshgp_browseGuess` | 447-449 | 3 | `function dshgp_browseGuess() {` |
| `dshgp_browseRemember` | 450-452 | 3 | `function dshgp_browseRemember(p) {` |
| `dshgp_browseLoad` | 453-486 | 34 | `async function dshgp_browseLoad(p) {` |
| `dshgp_browseOpen` | 487-495 | 9 | `function dshgp_browseOpen(input, onPick) {` |
| `dshgp_browseClose` | 496-502 | 7 | `function dshgp_browseClose() {` |
| `dshgp_browseAttach` | 503-513 | 11 | `function dshgp_browseAttach(inputEl) {` |
| `dshgp_RepoManagerCard` | 517-550 | 34 | `function dshgp_RepoManagerCard(props) {` |
| `dshgp_RepoLocalRow` | 553-631 | 79 | `function dshgp_RepoLocalRow(props) {` |
| `dshgp_RepoLocalPane` | 634-671 | 38 | `function dshgp_RepoLocalPane(props) {` |
| `dshgp_RepoCloudRow` | 674-721 | 48 | `function dshgp_RepoCloudRow(props) {` |
| `dshgp_VisConfirmDialog` | 727-755 | 29 | `function dshgp_VisConfirmDialog(props) {` |
| `dshgp_RepoCloudPane` | 758-809 | 52 | `function dshgp_RepoCloudPane(props) {` |
| `dshgp_CloneProgress` | 820-837 | 18 | `function dshgp_CloneProgress(props) {` |
| `mb` | 822-822 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |
| `dshgp_ClonePreview` | 845-888 | 44 | `function dshgp_ClonePreview(props) {` |
| `mb` | 847-847 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |
| `dshgp_NpmAccountCard` | 899-948 | 50 | `function dshgp_NpmAccountCard(props) {` |
| `dshgp_NpmInstallForm` | 951-1014 | 64 | `function dshgp_NpmInstallForm(props) {` |
| `dshgp_NpmPanel` | 1017-1176 | 160 | `function dshgp_NpmPanel(props) {` |
| `doInstall` | 1049-1065 | 17 | `const doInstall = async () => {` |
| `dshgp_AccountSwitcher` | 1182-1220 | 39 | `function dshgp_AccountSwitcher(props) {` |
| `dshgp_NpmCredFields` | 1223-1272 | 50 | `function dshgp_NpmCredFields() {` |
| `save` | 1235-1251 | 17 | `const save = async () => {` |
| `dshgp_CredentialBlock` | 1275-1342 | 68 | `function dshgp_CredentialBlock(props) {` |
| `dshgp_PushDefaultsBlock` | 1345-1407 | 63 | `function dshgp_PushDefaultsBlock(props) {` |
| `dshgp_SettingsTab` | 1409-1418 | 10 | `function dshgp_SettingsTab(props) {` |
| `dshgp_GitPushPage` | 1421-1464 | 44 | `function dshgp_GitPushPage(props) {` |
| `tick` | 1957-1975 | 19 | `const tick = async () => {` |
| `renderResult` | 2468-2481 | 14 | `const renderResult = (res) => {` |
| `poll` | 2484-2509 | 26 | `const poll = async () => {` |
| `apply` | 2866-2930 | 65 | `function apply(ctx) {` |
| `useCardState` | 2906-2909 | 4 | `const useCardState = (selector) => {` |
| `SectionPage` | 2912-2917 | 6 | `function SectionPage() {` |

### lib/client/index.js（162 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `defaultConfig` | 54-58 | 5 | `export function defaultConfig() {` |
| `resolveConfig` | 66-78 | 13 | `export function resolveConfig(patch = {}, base = defaultConfig()) {` |
| `createSettingsCard` | 86-128 | 43 | `export function createSettingsCard(react, { config = defaultConfig(), onChange = () => {}, labels = {} } = {}) {` |
| `collectExternalRefs` | 136-141 | 6 | `export function collectExternalRefs(css = '') {` |
| `clientModuleInfo` | 151-162 | 12 | `export function clientModuleInfo() {` |

### lib/commit-push.js（282 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `defaultPreprocessRender` | 37-52 | 16 | `export function defaultPreprocessRender(ctx = {}) {` |
| `runAudit` | 63-233 | 171 | `export async function runAudit({` |
| `isExemptFile` | 153-153 | 1 | `const isExemptFile = (finding) => exemptSet.has(String(finding.file \|\| '').replace(/\\/g, '/').replace(/^\.\//, ''));` |
| `commitWithAudit` | 243-268 | 26 | `export async function commitWithAudit({` |
| `commitMany` | 276-282 | 7 | `export async function commitMany({ repos = [], message = '', push = true, dryRun = false, requirementsConfirmed = false, customIgnorePatterns = '' } = {}) {` |

### lib/commit-push/pre-commit-engine.js（436 行 · 17 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pluginRootDir` | 60-62 | 3 | `export function pluginRootDir() {` |
| `stderrTail` | 69-72 | 4 | `export function stderrTail(text) {` |
| `resolvePreCommitConfig` | 85-112 | 28 | `export function resolvePreCommitConfig(cfg = {}) {` |
| `readPreCommitBlock` | 119-132 | 14 | `function readPreCommitBlock(cfg = {}) {` |
| `isExecutableFile` | 139-148 | 10 | `function isExecutableFile(absPath) {` |
| `searchCommandOnPath` | 155-171 | 17 | `function searchCommandOnPath(commandName) {` |
| `resolvePathLikeCommand` | 178-182 | 5 | `function resolvePathLikeCommand(pathLike) {` |
| `resolveEngineCommand` | 192-198 | 7 | `export function resolveEngineCommand(command) {` |
| `resolveEngineArgs` | 209-217 | 9 | `export function resolveEngineArgs(args = []) {` |
| `toSlotCsv` | 224-229 | 6 | `function toSlotCsv(slots) {` |
| `buildEngineArgs` | 237-265 | 29 | `export function buildEngineArgs({` |
| `formatCommandLine` | 273-275 | 3 | `export function formatCommandLine(command, args = []) {` |
| `failClosed` | 284-286 | 3 | `function failClosed(message) {` |
| `parseEngineStdout` | 295-313 | 19 | `export function parseEngineStdout(stdout) {` |
| `runEngineProcess` | 323-370 | 48 | `function runEngineProcess({ command, args, timeoutMs }) {` |
| `finish` | 333-338 | 6 | `const finish = (result) => {` |
| `runPreCommitEngine` | 386-435 | 50 | `export async function runPreCommitEngine({` |

### lib/context/index.js（364 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadToolProbeTemplate` | 103-121 | 19 | `export function loadToolProbeTemplate(file = TEMPLATE_FILE) {` |
| `probeToolPath` | 132-163 | 32 | `export function probeToolPath(name, versionArgs = []) {` |
| `collectToolPaths` | 173-187 | 15 | `export function collectToolPaths(probes = null, { templateFile = TEMPLATE_FILE, resultFile = '' } = {}) {` |
| `writeToolResult` | 195-202 | 8 | `export function writeToolResult(file = '', results = []) {` |
| `mapWorkspaceDirs` | 209-240 | 32 | `export function mapWorkspaceDirs({ workspaceRoot = '', cwd = process.cwd(), maxChildren = 40 } = {}) {` |
| `detectLocalHost` | 261-276 | 16 | `export function detectLocalHost() {` |
| `createEnvInjectionText` | 278-308 | 31 | `export function createEnvInjectionText({ cwd = '', projectRoot = '', tools = DEFAULT_TOOLS, workspace = null, host = null } = {}) {` |
| `isWithinRoot` | 316-328 | 13 | `export function isWithinRoot(root = '', target = '') {` |
| `norm` | 317-322 | 6 | `const norm = (p) => {` |
| `parseEnvInjection` | 335-364 | 30 | `export function parseEnvInjection(text = '') {` |

### lib/core/atomic-json.js（99 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readJson` | 19-27 | 9 | `export function readJson(file) {` |
| `readJsonAny` | 34-41 | 8 | `export function readJsonAny(file) {` |
| `writeJsonAtomic` | 50-63 | 14 | `export function writeJsonAtomic(file, data, { mode = 0o600, pretty = true } = {}) {` |
| `updateJsonAtomic` | 72-76 | 5 | `export function updateJsonAtomic(file, updater, { mode = 0o600 } = {}) {` |
| `writeTextAtomic` | 86-98 | 13 | `export function writeTextAtomic(file, text, { mode = 0o600 } = {}) {` |

### lib/core/config.js（41 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadRequirements` | 23-40 | 18 | `export function loadRequirements() {` |

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

### lib/core/exec.js（273 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `gitSearchPlan` | 44-51 | 8 | `export function gitSearchPlan(pathValue, { delimiter = pathDelimiter, platform = process.platform } = {}) {` |
| `resolveGitBin` | 54-71 | 18 | `export function resolveGitBin() {` |
| `runGit` | 87-109 | 23 | `export function runGit(args, { cwd = '', timeoutMs = 120_000, env = {}, noMirror = false } = {}) {` |
| `gitRaw` | 117-133 | 17 | `export function gitRaw(args, { cwd = '', timeoutMs = 600_000 } = {}) {` |
| `runGitAsync` | 143-164 | 22 | `export function runGitAsync(args, { cwd = '', timeoutMs = 120_000, env = {}, noMirror = false } = {}) {` |
| `runGitStream` | 188-272 | 85 | `export function runGitStream(args, { cwd = '', env = {}, noMirror = false, stallMs, onProgress } = {}) {` |
| `feed` | 222-237 | 16 | `const feed = (chunk, isErr) => {` |
| `signal` | 243-250 | 8 | `const signal = (sig) => {` |
| `finish` | 259-268 | 10 | `const finish = (code, errMsg) => {` |

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

### lib/git/module-splitter.js（48 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runModuleSplitter` | 28-47 | 20 | `export function runModuleSplitter({ sub = '', target = '', dryRun = false } = {}) {` |

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

### lib/git/push.js（558 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveRepoIdentity` | 39-45 | 7 | `function resolveRepoIdentity(repoPath) {` |
| `commitAndPush` | 59-302 | 244 | `export async function commitAndPush({` |
| `legacyIdentity` | 195-204 | 10 | `const legacyIdentity = (() => {` |
| `collectCi` | 248-255 | 8 | `const collectCi = async () => {` |
| `fetchRemoteBranchRef` | 315-328 | 14 | `async function fetchRemoteBranchRef(repoPath, branch, owner, repo) {` |
| `enhanceAfterPushSuccess` | 336-486 | 151 | `async function enhanceAfterPushSuccess({ repoPath, pr, token, steps, commitSha, remote = '' }) {` |
| `lsRemoteProbe` | 395-416 | 22 | `const lsRemoteProbe = () => {` |
| `lsRemoteSha` | 418-418 | 1 | `const lsRemoteSha = () => lsRemoteProbe().sha;` |
| `readmeCheckHint` | 491-496 | 6 | `export function readmeCheckHint(repoPath) {` |
| `pushCurrentBranch` | 505-557 | 53 | `export async function pushCurrentBranch({ repoPath = '', pushMethod = 'ssh', remote = '' } = {}) {` |

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

### lib/git/repo-index.js（524 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `locateRepoIndex` | 40-43 | 4 | `export function locateRepoIndex(workspaceRoot) {` |
| `readRepoIndexMap` | 46-79 | 34 | `export function readRepoIndexMap(workspaceRoot) {` |
| `indexEntryForRepo` | 82-86 | 5 | `export function indexEntryForRepo(localPath, indexMap) {` |
| `parseMdFrontmatterName` | 91-96 | 6 | `export function parseMdFrontmatterName(content) {` |
| `collectProjectSkills` | 99-129 | 31 | `export async function collectProjectSkills(projectPath) {` |
| `exists` | 132-134 | 3 | `async function exists(p) {` |
| `parseManualVisibility` | 137-149 | 13 | `export function parseManualVisibility(existingContent) {` |
| `queryGitHubVisibility` | 152-163 | 12 | `async function queryGitHubVisibility(repoName, token, owner = 'EIGHTfs') {` |
| `remoteToRepoInfo` | 166-175 | 10 | `function remoteToRepoInfo(remote, visibility) {` |
| `buildRepoIndexVisibility` | 178-194 | 17 | `async function buildRepoIndexVisibility({ repos, token, manualVisibility, owner }) {` |
| `buildRepoIndexLocalOnly` | 197-210 | 14 | `async function buildRepoIndexLocalOnly({ workspaceRoot, repos, localOnlyExtra }) {` |
| `buildRepoIndex` | 217-263 | 47 | `export async function buildRepoIndex({ workspaceRoot, depth = 20, extraRepos = [], extraReposFile = '', token = '', manualVisibility = {}, localOnlyExtra = [], owner = 'EIGHTfs', offline = false, maxRepos = 200 } = {}) {` |
| `repoList` | 234-241 | 8 | `const repoList = (await Promise.all(ownedRepos.map(async (r) => {` |
| `syncRepoIndex` | 269-293 | 25 | `export function syncRepoIndex({ content, workspaceRoot = '', owner = 'EIGHTfs', syncTarget = '' } = {}) {` |
| `mergeFreshIntoExisting` | 308-355 | 48 | `function mergeFreshIntoExisting(existing, freshContent) {` |
| `updateRepoIndex` | 372-402 | 31 | `export async function updateRepoIndex({ workspaceRoot = '', token = '', owner = 'EIGHTfs', depth = 20, extraRepos = [], extraReposFile = '', syncTarget = '', offline = false, maxRepos = 200, mode = 'rebuild', cloudRepos = [], repoName = '', remoteState = {} } = {}) {` |
| `maintainRepoIndex` | 409-412 | 4 | `export async function maintainRepoIndex({ workspaceRoot = '', token = '', owner = 'EIGHTfs', depth = 20, extraRepos = [], extraReposFile = '', syncTarget = '', offline = false, maxRepos = 200 } = {}) {` |
| `mergeCloudReposIntoIndex` | 427-480 | 54 | `export function mergeCloudReposIntoIndex({ workspaceRoot = '', owner = 'EIGHTfs', cloudRepos = [], syncTarget = '' } = {}) {` |
| `updateRepoRemoteStateInIndex` | 497-523 | 27 | `export function updateRepoRemoteStateInIndex({ workspaceRoot = '', repoName = '', remoteState = {}, syncTarget = '' } = {}) {` |

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

### lib/npm/install.js（212 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `installingKeys` | 24-26 | 3 | `export function installingKeys() {` |
| `validatePackageNames` | 29-39 | 11 | `export function validatePackageNames(names = []) {` |
| `validateDest` | 42-52 | 11 | `export function validateDest(dest = '') {` |
| `buildInstallArgs` | 55-61 | 7 | `export function buildInstallArgs({ names = [], global = false, dest = '', ignoreScripts = true } = {}) {` |
| `appendInstallLog` | 64-72 | 9 | `function appendInstallLog(line, { workspaceRoot = '' } = {}) {` |
| `installPackages` | 80-118 | 39 | `export function installPackages({` |
| `startInstall` | 133-194 | 62 | `export function startInstall({` |
| `push` | 165-172 | 8 | `const push = (buf) => {` |
| `installProgress` | 200-211 | 12 | `export function installProgress({ consume = false } = {}) {` |

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

### lib/npm/publish.js（300 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `sleep` | 26-28 | 3 | `function sleep(ms) {` |
| `publishingKeys` | 34-36 | 3 | `export function publishingKeys() {` |
| `readPackageInfo` | 39-54 | 16 | `export function readPackageInfo(dir = '') {` |
| `fetchPublishedVersions` | 57-77 | 21 | `export async function fetchPublishedVersions({ name, registry = DEFAULT_REGISTRY, timeoutMs = NPM_TIMEOUT_MS } = {}) {` |
| `parsePackOutput` | 92-300 | 209 | `export function parsePackOutput(text = '', { maxCandidates = 200 } = {}) {` |
| `packDryRun` | 109-140 | 32 | `export function packDryRun({ dir, registry = DEFAULT_REGISTRY, workspaceRoot = '', token = '', timeoutMs = PUBLISH_TIMEOUT_MS } = {}) {` |
| `appendPublishLog` | 143-151 | 9 | `function appendPublishLog(line, { workspaceRoot = '' } = {}) {` |
| `publishPackage` | 158-299 | 142 | `export async function publishPackage({` |

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

### lib/plugin/auto-push.js（154 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `registerAutoPush` | 41-154 | 114 | `export function registerAutoPush(ctx, { cfg = {}, onPushAfterCommit } = {}) {` |
| `schedule` | 55-68 | 14 | `function schedule(session, event) {` |
| `runCheck` | 70-87 | 18 | `async function runCheck(session, turn) {` |
| `resolveTargets` | 90-105 | 16 | `function resolveTargets(session) {` |
| `gateCommit` | 108-118 | 11 | `async function gateCommit(repoPath) {` |
| `runAutoPush` | 120-140 | 21 | `async function runAutoPush(session, turn, log2) {` |

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

### lib/preprocess/providers.js（192 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `getProviderDefinition` | 46-48 | 3 | `export function getProviderDefinition(providerId = DEFAULT_PROVIDER_ID) {` |
| `providerEnvName` | 51-53 | 3 | `export function providerEnvName(providerId) {` |
| `resolveProvider` | 60-90 | 31 | `export function resolveProvider(providerId = DEFAULT_PROVIDER_ID) {` |
| `resolveGateProvider` | 97-99 | 3 | `export function resolveGateProvider() {` |
| `listProviderManifests` | 115-140 | 26 | `export async function listProviderManifests() {` |
| `findActionProvider` | 149-159 | 11 | `export async function findActionProvider(action) {` |
| `findEndpointProvider` | 167-177 | 11 | `export async function findEndpointProvider(subPath, method) {` |
| `listDeclaredCapabilities` | 180-191 | 12 | `export async function listDeclaredCapabilities() {` |

### lib/self/index.js（197 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readmeTemplate` | 77-142 | 66 | `export function readmeTemplate({ name = 'dsh-git-push', description = 'DSH git 自动提交推送插件——统一函数入口架构', version = VERSION, versionTable = '' } = {}) {` |
| `yamlTemplate` | 145-157 | 13 | `export function yamlTemplate() {` |
| `selfVersion` | 160-162 | 3 | `export function selfVersion() {` |
| `versionInfo` | 169-181 | 13 | `export function versionInfo(pkgJson = '') {` |
| `helpSync` | 190-196 | 7 | `export function helpSync(helpText = '', knownFlags = []) {` |

### lib/skip-dirs.js（76 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditRulesDir` | 36-38 | 3 | `export function auditRulesDir() {` |
| `loadYamlBlacklistDirs` | 46-65 | 20 | `export function loadYamlBlacklistDirs() {` |
| `getSkipSet` | 71-75 | 5 | `export function getSkipSet() {` |

### scripts/build-client.mjs（134 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readParts` | 68-74 | 7 | `export function readParts(order = PART_ORDER, dir = PARTS_DIR) {` |
| `buildClient` | 79-82 | 4 | `export function buildClient(order = PART_ORDER, dir = PARTS_DIR) {` |
| `checkShape` | 85-94 | 10 | `export function checkShape(code) {` |
| `main` | 98-129 | 32 | `function main(argv = process.argv.slice(2)) {` |

### scripts/bump-version.mjs（179 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseArgs` | 39-50 | 12 | `function parseArgs(argv) {` |
| `cmpVer` | 55-60 | 6 | `function cmpVer(a, b) {` |
| `bumpPatch` | 63-66 | 4 | `function bumpPatch(v) {` |
| `readJson` | 68-70 | 3 | `function readJson(p) {` |
| `buildVersionLine` | 83-100 | 18 | `function buildVersionLine(oldLine, newVer, oldVer, message, commentOverride = '') {` |

### scripts/check.mjs（206 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectJs` | 22-31 | 10 | `function collectJs(dir, acc = []) {` |
| `collectJson` | 34-42 | 9 | `function collectJson(dir, acc = []) {` |
| `layerOf` | 151-158 | 8 | `const layerOf = (rel) => {` |

### scripts/doc-drift.mjs（201 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countRules` | 32-42 | 11 | `export function countRules(root = ROOT) {` |
| `docFiles` | 45-53 | 9 | `function docFiles(root = ROOT) {` |
| `countSettings` | 60-70 | 11 | `export function countSettings(root = ROOT) {` |
| `countRoutes` | 76-85 | 10 | `export function countRoutes(root = ROOT) {` |
| `findCountDrift` | 92-130 | 39 | `export function findCountDrift(root = ROOT, actual = countRules(root), toolCount = null) {` |
| `findToolListGaps` | 137-145 | 9 | `export function findToolListGaps(root = ROOT, toolNames = []) {` |
| `toolNamesAsync` | 148-156 | 9 | `export async function toolNamesAsync(root = ROOT) {` |
| `countToolsAsync` | 163-171 | 9 | `export async function countToolsAsync(root = ROOT) {` |
| `main` | 173-198 | 26 | `async function main() {` |

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

### scripts/hot-path-probe.mjs（154 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readCfg` | 31-37 | 7 | `function readCfg() {` |
| `report` | 61-77 | 17 | `function report() {` |
| `initialize` | 88-90 | 3 | `export function initialize(data) {` |
| `resolve` | 93-102 | 10 | `export async function resolve(specifier, context, next) {` |
| `load` | 105-153 | 49 | `export async function load(url, context, next) {` |
| `__wrapped` | 141-145 | 5 | `const __wrapped = function (...__a) {` |

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

### scripts/scan-version.mjs（126 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readmeVersion` | 36-66 | 31 | `export function readmeVersion(text = '') {` |
| `cmp` | 56-63 | 8 | `const cmp = (a, b) => {` |
| `main` | 68-123 | 56 | `function main() {` |

### scripts/version-source.mjs（174 行 · 9 个函数）

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
| `buildReadmeVersionTable` | 151-171 | 21 | `export function buildReadmeVersionTable(repoPath) {` |

### test/app/test-plugin.mjs（680 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeExemptRepo` | 511-517 | 7 | `function makeExemptRepo() {` |
| `addSecretFile` | 518-521 | 4 | `function addSecretFile(root, path) {` |
| `fsStatMode` | 675-677 | 3 | `function fsStatMode(file) {` |

### test/app/test-settings-persistence.mjs（254 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `clientSubmitKeys` | 29-39 | 11 | `function clientSubmitKeys() {` |
| `allowlistKeys` | 48-53 | 6 | `function allowlistKeys() {` |
| `cfgMappingKeys` | 56-254 | 199 | `function cfgMappingKeys() {` |
| `isolatedEnv` | 73-80 | 8 | `function isolatedEnv() {` |

### test/app/test-slash-commands.mjs（288 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `inv` | 16-18 | 3 | `function inv(cwd) {` |

### test/app/test-symlink-resolution.mjs（104 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildFixture` | 25-41 | 17 | `function buildFixture() {` |
| `runNode` | 43-45 | 3 | `function runNode(args, env) {` |

### test/app/test-task-queue.mjs（233 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkRepo` | 17-24 | 8 | `function mkRepo() {` |
| `mkDirtyRepo` | 32-36 | 5 | `function mkDirtyRepo() {` |
| `wait` | 37-38 | 2 | `function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }` |
| `mockJobs` | 40-58 | 19 | `function mockJobs() {` |

### test/app/test-tools-e2e.mjs（86 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 26-32 | 7 | `function makeRepo(name) {` |

### test/app/test-workspace-paths.mjs（139 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mod` | 28-28 | 1 | `const mod = () => import('../../lib/core/workspace-paths.js');` |
| `h` | 29-29 | 1 | `const h = () => import('../../lib/app/handlers/workspace-paths.js');` |

### test/fixtures/mock-preprocess-cli.mjs（55 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `argMode` | 18-18 | 1 | `const argMode = (process.argv.find((a) => a.startsWith('--mode=')) \|\| '').slice('--mode='.length);` |
| `emit` | 32-35 | 4 | `const emit = (payload, code) => {` |

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

### test/git/test-git-core.mjs（632 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withRepo` | 79-83 | 5 | `function withRepo(fn) {` |
| `writeHook` | 85-90 | 6 | `function writeHook(root, name, body, mode = 0o755) {` |
| `makeRepo` | 172-179 | 8 | `function makeRepo() {` |
| `commit` | 182-186 | 5 | `function commit(dir, msg, { author = null, committer = { name: 'DSH Agent', email: 'agent@dsh.local' } } = {}) {` |
| `identities` | 189-191 | 3 | `function identities(dir) {` |
| `repoWrongEmails` | 193-195 | 3 | `function repoWrongEmails() {` |
| `setupRepo` | 358-374 | 17 | `function setupRepo() {` |
| `commitAll` | 377-380 | 4 | `function commitAll(dir, msg = 'init') {` |
| `withRepo` | 463-467 | 5 | `function withRepo(fn) {` |
| `runFetchCase` | 581-596 | 16 | `async function runFetchCase(streamResult) {` |

### test/git/test-git-identity.mjs（123 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 31-35 | 5 | `function makeRepo() {` |
| `repoConfig` | 38-40 | 3 | `function repoConfig(dir, key) {` |

### test/git/test-git.mjs（879 行 · 3 个函数）

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

### test/git/test-pre-commit-engine.mjs（441 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeEngineSource` | 49-82 | 34 | `function fakeEngineSource(mode) {` |
| `makeFakeEngines` | 85-94 | 10 | `function makeFakeEngines(dir) {` |
| `runWithFake` | 97-104 | 8 | `function runWithFake(engines, mode, extra = {}) {` |
| `makeBlockerRepo` | 107-119 | 13 | `function makeBlockerRepo() {` |

### test/git/test-private-gate.mjs（72 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fixture` | 27-33 | 7 | `function fixture() {` |

### test/git/test-push.mjs（319 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `tempRepo` | 150-160 | 11 | `function tempRepo() {` |

### test/git/test-remote-resolve.mjs（128 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 25-29 | 5 | `function makeRepo() {` |
| `addRemote` | 30-32 | 3 | `function addRemote(dir, name, url) {` |
| `getUrl` | 33-39 | 7 | `function getUrl(dir, name) {` |

### test/git/test-repo-list.mjs（549 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 38-49 | 12 | `function makeRepo(dir, { remote = '', commit = true } = {}) {` |
| `sandbox` | 52-64 | 13 | `function sandbox(fn) {` |
| `pick` | 461-461 | 1 | `const pick = (push) => String(push?.commitSha \|\| '').slice(0, 40) \|\| localHead;` |
| `sandboxAsync` | 491-503 | 13 | `async function sandboxAsync(fn) {` |

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

### test/helpers/mock-preprocess.mjs（34 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withMockPreprocess` | 22-31 | 10 | `export function withMockPreprocess(cfg = {}, mode = 'ok') {` |

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

### test/tool/test-cli.mjs（1033 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `usageLines` | 58-68 | 11 | `function usageLines(helpText, cliName, command) {` |
| `helpOf` | 71-75 | 5 | `function helpOf(cliName) {` |
| `runCliFile` | 152-161 | 10 | `async function runCliFile(cliName, argv, opts = {}) {` |
| `runInWaves` | 164-170 | 7 | `async function runInWaves(tasks, waveSize = 4) {` |
| `run` | 372-377 | 6 | `const run = (file, args) => {` |
| `mockReact` | 529-535 | 7 | `function mockReact() {` |
| `req` | 837-854 | 18 | `const req = (name) => {` |
| `req` | 915-934 | 20 | `const req = (name) => {` |
| `req` | 983-1001 | 19 | `const req = (name) => {` |

### test/tool/test-client-fragment-scope.mjs（69 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeRepo` | 16-20 | 5 | `function fakeRepo(pkg) {` |

### test/tool/test-doc-func.mjs（110 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkTmp` | 22-22 | 1 | `const mkTmp = () => mkdtempSync(join(tmpdir(), 'dshgp-docfunc-'));` |

### test/tool/test-doc-version-release-source.mjs（61 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fixture` | 18-29 | 12 | `function fixture(version, releases) {` |

### test/tool/test-doc-version.mjs（84 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkTmp` | 20-20 | 1 | `const mkTmp = () => mkdtempSync(join(tmpdir(), 'dshgp-docver-'));` |
| `gitRepoWithVersions` | 33-41 | 9 | `function gitRepoWithVersions(dir) {` |

### test/tool/test-func-doc-drift.mjs（71 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fixture` | 19-71 | 53 | `function fixture(block) {` |
| `driftFindings` | 37-40 | 4 | `async function driftFindings(dir) {` |

### test/tool/test-module-splitter.mjs（177 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFixture` | 121-139 | 19 | `function makeFixture(dir) {` |

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

### test/tool/test-tree-doc.mjs（221 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeReadme` | 41-43 | 3 | `function makeReadme(tree) {` |

### test/tool/test-tree-first.mjs（262 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFixture` | 61-65 | 5 | `async function makeFixture() {` |
| `hardLines` | 67-72 | 6 | `function hardLines(res) {` |
| `makeFixture` | 187-191 | 5 | `async function makeFixture() {` |
| `hitLines` | 193-193 | 1 | `const hitLines = (res) => res.findings` |
| `isShort` | 246-246 | 1 | `const isShort = (n) => String(n).length <= 2 && !['tr', 't'].includes(n);` |

<!-- dshgp-functions:end -->
