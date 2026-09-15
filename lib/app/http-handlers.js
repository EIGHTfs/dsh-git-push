/**
 * 插件入口层 · HTTP 处理
 *
 * handleHttp（路由分发）、listRuleSlots（规则包列表端点）、
 *   adaptHttpHandler（把 handler 适配成宿主 HTTP 形态）。
 * 与工具调用分开：HTTP 走 host 的路由与状态码，工具走结构化返回。
 */

import { VERSION } from '../self/index.js';
import {
  scanRepos, checkGithubAccount, formatGithubAccountBlock, generateSshKey, persistSshPub,
  browseDir, listCloudRepos, pushCurrentBranch, cloneViaApi, resolveToken,
  githubFetch, parseGithubOwnerRepo,
} from '../git/index.js';
import { readRepoIndexMap, indexEntryForRepo, maintainRepoIndex } from '../git/repo-index.js';
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
  } catch { /* 响应已开始或连接已断：忽略 */ }
  return result;
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
      // 账号卡片「本地」面板：默认扫工作区，可手动指定路径（path 参数）。
      // 2026-09-14 联动仓库索引：为每个仓库附 indexed（dsh-repo-index.json 登记的
      //   owner/repo/可见性）——本地无 remote/上游时也能显示它的 GitHub 归属。
      // 2026-09-14 只显示登录同作者的仓库：有 remote 则 owner 必须=登录账号；无 remote
      //   的本地仓库按索引登记的 owner 归属判定；无登录态（无 token）时不过滤（降级全量）。
      const path = String(query.path || '').trim() || getDefaultScanRoot(env, { defaultScanRoot: String(cfg.defaultScanRoot || '') });
      let list = scanRepos(path, { extraRepos: env.extraRepos });
      const indexMap = readRepoIndexMap(env.workspaceRoot);
      for (const r of list) r.indexed = indexEntryForRepo(r.path, indexMap);
      const token = resolveToken({ workspaceRoot: env.workspaceRoot }).token;
      let owner = '';
      if (token) {
        try {
          const me = await githubFetch('/user', { token, timeout: 10_000 });
          if (me.status === 200 && me.json?.login) owner = String(me.json.login);
        } catch { /* 查询失败 → 不过滤 */ }
      }
      if (owner) {
        list = list.filter((r) => (r.hasRemote ? parseGithubOwnerRepo(r.remote)?.owner === owner : r.indexed?.owner === owner));
      }
      return { status: 200, body: { ok: true, root: path, count: list.length, repos: list, owner: owner || null, indexedAvailable: !!indexMap } };
    }
    case '/api/git-push/repos-cloud': {
      // 账号卡片「云端」面板：token 列账号名下仓库（GET /user/repos）。
      // 未配 token 也是合法业务状态（页面向导引导去设置），故恒 200 + body.ok 区分。
      const r = await listCloudRepos({ token: resolveToken({ workspaceRoot: env.workspaceRoot }).token });
      return { status: 200, body: r };
    }
    case '/api/git-push/repo-push': {
      // 手动推送：领先 + 工作树干净才允许（pushCurrentBranch 内校验），写确认前置
      const path = String(body.path || '').trim();
      if (!path) return { status: 400, body: { ok: false, error: '缺少仓库路径 path' } };
      const r = await pushCurrentBranch({ repoPath: path, pushMethod: cfg.pushMethod || 'ssh' });
      // 推送成功后全量重建仓库索引（v1 语义，含可见性更新/索引登记同步）；
      //   fire-and-forget，不阻塞推送响应，失败静默。
      if (r.ok) {
        maintainRepoIndex({
          workspaceRoot: env.workspaceRoot,
          token: resolveToken({ workspaceRoot: env.workspaceRoot }).token,
          owner: r.push?.owner || 'EIGHTfs',
        }).catch(() => { /* fire-and-forget：索引更新失败不阻断推送响应 */ });
      }
      // 失败时把通道 reason 提到顶层 error（前端原先只读 data.error，会显示成「推送失败」）
      const error = r.error || r.push?.reason || undefined;
      return { status: r.ok ? 200 : 400, body: { ...r, error, repoIndex: r.ok ? 'updating' : undefined } };
    }
    case '/api/git-push/repo-clone': {
      // 手动克隆：云端仓库 → 用户选定目录（browse 弹窗选父目录，dest = dir + 仓库名）
      const target = String(body.target || '').trim();
      const dir = String(body.dir || '').trim();
      if (!target) return { status: 400, body: { ok: false, error: '缺少 target（owner/repo 或 GitHub URL）' } };
      if (!dir) return { status: 400, body: { ok: false, error: '缺少目标目录 dir（先用目录选择器选父目录）' } };
      const r = await cloneViaApi({ target, dest: dir, token: resolveToken({ workspaceRoot: env.workspaceRoot }).token });
      return { status: r.ok ? 200 : 400, body: r };
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
    case '/api/git-push/account-check': {
      // body 由 adaptHttpHandler 解析为对象；{ githubToken?, sshPub? } → 校验账号；sshPub 非空先持久化公钥
      // 2026-09-12 修复：token 优先用设置页保存的 cfg.githubToken（scope.watch/初始同步已把
      //   settings 的 githubToken/sshPub 灌入 cfg），body 传参仅作显式覆盖；否则 resolveToken()
      //   只会读配置文件里的旧 token → 误判未登录。
      const b = body;
      const pub = String(b.sshPub || cfg.sshPub || '');
      if (pub) persistSshPub(pub, { workspaceRoot: env.workspaceRoot });
      const tok = String(b.githubToken || cfg.githubToken || '');
      const result = await checkGithubAccount({ workspaceRoot: env.workspaceRoot, token: tok });
      result.block = formatGithubAccountBlock(result);
      return { status: 200, body: result };
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
      const allowedKeys = new Set([
        'auditEnabled', 'injectRequirements', 'injectSystemPrompt', 'auditScanScope',
        'auditLevel', 'auditRuleset', 'maxScanFiles', 'weightOverrides', 'commitMessage',
        'defaultScanRoot', 'pushMethod', 'hardcodeFullScan', 'auditRuleOrder', 'auditDisabledSlots',
        'githubToken', 'sshPub',
      ]);
      if (!allowedKeys.has(key)) return { status: 400, body: { ok: false, error: `不支持的设置键: ${key || '(空)'}` } };
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
