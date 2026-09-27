# 函数列表

> 由 `scripts/doc-func.mjs` 维护：`gen` 打印 / `apply` 更新本节 / `check` 查漂移（扫描 lib/scripts/test 函数）。

<!-- dshgp-functions:start -->
## 函数列表

### lib/app/apply.js（217 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `apply` | 36-216 | 181 | `export async function apply(ctx, config = {}) {` |
| `envInjectText` | 81-108 | 28 | `const envInjectText = (cwdOverride) => {` |

### lib/app/audit-api.js（125 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `groupKeyOf` | 19-24 | 6 | `function groupKeyOf(finding, groupBy, ruleSlotMap) {` |
| `parseSeverityFilter` | 30-34 | 5 | `export function parseSeverityFilter(raw) {` |
| `aggregateFindings` | 43-64 | 22 | `export function aggregateFindings(findings = [], opts = {}) {` |
| `runAuditApi` | 72-124 | 53 | `export async function runAuditApi(repo, params = {}, cfg = {}) {` |

### lib/app/handlers/account.js（91 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `formatLastLoginAt` | 13-19 | 7 | `function formatLastLoginAt(iso) {` |
| `p` | 17-17 | 1 | `const p = (n) => String(n).padStart(2, '0');` |
| `handleAccountStatus` | 22-71 | 50 | `export function handleAccountStatus(ctx) {` |
| `line` | 49-62 | 14 | `const line = (label, configured, st) => {` |
| `handleAccountCheck` | 74-83 | 10 | `export async function handleAccountCheck(ctx) {` |
| `handleGenSshKey` | 86-91 | 6 | `export function handleGenSshKey(ctx) {` |

### lib/app/handlers/clone.js（114 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `handleRepoClone` | 19-78 | 60 | `export async function handleRepoClone(ctx) {` |
| `handleCloneLogs` | 81-85 | 5 | `export function handleCloneLogs(ctx) {` |
| `handleCloneAbort` | 88-91 | 4 | `export function handleCloneAbort() {` |
| `handleClonePreview` | 94-106 | 13 | `export async function handleClonePreview(ctx) {` |
| `handleCloneProgress` | 109-114 | 6 | `export function handleCloneProgress(ctx) {` |

### lib/app/handlers/meta.js（138 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `handleStatus` | 18-21 | 4 | `export function handleStatus(ctx) {` |
| `handleScan` | 24-27 | 4 | `export function handleScan(ctx) {` |
| `handleBrowse` | 30-34 | 5 | `export function handleBrowse(ctx) {` |
| `handleTools` | 37-39 | 3 | `export function handleTools() {` |
| `handleToolProbes` | 42-44 | 3 | `export function handleToolProbes() {` |
| `listRuleSlots` | 47-79 | 33 | `export function listRuleSlots(order, disabledSlots = [], hitStats = null) {` |
| `handleRuleSlots` | 82-85 | 4 | `export function handleRuleSlots(ctx) {` |
| `handleRuleDetail` | 88-111 | 24 | `export function handleRuleDetail(ctx) {` |
| `count` | 103-103 | 1 | `const count = (sev) => detail.filter((x) => x.severity === sev).length;` |
| `handleAudit` | 114-127 | 14 | `export async function handleAudit(ctx) {` |
| `handleToggleRule` | 130-138 | 9 | `export function handleToggleRule(ctx) {` |

### lib/app/handlers/repo-actions.js（131 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `handleRepoVisibility` | 16-36 | 21 | `export async function handleRepoVisibility(ctx) {` |
| `handleRepoPush` | 39-80 | 42 | `export async function handleRepoPush(ctx) {` |
| `handleRepoCommit` | 83-131 | 49 | `export async function handleRepoCommit(ctx) {` |

### lib/app/handlers/repos.js（222 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildLocalList` | 23-55 | 33 | `function buildLocalList(indexMap, root, deadline) {` |
| `applyLiveRemote` | 58-109 | 52 | `async function applyLiveRemote(list, deadline) {` |
| `handleReposLocal` | 112-133 | 22 | `export async function handleReposLocal(ctx) {` |
| `handleReposLocalScan` | 135-144 | 10 | `export function handleReposLocalScan(ctx) {` |
| `handleReposLocalScanWait` | 147-152 | 6 | `export async function handleReposLocalScanWait(ctx) {` |
| `handleReposLocalRefresh` | 155-195 | 41 | `export async function handleReposLocalRefresh(ctx) {` |
| `handleReposCloud` | 198-222 | 25 | `export async function handleReposCloud(ctx) {` |

### lib/app/handlers/settings.js（56 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `handleSettingsGet` | 13-19 | 7 | `export function handleSettingsGet(ctx) {` |
| `handleSettingsSet` | 22-56 | 35 | `export async function handleSettingsSet(ctx) {` |

### lib/app/http-handlers.js（122 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `adaptHttpHandler` | 37-54 | 18 | `export async function adaptHttpHandler(req, res, env, cfg) {` |
| `readBody` | 57-60 | 4 | `function readBody(req) {` |
| `buildCtx` | 63-65 | 3 | `function buildCtx(req, method, env, cfg, query, body, path) {` |
| `handleHttp` | 75-121 | 47 | `export async function handleHttp(req = {}, env = {}, cfg = defaultConfig()) {` |

### lib/app/inject-text.js（102 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildRequirementsInjectionText` | 57-66 | 10 | `export function buildRequirementsInjectionText() {` |
| `formatAuditBlock` | 74-101 | 28 | `export function formatAuditBlock(r = {}) {` |

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

### lib/app/settings-bridge.js（151 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `applySettingsToCfg` | 37-70 | 34 | `export function applySettingsToCfg(cfg, patch) {` |
| `setSettingsFileOverride` | 74-76 | 3 | `export function setSettingsFileOverride(path) {` |
| `settingsFilePath` | 79-82 | 4 | `export function settingsFilePath({ workspaceRoot = '' } = {}) {` |
| `settingsLogFilePath` | 90-93 | 4 | `export function settingsLogFilePath({ workspaceRoot = '' } = {}) {` |
| `appendSettingsLog` | 100-124 | 25 | `export function appendSettingsLog(entry, env = {}) {` |
| `readSettings` | 131-133 | 3 | `export function readSettings(env = {}) {` |
| `writeSettingsKey` | 142-151 | 10 | `export async function writeSettingsKey(key, jsonValue, env = {}) {` |

### lib/app/slash-commands.js（391 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `sessionCwdOf` | 25-28 | 4 | `export function sessionCwdOf(invocation) {` |
| `findGitRoot` | 41-51 | 11 | `export function findGitRoot(dir) {` |
| `resolveTargetPath` | 58-64 | 7 | `export function resolveTargetPath(rawPath, { sessionCwd = '' } = {}) {` |
| `parseCommandInput` | 74-90 | 17 | `export function parseCommandInput(raw = '', flags = [], usage = '') {` |
| `rejectRepo` | 93-95 | 3 | `function rejectRepo(usage, example, detail) {` |
| `parseGitAuditInput` | 105-109 | 5 | `export function parseGitAuditInput(raw = '') {` |
| `resolveAuditRepo` | 112-114 | 3 | `export function resolveAuditRepo(rawPath, opts) {` |
| `formatGitAuditCommandText` | 120-135 | 16 | `export function formatGitAuditCommandText(r = {}) {` |
| `runGitAuditCommand` | 138-162 | 25 | `export async function runGitAuditCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {` |
| `formatGitScanCommandText` | 170-187 | 18 | `export function formatGitScanCommandText(r = {}) {` |
| `runGitScanCommand` | 189-203 | 15 | `export async function runGitScanCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {` |
| `formatIoScanCommandText` | 214-241 | 28 | `export function formatIoScanCommandText(r = {}) {` |
| `runGitIoScanCommand` | 248-260 | 13 | `export async function runGitIoScanCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {` |
| `formatLinkCheckCommandText` | 268-279 | 12 | `export function formatLinkCheckCommandText(r = {}) {` |
| `runLinkCheckCommand` | 281-290 | 10 | `export async function runLinkCheckCommand({ rawInput = '', invocation = null, env = {}, cfg = {}, log = null } = {}) {` |
| `runGitAccountCommand` | 296-300 | 5 | `export async function runGitAccountCommand({ env = {}, cfg = {}, log = null } = {}) {` |
| `formatClonePreviewCommandText` | 310-332 | 23 | `export function formatClonePreviewCommandText(r = {}) {` |
| `runGitClonePreviewCommand` | 334-345 | 12 | `export async function runGitClonePreviewCommand({ rawInput = '', env = {}, cfg = {}, log = null } = {}) {` |
| `registerSlashCommands` | 366-390 | 25 | `export function registerSlashCommands(ctx, { env = {}, cfg = {}, log = null } = {}) {` |

