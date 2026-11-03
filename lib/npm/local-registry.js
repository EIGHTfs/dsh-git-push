/**
 * 零依赖本地 npm registry —— 把本机当"npm 网站"，用于**发布前彩排**：
 * publish → install → 加载 全链路真跑一遍，公网零痕迹（不写 registry.npmjs.org）。
 *
 * 为什么自己实现而不装 verdaccio：registry 的发布/安装协议面很小（三条路由），
 *   而 verdaccio 是一个带配置与存储布局的独立服务。这里只要能回答三件事：
 *     ① `npm publish` 能不能成功（含版本冲突 403、dist-tags 写入）
 *     ② `npm install <pkg>` 能不能装上（packument + tarball 两个请求）
 *     ③ 装完能不能加载（由调用方继续 import 公开面）
 *   零依赖 → 随仓库走、不污染 node_modules。
 *
 * 与「发布前冒烟（lib/npm/smoke.js）」的分工：
 *   · 冒烟 = pack → 本地装 tarball → import（4 秒级，验**包内容**）；
 *   · 本地 registry = publish → 从 registry 装 → import（分钟级，验**真实发布/安装语义**：
 *     版本冲突、dist-tags、exports、依赖解析全走真路径）。
 *
 * 两个实现坑（实测踩过，勿改回去）：
 *   ① 调用方与 server 同进程时**必须用异步 spawn**，不能 spawnSync —— 后者阻塞事件循环，
 *      npm 发的 PUT 没人应答、这边又在等 npm 退出 ⇒ 死锁（实测 publish 卡 10 分钟）。
 *   ② npm publish 需要在 `--userconfig` 指定的 npmrc 里写该 registry 的认证令牌；
 *      只在环境变量里给令牌，客户端仍报 ENEEDAUTH。
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';

const UPSTREAM = 'https://registry.npmjs.org';

/** 异步执行命令（见文件头坑①：绝不能用 spawnSync）。 */
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

/**
 * 起一个本地 registry。
 * @param {{storeDir?:string, port?:number}} o
 * @returns {Promise<{url:string, port:number, storeDir:string, packuments:Map, tarballs:Map, close:Function}>}
 */
export async function startLocalRegistry({ storeDir, port = 0 } = {}) {
  const dir = storeDir || mkdtempSync(join(tmpdir(), 'dshgp-registry-'));
  mkdirSync(dir, { recursive: true });
  const packuments = new Map();   // name → { 'dist-tags', versions }
  const tarballs = new Map();     // `${name}/${file}` → Buffer

  const json = (res, code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let buf = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') { try { buf = gunzipSync(buf); } catch { /* 原样解析 */ } }
      resolve(buf);
    });
    req.on('error', reject);
  });

  /** 未知包透传公有 registry（当镜像用；否则装依赖时会 404）。 */
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
    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (path === '/-/ping') return json(res, 200, { ok: true });

    const tarMatch = /^\/(.+)\/-\/([^/]+)$/.exec(path);
    if (tarMatch && req.method === 'GET') {
      const buf = tarballs.get(`${tarMatch[1]}/${tarMatch[2]}`);
      if (!buf) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': buf.length });
      return res.end(buf);
    }

    const name = path.replace(/^\//, '');
    if (!name) { res.writeHead(404); return res.end('not found'); }

    if (req.method === 'GET') {
      const doc = packuments.get(name);
      if (doc) return json(res, 200, doc);
      return proxyToUpstream(req, res);
    }

    if (req.method === 'PUT') {
      let body;
      try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch (e) {
        return json(res, 400, { error: `bad body: ${e.message}` });
      }
      const versions = body.versions || {};
      const vids = Object.keys(versions);
      if (!vids.length) return json(res, 400, { error: 'no versions' });
      const existing = packuments.get(name) || { 'dist-tags': {}, versions: {} };
      for (const v of vids) {
        // 与真 registry 语义一致：同版本号不允许重复发布
        if (existing.versions[v]) return json(res, 403, { error: `cannot publish over existing version ${v}` });
      }
      const atts = Object.entries(body._attachments || {});
      for (const [file, att] of atts) {
        tarballs.set(`${name}/${file}`, Buffer.from(String(att?.data || ''), 'base64'));
      }
      const merged = {
        name,
        'dist-tags': { ...(existing['dist-tags'] || {}), ...(body['dist-tags'] || {}) },
        versions: { ...existing.versions, ...versions },
      };
      for (const v of Object.keys(merged.versions)) {
        const file = `${name}-${v}.tgz`;
        if (!tarballs.has(`${name}/${file}`) && atts.length) tarballs.set(`${name}/${file}`, tarballs.get(`${name}/${atts[0][0]}`));
        merged.versions[v] = {
          ...merged.versions[v],
          dist: { ...(merged.versions[v].dist || {}), tarball: `http://127.0.0.1:${server.address().port}/${name}/-/${file}` },
        };
      }
      packuments.set(name, merged);
      return json(res, 201, { ok: true, name, versions: Object.keys(merged.versions) });
    }

    res.writeHead(405); res.end('method not allowed');
  });

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
    close: () => new Promise((resolve) => {
      server.close(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ } resolve(); });
    }),
  };
}

