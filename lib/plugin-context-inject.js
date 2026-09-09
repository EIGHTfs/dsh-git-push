/**
 * dsh-git-push — 上下文注入（v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * 通道 A：systemPrompt.section——功能目录（A1）/ README 检查提醒（A3）/ 环境注入（A2，60s 缓存）。
 * 通道 B：agent/pre-step——两仓 skill 注入 + dsh-repo-index 注入（每 agent 仅首次）。
 */
import { name } from './plugin-config.js';
import { collectRepoSkillDocs, formatRepoSkillInjection, collectRepoSkillDirs, formatRepoSkillDirsInjection, collectFunctionManual } from './core.js';
import { formatRepoIndexInjection } from './repo-index.js';
import { buildEnvInjection, buildEnvInjectionWithTools, ensureToolsIndexFile } from './env-inject.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

/** A1+A3：systemPrompt 固定 section——功能目录（990）+ README 检查提醒（991）。 */
function registerSystemPromptSections(ctx, log) {
  ctx.inject(['systemPrompt'], (sctx) => {
    try {
      sctx.get('systemPrompt').section({
        name: 'dsh-git-push-functions',
        order: 990,
        text: () => collectFunctionManual(),
      });
    } catch (e) {
      log.warn(`功能说明书 systemPrompt 注入失败: ${e?.message || e}`);
    }
    try {
      sctx.get('systemPrompt').section({
        name: 'dsh-git-push-readme-check',
        order: 991,
        text: () => [
          '【dsh-git-push 提交前提醒】每次调用 git_commit_push 前必须检查该仓库 README：',
          '功能表 / 版本记录 / 用法是否与本次改动一致。需要更新则先改 README 再提交',
          '（可用 git_gen_readme 按模板生成）。不要把过时 README 推进远端。',
        ].join(''),
      });
    } catch (e) {
      log.warn(`README 检查注入 systemPrompt 失败: ${e?.message || e}`);
    }
  });
}

/** A2 环境注入文本 provider（60s 缓存 + tools-index.md 同步）。config/log 传引用保持运行期即时生效。 */
function createEnvInjectionTextProvider({ workspaceRoot, config, log }) {
  let envCache = { key: '', at: 0, dirsText: '', toolsText: '' };
  return () => {
    const key = workspaceRoot;
    const now = Date.now();
    if (envCache.key === key && now - envCache.at < 60_000 && envCache.dirsText) {
      return [envCache.dirsText, envCache.toolsText].filter(Boolean).join('\n\n');
    }
    try {
      const customNames = (config.envInjectionTools || '').split(',').map((s) => s.trim()).filter(Boolean);
      const env2 = customNames.length
        ? buildEnvInjectionWithTools(customNames, { workspaceRoot })
        : buildEnvInjection({ workspaceRoot, probeTools: true });
      envCache = { key, at: now, dirsText: env2.dirsText, toolsText: env2.toolsText };
      try {
        const saved = ensureToolsIndexFile({ workspaceRoot, tools: env2.tools });
        if (saved.ok) log.info(`tools-index.md 已同步 → ${saved.file}`);
        else log.warn(`tools-index.md 写入失败: ${saved.error}`);
      } catch (e) {
        log.warn(`tools-index.md 写入异常: ${e?.message || e}`);
      }
      return [env2.dirsText, env2.toolsText].filter(Boolean).join('\n\n');
    } catch (e) {
      log.warn(`环境注入失败: ${e?.message || e}`);
      return '';
    }
  };
}

/** A2：环境注入 systemPrompt section 注册（config.envInjectionEnabled !== false 才启用）。 */
function registerEnvInjectionSection(ctx, { workspaceRoot, config, log }) {
  const envInjectionOn = config.envInjectionEnabled !== false;
  if (!envInjectionOn) return;
  const getEnvInjectionText = createEnvInjectionTextProvider({ workspaceRoot, config, log });
  ctx.inject(['systemPrompt'], (sctx) => {
    try {
      return sctx.get('systemPrompt').section({
        name: 'dsh-git-push-env',
        order: 980,
        text: () => getEnvInjectionText(),
      });
    } catch (e) {
      log.warn(`环境注入 systemPrompt 失败: ${e?.message || e}`);
    }
  });
}

/**
 * B：agent/pre-step handler——两仓 skill 注入 + dsh-repo-index 注入（user 消息，每 agent 仅首次，
 * 避免每步重复烧 token）。env 传引用：injectFullSkill / repoIndexSyncTarget / injectRepoIndexFull
 * 在事件运行期读取，settings watch 改写即时生效。
 */
function createPreStepHandler({ env, log, workspaceRoot, injectedAgents }) {
  return async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind === 'reject') return decision;
    if (signal?.aborted) return decision;
    if (injectedAgents.has(agent)) return decision;
    injectedAgents.add(agent);
    const blocks = [];
    // 1) 两仓 skill 注入：按 injectFullSkill 开关选择「全文注入」或「目录清单注入」。
    //    「其实我只想注入skill目录」→ 默认只列清单；2026-09-07恢复全文注入为可选。
    if (env.injectFullSkill) {
      const docs = collectRepoSkillDocs({ workspaceRoot });
      const text = formatRepoSkillInjection(docs);
      if (text) {
        blocks.push(text);
        log.info(`已注入两仓 skill 全文 ${docs.length} 篇（injectFullSkill=true）`);
      }
    } else {
      const dirs = collectRepoSkillDirs({ workspaceRoot });
      const text = formatRepoSkillDirsInjection(dirs);
      if (text) {
        blocks.push(text);
        log.info(`已注入两仓 skill 目录 ${dirs.length} 个（injectFullSkill=false，只列清单）`);
      }
    }
    // 2) dsh-repo-index JSON：md 表格已废弃。默认只注入文件名，勾选才注入正文。
    try {
      const idxText = formatRepoIndexInjection({
        workspaceRoot,
        syncTarget: env.repoIndexSyncTarget,
        full: env.injectRepoIndexFull,
      });
      if (idxText) {
        blocks.push(idxText);
        log.info(`已注入 dsh-repo-index.json（full=${env.injectRepoIndexFull}）`);
      }
    } catch (e) {
      log.warn(`dsh-repo-index 注入失败: ${e?.message || e}`);
    }
    // 3) 环境注入已迁移到 systemPrompt.section（见上方 A2）——工作目录映射 + 工具路径每步组装生效
    // v1.38.0：移除「设备/用户 json 注入」（原 v1.27.0）——凭据类信息不该由 git-push 注入，
    // 该职责不属于提交推送插件；需要设备/站点导航信息时由会话插件/模板注入另行处理。
    if (!blocks.length) return decision;
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text: blocks.join('\n\n') }],
          source: { kind: 'plugin', plugin: name, form: 'instructions' },
        }),
      ],
    };
  };
}

/** 通道 A：systemPrompt 注入（A1 功能目录 + A3 README 检查 + A2 环境注入带 60s 缓存）。 */
export function registerContextInjection(ctx, env) {
  const { config, log, workspaceRoot } = env;
  const injectedAgents = new WeakSet();
  registerSystemPromptSections(ctx, log);
  registerEnvInjectionSection(ctx, { workspaceRoot, config, log });
  ctx.on('agent/pre-step', createPreStepHandler({ env, log, workspaceRoot, injectedAgents }));
}