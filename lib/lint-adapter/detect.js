/**
 * 外部 linter 委托层 · 探测
 *
 * 职责：判断被审项目是否**自带官方 linter**（配置存在），并**自探测**出可执行的工具路径。
 *
 * 设计口径（docs/2026-11-06-审计插件本体审视与优化方向讨论.案例d3dx.md 方向 A）：
 *   · 委托层只负责「外部有权威判定源时用它」，绝不在外部工具缺失时硬失败——探测不到即返回 null，
 *     调用方（runner）据此**降级跳过**，交回自研规则（D5：增强件坏了不能拖垮门禁）。
 *   · 工具副本按 project-self-tools 存项目 tools/ 目录；本机/CI 没有 tools 副本时回退 PATH 与常见路径。
 *
 * 路径探测四律（tool-self-detection）：环境变量覆盖 → 项目 tools/ 自带 → PATH → 常见绝对路径；
 *   每条候选都必须校验**可执行**（-x），仅存在不够（CIFS/noexec 上会存在但跑不了）。
 */
import { existsSync, readFileSync, constants, accessSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// 插件根：与 ext-runner 同源——统一从 lib/core/config.js 导入，不自行 resolve
//   （两处各算一次是 duplicate-constant，换了目录层级就会不一致；见 ext-runner 同款修复）。
import { PLUGIN_ROOT } from '../core/config.js';

/** 支持的 linter 与其**配置指纹**（探测「项目是否用了它」的依据，均为项目根级文件/字段）。 */
export const LINTERS = [
  {
    key: 'ruff',
    lang: 'py',
    // 命中任一即认为项目在用 ruff
    configHits: ['ruff.toml', '.ruff.toml'],
    tomlTable: '[tool.ruff',
    // 工具可执行名（PATH 与 tools/ 下同名查找）
    bin: 'ruff',
    envOverride: 'DSH_GIT_PUSH_RUFF',
  },
];

/** 是否可执行（存在 + x 位；Windows 下 existsSync 即可，无 x 位概念）。 */
function isExecutable(p) {
  try {
    if (!existsSync(p)) return false;
    // process.platform === 'win32' 时不校验 mode（NTFS 无 POSIX x 位）
    if (process.platform === 'win32') return true;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 项目根是否存在该 linter 的配置（ruff：独立 toml 或 pyproject 的 [tool.ruff] 段）。 */
function hasConfig(repoRoot, linter) {
  for (const f of linter.configHits) {
    if (existsSync(join(repoRoot, f))) return true;
  }
  const pyproject = join(repoRoot, 'pyproject.toml');
  if (existsSync(pyproject)) {
    try {
      const txt = readFileSync(pyproject, 'utf8');
      // 粗略匹配 [tool.ruff] / [tool.ruff.lint] 等段头（配置指纹，非语义解析）
      if (txt.includes(linter.tomlTable)) return true;
    } catch { /* 读不动就当没配置 */ }
  }
  return false;
}

/**
 * 自探测 linter 可执行路径（简版：只要「有没有」，不要「为什么没有」）。
 * 候选清单唯一来源是 binCandidates —— 与 resolveBinDetailed 共用，
 *   避免四律改一处漏一处导致「详版找得到、简版找不到」的自相矛盾。
 * @returns {string|null} 首个可执行候选；全落空 null（调用方降级）
 */
export function resolveBin(repoRoot, linter) {
  for (const c of binCandidates(repoRoot, linter)) {
    if (c && isExecutable(c)) return c;
  }
  return null;
}

/** PATH 里找可执行（不依赖 which 命令，扫 PATH 各段）。 */
function tryWhich(bin) {
  const paths = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of paths) {
    if (!dir) continue;
    for (const e of exts) {
      const p = join(dir, bin + e);
      if (isExecutable(p)) return p;
    }
  }
  return null;
}

/**
 * 探测结果：项目内所有「有配置且工具可执行」的 linter，附版本（拿不到版本不阻断）。
 * @returns {Array<{key,lang,bin,version}>}
 */
export function detectLinters(repoRoot) {
  return detectLinterStatus(repoRoot).ok;
}

/**
 * 探测状态全貌（委托层可观测性 bugfix）：
 *   ok          = 可委托（有配置 + 工具可执行）
 *   unavailable = **项目声明了要用的 linter，但工具不可用**——必须与「项目根本没配置」区分开。
 *
 * 为什么单列（实测事故）：部署副本迁移时 tools/ruff 丢了可执行位（cp/同步不保 mode），
 *   旧行为是静默返回 []，报告里与「项目没装 ruff」完全无法区分——委托层宣称要防的静默空转，
 *   恰恰发生在它自己身上（灯下黑）。unavailable 让这类问题当场可见、且给出修复动作。
 * @returns {{ok: Array<{key,lang,bin,version}>, unavailable: Array<{key,reason}>}}
 */
export function detectLinterStatus(repoRoot) {
  const ok = [];
  const unavailable = [];
  for (const linter of LINTERS) {
    if (!hasConfig(repoRoot, linter)) continue;
    const r = resolveBinDetailed(repoRoot, linter);
    if (r.bin) ok.push({ key: linter.key, lang: linter.lang, bin: r.bin, version: tryVersion(r.bin) });
    else unavailable.push({ key: linter.key, reason: r.reason });
  }
  return { ok, unavailable };
}

/** 候选路径清单（四律：env 覆盖 → 插件 tools/ → 项目 tools/ → PATH → 常见绝对路径）。 */
function binCandidates(repoRoot, linter) {
  const out = [];
  if (process.env[linter.envOverride]) out.push(process.env[linter.envOverride]);
  for (const d of ['tools', 'tool']) {
    out.push(join(PLUGIN_ROOT, d, linter.bin));
    out.push(join(PLUGIN_ROOT, d, linter.bin, linter.bin)); // tools/ruff/ruff（pip --target 装法）
  }
  for (const d of ['tools', 'tool']) out.push(join(repoRoot, d, linter.bin));
  const which = tryWhich(linter.bin);
  if (which) out.push(which);
  out.push('/usr/local/bin/' + linter.bin, '/usr/bin/' + linter.bin);
  return out;
}

/** resolveBin 的详版：落空时给出可诊断原因（区分「存在但缺 +x」与「压根没有」）。 */
function resolveBinDetailed(repoRoot, linter) {
  const candidates = binCandidates(repoRoot, linter);
  let existsOnly = null;
  for (const c of candidates) {
    if (!c) continue;
    if (isExecutable(c)) return { bin: c };
    if (existsOnly === null && existsSync(c)) existsOnly = c;
  }
  if (existsOnly) {
    return { bin: null, reason: '文件存在但不可执行（疑似同步/拷贝丢了可执行位）：' + existsOnly + '；修复：chmod 755 该文件' };
  }
  const n = candidates.filter(Boolean).length;
  return { bin: null, reason: '未找到可执行（探测 ' + n + ' 个候选路径）；修复：把 ' + linter.bin + ' 放入 tools/，或 export ' + linter.envOverride + '=路径，或装进 PATH' };
}

/** 取 `bin --version` 首行（失败返回空串，不影响委托）。 */
function tryVersion(bin) {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    return String(out).split('\n')[0].trim().slice(0, 40);
  } catch {
    return '';
  }
}
