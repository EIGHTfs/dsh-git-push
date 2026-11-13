# 函数列表

> 由 `scripts/doc-func.mjs` 维护：`gen` 打印 / `apply` 更新本节 / `check` 查漂移（扫描 lib/scripts/test 函数）。

<!-- dshgp-functions:start -->
## 函数列表

### lib/app/apply.js（296 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `apply` | 44-295 | 252 | `export async function apply(ctx, config = {}) {` |
| `envInjectText` | 106-145 | 40 | `const envInjectText = (cwdOverride) => {` |

### lib/app/audit-api.js（174 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `exemptStatsOf` | 29-55 | 27 | `export function exemptStatsOf(findings = []) {` |
| `groupKeyOf` | 58-63 | 6 | `function groupKeyOf(finding, groupBy, ruleSlotMap) {` |
| `parseSeverityFilter` | 69-73 | 5 | `export function parseSeverityFilter(raw) {` |
| `aggregateFindings` | 82-103 | 22 | `export function aggregateFindings(findings = [], opts = {}) {` |
| `runAuditApi` | 111-173 | 63 | `export async function runAuditApi(repo, params = {}, cfg = {}) {` |

### lib/app/command-registry.js（330 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveEntryParams` | 14-18 | 5 | `export function resolveEntryParams(entry, cfg, hasBuiltinEngine) {` |
| `applyFlagToken` | 268-284 | 17 | `function applyFlagToken(args, tok, rest, i, byFlag) {` |
| `validateParamConstraints` | 287-293 | 7 | `function validateParamConstraints(args, params) {` |
| `parseRegistryArgs` | 295-315 | 21 | `export function parseRegistryArgs(rest = [], params = []) {` |
| `registryByName` | 318-320 | 3 | `export function registryByName(name) {` |
| `registryByCli` | 323-325 | 3 | `export function registryByCli(cli) {` |
| `buildToolsListText` | 328-330 | 3 | `export function buildToolsListText() {` |

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

### lib/app/handlers/audit.js（151 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ruleSlotStats` | 25-32 | 8 | `function ruleSlotStats(r) {` |
| `listRuleSlots` | 35-54 | 20 | `export function listRuleSlots(order, disabledSlots = [], hitStats = null) {` |
| `handleRuleSlots` | 57-60 | 4 | `export function handleRuleSlots(ctx) {` |
| `handleRuleDetail` | 63-86 | 24 | `export function handleRuleDetail(ctx) {` |
| `count` | 78-78 | 1 | `const count = (sev) => detail.filter((x) => x.severity === sev).length;` |
| `handleAudit` | 89-102 | 14 | `export async function handleAudit(ctx) {` |
| `handleToggleRule` | 105-113 | 9 | `export function handleToggleRule(ctx) {` |
| `handleExemptHint` | 125-150 | 26 | `export function handleExemptHint(ctx) {` |

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

### lib/app/host-doc-checks.js（26 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `installHostDocChecks` | 20-23 | 4 | `export function installHostDocChecks(checks = HOST_DOC_CHECKS) {` |

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

### lib/app/schema-audit.js（43 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditConfigShape` | 23-42 | 20 | `export function auditConfigShape(Schema) {` |

### lib/app/schema.js（151 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFallbackSchema` | 33-78 | 46 | `function makeFallbackSchema() {` |
| `fn` | 35-35 | 1 | `const fn = (v) => (v === undefined ? meta.default : v);` |
| `redactConfig` | 142-150 | 9 | `export function redactConfig(cfg = {}) {` |

### lib/app/scope-check.js（70 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `policyForFile` | 28-30 | 3 | `export function policyForFile(file) {` |
| `runScopeCheck` | 38-69 | 32 | `export function runScopeCheck({ files = [], prefix = '', allowlist = [], topLevelMustBeEmpty } = {}) {` |

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

### lib/app/tool-call.js（838 行 · 23 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pushWithPostSteps` | 58-126 | 69 | `async function pushWithPostSteps(args, env, cfg) {` |
| `pushJobOutcome` | 147-179 | 33 | `export function pushJobOutcome(r = {}) {` |
| `short` | 149-149 | 1 | `const short = (sha) => String(sha \|\| '').slice(0, 8);` |
| `cloneJobOutcome` | 187-192 | 6 | `export function cloneJobOutcome(r = {}) {` |
| `buildCommitPushJobSpec` | 195-212 | 18 | `function buildCommitPushJobSpec(repo, doPush) {` |
| `done` | 200-208 | 9 | `const done = (async () => {` |
| `startHostJob` | 225-232 | 8 | `function startHostJob(jobs, spec, owner) {` |
| `callCloneJob` | 246-278 | 33 | `async function callCloneJob(args, jobs, exec, log, env = {}, cfg = {}) {` |
| `callNpmPublishJob` | 286-369 | 84 | `async function callNpmPublishJob(args = {}, jobs, exec, log, env = {}, cfg = {}) {` |
| `outcome` | 320-344 | 25 | `const outcome = (r) => {` |
| `done` | 353-355 | 3 | `const done = (async () => {` |
| `buildCloneJobSpec` | 372-389 | 18 | `function buildCloneJobSpec(target, dest, doClone) {` |
| `done` | 377-385 | 9 | `const done = (async () => {` |
| `callCommitPush` | 396-442 | 47 | `async function callCommitPush(args, env, cfg, log, jobs, exec) {` |
| `doPush` | 415-415 | 1 | `const doPush = () => pushWithPostSteps(args, env, cfg);` |
| `buildAuditOpts` | 453-467 | 15 | `function buildAuditOpts(args, cfg, scope) {` |
| `runHistoryAuditTool` | 473-499 | 27 | `async function runHistoryAuditTool(args, env, cfg, jobs, exec, weights) {` |
| `doHistory` | 479-482 | 4 | `const doHistory = async () => {` |
| `callCodeAudit` | 501-513 | 13 | `async function callCodeAudit(args, env, cfg, log, jobs, exec) {` |
| `runStandardAuditTool` | 516-558 | 43 | `async function runStandardAuditTool(args, env, cfg, log, weights) {` |
| `callTool` | 560-838 | 279 | `export async function callTool(toolName, args = {}, env = {}, cfg = defaultConfig(), log = null, jobs = null, exec = null, fsCtx = null) {` |
| `shellSplit` | 812-830 | 19 | `function shellSplit(input) {` |
| `readTextSafe` | 833-837 | 5 | `function readTextSafe(path = '') {` |

### lib/app/tools.js（41 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `paramsToParameters` | 16-30 | 15 | `function paramsToParameters(params = [], cfg) {` |
| `listTools` | 33-41 | 9 | `export function listTools(cfg, hasBuiltinEngine) {` |

### lib/ast/brace.js（121 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `matchBrace` | 13-25 | 13 | `export function matchBrace(tokens, openIdx) {` |
| `matchParenForward` | 28-40 | 13 | `export function matchParenForward(tokens, startIdx) {` |
| `matchPairBack` | 52-61 | 10 | `export function matchPairBack(tokens, closeIdx, openPunct, closePunct) {` |
| `isBlockParen` | 71-83 | 13 | `export function isBlockParen(tokens, closeTok) {` |
| `matchingOpen` | 86-88 | 3 | `export function matchingOpen(tokens, closeIdx) {` |
| `collectInnerFnRanges` | 106-121 | 16 | `export function collectInnerFnRanges(tokens, from, to) {` |

### lib/ast/callgraph.js（135 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildCallGraph` | 23-42 | 20 | `export function buildCallGraph(text) {` |
| `isInRequestPath` | 52-68 | 17 | `export function isInRequestPath(fnName, graph, isRequestName) {` |
| `collectFunctionDecls` | 71-135 | 65 | `function collectFunctionDecls(tokens) {` |
| `collectArrowFns` | 93-135 | 43 | `function collectArrowFns(tokens) {` |
| `collectNamedFnRanges` | 120-122 | 3 | `export function collectNamedFnRanges(tokens) {` |
| `matchBraceIdx` | 125-135 | 11 | `function matchBraceIdx(tokens, openIdx) {` |

### lib/ast/code-lines.js（176 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeCodeLineFilter` | 24-47 | 24 | `export function makeCodeLineFilter(text = '', candidateLines = [], opts = {}) {` |
| `makeCodeSpanFilter` | 72-108 | 37 | `export function makeCodeSpanFilter(text = '', candidateLines = [], opts = {}) {` |
| `isProseDoc` | 122-124 | 3 | `function isProseDoc(text, file) {` |
| `makeProseCodeFilter` | 138-161 | 24 | `function makeProseCodeFilter(text, candidateLines) {` |
| `codeStringLiterals` | 168-175 | 8 | `export function codeStringLiterals(text = '') {` |

### lib/ast/control-flow.js（471 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectNamedSyncFs` | 27-58 | 32 | `function collectNamedSyncFs(tokens) { // dsh-skip-complexity: named-import 扫描器（import{..}→from 模式匹配，扫描结构必然嵌套）` |
| `collectAsyncRanges` | 61-79 | 19 | `function collectAsyncRanges(tokens) { // dsh-skip-complexity: async 函数体边界扫描器（token 遍历+配对，结构必然嵌套）` |
| `scanSyncCalls` | 82-108 | 27 | `function scanSyncCalls(tokens, namedSync, asyncRanges) { // dsh-skip-complexity: 同步 fs 调用扫描器（定位调用点+区间归属判定，结构必然嵌套）` |
| `checkSyncFs` | 111-116 | 6 | `export function checkSyncFs(text = '') {` |
| `checkEmptyCatchAst` | 123-177 | 55 | `export function checkEmptyCatchAst(text = '') { // dsh-skip-complexity: 空 catch 检测器本体（token 遍历 + catch 体空判定多条件链，职责单一）` |
| `checkComplexityAst` | 179-471 | 293 | `export function checkComplexityAst(text = '', { warn = 10, block = 20 } = {}) {` |
| `inInner` | 212-212 | 1 | `const inInner = (k) => innerRanges.some(([a, b]) => k >= a && k < b);` |
| `checkNestingDepthAst` | 256-471 | 216 | `export function checkNestingDepthAst(text = '', { warn = 4, block = 6 } = {}) { // dsh-skip-complexity: 嵌套深度统计器本体（统计 if/for 嵌套必然自身嵌套）` |
| `pythonDetectDef` | 336-338 | 3 | `function pythonDetectDef(text) {` |
| `checkPythonComplexity` | 352-376 | 25 | `function checkPythonComplexity(text, { warn, block }) {` |
| `checkPythonNesting` | 387-416 | 30 | `function checkPythonNesting(text, { warn, block }) {` |
| `indentOf` | 419-421 | 3 | `function indentOf(line) {` |
| `checkJavaKtComplexity` | 435-468 | 34 | `function checkJavaKtComplexity(tokens, ranges, { warn, block }) {` |

### lib/ast/credential.js（316 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isPlaceholderText` | 48-50 | 3 | `function isPlaceholderText(text) {` |
| `stripQuotes` | 78-82 | 5 | `function stripQuotes(raw) {` |
| `isMeaningfulCredentialValue` | 101-112 | 12 | `export function isMeaningfulCredentialValue(raw) {` |
| `checkPlaceholderCredentialAst` | 136-160 | 25 | `export function checkPlaceholderCredentialAst(text = '', file = '') {` |
| `credentialNameTier` | 195-200 | 6 | `export function credentialNameTier(name) {` |
| `isHardcodedCredentialValue` | 206-215 | 10 | `export function isHardcodedCredentialValue(name, raw) {` |
| `isCredentialIdent` | 218-220 | 3 | `export function isCredentialIdent(name) {` |
| `scanCredentialTokens` | 229-269 | 41 | `function scanCredentialTokens(tokens, out, lineOffset = 0) {` |
| `literalAfterPrefix` | 282-291 | 10 | `function literalAfterPrefix(tokens, next, opIdx) {` |
| `checkCredentialRefAst` | 293-315 | 23 | `export function checkCredentialRefAst(text = '', tree = null) {` |

### lib/ast/dataflow.js（391 行 · 16 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectDeclaredFnBodies` | 60-391 | 332 | `function collectDeclaredFnBodies(tokens) {` |
| `collectArrowMethodBodies` | 77-391 | 315 | `function collectArrowMethodBodies(tokens) {` |
| `collectPythonDefBodies` | 117-163 | 47 | `function collectPythonDefBodies(text, tokens) {` |
| `indentOf` | 122-125 | 4 | `const indentOf = (s) => {` |
| `isBlankOrComment` | 126-126 | 1 | `const isBlankOrComment = (s) => !s.trim() \|\| /^\s*#/.test(s);` |
| `mergeFnRanges` | 166-187 | 22 | `function mergeFnRanges(fnRanges, tokens) {` |
| `collectFnBodies` | 194-201 | 8 | `function collectFnBodies(tokens, text = '') {` |
| `prevNonWs` | 204-210 | 7 | `function prevNonWs(tokens, i) {` |
| `nextNonWs` | 213-220 | 8 | `function nextNonWs(tokens, i, to) {` |
| `applyArgWriteback` | 223-230 | 8 | `function applyArgWriteback(tokens, i, nxt, obj, clearMap) {` |
| `applyAssignClearOrWriteback` | 236-265 | 30 | `function applyAssignClearOrWriteback(tokens, i, to, t, nxt, obj, clearMap) {` |
| `applyClearMethods` | 271-289 | 19 | `function applyClearMethods(t, member, memberIdx, callOpen, tokens, obj, clearMap, i) {` |
| `applyAccessAfterClear` | 295-316 | 22 | `function applyAccessAfterClear(t, nxt, member, memberIdx, callOpen, tokens, i, obj, clearMap, out, to) {` |
| `isWriteSubscript` | 319-336 | 18 | `function isWriteSubscript(tokens, objIdx, to) {` |
| `scanClearThenAccess` | 346-369 | 24 | `function scanClearThenAccess(tokens, from, to) {` |
| `checkClearAccessAst` | 377-391 | 15 | `export function checkClearAccessAst(text = '') {` |

