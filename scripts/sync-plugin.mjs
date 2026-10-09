/**
 * 双副本同步脚本（1.0.0）
 *
 * 源 = 本仓库（脚本所在插件仓库根）
 * 目标 = DSH 插件目录（.dsh/profiles/<profile>/node_modules/<插件名>）
 *
 * 默认 **dryRun**（只打印将要同步的差异，不写入）；`--write` 才真同步。
 * 同步内容：lib/**  skills/**  scripts/**  cli.mjs  package.json  cordis.patch.yml  README.md
 * 排除：.git  node_modules  docs/WORKBOARD*（开发看板不随插件发布）test/**
 *
 * 用法：
 *   node scripts/sync-plugin.mjs                    # dry-run（默认）
 *   node scripts/sync-plugin.mjs --write            # 真同步
 *   node scripts/sync-plugin.mjs --target <目录>    # 指定目标（默认自动探测）
 *   node scripts/sync-plugin.mjs --source <目录>    # 指定源插件仓库（默认本仓库）；
 *                                                   # 目标未显式给时按源目录名自动探测双副本
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { mkdir, readFile, chmod } from 'node:fs/promises';
// 目标目录常在工作区（CIFS 网络挂载）：copyFileSync 在 CIFS 内会 EPERM
//   （尝试 SMB 服务端复制），必须用带读写回退的 copyFileCompat。
import { copyFileCompat } from '../lib/fsx.js';
import { readdir, stat, access } from 'node:fs/promises';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
// 安装形态与免重启热重载自检（2026-10-09 拆出，见 scripts/sync-plugin-install.mjs 顶部说明）
import { dshRootOf, profilesDirOf, inspectProfiles, readHmrConfig, judgeHmr, planInstall, applyInstall, depHints, pickProfile } from './sync-plugin-install.mjs';

export const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 随插件发布的顶层条目（通用候选：按源目录存在性过滤，兼容任意 DSH 插件）。
 *   候选含 lib/skills/scripts/assets/tools/cli.mjs/package.json/cordis.patch.yml/
 *   README.md/.auditignore/.gitignore——源里没有的条目自动跳过。 */
export const SYNC_ENTRIES = ['lib', 'skills', 'scripts', 'assets', 'tools', 'cli.mjs', 'package.json', 'cordis.patch.yml', 'README.md', '.auditignore', '.gitignore'];

/**
 * npm 打包的**硬性排除项**（npm-packlist 默认忽略集，与项目自定义无关）。
 *
 * 【设计】同步清单的唯一权威 = 源项目 package.json 的 `files` 字段（npm 发布语义）：
 *   「要发布什么，就写进 files」；同步工具**不维护任何自定义排除表**。
 *
 *   为什么删掉旧的自定义排除（2026-10-07 事故）：旧实现在 `files` 白名单之外另有一套
 *   子串排除 `['.git','node_modules','WORKBOARD','test','.tmp','.bak','.trash']`，
 *   判定写成 `rel.split('/').includes(x) || rel.includes(x)`——`rel.includes('test')`
 *   把随插件发布的正式模块 `lib/shared/test-hooks.js` 当成 test 目录排掉了。后果：
 *   同步报「成功」、安装副本却少一个文件，两个版本之间 lib/ 永远对不齐（只有逐文件
 *   diff 副本才发现，宿主运行看不出）。教训：**发布内容只由 package.json 决定**，
 *   `files` 白名单与自定义排除表是两套真相，必然分叉——排除只保留 npm 自己的硬规则。
 */
export const NPM_ALWAYS_IGNORE_SEGMENTS = ['.git', 'node_modules', '.DS_Store', '.npmrc', 'package-lock.json'];
/** npm 硬性忽略的后缀型条目（编辑器交换/备份文件）。 */
export const NPM_ALWAYS_IGNORE_SUFFIX = ['.orig', '.swp'];

/**
 * 该相对路径是否命中 npm 硬性排除项（目录遍历与单测共用同一判定，避免规则再次分叉）。
 * @param {string} rel 相对插件根的路径（POSIX 分隔符）
 * @returns {boolean} true = npm 不会打包它，同步也不复制
 */
export function isNpmIgnored(rel) {
  const segments = String(rel).split('/');
  return NPM_ALWAYS_IGNORE_SEGMENTS.some((x) => segments.includes(x))
    || NPM_ALWAYS_IGNORE_SUFFIX.some((x) => String(rel).endsWith(x));
}

/** 异步探测路径是否存在（node:fs/promises 不提供 exists）。 */
async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

/**
 * 随插件发布的顶层条目 = 源项目 package.json 的 `files` 白名单（每个插件自行声明
 * 发布内容，与 npm 打包语义一致）；另强制包含 package.json 本身（部署副本加载必需）。
 * files 缺失或读取失败时兜底保守最小集 ['lib', 'cordis.patch.yml']。
 * @param {string} root 源仓库根
 * @returns {string[]} 应同步的顶层条目
 */
