/**
 * 规则总入口测试：编译函数注册 / 字段探测指派 / 显式 kind / dimensions 绑定 /
 * 正则安全编译 / 槽位配置驱动 / 装载合并。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import '../lib/rule/compilers.js'; // 副作用导入：注册编译函数
import { registerCompiler, compileRule, compileAllRules, RULE_COMPILERS } from '../lib/rule/registry.js';
import { loadRuleFiles, RULE_SLOTS, resolveSlotOrder, discoverRuleSlots } from '../lib/rule/loader.js';
import { safeRe } from '../lib/rule/compilers.js';

test('注册表：编译函数已注册（含 credential-ref / credential-file / [FUNC]）', () => {
  const kinds = RULE_COMPILERS.map((e) => e.kind);
  for (const k of ['credential-ref', 'credential-file', '[FUNC]', 'func-lines',
    'min-length', 'max-lines', 'max-complexity', 'max-depth', 'min-occurrences', 'repeated-string',
    'regex', 'path-regex', 'semantic', 'link-check']) {
    assert.ok(kinds.includes(k), `缺 ${k}`);
  }
});

test('字段探测：id 前缀 credref- → credential-ref', () => {
  const res = compileRule({ id: 'credref-plain-text', name: '明文凭据', pattern: 'x' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'credential-ref');
});

test('字段探测：id 前缀 credfile- → credential-file', () => {
  const res = compileRule({ id: 'credfile-key-file', name: '私钥路径', pattern: 'x' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'credential-file');
});

test('字段探测：id 前缀 [FUNC]- → [FUNC]', () => {
  const res = compileRule({ id: '[FUNC]-aws', name: 'AWS', pattern: 'AKIA' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, '[FUNC]');
});

test('字段探测：path_pattern → path-regex（非 credfile 前缀）', () => {
  const res = compileRule({ id: 'path/x', name: '路径规则', path_pattern: '.*\\.key$' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'path-regex');
});

test('字段探测：max_complexity → max-complexity', () => {
  const res = compileRule({ id: 'c1', name: '复杂度', max_complexity: 10 });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'max-complexity');
  assert.equal(res.rule.threshold, 10);
});

test('数值拆分：min_occurrences + ignore_values → repeated-string', () => {
  const res = compileRule({ id: 'r1', name: '重复串', min_occurrences: 3, ignore_values: ['', ' '] });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'repeated-string');
  assert.deepEqual(res.rule.ignoreValues, ['', ' ']);
});

test('数值拆分：min_occurrences 无 ignore → min-occurrences', () => {
  const res = compileRule({ id: 'm1', name: '重复数', min_occurrences: 5 });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'min-occurrences');
});

test('显式 kind 优先：kind: path-regex + pattern 字段 → path-regex', () => {
  const res = compileRule({ id: 'p1', kind: 'path-regex', name: '路径', pattern: 'x', path_pattern: 'y' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'path-regex');
});

test('dimensions 绑定：func-lines → 可读性+可维护性（多维度）', () => {
  const res = compileRule({ id: 'func-lines', name: '函数超长', max_lines: 50 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.rule.dimensions, ['可读性', '可维护性']);
});

test('dimensions 绑定：[FUNC] → 安全性', () => {
  const res = compileRule({ id: '[FUNC]-x', name: 'x', pattern: 'y' });
  assert.deepEqual(res.rule.dimensions, ['安全性']);
});

test('未知规则：既无 kind 也无字段 → 报错不静默', () => {
  const res = compileRule({ id: 'unknown', name: '无字段规则' });
  assert.equal(res.ok, false);
  assert.match(res.error, /无法识别/);
});

test('未知显式 kind → 报错', () => {
  const res = compileRule({ id: 'z', kind: 'not-a-kind', name: 'z' });
  assert.equal(res.ok, false);
  assert.match(res.error, /未知规则类型/);
});

// ---------- 装载与编译（nodejs 槽位） ----------
test('装载：nodejs 槽位 yml 已落地，编译全部成功', () => {
  const r = loadRuleFiles(['nodejs']);
  assert.ok(RULE_SLOTS.includes('nodejs'));
  assert.equal(r.ok, true, `errors: ${r.errors.join('; ')}`);
  assert.equal(r.files.length, 1, 'nodejs 文件应成功加载');
});

test('装载：nodejs 槽位全量编译（1.0.3 复制旧项目 34 条 + v2 独有能力）', () => {
  const r = loadRuleFiles(['nodejs']);
  const ctx = { errors: [] };
  const compiled = compileAllRules(r.merged.rules, ctx);
  assert.ok(compiled.length >= 34, `编译 ${compiled.length} 条（应 ≥ 旧项目 34 条）`);
  assert.equal(ctx.errors.length, 0, `errors: ${ctx.errors.join('; ')}`);
  for (const c of compiled) {
    assert.ok(Array.isArray(c.dimensions) && c.dimensions.length > 0, `${c.id} 缺 dimensions`);
    assert.ok(typeof c.kind === 'string' && c.kind, `${c.id} 缺 kind`);
  }
});

test('编译统计：关键 kind 齐全 + 全部带维度（1.0.3 规则包扩展后）', () => {
  const r = loadRuleFiles(['nodejs']);
  const compiled = compileAllRules(r.merged.rules, { errors: [] });
  const byKind = {};
  for (const c of compiled) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  // 关键 kind 必须存在（1.0.3 契约：旧项目规则全接线 + v2 独有能力保留）
  assert.ok(byKind['[FUNC]'] >= 1, '[FUNC] 应有 secret-* 规则');
  assert.ok(byKind['credential-file'] >= 1, 'credential-file 应有');
  assert.ok(byKind['func-lines'] >= 1, 'func-lines 应有（中文「函数」识别）');
  assert.ok(byKind['regex'] >= 1, 'regex 宽类应有');
  assert.ok(byKind['semantic'] >= 1, 'semantic 应有');
  // 全部带维度
  for (const c of compiled) assert.ok(Array.isArray(c.dimensions) && c.dimensions.length > 0, `${c.id} 缺 dimensions`);
});

// ---------- 正则安全编译（1.0.x 修复：大小写不敏感防漏检） ----------
test('safeRe：默认大小写不敏感（驼峰/大写凭据写法不漏检）', () => {
  const errs = [];
  const re = safeRe('\\bapi[_-]?key\\s*=\\s*[\'"][^\'"]{12,}[\'"]', 'generic-token', errs);
  // 规则测试样本（非真实凭据）：字符串拼接构造，避免明文凭据入库
  const sample = 'sk-' + '1234567890abcdefghijklmn';
  const hitCamel = 'const api' + 'Key = ' + JSON.stringify(sample);
  const hitUpper = 'const API' + '_KEY = ' + JSON.stringify(sample);
  const hitSnake = 'const api' + '_key = ' + JSON.stringify(sample);
  assert.ok(re.test(hitCamel), 'apiKey 驼峰应命中');
  assert.ok(re.test(hitUpper), 'API_KEY 大写应命中');
  assert.ok(re.test(hitSnake), 'api_key 下划线应命中');
});

test('safeRe：(?-i) 可显式要求大小写敏感', () => {
  const errs = [];
  const re = safeRe('(?-i)TOKEN', 'x', errs);
  assert.ok(re.test('TOKEN'));
  assert.ok(!re.test('token'));
});

test('safeRe：(?i) 前缀合法（同义写法不报错）', () => {
  const errs = [];
  const re = safeRe('(?i)abc', 'x', errs);
  assert.equal(errs.length, 0);
  assert.ok(re.test('ABC'));
});

test('safeRe：非法正则不抛异常，收集错误返回 null', () => {
  const errs = [];
  const re = safeRe('([unclosed', 'bad', errs);
  assert.equal(re, null);
  assert.equal(errs.length, 1);
});

// ---------- 槽位配置驱动（槽位不写死，可配置顺序） ----------
test('槽位：resolveSlotOrder 默认取 RULE_SLOTS ∩ 目录实际文件', () => {
  const slots = resolveSlotOrder();
  assert.ok(slots.includes('nodejs'));
  for (const s of slots) assert.ok(discoverRuleSlots().includes(s), `${s} 应实际存在`);
});

test('槽位：显式配置数组生效（配置驱动，不写死）', () => {
  const slots = resolveSlotOrder(['docs']);
  assert.ok(slots.includes('docs'), '显式指定 docs 应在列');
  assert.ok(slots.includes('nodejs'), 'nodejs 默认应在列');
  assert.ok(slots.indexOf('docs') < slots.indexOf('nodejs'), '显式槽位排前');
});

test('槽位：逗号分隔字符串配置生效', () => {
  const slots = resolveSlotOrder('docs,nodejs');
  assert.equal(slots[0], 'docs');
  assert.equal(slots[1], 'nodejs');
});

test('槽位：未落文件的槽位静默跳过（不报缺失）', () => {
  const slots = resolveSlotOrder(['nonexistent-slot', 'nodejs']);
  assert.ok(!slots.includes('nonexistent-slot'), '不存在的槽位应跳过');
  assert.ok(slots.includes('nodejs'));
});

test('槽位：目录新增槽位自动追加（新 yml 放进去即生效）', () => {
  const slots = resolveSlotOrder(['nodejs']);
  for (const s of discoverRuleSlots()) {
    if (s !== 'template') assert.ok(slots.includes(s), `${s} 应自动追加`);
  }
});

test('槽位：template 默认不加载（模板保持为空）', () => {
  assert.ok(!resolveSlotOrder().includes('template'));
});

test('槽位：环境变量 DSH_GIT_PUSH_RULE_SLOTS 可配置（脱离 DSH 时用）', () => {
  process.env.DSH_GIT_PUSH_RULE_SLOTS = 'docs';
  try {
    const slots = resolveSlotOrder();
    assert.equal(slots[0], 'docs');
  } finally { delete process.env.DSH_GIT_PUSH_RULE_SLOTS; }
});

test('装载：loadRuleFiles 无参走配置驱动（向后兼容数组入参）', () => {
  const r = loadRuleFiles();
  assert.equal(r.ok, true);
  assert.ok(r.merged.rules.length > 0);
  assert.ok(r.order.length > 0, '应返回生效槽位顺序');
  assert.equal(r.errors.length, 0, '已建槽位不应报缺失');
});

// ---------- 注册表行为 / 装载健壮性 / 槽位发现（原 test-framework）----------
test('注册表：registerCompiler 后 compileRule 按 detect 指派', () => {
  registerCompiler('test-kind-a', (r) => r.path_pattern, (r) => ({ ok: true, rule: { kind: 'path-regex', dimensions: ['文档'] } }));
  const res = compileRule({ path_pattern: '*.md' });
  assert.equal(res.ok, true);
  assert.equal(res.rule.kind, 'path-regex');
});

test('注册表：显式 kind 优先于字段探测', () => {
  const res = compileRule({ kind: '不存在的kind' });
  assert.equal(res.ok, false);
  assert.match(res.error, /未知规则类型/);
});

test('注册表：compileRule 对字段可自动探测', () => {
  // 无 kind、无已知字段 → 报错而非静默跳过
  const res = compileRule({ id: 'x', name: '未知' });
  assert.equal(res.ok, false);
  assert.match(res.error, /无法识别规则类型/);
});

test('注册表：compileAllRules 收集错误不中断', () => {
  const ctx = { errors: [] };
  const out = compileAllRules([{ id: 'bad', name: '未知规则' }], ctx);
  assert.equal(out.length, 0);
  assert.equal(ctx.errors.length, 1);
});

test('装载：槽位全动态——由目录文件决定，放文件即生效', () => {
  const discovered = discoverRuleSlots();
  // 已建槽位必在发现列表里
  assert.ok(discovered.includes('nodejs'));
  assert.ok(discovered.includes('docs'));
  // 默认装载不报缺失：只装目录里真实存在的槽位
  const r = loadRuleFiles();
  assert.equal(r.errors.length, 0, `不应报缺失：${r.errors.join('; ')}`);
  for (const slot of r.order) assert.ok(discovered.includes(slot), `${slot} 应实际存在`);
  // template 默认不加载（模板保持为空，不进默认装载）
  assert.ok(!r.order.includes('template'));
});

test('装载：loadRuleFiles 对缺失槽位不崩溃，返回错误收集', () => {
  // audit-rules 目录尚未落任何 yml → 全部槽位报缺失，但函数正常返回
  const r = loadRuleFiles(['nodejs']);
  assert.equal(typeof r.ok, 'boolean');
  assert.ok(Array.isArray(r.errors));
});

test('发现槽位：空目录不崩溃', () => {
  const slots = discoverRuleSlots('/tmp/nonexistent-dir-for-test');
  assert.ok(Array.isArray(slots));
  assert.equal(slots.length, 0);
});

// ---------- 1.0.3 新 kind：blacklist / folder / npm-json / i18n（同名函数 + 注册一行） ----------
test('1.0.3：blacklist kind 编译（comment 槽位黑名单加分制）', () => {
  const r = loadRuleFiles(['comment']);
  const compiled = compileAllRules(r.merged.rules, { errors: [] });
  const bl = compiled.filter((c) => c.kind === 'blacklist');
  assert.ok(bl.length >= 1, 'comment 槽位应有 blacklist 规则');
  const rule = bl[0];
  assert.ok(Array.isArray(rule.blacklist) && rule.blacklist.length > 0, 'blacklist 数组应编译');
  assert.ok(rule.blacklist.some((b) => b.weight > 0), 'blacklist 条目应带 weight');
  assert.ok(Array.isArray(rule.whitelist) && rule.whitelist.length > 0, 'whitelist 应编译');
});

test('1.0.3：folder kind 编译（目录级审计 4 条）', () => {
  const r = loadRuleFiles(['folder']);
  const compiled = compileAllRules(r.merged.rules, { errors: [] });
  const folder = compiled.filter((c) => c.kind === 'folder');
  assert.ok(folder.length >= 4, `folder 槽位应 ≥4 条（得 ${folder.length}）`);
  assert.ok(folder.some((c) => c.id === 'folder/total-count' && c.threshold === 30), 'total-count 带 threshold=30');
  assert.ok(folder.some((c) => Array.isArray(c.signatures) && c.signatures.length > 0), '解包特征带 signatures');
  assert.ok(folder.some((c) => Array.isArray(c.requiredPatterns) && c.requiredPatterns.length > 0), 'gitignore 覆盖带 requiredPatterns');
});

test('1.0.3：npm-json kind 编译（结构化判定取代弱 pattern）', () => {
  const r = loadRuleFiles(['npm']);
  const compiled = compileAllRules(r.merged.rules, { errors: [] });
  const npmj = compiled.filter((c) => c.kind === 'npm-json');
  assert.ok(npmj.length >= 2, `npm-json 应 ≥2 条（得 ${npmj.length}）`);
  const ids = npmj.map((c) => c.id);
  assert.ok(ids.includes('npm/files-missing-lib'), 'files-missing-lib 应走 npm-json');
  assert.ok(ids.includes('npm/undeclared-js-yaml'), 'undeclared-js-yaml 应走 npm-json');
});

test('1.0.3：i18n 槽位编译（国际化审计 3 条）', () => {
  const r = loadRuleFiles(['i18n']);
  const compiled = compileAllRules(r.merged.rules, { errors: [] });
  assert.ok(compiled.length >= 3, `i18n 槽位应 ≥3 条（得 ${compiled.length}）`);
  assert.ok(compiled.some((c) => c.id === 'i18n/hardcoded-user-visible'), '硬编码文案规则');
  assert.ok(compiled.some((c) => c.id === 'i18n/concat-in-t'), 't() 拼接规则');
  assert.ok(compiled.some((c) => c.id === 'i18n/locale-file-missing' && c.detectionMethod === 'locale-file-exists'), '语言包缺失规则（仓库级）');
});

test('1.0.3：全槽位编译 96+ 条 0 失败（9 旧 + robustness/folder/i18n + docs）', () => {
  const r = loadRuleFiles();
  const ctx = { errors: [] };
  const compiled = compileAllRules(r.merged.rules, ctx);
  assert.equal(ctx.errors.length, 0, `errors: ${ctx.errors.join('; ')}`);
  assert.ok(compiled.length >= 96, `总规则应 ≥96 条（得 ${compiled.length}）`);
  const kinds = new Set(compiled.map((c) => c.kind));
  for (const k of ['blacklist', 'folder', 'npm-json', 'regex', 'semantic', '[FUNC]', 'func-lines', 'link-check']) {
    assert.ok(kinds.has(k), `kind ${k} 应存在`);
  }
});
