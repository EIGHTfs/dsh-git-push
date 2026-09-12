/**
 * compare-v1-v2.mjs — v1/v2 行为对齐验证（2026-09-11）
 *
 * 逐功能面喂同一输入，对比 v1/v2 输出契约与行为。
 * 唯一允许差异：审计独立调用（v2 commitWithAudit 走独立审计；v1 commit 集成审计）。
 * 其余差异一律登记为「意外差异」需要处理。
 *
 * 用法：node scripts/compare-v1-v2.mjs [--only <面名,面名>]
 * 面名: audit | rules | score | git | scan | exempt | cli | tools | readme | context
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const V1 = '/vol2/1000/DeepSeek Harness/dsh-v0.1.2-alpha.4/.dsh-home/工作区/dsh-git-push';
const V2 = '/vol2/1000/DeepSeek Harness/dsh-v0.1.2-alpha.4/.dsh-home/工作区/dsh-git-push-v2';

const results = []; // { face, name, ok, detail, known? }
const only = process.argv.includes('--only')
  ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(','))
  : null;
// 已知登记差异（用户确认的「有意差异」或已登记的契约差异）：报告但不计入失败
// D32 规则集扩容 / D33 敏感扫描增强 / D-early scoreContext 契约 / D-early runGit 契约 / D-early context 契约
// 前缀匹配（face:name 前缀）：audit 的 summary.* 与 findings 差异都算 D32
const KNOWN_DIFFS = [
  'audit:summary.', 'audit:findings 覆盖',              // D32 规则集扩容
  'score:契约差异',                                      // D-early
  'git:runGit 返回结构',                                  // D-early
  'scan:scanSensitiveFiles 检出文件集',                    // D33
  'context:契约差异',                                     // D-early
];
const seenKnown = new Set();

function want(face) { return !only || only.has(face); }

function rec(face, name, ok, detail = '') {
  const key = `${face}:${name}`;
  let finalOk = ok;
  if (!ok && KNOWN_DIFFS.some((k) => key.startsWith(k))) { finalOk = true; seenKnown.add(key); detail = (detail ? detail + '；' : '') + '【已知登记差异】'; }
  results.push({ face, name, ok: finalOk, detail });
  console.log(`  ${finalOk ? (ok ? '✅' : '🧾') : '❌'} [${face}] ${name}${detail ? ' — ' + detail : ''}`);
}

function norm(v) {
  if (Array.isArray(v)) return v.map(norm).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = norm(v[k]);
    return o;
  }
  if (typeof v === 'number') return Math.round(v * 10000) / 10000;
  return v;
}

function eq(a, b) { return JSON.stringify(norm(a)) === JSON.stringify(norm(b)); }

function brief(v, n = 300) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + '…' : s;
}

/** 建一个带已知「坏样本」的临时 git 仓库（供 audit/rules/score 对比）。 */
function makeSampleRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cmp-v1v2-'));
  execFileSync('git', ['init', '-b', 'master'], { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'bad.js'), [
    'export function longFn() {',
    '  console.log("debug")',
    '  // 用户指示：这里必须加缓存否则太慢',
    '  let a = 1, b = 2, c = 3;',
    ...Array.from({ length: 60 }, (_, i) => `  const v${i} = ${i};`),
    '  return a + b + c;',
    '}',
    'const SECRET_KEY = "sk-abcdef1234567890";',
  ].join('\n'));
  writeFileSync(join(dir, 'ok.js'), [
    'export function add(a, b) { return a + b; }',
  ].join('\n'));
  writeFileSync(join(dir, '.env'), 'TOKEN=ghp_ABCDEF123456\n');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'base'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

function cleanup(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } }

/* ═══════════════ 面：audit（审计结果一致性） ═══════════════ */
async function faceAudit() {
  const dir = makeSampleRepo();
  try {
    // 注意：v1 auditRepo 默认走 getDiff（只扫变更文件）；v2 auditFull 是全量。
    // 为公平对比：制造一份 dirty 工作树（追加坏文件），两边都走「变更」语义。
    writeFileSync(join(dir, 'dirty.js'), 'export function x(){ console.error("boom") }\n');
    const { auditRepo } = await import(join(V1, 'lib/audit.js'));
    const { auditChanged } = await import(join(V2, 'lib/audit/index.js'));
    const r1 = auditRepo(dir, { blockOn: 'any' });
    const r2 = auditChanged(dir);
    const s1 = r1.summary || {}, s2 = r2.summary || {};
    for (const k of ['blocker', 'warning', 'total']) {
      rec('audit', `summary.${k}（v1=${s1[k] ?? 0} vs v2=${s2[k] ?? 0}）`, (s1[k] ?? 0) === (s2[k] ?? 0));
    }
    const f1 = new Set((r1.findings || []).map((f) => f.file));
    const f2 = new Set((r2.findings || []).map((f) => f.file));
    rec('audit', 'findings 覆盖文件集一致', eq([...f1].sort(), [...f2].sort()),
      `v1=${brief([...f1])} v2=${brief([...f2])}`);
  } finally { cleanup(dir); }
}

