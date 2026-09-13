/**
 * dsh-git-push 插件入口（DSH 接线，1.0.0）
 * dsh-skip-i18n: 插件为中文零依赖 CLI（无 i18n 框架需求），用户可见文案硬编码为产品设计
 *
 * 形态：`apply(ctx, config)`，接线全部走 lib/plugin/（Host 侧注册层）。
 * 职责：把 v2 十大总入口接到 DSH 运行时——
 *   1) 工具注册：ctx.inject(['tools']) → get('tools').register(defineTool(...))
 *   2) 上下文注入：ctx.inject(['systemPrompt']) → section({name, order, text:()=>同步})
 *   3) HTTP API：ctx.inject(['webServer']) → register({kind:'prefix', path, handler})
 *   4) 客户端（设置卡片/侧边栏）：**不在此注册**，由 package.json 的 dsh.client
 *      + exports["./client"] 自动发现（client.js）
 *
 * 本文件只做接线（薄适配层），业务全部在 lib/<入口>/：
 *   rule / audit / git / self / score / exempt / context / http / client / link-check。
 * 引擎可脱离 DSH 独立运行：`node cli.mjs <子命令>`。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

/**
 * schemastery 条件加载（peerDependency 由 DSH 宿主提供）：
 *   - DSH 插件运行期：宿主 node_modules 提供 → 用真实 Schema（Standard Schema v1）
 *   - 源码仓本地测试 / CLI（零依赖）：缺失 → 降级为最小 schema（见 makeFallbackSchema）
 * 零依赖仓库设计：不把 peer 依赖装进 v2，缺失时插件入口仍可 import 不崩。
 */
const require2 = createRequire(import.meta.url);
let Schema = null;
try {
  Schema = require2('@deepseek-ai/schemastery');
} catch { Schema = null; }
if (Schema && typeof Schema.object !== 'function') Schema = null; // 防加载到残缺包

/** schemastery 缺失时的最小 schema（仅保留测试用到的语义：可调用返回默认值 + toJSON 形状）。 */
function makeFallbackSchema() {
  const field = (meta = {}) => {
    const fn = (v) => (v === undefined ? meta.default : v);
    fn.meta = meta; // 让 toJSON 能读到 description（schemastery 的 refs 走 meta.description）
    fn.default = (d) => field({ ...meta, default: d });
    fn.description = (d) => field({ ...meta, description: d });
    return fn;
  };
  const object = (shape = {}) => {
    const fn = (v = {}) => {
      const out = {};
      for (const [k, spec] of Object.entries(shape)) {
        const s = typeof spec === 'function' ? spec : field();
        out[k] = s(v[k]);
      }
      return out;
    };
    fn.toJSON = () => ({
      type: 'object',
      refs: Object.entries(shape).map(([k, s]) => ({ key: k, meta: s?.meta || {} })),
    });
    // 【修复 2026-09-11】fallback schema 必须带 ~standard 标记，否则 DSH cordis 的
    // resolveConfig 读 Config['~standard'].validate 时 undefined 崩溃
    // （"Cannot read properties of undefined (reading 'validate')"）。
    // 真实 schemastery 加载时自带该标记；fallback 路径补上等价实现，双路都稳。
    fn['~standard'] = { version: 1, vendor: 'dsh-git-push', validate: fn };
    return fn;
  };
  return {
    object,
    string: () => field({ type: 'string', default: '' }),
    boolean: () => field({ type: 'boolean', default: false }),
    array: () => field({ type: 'array', default: [] }),
    number: () => field({ type: 'number', default: 0 }),
    dict: () => field({ type: 'dict', default: {} }),
    any: () => field({ default: undefined }),
    union: (...fns) => field({ default: undefined }),
  };
}

// 兼容旧引用：Schema 缺失时用 fallback（Config 定义处不感知）
if (!Schema) Schema = makeFallbackSchema();

import { VERSION } from './self/index.js';
import { auditWithScope, auditFull } from './audit/index.js';
import { summarize } from './audit/index.js';
import { scoreQuality } from './score/index.js';
import { cloneViaApi, ensureRemoteRepo, setVisibility } from './git/index.js';
import { commitWithAudit } from './commit-push.js';
import { scanRepos } from './git/index.js';
import { checkGithubAccount, formatGithubAccountBlock, generateSshKey, persistGithubToken, persistSshPub } from './git/index.js';
import { createEnvInjectionText } from './context/index.js';
import { routeRequest, checkOrigin, checkBodySize, checkWriteConfirm, readJsonBody } from './http/index.js';
import { defaultConfig, resolveConfig } from './client/index.js';
import { checkLinks, sumLinkPenalty } from './link-check/index.js';
import { genReadme } from './readme-gen/index.js';
import { loadDefineTool, registerTools, registerContext, registerHttp } from './plugin/index.js';
import { discoverRuleSlots, loadYamlRuleFile, resolveSlotOrder, setSlotDisabled, RULE_YAML_DIR } from './rule/loader.js';

/** git 工具共用参数错误文案（单处定义，多处复用）。 */
export const MSG_REPO_REQUIRED = 'repo 必填';