### lib/app/slot-stats.js（36 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setLastSlotHitStats` | 20-25 | 6 | `export function setLastSlotHitStats(stats, repo = '') {` |
| `getLastSlotHitStats` | 28-30 | 3 | `export function getLastSlotHitStats() {` |
| `getLastSlotHitMeta` | 33-35 | 3 | `export function getLastSlotHitMeta() {` |

### lib/app/tool-call.js（340 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pushWithPostSteps` | 49-84 | 36 | `async function pushWithPostSteps(args, env, cfg) {` |
| `buildCommitPushJobSpec` | 87-103 | 17 | `function buildCommitPushJobSpec(repo, doPush) {` |
| `done` | 92-99 | 8 | `const done = (async () => {` |
| `callCommitPush` | 110-152 | 43 | `async function callCommitPush(args, env, cfg, log, jobs, exec) {` |
| `doPush` | 126-126 | 1 | `const doPush = () => pushWithPostSteps(args, env, cfg);` |
| `buildAuditOpts` | 163-172 | 10 | `function buildAuditOpts(args, cfg, scope) {` |
| `runHistoryAuditTool` | 178-205 | 28 | `async function runHistoryAuditTool(args, env, cfg, jobs, exec, weights) {` |
| `doHistory` | 184-187 | 4 | `const doHistory = async () => {` |
| `callCodeAudit` | 207-219 | 13 | `async function callCodeAudit(args, env, cfg, log, jobs, exec) {` |
| `runStandardAuditTool` | 222-238 | 17 | `async function runStandardAuditTool(args, env, cfg, log, weights) {` |
| `callTool` | 240-332 | 93 | `export async function callTool(toolName, args = {}, env = {}, cfg = defaultConfig(), log = null, jobs = null, exec = null) {` |
| `readTextSafe` | 335-339 | 5 | `function readTextSafe(path = '') {` |

### lib/app/tools.js（140 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `listTools` | 137-139 | 3 | `export function listTools() {` |

### lib/ast/brace.js（105 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `matchBrace` | 12-24 | 13 | `export function matchBrace(tokens, openIdx) {` |
| `matchPairBack` | 36-45 | 10 | `export function matchPairBack(tokens, closeIdx, openPunct, closePunct) {` |
| `isBlockParen` | 55-67 | 13 | `export function isBlockParen(tokens, closeTok) {` |
| `matchingOpen` | 70-72 | 3 | `export function matchingOpen(tokens, closeIdx) {` |
| `collectInnerFnRanges` | 90-105 | 16 | `export function collectInnerFnRanges(tokens, from, to) {` |

### lib/ast/callgraph.js（126 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildCallGraph` | 23-42 | 20 | `export function buildCallGraph(text) {` |
| `isInRequestPath` | 52-68 | 17 | `export function isInRequestPath(fnName, graph, isRequestName) {` |
| `collectNamedFnRanges` | 71-126 | 56 | `export function collectNamedFnRanges(tokens) {` |
| `matchBraceIdx` | 116-126 | 11 | `function matchBraceIdx(tokens, openIdx) {` |

### lib/ast/code-lines.js（115 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeCodeLineFilter` | 24-47 | 24 | `export function makeCodeLineFilter(text = '', candidateLines = [], opts = {}) {` |
| `isProseDoc` | 61-63 | 3 | `function isProseDoc(text, file) {` |
| `makeProseCodeFilter` | 77-100 | 24 | `function makeProseCodeFilter(text, candidateLines) {` |
| `codeStringLiterals` | 107-114 | 8 | `export function codeStringLiterals(text = '') {` |

### lib/ast/control-flow.js（285 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectNamedSyncFs` | 25-56 | 32 | `function collectNamedSyncFs(tokens) {` |
| `collectAsyncRanges` | 59-77 | 19 | `function collectAsyncRanges(tokens) {` |
| `scanSyncCalls` | 80-106 | 27 | `function scanSyncCalls(tokens, namedSync, asyncRanges) {` |
| `checkSyncFs` | 109-114 | 6 | `export function checkSyncFs(text = '') {` |
| `checkEmptyCatchAst` | 121-162 | 42 | `export function checkEmptyCatchAst(text = '') {` |
| `checkComplexityAst` | 164-285 | 122 | `export function checkComplexityAst(text = '', { warn = 10, block = 20 } = {}) {` |
| `inInner` | 184-184 | 1 | `const inInner = (k) => innerRanges.some(([a, b]) => k >= a && k < b);` |
| `checkNestingDepthAst` | 221-285 | 65 | `export function checkNestingDepthAst(text = '', { warn = 4, block = 6 } = {}) {` |

### lib/ast/credential.js（188 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isPlaceholderText` | 40-42 | 3 | `function isPlaceholderText(text) {` |
| `stripQuotes` | 70-72 | 3 | `function stripQuotes(raw) {` |
| `isMeaningfulCredentialValue` | 80-87 | 8 | `export function isMeaningfulCredentialValue(raw) {` |
| `checkPlaceholderCredentialAst` | 111-123 | 13 | `export function checkPlaceholderCredentialAst(text = '') {` |
| `scanCredentialTokens` | 135-169 | 35 | `function scanCredentialTokens(tokens, out, lineOffset = 0) {` |
| `checkCredentialRefAst` | 171-187 | 17 | `export function checkCredentialRefAst(text = '') {` |

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

### lib/ast/magic-number.js（169 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkMagicNumberSmartAst` | 48-111 | 64 | `export function checkMagicNumberSmartAst(text = '', {` |
| `hintTest` | 52-55 | 4 | `const hintTest = (hints) => {` |
| `isNamedConstantValue` | 121-168 | 48 | `function isNamedConstantValue(tokens, numIdx) {` |

### lib/ast/naming.js（152 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkNameLengthAst` | 16-58 | 43 | `export function checkNameLengthAst(text = '', { min = 2, allow = [] } = {}) {` |
| `checkShortFunctionNameAst` | 72-87 | 16 | `export function checkShortFunctionNameAst(text = '', { max = 2, allow = [] } = {}) {` |
| `checkSmallFileReadAst` | 103-126 | 24 | `export function checkSmallFileReadAst(text = '') {` |
| `checkConsoleLogJsonAst` | 135-151 | 17 | `export function checkConsoleLogJsonAst(text = '') {` |

