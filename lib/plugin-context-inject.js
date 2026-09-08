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

/** 通道 A：systemPrompt 注入（A1 功能目录 + A3 README 检查 + A2 环境注入带 60s 缓存）。 */
export function registerContextInjection(ctx, env) {
  const { config, log, workspaceRoot } = env;
  const injectedAgents = new WeakSet();
  // A) 系统提示词通道（systemPrompt.section）——每步组装都生效，强制注入，不受设置影响：
  //    A1) 插件功能目录精简注入（v1.32.0）：collectFunctionManual() 返回短目录，不塞全文。
  //    A2) 环境注入（v1.28.1，由 pre-step 迁移）：工作目录映射 + 工具安装路径
  //        （注入用户环境和工具目录用系统提示词，其他保持不变）。
  //        text 函数带 60s 缓存：systemPrompt 每步组装都会调用，避免每步重新 spawnSync 探测；
  //        缓存过期时重新探测并同步 tools-index.md 到插件配置目录（v1.40.0 原同级仓废除）。
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
  let envCache = { key: '', at: 0, dirsText: '', toolsText: '' };
  const getEnvInjectionText = () => {
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
  const envInjectionOn = config.envInjectionEnabled !== false;
  if (envInjectionOn) {
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

  // B) agent/pre-step 钩子（user 消息，仅首次注入，避免每步重复烧 token）：
  //    1) 两仓 skill 注入（v1.40.0）：injectFullSkill=true 注全文，默认只注入目录清单。
  //    2) dsh-repo-index JSON（v1.35.0）：默认只注入文件名；injectRepoIndexFull=true 注入正文。
  //    3) 设备/用户 json 脱敏注入已移除（v1.38.0）。
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
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
  });
}
