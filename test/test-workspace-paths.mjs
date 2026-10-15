// AI 自设工作区路径（workspace-paths）回归：状态文件读写 + 校验 + 端点行为 + 注入文本。
//
// 隔离纪律（no-pollution）：把 DSH_HOME 指向临时目录 ⇒ credentialsDir() 落在临时目录，
//   **绝不碰真实配置目录** ✓（credentialsDir 在调用时读 process.env.DSH_HOME，所以进程内设置即生效）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let HOME_TMP = '';
let WS_TMP = '';
let dirs = [];

before(() => {
  HOME_TMP = mkdtempSync(join(tmpdir(), 'dsh-wsp-home-'));
  WS_TMP = mkdtempSync(join(tmpdir(), 'dsh-wsp-ws-'));
  process.env.DSH_HOME = HOME_TMP;
  dirs = [1, 2, 3].map((i) => { const d = join(WS_TMP, `ws${i}`); mkdirSync(d, { recursive: true }); return d; });
});

after(() => {
  rmSync(HOME_TMP, { recursive: true, force: true });
  rmSync(WS_TMP, { recursive: true, force: true });
  delete process.env.DSH_HOME;
});

const mod = () => import('../lib/core/workspace-paths.js');
const h = () => import('../lib/app/handlers/workspace-paths.js');

test('① 初始无自设：读为空、注入为空、文件不落盘', async () => {
  const { loadWorkspacePaths, workspacePathsInjectionText, workspacePathsFile } = await mod();
  assert.deepEqual(loadWorkspacePaths().paths, []);
  assert.equal(workspacePathsInjectionText(), '', '无自设时注入文本应为空（⇒ 注入回退会话 cwd）');
  assert.equal(existsSync(workspacePathsFile()), false, '只读不应创建文件');
});

