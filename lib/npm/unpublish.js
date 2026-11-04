/**
 * npm 撤包（`npm unpublish`）。
 *
 * 为什么单独做、且**默认 dryRun**：撤包不可逆——
 *   · 一个 `包@版本` 一旦用过，即使撤掉也**永久不能再发**同一个号；
 *   · 官方只承诺 registry 不再提供，不承诺清 CDN/第三方镜像/已下载副本；
 *   · 撤掉 `latest` 会让 dist-tags 悬空，影响所有 `npm i <包>` 的人。
 *   所以调用方必须先看清「要撤什么、撤完会怎样」，再显式 `confirm` 才真撤。
 *
 * 预检能回答什么（都不联网到第三方，只查 registry 元数据）：
 *   · 版本是否存在；dist-tags 是否指向它（撤 latest 有额外影响）；
 *   · 发布距今是否在 72 小时窗口内（窗口内且无依赖者才符合官方条件）；
 *   · 是否该包唯一版本（撤光会让包名冷却 24h）。
 * 预检**不能**回答：是否有其它包依赖它（公共 registry 没有 reverse-deps 接口），
 *   这一条只能由 npm 服务端判定，失败时如实把 npm 的报错回传。
 */
import { DEFAULT_REGISTRY, NPM_TIMEOUT_MS, normalizeRegistry, runNpm } from './registry.js';
import { npmArgs, writeNpmrc } from './npmrc.js';
import { readNpmToken } from '../core/credentials.js';

/** 官方 unpublish 政策里的时间窗：发布 72h 内（且无依赖者）可自由撤。 */
const UNPUBLISH_WINDOW_MS = 72 * 60 * 60 * 1000;
/** 整包撤光后，同名包 24h 内不能发布。 */
const WHOLE_PACKAGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** 归一化包名/版本入参，做前置校验（不联网）。 */
export function parseTarget({ name = '', version = '', wholePackage = false } = {}) {
  const pkg = String(name || '').trim();
  const ver = String(version || '').trim();
  if (!pkg) return { ok: false, error: '缺 name（要撤的包名）' };
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(pkg)) return { ok: false, error: `包名不合法：${pkg}` };
  if (!wholePackage && !ver) return { ok: false, error: '缺 version；若确实要撤整个包，请显式传 wholePackage:true（会连带撤所有版本）' };
  if (!wholePackage && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(ver)) return { ok: false, error: `版本号不合法：${ver}` };
  return { ok: true, name: pkg, version: ver, wholePackage: wholePackage === true };
}

/**
 * 预检：查 registry 元数据，给出「撤这个版本会发生什么」。
 * @param {{name:string, version:string, wholePackage?:boolean,
 *          registry?:string, timeoutMs?:number, fetchImpl?:Function}} o
 */
