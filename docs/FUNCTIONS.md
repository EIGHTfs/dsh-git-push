# 函数列表

> 由 `scripts/doc-func.mjs` 维护：`gen` 打印 / `apply` 更新本节 / `check` 查漂移（扫描 lib/scripts/test 函数）。

<!-- dshgp-functions:start -->
## 函数列表

### lib/app/apply.js（276 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `apply` | 43-275 | 233 | `export async function apply(ctx, config = {}) {` |
| `envInjectText` | 98-125 | 28 | `const envInjectText = (cwdOverride) => {` |

### lib/app/audit-api.js（159 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `exemptStatsOf` | 27-43 | 17 | `export function exemptStatsOf(findings = []) {` |
| `groupKeyOf` | 46-51 | 6 | `function groupKeyOf(finding, groupBy, ruleSlotMap) {` |
| `parseSeverityFilter` | 57-61 | 5 | `export function parseSeverityFilter(raw) {` |
| `aggregateFindings` | 70-91 | 22 | `export function aggregateFindings(findings = [], opts = {}) {` |
| `runAuditApi` | 99-158 | 60 | `export async function runAuditApi(repo, params = {}, cfg = {}) {` |

### lib/app/command-registry.js（248 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `applyFlagToken` | 186-202 | 17 | `function applyFlagToken(args, tok, rest, i, byFlag) {` |
| `validateParamConstraints` | 205-211 | 7 | `function validateParamConstraints(args, params) {` |
| `parseRegistryArgs` | 213-233 | 21 | `export function parseRegistryArgs(rest = [], params = []) {` |
| `registryByName` | 236-238 | 3 | `export function registryByName(name) {` |
| `registryByCli` | 241-243 | 3 | `export function registryByCli(cli) {` |
| `buildToolsListText` | 246-248 | 3 | `export function buildToolsListText() {` |

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

### lib/app/handlers/arch-json.js（79 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `repositoryEvidence` | 18-32 | 15 | `function repositoryEvidence(repoPath, { execFileSync }) {` |
| `run` | 19-24 | 6 | `const run = (args) => {` |
| `readTreeDoc` | 35-40 | 6 | `function readTreeDoc(repoPath) {` |
| `exportArchJson` | 48-78 | 31 | `export async function exportArchJson(args = {}, deps = {}) {` |

### lib/app/handlers/clone.js（154 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseCloneRequest` | 23-31 | 9 | `function parseCloneRequest(body) {` |
| `busyResponse` | 38-53 | 16 | `function busyResponse(target, dest) {` |
| `handleRepoClone` | 56-118 | 63 | `export async function handleRepoClone(ctx) {` |
| `handleCloneLogs` | 121-125 | 5 | `export function handleCloneLogs(ctx) {` |
| `handleCloneAbort` | 128-131 | 4 | `export function handleCloneAbort() {` |
| `handleClonePreview` | 134-146 | 13 | `export async function handleClonePreview(ctx) {` |
| `handleCloneProgress` | 149-154 | 6 | `export function handleCloneProgress(ctx) {` |

### lib/app/handlers/identity-rewrite.js（95 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `bool` | 19-21 | 3 | `function bool(v) {` |
| `callIdentityRewrite` | 28-94 | 67 | `export async function callIdentityRewrite(args = {}, env = {}, cfg = {}) {` |

### lib/app/handlers/meta.js（175 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `currentCommitIdentity` | 23-37 | 15 | `function currentCommitIdentity() {` |
| `handleStatus` | 40-54 | 15 | `export function handleStatus(ctx) {` |
| `handleScan` | 57-60 | 4 | `export function handleScan(ctx) {` |
| `handleBrowse` | 63-67 | 5 | `export function handleBrowse(ctx) {` |
| `handleTools` | 70-72 | 3 | `export function handleTools() {` |
| `handleToolProbes` | 75-77 | 3 | `export function handleToolProbes() {` |
| `ruleSlotStats` | 87-94 | 8 | `function ruleSlotStats(r) {` |
| `listRuleSlots` | 97-116 | 20 | `export function listRuleSlots(order, disabledSlots = [], hitStats = null) {` |
| `handleRuleSlots` | 119-122 | 4 | `export function handleRuleSlots(ctx) {` |
| `handleRuleDetail` | 125-148 | 24 | `export function handleRuleDetail(ctx) {` |
| `count` | 140-140 | 1 | `const count = (sev) => detail.filter((x) => x.severity === sev).length;` |
| `handleAudit` | 151-164 | 14 | `export async function handleAudit(ctx) {` |
| `handleToggleRule` | 167-175 | 9 | `export function handleToggleRule(ctx) {` |

### lib/app/handlers/repo-actions.js（143 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `handleRepoVisibility` | 16-21 | 6 | `export async function handleRepoVisibility(ctx) {` |
| `handleVisibilityGet` | 24-33 | 10 | `async function handleVisibilityGet({ query, env }) {` |
| `handleVisibilityPost` | 36-45 | 10 | `async function handleVisibilityPost({ body, env }) {` |
| `handleRepoPush` | 48-92 | 45 | `export async function handleRepoPush(ctx) {` |
| `handleRepoCommit` | 95-143 | 49 | `export async function handleRepoCommit(ctx) {` |

### lib/app/handlers/repos.js（231 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildLocalList` | 23-55 | 33 | `function buildLocalList(indexMap, root, deadline) {` |
| `applyLiveRemote` | 58-109 | 52 | `async function applyLiveRemote(list, deadline) {` |
| `handleReposLocal` | 112-133 | 22 | `export async function handleReposLocal(ctx) {` |
| `handleReposLocalScan` | 135-144 | 10 | `export function handleReposLocalScan(ctx) {` |
| `handleReposLocalScanWait` | 147-152 | 6 | `export async function handleReposLocalScanWait(ctx) {` |
| `refreshOneTarget` | 158-192 | 35 | `async function refreshOneTarget(t, env) {` |
| `handleReposLocalRefresh` | 195-204 | 10 | `export async function handleReposLocalRefresh(ctx) {` |
| `handleReposCloud` | 207-231 | 25 | `export async function handleReposCloud(ctx) {` |

### lib/app/handlers/settings.js（56 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `handleSettingsGet` | 13-19 | 7 | `export function handleSettingsGet(ctx) {` |
| `handleSettingsSet` | 22-56 | 35 | `export async function handleSettingsSet(ctx) {` |

### lib/app/http-handlers.js（123 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `adaptHttpHandler` | 37-54 | 18 | `export async function adaptHttpHandler(req, res, env, cfg) {` |
| `readBody` | 57-60 | 4 | `function readBody(req) {` |
| `buildCtx` | 63-65 | 3 | `function buildCtx(req, method, env, cfg, query, body, path) {` |
| `handleHttp` | 75-122 | 48 | `export async function handleHttp(req = {}, env = {}, cfg = defaultConfig()) {` |

### lib/app/inject-text.js（188 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildIdentityInjectionText` | 69-79 | 11 | `export function buildIdentityInjectionText() {` |
| `buildRequirementsInjectionText` | 81-93 | 13 | `export function buildRequirementsInjectionText() {` |
| `detectHostIp` | 114-125 | 12 | `function detectHostIp() {` |
| `buildAuditApiGuide` | 131-158 | 28 | `export function buildAuditApiGuide(repo = '', opts = {}) {` |
| `formatAuditBlock` | 160-187 | 28 | `export function formatAuditBlock(r = {}) {` |

### lib/app/scan-root.js（23 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `getDefaultScanRoot` | 13-23 | 11 | `export function getDefaultScanRoot(env = {}, cfg = {}) {` |

### lib/app/schema.js（148 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFallbackSchema` | 31-72 | 42 | `function makeFallbackSchema() {` |
| `fn` | 33-33 | 1 | `const fn = (v) => (v === undefined ? meta.default : v);` |
| `redactConfig` | 140-147 | 8 | `export function redactConfig(cfg = {}) {` |

### lib/app/settings-bridge.js（167 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `applyTypedKeys` | 57-66 | 10 | `function applyTypedKeys(cfg, patch) {` |
| `applyClampedNumbers` | 69-77 | 9 | `function applyClampedNumbers(cfg, patch) {` |
| `applySettingsToCfg` | 79-86 | 8 | `export function applySettingsToCfg(cfg, patch) {` |
| `setSettingsFileOverride` | 90-92 | 3 | `export function setSettingsFileOverride(path) {` |
| `settingsFilePath` | 95-98 | 4 | `export function settingsFilePath({ workspaceRoot = '' } = {}) {` |
| `settingsLogFilePath` | 106-109 | 4 | `export function settingsLogFilePath({ workspaceRoot = '' } = {}) {` |
| `appendSettingsLog` | 116-140 | 25 | `export function appendSettingsLog(entry, env = {}) {` |
| `readSettings` | 147-149 | 3 | `export function readSettings(env = {}) {` |
| `writeSettingsKey` | 158-167 | 10 | `export async function writeSettingsKey(key, jsonValue, env = {}) {` |

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

### lib/app/tool-call.js（558 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pushWithPostSteps` | 57-92 | 36 | `async function pushWithPostSteps(args, env, cfg) {` |
| `pushJobOutcome` | 112-135 | 24 | `export function pushJobOutcome(r = {}) {` |
| `short` | 114-114 | 1 | `const short = (sha) => String(sha \|\| '').slice(0, 8);` |
| `cloneJobOutcome` | 143-148 | 6 | `export function cloneJobOutcome(r = {}) {` |
| `buildCommitPushJobSpec` | 151-168 | 18 | `function buildCommitPushJobSpec(repo, doPush) {` |
| `done` | 156-164 | 9 | `const done = (async () => {` |
| `callCloneJob` | 182-212 | 31 | `async function callCloneJob(args, jobs, exec, log, env = {}, cfg = {}) {` |
| `buildCloneJobSpec` | 215-232 | 18 | `function buildCloneJobSpec(target, dest, doClone) {` |
| `done` | 220-228 | 9 | `const done = (async () => {` |
| `callCommitPush` | 239-286 | 48 | `async function callCommitPush(args, env, cfg, log, jobs, exec) {` |
| `doPush` | 255-255 | 1 | `const doPush = () => pushWithPostSteps(args, env, cfg);` |
| `buildAuditOpts` | 297-308 | 12 | `function buildAuditOpts(args, cfg, scope) {` |
| `runHistoryAuditTool` | 314-346 | 33 | `async function runHistoryAuditTool(args, env, cfg, jobs, exec, weights) {` |
| `doHistory` | 320-323 | 4 | `const doHistory = async () => {` |
| `callCodeAudit` | 348-360 | 13 | `async function callCodeAudit(args, env, cfg, log, jobs, exec) {` |
| `runStandardAuditTool` | 363-402 | 40 | `async function runStandardAuditTool(args, env, cfg, log, weights) {` |
| `callTool` | 404-529 | 126 | `export async function callTool(toolName, args = {}, env = {}, cfg = defaultConfig(), log = null, jobs = null, exec = null) {` |
| `shellSplit` | 532-550 | 19 | `function shellSplit(input) {` |
| `readTextSafe` | 553-557 | 5 | `function readTextSafe(path = '') {` |

### lib/app/tools.js（27 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `paramsToParameters` | 12-18 | 7 | `function paramsToParameters(params = []) {` |
| `listTools` | 21-27 | 7 | `export function listTools() {` |

### lib/arch/aggregate.js（90 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `aggregateModules` | 17-76 | 60 | `export function aggregateModules(facts, { min = 8, max = 15 } = {}) {` |
| `componentId` | 84-89 | 6 | `function componentId(layer, mods) {` |

### lib/arch/extract.js（463 行 · 14 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `detectSourceRoot` | 41-64 | 24 | `export function detectSourceRoot(repoPath) {` |
| `collectSync` | 67-78 | 12 | `function collectSync(dir, out = [], depth = 0) {` |
| `ioPathFromLine` | 89-463 | 375 | `export function ioPathFromLine(text, line) {` |
| `statementAt` | 114-133 | 20 | `export function statementAt(text, line) {` |
| `startsStatement` | 118-118 | 1 | `const startsStatement = (s) => /^\s*(const\|let\|var\|function\|return\|if\|for\|while\|await\|export)\b/.test(s);` |
| `count` | 125-125 | 1 | `const count = (s, re) => (s.match(re) \|\| []).length;` |
| `collectPathConsts` | 148-463 | 316 | `export function collectPathConsts(text) {` |
| `ioPathsFromLine` | 170-463 | 294 | `export function ioPathsFromLine(text, line) {` |
| `extractFileIo` | 193-237 | 45 | `export function extractFileIo(text) {` |
| `resolveIoPath` | 249-262 | 14 | `export function resolveIoPath(baseDir, p, repoFiles = []) {` |
| `normalizeIoPath` | 270-280 | 11 | `export function normalizeIoPath(baseDir, p) {` |
| `importSpecifiers` | 282-286 | 5 | `export function importSpecifiers(text) {` |
| `resolveModule` | 289-302 | 14 | `export function resolveModule(fromRel, spec, sourceRoot) {` |
| `extractArchFacts` | 313-462 | 150 | `export async function extractArchFacts(repoPath, { maxFiles = DEFAULT_MAX_FILES } = {}) {` |

### lib/arch/ir.js（150 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `toArchFacts` | 35-149 | 115 | `export function toArchFacts(agg, facts, opts = {}) {` |

### lib/arch/lists.js（97 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `scanUrls` | 14-27 | 14 | `export function scanUrls(text, file, moduleId) {` |
| `scanApis` | 37-66 | 30 | `export function scanApis(text, file, moduleId) {` |
| `functionsFromScan` | 73-83 | 11 | `export function functionsFromScan(scan, moduleId) {` |
| `fileEntries` | 89-96 | 8 | `export function fileEntries(entries) {` |

### lib/arch/to-json.js（140 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dataFileId` | 21-31 | 11 | `export function dataFileId(path) {` |
| `collectDataFiles` | 42-66 | 25 | `export function collectDataFiles(agg, facts, { repoPath = '' } = {}) {` |
| `isRepoRelative` | 69-78 | 10 | `function isRepoRelative(p, repoPath = '') {` |
| `toArchifyJson` | 87-139 | 53 | `export function toArchifyJson(agg, facts, { name = 'repo', repoPath = '', evidence = null, treeDoc = null } = {}) {` |

### lib/arch/validate-facts.js（118 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `evidenceFile` | 13-20 | 8 | `function evidenceFile(entry) {` |
| `validateFacts` | 28-117 | 90 | `export function validateFacts(ir, { repoPath = '' } = {}) {` |
| `exists` | 37-37 | 1 | `const exists = (p) => !repoPath \|\| !p \|\| existsSync(join(repoPath, p));` |
| `dfs` | 85-95 | 11 | `const dfs = (node, stack) => {` |

