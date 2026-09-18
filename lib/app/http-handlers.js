/**
 * 插件入口层 · HTTP 处理
 *
 * handleHttp（路由分发）、listRuleSlots（规则包列表端点）、
 *   adaptHttpHandler（把 handler 适配成宿主 HTTP 形态）。
 * 与工具调用分开：HTTP 走 host 的路由与状态码，工具走结构化返回。
 */

import { VERSION } from '../self/index.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  startCloneJob, updateCloneJob, finishCloneJob, setCloneJobPhase,
  cloneJobStatus, clearCloneJobResult, getPreview, setPreview,
} from '../git/clone-jobs.js';
import { spawn } from 'node:child_process';
import {
  scanRepos, checkGithubAccount, formatGithubAccountBlock, generateSshKey, persistSshPub,
  persistGithubToken, browseDir, listCloudRepos, pushCurrentBranch, cloneViaApi, resolveToken,
  previewClone,
  githubFetch, parseGithubOwnerRepo, describeRepo, liveRemoteHead, runGit, readSshPub,
  writeAccountStatusFromResult, accountStatusFile, readAccountStatus, refreshAccountStatus,
} from '../git/index.js';
import { readRepoIndexMap, indexEntryForRepo, maintainRepoIndex, mergeCloudReposIntoIndex, updateRepoRemoteStateInIndex } from '../git/repo-index.js';
import { runScan, waitScanDelta, readScanLive } from '../git/index.js';
import { getDefaultScanRoot } from './scan-root.js';
import { checkOrigin, checkBodySize, checkWriteConfirm, readJsonBody } from '../http/index.js';
import { defaultConfig } from '../client/index.js';
import { discoverRuleSlots, loadYamlRuleFile, resolveSlotOrder, setSlotDisabled, RULE_YAML_DIR } from '../rule/loader.js';
import { name } from './constants.js';
import { redactConfig } from './schema.js';
import { getLastSlotHitStats } from './slot-stats.js';
import { listTools } from './tools.js';
// 2026-09-14：设置读写桥（绕开 client isLoopback=memory 陷阱，host 侧 scope.update 真正落盘）
import { readSettings, writeSettingsKey, applySettingsToCfg, appendSettingsLog } from './settings-bridge.js';

/** 本地列表 SSH live 探测：整表共享预算 / 单仓「过慢即熔断」判定 / 扫描等待超时（毫秒）。 */
const LIST_LIVE_BUDGET_MS = 6_000;
const LIVE_SLOW_THRESHOLD_MS = 5_000;
const SCAN_WAIT_TIMEOUT_MS = 60_000;

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
  const httpResult = await handleHttp(
    { method: req?.method, url: req?.url, origin: req?.headers?.origin, headers: req?.headers, body },
    env,
    cfg,
  );
  if (!httpResult) return undefined;
  try {
    res.writeHead(httpResult.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(httpResult.body, null, 2));
  } catch { /* 响应已开始或连接已断：忽略 */ }
  return httpResult;
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
 *   已不再参与计算（2026-09-18 起一律用 yml 规则条数口径）；仅保留形参以兼容既有调用方。
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
      // 一律用 yml 规则条数口径（2026-09-18 变更）。
      //
      // 原先「有审计结果就用命中数」会产出**自相矛盾**的一行：blocker/warning 数的是
      //   命中**次数**（同一条规则可在多个文件各命中一次而累加），total 数的是规则**条数**，
      //   两者量纲不同却同排对比——实测 nodejs 显示 245 警告 / 37 总规则，245 > 37 一眼即知有假；
      //   filehealth 5/1、performance 7/2 同样越界。侧边栏是「规则包有哪些规则、各多少条」的
      //   静态清单，用规则条数才是自洽且不会随审计与否跳变的口径。
      //   hitStats 参数保留在签名里（调用方与旧测试仍传），但不再参与计算。
      const stats = {
        blocker: ruleBlocker,
        warning: ruleWarning,
        pass: Math.max(0, ruleCount - ruleBlocker - ruleWarning),
        total: ruleCount,
        source: 'rules',
      };
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

/**
 * 把 account-status.json 的 ISO 时间格式化为「本地可读」的上次成功登录时间。
 * 2026-09-17 新增：账号卡片此前写死「离线快照」，改为显示真实时间——
 *   时间来源 = 快照 checkedAt（推送成功 / 手动「重新检测」会刷新它）。
 * @param {string} iso ISO 8601 时间串（空/非法 → 返回空串，调用方据此省略该段）
 * @returns {string} 形如 `2026-09-17 17:05`，非法则为 ''
 */
function formatLastLoginAt(iso) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** POST JSON 体：只接受非数组对象，其它一律当空对象。 */
function readBody(req) {
  const raw = req && req['body'];
  return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
}

