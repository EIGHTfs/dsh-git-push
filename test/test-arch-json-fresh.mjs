// ArchFacts 产出测试（**渲染器无关**）——取代原先的「.archify 产物防漂移」测试。
//
// 为什么改（2026-10-09 边界收敛）：
//   我们产出的 JSON 是**我们自己的中性事实**（ArchFacts，规范 docs/ARCH-FACTS-SPEC.md），**不入库**；
//   `.archify/*.html|json` 是**渲染器 archify** 的格式，由**独立翻译脚本**产出
//   （ai-work-archive/scripts/archify-translate.mjs）。渲染器产物不入库 ⇒ 「与入库产物比对」这个口径消失。
//
// 现在钉住两条更本质、且不依赖任何渲染器的事实：
//   ① **可复现**：同一份代码连续生成两次必须逐字节一致（用 git revision 而非时间戳 ⇒ 无随机性）
//   ② **无渲染器概念**：产出里不得出现 archify 的字段（diagram_type / schema_version / layout /
//      sublabel / variant / pos / size / boundaries）——那属于翻译层，出现即边界被侵蚀
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportArchFacts, ARCH_FACTS_DIR } from '../lib/app/handlers/arch-json.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'dsh-git-push';

/** 在临时目录里跑一次导出（默认写盘），返回 { summary, text }。 */
async function generate(outDir) {
  const r = await exportArchFacts({ repoPath: ROOT, name: NAME, inline: false });
  assert.equal(r.ok, true, `导出失败：${r.error || ''}`);
  const p = join(ROOT, ARCH_FACTS_DIR, `${NAME}.facts.json`);
  assert.ok(existsSync(p), `未落盘：${p}`);
  void outDir;
  return { summary: r, text: readFileSync(p, 'utf8') };
}

test('ArchFacts 可复现：连续两次生成逐字节一致（无时间戳/无随机）', async () => {
  const a = await generate();
  const b = await generate();
  assert.equal(a.text, b.text, '两次生成不一致 ⇒ 产出里混入了非确定性内容（时间戳/随机数/遍历顺序）');
  assert.ok(a.text.length > 1000, `产出过小（${a.text.length} 字节），疑似没扫到内容`);
});

test('ArchFacts 是无渲染器概念的中性产物（archify 字段一律不得出现）', async () => {
  const { text } = await generate();
  const RENDERER_ONLY = ['diagram_type', 'schema_version', '"layout"', 'sublabel', '"variant"', '"pos"', '"size"', '"boundaries"'];
  for (const k of RENDERER_ONLY) {
    assert.ok(!text.includes(k), `产出里出现了渲染器字段 ${k} ⇒ 事实层被渲染器概念侵蚀（应只在翻译脚本里出现）`);
  }
  const doc = JSON.parse(text);
  assert.equal(doc.schema, 'dsh-archfacts/1', 'schema 标记必须是我们的规范版本');
  assert.ok(Array.isArray(doc.facts?.modules) && doc.facts.modules.length > 0, 'facts.modules 不能为空');
  assert.ok(Array.isArray(doc.agg?.components) && doc.agg.components.length > 0, 'agg.components 不能为空');
  assert.ok(/^[a-fA-F0-9]{40}$/.test(doc.revision || ''), `revision 应是 git 提交号（可复现的锚），实际：${doc.revision}`);
});

test('落盘位置在仓库内且已 gitignore（不入库）', async () => {
  await generate();
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.ok(gi.includes(`${ARCH_FACTS_DIR}/`), `.gitignore 必须忽略 ${ARCH_FACTS_DIR}/（事实产物不入库）`);
  const tmp = mkdtempSync(join(tmpdir(), 'dshgp-facts-'));
  try {
    const r = await exportArchFacts({ repoPath: ROOT, name: `${NAME}-tmp`, write: false });
    assert.equal(r.ok, true);
    assert.equal(r.outPath, '', 'write:false 时不应落盘（只算不写）');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