export async function packageFilesOf(root) {
  let files = [];
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (Array.isArray(pkg.files) && pkg.files.length > 0) files = pkg.files;
  } catch {
    // 读失败 → 走兜底最小集
  }
  if (files.length === 0) {
    // npm 语义：未声明 `files` = 发布「除默认忽略项以外的一切」；安装副本**不照做**
    //   （那会把 test/、docs/、开发归档一起灌进宿主副本），退化为候选白名单并提示补声明。
    console.warn('[sync-plugin] ⚠️ package.json 未声明 files —— 按保守白名单同步；建议按 npm 规范补上 files 字段');
    files = SYNC_ENTRIES;
  }
  // package.json 永远随包（npm 语义：始终包含）——部署副本靠它识别插件与版本。
  return Array.from(new Set([...files, 'package.json']));
}

/**
 * 递归列出源目录下应同步的文件（相对路径）。
 * @param {string} root 源根
 * @returns {string[]} 相对路径列表
 */
export async function listSyncFiles(root = SOURCE_ROOT) {
  const out = [];
  // 递归遍历目录：改异步以免在大目录上逐项阻塞事件循环
  //   （readdir 带 withFileTypes，目录项类型由一次调用带回，无需再逐个 stat）
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (isNpmIgnored(rel)) continue;
      if (entry.isDirectory()) await walk(full);
      else out.push(rel);
    }
  };
  for (const entryName of await packageFilesOf(root)) {
    const full = join(root, entryName);
    if (!(await exists(full))) continue;
    if ((await stat(full)).isDirectory()) await walk(full);
    else out.push(entryName);
  }
  return out.sort();
}

/**
 * 探测 DSH 插件目录。
 *
 * **两个位置都要同步**（最大教训：只同步 node_modules 导致改动看不到）：
 *   1) `<profile>/local-plugins/<插件名>`  ← **真实加载源**（profile 的 package.json
 *      写的是 `"<插件名>": "file:./local-plugins/<插件名>"`，DSH 加载这里）
 *   2) `<profile>/node_modules/<插件名>`   ← npm link 产物（部分运行路径会解析到这里）
 *
 * 历史上 UI 改动「刷新看不到」，根因就是只 rsync 了 node_modules。
 * @param {string} [home] DSH_HOME（默认从环境变量推断）
 * @param {string} [pluginName] 插件名
 * @returns {string[]} 命中的目标目录（local-plugins 在前）
 */
export function detectTargets(home = process.env.DSH_HOME || '', pluginName = '', profileName = '') {
  const hits = [];
  if (!home || !pluginName) return hits;
  // 2026-10-09 入参归一：DSH 自己的 DSH_HOME **含** `.dsh`，而本函数原先一律按「不含 .dsh」拼接
  //   ⇒ 直接传 $DSH_HOME 会拼成 `…/.dsh/.dsh/profiles`、探测为空（开发者文档 §5.1 记录的坑）。
  //   现按实存目录判定两种形态；多 profile 时可用 profileName 只看指定 profile（§5.2：自动取首个会选错）。
  const profiles = profilesDirOf(home);
  if (!profiles || !existsSync(profiles)) return hits;
  for (const profile of readdirSync(profiles, { withFileTypes: true })) {
    if (!profile.isDirectory()) continue;
    if (profileName && profile.name !== profileName) continue;
    const base = join(profiles, profile.name);
    // 真实加载源优先（package.json 的 file: 指向这里）
    const local = join(base, 'local-plugins', pluginName);
    if (existsSync(local)) hits.push(local);
    // npm link 产物（保留：部分解析路径走这里）
    const nm = join(base, 'node_modules', pluginName);
    if (existsSync(nm)) hits.push(nm);
  }
  return hits;
}

/**
 * 同步（dry-run 或真写入）。
 * @param {object} p { source, target, write }
 * @returns {{ok: boolean, written: number, skipped: number, files: string[], error?: string}}
 */
/**
 * 两文件内容是否相同；目标不存在返回 false。
 *   读失败（权限/编码）按「不相同」处理 —— 交给后续复制去覆盖并上报真实错误，
 *   避免在这里吞掉问题。
 */
async function fileContentEqual(from, to) {
  try {
    // 异步函数内同步 existsSync 改 fs.promises.access（消除阻塞事件循环）
    try { await access(to); } catch { return false; }
    const [a, b] = await Promise.all([readFile(from, 'utf8'), readFile(to, 'utf8')]);
    return a === b;
  } catch {
    return false;
  }
}

