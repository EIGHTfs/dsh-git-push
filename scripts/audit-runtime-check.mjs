#!/usr/bin/env node
/**
 * 三层审计 · L3 运行时检测（2026-09-14）
 *
 * 职责：兜住静态盲区——L2（AST 同函数数据流）看不到的跨文件引用、闭包捕获、
 *   异步时序（清空在 setTimeout/await 之后、访问在回调里）。本脚本用**运行时实测**
 *   确认「清空后访问」是否真的拿到 undefined / 空值。
 *
 * 用法：
 *   node scripts/audit-runtime-check.mjs <被测 js 文件> [--obj 对象名] [--verbose]
 *   node scripts/audit-runtime-check.mjs --all <目录>     # 目录内所有 js 文件逐个测
 *
 * 原理（在测试沙箱里构造，不改被测文件）：
 *   ① 动态 import 被测模块（file:// URL），拿到模块导出的对象；
 *   ② 若模块顶层有「清空动作」（clear()/reset()/=[]/=null/length=0）对应的方法，
 *      依次调用：先调清空方法，再调访问方法（get/first/peek/[0]），捕获返回值；
 *   ③ 返回值是 undefined / null / 空数组 → 命中（L3 确认）；否则不命中（L2 疑点排除）。
 *
 * 局限（如实标注）：
 *   - 只能测「模块导出」的入口；内部闭包/未导出的状态只能靠测试钩子；
 *   - 依赖被测文件能安全 import（副作用不能炸进程，如连真 API/写文件）；
 *   - 异步时序无法在纯同步沙箱复现——异步场景建议用 node:test 写专门用例。
 *
 * 退出码：0 = 全部通过（无运行时命中）；1 = 存在运行时命中（L3 确认的 bug）；
 *   2 = 无法检测（文件不可 import / 无导出对象 / 用法错误）。
 */

import { pathToFileURL } from 'node:url';
import { statSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const args = process.argv.slice(2);

/** 解析 CLI 参数。 */
function parseArgs() {
  const opts = { files: [], obj: null, verbose: false, all: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--obj') { opts.obj = args[++i] || null; }
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--all') opts.all = true;
    else opts.files.push(a);
  }
  return opts;
}

/** 收集目录下所有 .js 文件（一层）。 */
function collectJs(dir) {
  try {
    const st = statSync(dir);
    if (!st.isDirectory()) return [dir];
    return readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => join(dir, n));
  } catch { return []; }
}

/**
 * 对单个文件做运行时检测。
 * @returns {Promise<{file:string, hits:Array<{op:string, result:string}>, error?:string}>}
 */
async function runFile(file, obj) {
  const out = { file, hits: [], error: null };
  let mod;
  try {
    mod = await import(pathToFileURL(resolve(file)).href);
  } catch (e) {
    out.error = `无法 import（${String(e?.message || e).split('\n')[0]}）`;
    return out;
  }
  const exp = mod?.default ?? mod;
  const cands = [];
  // 候选对象：指定 obj → 导出里找；否则导出里「看起来像容器」的值（对象/数组/Map/Set）
  for (const [name, val] of Object.entries(exp || {})) {
    if (typeof val !== 'object' || val === null) continue;
    if (obj && name !== obj) continue;
    cands.push({ name, val });
  }
  if (!cands.length) {
    out.error = '无候选容器对象（导出里没有对象/数组/Map/Set）';
    return out;
  }
  for (const { name, val } of cands) {
    const clearOps = ['clear', 'reset', 'flush', 'purge'].filter((m) => typeof val?.[m] === 'function');
    const accessOps = ['get', 'first', 'last', 'peek', 'head', 'at', 'shift', 'pop'].filter((m) => typeof val?.[m] === 'function');
    if (!clearOps.length) continue; // 无清空方法 → 本对象不适用
    for (const c of clearOps) {
      let clearOk = true;
      try { val[c](); } catch (e) { clearOk = false; out.hits.push({ op: `${name}.${c}()`, result: `调用抛错：${String(e?.message || e).split('\n')[0]}` }); }
      if (!clearOk) continue;
      for (const a of accessOps) {
        let res;
        try { res = val[a](); } catch (e) { res = `抛错：${String(e?.message || e).split('\n')[0]}`; }
        const isBad = res === undefined || res === null || (Array.isArray(res) && res.length === 0);
        if (isBad) out.hits.push({ op: `${name}.${c}() 后 ${name}.${a}()`, result: `${typeof res === 'object' ? JSON.stringify(res) : String(res)}` });
      }
    }
  }
  return out;
}

/** 主流程。 */
async function main() {
  const opts = parseArgs();
  if (!opts.files.length) {
    console.error('用法: node scripts/audit-runtime-check.mjs <js 文件> [--obj 对象名] [--verbose]');
    console.error('      node scripts/audit-runtime-check.mjs --all <目录>');
    process.exitCode = 2;
    return;
  }
  const files = opts.all ? opts.files.flatMap((d) => collectJs(d)) : opts.files;
  let confirmed = 0;
  for (const f of files) {
    const r = await runFile(f, opts.obj);
    if (r.error) {
      console.log(`— ${f}: ${r.error}`);
      continue;
    }
    if (r.hits.length) {
      confirmed++;
      console.log(`✗ ${f} —— L3 确认「清空后访问」命中 ${r.hits.length} 处:`);
      for (const h of r.hits) console.log(`    ${h.op} → ${h.result}`);
    } else if (opts.verbose) {
      console.log(`✔ ${f}: 无运行时命中`);
    }
  }
  console.log(`\nL3 运行时检测完成：${confirmed} 个文件确认命中`);
  if (confirmed > 0) process.exitCode = 1;
}

await main();
