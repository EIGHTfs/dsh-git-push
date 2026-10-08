/**
 * CJS 侧探针通道（配合 scripts/hot-path-probe.mjs 的 ESM loader 钩子；由它 createRequire 载入）。
 *
 * 【为什么需要单独一条通道】Node 对 `format: 'commonjs'` **不采用** loader 钩子返回的源码
 *   （实测：同一探针下 ESM 目标计数正常，CJS 目标计数为 0），故 CJS 必须走自己的路：
 *   patch `Module._extensions['.js'/'.cjs']`。
 *
 * 【为什么用 _compile 重编译，而不是只包 module.exports】只包 `module.exports` 只能统计
 *   「外部调用」；模块内部自调用（helper 调 helper）统计不到。重编译时在源码**末尾追加**
 *   与 ESM 侧同形的包装，即可同时覆盖两种调用——与 ESM 侧行为对称。
 *
 * 【计数容器】与 ESM 侧共用 `globalThis.__HOT_PATH_PROBE__`（同进程同主线程），
 *   故报告由 ESM 侧的退出钩子统一打印，本文件不重复打印。
 *
 * 【失败兜底】包装失败（源码不可读 / 语法异常等）一律**回退原始加载**并 emitWarning——
 *   探针绝不能让被测程序跑不起来。
 */
const Module = require('node:module');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const cfg = (() => {
  try { return JSON.parse(process.env.HOT_PATH_PROBE || '{}'); } catch { return {}; }
})();
const targets = cfg.modules || {};

const HEADER = '\nconst __HP = (globalThis.__HOT_PATH_PROBE__ ||= { fn: {}, fs: {} });\n'
  + 'function __hpRecord(__n, __ms) { const __e = (__HP.fn[__n] ||= { calls: 0, ms: 0 }); __e.calls += 1; __e.ms += __ms; }\n';

/**
 * 生成与 ESM 侧同形的包装代码。
 * @param {string[]} names 目标函数名
 * @returns {string} 追加到源码末尾的包装片段
 */
function suffixFor(names) {
  return names.map((n) => `
;(() => {
  const __orig = typeof ${n} === 'function' ? ${n} : (module.exports && module.exports.${n});
  if (typeof __orig !== 'function') return;
  const __wrapped = function (...__a) {
    const __t0 = performance.now();
    try { return __orig.apply(this, __a); }
    finally { __hpRecord(${JSON.stringify(n)}, performance.now() - __t0); }
  };
  try { ${n} = __wrapped; } catch { /* 非可变绑定（const 箭头函数等）：只兜 exports */ }
  try {
    if (module.exports && module.exports.${n} === __orig) module.exports.${n} = __wrapped;
  } catch { /* 只读导出（getter/冻结）忽略：内部调用已计数 */ }
})();`).join('');
}

for (const ext of ['.js', '.cjs']) {
  const orig = Module._extensions[ext];
  if (typeof orig !== 'function') continue;
  Module._extensions[ext] = function patchedExtension(mod, filename) {
    const names = targets[pathToFileURL(filename).href];
    if (!Array.isArray(names) || !names.length) return orig.call(this, mod, filename);
    let src;
    try {
      src = fs.readFileSync(filename, 'utf8');
    } catch {
      return orig.call(this, mod, filename);
    }
    try {
      mod._compile(src + HEADER + suffixFor(names), filename);
    } catch (e) {
      process.emitWarning(`hot-path-probe-cjs: 包装失败，已回退原始加载（${filename}）：${e && e.message}`);
      return orig.call(this, mod, filename);
    }
  };
}
