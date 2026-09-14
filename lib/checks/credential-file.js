/**
 * 检查层 · 凭据文件检查
 *
 * 职责：识别并检查仓库中的凭据类文件（.env、密钥文件等）。
 */

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFinding } from '../audit/index.js';
import { capSeverity } from './common.js';

/** 检查文件路径规则（credential-file：私钥/凭据文件路径命中）。 */
export function checkCredentialFiles({ file, relPath, rules }) {
  const findings = [];
  const target = String(relPath || file || '');
  const base = target.split(/[/\\]/).pop() || '';
  for (const rule of rules || []) {
    // 2026-09-14 bugfix：compilers/credential.js 对 credfile-* 规则编译输出的是
    //   pathPattern 字段（取自 yml path_pattern），但这里原来只读 patterns/pattern
    //   → .env / 密钥目录等凭据文件路径规则永远不触发（审计变动文件拦截形同虚设）。
    //   现在两种形态都认：pathPattern 优先，patterns/pattern 兼容旧规则。
    const pats = rule.pathPattern ? [rule.pathPattern] : (rule.patterns || (rule.pattern ? [rule.pattern] : []));
    for (const p of pats) {
      let re;
      try { re = p instanceof RegExp ? p : new RegExp(String(p), 'i'); } catch { continue; }
      if (re.test(target) || re.test(base)) {
        // 2026-09-14：severity 契约对齐 checkPathRegexRules——yml error 级凭据文件
        //   （编译后 level=blocker）必须升 blocker 拦截提交；warning 级保持 warning。
        //   原来 capSeverity('error','blocker') 恒返回 'error'，runAudit 只认 blocker → 永不拦截。
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'credential-file',
          severity: rule.level === 'blocker' ? 'blocker' : capSeverity(rule.severity, 'warning'),
          message: rule.message || `凭据/私钥类文件：${base}`,
          dimensions: rule.dimensions || ['安全性'],
          exemptHint: 'dsh-skip-sensitive（文件头=整文件 / 行尾=本行）',
          scoreImpact: 2,
        }));
        break;
      }
    }
  }
  return findings;
}
