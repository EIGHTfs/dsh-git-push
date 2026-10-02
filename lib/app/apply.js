/**
 * 插件入口层 · apply（插件装载入口）
 *
 * 宿主加载插件时调用：注册配置 schema、注册工具、注册 HTTP 路由、注册注入钩子。
 * 本模块只做「注册编排」，具体处理逻辑在 handlers.js，工具声明在 tools.js。
 */

import { VERSION } from '../self/index.js';
import { persistGithubToken, persistSshPub, credentialsDir } from '../git/index.js';
import { createEnvInjectionText, collectToolPaths, mapWorkspaceDirs } from '../context/index.js';
import { defaultConfig, resolveConfig } from '../client/index.js';
import { loadDefineTool, registerTools, registerContext, registerHttp, registerPreStepInjection } from '../plugin/index.js';
// 【2026-10-02 · DSH 0.2.0-rc.2 适配】0.2.0 删除了 settings.register / settings.get 旧 API
//   （settings 服务改为 SettingsForms：describe/update/replace/mutate/configure，命名空间由
//   Loader 条目派生）。本插件改为「特性检测自动切换」：旧宿主走 register 分支、0.2.0 走
//   describe 分支，故 GIT_PUSH_SETTINGS_NS（命名空间名）与 Config（旧分支注册用 schema）
//   两个 import 仍需保留。按 comment-not-delete 保留原行注释，便于回退与对照。
// 【原代码】import { GIT_PUSH_SETTINGS_NS, name } from './constants.js';
import { GIT_PUSH_SETTINGS_NS } from './constants.js';
import { adaptHttpHandler } from './http-handlers.js';
import { readSettings, applySettingsToCfg, writeSettingsKey } from './settings-bridge.js';
import { FUNCTION_USAGE_HINT, README_CHECK_HINT, buildRequirementsInjectionText } from './inject-text.js';
// 【原代码】import { Config } from './schema.js';
import { Config } from './schema.js';
import { callTool } from './tool-call.js';
import { listTools } from './tools.js';
import { registerSlashCommands } from './slash-commands.js';
import { registerAutoPush } from '../plugin/auto-push.js';
import { join } from 'node:path';

/** 系统提示词注入段的排序号（越大越靠前；同段位相对顺序固定）。 */
// 运行环境段（ORDER_ENV=980）迁出 systemPrompt → 改用上下文注入
//   （agent/pre-step，registerPreStepInjection，见下方 2.5 步）；systemPrompt 只留三段。
const ORDER_USAGE = 990;        // 功能用法（工具清单 + 凭据托管说明）
const ORDER_README_CHECK = 991; // 提交前必须核对 README 的提醒
const ORDER_REQUIREMENTS = 992; // 开发者要求清单（提交前逐条核对）

/**
 * 插件应用入口（DSH 调用）。
 * @param {object} ctx DSH 上下文（提供 inject / tools / http / log）
 * @param {object} [config] 插件配置
 */
