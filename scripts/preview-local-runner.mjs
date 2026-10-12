#!/usr/bin/env node
/**
 * 预览服务「本地模式」执行器（--local）。
 *
 * 用途：让预览页在**不重启 DSH 宿主**的前提下跑**工作区当前的插件代码**。
 * 做法：预览服务对每个 `/api/git-push/*` 请求 fork 一个本脚本（一次性子进程）——
 *   子进程冷启动 → 插件模块（含其全部子模块）都是磁盘上最新版本，天然绕开 ESM 模块缓存；
 *   执行完把 {status, body} 以 JSON 写到 stdout 后退出。
 *
 * 为什么用「一次性子进程」而不是「进程内带 ?t= 时间戳重新 import」：
 *   ESM 的模块缓存键是 URL，只给**入口**加时间戳时，入口 import 的子模块（handlers/*.js、
 *   git/*.js 等）仍命中旧缓存——改了子模块不生效。子进程方案对整个模块图都新鲜，代价是
 *   每次请求多一次进程启动（约 100ms，预览场景可接受）。
 *
 * 输入（stdin JSON）：{ method, url, headers, workspaceRoot? }
 * 输出（stdout JSON）：{ status, body }
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
/** 以绝对 file URL 加载插件模块（相对本脚本解析，避免 cwd 影响）。 */
const load = (rel) => import(pathToFileURL(resolve(ROOT, rel)).href);

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { payload = {}; }

const { handleHttp } = await load('lib/app/http-handlers.js');
const { defaultConfig } = await load('lib/client/index.js');
const { VERSION } = await load('lib/self/index.js');

const headers = payload.headers || {};
// env 形状与插件 apply() 里构造的一致（HTTP 层只用到这几项）；
//   workspaceRoot 决定凭据/索引等数据目录——缺省取项目根的上一级（工作区）。
const env = {
  version: VERSION,
  workspaceRoot: payload.workspaceRoot || resolve(ROOT, '..'),
  extraRepos: [],
  extraReposFile: '',
};
const req = {
  method: payload.method || 'GET',
  url: payload.url || '/',
  headers,
  origin: `http://${headers.host || '127.0.0.1'}`,
};

try {
  const r = await handleHttp(req, env, defaultConfig());
  process.stdout.write(JSON.stringify({ status: r?.status || 200, body: r?.body }));
} catch (e) {
  process.stdout.write(JSON.stringify({ status: 500, body: { ok: false, error: String(e?.message || e) } }));
}
