/**
 * 审计包客户端（宿主侧唯一入口）
 *
 * 拆包后审计实现住在 `audit-sluice`，宿主**不再自己实现**判定，只负责：解析包位置 →
 * 调它的公开面 → 把结果转给 AI/前端。本文件就是那个「调」的位置：
 *   · 包位置解析复用 pre-commit-engine 的同一套规则（env → node_modules → 平级目录），
 *     保证「工具调用」与「提交门禁」永远指向**同一个**包（否则两处行为会分叉）；
 *   · 用**动态 import**（不是子进程）：工具调用要返回结构化对象，进程内调用省掉序列化与启动开销，
 *     且包的公开面（`lib/index.js`）本来就是给 library 形态准备的。
 *
 * 为什么集中在一个文件：宿主里有 5 个工具 + 若干 handler 要用审计能力，
 *   各自 `import(...)` 会让「包路径怎么找」散成 N 处（一处改了漏另一处 ⇒ 有的工具悄悄用旧实现）。
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveAuditSluiceEntry } from '../commit-push/pre-commit-engine.js';

/** 已加载的包模块（进程内单例：包是纯函数集合，重复加载只浪费内存）。 */
let cachedModule = null;
let cachedHostApi = null;
let cachedRoot = '';

/**
 * 解析审计包根目录（CLI 入口所在目录）。
 * @returns {{ok: true, root: string, source: string} | {ok: false, error: string}}
 */
export function resolveAuditPackageRoot() {
  const entry = resolveAuditSluiceEntry();
  if (!entry.ok) return entry;
  return { ok: true, root: dirname(entry.path), source: entry.source };
}

/**
 * 取审计包模块（懒加载 + 缓存）。
 * 失败时抛出**可诊断**的错误：调用方（工具层）会把它转成 `{ ok:false, error }` 给 AI 看。
 * @returns {Promise<object>}
 */
export async function loadAuditPackage() {
  if (cachedModule) return cachedModule;
  const resolvedRoot = resolveAuditPackageRoot();
  if (!resolvedRoot.ok) throw new Error(resolvedRoot.error);
  const entryFile = join(resolvedRoot.root, 'lib', 'index.js');
  if (!existsSync(entryFile)) {
    throw new Error(`审计包缺少公开面 ${entryFile}（包根 ${resolvedRoot.root}）——检查 audit-sluice 是否完整`);
  }
  cachedModule = await import(pathToFileURL(entryFile).href);
  cachedRoot = resolvedRoot.root;
  return cachedModule;
}

/** 当前已加载的包根（未加载时为空串；供状态/排查展示）。 */
export function auditPackageRoot() {
  return cachedRoot;
}

/** 供测试重置缓存（改 DSH_AUDIT_SLUICE_CLI 后要能重新解析）。 */
export function resetAuditPackageCache() {
  cachedModule = null;
  cachedHostApi = null;
  cachedRoot = '';
}

/**
 * 宿主对接面（规则包/聚合/豁免提示/预处理参数与文案）——从审计包 `lib/host-api.js` 取。
 * 包的对接面**只提供已完成的中立能力，不含宿主策略**；宿主策略（job、缓存、路由整形）留在这里。
 * @returns {Promise<object>}
 */
export async function hostApi() {
  if (cachedHostApi) return cachedHostApi;
  const resolvedRoot = resolveAuditPackageRoot();
  if (!resolvedRoot.ok) throw new Error(resolvedRoot.error);
  const entryFile = join(resolvedRoot.root, 'lib', 'capabilities.js');
  if (!existsSync(entryFile)) throw new Error(`审计包缺少能力出口 ${entryFile}`);
  cachedHostApi = await import(pathToFileURL(entryFile).href);
  return cachedHostApi;
}

/**
 * 跑审计报告（`code_audit` 工具的实体）。
 * @param {object} options 见 audit-sluice `auditReport`
 * @returns {Promise<object>}
 */
export async function auditReport(options = {}) {
  const pkg = await loadAuditPackage();
  return pkg.auditReport({ ...options, repo: resolve(String(options.repo || '.')) });
}

/** 历史审计（按 commit 区间逐版本审计 + 报告）。 */
export async function auditHistory(options = {}) {
  const pkg = await loadAuditPackage();
  return pkg.auditHistory({ ...options, repo: resolve(String(options.repo || '.')) });
}

/** IO 风险扫描。 */
export async function ioScan(options = {}) {
  const pkg = await loadAuditPackage();
  return pkg.ioScan({ ...options, ...(options.root ? { root: resolve(String(options.root)) } : {}) });
}

/** 链接检查。 */
export async function linkCheck(options = {}) {
  const pkg = await loadAuditPackage();
  return pkg.linkCheck({ ...options, ...(options.path ? { path: resolve(String(options.path)) } : {}) });
}

/** 拼接产物作用域撞名检查。 */
export async function scopeCheck(options = {}) {
  const pkg = await loadAuditPackage();
  return pkg.scopeCheck({ ...options });
}

/** 注释豁免标注（add/remove/list/check）。 */
export async function exemptAction(options = {}) {
  const pkg = await loadAuditPackage();
  return pkg.exemptAction({ ...options });
}

/** 聚合查询维度清单（宿主 HTTP/工具提示共用；从包取，不在宿主里再写一份）。 */
export async function groupByKeys() {
  const pkg = await loadAuditPackage();
  return pkg.GROUP_BY_KEYS;
}