### lib/ast/dup-code.js（166 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectDupCodeCandidates` | 41-78 | 38 | `export function collectDupCodeCandidates(text, file = '') {` |
| `findDuplicateBodies` | 86-110 | 25 | `export function findDuplicateBodies(perFileCandidates, opts = {}) {` |
| `countParams` | 113-166 | 54 | `function countParams(tokens, openIdx) {` |
| `hasBoolFlagParam` | 146-166 | 21 | `function hasBoolFlagParam(tokens, openIdx) {` |

### lib/ast/fs-hotspots.js（155 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `lineAt` | 38-42 | 5 | `function lineAt(text, idx) {` |
| `scanFsHotspotsText` | 50-119 | 70 | `export function scanFsHotspotsText(text = '', relPath = '') {` |
| `collect` | 58-67 | 10 | `const collect = (re) => {` |
| `fnNameAt` | 69-72 | 4 | `const fnNameAt = (at) => {` |
| `dups` | 78-87 | 10 | `const dups = (calls) => {` |
| `groupOf` | 91-95 | 5 | `const groupOf = (fn, at) => {` |
| `scanFsHotspots` | 126-154 | 29 | `export function scanFsHotspots(fileTexts = []) {` |

### lib/ast/io-risk-const.js（96 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isLoopHead` | 86-89 | 4 | `export function isLoopHead(t, prev) {` |
| `raise` | 92-95 | 4 | `export function raise(level, n = 1) {` |

### lib/ast/io-risk-fn.js（209 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `enclosingLoop` | 17-24 | 8 | `export function enclosingLoop(loops, line) {` |
| `findBody` | 44-209 | 166 | `export function findBody(tokens, from, window = BODY_SEARCH_TOKENS) {` |
| `findAsyncBody` | 57-65 | 9 | `export function findAsyncBody(tokens, i) {` |
| `findLoopRange` | 72-86 | 15 | `export function findLoopRange(tokens, i) {` |
| `endLineOf` | 89-91 | 3 | `export function endLineOf(tokens, range) {` |
| `seekLoopBody` | 98-209 | 112 | `export function seekLoopBody(tokens, i) {` |
| `isSingleStmtLoopClose` | 109-209 | 101 | `export function isSingleStmtLoopClose(tokens, j) {` |
| `classifySyncFnHead` | 122-149 | 28 | `export function classifySyncFnHead(tokens, i, t) {` |
| `rangeOf` | 152-156 | 5 | `export function rangeOf(tokens, open) {` |
| `findArrowBody` | 159-170 | 12 | `export function findArrowBody(tokens, i) {` |
| `findBodyAfterParen` | 178-209 | 32 | `export function findBodyAfterParen(tokens, parenIdx) {` |
| `matchParen` | 186-195 | 10 | `export function matchParen(tokens, parenIdx) {` |
| `classifyFnHead` | 202-208 | 7 | `export function classifyFnHead(tokens, i, t) {` |

### lib/ast/io-risk-loop.js（309 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isSmallLiteralCallee` | 24-31 | 8 | `export function isSmallLiteralCallee(tokens, methodIdx) {` |
| `isSmallPushedArray` | 47-58 | 12 | `export function isSmallPushedArray(tokens, name, ofIdx) {` |
| `findLiteralArrayDecl` | 65-74 | 10 | `export function findLiteralArrayDecl(tokens, name, ofIdx) {` |
| `countUnsafePushes` | 90-116 | 27 | `export function countUnsafePushes(tokens, name, ofIdx) {` |
| `loopHeadSpan` | 121-309 | 189 | `export function loopHeadSpan(tokens, i) {` |
| `matchParenIn` | 139-148 | 10 | `function matchParenIn(tokens, openIdx) {` |
| `insideLoopOver` | 160-181 | 22 | `export function insideLoopOver(tokens, idx) {` |
| `isLoopBodyBrace` | 193-201 | 9 | `export function isLoopBodyBrace(tokens, braceIdx) {` |
| `isSmallFixedLoop` | 210-229 | 20 | `export function isSmallFixedLoop(tokens, i) {` |
| `findOfKeyword` | 236-309 | 74 | `export function findOfKeyword(tokens, i) {` |
| `countLiteralElements` | 254-272 | 19 | `export function countLiteralElements(tokens, fromIdx) {` |
| `collectRanges` | 281-308 | 28 | `export function collectRanges(tokens) {` |

### lib/ast/io-risk.js（315 行 · 15 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `classifyIoCall` | 55-65 | 11 | `function classifyIoCall(tokens, idx) {` |
| `judgeIoTokend` | 75-104 | 30 | `function judgeIoTokend(ctx) {` |
| `detectRequestContext` | 107-112 | 6 | `function detectRequestContext(lines, fnRange) {` |
| `gradeRisk` | 125-164 | 40 | `function gradeRisk({ isSync, inAsync, inLoop, inSmallFixedLoop, inRequest, inParallelAll, kind }) {` |
| `findMatchingClose` | 167-177 | 11 | `function findMatchingClose(tokens, openIdx) {` |
| `findPromiseAllRanges` | 186-199 | 14 | `function findPromiseAllRanges(tokens) {` |
| `scanIoRiskAst` | 206-245 | 40 | `export function scanIoRiskAst(text = '') {` |
| `within` | 215-215 | 1 | `const within = (ranges, line) => ranges.some(([s, e]) => line >= s && line <= e);` |
| `enclosingFnText` | 223-227 | 5 | `const enclosingFnText = (line) => {` |
| `fnNameAt` | 229-236 | 8 | `const fnNameAt = (line) => {` |
| `summarizeIoRisk` | 252-273 | 22 | `export function summarizeIoRisk(hits = []) {` |
| `rankIoFixList` | 280-284 | 5 | `export function rankIoFixList(hits = []) {` |
| `compareFixPriority` | 291-301 | 11 | `function compareFixPriority(a, b) {` |
| `isWriteLike` | 304-306 | 3 | `function isWriteLike(kind) {` |
| `isSync` | 309-311 | 3 | `function isSync(type) {` |

### lib/ast/lang.js（156 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `prevNonWsToken` | 58-65 | 8 | `function prevNonWsToken(tokens, i) {` |
| `isMethodCandidate` | 68-73 | 6 | `function isMethodCandidate(prev) {` |
| `findMatchingParen` | 76-85 | 10 | `function findMatchingParen(tokens, openIdx) {` |
| `findOpenBrace` | 88-156 | 69 | `function findOpenBrace(tokens, closeIdx) {` |
| `javaKtFuncRanges` | 100-123 | 24 | `export function javaKtFuncRanges(text = '') {` |
| `detectLang` | 131-142 | 12 | `export function detectLang(text = '') {` |

### lib/ast/line-count.js（53 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `lineStats` | 26-43 | 18 | `export function lineStats(text) {` |
| `codeLineCount` | 50-52 | 3 | `export function codeLineCount(text) {` |

### lib/ast/magic-number.js（273 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkMagicNumberSmartAst` | 51-152 | 102 | `export function checkMagicNumberSmartAst(text = '', {` |
| `hintTest` | 57-60 | 4 | `const hintTest = (hints) => {` |
| `scanBackToEquals` | 155-173 | 19 | `function scanBackToEquals(tokens, numIdx) {` |
| `checkConstPrefix` | 176-207 | 32 | `function checkConstPrefix(tokens, eqIdx) {` |
| `isNamedConstantValue` | 217-224 | 8 | `function isNamedConstantValue(tokens, numIdx) {` |
| `collectPythonEnumAssignLines` | 246-272 | 27 | `function collectPythonEnumAssignLines(text) {` |

### lib/ast/naming.js（293 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkNameLengthAst` | 27-192 | 166 | `export function checkNameLengthAst(text = '', { min = 2, allow = [] } = {}) {` |
| `checkShortFunctionNameAst` | 206-228 | 23 | `export function checkShortFunctionNameAst(text = '', { max = 2, allow = [], tree = null } = {}) {` |
| `isShortName` | 213-213 | 1 | `const isShortName = (name) => String(name).length <= max && !ALLOW.has(name);` |
| `checkSmallFileReadAst` | 244-267 | 24 | `export function checkSmallFileReadAst(text = '') {` |
| `checkConsoleLogJsonAst` | 276-292 | 17 | `export function checkConsoleLogJsonAst(text = '') {` |

### lib/ast/perf.js（489 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `matchingBrace` | 22-33 | 12 | `function matchingBrace(text, openIdx) {` |
| `matchingParen` | 36-47 | 12 | `function matchingParen(text, openIdx) {` |
| `lineOf` | 50-54 | 5 | `function lineOf(text, idx) {` |
| `inCommentOrString` | 63-69 | 7 | `function inCommentOrString(tokens, line, matchText) {` |
| `nextBlockRange` | 72-489 | 418 | `function nextBlockRange(text, startIdx) {` |
| `collectLoopRanges` | 86-102 | 17 | `function collectLoopRanges(text) {` |
| `loopBodyLines` | 109-118 | 10 | `export function loopBodyLines(text = '') {` |
| `innermostLoopRanges` | 146-149 | 4 | `function innermostLoopRanges(text) {` |
| `repeatIdenticalCallLines` | 175-203 | 29 | `export function repeatIdenticalCallLines(text = '') {` |
| `scanRange` | 180-196 | 17 | `const scanRange = (a, b) => {` |
| `loopFullCollectionLines` | 217-232 | 16 | `export function loopFullCollectionLines(text = '') {` |
| `collectFuncRanges` | 242-489 | 248 | `export function collectFuncRanges(text) {` |
| `directFullWriters` | 261-268 | 8 | `function directFullWriters(text) {` |
| `blankCommentsAndLiterals` | 279-341 | 63 | `function blankCommentsAndLiterals(text) {` |
| `isRegexStart` | 284-291 | 8 | `const isRegexStart = (idx) => {` |
| `loopNoFallbackReturnLines` | 361-389 | 29 | `export function loopNoFallbackReturnLines(text = '') {` |
| `loopFullRewriteCallLines` | 405-431 | 27 | `export function loopFullRewriteCallLines(text = '') {` |
| `nestedLinearScanLines` | 444-462 | 19 | `export function nestedLinearScanLines(text = '') {` |
| `longSyncLoopLines` | 474-488 | 15 | `export function longSyncLoopLines(text = '') {` |

### lib/ast/scope-collisions.js（229 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `analyzeScopeCollisions` | 49-229 | 181 | `export function analyzeScopeCollisions(text = '', {` |
| `nearestFunctionFrame` | 85-88 | 4 | `const nearestFunctionFrame = () => {` |

### lib/ast/scope.js（242 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectFnLineRanges` | 19-35 | 17 | `export function collectFnLineRanges(text) {` |
| `collectLoopLineRanges` | 38-57 | 20 | `export function collectLoopLineRanges(text) {` |
| `braceCloseIdx` | 60-70 | 11 | `function braceCloseIdx(tokens, openIdx) {` |
| `classifyFunctionPath` | 88-93 | 6 | `export function classifyFunctionPath(fnName = '') {` |
| `classifyLineScope` | 100-104 | 5 | `export function classifyLineScope(text, line) {` |
| `isModuleConstAssignment` | 113-137 | 25 | `export function isModuleConstAssignment(text, line) { // dsh-skip-complexity: 模块级常量判定器（顶层过滤+常量名风格+行内=num 多条件链，职责单一）` |
| `analyzeFunctionalScope` | 146-154 | 9 | `export function analyzeFunctionalScope(text = '') {` |
| `collectFnNames` | 157-184 | 28 | `function collectFnNames(tokens) { // dsh-skip-complexity: 函数名收集器（function/const function/箭头三形态扫描，拆分后职责单一）` |
| `scanReturnExposed` | 187-196 | 10 | `function scanReturnExposed(tokens, fnNames, scope) {` |
| `scanAssignmentExposed` | 200-227 | 28 | `function scanAssignmentExposed(tokens, fnNames, scope) { // dsh-skip-complexity: this/exports/module 赋值暴露扫描（三前缀分支为结构必然）` |
| `scanCallbackPassed` | 230-241 | 12 | `function scanCallbackPassed(tokens, fnNames, scope) {` |

### lib/ast/shell.js（132 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `shellCdDynamicLines` | 22-45 | 24 | `export function shellCdDynamicLines(text) {` |
| `parseGitignore` | 50-76 | 27 | `function parseGitignore(text) {` |
| `isIgnored` | 79-85 | 7 | `function isIgnored(target, patterns) {` |
| `extractWriteTarget` | 88-94 | 7 | `function extractWriteTarget(line) {` |
| `writeIntoGitignoredLines` | 106-131 | 26 | `export function writeIntoGitignoredLines(text, repoPath = '') {` |

