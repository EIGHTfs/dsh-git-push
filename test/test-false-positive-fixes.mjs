// dsh-skip-sensitive: 测试 fixture 不含真实凭据
/**
 * 1.1.1 误报修复回归测试：
 *   ① npm/undeclared-js-yaml：全仓无 js-yaml import 不报（零依赖插件）
 *   ② timeout-on-external-api：fetch + AbortSignal.timeout 同调用不报
 *   ③ client-module-loader-id：已按 __ModuleLoader__.load({id,factory}) 契约注册不报
 *   ④ concat-in-t：split('{'+k+'}' 的 t( 不误匹配（词边界）
 *   ⑤ mkdir-before-write：写文件前同函数 ensureDataDir 不报
 *   ⑥ patch-insert-unique-id：纯 insert 无同 id 覆盖行不报；README 示例不再命中
 *   ⑦ semantic 只对代码文件报（.gitignore/README 不报）
 *   ⑧ version/embedded-major-zero：安装路径里的 dsh-v0.x.y 不报
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import '../lib/rule/compilers.js';
import { auditFull } from '../lib/audit/index.js';
import { checkPatchInsert, filterRulesByExt, checkSemantic, runChecks, groupByKind } from '../lib/audit/checks.js';
import { loadRuleFiles, isForceLoadRule, FORCE_LOAD_FALLBACK, setSlotDisabled } from '../lib/rule/loader.js';
import { compileAllRules } from '../lib/rule/registry.js';
import { isVersionInPathContext, hasExternalCallTimeout, hasMkdirInSameFunction, detectRepoJsYamlImport } from '../lib/audit/index.js';

let fixture = '';
let depProj = ''; // 独立 fixture（js-yaml import 对照），避免污染主 fixture 的全仓证据

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'v2-fp-fix-'));
  depProj = mkdtempSync(join(tmpdir(), 'v2-fp-dep-'));
  // 零依赖插件骨架（无 js-yaml import；saveData 先 ensureDataDir）
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({
    name: 'fp-fixture', version: '1.0.0', license: 'MIT',
    main: 'lib/index.js', files: ['lib'],
  }, null, 2) + '\n');
  mkdirSync(join(fixture, 'lib'));
  writeFileSync(join(fixture, 'lib', 'index.js'), `// 零依赖实现
import { dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
export async function ensureDataDir(file) { await mkdir(dirname(file), { recursive: true }); }
export async function saveData(file, data) {
  await ensureDataDir(file);
  await writeFile(file, JSON.stringify(data), 'utf8');
}
`);
  // client 半部：load 契约 + 带超时的 fetch + split 拼接（三误报源同文件）
  writeFileSync(join(fixture, 'lib', 'client.js'), `// client 半部
window.__ModuleLoader__.load({ id: 'fp-fixture', factory: (require) => ({ apply() {} }) });
export function tr(s, vars) { return s.split('{' + 'k' + '}').join('v'); }
export async function loadData() {
  return fetch('/api', { signal: AbortSignal.timeout(30000) })
    .then((r) => r.json());
}
export async function postData() {
  return fetch('/api/post', { signal: AbortSignal.timeout(30000) })
    .then((r) => r.json());
}
`);
  // cordis.patch.yml：纯 insert（无同 id 顶层覆盖行）——不应报
  writeFileSync(join(fixture, 'cordis.patch.yml'), `# 标准 insert 写法
- insert:
    - id: skill-scoreboard
      name: dsh-skill-scoreboard
      config:
        enabled: true
`);
  // 冲突版 patch：insert 与顶层覆盖行同 id —— 应报
  writeFileSync(join(fixture, 'conflict.patch.yml'), `- insert:
    - id: dup-id
      name: a
- id: dup-id
  name: b
`);
  // README 含数据示例路径（dsh-v0.x.y 安装目录）与 insert 代码块示例
  writeFileSync(join(fixture, 'README.md'), `# fixture
数据路径示例：/vol2/runtime/dsh-v0.1.2-alpha.4/.dsh-home/data
\`\`\`yaml
- insert:
    - id: skill-scoreboard
\`\`\`
`);
  // 非代码文件（semantic 不应报）
  writeFileSync(join(fixture, '.gitignore'), '*.log\n');
  // 真 import js-yaml 但未声明依赖的项目（独立目录，全仓证据互不污染）
  mkdirSync(join(depProj, 'lib'), { recursive: true });
  writeFileSync(join(depProj, 'package.json'), JSON.stringify({ name: 'with-dep', version: '1.0.0' }, null, 2) + '\n');
  writeFileSync(join(depProj, 'lib', 'a.js'), "import yaml from 'js-yaml';\nexport const p = yaml.load('a: 1');\n");
});

after(() => {
  try { rmSync(fixture, { recursive: true, force: true }); } catch { /* noop */ }
  try { rmSync(depProj, { recursive: true, force: true }); } catch { /* noop */ }
});

