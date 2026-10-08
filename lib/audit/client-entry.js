/**
 * DSH 客户端入口推导（**中立模块**：供 lib/checks/dispatch.js 与 lib/audit/audit-file.js 共用）。
 *
 * 为什么单独一个文件：`audit-file.js` 依赖 `runChecks`（定义在 `lib/checks/dispatch.js`），
 *   若 `dispatch.js` 反过来从 `audit-file.js` 导入本函数，会形成
 *   dispatch → audit-file → checks → dispatch 的**循环依赖**。
 *   把共用函数下沉到中立模块，两边都从它导入，依赖方向单向。
 *
 * 背景：DSH 要求插件的客户端是**单文件**（`package.json` 的 `dsh.client` + `exports["./client"]`
 *   指向同一文件），该文件天然超长且**不可按模块拆分**。调用方据此**降级**（仍报、不扣分），
 *   而不是静默排除——静默排除会让这个事实从报告里消失。
 *
 * 判据**推导而非写死文件名**：读仓库 `package.json` 的 `exports["./client"]`，兼容三种形态
 *   （字符串 / 条件导出对象 / 数组），并回退看 `dsh.client.entry`。换仓库自动生效。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 推导仓库里的客户端入口文件（仓库相对路径集合）。
 * @param {string} repoRoot 仓库根目录（绝对路径）
 * @returns {Set<string>} 客户端入口的仓库相对路径集合（无 package.json / 无声明 → 空集）
 */
export function resolveDshClientEntries(repoRoot) {
  const out = new Set();
  const pkgPath = join(String(repoRoot || ''), 'package.json');
  if (!existsSync(pkgPath)) return out;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return out; // package.json 损坏 → 按无声明处理（不抛，调用方无需兜底）
  }
  const pick = (v) => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(pick).find(Boolean) || '';
    if (v && typeof v === 'object') {
      for (const k of ['import', 'default', 'require']) if (v[k]) return pick(v[k]);
      return Object.values(v).map(pick).find(Boolean) || '';
    }
    return '';
  };
  const target = pick(pkg.exports && pkg.exports['./client'])
    || pick(pkg.dsh && pkg.dsh.client && pkg.dsh.client.entry);
  const rel = String(target || '').replace(/^\.\//, '').replace(/\\/g, '/');
  if (rel) out.add(rel);
  return out;
}