### lib/ast/size.js（449 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `funcNameAt` | 31-45 | 15 | `function funcNameAt(tokens, i) {` |
| `pythonFuncRanges` | 60-84 | 25 | `export function pythonFuncRanges(text = '') {` |
| `maxFunctionLength` | 95-101 | 7 | `export function maxFunctionLength(text = '') {` |
| `arrowAndMethodRanges` | 130-449 | 320 | `function arrowAndMethodRanges(tokens) {` |
| `push` | 132-136 | 5 | `const push = (range, name) => {` |
| `funcRangesAst` | 165-449 | 285 | `export function funcRangesAst(text = '') {` |
| `countCommentLinesInRange` | 213-226 | 14 | `export function countCommentLinesInRange(tokens, startLine = 1, endLine = Infinity) {` |
| `checkFuncLinesAst` | 236-253 | 18 | `export function checkFuncLinesAst(text = '', { warn = FUNC_LINES_WARN, block = FUNC_LINES_BLOCK } = {}) {` |
| `checkFuncDensityAst` | 277-298 | 22 | `export function checkFuncDensityAst(text = '', { threshold = FUNC_LINES_WARN, blockThreshold = FUNC_LINES_BLOCK, skipLines = new Set() } = {}) {` |
| `countCommentLines` | 306-319 | 14 | `export function countCommentLines(text = '') {` |
| `checkFileLines` | 330-339 | 10 | `export function checkFileLines(text = '', { warn = 500, block = 1000, excludeComments = true } = {}) {` |
| `checkCommentDensityAst` | 361-396 | 36 | `export function checkCommentDensityAst(text = '', { warn = COMMENT_DENSITY_WARN_DEFAULT, minCodeLines = 5 } = {}) {` |
| `checkRepeatedStringsAst` | 406-448 | 43 | `export function checkRepeatedStringsAst(text = '', { min = 3, ignore = [] } = {}) {` |

### lib/ast/symbol-index.js（400 行 · 22 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `sanitizeId` | 39-41 | 3 | `export function sanitizeId(input) {` |
| `symbolId` | 49-52 | 4 | `export function symbolId(relPath, name) {` |
| `unquote` | 55-58 | 4 | `function unquote(raw) {` |
| `collectDeclarations` | 61-78 | 18 | `function collectDeclarations(tokens) {` |
| `collectEsmImports` | 84-114 | 31 | `function collectEsmImports(tokens) {` |
| `collectCjsImports` | 120-137 | 18 | `function collectCjsImports(tokens) {` |
| `collectCallSites` | 147-164 | 18 | `function collectCallSites(tokens, fnRanges) {` |
| `isMemberAccess` | 167-175 | 9 | `function isMemberAccess(tokens, idx) {` |
| `findEnclosingFn` | 178-183 | 6 | `function findEnclosingFn(idx, fnRanges) {` |
| `extractFileSymbols` | 191-202 | 12 | `export function extractFileSymbols(relPath, text) {` |
| `resolveSpecifier` | 211-236 | 26 | `export function resolveSpecifier(relPath, source, fileSet) {` |
| `buildSymbolIndex` | 244-254 | 11 | `export function buildSymbolIndex(files = [], opts = {}) {` |
| `collectExports` | 257-267 | 11 | `function collectExports(perFile) {` |
| `flattenSymbols` | 270-282 | 13 | `function flattenSymbols(exportsByFile, perFile) {` |
| `buildNameIndex` | 285-294 | 10 | `function buildNameIndex(exportsByFile) {` |
| `resolveCalls` | 297-313 | 17 | `function resolveCalls(perFile, exportsByFile, fileSet) {` |
| `buildImportMap` | 316-328 | 13 | `function buildImportMap(rel, imports, fileSet, exportsByFile) {` |
| `resolveOne` | 331-337 | 7 | `function resolveOne(rel, call, localNames, importMap, byName) {` |
| `indexStats` | 340-359 | 20 | `function indexStats(perFile, symbols, edges, unresolved) {` |
| `callersOf` | 362-370 | 9 | `export function callersOf(index, id) {` |
| `unusedExportCandidates` | 377-391 | 15 | `export function unusedExportCandidates(index) {` |
| `indexSummary` | 394-399 | 6 | `export function indexSummary(index) {` |

### lib/ast/tokenizer.js（422 行 · 14 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `tokenize` | 49-70 | 22 | `export function tokenize(text = '') {` |
| `clearTokenCache` | 73-76 | 4 | `export function clearTokenCache() {` |
| `tokenizeUncached` | 83-195 | 113 | `function tokenizeUncached(text = '') {` |
| `MULTI_OPS_BY_FIRST` | 207-215 | 9 | `const MULTI_OPS_BY_FIRST = (() => {` |
| `isCjkChar` | 232-232 | 1 | `const isCjkChar = (c) => c >= 0x4e00 && c <= 0x9fa5;` |
| `isIdentStartCode` | 234-234 | 1 | `const isIdentStartCode = (c) => (c < 128 ? ID_START_ASCII[c] === 1 : isCjkChar(c));` |
| `isIdentPartCode` | 236-236 | 1 | `const isIdentPartCode = (c) => (c < 128 ? ID_PART_ASCII[c] === 1 : isCjkChar(c));` |
| `isNumPartCode` | 238-238 | 1 | `const isNumPartCode = (c) => c < 128 && NUM_PART_ASCII[c] === 1;` |
| `isAsciiDigit` | 240-240 | 1 | `const isAsciiDigit = (c) => c >= 48 && c <= 57;` |
| `consumeLexeme` | 251-293 | 43 | `function consumeLexeme(src, i, n, ch, next, tokens, push) { // dsh-skip-complexity: 词素分派器（六类词素分派分支为结构必然，拆分后职责单一）` |
| `consumeCsharpInterpolated` | 311-360 | 50 | `function consumeCsharpInterpolated(src, i, n, push) { // dsh-skip-complexity: 三前缀组合 + 洞内嵌套串 + verbatim 转义` |
| `consumeString` | 363-374 | 12 | `function consumeString(src, i, n, ch, push) {` |
| `consumeTemplate` | 377-388 | 12 | `function consumeTemplate(src, i, n, push) {` |
| `consumeRegex` | 391-396 | 6 | `function consumeRegex(src, i, n, tokens, push) { // dsh-skip-complexity: 正则状态机（转义/字符组/闭包三态，天然多分支）` |

### lib/ast/treesitter.js（414 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveDirs` | 46-56 | 11 | `function resolveDirs() {` |
| `pick` | 48-50 | 3 | `const pick = (spec) => {` |
| `treesitterAvailable` | 94-102 | 9 | `export function treesitterAvailable() {` |
| `availableGrammars` | 105-115 | 11 | `export function availableGrammars() {` |
| `grammarForExt` | 118-121 | 4 | `export function grammarForExt(ext = '') {` |
| `loadModule` | 126-139 | 14 | `async function loadModule() {` |
| `ensureInit` | 142-155 | 14 | `async function ensureInit() {` |
| `getParser` | 158-179 | 22 | `async function getParser(grammar) {` |
| `parseText` | 182-198 | 17 | `export async function parseText(text, grammar) {` |
| `isOpaqueNode` | 201-208 | 8 | `export function isOpaqueNode(node) {` |
| `confirmHits` | 218-237 | 20 | `export async function confirmHits({ text, ext = '', grammar = '', hits = [] } = {}) {` |
| `makeSyncConfirmer` | 249-268 | 20 | `export function makeSyncConfirmer(tree) {` |
| `fn` | 251-263 | 13 | `const fn = (line, col) => {` |
| `credentialLinesFromTree` | 288-355 | 68 | `export function credentialLinesFromTree(tree, credHit) {` |
| `isPlainLiteral` | 299-305 | 7 | `const isPlainLiteral = (node) => {` |
| `walk` | 307-348 | 42 | `const walk = (node) => {` |
| `shortFunctionNamesFromTree` | 373-405 | 33 | `export function shortFunctionNamesFromTree(tree, isShort) {` |
| `walk` | 380-398 | 19 | `const walk = (node) => {` |
| `resetTreeSitterCache` | 408-413 | 6 | `export function resetTreeSitterCache() {  modPromise = null;` |

### lib/audit-ui-sdk/contract.js（118 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `assertMetaShape` | 52-65 | 14 | `function assertMetaShape(meta) {` |
| `assertRequiredParts` | 72-76 | 5 | `function assertRequiredParts(definition) {` |
| `assertOptionalParts` | 82-89 | 8 | `function assertOptionalParts(definition) {` |
| `defineAuditPanel` | 101-117 | 17 | `export function defineAuditPanel(definition) {` |

### lib/audit/analysis-coverage.js（99 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveEntries` | 30-40 | 11 | `async function resolveEntries({ repoPath, files }) {` |
| `computeAnalysisCoverage` | 48-68 | 21 | `export async function computeAnalysisCoverage({ repoPath = '', files = null, topN = DEFAULT_TOP_N } = {}) {` |
| `countByReason` | 71-75 | 5 | `function countByReason(unresolved) {` |
| `topUnresolvedFiles` | 78-85 | 8 | `function topUnresolvedFiles(unresolved, topN) {` |
| `formatAnalysisCoverageLine` | 92-98 | 7 | `export function formatAnalysisCoverageLine(cov = {}) {` |

### lib/audit/audit-file.js（206 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isMinifiedOneLine` | 31-41 | 11 | `function isMinifiedOneLine(text) {` |
| `isHashSegment` | 45-47 | 3 | `function isHashSegment(seg) {` |
| `isBuildArtifactFile` | 49-79 | 31 | `export function isBuildArtifactFile(relPathOrFile = '', text = '') {` |
| `auditFile` | 81-206 | 126 | `export function auditFile({ file, relPath, text, grouped }, opts = {}) {` |

### lib/audit/auditignore-rules.js（149 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseScopedLine` | 43-60 | 18 | `export function parseScopedLine(line) {` |
| `splitAuditIgnore` | 68-80 | 13 | `export function splitAuditIgnore(text = '') {` |
| `ruleMatches` | 83-91 | 9 | `export function ruleMatches(pattern, ruleId) {` |
| `matchScopedExemption` | 100-109 | 10 | `export function matchScopedExemption(scoped, relPath, ruleId) {` |
| `hasScopedEntries` | 112-114 | 3 | `export function hasScopedEntries(text = '') {` |
| `applyScopedExemptions` | 125-148 | 24 | `export function applyScopedExemptions(findings = [], root = '') {` |

### lib/audit/client-entry.js（94 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveDshClientEntries` | 27-54 | 28 | `export function resolveDshClientEntries(repoRoot) {` |
| `pick` | 40-48 | 9 | `const pick = (v) => {` |
| `resolveDshClientFragments` | 70-93 | 24 | `export function resolveDshClientFragments(repoRoot) {` |

### lib/audit/collector.js（610 行 · 20 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readIgnoreFileCached` | 71-77 | 7 | `function readIgnoreFileCached(p) {` |
| `isGitWorkTree` | 90-101 | 12 | `function isGitWorkTree(dir) {` |
| `auditIgnoreExcludesFile` | 110-125 | 16 | `function auditIgnoreExcludesFile(root, auditIgnorePath) {` |
| `tryLoadAuditIgnoreFallback` | 141-192 | 52 | `function tryLoadAuditIgnoreFallback(root, respectAuditIgnore = true) {` |
| `handleEntry` | 171-184 | 14 | `const handleEntry = (dir, en) => {` |
| `walkDirs` | 185-189 | 5 | `const walkDirs = (dir) => {` |
| `tryLoadGitIgnoreSet` | 204-301 | 98 | `function tryLoadGitIgnoreSet(root, respectAuditIgnore = true) {` |
| `walkDirs` | 245-260 | 16 | `const walkDirs = (dir) => {` |
| `isHardSkipped` | 310-312 | 3 | `function isHardSkipped(name) {` |
| `computeGitIgnored` | 315-320 | 6 | `function computeGitIgnored(full, gitIgnoreRoot, includeIgnored, respectAuditIgnore = true) {` |
| `shouldSkipDirByYml` | 323-327 | 5 | `function shouldSkipDirByYml(name, ignoredByGit, gitIgnoreRoot) {` |
| `isFileGitIgnored` | 330-341 | 12 | `function isFileGitIgnored(full, gitIgnoreRoot, includeIgnored, respectAuditIgnore = true) {` |
| `collectTextFiles` | 343-413 | 71 | `export async function collectTextFiles(dir, { depth = 10, gitIgnoreRoot = null, includeIgnored = false, testExemptRoot = null, respectAuditIgnore = true } = {}) {` |
| `walk` | 376-412 | 37 | `async function walk(cur, level) {` |
| `gitListTextFiles` | 424-486 | 63 | `function gitListTextFiles(dir, { gitIgnoreRoot = null, includeIgnored = false, testExemptRoot = null, respectAuditIgnore = true } = {}) {` |
| `isGitRepo` | 489-491 | 3 | `export function isGitRepo(dir) {` |
| `collectChangedFiles` | 499-556 | 58 | `export function collectChangedFiles(repoPath) {` |
| `isTextFile` | 559-577 | 19 | `export function isTextFile(full) {` |
| `clearReadCache` | 591-594 | 4 | `export function clearReadCache() {` |
| `readText` | 597-610 | 14 | `export function readText(full) {` |

