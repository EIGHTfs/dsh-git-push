/**
 * clone 并发与中止（2026-09-18）。
 *
 * 现象（用户实测）：点克隆报「创建目录失败: ENOTEMPTY: directory not empty,
 *   rmdir '.../gallery/.dsh-parts'」，但**报错之后下载仍在继续**：
 *   .dsh-parts 字节数持续增长、文件句柄不释放，而任务状态已是 done。
 *
 * 根因（三段串起来）：
 *   ① 无并发互斥——clone-jobs 注释写着「单任务模型」，但 startCloneJob 直接覆盖
 *      current，第二次 clone 能与第一次并存；
 *   ② 清理目录时第一次的 worker 仍在写——rm 先 readdir 再逐个删、最后 rmdir，
 *      边删边写就会「readdir 时已删完、rmdir 时服务端又有新条目」→ ENOTEMPTY；
 *   ③ 失败返回后无人中止 worker——downloadBlobs 的 worker 循环没有中止检查点，
 *      于是任务已判失败、下载仍跑完剩余全部文件（孤儿协程）。
 *
 * 验证：互斥/中止用行为断言；removeDirForce 用真实 CIFS 上的**并发写入**场景，
 *   且与 rmSync 做对照（同条件下 rmSync 失败、removeDirForce 成功）。
 *   CIFS 用例在非 CIFS 环境自动跳过（rmSync 本就成功，无从对照）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, createWriteStream, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  startCloneJob, finishCloneJob, cloneAbortSignal, abortCloneJob,
  isCloneInFlight, cloneLogs, __resetCloneJobs,
} from '../lib/git/clone-jobs.js';
import { removeDirForce, downloadBlobs } from '../lib/git/clone-download.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- ① 并发互斥 ----------
test('clone 互斥：已有任务在跑时拒绝新任务，而不是覆盖', () => {
  __resetCloneJobs();
  const a = startCloneJob({ target: 'o/a', dest: '/tmp/dest-a', totalFiles: 2, totalBytes: 100 });
  assert.equal(a.ok, true, '首个任务应可启动');

  const b = startCloneJob({ target: 'o/b', dest: '/tmp/dest-b', totalFiles: 3, totalBytes: 200 });
  assert.equal(b.ok, false, '第二个任务必须被拒绝（原实现在此覆盖 current）');
  assert.equal(b.reason, 'busy');
  assert.equal(b.running.dest, '/tmp/dest-a', '应回传正在跑的目录，供前端如实提示');

  // 被拒绝的任务不得污染 running 状态
  finishCloneJob({ ok: false, error: 'x' });
  __resetCloneJobs();
});

test('clone 互斥：任务结束后释放，不会永久锁死', () => {
  __resetCloneJobs();
  startCloneJob({ target: 'o/a', dest: '/tmp/dest-a', totalFiles: 1, totalBytes: 1 });
  assert.equal(isCloneInFlight('/tmp/dest-a'), true);
  finishCloneJob({ ok: true });
  assert.equal(isCloneInFlight('/tmp/dest-a'), false, '结束后必须释放 in-flight，否则后续 clone 全被拒');
  const again = startCloneJob({ target: 'o/a', dest: '/tmp/dest-a', totalFiles: 1, totalBytes: 1 });
  assert.equal(again.ok, true, '结束后应能再次启动');
  finishCloneJob({ ok: true });
  __resetCloneJobs();
});

// ---------- ② 中止 ----------
test('clone 中止：已在 abort 状态时 worker 一个都不领（确定性，不依赖网络）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clone-abort-'));
  const ctrl = new AbortController();
  ctrl.abort();   // 进入前就已中止
  const blobs = Array.from({ length: 30 }, (_, i) => ({ path: `f${i}.bin`, sha: `s${i}`, size: 1024, mode: '100644' }));
  const r = await downloadBlobs({
    blobs, targetDir: dir, owner: 'x', repo: 'y', branch: 'main', token: 'bad',
    concurrency: 4, signal: ctrl.signal,
  });
  assert.equal(r.failed?.length || 0, 0,
    '已中止时 worker 必须一个任务都不领取（原实现无检查点，会跑完全部）');
  assert.equal(r.files?.length || 0, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('clone 中止：运行中 abort 能提前退出（不跑完剩余文件）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'clone-abort2-'));
  const ctrl = new AbortController();
  const blobs = Array.from({ length: 200 }, (_, i) => ({ path: `f${i}.bin`, sha: `s${i}`, size: 1024, mode: '100644' }));
  const p = downloadBlobs({
    blobs, targetDir: dir, owner: 'x', repo: 'y', branch: 'main', token: 'bad',
    concurrency: 4, signal: ctrl.signal,
  });
  setTimeout(() => ctrl.abort(), 120);
  const r = await p;
  assert.equal(ctrl.signal.aborted, true);
  // 不依赖具体秒数：只要求「远少于全部」——给了 200 个文件，中止后不该跑完
  assert.ok((r.failed?.length || 0) < 200,
    `中止后不应跑完全部 200 个（实际 ${r.failed?.length}）——这正是孤儿的成因`);
  rmSync(dir, { recursive: true, force: true });
});

test('clone 中止：任务持有 signal，结束后不残留', () => {
  __resetCloneJobs();
  startCloneJob({ target: 'o/a', dest: '/tmp/dest-a', totalFiles: 1, totalBytes: 1 });
  const sig = cloneAbortSignal();
  assert.ok(sig, '运行中的任务应持有 signal');
  assert.equal(sig.aborted, false);
  assert.equal(abortCloneJob('test'), true);
  assert.equal(sig.aborted, true, 'abort 后 signal 必须置为 aborted');

  finishCloneJob({ ok: false, error: 'aborted' });
  assert.equal(cloneAbortSignal(), null, '任务结束后不应残留 signal');
  __resetCloneJobs();
});

// ---------- ③ 清理健壮性 ----------
test('removeDirForce：多级目录可删，且对不存在的目录幂等返回 true', async () => {
  const d = mkdtempSync(join(tmpdir(), 'rmforce-'));
  mkdirSync(join(d, 'sub'), { recursive: true });
  writeFileSync(join(d, 'a.txt'), 'x');
  writeFileSync(join(d, 'sub', 'b.txt'), 'y');
  assert.equal(await removeDirForce(d), true);
  assert.equal(existsSync(d), false);
  // 幂等：已删除的目录再删一次也应报成功（调用方不必先判存在）
  assert.equal(await removeDirForce(join(d, 'never-existed')), true);
});

test('removeDirForce：并发写入下仍能删掉（rmSync 会 ENOTEMPTY）', async (t) => {
  // 复现用户现场：多个大文件流并发追加写 .part，同时删目录。
  //   仅在 CIFS（actimeo=1、服务端无原子目录语义）上 rmSync 才会失败；
  //   本地 tmpfs 上两者都成功，故先探测环境，非 CIFS 直接跳过（避免假绿）。
  // 允许指定落点：CIFS 环境把 DSH_TEST_CIFS_DIR 指向工作区，即可真正跑到
  //   会复现 ENOTEMPTY 的文件系统上（/tmp 多为本地盘，复现不出来）。
  const baseDir = process.env.DSH_TEST_CIFS_DIR || tmpdir();
  const probe = async (useNew) => {
    const d = mkdtempSync(join(baseDir, 'conc-'));
    const streams = [];
    for (let i = 0; i < 4; i += 1) streams.push(createWriteStream(join(d, `big${i}.part`), { flags: 'a' }));
    let writing = true;
    const writer = (async () => {
      const buf = Buffer.alloc(65536);
      while (writing) {
        for (const s of streams) { try { s.write(buf); } catch { /* 流已关 */ } }
        await new Promise((r) => setTimeout(r, 2));
      }
    })();
    await new Promise((r) => setTimeout(r, 600));
    let err = '';
    try {
      if (useNew) await removeDirForce(d);
      else rmSync(d, { recursive: true, force: true });
    } catch (e) { err = e.code || String(e); }
    writing = false;
    await writer;
    for (const s of streams) { try { s.end(); } catch { /* 已关 */ } }
    await new Promise((r) => setTimeout(r, 150));
    try { rmSync(d, { recursive: true, force: true }); } catch { /* 收尾 */ }
    return err;
  };

  const oldErr = await probe(false);
  if (oldErr !== 'ENOTEMPTY') {
    t.skip(`本环境 rmSync 未复现 ENOTEMPTY（${oldErr || '成功'}），跳过对照`);
    return;
  }
  const newErr = await probe(true);
  assert.equal(newErr, '',
    'removeDirForce 在 rmSync 会 ENOTEMPTY 的同一场景下必须成功——这是修复的核心');
});