test('② 写入 + 读回 + 注入文本含路径与修改入口', async () => {
  const { loadWorkspacePaths, saveWorkspacePaths, workspacePathsInjectionText } = await mod();
  const r = saveWorkspacePaths([dirs[0], dirs[1]], { by: 'ai' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.paths, dirs.slice(0, 2));
  assert.deepEqual(loadWorkspacePaths().paths, dirs.slice(0, 2), '读回应与写入一致');
  const text = workspacePathsInjectionText();
  assert.match(text, /AI 自设工作区/);
  assert.ok(text.includes(dirs[0]) && text.includes(dirs[1]), '注入文本应逐条列出路径');
  assert.match(text, /workspace-paths/, '注入文本应给出修改入口（下一轮的自己知道怎么改）');
});

test('③ 校验：相对路径 / 不存在的目录 一律拒收（附原因）', async () => {
  const { saveWorkspacePaths } = await mod();
  const r = saveWorkspacePaths(['relative/path', join(WS_TMP, 'not-exist'), dirs[2]], { by: 'ai' });
  assert.deepEqual(r.paths, [dirs[2]], '只应保留合法的那条');
  const reasons = r.rejected.map((x) => x.reason).join('|');
  assert.match(reasons, /绝对路径/);
  assert.match(reasons, /不存在/);
});

test('④ 去重与上限（同一路径只留一次；超过 20 条截断并报原因）', async () => {
  const { saveWorkspacePaths, MAX_WORKSPACE_PATHS } = await mod();
  const dup = saveWorkspacePaths([dirs[0], dirs[0], dirs[0]], { by: 'ai' });
  assert.equal(dup.paths.length, 1, '重复路径应去重');

  const many = [];
  for (let i = 0; i < MAX_WORKSPACE_PATHS + 3; i++) { const d = join(WS_TMP, `many${i}`); mkdirSync(d, { recursive: true }); many.push(d); }
  const over = saveWorkspacePaths(many, { by: 'ai' });
  assert.equal(over.paths.length, MAX_WORKSPACE_PATHS, `应截断到上限 ${MAX_WORKSPACE_PATHS}`);
  assert.ok(over.rejected.some((x) => /上限/.test(x.reason)), '应给出超上限原因');
});

test('⑤ 端点：GET 读 / POST set·add·remove·clear', async () => {
  const { handleWorkspacePathsGet, handleWorkspacePathsSet } = await h();
  // 先清空，保证从干净状态开始
  handleWorkspacePathsSet({ body: { clear: true } });
  assert.deepEqual(handleWorkspacePathsGet().body.paths, []);

  const set = handleWorkspacePathsSet({ body: { paths: [dirs[0]] } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.paths, [dirs[0]]);

  const add = handleWorkspacePathsSet({ body: { paths: [dirs[1]], mode: 'add' } });
  assert.deepEqual(add.body.paths, [dirs[0], dirs[1]], 'add 应追加');

  const addDup = handleWorkspacePathsSet({ body: { paths: [dirs[1]], mode: 'add' } });
  assert.deepEqual(addDup.body.paths, [dirs[0], dirs[1]], 'add 重复项不应翻倍');

  const rm = handleWorkspacePathsSet({ body: { paths: [dirs[0]], mode: 'remove' } });
  assert.deepEqual(rm.body.paths, [dirs[1]], 'remove 应移除指定项');

  const get = handleWorkspacePathsGet();
  assert.equal(get.body.count, 1);
  assert.ok(get.body.injection.includes(dirs[1]), 'GET 应带回注入预览（AI 自查用）');

  const clear = handleWorkspacePathsSet({ body: { clear: true } });
  assert.deepEqual(clear.body.paths, []);
  assert.equal(handleWorkspacePathsGet().body.injectionActive, false, '清空后注入应回退会话 cwd');
});

test('⑥ 端点：全被拒时报 400（不能"成功但空"）· 缺参报 400', async () => {
  const { handleWorkspacePathsSet } = await h();
  const bad = handleWorkspacePathsSet({ body: { paths: ['relative/only'] } });
  assert.equal(bad.status, 400, '全部条目非法 ⇒ 必须 400');
  assert.equal(bad.body.ok, false);
  assert.deepEqual(bad.body.paths, []);

  const empty = handleWorkspacePathsSet({ body: {} });
  assert.equal(empty.status, 400, '缺 paths ⇒ 400');
  assert.match(String(empty.body.error), /paths/);

  const badMode = handleWorkspacePathsSet({ body: { paths: [dirs[0]], mode: 'explode' } });
  assert.equal(badMode.status, 400, '未知 mode ⇒ 400');
});

test('⑦ 坏 JSON 容错：文件被写坏时降级为空清单（不抛错）', async () => {
  const { workspacePathsFile, loadWorkspacePaths, workspacePathsInjectionText } = await mod();
  writeFileSync(workspacePathsFile(), '{ 这不是 JSON', 'utf8');
  assert.deepEqual(loadWorkspacePaths().paths, []);
  assert.equal(workspacePathsInjectionText(), '');
});

test('⑧ 经 handleHttp（工具/CLI 同源路径）POST：JSON **字符串** body 必须被解析', async () => {
  // 回归背景（实测 bug）：handleHttp 的 readBody 原先只接受对象 ⇒ 工具/CLI 传 JSON 字符串时
  //   body 被静默丢成 {} ⇒ 所有 POST 端点在工具/CLI 路径下都收不到参数 ✗
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const { handleWorkspacePathsSet, handleWorkspacePathsGet } = await h();
  handleWorkspacePathsSet({ body: { clear: true } }); // 先清空，保证断言从干净状态开始

  const out = await handleHttp({
    method: 'POST',
    url: '/api/git-push/workspace-paths',
    origin: 'http://localhost',
    headers: { host: 'localhost' },
    body: JSON.stringify({ paths: [dirs[0]] }),   // ← 字符串形态（工具/CLI 就是这么传的）
  }, { workspaceRoot: WS_TMP }, {});
  assert.equal(out.status, 200, 'body 为 JSON 字符串时也必须解析成功');
  assert.deepEqual(out.body.paths, [dirs[0]], '应写入成功');
  assert.deepEqual(handleWorkspacePathsGet().body.paths, [dirs[0]], '读回应一致');
});