### lib/audit/ext-runner.js（80 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadAuditExt` | 28-51 | 24 | `export async function loadAuditExt(dir = DEFAULT_EXT_DIR) {` |
| `runAuditExt` | 59-80 | 22 | `export async function runAuditExt(repo, opts = {}) {` |

### lib/audit/file-context.js（392 行 · 15 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hasMkdirInSameFunction` | 19-48 | 30 | `export function hasMkdirInSameFunction(lines, lineIdx) {` |
| `enclosingScopes` | 55-63 | 9 | `function enclosingScopes(lines, lineIdx) {` |
| `topLevelFunctionScope` | 69-392 | 324 | `function topLevelFunctionScope(lines, lineIdx) {` |
| `isBestEffortWrite` | 99-120 | 22 | `export function isBestEffortWrite(lines, lineIdx) {` |
| `functionScope` | 123-392 | 270 | `function functionScope(lines, lineIdx) {` |
| `stripBracesNoise` | 167-173 | 7 | `function stripBracesNoise(line) {` |
| `mkdirHelperNames` | 176-198 | 23 | `function mkdirHelperNames(lines) {` |
| `hasForeignWriteTarget` | 222-247 | 26 | `export function hasForeignWriteTarget(lines, lineIdx) {` |
| `enclosingParams` | 257-262 | 6 | `function enclosingParams(lines, lineIdx) {` |
| `hasTimeoutInRange` | 315-320 | 6 | `function hasTimeoutInRange(lines, start, end) {` |
| `isCallClosed` | 323-324 | 2 | `function isCallClosed(s, depth) {` |
| `hasTimeoutAfterCall` | 337-347 | 11 | `function hasTimeoutAfterCall(line, lines, lineIdx) {` |
| `hasExternalCallTimeout` | 349-354 | 6 | `export function hasExternalCallTimeout(line, lines, lineIdx) {` |
| `detectRepoJsYamlImport` | 363-372 | 10 | `export function detectRepoJsYamlImport(files) {` |
| `isVersionInPathContext` | 385-391 | 7 | `export function isVersionInPathContext(line) {` |

### lib/audit/finding.js（102 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isBlockerFinding` | 11-14 | 4 | `export function isBlockerFinding(f) {` |
| `makeFinding` | 18-20 | 3 | `export function makeFinding({ file, line, rule, kind, severity = 'warning', message, dimensions = [], exemptHint = '', scoreImpact = 0 }) {` |
| `normalizeExemptHints` | 36-47 | 12 | `export function normalizeExemptHints(findings = []) {` |
| `decorateTestExemptHint` | 57-68 | 12 | `export function decorateTestExemptHint(findings = []) {` |
| `summarize` | 81-91 | 11 | `export function summarize(findings = []) {` |

### lib/audit/gitignore-match.js（114 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseGitignore` | 33-52 | 20 | `export function parseGitignore(text) {` |
| `compilePattern` | 63-71 | 9 | `function compilePattern(pattern, anchored) {` |
| `isIgnoredByRules` | 85-102 | 18 | `export function isIgnoredByRules(rules, relPath, isDir = false) {` |
| `isIgnored` | 111-113 | 3 | `export function isIgnored(text, relPath, isDir = false) {` |

### lib/audit/glob.js（63 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `globToRegex` | 9-63 | 55 | `export function globToRegex(glob, anchored = true) {` |
| `globMatch` | 60-63 | 4 | `export function globMatch(glob, path) {` |

### lib/audit/history-report.js（100 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveReportDir` | 18-20 | 3 | `export function resolveReportDir(repoPath, outDir = '') {` |
| `renderMarkdown` | 23-53 | 31 | `function renderMarkdown(entry = {}) {` |
| `writeCommitReport` | 61-70 | 10 | `export function writeCommitReport(dir, entry = {}) {` |
| `writeHistoryIndex` | 77-100 | 24 | `export function writeHistoryIndex(dir, meta = {}) {` |

### lib/audit/history.js（126 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `listHistoryCommits` | 31-53 | 23 | `export function listHistoryCommits(repoPath, { since = '', until = '' } = {}) {` |
| `auditHistoryCommit` | 63-86 | 24 | `export async function auditHistoryCommit(repoPath, commit, opts = {}, weights = {}) {` |
| `runHistoryAudit` | 94-126 | 33 | `export async function runHistoryAudit(repoPath, { since = '', until = '', outDir = '', auditOpts = {}, weights = {}, signal, onCommit } = {}) {` |

### lib/audit/ignore-blind.js（103 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `excludePathOf` | 39-48 | 10 | `function excludePathOf(root) {` |
| `detectIgnoreBlindSpot` | 55-102 | 48 | `export function detectIgnoreBlindSpot(root) {` |

### lib/audit/orchestrate.js（673 行 · 20 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setHostDocChecks` | 32-34 | 3 | `export function setHostDocChecks(checks) {` |
| `findMarkedHostMd` | 38-38 | 1 | `const findMarkedHostMd = (...args) => (injected \|\| EMPTY_DOC_CHECKS).findMarkedHostMd(...args);` |
| `checkDrift` | 39-39 | 1 | `const checkDrift = (...args) => (injected \|\| EMPTY_DOC_CHECKS).checkDrift(...args);` |
| `checkFuncDrift` | 40-40 | 1 | `const checkFuncDrift = (...args) => (injected \|\| EMPTY_DOC_CHECKS).checkFuncDrift(...args);` |
| `capScanFiles` | 61-71 | 11 | `export function capScanFiles(files, root, maxFiles) {` |
| `appendIgnoreBlindSpot` | 84-100 | 17 | `function appendIgnoreBlindSpot(findings, repoPath, scanned) {` |
| `buildTreeConfirmer` | 132-158 | 27 | `async function buildTreeConfirmer(relPath, text, grouped) {` |
| `computeDimFileCounts` | 179-213 | 35 | `export function computeDimFileCounts(grouped, normFiles) {` |
| `computeDimRuleCounts` | 226-238 | 13 | `export function computeDimRuleCounts(grouped) {` |
| `auditFiles` | 240-464 | 225 | `async function auditFiles(repoPath, files, opts = {}) {` |
| `isDshPlugin` | 265-271 | 7 | `const isDshPlugin = (() => {` |
| `auditFull` | 466-488 | 23 | `export async function auditFull(repoPath, opts = {}) {` |
| `appendTreeDocDrift` | 493-535 | 43 | `function appendTreeDocDrift(findings, repoPath) {` |
| `by` | 526-526 | 1 | `const by = (code) => wt.filter(([, v]) => v?.status === code).length;` |
| `appendFuncDocDrift` | 544-560 | 17 | `function appendFuncDocDrift(findings, repoPath) {` |
| `appendSplitDocsCheck` | 568-622 | 55 | `function appendSplitDocsCheck(findings, repoPath) {` |
| `hasMarkBlock` | 625-627 | 3 | `function hasMarkBlock(text, marker) {` |
| `auditChanged` | 632-667 | 36 | `export async function auditChanged(repoPath, opts = {}) {` |
| `isAuditIgnored` | 648-661 | 14 | `const isAuditIgnored = (rel) => {` |
| `auditWithScope` | 670-672 | 3 | `export async function auditWithScope(repoPath, { scope = 'diff', ...opts } = {}) {` |

### lib/audit/ownership.js（47 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `classifyOwnership` | 27-32 | 6 | `export function classifyOwnership(login = '', owner = '') {` |
| `privacyRulesEnabled` | 39-41 | 3 | `export function privacyRulesEnabled(ownership) {` |
| `isPrivacyRule` | 44-46 | 3 | `export function isPrivacyRule(ruleId) {` |

### lib/audit/repo-level.js（31 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `repoLevelSemanticRuleIds` | 10-16 | 7 | `export function repoLevelSemanticRuleIds(grouped = {}) {` |
| `pickRepoLevelAnchorFile` | 24-30 | 7 | `export function pickRepoLevelAnchorFile(files = []) {` |

### lib/audit/report-yaml.js（90 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `findingsToYaml` | 32-81 | 50 | `export function findingsToYaml(findings = [], { includeMessage = true, maxMessageLen = 200 } = {}) {` |
| `countSeverity` | 84-90 | 7 | `function countSeverity(dirMap) {` |

### lib/audit/scope-policy.js（111 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `normRelPath` | 28-30 | 3 | `function normRelPath(value) {` |
| `findConfigPath` | 44-58 | 15 | `function findConfigPath(startDir, now) {` |
| `readProjectScopePolicy` | 74-110 | 37 | `export function readProjectScopePolicy(file = '') {` |

### lib/audit/slot.js（67 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `slotStatsFromFindings` | 17-46 | 30 | `export function slotStatsFromFindings(findings = [], ruleSlotMap = new Map(), slotRuleCount = {}) {` |
| `ensure` | 26-29 | 4 | `const ensure = (slot) => {` |
| `buildRuleSlotMap` | 49-56 | 8 | `export function buildRuleSlotMap(compiledRules = []) {` |
| `countRulesBySlot` | 59-66 | 8 | `export function countRulesBySlot(compiledRules = []) {` |

### lib/checks/button-bind.js（348 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readBalancedCall` | 28-48 | 21 | `export function readBalancedCall(text, startIdx, maxLen = 4000) {` |
| `extractJsxButtons` | 60-92 | 33 | `export function extractJsxButtons(text) {` |
| `stripCommentLines` | 106-120 | 15 | `function stripCommentLines(text) {` |
| `checkButtonBindings` | 138-348 | 211 | `export function checkButtonBindings({ file, text, rules, fileScope = '' }) {` |

### lib/checks/common.js（171 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `capSeverity` | 35-41 | 7 | `export function capSeverity(ruleSeverity, internalLevel) {` |
| `groupByKind` | 52-61 | 10 | `export function groupByKind(compiled) {` |
| `smartHitLines` | 70-73 | 4 | `export function smartHitLines(text) {` |
| `smallFileReadLines` | 83-87 | 5 | `export function smallFileReadLines(text) {` |
| `consoleLogJsonLines` | 95-97 | 3 | `export function consoleLogJsonLines(text) {` |
| `shortFuncNameLines` | 105-107 | 3 | `export function shortFuncNameLines(text, tree) {` |
| `placeholderCredentialLines` | 118-120 | 3 | `export function placeholderCredentialLines(text, file) {` |
| `credentialValueLines` | 122-124 | 3 | `export function credentialValueLines(text, tree) {` |
| `ioRiskLines` | 138-140 | 3 | `export function ioRiskLines(text) {` |
| `ioRiskDetail` | 148-156 | 9 | `export function ioRiskDetail(text) {` |
| `shellCdDynamicLines` | 158-160 | 3 | `export function shellCdDynamicLines(text) {` |
| `writeIntoGitignoredLines` | 167-169 | 3 | `export function writeIntoGitignoredLines(text, repoPath) {` |

### lib/checks/credential-file.js（44 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkCredentialFiles` | 13-43 | 31 | `export function checkCredentialFiles({ file, relPath, rules }) {` |

### lib/checks/dataflow.js（41 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkDataflow` | 25-40 | 16 | `export function checkDataflow({ file, text, rules }) {` |

### lib/checks/dispatch.js（118 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveFileScope` | 48-56 | 9 | `function resolveFileScope({ repoPath, relPath }) {` |
| `runChecks` | 58-117 | 60 | `export function runChecks({ file, relPath, text, grouped }, opts = {}) {` |

### lib/checks/dup-code.js（70 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkDuplicateCode` | 28-69 | 42 | `export function checkDuplicateCode(fileTexts = [], rules = null) {` |

### lib/checks/dup-const.js（233 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `extractFromConst` | 46-66 | 21 | `function extractFromConst(tokens, i, atTopLevel, push) {` |
| `extractFromJavaFinal` | 72-80 | 9 | `function extractFromJavaFinal(tokens, i, push) {` |
| `createConstPusher` | 100-116 | 17 | `function createConstPusher(out) {` |
| `extractConstAtToken` | 124-148 | 25 | `function extractConstAtToken(tokens, i, { lang, atTopLevel, push }) {` |
| `findConstDefs` | 150-175 | 26 | `export function findConstDefs(text = '') {` |
| `atTopLevel` | 160-160 | 1 | `const atTopLevel = (line) => /^\S/.test(lines[line - 1] \|\| '');` |
| `checkDuplicateConst` | 183-232 | 50 | `export function checkDuplicateConst(fileTexts = [], rules = null) {` |

### lib/checks/file-health.js（151 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFileHealth` | 38-150 | 113 | `export function checkFileHealth({ file, relPath, text, rules }) {` |
| `levelOf` | 87-90 | 4 | `const levelOf = (val, levels) => {` |

### lib/checks/filter.js（138 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `filterRulesByExt` | 32-50 | 19 | `export function filterRulesByExt(grouped, relPath) {` |
| `normRelPath` | 59-61 | 3 | `function normRelPath(s) {` |
| `includeHit` | 67-73 | 7 | `function includeHit(rel, inc) {` |
| `excludeHit` | 76-79 | 4 | `function excludeHit(rel, ex) {` |
| `filterRulesByPath` | 81-100 | 20 | `export function filterRulesByPath(grouped, relPath) {` |
| `filterRulesByFileText` | 118-137 | 20 | `export function filterRulesByFileText(grouped, text) {` |

