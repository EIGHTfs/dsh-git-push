// 三入口「克隆默认带历史」一致性守卫（源码级断言，不联网、不启动宿主）
//
// 为什么需要：默认值反转后，「前端/工具/CLI 是否都带历史」只由三处独立代码维持 ——
//   谁改了其中一处，另外两处不会红、界面也不会报错，行为却已经分叉。
//   本用例把三处默认钉在一起，任何单点改动都会立刻暴露。
//
// 说明：这里读源码做断言（而非跑整条克隆链），因为克隆链要联网且耗时；
//   源码级断言足以挡住「单点改成默认关」这类真实回归，行为本身另由真仓库 e2e 覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('agent 工具入口：未传 history 时按 true 处理，且显式关闭仍生效', () => {
  const s = read('lib/app/tool-call.js');
  assert.match(s, /args\.history === undefined \? true/, '工具入口的 history 默认应为 true');
  assert.match(s, /'false'/, '工具入口应仍支持显式传 false/0 关闭（退回整树快照）');
});

test('HTTP/侧边栏入口：请求体未带 history 时按 true 处理，且显式关闭仍生效', () => {
  const s = read('lib/app/handlers/clone.js');
  assert.match(s, /body\?\.history === undefined \? true/, 'HTTP 入口的 history 默认应为 true');
  assert.match(s, /'false'/, 'HTTP 入口应仍支持显式传 false/0 关闭');
});

test('CLI/工具 schema：history 参数声明默认 true，并说明可传 false 退回快照', () => {
  const s = read('lib/app/command-registry.js');
  assert.match(s, /flag: 'history', type: 'boolean', default: true/, 'schema 里 history 的默认应为 true');
  assert.match(s, /传 false 退回整树快照/, 'schema 的说明应写明可退回整树快照');
});

test('底层 cloneViaApi 保持显式默认（入口层才反转默认，内核不动）', () => {
  const s = read('lib/git/clone.js');
  assert.match(s, /history = false/, 'cloneViaApi 的 history 默认应仍为 false（由入口层显式传值）');
});

test('三入口一致：两处入口 + schema 都在讲「默认带历史」', () => {
  const a = read('lib/app/tool-call.js');
  const b = read('lib/app/handlers/clone.js');
  const c = read('lib/app/command-registry.js');
  assert.match(a, /真实历史/, '工具入口应注释说明默认带真实历史');
  assert.match(b, /真实历史/, 'HTTP 入口应注释说明默认带真实历史');
  assert.match(c, /真实历史/, 'schema 说明应含「真实历史」字样');
});
