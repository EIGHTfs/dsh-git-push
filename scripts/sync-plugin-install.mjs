/**
 * 插件部署形态与 HMR 自检（sync-plugin 的安装位置逻辑，2026-10-09 拆出）
 *
 * 背景（来源：开发者文档《DSH 插件免重启热重载 —— 打通方法与两个必要条件》）：
 *   服务端插件代码要**免重启热重载**，必须同时满足两条，缺一不可：
 *     ① hmr 插件要显式配 `root`（base bundle 默认 `root: []` = 「module roots are opt-in」，一个模块目录都不 watch）；
 *     ② 插件本体要放在 `<profile>/local-plugins/`，**不能只放 node_modules**
 *        （hmr 的 ignored 默认含 `node_modules/**`，chokidar 遇到该目录整棵剪枝——
 *          想「只放行 node_modules 下某个插件」的否定写法也无效）。
 *   另外 `config.base` 是相对 **hmr 自己的包位置**解析的（不是相对 profile），
 *   所以只写 `root: ['local-plugins']` 会解析到 `node_modules/@deepseek-ai/dsh-hmr/local-plugins` —— 必须同时给 base。
 *
 * 本模块只做「看清楚 + 给方案 + 按需执行」：
 *   inspectProfiles  列 profile 与插件双副本形态
 *   readHmrConfig    读该 profile 的 cordis.patch.yml 里 id: hmr 的 base/root
 *   judgeHmr         判定「这个插件改代码是否需要重启」
 *   planInstall      目标形态与现状的差异清单（默认只报告）
 *   applyInstall     按 on/off 执行安装形态动作（用改动本体的 sync 步骤落真实文件）
 *   depHints         package.json 依赖声明是否还指向 node_modules / 绝对 link:
 */
import { existsSync, readdirSync, lstatSync, readlinkSync, unlinkSync, symlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** DSH 数据根（含 .dsh 的那一层）。兼容两种入参形态：
 *   A) DSH_HOME 本尊：`…/0.2.0-rc.2`        → profiles 在 `<h>/.dsh/profiles`
 *   B) 已含 .dsh 的路径：`…/0.2.0-rc.2/.dsh` → profiles 在 `<h>/profiles`
 *   两种都探测不到时按 A 返回（保持既有调用方行为），由上层报「探测为空」。 */
export function dshRootOf(home = process.env.DSH_HOME || '') {
  const h = String(home || '').trim();
  if (!h) return '';
  if (existsSync(join(h, '.dsh', 'profiles'))) return join(h, '.dsh');
  if (existsSync(join(h, 'profiles'))) return h;
  return join(h, '.dsh');
}

/** profiles 目录。 */
export function profilesDirOf(home = process.env.DSH_HOME || '') {
  const root = dshRootOf(home);
  return root ? join(root, 'profiles') : '';
}

/** 列各 profile 及其中 local-plugins 的概况（供「多 profile 要显式指定」的提示）。 */
export function inspectProfiles(home = process.env.DSH_HOME || '') {
  const dir = profilesDirOf(home);
  const out = [];
  if (!dir || !existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const pd = join(dir, e.name);
    const localDir = join(pd, 'local-plugins');
    let localPlugins = [];
    try { localPlugins = readdirSync(localDir, { withFileTypes: true }).filter((x) => x.isDirectory() || x.isSymbolicLink()).map((x) => x.name); } catch { localPlugins = []; }
    out.push({ name: e.name, dir: pd, localDir, localPlugins });
  }
  return out;
}

/**
 * 读 profile 的 hmr 配置（cordis.patch.yml 的 `- id: hmr` 块）。
 * 文本扫描而非引 YAML 依赖：只需要 base / root 两项，且该文件由插件管理器生成、结构稳定。
 */
