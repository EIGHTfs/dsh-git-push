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
import { loadRuleFiles } from '../lib/rule/loader.js';
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

test('① npm/undeclared-js-yaml：全仓零 js-yaml import 不报（零依赖插件）', () => {
  const res = auditFull(fixture, { depth: 5 });
  assert.equal(byRule(res.findings, 'npm/undeclared-js-yaml').length, 0,
    '零依赖项目不应报 js-yaml 未声明（无 import 即无运行时风险）');
  // 对照：真 import 的项目仍应报（规则没有变哑）
  const dep = auditFull(depProj, { depth: 5 });
  assert.ok(byRule(dep.findings, 'npm/undeclared-js-yaml').length > 0,
    'import js-yaml 但未声明依赖仍应报');
});

test('② timeout-on-external-api：fetch + AbortSignal.timeout 同调用不报', () => {
  const res = auditFull(fixture, { depth: 5 });
  assert.equal(byRule(res.findings, 'robustness/timeout-on-external-api').length, 0,
    '带 AbortSignal.timeout 的 fetch 不应报无超时');
  // 对照：真无超时的 fetch 仍应报
  assert.ok(hasExternalCallTimeout("fetch('/a')", ["fetch('/a')"], 0) === false, '无超时行不豁免');
  assert.ok(hasExternalCallTimeout("fetch('/a', { signal: AbortSignal.timeout(1) })", [], 0) === true, '内联超时豁免');
});

test('③ client-module-loader-id：已按 load({id,factory}) 契约注册不报', () => {
  const res = auditFull(fixture, { depth: 5 });
  assert.equal(byRule(res.findings, 'dsh/client-module-loader-id').length, 0,
    '已用统一 ModuleLoader 契约的 client 半部不应报');
});

test('④ concat-in-t：split(\'{\'+\'k\' 的 t( 不误匹配（词边界）', () => {
  const res = auditFull(fixture, { depth: 5 });
  assert.equal(byRule(res.findings, 'i18n/concat-in-t').length, 0,
    'split() 内含拼接不是 t() 调用，不应报 concat-in-t');
  // 对照：真 t('a' + b 拼接仍应命中
  const r = checkRegexRulesSafe();
  assert.ok(r, 't() 拼接 pattern 仍可编译');
});

import { checkRegexRules } from '../lib/audit/checks.js';
function checkRegexRulesSafe() {
  const loaded = loadRuleFiles(['i18n']);
  const compiled = compileAllRules(loaded.merged.rules, { errors: [] });
  const g = groupByKind(compiled);
  const findings = checkRegexRules({ file: 'x.js', text: "const s = t('a' + b);\n", rules: g['regex'] });
  return findings.some((f) => f.rule === 'i18n/concat-in-t');
}

test('⑤ mkdir-before-write：写文件前同函数 ensureDataDir 不报', () => {
  const res = auditFull(fixture, { depth: 5 });
  assert.equal(byRule(res.findings, 'robustness/mkdir-before-write').length, 0,
    'saveData 模式（先 ensureDataDir 再 writeFile）不应报');
  assert.ok(hasMkdirInSameFunction(['function f() {', '  mkdirSync("/a", {recursive:true})', '  writeFileSync("/a/b")', '}'], 2) === true, '同函数 mkdir 豁免');
  assert.ok(hasMkdirInSameFunction(['function f() {', '  writeFileSync("/a/b")', '}'], 1) === false, '无 mkdir 不豁免');
});

test('⑥ patch-insert-unique-id：纯 insert 不报；insert+覆盖同 id 才报；README 示例不查', () => {
  const res = auditFull(fixture, { depth: 5 });
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

test('⑦ checkSemantic：只对代码文件报（.gitignore/README 不报）', () => {
  const res = auditFull(fixture, { depth: 5 });
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

test('⑧ version 路径上下文豁免：安装路径里的 dsh-v0.x.y 不报', () => {
  assert.ok(isVersionInPathContext('/vol2/runtime/dsh-v0.1.2-alpha.4/.dsh-home') === true, '路径内版本号应豁免');
  assert.ok(isVersionInPathContext('| v0.2.0 | 更新日志标题') === false, 'README 版本记录标题不应豁免');
  const res = auditFull(fixture, { depth: 5 });
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
