#!/usr/bin/env node
// 从**真实代码**推导 lib/ 的模块依赖图（供 archify 架构图使用）。
//
// 为什么单独成模块：架构图的组件与连线必须完全来自代码（不手写），而「谁 import 谁」这件事
//   只与源码有关——独立出来既可单独测，也能让生成器保持「只负责排版与校验」。
//
// 口径（全部实测可验证）：
//   ① 组件 = lib/ 下的子目录 + lib/ 顶层的 .js 文件（一个模块一个组件）
//   ② 连线 = 解析各模块源文件里的**相对 import**（`from './x'` / `import('./x')`），
//      把目标路径归属到某个模块，得到「模块 A → 模块 B」的依赖边（同模块内部不计）
//   ③ 只取相对路径：本插件零运行时依赖，裸模块名只有 node 内置（node:fs 等），不算架构依赖
//
// 用法：node scripts/archify-imports.mjs gen|check <仓库路径>
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
// 复用既有的「函数列表」能力：doc-func.mjs 的 scanFileFuncs 已是导出的纯函数，
//   不再另写一套函数扫描（同一份口径，避免两处实现漂移）。
import { scanFileFuncs } from './doc-func.mjs';

// 分层关键词 → 层名（**通用启发式，不绑定任何具体项目**）。
// 分层：**不再有层名表**（原 LAYER_KEYWORDS 把目录映射成「入口层/规则层/检查层…」这类中文层名，
//   那是本项目专属概念——换项目要么全落「其它」、要么靠猜语义）。
//   通用口径：**层 = 目录本身**。目录名就是仓库里真实存在的组织单位，可反查、不含任何项目假设；
//   同一目录下的模块自然归为一层，聚合视图的分组也由此而来。
/**
 * 取模块所属的「层」——通用实现：直接用目录名（父目录优先，展开出来的子模块归到父目录）。
 * @param {string} dirName 模块目录名
 * @returns {string} 层名（即目录名）
 */
export function inferLayer(dirName) {
  return dirName || 'root';
}

