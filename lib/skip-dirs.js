/**
 * 统一「无条件跳过目录」名单（2026-09-16 收敛）。
 *
 * 组成 = 硬编码基线 + yml 黑名单关键词：
 *  - 硬编码基线：**只允许 node_modules 和 .git 两个**——禁止在本文件追加目录名
 *    （dist/build/vendor/coverage/.dsh/.trash/.npm/.pnpm-store/.tmp-build 等一律不许写死在代码里）。
 *  - yml 黑名单关键词：从审计规则 yml 的 `exclude_dirs` 字段加载（各规则的黑名单目录并集，
 *    如 folder 规则的 dist/build/vendor/.dsh/.trash 等）。要新增跳过目录 → 改 yml，不改代码。
 *
 * 白名单（gitignore negation）不受影响：collector walk 对「被忽略目录」按前缀跳过，
 *   但 gitignore 白名单恢复的目录仍会进入（黑名单初筛 + 白名单补充）。
 *
 * 消费方：lib/audit/collector.js（审计文件收集）、lib/git/sensitive.js（敏感扫描）、
 *        scripts/scrub-user-wording.mjs（沟通措辞清洗）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from './vendor/js-yaml/js-yaml.mjs';

/** 硬编码基线：只许这两个（勿改）。 */
export const SKIP_DIRS = new Set(['node_modules', '.git']);

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