### lib/ast/scope.js（213 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectFnLineRanges` | 19-35 | 17 | `export function collectFnLineRanges(text) {` |
| `collectLoopLineRanges` | 38-57 | 20 | `export function collectLoopLineRanges(text) {` |
| `braceCloseIdx` | 60-70 | 11 | `function braceCloseIdx(tokens, openIdx) {` |
| `classifyFunctionPath` | 78-81 | 4 | `export function classifyFunctionPath(fnName = '') {` |
| `classifyLineScope` | 88-92 | 5 | `export function classifyLineScope(text, line) {` |
| `isModuleConstAssignment` | 101-125 | 25 | `export function isModuleConstAssignment(text, line) {` |
| `analyzeFunctionalScope` | 134-172 | 39 | `export function analyzeFunctionalScope(text = '') {` |

### lib/ast/shell.js（132 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `shellCdDynamicLines` | 22-45 | 24 | `export function shellCdDynamicLines(text) {` |
| `parseGitignore` | 50-76 | 27 | `function parseGitignore(text) {` |
| `isIgnored` | 79-85 | 7 | `function isIgnored(target, patterns) {` |
| `extractWriteTarget` | 88-94 | 7 | `function extractWriteTarget(line) {` |
| `writeIntoGitignoredLines` | 106-131 | 26 | `export function writeIntoGitignoredLines(text, repoPath = '') {` |

### lib/ast/size.js（245 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `funcNameAt` | 27-41 | 15 | `function funcNameAt(tokens, i) {` |
| `funcRangesAst` | 43-245 | 203 | `export function funcRangesAst(text = '') {` |
| `countCommentLinesInRange` | 75-88 | 14 | `export function countCommentLinesInRange(tokens, startLine = 1, endLine = Infinity) {` |
| `checkFuncLinesAst` | 98-245 | 148 | `export function checkFuncLinesAst(text = '', { warn = FUNC_LINES_WARN, block = FUNC_LINES_BLOCK } = {}) {` |
| `checkFuncDensityAst` | 150-171 | 22 | `export function checkFuncDensityAst(text = '', { threshold = FUNC_LINES_WARN, blockThreshold = FUNC_LINES_BLOCK, skipLines = new Set() } = {}) {` |
| `countCommentLines` | 179-192 | 14 | `export function countCommentLines(text = '') {` |
| `checkFileLines` | 203-209 | 7 | `export function checkFileLines(text = '', { warn = 500, block = 1000, excludeComments = true } = {}) {` |
| `checkRepeatedStringsAst` | 219-244 | 26 | `export function checkRepeatedStringsAst(text = '', { min = 3, ignore = [] } = {}) {` |

### lib/ast/tokenizer.js（213 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `tokenize` | 39-56 | 18 | `export function tokenize(text = '') {` |
| `clearTokenCache` | 59-61 | 3 | `export function clearTokenCache() {` |
| `tokenizeUncached` | 68-210 | 143 | `function tokenizeUncached(text = '') {` |

### lib/audit/audit-file.js（74 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditFile` | 13-74 | 62 | `export function auditFile({ file, relPath, text, grouped }, opts = {}) {` |

### lib/audit/collector.js（376 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isGitWorkTree` | 47-58 | 12 | `function isGitWorkTree(dir) {` |
| `tryLoadAuditIgnoreFallback` | 74-99 | 26 | `function tryLoadAuditIgnoreFallback(root) {` |
| `walkDirs` | 85-96 | 12 | `const walkDirs = (dir) => {` |
| `tryLoadGitIgnoreSet` | 111-185 | 75 | `function tryLoadGitIgnoreSet(root) {` |
| `walkDirs` | 143-155 | 13 | `const walkDirs = (dir) => {` |
| `collectTextFiles` | 193-299 | 107 | `export async function collectTextFiles(dir, { depth = 10, gitIgnoreRoot = null, includeIgnored = false, testExemptRoot = null } = {}) {` |
| `relOf` | 207-207 | 1 | `const relOf = (full) => relative(gitIgnoreRoot, full).replace(/\\/g, '/');` |
| `walk` | 240-298 | 59 | `async function walk(cur, level) {` |
| `isGitRepo` | 302-304 | 3 | `export function isGitRepo(dir) {` |
| `collectChangedFiles` | 312-350 | 39 | `export function collectChangedFiles(repoPath) {` |
| `isTextFile` | 353-371 | 19 | `export function isTextFile(full) {` |
| `readText` | 374-376 | 3 | `export function readText(full) {` |

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

### lib/audit/orchestrate.js（331 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `capScanFiles` | 36-46 | 11 | `export function capScanFiles(files, root, maxFiles) {` |
| `appendIgnoreBlindSpot` | 59-75 | 17 | `function appendIgnoreBlindSpot(findings, repoPath, scanned) {` |
| `auditFiles` | 87-179 | 93 | `async function auditFiles(repoPath, files, opts = {}) {` |
| `auditFull` | 181-199 | 19 | `export async function auditFull(repoPath, opts = {}) {` |
| `appendTreeDocDrift` | 204-246 | 43 | `function appendTreeDocDrift(findings, repoPath) {` |
| `by` | 237-237 | 1 | `const by = (code) => wt.filter(([, v]) => v?.status === code).length;` |
| `appendSplitDocsCheck` | 254-285 | 32 | `function appendSplitDocsCheck(findings, repoPath) {` |
| `hasMarkBlock` | 288-290 | 3 | `function hasMarkBlock(text, marker) {` |
| `auditChanged` | 295-325 | 31 | `export async function auditChanged(repoPath, opts = {}) {` |
| `isAuditIgnored` | 311-319 | 9 | `const isAuditIgnored = (rel) => {` |
| `auditWithScope` | 328-330 | 3 | `export async function auditWithScope(repoPath, { scope = 'diff', ...opts } = {}) {` |

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

### lib/checks/common.js（152 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `capSeverity` | 27-33 | 7 | `export function capSeverity(ruleSeverity, internalLevel) {` |
| `groupByKind` | 36-42 | 7 | `export function groupByKind(compiled) {` |
| `smartHitLines` | 51-54 | 4 | `export function smartHitLines(text) {` |
| `smallFileReadLines` | 64-68 | 5 | `export function smallFileReadLines(text) {` |
| `consoleLogJsonLines` | 76-78 | 3 | `export function consoleLogJsonLines(text) {` |
| `shortFuncNameLines` | 86-88 | 3 | `export function shortFuncNameLines(text) {` |
| `placeholderCredentialLines` | 99-101 | 3 | `export function placeholderCredentialLines(text) {` |
| `credentialValueLines` | 103-105 | 3 | `export function credentialValueLines(text) {` |
| `ioRiskLines` | 119-121 | 3 | `export function ioRiskLines(text) {` |
| `ioRiskDetail` | 129-137 | 9 | `export function ioRiskDetail(text) {` |
| `shellCdDynamicLines` | 139-141 | 3 | `export function shellCdDynamicLines(text) {` |
| `writeIntoGitignoredLines` | 148-150 | 3 | `export function writeIntoGitignoredLines(text, repoPath) {` |

### lib/checks/credential-file.js（44 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkCredentialFiles` | 13-43 | 31 | `export function checkCredentialFiles({ file, relPath, rules }) {` |

### lib/checks/dataflow.js（41 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkDataflow` | 25-40 | 16 | `export function checkDataflow({ file, text, rules }) {` |

### lib/checks/dispatch.js（80 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runChecks` | 30-79 | 50 | `export function runChecks({ file, relPath, text, grouped }, opts = {}) {` |

### lib/checks/dup-code.js（70 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkDuplicateCode` | 28-69 | 42 | `export function checkDuplicateCode(fileTexts = [], rules = null) {` |

### lib/checks/file-health.js（106 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFileHealth` | 35-105 | 71 | `export function checkFileHealth({ file, relPath, text, rules }) {` |
| `levelOf` | 56-59 | 4 | `const levelOf = (val, levels) => {` |

