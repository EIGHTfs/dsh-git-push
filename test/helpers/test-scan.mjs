/**
 * 测试树扫描：递归收集 `test/` 下所有 `test-*.mjs`，并区分「常规回归」与「归档」。
 *
 * 为什么要有这个模块（而不是直接写在 run-tests.mjs 里）：
 *   扫描逻辑是「漏跑」的唯一入口——它一旦只扫顶层，把测试移进子目录就等于让它们静默消失，
 *   而报告仍然全绿。这种代码必须能被单元测试直接调（见 test/test-run-tests-scan.mjs），
 *   塞在入口脚本里就只能靠「跑一遍全量看数字」间接验证，太贵也太晚。
 *
 * 结构约定（三层）：
 *   test/<side>/test-*.mjs          常规回归（side ∈ git / audit / tool / app）
 *   test/<side>/_archived/*.mjs     归档：**不参与**常规回归，可手动跑（断言当前不成立）
 *   test/helpers、test/fixtures     共享代码与夹具，永远不当作测试
 *   test/test-*.mjs                 **禁止**：新旧结构并存会让同一测试跑两遍/缓存键冲突
 *
 * 归档目录名固定为 `_archived`（下划线开头，readdir 排序时自然靠前，肉眼也好认）。
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** 测试文件名形状：`test-*.mjs`（与历史约定一致，入口脚本自身 run-tests.mjs 不匹配）。 */
/** 回归入口文件名：顶层唯一允许存在的 .mjs */
const ENTRY_FILE_NAME = 'run-tests.mjs';

const TEST_FILE_PATTERN = /^test-.+\.mjs$/;

/** 归档目录名（出现在任意层级都按归档处理，且不再计入回归）。 */
export const ARCHIVED_DIR = '_archived';

/** 永不当作测试的共享目录（夹具/辅助代码）。 */
export const SHARED_DIRS = new Set(['helpers', 'fixtures']);

/**
 * 递归扫描测试树。
 * @param {string} testDir `test/` 目录的绝对路径
 * @returns {{
 *   regular: string[],           常规回归文件（绝对路径，已排序）
 *   archived: string[],          归档文件（绝对路径，已排序；不进回归）
 *   bySide: Record<string, {regular: string[], archived: string[]}>,  按一级子目录分组的相对路径
 *   violations: string[],        结构违规（顶层出现 test-*.mjs 等），非空即应判失败
 * }}
 */
export function scanTestTree(testDir) {
  const regular = [];
  const archived = [];
  const violations = [];
  const bySide = {};

  const noteSide = (side, kind, absPath) => {
    if (!bySide[side]) bySide[side] = { regular: [], archived: [] };
    bySide[side][kind].push(relative(testDir, absPath).split(sep).join('/'));
  };

  /** 递归遍历（不跟随符号链接；CIFS 上符号链接会退化成普通文件，跟随只会带来歧义）。 */
  const walk = (dirAbs, depth, insideArchived) => {
    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return; // 目录不存在/无权限：跳过而不是崩（扫描器不该因为缺目录让整轮回归失败）
    }
    for (const entry of entries) {
      const abs = join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        if (SHARED_DIRS.has(entry.name)) continue; // helpers/fixtures 永不参与
        walk(abs, depth + 1, insideArchived || entry.name === ARCHIVED_DIR);
        continue;
      }
      // 顶层：除回归入口外**不允许任何 .mjs**（不只是 test-*.mjs）。
      //  为什么必须这么严：曾有两个测试文件命名为 e2e-*.mjs / regression-*.mjs，
      //  不匹配 TEST_FILE_PATTERN 就被 `continue` 静默跳过 —— 既不进 regression、也不报违规，
      //  长期空转（12 个用例）无人察觉。判定必须放在 TEST_FILE_PATTERN 过滤**之前**。
      if (depth === 0 && entry.name.endsWith('.mjs') && entry.name !== ENTRY_FILE_NAME) {
        violations.push(relative(testDir, abs).split(sep).join('/'));
        continue;
      }
      if (!TEST_FILE_PATTERN.test(entry.name)) continue;
      if (insideArchived) {
        archived.push(abs);
        if (depth >= 1) noteSide(relative(testDir, dirAbs).split(sep)[0], 'archived', abs);
        continue;
      }
      if (depth === 0) {
        // 顶层出现 test-*.mjs：结构违规（新旧并存 → 可能跑两遍 / 缓存键冲突）
        violations.push(relative(testDir, abs).split(sep).join('/'));
        continue;
      }
      regular.push(abs);
      noteSide(relative(testDir, dirAbs).split(sep)[0], 'regular', abs);
    }
  };

  walk(testDir, 0, false);
  regular.sort();
  archived.sort();
  return { regular, archived, bySide, violations };
}

/**
 * 目录结构门禁：顶层不得再有 `test-*.mjs`，且每个常规测试都必须在一级子目录里。
 * @param {{violations: string[]}} scan scanTestTree 的返回值
 * @returns {string[]} 违规清单（空 = 通过）
 */
export function structureViolations(scan) {
  return [...(scan.violations || [])];
}

/**
 * 给某个文件取「所属侧」（一级子目录名）；顶层文件返回空串。
 * @param {string} testDir
 * @param {string} absPath
 * @returns {string}
 */
export function sideOf(testDir, absPath) {
  const parts = relative(testDir, absPath).split(sep);
  return parts.length > 1 ? parts[0] : '';
}

/** 判断路径是否存在且是目录（供调用方判断 test/ 结构是否已迁移）。 */
export function isDirectory(dirPath) {
  try { return statSync(dirPath).isDirectory(); } catch { return false; }
}
