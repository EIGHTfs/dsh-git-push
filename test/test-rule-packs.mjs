/** 规则包装载器单测（v1.41.0 C 组）：stripJsonComments / validateRulePack / 装载三来源 / 编译分桶 / JSONC 注释豁免 */
import { auditRepo, resetAuditRuleset } from '../lib/audit.js';
import {
  stripJsonComments, validateRulePack, parseRulePackText, loadRulePackFromFile, loadBuiltinRulePack,
  resolveRulesetChoice, loadRulePack, compileRulePack,
} from '../lib/rule-packs.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

const root = mkdtempSync(join(tmpdir(), 'gitpush-rulepack-test-'));
mkdirSync(join(root, 'repo'), { recursive: true });

/* ---------- stripJsonComments ---------- */
const s1 = stripJsonComments('{\n  // 注释行\n  "a": 1, // 行尾注释\n  "url": "https://x//y",\n  "b": "//字符串里的不算"\n}');
const p1 = JSON.parse(s1);
ok(p1.a === 1 && p1.url === 'https://x//y' && p1.b === '//字符串里的不算', 'stripJsonComments 只剥真注释（字符串内 // 保留）');

/* ---------- validateRulePack ---------- */
const bad1 = validateRulePack({ name: 'x', owner: 'o', version: '1', rules: [{ id: 'a', kind: 'nope', pattern: 'x' }] });
ok(!bad1.ok && bad1.errors.some((e) => e.includes('kind 非法')), 'kind 非法被拒');
const bad2 = validateRulePack({ name: 'x', owner: 'o', version: '1', rules: [{ id: 'a', kind: 'secret', pattern: 'x' }, { id: 'a', kind: 'secret', pattern: 'y' }] });
ok(!bad2.ok && bad2.errors.some((e) => e.includes('id 重复')), 'id 重复被拒');
const bad3 = validateRulePack({ name: 'x', owner: 'o', version: '1', rules: [{ id: 'a', kind: 'secret', pattern: '(' }] });
ok(!bad3.ok && bad3.errors.some((e) => e.includes('正则非法')), '非法正则被拒');
const bad4 = validateRulePack({ name: 'x', owner: 'o', version: '1', rules: [{ id: 'a', kind: 'doc-conversation' }] });
ok(!bad4.ok && bad4.errors.some((e) => e.includes('缺少 pattern')), 'doc-conversation 缺 pattern 被拒');
const bad5 = validateRulePack({ name: 'x', owner: 'o', version: '1', rules: [{ id: 'a', kind: 'credential-file' }] });
ok(!bad5.ok && bad5.errors.some((e) => e.includes('pathPattern')), 'credential-file 缺 pathPattern 被拒');

/* ---------- 内置包装载与编译 ---------- */
const bi = loadBuiltinRulePack();
ok(bi.ok && bi.pack.name === 'eightfs' && bi.pack.owner === 'EIGHTfs', '内置 eightfs 包可装载（归属 EIGHTfs）');
const brc = compileRulePack(bi.pack, { source: 'builtin' });
ok(brc.secretPatterns.length === 3, `内置包 secret 3 条（实际 ${brc.secretPatterns.length}）`);
ok(brc.wordingPatterns.length === 9, `内置包 comment-wording 9 条（实际 ${brc.wordingPatterns.length}）`);
ok(brc.docConvPatterns.length === 5, `内置包 doc-conversation 5 条（实际 ${brc.docConvPatterns.length}）`);
ok(brc.credentialFileRes.length === 2, `内置包 credential-file 2 条（实际 ${brc.credentialFileRes.length}）`);
ok(brc.credentialRefPatterns.length === 2, `内置包 credential-ref 2 条（实际 ${brc.credentialRefPatterns.length}）`);
ok(brc.quality.funcLinesWarn === 50 && brc.quality.funcLinesBlock === 100, '内置包质量阈值 50/100');
ok(brc.errors.length === 0, '内置包编译零错误');

/* ---------- file 来源装载（JSONC 规则包） ---------- */
const customPack = join(root, 'custom.rules.json');
writeFileSync(customPack, [
  '// 自定义最小规则包（JSONC 注释 tolerated）',
  '{',
  '  "name": "minimal",',
  '  "owner": "tester",',
  '  "version": "0.1.0",',
  '  "rules": [',
  '    { "id": "sk-only", "kind": "secret", "level": "blocker", "name": "sk-key", "pattern": "\\\\bsk-[A-Za-z0-9]{8,}\\\\b" }',
  '  ]',
  '}',
].join('\n'));
const fr = loadRulePackFromFile(customPack);
ok(fr.ok && fr.pack.name === 'minimal', 'file 来源 JSONC 规则包装载成功');
const crc = compileRulePack(fr.pack, { source: 'file' });
ok(crc.secretPatterns.length === 1 && crc.wordingPatterns.length === 0, '自定义包只编译出 1 条 secret（措辞清空=整包替换语义）');