### lib/checks/filter.js（107 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `filterRulesByExt` | 32-44 | 13 | `export function filterRulesByExt(grouped, relPath) {` |
| `filterRulesByPath` | 52-69 | 18 | `export function filterRulesByPath(grouped, relPath) {` |
| `norm` | 60-60 | 1 | `const norm = (s) => String(s \|\| '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');` |
| `filterRulesByFileText` | 87-106 | 20 | `export function filterRulesByFileText(grouped, text) {` |

### lib/checks/folder.js（146 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFolderRules` | 22-145 | 124 | `export function checkFolderRules({ root, rules, gitignoreText = '' }) {` |
| `isIgnored` | 120-120 | 1 | `const isIgnored = (p) => lines.some((l) => l === p \|\| l === p.replace(/^\*/, '') \|\| l.replace(/\/$/, '') === p);` |

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

### lib/checks/regex.js（203 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkRegexRules` | 22-125 | 104 | `export function checkRegexRules({ file, text, rules, source = '新增行', repoPath = '' }) {` |
| `checkPathRegexRules` | 128-144 | 17 | `export function checkPathRegexRules({ file, relPath, rules }) {` |
| `checkBlacklist` | 154-202 | 49 | `export function checkBlacklist({ file, text, rules }) {` |

### lib/checks/semantic.js（135 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkSemantic` | 35-59 | 25 | `export function checkSemantic({ file, relPath, rules, repoLevelRules }) {` |
| `isRepoLevelSemanticRule` | 69-78 | 10 | `export function isRepoLevelSemanticRule(rule) {` |
| `checkPatchInsert` | 93-134 | 42 | `export function checkPatchInsert({ file, text, rules }) {` |

### lib/checks/structural.js（201 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFuncLines` | 20-64 | 45 | `export function checkFuncLines({ file, text, rules }) {` |
| `checkSyncFsInFile` | 67-80 | 14 | `export function checkSyncFsInFile({ file, text }) {` |
| `checkEmptyCatch` | 83-96 | 14 | `export function checkEmptyCatch({ file, text }) {` |
| `checkMinLength` | 99-114 | 16 | `export function checkMinLength({ file, text, rules }) {` |
| `checkComplexity` | 117-136 | 20 | `export function checkComplexity({ file, text, rules }) {` |
| `checkDepth` | 139-155 | 17 | `export function checkDepth({ file, text, rules }) {` |
| `checkMaxLines` | 158-173 | 16 | `export function checkMaxLines({ file, text, rules }) {` |
| `checkRepeated` | 176-200 | 25 | `export function checkRepeated({ file, text, rules }) {` |

### lib/cli/commands-account.mjs（108 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `cmdAccountCheck` | 23-30 | 8 | `export async function cmdAccountCheck(flags) {` |
| `cmdCredEnv` | 33-47 | 15 | `export async function cmdCredEnv(flags) {` |
| `cmdRemoteCreate` | 50-65 | 16 | `export async function cmdRemoteCreate(repo, flags) {` |
| `cmdSetVisibility` | 68-82 | 15 | `export async function cmdSetVisibility(repo, flags) {` |
| `cmdGenSshKey` | 85-96 | 12 | `export async function cmdGenSshKey(flags) {` |
| `resolveRepoOwnerName` | 99-107 | 9 | `async function resolveRepoOwnerName(repoPath) {` |

### lib/cli/commands-audit.mjs（140 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `cliPluginConfig` | 26-35 | 10 | `export function cliPluginConfig() {` |
| `pluginEqualAuditOpts` | 42-52 | 11 | `export function pluginEqualAuditOpts(cfg, flags, { scope = 'diff' } = {}) {` |
| `pluginEqualWeights` | 55-59 | 5 | `export function pluginEqualWeights(cfg, flags) {` |
| `pathExists` | 62-64 | 3 | `async function pathExists(p) {` |
| `cmdAudit` | 67-71 | 5 | `export async function cmdAudit(root, flags) {` |
| `runHistoryAuditCmd` | 74-89 | 16 | `async function runHistoryAuditCmd(root, flags) {` |
| `runStandardAudit` | 92-104 | 13 | `async function runStandardAudit(root, flags) {` |
| `printAuditResult` | 107-123 | 17 | `function printAuditResult(root, auditResult, opts, weights, quality) {` |
| `cmdScan` | 131-139 | 9 | `export async function cmdScan(root, flags) {` |

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

### lib/client.js（2516 行 · 48 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `dshgp_ensureCss` | 230-238 | 9 | `function dshgp_ensureCss() {` |
| `dshgp_getJson` | 241-244 | 4 | `async function dshgp_getJson(url) {` |
| `dshgp_postJson` | 246-255 | 10 | `async function dshgp_postJson(url, payload, timeoutMs) {` |
| `dshgp_tokenConfigured` | 263-267 | 5 | `function dshgp_tokenConfigured(value) {` |
| `dshgp_localGet` | 274-276 | 3 | `function dshgp_localGet(key) {` |
| `dshgp_localSet` | 279-281 | 3 | `function dshgp_localSet(key, value) {` |
| `dshgp_copyText` | 284-289 | 6 | `function dshgp_copyText(text) {` |
| `dshgp_AcctHead` | 305-319 | 15 | `function dshgp_AcctHead(props) {` |
| `dshgp_AccountCard` | 322-408 | 87 | `function dshgp_AccountCard(props) {` |
| `toLocal` | 335-340 | 6 | `const toLocal = (iso) => {` |
| `credPill` | 342-368 | 27 | `const credPill = (configured, st) => {` |
| `dshgp_AccountTab` | 411-426 | 16 | `function dshgp_AccountTab(props) {` |
| `dshgp_browseEnsureDom` | 433-461 | 29 | `function dshgp_browseEnsureDom() {` |
| `dshgp_browseGuess` | 462-464 | 3 | `function dshgp_browseGuess() {` |
| `dshgp_browseRemember` | 465-467 | 3 | `function dshgp_browseRemember(p) {` |
| `dshgp_browseLoad` | 468-493 | 26 | `async function dshgp_browseLoad(p) {` |
| `dshgp_browseOpen` | 494-502 | 9 | `function dshgp_browseOpen(input, onPick) {` |
| `dshgp_browseClose` | 503-509 | 7 | `function dshgp_browseClose() {` |
| `dshgp_browseAttach` | 510-520 | 11 | `function dshgp_browseAttach(inputEl) {` |
| `dshgp_RepoManagerCard` | 524-554 | 31 | `function dshgp_RepoManagerCard(props) {` |
| `dshgp_RepoLocalRow` | 557-633 | 77 | `function dshgp_RepoLocalRow(props) {` |
| `dshgp_RepoLocalPane` | 636-673 | 38 | `function dshgp_RepoLocalPane(props) {` |
| `dshgp_RepoCloudRow` | 676-720 | 45 | `function dshgp_RepoCloudRow(props) {` |
| `dshgp_VisConfirmDialog` | 726-754 | 29 | `function dshgp_VisConfirmDialog(props) {` |
| `dshgp_RepoCloudPane` | 757-808 | 52 | `function dshgp_RepoCloudPane(props) {` |
| `dshgp_CloneProgress` | 819-836 | 18 | `function dshgp_CloneProgress(props) {` |
| `mb` | 821-821 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |
| `dshgp_ClonePreview` | 844-869 | 26 | `function dshgp_ClonePreview(props) {` |
| `mb` | 846-846 | 1 | `const mb = (n) => (n / 1024 / 1024).toFixed(1);` |
| `dshgp_WeightRows` | 873-896 | 24 | `function dshgp_WeightRows(props) {` |
| `dshgp_RuleRow` | 907-969 | 63 | `function dshgp_RuleRow(props, slot, idx, len) {` |
| `countTitle` | 916-919 | 4 | `const countTitle = (kind) => {` |
| `move` | 924-924 | 1 | `const move = (dir) => props.moveSlot(slot, dir);` |
| `dshgp_AuditSwitchBlock` | 972-1036 | 65 | `function dshgp_AuditSwitchBlock(props) {` |
| `dshgp_InjectPromptSwitchBlock` | 1039-1061 | 23 | `function dshgp_InjectPromptSwitchBlock(props) {` |
| `dshgp_CommentWordingBlock` | 1064-1079 | 16 | `function dshgp_CommentWordingBlock(props) {` |
| `dshgp_AuditAdvancedBlock` | 1082-1108 | 27 | `function dshgp_AuditAdvancedBlock(props) {` |
| `dshgp_RuleListBlock` | 1111-1142 | 32 | `function dshgp_RuleListBlock(props) {` |
| `dshgp_AuditTab` | 1149-1169 | 21 | `function dshgp_AuditTab(props) {` |
| `dshgp_CredentialBlock` | 1173-1238 | 66 | `function dshgp_CredentialBlock(props) {` |
| `dshgp_PushDefaultsBlock` | 1241-1303 | 63 | `function dshgp_PushDefaultsBlock(props) {` |
| `dshgp_SettingsTab` | 1305-1314 | 10 | `function dshgp_SettingsTab(props) {` |
| `dshgp_GitPushPage` | 1317-1370 | 54 | `function dshgp_GitPushPage(props) {` |
| `renderResult` | 2111-2124 | 14 | `const renderResult = (res) => {` |
| `poll` | 2127-2152 | 26 | `const poll = async () => {` |
| `apply` | 2476-2509 | 34 | `function apply(ctx) {` |
| `useCardState` | 2490-2493 | 4 | `const useCardState = (selector) => {` |
| `SectionPage` | 2496-2501 | 6 | `function SectionPage() {` |