/** 递归列出目录下的 .js/.mjs 源文件（跳过 node_modules/.git/构建产物）。 */
export function listSourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    let items;
    try { items = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (it.name === 'node_modules' || it.name === '.git' || it.name === '__pycache__') continue;
      const p = join(d, it.name);
      if (it.isDirectory()) walk(p);
      else if (/\.(m?js)$/.test(it.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * 解析源码里的相对 import 目标。
 * 覆盖：`import ... from './x'`、`export ... from './x'`、`import('./x')`、`require('./x')`。
 * @returns {string[]} import 说明符（原样，含 ./ 前缀）
 */
export function importSpecifiers(text) {
  const out = new Set();
  const re = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]+)['"]/g;
  for (const m of String(text).matchAll(re)) out.add(m[1]);
  return [...out];
}

/**
 * 把一个 import 说明符解析成它所属的 lib 模块 id。
 * @param {string} fromFile 仓库相对路径（发起 import 的文件）
 * @param {string} spec     import 说明符（./ 或 ../ 开头）
 * @returns {string|null}   模块 id（如 `ast` / `index`），不在 lib/ 下或解析不出则 null
 */
export function resolveLibModule(fromFile, spec, sourceRoot = 'lib') {
  if (!spec.startsWith('.')) return null;
  const target = resolve(dirname(join('/', fromFile)), spec).slice(1); // 归一到仓库相对路径
  const parts = target.split(sep);
  // 源码根就是**仓库根**（'.'，实测 Pawchive-downloader 这种「代码全在根目录」的形态）时，
  //   模块 id = 目标文件自身（去扩展名）——不能走下面的 parts[0] !== sourceRoot 判断，
  //   那时 parts[0] 是文件名，永远不等于 '.'，会把**所有边丢掉**（实测 13 个模块 0 条边）。
  if (sourceRoot === '.') {
    const base = parts[parts.length - 1] || '';
    return base.replace(/\.(m?js|cjs)$/, '') || null;
  }
  if (parts[0] !== sourceRoot) return null;
  if (parts.length === 1) return null;
  return parts[1].endsWith('.js') || parts[1].endsWith('.mjs') ? parts[1].replace(/\.m?js$/, '') : parts[1];
}

/**
 * 求一个模块的**锚点文件**（archify 的 sources 必须指向真实文件，目录会被判 file-missing）。
 *   抽成独立函数：内联实现把 deriveLibGraph 的圈复杂度推到 52（阈值 10，拦提交）。
 *   锚点路径**不写死 lib/**：用推导出的源码根拼接（可能是 lib / src / '.'），换项目才不会全错。
 * @returns {string} 仓库相对路径
 */
function moduleAnchor(repoPath, mod, sourceRoot) {
  if (mod.file) return relative(repoPath, mod.file);
  const rootPrefix = sourceRoot === '.' ? '' : `${sourceRoot}/`;
  for (const c of ['index.js', 'index.mjs']) {
    if (existsSync(join(mod.dir, c))) return `${rootPrefix}${mod.id}/${c}`;
  }
  const src = listSourceFiles(mod.dir)[0];
  if (src) return relative(repoPath, src);
  // 没有源码文件的模块（只放 .yml 等非源码的目录）也要给真实文件做锚点
  try {
    const any = readdirSync(mod.dir, { withFileTypes: true })
      .filter((it) => it.isFile() && !it.name.startsWith('.'))
      .map((it) => it.name).sort()[0];
    if (any) return `${rootPrefix}${mod.id}/${any}`;
  } catch { /* 读不到就退回目录名，由 check 报出 */ }
  return `${rootPrefix}${mod.id}`;
}

/**
 * 推导 lib 模块依赖图。
 * @returns {{components:{id:string,type:string,label:string,layer:string,file:string,fileCount:number}[],
 *            edges:{from:string,to:string,count:number}[], modules:number, files:number}}
 */
/**
 * 资源引用边：给「没有 import 关系」的内容/数据模块（yml 规则、readme 模板、docs、skills、
 *   assets、内置 vendor 等）连一条虚线边——谁在源码里提到该模块名就连谁。
 *
 * 为什么单独成函数：这段扫描逻辑（全仓源码 + 归属判定 + 上限 3 条）原内联在 deriveLibGraph 里，
 *   把该函数的圈复杂度推到 53（阈值 10，自检直接拦提交）。
 *
 * @param {string} repoPath 仓库根
 * @param {string} sourceRoot 源码根目录名
 * @param {object[]} components 已推导出的组件（就地不改）
 * @param {object[]} edges 已有的 import 边（会被追加 resource 边）
 */
function addResourceEdges(repoPath, sourceRoot, components, edges) {
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const repoFiles = listSourceFiles(repoPath).filter((f) => {
    const rel = relative(repoPath, f);
    return rel.startsWith(`${sourceRoot}/`) || !rel.includes('/'); // 源码根内 + 顶层散文件
  });
  for (const c of components) {
    if (linked.has(c.id)) continue;
    const froms = [];
    for (const f of repoFiles) {
      const rel = relative(repoPath, f);
      if (rel.startsWith(`${sourceRoot}/${c.id}/`) || rel === `${sourceRoot}/${c.id}.js`) continue; // 自己不算
      try {
        if (!readFileSync(f, 'utf8').includes(c.id)) continue;
      } catch { continue; }
      // 归属：源码根内的文件归到「源码根/模块名」，其他顶层目录的文件归到该目录名
      const parts = rel.split('/');
      const owner = parts.length > 1
        ? (parts[0] === sourceRoot ? parts[1].replace(/\.m?js$/, '') : parts[0])
        : null;
      if (owner && owner !== c.id && !froms.includes(owner)) froms.push(owner);
    }
    for (const from of froms.slice(0, 3)) edges.push({ from, to: c.id, count: 1, kind: 'resource' });
  }
}

export function deriveLibGraph(repoPath) {
  // 源码根自动探测（原来写死 lib/，换项目就推不出东西——实测 archify 自身只有 4 组件 0 连线）
  const sourceRoot = detectSourceRoot(repoPath);
  if (!sourceRoot) return { components: [], edges: [], modules: 0, files: 0, sourceRoot: null };
  const libDir = join(repoPath, sourceRoot);
  // 组件来源：lib/ 的子目录 + lib/ 顶层 .js。
  //   注意：同名文件与目录同时存在（实测 lib/client.js 与 lib/client/ 并存）时**合并为一个模块**——
  //   它们逻辑上就是一个模块，拆成两个组件会产生重复 id 且看不出关系。
  const dirNames = new Set();
  for (const it of readdirSync(libDir, { withFileTypes: true })) if (it.isDirectory()) dirNames.add(it.name);
  // 只认 **git 已跟踪**的源码文件：实测主题插件 dsh-theme-mediascape 的 lib/client.js 是构建产物
  //   （仓库里有 build-parts/ + build.cjs，产物被 .gitignore 掉），把它当组件会导致
  //   archify 官方 validate 报 file-missing（「该 revision 下不存在此文件」）。
  //   注意：这里不能只靠 .gitignore 文本匹配，直接用 git ls-files 最准。
  const trackedSet = (() => {
    try {
      const r = spawnSync('git', ['-c', 'core.quotepath=false', '-C', repoPath, 'ls-files'], { encoding: 'utf8' });
      if (r.status !== 0) return null; // 非 git 仓库：不按跟踪过滤（保留原行为）
      return new Set(String(r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean));
    } catch { return null; }
  })();
  const isTracked = (rel) => !trackedSet || trackedSet.has(rel);
  const modules = [];
  for (const it of readdirSync(libDir, { withFileTypes: true })) {
    if (it.isDirectory()) continue;
    if (!/\.m?js$/.test(it.name)) continue;
    if (!isTracked(`${sourceRoot}/${it.name}`)) continue; // 跳过未跟踪的构建产物
    const id = it.name.replace(/\.m?js$/, '');
    modules.push(dirNames.has(id)
      ? { id, dir: join(libDir, id), file: join(libDir, it.name) } // 文件 + 目录合并
      : { id, dir: null, file: join(libDir, it.name) });
  }
  for (const it of readdirSync(libDir, { withFileTypes: true })) {
    // 已与同名文件合并的目录不再重复推（否则同一个 id 出现两次，校验会报「组件 id 重复」）
    if (it.isDirectory() && !modules.some((m) => m.id === it.name)) {
      modules.push({ id: it.name, dir: join(libDir, it.name), file: null });
    }
  }
  // **粒度自适应**：模块目录里文件多（或还有子目录）时再展开一层，否则嵌套型仓库会整包被当成一个组件。
  //   实测：我们的 lib/ 是扁平的（19 个子目录）⇒ 出 25 个模块；normify 是嵌套的
  //   （代码都在 lib/engine/ 的 15 个文件里）⇒ 只出 4 个模块，图看起来「简陋那么多」。
  //   阈值：**该层模块总数 <= 6（太粗）且**模块目录里源码文件 >= 8 或含子目录 —— 才展开。
  //   为什么加「总数 <= 6」：实测只按文件数判断时，我们的 lib/app（21 文件）也被展开，
  //   25 个模块暴涨到 120 个，网格直接压不住；而 normify 只有 4 个模块，正是需要展开的情形。
  const tooCoarse = modules.length <= 6;
  const expanded = [];
  for (const mod of modules) {
    const files = mod.dir ? listSourceFiles(mod.dir) : [];
    let subDirs = [];
    try {
      subDirs = mod.dir ? readdirSync(mod.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
    } catch { subDirs = []; }
    if (!tooCoarse || !mod.dir || (files.length < 8 && subDirs.length === 0)) { expanded.push(mod); continue; }
    const inner = [];
    // id 用 `-` 连接并**去掉所有非 id 合法字符**：archify 的 id 模式 `^[a-zA-Z][a-zA-Z0-9_-]*$`
    //   不允许 `/` 与 `.`——实测 `test-architecture-delta.test` 就是被点号卡住的。
    const slug = (x) => String(x).replace(/\.(m?js|cjs)$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
    for (const d of subDirs) inner.push({ id: `${slug(mod.id)}-${slug(d)}`, dir: join(mod.dir, d), file: null, parent: mod.id });
    for (const f of files) {
      const base = relative(mod.dir, f).split(sep).join('/');
      if (base.includes('/')) continue; // 子目录里的已在上面按子目录归过
      // 只认 git 已跟踪的文件（与顶层一致）：否则 sources 会指向未提交文件，
      //   官方 validate 报 file-missing（实测 120 组件展开后踩到）
      if (!isTracked(relative(repoPath, f).split(sep).join('/'))) continue;
      inner.push({ id: `${slug(mod.id)}-${slug(base)}`, dir: null, file: f, parent: mod.id });
    }
    if (inner.length >= 2) expanded.push(...inner);
    else expanded.push(mod);
  }
  modules.length = 0;
  modules.push(...expanded);
  const components = [];
  const edgeCount = new Map();
  let fileTotal = 0;
  for (const mod of modules) {
    // 合并型模块（文件 + 目录同名）要把两边都算进来；只有目录/只有文件各按各的
    const files = mod.dir
      ? (mod.file ? [mod.file, ...listSourceFiles(mod.dir)] : listSourceFiles(mod.dir))
      : [mod.file];
    fileTotal += files.length;
    for (const f of files) {
      const rel = relative(repoPath, f);
      let text;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      for (const spec of importSpecifiers(text)) {
        const target = resolveLibModule(rel, spec, sourceRoot);
        if (!target || target === mod.id) continue; // 同模块内部依赖不计
        const key = `${mod.id}→${target}`;
        edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      }
    }
    const anchor = moduleAnchor(repoPath, mod, sourceRoot);
    components.push({
      id: mod.id,
      type: 'backend',
      label: sourceRoot === '.' ? mod.id : `${sourceRoot}/${mod.id}`,
      layer: inferLayer(mod.parent || mod.id),
      file: anchor,
      fileCount: files.length,
      // 函数数复用 doc-func 的扫描口径（同一实现，不另写）。
      //   注意其返回形状是 { file, funcs, totalLines }——取 funcs.length（实测踩过：直接取返回值 .length 恒为 0）
      funcCount: files.reduce((n, f) => {
        try { return n + (scanFileFuncs(f).funcs || []).length; } catch { return n; }
      }, 0),
    });
  }
  const ids = new Set(components.map((c) => c.id));
  const edges = [...edgeCount.entries()]
    .map(([k, count]) => { const [from, to] = k.split('→'); return { from, to, count }; })
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .sort((a, b) => (b.count - a.count) || a.from.localeCompare(b.from));
  // **资源引用边**：内容/数据模块在 lib 内部可能没有任何 import 关系，在图里会成孤立节点。
  //   做法与「数据文件归属」一致：谁在源码里提到该模块名就连一条引用边（标 kind='resource'）。
  //   扫描范围是**全仓源码**（含 scripts/ 与 test/）——实测只扫 lib/ 会漏掉
  //   「vendor 被 scripts/readme-gen.mjs import」这种跨顶层目录的引用。
  addResourceEdges(repoPath, sourceRoot, components, edges);
  return { components: components.sort((a, b) => a.id.localeCompare(b.id)), edges, modules: components.length, files: fileTotal, sourceRoot };
}

/**
 * 探测「源码根」——让推导不绑死某个项目的目录习惯（原来写死 lib/，换项目就推不出东西）。
 * 顺序：lib/ → src/ → source/ → **含源码文件最多的顶层目录**（深度 2 内统计）。
 * @returns {string|null} 相对仓库根的源码根目录名
 */
// 复用工具侧（lib/arch/extract.js）的**同一份**源码根探测实现——只留一份逻辑，避免「改一处漏一处」。
//   实测教训：脚本与工具各写一套时，同一个仓库会得到不同结果（工具 9 模块/0 边 vs 脚本 13 模块/6 边）。
import { detectSourceRoot as toolDetectSourceRoot } from '../lib/arch/extract.js';
export function detectSourceRoot(repoPath) {
  return toolDetectSourceRoot(repoPath);
}

/**
 * 推导「规则引擎三层」与「审计管线 L1/L2/L3」——都来自代码，不手写清单。
 *
 * 规则引擎三层（映射见 lib/audit/checks.js 注释，三层目录可枚举）：
 *   ① 声明层 lib/audit-rules/*.yml → ② 实现层 lib/ast/*.js → ③ 包装层 lib/checks/*.js
 *
 * 审计管线三层（实现文件与顺序取自 lib/checks/dispatch.js 的 import 与用法）：
 *   L1 正则初筛 filterRulesByFileText → L2 AST 数据流 checkDataflow → L3 运行时检测脚本
 *
 * @returns {{ruleEngine:{label:string,files:number}[],
 *            pipeline:{id:string,file:string,desc:string}[],
 *            dispatchFile:string|null}}
 */
// deriveAuditLayers 已删除：所谓「审计三层管线 + 规则引擎三层」是靠针对性代码凑的
//   （写死 lib/rule/compilers、lib/ast、scripts/audit-runtime-check.mjs 三个目录 + 一张规则引擎表），
//   换任何项目都落空。通用化口径下结构与依赖只从「目录 + 真实 import + IO 事实」推导。

/**
 * 推导应用的公开面与数据文件（全部来自代码）：
 *   · 工具 = lib/app/command-registry.js 里 TOOL_REGISTRY 的 name 项
 *   · 路由 = lib/app/http-handlers.js 里 `case '/api/git-push/...'` 的路径
 *   · 数据文件 = 4 个（config / account-status / dsh-repo-index / scan-live），
 *     归属模块 = 引用该文件名的 lib 模块（取第一个命中的模块目录名，即「各归其模块」）
 *
 * @returns {{tools:string[], routes:string[], dataFiles:{name:string,module:string|null}[]}}
 */
// deriveAppSurface 已删除：它靠针对性代码读本插件自己的注册表
//   （lib/app/command-registry.js 的工具名、lib/app/http-handlers.js 的路由）并写死 4 个数据文件名，
//   换项目全落空。数据文件现在由 lib/arch/extract.js 的 IO 事实推导（含 fetch 类），无需这里特殊处理。

/** 分层 → boundaries 分组（每层一个 region 边界框，包住该层全部模块）。 */
export function layersToBoundaries(components) {
  const byLayer = new Map();
  for (const c of components) {
    if (!byLayer.has(c.layer)) byLayer.set(c.layer, []);
    byLayer.get(c.layer).push(c.id);
  }
  return [...byLayer.entries()].map(([label, wraps]) => ({ kind: 'region', label, wraps }));
}

function main() {
  const [cmd = 'gen', repoArg = '.'] = process.argv.slice(2);
  const repoPath = resolve(repoArg);
  const g = deriveLibGraph(repoPath);
  if (cmd === 'check') {
    const missing = g.components.filter((c) => !existsSync(join(repoPath, c.file)));
    if (missing.length) {
      console.error('❌ 组件锚点文件不存在：');
      for (const m of missing) console.error(`  - ${m.id} → ${m.file}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✅ lib 依赖图与真实代码一致（${g.modules} 模块 / ${g.files} 文件 / ${g.edges.length} 条依赖边）`);
    return;
  }
  console.log(JSON.stringify({ ...g, boundaries: layersToBoundaries(g.components) }, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('archify-imports.mjs')) main();