### lib/arch/validate.js（120 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `validateSchema` | 20-41 | 22 | `function validateSchema(doc) {` |
| `validateReferences` | 44-53 | 10 | `function validateReferences(doc) {` |
| `validateFacts` | 56-67 | 12 | `function validateFacts(doc, repoPath) {` |
| `validateTopology` | 70-100 | 31 | `function validateTopology(doc) {` |
| `dfs` | 80-90 | 11 | `const dfs = (node, stack) => {` |
| `validateArchJson` | 109-119 | 11 | `export function validateArchJson(doc, { repoPath = '', allowDangling = false } = {}) {` |

### lib/ast/brace.js（106 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `matchBrace` | 13-25 | 13 | `export function matchBrace(tokens, openIdx) {` |
| `matchPairBack` | 37-46 | 10 | `export function matchPairBack(tokens, closeIdx, openPunct, closePunct) {` |
| `isBlockParen` | 56-68 | 13 | `export function isBlockParen(tokens, closeTok) {` |
| `matchingOpen` | 71-73 | 3 | `export function matchingOpen(tokens, closeIdx) {` |
| `collectInnerFnRanges` | 91-106 | 16 | `export function collectInnerFnRanges(tokens, from, to) {` |

### lib/ast/callgraph.js（135 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildCallGraph` | 23-42 | 20 | `export function buildCallGraph(text) {` |
| `isInRequestPath` | 52-68 | 17 | `export function isInRequestPath(fnName, graph, isRequestName) {` |
| `collectFunctionDecls` | 71-135 | 65 | `function collectFunctionDecls(tokens) {` |
| `collectArrowFns` | 93-135 | 43 | `function collectArrowFns(tokens) {` |
| `collectNamedFnRanges` | 120-122 | 3 | `export function collectNamedFnRanges(tokens) {` |
| `matchBraceIdx` | 125-135 | 11 | `function matchBraceIdx(tokens, openIdx) {` |

### lib/ast/code-lines.js（115 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeCodeLineFilter` | 24-47 | 24 | `export function makeCodeLineFilter(text = '', candidateLines = [], opts = {}) {` |
| `isProseDoc` | 61-63 | 3 | `function isProseDoc(text, file) {` |
| `makeProseCodeFilter` | 77-100 | 24 | `function makeProseCodeFilter(text, candidateLines) {` |
| `codeStringLiterals` | 107-114 | 8 | `export function codeStringLiterals(text = '') {` |

### lib/ast/control-flow.js（462 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectNamedSyncFs` | 27-58 | 32 | `function collectNamedSyncFs(tokens) { // dsh-skip-complexity: named-import 扫描器（import{..}→from 模式匹配，扫描结构必然嵌套）` |
| `collectAsyncRanges` | 61-79 | 19 | `function collectAsyncRanges(tokens) { // dsh-skip-complexity: async 函数体边界扫描器（token 遍历+配对，结构必然嵌套）` |
| `scanSyncCalls` | 82-108 | 27 | `function scanSyncCalls(tokens, namedSync, asyncRanges) { // dsh-skip-complexity: 同步 fs 调用扫描器（定位调用点+区间归属判定，结构必然嵌套）` |
| `checkSyncFs` | 111-116 | 6 | `export function checkSyncFs(text = '') {` |
| `checkEmptyCatchAst` | 123-177 | 55 | `export function checkEmptyCatchAst(text = '') { // dsh-skip-complexity: 空 catch 检测器本体（token 遍历 + catch 体空判定多条件链，职责单一）` |
| `checkComplexityAst` | 179-462 | 284 | `export function checkComplexityAst(text = '', { warn = 10, block = 20 } = {}) {` |
| `inInner` | 212-212 | 1 | `const inInner = (k) => innerRanges.some(([a, b]) => k >= a && k < b);` |
| `checkNestingDepthAst` | 256-462 | 207 | `export function checkNestingDepthAst(text = '', { warn = 4, block = 6 } = {}) { // dsh-skip-complexity: 嵌套深度统计器本体（统计 if/for 嵌套必然自身嵌套）` |
| `pythonDetectDef` | 327-329 | 3 | `function pythonDetectDef(text) {` |
| `checkPythonComplexity` | 343-367 | 25 | `function checkPythonComplexity(text, { warn, block }) {` |
| `checkPythonNesting` | 378-407 | 30 | `function checkPythonNesting(text, { warn, block }) {` |
| `indentOf` | 410-412 | 3 | `function indentOf(line) {` |
| `checkJavaKtComplexity` | 426-459 | 34 | `function checkJavaKtComplexity(tokens, ranges, { warn, block }) {` |

### lib/ast/credential.js（200 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isPlaceholderText` | 40-42 | 3 | `function isPlaceholderText(text) {` |
| `stripQuotes` | 70-72 | 3 | `function stripQuotes(raw) {` |
| `isMeaningfulCredentialValue` | 80-87 | 8 | `export function isMeaningfulCredentialValue(raw) {` |
| `checkPlaceholderCredentialAst` | 111-135 | 25 | `export function checkPlaceholderCredentialAst(text = '', file = '') {` |
| `scanCredentialTokens` | 147-181 | 35 | `function scanCredentialTokens(tokens, out, lineOffset = 0) {` |
| `checkCredentialRefAst` | 183-199 | 17 | `export function checkCredentialRefAst(text = '') {` |

### lib/ast/dataflow.js（274 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectDeclaredFnBodies` | 52-274 | 223 | `function collectDeclaredFnBodies(tokens) {` |
| `collectArrowMethodBodies` | 69-274 | 206 | `function collectArrowMethodBodies(tokens) {` |
| `mergeFnRanges` | 94-115 | 22 | `function mergeFnRanges(fnRanges, tokens) {` |
| `collectFnBodies` | 118-121 | 4 | `function collectFnBodies(tokens) {` |
| `prevNonWs` | 124-130 | 7 | `function prevNonWs(tokens, i) {` |
| `nextNonWs` | 133-140 | 8 | `function nextNonWs(tokens, i, to) {` |
| `applyArgWriteback` | 143-150 | 8 | `function applyArgWriteback(tokens, i, nxt, obj, clearMap) {` |
| `applyAssignClearOrWriteback` | 156-173 | 18 | `function applyAssignClearOrWriteback(tokens, i, to, t, nxt, obj, clearMap) {` |
| `applyClearMethods` | 179-197 | 19 | `function applyClearMethods(t, member, memberIdx, callOpen, tokens, obj, clearMap, i) {` |
| `applyAccessAfterClear` | 203-219 | 17 | `function applyAccessAfterClear(t, nxt, member, memberIdx, callOpen, tokens, i, obj, clearMap, out) {` |
| `scanClearThenAccess` | 229-252 | 24 | `function scanClearThenAccess(tokens, from, to) {` |
| `checkClearAccessAst` | 260-274 | 15 | `export function checkClearAccessAst(text = '') {` |

### lib/ast/dup-code.js（166 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectDupCodeCandidates` | 41-78 | 38 | `export function collectDupCodeCandidates(text, file = '') {` |
| `findDuplicateBodies` | 86-110 | 25 | `export function findDuplicateBodies(perFileCandidates, opts = {}) {` |
| `countParams` | 113-166 | 54 | `function countParams(tokens, openIdx) {` |
| `hasBoolFlagParam` | 146-166 | 21 | `function hasBoolFlagParam(tokens, openIdx) {` |

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

### lib/ast/naming.js（285 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkNameLengthAst` | 26-191 | 166 | `export function checkNameLengthAst(text = '', { min = 2, allow = [] } = {}) {` |
| `checkShortFunctionNameAst` | 205-220 | 16 | `export function checkShortFunctionNameAst(text = '', { max = 2, allow = [] } = {}) {` |
| `checkSmallFileReadAst` | 236-259 | 24 | `export function checkSmallFileReadAst(text = '') {` |
| `checkConsoleLogJsonAst` | 268-284 | 17 | `export function checkConsoleLogJsonAst(text = '') {` |

### lib/ast/perf.js（217 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `matchingBrace` | 22-33 | 12 | `function matchingBrace(text, openIdx) {` |
| `matchingParen` | 36-47 | 12 | `function matchingParen(text, openIdx) {` |
| `lineOf` | 50-54 | 5 | `function lineOf(text, idx) {` |
| `inCommentOrString` | 63-69 | 7 | `function inCommentOrString(tokens, line, matchText) {` |
| `nextBlockRange` | 72-217 | 146 | `function nextBlockRange(text, startIdx) {` |
| `collectLoopRanges` | 86-102 | 17 | `function collectLoopRanges(text) {` |
| `loopBodyLines` | 109-118 | 10 | `export function loopBodyLines(text = '') {` |
| `innermostLoopRanges` | 137-140 | 4 | `function innermostLoopRanges(text) {` |
| `repeatIdenticalCallLines` | 164-187 | 24 | `export function repeatIdenticalCallLines(text = '') {` |
| `loopFullCollectionLines` | 201-216 | 16 | `export function loopFullCollectionLines(text = '') {` |

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

### lib/ast/size.js（379 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `funcNameAt` | 31-45 | 15 | `function funcNameAt(tokens, i) {` |
| `pythonFuncRanges` | 60-84 | 25 | `export function pythonFuncRanges(text = '') {` |
| `maxFunctionLength` | 95-101 | 7 | `export function maxFunctionLength(text = '') {` |
| `funcRangesAst` | 103-379 | 277 | `export function funcRangesAst(text = '') {` |
| `countCommentLinesInRange` | 146-159 | 14 | `export function countCommentLinesInRange(tokens, startLine = 1, endLine = Infinity) {` |
| `checkFuncLinesAst` | 169-186 | 18 | `export function checkFuncLinesAst(text = '', { warn = FUNC_LINES_WARN, block = FUNC_LINES_BLOCK } = {}) {` |
| `checkFuncDensityAst` | 210-231 | 22 | `export function checkFuncDensityAst(text = '', { threshold = FUNC_LINES_WARN, blockThreshold = FUNC_LINES_BLOCK, skipLines = new Set() } = {}) {` |
| `countCommentLines` | 239-252 | 14 | `export function countCommentLines(text = '') {` |
| `checkFileLines` | 263-272 | 10 | `export function checkFileLines(text = '', { warn = 500, block = 1000, excludeComments = true } = {}) {` |
| `checkCommentDensityAst` | 294-329 | 36 | `export function checkCommentDensityAst(text = '', { warn = COMMENT_DENSITY_WARN_DEFAULT, minCodeLines = 5 } = {}) {` |
| `checkRepeatedStringsAst` | 339-378 | 40 | `export function checkRepeatedStringsAst(text = '', { min = 3, ignore = [] } = {}) {` |

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

### lib/ast/tokenizer.js（286 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `tokenize` | 39-56 | 18 | `export function tokenize(text = '') {` |
| `clearTokenCache` | 59-61 | 3 | `export function clearTokenCache() {` |
| `tokenizeUncached` | 68-172 | 105 | `function tokenizeUncached(text = '') {` |
| `consumeLexeme` | 191-224 | 34 | `function consumeLexeme(src, i, n, ch, next, tokens, push) { // dsh-skip-complexity: 词素分派器（六类词素分派分支为结构必然，拆分后职责单一）` |
| `consumeString` | 227-238 | 12 | `function consumeString(src, i, n, ch, push) {` |
| `consumeTemplate` | 241-252 | 12 | `function consumeTemplate(src, i, n, push) {` |
| `consumeRegex` | 255-260 | 6 | `function consumeRegex(src, i, n, tokens, push) { // dsh-skip-complexity: 正则状态机（转义/字符组/闭包三态，天然多分支）` |

### lib/audit/analysis-coverage.js（99 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveEntries` | 30-40 | 11 | `async function resolveEntries({ repoPath, files }) {` |
| `computeAnalysisCoverage` | 48-68 | 21 | `export async function computeAnalysisCoverage({ repoPath = '', files = null, topN = DEFAULT_TOP_N } = {}) {` |
| `countByReason` | 71-75 | 5 | `function countByReason(unresolved) {` |
| `topUnresolvedFiles` | 78-85 | 8 | `function topUnresolvedFiles(unresolved, topN) {` |
| `formatAnalysisCoverageLine` | 92-98 | 7 | `export function formatAnalysisCoverageLine(cov = {}) {` |

### lib/audit/audit-file.js（183 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isMinifiedOneLine` | 29-39 | 11 | `function isMinifiedOneLine(text) {` |
| `isHashSegment` | 43-45 | 3 | `function isHashSegment(seg) {` |
| `isBuildArtifactFile` | 47-77 | 31 | `export function isBuildArtifactFile(relPathOrFile = '', text = '') {` |
| `auditFile` | 79-183 | 105 | `export function auditFile({ file, relPath, text, grouped }, opts = {}) {` |

### lib/audit/client-entry.js（50 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveDshClientEntries` | 25-49 | 25 | `export function resolveDshClientEntries(repoRoot) {` |
| `pick` | 35-43 | 9 | `const pick = (v) => {` |

### lib/audit/collector.js（449 行 · 17 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readIgnoreFileCached` | 47-53 | 7 | `function readIgnoreFileCached(p) {` |
| `isGitWorkTree` | 66-77 | 12 | `function isGitWorkTree(dir) {` |
| `tryLoadAuditIgnoreFallback` | 93-143 | 51 | `function tryLoadAuditIgnoreFallback(root, respectAuditIgnore = true) {` |
| `handleEntry` | 122-135 | 14 | `const handleEntry = (dir, en) => {` |
| `walkDirs` | 136-140 | 5 | `const walkDirs = (dir) => {` |
| `tryLoadGitIgnoreSet` | 155-252 | 98 | `function tryLoadGitIgnoreSet(root, respectAuditIgnore = true) {` |
| `walkDirs` | 196-211 | 16 | `const walkDirs = (dir) => {` |
| `isHardSkipped` | 261-263 | 3 | `function isHardSkipped(name) {` |
| `computeGitIgnored` | 266-271 | 6 | `function computeGitIgnored(full, gitIgnoreRoot, includeIgnored, respectAuditIgnore = true) {` |
| `shouldSkipDirByYml` | 274-278 | 5 | `function shouldSkipDirByYml(name, ignoredByGit, gitIgnoreRoot) {` |
| `isFileGitIgnored` | 281-292 | 12 | `function isFileGitIgnored(full, gitIgnoreRoot, includeIgnored, respectAuditIgnore = true) {` |
| `collectTextFiles` | 294-353 | 60 | `export async function collectTextFiles(dir, { depth = 10, gitIgnoreRoot = null, includeIgnored = false, testExemptRoot = null, respectAuditIgnore = true } = {}) {` |
| `walk` | 316-352 | 37 | `async function walk(cur, level) {` |
| `isGitRepo` | 356-358 | 3 | `export function isGitRepo(dir) {` |
| `collectChangedFiles` | 366-423 | 58 | `export function collectChangedFiles(repoPath) {` |
| `isTextFile` | 426-444 | 19 | `export function isTextFile(full) {` |
| `readText` | 447-449 | 3 | `export function readText(full) {` |