### lib/client/index.js（162 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `defaultConfig` | 54-58 | 5 | `export function defaultConfig() {` |
| `resolveConfig` | 66-78 | 13 | `export function resolveConfig(patch = {}, base = defaultConfig()) {` |
| `createSettingsCard` | 86-128 | 43 | `export function createSettingsCard(react, { config = defaultConfig(), onChange = () => {}, labels = {} } = {}) {` |
| `collectExternalRefs` | 136-141 | 6 | `export function collectExternalRefs(css = '') {` |
| `clientModuleInfo` | 151-162 | 12 | `export function clientModuleInfo() {` |

### lib/commit-push.js（112 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runAudit` | 26-66 | 41 | `export async function runAudit({ repoPath = '', audit, rulesetDir, slots, cfg: extCfg } = {}) {` |
| `commitWithAudit` | 76-98 | 23 | `export async function commitWithAudit({` |
| `commitMany` | 106-112 | 7 | `export async function commitMany({ repos = [], message = '', push = true, dryRun = false, requirementsConfirmed = false, customIgnorePatterns = '' } = {}) {` |

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

### lib/exempt/index.js（231 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hasHeaderExempt` | 77-81 | 5 | `export function hasHeaderExempt(text, marker) {` |
| `hasLineExempt` | 84-86 | 3 | `export function hasLineExempt(line, marker) {` |
| `isCategoryExempt` | 104-112 | 9 | `export function isCategoryExempt(finding = {}) {` |
| `exemptForFinding` | 123-157 | 35 | `export function exemptForFinding(finding, text = '') {` |
| `exemptHintFor` | 160-165 | 6 | `export function exemptHintFor(ruleOrKind) {` |
| `isSampleExemptDir` | 176-198 | 23 | `export function isSampleExemptDir(repoPath, relPath = '') {` |
| `isTestExemptDir` | 208-230 | 23 | `export function isTestExemptDir(repoPath, relPath = '') {` |

### lib/fsx.js（88 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `copyFileCompat` | 30-48 | 19 | `export function copyFileCompat(from, to, opts = {}) {` |
| `chmodBestEffort` | 56-63 | 8 | `export function chmodBestEffort(fn, mode) {` |
| `supportsMetadata` | 75-87 | 13 | `export function supportsMetadata(dirPath) {` |

### lib/git/account-status.js（107 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `accountStatusFile` | 25-27 | 3 | `export function accountStatusFile({ workspaceRoot = '' } = {}) {` |
| `readAccountStatus` | 33-39 | 7 | `export function readAccountStatus({ workspaceRoot = '' } = {}) {` |
| `writeAccountStatus` | 44-57 | 14 | `export function writeAccountStatus(status, { workspaceRoot = '' } = {}) {` |
| `buildAccountStatus` | 63-75 | 13 | `export function buildAccountStatus(result = {}) {` |
| `writeAccountStatusFromResult` | 89-92 | 4 | `export function writeAccountStatusFromResult(result, { workspaceRoot = '' } = {}) {` |
| `refreshAccountStatus` | 100-107 | 8 | `export async function refreshAccountStatus({ workspaceRoot = '', token = '' } = {}) {` |

### lib/git/account.js（179 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `testSshAuth` | 26-48 | 23 | `export function testSshAuth({ workspaceRoot = '' } = {}) {` |
| `checkGithubAccount` | 56-141 | 86 | `export async function checkGithubAccount({ workspaceRoot = '', token = '', checkSsh = true } = {}) {` |
| `formatGithubAccountBlock` | 144-179 | 36 | `export function formatGithubAccountBlock(r = {}) {` |
| `fmtAt` | 151-156 | 6 | `const fmtAt = (iso) => {` |
| `line` | 157-165 | 9 | `const line = (label, present, item, masked) => {` |

### lib/git/api.js（101 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `githubFetch` | 19-57 | 39 | `export async function githubFetch(path, { token = '', method = 'GET', body, timeout = 60_000, headers: extraHeaders } = {}) {` |
| `parseGithubOwnerRepo` | 60-74 | 15 | `export function parseGithubOwnerRepo(originUrl) {` |
| `isBadCredentials` | 77-79 | 3 | `export function isBadCredentials(reason = '') {` |
| `detectRepoVisibility` | 86-100 | 15 | `export async function detectRepoVisibility({ repoPath = '', token = '' } = {}) {` |

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

### lib/git/clone-download.js（309 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `partitionBySize` | 54-65 | 12 | `export function partitionBySize(blobs = [], maxFileMB = DEFAULT_MAX_FILE_MB) {` |
| `downloadBlobs` | 82-159 | 78 | `export async function downloadBlobs(o) {` |
| `one` | 106-138 | 33 | `const one = async (entry) => {` |
| `worker` | 141-148 | 8 | `const worker = async () => {` |
| `fetchBlobJson` | 164-179 | 16 | `async function fetchBlobJson(owner, repo, sha, token) {` |
| `removeDirForce` | 205-224 | 20 | `export async function removeDirForce(dir, attempts = 3) {` |
| `fetchToFile` | 226-308 | 83 | `async function fetchToFile({ owner, repo, branch, relPath, token, out, partPath, size, onBytes, signal = null }) {` |
| `mkHeaders` | 260-267 | 8 | `const mkHeaders = (raw, withRange) => {` |

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

### lib/git/clone.js（364 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isPartialCloneDir` | 47-54 | 8 | `export function isPartialCloneDir(dir) {` |
| `enclosingGitRoot` | 71-89 | 19 | `export function enclosingGitRoot(dir) {` |
| `cloneViaApi` | 98-262 | 165 | `export async function cloneViaApi({` |
| `cleanupPartial` | 275-279 | 5 | `async function cleanupPartial(dir) {` |
| `classifyCloneFailure` | 293-306 | 14 | `export function classifyCloneFailure(failed = []) {` |
| `previewClone` | 334-363 | 30 | `export async function previewClone({ target = '', token = '', branch = '', maxFileMB = DEFAULT_MAX_FILE_MB } = {}) {` |

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

