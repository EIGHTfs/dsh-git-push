/**
 * CLI 命令 · 文档/工具域（file-io/tree-doc/functions/module-splitter）（从 cli.mjs 抽出）
 *
 * 为什么拆出来：cli.mjs 578 行代码超单文件阈值（400），本组 4 个命令是
 *   「文档生成与代码工具」域（扫描文件 I/O / README 目录树 / 函数索引 / 巨型文件拆分），
 *   与审计/账号/VCS 域无共享状态。
 *
 * 保持薄引用：逻辑在 scripts/* 与 lib/git/module-splitter.js（与插件工具同源）。
 */

import { runModuleSplitter } from '../git/module-splitter.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';


/** 子进程最大等待时长（ms，tree-doc/functions 共用）。 */
const SUBPROC_TIMEOUT_MS = 120_000;

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