export function readHmrConfig(profileDir, home = process.env.DSH_HOME || '') {
  const baseDir = profileDir || join(profilesDirOf(home), 'web');
  const f = join(baseDir, 'cordis.patch.yml');
  if (!existsSync(f)) return { found: false, profileDir: baseDir, base: '', root: [], reason: '该 profile 没有 cordis.patch.yml' };
  let text = '';
  try { text = readFileSync(f, 'utf8'); } catch { return { found: false, profileDir: baseDir, base: '', root: [], reason: 'cordis.patch.yml 读失败' }; }
  const i = text.search(/^-\s*id:\s*hmr\s*$/m);
  if (i < 0) {
    return { found: false, profileDir: baseDir, base: '', root: [], reason: '未配置 id: hmr —— hmr 默认 root:[] 只重载 profile 配置，不 watch 任何模块目录' };
  }
  const rest = text.slice(i);
  const nextIdx = rest.slice(1).search(/^-\s/m);
  const block = nextIdx < 0 ? rest : rest.slice(0, nextIdx + 1);
  const base = ((block.match(/^[ \t]*base:[ \t]*(\S+)[ \t]*$/m) || [])[1] || '');
  // ⚠️ 这里不能用 \s*（\s 含换行，会把 root: 后的换行也吃掉，导致再要求 \n 时匹配失败）——只吃行内空白。
  const rootBlock = ((block.match(/^[ \t]*root:[ \t]*\r?\n((?:[ \t]+-[ \t]*\S+[ \t]*\r?\n?)+)/m) || [])[1] || '');
  const root = [...rootBlock.matchAll(/-[ \t]*(\S+)/g)].map((m) => m[1]);
  return { found: true, profileDir: baseDir, base, root, reason: '' };
}

/**
 * 判定「该插件改代码是否需要重启」。
 * @param {{hmr: object, profileDir: string, pluginName: string}} p
 * @returns {{hot: boolean, reason: string, dir?: string}}
 */
export function judgeHmr({ hmr, profileDir, pluginName }) {
  if (!pluginName) return { hot: false, reason: '未给出插件名' };
  if (!hmr || !hmr.found) return { hot: false, reason: (hmr && hmr.reason) || '未读到 hmr 配置（默认不 watch 模块目录）' };
  const base = hmr.base || profileDir || '';
  if (!hmr.root.length) {
    return { hot: false, reason: 'hmr.root 为空 —— module roots are opt-in：配了 base 也必须显式列出要 watch 的目录' };
  }
  const roots = hmr.root.map((r) => resolve(base, r));
  const localDir = join(base, 'local-plugins', pluginName);
  const nmDir = join(base, 'node_modules', pluginName);
  const inRoot = (p) => roots.some((r) => p === r || p.startsWith(r + sep));
  // 判据必须**先确认真实存在**：只看路径前缀会把「名字恰好落在 root 下、其实没装」也判成可热重载（单测抓到过）。
  if (existsSync(localDir) && inRoot(localDir)) {
    return { hot: true, reason: `命中所配 root（${hmr.root.join(' / ')}）且不经 node_modules ⇒ 改代码可免重启热重载`, dir: localDir };
  }
  if (existsSync(nmDir)) {
    return { hot: false, reason: `插件只落在 node_modules（${nmDir}）—— hmr 的默认 ignored 会整棵剪枝该目录（否定写法同样无效），需按目标形态挪到 local-plugins` };
  }
  if (!existsSync(localDir)) {
    return { hot: false, reason: `未在 ${localDir} 找到该插件（看起来没装到该 profile）` };
  }
  return { hot: false, reason: `插件在 local-plugins，但该目录不在所配 root 覆盖范围内（root=${hmr.root.join(',')}）` };
}

/** lstat 包装：不存在返回 null（符号链接本身用 lstat 判断）。 */
function lstatOrNull(p) {
  try { return lstatSync(p); } catch { return null; }
}

/**
 * 目标形态（对照文档 §3.2）与现状的差异清单。默认只报告，不执行。
 *   目标：`<profile>/local-plugins/<插件>` 为**真实目录**；`<profile>/node_modules/<插件>` 为**相对软链**指回去。
 * @returns {Array<{kind: string, path: string, desc: string}>}
 */
export function planInstall({ profileDir, pluginName }) {
  const actions = [];
  if (!profileDir || !pluginName) return actions;
  const local = join(profileDir, 'local-plugins', pluginName);
  const nm = join(profileDir, 'node_modules', pluginName);
  const ls = lstatOrNull(local);
  if (ls && ls.isSymbolicLink()) {
    actions.push({ kind: 'delink-local', path: local, desc: 'local-plugins 下是软链：真实加载源应是**真实目录**（执行时会先删链再落一份真实副本）' });
  } else if (!ls) {
    actions.push({ kind: 'create-local', path: local, desc: 'local-plugins 下缺该插件：需先同步一份真实目录（HMR 的覆盖点与真实加载源都在这里）' });
  }
  const ns = lstatOrNull(nm);
  if (ns && ns.isSymbolicLink()) {
    let t = '';
    try { t = readlinkSync(nm); } catch { t = ''; }
    if (!t.startsWith('.')) {
      actions.push({ kind: 'relink-nm', path: nm, desc: `node_modules 下是绝对软链（→ ${t}）：应改相对链 ../local-plugins/${pluginName}（换机/换卷仍有效）` });
    }
  } else if (!ns) {
    actions.push({ kind: 'link-nm', path: nm, desc: `node_modules 下缺软链：应建相对链 ../local-plugins/${pluginName}` });
  } else {
    actions.push({ kind: 'dir-nm', path: nm, desc: 'node_modules 下是真实目录：按目标形态应让真实源落在 local-plugins、这里只留相对软链（本工具不自动搬移，避免动到既有数据）' });
  }
  return actions;
}