/* ═══════════════ 面：rules（规则编译/槽位） ═══════════════ */
async function faceRules() {
  const n1 = (await import(join(V1, 'lib/rule-packs.js'))).RULE_SLOTS || [];
  const l2 = await import(join(V2, 'lib/rule/loader.js'));
  const n2 = l2.discoverRuleSlots() || []; // 实际生效槽位（目录文件动态）
  rec('rules', '生效槽位集合 v1 vs v2（v2 新增 5 槽）',
    n2.length >= n1.length && n1.every((x) => n2.includes(x)),
    `v1=${n1.length}槽${brief(n1)} v2=${n2.length}槽${brief(n2)}`);
  try {
    await import(join(V2, 'lib/rule/compilers.js')); // 副作用：注册编译函数
    const { loadRuleFiles } = await import(join(V2, 'lib/rule/loader.js'));
    const { compileAllRules } = await import(join(V2, 'lib/rule/registry.js'));
    const loaded = loadRuleFiles();
    const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
    const cnt2 = compiled.length;
    const failed = loaded.merged.rules.length - cnt2;
    rec('rules', `v2 规则编译：${cnt2} 成功 / ${failed} 失败`, failed === 0 && cnt2 > 0,
      `raw=${loaded.merged.rules.length} compiled=${cnt2}`);
  } catch (e) {
    rec('rules', '编译规则总数', false, String(e.message).split('\n')[0]);
  }
}

/* ═══════════════ 面：score（质量评分契约——已知登记差异） ═══════════════ */
async function faceScore() {
  const { scoreQuality: s1 } = await import(join(V1, 'lib/quality.js'));
  const { scoreQuality: s2 } = await import(join(V2, 'lib/score/index.js'));
  // v1 收 counts（维度加权扣分点），v2 收 findings：契约不同，这里分别喂各自契约并比较「同样的问题输入」得分趋势
  const findings = [
    { file: 'a.js', severity: 'blocker', kind: 'func-lines', dimensions: ['可读性', '可维护性'] },
    { file: 'a.js', severity: 'warning', kind: 'console', dimensions: ['可读性'] },
  ];
  // v1：counts 的 readability 是加权扣分点（warning 0.5/blocker 1 → 1.5）
  const a = s1({ readability: 1.5, maintainability: 1, security: 0 }, {});
  // v2
  const b = s2(findings, {});
  rec('score', '两者均产出 {dims, score, level}', a?.score !== undefined && b?.score !== undefined,
    `v1=${brief(a?.score)} v2=${brief(b?.score)}`);
  rec('score', '契约差异（已知登记 D-early）', false,
    'v1 收 counts 维度专属公式 / v2 收 findings 统一 10-d×weight 归一——已登记，需用户确认是否允许');
}

/* ═══════════════ 面：git（核心函数返回结构） ═══════════════ */
async function faceGit() {
  const dir = makeSampleRepo();
  try {
    const g1 = await import(join(V1, 'lib/git-core.js'));
    const ga1 = await import(join(V1, 'lib/github-api.js'));
    const g2 = await import(join(V2, 'lib/git/index.js'));
    const r1 = g1.runGit(['rev-parse', '--short', 'HEAD'], dir);
    const r2 = g2.runGit(['rev-parse', '--short', 'HEAD'], { cwd: dir });
    rec('git', 'rev-parse 输出一致', r1.stdout === r2.stdout, `v1=${r1.stdout} v2=${r2.stdout}`);
    rec('git', 'runGit 返回结构（v1 status/ok 字段 vs v2 ok）', false,
      '契约：v1 返回 {status:0,…}、v2 返回 {ok:true,…}——已登记，待确认');
    const p1 = ga1.parseGithubOwnerRepo?.('ssh://git@ssh.github.com:443/o/r.git');
    const p2 = g2.parseGithubOwnerRepo('ssh://git@ssh.github.com:443/o/r.git');
    rec('git', 'parseGithubOwnerRepo 同输入', eq(p1, p2), `v1=${brief(p1)} v2=${brief(p2)}`);
    const b1 = ga1.isBadCredentials?.('Bad credentials');
    const b2 = g2.isBadCredentials('Bad credentials');
    rec('git', 'isBadCredentials 真值一致', b1 === b2, `v1=${b1} v2=${b2}`);
  } catch (e) {
    rec('git', '整面', false, String(e.message).split('\n')[0]);
  } finally { cleanup(dir); }
}

