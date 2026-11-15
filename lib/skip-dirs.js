/**
 * 统一「无条件跳过目录」名单（收敛）。
 *
 * 组成 = 硬编码基线 + yml 黑名单关键词：
 *  - 硬编码基线：node_modules 系列 + .git——禁止在本文件追加业务目录名
 *    （dist/build/vendor/coverage/.dsh/.trash/.npm/.pnpm-store/.tmp-build 等一律不许写死在代码里）。
 *  - yml 黑名单关键词（已随审计包迁走，本仓降级为空）：从审计规则 yml 的 `exclude_dirs` 加载（各规则的黑名单目录并集，
 *    如 folder 规则的 dist/build/vendor/.dsh/.trash 等）。要新增跳过目录 → 改 yml，不改代码。
 *
 * 白名单（gitignore negation）不受影响：collector walk 对「被忽略目录」按前缀跳过，
 *   但 gitignore 白名单恢复的目录仍会进入（黑名单初筛 + 白名单补充）。
 *
 * 消费方：lib/audit/collector.js（审计文件收集）、lib/git/sensitive.js（敏感扫描）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// js-yaml 走 npm 依赖（仓库内不保存副本）。
//   这里**故意用静态 import**：规则加载是启动关键路径，依赖没装上就应当在模块加载期
//   抛 ERR_MODULE_NOT_FOUND（错误里带包名，够响亮），而不是被 try/catch 吞成「0 条规则」
//   继续跑——静默无规则比启动失败更危险（口径见 docs/2026-10-28-弃零依赖引入npm与AST优先规则方案.MD D5）。
import { load as yamlLoad } from 'js-yaml';

/**
 * 硬编码基线。原设计「只许 node_modules 和 .git，其余靠规则 yml 的 exclude_dirs」，
 * 但审计规则 yml 已随审计实现搬进独立包（audit-sluice），本仓不再能读它。
 *
 * 于是这里补上本仓自己确实需要无条件跳过的两个**残留副本目录**：
 *   - `node_modules.orig` / `node_modules.bak`：安装/降级留下的完整副本，
 *     里面同样是依赖代码，扫它既慢又会产生大量无关敏感命中。
 * 其余目录（dist/build/vendor/.dsh/.trash…）仍不写死——需要时改规则或显式传参。
 */
export const SKIP_DIRS = new Set(['node_modules', 'node_modules.orig', 'node_modules.bak', '.git']);

/** 规则 yml 目录（audit-rules-*.yml，与本模块同级的 audit-rules/）。 */
export function auditRulesDir() {
  return join(dirname(fileURLToPath(import.meta.url)), 'audit-rules');
}

let ymlBlacklistCache = null;

/**
 * 从规则 yml 的 exclude_dirs 字段收集黑名单目录关键词（跨 yml 并集）。
 * 加载失败返回空集（不因规则文件损坏阻塞扫描）。
 */
export function loadYamlBlacklistDirs() {
  if (ymlBlacklistCache) return ymlBlacklistCache;
  const out = new Set();
  const dir = auditRulesDir();
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.yml')) continue;
      let doc;
      try { doc = yamlLoad(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
      const rules = doc && Array.isArray(doc.rules) ? doc.rules : [];
      for (const r of rules) {
        if (Array.isArray(r && r.exclude_dirs)) {
          for (const n of r.exclude_dirs) if (typeof n === 'string' && n.trim()) out.add(n.trim());
        }
      }
    }
  } catch { /* 目录缺失/不可读：返回空集 */ }
  ymlBlacklistCache = out;
  return out;
}

/**
 * 最终跳过目录集合 = 硬编码基线 ∪ yml 黑名单关键词。
 * 消费方在遍历剪枝时对目录名命中此集合即整棵跳过。
 */
export function getSkipSet() {
  const set = new Set(SKIP_DIRS);
  for (const n of loadYamlBlacklistDirs()) set.add(n);
  return set;
}