const byRule = (findings, ruleId) => findings.filter((f) => f.rule === ruleId);

test('① npm/undeclared-js-yaml：全仓零 js-yaml import 不报（零依赖插件）', async () => {
  const res = await auditFull(fixture, { depth: 5 });
  assert.equal(byRule(res.findings, 'npm/undeclared-js-yaml').length, 0,
    '零依赖项目不应报 js-yaml 未声明（无 import 即无运行时风险）');
  // 对照：真 import 的项目仍应报（规则没有变哑）
  const dep = await auditFull(depProj, { depth: 5 });
  assert.ok(byRule(dep.findings, 'npm/undeclared-js-yaml').length > 0,
    'import js-yaml 但未声明依赖仍应报');
});

test('② timeout-on-external-api：fetch + AbortSignal.timeout 同调用不报', async () => {
  const res = await auditFull(fixture, { depth: 5 });
  assert.equal(byRule(res.findings, 'robustness/timeout-on-external-api').length, 0,
    '带 AbortSignal.timeout 的 fetch 不应报无超时');
  // 对照：真无超时的 fetch 仍应报
  assert.ok(hasExternalCallTimeout("fetch('/a')", ["fetch('/a')"], 0) === false, '无超时行不豁免');
  assert.ok(hasExternalCallTimeout("fetch('/a', { signal: AbortSignal.timeout(1) })", [], 0) === true, '内联超时豁免');
});

test('③ client-module-loader-id：已按 load({id,factory}) 契约注册不报', async () => {
  const res = await auditFull(fixture, { depth: 5 });
  assert.equal(byRule(res.findings, 'dsh/client-module-loader-id').length, 0,
    '已用统一 ModuleLoader 契约的 client 半部不应报');
});

test('④ concat-in-t：split(\'{\'+\'k\' 的 t( 不误匹配（词边界）', async () => {
  const res = await auditFull(fixture, { depth: 5 });
  assert.equal(byRule(res.findings, 'i18n/concat-in-t').length, 0,
    'split() 内含拼接不是 t() 调用，不应报 concat-in-t');
  // 对照：真 t('a' + b 拼接仍应命中
  const r = checkRegexRulesSafe();
  assert.ok(r, 't() 拼接 pattern 仍可编译');
});

import { checkRegexRules } from '../lib/audit/checks.js';
function checkRegexRulesSafe() {
  // 2026-09-13（yml 为准）：参数显式列出不再强制加载 → 临时删 i18n 的 disabled 行（启用），测完写回（还原禁用）
  const orig = loadRuleFiles([]);
  setSlotDisabled('i18n', false); // 启用
  let loaded;
  try { loaded = loadRuleFiles(); } finally { setSlotDisabled('i18n', true); } // 还原禁用
  void orig;
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  const g = groupByKind(compiled);
  const findings = checkRegexRules({ file: 'x.js', text: "const s = t('a' + b);\n", rules: g['regex'] });
  return findings.some((f) => f.rule === 'i18n/concat-in-t');
}