/* ---------- resolveRulesetChoice / loadRulePack ---------- */
ok(resolveRulesetChoice('').source === 'builtin' && resolveRulesetChoice('eightfs').source === 'builtin', '空/别名 → builtin');
ok(resolveRulesetChoice('https://x/a.json').source === 'url', 'http(s) → url');
ok(resolveRulesetChoice('/tmp/a.json').source === 'file' && resolveRulesetChoice('/tmp/a.json').path === '/tmp/a.json', '本地路径 → file');
const lu = await loadRulePack({ source: 'file', path: customPack });
ok(lu.ok && lu.source === 'file' && lu.pack.name === 'minimal', 'loadRulePack file 路径生效');
const lmiss = await loadRulePack({ source: 'file', path: join(root, 'missing.json') });
ok(!lmiss.ok && lmiss.error.includes('不存在'), '缺失文件报错不崩溃');

/* ---------- 非法 pattern 编译降级（不崩溃、errors 标记） ---------- */
const brk = compileRulePack({ name: 'brk', owner: 'o', version: '1', rules: [
  { id: 'bad', kind: 'secret', level: 'blocker', name: 'bad', pattern: '([unclosed' },
] });
ok(brk.secretPatterns.length === 0 && brk.errors.length === 1 && brk.errors[0].includes('正则非法'), '非法 pattern 编译降级记 errors');

/* ---------- auditRepo 换包生效（C3：整包替换语义） ---------- */
// 最小包只有 sk- 规则：ghp_ 不再检出（规则包整包替换），sk- 仍检出（真实落盘过语法检查）
writeFileSync(join(root, 'repo', 'a.js'), 'const t = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"; const k = "sk-abcdefghijklmnop";\n');
const r1 = auditRepo(join(root, 'repo'), {
  files: [{ path: 'a.js', addedLines: ['const t = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"; const k = "sk-abcdefghijklmnop";'], isBinary: false }],
  quality: { enabled: false },
  ruleset: crc,
});
ok(!r1.findings.some((f) => f.rule === 'secret' && f.message.includes('ghp')), '最小包下 ghp_ 不检出（整包替换）');
ok(r1.findings.some((f) => f.rule === 'secret' && f.message.includes('sk')), '最小包下 sk- 仍检出');
ok(r1.ruleset.name === 'minimal' && r1.ruleset.owner === 'tester' && r1.ruleset.source === 'file', 'C6：ruleset 来源/归属随包输出');
ok(!r1.findings.some((f) => f.rule === 'comment-wording'), '最小包无措辞规则 → 注释措辞不拦（规则包化生效）');

// 内置包（缺省）下 ghp_ 检出
const r2 = auditRepo(join(root, 'repo'), {
  files: [{ path: 'b.js', addedLines: ['const t = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";'], isBinary: false }],
  quality: { enabled: false },
});
ok(r2.findings.some((f) => f.rule === 'secret'), '缺省走内置 eightfs 包：ghp_ 检出');
ok(r2.ruleset.name === 'eightfs' && r2.ruleset.owner === 'EIGHTfs', 'C6：缺省包溯源 eightfs/EIGHTfs');
ok(Array.isArray(r2.ruleset.counts) === false && r2.ruleset.counts.secret === 3, 'C6：counts 摘要输出');

/* ---------- JSONC 审计豁免（C5）：json 注释行豁免隐私入库，措辞/质量不豁免 ---------- */
const pack = loadBuiltinRulePack();
const rs = compileRulePack(pack.pack, { source: 'builtin' });
const rj = auditRepo(join(root, 'repo'), {
  files: [{ path: 'rules.json', addedLines: ['// 说明: 示例 token: "ghp_AAAABBBBCCCCDDDDEEEEFFFF11"', '{"a":1}'], isBinary: false }],
  quality: { enabled: false },
  ruleset: rs,
});
ok(!rj.findings.some((f) => f.rule === 'secret'), 'C5：json // 注释行豁免 secret（隐私入库类）');
// json 语法容忍 // 注释（写真实文件走语法检查分支）
writeFileSync(join(root, 'repo', 'jsonc.json'), '{\n  // 注释\n  "a": 1\n}\n');
const rj2 = auditRepo(join(root, 'repo'), {
  files: [{ path: 'jsonc.json', addedLines: ['{', '  // 注释', '  "a": 1', '}'], isBinary: false }],
  quality: { enabled: false },
  ruleset: rs,
});
ok(!rj2.findings.some((f) => f.rule === 'json'), 'C5：JSONC 文件解析不再误报 json blocker');
// 真 JSON 坏语法仍拦
writeFileSync(join(root, 'repo', 'badj.json'), '{ bad\n');
const rj3 = auditRepo(join(root, 'repo'), {
  files: [{ path: 'badj.json', addedLines: ['{ bad'], isBinary: false }],
  quality: { enabled: false },
  ruleset: rs,
});
ok(rj3.findings.some((f) => f.rule === 'json'), '坏 JSON 仍拦截');

/* ---------- parseRulePackText 拒绝坏 JSON ---------- */
const pr = parseRulePackText('{ name: x }');
ok(!pr.ok && pr.error.includes('解析失败'), '坏 JSON 文本报解析失败');

/* ---------- resetAuditRuleset 隔离 ---------- */
resetAuditRuleset();
writeFileSync(join(root, 'repo', 'c.js'), 'const a = 1;\n');
const rs2 = auditRepo(join(root, 'repo'), { files: [{ path: 'c.js', addedLines: ['const a = 1;'], isBinary: false }], quality: { enabled: false } });
ok(rs2.passed === true, 'resetAuditRuleset 后缺省审计正常');

rmSync(root, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
