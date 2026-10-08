/**
 * 热路径探针（C1）：统计指定模块里关键函数的**耗时 + 调用次数**，并统计 fs 调用次数。
 *
 * 【为什么用 loader 钩子】ESM 的导出绑定与模块命名空间对象都是**只读**的，
 *   `mod.fn = wrapper` 这类 monkey-patch 对 import 方**无效**（只对 CJS 有效）。
 *   想在 ESM 里量函数耗时/调用次数，只能在**模块加载时**改源码——本文件即该钩子。
 *   注入方式：给目标模块源码**追加**包装代码。ESM 里模块**自己的函数声明绑定是可变的**
 *   （只有 `import` 进来的绑定只读），故模块内部 `fn = wrapper` 会被 import 方看到 ✓。
 *
 * 【一个文件两种角色】（Node 的 register 允许钩子与注册器同文件，用线程区分）
 *   · 主线程：把自己注册为 loader 钩子，并在退出时打印统计；
 *   · 钩子线程：导出 resolve/load/initialize，负责改源码与重定向 node:fs。
 *
 * 【用法】
 *   node --import ./scripts/hot-path-probe.mjs <目标脚本或 -e 代码>
 *   目标由环境变量 HOT_PATH_PROBE 指定（JSON）：
 *     {"modules":{"<模块绝对URL>":["fn1","fn2"]},"fs":true}
 *   便捷入口：`node scripts/hot-path-probe.mjs run -- <命令...>`（本文件自己起子进程并透传环境）。
 *
 * 【计数落在哪】被改写的代码跑在**主线程**，故 `globalThis.__HOT_PATH_PROBE__` 可直接读。
 */

import { isMainThread } from 'node:worker_threads';
import { register } from 'node:module';
import { createRequire } from 'node:module';

/** 统计容器（主线程可读；钩子线程里也初始化一份，互不干扰）。 */
const HP = (globalThis.__HOT_PATH_PROBE__ ||= { fn: {}, fs: {} });

/** 从环境读取配置（钩子线程同样能读 process.env）。 */
function readCfg() {
  try {
    return JSON.parse(process.env.HOT_PATH_PROBE || '{}');
  } catch {
    return {};
  }
}

// ─────────────────────────── 主线程：注册 + 报告 ───────────────────────────
if (isMainThread) {
  const cfg = readCfg();
  if (!process.env.HOT_PATH_PROBE_ACTIVE) {
    // 作为 --import 预载时：注册钩子（把配置通过 data 传给钩子线程），并在退出时报告。
    process.env.HOT_PATH_PROBE_ACTIVE = '1';
    register(import.meta.url, { data: cfg });
    // 顺带装上 **CJS 通道**：Node 对 format:'commonjs' 不采用 loader 钩子返回的源码（实测计数为 0），
    //   故 CJS 必须 patch Module._extensions；而该 patch 必须在任何 CJS 模块被加载**之前**完成，
    //   `--import` 预载正是最早的时机 ⇒ 一个 --import 即可同时覆盖 ESM 与 CJS。
    try {
      createRequire(import.meta.url)('./hot-path-probe-cjs.cjs');
    } catch (e) {
      process.emitWarning(`hot-path-probe: CJS 通道未装上（${e && e.message}）——CJS 目标将不会被计数`);
    }
    process.on('exit', () => report());
  }

  /**
   * 打印统计：函数按累计耗时降序（耗时 + 次数 + 均值），另列 fs 调用次数。
   * 用途：区分「CPU 重复计算」（某函数耗时高、次数多）与「I/O 等待」（fs 次数高）。
   */
  function report() {
    const fn = Object.entries(HP.fn || {});
    const fs = Object.entries(HP.fs || {});
    if (!fn.length && !fs.length) return;
    const lines = ['', '── 热路径探针 ──'];
    if (fn.length) {
      lines.push('函数（按累计耗时降序）：');
      for (const [name, s] of fn.sort((a, b) => b[1].ms - a[1].ms)) {
        lines.push(`  ${name.padEnd(28)} 调用 ${String(s.calls).padStart(7)} 次｜累计 ${s.ms.toFixed(1).padStart(9)} ms｜均值 ${(s.ms / s.calls).toFixed(3)} ms`);
      }
    }
    if (fs.length) {
      lines.push('fs 调用（按次数降序）：');
      for (const [name, n] of fs.sort((a, b) => b[1] - a[1])) lines.push(`  ${name.padEnd(28)} ${String(n).padStart(7)} 次`);
    }
    process.stderr.write(`${lines.join('\n')}\n`);
  }
}