### lib/checks/folder.js（174 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFolderRules` | 23-173 | 151 | `export function checkFolderRules({ root, rules, gitignoreText = '' }) {` |
| `isPackageDir` | 89-89 | 1 | `const isPackageDir = (d) => /\/src\/(?:main\|test\|androidTest)\/(?:java\|kotlin)\//.test(d.full)` |
| `isIgnored` | 148-148 | 1 | `const isIgnored = (p) => lines.some((l) => l === p \|\| l === p.replace(/^\*/, '') \|\| l.replace(/\/$/, '') === p);` |

### lib/checks/fs-scanner.js（58 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkMultiFileScanners` | 21-57 | 37 | `export function checkMultiFileScanners(fileTexts = [], rules = null) {` |

### lib/checks/hardcoded-path.js（99 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hardcodedAbsPathHits` | 47-74 | 28 | `export function hardcodedAbsPathHits(text, filePath = '', baseDir = '') {` |
| `hardcodedAbsPathLines` | 77-79 | 3 | `export function hardcodedAbsPathLines(text, filePath = '', baseDir = '') {` |
| `hardcodedAbsPathDetail` | 82-90 | 9 | `export function hardcodedAbsPathDetail(text, filePath = '', baseDir = '') {` |
| `describeHardcodedAbsPath` | 93-98 | 6 | `export function describeHardcodedAbsPath(hit) {` |

### lib/checks/io.js（67 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkIoRisk` | 26-66 | 41 | `export function checkIoRisk({ file, text }) {` |

### lib/checks/magic-number.js（43 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkMagicNumberSmart` | 22-42 | 21 | `export function checkMagicNumberSmart({ file, text, rules }) {` |

### lib/checks/npm-json.js（274 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `starRangeDeps` | 21-33 | 13 | `function starRangeDeps(pkg) {` |
| `findJsonKeyLine` | 51-59 | 9 | `function findJsonKeyLine(text, key, valueHint) {` |
| `checkNpmJson` | 61-273 | 213 | `export function checkNpmJson({ file, text, rules, repoHasJsYamlImport, repoPath }) {` |

### lib/checks/private.js（65 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkPrivateFiles` | 25-64 | 40 | `export function checkPrivateFiles({ root, visibility = 'unknown', privateFiles = [] }) {` |

### lib/checks/regex.js（299 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pickExemptHint` | 28-47 | 20 | `export function pickExemptHint(rule) {` |
| `hit` | 31-31 | 1 | `const hit = (words) => (Array.isArray(words) ? words : []).some((w) => id.includes(w));` |
| `checkRegexRules` | 58-221 | 164 | `export function checkRegexRules({ file, text, rules, source = '新增行', repoPath = '', treeConfirm = null }) {` |
| `inComment` | 94-101 | 8 | `const inComment = (line, col) => {` |
| `checkPathRegexRules` | 224-240 | 17 | `export function checkPathRegexRules({ file, relPath, rules }) {` |
| `checkBlacklist` | 250-298 | 49 | `export function checkBlacklist({ file, text, rules }) {` |

### lib/checks/scope-collision.js（69 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkScopeCollision` | 32-68 | 37 | `export function checkScopeCollision({ file, text, rules }) {` |

### lib/checks/semantic.js（135 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkSemantic` | 35-59 | 25 | `export function checkSemantic({ file, relPath, rules, repoLevelRules }) {` |
| `isRepoLevelSemanticRule` | 69-78 | 10 | `export function isRepoLevelSemanticRule(rule) {` |
| `checkPatchInsert` | 93-134 | 42 | `export function checkPatchInsert({ file, text, rules }) {` |

### lib/checks/structural.js（282 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFuncLines` | 22-66 | 45 | `export function checkFuncLines({ file, text, rules }) {` |
| `checkSyncFsInFile` | 69-82 | 14 | `export function checkSyncFsInFile({ file, text }) {` |
| `checkEmptyCatch` | 85-98 | 14 | `export function checkEmptyCatch({ file, text }) {` |
| `checkMinLength` | 101-122 | 22 | `export function checkMinLength({ file, text, rules }) {` |
| `checkComplexity` | 125-151 | 27 | `export function checkComplexity({ file, text, rules }) {` |
| `checkDepth` | 154-170 | 17 | `export function checkDepth({ file, text, rules }) {` |
| `checkMaxLines` | 173-231 | 59 | `export function checkMaxLines({ file, text, rules, fileScope = '' }) {` |
| `checkCommentDensity` | 239-254 | 16 | `export function checkCommentDensity({ file, text, rules }) {` |
| `checkRepeated` | 257-281 | 25 | `export function checkRepeated({ file, text, rules }) {` |

### lib/cli/commands-account.mjs（108 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `cmdAccountCheck` | 23-30 | 8 | `export async function cmdAccountCheck(flags) {` |
| `cmdCredEnv` | 33-47 | 15 | `export async function cmdCredEnv(flags) {` |
| `cmdRemoteCreate` | 50-65 | 16 | `export async function cmdRemoteCreate(repo, flags) {` |
| `cmdSetVisibility` | 68-82 | 15 | `export async function cmdSetVisibility(repo, flags) {` |
| `cmdGenSshKey` | 85-96 | 12 | `export async function cmdGenSshKey(flags) {` |
| `resolveRepoOwnerName` | 99-107 | 9 | `async function resolveRepoOwnerName(repoPath) {` |

### lib/cli/commands-audit.mjs（143 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pluginEqualAuditOpts` | 31-43 | 13 | `export function pluginEqualAuditOpts(cfg, flags, { scope = 'diff' } = {}) {` |
| `pluginEqualWeights` | 46-50 | 5 | `export function pluginEqualWeights(cfg, flags) {` |
| `pathExists` | 53-55 | 3 | `async function pathExists(p) {` |
| `cmdAudit` | 58-62 | 5 | `export async function cmdAudit(root, flags) {` |
| `runHistoryAuditCmd` | 65-81 | 17 | `async function runHistoryAuditCmd(root, flags) {` |
| `runStandardAudit` | 84-97 | 14 | `async function runStandardAudit(root, flags) {` |
| `printAuditResult` | 100-118 | 19 | `function printAuditResult(root, auditResult, opts, weights, quality) {` |
| `cmdScan` | 134-142 | 9 | `export async function cmdScan(root, flags) {` |

### lib/cli/commands-doc.mjs（128 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `cmdFileIo` | 27-66 | 40 | `export function cmdFileIo(targets = [], flags = {}) {` |
| `splitMulti` | 28-28 | 1 | `const splitMulti = (v) => String(v \|\| '').split(',').map((x) => x.trim()).filter(Boolean);` |
| `riskMark` | 49-49 | 1 | `const riskMark = (r) => (r === 'high' ? '🔴' : r === 'medium' ? '🟠' : '·');` |
| `tagsOf` | 50-56 | 7 | `const tagsOf = (hit) => {` |
| `cmdTreeDoc` | 69-81 | 13 | `export async function cmdTreeDoc(sub, flags) {` |
| `cmdFunctions` | 84-106 | 23 | `export async function cmdFunctions(op, target, flags) {` |
| `cmdModuleSplitter` | 109-127 | 19 | `export async function cmdModuleSplitter(positional = [], flags = {}) {` |

### lib/cli/commands-tool.mjs（94 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readPkgJson` | 23-27 | 5 | `export function readPkgJson() {` |
| `cmdYamlTemplate` | 30-32 | 3 | `export function cmdYamlTemplate() {` |
| `cmdReadmeTemplate` | 35-37 | 3 | `export function cmdReadmeTemplate() {` |
| `checkEntries` | 43-71 | 29 | `export function checkEntries() {` |
| `cmdSelfCheck` | 74-93 | 20 | `export function cmdSelfCheck() {` |

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

### lib/cli/shared.mjs（452 行 · 20 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `commandOwner` | 57-63 | 7 | `export function commandOwner(command) {` |
| `allCommands` | 66-68 | 3 | `export function allCommands() {` |
| `cliPluginConfig` | 81-90 | 10 | `export function cliPluginConfig() {` |
| `versionLine` | 93-95 | 3 | `export function versionLine(cliName) {` |
| `buildCrossCliHint` | 102-112 | 11 | `export function buildCrossCliHint({ command = '', argvRest = [], fromCli = '' } = {}) {` |
| `defaultFlags` | 161-170 | 10 | `function defaultFlags() {` |
| `applyBoolFlag` | 173-178 | 6 | `function applyBoolFlag(flags, token) {` |
| `applyValueFlag` | 181-184 | 4 | `function applyValueFlag(flags, token, rawValue) {` |
| `parseArgv` | 193-211 | 19 | `export function parseArgv(argv = []) {` |
| `parseVia` | 214-227 | 14 | `export function parseVia(run) {` |
| `printToolResult` | 235-242 | 8 | `export function printToolResult(result, asJson) {` |
| `readableResultLines` | 250-258 | 9 | `function readableResultLines(result) {` |
| `printVersion` | 261-263 | 3 | `export function printVersion(cliName) {` |
| `resolveDispatch` | 273-304 | 32 | `export function resolveDispatch({ cliName = CLI_GIT, argv = [], commands = new Map() } = {}) {` |
| `normalizeRegistryArgv` | 318-332 | 15 | `export function normalizeRegistryArgv(rest = [], params = []) {` |
| `runCli` | 345-391 | 47 | `export async function runCli({` |
| `isDirectRun` | 401-409 | 9 | `export function isDirectRun(moduleUrl) {` |
| `runAsEntry` | 416-427 | 12 | `export function runAsEntry(moduleUrl, main) {` |
| `readEntrySource` | 436-438 | 3 | `export function readEntrySource(relPath) {` |
| `parseEntrySourceMeta` | 445-451 | 7 | `export function parseEntrySourceMeta(sourceText = '') {` |

### lib/client-parts/audit/audit.js（302 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_WeightRows` | 3-26 | 24 | `function dshgp_WeightRows(props) {` |
| `dshgp_RuleRow` | 37-99 | 63 | `function dshgp_RuleRow(props, slot, idx, len) {` |
| `countTitle` | 46-49 | 4 | `const countTitle = (kind) => {` |
| `move` | 54-54 | 1 | `const move = (dir) => props.moveSlot(slot, dir);` |
| `dshgp_AuditSwitchBlock` | 102-166 | 65 | `function dshgp_AuditSwitchBlock(props) {` |
| `dshgp_InjectPromptSwitchBlock` | 169-191 | 23 | `function dshgp_InjectPromptSwitchBlock(props) {` |
| `dshgp_CommentWordingBlock` | 194-209 | 16 | `function dshgp_CommentWordingBlock(props) {` |
| `dshgp_AuditAdvancedBlock` | 212-238 | 27 | `function dshgp_AuditAdvancedBlock(props) {` |
| `dshgp_RuleListBlock` | 241-272 | 32 | `function dshgp_RuleListBlock(props) {` |
| `dshgp_AuditTab` | 279-299 | 21 | `function dshgp_AuditTab(props) {` |

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

### lib/commit-push.js（238 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `defaultPreprocessRender` | 38-53 | 16 | `export function defaultPreprocessRender(ctx = {}) {` |
| `runAudit` | 64-189 | 126 | `export async function runAudit({ repoPath = '', audit, rulesetDir, slots, cfg: extCfg, visibility: extVisibility, exemptPaths = [], exemptReason = '' } = {}) {` |
| `isExemptFile` | 118-118 | 1 | `const isExemptFile = (f) => exemptSet.size > 0 && exemptSet.has(String(f.file \|\| '').replace(/\\/g, '/').replace(/^\.\//, ''));` |
| `commitWithAudit` | 199-224 | 26 | `export async function commitWithAudit({` |
| `commitMany` | 232-238 | 7 | `export async function commitMany({ repos = [], message = '', push = true, dryRun = false, requirementsConfirmed = false, customIgnorePatterns = '' } = {}) {` |

### lib/commit-push/pre-commit-engine.js（389 行 · 17 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pluginRootDir` | 46-48 | 3 | `export function pluginRootDir() {` |
| `stderrTail` | 55-58 | 4 | `export function stderrTail(text) {` |
| `resolvePreCommitConfig` | 71-89 | 19 | `export function resolvePreCommitConfig(cfg = {}) {` |
| `readPreCommitBlock` | 96-109 | 14 | `function readPreCommitBlock(cfg = {}) {` |
| `isExecutableFile` | 116-125 | 10 | `function isExecutableFile(absPath) {` |
| `searchCommandOnPath` | 132-148 | 17 | `function searchCommandOnPath(commandName) {` |
| `resolvePathLikeCommand` | 155-159 | 5 | `function resolvePathLikeCommand(pathLike) {` |
| `resolveEngineCommand` | 169-175 | 7 | `export function resolveEngineCommand(command) {` |
| `resolveEngineArgs` | 186-194 | 9 | `export function resolveEngineArgs(args = []) {` |
| `toSlotCsv` | 201-206 | 6 | `function toSlotCsv(slots) {` |
| `buildEngineArgs` | 214-232 | 19 | `export function buildEngineArgs({` |
| `formatCommandLine` | 240-242 | 3 | `export function formatCommandLine(command, args = []) {` |
| `failClosed` | 251-253 | 3 | `function failClosed(message) {` |
| `parseEngineStdout` | 262-280 | 19 | `export function parseEngineStdout(stdout) {` |
| `runEngineProcess` | 290-337 | 48 | `function runEngineProcess({ command, args, timeoutMs }) {` |
| `finish` | 300-305 | 6 | `const finish = (result) => {` |
| `runPreCommitEngine` | 353-388 | 36 | `export async function runPreCommitEngine({` |

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