### lib/git/exec.js（79 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runGit` | 17-32 | 16 | `export function runGit(args, { cwd = '', timeoutMs = 120_000, env = {} } = {}) {` |
| `gitRaw` | 40-54 | 15 | `export function gitRaw(args, { cwd = '', timeoutMs = 600_000 } = {}) {` |
| `runGitAsync` | 64-78 | 15 | `export function runGitAsync(args, { cwd = '', timeoutMs = 120_000, env = {} } = {}) {` |

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

### lib/git/push.js（274 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `commitAndPush` | 26-139 | 114 | `export async function commitAndPush({ repoPath = '', message = '', push = true, dryRun = false, token = '', customIgnorePatterns = '', requirementsConfirmed = false, force = false, pushMethod = 'ssh', pushGate = false, pushConfirmed = false, paths = '' } = {}) {` |
| `fetchRemoteBranchRef` | 152-165 | 14 | `async function fetchRemoteBranchRef(repoPath, branch, owner, repo) {` |
| `enhanceAfterPushSuccess` | 173-203 | 31 | `async function enhanceAfterPushSuccess({ repoPath, pr, token, steps, commitSha }) {` |
| `readmeCheckHint` | 208-213 | 6 | `export function readmeCheckHint(repoPath) {` |
| `pushCurrentBranch` | 222-273 | 52 | `export async function pushCurrentBranch({ repoPath = '', pushMethod = 'ssh' } = {}) {` |

### lib/git/remote.js（74 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ensureRemoteRepo` | 17-44 | 28 | `export async function ensureRemoteRepo({ repoPath = '', owner = '', visibility = 'private', dryRun = false, token = '' } = {}) {` |
| `parseOwnerRepoFromRemote` | 47-54 | 8 | `export function parseOwnerRepoFromRemote(remoteUrl) {` |
| `setVisibility` | 57-73 | 17 | `export async function setVisibility({ owner = '', repo = '', visibility = '', token = '', repoPath = '' } = {}) {` |

### lib/git/repo-index.js（508 行 · 19 个函数）

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
| `buildRepoIndexVisibility` | 176-191 | 16 | `async function buildRepoIndexVisibility({ repos, token, manualVisibility, owner }) {` |
| `buildRepoIndexLocalOnly` | 194-207 | 14 | `async function buildRepoIndexLocalOnly({ workspaceRoot, repos, localOnlyExtra }) {` |
| `buildRepoIndex` | 214-259 | 46 | `export async function buildRepoIndex({ workspaceRoot, depth = 20, extraRepos = [], extraReposFile = '', token = '', manualVisibility = {}, localOnlyExtra = [], owner = 'EIGHTfs', offline = false, maxRepos = 200 } = {}) {` |
| `repoList` | 231-238 | 8 | `const repoList = (await Promise.all(ownedRepos.map(async (r) => {` |
| `syncRepoIndex` | 265-284 | 20 | `export function syncRepoIndex({ content, workspaceRoot = '', owner = 'EIGHTfs', syncTarget = '' } = {}) {` |
| `mergeFreshIntoExisting` | 299-342 | 44 | `function mergeFreshIntoExisting(existing, freshContent) {` |
| `updateRepoIndex` | 359-386 | 28 | `export async function updateRepoIndex({ workspaceRoot = '', token = '', owner = 'EIGHTfs', depth = 20, extraRepos = [], extraReposFile = '', syncTarget = '', offline = false, maxRepos = 200, mode = 'rebuild', cloudRepos = [], repoName = '', remoteState = {} } = {}) {` |
| `maintainRepoIndex` | 393-396 | 4 | `export async function maintainRepoIndex({ workspaceRoot = '', token = '', owner = 'EIGHTfs', depth = 20, extraRepos = [], extraReposFile = '', syncTarget = '', offline = false, maxRepos = 200 } = {}) {` |
| `mergeCloudReposIntoIndex` | 411-464 | 54 | `export function mergeCloudReposIntoIndex({ workspaceRoot = '', owner = 'EIGHTfs', cloudRepos = [], syncTarget = '' } = {}) {` |
| `updateRepoRemoteStateInIndex` | 481-507 | 27 | `export function updateRepoRemoteStateInIndex({ workspaceRoot = '', repoName = '', remoteState = {}, syncTarget = '' } = {}) {` |

### lib/git/repos.js（144 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `scanRepos` | 28-98 | 71 | `export function scanRepos(root = '.', { depth = DEFAULT_SCAN_DEPTH, extraRepos = [], extraReposFile = '', maxRepos = 200 } = {}) {` |
| `loadIgnoredDirs` | 37-51 | 15 | `const loadIgnoredDirs = (repoRoot) => {` |
| `isIgnored` | 53-61 | 9 | `const isIgnored = (abs) => {` |
| `walk` | 62-79 | 18 | `const walk = (dir, level) => {` |
| `maskRemoteUrl` | 104-113 | 10 | `export function maskRemoteUrl(url = '') {` |
| `describeRepo` | 119-143 | 25 | `export function describeRepo(repoPath = '') {` |

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

### lib/git/sensitive.js（121 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `escapeRegExp` | 43-45 | 3 | `function escapeRegExp(s) {` |
| `sensitiveLineMatch` | 48-67 | 20 | `function sensitiveLineMatch(line) {` |
| `scanSensitiveFiles` | 75-120 | 46 | `export async function scanSensitiveFiles(repoPath) {` |
| `walk` | 79-117 | 39 | `const walk = async (dir, rel) => {` |

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

### lib/git/wrapped-git.js（37 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildWrappedGitEnv` | 14-26 | 13 | `export function buildWrappedGitEnv({ workspaceRoot = '' } = {}) {` |
| `runWrappedGit` | 29-37 | 9 | `export function runWrappedGit(args = [], { workspaceRoot = '' } = {}) {` |

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

### lib/plugin/auto-push.js（153 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `registerAutoPush` | 40-153 | 114 | `export function registerAutoPush(ctx, { cfg = {}, onPushAfterCommit } = {}) {` |
| `schedule` | 54-67 | 14 | `function schedule(session, event) {` |
| `runCheck` | 69-86 | 18 | `async function runCheck(session, turn) {` |
| `resolveTargets` | 89-104 | 16 | `function resolveTargets(session) {` |
| `gateCommit` | 107-117 | 11 | `async function gateCommit(repoPath) {` |
| `runAutoPush` | 119-139 | 21 | `async function runAutoPush(session, turn, log2) {` |

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

### lib/rule/registry.js（100 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `registerCompiler` | 18-20 | 3 | `export function registerCompiler(kind, detect, compile) {` |
| `compileRule` | 28-56 | 29 | `export function compileRule(rule, ctx = {}) {` |
| `withSlot` | 43-46 | 4 | `const withSlot = (res) => {` |
| `compileAllRules` | 59-67 | 9 | `export function compileAllRules(rules, ctx = {}) {` |
| `withRuleScope` | 84-100 | 17 | `function withRuleScope(compiled, source) {` |

### lib/rule/scope.js（62 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `normalizeScopeRules` | 30-39 | 10 | `export function normalizeScopeRules(rule) {` |
| `resolveScopeAction` | 47-62 | 16 | `export function resolveScopeAction(scopeRules, scopeInfo = {}) {` |

### lib/score/docs-score.js（126 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectDocFiles` | 45-69 | 25 | `export function collectDocFiles(root = '.') {` |
| `walk` | 54-63 | 10 | `const walk = (dir) => {` |
| `checkDocsScore` | 84-126 | 43 | `export function checkDocsScore(root = '.') {` |