// ─────────────────────────── 钩子线程：resolve / load ───────────────────────────
/** fs shim 的 URL：`node:fs` 与 `node:fs/promises` **必须分开两个 shim** —— 两者导出面重叠但不同
 *  （如 access），塞进同一模块会触发 conflicting star exports 语法错误（实测真实审计因此崩掉）。 */
const SHIM_FS = new URL('./hot-path-probe-fs-shim.mjs', import.meta.url).href;
const SHIM_FSP = new URL('./hot-path-probe-fsp-shim.mjs', import.meta.url).href;

let hookCfg = {};
/** Node 在钩子线程启动时调用，data 即主线程 register 传的配置。 */
export function initialize(data) {
  hookCfg = data || {};
}

/** 重定向 fs 到对应 shim（用于统计 I/O 次数）。 */
export async function resolve(specifier, context, next) {
  // ⚠️ 必须放行 **shim 自己**对 builtin 的 import：否则会把 shim 重定向到 shim，成环且静默埋雷
  //   （实测：负载不碰 fs 时看不出问题，一旦真用 fs 就会炸）。
  const fromShim = context?.parentURL === SHIM_FS || context?.parentURL === SHIM_FSP;
  if (!fromShim && hookCfg.fs !== false) {
    if (specifier === 'node:fs') return { url: SHIM_FS, format: 'module', shortCircuit: true };
    if (specifier === 'node:fs/promises') return { url: SHIM_FSP, format: 'module', shortCircuit: true };
  }
  return next(specifier, context);
}

/** 给目标模块源码追加「耗时 + 次数」包装（**ESM 与 CJS 自动判断**，用 loader 给的 format，不猜）。 */
export async function load(url, context, next) {
  const r = await next(url, context);
  const names = (hookCfg.modules || {})[url];
  if (!Array.isArray(names) || !names.length) return r;
  // format 由 Node 给出：'module' = ESM；'commonjs'（含 commonjs-typescript）= CJS；
  //   其余（builtin / json / wasm 等）不处理——既不该改，也不适用下面两种包装。
  const isEsm = r.format === 'module';
  const isCjs = r.format === 'commonjs' || r.format === 'commonjs-typescript';
  if (!isEsm && !isCjs) return r;
  let src = r.source;
  if (src && typeof src !== 'string') src = Buffer.from(src).toString('utf8');
  if (typeof src !== 'string') return r;

  // 计数容器 + 上报函数（两种格式共用；代码最终跑在主线程，故 globalThis 直接可读）
  const header = '\nconst __HP = (globalThis.__HOT_PATH_PROBE__ ||= { fn: {}, fs: {} });\n'
    + 'function __hpRecord(__n, __ms) { const __e = (__HP.fn[__n] ||= { calls: 0, ms: 0 }); __e.calls += 1; __e.ms += __ms; }\n';

  // ESM：模块**自己的函数声明绑定可变**（只有 import 进来的绑定只读）⇒ 模块内重赋值 import 方可见。
  const esmSuffix = names.map((n) => `
;(() => {
  const __orig = ${n};
  if (typeof __orig !== 'function') return;
  ${n} = function (...__a) {
    const __t0 = performance.now();
    try { return __orig.apply(this, __a); }
    finally { __hpRecord(${JSON.stringify(n)}, performance.now() - __t0); }
  };
})();`).join('');

  // CJS：同样重赋值本地函数声明（覆盖**内部调用**），并额外替换 `module.exports` 上**已导出**的引用
  //   —— CJS 常见 `module.exports = { foo }` 写在文件末尾，而本段代码追加在最后，
  //   此时导出对象已捕获旧引用，故两处都要换。
  const cjsSuffix = names.map((n) => `
;(() => {
  const __orig = ${n};
  if (typeof __orig !== 'function') return;
  const __wrapped = function (...__a) {
    const __t0 = performance.now();
    try { return __orig.apply(this, __a); }
    finally { __hpRecord(${JSON.stringify(n)}, performance.now() - __t0); }
  };
  ${n} = __wrapped;
  try {
    if (typeof module !== 'undefined' && module.exports && module.exports.${n} === __orig) module.exports.${n} = __wrapped;
  } catch { /* 只读导出（getter/冻结）忽略：内部调用已计数 */ }
})();`).join('');

  return { ...r, source: src + header + (isEsm ? esmSuffix : cjsSuffix) };
}