export async function handleHttp(req = {}, env = {}, cfg = defaultConfig()) {
  const method = String(req.method || 'GET').toUpperCase();
  const originCheck = checkOrigin(method, req.origin, undefined, req.headers?.host);
  if (!originCheck.ok) return { status: originCheck.status, body: { ok: false, ...originCheck } };
  const sizeCheck = checkBodySize(Number(req.headers?.['content-length']) || 0);
  if (!sizeCheck.ok) return { status: sizeCheck.status, body: { ok: false, ...sizeCheck } };
  const path = String(req.url || '/').split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(String(req.url || '/').split('?')[1] || ''));
  const body = readBody(req);
  const writeConfirmOps = ['/api/git-push/rebuild', '/api/git-push/rollback', '/api/git-push/repo-push', '/api/git-push/repo-clone'];
  if (writeConfirmOps.includes(path)) {
    const confirm = checkWriteConfirm(body);
    if (!confirm.ok) return { status: confirm.status, body: { ok: false, ...confirm } };
  }
  // 2026-09-15 后台任务查询已随方案取消（task-queue 删除）：git_commit_push 改走
  //   宿主官方 job（ctx.jobs），查询用宿主 job_output/job_list/job_kill 工具，不再提供 /task 端点。
  switch (path) {
    case '/api/git-push/status':
      // 2026-09-13 安全修复：原来回吐整个 cfg（含 githubToken 明文）。改为脱敏副本——
      //   密钥位删除、另给 tokenConfigured/sshConfigured 布尔位供浏览器渲染「已填写」。
      return { status: 200, body: { ok: true, plugin: name, version: VERSION, workspaceRoot: env.workspaceRoot, config: redactConfig(cfg) } };
    case '/api/git-push/scan':
      return { status: 200, body: { ok: true, repos: scanRepos(env.workspaceRoot || '.', { extraRepos: env.extraRepos }) } };
    case '/api/git-push/browse': {
      // 账号卡片「手动指定路径」的目录浏览（对齐 gbmd path-picker 契约 {path,parent,dirs}）
      const r = browseDir(String(query.path || ''), { root: env.workspaceRoot });
      return { status: r.ok ? 200 : 400, body: r.ok ? { ok: true, path: r.path, parent: r.parent, dirs: r.dirs } : { ok: false, error: r.error } };
    }
    case '/api/git-push/repos-local': {
      // 账号卡片「本地」面板（2026-09-15 重构：读 dsh-repo-index.json）：
      //   - ?rebuild=1：**离线重建索引**（2026-09-16）——只扫本地 .git、纯离线不联网：
      //      ① author 用离线账号 json（account-status.json 的 username）比对（不调 /user）
      //      ② 可见性回退既有标注（buildRepoIndex offline=true 不查 GitHub API）
      //      → 把 author 一致的（含本地新增）登记进索引再读回
      //   - 缺省：直接读索引文件返回（列表永远与索引一致，不复扫）
      // 索引路径 = $DSH_HOME/git-push/dsh-repo-index.json（locateRepoIndex）。
      const rebuild = query.rebuild === '1' || query.rebuild === 'true';
      const path = String(query.path || '').trim() || getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
      // 离线 owner：优先读账号 json 快照（不联网）；无快照才落默认（不按账号过滤则只读索引）
      const acct = readAccountStatus({ workspaceRoot: env.workspaceRoot });
      const owner = (acct && acct.username) || '';
      if (rebuild) {
        // 离线重建：author=离线账号 owner → 索引只存 author 一致的仓库（含本地新增）；offline=true 不联网
        const r = await maintainRepoIndex({ workspaceRoot: path, token: '', owner: owner || 'EIGHTfs', extraRepos: env.extraRepos, extraReposFile: env.extraReposFile, offline: true });
        if (!r.ok) return { status: 500, body: { ok: false, error: '索引重建失败: ' + (r.error || '') } };
      }
      // 列表 = 读索引（只读文件，不复扫）
      const indexMap = readRepoIndexMap(env.workspaceRoot);
      let list = [];
      if (indexMap) {
        // 按索引登记顺序列出，附本地路径（root 下同名目录；找不到目录的索引条目仍展示为「已登记」）
        const p = path;
        // 2026-09-16 修复：整列表 live 探测设**总预算**（整表共享 6s）——逐仓 SSH 真源虽准，
        //   但多仓串行（每仓最多 8s）会让「打开本地面板」卡住数分钟（实测 73s）。
        //   超预算的仓库直接回退 describeRepo 本地引用（列表秒级返回，精确真源留给单仓 push）。
        const listDeadline = Date.now() + LIST_LIVE_BUDGET_MS;
        // SSH live 熔断：一旦某仓探测失败/超时（网络慢/不可达），剩余仓库全部跳过 live
        //   → 总耗时最多「一次超时」，避免 15 仓 × 8s 串行把列表拖到两分钟。
        let sshLiveBroken = false;
        list = Object.keys(indexMap).map((name) => {
          const entry = indexMap[name];
          // 2026-09-16：优先用索引里缓存的真实路径 entry.path（工作区在 <根>/工作区/<repo>）；
          //   老索引无 path（兼容透传）时才退回 join(扫描根, name)。
          const local = entry.path || join(p, name);
          const exists = existsSync(local);
          const out = {
            name,
            path: exists ? local : '',
            exists,
            hasRemote: !!entry.repoUrl,
            remote: entry.repoUrl || '',
            indexed: entry,
            visibility: entry.visibility || '未知',
            // 2026-09-16：云端合并字段透传（mergeCloudReposIntoIndex 写入索引，
            //   云端扫描后本地列表据此刷新远端状态：默认分支/云端最后推送/纯云端标记）
            defaultBranch: entry.defaultBranch || '',
            cloudPushedAt: entry.pushedAt || '',
            cloudOnly: !!entry.cloudOnly,
            // 2026-09-15：以本地仓库为视角补 ahead/behind（describeRepo 以 HEAD 对 upstream/origin/<分支>
            //   计算，ahead=本地领先远端、behind=本地落后远端）；目录缺失/非仓库 → null。
            branch: '',
            ahead: null,
            behind: null,
            changed: 0,
            lastCommit: '',
          };
          if (exists) {
            try {
              const repoState = describeRepo(local);
              out.branch = repoState.branch || '';
              out.changed = repoState.changed || 0;
              out.lastCommit = repoState.lastCommit || ''; // 本地 HEAD 短 sha + 提交信息
              out.localHead = repoState.lastCommit || '';
              // 2026-09-16：ahead/behind 必须用 liveRemoteHead（SSH 真源 ls-remote）——describeRepo
              //   用 origin/<分支> 本地缓存引用（origin 是 https 时 fetch 失败、缓存过期），会把
              //   「已推送」显示成「领先 N」、点 push 才暴露矛盾；真源 = 远端实际 HEAD。
              //   同时补 remoteHead/remoteHeadAt（云端 HEAD 短 sha + 提交时间，经 git log 取远端 sha 的提交行）。
              // 整表共享预算 + SSH 熔断：超预算/已熔断则不再 SSH，回退本地引用
              let live = { ok: false, sha: '' };
              if (!sshLiveBroken && Date.now() < listDeadline) {
                const t0 = Date.now();
                try { live = liveRemoteHead({ repoPath: local, branch: out.branch || '' }); } catch { /* 忽略 */ }
                // 探测失败，或耗时接近单次超时（说明网络慢）→ 熔断后续探测
                if (!live.ok || (Date.now() - t0) > LIVE_SLOW_THRESHOLD_MS) sshLiveBroken = true;
              }
              if (live.ok && live.sha) {
                out.remoteHead = live.sha.slice(0, 7);
                const rc = runGit(['rev-list', '--left-right', '--count', `HEAD...${live.sha}`], { cwd: local });
                if (rc.ok) {
                  const parts = (rc.stdout || '').trim().split(/\s+/).map(Number);
                  out.ahead = Number(parts[0]) || 0;
                  out.behind = Number(parts[1]) || 0;
                } else {
                  out.ahead = null; out.behind = null; out.remoteHead = ''; // 本地无该 sha（缓存过期/未 fetch）
                }
                // 云端 HEAD 提交时间：git log 远端 sha（本地已有该对象时才有；没有就空）
                const lt = runGit(['log', '-1', '--format=%cI', live.sha], { cwd: local });
                out.remoteHeadAt = lt.ok ? (lt.stdout || '').trim() : '';
                out.synced = out.ahead === 0 && out.behind === 0;
              } else {
                // 真源不可用（超预算/熔断/远端不可达）→ **不**用 describeRepo 的过期引用充当
                //   ahead/behind（会造成「显示领先 3、点 push 却说无提交可推」的误导），
                //   统一标 null + liveSkipped，前端显示「未探测，点 push 时核对」。
                out.ahead = null;
                out.behind = null;
                out.remoteHead = '';
                out.remoteHeadAt = '';
                out.synced = false;
                out.liveSkipped = true;
              }
              // 本地 HEAD 提交时间（%cI 完整 ISO）
              const lc = runGit(['log', '-1', '--format=%cI'], { cwd: local });
              out.localHeadAt = lc.ok ? (lc.stdout || '').trim() : '';
            } catch { /* 非 git 目录：保持空状态 */ }
          }
          return out;
        });
        if (owner) list = list.filter((r) => (r.indexed?.owner === owner) || !r.indexed?.owner);
      }
      return { status: 200, body: { ok: true, root: path, count: list.length, repos: list, owner: owner || null, indexedAvailable: !!indexMap } };
    }
    case '/api/git-push/repos-local-scan': {
      // POST 本地扫描（独立进程后台 + 前端只读新增 diff）：spawn 独立进程离线扫描，
      //   立即返回；扫描中不可重复启动（alreadyRunning）。前端随后轮询 wait 拿新增。
      // body: { path } → 扫描根（默认 DSH 家根）；账号 owner 用离线账号 json 快照。
      const acct = readAccountStatus({ workspaceRoot: env.workspaceRoot });
      const scanOwner = (acct && acct.username) || 'EIGHTfs';
      const scanRoot = String((body && body.path) || '').trim() || getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
      const r = runScan({ root: scanRoot, owner: scanOwner, workspaceRoot: env.workspaceRoot });
      if (r.ok === false) return { status: 500, body: { ok: false, error: r.error || '扫描启动失败' } };
      if (r.alreadyRunning) return { status: 200, body: { ok: false, running: true, error: '扫描进行中，不能重复扫描' } };
      return { status: 200, body: { ok: true, started: true, scanId: r.scanId, running: true } };
    }
    case '/api/git-push/repos-local-scan-wait': {
      // GET 等待新版本（非轮询增量）：挂起直到 scan-live.json 有新仓库或扫描结束，
      //   返回本次新增仓库名（前端只追加这些，不全量重读）。
      // query: from=<已见节点数>；POST body 亦可传 { from }
      const from = Number((query && query.from) || (body && body.from) || 0);
      const scanDelta = await waitScanDelta({ from, timeoutMs: SCAN_WAIT_TIMEOUT_MS, workspaceRoot: env.workspaceRoot });
      return { status: 200, body: { ok: true, newest: scanDelta.newest, version: scanDelta.version, done: scanDelta.done, running: scanDelta.running, timeout: scanDelta.timeout } };
    }
    case '/api/git-push/repos-local-refresh': {
      // 2026-09-16：本地扫描完自动补查「远端状态未知」仓库（liveSkipped）——前端扫描收尾后
      //   把 liveSkipped 的仓库名 POST 过来，串行 liveRemoteHead 补查 SSH 真源（每仓一个），
      //   结果**逐个追加**写回索引（updateRepoRemoteStateInIndex 读-改-写单条目，不重建索引、
      //   不重扫本地、保留其他条目），返回补查结果供前端刷新 UI 远端状态。
      // body: { repos: [{ name, path, branch }] } —— 只需 name；path 用于本地探测
      const targets = Array.isArray((body && body.repos)) ? body.repos : [];
      const refreshed = [];
      for (const t of targets) {
        const name = String(t && t.name || '').trim();
        const repoPath = String(t && t.path || '').trim();
        if (!name) continue;
        try {
          const branch = String(t && t.branch || '') || runGit(['branch', '--show-current'], { cwd: repoPath }).stdout.trim();
          const live = await liveRemoteHead({ repoPath, branch });
          let state = { remoteHead: '', ahead: null, behind: null, remoteHeadAt: '', synced: false };
          if (live.ok && live.sha) {
            state.remoteHead = live.sha.slice(0, 7);
            // 2026-09-17：区分「已连通但无法比较」与「未连通」——rc 失败说明本地缺该提交对象
            //   （缓存过期/未 fetch），远端本身是已知的；前端据此说「待 fetch 比较」而不是「未知」。
            state.remoteKnown = true;
            const rc = runGit(['rev-list', '--left-right', '--count', `HEAD...${live.sha}`], { cwd: repoPath });
            if (rc.ok) {
              const parts = (rc.stdout || '').trim().split(/\s+/).map(Number);
              state.ahead = Number(parts[0]) || 0;
              state.behind = Number(parts[1]) || 0;
              state.compareOk = true;
            } else {
              state.compareOk = false;
              state.compareHint = '本地缺少远端提交对象，执行 git fetch 后即可比较领先/落后';
            }
            const lt = runGit(['log', '-1', '--format=%cI', live.sha], { cwd: repoPath });
            state.remoteHeadAt = lt.ok ? (lt.stdout || '').trim() : '';
            state.synced = state.ahead === 0 && state.behind === 0;
          } else {
            // 未连通：既没探到远端 sha，也不该冒充「已知」
            state.remoteKnown = false;
            state.compareOk = false;
            state.error = live.error || '远端不可达';
          }
          // 追加写回索引（只更新该条目，不重建/不重扫）
          const up = updateRepoRemoteStateInIndex({ workspaceRoot: env.workspaceRoot, repoName: name, remoteState: state });
          refreshed.push({ name, ok: true, remoteState: state, indexUpdated: up.ok, error: up.error });
        } catch (e) {
          refreshed.push({ name, ok: false, error: String(e?.message || e) });
        }
      }
      return { status: 200, body: { ok: true, count: refreshed.length, refreshed } };
    }
    case '/api/git-push/repos-cloud': {
      // 账号卡片「云端」面板：token 列账号名下仓库（GET /user/repos）。
      // 未配 token 也是合法业务状态（页面向导引导去设置），故恒 200 + body.ok 区分。
      // 2026-09-16：为每个云端仓库标记本地是否已有（localExists + localPath）——
      //   依据插件索引（dsh-repo-index.json 的 path 字段）与扫描根下同名目录存在性。
      // 2026-09-16：云端扫描结果同步写索引（mergeCloudReposIntoIndex）——云端仓库
      //   登记进 dsh-repo-index.json（含 defaultBranch/pushedAt/visibility 云端真源），
      //   本地已有副本的条目刷新云端状态；列表返回 indexUpdated 供前端提示「索引已更新」。
      const r = await listCloudRepos({ token: resolveToken({ workspaceRoot: env.workspaceRoot }).token });
      let indexUpdated = 0;
      if (r && r.ok && Array.isArray(r.repos)) {
        const indexMap = readRepoIndexMap(env.workspaceRoot);
        const root = getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
        for (const repo of r.repos) {
          const repoName = String(repo.name || '').trim();
          let local = indexMap && indexMap[repoName] ? (indexMap[repoName].path || '') : '';
          if (!local && repoName) local = join(root, repoName);
          repo.localExists = !!(local && existsSync(local));
          repo.localPath = repo.localExists ? local : '';
        }
        // 云端扫描写索引（云端 owner 取首个 fullName 前缀；失败静默不阻塞列表）
        const acct = readAccountStatus({ workspaceRoot: env.workspaceRoot });
        const cloudOwner = (acct && acct.username) || String(r.repos[0]?.fullName || '').split('/')[0] || 'EIGHTfs';
        const merged = mergeCloudReposIntoIndex({ workspaceRoot: env.workspaceRoot, owner: cloudOwner, cloudRepos: r.repos });
        if (merged.ok) indexUpdated = merged.updated || 0;
      }
      return { status: 200, body: { ...r, indexUpdated } };
    }
    case '/api/git-push/repo-push': {
      // 手动推送：领先 + 工作树干净才允许（pushCurrentBranch 内校验），写确认前置
      const path = String(body.path || '').trim();
      if (!path) return { status: 400, body: { ok: false, error: '缺少仓库路径 path' } };
      const r = await pushCurrentBranch({ repoPath: path, pushMethod: cfg.pushMethod || 'ssh' });
      // 推送成功后全量重建仓库索引（v1 语义，含可见性更新/索引登记同步）；
      //   fire-and-forget，不阻塞推送响应，失败静默。
      if (r.ok) {
        // 推送成功后全量重建仓库索引（v1 语义，含可见性更新/索引登记同步）；fire-and-forget，失败静默
        maintainRepoIndex({
          workspaceRoot: env.workspaceRoot,
          token: resolveToken({ workspaceRoot: env.workspaceRoot }).token,
          owner: r.push?.owner || 'EIGHTfs',
        }).catch(() => { /* fire-and-forget：索引更新失败不阻断推送响应 */ });
        // 2026-09-16：推送成功顺便验证账号并刷新 account-status.json（凭据有效性），与索引同批
        refreshAccountStatus({ workspaceRoot: env.workspaceRoot }).catch(() => { /* 账号刷新失败静默 */ });
      }
      // 失败时把通道 reason 提到顶层 error（前端原先只读 data.error，会显示成「推送失败」）
      const error = r.error || r.push?.reason || undefined;
      return { status: r.ok ? 200 : 400, body: { ...r, error, repoIndex: r.ok ? 'updating' : undefined } };
    }
    case '/api/git-push/repo-clone': {
      // 手动克隆：云端仓库 → 用户选定父目录（browse 弹窗），实际落点 = 父目录/<仓库名>。
      // 2026-09-16 修复：此前把选中的目录直接当 dest → 选到工作区根（非空）就报
      //   「目标目录已存在且非空」；语义应为父目录，自动拼仓库名，不存在则创建。
      const target = String(body.target || '').trim();
      const dir = String(body.dir || '').trim();
      if (!target) return { status: 400, body: { ok: false, error: '缺少 target（owner/repo 或 GitHub URL）' } };
      if (!dir) return { status: 400, body: { ok: false, error: '缺少目标目录 dir（先用目录选择器选父目录）' } };
      const pr = parseGithubOwnerRepo(target);
      if (!pr) return { status: 400, body: { ok: false, error: `无法解析 target（${target}）：需要 owner/repo 或 GitHub URL` } };
      const dest = join(dir, pr.repo);
      // 体积守卫与并发数走用户设置（默认 10MB / 6 并发）
      const cfg = env.cfg || {};
      const maxFileMB = Number.isFinite(cfg.maxCloneFileMB) ? cfg.maxCloneFileMB : 10;
      const concurrency = Number.isFinite(cfg.cloneConcurrency) ? cfg.cloneConcurrency : 6;
      // 先取 tree 建立进度总量，再开始下载（否则进度条无从计算百分比）
      const pre = await previewClone({ target, token: resolveToken({ workspaceRoot: env.workspaceRoot }).token, maxFileMB });
      if (!pre.ok) return { status: 400, body: pre };
      startCloneJob({ target, dest, totalFiles: pre.downloadCount, totalBytes: pre.downloadBytes });
      let r;
      try {
        r = await cloneViaApi({
          target, dest,
          token: resolveToken({ workspaceRoot: env.workspaceRoot }).token,
          maxFileMB, concurrency,
          onProgress: (p) => updateCloneJob(p),
        });
      } finally {
        // 无论成败都要落终态，否则前端会永远停在「下载中」
        setCloneJobPhase('done');
      }
      finishCloneJob(r);
      return { status: r.ok ? 200 : 400, body: r };
    }
    case '/api/git-push/clone-preview': {
      // 点 clone 前先预览：会下载多少、会跳过哪些超大文件。
      // 不让用户「下载到一半才发现缺文件」，也顺带给前端提供总量算进度百分比。
      const target = String(body.target || '').trim();
      if (!target) return { status: 400, body: { ok: false, error: '缺少 target（owner/repo 或 GitHub URL）' } };
      const maxFileMB = Number.isFinite(body.maxFileMB) ? body.maxFileMB
        : (Number.isFinite((env.cfg || {}).maxCloneFileMB) ? env.cfg.maxCloneFileMB : 10);
      const cacheKey = target + '|' + maxFileMB;
      const cached = getPreview(cacheKey);
      if (cached) return { status: 200, body: cached };
      const r = await previewClone({ target, token: resolveToken({ workspaceRoot: env.workspaceRoot }).token, maxFileMB });
      if (r.ok) setPreview(cacheKey, r);
      return { status: r.ok ? 200 : 400, body: r };
    }
    case '/api/git-push/clone-progress': {
      // 轮询进度：前端按「进度停滞」而非绝对超时判失败（30MB 单文件慢但不算卡）
      const st = cloneJobStatus();
      // 终态被取走后清掉，避免下次打开面板读到上次结果
      if (st.state === 'done' && body.consume) clearCloneJobResult();
      return { status: 200, body: { ok: true, ...st } };
    }
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
      const b = body;
      const slot = String(b.slot || '');
      const want = b.disabled === true;
      if (!slot) return { status: 400, body: { ok: false, code: 'SLOT_REQUIRED', error: '缺少规则包名 slot' } };
      const r = setSlotDisabled(slot, want);
      if (!r.ok) return { status: 400, body: { ok: false, code: 'SLOT_TOGGLE_FAIL', error: r.error || '切换失败' } };
      return { status: 200, body: { ok: true, slot, disabled: r.disabled, message: want ? '已禁用' : '已启用' } };
    }
    case '/api/git-push/account-status': {
      // GET 离线读账号状态（秒级，不触发任何网络/在线校验）：
      //   插件启动 / push 后重读 / 账号卡片渲染全用它——读的就是 account-status.json 快照
      //   （由「重新检测」在线校验 / push 在线刷新时落盘）+ 凭据文件判「是否配置」。
      //   与 /account-check（在线校验并写 json）互为读写两端：这里只读不写。
      const status = readAccountStatus({ workspaceRoot: env.workspaceRoot });
      // 凭据文件真源：token / sshPub 在 config.json 里**有没有值**（与 redactConfig 的判断口径一致）。
      // 2026-09-17 修：此前 tokenConfigured/sshConfigured 只看 account-status.json 快照的
      //   valid/login/checkedAt，而那是**在线校验结果**——用户填了 token/公钥但没点过「重新检测」
      //   时快照为空 → 界面显示「未填写」（实测：config.json 里 sshPub 741 字符仍在，界面却报未配置）。
      //   现改为「配置文件有值 即视为已填写」，快照只用于补充有效性/登录名。
      let fileHasToken = false;
      let fileHasSsh = false;
      try { fileHasToken = !!(resolveToken({ workspaceRoot: env.workspaceRoot }).token || '').trim(); } catch { /* 读失败按未配置 */ }
      // 注意：readSshPub 返回的是**对象** {configured, pub, file, fingerprint}，不是字符串
      //   ——直接 `.trim()` 会抛 TypeError 并被 catch 吞掉，导致「已填写」恒为 false（实测踩过）。
      try { fileHasSsh = !!readSshPub({ workspaceRoot: env.workspaceRoot })?.configured; } catch { /* 读失败按未配置 */ }
      const snap = status;
      const hasToken = fileHasToken;
      const hasSsh = fileHasSsh;
      const ts = snap?.token || {};
      const ss = snap?.ssh || {};
      const statusObj = {
        ok: true,
        offline: true,
        // 2026-09-16：登录 = 或逻辑——ssh 或 token 任意一个 valid 即登录成功（不依赖快照 loggedIn 字段）
        loggedIn: !!(ts.valid || ss.valid),
        username: snap?.username || '',
        tokenConfigured: hasToken,
        sshConfigured: hasSsh,
        // 2026-09-17：两条凭据各自独立——Token 与 SSH 可以是**不同 GitHub 用户**且各自有效，
        //   因此各自带 login（该凭据自己的用户名）与 checkedAt（该凭据最近一次校验通过时间），
        //   前端按行分别渲染，不再合并成单一「已登录为 X」。
        tokenStatus: {
          valid: !!ts.valid, login: ts.login || '', checked: !!ts.checkedAt,
          checkedAt: ts.checkedAt || '', timeout: ts.timeout === true,
        },
        sshStatus: {
          valid: !!ss.valid, login: ss.login || '', checked: !!ss.checkedAt,
          checkedAt: ss.checkedAt || '', timeout: ss.timeout === true,
        },
        checkedAt: snap?.checkedAt || '',
        // 2026-09-17：**取消汇总行**——两条凭据可以属于不同 GitHub 用户，写单一「已登录为 X」
        //   本身就是错的（另一个账号被隐藏）。改为逐条列出：各自用户名 + 各自最近一次校验通过时间。
        //   顶部状态由前端单独呈现（已连接/未连接），不在这里重复。
        block: snap ? (() => {
          /** 单条凭据行：`<图标> <名称>：<用户名|已配置>｜<时间或状态>` */
          const line = (label, configured, st) => {
            if (!configured) return `⏳ ${label}：未配置`;
            const who = st.login || '已配置';
            if (st.valid) {
              const when = formatLastLoginAt(st.checkedAt);
              return `✅ ${label}：${who}${when ? '｜校验于 ' + when : ''}`;
            }
            if (st.timeout) return `⏳ ${label}：${who}｜未测成（网络超时，可重试）`;
            if (st.checkedAt) {
              const when = formatLastLoginAt(st.checkedAt);
              return `❌ ${label}：${who}${when ? '｜失效于 ' + when : ''}`;
            }
            return `⏳ ${label}：${who}｜未校验`;
          };
          const hasAny = !!(ts.valid || ss.valid);
          const lines = [line('Token', hasToken, ts), line('SSH 公钥', hasSsh, ss)];
          // Token 失效但 SSH 可用时，补一句影响范围，避免用户误以为整体不可用
          if (hasToken && !ts.valid && ss.valid) lines.push('（推送走 SSH，Token 失效不影响推送）');
          const head = hasAny ? '✅ 凭据可用' : '⚠️ 凭据不可用：点「重新检测」在线校验';
          return `${head}\n${lines.join('\n')}`;
        })() : '（暂无登录记录，点击「重新检测」在线校验）',
      };
      return { status: 200, body: statusObj };
    }
    case '/api/git-push/account-check': {
      // body 由 adaptHttpHandler 解析为对象；{ githubToken?, sshPub? } → 校验账号；sshPub 非空先持久化公钥
      // 2026-09-12 修复：token 优先用设置页保存的 cfg.githubToken（scope.watch/初始同步已把
      //   settings 的 githubToken/sshPub 灌入 cfg），body 传参仅作显式覆盖；否则 resolveToken()
      //   只会读配置文件里的旧 token → 误判未登录。
      const b = body;
      const pub = String(b.sshPub || cfg.sshPub || '');
      if (pub) persistSshPub(pub, { workspaceRoot: env.workspaceRoot });
      const tok = String(b.githubToken || cfg.githubToken || '');
      const accountInfo = await checkGithubAccount({ workspaceRoot: env.workspaceRoot, token: tok, checkSsh: b.checkSsh !== false });
      accountInfo.block = formatGithubAccountBlock(accountInfo);
      // 2026-09-16：账号信息持久化到 account-status.json（token/ssh 有效性快照），
      //   推送/提交同步刷新，设置侧边栏打开时读取。
      writeAccountStatusFromResult(accountInfo, { workspaceRoot: env.workspaceRoot });
      return { status: 200, body: { ...accountInfo, status: readAccountStatus({ workspaceRoot: env.workspaceRoot }) } };
    }
    case '/api/git-push/gen-ssh-key': {
      // body 由 adaptHttpHandler 解析为对象；{ email, force? } → 生成 SSH 密钥对；公钥整行回传（私钥永不离开本机）
      const b = body;
      const r = generateSshKey(String(b.email || ''), { workspaceRoot: env.workspaceRoot, force: b.force === true });
      if (!r.ok) return { status: 400, body: { ok: false, code: 'SSH_KEY', error: r.error } };
      return { status: 200, body: { ok: true, email: r.email, privateKey: r.privateKey, pubFile: r.pubFile, pub: r.pub, note: '公钥已写入插件配置目录 *.pub，可复制粘贴到 GitHub → Settings → SSH and GPG keys' } };
    }
    // 2026-09-15：设置读写（持久化 = 插件私有 config.json，**不写公共 settings.yaml**——
