/**
 * 「拼接产物作用域检查」的**共享执行器**（工具 / 独立脚本 / 审计规则共用一份判定）。
 *
 * 为什么要有这一层：同一件事有三个入口（`scope_check` 工具、`scripts/check-js-scope.mjs`、
 *   审计规则 kind=scope-collision），执行流程一旦各写一份就会漂移。这里只做
 *   「找契约 → 逐文件分析 → 汇总」，真正的判定在 `lib/ast/scope-collisions.js`，
 *   「按文件所属项目取契约」在 `lib/audit/scope-policy.js`（中立模块，审计侧也用它）。
 *
 * 契约适用口径（与审计侧**故意不同**，各有各的输入面）：
 *   · 本执行器：目标文件是调用方**显式点名**的 ⇒ 视为产物；项目给了 `files` 清单
 *     且不含该文件时仍不套契约（典型场景：分片源码不是产物，套前缀会把局部变量
 *     全判成缺前缀）。
 *   · 审计侧（lib/checks/scope-collision.js）：那是**全仓扫描**，必须严格按
 *     `files` 清单命中，否则每个 js 文件都会被套上前缀契约。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { analyzeScopeCollisions } from '../ast/scope-collisions.js';
import { POLICY_SOURCE, readProjectScopePolicy } from '../audit/scope-policy.js';

export { POLICY_SOURCE };

/**
 * 找出某个文件所属项目的契约配置（兼容旧名，实现在中立模块）。
 * @param {string} file 目标文件绝对路径
 */
export function policyForFile(file) {
  return readProjectScopePolicy(file);
}

/**
 * 逐文件跑检查。
 * @param {{files:string[], prefix?:string, allowlist?:string[], topLevelMustBeEmpty?:boolean}} o
 *   prefix/allowlist/topLevelMustBeEmpty 显式给出时覆盖项目配置（顶层零声明需显式 true/false）。
 * @returns {{ok:boolean, reports:Array<object>, policySources:string[]}}
 */
export function runScopeCheck({ files = [], prefix = '', allowlist = [], topLevelMustBeEmpty } = {}) {
  const reports = [];
  const policySources = new Set();
  for (const raw of files) {
    const file = resolve(raw);
    const own = readProjectScopePolicy(file);
    // 项目没给 files 清单时，点名文件即产物；给了清单就只认清单内的文件
    const contractApplies = own.declared && (own.files.length === 0 || own.isDeclaredArtifact);
    const explicit = [];
    if (prefix) explicit.push('prefix');
    if (Array.isArray(allowlist) && allowlist.length) explicit.push('allowlist');
    if (typeof topLevelMustBeEmpty === 'boolean') explicit.push('topLevel');
    const policy = {
      prefix: prefix || (contractApplies ? own.prefix : ''),
      allowlist: Array.isArray(allowlist) && allowlist.length ? allowlist : (contractApplies ? own.allowlist : []),
      topLevelMustBeEmpty: typeof topLevelMustBeEmpty === 'boolean'
        ? topLevelMustBeEmpty
        : (contractApplies && own.topLevelMustBeEmpty),
    };
    const source = explicit.length
      ? `${POLICY_SOURCE.CLI}（${explicit.join('/')}）`
      : `${own.source}${own.configPath ? `：${own.configPath}` : ''}`;
    policySources.add(source);
    if (!existsSync(file)) {
      reports.push({ file, ok: false, missing: true, violations: [`文件不存在：${file}`], declarations: [], duplicates: [] });
      continue;
    }
    const result = analyzeScopeCollisions(readFileSync(file, 'utf8'), policy);
    reports.push({ file, ...result, policy });
  }
  return { ok: reports.every((r) => r.ok), reports, policySources: [...policySources] };
}
