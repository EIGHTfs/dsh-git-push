/**
 * test-quality.mjs — 代码质量审计模块单测（v1.39.0）
 * 依据 docs/code-quality-checklist.yaml 的维度规则：
 *   checkFunctionLength（可读性）/ checkSilentCatch（健壮性）/ checkSyncInAsync（性能）
 *   hasTestFiles（测试覆盖）/ scoreQuality（评分与等级）/ loadQualityYaml / locateQualityYaml
 * 零依赖 node:test 风格（自实现 ok 计数，仿 test-core.mjs）。
 */
import { checkFunctionLength, checkSilentCatch, checkSyncInAsync, hasTestFiles, scoreQuality, scoreFile, loadQualityYaml, locateQualityYaml } from '../lib/quality.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const TEST_REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); // 插件仓根（测试自身，不写死路径）

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}

console.log('[v1.39.0] 代码质量审计');

// ---- 可读性：函数行数 ----
console.log('  函数行数（checkFunctionLength）');
{
  const longFn = 'function big() {\n' + '  const x = 1;\n'.repeat(60) + '}\n';
  const hits = checkFunctionLength(longFn, { warn: 50, block: 100 });
  ok(hits.length === 1 && hits[0].len === 62 && hits[0].level === 'warning', `60 行函数 → warning（got=${JSON.stringify(hits.map(h => h.len + ':' + h.level))}）`);

  const hugeFn = 'function huge() {\n' + '  const x = 1;\n'.repeat(110) + '}\n';
  const hits2 = checkFunctionLength(hugeFn, { warn: 50, block: 100 });
  ok(hits2.length === 1 && hits2[0].len === 112 && hits2[0].level === 'blocker', `110 行函数 → blocker（got=${hits2[0]?.len}:${hits2[0]?.level}）`);

  const small = 'function ok() {\n  return 1;\n}\n';
  ok(checkFunctionLength(small).length === 0, '3 行函数不报');

  const arrow = 'const f = () => {\n' + '  const a = 1;\n'.repeat(55) + '};\n';
  const hits3 = checkFunctionLength(arrow, { warn: 50, block: 100 });
  ok(hits3.length === 1 && hits3[0].level === 'warning', `箭头函数 57 行 → warning（got=${hits3.length}）`);

  ok(checkFunctionLength('').length === 0 && checkFunctionLength(null).length === 0, '空输入不报');
}

// ---- 健壮性：静默吞错 ----
console.log('  静默吞错（checkSilentCatch）');
{
  ok(checkSilentCatch('try { a(); } catch (_) {}').length === 1, 'catch(_){} → 报');
  ok(checkSilentCatch('try { a(); } catch (e) {}').length === 1, 'catch(e){} → 报');
  ok(checkSilentCatch('catch { }').length === 1, 'catch{} → 报');
  ok(checkSilentCatch('try { a(); } catch (e) { // 忽略\n}').length === 1, 'catch 仅注释 → 报');
  ok(checkSilentCatch('try { a(); } catch (e) { console.error(e); }').length === 0, '有实质语句 catch → 不报');
  ok(checkSilentCatch('catch (e) { throw e; }').length === 0, 'catch 重新抛出 → 不报');
  ok(checkSilentCatch('try { a(); } catch (e) { log.warn("x"); }').length === 0, 'catch 记录日志 → 不报');
  ok(checkSilentCatch('').length === 0, '空输入不报');
}

// ---- 性能：async 路径同步 fs ----
console.log('  同步阻塞（checkSyncInAsync）');
{
  const s1 = 'async function go() {\n  const x = fs.readFileSync("/a");\n  await y();\n}\n';
  const r1 = checkSyncInAsync(s1);
  ok(r1.length === 1 && r1[0].line === 2 && r1[0].call.includes('readFileSync'), `async 中 readFileSync → 报（got=${JSON.stringify(r1)}）`);

  const s2 = 'function sync() {\n  const x = fs.readFileSync("/a");\n  return x;\n}\n';
  ok(checkSyncInAsync(s2).length === 0, '同步函数中 readFileSync → 不报');

  const s3 = 'const fs = require("fs");\nfunction top() { return fs.existsSync("/x"); }\n';
  ok(checkSyncInAsync(s3).length === 0, '无 async 上下文的 existsSync → 不报');
  ok(checkSyncInAsync('').length === 0, '空输入不报');
}

// ---- 测试覆盖 ----
console.log('  测试覆盖（hasTestFiles）');
{
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-q-'));
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.js'), 'x');
    ok(hasTestFiles(tmp) === false, '无测试文件 → false');
    fs.mkdirSync(path.join(tmp, 'test'), { recursive: true });
    ok(hasTestFiles(tmp) === true, '有 test/ 目录 → true');
    fs.rmSync(path.join(tmp, 'test'), { recursive: true, force: true });
    fs.writeFileSync(path.join(tmp, 'a.test.js'), 'x');
    ok(hasTestFiles(tmp) === true, '有 *.test.js → true');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  ok(hasTestFiles('') === false && hasTestFiles('/nonexistent-xyz-123') === false, '空/不存在路径 → false');
}