export const name = 'dsh-git-push';
export const GIT_PUSH_SETTINGS_NS = 'git-push';

/* ───────────── 最近一次审计的按规则包命中数缓存（2026-09-13） ─────────────
 * 侧边栏规则包列表的「拦截 / 警告 / 通过」要显示实际审计命中数，但 HTTP
 * /rule-slots 是独立分发（不共享工具调用的调用栈/局部状态），故用模块级缓存：
 * code_audit 每次审计后写入（setLastSlotHitStats），接口读取（getLastSlotHitStats）。
 */
let lastSlotHitStats = null;
let lastSlotHitAt = null;
let lastSlotHitRepo = '';

/** 写入最近一次审计的按规则包命中数（code_audit 审计后调用）。 */
export function setLastSlotHitStats(stats, repo = '') {
  if (!stats || typeof stats !== 'object') return;
  lastSlotHitStats = stats;
  lastSlotHitAt = new Date().toISOString();
  lastSlotHitRepo = String(repo || '');
}

/** 读最近一次审计的按规则包命中数（无审计记录时返回 null → 前端回退规则条数口径）。 */
export function getLastSlotHitStats() {
  return lastSlotHitStats;
}

/** 读最近一次审计命中数的时间与仓库（供状态接口展示「统计时间」）。 */
export function getLastSlotHitMeta() {
  return { at: lastSlotHitAt, repo: lastSlotHitRepo };
}

/** 插件配置 schema（Standard Schema v1，DSH cordis 校验必需；schemastery 提供 ~standard 标记）。 */
export const Config = Schema.object({
  // —— v2 特有字段 ——
  enabled: Schema.boolean().default(true).description('启用插件'),
  workspaceRoot: Schema.string().default('').description('扫描根目录（空=DSH workspaceRoot）'),
  extraRepos: Schema.array(Schema.string()).default([]).description('额外仓库路径（数组）'),
  extraReposFile: Schema.string().default('').description('额外仓库清单文件（每行一个绝对路径，# 注释；运行时实时读取）'),
  auditEnabled: Schema.boolean().default(false).description('提交前审计（默认关）'),
  auditScanScope: Schema.string().default('diff').description('diff | full'),
  auditLevel: Schema.string().default('standard').description('审计强度：quick | standard | deep（默认 standard）'),
  auditRuleset: Schema.string().default('').description('自定规则目录（空=内置规则包；放 audit-rules-<名>.yml 即整体替换）'),
  auditRuleOrder: Schema.array(Schema.string()).default([]).description('规则槽位加载顺序（后加载覆盖先加载；空=默认偏好顺序；private 恒末尾强制）'),
  auditDisabledSlots: Schema.array(Schema.string()).default([]).description('UI 禁用的规则槽位（设置页单击切换；nodejs/private 安全红线不可禁用）'),
  weightOverrides: Schema.string().default('').description('权重覆盖 JSON（如 {"安全性":100}，空=默认权重表）'),
  linkCheckEnabled: Schema.boolean().default(false).description('链接检查（默认关，需网络）'),
  // —— v1 全量移植字段（2026-09-12：客户端完全移植 v1，Config 补全 v1 卡片读写键）——
  githubToken: Schema.string().description('GitHub token（ghp_/github_pat_ 开头；存插件配置目录 0600）'),
  sshPub: Schema.string().description('SSH 公钥整行（存同级仓 *.pub）'),
  tokenConfigured: Schema.boolean().default(false).description('是否已配置 token（由 host 派生）'),
  commentWordingEnabled: Schema.boolean().default(true).description('提交信息措辞检查'),
  commentWordingCustom: Schema.string().default('').description('自定义措辞规则'),
  commentWordingRulesFile: Schema.string().default('').description('措辞规则文件路径'),
  commentWordingRulesUrl: Schema.string().default('').description('措辞规则 URL'),
  auditRuleWeights: Schema.dict(Schema.any()).default({}).description('规则权重（{ blacklist: { pattern: weight } }）'),
  qualityWeights: Schema.dict(Schema.number()).default({}).description('质量维度权重覆盖（{ 维度名: weight }）'),
  ruleSlotMeta: Schema.dict(Schema.any()).default({}).description('规则槽位元数据（host 启动填充，只读）'),
  injectFullSkill: Schema.boolean().default(false).description('注入全部 skill 正文（默认只注目录+清单）'),
  injectRepoIndexFull: Schema.boolean().default(false).description('注入 dsh-repo-index.json 全文（默认只注文件名）'),
  customIgnorePatterns: Schema.string().default('').description('自定义 gitignore 模式（逗号/换行分隔）'),
  hardcodeFullScan: Schema.boolean().default(false).description('硬编码审计全量扫（默认只扫新增/变更行）'),
  yamlCheckMode: Schema.string().default('js-yaml').description('YAML 检查模式：js-yaml（默认）| heuristic'),
});

