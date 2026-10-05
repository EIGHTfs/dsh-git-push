#!/usr/bin/env node
// 架构图预览刷新：一条命令把多个项目的架构图重新生成 → 渲染 → 挂到预览目录。
//
// 为什么要它：架构图是「事实导出」的产物，**代码一改就该重生成**，否则图会过期（比没有更糟）。
//   靠记性容易漏，故固化成一条命令：每次改完代码跑一次即可。
//
// 用法：
//   node scripts/archify-preview.mjs                 # 刷新默认项目列表
//   node scripts/archify-preview.mjs <仓库> [<仓库>…]  # 刷新指定项目
//   node scripts/archify-preview.mjs --check         # 只查漂移（不渲染），有漂移非零退出
//
// 环境变量：
//   ARCHIFY_DIR   archify 仓库根（默认自动探测：与本仓库同级的 archify/）
//   PREVIEW_DIR   预览输出目录（默认：与工作区同级的 archify-预览/）
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = dirname(ROOT);
// 项目列表**外置**（不写死在代码里，也不入库）：
//   · 读 <本仓库>/archify-preview.json —— 形如 { "projects": ["<绝对或相对路径>", …], "previewDir": "…", "archifyDir": "…" }
//   · 该文件被 .gitignore 忽略（每台机器的项目路径不同，属于本机配置，不该进仓库）
//   · 仓库里只放一份 archify-preview.example.json 作为模板
//   · 找不到配置时退回下面这份「本机默认」（只为开箱可用，正式用法是写配置）
const CONFIG_PATH = join(ROOT, 'archify-preview.json');
const CONFIG_EXAMPLE = join(ROOT, 'archify-preview.example.json');

/** 读外置配置（缺文件/坏 JSON 都返回 null，由调用方退回默认）。 */
function readPreviewConfig() {
  for (const p of [CONFIG_PATH, CONFIG_EXAMPLE]) {
    try {
      if (!existsSync(p)) continue;
      const data = JSON.parse(readFileSync(p, 'utf8'));
      if (data && typeof data === 'object') return { ...data, __from: p };
    } catch { /* 坏 JSON 退回默认 */ }
  }
  return null;
}

const CONFIG = readPreviewConfig();
const ARCHIFY = process.env.ARCHIFY_DIR || CONFIG?.archifyDir || join(WORKSPACE, 'archify');
const PREVIEW = process.env.PREVIEW_DIR || CONFIG?.previewDir || join(WORKSPACE, 'archify-预览');
const ARCHIFY_BIN = join(ARCHIFY, 'archify', 'bin', 'archify.mjs');

// 默认项目列表（仅在无外置配置时使用；正式用法写 archify-preview.json）
const DEFAULT_PROJECTS = [
  ROOT,
  join(WORKSPACE, 'dsh-theme-mediascape'),
  join(WORKSPACE, 'dsh-normify'),
  join(WORKSPACE, 'archify'),
];

/** 生成 + 校验 + 渲染一个项目；--check 模式只做漂移检查。 */
function refreshProject(repoPath, { checkOnly = false } = {}) {
  const name = basename(repoPath);
  const jsonPath = join(repoPath, '.archify', `${name}.architecture.json`);
  const out = { name, repoPath, ok: false, steps: [] };
  // ① 生成（gen 到内存，便于漂移比对）
  const gen = execFileSync(process.execPath, [join(ROOT, 'scripts', 'archify-gen.mjs'), 'gen', repoPath],
    { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
  const fresh = JSON.parse(gen);
  // ② 漂移检查：与入库产物比对（--check 模式的核心；正常模式也顺手报出来）
  if (existsSync(jsonPath)) {
    const committed = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const same = fresh.components.length === committed.components.length
      && fresh.connections.length === committed.connections.length
      && fresh.components.map((c) => c.id).sort().join(',') === committed.components.map((c) => c.id).sort().join(',');
    out.steps.push(same ? 'JSON 一致 ✅' : 'JSON 漂移 ❌（需重新 apply）');
    out.drift = !same;
  } else {
    out.steps.push('JSON 未入库（先 apply）');
    out.drift = true;
  }
  if (checkOnly) { out.ok = !out.drift; return out; }
  // ③ 写盘 + 渲染 + 挂预览
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'archify-gen.mjs'), 'apply', repoPath],
    { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (!existsSync(ARCHIFY_BIN)) { out.steps.push('未找到 archify，跳过渲染'); out.ok = true; return out; }
  // 渲染到 /tmp（本卷不能直写预览目录：多重硬链接会让 archify 的原子替换失败）
  const tmpHtml = join('/tmp', `archify-preview-${name}.html`);
  try {
    execFileSync(process.execPath, [ARCHIFY_BIN, 'render', 'architecture', jsonPath, tmpHtml, '--repo-root', repoPath],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
  } catch (e) {
    // 渲染失败时把**真实原因**带出来（官方 validate 会给出可执行的修法提示）；
    //   只报「Command failed」等于把线索丢了——实测踩过，排查时得再手动跑一次。
    const err = String(e?.stderr || e?.stdout || e?.message || e);
    const lines = err.split('\n').filter((l) => l.trim() && !l.startsWith('    at '));
    out.steps.push(`渲染失败：${lines.slice(0, 2).join(' ／ ').slice(0, 220)}`);
    out.ok = false;
    return out;
  }
  mkdirSync(PREVIEW, { recursive: true });
  copyFileSync(tmpHtml, join(PREVIEW, `${name}.html`));
  copyFileSync(jsonPath, join(PREVIEW, `${name}.architecture.json`));
  // **同时写回项目自己的 .archify/**：产物属于项目（防漂移测试比对的正是这里），
  //   只拷预览目录会让项目内那份过期——实测 test-arch-json-fresh 因此报 HTML 大小漂移。
  mkdirSync(join(repoPath, '.archify'), { recursive: true });
  copyFileSync(tmpHtml, join(repoPath, '.archify', `${name}.html`));
  out.steps.push(`已渲染并挂预览（${readFileSync(tmpHtml).length} 字节）`);
  out.ok = true;
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const explicit = argv.filter((a) => !a.startsWith('--')).map((p) => resolve(p));
  // 优先级：命令行显式路径 > 外置配置里的 projects > 代码内默认（仅开箱可用）
  const fromConfig = Array.isArray(CONFIG?.projects) ? CONFIG.projects.map((p) => resolve(ROOT, String(p))) : [];
  const projects = (explicit.length ? explicit : (fromConfig.length ? fromConfig : DEFAULT_PROJECTS))
    .filter((p) => existsSync(p));
  if (!projects.length) { console.error('没有可刷新的项目'); process.exitCode = 1; return; }
  console.log(`架构图${checkOnly ? '漂移检查' : '刷新'}：${projects.length} 个项目 ｜ archify=${existsSync(ARCHIFY_BIN) ? '已找到' : '未找到'} ｜ 配置=${CONFIG?.__from ? CONFIG.__from.replace(`${ROOT}/`, '') : '（无，用代码内默认）'}`);
  let bad = 0;
  for (const p of projects) {
    try {
      const r = refreshProject(p, { checkOnly });
      if (!r.ok) bad += 1;
      console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}：${r.steps.join(' ｜ ')}`);
    } catch (e) {
      bad += 1;
      console.log(`  ❌ ${basename(p)}：${String(e?.message || e).slice(0, 120)}`);
    }
  }
  console.log(`完成：${projects.length - bad} 成功 / ${bad} 失败`);
  if (bad) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('archify-preview.mjs')) main();
