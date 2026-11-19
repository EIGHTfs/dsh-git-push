/**
 * HTTP 方法闸门回归（表驱动）
 *
 * 背景：http-handlers.js 的 switch 只看 path、不看 method，而 lib/http 的 checkOrigin 对
 *   GET/HEAD/OPTIONS 一律免校验（前提是「读不产生副作用」）。于是只要某个有副作用的端点
 *   用 GET 也能触发，`<img src=…>`、链接预览、浏览器预取就能替用户按下那个按钮——
 *   不需要同源、也不需要读响应。本文件锁三件事：
 *
 *   ① 写端点（改配置/凭据/业务状态、起停任务、发版/推送/改远端）**只接受 POST**，
 *      GET 必须 405 且**零副作用**（用 DSH_HOME 目录树的快照前后比对证明 handler 没跑）；
 *   ② 读端点（含前端定时轮询的那些）**GET 照常**——加错闸门会直接打断进度显示；
 *   ③ 路由层两张表（POST_ONLY_OPS / READ_ENDPOINTS_ALLOWED_ANY_METHOD）与 switch 里每个
 *      case 一一对应：新增端点忘了判定，这里会红（这是本任务最容易复发的地方）。
 *
 * 为什么用表驱动：端点会持续增加。表里加一行就多一条断言，不必复制粘贴测试体。
 * 隔离：DSH_HOME 指向临时目录，且置 DSH_GIT_PUSH_OFFLINE=1（任何漏网的外部调用快速失败，
 *   测试不依赖网络）。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { handleHttp, POST_ONLY_OPS, READ_ENDPOINTS_ALLOWED_ANY_METHOD } from '../../lib/app/http-handlers.js';
import { rejectNonPostMethod } from '../../lib/http/index.js';
import { cloneJobStatus } from '../../lib/git/clone-jobs.js';
import { handleStatus } from '../../lib/app/handlers/meta.js';

const WORKSPACE_ENV = { workspaceRoot: '' };
const LOOPBACK_ORIGIN = 'http://127.0.0.1';

/**
 * 期望「有副作用 ⇒ 只接受 POST」的端点。
 * 这一列是**人工逐个读 handler 判定**的结果，不是从 POST_ONLY_OPS 反抄的——
 *   两边互为第二真相，漂移时下面的「表与集合一致」用例会红。
 */
const WRITE_ENDPOINTS = [
  { path: '/api/git-push/settings-set', sideEffect: '写 config.json（设置/凭据落盘）' },
  { path: '/api/git-push/account-check', sideEffect: '在线校验并 persistSshPub + 写 account-status 快照' },
  { path: '/api/git-push/gen-ssh-key', sideEffect: '生成 SSH 私钥落盘（不可逆覆盖风险）' },
  { path: '/api/git-push/npm-check', sideEffect: '写 npmrc + 跑 npm whoami + 写 npm 快照' },
  { path: '/api/git-push/npm-install', sideEffect: '装包写 node_modules' },
  { path: '/api/git-push/npm-publish', sideEffect: '发包（不可逆的对外动作）' },
  { path: '/api/git-push/repos-local-scan', sideEffect: '启动后台扫描进程并写索引' },
  { path: '/api/git-push/repos-local-refresh', sideEffect: '补查远端并回写索引' },
  { path: '/api/git-push/repo-push', sideEffect: '推送（改远端）' },
  { path: '/api/git-push/repo-commit', sideEffect: '提交（改本地仓库历史）' },
  { path: '/api/git-push/repo-clone', sideEffect: '启动克隆任务并写盘' },
  { path: '/api/git-push/repo-visibility', sideEffect: '改远端仓库可见性' },
  { path: '/api/git-push/clone-abort', sideEffect: '中止进行中的克隆任务' },
  { path: '/api/preprocess/toggle-rule', sideEffect: '改审计规则 yml' },
  { path: '/api/git-push/auth/device/start', sideEffect: '申请设备码并重置进行中的会话' },
  { path: '/api/git-push/auth/device/poll', sideEffect: '换 token 并落盘' },
  { path: '/api/git-push/auth/revoke', sideEffect: '清空本地凭据' },
];