### lib/audit/ext-runner.js（80 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadAuditExt` | 28-51 | 24 | `export async function loadAuditExt(dir = DEFAULT_EXT_DIR) {` |
| `runAuditExt` | 59-80 | 22 | `export async function runAuditExt(repo, opts = {}) {` |

### lib/audit/file-context.js（139 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hasMkdirInSameFunction` | 19-72 | 54 | `export function hasMkdirInSameFunction(lines, lineIdx) {` |
| `hasTimeoutInRange` | 62-67 | 6 | `function hasTimeoutInRange(lines, start, end) {` |
| `isCallClosed` | 70-71 | 2 | `function isCallClosed(s, depth) {` |
| `hasTimeoutAfterCall` | 84-94 | 11 | `function hasTimeoutAfterCall(line, lines, lineIdx) {` |
| `hasExternalCallTimeout` | 96-101 | 6 | `export function hasExternalCallTimeout(line, lines, lineIdx) {` |
| `detectRepoJsYamlImport` | 110-119 | 10 | `export function detectRepoJsYamlImport(files) {` |
| `isVersionInPathContext` | 132-138 | 7 | `export function isVersionInPathContext(line) {` |

### lib/audit/finding.js（51 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFinding` | 2-4 | 3 | `export function makeFinding({ file, line, rule, kind, severity = 'warning', message, dimensions = [], exemptHint = '', scoreImpact = 0 }) {` |
| `decorateTestExemptHint` | 14-25 | 12 | `export function decorateTestExemptHint(findings = []) {` |
| `summarize` | 38-47 | 10 | `export function summarize(findings = []) {` |

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

### lib/audit/ignore-blind.js（102 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `excludePathOf` | 38-47 | 10 | `function excludePathOf(root) {` |
| `detectIgnoreBlindSpot` | 54-101 | 48 | `export function detectIgnoreBlindSpot(root) {` |

### lib/audit/orchestrate.js（448 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `capScanFiles` | 39-49 | 11 | `export function capScanFiles(files, root, maxFiles) {` |
| `appendIgnoreBlindSpot` | 62-78 | 17 | `function appendIgnoreBlindSpot(findings, repoPath, scanned) {` |
| `auditFiles` | 90-250 | 161 | `async function auditFiles(repoPath, files, opts = {}) {` |
| `isDshPlugin` | 115-121 | 7 | `const isDshPlugin = (() => {` |
| `auditFull` | 252-274 | 23 | `export async function auditFull(repoPath, opts = {}) {` |
| `appendTreeDocDrift` | 279-321 | 43 | `function appendTreeDocDrift(findings, repoPath) {` |
| `by` | 312-312 | 1 | `const by = (code) => wt.filter(([, v]) => v?.status === code).length;` |
| `appendFuncDocDrift` | 330-346 | 17 | `function appendFuncDocDrift(findings, repoPath) {` |
| `appendSplitDocsCheck` | 354-397 | 44 | `function appendSplitDocsCheck(findings, repoPath) {` |
| `hasMarkBlock` | 400-402 | 3 | `function hasMarkBlock(text, marker) {` |
| `auditChanged` | 407-442 | 36 | `export async function auditChanged(repoPath, opts = {}) {` |
| `isAuditIgnored` | 423-436 | 14 | `const isAuditIgnored = (rel) => {` |
| `auditWithScope` | 445-447 | 3 | `export async function auditWithScope(repoPath, { scope = 'diff', ...opts } = {}) {` |

### lib/audit/repo-level.js（31 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `repoLevelSemanticRuleIds` | 10-16 | 7 | `export function repoLevelSemanticRuleIds(grouped = {}) {` |
| `pickRepoLevelAnchorFile` | 24-30 | 7 | `export function pickRepoLevelAnchorFile(files = []) {` |

### lib/audit/report-yaml.js（86 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `findingsToYaml` | 28-77 | 50 | `export function findingsToYaml(findings = [], { includeMessage = true, maxMessageLen = 200 } = {}) {` |
| `countSeverity` | 80-86 | 7 | `function countSeverity(dirMap) {` |

### lib/audit/slot.js（66 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `slotStatsFromFindings` | 17-45 | 29 | `export function slotStatsFromFindings(findings = [], ruleSlotMap = new Map(), slotRuleCount = {}) {` |
| `ensure` | 25-28 | 4 | `const ensure = (slot) => {` |
| `buildRuleSlotMap` | 48-55 | 8 | `export function buildRuleSlotMap(compiledRules = []) {` |
| `countRulesBySlot` | 58-65 | 8 | `export function countRulesBySlot(compiledRules = []) {` |

### lib/checks/button-bind.js（277 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readBalancedCall` | 28-48 | 21 | `export function readBalancedCall(text, startIdx, maxLen = 4000) {` |
| `extractJsxButtons` | 60-92 | 33 | `export function extractJsxButtons(text) {` |
| `stripCommentLines` | 106-120 | 15 | `function stripCommentLines(text) {` |
| `checkButtonBindings` | 138-277 | 140 | `export function checkButtonBindings({ file, text, rules }) {` |

### lib/checks/common.js（169 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `capSeverity` | 33-39 | 7 | `export function capSeverity(ruleSeverity, internalLevel) {` |
| `groupByKind` | 50-59 | 10 | `export function groupByKind(compiled) {` |
| `smartHitLines` | 68-71 | 4 | `export function smartHitLines(text) {` |
| `smallFileReadLines` | 81-85 | 5 | `export function smallFileReadLines(text) {` |
| `consoleLogJsonLines` | 93-95 | 3 | `export function consoleLogJsonLines(text) {` |
| `shortFuncNameLines` | 103-105 | 3 | `export function shortFuncNameLines(text) {` |
| `placeholderCredentialLines` | 116-118 | 3 | `export function placeholderCredentialLines(text, file) {` |
| `credentialValueLines` | 120-122 | 3 | `export function credentialValueLines(text) {` |
| `ioRiskLines` | 136-138 | 3 | `export function ioRiskLines(text) {` |
| `ioRiskDetail` | 146-154 | 9 | `export function ioRiskDetail(text) {` |
| `shellCdDynamicLines` | 156-158 | 3 | `export function shellCdDynamicLines(text) {` |
| `writeIntoGitignoredLines` | 165-167 | 3 | `export function writeIntoGitignoredLines(text, repoPath) {` |

### lib/checks/credential-file.js（44 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkCredentialFiles` | 13-43 | 31 | `export function checkCredentialFiles({ file, relPath, rules }) {` |

### lib/checks/dataflow.js（41 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkDataflow` | 25-40 | 16 | `export function checkDataflow({ file, text, rules }) {` |

### lib/checks/dispatch.js（106 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveFileScope` | 42-48 | 7 | `function resolveFileScope({ repoPath, relPath }) {` |
| `runChecks` | 50-105 | 56 | `export function runChecks({ file, relPath, text, grouped }, opts = {}) {` |

### lib/checks/dup-code.js（70 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkDuplicateCode` | 28-69 | 42 | `export function checkDuplicateCode(fileTexts = [], rules = null) {` |

### lib/checks/dup-const.js（231 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `extractFromConst` | 46-66 | 21 | `function extractFromConst(tokens, i, atTopLevel, push) {` |
| `extractFromJavaFinal` | 72-80 | 9 | `function extractFromJavaFinal(tokens, i, push) {` |
| `createConstPusher` | 100-116 | 17 | `function createConstPusher(out) {` |
| `extractConstAtToken` | 124-148 | 25 | `function extractConstAtToken(tokens, i, { lang, atTopLevel, push }) {` |
| `findConstDefs` | 150-173 | 24 | `export function findConstDefs(text = '') {` |
| `atTopLevel` | 155-158 | 4 | `const atTopLevel = (line) => {` |
| `checkDuplicateConst` | 181-230 | 50 | `export function checkDuplicateConst(fileTexts = [], rules = null) {` |

### lib/checks/file-health.js（151 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFileHealth` | 38-150 | 113 | `export function checkFileHealth({ file, relPath, text, rules }) {` |
| `levelOf` | 87-90 | 4 | `const levelOf = (val, levels) => {` |

### lib/checks/filter.js（132 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `filterRulesByExt` | 32-44 | 13 | `export function filterRulesByExt(grouped, relPath) {` |
| `normRelPath` | 53-55 | 3 | `function normRelPath(s) {` |
| `includeHit` | 61-67 | 7 | `function includeHit(rel, inc) {` |
| `excludeHit` | 70-73 | 4 | `function excludeHit(rel, ex) {` |
| `filterRulesByPath` | 75-94 | 20 | `export function filterRulesByPath(grouped, relPath) {` |
| `filterRulesByFileText` | 112-131 | 20 | `export function filterRulesByFileText(grouped, text) {` |

### lib/checks/folder.js（174 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFolderRules` | 23-173 | 151 | `export function checkFolderRules({ root, rules, gitignoreText = '' }) {` |
| `isPackageDir` | 89-89 | 1 | `const isPackageDir = (d) => /\/src\/(?:main\|test\|androidTest)\/(?:java\|kotlin)\//.test(d.full)` |
| `isIgnored` | 148-148 | 1 | `const isIgnored = (p) => lines.some((l) => l === p \|\| l === p.replace(/^\*/, '') \|\| l.replace(/\/$/, '') === p);` |

### lib/checks/io.js（67 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkIoRisk` | 26-66 | 41 | `export function checkIoRisk({ file, text }) {` |

### lib/checks/magic-number.js（43 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkMagicNumberSmart` | 22-42 | 21 | `export function checkMagicNumberSmart({ file, text, rules }) {` |

### lib/checks/npm-json.js（187 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `starRangeDeps` | 21-33 | 13 | `function starRangeDeps(pkg) {` |
| `findJsonKeyLine` | 51-59 | 9 | `function findJsonKeyLine(text, key, valueHint) {` |
| `checkNpmJson` | 61-186 | 126 | `export function checkNpmJson({ file, text, rules, repoHasJsYamlImport, repoPath }) {` |

### lib/checks/private.js（64 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkPrivateFiles` | 24-63 | 40 | `export function checkPrivateFiles({ root, visibility = 'unknown', privateFiles = [] }) {` |

### lib/checks/regex.js（236 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pickExemptHint` | 25-40 | 16 | `export function pickExemptHint(rule) {` |
| `hit` | 28-28 | 1 | `const hit = (words) => (Array.isArray(words) ? words : []).some((w) => id.includes(w));` |
| `checkRegexRules` | 51-158 | 108 | `export function checkRegexRules({ file, text, rules, source = '新增行', repoPath = '' }) {` |
| `checkPathRegexRules` | 161-177 | 17 | `export function checkPathRegexRules({ file, relPath, rules }) {` |
| `checkBlacklist` | 187-235 | 49 | `export function checkBlacklist({ file, text, rules }) {` |

### lib/checks/semantic.js（135 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkSemantic` | 35-59 | 25 | `export function checkSemantic({ file, relPath, rules, repoLevelRules }) {` |
| `isRepoLevelSemanticRule` | 69-78 | 10 | `export function isRepoLevelSemanticRule(rule) {` |
| `checkPatchInsert` | 93-134 | 42 | `export function checkPatchInsert({ file, text, rules }) {` |

### lib/checks/structural.js（275 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFuncLines` | 22-66 | 45 | `export function checkFuncLines({ file, text, rules }) {` |
| `checkSyncFsInFile` | 69-82 | 14 | `export function checkSyncFsInFile({ file, text }) {` |
| `checkEmptyCatch` | 85-98 | 14 | `export function checkEmptyCatch({ file, text }) {` |
| `checkMinLength` | 101-122 | 22 | `export function checkMinLength({ file, text, rules }) {` |
| `checkComplexity` | 125-151 | 27 | `export function checkComplexity({ file, text, rules }) {` |
| `checkDepth` | 154-170 | 17 | `export function checkDepth({ file, text, rules }) {` |
| `checkMaxLines` | 173-224 | 52 | `export function checkMaxLines({ file, text, rules, fileScope = '' }) {` |
| `checkCommentDensity` | 232-247 | 16 | `export function checkCommentDensity({ file, text, rules }) {` |
| `checkRepeated` | 250-274 | 25 | `export function checkRepeated({ file, text, rules }) {` |

### lib/cli/commands-account.mjs（108 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `cmdAccountCheck` | 23-30 | 8 | `export async function cmdAccountCheck(flags) {` |
| `cmdCredEnv` | 33-47 | 15 | `export async function cmdCredEnv(flags) {` |
| `cmdRemoteCreate` | 50-65 | 16 | `export async function cmdRemoteCreate(repo, flags) {` |
| `cmdSetVisibility` | 68-82 | 15 | `export async function cmdSetVisibility(repo, flags) {` |
| `cmdGenSshKey` | 85-96 | 12 | `export async function cmdGenSshKey(flags) {` |
| `resolveRepoOwnerName` | 99-107 | 9 | `async function resolveRepoOwnerName(repoPath) {` |

### lib/cli/commands-audit.mjs（145 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `cliPluginConfig` | 27-36 | 10 | `export function cliPluginConfig() {` |
| `pluginEqualAuditOpts` | 43-55 | 13 | `export function pluginEqualAuditOpts(cfg, flags, { scope = 'diff' } = {}) {` |
| `pluginEqualWeights` | 58-62 | 5 | `export function pluginEqualWeights(cfg, flags) {` |
| `pathExists` | 65-67 | 3 | `async function pathExists(p) {` |
| `cmdAudit` | 70-74 | 5 | `export async function cmdAudit(root, flags) {` |
| `runHistoryAuditCmd` | 77-92 | 16 | `async function runHistoryAuditCmd(root, flags) {` |
| `runStandardAudit` | 95-107 | 13 | `async function runStandardAudit(root, flags) {` |
| `printAuditResult` | 110-128 | 19 | `function printAuditResult(root, auditResult, opts, weights, quality) {` |
| `cmdScan` | 136-144 | 9 | `export async function cmdScan(root, flags) {` |

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

### lib/cli/commands-vcs.mjs（176 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pathExists` | 33-35 | 3 | `async function pathExists(p) {` |
| `cmdRepos` | 38-55 | 18 | `export function cmdRepos(root, flags) {` |
| `cmdIndex` | 58-76 | 19 | `export async function cmdIndex(root, flags) {` |
| `cmdGit` | 79-87 | 9 | `export async function cmdGit(args = []) {` |
| `cmdCommit` | 90-121 | 32 | `export async function cmdCommit(root, flags) {` |
| `cmdLinkCheck` | 124-134 | 11 | `export async function cmdLinkCheck(root = '.') {` |
| `runClonePreview` | 137-150 | 14 | `async function runClonePreview(target, flags) {` |
| `printCloneResult` | 153-165 | 13 | `function printCloneResult(r, flags, target, dest) {` |
| `cmdClone` | 168-175 | 8 | `export async function cmdClone(flags, positional) {` |