/** 工具清单（名 + 说明 + 参数 spec；由 lib/plugin/normalizeParameters 转 DSH 形状注册）。 */
export function listTools() {
  return [
    { name: 'git_scan',
      description: '扫描 DSH workspace 下所有 git 仓库，返回每个仓库的分支/remote/未提交变更数/最近活动。'
        + '用于查看哪些仓库有未提交或未推送的改动。支持自由配置：root 传扫描根目录（默认 workspaceRoot，'
        + '传了则以它为准）、paths 传额外仓库绝对路径（逗号分隔，临时指定，无需改配置）、'
        + 'extraReposFile 传配置文件路径（每行一个仓库绝对路径，# 开头为注释，运行时实时读取即时生效）。',
      parameters: {
        root: { type: 'string', description: '扫描根目录（默认 workspaceRoot，传了则以它为准）' },
        paths: { type: 'string', description: '额外仓库绝对路径，逗号分隔（临时指定，无需改配置）' },
        extraReposFile: { type: 'string', description: 'extraRepos 配置文件路径（每行一个仓库绝对路径，# 开头为注释，实时读取生效）' },
      } },
    { name: 'git_commit_push',
      description: '对指定 git 仓库一键提交并推送：先审计（默认开，L0 静态检查语法/敏感信息/凭据/大文件/文档对话类措辞，'
        + '发现 blocker 拦截），再 git add -A → commit（message 必填）→ push origin <当前分支>。'
        + 'push 前自动 fetch 并检查 ahead/behind，远端领先时不推。repo 传仓库绝对路径（可用 git_scan 查）。'
        + 'audit=false 可关闭审计；dryRun=true 只模拟不写入。调用前需逐条核对开发者特殊要求（随插件内置清单，'
        + '可用 <插件配置目录>/requirements.json 外挂），全部达标才传 requirementsConfirmed=true，否则拦截。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        message: { type: 'string', description: 'commit message（必填）' },
        push: { type: 'boolean', description: '是否推送，默认 true' },
        audit: { type: 'boolean', description: '提交前审计，默认取插件配置 auditEnabled' },
        dryRun: { type: 'boolean', description: 'dry-run 只模拟不写入，默认 false' },
        force: { type: 'boolean', description: 'force 强推：覆盖远端历史（相当于 git push --force；SSH 通道 git push --force / API 通道重建 commit 去掉旧 parent）。默认 false，谨慎使用' },
        ignorePatterns: { type: 'string', description: '自定义忽略 pattern（逗号/换行分隔，追加进 .gitignore，幂等）' },
        requirementsConfirmed: { type: 'boolean', description: '已核对开发者特殊要求（随插件内置清单，可用 <插件配置目录>/requirements.json 外挂）：全部达标时 true，false 会被拦截' },
      } },
    { name: 'code_audit',
      description: '审计指定 git 仓库（L0 静态检查 + 10 维度质量评分）：语法/敏感信息/凭据/大文件/文档措辞 + 代码质量。'
        + 'scope=full 走全量扫描（非 git 目录自动全量）；ruleset 指向自定规则目录（放 audit-rules-<名>.yml 即整体替换规则包）；'
        + 'auditLevel 控强度（quick 跳 AST/语义重检查 / standard 全量 / deep）；weights 用 JSON 覆盖评分权重。'
        + '返回 summary（blocker/warning/notice）、quality（0-100 评分 + 等级）、findings。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        scope: { type: 'string', description: "扫描范围：'full'=全量 | 缺省/其他=仅本次变动" },
        llm: { type: 'boolean', description: '追加 LLM 深度审查（需配置 provider/model）' },
        ruleset: { type: 'string', description: '自定规则目录（含 audit-rules-<名>.yml；空=内置规则包）' },
        auditLevel: { type: 'string', description: '审计强度：quick | standard | deep（默认取插件配置）' },
        weights: { type: 'string', description: '权重覆盖 JSON，如 {"安全性":100}' },
      } },
    { name: 'git_gen_readme',
      description: '对指定 git 仓库按模板生成 README。模板 = 插件 template/README.md（用户可改章节，存于插件根 template/）'
        + '或内置 readme.yml 章节模板；占位符 {{name}} {{description}} {{version}} {{toc}} {{versionTable}}。'
        + 'repo 传仓库绝对路径。writePath 可选指定写入路径（默认只返回内容不写文件）。',
      parameters: {
        repo: { type: 'string', description: 'git 仓库绝对路径' },
        writePath: { type: 'string', description: '可选：写入路径（直接写 README.md 传路径），默认只返回内容' },
      } },
    { name: 'git_clone',
      description: '从 GitHub 远端 clone 仓库到本地（只走 api.github.com Git Data API，不跟随 tarball 302、不直连 github.com）。'
        + 'target 传 owner/repo 或完整 URL；dest 传目标目录绝对路径（缺省放 workspaceRoot），已存在非空目录会拒绝防覆盖；'
        + 'branch 可选指定分支。',
      parameters: {
        target: { type: 'string', description: 'owner/repo 或完整 URL' },
        dest: { type: 'string', description: '目标目录绝对路径（缺省 workspaceRoot）' },
        branch: { type: 'string', description: '分支名（缺省远端默认分支）' },
      } },
    { name: 'git_remote_create',
      description: '按项目文件夹创建远程仓库：对本地 git 仓库取目录名做仓库名，检查 GitHub 是否已存在同名仓库，'
        + '不存在则用 token 自动创建（默认 private）并把 origin 设为 api.github.com 形式（不写 SSH/github.com）。dryRun=true 只探测预演。',
      parameters: {
        repo: { type: 'string', description: '本地 git 仓库绝对路径（项目文件夹）' },
        visibility: { type: 'string', description: 'public | private（默认 private）' },
        dryRun: { type: 'boolean', description: '只探测预演，不写 remote 不调创建 API' },
      } },
    { name: 'git_set_visibility',
      description: '切换 GitHub 仓库公开/私有状态：调 GitHub API PATCH private 字段，支持双向切换。'
        + '改 public 有敏感信息暴露风险（先确认无凭据/隐私），改 private 安全。',
      parameters: {
        repo: { type: 'string', description: '本地 git 仓库绝对路径' },
        visibility: { type: 'string', description: 'public | private（必填）' },
      } },
    { name: 'link_check',
      description: '检查文档链接有效性（md/markdown/txt 中的 URL），只报 warning 永不拦截提交。path 传文件或目录（缺省 workspaceRoot）。',
      parameters: {
        path: { type: 'string', description: '文件或目录路径（缺省 workspaceRoot）' },
      } },
    { name: 'git_account_check',
      description: '校验 GitHub 账号与凭据：token 在线校验（api.github.com /user）+ SSH 公钥指纹读取，返回登录态/用户名/公钥仓库数/套餐 + 可读块。'
        + 'token 不传则从环境/凭据文件自动解析。也支持顺带持久化 SSH 公钥（sshPub 参数）。',
      parameters: {
        token: { type: 'string', description: 'GitHub token（可选；不传自动解析环境变量/凭据文件）' },
        sshPub: { type: 'string', description: 'SSH 公钥内容（可选；非空先持久化到配置目录 *.pub 再校验）' },
      } },
    { name: 'git_gen_ssh_key',
      description: '按邮箱生成 SSH 密钥对（ssh-keygen -t rsa -b 4096 -C email，写入插件配置目录）。'
        + 'force=true 先备份旧密钥再覆盖。公钥整行回传（私钥永不离开本机）。',
      parameters: {
        email: { type: 'string', description: '邮箱（x@y.z 格式，必填）' },
        force: { type: 'boolean', description: '已存在私钥时强制覆盖（先改名备份，可恢复）' },
      } },
  ];
}