/**
 * 发布彩排：publish → install → 加载公开面。
 * @param {{dir:string, tag?:string, packageName?:string, entrySpecs?:string[], timeoutMs?:number}} o
 * @returns {Promise<{ok:boolean, steps:object[], failures:string[], packument?:object}>}
 */
export async function runLocalPreview({
  dir, tag = 'beta', packageName = '', entrySpecs = [], bins = [], expectedVersion = '', timeoutMs = 300000,
} = {}) {
  const steps = [];
  const failures = [];
  const reg = await startLocalRegistry();
  let work = '';
  try {
    // 令牌在运行期随机生成：不在仓库里出现任何"像凭据"的字面量
    const token = `local-${randomBytes(8).toString('hex')}`;
    work = mkdtempSync(join(tmpdir(), 'dshgp-preview-'));
    const npmrc = join(work, '.npmrc');
    writeFileSync(npmrc, `registry=${reg.url}/\n//127.0.0.1:${reg.port}/:_authToken=${token}\n`, 'utf8');
    const common = ['--registry', `${reg.url}/`, '--userconfig', npmrc];
    const env = { ...process.env, npm_config_userconfig: npmrc, npm_config_registry: `${reg.url}/` };

    const pub = await run('npm', ['publish', ...common, '--tag', tag], { cwd: dir, env, timeoutMs });
    steps.push({ step: 'publish', ok: pub.code === 0 });
    if (pub.code !== 0) { failures.push(`npm publish（本地）失败：${(pub.err || pub.out).slice(-400)}`); return { ok: false, steps, failures }; }

    const name = packageName || (reg.packuments.keys().next().value || '');
    const doc = reg.packuments.get(name);
    steps.push({ step: 'packument', ok: !!doc, distTags: doc && doc['dist-tags'] });
    if (!doc) { failures.push('本地 registry 没有拿到 packument'); return { ok: false, steps, failures }; }

    const consumer = join(work, 'consumer');
    mkdirSync(consumer, { recursive: true });
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'preview-consumer', private: true, version: '0.0.0' }, null, 2), 'utf8');
    const inst = await run('npm', ['install', `${name}@${tag}`, ...common, '--no-audit', '--no-fund'], { cwd: consumer, env, timeoutMs });
    steps.push({ step: 'install', ok: inst.code === 0 });
    if (inst.code !== 0) { failures.push(`npm install（本地 registry）失败：${(inst.err || inst.out).slice(-400)}`); return { ok: false, steps, failures }; }

    // ① 库入口：按 exports/main 逐个 import
    if (entrySpecs.length) {
      const script = `for (const s of ${JSON.stringify(entrySpecs)}) { await import(s); }\nconsole.log('ok');\n`;
      const probe = await run(process.execPath, ['--input-type=module', '-e', script], { cwd: consumer, env, timeoutMs });
      steps.push({ step: 'import', ok: probe.code === 0, specs: entrySpecs });
      if (probe.code !== 0) failures.push(`从本地 registry 安装后加载失败：${(probe.err || '').slice(0, 400)}`);
    }
    // ② bin 入口：**真跑一次**（纯 CLI 包唯一有效的验证方式）。
    //   为什么不能只 import：纯 CLI 包没有库入口，import 必然失败；而它的真实用法是 `npx <命令>`。
    //   真跑 bin 还能抓到 import 永远测不到的故障：bin 判据用了字面路径、而 npm 装的是符号链接，
    //   导致执行静默 exit 0 且零输出（历史事故形态）。
    for (const b of bins) {
      const binPath = join(consumer, 'node_modules', name, b.path);
      const ver = await run(process.execPath, [binPath, '--version'], { cwd: consumer, env, timeoutMs: 60000 });
      const verOut = `${ver.out || ''}${ver.err || ''}`.trim();
      const verOk = ver.code === 0 && (!expectedVersion || verOut.includes(expectedVersion));
      steps.push({ step: 'bin-version', ok: verOk, bin: b.command, output: verOut.slice(0, 120) });
      if (!verOk) {
        failures.push(`bin「${b.command} --version」未通过（退出码 ${ver.code}${expectedVersion ? `，期望输出含 ${expectedVersion}` : ''}）：${verOut.slice(0, 300) || '(无输出)'}`);
      }
      const help = await run(process.execPath, [binPath, '--help'], { cwd: consumer, env, timeoutMs: 60000 });
      steps.push({ step: 'bin-help', ok: help.code === 0, bin: b.command, code: help.code });
      if (help.code !== 0) failures.push(`bin「${b.command} --help」退出码 ${help.code}（应为 0）`);
    }
    // ③ 既无库入口也无 bin：如实说「无可验证入口」，而不是含糊的「加载失败」
    if (!entrySpecs.length && !bins.length) {
      failures.push('该包既没有库入口（main/exports）也没有 bin——没有任何可验证入口，无法判断安装后是否可用');
    }
    return { ok: failures.length === 0, steps, failures, packument: { name, distTags: doc['dist-tags'], versions: Object.keys(doc.versions || {}) } };
  } catch (e) {
    failures.push(`本地彩排异常：${String(e?.message || e).slice(0, 300)}`);
    return { ok: false, steps, failures };
  } finally {
    await reg.close();
    if (work) { try { rmSync(work, { recursive: true, force: true }); } catch { /* 忽略 */ } }
  }
}
