/**
 * 客户端分片构建（C8 前提①：构建链落地）
 *
 * 背景与目标（任务.md C8）：`lib/client.js` 2585 行整文件入库、没有构建脚本，
 *   维护它是「改一处要看整份 2500 行」。改为**分片源码 + 拼接构建**：
 *   源码在 `lib/client-parts/**.js`（git 维护），`lib/client.js` 是**产物**。
 *
 * ⛔ 形态铁律（client-modules 聚合 bundle 兼容，见 client.js 头部注释）：
 *   1. `window.__ModuleLoader__.load` 必须是产物里的**第一条语句**；
 *   2. 全部代码在 `factory` 函数体内，文件顶层【零声明】（防 combo 拼接撞名）；
 *   3. 内部命名统一 `dshgp_` 前缀。
 *   ⇒ 分片是**片段**（fragment）：单个分片不是合法 JS（首片开工厂、尾片收工厂），
 *     只有按 PART_ORDER 拼起来才是完整文件。因此 `scripts/check.mjs` 必须排除
 *     `lib/client-parts/`，语法检查只对**产物**做。
 *
 * 产物**逐字节可复现**：分片是原文件的精确切片，拼接即原样还原（`--check` 可校验）。
 *
 * 用法：
 *   node scripts/build-client.mjs            # 校验产物与分片是否一致，不一致则写回
 *   node scripts/build-client.mjs --check    # 只校验（CI/提交门禁用；不一致 exit 1）
 *   node scripts/build-client.mjs --print    # 只打印产物到 stdout（不落盘）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PARTS_DIR = join(ROOT, 'lib', 'client-parts');
export const OUT_FILE = join(ROOT, 'lib', 'client.js');

/**
 * 拼接顺序 = 依赖顺序（先定义后使用）。
 * 函数声明会提升、但 `const`/`let` 不会——顺序错会在**运行时**才炸（静态查不出），
 * 所以这里与 client.js 的分节标记 `[N]` 一一对应，改分片必须同步改本表。
 */
export const PART_ORDER = [
  '00-loader.js',   // loader + factory 头 + require + NS（必须首片）
  '01-const.js',    // [1] 常量区（BUSY/维度表/超时/样式串）
  '02-utils.js',    // [2] 工具区（ensureCss/getJson/postJson/tokenConfigured/localGet…）
  '03-icons.js',    // [3] 图标区
  '10-account.js',  // [4] 账号信息 Tab
  '11-browser.js',  // [5] 目录选择器
  '20-repo.js',     // [6] 仓库管理卡
  '21-audit.js',    // [7] 审计 Tab
  '22-settings.js', // [8] 设置 Tab
  '30-page.js',     // [9] 页面装配（GitPushPage）
  '40-controller.js', // [10] Controller：状态机 + 数据加载
  '41-actions.js',    // [10续] Controller：动作注入
  '99-apply.js',    // 收尾：注册 settings.section + factory 返回（必须末片）
];

/** 读出全部分片内容（缺片直接报错，避免拼出半份产物当成功）。 */
export function readParts(order = PART_ORDER, dir = PARTS_DIR) {
  const missing = order.filter((f) => !existsSync(join(dir, f)));
  if (missing.length) throw new Error(`缺分片：${missing.join(' / ')}（先按 PART_ORDER 建齐，再构建）`);
  const extra = readdirSync(dir).filter((f) => f.endsWith('.js') && !order.includes(f));
  if (extra.length) throw new Error(`分片未登记进 PART_ORDER：${extra.join(' / ')}（未登记 = 不会进入产物，属静默丢失）`);
  return order.map((f) => readFileSync(join(dir, f), 'utf8'));
}

/** 拼接产物。分片自带行尾，直接相接即为完整文件（**零加工**：不加头尾换行/不加分隔符）。
 *  ⚠️ 原文件不以换行结尾（163020 字节，末行无 \n）——构建若补换行会导致产物比原文多一字节，
 *     cmp 直接抓到。等价性要求「拼接 = 原文」，任何后处理都会破坏它。 */
export function buildClient(order = PART_ORDER, dir = PARTS_DIR) {
  const parts = readParts(order, dir);
  return parts.join('');
}

/** 形态铁律自检：产物第一条语句必须是 __ModuleLoader__.load，且含 factory 收尾。 */
export function checkShape(code) {
  const errs = [];
  const firstStmt = code.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trimStart();
  if (!/^window\.__ModuleLoader__\.load\(/.test(firstStmt)) {
    errs.push('产物第一条语句不是 window.__ModuleLoader__.load(...)（第 1 条形态铁律）');
  }
  if (!/^\}\)\(\);\s*$/m.test(code.trimEnd().split('\n').slice(-3).join('\n') + '\n')) {
    // 宽松校验：末尾应能闭合 factory 调用
    if (!/\)\s*;?\s*$/.test(code.trimEnd())) errs.push('产物末尾不像闭合的 load({...}) 调用');
  }
  return errs;
}

function main(argv = process.argv.slice(2)) {
  const checkOnly = argv.includes('--check');
  const printOnly = argv.includes('--print');
  let built;
  try {
    built = buildClient();
  } catch (e) {
    console.error(`❌ ${e.message}`);
    return 1;
  }
  const errs = checkShape(built);
  if (errs.length) {
    console.error('❌ 形态铁律自检失败：');
    for (const e of errs) console.error(`   · ${e}`);
    return 1;
  }
  if (printOnly) { process.stdout.write(built); return 0; }
  const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : '';
  if (current === built) {
    console.log(`✅ 产物与分片一致（${built.split('\n').length - 1} 行，${PART_ORDER.length} 个分片）`);
    return 0;
  }
  if (checkOnly) {
    const a = current.split('\n').length - 1;
    const b = built.split('\n').length - 1;
    console.error(`❌ 产物与分片不一致（现存 ${a} 行 / 应为 ${b} 行）——请跑 node scripts/build-client.mjs 重新生成`);
    return 1;
  }
  writeFileSync(OUT_FILE, built, 'utf8');
  console.log(`✅ 已生成 lib/client.js（${built.split('\n').length - 1} 行，${PART_ORDER.length} 个分片）`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
