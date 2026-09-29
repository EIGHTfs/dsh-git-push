/**
 * CLI 命令 · 文档/工具域（file-io/tree-doc/functions/module-splitter）（从 cli.mjs 抽出）
 *
 * 为什么拆出来：cli.mjs 578 行代码超单文件阈值（400），本组 4 个命令是
 *   「文档生成与代码工具」域（扫描文件 I/O / README 目录树 / 函数索引 / 巨型文件拆分），
 *   与审计/账号/VCS 域无共享状态。
 *
 * 保持薄引用：逻辑在 scripts/* 与 lib/git/module-splitter.js（与插件工具同源）。
 */

import { scanFileIo, summarize } from '../../scripts/scan-file-io.mjs';
import { runModuleSplitter } from '../git/module-splitter.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** 子进程最大等待时长（ms，tree-doc/functions 共用）。 */
const SUBPROC_TIMEOUT_MS = 120_000;

/**
 * file-io —— 文件读写调用扫描（三标签：类型/操作/上下文）。
 * 输出每条命中带 sync|async、read|write|delete|rename、以及「是否在 async 函数内 /
 *   循环内 / 请求处理路径上」，用于判断同步 I/O 会不会阻塞其他请求、写操作是否高风险。
 * @param {string[]} targets 扫描目标（文件或目录；空=默认 lib/ scripts/ cli.mjs）
 * @param {object} flags { json, summary, write, op, kind, type, risk }
 */
export function cmdFileIo(targets = [], flags = {}) {
  const splitMulti = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  const hits = scanFileIo({
    targets,
    opFilter: splitMulti(flags.op),
    kindFilter: splitMulti(flags.kind),
    typeFilter: splitMulti(flags.type),
    riskOnly: flags.risk || '',
    writeOnly: !!flags.write,
  });
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, count: hits.length, hits }, null, 2));
    return hits;
  }
  if (flags.summary) { summarize(hits); return hits; }
  if (!hits.length) { console.log('（未命中任何文件操作）'); return hits; }
  // 按文件分组输出（组内按行号，风险降序已由 scanFileIo 排好）
  const byFile = new Map();
  for (const hit of hits) {
    if (!byFile.has(hit.file)) byFile.set(hit.file, []);
    byFile.get(hit.file).push(hit);
  }
  const riskMark = (r) => (r === 'high' ? '🔴' : r === 'medium' ? '🟠' : '·');
  const tagsOf = (hit) => {
    const t = [hit.type === 'sync' ? '同步' : '异步', hit.kind];
    if (hit.inAsync) t.push('async内');
    if (hit.inLoop) t.push('循环内');
    if (hit.inRequest) t.push('请求路径');
    return t.join('·');
  };
  for (const [file, hs] of [...byFile.entries()].sort()) {
    console.log(`\n── ${file} (${hs.length}) ──`);
    for (const hit of hs.sort((a, b) => a.line - b.line)) {
      console.log(`  ${riskMark(hit.risk)} L${String(hit.line).padEnd(4)} ${hit.op.padEnd(14)} ${tagsOf(hit)}`);
      console.log(`       ${hit.path}`);
    }
  }
  console.log(`\n合计 ${hits.length} 处文件操作（🔴high=写/删且并发路径 · 🟠medium=同步阻塞或写类 · ·low=普通读）`);
  return hits;
}

/** 子命令：tree-doc — README 目录结构维护（封装 scripts/tree-doc.mjs：sync/gen/check/apply）。 */
export async function cmdTreeDoc(sub, flags) {
  if (!['sync', 'gen', 'check', 'apply'].includes(sub)) {
    console.error(`tree-doc 子命令应为 sync|gen|check|apply（得「${sub || '(空)'}」）`);
    return 1;
  }
  const script = fileURLToPath(new URL('../../scripts/tree-doc.mjs', import.meta.url));
  const args = [script, sub];
  if (flags.root) args.push('--root', String(flags.root));
  if (flags.readme) args.push('--readme', String(flags.readme));
  if (flags.write) args.push('--write');
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: SUBPROC_TIMEOUT_MS, stdio: 'inherit' });
  return r.status === 0 ? 0 : 1;
}

/** 子命令：functions — 函数索引（analyze）与函数文档（apply，复用 scripts/func-index.js / functions-doc.mjs）。 */
export async function cmdFunctions(op, target, flags) {
  if (!['analyze', 'apply'].includes(op)) {
    console.error(`functions 子命令应为 analyze|apply（得「${op || '(空)'}」）`);
    return 1;
  }
  if (op === 'analyze') {
    const dir = target || '.';
    // 输出统一落到当前目录（cwd）根，与 apply 读取位置一致（scan 目标只影响扫描范围）
    const outFile = join(process.cwd(), 'functions-index.json');
    const script = fileURLToPath(new URL('../../scripts/func-index.js', import.meta.url));
    const r = spawnSync(process.execPath, [script, dir, '--out', outFile], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: SUBPROC_TIMEOUT_MS });
    if (r.error) { console.error(`❌ analyze 失败: ${r.error.message}`); return 1; }
    if (flags.json) { console.log(JSON.stringify({ ok: true, outFile }, null, 2)); return 0; }
    console.log(`✅ 函数索引已生成 → ${outFile}`);
    return 0;
  }
  const { applyFunctionsDocs } = await import('../../scripts/functions-doc.mjs');
  const r = applyFunctionsDocs(process.cwd(), { skipEmpty: flags.skipEmpty === true });
  if (!r.ok) { console.error(`❌ ${r.error}`); return 1; }
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); return 0; }
  console.log(`✅ 函数文档已生成：${r.written.length} 个文件${r.archived?.length ? `（归档 ${r.archived.length}）` : ''} → ${r.outDir}`);
  return 0;
}

/** 子命令：module-splitter — 巨型单文件按职责拆分（复用 scripts/module-splitter.py，python3 零依赖）。 */
export async function cmdModuleSplitter(positional = [], flags = {}) {
  // python3 调用逻辑抽到 lib/git/module-splitter.js（与工具 module_splitter 共用），
  //   此处只做传参与输出格式化（此前两份相同实现，改一处漏一处）。
  const r = runModuleSplitter({
    sub: String(positional[0] || '').trim(),
    target: String(positional[1] || '').trim(),
    dryRun: flags.dryRun === true,
  });
  if (!r.ok) {
    console.error(r.error);
    return { ok: false, error: r.error };
  }
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, command: r.sub, target: r.target, output: r.output }, null, 2));
  } else {
    console.log(r.output);
  }
  return { ok: true, command: r.sub, target: r.target, output: r.output };
}
