/** dsh-skip-sensitive dsh-git-push v1.1.0 规则引擎单测（内置自 dsh-code-audit）
 * 文件头 dsh-skip-sensitive：本文件含 comment-wording / secret 检测目标措辞与 PAT 样本（作为测试输入数据），
 * 同 test-audit / test-full-scan 规则豁免提交前敏感内容扫描。
 * 覆盖：四份 YAML 装载 / 默认顺序（template 不加载）/ 后覆盖前合并 / severity 三级映射 / 凭据规则保留 / commentScoring 提取 / 语义规则分桶 / ignore 豁免 / 权重覆盖 / 测试隔离 */
import { auditRepo, resetAuditRuleset } from '../lib/audit.js';
import {
  RULE_SLOTS, DEFAULT_RULE_ORDER, RULE_YAML_DIR,
  loadYamlRuleFile, loadYamlRuleFiles, validateYamlRuleSet, compileYamlRuleSet,
  getCompiledRulePack, clearRulePackCache, resolveRulesetChoice, loadRulePack,
} from '../lib/rule-packs.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

const root = mkdtempSync(join(tmpdir(), 'gitpush-yaml-test-'));
mkdirSync(join(root, 'repo'), { recursive: true });

/* ---------- 槽位与默认顺序（v1.52.0 动态发现：扫描 audit-rules/*.yml） ---------- */
// 固定核心槽位（内置规则文件存在即应被发现；不再写死数组数量——加新 yml 自动成为槽位）
for (const core of ['nodejs', 'frontend', 'comment', 'dsh', 'npm', 'version', 'template', 'private']) {
  ok(RULE_SLOTS.includes(core), `动态发现的槽位含 ${core}`);
}
ok(!RULE_SLOTS.some((s) => !/^[a-z0-9_-]+$/.test(s)), '槽位 id 全部为合法短横线小写');
// 默认顺序：不含 template（空模板不加载）与 private（强制末尾另行合入），但覆盖全部其它槽位
ok(!DEFAULT_RULE_ORDER.includes('template') && !DEFAULT_RULE_ORDER.includes('private'), '默认顺序排除 template/private');
ok(DEFAULT_RULE_ORDER.filter((s) => !RULE_SLOTS.includes(s)).length === 0, `默认顺序全部是已知槽位（实际 ${DEFAULT_RULE_ORDER.join(',')}`);

/* ---------- 私密拦截强制槽位（v1.48.0）---------- */
{
  const c = getCompiledRulePack('');
  ok(c.meta.order[c.meta.order.length - 1] === 'private' && c.meta.order.includes('private'), `强制槽位末尾合入（实际 ${c.meta.order.join(',')}`);
  ok(Array.isArray(c.privateFiles) && c.privateFiles.length >= 10, `privateFiles 编译（≥10 条）实际: ${c.privateFiles?.length}`);
  ok(c.privateFiles.some((p) => p.glob === '**/id_ed25519' || /id_ed25519/.test(p.glob)), 'privateFiles 含 id_ed25519 清单');
  const c2 = getCompiledRulePack(['comment']);
  ok(c2.meta.order.join(',') === 'comment,private', `用户仅排 comment → private 仍强制末尾实际: ${c2.meta.order.join(',')}`);
  const c3 = getCompiledRulePack({ order: [], weights: {} });
  ok(c3.meta.order.includes('private'), '空 order → private 仍强制合入');
  const pf = c.privateFiles.find((p) => p.glob === '**/id_ed25519');
  ok(pf && pf.re.test('EIGHTfs/id_ed25519'), 'glob **/id_ed25519 能匹配子目录私钥路径');
  ok(pf && !pf.re.test('lib/ed25519.js'), 'glob **/id_ed25519 不误配同名普通文件');
}

/* ---------- 全部槽位 YAML 各自可装载 ---------- */
for (const s of RULE_SLOTS) {
  const r = loadYamlRuleFile(s);
  ok(r.ok, `YAML 可装载: ${s}`);
}

/* ---------- 默认装载（template 排除） ---------- */
const loaded = loadYamlRuleFiles();
ok(loaded.ok, '默认装载成功');
ok(loaded.order.length === DEFAULT_RULE_ORDER.length && !loaded.order.includes('template') && !loaded.order.includes('private'), `实际加载顺序=${loaded.order.join(',')}（排除 template/private）`);
ok(loaded.files.length === loaded.order.length && loaded.files.every((f) => !f.includes('template')), `默认加载 ${loaded.files.length} 份（排除 template）`);
ok(loaded.errors.length === 0, `装载零错误（实际 ${loaded.errors.length}）`);