### lib/score/index.js（131 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countByDimension` | 42-72 | 31 | `export function countByDimension(findings = []) {` |
| `scoreQuality` | 89-131 | 43 | `export function scoreQuality(findings = [], weights = {}, context = {}) {` |

### lib/self/index.js（149 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readmeTemplate` | 29-94 | 66 | `export function readmeTemplate({ name = 'dsh-git-push', description = 'DSH git 自动提交推送插件——统一函数入口架构', version = VERSION, versionTable = '' } = {}) {` |
| `yamlTemplate` | 97-109 | 13 | `export function yamlTemplate() {` |
| `selfVersion` | 112-114 | 3 | `export function selfVersion() {` |
| `versionInfo` | 121-133 | 13 | `export function versionInfo(pkgJson = '') {` |
| `helpSync` | 142-148 | 7 | `export function helpSync(helpText = '', knownFlags = []) {` |

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

### scripts/audit-runtime-check.mjs（130 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseArgs` | 35-45 | 11 | `function parseArgs() {` |
| `collectJs` | 48-54 | 7 | `function collectJs(dir) {` |
| `runFile` | 60-98 | 39 | `async function runFile(file, obj) {` |
| `main` | 101-127 | 27 | `async function main() {` |

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

### scripts/doc-tree.mjs（453 行 · 20 个函数）

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
| `syncIndex` | 166-208 | 43 | `export function syncIndex({ write = true, files = gitLsFiles(), map = loadMapping(), root = ROOT } = {}) {` |
| `buildGroups` | 213-229 | 17 | `function buildGroups(files) {` |
| `groupLines` | 232-258 | 27 | `function groupLines(name, paths, map, prefix = '') {` |
| `note` | 246-246 | 1 | `const note = (p) => (map[p] ? map[p] : '（待注释）');` |
| `buildTreeText` | 261-273 | 13 | `export function buildTreeText(files = gitLsFiles(), map = loadMapping(), rootLabel = basename(ROOT)) {` |
| `findBlock` | 278-285 | 8 | `function findBlock(text, marker = 'dshgp-tree') {` |
| `readReadme` | 287-290 | 4 | `function readReadme(path) {` |
| `applyBlock` | 292-296 | 5 | `function applyBlock(text, newTree) {` |
| `checkDrift` | 300-378 | 79 | `export function checkDrift({ readmePath = DEFAULT_README, root = ROOT } = {}) {` |
| `isToolGenerated` | 349-349 | 1 | `const isToolGenerated = (p) => p === 'functions-index.json' \|\| p === '_meta'` |
| `filesOf` | 397-397 | 1 | `const filesOf = (r) => gitLsFiles(r);` |
| `mapOf` | 398-398 | 1 | `const mapOf = (r) => loadMapping(r);` |

### scripts/doc-version.mjs（92 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildVersionListText` | 28-31 | 4 | `export function buildVersionListText(root) {` |
| `findBlock` | 34-39 | 6 | `function findBlock(text) {` |
| `applyVersionBlock` | 42-46 | 5 | `export function applyVersionBlock(text, newContent) {` |
| `checkVersionDrift` | 49-57 | 9 | `export function checkVersionDrift({ hostPath, root } = {}) {` |
| `out` | 67-67 | 1 | `const out = (msg) => console.log(msg);` |

### scripts/preview-server.mjs（116 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `detectLanIp` | 29-41 | 13 | `function detectLanIp() {` |

### scripts/readme-gen.mjs（242 行 · 12 个函数）

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
| `buildReadmeVersionTable` | 178-199 | 22 | `export function buildReadmeVersionTable(repoPath) {` |
| `genReadme` | 202-218 | 17 | `export function genReadme({ repoPath, template = '' } = {}) {` |
| `toString` | 220-221 | 2 | `function toString(arr) { return Array.isArray(arr) ? arr.join('\n') : String(arr \|\| ''); }` |
| `main` | 222-234 | 13 | `function main(argv) {` |

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

### scripts/scan-file-io.mjs（684 行 · 25 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isFnSignature` | 116-439 | 324 | `function isFnSignature(s) {` |
| `stripCommentLines` | 129-153 | 25 | `function stripCommentLines(lines, uptoIdx) {` |
| `scanEnclosure` | 156-173 | 18 | `function scanEnclosure(lines, lineIdx) {` |
| `inRequestPath` | 181-194 | 14 | `function inRequestPath(lines, lineIdx) {` |
| `contextAt` | 197-200 | 4 | `function contextAt(lines, lineIdx) {` |
| `ioTypeOf` | 203-205 | 3 | `function ioTypeOf(opName = '') {` |
| `collectFiles` | 213-231 | 19 | `function collectFiles(targets) {` |
| `walk` | 215-228 | 14 | `const walk = (p) => {` |
| `stripLiterals` | 235-280 | 46 | `function stripLiterals(line) {` |
| `scanFile` | 286-334 | 49 | `function scanFile(file) {` |
| `riskOfFallback` | 347-354 | 8 | `function riskOfFallback(entry, ctx) {` |
| `riskOfByAst` | 367-380 | 14 | `function riskOfByAst(astHits, line, op, entry, ctx) {` |
| `collectVarAssignments` | 383-397 | 15 | `function collectVarAssignments(lines) {` |
| `extractArg` | 400-424 | 25 | `function extractArg(line, op, opName) {` |
| `resolvePathArg` | 427-433 | 7 | `function resolvePathArg(arg, varMap, lineIdx) {` |
| `tagsOf` | 444-450 | 7 | `function tagsOf(h) {` |
| `riskMark` | 453-455 | 3 | `function riskMark(risk) {` |
| `printText` | 462-487 | 26 | `function printText(hits, { writeOnly = false, riskOnly = '', summary = false } = {}) {` |
| `printJson` | 490-492 | 3 | `function printJson(hits) {` |
| `main` | 500-547 | 48 | `export function main(argv = process.argv.slice(2)) {` |
| `splitMulti` | 511-511 | 1 | `const splitMulti = (v) => String(v \|\| '').split(',').map((x) => x.trim()).filter(Boolean);` |
| `scanFileIo` | 550-570 | 21 | `export function scanFileIo(opts = {}) {` |
| `summarize` | 573-590 | 18 | `export function summarize(hits) {` |
| `count` | 574-578 | 5 | `const count = (key) => {` |
| `printReport` | 602-678 | 77 | `function printReport(hits, opts = {}) {` |

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

### scripts/scrub-user-wording.mjs（399 行 · 14 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadWordingRewrites` | 48-60 | 13 | `export function loadWordingRewrites(ymlPath = DEFAULT_REWRITE_YML) {` |
| `wordingRewrites` | 63-66 | 4 | `function wordingRewrites() {` |
| `scrubText` | 69-76 | 8 | `function scrubText(text) {` |
| `commentSyntax` | 81-90 | 10 | `function commentSyntax(ext) {` |
| `codeCommentRanges` | 97-160 | 64 | `function codeCommentRanges(text, syn) {` |
| `markupFenceLines` | 165-182 | 18 | `function markupFenceLines(text) {` |
| `fileHeaderExempt` | 185-188 | 4 | `function fileHeaderExempt(text) {` |
| `lineExempt` | 191-193 | 3 | `function lineExempt(line) {` |
| `processFile` | 206-252 | 47 | `function processFile(filePath) {` |
| `applyConfirmed` | 255-270 | 16 | `function applyConfirmed(file, confirmedSet) {` |
| `collectFiles` | 273-285 | 13 | `function collectFiles(root, out = []) {` |
| `repoDiffFiles` | 288-295 | 8 | `function repoDiffFiles(repoPath) {` |
| `main` | 297-395 | 99 | `async function main(argv) {` |
| `ask` | 363-363 | 1 | `const ask = (q) => new Promise((res) => rl.question(q, res));` |