### lib/client.js（2549 行 · 46 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_ensureCss` | 227-235 | 9 | `function dshgp_ensureCss() {` |
| `dshgp_getJson` | 238-241 | 4 | `async function dshgp_getJson(url) {` |
| `dshgp_postJson` | 243-252 | 10 | `async function dshgp_postJson(url, payload, timeoutMs) {` |
| `dshgp_tokenConfigured` | 260-264 | 5 | `function dshgp_tokenConfigured(value) {` |
| `dshgp_localGet` | 271-273 | 3 | `function dshgp_localGet(key) {` |
| `dshgp_localSet` | 276-278 | 3 | `function dshgp_localSet(key, value) {` |
| `dshgp_copyText` | 281-286 | 6 | `function dshgp_copyText(text) {` |
| `dshgp_AcctHead` | 302-316 | 15 | `function dshgp_AcctHead(props) {` |
| `dshgp_AccountCard` | 319-363 | 45 | `function dshgp_AccountCard(props) {` |
| `dshgp_AccountTab` | 366-381 | 16 | `function dshgp_AccountTab(props) {` |
| `dshgp_browseEnsureDom` | 388-416 | 29 | `function dshgp_browseEnsureDom() {` |
| `dshgp_browseGuess` | 417-419 | 3 | `function dshgp_browseGuess() {` |
| `dshgp_browseRemember` | 420-422 | 3 | `function dshgp_browseRemember(p) {` |
| `dshgp_browseLoad` | 423-448 | 26 | `async function dshgp_browseLoad(p) {` |
| `dshgp_browseOpen` | 449-457 | 9 | `function dshgp_browseOpen(input, onPick) {` |
| `dshgp_browseClose` | 458-464 | 7 | `function dshgp_browseClose() {` |
| `dshgp_browseAttach` | 465-475 | 11 | `function dshgp_browseAttach(inputEl) {` |
| `dshgp_RepoManagerCard` | 479-509 | 31 | `function dshgp_RepoManagerCard(props) {` |
| `dshgp_RepoLocalRow` | 512-590 | 79 | `function dshgp_RepoLocalRow(props) {` |
| `dshgp_RepoLocalPane` | 593-630 | 38 | `function dshgp_RepoLocalPane(props) {` |
| `dshgp_RepoCloudRow` | 633-680 | 48 | `function dshgp_RepoCloudRow(props) {` |
| `dshgp_VisConfirmDialog` | 686-714 | 29 | `function dshgp_VisConfirmDialog(props) {` |
| `dshgp_RepoCloudPane` | 717-768 | 52 | `function dshgp_RepoCloudPane(props) {` |
| `dshgp_CloneProgress` | 779-796 | 18 | `function dshgp_CloneProgress(props) {` |
| `mb` | 781-781 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |
| `dshgp_ClonePreview` | 804-829 | 26 | `function dshgp_ClonePreview(props) {` |
| `mb` | 806-806 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |
| `dshgp_WeightRows` | 833-856 | 24 | `function dshgp_WeightRows(props) {` |
| `dshgp_RuleRow` | 867-929 | 63 | `function dshgp_RuleRow(props, slot, idx, len) {` |
| `countTitle` | 876-879 | 4 | `const countTitle = (kind) => {` |
| `move` | 884-884 | 1 | `const move = (dir) => props.moveSlot(slot, dir);` |
| `dshgp_AuditSwitchBlock` | 932-996 | 65 | `function dshgp_AuditSwitchBlock(props) {` |
| `dshgp_InjectPromptSwitchBlock` | 999-1021 | 23 | `function dshgp_InjectPromptSwitchBlock(props) {` |
| `dshgp_CommentWordingBlock` | 1024-1039 | 16 | `function dshgp_CommentWordingBlock(props) {` |
| `dshgp_AuditAdvancedBlock` | 1042-1068 | 27 | `function dshgp_AuditAdvancedBlock(props) {` |
| `dshgp_RuleListBlock` | 1071-1102 | 32 | `function dshgp_RuleListBlock(props) {` |
| `dshgp_AuditTab` | 1109-1129 | 21 | `function dshgp_AuditTab(props) {` |
| `dshgp_CredentialBlock` | 1133-1198 | 66 | `function dshgp_CredentialBlock(props) {` |
| `dshgp_PushDefaultsBlock` | 1201-1263 | 63 | `function dshgp_PushDefaultsBlock(props) {` |
| `dshgp_SettingsTab` | 1265-1274 | 10 | `function dshgp_SettingsTab(props) {` |
| `dshgp_GitPushPage` | 1277-1330 | 54 | `function dshgp_GitPushPage(props) {` |
| `renderResult` | 2110-2123 | 14 | `const renderResult = (res) => {` |
| `poll` | 2126-2151 | 26 | `const poll = async () => {` |
| `apply` | 2478-2542 | 65 | `function apply(ctx) {` |
| `useCardState` | 2518-2521 | 4 | `const useCardState = (selector) => {` |
| `SectionPage` | 2524-2529 | 6 | `function SectionPage() {` |

### lib/client/index.js（162 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `defaultConfig` | 54-58 | 5 | `export function defaultConfig() {` |
| `resolveConfig` | 66-78 | 13 | `export function resolveConfig(patch = {}, base = defaultConfig()) {` |
| `createSettingsCard` | 86-128 | 43 | `export function createSettingsCard(react, { config = defaultConfig(), onChange = () => {}, labels = {} } = {}) {` |
| `collectExternalRefs` | 136-141 | 6 | `export function collectExternalRefs(css = '') {` |
| `clientModuleInfo` | 151-162 | 12 | `export function clientModuleInfo() {` |

### lib/commit-push.js（143 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runAudit` | 32-97 | 66 | `export async function runAudit({ repoPath = '', audit, rulesetDir, slots, cfg: extCfg, visibility: extVisibility } = {}) {` |
| `commitWithAudit` | 107-129 | 23 | `export async function commitWithAudit({` |
| `commitMany` | 137-143 | 7 | `export async function commitMany({ repos = [], message = '', push = true, dryRun = false, requirementsConfirmed = false, customIgnorePatterns = '' } = {}) {` |

### lib/context/index.js（363 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadToolProbeTemplate` | 102-120 | 19 | `export function loadToolProbeTemplate(file = TEMPLATE_FILE) {` |
| `probeToolPath` | 131-162 | 32 | `export function probeToolPath(name, versionArgs = []) {` |
| `collectToolPaths` | 172-186 | 15 | `export function collectToolPaths(probes = null, { templateFile = TEMPLATE_FILE, resultFile = '' } = {}) {` |
| `writeToolResult` | 194-201 | 8 | `export function writeToolResult(file = '', results = []) {` |
| `mapWorkspaceDirs` | 208-239 | 32 | `export function mapWorkspaceDirs({ workspaceRoot = '', cwd = process.cwd(), maxChildren = 40 } = {}) {` |
| `detectLocalHost` | 260-275 | 16 | `export function detectLocalHost() {` |
| `createEnvInjectionText` | 277-307 | 31 | `export function createEnvInjectionText({ cwd = '', projectRoot = '', tools = DEFAULT_TOOLS, workspace = null, host = null } = {}) {` |
| `isWithinRoot` | 315-327 | 13 | `export function isWithinRoot(root = '', target = '') {` |
| `norm` | 316-321 | 6 | `const norm = (p) => {` |
| `parseEnvInjection` | 334-363 | 30 | `export function parseEnvInjection(text = '') {` |

### lib/exempt/index.js（260 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hasHeaderExempt` | 102-106 | 5 | `export function hasHeaderExempt(text, marker) {` |
| `hasLineExempt` | 109-111 | 3 | `export function hasLineExempt(line, marker) {` |
| `isCategoryExempt` | 129-137 | 9 | `export function isCategoryExempt(finding = {}) {` |
| `exemptForFinding` | 148-186 | 39 | `export function exemptForFinding(finding, text = '') { // dsh-skip-complexity: 豁免判定器本体（9 标记 × blocked/细分规则多条件链，职责单一）` |
| `exemptHintFor` | 189-194 | 6 | `export function exemptHintFor(ruleOrKind) {` |
| `isSampleExemptDir` | 205-227 | 23 | `export function isSampleExemptDir(repoPath, relPath = '') {` |
| `isTestExemptDir` | 237-259 | 23 | `export function isTestExemptDir(repoPath, relPath = '') {` |

### lib/fs/edit-after-read.js（90 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countOccurrences` | 18-27 | 10 | `export function countOccurrences(text, needle) {` |
| `fingerprint` | 30-37 | 8 | `function fingerprint(statFile, path) {` |
| `editAfterRead` | 51-89 | 39 | `export function editAfterRead({` |

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

### lib/git/api.js（111 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `githubFetch` | 22-67 | 46 | `export async function githubFetch(path, { token = '', method = 'GET', body, timeout = 60_000, headers: extraHeaders } = {}) {` |
| `parseGithubOwnerRepo` | 70-84 | 15 | `export function parseGithubOwnerRepo(originUrl) {` |
| `isBadCredentials` | 87-89 | 3 | `export function isBadCredentials(reason = '') {` |
| `detectRepoVisibility` | 96-110 | 15 | `export async function detectRepoVisibility({ repoPath = '', token = '' } = {}) {` |

### lib/git/atomic-json.js（99 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readJson` | 19-27 | 9 | `export function readJson(file) {` |
| `readJsonAny` | 34-41 | 8 | `export function readJsonAny(file) {` |
| `writeJsonAtomic` | 50-63 | 14 | `export function writeJsonAtomic(file, data, { mode = 0o600, pretty = true } = {}) {` |
| `updateJsonAtomic` | 72-76 | 5 | `export function updateJsonAtomic(file, updater, { mode = 0o600 } = {}) {` |
| `writeTextAtomic` | 86-98 | 13 | `export function writeTextAtomic(file, text, { mode = 0o600 } = {}) {` |

### lib/git/browse.js（39 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `browseDir` | 17-38 | 22 | `export function browseDir(p = '', { root = '' } = {}) {` |

### lib/git/clone-download.js（398 行 · 15 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `partitionBySize` | 55-66 | 12 | `export function partitionBySize(blobs = [], maxFileMB = DEFAULT_MAX_FILE_MB) {` |
| `downloadSymlinkEntry` | 93-105 | 13 | `async function downloadSymlinkEntry(entry, { owner, repo, token, out, rel }) {` |
| `posixModeOf` | 119-121 | 3 | `function posixModeOf(gitMode) {` |
| `downloadRegularEntry` | 129-143 | 15 | `async function downloadRegularEntry(entry, { owner, repo, branch, token, out, partPath, signal, rel, onBytes }) {` |
| `runDownloadPool` | 151-162 | 12 | `async function runDownloadPool(blobs, one, concurrency, signal) {` |
| `worker` | 153-160 | 8 | `const worker = async () => {` |
| `cleanupPartsIfAllSucceeded` | 174-177 | 4 | `async function cleanupPartsIfAllSucceeded(partsDir, failed, signal) {` |
| `downloadOneEntry` | 189-215 | 27 | `async function downloadOneEntry(entry, ctx) {` |
| `downloadBlobs` | 217-248 | 32 | `export async function downloadBlobs(o) {` |
| `emit` | 228-232 | 5 | `const emit = () => {` |
| `one` | 239-239 | 1 | `const one = (entry) => downloadOneEntry(entry, ctx);` |
| `fetchBlobJson` | 253-268 | 16 | `async function fetchBlobJson(owner, repo, sha, token) {` |
| `removeDirForce` | 294-313 | 20 | `export async function removeDirForce(dir, attempts = 3) {` |
| `fetchToFile` | 315-397 | 83 | `async function fetchToFile({ owner, repo, branch, relPath, token, out, partPath, size, onBytes, signal = null, mode = 0o644 }) {` |
| `mkHeaders` | 349-356 | 8 | `const mkHeaders = (raw, withRange) => {` |

### lib/git/clone-history-mode.js（144 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveBranchHead` | 26-36 | 11 | `export async function resolveBranchHead({ owner = '', repo = '', branch = '', token = '', deps = {} } = {}) {` |
| `cloneWithHistory` | 51-86 | 36 | `export async function cloneWithHistory({` |
| `cloneWithGitFetch` | 107-143 | 37 | `export async function cloneWithGitFetch({` |
| `run` | 114-118 | 5 | `const run = (args) => {` |

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

### lib/git/clone-replay-io.js（173 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `createReplayIo` | 47-172 | 126 | `export function createReplayIo({` |

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

### lib/git/clone.js（433 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isPartialCloneDir` | 48-55 | 8 | `export function isPartialCloneDir(dir) {` |
| `resolveMaxCloneFileMB` | 68-71 | 4 | `export function resolveMaxCloneFileMB(cfg = {}) {` |
| `enclosingGitRoot` | 88-106 | 19 | `export function enclosingGitRoot(dir) {` |
| `cloneViaApi` | 115-331 | 217 | `export async function cloneViaApi({` |
| `cleanupPartial` | 344-348 | 5 | `async function cleanupPartial(dir) {` |
| `classifyCloneFailure` | 362-375 | 14 | `export function classifyCloneFailure(failed = []) {` |
| `previewClone` | 403-432 | 30 | `export async function previewClone({ target = '', token = '', branch = '', maxFileMB = DEFAULT_MAX_FILE_MB } = {}) {` |

### lib/git/cloud.js（47 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `listCloudRepos` | 21-46 | 26 | `export async function listCloudRepos({ token = '', perPage = 100 } = {}) {` |

### lib/git/config.js（41 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadRequirements` | 23-40 | 18 | `export function loadRequirements() {` |

### lib/git/cred-env.js（88 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildSshEnvPrefix` | 21-23 | 3 | `function buildSshEnvPrefix(keyPath) {` |
| `buildCredEnv` | 30-88 | 59 | `export function buildCredEnv({ workspaceRoot = '' } = {}) {` |

### lib/git/credentials.js（235 行 · 11 个函数）

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
| `generateSshKey` | 195-234 | 40 | `export function generateSshKey(email, { workspaceRoot = '', force = false } = {}) {` |

### lib/git/endpoints.js（77 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mirrorPrefix` | 20-24 | 5 | `export function mirrorPrefix() {` |
| `withMirror` | 33-40 | 8 | `export function withMirror(url) {` |
| `mirrorGitConfigEnv` | 46-54 | 9 | `export function mirrorGitConfigEnv(env) {` |
| `blobApiUrl` | 64-66 | 3 | `export function blobApiUrl(owner, repo, sha) {` |
| `contentsApiUrl` | 69-71 | 3 | `export function contentsApiUrl(owner, repo, encodedPath, encodedRef) {` |
| `rawFileUrl` | 74-76 | 3 | `export function rawFileUrl(owner, repo, encodedRef, encodedPath) {` |