export async function syncPlugin({ source = SOURCE_ROOT, target = '', write = false } = {}) {
  if (!target) return { ok: false, written: 0, skipped: 0, files: [], error: '未指定目标目录（用 --target 或配置 DSH_HOME）' };
  const files = await listSyncFiles(source);
  let written = 0;
  let skipped = 0;
  const failures = [];
  for (const rel of files) {
    const from = join(source, rel);
    const to = join(target, rel);
    // 内容不同才写（幂等）
    // 逐文件比较内容（幂等）：改 await 后单次遍历不再阻塞事件循环
    const same = await fileContentEqual(from, to);
    if (same) { skipped++; continue; }
    if (write) {
      await mkdir(dirname(to), { recursive: true });
      const r = copyFileCompat(from, to);
      if (!r.ok) {
        // 单个文件失败不再抛出中断整个同步：记录后继续，最后统一上报。
        failures.push({ file: rel, error: r.error });
        continue;
      }
      // cli.mjs 是 bin（git-sluice）入口，需可执行权限（shebang 执行）。
      //   copyFile 不带原文件 mode，同步后恢复 +x（幂等 chmod；失败不阻塞）。
      if (rel === 'cli.mjs' || rel.endsWith('/cli.mjs')) {
        try { await chmod(to, 0o755); } catch { /* 权限恢复失败不强拦 */ }
      }
    }
    written++;
  }
  return { ok: failures.length === 0, written, skipped, files, failures };
}

/** CLI 入口。支持 --source <目录>（缺省=本仓库）、--target <目录>（缺省=自动探测）、
 *  --profile <名>（多 profile 时显式指定）、--write（真写）、--fix（按目标形态修正安装位置，含 --write 语义）。 */
export async function main(argv = process.argv.slice(2)) {
  const fix = argv.includes('--fix');
  const write = argv.includes('--write') || fix;
  const si = argv.indexOf('--source');
  const source = si >= 0 ? argv[si + 1] : SOURCE_ROOT;
  const ti = argv.indexOf('--target');
  const pi = argv.indexOf('--profile');
  const profileName = pi >= 0 ? argv[pi + 1] : '';
  const home = process.env.DSH_HOME || '';
  const pluginName = basename(source);
  // 2026-10-09：按 profile 探测（多 profile 时自动取首个会选错——开发者文档 §5.2 已记录该坑）
  const profiles = inspectProfiles(home);
  const picked = profileName
    ? { dir: (profiles.find((p) => p.name === profileName) || {}).dir || '', profile: profileName, reason: '按 --profile 指定' }
    : pickProfile(profiles, pluginName);
  if (!ti && picked.ambiguous) {
    console.log(`"${pluginName}" 在多个 profile 都有副本：${(picked.candidates || []).join(' / ')}`);
    console.log('请显式指定：--profile <名>（或 --target <目录>）');
    return 1;
  }
  const hits = detectTargets(home, pluginName, profileName || picked.profile || '');
  const target = ti >= 0 ? argv[ti + 1] : (hits[0] || '');
  const pd = picked.dir || (profiles.find((p) => p.dir === dirname(dirname(target))) || {}).dir || '';
  if (!ti && !target) {
    console.log(`未探测到 "${pluginName}" 的部署副本：${picked.reason}`);
    if (profiles.length) console.log(`  共 ${profiles.length} 个 profile：${profiles.map((p) => p.name).join(' / ')}`);
    console.log('请显式指定：--profile <名>（或 --target <目录>）');
    return 1;
  }
  const r = await syncPlugin({ source, target, write });
  if (!r.ok) {
    console.log(`同步未执行：${r.error}`);
    console.log(`可用目标（自动探测）：${hits.join(' | ') || '(无)'}`);
    return 1;
  }
  console.log(`双副本同步${write ? '' : '（dry-run，加 --write 才写）'}`);
  console.log(`  源：${source}`);
  console.log(`  目标：${target}`);
  console.log(`  待写 ${r.written} 个文件，已一致 ${r.skipped} 个`);
  for (const f of r.files.slice(0, 10)) console.log(`    - ${f}`);
  if (r.files.length > 10) console.log(`    … 共 ${r.files.length} 个`);
  // ── 安装形态 + 免重启热重载自检 + 依赖声明（2026-10-09：把开发者文档 §3.1/§3.2/§5 的检查内置）──
  if (pd) {
    const hmr = readHmrConfig(pd);
    const verdict = judgeHmr({ hmr, profileDir: pd, pluginName });
    console.log(`  profile：${pd}`);
    console.log(`  免重启热重载：${verdict.hot ? '✅ 可（改代码后同步即生效）' : `❌ 不可 —— ${verdict.reason}`}`);
    const actions = planInstall({ profileDir: pd, pluginName });
    if (actions.length) {
      console.log('  安装形态待办（目标：local-plugins 真实目录 + node_modules 相对软链）：');
      for (const a of actions) console.log(`    · [${a.kind}] ${a.desc}`);
      if (fix) {
        const res = applyInstall(actions, { on: true });
        console.log(`    已执行：${res.done.join(', ') || '（无）'}${res.skipped.length ? `｜跳过：${res.skipped.join(', ')}` : ''}`);
      } else {
        console.log('    （加 --fix 才执行：删软链/建相对链，真实文件由上面的同步步骤落盘）');
      }
    }
    for (const h of depHints(pd, pluginName)) console.log(`  ⚠️ ${h}`);
  }
  return 0;
}

// 顶层 await：main 已异步，未 await 的话 rejection 会成为 unhandled rejection
//   （进程静默退出，退出码不对），故显式 await 并回传退出码。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
