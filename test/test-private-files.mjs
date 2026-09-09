/** dsh-skip-sensitive dsh-git-push v1.1.0 私密拦截审计三态单测（v1.48.0）
 * 文件头 dsh-skip-sensitive：本文件含 id_ed25519 / .env / github-token 等私密文件样本路径（作为测试输入数据），
 * 提交前豁免敏感内容扫描。
 * 覆盖：远端 public → blocker 拦截 / private → warning 不拦 / unknown → warning / 无私密文件 → 0 finding /
 *       glob 全量匹配（git ls-files 存量级，不依赖 diff）。 */
import { auditRepo, resetAuditRuleset, scanPrivateFilesForVisibility } from '../lib/audit.js';
import { getCompiledRulePack, clearRulePackCache } from '../lib/rule-packs.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

// 临时 git 仓：真实 git init + commit（文件名含私密样本，内容中性）
const root = mkdtempSync(join(tmpdir(), 'gitpush-private-test-'));
const repo = join(root, 'repo');
mkdirSync(repo, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: repo });
execFileSync('git', ['config', 'user.email', 't@t.local'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
writeFileSync(join(repo, 'index.js'), 'const x = 1;\n');
writeFileSync(join(repo, 'id_ed25519'), '-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n');
mkdirSync(join(repo, 'data', 'sensitive'), { recursive: true });
writeFileSync(join(repo, 'data', 'sensitive', 'github-token'), 'not-a-real-token\n');
execFileSync('git', ['add', '-A'], { cwd: repo });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });

// 干净对照仓（无任何私密文件）
const repoClean = join(root, 'clean');
mkdirSync(repoClean, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: repoClean });
execFileSync('git', ['config', 'user.email', 't@t.local'], { cwd: repoClean });
execFileSync('git', ['config', 'user.name', 't'], { cwd: repoClean });
writeFileSync(join(repoClean, 'index.js'), 'const y = 2;\n');
execFileSync('git', ['add', '-A'], { cwd: repoClean });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoClean });

clearRulePackCache();
resetAuditRuleset();
const rs = getCompiledRulePack('');

/* ---------- 直接扫描函数三态 ---------- */
const sPub = scanPrivateFilesForVisibility(repo, { visibility: 'public', ruleset: rs });
ok(sPub.findings.length >= 2, `public 仓命中私密文件（≥2）实际: ${sPub.findings.length}`);
ok(sPub.findings.every((f) => f.level === 'blocker' && f.rule === 'private-file-public'), 'public → 全部 blocker');
ok(sPub.files.some((p) => p.includes('id_ed25519')) && sPub.files.some((p) => p.includes('github-token')), `files 列全量命中路径: ${sPub.files.join(',')}`);

const sPriv = scanPrivateFilesForVisibility(repo, { visibility: 'private', ruleset: rs });
ok(sPriv.findings.every((f) => f.level === 'warning' && f.rule === 'private-file-in-repo'), 'private → 全部 warning');

const sUnk = scanPrivateFilesForVisibility(repo, { visibility: 'unknown', ruleset: rs });
ok(sUnk.findings.every((f) => f.level === 'warning'), 'unknown → warning 保守提醒');

const sClean = scanPrivateFilesForVisibility(repoClean, { visibility: 'public', ruleset: rs });
ok(sClean.findings.length === 0 && sClean.files.length === 0, '干净仓 → 0 finding');

/* ---------- auditRepo 整体（blockOn=blocker 语义）---------- */
// 无变更 + public：早退分支也跑存量扫描 → blocked
const aPub = auditRepo(repo, { blockOn: 'blocker', visibility: 'public', files: [] });
ok(aPub.ok && aPub.blocked === true, `auditRepo public+存量私密 → blocked（早退分支）实际 blocked=${aPub.blocked}`);
ok(aPub.findings.some((f) => f.rule === 'private-file-public' && f.level === 'blocker'), 'auditRepo public finding 为 private-file-public blocker');
// 无变更 + private：warning 不拦
const aPriv = auditRepo(repo, { blockOn: 'blocker', visibility: 'private', files: [] });
ok(aPriv.ok && aPriv.blocked === false, `auditRepo private+存量私密 → 不拦（warning）实际 blocked=${aPriv.blocked}`);
ok(aPriv.findings.some((f) => f.rule === 'private-file-in-repo' && f.level === 'warning'), 'auditRepo private finding 为 warning');
// 干净仓 public：不拦截
const aClean = auditRepo(repoClean, { blockOn: 'blocker', visibility: 'public', files: [] });
ok(aClean.blocked === false && aClean.findings.filter((f) => f.rule.startsWith('private-file')).length === 0, '干净仓 public → 无私密 finding 不拦');

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
rmSync(root, { recursive: true, force: true });
process.exit(fail ? 1 : 0);