/**
 * 插件入口层 · HTTP 处理
 *
 * handleHttp（路由分发）、listRuleSlots（规则包列表端点）、
 *   adaptHttpHandler（把 handler 适配成宿主 HTTP 形态）。
 * 与工具调用分开：HTTP 走 host 的路由与状态码，工具走结构化返回。
 */

import { VERSION } from '../self/index.js';
import { scanRepos } from '../git/index.js';
import { checkGithubAccount, formatGithubAccountBlock, generateSshKey, persistSshPub } from '../git/index.js';
// 2026-09-14 账号卡片（本地/云端）：目录浏览 + 云端仓库列表 + 手动推送 + 克隆
import { browseDir, listCloudRepos, pushCurrentBranch, cloneViaApi, resolveToken } from '../git/index.js';
import { checkOrigin, checkBodySize, checkWriteConfirm, readJsonBody } from '../http/index.js';
import { defaultConfig } from '../client/index.js';
import { discoverRuleSlots, loadYamlRuleFile, resolveSlotOrder, setSlotDisabled, RULE_YAML_DIR } from '../rule/loader.js';
import { name } from './constants.js';
import { redactConfig } from './schema.js';
import { getLastSlotHitStats } from './slot-stats.js';
import { listTools } from './tools.js';

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
  const writeConfirmOps = ['/api/git-push/rebuild', '/api/git-push/rollback', '/api/git-push/repo-push', '/api/git-push/repo-clone'];
  if (writeConfirmOps.includes(path)) {
    const confirm = checkWriteConfirm(req.body || {});
    if (!confirm.ok) return { status: confirm.status, body: { ok: false, ...confirm } };
  }
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
      // 账号卡片「本地」面板：默认扫工作区，可手动指定路径（path 参数）
      const path = String(query.path || '').trim() || env.workspaceRoot || '.';
      const repos = scanRepos(path, { extraRepos: env.extraRepos });
      return { status: 200, body: { ok: true, root: path, count: repos.length, repos } };
    }
    case '/api/git-push/repos-cloud': {
      // 账号卡片「云端」面板：token 列账号名下仓库（GET /user/repos）。
      // 未配 token 也是合法业务状态（页面向导引导去设置），故恒 200 + body.ok 区分。
      const r = await listCloudRepos({ token: resolveToken({ workspaceRoot: env.workspaceRoot }).token });
      return { status: 200, body: r };
    }
    case '/api/git-push/repo-push': {
      // 手动推送：领先 + 工作树干净才允许（pushCurrentBranch 内校验），写确认前置
      const path = String(req.body?.path || '').trim();
      if (!path) return { status: 400, body: { ok: false, error: '缺少仓库路径 path' } };
      const r = await pushCurrentBranch({ repoPath: path, pushMethod: cfg.pushMethod || 'ssh' });
      return { status: r.ok ? 200 : 400, body: r };
    }
    case '/api/git-push/repo-clone': {
      // 手动克隆：云端仓库 → 用户选定目录（browse 弹窗选父目录，dest = dir + 仓库名）
      const target = String(req.body?.target || '').trim();
      const dir = String(req.body?.dir || '').trim();
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