//   公共文件有跨实例写锁竞争（实测 atomic-write lock 超时）+ client isLoopback=memory 陷阱；
//   插件私有文件无锁竞争、重启读回。见 settings-bridge.js 头部说明）
    case '/api/git-push/settings-get': {
      // GET：返回插件 config.json 里的设置快照（文件不存在=空对象）；token/sshPub 经 redact 掩码不裸传
      const snap = readSettings({ workspaceRoot: env.workspaceRoot });
      return { status: 200, body: { ok: true, settings: redactConfig(snap || {}) } };
    }
    case '/api/git-push/settings-set': {
      // POST：{ key, value } → 写插件 config.json（白名单键，防越权写任意字段）
      const b = body;
      const key = String(b.key || '');
      // 白名单：仅允许前端设置卡片声明的开关/枚举/文本键（SETTINGS_SCHEMA 同级）；
      //   凭据（githubToken/sshPub）也走这里（写 config.json + 下方同步 cfg，
      //   与 isLoopback 无关、无宿主锁竞争）
      // 2026-09-17：移除 auditLevel——审计强度不是可配置项，插件固定走完整流程（正则初筛 + AST）。
      const allowedKeys = new Set([
        'auditEnabled', 'injectRequirements', 'injectSystemPrompt', 'auditScanScope',
        'maxScanFiles', 'weightOverrides',
        'maxCloneFileMB', 'cloneConcurrency',
        'pushMethod', 'auditRuleOrder', 'auditDisabledSlots',
        'githubToken', 'sshPub', 'pushGate',
      ]);
      if (!allowedKeys.has(key)) return { status: 400, body: { ok: false, error: `不支持的设置键: ${key || '(空)'}` } };
      // 2026-09-15：凭据落插件目录（github-token / *.pub 0600）——前端已不再 scope.set，
      //   原来靠 scope.watch 触发 persist 的链路失去输入，改由本端点直接持久化凭据文件；
      //   config.json 仍由 writeSettingsKey 统一写入（凭据键在里面也留一份快照）。
      if (key === 'githubToken') {
        const r = persistGithubToken(b.value, { workspaceRoot: env.workspaceRoot });
        if (!r.ok) return { status: 400, body: { ok: false, error: `token 持久化失败: ${r.error || '未知错误'}` } };
      } else if (key === 'sshPub') {
        const r = persistSshPub(b.value, { workspaceRoot: env.workspaceRoot });
        if (!r.ok) return { status: 400, body: { ok: false, error: `公钥持久化失败: ${r.error || '未知错误'}` } };
      }
      const r = await writeSettingsKey(key, b.value, { workspaceRoot: env.workspaceRoot });
      // 2026-09-15：UI 提交日志（插件私有 settings-ui.log，重启可见，凭据打码）——
      //   每次设置页提交都留痕，验证「提交确实发生且落盘」
      appendSettingsLog({ key, value: b.value, via: 'http-settings-set', ok: r.ok, error: r.error }, { workspaceRoot: env.workspaceRoot });
      if (!r.ok) {
        return { status: r.code === 'BAD_KEY' ? 400 : 500, body: { ok: false, code: r.code || 'SETTINGS_WRITE', error: r.error } };
      }
      // 写盘成功后同步内存 cfg（即时生效：注入门控/审计范围/权重等读 cfg 的路径立刻看到新值，
      //   不再依赖宿主 scope.watch——config.json 才是真源；字段映射统一走 applySettingsToCfg，
      //   与 apply 启动 merge / scope.watch 同一张映射表，见 settings-bridge.js）
      try {
        applySettingsToCfg(cfg, { [key]: b.value });
      } catch (e) {
        // cfg 同步失败不阻断写盘（config.json 已落，重启会读回）
        log?.warn?.(`settings-set cfg 同步跳过：${e?.message || e}`);
      }
      return { status: 200, body: { ok: true, key, value: b.value, note: '设置已写入插件私有配置（config.json）' } };
    }
    default:
      return { status: 404, body: { ok: false, code: 'NOT_FOUND', message: `无此端点: ${method} ${path}` } };
  }
}