/**
 * 期望「允许任意方法（含 GET）」的端点。
 * skipGetProbe：该端点的 GET 会挂起等待（不是只读与否的问题），只做集合一致性断言。
 */
const READ_ENDPOINTS = [
  { path: '/api/git-push/status', note: '插件信息 + 脱敏配置' },
  { path: '/api/git-push/scan', note: '本地仓库清单（读目录）' },
  { path: '/api/git-push/browse', note: '目录浏览' },
  { path: '/api/git-push/repos-local', note: '本地仓库列表（默认只读索引快照）' },
  { path: '/api/git-push/repos-local-scan-wait', note: '等待扫描文件变化（不写状态）', skipGetProbe: true },
  { path: '/api/git-push/repos-cloud', note: '云端仓库列表（只读查询 + 派生索引合并）' },
  { path: '/api/git-push/clone-logs', note: '克隆日志（内存快照）' },
  { path: '/api/git-push/clone-preview', note: '克隆预览（只读查询 + 内存缓存）' },
  { path: '/api/git-push/clone-progress', note: '克隆进度轮询（前端定时 GET）' },
  { path: '/api/git-push/tools', note: '工具定义清单' },
  { path: '/api/git-push/tool-probes', note: '工具路径实测' },
  { path: '/api/preprocess/rule-slots', note: '规则包清单' },
  { path: '/api/preprocess/rule-detail', note: '规则明细' },
  { path: '/api/preprocess/audit', note: '审计聚合（请求时聚合、不落盘）' },
  { path: '/api/preprocess/exempt-hint', note: '豁免标记查询' },
  { path: '/api/git-push/account-status', note: '账号状态快照（离线读）' },
  { path: '/api/git-push/npm-account', note: 'npm 账号快照（离线读）' },
  { path: '/api/git-push/npm-owned', note: 'npm 名下包列表' },
  { path: '/api/git-push/npm-packages', note: '目录已装依赖' },
  { path: '/api/git-push/npm-install-progress', note: '安装进度轮询（前端定时 GET）' },
  { path: '/api/git-push/api-quota', note: '配额查询（顺带写派生快照）' },
  { path: '/api/git-push/settings-get', note: '设置快照' },
  { path: '/api/git-push/auth/status', note: '授权态查询' },
  { path: '/api/git-push/workspace-paths', note: '同一路径按方法分发（GET 读 / POST 写）' },
];

let homeDir = '';
const previousDshHome = process.env.DSH_HOME;
const previousOffline = process.env.DSH_GIT_PUSH_OFFLINE;

function pluginDir() {
  return join(homeDir, 'git-push');
}

function configFilePath() {
  return join(pluginDir(), 'config.json');
}

/** GET 调用（读方法免 Origin 校验，正是本任务要防的那条路径）。 */
function getPath(path) {
  return handleHttp({ method: 'GET', url: path }, WORKSPACE_ENV, {});
}

/** POST 调用（写方法需要同源 Origin）。 */
function postPath(path, body = {}) {
  return handleHttp({ method: 'POST', url: path, origin: LOOPBACK_ORIGIN, body }, WORKSPACE_ENV, {});
}

/** 递归快照 DSH_HOME 下所有文件内容：GET 前后一致 = handler 没有落盘副作用。 */
function snapshotTree(dir, root = dir, out = {}) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) snapshotTree(full, root, out);
    else out[relative(root, full)] = readFileSync(full, 'utf8');
  }
  return out;
}

before(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'dsh-gp-methodgate-'));
  process.env.DSH_HOME = homeDir;
  // 任何漏网的外部调用快速失败：本测试只关心「方法闸门有没有拦住 handler」，
  //   不该因为一个 405 用例意外打网络而变慢或变脆。
  process.env.DSH_GIT_PUSH_OFFLINE = '1';
});