### lib/exempt/index.js（347 行 · 14 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hasHeaderExempt` | 126-130 | 5 | `export function hasHeaderExempt(text, marker) {` |
| `hasLineExempt` | 133-135 | 3 | `export function hasLineExempt(line, marker) {` |
| `isCategoryExempt` | 153-161 | 9 | `export function isCategoryExempt(finding = {}) {` |
| `markerCovers` | 170-189 | 20 | `function markerCovers(meta, kind, rule) {` |
| `has` | 173-173 | 1 | `const has = (a) => Array.isArray(a) && a.length > 0;` |
| `exemptMarkerCovers` | 192-194 | 3 | `export function exemptMarkerCovers(marker, finding = {}) {` |
| `exemptHintForFinding` | 202-212 | 11 | `export function exemptHintForFinding(finding = {}) {` |
| `exemptForFinding` | 223-240 | 18 | `export function exemptForFinding(finding, text = '') { // dsh-skip-complexity: 豁免判定器本体（9 标记 × blocked/细分规则多条件链，职责单一）` |
| `exemptHintFor` | 243-248 | 6 | `export function exemptHintFor(ruleOrKind) {` |
| `cacheGet` | 264-265 | 2 | `function cacheGet(cache, dir) { return cache.has(dir) ? cache.get(dir) : undefined; }` |
| `dirHasEmptyMarker` | 267-279 | 13 | `function dirHasEmptyMarker(dir, name, cache) {` |
| `clearExemptMarkerCache` | 282-285 | 4 | `export function clearExemptMarkerCache() {` |
| `isSampleExemptDir` | 296-316 | 21 | `export function isSampleExemptDir(repoPath, relPath = '') {` |
| `isTestExemptDir` | 326-346 | 21 | `export function isTestExemptDir(repoPath, relPath = '') {` |

### lib/exempt/tool.js（199 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `findRuleKind` | 23-31 | 9 | `async function findRuleKind(repoPath, ruleId) {` |
| `readText` | 34-36 | 3 | `function readText(file) {` |
| `resolveTarget` | 39-47 | 9 | `function resolveTarget(repoPath, p) {` |
| `resolveMarker` | 50-76 | 27 | `function resolveMarker({ rule = '', marker = '', scope = '', kind = '' }) {` |
| `hasMarker` | 79-84 | 6 | `function hasMarker(lines, marker, scope, line) {` |
| `headerComment` | 87-89 | 3 | `function headerComment(marker, reason) {` |
| `addExempt` | 95-138 | 44 | `export async function addExempt({ repoPath = '', path: p, line, scope = '', rule = '', marker = '', reason = '', dryRun = false } = {}) {` |
| `removeExempt` | 141-158 | 18 | `export function removeExempt({ repoPath = '', path: p, marker = '', dryRun = false } = {}) {` |
| `listExempt` | 161-185 | 25 | `export function listExempt({ repoPath = '', root = '' } = {}) {` |
| `walk` | 164-182 | 19 | `const walk = (dir, depth) => {` |
| `checkExempt` | 188-198 | 11 | `export function checkExempt({ repoPath = '', root = '' } = {}) {` |

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

### lib/link-check/index.js（187 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isFlakyHost` | 43-46 | 4 | `export function isFlakyHost(host = '') {` |
| `extractLinks` | 53-65 | 13 | `export function extractLinks(text = '') {` |
| `gradeResult` | 75-104 | 30 | `export function gradeResult(url = '', r = {}) {` |
| `probeLink` | 112-129 | 18 | `export async function probeLink(url, { timeoutMs = DEFAULT_OPTS.timeoutMs, fetcher } = {}) {` |
| `probeLinks` | 137-151 | 15 | `export async function probeLinks(links = [], { concurrency = DEFAULT_OPTS.concurrency, timeoutMs = DEFAULT_OPTS.timeoutMs, fetcher } = {}) {` |
| `checkLinks` | 158-182 | 25 | `export async function checkLinks({ file = '', text = '', fetcher, concurrency, timeoutMs, maxLinks = DEFAULT_OPTS.maxLinks } = {}) {` |
| `sumLinkPenalty` | 185-187 | 3 | `export function sumLinkPenalty(findings = []) {` |

### lib/lint-adapter/detect.js（162 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isExecutable` | 37-47 | 11 | `function isExecutable(p) {` |
| `hasConfig` | 50-63 | 14 | `function hasConfig(repoRoot, linter) {` |
| `resolveBin` | 71-76 | 6 | `export function resolveBin(repoRoot, linter) {` |
| `tryWhich` | 79-90 | 12 | `function tryWhich(bin) {` |
| `detectLinters` | 96-98 | 3 | `export function detectLinters(repoRoot) {` |
| `detectLinterStatus` | 110-120 | 11 | `export function detectLinterStatus(repoRoot) {` |
| `binCandidates` | 123-135 | 13 | `function binCandidates(repoRoot, linter) {` |
| `resolveBinDetailed` | 138-151 | 14 | `function resolveBinDetailed(repoRoot, linter) {` |
| `tryVersion` | 154-161 | 8 | `function tryVersion(bin) {` |

### lib/lint-adapter/index.js（51 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runLintAdapters` | 19-48 | 30 | `export async function runLintAdapters(repoRoot, opts = {}) {` |

### lib/lint-adapter/runner.js（134 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ruffDims` | 39-43 | 5 | `function ruffDims(code) {` |
| `ruffItemToFinding` | 49-66 | 18 | `export function ruffItemToFinding(item, repoRoot) {` |
| `relFile` | 69-78 | 10 | `function relFile(abs, repoRoot) {` |
| `parseRuffJson` | 81-90 | 10 | `function parseRuffJson(stdout) {` |
| `runLinter` | 98-133 | 36 | `export async function runLinter(linter, repoRoot) {` |

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

### lib/preprocess/audit.js（99 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditPreprocessAvailable` | 39-45 | 7 | `export function auditPreprocessAvailable(cfg = {}, hasBuiltinEngine) {` |
| `formatBlocked` | 60-66 | 7 | `function formatBlocked(blocked = []) {` |
| `auditRenderResult` | 77-90 | 14 | `export function auditRenderResult(ctx = {}) {` |

### lib/preprocess/index.js（79 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `preprocessParams` | 36-44 | 9 | `export function preprocessParams(cfg = {}, hasBuiltinEngine, preprocessors = PREPROCESSORS) {` |
| `renderPreprocessResult` | 59-78 | 20 | `export function renderPreprocessResult(ctx = {}, cfg = {}, preprocessors = PREPROCESSORS) {` |

### lib/rule/compilers/helpers.js（72 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `safeRe` | 16-27 | 12 | `export function safeRe(pattern, label, errors = []) {` |
| `pickDimensions` | 43-53 | 11 | `export function pickDimensions(r = {}, fallback = [], errors = []) {` |
| `ruleOut` | 56-69 | 14 | `export function ruleOut({ id, name, kind, severity = 'warning', level = 'warning', message, pattern, patterns, pathPattern, threshold, dimensions = [], extra = {} }) {` |

### lib/rule/compilers/list-kinds.js（13 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `listRegisteredKinds` | 9-12 | 4 | `export function listRegisteredKinds() {` |

### lib/rule/homoglyph.js（46 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `findHomoglyphs` | 32-40 | 9 | `export function findHomoglyphs(text) {` |
| `hasHomoglyphs` | 43-45 | 3 | `export function hasHomoglyphs(text) {` |

### lib/rule/loader.js（274 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isForceLoadRule` | 48-50 | 3 | `export function isForceLoadRule(ruleId) {` |
| `loadYamlRuleFile` | 98-107 | 10 | `export function loadYamlRuleFile(slot, dir = RULE_YAML_DIR) {` |
| `discoverRuleSlots` | 112-120 | 9 | `export function discoverRuleSlots(dir = RULE_YAML_DIR) {` |
| `resolveSlotOrder` | 135-166 | 32 | `export function resolveSlotOrder(order = null, { dir = RULE_YAML_DIR, includeTemplate = false } = {}) {` |
| `push` | 148-156 | 9 | `const push = (slot) => {` |
| `loadRuleFiles` | 177-226 | 50 | `export function loadRuleFiles(order = null, opts = {}) {` |
| `setSlotDisabled` | 240-274 | 35 | `export function setSlotDisabled(slot, disabled, opts = {}) {` |

### lib/rule/registry.js（122 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `registerCompiler` | 18-20 | 3 | `export function registerCompiler(kind, detect, compile) {` |
| `compileRule` | 28-61 | 34 | `export function compileRule(rule, ctx = {}) {` |
| `withSlot` | 43-51 | 9 | `const withSlot = (res) => {` |
| `compileAllRules` | 64-72 | 9 | `export function compileAllRules(rules, ctx = {}) {` |
| `withRuleScope` | 89-122 | 34 | `function withRuleScope(compiled, source) {` |

### lib/rule/scope.js（67 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `normalizeScopeRules` | 35-44 | 10 | `export function normalizeScopeRules(rule) {` |
| `resolveScopeAction` | 52-67 | 16 | `export function resolveScopeAction(scopeRules, scopeInfo = {}) {` |

### lib/score/docs-score.js（166 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectDocFiles` | 45-69 | 25 | `export function collectDocFiles(root = '.') {` |
| `walk` | 54-63 | 10 | `const walk = (dir) => {` |
| `checkDocsScore` | 84-153 | 70 | `export function checkDocsScore(root = '.') { // dsh-skip-func-length dsh-skip-complexity: 文档加分判定器（四检查链 + 宿主版本比对多条件，职责单一；53 行/24 复杂度为结构必然）` |
| `maxVersion` | 156-166 | 11 | `function maxVersion(list) {` |
| `cmp` | 157-164 | 8 | `const cmp = (a, b) => {` |

### lib/score/index.js（234 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countByDimension` | 50-82 | 33 | `export function countByDimension(findings = []) {` |
| `countHitFilesByDimension` | 92-107 | 16 | `export function countHitFilesByDimension(findings = []) {` |
| `scoreQuality` | 127-234 | 108 | `export function scoreQuality(findings = [], weights = {}, context = {}) {` |
| `ruleCountOf` | 184-188 | 5 | `const ruleCountOf = (dim) => {` |
| `denomOf` | 193-196 | 4 | `const denomOf = (dim) => {` |
| `dynamicRatio` | 199-208 | 10 | `const dynamicRatio = (dim) => {` |

### lib/self/index.js（197 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readmeTemplate` | 77-142 | 66 | `export function readmeTemplate({ name = 'dsh-git-push', description = 'DSH git 自动提交推送插件——统一函数入口架构', version = VERSION, versionTable = '' } = {}) {` |
| `yamlTemplate` | 145-157 | 13 | `export function yamlTemplate() {` |
| `selfVersion` | 160-162 | 3 | `export function selfVersion() {` |
| `versionInfo` | 169-181 | 13 | `export function versionInfo(pkgJson = '') {` |
| `helpSync` | 190-196 | 7 | `export function helpSync(helpText = '', knownFlags = []) {` |

### lib/skip-dirs.js（68 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditRulesDir` | 28-30 | 3 | `export function auditRulesDir() {` |
| `loadYamlBlacklistDirs` | 38-57 | 20 | `export function loadYamlBlacklistDirs() {` |
| `getSkipSet` | 63-67 | 5 | `export function getSkipSet() {` |

### scripts/audit-ext/dsh-inject-declarations.mjs（210 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isPluginEntry` | 55-58 | 4 | `function isPluginEntry(text) {` |
| `collectFiles` | 61-79 | 19 | `function collectFiles(repo) {` |
| `walk` | 63-76 | 14 | `const walk = (dir) => {` |
| `declaredInjectNames` | 85-103 | 19 | `function declaredInjectNames(text) {` |
| `stripTrailingComment` | 106-129 | 24 | `function stripTrailingComment(line) {` |
| `ctxServiceNotInjectedHits` | 132-155 | 24 | `function ctxServiceNotInjectedHits(text) {` |
| `defaultExportConflictLine` | 158-169 | 12 | `function defaultExportConflictLine(text) {` |

### scripts/audit-ext/variable-min-length.mjs（102 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isExcludedPath` | 29-36 | 8 | `const isExcludedPath = (rel) => {` |
| `walk` | 60-98 | 39 | `const walk = (dir) => {` |

### scripts/audit-gate.mjs（236 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseScopeValue` | 68-71 | 4 | `function parseScopeValue(rawValue) {` |
| `parseWeightsValue` | 73-81 | 9 | `function parseWeightsValue(rawValue) {` |
| `parseMaxScanFilesValue` | 83-88 | 6 | `function parseMaxScanFilesValue(rawValue) {` |
| `parseSlotListValue` | 90-92 | 3 | `function parseSlotListValue(rawValue) {` |
| `parseGateArgs` | 116-140 | 25 | `export function parseGateArgs(argv = []) {` |
| `runGateAudit` | 152-177 | 26 | `export async function runGateAudit(opts) {` |
| `muteStdout` | 184-188 | 5 | `export function muteStdout() {` |
| `emitAndExit` | 191-194 | 4 | `function emitAndExit(result, exitCode) {` |
| `main` | 197-218 | 22 | `async function main(argv) {` |
| `invokedDirectly` | 221-225 | 5 | `function invokedDirectly() {` |