test('⑤ mkdir-before-write：写文件前同函数 ensureDataDir 不报', async () => {
  const res = await auditFull(fixture, { depth: 5 });
  assert.equal(byRule(res.findings, 'robustness/mkdir-before-write').length, 0,
    'saveData 模式（先 ensureDataDir 再 writeFile）不应报');
  assert.ok(hasMkdirInSameFunction(['function f() {', '  mkdirSync("/a", {recursive:true})', '  writeFileSync("/a/b")', '}'], 2) === true, '同函数 mkdir 豁免');
  assert.ok(hasMkdirInSameFunction(['function f() {', '  writeFileSync("/a/b")', '}'], 1) === false, '无 mkdir 不豁免');
});

test('⑥ patch-insert-unique-id：纯 insert 不报；insert+覆盖同 id 才报；README 示例不查', async () => {
  const res = await auditFull(fixture, { depth: 5 });
  // README 的 insert 代码块示例（md 非 yml）不命中——exts 只查 yml/yaml
  const readmeHits = res.findings.filter((f) => f.rule === 'dsh/patch-insert-unique-id' && /README/i.test(f.file));
  assert.equal(readmeHits.length, 0, 'README.md 示例不应命中（exts 只查 yml/yaml）');
  // cordis.patch.yml 纯 insert（无同 id 覆盖行）不报
  const patchHits = res.findings.filter((f) => f.rule === 'dsh/patch-insert-unique-id' && /cordis\.patch\.yml$/.test(f.file));
  assert.equal(patchHits.length, 0, '纯 insert 无覆盖行不报');
  // 冲突 patch（insert 与顶层覆盖同 id）应报——直接调用检查器验证语义
  const loaded = loadRuleFiles(['dsh']);
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  const g = groupByKind(compiled);
  const cf = checkPatchInsert({ file: 'conflict.patch.yml', text: '- insert:\n    - id: dup-id\n      name: a\n- id: dup-id\n  name: b\n', rules: g['patch-insert'] });
  assert.ok(cf.length === 1, `冲突 patch 应报 1 条（实际 ${cf.length}）`);
  const pf = checkPatchInsert({ file: 'cordis.patch.yml', text: '- insert:\n    - id: skill-scoreboard\n', rules: g['patch-insert'] });
  assert.equal(pf.length, 0, '纯 insert 无覆盖行不报（直接调用）');
});

test('⑦ checkSemantic：只对代码文件报（.gitignore/README 不报）', async () => {
  const res = await auditFull(fixture, { depth: 5 });
  // locale-file-missing 是仓库级预期检查（报在 package.json）；folder 规则是仓库级结构检查。
  // 排除这两类后，占位 semantic 规则（安全/a11y/dependency）应只报代码文件。
  const sem = res.findings.filter((f) => f.kind === 'semantic' && !/locale-file/.test(f.rule) && f.rule !== 'folder/gitignore-missing-artifacts');
  for (const f of sem) {
    assert.ok(/\.(js|mjs|cjs|ts|py)$/.test(f.file), `semantic 只应报代码文件（实际 ${f.file}）`);
  }
  // .gitignore 不应有安全/a11y/dependency 占位语义提示（folder 结构检查除外）
  const gitignoreSemantic = res.findings.filter((f) => /\.gitignore$/.test(f.file) && f.kind === 'semantic');
  assert.equal(gitignoreSemantic.length, 0, '.gitignore 不应有语义/安全占位提示');
});

