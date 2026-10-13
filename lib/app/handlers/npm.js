/**
 * npm 账号 handler（Step 2）：`/npm-account` —— 登录态 + registry + 凭据配置状态。
 *
 * 安全：**绝不回吐 token 明文**——只回 `configured` 布尔与 `maskedToken`（脱敏）；
 *   调用 npm 时把 token 物化成 0600 的独立 npmrc（`--userconfig`），不碰用户全局 ~/.npmrc。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readNpmToken, maskToken } from '../../core/credentials.js';
import { normalizeRegistry, whoami, listOwnedPackages } from '../../npm/registry.js';
import { npmArgs, writeNpmrc } from '../../npm/npmrc.js';
import { installPackages, startInstall, validateDest } from '../../npm/install.js';
import { publishPackage } from '../../npm/publish.js';
import { readNpmAccountStatus, writeNpmAccountStatus, buildNpmAccountStatus, renderNpmAccountBlock } from '../../npm/account.js';

/** 账号态公共装配（离线，不跑 npm）：凭据文件真源 + registry + 快照 ⇒ 供三个端点复用。 */
function npmAccountState(ctx) {
  const { env, cfg } = ctx;
  const workspaceRoot = env?.workspaceRoot || '';
  const registry = normalizeRegistry(cfg?.npmRegistry);
  let token = '';
  try { token = readNpmToken({ workspaceRoot }); } catch { token = ''; }
  const configured = !!(token && token.trim());
  const masked = configured ? maskToken(token) : '';
  const snap = readNpmAccountStatus({ workspaceRoot });
  const loggedIn = !!(snap.ok && snap.user);
  const error = configured
    ? (loggedIn ? '' : (snap.error || '尚未校验：点「刷新」做一次在线校验'))
    : '未配置 npm token（在设置里填写后即可显示登录态）';
  return {
    workspaceRoot, registry, token, configured, snap,
    body: {
      ok: true,
      configured,
      maskedToken: masked,
      registry,
      user: snap.user || '',
      loggedIn,
      checkedAt: snap.checkedAt || '',
      error,
      block: renderNpmAccountBlock(snap, { configured, maskedToken: masked, registry }),
    },
  };
}

/** `/npm-account`：**离线**读快照（对齐 GitHub 的 `/account-status`；秒级、不联网）。 */
export function handleNpmAccount(ctx) {
  return { status: 200, body: npmAccountState(ctx).body };
}

/** `/npm-check`：在线跑 `npm whoami` 并写快照（对齐 GitHub 的 `/account-check`；「刷新」按钮走这里）。 */
export function handleNpmCheck(ctx) {
  const st = npmAccountState(ctx);
  if (!st.configured) return { status: 200, body: st.body };
  const rc = writeNpmrc({ workspaceRoot: st.workspaceRoot, registry: st.registry, token: st.token });
  if (!rc.ok) return { status: 200, body: { ...st.body, loggedIn: false, error: rc.error || 'npmrc 写入失败' } };
  const w = whoami({ npmArgs: npmArgs({ npmrcFile: rc.file, registry: st.registry }) });
  const snap = buildNpmAccountStatus({ user: w.user, registry: st.registry, ok: !!w.ok, error: w.error || '' });
  writeNpmAccountStatus(snap, { workspaceRoot: st.workspaceRoot });
  const loggedIn = !!(snap.ok && snap.user);
  return {
    status: 200,
    body: {
      ...st.body,
      user: snap.user,
      loggedIn,
      checkedAt: snap.checkedAt,
      error: loggedIn ? '' : (snap.error || 'npm whoami 未通过'),
      block: renderNpmAccountBlock(snap, { configured: true, maskedToken: st.body.maskedToken, registry: st.registry }),
    },
  };
}

/** `/npm-owned`：登录账号名下的包列表（对齐 GitHub 云端仓库列表；只读 + 可降级）。 */
export async function handleNpmOwned(ctx) {
  const st = npmAccountState(ctx);
  if (!st.body.loggedIn) {
    return {
      status: 200,
      body: { ok: true, user: '', results: [], error: st.configured ? '尚未校验登录态：先点「刷新」' : '未配置 npm token' },
    };
  }
  const r = await listOwnedPackages(st.body.user, { registry: st.registry });
  return { status: 200, body: { ok: true, user: st.body.user, results: r.results, error: r.error || '' } };
}

/**
 * `/npm-packages`：列出某目录的已装依赖（读 package.json，不跑 npm、不联网）。
 * 入参：dir（可选，默认工作区）。返回 dependencies/devDependencies 与是否已有 node_modules。
 */
export function handleNpmPackages(ctx) {
  const { env, query, body } = ctx;
  const dir = String(query?.dir || body?.dir || env?.workspaceRoot || '');
  const d = validateDest(dir);
  if (!d.ok) return { status: 400, body: { ok: false, error: d.error, dir } };
  try {
    const pkgPath = join(dir, 'package.json');
    const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return {
      status: 200,
      body: {
        ok: true,
        dir,
        name: pkg.name || '',
        version: pkg.version || '',
        hasPackageJson: existsSync(pkgPath),
        nodeModules: existsSync(join(dir, 'node_modules')),
        dependencies: Object.entries(deps).map(([name, range]) => ({ name, range })),
      },
    };
  } catch (e) {
    return { status: 500, body: { ok: false, error: String(e?.message || e) } };
  }
}

/**
 * `/npm-install`：安装包（POST）。**必须显式 confirm:true**（第二次确认）；
 *   默认 `ignoreScripts:true`（不执行 postinstall）、默认非全局。
 */
export function handleNpmInstall(ctx) {
  const { env, body, cfg } = ctx;
  if (body?.confirm !== true) {
    return { status: 400, body: { ok: false, error: '安装需要显式二次确认（confirm: true）' } };
  }
  const names = Array.isArray(body?.names) ? body.names : String(body?.name || '').split(/[\s,]+/).filter(Boolean);
  const global = body?.global === true;
  const opts = {
    names,
    dest: String(body?.dest || ''),
    global,
    ignoreScripts: body?.ignoreScripts !== false, // 默认 true（安全默认）
    registry: cfg?.npmRegistry || '',
    workspaceRoot: env?.workspaceRoot || '',
  };
  // async=true：走异步安装 + /npm-install-progress 轮询（UI 进度框用；对应 GitHub 克隆的进度模型）
  if (body?.async === true) {
    const started = startInstall(opts);
    return { status: started.ok ? 200 : 400, body: started };
  }
  const res = installPackages(opts);
  return { status: res.ok ? 200 : 400, body: res };
}

/**
 * `/npm-publish`：发包。**默认 dry-run**（只体检 + `npm publish --dry-run`，不写 registry ✗）；
 * 真发必须同时 `confirm:true` **且** `dryRun:false`（双闸门，防误发不可撤销）。
 */
export async function handleNpmPublish(ctx) {
  const { env, cfg, body } = ctx;
  const dryRun = body?.dryRun !== false;
  if (!dryRun && body?.confirm !== true) {
    return {
      status: 400,
      body: { ok: false, blocked: 'need-confirm', error: '真实发布会写入 registry 且不可撤销：需同时传 confirm:true 与 dryRun:false（默认只做 dry-run）' },
    };
  }
  const r = await publishPackage({
    dir: String(body?.dir || env?.workspaceRoot || ''),
    registry: cfg?.npmRegistry || '',
    workspaceRoot: env?.workspaceRoot || '',
    dryRun,
    tag: body?.tag || 'latest',
    otp: body?.otp || '',
    confirm: body?.confirm === true,
  });
  return { status: r.ok ? 200 : 400, body: r };
}