### lib/git/exec.js（152 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `gitSearchPlan` | 44-51 | 8 | `export function gitSearchPlan(pathValue, { delimiter = pathDelimiter, platform = process.platform } = {}) {` |
| `resolveGitBin` | 54-71 | 18 | `export function resolveGitBin() {` |
| `runGit` | 84-101 | 18 | `export function runGit(args, { cwd = '', timeoutMs = 120_000, env = {} } = {}) {` |
| `gitRaw` | 109-125 | 17 | `export function gitRaw(args, { cwd = '', timeoutMs = 600_000 } = {}) {` |
| `runGitAsync` | 135-151 | 17 | `export function runGitAsync(args, { cwd = '', timeoutMs = 120_000, env = {} } = {}) {` |

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

### lib/git/ignore.js（70 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ensureGitignore` | 29-69 | 41 | `export async function ensureGitignore(repoPath, { customIgnorePatterns = '' } = {}) {` |

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

### lib/git/push.js（355 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveRepoIdentity` | 33-39 | 7 | `function resolveRepoIdentity(repoPath) {` |
| `commitAndPush` | 51-190 | 140 | `export async function commitAndPush({ repoPath = '', message = '', push = true, dryRun = false, token = '', customIgnorePatterns = '', requirementsConfirmed = false, force = false, pushMethod = 'ssh', pushGate = false, pushConfirmed = false, paths = '' } = {}) {` |
| `legacyIdentity` | 121-130 | 10 | `const legacyIdentity = (() => {` |
| `fetchRemoteBranchRef` | 203-216 | 14 | `async function fetchRemoteBranchRef(repoPath, branch, owner, repo) {` |
| `enhanceAfterPushSuccess` | 224-284 | 61 | `async function enhanceAfterPushSuccess({ repoPath, pr, token, steps, commitSha }) {` |
| `readmeCheckHint` | 289-294 | 6 | `export function readmeCheckHint(repoPath) {` |
| `pushCurrentBranch` | 303-354 | 52 | `export async function pushCurrentBranch({ repoPath = '', pushMethod = 'ssh' } = {}) {` |

### lib/git/remote.js（88 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ensureRemoteRepo` | 17-58 | 42 | `export async function ensureRemoteRepo({ repoPath = '', owner = '', visibility = 'private', dryRun = false, token = '' } = {}) {` |
| `parseOwnerRepoFromRemote` | 61-68 | 8 | `export function parseOwnerRepoFromRemote(remoteUrl) {` |
| `setVisibility` | 71-87 | 17 | `export async function setVisibility({ owner = '', repo = '', visibility = '', token = '', repoPath = '' } = {}) {` |

### lib/git/repo-index.js（513 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `locateRepoIndex` | 38-41 | 4 | `export function locateRepoIndex(workspaceRoot) {` |
| `readRepoIndexMap` | 44-77 | 34 | `export function readRepoIndexMap(workspaceRoot) {` |
| `indexEntryForRepo` | 80-84 | 5 | `export function indexEntryForRepo(localPath, indexMap) {` |
| `parseMdFrontmatterName` | 89-94 | 6 | `export function parseMdFrontmatterName(content) {` |
| `collectProjectSkills` | 97-127 | 31 | `export async function collectProjectSkills(projectPath) {` |
| `exists` | 130-132 | 3 | `async function exists(p) {` |
| `parseManualVisibility` | 135-147 | 13 | `export function parseManualVisibility(existingContent) {` |
| `queryGitHubVisibility` | 150-161 | 12 | `async function queryGitHubVisibility(repoName, token, owner = 'EIGHTfs') {` |
| `remoteToRepoInfo` | 164-173 | 10 | `function remoteToRepoInfo(remote, visibility) {` |
| `buildRepoIndexVisibility` | 176-192 | 17 | `async function buildRepoIndexVisibility({ repos, token, manualVisibility, owner }) {` |
| `buildRepoIndexLocalOnly` | 195-208 | 14 | `async function buildRepoIndexLocalOnly({ workspaceRoot, repos, localOnlyExtra }) {` |
| `buildRepoIndex` | 215-260 | 46 | `export async function buildRepoIndex({ workspaceRoot, depth = 20, extraRepos = [], extraReposFile = '', token = '', manualVisibility = {}, localOnlyExtra = [], owner = 'EIGHTfs', offline = false, maxRepos = 200 } = {}) {` |
| `repoList` | 232-239 | 8 | `const repoList = (await Promise.all(ownedRepos.map(async (r) => {` |
| `syncRepoIndex` | 266-285 | 20 | `export function syncRepoIndex({ content, workspaceRoot = '', owner = 'EIGHTfs', syncTarget = '' } = {}) {` |
| `mergeFreshIntoExisting` | 300-347 | 48 | `function mergeFreshIntoExisting(existing, freshContent) {` |
| `updateRepoIndex` | 364-391 | 28 | `export async function updateRepoIndex({ workspaceRoot = '', token = '', owner = 'EIGHTfs', depth = 20, extraRepos = [], extraReposFile = '', syncTarget = '', offline = false, maxRepos = 200, mode = 'rebuild', cloudRepos = [], repoName = '', remoteState = {} } = {}) {` |
| `maintainRepoIndex` | 398-401 | 4 | `export async function maintainRepoIndex({ workspaceRoot = '', token = '', owner = 'EIGHTfs', depth = 20, extraRepos = [], extraReposFile = '', syncTarget = '', offline = false, maxRepos = 200 } = {}) {` |
| `mergeCloudReposIntoIndex` | 416-469 | 54 | `export function mergeCloudReposIntoIndex({ workspaceRoot = '', owner = 'EIGHTfs', cloudRepos = [], syncTarget = '' } = {}) {` |
| `updateRepoRemoteStateInIndex` | 486-512 | 27 | `export function updateRepoRemoteStateInIndex({ workspaceRoot = '', repoName = '', remoteState = {}, syncTarget = '' } = {}) {` |

### lib/git/repos.js（145 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `scanRepos` | 29-99 | 71 | `export function scanRepos(root = '.', { depth = DEFAULT_SCAN_DEPTH, extraRepos = [], extraReposFile = '', maxRepos = 200 } = {}) {` |
| `loadIgnoredDirs` | 38-52 | 15 | `const loadIgnoredDirs = (repoRoot) => {` |
| `isIgnored` | 54-62 | 9 | `const isIgnored = (abs) => {` |
| `walk` | 63-80 | 18 | `const walk = (dir, level) => {` |
| `maskRemoteUrl` | 105-114 | 10 | `export function maskRemoteUrl(url = '') {` |
| `describeRepo` | 120-144 | 25 | `export function describeRepo(repoPath = '') {` |

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

### lib/git/sensitive.js（135 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `escapeRegExp` | 43-45 | 3 | `function escapeRegExp(s) {` |
| `sensitiveLineMatch` | 48-67 | 20 | `function sensitiveLineMatch(line) {` |
| `scanOneSensitiveFile` | 84-110 | 27 | `async function scanOneSensitiveFile(dir, it, relPath) {` |
| `scanSensitiveFiles` | 112-134 | 23 | `export async function scanSensitiveFiles(repoPath) {` |
| `walk` | 116-131 | 16 | `const walk = async (dir, rel) => {` |

### lib/git/transport.js（409 行 · 15 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `sshUrlOf` | 28-30 | 3 | `function sshUrlOf(pr) {` |
| `knownHostsPath` | 33-35 | 3 | `function knownHostsPath() {` |
| `fetchRemoteHeads` | 42-55 | 14 | `export async function fetchRemoteHeads({ owner = '', repo = '', branch = '', token = '', count = 3 } = {}) {` |
| `dispatchPush` | 73-117 | 45 | `export async function dispatchPush({ repoPath = '', branch = '', token = '', force = false, pushMethod = 'ssh' } = {}) {` |
| `sshReason` | 124-133 | 10 | `export function sshReason(stderr = '') {` |
| `isNonFastForward` | 140-142 | 3 | `export function isNonFastForward(text = '') {` |
| `sshMuxCtlPath` | 156-170 | 15 | `function sshMuxCtlPath() {` |
| `buildLsRemoteSshCmd` | 173-179 | 7 | `function buildLsRemoteSshCmd(keyPath, known, { mux = true } = {}) {` |
| `liveRemoteHead` | 186-216 | 31 | `export function liveRemoteHead({ repoPath = '', branch = '' } = {}) {` |
| `pushViaSsh` | 219-242 | 24 | `export function pushViaSsh({ repoPath = '', branch = '', force = false }) {` |
| `sshFallback` | 245-248 | 4 | `async function sshFallback(repoPath, branch) {` |
| `apiOrFallback` | 251-256 | 6 | `async function apiOrFallback(api, repoPath, branch, res) {` |
| `pushViaApi` | 263-349 | 87 | `export async function pushViaApi({ repoPath = '', branch = '', token = '', force = false } = {}) {` |
| `uploadBlobsAndBuildTree` | 355-372 | 18 | `async function uploadBlobsAndBuildTree({ repoPath, entries, remoteBlobShas, api }) {` |
| `liveRemoteHeadAsync` | 382-408 | 27 | `export async function liveRemoteHeadAsync({ repoPath = '', branch = '' } = {}) {` |

### lib/git/visibility.js（36 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveRepoVisibility` | 24-35 | 12 | `export async function resolveRepoVisibility(repoPath, token = '') {` |

### lib/git/wrapped-git.js（68 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildWrappedGitEnv` | 16-31 | 16 | `export function buildWrappedGitEnv({ workspaceRoot = '' } = {}) {` |
| `runWrappedGit` | 34-47 | 14 | `export function runWrappedGit(args = [], { workspaceRoot = '' } = {}) {` |
| `runWrappedGitCapture` | 53-68 | 16 | `export function runWrappedGitCapture(args = [], { workspaceRoot = '' } = {}) {` |

### lib/http/index.js（170 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkOrigin` | 38-64 | 27 | `export function checkOrigin(method = '', origin = '', allowed = ALLOWED_ORIGINS, host = '') {` |
| `hostOf` | 49-53 | 5 | `const hostOf = (u) => {` |
| `checkWriteConfirm` | 72-78 | 7 | `export function checkWriteConfirm(body = {}) {` |
| `checkBodySize` | 86-94 | 9 | `export function checkBodySize(byteLength = 0, limit = MAX_BODY_BYTES) {` |
| `httpOk` | 102-104 | 3 | `export function httpOk(ok = true, extra = {}) {` |
| `authPipeline` | 112-121 | 10 | `export function authPipeline({ method = '', origin = '', contentLength = 0, isWriteConfirmOp = false } = {}, opts = {}) {` |
| `readJsonBody` | 129-146 | 18 | `export function readJsonBody(req, resolve = () => {}, limit = MAX_BODY_BYTES) {` |
| `done` | 132-135 | 4 | `const done = () => {` |
| `routeRequest` | 155-170 | 16 | `export function routeRequest(req = {}, handlers = {}) {` |

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

### lib/rule/loader.js（270 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isForceLoadRule` | 44-46 | 3 | `export function isForceLoadRule(ruleId) {` |
| `loadYamlRuleFile` | 94-103 | 10 | `export function loadYamlRuleFile(slot, dir = RULE_YAML_DIR) {` |
| `discoverRuleSlots` | 108-116 | 9 | `export function discoverRuleSlots(dir = RULE_YAML_DIR) {` |
| `resolveSlotOrder` | 131-162 | 32 | `export function resolveSlotOrder(order = null, { dir = RULE_YAML_DIR, includeTemplate = false } = {}) {` |
| `push` | 144-152 | 9 | `const push = (slot) => {` |
| `loadRuleFiles` | 173-222 | 50 | `export function loadRuleFiles(order = null, opts = {}) {` |
| `setSlotDisabled` | 236-270 | 35 | `export function setSlotDisabled(slot, disabled, opts = {}) {` |

### lib/rule/registry.js（115 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `registerCompiler` | 18-20 | 3 | `export function registerCompiler(kind, detect, compile) {` |
| `compileRule` | 28-61 | 34 | `export function compileRule(rule, ctx = {}) {` |
| `withSlot` | 43-51 | 9 | `const withSlot = (res) => {` |
| `compileAllRules` | 64-72 | 9 | `export function compileAllRules(rules, ctx = {}) {` |
| `withRuleScope` | 89-115 | 27 | `function withRuleScope(compiled, source) {` |

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

### lib/score/index.js（140 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countByDimension` | 50-80 | 31 | `export function countByDimension(findings = []) {` |
| `scoreQuality` | 97-140 | 44 | `export function scoreQuality(findings = [], weights = {}, context = {}) {` |

### lib/self/index.js（186 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readmeTemplate` | 66-131 | 66 | `export function readmeTemplate({ name = 'dsh-git-push', description = 'DSH git 自动提交推送插件——统一函数入口架构', version = VERSION, versionTable = '' } = {}) {` |
| `yamlTemplate` | 134-146 | 13 | `export function yamlTemplate() {` |
| `selfVersion` | 149-151 | 3 | `export function selfVersion() {` |
| `versionInfo` | 158-170 | 13 | `export function versionInfo(pkgJson = '') {` |
| `helpSync` | 179-185 | 7 | `export function helpSync(helpText = '', knownFlags = []) {` |

### lib/skip-dirs.js（65 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditRulesDir` | 25-27 | 3 | `export function auditRulesDir() {` |
| `loadYamlBlacklistDirs` | 35-54 | 20 | `export function loadYamlBlacklistDirs() {` |
| `getSkipSet` | 60-64 | 5 | `export function getSkipSet() {` |

