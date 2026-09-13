/**
 * 插件入口层 · apply（插件装载入口）
 *
 * 宿主加载插件时调用：注册配置 schema、注册工具、注册 HTTP 路由、注册注入钩子。
 * 本模块只做「注册编排」，具体处理逻辑在 handlers.js，工具声明在 tools.js。
 */

import { VERSION } from '../self/index.js';
import { persistGithubToken, persistSshPub } from '../git/index.js';
import { createEnvInjectionText } from '../context/index.js';
import { defaultConfig, resolveConfig } from '../client/index.js';
import { loadDefineTool, registerTools, registerContext, registerHttp } from '../plugin/index.js';
import { GIT_PUSH_SETTINGS_NS, name } from './constants.js';
import { adaptHttpHandler } from './http-handlers.js';
import { README_CHECK_HINT, buildRequirementsInjectionText } from './inject-text.js';
import { Config } from './schema.js';
import { callTool } from './tool-call.js';
import { listTools } from './tools.js';

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
      // 开发者要求清单（子开关：提交前审计开启 且 injectRequirements 开启才注入）
      { name: 'dsh-git-push-requirements', order: 992, text: () => (cfg.auditEnabled && cfg.injectRequirements ? buildRequirementsInjectionText() : '') },
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
        if (typeof next.injectRequirements === 'boolean') cfg.injectRequirements = next.injectRequirements;
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