test('⑧ version 路径上下文豁免：安装路径里的 dsh-v0.x.y 不报', async () => {
  assert.ok(isVersionInPathContext('/vol2/runtime/dsh-v0.1.2-alpha.4/.dsh-home') === true, '路径内版本号应豁免');
  assert.ok(isVersionInPathContext('| v0.2.0 | 更新日志标题') === false, 'README 版本记录标题不应豁免');
  const res = await auditFull(fixture, { depth: 5 });
  const v = res.findings.filter((f) => /version\/(embedded-major-zero|readme-zero-title)/.test(f.rule));
  assert.equal(v.length, 0, 'README 路径示例不应触发 version 0.x 警告');
});

test('filterRulesByExt：声明 exts 的规则只对匹配文件生效', () => {
  const loaded = loadRuleFiles(['dsh']);
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  const g = groupByKind(compiled);
  const gYml = filterRulesByExt(g, 'cordis.patch.yml');
  const gMd = filterRulesByExt(g, 'README.md');
  const hasPatchYml = (gg) => Object.values(gg).flat().some((r) => r.id === 'dsh/patch-insert-unique-id');
  assert.ok(hasPatchYml(gYml), 'yml 文件应保留 patch 规则');
  assert.ok(!hasPatchYml(gMd), 'md 文件应裁剪 patch 规则（exts 过滤生效）');
});

test('detectRepoJsYamlImport：import/require 证据识别', async () => {
  const files = [{ full: join(depProj, 'lib', 'a.js') }];
  assert.equal(detectRepoJsYamlImport(files), true, 'import js-yaml 应识别');
  const clean = [{ full: join(fixture, 'lib', 'index.js') }];
  assert.equal(detectRepoJsYamlImport(clean), false, '无 js-yaml 引用不应识别');
});

