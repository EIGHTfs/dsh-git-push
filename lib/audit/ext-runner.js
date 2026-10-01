/**
 * 审计扩展运行器（独立审计脚本自动接入——统一入口动态加载）
 *
 * 契约：`scripts/audit-ext/` 下的每个 .mjs 脚本导出：
 *   export const auditExt = {
 *     name: '扩展名',                    // findings 里 source 标记 `ext:<name>`
 *     match: (repo) => true,            // 是否适用该仓库（false 跳过）
 *     run: async (repo, opts) => [],    // 返回 findings 数组 [{file, line, rule, severity, message, dimensions}]
 *   };
 *
 * 自动接入：新增审计脚本只需放进 `scripts/audit-ext/` 即被统一入口动态加载——
 *   auditFull/auditWithScope 后自动并入 findings；也可 `node scripts/audit-runner.mjs <repo>` 独立跑。
 * 单脚本失败（语法/运行错）try/catch 降级跳过，不中断整体审计。
 */

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
/** 默认扩展目录：插件根 scripts/audit-ext/。 */
export const DEFAULT_EXT_DIR = join(PLUGIN_ROOT, 'scripts', 'audit-ext');

/** 按约定动态加载扩展目录下全部审计扩展脚本。 */
export async function loadAuditExt(dir = DEFAULT_EXT_DIR) {
  const exts = [];
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_'));
  } catch {
    return exts; // 目录不存在 → 无扩展
  }
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(join(dir, f)).href + `?t=${Date.now()}`);
      const ext = mod && (mod.auditExt || mod.default);
      if (ext && typeof ext === 'object' && typeof ext.run === 'function') {
        exts.push({ file: f, name: String(ext.name || f.replace(/\.mjs$/, '')), match: typeof ext.match === 'function' ? ext.match : () => true, run: ext.run });
      }
    } catch (e) {
      // 单脚本加载失败降级跳过（记录，不中断其他扩展）
      console.error(`[audit-ext] 加载失败跳过 ${f}: ${(e && e.message) || e}`);
    }
  }
  return exts;
}

/**
 * 对仓库执行全部适用扩展，聚合 findings。
 * @param {string} repo 仓库路径
 * @param {object} [opts] { dir?: string, log? }
 * @returns {Array} findings（每条带 source: `ext:<name>` 标记）
 */
export async function runAuditExt(repo, opts = {}) {
  const exts = await loadAuditExt(opts.dir);
  const out = [];
  for (const ext of exts) {
    let applicable = true;
    try {
      applicable = ext.match(repo) !== false;
    } catch { applicable = true; }
    if (!applicable) continue;
    try {
      const res = await ext.run(repo, opts);
      if (Array.isArray(res)) {
        for (const f of res) {
          out.push({ ...f, source: `ext:${ext.name}` });
        }
      }
    } catch (e) {
      opts.log?.warn?.(`审计扩展 ${ext.name} 执行失败跳过：${(e && e.message) || e}`);
    }
  }
  return out;
}