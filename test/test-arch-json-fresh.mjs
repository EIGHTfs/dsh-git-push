// 架构图产物防漂移测试：确保入库的 .archify/ 与当前代码**始终一致**。
//
// 为什么需要：架构图是「事实导出」的产物——代码改了（加模块、改依赖、动 IO），
//   入库的 JSON/HTML 就会过期。过期的图比没有图更糟：它看起来是真的，其实是旧的。
//   本测试把「重算一遍 → 与入库产物比对」钉进全量回归，漂移即失败。
//
// 两层比对（与插件的 gen/apply/check 口径一致）：
//   ① JSON：重新 extract → aggregate → to-json，与 .archify/<名字>.architecture.json 比对
//   ② HTML：若本机有 archify（ARCHIFY_DIR 或工作区 archify/），重新 render 并逐字节比对；
//      没有则跳过（不因缺外部工具让测试变红，但要明确打印跳过原因）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArchFacts } from '../lib/arch/extract.js';
import { aggregateModules } from '../lib/arch/aggregate.js';
import { toArchifyJson } from '../lib/arch/to-json.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'dsh-git-push';
const JSON_PATH = join(ROOT, '.archify', `${NAME}.architecture.json`);
const HTML_PATH = join(ROOT, '.archify', `${NAME}.html`);

/** 复现 scripts/archify-gen.mjs 的产出（同一份事实与映射，不手写任何组件/连线）。 */
async function regenerate() {
  const facts = await extractArchFacts(ROOT);
  const agg = aggregateModules(facts);
  const treeDoc = existsSync(join(ROOT, 'tree-doc.json'))
    ? JSON.parse(readFileSync(join(ROOT, 'tree-doc.json'), 'utf8'))
    : null;
  const evidence = (() => {
    const run = (args) => {
      try {
        return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      } catch { return ''; }
    };
    const url = run(['remote', 'get-url', 'origin']);
    const revision = run(['rev-parse', 'HEAD']);
    if (!url || !/^[a-fA-F0-9]{40}$/.test(revision)) return null;
    const isPublic = /^https?:\/\/(www\.)?(github\.com|gitee\.com)\//i.test(url);
    return isPublic
      ? { url, revision, provider: /gitee\.com/i.test(url) ? 'gitee' : 'github', link_mode: 'web' }
      : { url, revision, link_mode: 'local-only' };
  })();
  return toArchifyJson(agg, facts, { name: NAME, repoPath: ROOT, evidence, treeDoc });
}

test('架构 JSON 无漂移：重跑生成器，结果与入库的 .archify/<名字>.architecture.json 一致', async () => {
  assert.ok(existsSync(JSON_PATH), `入库产物缺失：${JSON_PATH}（先跑 node scripts/archify-gen.mjs apply .）`);
  const committed = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  // 关键：比对对象必须是**真正生成入库产物的那个脚本**（scripts/archify-gen.mjs），
  //   而不是 lib/arch/* 的中间结果——脚本还会加审计三层组件、工具/路由说明、布局坐标等。
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'archify-gen.mjs'), 'gen', ROOT],
    { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
  const fresh = JSON.parse(out);
  // 逐字段比对（比字符串比对更易读：能指出是哪一类漂移）
  assert.equal(fresh.components.length, committed.components.length,
    `组件数漂移：重算 ${fresh.components.length} vs 入库 ${committed.components.length}（代码变了就重新 apply）`);
  assert.deepEqual(fresh.components.map((c) => c.id).sort(), committed.components.map((c) => c.id).sort(),
    '组件集合漂移');
  assert.equal(fresh.connections.length, committed.connections.length,
    `连线数漂移：重算 ${fresh.connections.length} vs 入库 ${committed.connections.length}`);
  assert.deepEqual(
    fresh.connections.map((c) => `${c.from}→${c.to}`).sort(),
    committed.connections.map((c) => `${c.from}→${c.to}`).sort(),
    '连线集合漂移',
  );
});

test('架构 HTML 无漂移：重新渲染并与入库 HTML 一致（本机无 archify 时跳过）', async () => {
  const archify = [process.env.ARCHIFY_DIR, join(ROOT, '..', 'archify')].filter(Boolean).find((d) => existsSync(join(d, 'archify', 'bin', 'archify.mjs')));
  if (!archify) {
    console.log('（跳过：本机未找到 archify，设置 ARCHIFY_DIR 指向其仓库根即可启用此测试）');
    return;
  }
  assert.ok(existsSync(HTML_PATH), `入库 HTML 缺失：${HTML_PATH}`);
  const tmp = mkdtempSync(join(tmpdir(), 'dshgp-arch-'));
  try {
    const out = join(tmp, `${NAME}.html`);
    execFileSync(process.execPath, [join(archify, 'archify', 'bin', 'archify.mjs'),
      'render', 'architecture', JSON_PATH, out, '--repo-root', ROOT], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
    const fresh = readFileSync(out, 'utf8');
    const committed = readFileSync(HTML_PATH, 'utf8');
    assert.equal(fresh.length, committed.length, `HTML 大小漂移：重渲 ${fresh.length} vs 入库 ${committed.length}（重新 render 并入库）`);
    assert.equal(fresh, committed, 'HTML 内容漂移（重新 render 并入库）');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