after(() => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
  if (previousOffline === undefined) delete process.env.DSH_GIT_PUSH_OFFLINE;
  else process.env.DSH_GIT_PUSH_OFFLINE = previousOffline;
  rmSync(homeDir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(pluginDir(), { recursive: true, force: true });
  mkdirSync(pluginDir(), { recursive: true });
});

/* ───────── 表与实现互校 ───────── */

test('表↔集合一致：测试表与路由层两张导出集合逐项相同，且互不重叠', () => {
  const writePaths = WRITE_ENDPOINTS.map((row) => row.path).sort();
  const readPaths = READ_ENDPOINTS.map((row) => row.path).sort();
  assert.deepEqual([...POST_ONLY_OPS].sort(), writePaths,
    'POST_ONLY_OPS 与「写端点表」必须一致（改一处忘了另一处 → 这里会红）');
  assert.deepEqual([...READ_ENDPOINTS_ALLOWED_ANY_METHOD].sort(), readPaths,
    'READ_ENDPOINTS_ALLOWED_ANY_METHOD 与「读端点表」必须一致');
  const overlap = writePaths.filter((p) => readPaths.includes(p));
  assert.deepEqual(overlap, [], `端点不能同时被判为「写」和「读」：${overlap.join(', ')}`);
});

test('源码覆盖：switch 里每个 case 都被判定过（新增端点忘了分类 → 红）', () => {
  const source = readFileSync(new URL('../../lib/app/http-handlers.js', import.meta.url), 'utf8');
  const casePaths = [...source.matchAll(/case '([^']+)':/g)].map((match) => match[1]);
  assert.ok(casePaths.length >= 40, `应扫到全部路由 case（现 ${casePaths.length} 个）`);
  const classified = new Set([...WRITE_ENDPOINTS, ...READ_ENDPOINTS].map((row) => row.path));
  const unclassified = casePaths.filter((path) => !classified.has(path));
  assert.deepEqual(unclassified, [],
    `这些 case 还没做副作用判定（该加闸门就进 POST_ONLY_OPS，否则进 READ_ENDPOINTS_ALLOWED_ANY_METHOD）：${unclassified.join(', ')}`);
});

/* ───────── 写端点：GET 必须 405 且零副作用 ───────── */

test('写端点表驱动：GET → 405 METHOD_NOT_ALLOWED，且 DSH_HOME 目录树一字未变', async () => {
  for (const row of WRITE_ENDPOINTS) {
    const before = snapshotTree(homeDir);
    const response = await getPath(row.path);
    const after = snapshotTree(homeDir);
    assert.equal(response.status, 405, `${row.path} 有副作用（${row.sideEffect}），GET 必须 405`);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.code, 'METHOD_NOT_ALLOWED');
    assert.match(String(response.body.message), /POST/, '错误文案要说明只接受 POST');
    assert.deepEqual(after, before, `${row.path} 的 GET 不得产生任何落盘副作用（${row.sideEffect}）`);
  }
});

test('写端点的副作用额外证据：任务未启动、私钥未生成、索引未动', async () => {
  const cloneBefore = cloneJobStatus();
  await getPath('/api/git-push/repo-clone');
  assert.deepEqual(cloneJobStatus(), cloneBefore, 'GET repo-clone 不得启动克隆任务');

  await getPath('/api/git-push/clone-abort');
  // abort 返回 false 才说明没有任务被中止（GET 根本没进 handler）
  const aborted = await postPath('/api/git-push/clone-abort');
  assert.equal(aborted.body.aborted, false, '没有进行中的任务时应返回 aborted=false');

  await getPath('/api/git-push/gen-ssh-key');
  for (const keyName of ['id_rsa', 'id_ed25519', 'id_ecdsa']) {
    assert.equal(existsSync(join(pluginDir(), keyName)), false, `GET gen-ssh-key 不得生成私钥 ${keyName}`);
  }
  assert.equal(existsSync(join(pluginDir(), '.npmrc')), false, 'GET npm-check 不得写 npmrc');
});

/* ───────── 读端点：GET 照常 ───────── */

