// client.js 分片构建的门禁测试（任务.md C8）。
//
// 守住四件事：
//   ① 分片齐全、且没有「未登记进 PART_ORDER」的分片（未登记 = 不进产物 = 静默丢失）
//   ② 产物 lib/client.js 与分片拼接结果**逐字节一致**（防止有人直接手改产物，下次构建就被覆盖）
//   ③ 构建幂等（同一分片集多次构建结果相同）
//   ④ 形态铁律（client-modules 聚合兼容）：loader 首发、产物整体是 load({...}) 调用、内部声明带 dshgp_ 前缀
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PART_ORDER, PARTS_DIR, OUT_FILE, buildClient, checkShape } from '../scripts/build-client.mjs';

test('分片齐全且无未登记分片', () => {
  const missing = PART_ORDER.filter((f) => !existsSync(join(PARTS_DIR, f)));
  assert.deepEqual(missing, [], `缺分片：${missing.join(' / ')}`);
  const extra = readdirSync(PARTS_DIR).filter((f) => f.endsWith('.js') && !PART_ORDER.includes(f));
  assert.deepEqual(extra, [], `未登记进 PART_ORDER（不会进入产物，属静默丢失）：${extra.join(' / ')}`);
});

test('产物与分片逐字节一致（禁止手改 lib/client.js）', () => {
  const built = buildClient();
  const current = readFileSync(OUT_FILE, 'utf8');
  assert.equal(current, built, 'lib/client.js 与分片不一致——请运行 node scripts/build-client.mjs 重新生成');
});

test('构建幂等（同一分片集重复构建产物不变）', () => {
  assert.equal(buildClient(), buildClient());
});

test('形态铁律：loader 首发 + 整体为 load({...}) 调用', () => {
  const code = buildClient();
  assert.deepEqual(checkShape(code), []);
  const firstStmt = code.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trimStart();
  assert.match(firstStmt, /^window\.__ModuleLoader__\.load\(/, '产物第一条语句必须是 __ModuleLoader__.load(...)');
  assert.ok(code.trimEnd().endsWith('});'), '产物应以 }); 收尾（factory 闭合 + load 调用结束）');
});

test('工厂体内函数声明统一 dshgp_ 前缀（防 combo 拼接撞名）', () => {
  const code = buildClient();
  // 4 空格缩进 = factory 体内顶层声明；apply/inject 是导出给宿主的 API 名，按设计不加前缀。
  const API_NAMES = ['apply', 'inject'];
  const bad = [...code.matchAll(/^ {4}function ([A-Za-z_$][A-Za-z0-9_$]*)/gm)]
    .map((m) => m[1])
    .filter((n) => !n.startsWith('dshgp_') && !API_NAMES.includes(n));
  assert.deepEqual(bad, [], `未加 dshgp_ 前缀的工厂体函数：${bad.join(' / ')}`);
});