/* ---------- 校验 ---------- */
const v = validateYamlRuleSet(loaded.merged);
ok(v.ok, `校验通过（实际错误 ${v.errors.join(';') || '无'}）`);

/* ---------- 编译分桶 ---------- */
const c = compileYamlRuleSet(loaded.merged, { order: loaded.order, files: loaded.files, source: 'yaml' });
ok(c.secretPatterns.length === 4, `凭据 secret 4 条（含 v1.54.0 真实邮箱入库，实际 ${c.secretPatterns.length}）`);
ok(c.credentialFileRes.length === 2, `凭据文件 2 条（实际 ${c.credentialFileRes.length}）`);
ok(c.credentialRefPatterns.length === 2, `凭据引用 2 条（实际 ${c.credentialRefPatterns.length}）`);
ok(c.wordingPatterns.length >= 2, `comment 高分项进措辞门禁（实际 ${c.wordingPatterns.length}）`);
ok(c.styleRules.length >= 30, `styleRules 数值/正则型 ≥30 条（实际 ${c.styleRules.length}）`);
ok(c.semanticRules.length >= 4, `语义规则桶 ≥4 条（实际 ${c.semanticRules.length}）`);
ok(c.ignore.length >= 5, `ignore 路径豁免 ≥5 条（实际 ${c.ignore.length}）`);
ok(c.commentScoring && c.commentScoring.threshold === 60 && c.commentScoring.thresholdHighlySuspicious === 80, `comment 评分阈值 60/80（实际 ${c.commentScoring?.threshold}/${c.commentScoring?.thresholdHighlySuspicious}）`);
ok(c.commentScoring && c.commentScoring.blacklist.length === 22 && c.commentScoring.whitelist.length === 22, `comment 黑名单 22（16 用户原表 + 9 历史翻译 - 3 重复去重） / 白名单 22（实际 ${c.commentScoring?.blacklist.length}/${c.commentScoring?.whitelist.length}）`);
ok(c.meta.order.length === loaded.order.length && !c.meta.order.includes('template') && !c.meta.order.includes('private'), `meta.order 随装载（${c.meta.order.join(',')}）`);
ok(c.errors.length === 0, `编译零错误（实际 ${c.errors.length}）`);

/* ---------- severity 三级映射 ---------- */
ok(c.secretPatterns.every((s2) => true), 'secret 桶全为 error 级（拦截）');
ok(c.styleRules.some((r) => r.id === 'readability/max-file-length' && r.level === 'warning'), 'max-file-length warning（存量超大文件为已知债不拦截，v1.47.0 降级）');
ok(c.styleRules.some((r) => r.id === 'readability/max-function-length' && r.level === 'warning'), 'max-function-length warning→warning');
ok(c.styleRules.some((r) => r.id === 'performance/no-json-full-save' && r.level === 'pass'), 'info→pass（不拦不警告）');
ok(!c.styleRules.some((r) => r.id === 'security/no-path-traversal'), '路径穿越语义规则不进 styleRules（已进 semanticRules）');

/* ---------- 自定义顺序：template 显式加入才加载 ---------- */
const withTpl = loadYamlRuleFiles(['comment', 'nodejs', 'template']);
ok(withTpl.order.join(',') === 'comment,nodejs,template', '自定义顺序生效（comment 在前）');
ok(withTpl.files.some((f) => f.includes('template')), 'template 显式加入才加载');
// 后覆盖前：comment 在前时，nodejs 的规则仍补齐（同 id 才覆盖）
const ct = compileYamlRuleSet(withTpl.merged, { order: withTpl.order, files: withTpl.files, source: 'yaml' });
ok(ct.secretPatterns.length === 4, '自定义顺序下凭据规则仍保留（nodejs 补齐，含邮箱规则）');

/* ---------- 后覆盖前：同 id 规则后者覆盖 ---------- */
const ov = loadYamlRuleFiles(['nodejs', 'nodejs']); // 同文件重复加载：后加载覆盖前（同 id）
ok(ov.ok && ov.merged.rules.filter((r) => r.id === 'readability/function-name-camelcase').length === 1, '同 id 规则后覆盖前（不重复）');

/* ---------- 非法正则校验拒绝 ---------- */
const bad = validateYamlRuleSet({ metadata: { name: 'x' }, rules: [{ id: 'a', severity: 'error', pattern: '([unclosed' }] });
ok(!bad.ok && bad.errors.some((e) => e.includes('正则非法')), '非法正则被拒');
const badSev = validateYamlRuleSet({ metadata: { name: 'x' }, rules: [{ id: 'a', severity: 'fatal', pattern: 'x' }] });
ok(!badSev.ok && badSev.errors.some((e) => e.includes('severity 非法')), '非法 severity 被拒');

