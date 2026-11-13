/**
 * test-clone-mirror.mjs —— 同族测试合并（test-clone-mirror-truncation.mjs · test-clone-preview-buttons.mjs · test-clone-maxfilemb.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { downloadBlobs, PARTS_DIR } from '../../lib/git/clone-download.js';
import { resolveMaxCloneFileMB } from '../../lib/git/index.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// ── 原 test-clone-mirror-truncation.mjs ──
{
  /**
   * 镜像坏缓存（截断响应）防御回归（2026-10-31 实测事故）。
   *
   * 事故：某镜像对一个 8MB 文件返回 total=590454 的截断资源（content-range 尾段），
   *   带 Range 续传时每轮「已到该源 total、无法增长」⇒ 长度校验永远失败、
   *   分片停在半截、clone 每轮死在同一文件（用户判定「没有续传」，实际是续传被坏镜像卡死）。
   *
   * 锁三件事：
   *   ① 坏镜像的截断字节**绝不能写进 .part**（脏数据拼接永远凑不出正确文件）；
   *   ② 声明总长与仓库记录不符 ⇒ 自动换候选通道（api 直连） rescue 成功；
   *   ③ 所有通道都异常 ⇒ 本轮判失败但分片保留（下轮重试），不是无限静默循环。
   */


  const SIZE = 10000;          // 仓库记录的期望大小
  const TRUNC = 5904;          // 坏镜像声明的（截断）总长
  /** 按 URL 判定通道并返回可控响应：raw=坏镜像（total 截断），api=正常全量。 */
  function stubChannels({ rawBroken = true, apiBroken = false } = {}) {
    const orig = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      seen.push({ u, range: opts?.headers?.Range || null });
      const isRaw = u.includes('raw.githubusercontent.com');
      if (isRaw && rawBroken) {
        // 206（带 Range 续传请求时）/ 200（无 Range）：该源声明 total 恒为截断值
        const rangeReq = Boolean(opts?.headers?.Range);
        const body = 'x'.repeat(TRUNC - 100);
        return new Response(rangeReq ? Buffer.from(body.slice(100)) : body, {
          status: rangeReq ? 206 : 200,
          headers: rangeReq
            ? { 'content-range': `bytes 100-${TRUNC - 1}/${TRUNC}` }
            : { 'content-length': String(TRUNC - 100) }, // 声明值仍 < SIZE，触发防御
        });
      }
      if (isRaw) { // raw 正常：全量
        return new Response('r'.repeat(SIZE), { status: 200 });
      }
      if (apiBroken) { // api 也坏：total 同样对不上
        return new Response('a'.repeat(TRUNC), { status: 200, headers: { 'content-length': String(TRUNC) } });
      }
      return new Response(API_CONTENT, { status: 200 }); // api 正常：完整内容
    };
    return { restore: () => { globalThis.fetch = orig; }, seen };
  }

  // git blob 哈希（与 clone-download 增量校验同口径）：桩内容必须算得出匹配 sha，
  //   否则测到的是「sha 校验必挂」而不是 rescue 路径本身
  function blobSha(content, size) {
    return createHash('sha1').update(`blob ${size}\u0000`, 'latin1').update(content, 'utf8').digest('hex');
  }
  const API_CONTENT = 'A'.repeat(SIZE);                       // api 通道的完整内容
  const RAW_SUFFIX = 'r'.repeat(SIZE - 3300);                  // raw 续传通道返回的部分
  const blob = { path: 'big.json', size: SIZE, sha: blobSha(API_CONTENT, SIZE), mode: '100644' };

  function newDir() { return mkdtempSync(join(tmpdir(), 'dshgp-trunc-')); }
  function partOf(dir) { return join(dir, PARTS_DIR, `${blob.sha}.part`); }

  test('[clone-mirror-truncation] 分片已有半截 + 镜像截断 → 自动退 api 通道完成，内容全部来自 api（脏字节不拼接）', async () => {
    const dir = newDir();
    const { restore, seen } = stubChannels();
    try {
      mkdirSync(join(dir, PARTS_DIR), { recursive: true });
      writeFileSync(partOf(dir), 'x'.repeat(3300)); // 模拟上轮残留（脏半截）
      const r = await downloadBlobs({
        blobs: [blob], targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 1,
      });
      assert.equal(r.failed.length, 0, `应经 api 通道 rescue 成功：${JSON.stringify(r.failed)}`);
      const got = readFileSync(join(dir, 'big.json'), 'utf8');
      assert.equal(got.length, SIZE);
      assert.match(got, /^A+$/, '内容必须全部来自 api 通道——坏镜像的 x 字节混进来就是脏文件');
      const rawReq = seen.find((s) => s.u.includes('raw.githubusercontent.com'));
      assert.ok(rawReq, '先试过 raw（have>0 优先 Range 续传）');
    } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('[clone-mirror-truncation] 无分片起步 + 镜像截断 → api rescue 成功，.part 不落入截断字节', async () => {
    const dir = newDir();
    const { restore } = stubChannels();
    try {
      const r = await downloadBlobs({
        blobs: [blob], targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 1,
      });
      assert.equal(r.failed.length, 0, `应 rescue 成功：${JSON.stringify(r.failed)}`);
      assert.match(readFileSync(join(dir, 'big.json'), 'utf8'), /^A+$/);
    } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('[clone-mirror-truncation] 所有通道都截断 → 本轮判失败，错误点明「疑似代理截断缓存」，半截分片保留未污染', async () => {
    const dir = newDir();
    const { restore } = stubChannels({ apiBroken: true });
    try {
      mkdirSync(join(dir, PARTS_DIR), { recursive: true });
      writeFileSync(partOf(dir), 'x'.repeat(3300));
      const r = await downloadBlobs({
        blobs: [blob], targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 1,
      });
      assert.equal(r.failed.length, 1, '两通道 total 都不符 → 必须报失败（不能假成功）');
      assert.match(r.failed[0].reason, /截断|数据异常/, `错误要能指根因：${r.failed[0].reason}`);
      assert.equal(existsSync(partOf(dir)), true, '分片保留供下轮重试');
      assert.equal(readFileSync(partOf(dir), 'utf8').length, 3300, '分片字节数不变 = 截断内容没被拼进去');
    } finally { restore(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('[clone-mirror-truncation] 镜像正常（total 相符）→ 走 raw 续传路径不受本次改动影响', async () => {
    const dir = newDir();
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const rangeReq = Boolean(opts?.headers?.Range);
      if (String(url).includes('raw.githubusercontent.com')) {
        return new Response(RAW_SUFFIX, {
          status: rangeReq ? 206 : 200,
          headers: { 'content-range': `bytes 3300-${SIZE - 1}/${SIZE}` },
        });
      }
      return new Response('A'.repeat(SIZE), { status: 200 });
    };
    try {
      mkdirSync(join(dir, PARTS_DIR), { recursive: true });
      const joined = 'x'.repeat(3300) + RAW_SUFFIX;
      const shaJoined = blobSha(joined, SIZE);
      // 分片文件名是 <entry.sha>.part —— 预置前缀必须落在实际传入的那个 sha 上
      writeFileSync(join(dir, PARTS_DIR, `${shaJoined}.part`), 'x'.repeat(3300)); // 半截是真·前缀，拼接后恰等于预期内容
      const r = await downloadBlobs({
        blobs: [{ ...blob, sha: shaJoined }], targetDir: dir, owner: 'o', repo: 'r', branch: 'main', concurrency: 1,
      });
      assert.equal(r.failed.length, 0, `total 相符应照常续传成功：${JSON.stringify(r.failed)}`);
      assert.equal(readFileSync(join(dir, 'big.json'), 'utf8').length, SIZE, '续传拼接后长度正确');
    } finally { globalThis.fetch = orig; rmSync(dir, { recursive: true, force: true }); }
  });
}

// ── 原 test-clone-preview-buttons.mjs ──
{
  /**
   * clone 预览确认框按钮可点。
   *
   * 现象：点「开始克隆」「取消」都没反应。
   * 根因：调用点写成 `dshgp_ClonePreview({ ..., onConfirm: () => { void this.cloneConfirmed(); },
   *   onCancel: () => { this.clonePreview = null; this.publish(); } })`，但所在组件
   *   `dshgp_RepoCloudPane(props)` 是**普通函数**、函数体内没有 this（ESM 严格模式下为 undefined），
   *   ESM 严格模式下 `this` 为 undefined → 点击抛 TypeError → 表现为「没反应」。
   *   且 props 里从未组装 cloneConfirmed / cancelPreview 两个入口。
   *
   * 验证方式：从源码提取真实的 dshgp_ClonePreview 与 dshgp_RepoCloudPane 函数体，
   *   用最小 jsx 替身**实际渲染**，再在渲染出的节点树里找到两个按钮并**真的调用其 onClick**，
   *   断言回调被触发（结构级 + 行为级，不是字符串匹配）。
   */

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const clientSrc = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');

  /** 记录式 jsx 替身（jsx-runtime 形状：children 在 props.children）。 */
  function makeJsx() {
    const createElement = (type, props) => {
      const kids = props && props.children !== undefined
        ? (Array.isArray(props.children) ? props.children : [props.children])
        : [];
      return { type, props: props || {}, children: kids.flat(Infinity).filter((c) => c !== null && c !== undefined) };
    };
    return { jsx: createElement, jsxs: createElement };
  }

  /** 从源码按大括号配平提取函数体文本。 */
  function extractFunction(src, signature) {
    const start = src.indexOf(signature);
    assert.ok(start >= 0, `未找到函数: ${signature}`);
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    throw new Error('函数体未闭合: ' + signature);
  }

  /** 深度遍历节点树。 */
  function walk(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    out.push(node);
    for (const c of node.children || []) walk(c, out);
    return out;
  }

  /** 渲染 clone 预览框，返回节点树。 */
  function renderPreview(handlers = {}) {
    const fnText = extractFunction(clientSrc, 'function dshgp_ClonePreview(props) {');
    const jsx = makeJsx();
    const dshgp_ClonePreview = new Function('jsx', 'return ' + fnText)(jsx);
    const tree = dshgp_ClonePreview({
      p: { repo: 'EIGHTfs/dsh-skill-scoreboard', branch: 'master', downloadCount: 26, downloadBytes: 2.0 * 1024 * 1024, skippedCount: 0, skipped: [] },
      onConfirm: handlers.onConfirm,
      onCancel: handlers.onCancel,
    });
    return { tree, nodes: walk(tree) };
  }

  test('[clone-preview-buttons] clone 预览框：两个按钮都渲染出来且都带 onClick', () => {
    const { nodes } = renderPreview({ onConfirm: () => {}, onCancel: () => {} });
    const btns = nodes.filter((n) => n.type === 'button');
    assert.equal(btns.length, 2, '预览框应有「开始克隆」「取消」两个按钮');
    assert.equal(btns[0].props.children, '开始克隆');
    assert.equal(btns[1].props.children, '取消');
    for (const b of btns) assert.equal(typeof b.props.onClick, 'function', `${b.props.children} 必须绑定 onClick`);
  });

  test('[clone-preview-buttons] clone 预览框：点「开始克隆」真的触发 onConfirm', () => {
    let confirmed = 0;
    const { nodes } = renderPreview({ onConfirm: () => { confirmed += 1; }, onCancel: () => {} });
    const btn = nodes.find((n) => n.type === 'button' && n.props.children === '开始克隆');
    assert.ok(btn, '应有「开始克隆」按钮');
    btn.props.onClick(); // 真点
    assert.equal(confirmed, 1, '点「开始克隆」必须触发 onConfirm');
  });

  test('[clone-preview-buttons] clone 预览框：点「取消」真的触发 onCancel', () => {
    let canceled = 0;
    const { nodes } = renderPreview({ onConfirm: () => {}, onCancel: () => { canceled += 1; } });
    const btn = nodes.find((n) => n.type === 'button' && n.props.children === '取消');
    assert.ok(btn, '应有「取消」按钮');
    btn.props.onClick();
    assert.equal(canceled, 1, '点「取消」必须触发 onCancel');
  });

  test('[clone-preview-buttons] clone 预览框：回调缺失时点击不抛错（防御性）', () => {
    const { nodes } = renderPreview({});
    const btns = nodes.filter((n) => n.type === 'button');
    // 传了 undefined 的 onClick，React 下等于没绑，不应在渲染期抛错
    for (const b of btns) assert.ok(b.props.onClick === undefined || typeof b.props.onClick === 'function');
  });

  test('[clone-preview-buttons] 调用点：dshgp_ClonePreview 的动作必须走 props，不得用 this', () => {
    const callIdx = clientSrc.indexOf('dshgp_ClonePreview({ p: s.clonePreview');
    assert.ok(callIdx > 0, '未找到调用点');
    const seg = clientSrc.slice(callIdx, callIdx + 320);
    assert.ok(!/\bthis\./.test(seg), '调用点不得出现 this（所在组件是普通函数，无 this）');
    assert.ok(/props\.cloneConfirmed\(\)/.test(seg), '确认动作应调 props.cloneConfirmed');
    assert.ok(/props\.cancelPreview\(\)/.test(seg), '取消动作应调 props.cancelPreview');
  });

  test('[clone-preview-buttons] 承接组件 dshgp_RepoCloudPane 函数体内不得出现 this（除注释）', () => {
    const fnText = extractFunction(clientSrc, 'function dshgp_RepoCloudPane(props) {');
    // 去掉注释再判，避免注释里提到 this 造成误报
    const noComment = fnText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!/\bthis\./.test(noComment), 'dshgp_RepoCloudPane 是普通函数组件，函数体内不得出现 this');
  });

  test('[clone-preview-buttons] props 组装：cloneConfirmed 与 cancelPreview 两个入口都已接线', () => {
    assert.ok(/cloneConfirmed: \(\) => \{ void this\.cloneConfirmed\(\); \}/.test(clientSrc), 'props 应含 cloneConfirmed');
    assert.ok(/cancelPreview: \(\) => \{ this\.cancelPreview\(\); \}/.test(clientSrc), 'props 应含 cancelPreview');
    assert.ok(/^\s{6}cancelPreview\(\) \{/m.test(clientSrc), 'Controller 应有 cancelPreview 方法');
  });

  test('[clone-preview-buttons] 取消语义：cancelPreview 同时清预览态与待办态', () => {
    const m = /\n\s{6}cancelPreview\(\) \{([\s\S]*?)\n\s{6}\}/.exec(clientSrc);
    assert.ok(m, '未找到 cancelPreview 实现');
    const body = m[1];
    assert.ok(/this\.clonePreview = null/.test(body), '应清 clonePreview');
    assert.ok(/this\.clonePending = null/.test(body), '应清 clonePending（否则残留上次目标目录）');
    assert.ok(/this\.publish\(\)/.test(body), '应触发重渲染');
  });
}

// ── 原 test-clone-maxfilemb.mjs ──
{
  // 克隆体积上限「两入口一致」回归：工具路径与 HTTP 路径必须共用同一个默认值。
  //
  // 事故：工具路径把未设值交给 previewClone（落到 50），HTTP 路径自己回落 10
  //   → 同一仓库两个入口克隆结果不同：实测同一仓库工具预览 753 文件 / HTTP 预览 707 文件，
  //   44 个 >10MB 的文件在 HTTP 路径被静默跳过，用户以为克隆完成（实际缺 46 个文件）。


  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  test('[clone-maxfilemb] resolveMaxCloneFileMB：未设/非法回落 schema 默认 10，显式值照用（0 = 不限制）', () => {
    assert.equal(resolveMaxCloneFileMB({}), 10, '未设应回落 schema 默认 10');
    assert.equal(resolveMaxCloneFileMB({ maxCloneFileMB: 50 }), 50, '显式值照用');
    assert.equal(resolveMaxCloneFileMB({ maxCloneFileMB: 0 }), 0, '0 = 不限制，不能被当成未设');
    assert.equal(resolveMaxCloneFileMB({ maxCloneFileMB: 'x' }), 10, '非法值回落默认');
  });

  test('[clone-maxfilemb] 结构契约：工具路径与 HTTP 路径都经统一解析，不得各自写默认值', () => {
    const cases = [
      ['lib/app/tool-call.js', readFileSync(join(ROOT, 'lib/app/tool-call.js'), 'utf8')],
      ['lib/app/handlers/clone.js', readFileSync(join(ROOT, 'lib/app/handlers/clone.js'), 'utf8')],
    ];
    for (const [name, src] of cases) {
      assert.match(src, /resolveMaxCloneFileMB\(/, `${name} 必须走统一解析 resolveMaxCloneFileMB`);
      assert.ok(!/Number\.isFinite\(cfg\.maxCloneFileMB\)\s*\?\s*cfg\.maxCloneFileMB\s*:\s*10/.test(src),
        `${name} 不得自带默认值 10（会与工具路径不一致）`);
      assert.ok(!/maxCloneFileMB\)\s*\|\|\s*undefined/.test(src),
        `${name} 不得把「未设 / 0=不限制」混成 undefined`);
    }
  });
}
