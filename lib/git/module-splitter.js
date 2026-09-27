/**
 * Git 执行层 · module-splitter 子进程调用（CLI 与工具共用）
 *
 * 为什么单独成文件（2026-10-05）：cli.mjs cmdModuleSplitter 与 lib/app/tool-call.js
 *   module_splitter case 各写了一份 python3 spawn 逻辑（参数拼装/ENOENT/错误截断/
 *   脚本路径解析）——同一实现两份，改一处漏一处。抽到本模块后两处只做「传参 + 格式化输出」。
 *
 * 行为约定：参数数组 spawn（防注入）；脚本相对插件根解析；python3 缺失返回明确的
 *   ENOENT 文案（module-splitter 依赖 python3 标准库）。
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** module-splitter 子命令白名单。 */
export const SPLITTER_SUBCOMMANDS = ['analyze', 'split', 'verify'];
/** 子进程最大等待时长（ms）。 */
export const SPLITTER_TIMEOUT_MS = 120_000;
/** 报错截断长度。 */
export const SPLITTER_ERR_MAX_LEN = 800;

/**
 * 调 scripts/module-splitter.py（python3 零依赖）。
 * @param {{sub:string, target:string, dryRun?:boolean}} p sub=analyze|split|verify；target=文件/plan 路径
 * @returns {{ok:boolean, error?:string, status?:number, output?:string, sub?:string, target?:string}}
 *   ok:true 时 output=stdout；失败 ok:false 且 error 可读。
 */
export function runModuleSplitter({ sub = '', target = '', dryRun = false } = {}) {
  if (!SPLITTER_SUBCOMMANDS.includes(sub)) {
    return { ok: false, error: `module-splitter 子命令应为 ${SPLITTER_SUBCOMMANDS.join('|')}（得「${sub || '(空)'}」）` };
  }
  if (!target) {
    return { ok: false, error: 'module-splitter 需要目标参数：analyze <file.js> / split <plan.json> / verify <plan.json>' };
  }
  const script = fileURLToPath(new URL('../../scripts/module-splitter.py', import.meta.url));
  const argv = [script, sub, target];
  if (dryRun) argv.push('--dry-run');
  const r = spawnSync('python3', argv, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: SPLITTER_TIMEOUT_MS });
  if (r.error) {
    const msg = r.error.code === 'ENOENT' ? 'python3 不可用（module-splitter 依赖 python3 标准库）' : `执行失败: ${r.error.message}`;
    return { ok: false, error: msg };
  }
  if (r.status !== 0) {
    return { ok: false, status: r.status, error: String(r.stderr || r.stdout || '执行失败').trim().slice(0, SPLITTER_ERR_MAX_LEN) };
  }
  return { ok: true, sub, target, dryRun, output: String(r.stdout || '') };
}
