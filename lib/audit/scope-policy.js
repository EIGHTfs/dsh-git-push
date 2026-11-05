/**
 * 拼接产物作用域契约的**读取层**（中立模块：工具/独立脚本/审计检查三方共用一份判定）。
 *
 * 为什么单独成模块：同一件事有三个入口（`scope_check` 工具、`scripts/check-js-scope.mjs`、
 *   审计规则 kind=scope-collision），「按文件所属项目取契约」的判定一旦各写一份就会漂移。
 *   放在 lib/app/ 会被 lib/checks/ 反向依赖（现有链路是 app → audit → checks，
 *   checks → app 会成环）；与 lib/audit/client-entry.js 同款处理：共用逻辑下沉中立模块，
 *   依赖方向保持单向（checks → audit/scope-policy 是叶子模块，无回指）。
 *
 * 核心约定：`dshgp_` 前缀与「顶层零声明」都是**各项目自己的契约**，不是通用规范。
 *   拿本项目的约定去要求别人的文件，会刷出一屏「缺少 dshgp_ 前缀」，把真正的同帧重名淹掉。
 *     ① 调用方显式给定 prefix/allowlist → 以显式值为准（调用方明确要求）；
 *     ② 否则从文件所在目录向上找最近的 package.json，读其 `dshScopeCheck`；
 *     ③ 都没有 → 前缀留空、不要求顶层零声明，**只查同帧重名**（唯一通用项）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** 策略来源（输出头自证：避免「继承了本仓默认值」被误读成对方的约定）。 */
export const POLICY_SOURCE = {
  CLI: '命令行',
  PROJECT: '项目 package.json',
  BUILTIN: '内置默认（只查同帧重名）',
};

/** 路径归一化：去掉前导 `./`、反斜杠统一成 `/`（声明值与相对路径两边都用它比）。 */
function normRelPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * 目录 → 最近的 package.json 路径缓存（'' = 一路到根都没有）。
 *
 * 为什么需要：审计逐文件调用本模块，全仓 400+ 个 js 就要做 400+ 次「向上找 package.json」；
 *   在 CIFS/HFS 挂载上 stat 单次约 2.8ms，实测这一项 1.2s（占比虽小但纯浪费）。
 * TTL 取 1s：一次审计内连续调用几乎全命中，而两次审计之间（≥1s）必然重新读，
 *   不会把「刚改了 dshScopeCheck 又立刻审计」读成旧值。
 */
const DIR_LOOKUP_TTL_MS = 1000;
const dirLookupCache = new Map(); // dir → { at, configPath }

/** 向上找最近的 package.json（带 1s 缓存）。 */
function findConfigPath(startDir, now) {
  const cached = dirLookupCache.get(startDir);
  if (cached && now - cached.at < DIR_LOOKUP_TTL_MS) return cached.configPath;
  let found = '';
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) { found = candidate; break; }
    const parent = dirname(dir);
    if (parent === dir) break; // 到根了还没找到 ⇒ 无声明
    dir = parent;
  }
  dirLookupCache.set(startDir, { at: now, configPath: found });
  return found;
}

/**
 * 读某个文件所属项目的作用域契约。
 *
 * @param {string} file 目标文件路径（绝对路径最稳；相对路径按进程 cwd 解析）
 * @returns {{
 *   declared: boolean,           是否找到了显式声明（决定「契约类检查」跑不跑）
 *   isDeclaredArtifact: boolean, 当前文件是否在该项目声明的 files 清单里
 *   prefix: string, allowlist: string[], topLevelMustBeEmpty: boolean,
 *   files: string[], configPath: string, relFromConfig: string, source: string
 * }}
 *   `isDeclaredArtifact` 必须为 true 才允许套用 prefix / 顶层零声明：`files` 清单就是
 *   「哪些文件是拼接产物」的声明——不在清单里的文件（如分片源码）套用前缀会把
 *   片段里的局部变量全部误判成缺前缀。
 */
export function readProjectScopePolicy(file = '') {
  const target = resolve(file);
  const builtin = {
    declared: false,
    isDeclaredArtifact: false,
    prefix: '',
    allowlist: [],
    topLevelMustBeEmpty: false,
    files: [],
    configPath: '',
    relFromConfig: '',
    source: POLICY_SOURCE.BUILTIN,
  };
  const configPath = findConfigPath(dirname(target), Date.now());
  if (!configPath) return builtin; // 一路到根都没有 package.json ⇒ 按「无声明」处理
  let own;
  try {
    own = JSON.parse(readFileSync(configPath, 'utf8'))?.dshScopeCheck;
  } catch {
    return builtin; // package.json 损坏 → 按「无声明」处理，不抛给调用方
  }
  if (!own || typeof own !== 'object') return builtin; // 找到所属项目但没声明 ⇒ 不套别人的规范
  const files = Array.isArray(own.files) ? own.files.map(String) : [];
  const configDir = dirname(configPath);
  const relFromConfig = normRelPath(relative(configDir, target));
  return {
    declared: true,
    isDeclaredArtifact: files.some((rel) => normRelPath(rel) === relFromConfig),
    prefix: String(own.prefix || ''),
    allowlist: Array.isArray(own.allowlist) ? own.allowlist.map(String) : [],
    topLevelMustBeEmpty: own.topLevelMustBeEmpty === true,
    files,
    configPath,
    relFromConfig,
    source: POLICY_SOURCE.PROJECT,
  };
}
