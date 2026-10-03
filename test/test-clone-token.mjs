// git_clone 工具必须带 token 走认证 API 通道（实测发现此前漏传）。
//
// 事故：lib/app/tool-call.js 的 clone 执行体写成 `cloneViaApi({ target, dest, branch })`——
//   **完全没传 token** ⇒ 工具路径的克隆走匿名 api.github.com：
//   ① 私有库直接失败 ② 公开库吃匿名限流（60 次/小时）③ 体积上限也没传，与 HTTP 路径默认值不一致。
//   而 HTTP 路径（handlers/clone.js）与预览路径都带了 token ⇒ 同一功能两条路径行为不同。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('结构契约：clone 工具执行体必须传 token + 统一体积上限', () => {
  const src = readFileSync(join(ROOT, 'lib/app/tool-call.js'), 'utf8');
  const start = src.indexOf('async function callCloneJob');
  const end = src.indexOf('async function callCommitPush');
  assert.ok(start !== -1 && end > start, '应能定位 callCloneJob 函数体');
  const fn = src.slice(start, end);
  assert.match(fn, /cloneViaApi\(\{/, '应调用 cloneViaApi');
  assert.match(fn, /token:\s*resolveToken\(/, '必须按仓库解析 token 并传入（否则走匿名 API）');
  assert.match(fn, /maxFileMB:\s*resolveMaxCloneFileMB\(/, '体积上限也要统一解析（与 HTTP 路径同口径）');
  // 调用点必须把 env/cfg 传下去，否则函数内部解析不到 token
  assert.match(src, /callCloneJob\(\{[^}]*\},\s*jobs,\s*exec,\s*log,\s*env,\s*cfg\)/,
    '调用点必须传 env/cfg（否则 token 解析不到）');
});

test('结构契约：HTTP clone 路径同样带 token（两条路径同口径，防单边回退）', () => {
  const http = readFileSync(join(ROOT, 'lib/app/handlers/clone.js'), 'utf8');
  assert.match(http, /token:\s*resolveToken\(/, 'HTTP clone 必须带 token');
});