### scripts/audit-runner.mjs（35 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `main` | 17-33 | 17 | `async function main() {` |

### scripts/audit-runtime-check.mjs（130 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseArgs` | 35-45 | 11 | `function parseArgs() {` |
| `collectJs` | 48-54 | 7 | `function collectJs(dir) {` |
| `runFile` | 60-98 | 39 | `async function runFile(file, obj) {` |
| `main` | 101-127 | 27 | `async function main() {` |

### scripts/browser-page-probe.mjs（272 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseArgv` | 33-44 | 12 | `function parseArgv(argv) {` |
| `findDirUnder` | 68-82 | 15 | `function findDirUnder(root, names, maxDepth = 4) {` |
| `sharedRootCandidates` | 85-107 | 23 | `function sharedRootCandidates() {` |
| `readBrowserEnvRecord` | 113-119 | 7 | `function readBrowserEnvRecord() {` |
| `discover` | 127-182 | 56 | `function discover() {` |
| `loadPlaywright` | 191-199 | 9 | `function loadPlaywright(pwroot) {` |
| `stripHtml` | 202-208 | 7 | `function stripHtml(html) {` |

### scripts/build-client.mjs（132 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readParts` | 66-72 | 7 | `export function readParts(order = PART_ORDER, dir = PARTS_DIR) {` |
| `buildClient` | 77-80 | 4 | `export function buildClient(order = PART_ORDER, dir = PARTS_DIR) {` |
| `checkShape` | 83-92 | 10 | `export function checkShape(code) {` |
| `main` | 96-127 | 32 | `function main(argv = process.argv.slice(2)) {` |

### scripts/bump-version.mjs（179 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseArgs` | 39-50 | 12 | `function parseArgs(argv) {` |
| `cmpVer` | 55-60 | 6 | `function cmpVer(a, b) {` |
| `bumpPatch` | 63-66 | 4 | `function bumpPatch(v) {` |
| `readJson` | 68-70 | 3 | `function readJson(p) {` |
| `buildVersionLine` | 83-100 | 18 | `function buildVersionLine(oldLine, newVer, oldVer, message, commentOverride = '') {` |

### scripts/check-js-scope.mjs（88 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `filesFromConfig` | 46-53 | 8 | `function filesFromConfig(path) {` |

### scripts/check.mjs（204 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectJs` | 22-31 | 10 | `function collectJs(dir, acc = []) {` |
| `collectJson` | 34-42 | 9 | `function collectJson(dir, acc = []) {` |
| `layerOf` | 149-156 | 8 | `const layerOf = (rel) => {` |

### scripts/cpu-sample.mjs（189 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `arg` | 28-31 | 4 | `const arg = (name, dflt) => {` |
| `cpuTotals` | 40-48 | 9 | `function cpuTotals() {` |
| `procTicks` | 51-58 | 8 | `function procTicks(pid) {` |
| `procRssMB` | 61-66 | 6 | `function procRssMB(pid) {` |
| `procInfo` | 69-75 | 7 | `function procInfo(pid) {` |
| `pids` | 78-80 | 3 | `function pids() {` |
| `memMB` | 83-89 | 7 | `function memMB() {` |
| `detectHostPid` | 95-101 | 7 | `function detectHostPid() {` |
| `sampleOnce` | 104-147 | 44 | `function sampleOnce() {` |
| `line` | 149-154 | 6 | `function line(rec) {` |
| `finish` | 170-185 | 16 | `function finish() {` |

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

### scripts/picker-repro.mjs（116 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `extractCss` | 37-38 | 2 | `export function extractCss(src = readFileSync(CONST_FILE, 'utf8')) {` |
| `buildReproHtml` | 44-65 | 22 | `export function buildReproHtml({ count = DEFAULT_COUNT, css = extractCss() } = {}) {` |
| `argOf` | 86-89 | 4 | `function argOf(name, def) {` |
| `main` | 91-110 | 20 | `function main() {` |

### scripts/platform-scan.mjs（169 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectFiles` | 56-68 | 13 | `function collectFiles(root, exts, dir = root, out = []) {` |
| `commentLineSet` | 71-79 | 9 | `function commentLineSet(text) {` |
| `scanPlatformCode` | 87-115 | 29 | `export function scanPlatformCode(root, { exts = DEFAULT_EXTS } = {}) {` |
| `parseArgs` | 118-132 | 15 | `function parseArgs(argv) {` |
| `printReport` | 135-153 | 19 | `function printReport(result, top) {` |

### scripts/rename-locator.mjs（97 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fnNameAtLine` | 28-31 | 4 | `function fnNameAtLine(src, line) {` |
| `locateVariables` | 39-77 | 39 | `export function locateVariables(src = '', opts = {}) {` |
| `scopeOf` | 42-45 | 4 | `const scopeOf = (line) => {` |
| `main` | 79-95 | 17 | `function main() {` |

### scripts/rule-switch.mjs（98 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveRulesDir` | 37-42 | 6 | `function resolveRulesDir(argv) {` |
| `listSlots` | 45-55 | 11 | `function listSlots(dir) {` |
| `main` | 57-95 | 39 | `function main(argv = process.argv.slice(2)) {` |

### scripts/rules-solo-audit.mjs（174 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ruleToYmlEntry` | 37-44 | 8 | `function ruleToYmlEntry(r) {` |
| `makeSoloRuleset` | 47-61 | 15 | `function makeSoloRuleset(ruleOrNull) {` |
| `auditWithRuleset` | 64-69 | 6 | `async function auditWithRuleset(repo, rulesetDir) {` |
| `runRulesSoloAudit` | 76-150 | 75 | `export async function runRulesSoloAudit(repo, opts = {}) {` |

### scripts/scan-file-io.mjs（718 行 · 27 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isFnSignature` | 116-469 | 354 | `function isFnSignature(s) {` |
| `stripCommentLines` | 129-153 | 25 | `function stripCommentLines(lines, uptoIdx) {` |
| `scanEnclosure` | 156-173 | 18 | `function scanEnclosure(lines, lineIdx) {` |
| `inRequestPath` | 181-194 | 14 | `function inRequestPath(lines, lineIdx) {` |
| `contextAt` | 197-200 | 4 | `function contextAt(lines, lineIdx) {` |
| `ioTypeOf` | 203-205 | 3 | `function ioTypeOf(opName = '') {` |
| `collectFiles` | 213-231 | 19 | `function collectFiles(targets) {` |
| `walk` | 215-228 | 14 | `const walk = (p) => {` |
| `isRegexStart` | 248-254 | 7 | `function isRegexStart(out, next) {` |
| `advanceInsideState` | 268-287 | 20 | `function advanceInsideState(line, i, st) {` |
| `stripLiterals` | 289-310 | 22 | `function stripLiterals(line) {` |
| `scanFile` | 316-364 | 49 | `function scanFile(file) {` |
| `riskOfFallback` | 377-384 | 8 | `function riskOfFallback(entry, ctx) {` |
| `riskOfByAst` | 397-410 | 14 | `function riskOfByAst(astHits, line, op, entry, ctx) {` |
| `collectVarAssignments` | 413-427 | 15 | `function collectVarAssignments(lines) {` |
| `extractArg` | 430-454 | 25 | `function extractArg(line, op, opName) {` |
| `resolvePathArg` | 457-463 | 7 | `function resolvePathArg(arg, varMap, lineIdx) {` |
| `tagsOf` | 474-480 | 7 | `function tagsOf(h) {` |
| `riskMark` | 483-485 | 3 | `function riskMark(risk) {` |
| `printText` | 492-517 | 26 | `function printText(hits, { writeOnly = false, riskOnly = '', summary = false } = {}) {` |
| `printJson` | 520-522 | 3 | `function printJson(hits) {` |
| `main` | 530-580 | 51 | `export function main(argv = process.argv.slice(2)) {` |
| `splitMulti` | 541-541 | 1 | `const splitMulti = (v) => String(v \|\| '').split(',').map((x) => x.trim()).filter(Boolean);` |
| `scanFileIo` | 583-604 | 22 | `export function scanFileIo(opts = {}) {` |
| `summarize` | 607-624 | 18 | `export function summarize(hits) {` |
| `count` | 608-612 | 5 | `const count = (key) => {` |
| `printReport` | 636-712 | 77 | `function printReport(hits, opts = {}) {` |

### scripts/scan-fs-hotspots.mjs（108 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseArgs` | 31-43 | 13 | `function parseArgs(argv) {` |
| `collectFiles` | 46-67 | 22 | `function collectFiles(dir, o, out = []) {` |

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

### scripts/symbol-index.mjs（86 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectFiles` | 23-35 | 13 | `function collectFiles(root, exts, dir = root, out = []) {` |
| `parseArgs` | 38-52 | 15 | `function parseArgs(argv) {` |

### scripts/verify-prestep.mjs（101 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `check` | 20-21 | 2 | `function check(name, ok) { results.push([name, !!ok]); if (!ok) console.log('  ❌', name); }` |

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

### test/app/test-http-audit-split.mjs（140 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `http` | 26-140 | 115 | `async function http(method, url, extra = {}) {` |
| `assertRouted` | 31-35 | 5 | `function assertRouted(result, label) {` |

### test/app/test-plugin.mjs（678 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeExemptRepo` | 509-515 | 7 | `function makeExemptRepo() {` |
| `addSecretFile` | 516-519 | 4 | `function addSecretFile(root, path) {` |
| `fsStatMode` | 673-675 | 3 | `function fsStatMode(file) {` |

### test/app/test-settings-persistence.mjs（253 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `clientSubmitKeys` | 28-38 | 11 | `function clientSubmitKeys() {` |
| `allowlistKeys` | 47-52 | 6 | `function allowlistKeys() {` |
| `cfgMappingKeys` | 55-253 | 199 | `function cfgMappingKeys() {` |
| `isolatedEnv` | 72-79 | 8 | `function isolatedEnv() {` |

### test/app/test-slash-commands.mjs（287 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `inv` | 15-17 | 3 | `function inv(cwd) {` |

### test/app/test-symlink-resolution.mjs（104 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildFixture` | 25-41 | 17 | `function buildFixture() {` |
| `runNode` | 43-45 | 3 | `function runNode(args, env) {` |

### test/app/test-task-queue.mjs（232 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkRepo` | 16-23 | 8 | `function mkRepo() {` |
| `mkDirtyRepo` | 31-35 | 5 | `function mkDirtyRepo() {` |
| `wait` | 36-37 | 2 | `function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }` |
| `mockJobs` | 39-57 | 19 | `function mockJobs() {` |

### test/app/test-tools-e2e.mjs（86 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 26-32 | 7 | `function makeRepo(name) {` |

### test/app/test-workspace-paths.mjs（139 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mod` | 28-28 | 1 | `const mod = () => import('../../lib/core/workspace-paths.js');` |
| `h` | 29-29 | 1 | `const h = () => import('../../lib/app/handlers/workspace-paths.js');` |

### test/audit/_archived/test-inject-switch.mjs（141 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `renderAuditInputs` | 28-98 | 71 | `function renderAuditInputs(value) {` |
| `req` | 43-56 | 14 | `const req = (name) => {` |
| `findChild` | 100-100 | 1 | `const findChild = (inputs) => inputs.find((p) => p['aria-label'] === LABEL);` |

### test/audit/_archived/test-inject-system-prompt.mjs（374 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `renderAuditInputs` | 25-90 | 66 | `function renderAuditInputs(value) {` |
| `req` | 39-50 | 12 | `const req = (name) => {` |
| `findSwitch` | 92-92 | 1 | `const findSwitch = (inputs) => inputs.find((p) => p['aria-label'] === LABEL);` |

### test/audit/_archived/test-sidebar-interaction.mjs（192 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeJsx` | 26-34 | 9 | `function makeJsx() {` |
| `createElement` | 27-32 | 6 | `const createElement = (type, props) => {` |
| `extractFunction` | 37-192 | 156 | `function extractFunction(src, signature) {` |
| `renderRow` | 54-192 | 139 | `function renderRow({ disabled = false, slot = 'frontend', stats, locked = false } = {}) {` |
| `walk` | 80-86 | 7 | `function walk(node, out = []) {` |
| `clsOf` | 88-88 | 1 | `const clsOf = (n) => String((n.props && n.props.className) \|\| '');` |
| `findClass` | 89-89 | 1 | `const findClass = (tree, cls) => walk(tree).find((n) => clsOf(n).includes(cls));` |

### test/audit/test-analysis-coverage.mjs（77 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeProject` | 20-27 | 8 | `function makeProject() {` |

### test/audit/test-ast-confirm-span.mjs（61 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `col` | 27-27 | 1 | `const col = (n, needle) => lines[n - 1].indexOf(needle) + 1;` |

### test/audit/test-audit-archive-exempt.mjs（64 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withRepo` | 23-27 | 5 | `async function withRepo(fn) {` |

### test/audit/test-audit-git-boundary.mjs（94 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `walk` | 21-28 | 8 | `function walk(dir, out = []) {` |
| `stripComments` | 31-33 | 3 | `function stripComments(text) {` |
| `specifiersOf` | 36-40 | 5 | `export function specifiersOf(text) {` |
| `findViolations` | 43-54 | 12 | `export function findViolations(files, rules) {` |

