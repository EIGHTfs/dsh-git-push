/** dsh-git-push v1.1.0 apply mock 测试：注册路由/工具 + 审计门禁端到端 */
import { apply, name } from './lib/index.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

// ---------- 临时 git 仓库 ----------
const tmpRoot = mkdtempSync(join(tmpdir(), 'gitpush-apply-'));
function makeRepo(sub) {
  const p = join(tmpRoot, sub);
  mkdirSync(p, { recursive: true });
  execSync('git init -b master', { cwd: p, stdio: 'ignore' });
  writeFileSync(join(p, 'base.js'), 'export const base = 1;\n');
  execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m init', { cwd: p, stdio: 'ignore' });
  return p;
}
const cleanRepo = makeRepo('clean-repo');
const badRepo = makeRepo('bad-repo');
const countCommits = (p) => Number(execSync('git rev-list --count HEAD', { cwd: p, encoding: 'utf8' }).trim());

// ---------- mock ctx ----------
const routes = [];
const tools = [];
const webServer = { register: (d) => routes.push(d) };
const toolReg = { register: (d) => tools.push(d) };
const mockCtx = {
  logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  get: (k) => (k === 'webServer' ? webServer : k === 'tools' ? toolReg : undefined),
  inject: async (deps, fn) => { await fn(mockCtx); },
};

await apply(mockCtx, { workspaceRoot: tmpRoot, auditEnabled: true, blockOn: 'blocker' });
ok(name === 'dsh-git-push', '插件名正确');
ok(routes.length === 1 && routes[0].kind === 'prefix' && routes[0].path === '/api/git-push', '注册了 prefix 路由 /api/git-push');
const toolNames = tools.map((t) => t.name).sort();
ok(toolNames.includes('git_scan') && toolNames.includes('git_commit_push') && toolNames.includes('code_audit') && toolNames.includes('git_clone'), `注册了 ${tools.length} 个工具（含 git_clone）`);

const scan = await tools.find((t) => t.name === 'git_scan').execute({});
const parsed = JSON.parse(scan);
ok(Array.isArray(parsed.repos), 'git_scan 返回仓库数组');

const cp = tools.find((t) => t.name === 'git_commit_push');
const auditTool = tools.find((t) => t.name === 'code_audit');

// ---------- 审计拦截：bad repo（含 token）→ 不提交 ----------
writeFileSync(join(badRepo, 'secret.js'), 'const t = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";\n');
const badBefore = countCommits(badRepo);
const r1 = JSON.parse(await cp.execute({ repo: badRepo, message: 'feat: 带密钥提交', audit: true }));
ok(r1.ok === false && r1.blocked === true, 'git_commit_push 审计拦截带密钥提交');
ok(r1.error?.includes('审计未通过'), '拦截原因说明审计未通过');
ok(r1.findings?.some((f) => f.rule === 'secret'), '拦截时返回 secret findings');
ok(countCommits(badRepo) === badBefore, '被拦截仓库无新提交');

// ---------- code_audit 工具手动审计 ----------
const m1 = JSON.parse(await auditTool.execute({ repo: badRepo }));
ok(m1.blocked === true && m1.findings.some((f) => f.rule === 'secret'), 'code_audit 手动审计检出 secret');

// ---------- 审计放行：clean repo → 提交成功 ----------
writeFileSync(join(cleanRepo, 'feature.js'), 'export const feature = () => 42;\n');
const cleanBefore = countCommits(cleanRepo);
const r2 = JSON.parse(await cp.execute({ repo: cleanRepo, message: 'feat: 干净功能', audit: true }));
ok(r2.ok === true && r2.committed === true, '干净仓库审计通过并提交');
ok(r2.audit?.audited === true && r2.audit?.blocked === false, 'audit 记录 audited=true blocked=false');
ok(countCommits(cleanRepo) === cleanBefore + 1, '提交数 +1');

// ---------- audit=false 跳过审计 ----------
writeFileSync(join(badRepo, 'more.js'), 'export const more = 1;\n');
const badBefore2 = countCommits(badRepo);
const r3 = JSON.parse(await cp.execute({ repo: badRepo, message: 'feat: 跳过审计', audit: false }));
ok(r3.ok === true && r3.committed === true, 'audit=false 跳过审计直接提交');
ok(r3.audit?.audited === false, 'audit 记录 audited=false');
ok(countCommits(badRepo) === badBefore2 + 1, '跳过审计时提交成功');

rmSync(tmpRoot, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