### lib/vendor/js-yaml/js-yaml.mjs（3074 行 · 150 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `getDefaultExportFromCjs` | 1-3 | 3 | `function getDefaultExportFromCjs(x) {` |
| `requireCommon` | 8-49 | 42 | `function requireCommon() {` |
| `isNothing` | 11-13 | 3 | `function isNothing(subject) {` |
| `isObject` | 14-16 | 3 | `function isObject(subject) {` |
| `toArray` | 17-21 | 5 | `function toArray(sequence) {` |
| `extend` | 22-31 | 10 | `function extend(target, source) {` |
| `repeat` | 32-38 | 7 | `function repeat(string, count) {` |
| `isNegativeZero` | 39-41 | 3 | `function isNegativeZero(number) {` |
| `requireException` | 52-87 | 36 | `function requireException() {` |
| `formatError` | 55-67 | 13 | `function formatError(exception2, compact) {` |
| `YAMLException2` | 68-79 | 12 | `function YAMLException2(reason, mark) {` |
| `requireSnippet` | 90-167 | 78 | `function requireSnippet() {` |
| `getLine` | 94-111 | 18 | `function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {` |
| `padStart` | 112-114 | 3 | `function padStart(string, max) {` |
| `makeSnippet` | 115-164 | 50 | `function makeSnippet(mark, options) {` |
| `requireType` | 170-231 | 62 | `function requireType() {` |
| `compileStyleAliases` | 191-201 | 11 | `function compileStyleAliases(map2) {` |
| `Type2` | 202-228 | 27 | `function Type2(tag, options) {` |
| `requireSchema` | 234-320 | 87 | `function requireSchema() {` |
| `compileList` | 239-251 | 13 | `function compileList(schema2, name) {` |
| `compileMap` | 252-277 | 26 | `function compileMap() {` |
| `collectType` | 265-272 | 8 | `function collectType(type2) {` |
| `Schema2` | 278-280 | 3 | `function Schema2(definition) {` |
| `requireStr` | 323-334 | 12 | `function requireStr() {` |
| `requireSeq` | 337-348 | 12 | `function requireSeq() {` |
| `requireMap` | 351-362 | 12 | `function requireMap() {` |
| `requireFailsafe` | 365-377 | 13 | `function requireFailsafe() {` |
| `require_null` | 380-420 | 41 | `function require_null() {` |
| `resolveYamlNull` | 384-388 | 5 | `function resolveYamlNull(data) {` |
| `constructYamlNull` | 389-391 | 3 | `function constructYamlNull() {` |
| `isNull` | 392-394 | 3 | `function isNull(object) {` |
| `requireBool` | 423-457 | 35 | `function requireBool() {` |
| `resolveYamlBoolean` | 427-431 | 5 | `function resolveYamlBoolean(data) {` |
| `constructYamlBoolean` | 432-434 | 3 | `function constructYamlBoolean(data) {` |
| `isBoolean` | 435-437 | 3 | `function isBoolean(object) {` |
| `requireInt` | 460-573 | 114 | `function requireInt() {` |
| `isHexCode` | 465-467 | 3 | `function isHexCode(c) {` |
| `isOctCode` | 468-470 | 3 | `function isOctCode(c) {` |
| `isDecCode` | 471-473 | 3 | `function isDecCode(c) {` |
| `resolveYamlInteger` | 474-521 | 48 | `function resolveYamlInteger(data) {` |
| `parseYamlInteger` | 522-538 | 17 | `function parseYamlInteger(data) {` |
| `constructYamlInteger` | 539-541 | 3 | `function constructYamlInteger(data) {` |
| `isInteger` | 542-544 | 3 | `function isInteger(object) {` |
| `requireFloat` | 576-658 | 83 | `function requireFloat() {` |
| `resolveYamlFloat` | 588-597 | 10 | `function resolveYamlFloat(data) {` |
| `constructYamlFloat` | 598-610 | 13 | `function constructYamlFloat(data) {` |
| `representYamlFloat` | 612-645 | 34 | `function representYamlFloat(object, style) {` |
| `isFloat` | 646-648 | 3 | `function isFloat(object) {` |
| `requireJson` | 661-673 | 13 | `function requireJson() {` |
| `requireCore` | 676-681 | 6 | `function requireCore() {` |
| `requireTimestamp` | 684-743 | 60 | `function requireTimestamp() {` |
| `resolveYamlTimestamp` | 694-699 | 6 | `function resolveYamlTimestamp(data) {` |
| `constructYamlTimestamp` | 700-731 | 32 | `function constructYamlTimestamp(data) {` |
| `representYamlTimestamp` | 732-734 | 3 | `function representYamlTimestamp(object) {` |
| `requireMerge` | 746-758 | 13 | `function requireMerge() {` |
| `resolveYamlMerge` | 750-752 | 3 | `function resolveYamlMerge(data) {` |
| `requireBinary` | 761-850 | 90 | `function requireBinary() {` |
| `resolveYamlBinary` | 766-778 | 13 | `function resolveYamlBinary(data) {` |
| `constructYamlBinary` | 779-805 | 27 | `function constructYamlBinary(data) {` |
| `representYamlBinary` | 806-838 | 33 | `function representYamlBinary(object) {` |
| `isBinary` | 839-841 | 3 | `function isBinary(obj) {` |
| `requireOmap` | 853-889 | 37 | `function requireOmap() {` |
| `resolveYamlOmap` | 859-879 | 21 | `function resolveYamlOmap(data) {` |
| `constructYamlOmap` | 880-882 | 3 | `function constructYamlOmap(data) {` |
| `requirePairs` | 892-927 | 36 | `function requirePairs() {` |
| `resolveYamlPairs` | 897-909 | 13 | `function resolveYamlPairs(data) {` |
| `constructYamlPairs` | 910-920 | 11 | `function constructYamlPairs(data) {` |
| `requireSet` | 930-954 | 25 | `function requireSet() {` |
| `resolveYamlSet` | 935-944 | 10 | `function resolveYamlSet(data) {` |
| `constructYamlSet` | 945-947 | 3 | `function constructYamlSet(data) {` |
| `require_default` | 957-973 | 17 | `function require_default() {` |
| `requireLoader` | 975-2344 | 1370 | `function requireLoader() {` |
| `_class` | 995-997 | 3 | `function _class(obj) {` |
| `isEol` | 998-1000 | 3 | `function isEol(c) {` |
| `isWhiteSpace` | 1001-1003 | 3 | `function isWhiteSpace(c) {` |
| `isWsOrEol` | 1004-1006 | 3 | `function isWsOrEol(c) {` |
| `isFlowIndicator` | 1007-1009 | 3 | `function isFlowIndicator(c) {` |
| `fromHexCode` | 1010-1019 | 10 | `function fromHexCode(c) {` |
| `escapedHexLen` | 1020-1031 | 12 | `function escapedHexLen(c) {` |
| `fromDecimalCode` | 1032-1037 | 6 | `function fromDecimalCode(c) {` |
| `simpleEscapeSequence` | 1038-1079 | 42 | `function simpleEscapeSequence(c) {` |
| `charFromCodepoint` | 1080-1088 | 9 | `function charFromCodepoint(c) {` |
| `setProperty` | 1089-1100 | 12 | `function setProperty(object, key, value) {` |
| `State` | 1107-1129 | 23 | `function State(input, options) {` |
| `generateError` | 1130-1141 | 12 | `function generateError(state, message) {` |
| `throwError` | 1142-1144 | 3 | `function throwError(state, message) {` |
| `throwWarning` | 1145-1149 | 5 | `function throwWarning(state, message) {` |
| `storeAnchor` | 1150-1162 | 13 | `function storeAnchor(state, name, value) {` |
| `beginAnchorTransaction` | 1163-1165 | 3 | `function beginAnchorTransaction(state) {` |
| `commitAnchorTransaction` | 1166-1178 | 13 | `function commitAnchorTransaction(state) {` |
| `rollbackAnchorTransaction` | 1179-1190 | 12 | `function rollbackAnchorTransaction(state) {` |
| `snapshotState` | 1191-1203 | 13 | `function snapshotState(state) {` |
| `restoreState` | 1204-1214 | 11 | `function restoreState(state, snapshot) {` |
| `captureSegment` | 1262-1277 | 16 | `function captureSegment(state, start, end, checkJson) {` |
| `mergeMappings` | 1278-1293 | 16 | `function mergeMappings(state, destination, source, overridableKeys) {` |
| `storeMappingPair` | 1294-1332 | 39 | `function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {` |
| `readLineBreak` | 1333-1348 | 16 | `function readLineBreak(state) {` |
| `skipSeparationSpace` | 1349-1381 | 33 | `function skipSeparationSpace(state, allowComments, checkIndent) {` |
| `testDocumentSeparator` | 1382-1393 | 12 | `function testDocumentSeparator(state) {` |
| `writeFoldedLines` | 1394-1400 | 7 | `function writeFoldedLines(state, count) {` |
| `readPlainScalar` | 1401-1472 | 72 | `function readPlainScalar(state, nodeIndent, withinFlowCollection) {` |
| `readSingleQuotedScalar` | 1473-1509 | 37 | `function readSingleQuotedScalar(state, nodeIndent) {` |
| `readDoubleQuotedScalar` | 1510-1566 | 57 | `function readDoubleQuotedScalar(state, nodeIndent) {` |
| `readFlowCollection` | 1567-1656 | 90 | `function readFlowCollection(state, nodeIndent) {` |
| `readBlockScalar` | 1657-1762 | 106 | `function readBlockScalar(state, nodeIndent) {` |
| `readBlockSequence` | 1763-1813 | 51 | `function readBlockSequence(state, nodeIndent) {` |
| `readBlockMapping` | 1814-1934 | 121 | `function readBlockMapping(state, nodeIndent, flowIndent) {` |
| `readTagProperty` | 1935-2008 | 74 | `function readTagProperty(state) {` |
| `readAnchorProperty` | 2009-2025 | 17 | `function readAnchorProperty(state) {` |
| `readAlias` | 2026-2044 | 19 | `function readAlias(state) {` |
| `tryReadBlockMappingFromProperty` | 2045-2060 | 16 | `function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {` |
| `composeNode` | 2061-2218 | 158 | `function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {` |
| `readDocument` | 2219-2291 | 73 | `function readDocument(state) {` |
| `loadDocuments` | 2292-2318 | 27 | `function loadDocuments(input, options) {` |
| `loadAll2` | 2319-2331 | 13 | `function loadAll2(input, iterator, options) {` |
| `load2` | 2332-2340 | 9 | `function load2(input, options) {` |
| `requireDumper` | 2347-2997 | 651 | `function requireDumper() {` |
| `compileStyleMap` | 2415-2432 | 18 | `function compileStyleMap(schema2, map2) {` |
| `encodeHex` | 2433-2450 | 18 | `function encodeHex(character) {` |
| `State` | 2453-2474 | 22 | `function State(options) {` |
| `indentString` | 2475-2494 | 20 | `function indentString(string, spaces) {` |
| `generateNextLine` | 2495-2497 | 3 | `function generateNextLine(state, level) {` |
| `testImplicitResolving` | 2498-2506 | 9 | `function testImplicitResolving(state, str2) {` |
| `isWhitespace` | 2507-2509 | 3 | `function isWhitespace(c) {` |
| `isPrintable` | 2510-2512 | 3 | `function isPrintable(c) {` |
| `isNsCharOrWhitespace` | 2513-2516 | 4 | `function isNsCharOrWhitespace(c) {` |
| `isPlainSafe` | 2517-2529 | 13 | `function isPlainSafe(c, prev, inblock) {` |
| `isPlainSafeFirst` | 2530-2537 | 8 | `function isPlainSafeFirst(c) {` |
| `isPlainSafeLast` | 2538-2540 | 3 | `function isPlainSafeLast(c) {` |
| `codePointAt` | 2541-2551 | 11 | `function codePointAt(string, pos) {` |
| `needIndentIndicator` | 2552-2555 | 4 | `function needIndentIndicator(string) {` |
| `chooseScalarStyle` | 2561-2610 | 50 | `function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {` |
| `writeScalar` | 2611-2652 | 42 | `function writeScalar(state, string, level, iskey, inblock) {` |
| `testAmbiguity` | 2625-2627 | 3 | `function testAmbiguity(string2) {` |
| `blockHeader` | 2653-2659 | 7 | `function blockHeader(string, indentPerLevel) {` |
| `dropEndingNewline` | 2660-2662 | 3 | `function dropEndingNewline(string) {` |
| `foldString` | 2663-2682 | 20 | `function foldString(string, width) {` |
| `foldLine` | 2683-2708 | 26 | `function foldLine(line, width) {` |
| `escapeString` | 2709-2723 | 15 | `function escapeString(string) {` |
| `writeFlowSequence` | 2724-2739 | 16 | `function writeFlowSequence(state, level, object) {` |
| `writeBlockSequence` | 2740-2762 | 23 | `function writeBlockSequence(state, level, object, compact) {` |
| `writeFlowMapping` | 2763-2789 | 27 | `function writeFlowMapping(state, level, object) {` |
| `writeBlockMapping` | 2790-2839 | 50 | `function writeBlockMapping(state, level, object, compact) {` |
| `detectType` | 2840-2870 | 31 | `function detectType(state, object, explicit) {` |
| `writeNode` | 2871-2951 | 81 | `function writeNode(state, level, object, block, compact, iskey, isblockseq) {` |
| `getDuplicateReferences` | 2952-2961 | 10 | `function getDuplicateReferences(object, state) {` |
| `inspectNode` | 2962-2983 | 22 | `function inspectNode(object, objects, duplicatesIndexes) {` |
| `dump2` | 2984-2994 | 11 | `function dump2(input, options) {` |
| `requireJsYaml` | 2999-3038 | 40 | `function requireJsYaml() {` |
| `renamed` | 3004-3008 | 5 | `function renamed(from, to) {` |

### scripts/arch-mcp.mjs（92 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `textResult` | 50-52 | 3 | `function textResult(obj) {` |
| `handleRequest` | 55-74 | 20 | `async function handleRequest(req) {` |
| `main` | 76-89 | 14 | `function main() {` |

### scripts/archify-gen.mjs（987 行 · 37 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `deriveExternals` | 52-74 | 23 | `function deriveExternals(repoPath, sourceRoot) {` |
| `deriveCrossLayerEdges` | 88-124 | 37 | `function deriveCrossLayerEdges(repoPath, sourceRootName, moduleIds) {` |
| `inferComponentType` | 127-130 | 4 | `export function inferComponentType(dirName) {` |
| `layoutByLayer` | 166-192 | 27 | `function layoutByLayer(components, connections = []) {` |
| `readRepositoryEvidence` | 199-220 | 22 | `function readRepositoryEvidence(repoPath) {` |
| `run` | 200-205 | 6 | `const run = (args) => {` |
| `appendDataFileNodes` | 235-256 | 22 | `async function appendDataFileNodes(repoPath, components, connections, ids, src, graph) {` |
| `linkOrDropIsolated` | 265-299 | 35 | `function linkOrDropIsolated(repoPath, components, connections, boundaries, topLevelIds = new Set()) {` |
| `buildFuncCards` | 312-324 | 13 | `async function buildFuncCards(repoPath) {` |
| `parentBoundaries` | 333-345 | 13 | `function parentBoundaries(components) {` |
| `deriveExternalNodes` | 352-375 | 24 | `function deriveExternalNodes(repoPath, sourceRootName) {` |
| `aggregateByLayer` | 386-447 | 62 | `export function aggregateByLayer(components, connections) {` |
| `groupOf` | 393-404 | 12 | `const groupOf = (c) => {` |
| `slug` | 414-414 | 1 | `const slug = (g) => g.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-\|-$/g, '') \|\| 'root';` |
| `dirComponents` | 453-461 | 9 | `function dirComponents(repoPath, dirs, src) {` |
| `placeOnGrid` | 469-501 | 33 | `function placeOnGrid(components, connections, maxCols = 6) {` |
| `resolveView` | 525-541 | 17 | `function resolveView(components, connections) {` |
| `useFine` | 531-534 | 4 | `const useFine = () => {` |
| `regroupForView` | 543-612 | 70 | `function regroupForView(fine, connections) {` |
| `topOf` | 545-555 | 11 | `const topOf = (c) => {` |
| `typeOf` | 557-562 | 6 | `const typeOf = (ms) => {` |
| `slug` | 571-571 | 1 | `const slug = (s) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-\|-$/g, '') \|\| 'grp';` |
| `buildArchitectureDoc` | 614-778 | 165 | `export async function buildArchitectureDoc(repoPath, name = basename(resolve(repoPath))) {` |
| `treeDoc` | 661-663 | 3 | `const treeDoc = (() => {` |
| `representativeFile` | 787-814 | 28 | `function representativeFile(repoPath, dir) {` |
| `tracked` | 788-798 | 11 | `const tracked = (() => {` |
| `countFiles` | 817-831 | 15 | `function countFiles(dir) {` |
| `walk` | 820-827 | 8 | `const walk = (d) => {` |
| `validateHeader` | 834-840 | 7 | `function validateHeader(doc, errs) {` |
| `validateComponents` | 848-867 | 20 | `function validateComponents(doc, errs) {` |
| `validateConnections` | 870-877 | 8 | `function validateConnections(doc, ids, errs) {` |
| `validateBoundaries` | 880-885 | 6 | `function validateBoundaries(doc, errs) {` |
| `validateRepositoryEvidence` | 891-898 | 8 | `function validateRepositoryEvidence(doc, errs) {` |
| `validateAgainstSpec` | 908-916 | 9 | `export function validateAgainstSpec(doc) {` |
| `checkDrift` | 922-947 | 26 | `export function checkDrift(repoPath, doc) {` |
| `outputPath` | 950-952 | 3 | `export function outputPath(repoPath, name = basename(resolve(repoPath))) {` |
| `main` | 954-984 | 31 | `async function main() {` |

