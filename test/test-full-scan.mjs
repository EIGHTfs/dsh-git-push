/**
 * dsh-skip-sensitive：本文件含 comment-wording/full-scan 检测目标措辞（作为测试输入数据），
 * dsh-git-push — fullScan 附属能力单测（v1.43.0）
 * 覆盖：注释提取（行锚定）/ 评分（黑加白减 + 次级信号）/ 规则包 fullScan 段编译降级 /
 *       全仓扫描（表格/排序/只读）/ 提交门禁集成（新增行注释 → warning 不拦截）
 * 运行：node test/test-full-scan.mjs
 * 豁免提交前 autoClean 自动清理——v1.45.0 两次实锤（夹具被静默篡改致 3+4 项测试挂）后固化。
 */

import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractComments, scoreComment, fullScanRepo, compileFullScan, FULLSCAN_DEFAULTS } from '../lib/full-scan.js';
import { validateRulePack, compileRulePack } from '../lib/rule-packs.js';
import { auditRepo } from '../lib/audit.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}

const fsDefaults = compileFullScan(FULLSCAN_DEFAULTS);

console.log('  注释提取（extractComments，行锚定）');
{
  const code = `const api = "https://api.example.com/v1/items?page=2";\n\n// 用户指示：必须先跑测试\nfunction run() { return 1; }\n`;
  const cs = extractComments(code, 'js');
  ok(cs.length === 1 && cs[0].text.includes('用户指示'), `URL 字符串不算注释，行首 // 才算（got ${cs.length} 条）`);
}
{
  const code = `/*\n * 用户原话："提交前要审计"\n */\nconst x = 1;\n`;
  const cs = extractComments(code, 'js');
  ok(cs.length === 1 && cs.some((c) => c.text.includes('用户原话')), '块注释跨行提取：只出内容行（开口/收尾行不产出）');
  ok(!cs.some((c) => c.text.includes('/*') || c.text.includes('*/')), '块标记本身不进文本');
  ok(!cs.some((c) => /^[*/]+$/.test(c.text)), '收尾行只闭合不产出垃圾（v1.45.0 回归）');
}
{
  const py = '# 这是关键逻辑\nx = 1\n';
  ok(extractComments(py, 'py').length === 1, 'py/sh 行首 # 提取');
  const html = '<!-- 改这里 -->\n<div></div>\n';
  ok(extractComments(html, 'html').length === 1, 'html <!-- --> 提取');
  const ts = '# TS不支持\nconst a = 1;';
  ok(extractComments(ts, 'ts').length === 0, 'ts 文件不认 # 注释');
}

console.log('  评分（scoreComment：黑加白减）');
{
  const r = scoreComment({ text: '用户指示：必须先跑测试再提交', prevBlankOrComment: true, nextIsCode: true }, fsDefaults);
  // 黑 40 + 短 10 + 上下文 20 = 70
  ok(r.score === 70 && r.hits.includes('用户指示词') && r.protects.length === 0, `黑名单命中 70 分（got ${r.score}）`);
}
{
  const r = scoreComment({ text: '用户指示：验证完成后重启', prevBlankOrComment: true, nextIsCode: true }, fsDefaults);
  // 黑 40 + 白 -30 + 短 10 + 上下文 20 = 40
  ok(r.score === 40 && r.protects.includes('技术词'), `白名单减分生效 40 分（got ${r.score}）`);
}
{
  const r = scoreComment({ text: '处理 "error" 返回 0', prevBlankOrComment: true, nextIsCode: true }, fsDefaults);
  ok(r.hits.length === 0 && r.score === 30, `无黑名单命中不进报告（半角引号不加分，got ${r.score}）`);
}
{
  const r = scoreComment({ text: 'v1.42.0：文件级评分（行数/容量）', prevBlankOrComment: true, nextIsCode: false }, fsDefaults);
  ok(r.hits.length === 0 && r.score < 60, `版本号注释不误报（got ${r.score}）`);
}
{
  const r = scoreComment({ text: '用户原话：“提交前要审计”', prevBlankOrComment: true, nextIsCode: false }, fsDefaults);
  ok(r.score >= 60 && r.warn !== false, `中文引号加分路径：${r.score}`);
}

