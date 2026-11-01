#!/usr/bin/env node
/**
 * 极简本地 npm registry —— 把本机当成"npm 网站"，用于**发布前彩排**：publish → install → 加载 全链路真跑一遍，
 * 公网零痕迹（不写 registry.npmjs.org）。
 *
 * 为什么自己写而不装 verdaccio：registry 的 publish/install 协议面很小（两个路由 + 一个 tarball 下载），
 *   而 verdaccio 是一个需要安装、有自己配置与存储布局的服务。这里只要能回答三件事就够了：
 *     ① `npm publish` 能不能成功（含版本冲突检测、dist-tags 写入）
 *     ② `npm install <pkg>` 能不能装上（packument + tarball 两个请求）
 *     ③ 装完能不能加载（由调用方继续做 import 验证）
 *   零依赖 → 不污染工作区、不需要 node_modules、随仓库走。
 *
 * 用法：
 *   node scripts/local-registry.mjs --port 4873 [--store /tmp/xxx]     # 前台起服务
 *   node scripts/local-registry.mjs --selftest                          # 起服务→publish→install→退出 全自动验证
 *
 * 路由：
 *   PUT  /:name            npm publish（body 含 _attachments[].data = base64 tarball）
 *   GET  /:name            packument（versions + dist-tags + dist.tarball）
 *   GET  /:name/-/:file    tarball 下载
 *   GET  /-/ping           健康检查（npm ping 用）
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';

/** 内存 + 磁盘双写：packument 放内存，tarball 落盘（便于安装时按路径读）。 */
function createRegistry({ storeDir }) {
  const packuments = new Map();   // name → { 'dist-tags', versions }
  const tarballs = new Map();     // `${name}/${file}` → Buffer
  mkdirSync(storeDir, { recursive: true });

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let buf = Buffer.concat(chunks);
      // npm 可能按配置 gzip 上传
      if (req.headers['content-encoding'] === 'gzip') { try { buf = gunzipSync(buf); } catch { /* 原样尝试 */ } }
      resolve(buf);
    });
    req.on('error', reject);
  });

  const json = (res, code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };

  const UPSTREAM = 'https://registry.npmjs.org';

  /** 未知包的透传代理（GET 只读）。失败原样返回上游状态码，便于排查。 */
  async function proxyToUpstream(req, res) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const upstream = await fetch(`${UPSTREAM}${req.url}`, {
        headers: { accept: String(req.headers.accept || '*/*'), 'user-agent': 'dsh-git-push-local-registry' },
        signal: ctrl.signal,
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'content-length': buf.length,
      });
      return res.end(buf);
    } catch (e) {
      return json(res, 502, { error: `upstream proxy failed: ${String(e?.message || e).slice(0, 200)}` });
    } finally { clearTimeout(timer); }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname);

    if (path === '/-/ping') return json(res, 200, { ok: true });

    // tarball 下载：/<name>/-/<file>
    const tarMatch = /^\/(.+)\/-\/([^/]+)$/.exec(path);
    if (tarMatch && req.method === 'GET') {
      const key = `${tarMatch[1]}/${tarMatch[2]}`;
      const buf = tarballs.get(key);
      if (!buf) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': buf.length });
      return res.end(buf);
    }

    // packument / publish：/<name>（支持 @scope/name 两段）
    const name = path.replace(/^\//, '');
    if (!name) { res.writeHead(404); return res.end('not found'); }

    if (req.method === 'GET') {
      const doc = packuments.get(name);
      if (doc) return json(res, 200, doc);
      // 未知包**透传到公网 registry**（本服务因此等价于「本地镜像站」）：
      //   只存自己发布的包，其余（依赖树）照常从 npmjs 拉——否则 `npm install <pkg>`
      //   会在解析 js-yaml / web-tree-sitter 这些依赖时 404（实测踩过）。
      return proxyToUpstream(req, res);
    }

    if (req.method === 'PUT') {
      let body;
      try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch (e) {
        return json(res, 400, { error: `bad body: ${e.message}` });
      }
      const versions = body.versions || {};
      const versionIds = Object.keys(versions);
      if (!versionIds.length) return json(res, 400, { error: 'no versions' });
      // 版本冲突检测：已存在的版本号不允许重复发布（与真 registry 语义一致）
      const existing = packuments.get(name) || { 'dist-tags': {}, versions: {} };
      for (const v of versionIds) {
        if (existing.versions[v]) return json(res, 403, { error: `cannot publish over existing version ${v}` });
      }
      // 收 tarball
      for (const [file, att] of Object.entries(body._attachments || {})) {
        const buf = Buffer.from(String(att && att.data ? att.data : ''), 'base64');
        tarballs.set(`${name}/${file}`, buf);
        writeFileSync(join(storeDir, file.replace(/[\\/]/g, '_')), buf);
      }
      // 组装 packument（dist.tarball 指向本服务）
      const merged = {
        name,
        'dist-tags': { ...(existing['dist-tags'] || {}), ...(body['dist-tags'] || {}) },
        versions: { ...existing.versions, ...versions },
      };
      for (const v of Object.keys(merged.versions)) {
        const file = `${name}-${v}.tgz`;
        merged.versions[v] = {
          ...merged.versions[v],
          dist: { ...(merged.versions[v].dist || {}), tarball: `http://127.0.0.1:${server.address().port}/${name}/-/${file}` },
        };
        if (!tarballs.has(`${name}/${file}`) && tarballs.has(`${name}/${Object.keys(body._attachments || {})[0]}`)) {
          tarballs.set(`${name}/${file}`, tarballs.get(`${name}/${Object.keys(body._attachments || {})[0]}`));
        }
      }
      packuments.set(name, merged);
      return json(res, 201, { ok: true, name, versions: Object.keys(merged.versions) });
    }

    res.writeHead(405); res.end('method not allowed');
  });

  return { server, packuments, tarballs };
}