### scripts/sync-plugin.mjs（203 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `exists` | 45-47 | 3 | `async function exists(p) {` |
| `packageFilesOf` | 56-66 | 11 | `export async function packageFilesOf(root) {` |
| `listSyncFiles` | 73-93 | 21 | `export async function listSyncFiles(root = SOURCE_ROOT) {` |
| `walk` | 77-85 | 9 | `const walk = async (dir) => {` |
| `detectTargets` | 108-124 | 17 | `export function detectTargets(home = process.env.DSH_HOME \|\| '', pluginName = '') {` |
| `fileContentEqual` | 136-145 | 10 | `async function fileContentEqual(from, to) {` |
| `syncPlugin` | 147-172 | 26 | `export async function syncPlugin({ source = SOURCE_ROOT, target = '', write = false } = {}) {` |
| `main` | 175-196 | 22 | `export async function main(argv = process.argv.slice(2)) {` |

### scripts/verify-prestep.mjs（101 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `check` | 20-21 | 2 | `function check(name, ok) { results.push([name, !!ok]); if (!ok) console.log('  ❌', name); }` |

### scripts/watch-preview.mjs（71 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `regen` | 38-48 | 11 | `function regen() {` |

### test/test-account-ssh.mjs（149 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isolatedEnv` | 17-24 | 8 | `function isolatedEnv() {` |

### test/test-audit-bad-file.mjs（107 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setupBadFile` | 18-23 | 6 | `function setupBadFile(relPath, content) {` |
| `cleanup` | 24-28 | 5 | `function cleanup(relPath) {` |

### test/test-auditignore.mjs（116 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setupRepo` | 11-32 | 22 | `function setupRepo() {` |

### test/test-cli-audit-parity.mjs（65 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeAuditRepo` | 19-39 | 21 | `function makeAuditRepo() {` |

### test/test-client.mjs（367 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mockReact` | 20-26 | 7 | `function mockReact() {` |
| `req` | 315-332 | 18 | `const req = (name) => {` |

### test/test-clone-concurrency.mjs（456 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `probe` | 129-153 | 25 | `const probe = async (useNew) => {` |
| `writer` | 134-140 | 7 | `const writer = (async () => {` |
| `call` | 433-433 | 1 | `const call = async (body) => (await handleHttp(` |

### test/test-clone-preview-buttons.mjs（134 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeJsx` | 25-33 | 9 | `function makeJsx() {` |
| `createElement` | 26-31 | 6 | `const createElement = (type, props) => {` |
| `extractFunction` | 36-134 | 99 | `function extractFunction(src, signature) {` |
| `walk` | 50-55 | 6 | `function walk(node, out = []) {` |
| `renderPreview` | 58-134 | 77 | `function renderPreview(handlers = {}) {` |

### test/test-dataflow.mjs（116 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 20-22 | 3 | `function hits(text) {` |

### test/test-doc-func.mjs（95 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkTmp` | 17-17 | 1 | `const mkTmp = () => mkdtempSync(join(tmpdir(), 'dshgp-docfunc-'));` |

### test/test-doc-version.mjs（66 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkTmp` | 15-15 | 1 | `const mkTmp = () => mkdtempSync(join(tmpdir(), 'dshgp-docver-'));` |
| `gitRepoWithVersions` | 18-26 | 9 | `function gitRepoWithVersions(dir) {` |

### test/test-docs-score.mjs（133 行 · 1 个函数）

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

### test/test-exempt.mjs（406 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `f` | 21-23 | 3 | `function f(kind, rule, line = 3) {` |
| `compileGrouped` | 230-238 | 9 | `async function compileGrouped() {` |

### test/test-false-positive-fixes.mjs（462 行 · 8 个函数）

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

### test/test-file-health.mjs（83 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `rule` | 10-22 | 13 | `function rule(over = {}) {` |

### test/test-folder-scope.mjs（106 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countSourceDirs` | 28-47 | 20 | `function countSourceDirs(tree, { threshold = 1, excludeDirs = [] } = {}) {` |

### test/test-git.mjs（844 行 · 2 个函数）

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

### test/test-history-audit.mjs（111 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 17-29 | 13 | `function makeRepo() {` |

### test/test-inject-switch.mjs（137 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `renderAuditInputs` | 28-94 | 67 | `function renderAuditInputs(value) {` |
| `req` | 43-56 | 14 | `const req = (name) => {` |
| `findChild` | 96-96 | 1 | `const findChild = (inputs) => inputs.find((p) => p['aria-label'] === LABEL);` |

### test/test-inject-system-prompt.mjs（330 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `renderAuditInputs` | 25-86 | 62 | `function renderAuditInputs(value) {` |
| `req` | 39-50 | 12 | `const req = (name) => {` |
| `findSwitch` | 88-88 | 1 | `const findSwitch = (inputs) => inputs.find((p) => p['aria-label'] === LABEL);` |

### test/test-link-check.mjs（229 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fakeFetch` | 14-21 | 8 | `function fakeFetch(map = {}) {` |

### test/test-magic-number.mjs（93 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 16-18 | 3 | `function hits(text) {` |

### test/test-persist-credentials.mjs（93 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withIsolatedDshHome` | 19-30 | 12 | `function withIsolatedDshHome(fn) {` |

### test/test-plugin.mjs（623 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeExemptRepo` | 454-460 | 7 | `function makeExemptRepo() {` |
| `addSecretFile` | 461-464 | 4 | `function addSecretFile(root, path) {` |
| `fsStatMode` | 618-620 | 3 | `function fsStatMode(file) {` |

### test/test-push-transport.mjs（198 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `tempRepo` | 30-40 | 11 | `function tempRepo() {` |

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

### test/test-rule-slots-render.mjs（188 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `renderRuleRows` | 38-128 | 91 | `async function renderRuleRows(value, { publishAfterLoad = false } = {}) {` |
| `req` | 56-67 | 12 | `const req = (name) => {` |

### test/test-scope.mjs（177 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadCheckFuncLines` | 132-133 | 2 | `function loadCheckFuncLines() { return { checkFuncLines, checkComplexity }; }` |
| `loadNaming` | 133-134 | 2 | `function loadNaming() { return { checkNameLengthAst }; }` |

### test/test-settings-persistence.mjs（250 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `clientSubmitKeys` | 28-38 | 11 | `function clientSubmitKeys() {` |
| `allowlistKeys` | 47-52 | 6 | `function allowlistKeys() {` |
| `cfgMappingKeys` | 55-250 | 196 | `function cfgMappingKeys() {` |
| `isolatedEnv` | 70-77 | 8 | `function isolatedEnv() {` |

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

### test/test-sidebar-state.mjs（263 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadSettingsBody` | 27-32 | 6 | `function loadSettingsBody() {` |
| `readbackKeys` | 35-38 | 4 | `function readbackKeys() {` |
| `schemaKeys` | 41-43 | 3 | `function schemaKeys() {` |

### test/test-slash-commands.mjs（284 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `inv` | 15-17 | 3 | `function inv(cwd) {` |

### test/test-task-queue.mjs（125 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkRepo` | 16-23 | 8 | `function mkRepo() {` |
| `wait` | 24-25 | 2 | `function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }` |
| `mockJobs` | 27-38 | 12 | `function mockJobs() {` |

### test/test-tree-doc.mjs（221 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeReadme` | 41-43 | 3 | `function makeReadme(tree) {` |

<!-- dshgp-functions:end -->
