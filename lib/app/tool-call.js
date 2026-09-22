/**
 * 插件入口层 · 工具调用分发
 *
 * callTool 把宿主的工具调用分发到各能力（审计/推送/扫描/账号…），
 *   readTextSafe 是它的读文件兜底（不存在返回空串而非抛错）。
 * 与 HTTP 处理分开：两条入口（工具 / HTTP）的鉴权与返回形态完全不同。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { auditWithScope, auditFull, summarize } from '../audit/index.js';
import { scoreQuality } from '../score/index.js';
import {
  cloneViaApi, previewClone, ensureRemoteRepo, setVisibility, maintainRepoIndex, updateRepoIndex, resolveToken, commitAndPush,
  scanRepos, checkGithubAccount, formatGithubAccountBlock, generateSshKey, persistSshPub,
  refreshAccountStatus,
} from '../git/index.js';
import { runAudit } from '../commit-push.js';
import { defaultConfig } from '../client/index.js';
import { checkLinks, sumLinkPenalty } from '../link-check/index.js';
import { scanFileIo } from '../../scripts/scan-file-io.mjs';
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
export async function callTool(toolName, args = {}, env = {}, cfg = defaultConfig(), log = null, jobs = null, exec = null) {
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
      const auditGate = await runAudit({
        repoPath: repo,
        audit: args.audit,
        // 2026-09-17：不再透传 auditLevel——审计固定走完整流程（正则初筛 + AST 语义检查）
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
          // 2026-09-17：推送门禁——开启时 push 需显式放行（pushConfirmed:true）；未放行返回 PUSH_GATE 拦截
          pushGate: cfg.pushGate === true,
          pushConfirmed: args.pushConfirmed === true,
          // 2026-09-21：精确 add 路径（逗号分隔，相对 repo）；空 = git add -A 全量
          paths: String(args.paths || ''),
        });
        if (r?.ok && r?.pushed) {
          try {
            // 2026-09-20：统一走 updateRepoIndex（mode='rebuild' 合并不全量覆盖），
            //   返回 indexUpdated 随工具结果透传（AI/UI 可据此触发列表重读）
            const idx = await updateRepoIndex({
              workspaceRoot: env.workspaceRoot,
              token: resolveToken({ workspaceRoot: env.workspaceRoot }).token,
              owner: r.push?.owner || 'EIGHTfs',
              mode: 'rebuild',
            });
            if (idx?.ok) r.indexUpdated = true;
          } catch { /* 索引重建失败静默，不阻塞任务结果 */ }
          // 2026-09-16：推送成功顺便验证账号并刷新 account-status.json（token/ssh 有效性）——
          //   与本地仓库索引同一时机，fire-and-forget，失败静默。
          try {
            await refreshAccountStatus({ workspaceRoot: env.workspaceRoot });
          } catch { /* 账号状态刷新失败静默 */ }
        }
        return r;
      };
      // 宿主未提供 ctx.jobs（如脱离 DSH 的 CLI/测试环境）→ 同步执行保底
      if (!jobs || typeof jobs.start !== 'function') {
        const r = await doPush();
        return { ok: true, async: false, result: r };
      }
      // 2026-09-15 修复：job 控制器**存在但不对当前执行主体服务**时，jobs.start() 会抛
      //   「no job controller serves this agent」——此前未捕获 → 工具报错退出、无法降级，
      //   结果只能人工手推（实测：宿主组合里 dsh-tool-jobs 未挂载到执行会话，start 即抛）。
      //   现在捕获该异常回退同步执行（与「无 ctx.jobs」同一保底路径）。
      // 2026-09-16 追加：**必须把 owner 传给 jobs.start**——servesOwner 按 owner 的 scope 链
      //   找控制器（tool-jobs 挂在执行会话组合 = scoped 控制器），不传 owner（undefined）时只查
      //   全局层控制器，scoped 控制器不服务 unowned 任务 → 仍抛错。exec.agent 即当前执行主体。
      let jobId;
      try {
        const spec = {
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
        };
        // exec.agent 缺失（CLI/测试环境）时不传 owner（unowned，仍走全局控制器或降级）
        if (exec?.agent) spec.owner = exec.agent;
        jobId = jobs.start(spec);
      } catch (e) {
        // 控制器不可用 → 同步执行降级（同一 doPush，幂等安全）
        log?.warn?.(`ctx.jobs 不可用，git_commit_push 降级同步执行：${e?.message || e}`);
        const r = await doPush();
        return { ok: true, async: false, jobFallback: true, result: r };
      }
      return { ok: true, async: true, jobId, audit: auditGate.audit, hint: '已注册宿主后台 job（结果完成会自动返回，无需特意查询）；如需主动查：job_output ' + jobId };
    }
    case 'code_audit': {
      const repo = args.repo;
      if (!repo) return { ok: false, error: MSG_REPO_REQUIRED };
      let weights = {};
      // 2026-09-15 修复：权重来源 = 工具参数显式传参 > 侧边栏保存的 cfg.weightOverrides（config.json
      //   回读）> 默认权重表。此前只认 args.weights——侧边栏权重设置保存了但审计完全无视（假保存）。
      const weightSrc = args.weights || (typeof cfg.weightOverrides === 'string' ? cfg.weightOverrides : '');
      if (weightSrc) {
        try { weights = JSON.parse(weightSrc); } catch { /* 非法 JSON 回退默认权重 */ }
      }
      // 2026-09-21：history 模式——历史提交审计（逐提交快照全量 + 落盘报告），宿主后台 job 串行；
      //   与 CLI `audit --history` 同一实现 runHistoryAudit；jobs 缺失/不服务时同步降级。
      if (args.history === true) {
        const { runHistoryAudit } = await import('../audit/history.js');
        const { resolveReportDir } = await import('../audit/history-report.js');
        const auditOpts = { scope: 'full', rulesetDir: args.ruleset || '', maxScanFiles: cfg.maxScanFiles, slots: cfg.auditRuleOrder && cfg.auditRuleOrder.length ? cfg.auditRuleOrder : undefined, disabledSlots: Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [], includeIgnored: args.includeIgnored === true };
        const reportDir = resolveReportDir(repo, args.outDir || '');
        const doHistory = async () => {
          const r = await runHistoryAudit(repo, { since: args.since, until: args.until, outDir: reportDir, auditOpts, weights });
          return { status: r.ok ? 'completed' : 'failed', detail: r.ok ? 'history audit done' : String(r.error || 'failed'), output: JSON.stringify(r) };
        };
        if (!jobs || typeof jobs.start !== 'function') {
          const r = await doHistory();
          return { ok: true, async: false, result: r, reportDir };
        }
        try {
          const spec = {
            kind: 'git-push',
            label: `history-audit ${repo}`,
            run: () => { const done = doHistory(); return { cancel: () => {}, done }; },
          };
          if (exec?.agent) spec.owner = exec.agent;
          const jobId = jobs.start(spec);
          return { ok: true, async: true, jobId, reportDir, hint: '历史审计后台 job 已注册（结果完成会自动返回，无需特意查询）；如需主动查：job_output ' + jobId };
        } catch (e) {
          const r = await doHistory();
          return { ok: true, async: false, jobFallback: true, result: r, reportDir };
        }
      }
      const auditOpts = { scope: 'diff', rulesetDir: args.ruleset || '', maxScanFiles: cfg.maxScanFiles, slots: cfg.auditRuleOrder && cfg.auditRuleOrder.length ? cfg.auditRuleOrder : undefined, disabledSlots: Array.isArray(cfg.auditDisabledSlots) ? cfg.auditDisabledSlots : [], includeIgnored: args.includeIgnored === true };
      const auditResult = args.scope === 'full' || !existsSync(join(repo, '.git'))
        ? await auditFull(repo, auditOpts)
        : await auditWithScope(repo, auditOpts);
      const summary = summarize(auditResult.findings);
      // 2026-09-16：0 文件（空目录/diff 0 变动）不评分——scoreQuality 返回 emptyResult 防满分
      const quality = scoreQuality(auditResult.findings, weights, { files: auditResult.files });
      // 2026-09-13：返回带 block 字段——审计结果直接格式化可读总结，AI 拿到后直接说给用户
      //   （不依赖 systemPrompt/pre-step 注入；对齐 git_account_check 的 block 模式）
      const block = formatAuditBlock({ repo, scope: auditResult.scope, summary, quality, docsScore: auditResult.docsScore });
      // 2026-09-13：缓存按规则包命中数供给 HTTP /rule-slots（侧边栏规则包列表显示实际命中数）
      if (auditResult.slotStats) setLastSlotHitStats(auditResult.slotStats, repo);
      log?.info?.(`code_audit ${repo} → ${quality.emptyResult ? '未评分(0 文件)' : quality.score + '/' + quality.level}（blocker ${summary.blocker} / warning ${summary.warning} / notice ${summary.notice}）`);
      return { ok: true, scope: auditResult.scope, files: auditResult.files, summary, quality, block, slotStats: auditResult.slotStats, findings: auditResult.findings, yaml: auditResult.yaml };
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
    case 'io_scan': {
      // 复用 scripts/scan-file-io.mjs（AST 四级分级，与审计 robustness/io-risk 同标准）
      //   不在此另写扫描逻辑，避免两套判定漂移。
      const root = args.repo || env.workspaceRoot;
      if (!root) return { ok: false, error: 'repo 必填（或用会话工作区）' };
      const hits = scanFileIo({
        targets: [root],
        writeOnly: args.writeOnly === true,
      });
      const byRisk = { high: 0, medium: 0, low: 0, safe: 0 };
      for (const h of hits) if (byRisk[h.risk] != null) byRisk[h.risk] += 1;
      const sync = hits.filter((h) => h.type === 'sync').length;
      return { ok: true, root, total: hits.length, sync, byRisk, items: hits };
    }
    case 'git_clone_preview': {
      if (!args.target) return { ok: false, error: 'target 必填' };
      return previewClone({
        target: args.target,
        branch: args.branch,
        token: resolveToken({ workspaceRoot: env.workspaceRoot }).token,
        maxFileMB: Number(cfg.maxCloneFileMB) || undefined,
      });
    }
    case 'link_check': {
      const path = args.path || env.workspaceRoot;
      const links = await checkLinks({ file: path, text: readTextSafe(path) });
      return { ok: true, count: links.length, penalty: sumLinkPenalty(links), findings: links };
    }
    case 'module_splitter': {
      // 巨型单文件拆分（复用 scripts/module-splitter.py，python3 零依赖）。
      // 与 cli.mjs cmdModuleSplitter 同一实现：参数数组 spawn（防注入），脚本相对插件根解析。
      const command = String(args.command || '').trim();
      if (!['analyze', 'split', 'verify'].includes(command)) {
        return { ok: false, error: `module_splitter command 应为 analyze|split|verify（得「${command}」）` };
      }
      const target = String((command === 'analyze' ? args.file : args.plan) || '').trim();
      if (!target) {
        return { ok: false, error: command === 'analyze' ? 'analyze 需要 file（待拆 .js 路径）' : `${command} 需要 plan（plan.json 文件路径）` };
      }
      if (!existsSync(target)) return { ok: false, error: `目标不存在：${target}` };
      const script = fileURLToPath(new URL('../../scripts/module-splitter.py', import.meta.url));
      const argv = [script, command, target];
      if (command === 'split' && args.dryRun === true) argv.push('--dry-run');
      const r = spawnSync('python3', argv, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
      if (r.error) {
        const msg = r.error.code === 'ENOENT' ? 'python3 不可用（module_splitter 依赖 python3 标准库）' : `执行失败: ${r.error.message}`;
        return { ok: false, error: msg };
      }
      if (r.status !== 0) {
        return { ok: false, status: r.status, error: String(r.stderr || r.stdout || '执行失败').trim().slice(0, 800) };
      }
      const output = String(r.stdout || '');
      return { ok: true, command, target, dryRun: argv.includes('--dry-run'), output };
    }
    case 'functions_index': {
      // 2026-09-23：函数索引/文档（analyze 生成 JSON / apply 生成 docs/函数/*.md）
      const { spawnSync } = await import('node:child_process');
      const { fileURLToPath } = await import('node:url');
      const cwd = process.cwd();
      if (args.op === 'apply') {
        const { applyFunctionsDocs } = await import('../../scripts/functions-doc.mjs');
        const r = applyFunctionsDocs(cwd, { skipEmpty: args.skipEmpty === true });
        return { ok: r.ok !== false, ...r };
      }
      // analyze：调 func-index 扫 target（缺省 cwd），输出 cwd/functions-index.json
      const dir = String(args.target || '').trim() || cwd;
      const script = fileURLToPath(new URL('../../scripts/func-index.js', import.meta.url));
      const outFile = join(cwd, 'functions-index.json');
      const r = spawnSync(process.execPath, [script, dir, '--out', outFile], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
      if (r.error) return { ok: false, error: `函数索引生成失败: ${r.error.message}` };
      return { ok: true, outFile, scanned: dir };
    }
    case 'git_account_check': {
      if (args.sshPub) persistSshPub(String(args.sshPub), { workspaceRoot: env.workspaceRoot });
      const accountInfo = await checkGithubAccount({ workspaceRoot: env.workspaceRoot, token: String(args.token || '') });
      return { ok: true, ...accountInfo, block: formatGithubAccountBlock(accountInfo) };
    }
    case 'git_cred_env': {
      // 2026-09-21：凭据传递——输出环境变量前缀（SSH 私钥路径 / HTTPS askpass 脚本），
      //   AI 执行任意外部 git 命令时粘贴使用，全程不输出 token/私钥明文。
      const { buildCredEnv } = await import('../git/cred-env.js');
      const r = buildCredEnv({ workspaceRoot: env.workspaceRoot });
      return { ok: true, ...r };
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
