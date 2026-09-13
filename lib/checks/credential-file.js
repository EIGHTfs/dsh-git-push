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
    const pats = rule.patterns || (rule.pattern ? [rule.pattern] : []);
    for (const p of pats) {
      let re;
      try { re = p instanceof RegExp ? p : new RegExp(String(p), 'i'); } catch { continue; }
      if (re.test(target) || re.test(base)) {
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'credential-file',
          severity: capSeverity(rule.severity, 'blocker'),
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