/**
 * 执行安装形态动作（仅在调用方传入 on=true 时写盘）。
 *   delink-local：删软链（真实内容由后续同步步骤落进来）
 *   create-local：建目录（同上）
 *   relink-nm / link-nm：替换/新建相对软链
 *   dir-nm：只报告（搬移真实目录有数据风险，交给人工或既有搬迁流程）
 * @returns {{done: string[], skipped: string[]}}
 */
export function applyInstall(actions, { on = false } = {}) {
  const done = [];
  const skipped = [];
  for (const a of actions) {
    if (!on || a.kind === 'dir-nm') { skipped.push(a.kind); continue; }
    try {
      if (a.kind === 'delink-local') {
        unlinkSync(a.path);                    // 只删软链本身，不触及它指向的任何内容
        mkdirSync(a.path, { recursive: true });
      } else if (a.kind === 'create-local') {
        mkdirSync(a.path, { recursive: true });
      } else if (a.kind === 'relink-nm') {
        unlinkSync(a.path);
        symlinkSync(join('..', 'local-plugins', a.path.split(sep).pop()), a.path);
      } else if (a.kind === 'link-nm') {
        symlinkSync(join('..', 'local-plugins', a.path.split(sep).pop()), a.path);
      }
      done.push(a.kind);
    } catch (e) {
      skipped.push(`${a.kind}(${String(e && e.message).slice(0, 60)})`);
    }
  }
  return { done, skipped };
}

/**
 * 依赖声明提示：profile 的 package.json 里该插件若写成 `link:<绝对路径>` 或 `file:node_modules/...`，
 * 应改为 `file:local-plugins/<插件>`（否则 profile 解析到的不是真实加载源）。
 * @returns {string[]} 提示行（空数组 = 无需改）
 */
export function depHints(profileDir, pluginName) {
  const out = [];
  if (!profileDir || !pluginName) return out;
  const f = join(profileDir, 'package.json');
  if (!existsSync(f)) return out;
  let deps = {};
  try { deps = { ...(JSON.parse(readFileSync(f, 'utf8')).dependencies || {}) }; } catch { return out; }
  const val = deps[pluginName];
  if (typeof val !== 'string') return out;
  const want = `file:local-plugins/${pluginName}`;
  if (val !== want) {
    out.push(`依赖声明应改为 "${pluginName}": "${want}"（当前 "${val}"）`);
  }
  return out;
}

/**
 * 从多 profile 里选出「该插件的正确部署 profile」。
 *
 * 为什么需要：自动探测原先取首个命中，而本机多个 profile 都可能残留同名副本（旧副本/测试 profile），
 *   选中错的 profile 会同步到错的地方、并把「未配 hmr」等结论也判错（dry-run 实测踩到过）。
 *   判据按可靠性排序：① 插件在 local-plugins（真实加载源）② 只在 node_modules（历史 link 产物）。
 *
 * @returns {{dir: string, profile?: string, reason: string, ambiguous?: boolean, candidates?: string[]}}
 */
export function pickProfile(profiles = [], pluginName = '') {
  if (!pluginName) return { dir: '', reason: '未给出插件名' };
  const withLocal = profiles.filter((p) => existsSync(join(p.localDir, pluginName)));
  if (withLocal.length === 1) return { dir: withLocal[0].dir, profile: withLocal[0].name, reason: '命中 local-plugins（真实加载源）' };
  if (withLocal.length > 1) {
    return { dir: '', reason: '多个 profile 的 local-plugins 下都有该插件，请用 --profile 指定', ambiguous: true, candidates: withLocal.map((p) => p.name) };
  }
  const withNm = profiles.filter((p) => existsSync(join(p.dir, 'node_modules', pluginName)));
  if (withNm.length === 1) return { dir: withNm[0].dir, profile: withNm[0].name, reason: '只在 node_modules 命中（历史 link 产物，建议按目标形态迁到 local-plugins）' };
  if (withNm.length > 1) {
    return { dir: '', reason: '多个 profile 的 node_modules 下都有该插件，请用 --profile 指定', ambiguous: true, candidates: withNm.map((p) => p.name) };
  }
  return { dir: '', reason: `没有任何 profile 装了这个插件（共 ${profiles.length} 个 profile）` };
}
