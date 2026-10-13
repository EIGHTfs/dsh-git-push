/**
 * npm 账号状态快照（与 `lib/git/account-status.js` **完全对称**）。
 *
 * 为什么要有快照：GitHub 账号那套是「离线读快照秒回 + 点按钮才在线校验」；
 *   npm 上一版是「每次打开都跑 npm whoami」✗ —— 联网慢、与 GitHub 不同源。
 *   这里补齐对称结构：`readNpmAccountStatus`（离线）+ `writeNpmAccountStatus`（在线校验后落盘）。
 * 落盘位置：凭据目录（0600）下的 `npm-account-status.json`，不写仓库、不含明文 token。
 */
import { join } from 'node:path';

import { credentialsDir } from '../core/credentials.js';
import { readJson, writeJsonAtomic } from '../core/atomic-json.js';

export const STATUS_FILE = 'npm-account-status.json';

/** 快照文件路径（凭据目录内）。 */
export function npmAccountStatusFile({ workspaceRoot = '' } = {}) {
  return join(credentialsDir({ workspaceRoot }), STATUS_FILE);
}

/** 离线读快照（不存在/损坏 ⇒ 空对象，不抛错）。 */
export function readNpmAccountStatus({ workspaceRoot = '' } = {}) {
  try {
    return readJson(npmAccountStatusFile({ workspaceRoot })) || {};
  } catch {
    return {};
  }
}

/** 写快照（原子写 + 0600）。 */
export function writeNpmAccountStatus(status = {}, { workspaceRoot = '' } = {}) {
  try {
    return writeJsonAtomic(npmAccountStatusFile({ workspaceRoot }), { ...status, checkedAt: new Date().toISOString() }, { mode: 0o600 });
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** 由在线校验结果构造快照对象（与 GitHub 的 `buildAccountStatus` 同构）。 */
export function buildNpmAccountStatus({ user = '', registry = '', ok = false, error = '' } = {}) {
  return { ok: !!ok, user: user || '', registry: registry || '', error: error || '', checkedAt: new Date().toISOString() };
}

/**
 * 渲染账号块文本——与 GitHub 凭据块**同规格的逐行 ✅/⚠️**（前端直接塞进 `<pre class="dshgp_acctblock2">`）。
 * @param {object} snap 快照
 * @param {{configured:boolean, maskedToken:string, registry:string}} o 凭据文件真源 + registry
 * @returns {string} 多行文本
 */
export function renderNpmAccountBlock(snap = {}, { configured = false, maskedToken = '', registry = '' } = {}) {
  const reg = registry || snap.registry || '';
  const at = snap.checkedAt ? String(snap.checkedAt).slice(0, 16).replace('T', ' ') : '';
  if (!configured) {
    return ['⚠️ 未配置 npm token', `⚠️ registry：${reg}`, '⚠️ 到「设置 → 凭据与密钥」填写 npm token 后即可显示登录态'].join('\n');
  }
  if (snap.ok && snap.user) {
    return [
      '✅ 凭据可用',
      `✅ npm token：${snap.user}${maskedToken ? `（${maskedToken}）` : ''}｜registry ${reg}`,
      `✅ 登录态：npm whoami 通过${at ? `｜校验于 ${at}` : ''}`,
    ].join('\n');
  }
  return ['⚠️ npm token 已配置，尚未通过校验', `⚠️ registry：${reg}`, `⚠️ ${snap.error || '点「刷新」做一次在线校验'}`].join('\n');
}