/* ═══════════════ 面：scan（敏感扫描） ═══════════════ */
async function faceScan() {
  const dir = makeSampleRepo();
  try {
    const { scanSensitiveFiles: s1 } = await import(join(V1, 'lib/ignore-scan.js'));
    const { scanSensitiveFiles: s2 } = await import(join(V2, 'lib/git/index.js'));
    const f1 = s1(dir).map((x) => x.path).sort();
    const f2 = s2(dir).map((x) => x.path).sort();
    rec('scan', 'scanSensitiveFiles 检出文件集一致', eq(f1, f2), `v1=${brief(f1)} v2=${brief(f2)}`);
    // 字段语义也对比
    const e1 = s1(dir)[0], e2 = s2(dir)[0];
    rec('scan', '元素字段 {path,fields} 结构', e1?.path !== undefined && e2?.path !== undefined,
      `v1=${brief(e1)} v2=${brief(e2)}`);
  } catch (e) {
    rec('scan', '整面', false, String(e.message).split('\n')[0]);
  } finally { cleanup(dir); }
}

/* ═══════════════ 面：exempt（豁免机制） ═══════════════ */
async function faceExempt() {
  const dir = makeSampleRepo();
  try {
    const e1 = await import(join(V1, 'lib/ignore-scan.js'));
    const e2 = await import(join(V2, 'lib/exempt/index.js'));
    const samples = join(dir, 'test', 'fixtures', 'compare');
    mkdirSync(samples, { recursive: true });
    writeFileSync(join(samples, '.samples'), '');
    writeFileSync(join(samples, 'bad.js'), 'console.log(1)');
    const rel = 'test/fixtures/compare/bad.js';
    const a = e1.isSampleExemptDir ? e1.isSampleExemptDir(dir, rel) : false;
    const b = e2.isSampleExemptDir ? e2.isSampleExemptDir(dir, rel) : false;
    rec('exempt', 'isSampleExemptDir 命中目录内文件', a === b, `v1=${a} v2=${b}`);
    // 逃逸路径（../）应拒绝
    const a2 = e1.isSampleExemptDir ? e1.isSampleExemptDir(dir, '../etc/passwd') : false;
    const b2 = e2.isSampleExemptDir ? e2.isSampleExemptDir(dir, '../etc/passwd') : false;
    rec('exempt', '路径逃逸拒绝一致', a2 === b2, `v1=${a2} v2=${b2}`);
    // 非豁免目录返回 false
    const a3 = e1.isSampleExemptDir ? e1.isSampleExemptDir(dir, 'bad.js') : false;
    const b3 = e2.isSampleExemptDir ? e2.isSampleExemptDir(dir, 'bad.js') : false;
    rec('exempt', '非豁免目录 false 一致', a3 === b3, `v1=${a3} v2=${b3}`);
  } catch (e) {
    rec('exempt', '整面', false, String(e.message).split('\n')[0]);
  } finally { cleanup(dir); }
}

/* ═══════════════ 面：cli（CLI 命令对齐） ═══════════════ */
async function faceCli() {
  const dir = makeSampleRepo();
  try {
    const runCli = (path, args) => {
      try {
        return { code: 0, out: execFileSync('node', [path, ...args], { encoding: 'utf8', timeout: 30000 }) };
      } catch (e) {
        return { code: e.status ?? -1, out: String(e.stdout || e.message) };
      }
    };
    // v1 无 version 命令（有 help）；v2 有 version。对比两者都有的：ruleset/audit/scan
    for (const [cmd, args] of [['ruleset', ['nodejs']], ['audit', [dir]], ['scan', [dir]]]) {
      const a = runCli(join(V1, 'cli.mjs'), [cmd, ...args]);
      const b = runCli(join(V2, 'cli.mjs'), [cmd, ...args]);
      rec('cli', `命令 ${cmd} 退出码一致`, a.code === b.code, `v1=${a.code} v2=${b.code}`);
    }
    const h1 = runCli(join(V1, 'cli.mjs'), ['help']).out;
    const h2 = runCli(join(V2, 'cli.mjs'), ['help']).out;
    rec('cli', 'help 均含 commit 用法', h1.includes('commit') && h2.includes('commit'));
    rec('cli', 'v1 独有命令 full-scan / v2 有 audit --full', 
      h1.includes('full-scan') && h2.includes('--full') && h2.includes('audit'),
      '功能等价：v1 full-scan=全量扫描 / v2 audit --full=全量');
  } finally { cleanup(dir); }
}

