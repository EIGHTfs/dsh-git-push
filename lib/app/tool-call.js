/**
 * 插件入口层 · 工具调用分发
 *
 * callTool 把宿主的工具调用分发到各能力（审计/推送/扫描/账号…），
 *   readTextSafe 是它的读文件兜底（不存在返回空串而非抛错）。
 * 与 HTTP 处理分开：两条入口（工具 / HTTP）的鉴权与返回形态完全不同。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditWithScope, auditFull, summarize } from '../audit/index.js';
import { scoreQuality } from '../score/index.js';
import {
  cloneViaApi, ensureRemoteRepo, setVisibility, maintainRepoIndex, resolveToken, commitAndPush,
  scanRepos, checkGithubAccount, formatGithubAccountBlock, generateSshKey, persistSshPub,
} from '../git/index.js';
import { runAudit } from '../commit-push.js';
import { defaultConfig } from '../client/index.js';
import { checkLinks, sumLinkPenalty } from '../link-check/index.js';
import { genReadme } from '../readme-gen/index.js';
import { MSG_REPO_REQUIRED } from './constants.js';
import { formatAuditBlock } from './inject-text.js';
import { setLastSlotHitStats } from './slot-stats.js';
import { getDefaultScanRoot } from './scan-root.js';

/**
 * 工具调用分发（薄适配：参数 → 总入口函数）。
 * @param {string} toolName
 * @param {object} args
 * @param {object} env { workspaceRoot, extraRepos }
 * @param {object} cfg 插件配置
 * @param {object} [log]
 * @param {object} [jobs] 宿主 ctx.jobs（dsh-jobs-local 提供）；缺省时 commit+push 同步执行
 * @returns {Promise<object>}
 */
export async function callTool(toolName, args = {}, env = {}, cfg = defaultConfig(), log = null, jobs = null) {
  switch (toolName) {
    case 'git_scan': {
      const root = args.root || getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
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
      // 2026-09-15 后台化（官方 job）：审计同步即时拦截（保住提交门禁），
      //   blocker 命中 → 立即返回拦截、不执行任何 git 操作；审计通过 → commit+push
      //   +索引重建注册为宿主官方后台 job（ctx.jobs，dsh-jobs-local），工具立即返回
      //   jobId（如 git-push-1），AI 用宿主自带 job_output/job_list/job_kill 查询。
      const auditGate = runAudit({
        repoPath: repo,
        audit: args.audit,
        auditLevel: args.auditLevel,
        rulesetDir: args.ruleset,
        slots: cfg.auditRuleOrder && cfg.auditRuleOrder.length ? cfg.auditRuleOrder : undefined,
        cfg,
      });
      if (!auditGate.ok) return auditGate; // { ok:false, blocked:true, audit }
      const doPush = async () => {
        const r = await commitAndPush({
          repoPath: repo,
          message: args.message,
          push: args.push !== false,
          dryRun: args.dryRun === true,
          customIgnorePatterns: args.ignorePatterns || '',
          requirementsConfirmed: args.requirementsConfirmed === true,
          force: args.force === true,
          pushMethod: cfg.pushMethod || 'ssh',
        });
        if (r?.ok && r?.pushed) {
          try {
            await maintainRepoIndex({
              workspaceRoot: env.workspaceRoot,
              token: resolveToken({ workspaceRoot: env.workspaceRoot }).token,
              owner: r.push?.owner || 'EIGHTfs',
            });
          } catch { /* 索引重建失败静默，不阻塞任务结果 */ }
        }
        return r;
      };
      // 宿主未提供 ctx.jobs（如脱离 DSH 的 CLI/测试环境）→ 同步执行保底
      if (!jobs || typeof jobs.start !== 'function') {
        const r = await doPush();
        return { ok: true, async: false, result: r };
      }
      const jobId = jobs.start({
        kind: 'git-push',
        label: `commit+push ${repo}`,
        run: () => {
          const done = (async () => {
            try {
              const r = await doPush();
              return { status: 'completed', detail: 'commit+push done', output: JSON.stringify(r) };
            } catch (e) {
              return { status: 'failed', detail: String((e && e.message) || e) };
            }
          })();
          return { cancel: () => {}, done };
        },
      });
      return { ok: true, async: true, jobId, audit: auditGate.audit, hint: '已注册宿主后台 job，用 job_output ' + jobId + ' 查询结果' };
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
      const auditOpts = { scope: 'diff', rulesetDir: args.ruleset || '', auditLevel: level, maxScanFiles: cfg.maxScanFiles, slots: cfg.auditRuleOrder && cfg.auditRuleOrder.length ? cfg.auditRuleOrder : undefined, disabledSlots: Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [], includeIgnored: args.includeIgnored === true };
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
