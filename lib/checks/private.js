/**
 * 检查层 · 私密文件检查
 *
 * 职责：私有仓库可见性与私密文件清单核对。
 */

import { globToRegex } from '../audit/glob.js';

import { execFileSync } from 'node:child_process';

import { makeFinding } from '../audit/index.js';

/**
 * 私密文件拦截检查（private 槽位，1.0.4，T1-T33 考古验收）。
 * git ls-files 列全部跟踪文件 × private_files glob 匹配，按远端可见性分级：
 *   visibility=public → blocker（私钥/凭据已可被任何人获取，禁止推送）
 *   visibility=private|unknown → warning（私有边界内仅提醒，转公开前须先移除）
 * @param {object} p { root, visibility, privateFiles[] } visibility: 'public'|'private'|'unknown'
 * @returns {Array} findings
 */
export function checkPrivateFiles({ root, visibility = 'unknown', privateFiles = [] }) {
  const findings = [];
  if (!root || !Array.isArray(privateFiles) || privateFiles.length === 0) return findings;
  let tracked;
  try {
    // 2026-09-16：显式捕获 stderr——execFileSync 未设 stdio 时异常会把子进程 stderr 直通父进程
    //   （非 git 目录跑 git ls-files 会打印「致命错误：不是 git 仓库」污染 audit --json 输出）
    const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
    tracked = out.split('\n').filter(Boolean);
  } catch (e) { /* 非 git 仓库 / git 不可用 → 跳过 */
    if (String(e?.stderr || '').trim()) { /* stderr 已捕获，静默 */ }
    return findings;
  }
  if (!tracked.length) return findings;
  const compiled = privateFiles
    .map((g) => ({ glob: g, re: globToRegex(g) }))
    .filter((x) => x.re);
  const hits = [];
  for (const p of tracked) {
    for (const pf of compiled) {
      if (pf.re.test(p)) { hits.push(p); break; }
    }
  }
  if (!hits.length) return findings;
  const publicGate = visibility === 'public';
  for (const p of hits) {
    findings.push(makeFinding({
      file: p, line: 1, rule: publicGate ? 'private-file-public' : 'private-file-in-repo',
      kind: 'private-files',
      severity: publicGate ? 'blocker' : 'warning',
      message: publicGate
        ? `仓库跟踪私密文件 ${p} 且远端公开（public）——私钥/凭据已可被任何人获取，禁止推送；请移除该文件或转为私有仓库`
        : `仓库跟踪私密文件 ${p}（远端 ${visibility === 'private' ? '私有' : '未确认'}）；私有边界内仅提醒，若未来转公开请先移除`,
      dimensions: ['安全性', '可部署性'],
      exemptHint: 'dsh-skip-sensitive（文件头=整文件）',
      scoreImpact: publicGate ? 1 : 0,
    }));
  }
  return findings;
}