// ---------- 日志 ----------
test('clone 日志：start/refuse/abort/finish 都有结构化记录', () => {
  __resetCloneJobs();
  startCloneJob({ target: 'o/a', dest: '/tmp/log-a', totalFiles: 1, totalBytes: 1 });
  startCloneJob({ target: 'o/b', dest: '/tmp/log-b', totalFiles: 1, totalBytes: 1 });   // refuse
  abortCloneJob('test');                                                               // abort
  finishCloneJob({ ok: false, error: 'test' });                                        // finish-fail

  const logs = cloneLogs(50);
  const events = logs.map((l) => l.event);
  for (const want of ['start', 'refuse', 'abort', 'finish-fail']) {
    assert.ok(events.includes(want), `应记录 ${want} 事件（实际：${events.join(',')}）`);
  }
  assert.ok(logs.every((l) => l.at && l.event), '每条日志都应有 at/event');
  __resetCloneJobs();
});

// ---------- 架构不变量 ----------
test('downloadBlobs 的 worker 必须检查中止（回归：孤儿协程的来源）', () => {
  const src = readFileSync(join(ROOT, 'lib/git/clone-download.js'), 'utf8');
  const worker = src.slice(src.indexOf('const worker = async () => {'), src.indexOf('await Promise.all'));
  assert.match(worker, /signal\?\.aborted/, 'worker 领取任务前必须检查 signal.aborted，否则 abort 后仍会跑完全部');
});

