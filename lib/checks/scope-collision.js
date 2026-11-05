/**
 * 检查层 · 拼接产物作用域撞名（kind = scope-collision）
 *
 * 判定在 `lib/ast/scope-collisions.js`（token 级、按真实作用域帧），契约在
 *   `lib/audit/scope-policy.js`（按**被审项目自己**的 package.json 取）。
 *
 * 两类命中，严重度口径**故意不同**：
 *   ① 同帧重名（任何 js 文件都查）——分两档，避免把合法写法拦成 blocker：
 *      · 两次都是 var：同一声明的重复写入（后一次等价赋值），运行时无害 → warning；
 *      · 含 function / class / const / let：后声明真的顶掉前者，或拼接后整份产物
 *        直接 SyntaxError → 跟随规则声明（yml `severity: error` ⇒ blocker 拦截提交）。
 *   ② 前缀 / 顶层零声明（**只对项目自己声明的产物文件**生效）——契约类问题，
 *      一律 capSeverity 到 warning：绝不因为别人的风格约定拦下提交。
 *
 * 为什么契约必须以「项目自己声明」为准：规则包是**跨仓库共享**的（同一份 yml 审计所有仓库）。
 *   把 dshgp_ 写进 yml，会给所有被审项目刷出「缺少 dshgp_ 前缀」，
 *   把真正的同帧重名淹掉。项目没声明 dshScopeCheck ⇒ 这里只做通用项（同帧重名）。
 *
 * 豁免：空 rules 短路（规则被 exts/exclude_paths/file_patterns 过滤空时，
 *   防止读 rule.severity 抛错——与 structural.js 各检查器同款守卫）。
 */

import { makeFinding } from '../audit/index.js';
import { readProjectScopePolicy } from '../audit/scope-policy.js';
import { analyzeScopeCollisions } from '../ast/index.js';
import { HINT_QUALITY, capSeverity } from './common.js';

/**
 * @param {object} ctx { file（绝对路径）, relPath, text, rules }
 * @returns {Array} findings
 */
export function checkScopeCollision({ file, text, rules }) {
  const findings = [];
  const rule = (rules || [])[0];
  if (!rule) return findings;

  const project = readProjectScopePolicy(file);
  // 全仓扫描口径：必须严格命中项目声明的 files 清单，不能「没清单就都算产物」
  const enforceContract = project.declared && project.isDeclaredArtifact;
  const result = analyzeScopeCollisions(String(text || ''), {
    prefix: enforceContract ? project.prefix : '',
    allowlist: enforceContract ? project.allowlist : [],
    topLevelMustBeEmpty: enforceContract ? project.topLevelMustBeEmpty : false,
  });

  const ruleId = rule.id || 'dsh/scope-collision';
  const dimensions = rule.dimensions || ['健壮性'];
  const base = { file, rule: ruleId, kind: 'scope-collision', dimensions, exemptHint: HINT_QUALITY, scoreImpact: 1 };
  // 契约类（前缀 / 顶层零声明）与「纯 var 重声明」最高只到 warning
  const softSeverity = capSeverity(rule.severity || 'warning', 'warning');
  // ① 同帧重名：严重度按**命中性质**分档，避免把合法写法拦成 blocker
  //   · 两次都是 var  ⇒ 同一声明的重复写入（后一次等价赋值），运行时无害 → warning
  //   · 含 function / class / const / let ⇒ 后声明真的顶掉前者，或拼接后整份产物
  //     直接 SyntaxError（命名冲突）→ 按规则声明的严重度（error ⇒ blocker）
  const hardSeverity = rule.level === 'blocker' ? 'blocker' : capSeverity(rule.severity || 'warning', 'warning');
  for (const hit of result.duplicates) {
    const varOnly = Array.isArray(hit.keywords) && hit.keywords.every((kw) => kw === 'var');
    findings.push(makeFinding({ ...base, line: hit.line, severity: varOnly ? softSeverity : hardSeverity, message: hit.message }));
  }
  // ② 契约类（项目自选）：恒为 warning
  for (const hit of result.topLevel) {
    findings.push(makeFinding({ ...base, line: hit.line, severity: softSeverity, message: hit.message }));
  }
  for (const hit of result.missingPrefix) {
    findings.push(makeFinding({ ...base, line: hit.line, severity: softSeverity, message: hit.message }));
  }
  return findings;
}