/** 提交前提醒（systemPrompt 注入段，对照旧版 dsh-git-push-readme-check）。 */
export const README_CHECK_HINT = [
  '【dsh-git-push 提交前提醒】每次调用 git_commit_push 前必须检查该仓库 README：',
  '功能表 / 版本记录 / 用法是否与本次改动一致。需要更新则先改 README 再提交。',
  '不要把过时 README 推进远端。',
].join('');

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

/**
 * 插件应用入口（DSH 调用）。
 * @param {object} ctx DSH 上下文（提供 inject / tools / http / log）
 * @param {object} [config] 插件配置
 */
export async function apply(ctx, config = {}) {
  const cfg = resolveConfig(config);
  // 【修复 2026-09-11】cordis 中 ctx.log 是服务属性，未 inject 时直读会抛
  // "cannot get property \"log\" without inject" 导致插件树加载失败、实例退出。
  // 改为 ctx.get() 防御式读取（可选服务，缺失时 log 为 undefined，不影响接线）。
  const log = ctx?.get?.('log');
  const env = {
    version: VERSION,
    // 【修复 2026-09-11】ctx.workspaceRoot 同为 cordis 服务属性，直读抛 without inject；
    // 与 ctx.log 一样改 ctx.get() 防御式读取（缺失返回 undefined，回退到空串）。
    workspaceRoot: config.workspaceRoot || ctx?.get?.('workspaceRoot') || '',
    extraRepos: String(config.extraRepos || '').split(',').map((str) => str.trim()).filter(Boolean),
    extraReposFile: String(config.extraReposFile || ''),
  };

  // 1) agent 工具：ctx.inject(['tools']) → get('tools').register(defineTool(spec))
  //    defineTool 动态加载：工作区自测环境没有 DSH 依赖，装在 profile 内必可解析。
  const defineTool = await loadDefineTool(log);
  const toolCount = registerTools(ctx, {
    defineTool,
    tools: listTools(),
    invoke: (toolName, args) => callTool(toolName, args, env, cfg, log),
    log,
  });

  // 2) 系统提示词注入：callback 体内必须调用 section()（返回值不是注册）；text 必须同步
  const sectionCount = registerContext(ctx, {
    sections: [
      { name: 'dsh-git-push-env', order: 980, text: () => createEnvInjectionText({ cwd: env.workspaceRoot, projectRoot: env.workspaceRoot }) },
      { name: 'dsh-git-push-readme-check', order: 991, text: () => README_CHECK_HINT },
    ],
    log,
  });

  // 3) HTTP API：ctx.inject(['webServer']) → register({kind:'prefix', path, handler})
  const httpWired = registerHttp(ctx, {
    path: '/api/git-push',
    handler: (req, res) => adaptHttpHandler(req, res, env, cfg),
    log,
  });

  // 4) 设置命名空间：settings.register('git-push') —— Host 必须注册命名空间，
  //    配置卡（settings.plugin.item key=git-push）才会与 Host 命名空间相交显示
  //    （学 v1 plugin-setup.js registerSettings；2026-09-12 补，此前配置卡空白根因）。
  try {
    ctx.inject(['settings'], (settingsCtx) => {
      const scope = settingsCtx.settings.register(GIT_PUSH_SETTINGS_NS, Config, { base: defaultConfig() });
      // 初始同步一次（watch 不会立即回调）：重启后第一次加载即拿到已保存的 token/SSH 公钥，
      //   账号检查端点才能用设置页保存的凭据判断（2026-09-12 修复误判未登录根因）
      try {
        const init = scope.get() || {};
        if (typeof init.githubToken === 'string') cfg.githubToken = init.githubToken;
        if (typeof init.sshPub === 'string') cfg.sshPub = init.sshPub;
      } catch (e) {
        log?.warn?.(`初始同步设置凭据跳过：${e?.message || e}`);
      }
      scope.watch(async (next) => {
        if (!next || typeof next !== 'object') return;
        // 设置页改动 → 同步运行期字段（学 v1：injectFullSkill 等即时生效）
        if (typeof next.auditEnabled === 'boolean') cfg.auditEnabled = next.auditEnabled;
        if (typeof next.auditScanScope === 'string') cfg.auditScanScope = next.auditScanScope;
        if (typeof next.auditLevel === 'string') cfg.auditLevel = next.auditLevel;
        if (typeof next.auditRuleset === 'string') cfg.auditRuleset = next.auditRuleset;
        if (Array.isArray(next.auditRuleOrder)) cfg.auditRuleOrder = next.auditRuleOrder;
        if (Array.isArray(next.auditDisabledSlots)) cfg.auditDisabledSlots = next.auditDisabledSlots;
        if (typeof next.weightOverrides === 'string') cfg.weightOverrides = next.weightOverrides;
        // 2026-09-12 修复：设置页保存的 token / SSH 公钥必须同步到运行期 cfg，
        //   否则账号检查端点读 b.githubToken（空）→ resolveToken() 落旧配置文件 → 旧失效 token 误判未登录。
        if (typeof next.githubToken === 'string') cfg.githubToken = next.githubToken;
        if (typeof next.sshPub === 'string') cfg.sshPub = next.sshPub;
        // 2026-09-13 修复：设置页保存凭据必须写插件配置目录（credentialsDir()/github-token 0600 + *.pub），
        //   不依赖 DSH settings.yaml 明文（用户实测：侧边栏保存后插件文件没写入，只能手动写）。
        if (typeof next.githubToken === 'string' && next.githubToken.trim()) {
          const r = persistGithubToken(next.githubToken, { workspaceRoot: env.workspaceRoot });
          if (!r.ok) log?.warn?.(`dsh-git-push token 持久化失败: ${r.error || r}`);
        }
        if (typeof next.sshPub === 'string' && next.sshPub.trim()) {
          const r = persistSshPub(next.sshPub, { workspaceRoot: env.workspaceRoot });
          if (!r.ok) log?.warn?.(`dsh-git-push SSH 公钥持久化失败: ${r.error || r}`);
        }
        log?.info?.('dsh-git-push 设置页更新已同步运行期配置');
      });
    });
  } catch (e) {
    log?.warn?.(`settings 命名空间注册跳过：${e?.message || e}`);
  }

  // 5) 客户端（设置卡片/侧边栏）不在 Host 注册：DSH 依据 package.json 的
  //    dsh.client + exports["./client"] 自动发现 client.js。

  log?.info?.(`dsh-git-push v${VERSION} 已接线（工具 ${toolCount} 个 / 注入 ${sectionCount} 段 / HTTP ${httpWired ? '已注册' : '未注册'}；审计默认${cfg.auditEnabled ? '开' : '关'}）`);
  // 【修复 2026-09-11】cordis 的 apply 返回值只能是 disposer 函数 / Promise / undefined；
  // 返回普通对象会抛 "Invalid effect" 导致插件树加载失败。插件内部注册均走 ctx.inject，
  // 生命周期由 cordis 管理，因此 apply 返回 undefined（标准写法）。
  return;
}

