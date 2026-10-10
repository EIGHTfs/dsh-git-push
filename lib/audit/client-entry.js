/**
 * DSH 客户端入口推导（**中立模块**：供 lib/checks/dispatch.js 与 lib/audit/audit-file.js 共用）。
 *
 * 为什么单独一个文件：`audit-file.js` 依赖 `runChecks`（定义在 `lib/checks/dispatch.js`），
 *   若 `dispatch.js` 反过来从 `audit-file.js` 导入本函数，会形成
 *   dispatch → audit-file → checks → dispatch 的**循环依赖**。
 *   把共用函数下沉到中立模块，两边都从它导入，依赖方向单向。
 *
 * 背景：DSH 要求插件的**运行态客户端**是单文件（`package.json` 的 `dsh.client` + `exports["./client"]`
 *   指向同一文件）——那是**构建产物**，不是源码形态。源码可以按分片维护 + 构建拼接
 *   （见下方 `resolveDshClientFragments`；本仓库 `lib/client-parts/**` → `lib/client.js`，
 *   由 scripts/build-client.mjs 拼接）。
 *   调用方据此**降级**（仍报、不扣分），而不是静默排除——静默排除会让这个事实从报告里消失。
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
  // 空 repoRoot 必须早退：`join('', 'package.json')` = 'package.json' 会命中**当前工作目录**的
  //   package.json（调用方忘了传仓库根时，会拿运行目录的声明冒充仓库声明）。
  if (!repoRoot) return out;
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

/**
 * 推导仓库里的**客户端分片目录**（C8：分片源码 + 拼接产物 的写法）。
 *
 * 为什么不是「不可拆分」：DSH 要求的是**运行态客户端**是单文件（`dsh.client` + `exports["./client"]`
 *   指向同一文件）——那是**构建产物**；源码完全可以按分片维护、由构建脚本拼接成那个单文件
 *   （本仓库：`lib/client-parts/**` → `lib/client.js`，见 scripts/build-client.mjs）。
 *   于是分片目录里的文件是**片段**：单文件语法不成立、行数天然可能超阈值，
 *   需要单独一档作用域（`dsh-client-fragment`）按片段定级，而不是靠「不可拆分」把整类问题挡掉。
 *
 * 判据推导而非写死：① 优先读 `package.json` 的 `dsh.client.fragments`（字符串或数组）；
 *   ② 未显式声明时按**入口同目录 + `<入口名去扩展>-parts/`** 约定推导（`lib/client.js` → `lib/client-parts/`）。
 * @param {string} repoRoot 仓库根目录（绝对路径）
 * @returns {Set<string>} 分片目录的仓库相对路径前缀集合（目录以 `/` 结尾，供 startsWith 匹配）
 */
export function resolveDshClientFragments(repoRoot) {
  const out = new Set();
  if (!repoRoot) return out; // 同 resolveDshClientEntries：空根会让相对 package.json 命中工作目录
  const pkgPath = join(String(repoRoot || ''), 'package.json');
  if (!existsSync(pkgPath)) return out;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return out;
  }
  const decl = pkg.dsh && pkg.dsh.client && pkg.dsh.client.fragments;
  const list = Array.isArray(decl) ? decl : (typeof decl === 'string' ? [decl] : []);
  for (const d of list) {
    const rel = String(d || '').replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/*$/, '/');
    if (rel && rel !== '/') out.add(rel);
  }
  if (out.size) return out;
  for (const entry of resolveDshClientEntries(repoRoot)) {
    const m = /^(.*\/)?([^/]+)\.js$/.exec(entry);
    if (m) out.add(`${m[1] || ''}${m[2]}-parts/`);
  }
  return out;
}