test('disabled 机制：文件级默认关 i18n / 仅环境变量显式列出强制加载 / 规则级单条过滤', () => {
  // ① 文件级：i18n yml 顶层 disabled:true → 默认 loadRuleFiles 不加载 i18n 规则
  const def = loadRuleFiles();
  assert.equal(def.merged.rules.filter((r) => /^i18n\//.test(r.id || '')).length, 0,
    'i18n 槽位默认 disabled 不应加载');
  // ② 2026-09-13（yml 为准）：参数显式列出 **不再**强制加载（auditRuleOrder 是顺序不是强制名单）；
  //    只有环境变量 DSH_GIT_PUSH_RULE_SLOTS 才是强制名单。
  const exp = loadRuleFiles(['i18n']);
  assert.equal(exp.merged.rules.filter((r) => /^i18n\//.test(r.id || '')).length, 0,
    '参数显式列出不再强制加载（yml disabled 为准）');
  const prev = process.env.DSH_GIT_PUSH_RULE_SLOTS;
  process.env.DSH_GIT_PUSH_RULE_SLOTS = 'i18n';
  try {
    const env = loadRuleFiles();
    assert.ok(env.merged.rules.filter((r) => /^i18n\//.test(r.id || '')).length > 0,
      '环境变量显式列出 i18n 应强制加载');
  } finally {
    if (prev === undefined) delete process.env.DSH_GIT_PUSH_RULE_SLOTS;
    else process.env.DSH_GIT_PUSH_RULE_SLOTS = prev;
  }
  // ③ 规则级：条目 disabled:true → 单条过滤（自定义目录 fixture）
  const customDir = mkdtempSync(join(tmpdir(), 'v2-disabled-'));
  try {
    writeFileSync(join(customDir, 'audit-rules-t.yml'), [
      'rules:',
      '  - id: t/on',
      '    name: on',
      '    severity: warning',
      '    patterns: ["x"]',
      '  - id: t/off',
      '    name: off',
      '    severity: warning',
      '    disabled: true',
      '    patterns: ["x"]',
      '',
    ].join('\n'));
    const r = loadRuleFiles(['t'], { dir: customDir });
    const ids = r.merged.rules.map((x) => x.id);
    assert.deepEqual(ids, ['t/on'], `规则级 disabled 应只保留 t/on（实际 ${JSON.stringify(ids)}）`);
  } finally {
    try { rmSync(customDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

test('强制加载：安全红线（nodejs 槽位/secret/cred/security 规则）disabled 不可关，文件缺失内置兜底', () => {
  // isForceLoadRule / FORCE_LOAD_FALLBACK 直接 import（顶部）
  // ① isForceLoadRule 判定：凭据/硬编码强制，i18n 不强制
  assert.equal(isForceLoadRule('secret-aws-access-key'), true);
  assert.equal(isForceLoadRule('credfile-common'), true);
  assert.equal(isForceLoadRule('security/no-hardcoded-credentials'), true);
  assert.equal(isForceLoadRule('npm/npmrc-authtoken'), true);
  assert.equal(isForceLoadRule('i18n/hardcoded-user-visible'), false);
  // ② 文件级强制：nodejs 槽位顶层 disabled:true 仍加载
  const dir = mkdtempSync(join(tmpdir(), 'v2-force-'));
  try {
    writeFileSync(join(dir, 'audit-rules-nodejs.yml'), [
      'disabled: true',
      'rules:',
      '  - id: security/no-hardcoded-credentials',
      '    name: hc',
      '    severity: error',
      '    disabled: true',
      '    patterns: ["cred"]',
      '  - id: secret-generic-token',
      '    name: sgt',
      '    severity: error',
      '    disabled: true',
      '    patterns: ["token"]',
      '  - id: readability/fake',
      '    name: fake',
      '    severity: warning',
      '    disabled: true',
      '    patterns: ["x"]',
      '',
    ].join('\n'));
    const r = loadRuleFiles(null, { dir });
    const ids = r.merged.rules.map((x) => x.id);
    assert.ok(ids.includes('security/no-hardcoded-credentials'), 'security/* 规则 disabled 仍强制保留');
    assert.ok(ids.includes('secret-generic-token'), 'secret-* 规则 disabled 仍强制保留');
    assert.ok(!ids.includes('readability/fake'), '普通规则 disabled 应被关闭');
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  }
  // ③ 强制槽位文件缺失 → 内置兜底（不静默、不崩、安全不断档）
  const missDir = mkdtempSync(join(tmpdir(), 'v2-miss-'));
  try {
    writeFileSync(join(missDir, 'audit-rules-version.yml'), 'rules: []\n');
    const m = loadRuleFiles(null, { dir: missDir });
    assert.equal(m.ok, false, '缺失强制槽位应 ok:false（显式记录）');
    assert.ok(m.errors.some((e) => /强制加载槽位 nodejs/.test(e)), 'errors 应含 nodejs 缺失提示');
    assert.ok(m.merged.rules.some((x) => x.id === 'secret-generic-token'), 'nodejs 兜底规则应合并');
    assert.ok(m.merged.rules.some((x) => x.id === 'security/no-hardcoded-credentials'), '硬编码兜底规则应合并');
    assert.ok(m.merged.private_files.length > 0, 'private 兜底清单应合并');
  } finally {
    try { rmSync(missDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

test('UI 禁用槽位（auditDisabledSlots）：普通槽位整包过滤 / nodejs-private 安全红线不可禁用', () => {
  // ① 禁用 comment：规则数减少（comment 槽位规则全部不加载）
  const base = loadRuleFiles();
  const ui = loadRuleFiles(null, { disabledSlots: ['comment'] });
  assert.ok(base.merged.rules.length > ui.merged.rules.length, '禁用 comment 后规则数应减少');
  // ② 禁用 nodejs/private（安全红线 FORCE_LOAD_SLOTS）：规则与私密清单不受影响
  const forceNodejs = loadRuleFiles(null, { disabledSlots: ['nodejs'] });
  assert.ok(forceNodejs.merged.rules.length >= base.merged.rules.length - 10,
    `禁用 nodejs 不应清空规则（${forceNodejs.merged.rules.length} vs ${base.merged.rules.length}）`);
  const forcePrivate = loadRuleFiles(null, { disabledSlots: ['private'] });
  assert.ok(forcePrivate.merged.private_files.length > 0, '禁用 private 后私密清单仍应保留（安全红线）');
  // ③ 空数组 / 非数组：不崩、等同不传
  const empty = loadRuleFiles(null, { disabledSlots: [] });
  assert.equal(empty.merged.rules.length, base.merged.rules.length, '空禁用数组应等同默认');
  const weird = loadRuleFiles(null, { disabledSlots: 'comment' });
  assert.equal(weird.merged.rules.length, base.merged.rules.length, '非数组禁用值应忽略');
});


/* ───────── 1.1.4 误报修复：credref-plain-secret 把非凭据当明文 ───────── */

test('credref-plain-secret：类型检查/字段透传/类型注解不报，真明文照报（1.1.4 误报修复）', () => {
  // 走真实管线：yml 规则定义 → compileAllRules 编译 → groupByKind 分桶
  // （直接用 yml 原始规则会拿不到编译后的 RegExp，测的就不是真实路径了）
  const raw = loadRuleFiles().merged.rules.filter((r) => r.id === 'credref-plain-secret');
  assert.equal(raw.length, 1, '应加载到 credref-plain-secret 规则');
  const compiled = compileAllRules(raw, { errors: [] }).filter((r) => r.id === 'credref-plain-secret');
  assert.equal(compiled.length, 1, 'credref-plain-secret 应编译成功');
  assert.equal(compiled[0].astConfirmKind, 'credential-value',
    '规则必须声明 credential-value 精筛，否则退化为纯正则初筛会大量误报');
  assert.ok(compiled[0].pattern instanceof RegExp, 'pattern 应已编译为 RegExp');
  const run = (text, ext = '.js') => {
    const file = `x${ext}`;
    return runChecks({ file, relPath: file, text, grouped: groupByKind(compiled) });
  };
  // ① 不该报：类型/存在性检查——旧 pattern 的 `[:：=]` 会命中 `===` 的第 3 个 `=`，
  //    再把被比较的 `'string'` 当成明文凭据（safeRe 默认带 i，大写 T 照样命中）
  assert.equal(run("if (typeof init.githubToken === 'string') cfg.githubToken = init.githubToken;").length, 0,
    '类型检查不应报');
  // ② 不该报：字段透传（右侧是变量）
  assert.equal(run('cfg.githubToken = next.githubToken;').length, 0, '字段透传不应报');
  // ③ 不该报：默认值取自配置（右侧是表达式）
  assert.equal(run("token = options.token || '';").length, 0, '表达式默认值不应报');
  // ④ 不该报：JSDoc / 对象字面量的类型注解
  assert.equal(run(' * @returns {{token: string, source: string}}').length, 0, 'JSDoc 类型注解不应报');
  assert.equal(run('const b = { token: string };').length, 0, '对象字段类型注解不应报');
  // ⑤ 照报：真明文（赋值 / 对象字段两种形态）
  assert.equal(run('const password = "hunter2xyz";').length, 1, '真明文赋值应报');
  assert.equal(run("const cfg = { token: 'ghp_a1b2c3d4e5f6g7h8i9j0' };").length, 1, '对象字段真明文应报');
  assert.equal(run('cookie: "abcdef123456"').length, 1, '真明文 cookie 应报');
  // ⑥ 照报：markdown 行内代码段里的真明文
  //    （`token: "..."` 的反引号被分词器当模板定界符，整段合成 tmpl token，
  //     若不做内部兜底会漏报——文档里最常见的写法恰恰是行内代码段）
  assert.equal(run('示例：`password: "hunter2xyz"`', '.md').length, 1, '行内代码段里的真明文应报');
  // ⑦ 不该报：占位符/掩码仍是占位符（判据共用 isMeaningfulCredentialValue）
  assert.equal(run("const token = 'your-token-here';").length, 0, '占位符不应报');
  assert.equal(run("const token = 'CHANGE_ME';").length, 0, 'CHANGE_ME 不应报');
});

test('cookie-secure-flag：读取响应头不报（跨语言），设置 Cookie 缺 Secure/HttpOnly 照报（2026-09-18）', () => {
  // 走真实管线：yml 规则定义 → compileAllRules 编译 → groupByKind 分桶
  const raw = loadRuleFiles().merged.rules.filter((r) => r.id === 'security/cookie-secure-flag');
  assert.equal(raw.length, 1, '应加载到 security/cookie-secure-flag 规则');
  const compiled = compileAllRules(raw, { errors: [] }).filter((r) => r.id === 'security/cookie-secure-flag');
  assert.equal(compiled.length, 1, 'cookie-secure-flag 应编译成功');
  const run = (text, ext = '.js') => {
    const file = `x${ext}`;
    return runChecks({ file, relPath: file, text, grouped: groupByKind(compiled) });
  };

  // ── ① 不该报：读取响应头（跨语言，均为误报）──
  //   Python：本次误报来源（scripts/migrate-session/lib/follow.py），
  //   规则 pattern 是 `Set-Cookie:`，而 safeRe 默认带 i，故小写 set-cookie 也命中；
  //   旧白名单只覆盖 JS 的 match(/Set-Cookie/) 与字符串字面量，Python 形态全漏。
  assert.equal(run('if line.lower().startswith("set-cookie:"):', '.py').length, 0,
    'Python startswith 读取响应头不应报');
  assert.equal(run('if line.startswith("Set-Cookie:"):', '.py').length, 0,
    'Python 大小写敏感 startswith 不应报');
  //   JS：Headers.get / 正则字面量 / 成员判定
  assert.equal(run("const ck = headers.get('Set-Cookie');").length, 0,
    'Headers.get 读取响应头不应报');
  assert.equal(run("const m = raw.match(/Set-Cookie:([^;]+)/);").length, 0,
    '正则字面量读取响应头不应报');
  assert.equal(run("const has = 'set-cookie' in lowerHeaders;").length, 0,
    '成员判定读取响应头不应报');
  //   Go：Header.Get
  assert.equal(run('ck := resp.Header.Get("Set-Cookie")', '.go').length, 0,
    'Go Header.Get 读取响应头不应报');

  // ── ② 照报：字符串里出现 Set-Cookie: 且该行无 Secure（规则的既有检出范围）──
  //   这条规则实际只能检查「代码里出现的 Set-Cookie: 文本」，覆盖不到 API 调用
  //   （res.setHeader('Set-Cookie', ...) 后面是引号不是冒号，pattern 不匹配）——
  //   属已知盲区，见规则注释；此处只锁「命中即报」不被白名单误伤。
  assert.equal(run("const raw = 'Set-Cookie: sid=1';").length, 1,
    '无 Secure 的 Set-Cookie 文本应报');

  // ── ③ 白名单不得过宽：读取动词与设置动词要区分 ──
  //   旧白名单 `['"]Set-Cookie['"]` 只认「字符串里出现 Set-Cookie」，
  //   而设置与读取都用字符串，于是把真风险 setHeader 一并豁免了（漏报）。
  //   改按动词细分后，setHeader 行不再被豁免——若将来有人把白名单改回宽匹配，
  //   本断言会失败（这条锁的是白名单的精确度，不是 pattern 的覆盖面）。
  const wl = raw[0].whitelist_patterns || [];
  const wlRe = wl.map((w) => new RegExp(w, 'i'));
  const setHeaderLine = "res.setHeader('Set-Cookie', 'sid=abc; Path=/');";
  assert.equal(wlRe.some((re) => re.test(setHeaderLine)), false,
    'setHeader 设置 Cookie 不应被读取类白名单豁免（会漏报真风险）');
});