/**
 * HTTP 适配：DSH webServer 原生 (req, res) ↔ v2 纯函数 handleHttp({status, body})。
 * 返回 undefined 表示「非本插件路由 → 放行」（与旧版 handler 语义一致）。
 */
export async function adaptHttpHandler(req, res, env, cfg) {
  let body;
  if (String(req?.method || 'GET').toUpperCase() === 'POST') {
    // readJsonBody 是 callback 风格（非 Promise）：包一层 Promise 等待完成
    body = await new Promise((resolve) => readJsonBody(req, resolve));
  }
  const result = await handleHttp(
    { method: req?.method, url: req?.url, origin: req?.headers?.origin, headers: req?.headers, body },
    env,
    cfg,
  );
  if (!result) return undefined;
  try {
    res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result.body, null, 2));
  } catch { /* 响应已开始/连接已断：忽略 */ }
  return result;
}

/**
 * 工具调用分发（薄适配：参数 → 总入口函数）。
 * @param {string} toolName
 * @param {object} args
 * @param {object} env { workspaceRoot, extraRepos }
 * @param {object} cfg 插件配置
 * @returns {Promise<object>}
 */
export async function callTool(toolName, args = {}, env = {}, cfg = defaultConfig(), log = null) {
  switch (toolName) {
    case 'git_scan': {
      const root = args.root || env.workspaceRoot;
      const pathList = String(args.paths || '').split(',').map((str) => str.trim()).filter(Boolean);
      const extraReposFile = args.extraReposFile || env.extraReposFile || '';
      const repos = scanRepos(root, {
        extraRepos: [...(env.extraRepos || []), ...pathList],
        extraReposFile,
      });
      return { ok: true, root, count: repos.length, paths: pathList, extraReposFile, repos };
    }
    case 'git_commit_push': {
      const repo = args.repo;
      if (!repo) return { ok: false, error: MSG_REPO_REQUIRED };
      // 审计门禁逻辑统一在 lib/commit-push.js（外部插件亦复用同一实现）
      return commitWithAudit({
        repoPath: repo,
        message: args.message,
        push: args.push !== false,
        dryRun: args.dryRun === true,
        audit: args.audit,
        auditLevel: args.auditLevel,
        rulesetDir: args.ruleset,
        slots: cfg.auditRuleOrder && cfg.auditRuleOrder.length ? cfg.auditRuleOrder : undefined,
        customIgnorePatterns: args.ignorePatterns || '',
        requirementsConfirmed: args.requirementsConfirmed === true,
        force: args.force === true,
      });
    }
    case 'code_audit': {
      const repo = args.repo;
      if (!repo) return { ok: false, error: MSG_REPO_REQUIRED };
      const validLevels = ['quick', 'standard', 'deep'];
      const level = validLevels.includes(args.auditLevel) ? args.auditLevel : (cfg.auditLevel || 'standard');
      let weights = {};
      if (args.weights) {
        try { weights = JSON.parse(args.weights); } catch { /* 非法 JSON 回退默认权重 */ }
      }
      const auditOpts = { scope: 'diff', rulesetDir: args.ruleset || '', auditLevel: level, slots: cfg.auditRuleOrder && cfg.auditRuleOrder.length ? cfg.auditRuleOrder : undefined, disabledSlots: Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [] };
      const res = args.scope === 'full' || !existsSync(join(repo, '.git'))
        ? auditFull(repo, auditOpts)
        : auditWithScope(repo, auditOpts);
      const summary = summarize(res.findings);
      const quality = scoreQuality(res.findings, weights);
      // 2026-09-13：返回带 block 字段——审计结果直接格式化可读总结，AI 拿到后直接说给用户
      //   （不依赖 systemPrompt/pre-step 注入；对齐 git_account_check 的 block 模式）
      const block = formatAuditBlock({ repo, scope: res.scope, summary, quality });
      // 2026-09-13：缓存按规则包命中数供给 HTTP /rule-slots（侧边栏规则包列表显示实际命中数）
      if (res.slotStats) setLastSlotHitStats(res.slotStats, repo);
      log?.info?.(`code_audit ${repo} → ${quality.score}/${quality.level}（blocker ${summary.blocker} / warning ${summary.warning} / notice ${summary.notice}）`);
      return { ok: true, scope: res.scope, summary, quality, block, slotStats: res.slotStats, findings: res.findings };
    }
    case 'git_gen_readme': {
      if (!args.repo) return { ok: false, error: MSG_REPO_REQUIRED };
      return genReadme({ repoPath: args.repo, writePath: args.writePath || undefined, workspaceRoot: env.workspaceRoot });
    }
    case 'git_clone': {
      if (!args.target) return { ok: false, error: 'target 必填' };
      return cloneViaApi({ target: args.target, dest: args.dest, branch: args.branch });
    }
    case 'git_remote_create':
      if (!args.repo) return { ok: false, error: MSG_REPO_REQUIRED };
      return ensureRemoteRepo({ repoPath: args.repo, visibility: args.visibility || 'private', dryRun: args.dryRun === true });
    case 'git_set_visibility':
      if (!args.repo || !args.visibility) return { ok: false, error: 'repo 与 visibility 必填' };
      return setVisibility({ repoPath: args.repo, visibility: args.visibility });
    case 'link_check': {
      const path = args.path || env.workspaceRoot;
      const res = await checkLinks({ file: path, text: readTextSafe(path) });
      return { ok: true, count: res.length, penalty: sumLinkPenalty(res), findings: res };
    }
    case 'git_account_check': {
      if (args.sshPub) persistSshPub(String(args.sshPub), { workspaceRoot: env.workspaceRoot });
      const result = await checkGithubAccount({ workspaceRoot: env.workspaceRoot, token: String(args.token || '') });
      return { ok: true, ...result, block: formatGithubAccountBlock(result) };
    }
    case 'git_gen_ssh_key': {
      const r = generateSshKey(String(args.email || ''), { workspaceRoot: env.workspaceRoot, force: args.force === true });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, email: r.email, privateKey: r.privateKey, pubFile: r.pubFile, pub: r.pub, note: '公钥已写入插件配置目录 *.pub，可复制粘贴到 GitHub → Settings → SSH and GPG keys' };
    }
    default:
      return { ok: false, error: `未知工具: ${toolName}` };
  }
}