// ---------- 端到端：走真实 HTTP 分发层 ----------
test('HTTP 端到端：占用中再发 clone 请求回 409（而非并发跑第二个）', async () => {
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const { defaultConfig } = await import('../lib/client/index.js');
  __resetCloneJobs();

  // 分发层读顶层 req.origin（不是 headers.origin）；写操作还需 confirm:true
  const call = (url, body = {}, method = 'POST') => handleHttp(
    {
      method, url, body, origin: 'http://127.0.0.1:30801',
      headers: { host: '127.0.0.1:30801', 'content-length': '0' },
    },
    { workspaceRoot: ROOT }, defaultConfig(),
  );
  const READ = (url, body = {}) => call(url, body, 'GET');

  // 新端点可用
  const logs = await READ('/api/git-push/clone-logs');
  assert.equal(logs.status, 200);
  assert.ok(Array.isArray(logs.body?.logs), 'clone-logs 应返回 logs 数组');

  // 空闲时 abort 安全
  const ab = await call('/api/git-push/clone-abort', { confirm: true });
  assert.equal(ab.status, 200);
  assert.equal(ab.body?.aborted, false, '无任务时不应误报已中止');

  // 占用中：clone 请求必须被 409 拒绝，而不是与在跑的任务并存
  startCloneJob({ target: 'fake/repo', dest: '/tmp/fake-dest', totalFiles: 1, totalBytes: 1 });
  const r = await call('/api/git-push/repo-clone', { target: 'EIGHTfs/gallery', dir: '/tmp', confirm: true });
  assert.equal(r.status, 409, `占用中应回 409（实际 ${r.status}）`);
  assert.equal(r.body?.cause, 'busy');
  assert.equal(r.body?.retriable, false, '重试无用，必须如实标为不可重试');
  assert.match(r.body?.error || '', /已有克隆/, '文案应说清是「已有克隆在跑」');

  // 拒绝必须留痕，便于事后排查
  const after = await READ('/api/git-push/clone-logs');
  const evts = (after.body?.logs || []).map((l) => l.event);
  assert.ok(evts.includes('refuse'), `日志应含 refuse（实际 ${evts.join(',')}）`);

  finishCloneJob({ ok: false, error: 'test' });
  __resetCloneJobs();
});