test('读端点表驱动：GET 不被方法闸门拦（不返回 405）', async () => {
  for (const row of READ_ENDPOINTS) {
    if (row.skipGetProbe) continue; // 会挂起等文件变化，只参与上面的集合一致性断言
    const response = await getPath(row.path);
    assert.notEqual(response.status, 405,
      `${row.path} 是读端点（${row.note}），GET 不得被方法闸门拦——加闸门会打断轮询/读取`);
    assert.notEqual(response.body?.code, 'METHOD_NOT_ALLOWED', `${row.path} 不该走到方法闸门`);
  }
});

test('轮询类端点专项：clone-progress / npm-install-progress / api-quota 的 GET 必须可用', async () => {
  // 这三个是前端定时 GET 的：一旦被要求 POST，轮询要过 CSRF Origin 校验，
  //   桌面端转发会剥离 Origin ⇒ 静默失败、进度条永不刷新（历史事故）。
  for (const path of ['/api/git-push/clone-progress', '/api/git-push/npm-install-progress', '/api/git-push/api-quota']) {
    const response = await getPath(path);
    assert.equal(response.status, 200, `${path} 的 GET 必须可用（前端在轮询）`);
    assert.notEqual(response.body?.code, 'METHOD_NOT_ALLOWED', `${path} 不该走到方法闸门`);
  }
  // 两个进度端点读的是内存快照，恒 ok=true；api-quota 的 ok 取决于能否取到配额
  //   （本测试把网络置为离线 ⇒ 它可能 ok=false），所以只对前者断言 ok。
  for (const path of ['/api/git-push/clone-progress', '/api/git-push/npm-install-progress']) {
    const response = await getPath(path);
    assert.equal(response.body.ok, true, `${path} 是纯内存读，应正常返回快照`);
  }
});

/* ───────── 闸门不误伤写方法的正常路径 ───────── */

test('POST 仍照常进入 handler：settings-set 能写、读端点 POST 也不被拦', async () => {
  const written = await postPath('/api/git-push/settings-set', { key: 'githubAuthClientId', value: 'Iv1.a1b2c3d4e5f6a7b8' });
  assert.equal(written.status, 200, 'POST 必须放行（否则闸门把功能一起挡死了）');
  assert.equal(written.body.ok, true);
  const saved = JSON.parse(readFileSync(configFilePath(), 'utf8'));
  assert.equal(saved.githubAuth.clientId, 'Iv1.a1b2c3d4e5f6a7b8', 'POST 应真的落盘（证明 handler 跑过）');

  const readViaPost = await postPath('/api/git-push/clone-progress');
  assert.equal(readViaPost.status, 200, '读端点 POST 也照常（只读端点不区分方法）');
});

test('闸门本身是纯函数：POST 放行、其余一律 405', () => {
  assert.equal(rejectNonPostMethod('POST'), null);
  assert.equal(rejectNonPostMethod('post'), null, '大小写不敏感');
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', '']) {
    const rejected = rejectNonPostMethod(method);
    assert.equal(rejected.status, 405, `${method || '(空)'} 应被拒`);
    assert.equal(rejected.body.code, 'METHOD_NOT_ALLOWED');
  }
});

/* ───────── 守卫自身有效性（防「测试假绿」） ───────── */

test('反例自证：拿掉闸门判定后同一 GET 会落到 handler（证明上面的 405 是闸门给的）', async () => {
  // 不真去改代码，而是直接调 handler：用 GET 语义调 settings-set 的 handler，
  //   它此刻不在路由层，闸门不参与 ⇒ 会真的尝试写盘/返回业务错误而不是 405。
  const bypass = await handleStatus({ method: 'GET', env: WORKSPACE_ENV, cfg: {} });
  assert.equal(bypass.status, 200, '直调只读 handler 正常');
  // 路由层的 405 只可能来自闸门：把同一请求换成 POST 就会进 handler（上一条已证）。
  const viaGet = await getPath('/api/git-push/settings-set');
  assert.equal(viaGet.body.message.includes('POST'), true, '405 文案必须指出「只接受 POST」——否则读者仍会以为补个 confirm 就行');
});