/** 读文件（失败返回空串，link_check 用）。 */
function readTextSafe(path = '') {
  try {
    return readFileSync(path, 'utf8');
  } catch { return ''; }
}

/**
 * HTTP 端点分发（鉴权前置：Origin/CSRF → 413 → 写确认）。
 * @param {object} req { method, url, origin, headers, body? }
 * @param {object} env
 * @param {object} cfg
 * @returns {Promise<{status:number, body:object}>}
 */
/**
 * 规则槽位清单 + 元数据（HTTP /api/git-push/rule-slots 与客户端共用）。
 * 动态发现目录下 audit-rules-<名>.yml；读各文件 metadata 作显示名/描述；
 * 生效顺序 = 配置 auditRuleOrder → 默认偏好（resolveSlotOrder）。
 *
 * stats 语义（2026-09-13 修正为「审计命中数」）：前端规则包行的「拦截 / 警告 / 通过」
 *   = 该规则包在最近一次审计里的实际命中数——
 *     拦截 = 命中的 blocker 级问题数；警告 = 命中的 warning 级问题数；
 *     通过 = 该包已加载规则数 − 有命中的规则数（没查出问题的规则）。
 *   未审计过时（hitStats 为空）退回「规则条数」口径并在 stats.source 标注，便于前端区分。
 *
 * @param {string[]} [order] 配置槽位顺序（空=默认）
 * @param {string[]} [disabledSlots] 旧版禁用槽位（向后兼容；新切换写 yml）
 * @param {Record<string, {blocker:number,warning:number,pass:number,total:number}>} [hitStats]
 *   最近一次审计的按槽位命中数（auditFull/auditChanged 返回的 slotStats）
 * @returns {object} { discovered, order, meta, forced }
 */