### scripts/archify-imports.mjs（343 行 · 14 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `inferLayer` | 31-33 | 3 | `export function inferLayer(dirName) {` |
| `listSourceFiles` | 36-50 | 15 | `export function listSourceFiles(dir) {` |
| `walk` | 38-47 | 10 | `const walk = (d) => {` |
| `importSpecifiers` | 57-62 | 6 | `export function importSpecifiers(text) {` |
| `resolveLibModule` | 70-84 | 15 | `export function resolveLibModule(fromFile, spec, sourceRoot = 'lib') {` |
| `moduleAnchor` | 92-108 | 17 | `function moduleAnchor(repoPath, mod, sourceRoot) {` |
| `addResourceEdges` | 127-151 | 25 | `function addResourceEdges(repoPath, sourceRoot, components, edges) {` |
| `deriveLibGraph` | 153-270 | 118 | `export function deriveLibGraph(repoPath) {` |
| `trackedSet` | 167-173 | 7 | `const trackedSet = (() => {` |
| `isTracked` | 174-174 | 1 | `const isTracked = (rel) => !trackedSet \|\| trackedSet.has(rel);` |
| `slug` | 209-209 | 1 | `const slug = (x) => String(x).replace(/\.(m?js\|cjs)$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');` |
| `detectSourceRoot` | 280-282 | 3 | `export function detectSourceRoot(repoPath) {` |
| `layersToBoundaries` | 315-322 | 8 | `export function layersToBoundaries(components) {` |
| `main` | 324-340 | 17 | `function main() {` |

### scripts/archify-preview.mjs（133 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readPreviewConfig` | 31-40 | 10 | `function readPreviewConfig() {` |
| `refreshProject` | 56-105 | 50 | `function refreshProject(repoPath, { checkOnly = false } = {}) {` |
| `main` | 107-130 | 24 | `function main() {` |

### scripts/audit-ext/variable-min-length.mjs（102 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isExcludedPath` | 29-36 | 8 | `const isExcludedPath = (rel) => {` |
| `walk` | 60-98 | 39 | `const walk = (dir) => {` |

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

### scripts/check.mjs（37 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectJs` | 15-23 | 9 | `function collectJs(dir, acc = []) {` |

### scripts/doc-func.mjs（207 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `escapeReg` | 30-31 | 2 | `function escapeReg(s) { return s.replace(/[.*+?^${}()\|[\]\\]/g, '\\$&'); }` |
| `stripComment` | 32-34 | 3 | `function stripComment(line) {` |
| `findBlockEnd` | 37-49 | 13 | `function findBlockEnd(lines, startIdx) {` |
| `detectFunction` | 51-60 | 10 | `function detectFunction(lines, i) {` |
| `scanFileFuncs` | 63-207 | 145 | `export function scanFileFuncs(file) {` |
| `collectFuncFiles` | 105-120 | 16 | `export function collectFuncFiles(root, includeDirs = DEFAULT_SCAN_DIRS) {` |
| `walk` | 107-117 | 11 | `const walk = (dir, depth) => {` |
| `buildFuncListText` | 123-142 | 20 | `export function buildFuncListText(root, includeDirs = DEFAULT_SCAN_DIRS) {` |
| `findBlock` | 145-150 | 6 | `function findBlock(text) {` |
| `applyFuncBlock` | 153-157 | 5 | `export function applyFuncBlock(text, newContent) {` |
| `checkFuncDrift` | 160-172 | 13 | `export function checkFuncDrift({ hostPath, root, includeDirs = DEFAULT_SCAN_DIRS } = {}) {` |
| `out` | 182-182 | 1 | `const out = (msg) => console.log(msg);` |

### scripts/doc-tree.mjs（456 行 · 20 个函数）

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
| `checkDrift` | 303-381 | 79 | `export function checkDrift({ readmePath = DEFAULT_README, root = ROOT } = {}) {` |
| `isToolGenerated` | 352-352 | 1 | `const isToolGenerated = (p) => p === 'functions-index.json' \|\| p === '_meta'` |
| `filesOf` | 400-400 | 1 | `const filesOf = (r) => gitLsFiles(r);` |
| `mapOf` | 401-401 | 1 | `const mapOf = (r) => loadMapping(r);` |

### scripts/doc-version.mjs（92 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildVersionListText` | 28-31 | 4 | `export function buildVersionListText(root) {` |
| `findBlock` | 34-39 | 6 | `function findBlock(text) {` |
| `applyVersionBlock` | 42-46 | 5 | `export function applyVersionBlock(text, newContent) {` |
| `checkVersionDrift` | 49-57 | 9 | `export function checkVersionDrift({ hostPath, root } = {}) {` |
| `out` | 67-67 | 1 | `const out = (msg) => console.log(msg);` |

### scripts/gen-preview.mjs（109 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildPreviewSlotData` | 28-35 | 8 | `export function buildPreviewSlotData() {` |
| `readPreviewSlotData` | 38-48 | 11 | `export function readPreviewSlotData(html = readPreviewHtml()) {` |
| `readPreviewHtml` | 50-53 | 4 | `function readPreviewHtml() {` |
| `genPreview` | 56-69 | 14 | `export function genPreview({ write = false } = {}) {` |
| `checkPreviewDrift` | 72-89 | 18 | `export function checkPreviewDrift() {` |
| `basenameSafe` | 105-108 | 4 | `function basenameSafe(p) {` |

### scripts/hot-path-probe.mjs（154 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readCfg` | 31-37 | 7 | `function readCfg() {` |
| `report` | 61-77 | 17 | `function report() {` |
| `initialize` | 88-90 | 3 | `export function initialize(data) {` |
| `resolve` | 93-102 | 10 | `export async function resolve(specifier, context, next) {` |
| `load` | 105-153 | 49 | `export async function load(url, context, next) {` |
| `__wrapped` | 141-145 | 5 | `const __wrapped = function (...__a) {` |

### scripts/platform-scan.mjs（169 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectFiles` | 56-68 | 13 | `function collectFiles(root, exts, dir = root, out = []) {` |
| `commentLineSet` | 71-79 | 9 | `function commentLineSet(text) {` |
| `scanPlatformCode` | 87-115 | 29 | `export function scanPlatformCode(root, { exts = DEFAULT_EXTS } = {}) {` |
| `parseArgs` | 118-132 | 15 | `function parseArgs(argv) {` |
| `printReport` | 135-153 | 19 | `function printReport(result, top) {` |

### scripts/preview-server.mjs（116 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `detectLanIp` | 29-41 | 13 | `function detectLanIp() {` |

### scripts/readme-gen.mjs（266 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runGit` | 65-72 | 8 | `function runGit(args, { cwd = '' } = {}) {` |
| `renderReadmeTemplateYml` | 75-89 | 15 | `export function renderReadmeTemplateYml(data) {` |
| `loadReadmeTemplateYml` | 92-103 | 12 | `export function loadReadmeTemplateYml(dir = README_TEMPLATE_YML_DIR) {` |
| `resolveReadmeTemplate` | 106-116 | 11 | `export function resolveReadmeTemplate({ repoPath = '', explicit = '' } = {}) {` |
| `tocFromTemplate` | 119-129 | 11 | `export function tocFromTemplate(template) {` |
| `parseVersion` | 134-138 | 5 | `export function parseVersion(str) {` |
| `listVersionCommits` | 143-157 | 15 | `export function listVersionCommits(repoPath) {` |
| `scrubConvWording` | 164-176 | 13 | `export function scrubConvWording(label) {` |
| `readVersionMetrics` | 187-194 | 8 | `export function readVersionMetrics(repoPath) {` |
| `buildReadmeVersionTable` | 196-223 | 28 | `export function buildReadmeVersionTable(repoPath) {` |
| `genReadme` | 226-242 | 17 | `export function genReadme({ repoPath, template = '' } = {}) {` |
| `toString` | 244-245 | 2 | `function toString(arr) { return Array.isArray(arr) ? arr.join('\n') : String(arr \|\| ''); }` |
| `main` | 246-258 | 13 | `function main(argv) {` |

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

### scripts/scan-file-io.mjs（714 行 · 27 个函数）

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
| `main` | 530-577 | 48 | `export function main(argv = process.argv.slice(2)) {` |
| `splitMulti` | 541-541 | 1 | `const splitMulti = (v) => String(v \|\| '').split(',').map((x) => x.trim()).filter(Boolean);` |
| `scanFileIo` | 580-600 | 21 | `export function scanFileIo(opts = {}) {` |
| `summarize` | 603-620 | 18 | `export function summarize(hits) {` |
| `count` | 604-608 | 5 | `const count = (key) => {` |
| `printReport` | 632-708 | 77 | `function printReport(hits, opts = {}) {` |

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

### scripts/scan-version.mjs（123 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readmeVersion` | 36-66 | 31 | `export function readmeVersion(text = '') {` |
| `cmp` | 56-63 | 8 | `const cmp = (a, b) => {` |
| `main` | 68-120 | 53 | `function main() {` |

### scripts/scrub-user-wording.mjs（421 行 · 17 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadWordingRewrites` | 48-60 | 13 | `export function loadWordingRewrites(ymlPath = DEFAULT_REWRITE_YML) {` |
| `wordingRewrites` | 63-66 | 4 | `function wordingRewrites() {` |
| `scrubText` | 69-76 | 8 | `function scrubText(text) {` |
| `commentSyntax` | 81-90 | 10 | `function commentSyntax(ext) {` |
| `skipRegexLiteral` | 106-116 | 11 | `function skipRegexLiteral(text, i, n) {` |
| `skipStringLiteral` | 119-128 | 10 | `function skipStringLiteral(text, i, n) {` |
| `matchCommentRange` | 138-143 | 6 | `function matchCommentRange(text, i, n, syn) {` |
| `codeCommentRanges` | 155-184 | 30 | `function codeCommentRanges(text, syn) {` |
| `markupFenceLines` | 187-204 | 18 | `function markupFenceLines(text) {` |
| `fileHeaderExempt` | 207-210 | 4 | `function fileHeaderExempt(text) {` |
| `lineExempt` | 213-215 | 3 | `function lineExempt(line) {` |
| `processFile` | 228-274 | 47 | `function processFile(filePath) {` |
| `applyConfirmed` | 277-292 | 16 | `function applyConfirmed(file, confirmedSet) {` |
| `collectFiles` | 295-307 | 13 | `function collectFiles(root, out = []) {` |
| `repoDiffFiles` | 310-317 | 8 | `function repoDiffFiles(repoPath) {` |
| `main` | 319-417 | 99 | `async function main(argv) {` |
| `ask` | 385-385 | 1 | `const ask = (q) => new Promise((res) => rl.question(q, res));` |

### scripts/symbol-index.mjs（86 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectFiles` | 23-35 | 13 | `function collectFiles(root, exts, dir = root, out = []) {` |
| `parseArgs` | 38-52 | 15 | `function parseArgs(argv) {` |

### scripts/sync-plugin.mjs（233 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isNpmIgnored` | 57-61 | 5 | `export function isNpmIgnored(rel) {` |
| `exists` | 64-66 | 3 | `async function exists(p) {` |
| `packageFilesOf` | 75-91 | 17 | `export async function packageFilesOf(root) {` |
| `listSyncFiles` | 98-118 | 21 | `export async function listSyncFiles(root = SOURCE_ROOT) {` |
| `walk` | 102-110 | 9 | `const walk = async (dir) => {` |
| `detectTargets` | 133-149 | 17 | `export function detectTargets(home = process.env.DSH_HOME \|\| '', pluginName = '') {` |
| `fileContentEqual` | 161-170 | 10 | `async function fileContentEqual(from, to) {` |
| `syncPlugin` | 172-202 | 31 | `export async function syncPlugin({ source = SOURCE_ROOT, target = '', write = false } = {}) {` |
| `main` | 205-226 | 22 | `export async function main(argv = process.argv.slice(2)) {` |

### scripts/verify-prestep.mjs（101 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `check` | 20-21 | 2 | `function check(name, ok) { results.push([name, !!ok]); if (!ok) console.log('  ❌', name); }` |

### scripts/watch-preview.mjs（71 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `regen` | 38-48 | 11 | `function regen() {` |

### test/helpers/test-cache.mjs（211 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `stripCommentsAndStrings` | 57-82 | 26 | `export function stripCommentsAndStrings(text) {` |
| `isCacheableTest` | 90-94 | 5 | `export function isCacheableTest(sourceText, fileName = '') {` |
| `relativeSpecifiers` | 97-110 | 14 | `export function relativeSpecifiers(sourceText) {` |
| `importClosure` | 118-137 | 20 | `export function importClosure(entryAbs, exists = existsSync) {` |
| `cacheKeyFor` | 145-156 | 12 | `export function cacheKeyFor(absFiles, nodeVersion = process.version) {` |
| `loadTestCache` | 159-166 | 8 | `export function loadTestCache(root) {` |
| `saveTestCache` | 169-182 | 14 | `export function saveTestCache(root, cache) {` |
| `planTestRun` | 191-210 | 20 | `export function planTestRun(files, cache, exists = existsSync) {` |