### test/audit/test-audit-guards.mjs（294 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `repo` | 35-43 | 9 | `function repo(files) {` |
| `withGitRepo` | 227-232 | 6 | `async function withGitRepo(fn) {` |
| `pathsOf` | 234-234 | 1 | `const pathsOf = (files) => files.map((f) => f.path).sort();` |

### test/audit/test-audit-rule-packs.mjs（219 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 41-41 | 1 | `const hits = (text, rule) => run(text).filter((f) => f.rule === rule);` |
| `has` | 42-42 | 1 | `const has = (text, rule) => hits(text, rule).length > 0;` |
| `msg` | 43-43 | 1 | `const msg = (text, rule) => hits(text, rule)[0]?.message \|\| '';` |
| `makeRepo` | 114-121 | 8 | `function makeRepo(files) {` |
| `auditCsharp` | 124-132 | 9 | `async function auditCsharp(repo) {` |

### test/audit/test-audit-scope.mjs（359 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `read` | 36-36 | 1 | `const read = (p) => readFileSync(join(ROOT, p), 'utf8');` |
| `read` | 325-325 | 1 | `const read = (p) => readFileSync(join(ROOT, p), 'utf8');` |

### test/audit/test-audit-ui-contract.mjs（192 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makePanel` | 23-29 | 7 | `function makePanel(patch = {}) {` |
| `assertThrowsWith` | 32-41 | 10 | `function assertThrowsWith(fn, keywords, label) {` |

### test/audit/test-auditignore.mjs（145 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setupRepo` | 11-32 | 22 | `function setupRepo() {` |

### test/audit/test-button.mjs（218 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditFiles` | 114-122 | 9 | `async function auditFiles(files) {` |

### test/audit/test-cli-audit-parity.mjs（69 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeAuditRepo` | 20-40 | 21 | `function makeAuditRepo() {` |

### test/audit/test-collector-ignore.mjs（68 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 21-31 | 11 | `function makeRepo() {` |
| `paths` | 33-33 | 1 | `const paths = (list) => list.map((f) => String(f.path).replace(/\\/g, '/'));` |

### test/audit/test-conv-rule-scope.mjs（46 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `extsOf` | 17-27 | 11 | `function extsOf(id) {` |

### test/audit/test-dataflow.mjs（289 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 30-32 | 3 | `function hits(text) {` |
| `n` | 149-149 | 1 | `const n = (src) => checkClearAccessAst(src).length;` |
| `n` | 238-238 | 1 | `const n = (src) => checkClearAccessAst(src).length;` |

### test/audit/test-docs-score.mjs（187 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeProject` | 19-27 | 9 | `function makeProject(files) {` |

### test/audit/test-dup.mjs（350 行 · 15 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseUser` | 31-36 | 6 | `function parseUser(row) {` |
| `parseOrder` | 37-42 | 6 | `function parseOrder(row) {` |
| `parseItem` | 43-48 | 6 | `function parseItem(row) {` |
| `alpha` | 60-65 | 6 | `function alpha(x) {` |
| `beta` | 68-73 | 6 | `function beta(y) {` |
| `alpha` | 84-88 | 5 | `function alpha() {` |
| `beta` | 91-95 | 5 | `function beta() {` |
| `one` | 106-107 | 2 | `function one(x) { return x + 1; }` |
| `two` | 107-108 | 2 | `function two(x) { return x + 1; }` |
| `three` | 108-109 | 2 | `function three(x) { return x + 1; }` |
| `alpha` | 116-119 | 4 | `function alpha(x) {` |
| `beta` | 120-123 | 4 | `function beta(y) {` |
| `mk` | 133-133 | 1 | `const mk = (fnName) => `` |
| `mk` | 153-153 | 1 | `const mk = (fnName) => `` |
| `mk` | 171-171 | 1 | `const mk = (fnName, params) => `` |

### test/audit/test-empty-catch.mjs（81 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `read` | 65-65 | 1 | `const read = (p) => readFileSync(join(ROOT, p), 'utf8');` |

### test/audit/test-exempt.mjs（680 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withHeader` | 115-115 | 1 | `const withHeader = (text, marker) => `// ${marker}\n${text}`;` |
| `makeRepo` | 208-210 | 3 | `function makeRepo() {` |
| `f` | 292-294 | 3 | `function f(kind, rule, line = 3) {` |
| `compileGrouped` | 501-509 | 9 | `async function compileGrouped() {` |

### test/audit/test-false-positive-fixes.mjs（549 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ensureDataDir` | 41-45 | 5 | `export async function ensureDataDir(file) { await mkdir(dirname(file), { recursive: true }); }` |
| `saveData` | 42-45 | 4 | `export async function saveData(file, data) {` |
| `tr` | 50-54 | 5 | `export function tr(s, vars) { return s.split('{' + 'k' + '}').join('v'); }` |
| `loadData` | 51-54 | 4 | `export async function loadData() {` |
| `postData` | 55-58 | 4 | `export async function postData() {` |
| `byRule` | 96-96 | 1 | `const byRule = (findings, ruleId) => findings.filter((f) => f.rule === ruleId);` |
| `checkRegexRulesSafe` | 148-159 | 12 | `function checkRegexRulesSafe() {` |
| `hasPatchYml` | 214-214 | 1 | `const hasPatchYml = (gg) => Object.values(gg).flat().some((r) => r.id === 'dsh/patch-insert-unique-id');` |

### test/audit/test-file-health.mjs（124 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `rule` | 10-22 | 13 | `function rule(over = {}) {` |

### test/audit/test-folder-scope.mjs（106 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countSourceDirs` | 28-47 | 20 | `function countSourceDirs(tree, { threshold = 1, excludeDirs = [] } = {}) {` |

### test/audit/test-gitignore-match.mjs（141 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `gitAvailable` | 23-25 | 3 | `function gitAvailable() {` |
| `makeTree` | 29-37 | 9 | `function makeTree() {` |
| `ig` | 41-41 | 1 | `const ig = (text, f) => isIgnored(text, f);` |
| `hits` | 135-135 | 1 | `const hits = (rel) => isIgnoredByRules(rules, rel);` |

### test/audit/test-gitignore-nongit-dir.mjs（40 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `rel` | 17-17 | 1 | `const rel = (list) => list.map((f) => String(f?.path ?? f).replace(SANDBOX + '/', '')).sort();` |

### test/audit/test-history-audit.mjs（111 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 17-29 | 13 | `function makeRepo() {` |

### test/audit/test-ignore-e2e.mjs（93 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setupRepo` | 38-51 | 14 | `function setupRepo({ git = true } = {}) {` |
| `hitNames` | 54-54 | 1 | `const hitNames = (findings) => [...new Set((findings \|\| []).map((f) => String(f.file \|\| '').replace(/^.*\//, '')))].sort();` |

### test/audit/test-link-check.mjs（230 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeFetch` | 14-21 | 8 | `function fakeFetch(map = {}) {` |

### test/audit/test-lint-adapter.mjs（193 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeProject` | 26-38 | 13 | `function makeProject({ withRuff = false, script = '' } = {}) {` |
| `mk` | 75-75 | 1 | `const mk = (code, msg, file, row) => ruffItemToFinding(` |

### test/audit/test-loop-no-fallback-return.mjs（115 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 19-19 | 1 | `const hits = (src) => [...loopNoFallbackReturnLines(src)].sort((a, b) => a - b);` |

### test/audit/test-magic-number.mjs（130 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 16-18 | 3 | `function hits(text) {` |

### test/audit/test-max-lines-scope.mjs（66 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withScope` | 24-26 | 3 | `function withScope(action) {` |

### test/audit/test-preprocess-render.mjs（121 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeBlockerRepo` | 25-37 | 13 | `function makeBlockerRepo() {` |

### test/audit/test-privacy-ownership.mjs（87 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 56-59 | 4 | `const hits = async (ownership) => {` |

### test/audit/test-project-type-filter.mjs（91 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkRepo` | 17-21 | 5 | `function mkRepo({ name = null } = {}) {` |

### test/audit/test-repeated-strings-cs.mjs（53 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `kinds` | 18-18 | 1 | `const kinds = (src) => tokenize(src).filter((t) => t.type === 'str' \|\| t.type === 'tmpl').map((t) => t.type);` |

### test/audit/test-rule-loading.mjs（645 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `block` | 397-400 | 4 | `const block = (text) => {` |

### test/audit/test-scope.mjs（177 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadCheckFuncLines` | 132-133 | 2 | `function loadCheckFuncLines() { return { checkFuncLines, checkComplexity }; }` |
| `loadNaming` | 133-134 | 2 | `function loadNaming() { return { checkNameLengthAst }; }` |

### test/audit/test-score-zero-rule-dims.mjs（80 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countsExcept` | 22-22 | 1 | `const countsExcept = (...listed) => Object.fromEntries(` |

### test/audit/test-treesitter.mjs（362 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 36-43 | 8 | `function makeRepo(files) {` |
| `auditHits` | 46-69 | 24 | `function auditHits(repo, extraEnv = {}) {` |
| `col` | 92-92 | 1 | `const col = (n, needle) => lines[n - 1].indexOf(needle) + 1;` |
| `countBrokenNodes` | 237-246 | 10 | `function countBrokenNodes(tree) {` |
| `walk` | 239-243 | 5 | `const walk = (node) => {` |
| `textOf` | 248-248 | 1 | `const textOf = (c) => c.lines.join('\n');` |
| `makeRepo` | 313-320 | 8 | `function makeRepo(files) {` |
| `auditRuleHits` | 323-343 | 21 | `function auditRuleHits(repo, rule) {` |

### test/git/test-account-ssh.mjs（149 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isolatedEnv` | 17-24 | 8 | `function isolatedEnv() {` |

### test/git/test-audit-bad-file.mjs（129 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setupBadFile` | 40-45 | 6 | `function setupBadFile(relPath, content) {` |
| `cleanup` | 46-50 | 5 | `function cleanup(relPath) {` |

### test/git/test-audit-boundary.mjs（275 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 31-40 | 10 | `function makeRepo(t) {` |
| `writeBlocker` | 43-50 | 8 | `function writeBlocker(dir, name = 'bad.js') {` |
| `makeRepo` | 116-126 | 11 | `function makeRepo() {` |
| `stageBlocker` | 132-139 | 8 | `function stageBlocker(dir) {` |

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

### test/git/test-pre-commit-engine.mjs（420 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeEngineSource` | 46-75 | 30 | `function fakeEngineSource(mode) {` |
| `makeFakeEngines` | 78-87 | 10 | `function makeFakeEngines(dir) {` |
| `runWithFake` | 90-97 | 8 | `function runWithFake(engines, mode, extra = {}) {` |
| `makeBlockerRepo` | 100-112 | 13 | `function makeBlockerRepo() {` |

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

### test/tool/test-cli.mjs（1062 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `usageLines` | 57-67 | 11 | `function usageLines(helpText, cliName, command) {` |
| `helpOf` | 70-74 | 5 | `function helpOf(cliName) {` |
| `runCliFile` | 151-160 | 10 | `async function runCliFile(cliName, argv, opts = {}) {` |
| `runInWaves` | 163-169 | 7 | `async function runInWaves(tasks, waveSize = 4) {` |
| `run` | 400-405 | 6 | `const run = (file, args) => {` |
| `mockReact` | 558-564 | 7 | `function mockReact() {` |
| `req` | 866-883 | 18 | `const req = (name) => {` |
| `req` | 944-963 | 20 | `const req = (name) => {` |
| `req` | 1012-1030 | 19 | `const req = (name) => {` |

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

### test/tool/test-platform-scan.mjs（98 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeProject` | 20-46 | 27 | `function makeProject() {` |

### test/tool/test-scan-and-cache.mjs（334 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFakeTree` | 42-64 | 23 | `function makeFakeTree() {` |
| `write` | 44-49 | 6 | `const write = (rel) => {` |
| `dryRunStats` | 142-149 | 8 | `function dryRunStats() {` |
| `keyOf` | 186-186 | 1 | `const keyOf = (abs) => cacheKeyFor(importClosure(abs));` |
| `makeProject` | 235-242 | 8 | `function makeProject() {` |

### test/tool/test-scope-collisions.mjs（256 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeForeignProject` | 109-117 | 9 | `function makeForeignProject({ withContract = false } = {}) {` |
| `makeAuditProject` | 146-152 | 7 | `function makeAuditProject({ name = 'app', contract = null } = {}) {` |

### test/tool/test-symbol-index.mjs（120 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `build` | 31-34 | 4 | `function build(extra = {}) {` |
| `hasEdge` | 36-36 | 1 | `const hasEdge = (idx, from, to, via) => idx.edges.some((e) => e.from === from && e.to === to && e.via === via);` |

### test/tool/test-tree-doc.mjs（221 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeReadme` | 41-43 | 3 | `function makeReadme(tree) {` |

### test/tool/test-tree-first.mjs（260 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFixture` | 61-65 | 5 | `async function makeFixture() {` |
| `hardLines` | 67-72 | 6 | `function hardLines(res) {` |
| `makeFixture` | 186-190 | 5 | `async function makeFixture() {` |
| `hitLines` | 192-192 | 1 | `const hitLines = (res) => res.findings` |
| `isShort` | 244-244 | 1 | `const isShort = (n) => String(n).length <= 2 && !['tr', 't'].includes(n);` |

<!-- dshgp-functions:end -->