export function listRuleSlots(order, disabledSlots = [], hitStats = null) {
  const discovered = discoverRuleSlots(RULE_YAML_DIR);
  const meta = {};
  for (const slot of discovered) {
    const r = loadYamlRuleFile(slot, RULE_YAML_DIR);
    if (r.ok && r.data?.metadata) {
      const rules = Array.isArray(r.data.rules) ? r.data.rules : [];
      const ruleCount = rules.length;
      const ruleBlocker = rules.filter((x) => x && (x.severity === 'blocker' || x.severity === 'error')).length;
      const ruleWarning = rules.filter((x) => x && x.severity === 'warning').length;
      // 审计命中数优先（无审计结果时退回规则条数口径）
      const hit = hitStats && hitStats[slot];
      const stats = hit
        ? { blocker: hit.blocker || 0, warning: hit.warning || 0, pass: hit.pass || 0, total: ruleCount, source: 'audit' }
        : { blocker: ruleBlocker, warning: ruleWarning, pass: Math.max(0, ruleCount - ruleBlocker - ruleWarning), total: ruleCount, source: 'rules' };
      meta[slot] = {
        name: r.data.metadata.name || slot,
        description: r.data.metadata.description || '',
        author: r.data.metadata.author || '',
        stats,
        // 2026-09-13：disabled 以 yml 顶层为准（启用/禁用以 yml 解析，不单独存变量）。
        //   disabledSlots 参数仅向后兼容（旧配置/旧调用仍生效），新切换走 toggle-rule 写 yml。
        disabled: r.data.disabled === true || disabledSlots.includes(slot),
      };
    } else {
      meta[slot] = { name: slot, description: '', author: '', stats: { blocker: 0, warning: 0, pass: 0, total: 0, source: 'rules' }, disabled: disabledSlots.includes(slot) };
    }
  }
  const eff = resolveSlotOrder(order && order.length ? order : undefined, { dir: RULE_YAML_DIR });
  return { discovered, order: eff, meta, forced: ['private'] };
}