export async function preflightUnpublish({ name = '', version = '', wholePackage = false, registry = DEFAULT_REGISTRY, timeoutMs = NPM_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  const target = parseTarget({ name, version, wholePackage });
  if (!target.ok) return { ok: false, error: target.error };
  const reg = normalizeRegistry(registry);
  const url = `${reg.replace(/\/$/, '')}/${name.replace('/', '%2f')}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (res.status === 404) return { ok: false, error: `registry 上不存在该包：${name}` };
    if (res.status !== 200) return { ok: false, error: `查询失败：HTTP ${res.status}` };
    const doc = await res.json();
    const versions = Object.keys(doc.versions || {});
    const publishedAt = (doc.time || {})[target.version] || '';
    const ageMs = publishedAt ? Date.now() - Date.parse(publishedAt) : null;
    const tagsPointingHere = Object.entries(doc['dist-tags'] || {}).filter(([, v]) => v === target.version).map(([t]) => t);
    if (!wholePackage && !versions.includes(target.version)) {
      return { ok: false, error: `版本不存在：${name}@${target.version}（现有版本：${versions.join(', ')}）` };
    }
    const warnings = [];
    if (tagsPointingHere.length) {
      warnings.push(`dist-tag ${tagsPointingHere.join('/')} 指向该版本：撤掉后这些 tag 会失效/悬空（建议先把 tag 移到其它版本）`);
    }
    if (versions.length <= 1) {
      warnings.push(`该包只有 1 个版本：撤光后同名包名将冷却 ${WHOLE_PACKAGE_COOLDOWN_MS / 3600000} 小时`);
    }
    return {
      ok: true,
      name, version: target.version, wholePackage: target.wholePackage,
      exists: true,
      versions,
      publishedAt,
      ageHours: ageMs === null ? null : Math.round(ageMs / 3600000),
      withinWindow: ageMs === null ? null : ageMs <= UNPUBLISH_WINDOW_MS,
      tagsPointingHere,
      warnings,
      // 72h 内只是「可以申请撤」的必要条件之一；依赖者一条只有服务端能判
      policyHint: ageMs !== null && ageMs > UNPUBLISH_WINDOW_MS
        ? '已超出 72h 窗口：只有「无依赖者 + 近一周下载<300 + 单一维护者」三者同时满足才允许撤，否则只能 npm deprecate'
        : '在 72h 窗口内：无其它包依赖它时可直接撤',
      // 撤包不可逆的提醒：即使成功，该版本号也永久作废
      irreversible: `撤掉后 ${name}@${target.version} 永久不能再发布（只能发新版本号）`,
    };
  } catch (e) {
    return { ok: false, error: `查询失败：${String(e?.message || e).slice(0, 200)}` };
  } finally { clearTimeout(timer); }
}

/**
 * 执行撤包。
 * @param {{name:string, version?:string, wholePackage?:boolean, registry?:string,
 *          workspaceRoot?:string, dryRun?:boolean, confirm?:boolean, timeoutMs?:number}} o
 */
export async function unpublishPackage({
  name = '', version = '', wholePackage = false,
  registry = DEFAULT_REGISTRY, workspaceRoot = '',
  dryRun = true, confirm = false, timeoutMs = 120000,
  // 可注入（测试用）：npm 执行器、registry 查询、凭据
  runNpmImpl = runNpm, fetchImpl = globalThis.fetch, token = '',
} = {}) {
  const pre = await preflightUnpublish({ name, version, wholePackage, registry, fetchImpl });
  if (!pre.ok) return { ok: false, blocked: 'preflight-failed', error: pre.error };
  if (dryRun) {
    return {
      ok: true, dryRun: true, ...pre,
      wouldRun: `npm unpublish ${name}${wholePackage ? '' : `@${pre.version}`}${wholePackage ? ' --force' : ''}`,
      hint: '确认无误后传 dryRun:false + confirm:true 才真正撤包（不可逆）',
    };
  }
  if (confirm !== true) {
    return { ok: false, blocked: 'need-confirm', ...pre, error: '真实撤包不可逆：需同时传 dryRun:false 与 confirm:true' };
  }
  const tokenValue = token || (() => { try { return readNpmToken({ workspaceRoot }); } catch { return ''; } })();
  // 没有凭据必须当场拒绝：实测 npm 在**无认证**时会对 unpublish 发 PUT 拿到 404，
  //   但**退出码仍是 0** 并打印「- pkg@ver」，看起来像撤成功（历史假成功就是这么来的）。
  if (!tokenValue) {
    return { ...pre, ok: false, blocked: 'no-token', error: '插件配置里没有可用的 npmToken（或未生效），无法撤包；请先配置 npm 凭据' };
  }
  const rc = writeNpmrc({ workspaceRoot, registry, token: tokenValue });
  if (!rc.ok) return { ok: false, error: rc.error || 'npmrc 写入失败' };
  const args = ['unpublish', wholePackage ? name : `${name}@${pre.version}`, ...npmArgs({ npmrcFile: rc.file, registry })];
  if (wholePackage) args.push('--force');
  const r = runNpmImpl(args, { timeoutMs, env: { NO_UPDATE_NOTIFIER: '1' } });
  const npmText = String(r.error || r.stderr || r.stdout || '');
  if (!r.ok) {
    // granular token 的 2FA 限制是最常见的硬阻塞，单独给出可执行指引
    const twoFactorBlocked = /granular access token/i.test(npmText) || /bypass two-factor/i.test(npmText);
    return {
      ...pre, ok: false,
      error: `npm unpublish 失败：${npmText.slice(0, 400)}`,
      ...(twoFactorBlocked
        ? { hint: '该 token 是「绕过 2FA 的 granular token」，npm 禁止它执行撤包。改用：① npm 网站手动撤（需 2FA）；② 换 classic token 并带 --otp；③ 本机 npm login 后执行' }
        : { hint: '若提示 72h/依赖者/下载量限制，说明不满足官方撤包条件——改用 npm deprecate 让使用者看到警告而不破坏构建' }),
    };
  }
  // **关键**：npm 的 unpublish 在若干失败情形下仍会 exit 0 并打印「- pkg@ver」。
  //   唯一可信的判据是回读 registry：版本真的没了才算成功。
  const after = await preflightUnpublish({ name, version: pre.version, wholePackage, registry, fetchImpl });
  const stillThere = after.ok && !wholePackage && Array.isArray(after.versions) && after.versions.includes(pre.version);
  if (stillThere) {
    return {
      ...pre, ok: false, verified: false,
      error: `npm 退出码为 0，但 registry 里 ${name}@${pre.version} 仍在——撤包未生效`,
      npmOutput: npmText.slice(-600),
      hint: '常见原因：token 无权限/需 2FA/被 granular token 策略禁止。请改用 npm 网站或 classic token + --otp',
    };
  }
  return {
    ok: true, dryRun: false, ...pre,
    unpublishd: wholePackage ? `${name}（全部版本）` : `${name}@${pre.version}`,
    stdout: String(r.stdout || '').slice(-2000),
    note: '撤包不可逆：该版本号永久作废；对外索引（第三方镜像/文档）不会自动清理',
  };
}