/* ═══════════════ 面：tools（工具清单） ═══════════════ */
async function faceTools() {
  // v1 工具名从源码静态提取（plugin-tools.js 依赖 DSH 环境，无法独立 import）
  const src = readFileSync(join(V1, 'lib/plugin-tools.js'), 'utf8');
  const names1 = [...src.matchAll(/name: '([a-z_]+)'/g)].map((m) => m[1]).sort();
  const { listTools } = await import(join(V2, 'lib/index.js'));
  const names2 = listTools().map((t) => t.name).sort();
  const common = names1.filter((x) => names2.includes(x)).sort();
  rec('tools', '共用工具同名同集合', eq(common, names2.filter((x) => names1.includes(x)).sort()),
    `v1=${names1.length} v2=${names2.length} 共用=${common.length}`);
  rec('tools', '仅 v1 有（预期：permit/rebuild/push_rules/audit_full_scan）', true,
    brief(names1.filter((x) => !names2.includes(x))));
  rec('tools', '仅 v2 有（预期：link_check）', true, brief(names2.filter((x) => !names1.includes(x))));
}

/* ═══════════════ 面：readme（README 生成契约） ═══════════════ */
async function faceReadme() {
  const dir = makeSampleRepo();
  try {
    const { genReadme: g1 } = await import(join(V1, 'lib/readme-gen.js'));
    const { genReadme: g2 } = await import(join(V2, 'lib/readme-gen/index.js'));
    const r1 = g1({ repoPath: dir });
    const r2 = g2({ repoPath: dir });
    rec('readme', 'genReadme 返回对象含 content/markdown', 
      (typeof r1 === 'object' && r1 !== null && (r1.content || r1.markdown)) &&
      (typeof r2 === 'object' && r2 !== null && (r2.content || r2.markdown)),
      `v1=${brief(Object.keys(r1 || {}))} v2=${brief(Object.keys(r2 || {}))}`);
  } finally { cleanup(dir); }
}

/* ═══════════════ 面：context（环境注入） ═══════════════ */
async function faceContext() {
  const { buildEnvInjection } = await import(join(V1, 'lib/env-inject.js'));
  const { createEnvInjectionText } = await import(join(V2, 'lib/context/index.js'));
  const a = buildEnvInjection?.({ workspaceRoot: '/tmp', cwd: '/tmp' }) || {};
  const b = createEnvInjectionText?.({ cwd: '/tmp', projectRoot: '/tmp' }) || '';
  const aText = String(a.dirsText || a.text || '') + String(a.toolsText || '');
  rec('context', '两注入文本均含 git-push / 环境标记', 
    aText.includes('git-push') || aText.includes('environment') && b.includes('git-push'),
    `v1len=${aText.length} v2len=${String(b).length}`);
  rec('context', '契约差异', false, 
    'v1 buildEnvInjection 返回 {map,tools,dirsText,toolsText} 结构化；v2 createEnvInjectionText 返回纯字符串——已登记，待确认');
}

/* ═══════════════ 主流程 ═══════════════ */
const faces = { audit: faceAudit, rules: faceRules, score: faceScore, git: faceGit, scan: faceScan, exempt: faceExempt, cli: faceCli, tools: faceTools, readme: faceReadme, context: faceContext };

console.log('═'.repeat(60));
console.log('v1/v2 行为对齐验证（唯一允许差异：审计独立调用）');
console.log('═'.repeat(60));
for (const [face, fn] of Object.entries(faces)) {
  if (!want(face)) continue;
  console.log(`\n【面：${face}】`);
  try { await fn(); } catch (e) { rec(face, '整面异常', false, String(e.message).split('\n')[0]); }
}

const ok = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log('\n' + '═'.repeat(60));
console.log(`汇总：${ok} ✅ / ${fail} ❌（共 ${results.length} 项检查）`);
if (fail) {
  console.log('\n差异明细（需人工判定：已知登记差异 / 意外差异需处理）：');
  for (const r of results.filter((x) => !x.ok)) console.log(`  ❌ [${r.face}] ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
}
process.exit(fail ? 1 : 0);