export async function handleHttp(req = {}, env = {}, cfg = defaultConfig()) {
  const method = String(req.method || 'GET').toUpperCase();
  const originCheck = checkOrigin(method, req.origin, undefined, req.headers?.host);
  if (!originCheck.ok) return { status: originCheck.status, body: { ok: false, ...originCheck } };
  const sizeCheck = checkBodySize(Number(req.headers?.['content-length']) || 0);
  if (!sizeCheck.ok) return { status: sizeCheck.status, body: { ok: false, ...sizeCheck } };
  const path = String(req.url || '/').split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(String(req.url || '/').split('?')[1] || ''));
  const writeConfirmOps = ['/api/git-push/rebuild', '/api/git-push/rollback'];
  if (writeConfirmOps.includes(path)) {
    const confirm = checkWriteConfirm(req.body || {});
    if (!confirm.ok) return { status: confirm.status, body: { ok: false, ...confirm } };
  }
  switch (path) {
    case '/api/git-push/status':
      return { status: 200, body: { ok: true, plugin: name, version: VERSION, workspaceRoot: env.workspaceRoot, config: cfg } };
    case '/api/git-push/scan':
      return { status: 200, body: { ok: true, repos: scanRepos(env.workspaceRoot || '.', { extraRepos: env.extraRepos }) } };
    case '/api/git-push/tools':
      return { status: 200, body: { ok: true, tools: listTools() } };
    case '/api/git-push/rule-slots':
      // 2026-09-13：传入最近一次审计的按规则包命中数（getLastSlotHitStats），
      //   让前端规则包行的「拦截/警告/通过」显示实际命中数而非规则条数。
      return { status: 200, body: { ok: true, slots: listRuleSlots(cfg.auditRuleOrder, Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [], getLastSlotHitStats()) } };
    case '/api/git-push/rule-detail': {
      // 规则包明细：读单个 audit-rules-<slot>.yml 的 rules 数组，按 severity 统计拦截/警告/通过数量。
      // 拦截=blocker|error，警告=warning，通过=notice|info|pass（不含 severity 视为通过）。
      const slot = String(query.slot || '');
      if (!slot) return { status: 400, body: { ok: false, code: 'SLOT_REQUIRED', error: '缺少规则包名 slot' } };
      const r = loadYamlRuleFile(slot, RULE_YAML_DIR);
      if (!r.ok) return { status: 404, body: { ok: false, code: 'SLOT_NOT_FOUND', error: r.error } };
      const rules = Array.isArray(r.data?.rules) ? r.data.rules : [];
      const detail = rules.map((rule) => ({
        id: rule.id || '',
        name: rule.name || rule.id || '',
        category: rule.category || '',
        severity: rule.severity || 'notice',
        description: rule.description || '',
        author: rule.author || r.data.metadata?.author || '',
      }));
      const count = (sev) => detail.filter((x) => x.severity === sev).length;
      const stats = {
        blocker: count('blocker') + count('error'),
        warning: count('warning'),
        pass: rules.length - count('blocker') - count('error') - count('warning'),
        total: rules.length,
      };
      return { status: 200, body: { ok: true, slot, meta: { name: r.data?.metadata?.name || slot, description: r.data?.metadata?.description || '', author: r.data?.metadata?.author || '' }, stats, rules: detail } };
    }
    case '/api/git-push/toggle-rule': {
      // 2026-09-13：启用/禁用规则包 = 直接改 yml 顶层 disabled（以 yml 解析，不单独存变量）。
      //   body { slot, disabled } → 文本级改 audit-rules-<slot>.yml 的 disabled 行；nodejs/private 安全红线拒绝。
      const b = (req && typeof req.body === 'object' && req.body) || {};
      const slot = String(b.slot || '');
      const want = b.disabled === true;
      if (!slot) return { status: 400, body: { ok: false, code: 'SLOT_REQUIRED', error: '缺少规则包名 slot' } };
      const r = setSlotDisabled(slot, want);
      if (!r.ok) return { status: 400, body: { ok: false, code: 'SLOT_TOGGLE_FAIL', error: r.error || '切换失败' } };
      return { status: 200, body: { ok: true, slot, disabled: r.disabled, message: want ? '已禁用' : '已启用' } };
    }
    case '/api/git-push/account-check': {
      // body 由 adaptHttpHandler 解析为对象；{ githubToken?, sshPub? } → 校验账号；sshPub 非空先持久化公钥
      // 2026-09-12 修复：token 优先用设置页保存的 cfg.githubToken（scope.watch/初始同步已把
      //   settings 的 githubToken/sshPub 灌入 cfg），body 传参仅作显式覆盖；否则 resolveToken()
      //   只会读配置文件里的旧 token → 误判未登录。
      const b = req.body || {};
      const pub = String(b.sshPub || cfg.sshPub || '');
      if (pub) persistSshPub(pub, { workspaceRoot: env.workspaceRoot });
      const tok = String(b.githubToken || cfg.githubToken || '');
      const result = await checkGithubAccount({ workspaceRoot: env.workspaceRoot, token: tok });
      result.block = formatGithubAccountBlock(result);
      return { status: 200, body: result };
    }
    case '/api/git-push/gen-ssh-key': {
      // body 由 adaptHttpHandler 解析为对象；{ email, force? } → 生成 SSH 密钥对；公钥整行回传（私钥永不离开本机）
      const b = req.body || {};
      const r = generateSshKey(String(b.email || ''), { workspaceRoot: env.workspaceRoot, force: b.force === true });
      if (!r.ok) return { status: 400, body: { ok: false, code: 'SSH_KEY', error: r.error } };
      return { status: 200, body: { ok: true, email: r.email, privateKey: r.privateKey, pubFile: r.pubFile, pub: r.pub, note: '公钥已写入插件配置目录 *.pub，可复制粘贴到 GitHub → Settings → SSH and GPG keys' } };
    }
    default:
      return { status: 404, body: { ok: false, code: 'NOT_FOUND', message: `无此端点: ${method} ${path}` } };
  }
}

export { routeRequest, readJsonBody };