export async function apply(ctx, config = {}) {
  const cfg = resolveConfig(config);
 // 【原实现·历史】早前以为 ctx.log 是服务属性、未 inject 直读会抛，故改用 ctx.get('log')：
  // "cannot get property \"log\" without inject" 导致插件树加载失败、实例退出。
  //   实测（0.1.6 / 0.2.0）宿主并无 log 服务 → 该读法恒 undefined（见下方修正）。
  // 【修复】日志句柄：cordis 的 logger 是**内置属性** `ctx.logger`，不是服务——
  //   宿主（0.1.6 与 0.2.0 均实测）**没有名为 log 的服务**，`ctx.get('log')` 恒 undefined，
  //   于是插件所有日志（接线信息、job 降级原因）被静默丢弃、排障时什么都看不到。
  //   改为优先取内置 logger（属性读取包 try/catch 兜底），再退回 get('log') 兼容旧宿主。
  let log;
  try { log = ctx?.logger; } catch { /* 属性读取异常忽略 */ }
  if (!log && typeof ctx?.get === 'function') {
    try { log = ctx.get('log'); } catch { /* 无 log 服务 */ }
  }
  const env = {
    version: VERSION,
 // 【修复 】ctx.workspaceRoot 同为 cordis 服务属性，直读抛 without inject；
    // 与 ctx.log 一样改 ctx.get() 防御式读取（缺失返回 undefined，回退到空串）。
    workspaceRoot: config.workspaceRoot || ctx?.get?.('workspaceRoot') || '',
    extraRepos: String(config.extraRepos || '').split(',').map((str) => str.trim()).filter(Boolean),
    extraReposFile: String(config.extraReposFile || ''),
  };

  // 1) agent 工具：ctx.inject(['tools']) → get('tools').register(defineTool(spec))
  //    defineTool 动态加载：工作区自测环境没有 DSH 依赖，装在 profile 内必可解析。
  const defineTool = await loadDefineTool(log);
  // 宿主官方后台 job 服务（dsh-jobs-local）：ctx.get 防御式读取，缺失时 git_commit_push 同步执行
  const jobs = ctx?.get?.('jobs');
  const toolCount = registerTools(ctx, {
    defineTool,
    tools: listTools(),
    // 透传 exec（宿主执行工具时注入 exec.agent）——callTool 用它作 jobs.start 的
    //   owner（owner 对上了 scoped job 控制器才会放行，否则 start 抛 no controller serves）。
    invoke: (toolName, args, exec) => callTool(toolName, args, env, cfg, log, jobs, exec),
    log,
  });

  // 2) 系统提示词注入：callback 体内必须调用 section()（返回值不是注册）；text 必须同步
  //
  // 改造：总开关 injectSystemPrompt（侧边栏可勾，默认开）控制整组注入；
  // 环境段迁出：运行环境（工作区目录 + 工具安装路径 + skill 总入口）改走
  //   上下文注入（agent/pre-step，见下方 2.5 步），systemPrompt 只留三段：
  //   ①功能用法（990，每个工具怎么用 + 凭据由插件托管，治「不用插件到处找凭据」）
  //   ②提交前 README 提醒（991）+ 开发者要求清单（992，挂审计子开关）
  //   只注入目录/路径级信息，不注入 skill 正文、不列 skill 文件清单。
  //
  // 环境注入惰性缓存：探测（which + git rev-parse）是同步 spawn，首次注入时算一次，
  //   避免每次读上下文都 spawn 一轮；开关切换时清缓存重算。
  // 缓存按 root 键化（Map<root, text>）——注入 cwd 现在优先取**会话工作区**
  //   （agent.session.header.cwd），不同会话/agent 的工作目录不同，不能共用单条缓存。
  let envInjectCache = null;
  // @param {string} [cwdOverride] 会话工作区（agent.session.header.cwd，宿主 sandbox-policy 同源真源）；
  //   空 = 回退宿主全局 workspaceRoot（=DSH 安装根）
  const envInjectText = (cwdOverride) => {
    if (!cfg.injectSystemPrompt) return '';
    const root = cwdOverride || env.workspaceRoot || process.cwd();
    if (envInjectCache instanceof Map && envInjectCache.has(root)) return envInjectCache.get(root);
    let text = '';
    try {
      // 工具清单：lib/tool-probes.json 模板（只 key，跨平台裸名）→ which/where 实测
      //   （Windows 自动补 .exe）→ 结果落盘运行目录 <配置目录>/tools.json
      //   （工具为 key、值为本机实测路径，不入库、可热改）。
      const toolsFile = join(credentialsDir({ workspaceRoot: env.workspaceRoot }), 'tools.json');
      const tools = collectToolPaths(null, { resultFile: toolsFile });
      // cwd 一并传 root：git 根探测 / 子目录列举都发生在会话工作区，而不是宿主进程 cwd
      const workspace = mapWorkspaceDirs({ workspaceRoot: root, cwd: root });
      text = createEnvInjectionText({
        cwd: root,
        projectRoot: workspace.projectDir || root,
        tools,
        workspace,
      });
    } catch (e) {
      // 探测失败降级为静态工具清单（注入不因探测异常而中断）
      log?.warn?.(`环境注入探测失败，降级静态清单：${e?.message || e}`);
      text = createEnvInjectionText({ cwd: root, projectRoot: root });
    }
    if (!(envInjectCache instanceof Map)) envInjectCache = new Map();
    envInjectCache.set(root, text);
    return text;
  };

  const sectionCount = registerContext(ctx, {
    sections: [
      // 功能用法（插件每个工具怎么用 + 凭据托管说明）
      { name: 'dsh-git-push-usage', order: ORDER_USAGE, text: () => (cfg.injectSystemPrompt ? (cfg.injectUsageText || FUNCTION_USAGE_HINT) : '') }, // injectUsageText 配置覆盖默认注入文本
      { name: 'dsh-git-push-readme-check', order: ORDER_README_CHECK, text: () => (cfg.injectSystemPrompt ? README_CHECK_HINT : '') },
      // 开发者要求清单（子开关：注入总开关 且 提交前审计 且 injectRequirements 才注入）
      { name: 'dsh-git-push-requirements', order: ORDER_REQUIREMENTS, text: () => (cfg.injectSystemPrompt && cfg.auditEnabled && cfg.injectRequirements ? buildRequirementsInjectionText() : '') },
    ],
    log,
  });

  // 2.5) 上下文注入（agent/pre-step）：环境信息（工作区目录 + 工具安装路径 + skill 总入口）
  //   每个 agent 首次 step 注入一次 user 消息（参考 dsh-skill-scoreboard v1.4.0 时机与形态：
  //   WeakSet 防重复 + createUserMessage 追加 + source 标记 plugin instructions）。
  //   总开关 injectSystemPrompt 同时门控（关=完全不注入，含此通道）。
  const preStepWired = registerPreStepInjection(ctx, { envInjectText, log });

  // 3) HTTP API：ctx.inject(['webServer']) → register({kind:'prefix', path, handler})
  const httpWired = registerHttp(ctx, {
    path: '/api/git-push',
    // 把宿主 jobs 传进 env（repos-local 等重端点用它做后台扫描，避免卡前台）
    handler: (req, res) => adaptHttpHandler(req, res, { ...env, jobs }, cfg),
    log,
  });

  // 4) 设置命名空间：settings.register('git-push') —— Host 必须注册命名空间，
  //    配置卡（settings.plugin.item key=git-push）才会与 Host 命名空间相交显示
 // （学 v1 plugin-setup.js registerSettings；补，此前配置卡空白根因）。
  // 设置持久化**不写公共 settings.yaml**（跨实例写锁竞争 + client isLoopback=memory
  //   陷阱，见 settings-bridge.js 头部）——插件私有 config.json 才是持久化真源。
  //   启动时先 merge config.json 进运行期 cfg（注入/审计设置重启保持）；
  //   宿主 scope 仅用于让「设置 → 插件配置」卡与 Host 命名空间相交显示，不再承担持久化。
  try {
    const fileSettings = readSettings({ workspaceRoot: env.workspaceRoot }) || {};
    // config.json → cfg 字段映射用共用函数（applySettingsToCfg，与 watch/HTTP
    //   settings-set 同一张映射表，避免三处重复漂移）
    const changed = applySettingsToCfg(cfg, fileSettings);
    // 配置化：注入系统提示词内容可配——config.json 的 injectUsageText（数组/字符串）覆盖默认功能用法注入文本
    if (typeof fileSettings.injectUsageText === 'string' && fileSettings.injectUsageText.trim()) {
      cfg.injectUsageText = fileSettings.injectUsageText;
    } else if (Array.isArray(fileSettings.injectUsageText) && fileSettings.injectUsageText.length) {
      cfg.injectUsageText = fileSettings.injectUsageText.join('\n');
    }
    if (changed.changedSystemPrompt) envInjectCache = null;
  } catch (e) {
    log?.warn?.(`config.json 设置回读跳过：${e?.message || e}`);
  }
  // 4) 设置命名空间接线（版本自适应 · 特性检测自动切换）
  //   ⚠️ 关键：inject 回调是「稍后异步执行」的，外层 try/catch 只包住注册调用、包不住回调体
  //   内的异常（这正是此前失败被吞成一条 warn、不进启动失败列表的根因）→ 回调体自带
  //   try/catch 并同时 console.error，保证接线失败一定可见。
  try {
    ctx.inject(['settings'], (settingsCtx) => {
      try {
      // 【2026-10-02 · DSH 0.2.0-rc.2 适配】0.2.0 删除了 settings.register / settings.get：
      //   settings 服务改为 SettingsForms（describe/update/replace/mutate/configure），命名空间
      //   由 Loader 条目派生（ns = 行 id，schema = 入口导出的 Config），无需命令式注册。
      //   同款死法见 dsh-context-budget：TypeError: ctx.settings.register is not a function。
      //   本插件设置/凭据真源是私有 config.json（settings-bridge），宿主命名空间只用于让
      //   「设置 → 插件配置」卡与命名空间相交显示 → 两条分支都保留，旧宿主行为完全不变。
      const settings = settingsCtx.settings;
      // ── 0.2.0 分支：SettingsForms（无 register / 无 get / 无 watch）──
      if (typeof settings?.register !== 'function') {
        // ① 自带设置页（settings.section）→ 关闭宿主按 schema 自动生成表单（官方推荐写法）
        try {
          settings?.configure?.({ auto: false }, ctx.fiber);
        } catch (e) {
          log?.warn?.(`settings.configure 跳过：${e?.message || e}`);
        }
        // ② 凭据只读同步（等价旧 scope.get() 那段）：0.2.0 无 get()，改从 describe() 找自己的
        //    命名空间——ns 优先旧名 'git-push'，兜底 0.2.0 行 id 'dsh-git-push'，再兜底按值
        //    特征（含 githubToken/sshPub）匹配；找不到就跳过，绝不阻断 apply。
        try {
          const rows = settings?.describe?.() || [];
          const own = rows.find((r) => r?.ns === GIT_PUSH_SETTINGS_NS || r?.ns === 'dsh-git-push'
            || (r?.value && typeof r.value === 'object' && ('githubToken' in r.value || 'sshPub' in r.value)));
          const init = own?.value || {};
          if (typeof init.githubToken === 'string') cfg.githubToken = init.githubToken;
          if (typeof init.sshPub === 'string') cfg.sshPub = init.sshPub;
        } catch (e) {
          log?.warn?.(`0.2.0 命名空间凭据读取跳过：${e?.message || e}`);
        }
        // ③ 不做 watch：SettingsForms 无 watch；凭据落盘仍走 config.json + HTTP settings-set
        return;
      }
      // ── 0.1.x 分支：宿主仍提供 register，走原逻辑（原代码原样保留）──
      const scope = settings.register(GIT_PUSH_SETTINGS_NS, Config, { base: defaultConfig() });
      // 初始同步一次（watch 不会立即回调）：重启后第一次加载即拿到已保存的 token/SSH 公钥，
      // 账号检查端点才能用设置页保存的凭据判断（修复误判未登录根因）
      try {
        const init = scope.get() || {};
        if (typeof init.githubToken === 'string') cfg.githubToken = init.githubToken;
        if (typeof init.sshPub === 'string') cfg.sshPub = init.sshPub;
      } catch (e) {
        log?.warn?.(`初始同步设置凭据跳过：${e?.message || e}`);
      }
      scope.watch(async (next) => {
        if (!next || typeof next !== 'object') return;
        // watch **只处理凭据**。开关/扫描范围/权重真源是插件私有
        //   config.json（启动 merge + HTTP settings-set）。yaml 缺键时 schema 默认
        //   injectRequirements=false，若把 yaml 整包灌进 cfg 会把 HTTP 刚写入的
        //   true 盖回去——开关点了不对的根因。
        if (typeof next.githubToken === 'string' && next.githubToken.trim()) {
          cfg.githubToken = next.githubToken.trim();
          const r = persistGithubToken(next.githubToken, { workspaceRoot: env.workspaceRoot });
          if (!r.ok) log?.warn?.(`dsh-git-push token 持久化失败: ${r.error || r}`);
        }
        if (typeof next.sshPub === 'string' && next.sshPub.trim()) {
          cfg.sshPub = next.sshPub.trim();
          const r = persistSshPub(next.sshPub, { workspaceRoot: env.workspaceRoot });
          if (!r.ok) log?.warn?.(`dsh-git-push SSH 公钥持久化失败: ${r.error || r}`);
        }
      });
      } catch (e) {
        log?.warn?.(`settings 命名空间接线跳过：${e?.message || e}`);
        console.error('[dsh-git-push] settings 接线失败：', e);
      }
    });
  } catch (e) {
    log?.warn?.(`settings 命名空间接线跳过：${e?.message || e}`);
    console.error('[dsh-git-push] settings 接线失败：', e);
  }

  // 5) 用户输入框斜杠命令：ctx.inject(['commands']) → /git-audit（人直接跑审计，不进模型）
  const slashCount = registerSlashCommands(ctx, { env, cfg, log });

  // 5.5) 任务完成自动推送（内置自 dsh-task-completion）：监听回合结束，
  //   检测 AI 回复「✅任务完成」（UI 可自定义），autoPushEnabled 开启时自动 commit+push
  //   交付物（复用 commitWithAudit 完整门禁——审计 blocker 拦截 / requirements / pushGate，
  //   绝不裸提交绕过门禁）。开关/触发文本/范围经 config.json 持久化（settings-bridge 读回）。
  const autoPush = registerAutoPush(ctx, {
    cfg,
    // 触发后记录最近一次自动推送结果（写入 config.json 供 UI/状态查询，evidence）
    onPushAfterCommit: (outcome) => {
      try {
        writeSettingsKey('autoPushLast', outcome, { workspaceRoot: env.workspaceRoot });
      } catch { /* 记录失败不影响自动推送 */ }
    },
  });

  // 6) 客户端（设置卡片/侧边栏）不在 Host 注册：DSH 依据 package.json 的
  //    dsh.client + exports["./client"] 自动发现 client.js。

  log?.info?.(`dsh-git-push v${VERSION} 已接线（工具 ${toolCount} 个 / 注入 ${sectionCount} 段 + ${preStepWired ? '上下文注入' : '上下文注入未接'} / HTTP ${httpWired ? '已注册' : '未注册'} / 斜杠 ${slashCount}；审计默认${cfg.auditEnabled ? '开' : '关'} / 自动推送${autoPush.enabled ? '开（触发: ' + autoPush.trigger + '）' : '关'}）`);
 // 【修复 】cordis 的 apply 返回值只能是 disposer 函数 / Promise / undefined；
  // 返回普通对象会抛 "Invalid effect" 导致插件树加载失败。插件内部注册均走 ctx.inject，
  // 生命周期由 cordis 管理，因此 apply 返回 undefined（标准写法）。
  return;
}