// ---- 评分与等级 ----
console.log('  评分（scoreQuality）');
{
  const clean = scoreQuality({ readability: 0, robustness: 0, performance: 0, testing: true }, {});
  ok(clean.score >= 85 && clean.level === 'A', `无问题+有测试 → A（got=${clean.score}:${clean.level}）`);

  const bad = scoreQuality({ readability: 4, robustness: 4, performance: 3, testing: false }, {});
  ok(bad.score >= 40 && bad.score < 70 && bad.level === 'C', `较多问题+无测试 → C（got=${bad.score}:${bad.level}）`);

  const worst = scoreQuality({ readability: 99, robustness: 99, performance: 99, testing: false }, {});
  ok(worst.score < 40 && worst.level === 'D', `极端问题 → D（got=${worst.score}:${worst.level}）`);

  // v1.60.0：质量扣分分级后——readability 为加权扣分点（warning 0.5/blocker 2，直接扣不乘 2），
  // 中等问题（2/3/1）不再扣到 C，落入 B 级
  const mid = scoreQuality({ readability: 2, robustness: 3, performance: 1, testing: false }, {});
  ok(mid.score >= 70 && mid.score < 85 && mid.level === 'B', `中等 → B（got=${mid.score}:${mid.level}）`);

  const q = scoreQuality({}, {});
  ok(q.dimensions && Object.keys(q.dimensions).length === 10, `10 维度齐全（got=${Object.keys(q.dimensions).length}）`);
  ok(q.levelDesc && q.levelDesc.length > 0, '等级描述非空');

  // v1.59.0：qualityWeights 覆盖（维度名 → 权重，合并进默认权重）
  const over = scoreQuality({ readability: 1, robustness: 1, performance: 1, testing: true }, { qualityWeights: { 可读性: 50 } });
  ok(typeof over.score === 'number' && over.score !== q.score, `qualityWeights 覆盖改变得分（base=${q.score} over=${over.score}）`);
}

// ---- yaml 解析 ----
console.log('  yaml 解析（loadQualityYaml / locateQualityYaml）');
{
  const fallback = loadQualityYaml('');
  ok(fallback.weights['可读性'] === 15 && Object.keys(fallback.weights).length === 10, '默认权重 10 项');
  // v1.59.0：安全性 20→18 文档 3→4 DX 2→3（定稿 10 维度合并版）
  ok(loadQualityYaml('/nonexistent-xyz.yaml').weights['安全性'] === 18, '文件缺失降级默认（安全性 18）');

  const yp = locateQualityYaml(TEST_REPO_ROOT);
  ok(yp.endsWith('code-quality-checklist.yaml'), `定位到 checklist（got=${yp.split('/').pop()}）`);
  const parsed = loadQualityYaml(yp);
  ok(parsed.weights['可读性'] === 15 && parsed.weights['安全性'] === 18 && parsed.weights['开发者体验'] === 3 && parsed.weights['文档'] === 4, `解析 yaml 权重（可读=${parsed.weights['可读性']} 安全=${parsed.weights['安全性']} DX=${parsed.weights['开发者体验']} 文档=${parsed.weights['文档']}）`);
  ok(parsed.levels.A && parsed.levels.D, `解析 A/D 等级描述`);
}

// ---- auditRepo 集成：quality 字段 ----
console.log('  auditRepo 集成');
{
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { auditRepo } = await import('../lib/audit.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-aq-'));
  try {
    fs.mkdirSync(path.join(tmp, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'lib', 'x.js'), 'function big() {\n' + '  const a = 1;\n'.repeat(60) + '}\ntry { a(); } catch (_) {}\n');
    fs.writeFileSync(path.join(tmp, 'lib', 'y.js'), 'export const ok = 1;\n');
    const files = [
      { path: 'lib/x.js', isBinary: false, addedLines: ['function big() {'] },
      { path: 'lib/y.js', isBinary: false, addedLines: ['export const ok = 1;'] },
    ];
    const r = auditRepo(tmp, { files, blockOn: 'none' });
    ok(r.ok === true, 'auditRepo ok');
    ok(r.quality && typeof r.quality.score === 'number' && r.quality.level, `quality 字段存在（score=${r.quality?.score} level=${r.quality?.level}）`);
    ok(r.findings.some((f) => f.rule === 'func-lines'), 'func-lines finding 产出');
    ok(r.findings.some((f) => f.rule === 'silent-catch'), 'silent-catch finding 产出');
    // 仓库无测试文件 → no-tests warning
    ok(r.findings.some((f) => f.rule === 'no-tests') && r.quality.hasTests === false, '无测试 → no-tests warning');
    // quality:false 关闭
    const r2 = auditRepo(tmp, { files, blockOn: 'none', quality: { enabled: false } });
    ok(!r2.quality, 'quality:false 时无 quality 字段');
    ok(!r2.findings.some((f) => f.rule === 'func-lines' || f.rule === 'silent-catch'), 'quality:false 时无质量 finding');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('  文件级评分（scoreFile）');
{
  const r = scoreFile('a\n'.repeat(100));
  ok(r.score === 100 && r.grade === 'A' && r.deductions.length === 0 && r.lines === 101, `基准内满分 A 级（score=${r.score} lines=${r.lines}）`);
}
{
  const r = scoreFile('\n'.repeat(300)); // 301 行 → (301-200)*0.05=5.05 → 保留 95
  ok(r.score === 95 && r.deductions.length === 1 && r.deductions[0].includes('行数 301 行（基准200行）'), `行数超基准扣分（score=${r.score}）`);
}
{
  const r = scoreFile('x'.repeat(60 * 1024)); // ~60KB → 30*0.2=6 → 94
  ok(r.score === 94 && r.deductions[0].includes('60.0KB（基准30KB）'), `容量超基准扣分（score=${r.score}）`);
}
{
  const r = scoreFile('x'.repeat(500 * 1024) + '\n'.repeat(1000)); // 扣满 40+30
  ok(r.score === 30 && r.deductions.length === 2 && r.grade === 'D', `扣分上限截断 D 级（score=${r.score}）`);
}
{
  const r = scoreFile('\n'.repeat(300), { fileLinesBase: 500, fileKbBase: 100 });
  ok(r.score === 100 && r.grade === 'A', '阈值可覆盖（基准 500 行/100KB → 满分）');
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