// ---------- 失败路径：保留已下文件（不再删掉整个目标目录） ----------
test('clone 失败路径：不得删除目标目录（实测 gallery 曾因此整个消失）', () => {
  const src = readFileSync(join(ROOT, 'lib/git/clone.js'), 'utf8');
  // 失败分支（failed.length > 0）里不得出现删目录调用
  const idx = src.indexOf('if (failed.length > 0) {');
  assert.ok(idx > 0, '应存在失败分支');
  // 按**大括号配对**取失败分支的精确范围（固定字符窗口会越过分支、
  //   把后面 cleanupPartial 的函数定义也算进来 → 误报）。
  const start = src.indexOf('{', idx);
  let depth = 0, end = start;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  const raw = src.slice(idx, end);
  // 剔除注释（行注释与块注释）后再断言：注释里提到的函数名是解释历史，不是调用
  const branch = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(branch.length > 100, '失败分支范围提取失败');
  assert.doesNotMatch(branch, /cleanupPartial\s*\(/,
    '失败分支不得调用 cleanupPartial——它递归删除整个目标目录，已实测造成 104MB 内容丢失');
  assert.doesNotMatch(branch, /removeDirForce\s*\(/,
    '失败分支不得删除目标目录：应保留已下文件以便续传');
  assert.match(branch, /kept: true/, '应显式标记「已保留」而非「已清理」');
  assert.match(branch, /resumable: true/, '应显式标记可续传');
});

test('clone 失败路径：不落 .git，故不会被误判为完整仓库', () => {
  const src = readFileSync(join(ROOT, 'lib/git/clone.js'), 'utf8');
  const dlIdx = src.indexOf('await downloadBlobs(');
  const failIdx = src.indexOf('if (failed.length > 0) {');
  const gitIdx = src.indexOf("['init', '-q']");
  assert.ok(dlIdx > 0 && failIdx > 0 && gitIdx > 0);
  // 失败判断必须早于 git init：否则失败目录里会有 .git，下次会被当成完整仓库
  assert.ok(failIdx < gitIdx, '失败分支必须位于 git init 之前（否则保留的目录会带 .git）');
});

test('clone 残留清理：只删 .dsh-parts，不得删掉整个目标目录', () => {
  const src = readFileSync(join(ROOT, 'lib/git/clone.js'), 'utf8');
  // cloneViaApi 主路径内不得对整个 targetDir 做递归删除。
  //   注意：cleanupPartial(dir) 是**当前无调用者**的兜底函数，其形参 `dir` 不在此限，
  //   故只检查 cloneViaApi 函数体范围。
  const fnStart = src.indexOf('export async function cloneViaApi');
  // 结束于下一个**顶层函数声明**（行首的 function/async function/export function）；
  //   原来用 indexOf('\nfunction ') 会因缩进/导出形式不同而失配 → 截到文件尾，误报。
  const tail = src.slice(fnStart + 10);
  const m = tail.match(/\n(?:export )?(?:async )?function /);
  const fnEnd = m ? fnStart + 10 + m.index : src.length;
  const body = src.slice(fnStart, fnEnd)
    .replace(/\/\*[\s\S]*?\*\//g, '')                       // 去块注释
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');  // 去行注释
  assert.doesNotMatch(body, /removeDirForce\(\s*targetDir\s*\)/,
    'cloneViaApi 内不得对 targetDir 做递归删除——已实测导致 gallery 连同 104MB 内容消失');
  assert.doesNotMatch(body, /rmSync\(\s*targetDir\s*,/,
    'cloneViaApi 内不得对 targetDir 做 rmSync');
  // 清理的对象应是分片目录
  assert.match(src, /removeDirForce\(partsPath\)/,
    '残留清理应只针对 .dsh-parts 分片目录，保留已下好的文件以便续传');
});

test('clone 续传安全性：最终文件必完整（写 .part → 校验长度 → rename）', () => {
  const src = readFileSync(join(ROOT, 'lib/git/clone-download.js'), 'utf8');
  // 取 pipeline 写完之后的这一段（写盘→校验→rename），检查三者的相对顺序。
  //   只比较「第一个 rename」是不够的：在长度校验前另插一个 rename 也能骗过它。
  const pipeIdx = src.indexOf('await pipeline(src, ws)');
  assert.ok(pipeIdx > 0, '应存在 pipeline 写盘');
  const seg = src.slice(pipeIdx, pipeIdx + 1200);
  const c = seg.indexOf('长度不符');
  const r = seg.indexOf('await rename(partPath, out)');
  assert.ok(c > 0, '写盘后应有长度校验（长度不符）');
  assert.ok(r > 0, '写盘后应有 rename 到最终路径');
  assert.ok(c < r,
    '长度校验必须早于 rename——否则残缺文件会被改名成最终名，'
    + '而「保留已下文件续传」正是建立在「最终路径上的文件必完整」之上');
  // 反向兜底：写盘段内不得出现「先 rename 后校验」的顺序
  assert.ok(seg.indexOf('rename(partPath, out)') >= c - 200,
    '不得在长度校验之前 rename');
});

test('clone 续传：已下完的最终文件必须复用，不得重下', () => {
  const src = readFileSync(join(ROOT, 'lib/git/clone-download.js'), 'utf8');
  const fnStart = src.indexOf('async function fetchToFile');
  assert.ok(fnStart > 0, '应存在 fetchToFile');
  // 取到**下一个顶层函数**为止，而不是写死字符数：
  //   写死 2000 时，函数体内新增任何逻辑（如 2026-09-19 的 api/raw 双通道选路）
  //   都会把 'await fetch(' 推出窗口，导致本测试「因功能变长而失败」——测的是
  //   代码长度而非复用语义，属脆弱断言。按函数边界截取才对准被测语义。
  const nextFn = src.indexOf('\nasync function ', fnStart + 1);
  const body = src.slice(fnStart, nextFn > 0 ? nextFn : fnStart + 6000);
  // 必须在开头就有「最终文件已完整则复用」的早返回；
  //   若只认 .part 分片，失败清理删掉 .dsh-parts 后保留的文件会被重下，
  //   「保留已下文件」的收益归零（实测 gallery 153.8MB 重下一遍）。
  assert.match(body, /existsSync\(out\)/,
    'fetchToFile 必须检查最终文件 out 是否存在');
  assert.match(body, /haveFinal === size\) return \{ ok: true, reused: true \}/,
    '最终文件长度与远端一致时必须直接复用（早返回），否则会被重下');
  // 复用判定必须在「发起 fetch 请求」之前
  const reuseIdx = body.indexOf('reused: true');
  const fetchIdx = body.indexOf('await fetch(');
  assert.ok(reuseIdx > 0 && fetchIdx > 0 && reuseIdx < fetchIdx,
    '复用判断必须早于网络请求，否则复用没有意义');
});

test('clone 续传：残留清理必须保留 .dsh-parts 分片', () => {
  const src = readFileSync(join(ROOT, 'lib/git/clone.js'), 'utf8');
  // 判据必须**剥掉注释**再匹配：本文件注释里正描述着「原先删分片」这件事，
  //   直接对全文做正则会被自己的说明文字命中，导致测试恒失败（已踩过一次）。
  const code = src.split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
    .join('\n');
  // 绝不能出现「删掉分片目录」的调用：分片是大文件续传的唯一载体，
  //   实测删除它会让 7~15MB 的库每轮从 0 重下、永远下不完（卡在 95/99）。
  assert.ok(!/removeDirForce\(\s*partsPath\s*\)/.test(code),
    '残留清理不得删除 .dsh-parts——分片一旦清掉，大文件续传失效');
  // 分片路径仍须可被识别为「残留」（只含 .dsh-parts 的目录要能自愈重试）
  assert.match(src, /top\.every\(\(n\) => n === PARTS_DIR\)\) isPartialClone = true/,
    '只含 .dsh-parts 的目录必须被识别为可自愈残留，否则用户重试会一直撞「目录非空」');
});

// ---------- 后台 job 化（2026-09-19）：克隆不再阻塞 HTTP 请求 ----------
test('clone 后台化：占用中提交被 409 拒绝（不能因后台化而丢掉互斥）', async () => {
  __resetCloneJobs();
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const { defaultConfig } = await import('../lib/client/index.js');
  const call = (url, body = {}, method = 'POST') => handleHttp(
    {
      method, url, body, origin: 'http://127.0.0.1:30801',
      headers: { host: '127.0.0.1:30801', 'content-length': '0' },
    },
    { workspaceRoot: ROOT }, defaultConfig(),
  );
  // 先占位一个在跑的任务，再提交 → 必须 409（预检/互斥仍同步做，且后台化
  //   不能把互斥挪进后台协程里，否则两个 clone 会真并发写同一目录）
  startCloneJob({ target: 'fake/repo', dest: '/tmp/fake-dest-bg', totalFiles: 1, totalBytes: 1 });
  const r = await call('/api/git-push/repo-clone', { target: 'EIGHTfs/dsh-git-push', dir: '/tmp/x-' + Date.now(), confirm: true });
  assert.equal(r.status, 409, `占用中应回 409（实际 ${r.status}）`);
  assert.equal(r.body?.cause, 'busy');
  assert.equal(r.body?.async, undefined, '被拒时不得冒充已提交后台任务');
  finishCloneJob({ ok: false, error: 'test' });
  __resetCloneJobs();
});

test('clone 后台化：缺 target/dir 仍同步回 400（参数错误不该进后台）', async () => {
  __resetCloneJobs();
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const { defaultConfig } = await import('../lib/client/index.js');
  const call = (url, body = {}) => handleHttp(
    { method: 'POST', url, body, origin: 'http://127.0.0.1:30801', headers: { host: '127.0.0.1:30801' } },
    { workspaceRoot: ROOT }, defaultConfig(),
  );
  const r1 = await call('/api/git-push/repo-clone', { dir: '/tmp', confirm: true });
  assert.equal(r1.status, 400, '缺 target 应 400');
  const r2 = await call('/api/git-push/repo-clone', { target: 'EIGHTfs/dsh-git-push', confirm: true });
  assert.equal(r2.status, 400, '缺 dir 应 400');
  const st = await handleHttp(
    { method: 'POST', url: '/api/git-push/clone-progress', body: {}, origin: 'http://127.0.0.1:30801', headers: { host: '127.0.0.1:30801' } },
    { workspaceRoot: ROOT }, defaultConfig(),
  );
  assert.equal(st.body?.state, 'idle', '参数错误不得留下 running 任务（否则永久占住互斥）');
  __resetCloneJobs();
});

test('clone 后台化：提交成功后 HTTP 立即返回，且不残留未捕获的后台异常', async () => {
  // 这条用**非联网**方式验证契约：后台协程的 .catch 必须存在，否则
  //   异常会绕过 finishCloneJob → current 永不释放 → 之后所有 clone 永久 busy。
  const src = readFileSync(join(ROOT, 'lib/app/http-handlers.js'), 'utf8');
  // 用**括号配对**精确取出承载 cloneViaApi 的那个异步 IIFE，再检查它自己挂了 .catch。
  //   教训：先前写成「端点段内出现 })().catch( 即可」——但该段内还有别的 IIFE（索引回写那条），
  //   于是把 clone 的 .catch 删掉后断言**仍然通过**（反向验证才暴露）。必须绑定到同一个 IIFE。
  const segRaw = src.slice(src.indexOf("'/api/git-push/repo-clone'"), src.indexOf("'/api/git-push/clone-logs'"));
  // 必须**先剥注释**再定位：段内注释里写着「此前这里 await cloneViaApi」，
  //   直接 indexOf 会命中那句注释（实测踩到），从而锚到上一个 IIFE、断言看错对象。
  const seg = segRaw
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 行注释（避开 http:// 里的 //）
  // 段内**有两个** IIFE（① 索引回写 ② clone 后台）。必须锚定②，即
  //   「最后一个位于 await cloneViaApi 之前的 IIFE 起点」。
  const callAt = seg.indexOf('await cloneViaApi');
  assert.ok(callAt > 0, 'repo-clone 内应调用 cloneViaApi');
  const iifeStart = seg.lastIndexOf('(async () => {', callAt);
  assert.ok(iifeStart > 0, 'cloneViaApi 应被异步 IIFE 包裹（后台跑）');
  // 括号配对精确取出该 IIFE 范围，确认 cloneViaApi 真在它体内（而非落在别处）
  let depth = 0, end = -1;
  for (let k = seg.indexOf('{', iifeStart); k < seg.length; k++) {
    const ch = seg[k];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
  }
  assert.ok(end > callAt, 'cloneViaApi 必须落在该异步 IIFE 的体内（否则请求仍被阻塞）');
  const tail = seg.slice(end, end + 20);
  assert.match(tail, /^\}\)\(\)\.catch\(/, `承载 clone 的 IIFE 必须紧接 })().catch(（实际 "${tail.trim()}"）——异常逃逸会让任务永久卡 busy`);
  // 且该 IIFE 体内确实包含 cloneViaApi
  assert.match(seg.slice(iifeStart, end), /cloneViaApi/, '该 IIFE 体内应调用 cloneViaApi');
  assert.match(seg, /status: 202/, '提交成功应回 202（已受理，非 200 已完成）');
  assert.match(seg, /async: true/, '响应体应标 async:true，前端据此转轮询');
  assert.match(seg, /finishCloneJob/, '后台收尾必须调 finishCloneJob 落终态');
  const retAt = seg.indexOf('status: 202');
  assert.ok(retAt > iifeStart, '202 响应应在启动后台 IIFE 之后立即返回');
});

test('clone 后台化：终态可被 clone-progress 取到并 consume（刷新后仍能收敛）', async () => {
  __resetCloneJobs();
  const { handleHttp } = await import('../lib/app/http-handlers.js');
  const { defaultConfig } = await import('../lib/client/index.js');
  const { updateCloneJob } = await import('../lib/git/clone-jobs.js');
  const call = async (body) => (await handleHttp(
    { method: 'POST', url: '/api/git-push/clone-progress', body, origin: 'http://127.0.0.1:30801', headers: { host: '127.0.0.1:30801' } },
    { workspaceRoot: ROOT }, defaultConfig(),
  )).body;
  // running 态
  startCloneJob({ target: 'o/a', dest: '/tmp/term-a', totalFiles: 4, totalBytes: 400 });
  updateCloneJob({ done: 2, transferred: 200, failed: 0 });
  const running = await call({});
  assert.equal(running.state, 'running', '进行中应报 running');
  assert.equal(running.progress.percent, 50, '进度按字节算');
  // 落终态后：不 consume 也能读到（页面刷新后靠这个恢复）
  finishCloneJob({ ok: false, error: '网络中断' });
  const done1 = await call({});
  assert.equal(done1.state, 'done', '结束后应报 done');
  assert.equal(done1.result.ok, false);
  assert.match(done1.result.error, /网络中断/);
  // consume 取走后清空
  const done2 = await call({ consume: true });
  assert.equal(done2.state, 'done', 'consume 那次仍返回终态（先取后清）');
  const idle = await call({});
  assert.equal(idle.state, 'idle', 'consume 之后应回到 idle');
  __resetCloneJobs();
});