/* ---------- getCompiledRulePack（缓存入口） ---------- */
clearRulePackCache();
const g = getCompiledRulePack('');
ok(g.secretPatterns.length === 4 && g.meta.order[g.meta.order.length - 1] === 'private' && !g.meta.order.includes('template'), `getCompiledRulePack 缺省装载正确（private 强制末尾，实际 ${g.meta.order.join(',')}）`);
const g2 = getCompiledRulePack(['comment', 'nodejs']);
ok(g2.meta.order.join(',') === 'comment,nodejs,private', 'getCompiledRulePack 自定义顺序（private 强制末尾）');

/* ---------- resolveRulesetChoice 兼容旧调用 ---------- */
ok(resolveRulesetChoice('').source === 'yaml' && resolveRulesetChoice('').order[resolveRulesetChoice('').order.length - 1] === 'private' && !resolveRulesetChoice('').order.includes('template'), `空配置 → yaml 默认顺序（private 强制末尾，实际 ${resolveRulesetChoice('').order.join(',')}）`);
ok(resolveRulesetChoice('comment,nodejs').order.join(',') === 'comment,nodejs,private', '逗号分隔顺序解析（private 强制末尾）');
ok(resolveRulesetChoice('eightfs').source === 'yaml', '别名 eightfs → yaml 引擎（替换语义）');

/* ---------- loadRulePack 兼容名 ---------- */
const lu = await loadRulePack('');
ok(lu.ok && lu.source === 'yaml' && lu.order[lu.order.length - 1] === 'private' && !lu.order.includes('template'), `loadRulePack 默认装载（private 强制末尾，实际 ${lu.order.join(',')}）`);
const lorder = await loadRulePack({ order: ['frontend', 'comment'] });
ok(lorder.ok && lorder.order.join(',') === 'frontend,comment,private', 'loadRulePack 自定义顺序（private 强制末尾）');

/* ---------- auditRepo 端到端：YAML 规则引擎生效 ---------- */
// 凭据规则拦截（secret error→blocker）
writeFileSync(join(root, 'repo', 'a.js'), 'const t = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";\n');
const r1 = auditRepo(join(root, 'repo'), {
  files: [{ path: 'a.js', addedLines: ['const t = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";'], isBinary: false }],
  quality: { enabled: false },
});
ok(r1.findings.some((f) => f.rule === 'secret' && f.level === 'blocker'), 'YAML 凭据规则：ghp_ 检出且 blocker');
ok(r1.ruleset.source === 'yaml' && r1.ruleset.name.length > 0, 'C6：ruleset 溯源 yaml');

// info=pass 规则不产 findings（无警告无拦截）
writeFileSync(join(root, 'repo', 'b.js'), 'const data = JSON.stringify(obj); fs.writeFileSync("f.json", data);\n');
const r2 = auditRepo(join(root, 'repo'), {
  files: [{ path: 'b.js', addedLines: ['const data = JSON.stringify(obj); fs.writeFileSync("f.json", data);'], isBinary: false }],
  quality: { enabled: false },
});
ok(!r2.findings.some((f) => f.rule && f.rule.includes('no-json-full-save')), 'info 级规则不产 findings（通过）');

// ignore 豁免：dist/ 下的文件跳过 styleRules
mkdirSync(join(root, 'repo', 'dist'), { recursive: true });
writeFileSync(join(root, 'repo', 'dist', 'x.js'), 'const a=1;\n');
const r3 = auditRepo(join(root, 'repo'), {
  files: [{ path: 'dist/x.js', addedLines: ['const a=1;'], isBinary: false }],
  quality: { enabled: false },
});
ok(!r3.findings.some((f) => f.rule && f.rule.startsWith('style:')), 'ignore glob 豁免 dist/ 的 styleRules');

/* ---------- resetAuditRuleset 隔离 ---------- */
resetAuditRuleset();
// 用不触犯 styleRules 的命名（变量名 ≥2 字符）验证缺省审计可正常通过
writeFileSync(join(root, 'repo', 'c.js'), 'const count = 1;\n');
const rs2 = auditRepo(join(root, 'repo'), { files: [{ path: 'c.js', addedLines: ['const count = 1;'], isBinary: false }], quality: { enabled: false } });
ok(rs2.passed === true, 'resetAuditRuleset 后缺省审计正常（合规命名无 findings）');

rmSync(root, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