### test/helpers/tmp-dir.mjs（117 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `installExitHook` | 25-33 | 9 | `function installExitHook() {` |
| `removeTempDir` | 36-39 | 4 | `export function removeTempDir(dir) {` |
| `mkdtempTracked` | 51-57 | 7 | `export function mkdtempTracked(prefixPath) {` |
| `tempDir` | 65-71 | 7 | `export function tempDir(label = 'tmp', { t = null } = {}) {` |
| `tempRepo` | 79-85 | 7 | `export function tempRepo(label = 'repo', { t = null, name = '', email = '' } = {}) {` |
| `sweepStaleTempDirs` | 93-116 | 24 | `export function sweepStaleTempDirs({ maxAgeMs = 60 * 60 * 1000, log = null } = {}) {` |

### test/test-account-ssh.mjs（149 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isolatedEnv` | 17-24 | 8 | `function isolatedEnv() {` |

### test/test-analysis-coverage.mjs（77 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeProject` | 20-27 | 8 | `function makeProject() {` |

### test/test-arch-generic.mjs（72 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `signature` | 20-26 | 7 | `function signature(facts) {` |

### test/test-arch-ir.mjs（93 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFixture` | 17-24 | 8 | `function makeFixture() {` |
| `buildIr` | 26-30 | 5 | `async function buildIr(dir) {` |

### test/test-arch-json-fresh.mjs（94 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `regenerate` | 29-50 | 22 | `async function regenerate() {` |
| `evidence` | 35-48 | 14 | `const evidence = (() => {` |
| `run` | 36-40 | 5 | `const run = (args) => {` |

### test/test-audit-bad-file.mjs（107 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setupBadFile` | 18-23 | 6 | `function setupBadFile(relPath, content) {` |
| `cleanup` | 24-28 | 5 | `function cleanup(relPath) {` |

### test/test-audit-defaults.mjs（34 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `read` | 15-15 | 1 | `const read = (p) => readFileSync(join(ROOT, p), 'utf8');` |

### test/test-auditignore.mjs（145 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setupRepo` | 11-32 | 22 | `function setupRepo() {` |

### test/test-cli-audit-parity.mjs（65 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeAuditRepo` | 19-39 | 21 | `function makeAuditRepo() {` |

### test/test-client.mjs（519 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mockReact` | 20-26 | 7 | `function mockReact() {` |
| `req` | 324-341 | 18 | `const req = (name) => {` |
| `req` | 402-421 | 20 | `const req = (name) => {` |
| `req` | 470-488 | 19 | `const req = (name) => {` |

### test/test-clone-concurrency.mjs（456 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `probe` | 129-153 | 25 | `const probe = async (useNew) => {` |
| `writer` | 134-140 | 7 | `const writer = (async () => {` |
| `call` | 433-433 | 1 | `const call = async (body) => (await handleHttp(` |

### test/test-clone-history-mode.mjs（129 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeApi` | 20-30 | 11 | `function fakeApi({ headSha = 'c', trees = {}, commits = {}, refStatus = 200 } = {}) {` |
| `fakeGit` | 33-44 | 12 | `function fakeGit() {` |
| `runGit` | 36-42 | 7 | `const runGit = (args) => {` |

### test/test-clone-history.mjs（136 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `stubApi` | 28-38 | 11 | `function stubApi(chain) {` |

### test/test-clone-parts-keep.mjs（64 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `stubFetch` | 16-24 | 9 | `function stubFetch() {` |

### test/test-clone-preview-buttons.mjs（134 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeJsx` | 25-33 | 9 | `function makeJsx() {` |
| `createElement` | 26-31 | 6 | `const createElement = (type, props) => {` |
| `extractFunction` | 36-134 | 99 | `function extractFunction(src, signature) {` |
| `walk` | 50-55 | 6 | `function walk(node, out = []) {` |
| `renderPreview` | 58-134 | 77 | `function renderPreview(handlers = {}) {` |

### test/test-clone-replay-io.mjs（159 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeGit` | 17-159 | 143 | `function fakeGit({ hasOrigin = false, failAt = '' } = {}) {` |
| `runGit` | 19-29 | 11 | `const runGit = (args) => {` |

### test/test-clone-replay.mjs（233 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeIo` | 115-133 | 19 | `function fakeIo({ trees = {}, failDownloadAt = -1, marker = null } = {}) {` |

### test/test-collector-ignore.mjs（68 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 21-31 | 11 | `function makeRepo() {` |
| `paths` | 33-33 | 1 | `const paths = (list) => list.map((f) => String(f.path).replace(/\\/g, '/'));` |

### test/test-conv-rule-scope.mjs（46 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `extsOf` | 17-27 | 11 | `function extsOf(id) {` |

### test/test-dataflow.mjs（116 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 20-22 | 3 | `function hits(text) {` |

### test/test-doc-func.mjs（110 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkTmp` | 22-22 | 1 | `const mkTmp = () => mkdtempSync(join(tmpdir(), 'dshgp-docfunc-'));` |

### test/test-doc-version.mjs（81 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkTmp` | 20-20 | 1 | `const mkTmp = () => mkdtempSync(join(tmpdir(), 'dshgp-docver-'));` |
| `gitRepoWithVersions` | 33-41 | 9 | `function gitRepoWithVersions(dir) {` |

### test/test-docs-score.mjs（187 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeProject` | 19-27 | 9 | `function makeProject(files) {` |

### test/test-dup-code.mjs（177 行 · 15 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseUser` | 20-25 | 6 | `function parseUser(row) {` |
| `parseOrder` | 26-31 | 6 | `function parseOrder(row) {` |
| `parseItem` | 32-37 | 6 | `function parseItem(row) {` |
| `alpha` | 49-54 | 6 | `function alpha(x) {` |
| `beta` | 57-62 | 6 | `function beta(y) {` |
| `alpha` | 73-77 | 5 | `function alpha() {` |
| `beta` | 80-84 | 5 | `function beta() {` |
| `one` | 95-96 | 2 | `function one(x) { return x + 1; }` |
| `two` | 96-97 | 2 | `function two(x) { return x + 1; }` |
| `three` | 97-98 | 2 | `function three(x) { return x + 1; }` |
| `alpha` | 105-108 | 4 | `function alpha(x) {` |
| `beta` | 109-112 | 4 | `function beta(y) {` |
| `mk` | 122-122 | 1 | `const mk = (fnName) => `` |
| `mk` | 142-142 | 1 | `const mk = (fnName) => `` |
| `mk` | 160-160 | 1 | `const mk = (fnName, params) => `` |

### test/test-edit-after-read.mjs（91 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fixture` | 20-26 | 7 | `function fixture(content = 'const a = 1;\n') {` |
| `statFile` | 69-72 | 4 | `const statFile = () => {` |

### test/test-empty-catch-single-source.mjs（29 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `read` | 14-14 | 1 | `const read = (p) => readFileSync(join(ROOT, p), 'utf8');` |

### test/test-exempt.mjs（407 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `f` | 21-23 | 3 | `function f(kind, rule, line = 3) {` |
| `compileGrouped` | 230-238 | 9 | `async function compileGrouped() {` |

### test/test-false-positive-fixes.mjs（549 行 · 8 个函数）

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

### test/test-file-health.mjs（124 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `rule` | 10-22 | 13 | `function rule(over = {}) {` |

### test/test-folder-scope.mjs（106 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countSourceDirs` | 28-47 | 20 | `function countSourceDirs(tree, { threshold = 1, excludeDirs = [] } = {}) {` |

### test/test-func-doc-drift.mjs（70 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fixture` | 18-70 | 53 | `function fixture(block) {` |
| `driftFindings` | 36-39 | 4 | `async function driftFindings(dir) {` |

### test/test-git-identity-rewrite.mjs（191 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 28-35 | 8 | `function makeRepo() {` |
| `commit` | 38-42 | 5 | `function commit(dir, msg, { author = null, committer = { name: 'DSH Agent', email: 'agent@dsh.local' } } = {}) {` |
| `identities` | 45-47 | 3 | `function identities(dir) {` |
| `repoWrongEmails` | 49-51 | 3 | `function repoWrongEmails() {` |

### test/test-git-identity.mjs（117 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 25-29 | 5 | `function makeRepo() {` |
| `repoConfig` | 32-34 | 3 | `function repoConfig(dir, key) {` |

### test/test-git.mjs（846 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mockFetch` | 62-79 | 18 | `function mockFetch(routes) {` |
| `mockRawRoutes` | 86-96 | 11 | `function mockRawRoutes(files) {` |

### test/test-gitignore-match.mjs（141 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `gitAvailable` | 23-25 | 3 | `function gitAvailable() {` |
| `makeTree` | 29-37 | 9 | `function makeTree() {` |
| `ig` | 41-41 | 1 | `const ig = (text, f) => isIgnored(text, f);` |
| `hits` | 135-135 | 1 | `const hits = (rel) => isIgnoredByRules(rules, rel);` |

### test/test-gitignore-nongit-dir.mjs（40 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `rel` | 17-17 | 1 | `const rel = (list) => list.map((f) => String(f?.path ?? f).replace(SANDBOX + '/', '')).sort();` |

### test/test-history-audit.mjs（111 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 17-29 | 13 | `function makeRepo() {` |

### test/test-inject-switch.mjs（141 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `renderAuditInputs` | 28-98 | 71 | `function renderAuditInputs(value) {` |
| `req` | 43-56 | 14 | `const req = (name) => {` |
| `findChild` | 100-100 | 1 | `const findChild = (inputs) => inputs.find((p) => p['aria-label'] === LABEL);` |

### test/test-inject-system-prompt.mjs（373 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `renderAuditInputs` | 25-90 | 66 | `function renderAuditInputs(value) {` |
| `req` | 39-50 | 12 | `const req = (name) => {` |
| `findSwitch` | 92-92 | 1 | `const findSwitch = (inputs) => inputs.find((p) => p['aria-label'] === LABEL);` |

### test/test-link-check.mjs（229 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeFetch` | 14-21 | 8 | `function fakeFetch(map = {}) {` |

### test/test-magic-number.mjs（130 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 16-18 | 3 | `function hits(text) {` |

### test/test-max-lines-scope.mjs（66 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withScope` | 24-26 | 3 | `function withScope(action) {` |

### test/test-module-splitter-multiline.mjs（80 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFixture` | 25-43 | 19 | `function makeFixture(dir) {` |

### test/test-persist-credentials.mjs（93 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withIsolatedDshHome` | 19-30 | 12 | `function withIsolatedDshHome(fn) {` |

### test/test-platform-scan.mjs（98 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeProject` | 20-46 | 27 | `function makeProject() {` |

### test/test-plugin.mjs（652 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeExemptRepo` | 483-489 | 7 | `function makeExemptRepo() {` |
| `addSecretFile` | 490-493 | 4 | `function addSecretFile(root, path) {` |
| `fsStatMode` | 647-649 | 3 | `function fsStatMode(file) {` |

### test/test-private-gate.mjs（72 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fixture` | 27-33 | 7 | `function fixture() {` |

### test/test-project-type-filter.mjs（91 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkRepo` | 17-21 | 5 | `function mkRepo({ name = null } = {}) {` |

### test/test-push-transport.mjs（199 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `tempRepo` | 31-41 | 11 | `function tempRepo() {` |

### test/test-repo-list.mjs（548 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 37-48 | 12 | `function makeRepo(dir, { remote = '', commit = true } = {}) {` |
| `sandbox` | 51-63 | 13 | `function sandbox(fn) {` |
| `pick` | 460-460 | 1 | `const pick = (push) => String(push?.commitSha \|\| '').slice(0, 40) \|\| localHead;` |
| `sandboxAsync` | 490-502 | 13 | `async function sandboxAsync(fn) {` |

### test/test-rule-packs.mjs（609 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `apply` | 347-351 | 5 | `const apply = (s) => {` |
| `block` | 362-365 | 4 | `const block = (text) => {` |

### test/test-rule-slots-render.mjs（200 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `renderRuleRows` | 38-132 | 95 | `async function renderRuleRows(value, { publishAfterLoad = false } = {}) {` |
| `req` | 56-67 | 12 | `const req = (name) => {` |

### test/test-scope.mjs（177 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadCheckFuncLines` | 132-133 | 2 | `function loadCheckFuncLines() { return { checkFuncLines, checkComplexity }; }` |
| `loadNaming` | 133-134 | 2 | `function loadNaming() { return { checkNameLengthAst }; }` |

### test/test-settings-persistence.mjs（252 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `clientSubmitKeys` | 28-38 | 11 | `function clientSubmitKeys() {` |
| `allowlistKeys` | 47-52 | 6 | `function allowlistKeys() {` |
| `cfgMappingKeys` | 55-252 | 198 | `function cfgMappingKeys() {` |
| `isolatedEnv` | 72-79 | 8 | `function isolatedEnv() {` |

### test/test-sidebar-interaction.mjs（192 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeJsx` | 26-34 | 9 | `function makeJsx() {` |
| `createElement` | 27-32 | 6 | `const createElement = (type, props) => {` |
| `extractFunction` | 37-192 | 156 | `function extractFunction(src, signature) {` |
| `renderRow` | 54-192 | 139 | `function renderRow({ disabled = false, slot = 'frontend', stats, locked = false } = {}) {` |
| `walk` | 80-86 | 7 | `function walk(node, out = []) {` |
| `clsOf` | 88-88 | 1 | `const clsOf = (n) => String((n.props && n.props.className) \|\| '');` |
| `findClass` | 89-89 | 1 | `const findClass = (tree, cls) => walk(tree).find((n) => clsOf(n).includes(cls));` |

### test/test-sidebar-state.mjs（267 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadSettingsBody` | 27-32 | 6 | `function loadSettingsBody() {` |
| `readbackKeys` | 35-38 | 4 | `function readbackKeys() {` |
| `schemaKeys` | 41-43 | 3 | `function schemaKeys() {` |

### test/test-slash-commands.mjs（287 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `inv` | 15-17 | 3 | `function inv(cwd) {` |

### test/test-symbol-index.mjs（120 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `build` | 31-34 | 4 | `function build(extra = {}) {` |
| `hasEdge` | 36-36 | 1 | `const hasEdge = (idx, from, to, via) => idx.edges.some((e) => e.from === from && e.to === to && e.via === via);` |

### test/test-symlink-resolution.mjs（104 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildFixture` | 25-41 | 17 | `function buildFixture() {` |
| `runNode` | 43-45 | 3 | `function runNode(args, env) {` |

### test/test-task-queue.mjs（177 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkRepo` | 16-23 | 8 | `function mkRepo() {` |
| `wait` | 24-25 | 2 | `function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }` |
| `mockJobs` | 27-45 | 19 | `function mockJobs() {` |

### test/test-test-cache.mjs（120 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeProject` | 22-29 | 8 | `function makeProject() {` |

### test/test-tools-e2e.mjs（86 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 26-32 | 7 | `function makeRepo(name) {` |

### test/test-tree-doc.mjs（221 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeReadme` | 41-43 | 3 | `function makeReadme(tree) {` |

<!-- dshgp-functions:end -->