/** 起服务并在随机端口上监听。 */
export async function startLocalRegistry({ storeDir, port = 0 } = {}) {
  const dir = storeDir || mkdtempSync(join(tmpdir(), 'dshgp-registry-'));
  const { server, packuments, tarballs } = createRegistry({ storeDir: dir });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actualPort = server.address().port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    storeDir: dir,
    packuments,
    tarballs,
    close: () => new Promise((resolve) => { server.close(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ } resolve(); }); }),
  };
}

/**
 * 异步执行命令（**不能用 spawnSync**）。
 *   为什么：本脚本的 registry 服务与调用方在**同一个进程**里；spawnSync 会阻塞事件循环，
 *   于是 npm 发的 PUT 请求没人处理、而这边又在等 npm 退出 —— 直接死锁（实测 publish 卡住 10 分钟）。
 *   用异步 spawn 让事件循环继续跑，registry 才能应答。
 */
function run(cmd, args, { cwd, env, timeoutMs = 300000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* 已退出 */ } }, timeoutMs);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out, err }); });
  });
}

/** 自测：起服务 → publish 本仓库包 → 从本地 registry 安装 → 加载公开面 → 收尾。 */
async function selftest() {
  // 必须用 fileURLToPath：本仓库路径含中文，URL.pathname 会给出 %E5.. 转义路径，spawn 的 cwd 就不存在
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const reg = await startLocalRegistry();
  console.log(`[registry] ${reg.url}（存储 ${reg.storeDir}）`);
  try {
    const work = mkdtempSync(join(tmpdir(), 'dshgp-regtest-'));
    // 用一个临时 npmrc，把 registry 与假 token 都指到本地（绝对不碰公网）
    writeFileSync(join(work, '.npmrc'), `registry=${reg.url}/\n//127.0.0.1:${reg.port}/:_authToken=local-dummy\n`, 'utf8');
    const env = { ...process.env, npm_config_userconfig: join(work, '.npmrc'), npm_config_registry: `${reg.url}/` };

    console.log('[1/3] npm publish → 本地 registry');
    const npmrc = join(work, '.npmrc');
    writeFileSync(npmrc, `registry=${reg.url}/\n//127.0.0.1:${reg.port}/:_authToken=local-dummy\n`, 'utf8');
    // 必须用 --userconfig 显式指定：只在 env 里给 token 时 npm 仍报 ENEEDAUTH（客户端侧校验）
    const common = ['--registry', `${reg.url}/`, '--userconfig', npmrc];
    const pub = await run('npm', ['publish', ...common, '--tag', 'beta'], { cwd: repo, env, timeoutMs: 180000 });
    console.log('   ', pub.code === 0 ? 'OK' : `FAILED(code=${pub.code} signal=${pub.signal}): ${pub.out.slice(-600)} | ${pub.err.slice(-600)}`);
    if (pub.code !== 0) return 1;

    const consumer = join(work, 'consumer');
    mkdirSync(consumer, { recursive: true });
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true, version: '0.0.0' }, null, 2));
    console.log('[2/3] npm install <pkg> --registry 本地');
    const inst = await run('npm', ['install', 'dsh-git-push@beta', ...common, '--no-audit', '--no-fund'], { cwd: consumer, env, timeoutMs: 300000 });
    console.log('   ', inst.code === 0 ? 'OK' : `FAILED(code=${inst.code}): ${inst.out.slice(-600)} | ${inst.err.slice(-600)}`);
    if (inst.code !== 0) return 1;

    // 顺带校验 packument（相当于「本地 npm 网站上真的能查到这版」）
    const doc = reg.packuments.get('dsh-git-push');
    console.log('   packument: dist-tags =', JSON.stringify(doc && doc['dist-tags']), '| versions =', Object.keys((doc && doc.versions) || {}));
    console.log('[3/3] 加载公开面 + 解析依赖');
    const probe = await run(process.execPath, ['-e', `
      const m = await import('dsh-git-push');
      console.log('   root apply:', typeof m.apply);
      const a = await import('dsh-git-push/audit');
      console.log('   ./audit 导出数:', Object.keys(a).length);
    `, '--input-type=module'], { cwd: consumer, env, timeoutMs: 120000 });
    console.log(probe.out.trim() || `FAILED: ${probe.err.slice(0, 400)}`);
    return probe.code === 0 ? 0 : 1;
  } finally {
    await reg.close();
    console.log('[cleanup] 本地 registry 已停止，临时目录已删除（公网零痕迹）');
  }
}

// 直接运行时：--selftest 跑全链路，否则前台起服务
if (process.argv[1] && process.argv[1].endsWith('local-registry.mjs')) {
  if (process.argv.includes('--selftest')) {
    selftest().then((code) => process.exit(code));
  } else {
    const portArg = process.argv.find((a) => a.startsWith('--port='));
    const port = Number(portArg ? portArg.split('=')[1] : 4873);
    const reg = await startLocalRegistry({ port });
    console.log(`本地 npm registry: ${reg.url}（Ctrl-C 结束）`);
    console.log('用法：npm publish --registry ' + reg.url + '/ --userconfig <含 //127.0.0.1:' + reg.port + '/:_authToken=xxx 的 npmrc>');
    const stop = async () => { await reg.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }
}