console.log('  规则包 fullScan 段（校验 + 编译降级）');
{
  const bad = validateRulePack({ name: 'x', owner: 'o', version: '1', rules: [], fullScan: { threshold: -1, keywords: [{ name: 'a', pattern: '([bad' }] } });
  ok(!bad.ok && bad.errors.length >= 2, '非法 threshold 与正则报错');
  const c = compileRulePack({ name: 'x', owner: 'o', version: '1', rules: [], fullScan: { threshold: 80, keywords: [{ name: 'k', pattern: '用户指示', score: 50 }], protectWords: [{ name: 'p', pattern: '([bad' }] } }, { source: 'test' });
  ok(c.fullScan.threshold === 80 && c.fullScan.keywords[0].score === 50, '合法段编译透传');
  ok(c.fullScan.protectWords[0].re.test('任何文本') === false, '非法正则降级为永不匹配');
  const n = compileRulePack({ name: 'x', owner: 'o', version: '1', rules: [] }, { source: 'test' });
  ok(n.fullScan === null, '未配 fullScan → null（引擎用内置缺省）');
}

console.log('  全仓扫描（fullScanRepo：表格/排序/只读）');
{
  const d = mkdtempSync(join(tmpdir(), 'fullscan-'));
  const before = new Map();
  try {
    writeFileSync(join(d, 'a.js'), '// 用户指示：必须先跑测试再提交\nconst x = 1;\n// 普通注释说明用途\nconst y = 2;\n');
    writeFileSync(join(d, 'b.py'), '# 用户说这里要加缓存\nz = 3\n');
    mkdirSync(join(d, 'node_modules'));
    writeFileSync(join(d, 'node_modules', 'c.js'), '// 用户指示：不该被扫到\n');
    before.set('a.js', readFileSync(join(d, 'a.js'), 'utf8'));
    const r = fullScanRepo(d);
    ok(r.ok && r.scanned === 2, `扫描 2 个文本文件（node_modules 跳过，got ${r.scanned}）`);
    ok(r.hits.length === 2 && r.hits[0].score >= r.hits[1].score, `命中 2 条且按分数降序`);
    ok(r.hits[0].warn === true, `阈值 60：最高分标⚠（${r.hits[0].score}）`);
    ok(r.table.includes('a.js:1') && r.table.includes('b.py:1'), `表格含全部命中位置`);
    ok(!r.table.includes('node_modules'), '跳过目录内容不进表格');
    ok(r.table.includes('未改动') || r.table.includes('只读'), '表格注明只读不删码');
    ok(readFileSync(join(d, 'a.js'), 'utf8') === before.get('a.js'), '扫描后文件内容不变（只读）');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

console.log('  提交门禁集成（新增行注释 → warning 不拦截）');
{
  const d = mkdtempSync(join(tmpdir(), 'fsaudit-'));
  try {
    writeFileSync(join(d, 'a.js'), 'const x = 1;\n');
    const r = auditRepo(d, { blockOn: 'blocker', files: [{ path: 'a.js', addedLines: ['// 用户指示：必须先跑测试再提交', 'const y = 2;'] }] });
    const f = r.findings.filter((x) => x.rule === 'full-scan');
    ok(f.length === 1 && f[0].level === 'warning' && /评分 70/.test(f[0].message), `新增行黑名单注释产出 warning（got ${f.length} 条）`);
    ok(r.blocked === false && r.passed === true, 'full-scan warning 不拦截提交');
    const r2 = auditRepo(d, { files: [{ path: 'a.js', addedLines: ['// 普通技术注释，说明函数用途', 'const y = 2;'] }] });
    ok(r2.findings.filter((x) => x.rule === 'full-scan').length === 0, '普通注释不产 finding');
    writeFileSync(join(d, 'b.js'), 'const z = 1;\n// 用户指示：这个文件头豁免\n');
    const r3 = auditRepo(d, { files: [{ path: 'b.js', addedLines: ['// 用户指示：必须先跑测试', 'const w = 2;'] }] });
    // b.js 无文件头豁免标记——这里验证的是 skipSensitive 逻辑，单独构造头豁免文件
    const r4 = auditRepo(d, { files: [{ path: 'b.js', addedLines: [], }] });
    ok(r4.ok, '空 addedLines 不炸');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
