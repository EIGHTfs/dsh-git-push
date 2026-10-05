#!/usr/bin/env node
// archify 架构图 JSON 生成器（产出符合 archify 规范的 architecture.json）。
//
// 规范来源：archify 的 `archify/schemas/architecture.schema.json` + `common.schema.json`，实测约束：
//   顶层必填 schema_version(=1 常量) / diagram_type(="architecture" 常量) / meta / components
//   meta 必填 title + output
//   component 必填 id / type / label；type ∈ frontend|backend|database|cloud|security|messagebus|external
//   connection 必填 from / to；variant ∈ default|emphasis|security|dashed
//   boundary 必填 kind / label / wraps；kind ∈ region|security-group
//   layout.mode ∈ grid
//
// 三段式（与本插件其它生成器同口径）：
//   gen   打印 JSON
//   apply 写入 <repo>/.archify/<name>.architecture.json
//   check 两层校验：① 规范层（必填 + 枚举 + 引用完整性）② 事实层（防漂移：组件声明的路径必须真实存在、
//         顶层源码目录必须都有组件）——第二层正是「复用本插件防漂移检验能力」的落点。
//
// 用法：node scripts/archify-gen.mjs gen|apply|check <仓库路径> [--name <文件名>]
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
// 架构图的组件与连线全部来自这个推导模块（解析真实 import），生成器不手写任何一条
import { deriveLibGraph, layersToBoundaries, listSourceFiles, importSpecifiers } from './archify-imports.mjs';
// 统一口径：数据文件节点改用 lib/arch/extract.js 的 **IO 事实**（含 fs 与 fetch 两类），
//   不再依赖 deriveAppSurface 里写死的那 4 个文件名——这样主题类插件走 fetch 的数据文件
//   （如 dsh-theme-mediascape 的 boot/boot.json）也能显示在预览 HTML 里。
import { extractArchFacts } from '../lib/arch/extract.js';
import { collectDataFiles, dataFileId } from '../lib/arch/to-json.js';

// 目录 → 组件类型：**不再写死本项目目录**，改为按目录语义推导（任一项目都适用）。
//   archify 的组件类型枚举只有这 7 个，故按语义映射：
//     测试/安全 → security；数据/配置/规则 → database；前端/UI/主题 → frontend；
//     文档/资源 → cloud；其余源码目录 → backend。
//   注：原来这里是一张本项目专属表（lib/scripts/test/docs/skills/assets），换项目就全部落空。
const TYPE_BY_KEYWORD = [
  [/^(tests?|spec|specs|e2e|fixtures?)$/i, 'security'],
  [/^(data|assets?|config|configs|rules?|audit-rules|schemas?|migrations?|vendor)$/i, 'database'],
  [/^(client|clients|ui|web|view|views|frontend|theme|themes|widgets?|styles?|css)$/i, 'frontend'],
  [/^(docs?|doc|examples?|samples?|website|site|media|music|images?)$/i, 'cloud'],
];

/** 顶层目录里**不作为架构组件**的（构建产物/依赖/缓存类，通用跳过名单）。 */
const SKIP_TOP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '__pycache__', '.git']);

/**
 * 推导**外部系统**节点：扫源码里出现的 URL 主机名，每个主机一个 external 组件。
 *
 * 通用规则（不依赖具体项目）：原来 github / host 两个外部节点是**写死**的——换项目就没有外部依赖可谈，
 *   而「代码里引用了哪些外部主机」本身就是确定性事实（正则抓 https?://host/… 即可）。
 * @returns {{hosts:string[], refs:Map<string,string[]>}} 主机清单 + 主机 → 引用它的源文件（仓库相对路径）
 */
function deriveExternals(repoPath, sourceRoot) {
  const refs = new Map();
  const files = listSourceFiles(repoPath).slice(0, 400);
  for (const f of files) {
    const rel = relative(repoPath, f);
    // 排除测试夹具：实测 test/ 里的假域名（evil.example.com 之类）会当成真实外部系统上图
    if (/(^|\/)(tests?|specs?|e2e|fixtures?)\//.test(rel)) continue;
    let text = '';
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(\/[^\s'"`)\]}>]*)?/g)) {
      const host = m[1].toLowerCase();
      const urlPath = m[2] || '';
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host)) continue;
      // **滤掉 XML 命名空间**：它们是格式声明，不是「外部系统」。
      //   确定性判据（不猜）：① 主机是标准命名空间域（www.w3.org 等）
      //   ② 路径形如 `/YYYY/…`（XML 命名空间的标准写法，如 /2000/svg、/1999/xhtml）
      //   注意：`urls` **清单**里保留它们（那是源码里的真实字面量），只在这里过滤节点。
      if (/^(www\.)?w3\.org$/.test(host)) continue;
      if (/^\/\d{4}\//.test(urlPath)) continue;
      if (!refs.has(host)) refs.set(host, []);
      if (!refs.get(host).includes(rel)) refs.get(host).push(rel);
    }
  }
  const hosts = [...refs.keys()].sort();
  return { hosts, refs };
}

/**
 * 跨层依赖边（**推导**）：扫非源码根的顶层目录（scripts / test / bin / …）里的 import 与 require，
 *   命中源码根的模块名就连一条边。
 *
 * 为什么改成推导：原来这里是写死的 4 条（host→lib、lib→github、scripts→lib、test→lib）——
 *   换项目就完全不适用（别的项目没有 scripts/test，也没有 github/host 这两个概念）。
 *   而「谁 import 了谁」本身就是确定性事实，扫一遍即可。
 * @returns {{from:string,to:string,variant:string}[]}
 */
function deriveCrossLayerEdges(repoPath, sourceRootName, moduleIds) {
  const edges = [];
  const seen = new Set();
  const topDirs = readdirSync(repoPath, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules'
      && d.name !== sourceRootName && !SKIP_TOP_DIRS.has(d.name))
    .map((d) => d.name);
  for (const dir of topDirs) {
    for (const f of listSourceFiles(join(repoPath, dir)).slice(0, 200)) {
      let text = '';
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      for (const spec of importSpecifiers(text)) {
        // 只看指向源码根的相对引用（../../lib/xxx、../lib/xxx 之类）。
        //   注意必须**先锚到 `/` 再截掉首字符**（与 archify-imports.mjs 的 resolveLibModule 同一手法）：
        //   直接 resolve(dirname(rel), spec) 会按**当前工作目录**解析成绝对路径，判断必然失败（实测踩到）。
        const target = resolve('/', dirname(relative(repoPath, f)), spec).slice(1).split(sep).join('/');
        if (!target.startsWith(`${sourceRootName}/`)) continue;
        const mod = target.slice(sourceRootName.length + 1).split('/')[0].replace(/\.(m?js|cjs)$/, '');
        if (!moduleIds.has(mod)) continue;
        if (mod === dir) continue; // 自环（顶层目录与同名模块，实测 archify 仓库的 scripts→scripts 会直接拒绝渲染）
        const key = `${dir}→${mod}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: dir, to: mod, variant: 'dashed' });
        // 上限收紧到 **每层 4 条**（原来 24）：实测放到 24 时本仓库连线从 31 涨到 55，
        //   网格立刻压不住、官方 validate 报连线穿越（edge-through-node）直接拒绝渲染。
        //   一个顶层目录的依赖本来就该看「最主要的几个」，全画反而看不清。
        edges.push({ from: dir, to: mod, variant: 'dashed' });
      }
    }
  }
  // **不裁剪**：跨层依赖全部保留（谁 import 了谁就是谁）。
  //   此前为了「让渲染通过」加过「每层 1 条 / 4 条」的上限，结果把**文件夹之间的真实连线砍没了**——
  //   那是拿事实换渲染，方向错了（本插件的红线是事实优先）。渲染问题要靠**减少节点**
  //   （聚合视图）解决，而不是砍边。
  return edges;
}

/** 按目录名推导 archify 组件类型（通用，不依赖具体项目）。 */
export function inferComponentType(dirName) {
  for (const [re, type] of TYPE_BY_KEYWORD) if (re.test(dirName)) return type;
  return 'backend';
}
// 固定外部节点（本插件依赖的外部系统）
const EXTERNAL = [
  { id: 'github', type: 'external', label: 'GitHub API', sublabel: 'api.github.com' },
  { id: 'host', type: 'external', label: 'DSH 宿主', sublabel: 'tools / http / settings' },
];
// 层级依赖（架构事实：谁依赖谁）——**已改为推导**，见 deriveCrossLayerEdges；
//   原来这里写死 4 条（host→lib、lib→github、scripts→lib、test→lib），换项目即失效。
// 注：原先还有一个写死的 EXTERNAL 数组（github / host 两个外部节点），也已改为按源码 URL 主机名推导。

const SCHEMA_VERSION = 1;
const DIAGRAM_TYPE = 'architecture';
const COMPONENT_TYPES = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
const VARIANTS = ['default', 'emphasis', 'security', 'dashed'];
const BOUNDARY_KINDS = ['region', 'security-group'];

/**
 * 给组件排布网格坐标（archify 必须显式给 pos/size：不给时其渲染器在连线路由几何处直接抛
 *   `Cannot read properties of undefined (reading '0')`，实测给不给 layout 声明都一样）。
 *
 * 三步都是为了压「连线穿过无关组件」：
 *   ① 按分层排（入口 → 规则 → 检查 → 审计 → git → 客户端 → 基础 → 测试 → 其它）
 *   ② 外部与调用方节点**挨着对应层**放，避免长边纵贯整张图
 *   ③ 列距/行距留足，给连线路由留通道
 * @param {object[]} components 组件数组（就地写入 pos/size）
 */
function layoutByLayer(components, connections = []) {
  // 排序依据**全部从数据推导**（不写死任何本项目的东西）：
  //   ① 层名按**该层节点数**降序（成员多的层是主干，先排）——原来这里写死了一张中文层序表
  //      （入口层/规则层/检查层/…），那是本项目专属的层名，换项目完全对不上。
  //   ② 同层内按**入度**降序（被依赖多的靠前）。
  //   ③ 最后按 id 稳定排序。
  const layerSize = new Map();
  for (const c of components) layerSize.set(c.layer, (layerSize.get(c.layer) || 0) + 1);
  const inbound = new Map();
  for (const e of connections) inbound.set(e.to, (inbound.get(e.to) || 0) + 1);
  const ordered = [...components].sort((a, b) =>
    ((layerSize.get(b.layer) || 0) - (layerSize.get(a.layer) || 0))
    || String(a.layer).localeCompare(String(b.layer))
    || ((inbound.get(b.id) || 0) - (inbound.get(a.id) || 0))
    || a.id.localeCompare(b.id));
  // 每行放几个：实测 5 个时，模块增删（如新增 lib/arch）会让长边重新穿越其它方块、
  //   官方 validate 报几十条 edge-through-node 并拦住渲染；4 个时纵向分布更均匀，穿越显著减少。
  const PER_ROW = 4;
  ordered.forEach((c, i) => {
    // 间距：高密度图需要大间距（460/320）才不穿越，但那种图走归并分支；细粒度分支只在组件少时进入，
    //   用 340/300 即可——原 460 间距使 4 列宽达 1640，超出 1440 视口触发 desktop-readability
    //   （实测 Pawchive 16 组件时画布 1680×1070 被判不可读）。
    c.pos = [60 + (i % PER_ROW) * 340, 60 + Math.floor(i / PER_ROW) * 300];
    c.size = [200, 74];
  });
}

/**
 * 读仓库证据（archify 的规矩：组件带 sources 时**必须**给 meta.repository，
 *   否则官方 validate 报 `Repository evidence requires /meta/repository`）。
 * @returns {{url:string, revision:string, provider?:string, link_mode?:string}|null}
 */
function readRepositoryEvidence(repoPath) {
  const run = (args) => {
    try {
      const r = spawnSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' });
      return r.status === 0 ? String(r.stdout || '').trim() : '';
    } catch { return ''; }
  };
  const url = run(['remote', 'get-url', 'origin']);
  const revision = run(['rev-parse', 'HEAD']);
  if (!url || !/^[a-fA-F0-9]{40}$/.test(revision)) return null; // 非 git 仓库/无远端 → 不给证据
  // URL 与 provider 的合法组合（均由官方 validate 的报错实测得出）：
  //   ① 公开主机（github.com / gitee.com）：声明 provider + link_mode: web
  //   ② 其它主机（本插件按约定把 remote 写成 GitHub API 地址 api.github.com/repos/o/r）：
  //      **url 必须与本地 origin 逐字一致**（否则报 origin-mismatch），且不能声明 provider
  //      （否则报 provider-invalid）⇒ 只能 url 原样 + link_mode: local-only
  const isPublicHost = /^https?:\/\/(www\.)?(github\.com|gitee\.com)\//i.test(url);
  if (isPublicHost) {
    const provider = /gitee\.com/i.test(url) ? 'gitee' : 'github';
    return { url, revision, provider, link_mode: 'web' };
  }
  return { url, revision, link_mode: 'local-only' };
}

/**
 * 扫描仓库，产出 archify architecture 文档。
 *
 * 事实**全部来自代码**（不手写组件/连线）：
 *   · 顶层目录来自目录扫描；`lib/` 进一步展开成子模块
 *   · lib 子模块之间的依赖边来自 archify-imports 的推导（解析真实 import）
 *   · 分层来自目录职责（同一份 LIB_LAYERS，生成器不另写一份）
 */
/**
 * 追加「数据文件节点 + 读写边」（来自 lib/arch/extract.js 的 IO 事实：fs 与 fetch 两类都收）。
 *   抽成独立函数的原因：buildArchitectureDoc 单函数被 readability/max-function-length 拦提交。
 * @returns {number} 新增的数据文件节点数
 */
async function appendDataFileNodes(repoPath, components, connections, ids, src, graph) {
  const facts = await extractArchFacts(repoPath);
  const aggForIo = { components: graph.components.map((m) => ({ id: m.id, members: [m.id] })) };
  const ioDataFiles = collectDataFiles(aggForIo, facts, { repoPath });
  let added = 0;
  for (const [p, slot] of ioDataFiles) {
    const id = dataFileId(p);
    if (ids.has(id)) continue;
    ids.add(id);
    added += 1;
    components.push({
      id, type: 'database', label: p.split('/').pop().slice(0, 16),
      // 标签有宽度上限：实测 `cache-miss-request.sequence.json` 这类长文件名（~211px）会超出
      //   组件宽度 200px，官方 validate 报 `Label ... is wider than component` ⇒ 截断到 16 字符
      sublabel: `数据文件 · ${p}`.slice(0, 22),
      ...src(p),
    });
    for (const from of new Set(slot.reads)) connections.push({ from, to: id, variant: 'dashed' });   // 读=虚线
    for (const from of new Set(slot.writes)) connections.push({ from, to: id, variant: 'default' }); // 写=实线
  }
  return added;
}

/**
 * 孤立节点通用兜底：谁在源码里提到该组件名就连一条虚线；没人提到就摘掉（不留悬空方块）。
 *
 * 抽成独立函数的原因：内联实现让 buildArchitectureDoc 涨到 122 行 / 圈复杂度 55，
 *   被 readability/max-function-length 与 max-cyclomatic-complexity 同时拦提交。
 * @returns {{dropped:number}}
 */
function linkOrDropIsolated(repoPath, components, connections, boundaries, topLevelIds = new Set()) {
  const linkedFinal = new Set(connections.flatMap((c) => [c.from, c.to]));
  const sourceTexts = listSourceFiles(repoPath).slice(0, 400).map((f) => {
    try { return { rel: relative(repoPath, f), text: readFileSync(f, 'utf8') }; } catch { return null; }
  }).filter(Boolean);
  const dropIds = new Set();
  for (const c of components) {
    if (linkedFinal.has(c.id) || c.id.startsWith('data-')) continue;
    const owner = sourceTexts.find((f) => f.rel !== c.anchor && f.text.includes(c.id));
    const from = owner ? components.find((x) => x.anchor === owner.rel || x.id === owner.rel.split('/')[0]) : null;
    if (from && from.id !== c.id) {
      connections.push({ from: from.id, to: c.id, variant: 'dashed' });
      linkedFinal.add(c.id);
      continue;
    }
    dropIds.add(c.id); // 源码里没人提到 ⇒ 摘掉（宁可少画，不画悬空方块）
  }
  // **顶层目录组件永不摘**：它们代表仓库里真实存在的目录，本身就是事实（实测踩坑——
  //   Pawchive-downloader 的 adapters/（含 KToolBox-webui.js，是它对接 KToolBox 的重要设计）
  //   因为没有 import 边被这条兜底规则误删，图里就少了这一块）。
  //   这条兜底只该清理「写死/推导出来的外部节点」这类可能落空的东西。
  for (const id of [...dropIds]) if (topLevelIds.has(id)) dropIds.delete(id);
  if (!dropIds.size) return { dropped: 0 };
  for (let i = components.length - 1; i >= 0; i -= 1) if (dropIds.has(components[i].id)) components.splice(i, 1);
  for (let i = connections.length - 1; i >= 0; i -= 1) {
    if (dropIds.has(connections[i].from) || dropIds.has(connections[i].to)) connections.splice(i, 1);
  }
  // 边界框也要跟着清：实测漏了这步，官方 validate 报
  //   `Boundary "其它" wraps unknown component "readme-templates"` 并拒绝渲染
  for (let i = boundaries.length - 1; i >= 0; i -= 1) {
    boundaries[i].wraps = boundaries[i].wraps.filter((w) => !dropIds.has(w));
    if (!boundaries[i].wraps.length) boundaries.splice(i, 1);
  }
  return { dropped: dropIds.size };
}

/**
 * 生成「函数清单卡片」（archify 的 cards：{dot,title,items[]}，schema 已实测）。
 *   数据来自 lib/arch/extract.js 的 funcNames —— 与 docs/FUNCTIONS.md **同一扫描器**（scanFileFuncs），
 *   所以卡片内容与已发布的函数列表永远一致。
 *
 * 数量上限已取消：原来只给「函数最多的前 6 个模块」出卡片、每个只列前 12 个函数，
 *   现在**全部模块、全部函数**都出（事实层负责给全，不必顾及页面内容多少）。
 *   折叠交互由渲染器负责，事实层只负责把事实给全。
 *   抽成独立函数：内联实现让 buildArchitectureDoc 涨到 102 行，被 readability/max-function-length 拦提交。
 * @returns {Promise<{cards?:object[]}>} 可直接展开进返回对象的字段
 */
async function buildFuncCards(repoPath) {
  const facts = await extractArchFacts(repoPath);
  const cards = facts.modules
    .filter((m) => m.funcNames?.length)
    .sort((a, b) => b.funcCount - a.funcCount)
    .map((m, i) => ({
      dot: ['cyan', 'emerald', 'violet', 'amber', 'rose', 'orange'][i % 6],
      title: `${m.id}（${m.funcCount} 个函数）`,
      items: m.funcNames.map((n) => String(n)),
    }))
    .filter((c) => c.items.length);
  return cards.length ? { cards } : {};
}

/**
 * 同父目录分组：按组件锚点（sources 的第一条路径）所在目录归类，**≥2 个成员**的目录各出一个边界框。
 *
 * 为什么需要：实测反馈「同一父目录的兄弟节点没有视觉分组」——图上只看得出分层，看不出
 *   `lib/git/*`、`lib/app/handlers/*` 这种同目录归属。边界框可以重叠（实测层分组与规则引擎
 *   分组本来就重叠且渲染正常），故这里与分层框并存。
 */
function parentBoundaries(components) {
  const byParent = new Map();
  for (const c of components) {
    const anchor = c.sources?.[0]?.path || '';
    if (!anchor || !anchor.includes('/')) continue;
    const parent = anchor.slice(0, anchor.lastIndexOf('/'));
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(c.id);
  }
  return [...byParent.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([parent, wraps]) => ({ kind: 'region', label: `${parent}/`, wraps }));
}

/**
 * 外部系统节点 + 引用边（从源码 URL 主机名推导）。
 *   抽成独立函数的原因：内联实现让 buildArchitectureDoc 涨到 115 行，被 readability/max-function-length 拦提交。
 * @returns {{components:object[], edges:object[]}}
 */
function deriveExternalNodes(repoPath, sourceRootName) {
  const externals = deriveExternals(repoPath);
  const components = externals.hosts.slice(0, 8).map((h) => ({
    id: `ext-${h.replace(/[^a-zA-Z0-9]/g, '-')}`,
    type: 'external',
    label: h,
    sublabel: `${externals.refs.get(h).length} 处引用`,
  }));
  const edges = [];
  const seenPair = new Set(); // 事实级去重：同一对 (from,to) 只留一条（不是按数量裁剪）
  for (const c of components) {
    for (const rel of (externals.refs.get(c.label) || [])) {
      // 引用它的文件归到其所属模块（源码根内的归第二段，其余顶层目录归目录名）
      const parts = rel.split('/');
      const owner = parts.length > 1 ? (parts[0] === sourceRootName ? parts[1].replace(/\.m?js$/, '') : parts[0]) : null;
      if (!owner) continue;
      const key = `${owner}→${c.id}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      edges.push({ from: owner, to: c.id, variant: 'dashed' });
    }
  }
  return { components, edges };
}

/**
 * 聚合视图：把细粒度组件按**所属文件夹/层**归并成 8~15 个组件，**连线全部保留**（合并同类项）。
 *
 * 为什么需要：细粒度视图在 38 组件 / 97 连线时网格压不住（官方 validate 报 edge-through-node）。
 *   渲染问题必须靠**减少节点**解决，**绝不能砍边**——砍边就是拿事实换渲染。
 *   归并规则：按组件已有的 `layer`（由目录语义推导而来）分组；同组内多条边合并为一条，
 *   自环（组内互连）丢弃（组内关系在聚合视图里不表达）。
 * @returns {{components:object[], connections:object[]}} 聚合后的组件与连线（边是**全量**的真实关系）
 */
export function aggregateByLayer(components, connections) {
  // 归并键 = 组件锚点的**顶层目录**（lib / scripts / test / docs / …）。
  //   实测踩过两次：
  //   ① 按 c.layer 分组——生成器的组件压根没有 layer 字段，会把所有组件归到「其它」变成 1 个组件 0 条边；
  //   ② 按**直接父目录**分组——lib/ast、lib/app、lib/checks… 仍是 30+ 组，
  //      既没达到「节点 8~15」的设计目标，也压不住渲染（archify 在 61 条连线的图上直接挂住）。
  //   顶层目录才是「少而稳」的分组粒度：本仓库 31 组件 → 约 8 组。
  const groupOf = (c) => {
    const anchor = c.sources?.[0]?.path || '';
    if (anchor) {
      const seg = anchor.split('/');
      return seg.length > 1 ? seg[0] : c.id;
    }
    // **非 git 仓库没有 sources**（实测：archify 仓库不是 git 仓 ⇒ 组件无锚点）⇒ 原来退回 c.id
    //   ⇒ 聚合完全失效（实测该仓 118 个组件一个都没归并，渲染直接失败）。
    //   兜底用 id 的首段归并：模块组件 id 形如 `lib-ast` / `scripts-gen`，首段就是顶层目录。
    const parts = String(c.id).split('-');
    return parts.length > 1 ? parts[0] : c.id;
  };
  const members = new Map();
  for (const c of components) {
    const g = groupOf(c);
    if (!members.has(g)) members.set(g, []);
    members.get(g).push(c);
  }
  const groups = [...members.keys()].sort();
  // 组的 id：用**目录名 slug**（可反查真实目录），不用 group-1 这种不可追溯的序号——
  //   id 必须能反查到真实文件/模块是本插件的红线。撞名时再加序号。
  const slug = (g) => g.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
  const idOf = new Map();
  const used = new Set();
  for (const g of groups) {
    let id = slug(g);
    let n = 1;
    while (used.has(id)) { n += 1; id = `${slug(g)}-${n}`; }
    used.add(id);
    idOf.set(g, id);
  }
  const aggComponents = groups.map((g) => {
    const list = members.get(g);
    const anchor = list.find((c) => c.sources?.[0]?.path)?.sources?.[0]?.path || null;
    return {
      id: idOf.get(g),
      type: list[0].type || 'backend',
      label: g,
      sublabel: `${list.length} 个模块`,
      ...(anchor ? { sources: [{ path: anchor }] } : {}),
    };
  });
  const seen = new Set();
  const aggConnections = [];
  for (const e of connections) {
    const from = idOf.get(groupOf(components.find((c) => c.id === e.from) || { layer: '其它' }));
    const to = idOf.get(groupOf(components.find((c) => c.id === e.to) || { layer: '其它' }));
    if (!from || !to || from === to) continue; // 组内互连在聚合视图里不表达
    const key = `${from}→${to}`;
    if (seen.has(key)) continue; // 同类项合并（同一个事实不重复画），**不是按数量裁剪**
    seen.add(key);
    aggConnections.push({ from, to, variant: e.variant || 'default' });
  }
  return { components: aggComponents, connections: aggConnections };
}

/**
 * 顶层目录 → 组件（类型按目录语义推导；锚点取该目录的代表文件）。
 *   抽出来只为压 buildArchitectureDoc 的行数（实测 101 行，超 max-function-length 拦线 1 行）。
 */
function dirComponents(repoPath, dirs, src) {
  return dirs.map((d) => ({
    id: d,
    type: inferComponentType(d),
    label: d,
    sublabel: `${countFiles(join(repoPath, d))} 个文件`,
    ...src(representativeFile(repoPath, d)),
  }));
}

// 网格放置：按依赖层（最长路径）定 row、层内按 id 定 col，返回列数。
// 需求：所有分支（归并视图与细粒度视图）共用同一套放置，且坐标交给渲染器计算。
// 思路：契约要求 Grid placement 优先、「自由坐标只适合有界例外，不做 prose-level 坐标规划」。
//   此前细粒度分支用 layoutByLayer 手算坐标，实测在 Pawchive（16 组件 / 12 连线）触发
//   composition/desktop-readability（桌面可读性）⇒ 改为共用本函数。
// 返回：列数（供 layout.cols 使用）。
function placeOnGrid(components, connections, maxCols = 6) {
  const level = new Map(components.map((c) => [c.id, 0]));
  const byId = new Set(components.map((c) => c.id));
  for (let pass = 0; pass < components.length; pass += 1) {
    let changed = false;
    for (const e of connections) {
      if (!byId.has(e.from) || !byId.has(e.to)) continue;
      const want = (level.get(e.from) || 0) + 1;
      if (want > (level.get(e.to) || 0)) { level.set(e.to, want); changed = true; }
    }
    if (!changed) break;
  }
  const rows = new Map();
  for (const c of components) {
    const L = level.get(c.id) || 0;
    if (!rows.has(L)) rows.set(L, []);
    rows.get(L).push(c);
  }
  // 每行最多 maxCols 个：同一层的节点过多时**换行**再接，避免整行铺开造成横向溢出
  //   （契约要求 zero horizontal overflow；实测 Pawchive 16 组件排成一行时画布宽 1680 > 1440 视口）。
  let row = 0;
  let cols = 1;
  for (const L of [...rows.keys()].sort((a, b) => a - b)) {
    const ms = rows.get(L);
    ms.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (let i = 0; i < ms.length; i += maxCols) {
      const chunk = ms.slice(i, i + maxCols);
      chunk.forEach((c, k) => { c.row = row; c.col = k; cols = Math.max(cols, k + 1); });
      row += 1;
    }
  }
  return cols;
}


// 需求：archify 的作者契约要求 Architecture 是**系统总览**，并把协作角色分组到准确命名的子系统；
//   细粒度全铺（本仓库 36 个模块）不是契约期望的抽象层级，且在 showcase 几何约束下过不了验收。
// 思路（每条都有依据，不是为省路由而合并）：
//   ① 分组键取 sources 锚点的顶层目录——实测用标签传播做社区发现时，lib 内部 34 个节点收敛成一团
//      ⇒ 该模块高度内聚、没有可分割的社区结构，按目录分组属于契约允许的「分组仍能解释交互」；
//   ② 契约明确「fewer routes alone do not justify merging」，所以保留全部语义：
//      每个子系统的成员清单写进**顶层 cards**（实测组件级 cards 会被 schema 拒绝）；
//   ③ 组内关系不画成自环（聚合视图不表达组内关系），但成员与来源路径在 cards 里可查，语义不丢。
// 返回：{ components, connections, cards }。
// 选择视图的抽象层级：归并成子系统，还是保留细粒度。
// 需求：overview 必须在**选定的抽象层级上可读**，且契约明确「fewer routes alone do not justify
//   merging」——不能为了少画几条线而丢掉交互信息。
// 思路（三级判据，全部由数据决定，不写死项目名）：
//   ① 细粒度节点本来就不多（≤ ARCHIFY_FINE_MAX，默认 14）⇒ 直接输出细粒度；
//   ② 归并后节点过少（< ARCHIFY_MIN_GROUPS，默认 5）⇒ 说明该仓库结构扁平、按目录归并会吞掉一切
//      （实测：dsh-normify 10 个组件归并只剩 2 个、Pawchive 16 个只剩 3 个）⇒ 归并即信息丢失，退回细粒度；
//   ③ 其余情形（如 dsh-git-push 36 → 8）才用归并结果。
//   `ARCHIFY_FINE_GRAIN=1` 可强制走细粒度分支（对比排查用）。
// 坐标策略：归并分支用 placeOnGrid（组件多、网格可摊开）；细粒度分支用 layoutByLayer 的紧凑坐标
//   （实测网格会把 10 个节点摊成整行、触发 composition/desktop-readability）。
// 返回：{ components, connections, cards, cols }。
function resolveView(components, connections) {
  const fineMax = Number(process.env.ARCHIFY_FINE_MAX) > 0 ? Number(process.env.ARCHIFY_FINE_MAX) : 14;
  const minGroups = Number(process.env.ARCHIFY_MIN_GROUPS) > 0 ? Number(process.env.ARCHIFY_MIN_GROUPS) : 5;
  // 细粒度**硬上限**：组件超过它时即使归并后组数少也必须归并——
  //   实测 archify 仓库 118 组件走细粒度会让渲染器进程崩（internal/renderer-process）。
  const fineHardMax = Number(process.env.ARCHIFY_FINE_HARD_MAX) > 0 ? Number(process.env.ARCHIFY_FINE_HARD_MAX) : 24;
  const useFine = () => {
    layoutByLayer(components, connections);
    return { components, connections, cards: [], cols: null };
  };
  if (process.env.ARCHIFY_FINE_GRAIN === '1') return useFine();
  if (components.length <= fineMax) return useFine();
  const agg = regroupForView(components, connections);
  // 归并后组数过少（结构扁平）：只有细粒度还画得下时才退回细粒度，否则宁可粗也要出图
  if (agg.components.length < minGroups && components.length <= fineHardMax) return useFine();
  return agg;
}

function regroupForView(fine, connections) {

  const topOf = (c) => {
    // external **必须最先判断**：带 sources 的外部节点如果先走目录分支就不会被归并，
    //   实测 archify 仓库有 118 个组件、其中绝大多数是 ext-* 外部域名（airtable/angular/apache…），
    //   导致归并后组数反而不足、退回细粒度、渲染器进程崩溃。
    //   契约也要求「次要与可选能力放进简明带来源的注记」（Keep secondary and opt-in capabilities in
    //   concise sourced notes unless their path matters）——外部引用正属此类。
    if (c.type === 'external') return '外部系统';
    const p = String((c.sources && c.sources[0] && c.sources[0].path) || c.id).split('/');
    if (p.length > 1) return p[0];
    return String(c.id).startsWith('data-') ? '数据文件' : '根文件';
  };
  // 子系统类型：取成员里语义最强的一个（security > database > cloud > …）
  const typeOf = (ms) => {
    const t = ms.map((m) => m.type);
    const order = ['security', 'database', 'cloud', 'messagebus', 'frontend', 'backend', 'external'];
    for (const k of order) if (t.includes(k)) return k;
    return 'backend';
  };
  const groups = new Map();
  for (const c of fine) {
    const k = topOf(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  // id 唯一化：中文组名 slug 后会变成空串（实测「外部系统」「数据文件」都变成 root 导致 id 重复），
  //   因此 slug 之后必须去重加序号。
  const slug = (s) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grp';
  const used = new Set();
  const uniq = (base) => { let id = base; let n = 2; while (used.has(id)) { id = `${base}-${n}`; n += 1; } used.add(id); return id; };
  const idOf = new Map();
  const components = [];
  const cards = [];
  const dots = ['cyan', 'emerald', 'violet', 'amber', 'rose', 'orange'];
  let gi = 0;
  for (const [label, ms] of groups) {
    const id = uniq(slug(label));
    idOf.set(label, id);
    components.push({
      id,
      type: typeOf(ms),
      label,
      sublabel: `${ms.length} 个模块`,
      ...(ms[0].sources ? { sources: [ms[0].sources[0]] } : {}),
    });
    cards.push({
      dot: dots[gi % dots.length],
      title: `${label}（${ms.length} 个模块）`,
      items: ms.map((m) => String((m.sources && m.sources[0] && m.sources[0].path) || m.label || m.id)).slice(0, 40),
    });
    gi += 1;
  }
  // 组间关系：同组自环丢弃、同向重复合并（同一事实不重复画）
  const groupOf = new Map(fine.map((c) => [c.id, idOf.get(topOf(c))]));
  const seenEdge = new Set();
  const aggConnections = [];
  for (const e of connections) {
    const from = groupOf.get(e.from);
    const to = groupOf.get(e.to);
    if (!from || !to || from === to) continue;
    const key = `${from}>${to}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    aggConnections.push({ id: `r${aggConnections.length}`, from, to });
  }
  // 网格放置与细粒度分支共用 placeOnGrid（坐标由渲染器按 row/col 计算）
  const cols = placeOnGrid(components, aggConnections);
  return { components, connections: aggConnections, cards, cols };
}

export async function buildArchitectureDoc(repoPath, name = basename(resolve(repoPath))) {

  const graph = deriveLibGraph(repoPath);
  // 顶层目录：**不再查写死的表**——除源码根（下面会展开成模块）与隐藏/依赖目录外，全部作组件
  const sourceRootName = graph.sourceRoot || 'lib';
  const dirs = readdirSync(repoPath, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules'
      && d.name !== sourceRootName && !SKIP_TOP_DIRS.has(d.name))
    .map((d) => d.name)
    .sort();
  // 有仓库证据才写 sources：archify 要求「有 sources 就必须有 meta.repository」，
  //   二者要么同时给、要么同时不给（否则官方 validate 直接拒）。
  const evidence = readRepositoryEvidence(repoPath);
  // sources 是**防漂移锚点**：check 会逐条验证这些路径真实存在。
  //   形状必须是**对象数组**（archify common.schema.json#/$defs/sourceReferences：
  //   1–3 项、每项必填 path、additionalProperties:false）——写成字符串数组会被官方 validate 拒掉。
  //   且实测官方 validate 还有两条硬要求：路径不能带尾斜杠（path-escape）、
  //   必须**指向该 revision 下真实存在的文件**（file-missing）⇒ 这里取目录的代表文件。
  const src = (p) => (evidence ? { sources: [{ path: p }] } : {});
  // 外部系统节点：**从源码里的 URL 主机名推导**（不再写死 github/host）
  const { components: externalComponents, edges: externalEdges } = deriveExternalNodes(repoPath, sourceRootName);
  const components = [
    ...externalComponents,
    ...dirComponents(repoPath, dirs, src),
    ...graph.components.map((m) => ({
      id: m.id,
      type: 'backend',
      label: m.label,
      // 文件数与函数数都来自代码（文件清单来自推导、函数数复用 doc-func 的扫描口径）
      sublabel: `${m.fileCount} 文件 · ${m.funcCount} 函数 · ${m.layer}`,
      ...src(m.file),
    })),
  ];
  // 审计三层管线（L1/L2/L3）、规则引擎三层、以及「公开面（工具/路由）」：**全部舍弃**。
  //   原因：这些都不是通用推导，而是靠**针对性代码**凑出来的——写死目录（lib/rule/compilers、
  //   lib/ast、scripts/audit-runtime-check.mjs）、写死调度文件与导出名、写死本插件的注册表文件。
  //   换任何别的项目都落空，等于把本项目专属概念硬塞进「通用生成器」。
  //   通用化口径：结构与依赖只从「目录 + 真实 import + IO 事实」推导。
  const audit = { ruleEngine: [], pipeline: [] };
  const pipelineIds = [];
  const surface = { tools: [], routes: [], dataFiles: [] };
  const byId = new Map(components.map((c) => [c.id, c]));
  if (byId.has('app') && surface.tools.length) byId.get('app').sublabel += ` · ${surface.tools.length} 工具`;
  if (byId.has('http') && surface.routes.length) byId.get('http').sublabel += ` · ${surface.routes.length} 路由`;
  // 复用 tree-doc.json 的「路径 → 一句话介绍」当组件说明：这是仓库**自己维护**的事实，
  //   连命名都不需要 AI 参与（与「只导出事实」一致）。没有该文件的项目自然退回「文件数 · 函数数 · 层」。
  //   注意 sublabel 有宽度上限（实测超长会被官方 validate 以 layout/constraint 拦），故截断。
  const treeDoc = (() => {
    try { return JSON.parse(readFileSync(join(repoPath, 'tree-doc.json'), 'utf8')); } catch { return null; }
  })();
  if (treeDoc && typeof treeDoc === 'object') {
    for (const c of components) {
      const desc = treeDoc[c.id] || treeDoc[`${graph.sourceRoot}/${c.id}`] || treeDoc[`lib/${c.id}`];
      if (desc) c.sublabel = String(desc).slice(0, 22);
    }
  }

  layoutByLayer(components);
  // 连线：lib 内部依赖来自**真实 import 推导**；跨层关系同样是代码事实——
  //   入口层由宿主调用、git 层访问 GitHub API、脚本与测试复用 lib。
  //   **只画显著依赖**（被引用 >= EDGE_MIN_COUNT 次）：实测 48 条全画时，官方 validate 报
  //   170 条 `edge-through-node`（连线穿过无关组件）且**渲染被拦**；只留显著边后可通过。
  //   完整的依赖边清单仍在推导结果里（`archify-imports.mjs gen` 可查），图只做可读性取舍。
  //   **import 依赖只画被引用 >= 2 次的**（控制连线数量与穿越），
  //   **资源引用边（kind='resource'）全保留**——它们正是把 vendor / audit-rules 这类
  //   「没有 import 关系但有引用」的模块连起来的关键，全画会因边数过多导致渲染被拦（实测 88 条穿越）。
  //   阈值**自适应**：组件多（>20）时只画被引用 >=3 次的依赖——实测 33 组件的项目在 >=2 时
  //   仍有 50 条穿越导致渲染被拦；17 组件的项目用 >=2 就够。资源边始终保留。
  //   阈值**自适应**（按组件规模分档）：组件越多，网格越大、长边越多，必须只留更强的依赖
  //   才压得住「连线穿过无关组件」。实测：33 组件用 >=4 稳、81 组件（archify 自身）用 >=4 仍穿越。
  const EDGE_MIN_COUNT = components.length > 40 ? 6 : (components.length > 20 ? 4 : 2);
  const ids = new Set(components.map((c) => c.id));
  const kept = graph.edges.filter((e) => e.kind === 'resource' || e.count >= EDGE_MIN_COUNT);
  // **孤立节点兜底**：按阈值筛完后若某组件一条边都没有（实测 vendor / skip-dirs / fsx / index /
  //   link-check 都遇到过），把它被丢掉的那条边补回来——否则图里出现一堆无连线的方块。
  //   注意：资源引用边只在「该组件没有任何 import 边」时才由推导侧生成，
  //   所以这里必须补的是**被阈值丢掉的那条 import 边**。
  const linkedNow = new Set(kept.flatMap((e) => [e.from, e.to]));
  for (const c of components) {
    if (linkedNow.has(c.id)) continue;
    const dropped = graph.edges.filter((e) => (e.from === c.id || e.to === c.id) && !kept.includes(e));
    if (dropped.length) {
      kept.push(dropped.sort((a, b) => b.count - a.count)[0]);
      linkedNow.add(c.id);
    }
  }
  // 组件 id 去重：不同来源可能撞名（实测 archify 仓库**同时有顶层 scripts/ 与 archify/scripts/**
  //   ⇒ 都映射成 id `scripts`，官方 validate 直接报 `Component ids must be unique` 并拒绝渲染）。
  //   撞了就加序号（scripts、scripts-2…）；**必须在生成连线之前做**，否则连线还指向旧 id。
  const idSeen = new Map();
  for (const c of components) {
    const n = (idSeen.get(c.id) || 0) + 1;
    idSeen.set(c.id, n);
    if (n > 1) c.id = `${c.id}-${n}`;
  }
  // 跨层依赖边（推导）：非源码根顶层目录里的 import/require 命中源码根模块就连线
  const crossLayerEdges = deriveCrossLayerEdges(repoPath, sourceRootName, new Set(graph.components.map((m) => m.id)));
  const connections = [
    // 跨层依赖边：**推导**（扫非源码根顶层目录里的 import/require，命中源码根模块就连线）。
    //   原来这里是写死的 4 条（host→app/cli/http、git→github、scripts→app、test→app），换项目即失效。
    ...crossLayerEdges,
    ...kept
      // 资源引用边（kind='resource'）用虚线，与真实 import 依赖区分开。
      //   不设 route:'auto'——实测它不减少穿越，反而让渲染器认为路线是「作者指定」而拒绝重排。
      .map((e, i) => ({ id: `e${i + 1}`, from: e.from, to: e.to, variant: e.kind === 'resource' ? 'dashed' : 'default' })),
    // 审计管线三层之间的顺序连线（L1 → L2 → L3），顺序来自代码推导
    ...pipelineIds.slice(0, -1).map((id, i) => ({ id: `p${i + 1}`, from: id, to: pipelineIds[i + 1], variant: 'emphasis' })),
  ].filter((c) => ids.has(c.from) && ids.has(c.to));
  // 外部系统引用边（虚线）：谁引用该主机就连谁
  for (const e of externalEdges) if (ids.has(e.from) && ids.has(e.to)) connections.push(e);
  // 实测否掉的一条路：按相对位置硬算 fromSide/toSide（目标在上就顶出底进）——
  //   结果穿越反而更多（我们 50 → 80 条），连本来能渲染的 17 组件项目也被弄坏。
  //   结论：出入边交给渲染器自己选更稳，我们只负责坐标与边集。
  // 边界框：模块分层（推导）+ **规则引擎三层** + **审计管线三层**（都由 deriveAuditLayers 推导）
  const boundaries = [
    ...layersToBoundaries(graph.components),
    ...audit.ruleEngine
      .map((l) => ({ kind: 'region', label: l.label, wraps: [basename(l.dir)] }))
      .filter((b) => ids.has(b.wraps[0])),
    ...(pipelineIds.length >= 2 ? [{ kind: 'region', label: '审计管线（三层）', wraps: pipelineIds }] : []),
    // 同父目录分组（回应「同一父目录显示不够好」）：≥2 个成员的目录各出一个框
    ...parentBoundaries(components),
  ];
  // 数据文件节点 + 读写边（来自 IO 事实；含 fetch 类，见 appendDataFileNodes 的说明）
  await appendDataFileNodes(repoPath, components, connections, ids, src, graph);
  // **孤立节点通用兜底**：外部节点（github/host）与跨层连线规则原本按本项目写死
  //   （只连 app/cli/http/git），换项目就没有对应模块 ⇒ 一堆组件成孤儿（实测 mediascape 有 5 个）。
  linkOrDropIsolated(repoPath, components, connections, boundaries, new Set(dirs));
  // 数据文件组件是在第一次布局**之后**追加的，必须再排一次版——否则它们没有 pos，
  //   官方 validate 直接报 `Component "data-xxx" needs pos [x,y] or grid row/col when layout.mode is "grid"`。
  //   这里把连线一起传进去——布局的排序依据现在是**从依赖图推导**的入度（见 layoutByLayer 注释）。
  // **不做组件聚合**：archify 官方布局手册（`archify/references/architecture-layout-repair.md`）第一条
  //   就写着「retaining **all required components**, relationships, labels, evidence, boundaries,
  //   and node sizes」——穿越要靠**重排坐标**（reflow the connected scene in one edit）解决，
  //   不是靠减少节点。实测教训：我曾按 >28 自动聚合到 14 个组件绕过穿越，图渲染是通过了，
  //   但**细节丢了一大截**（用户一眼看出「和之前变化太大」），方向错了。
  //   因此这里保留全部细粒度组件；布局问题回到 `layoutByLayer` 的坐标计算上解决。
  // 视图抽象层级由 resolveView 决定（三级判据与依据见该函数注释）
  const view = resolveView(components, connections);
  // 函数清单卡片（archify 的 cards：{dot,title,items[]}，schema 已实测）：
  //   数据来自 lib/arch/extract.js 的 funcNames —— 与 docs/FUNCTIONS.md **同一扫描器**（scanFileFuncs），
  //   所以卡片内容与已发布的函数列表永远一致。只给函数最多的前 6 个模块出卡片，避免页面过载。
  const cardsField = await buildFuncCards(repoPath);
  return {
    ...cardsField,
    // 顶层 cards 同时承载「子系统成员清单」：聚合视图不画组内关系，成员与来源路径必须可查（语义不丢）
    cards: [...(cardsField.cards || []), ...view.cards],
    schema_version: SCHEMA_VERSION,
    diagram_type: DIAGRAM_TYPE,
    // layout.mode 是 schema 里的可选枚举（当前只有 "grid"）；cols 必须覆盖最大列号，
    //   否则官方报 `Component "x" col N exceeds layout.cols N`。
    //   细粒度分支用 layoutByLayer 算出的 pos，不给 cols。
    layout: view.cols ? { mode: 'grid', cols: view.cols } : { mode: 'grid' },
    meta: {
      // quality_profile 决定验收档位：showcase 才启用 composition 系列严格检查（corridor/箭头/微段等）
      quality_profile: 'showcase',
      title: `${name} — 架构总览`,
      output: `${name}.architecture.html`,
      ...(evidence ? { repository: evidence } : {}),
    },
    // 重组后组件 id 已变化，细粒度的 boundaries 不再引用有效节点 ⇒ 不输出（聚合视图用 cards 表达成员）
    components: view.components,
    connections: view.connections,
  };
}

/**
 * 给目录挑一个「代表文件」作为 sources 锚点（archify 要求 sources 指向**文件**，不能是目录；
 *   且必须在 pinned revision 下存在——实测未提交的新文件会被官方 validate 判 file-missing）。
 * 顺序：git 已跟踪的 index.js / index.mjs / README.md → git 已跟踪的任意文件 →
 *   磁盘上的 index 系列 / README.md → 磁盘上任意文件。
 * @returns {string} 相对仓库根的路径（找不到任何文件时退回目录名，由 check 报出）
 */
function representativeFile(repoPath, dir) {
  const tracked = (() => {
    try {
      // core.quotepath=false：否则中文等非 ASCII 路径会被转义成 \345\212\237…（实测踩过，
      //   转义串既不是合法 POSIX 相对路径、check 也找不到该文件）
      const r = spawnSync('git', ['-c', 'core.quotepath=false', '-C', repoPath, 'ls-files', '--', dir], { encoding: 'utf8' });
      if (r.status !== 0) return [];
      // 跳过构建产物与隐藏文件：.pyc/__pycache__/node_modules 之类不该当「源码证据」
      return String(r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)
        .filter((p) => !/(^|\/)(__pycache__|node_modules|\.git)\//.test(p) && !/\.pyc$/.test(p) && !/(^|\/)\.[^/]+$/.test(p));
    } catch { return []; }
  })();
  const preferred = ['index.js', 'index.mjs', 'index.ts', 'README.md'];
  for (const f of preferred) {
    const p = `${dir}/${f}`;
    if (tracked.includes(p)) return p; // 已提交 → pinned revision 下必定存在
  }
  if (tracked.length) return tracked.sort()[0];
  for (const f of preferred) if (existsSync(join(repoPath, dir, f))) return `${dir}/${f}`;
  try {
    const first = readdirSync(join(repoPath, dir), { withFileTypes: true })
      .filter((it) => it.isFile() && !it.name.startsWith('.'))
      .map((it) => it.name)
      .sort()[0];
    if (first) return `${dir}/${first}`;
  } catch { /* 读不到就退回目录名 */ }
  return dir;
}

/** 统计目录下文件数（只用于 sublabel 展示，失败按 0）。 */
function countFiles(dir) {
  try {
    let n = 0;
    const walk = (d) => {
      for (const it of readdirSync(d, { withFileTypes: true })) {
        if (it.name === 'node_modules' || it.name === '.git') continue;
        const p = join(d, it.name);
        if (it.isDirectory()) walk(p);
        else n++;
      }
    };
    walk(dir);
    return n;
  } catch { return 0; }
}

/** 校验顶层必填字段与 meta（schema_version / diagram_type 是常量，meta 必填 title 与 output）。 */
function validateHeader(doc, errs) {
  if (doc?.schema_version !== SCHEMA_VERSION) errs.push(`schema_version 必须为 ${SCHEMA_VERSION}`);
  if (doc?.diagram_type !== DIAGRAM_TYPE) errs.push(`diagram_type 必须为 "${DIAGRAM_TYPE}"`);
  if (!doc?.meta?.title) errs.push('meta.title 必填');
  if (!doc?.meta?.output) errs.push('meta.output 必填');
  if (!Array.isArray(doc?.components) || doc.components.length === 0) errs.push('components 必须是非空数组');
}

/**
 * 校验组件：必填字段 / type 枚举 / id 去重 / sources 形状。
 * sources 必须是 1–3 项**对象数组**、每项必填 path——这条是实测踩过的坑
 *   （写成字符串数组会被 archify 官方 validate 拒掉），故内置校验必须覆盖。
 * @returns {Set<string>} 已声明组件 id 集合（供连线校验引用完整性）
 */
function validateComponents(doc, errs) {
  const ids = new Set();
  for (const c of doc?.components || []) {
    if (!c.id || !c.type || !c.label) errs.push(`组件缺必填字段（id/type/label）：${JSON.stringify(c).slice(0, 60)}`);
    if (c.type && !COMPONENT_TYPES.includes(c.type)) errs.push(`组件 ${c.id} 的 type 不在枚举内：${c.type}`);
    if (ids.has(c.id)) errs.push(`组件 id 重复：${c.id}`);
    ids.add(c.id);
    if (c.sources === undefined) continue;
    if (!Array.isArray(c.sources) || c.sources.length < 1 || c.sources.length > 3) {
      errs.push(`组件 ${c.id} 的 sources 必须是 1–3 项数组`);
      continue;
    }
    for (const s of c.sources) {
      if (!s || typeof s !== 'object' || Array.isArray(s) || typeof s.path !== 'string' || !s.path) {
        errs.push(`组件 ${c.id} 的 sources 每项必须是含 path 的对象：${JSON.stringify(s)}`);
      }
    }
  }
  return ids;
}

/** 校验连线：必填 from/to、引用完整性（必须指向已声明组件）、variant 枚举。 */
function validateConnections(doc, ids, errs) {
  for (const e of doc?.connections || []) {
    if (!e.from || !e.to) errs.push(`连线缺必填字段（from/to）：${JSON.stringify(e).slice(0, 60)}`);
    if (!ids.has(e.from)) errs.push(`连线 from 引用了不存在的组件：${e.from}`);
    if (!ids.has(e.to)) errs.push(`连线 to 引用了不存在的组件：${e.to}`);
    if (e.variant && !VARIANTS.includes(e.variant)) errs.push(`连线 variant 不在枚举内：${e.variant}`);
  }
}

/** 校验边界框：必填 kind/label/wraps、kind 枚举。 */
function validateBoundaries(doc, errs) {
  for (const b of doc?.boundaries || []) {
    if (!b.kind || !b.label || !Array.isArray(b.wraps)) errs.push('boundary 缺必填字段（kind/label/wraps）');
    if (b.kind && !BOUNDARY_KINDS.includes(b.kind)) errs.push(`boundary kind 不在枚举内：${b.kind}`);
  }
}

/**
 * 校验仓库证据：任一组件带 sources 时，meta.repository 必须存在且含 url + 40 位 revision
 *   （archify 官方 validate 的硬要求：`Repository evidence requires /meta/repository`）。
 */
function validateRepositoryEvidence(doc, errs) {
  const hasSources = (doc?.components || []).some((c) => Array.isArray(c.sources) && c.sources.length);
  if (!hasSources) return;
  const repo = doc?.meta?.repository;
  if (!repo || typeof repo !== 'object') { errs.push('组件带 sources 时必须提供 meta.repository（仓库证据）'); return; }
  if (!repo.url) errs.push('meta.repository.url 必填');
  if (!/^[a-fA-F0-9]{40}$/.test(String(repo.revision || ''))) errs.push('meta.repository.revision 必须是 40 位 commit SHA');
}

/**
 * 规范层校验（不依赖 archify 仓库，内置其 schema 的关键约束）。
 *
 * 拆成五个子校验函数：本函数原先一个函数里塞了「顶层 / 组件 / 连线 / 边界 / 仓库证据」
 *   五段校验，圈复杂度 48（阈值 10，自审 max-cyclomatic-complexity 最高项）。此处只做调度。
 *
 * @returns {string[]} 违规说明（空数组=通过）
 */
export function validateAgainstSpec(doc) {
  const errs = [];
  validateHeader(doc, errs);
  const ids = validateComponents(doc, errs);
  validateConnections(doc, ids, errs);
  validateBoundaries(doc, errs);
  validateRepositoryEvidence(doc, errs);
  return errs;
}

/**
 * 事实层校验（防漂移）：组件声明的 sources 路径必须真实存在；顶层源码目录必须都有组件。
 * @returns {string[]} 漂移说明（空数组=一致）
 */
export function checkDrift(repoPath, doc) {
  const issues = [];
  for (const c of doc?.components || []) {
    for (const src of c.sources || []) {
      // sources 项是对象（{path}）；兼容字符串写法但以对象为准
      const p = typeof src === 'string' ? src : src?.path;
      if (!p) { issues.push(`组件 ${c.id} 的 sources 项缺少 path`); continue; }
      if (!existsSync(join(repoPath, p))) issues.push(`组件 ${c.id} 声明的路径不存在：${p}`);
    }
  }
  const declared = new Set((doc?.components || []).map((c) => c.id));
  // lib/ 会被**展开成子模块**（不再作为单一组件出现）⇒ 它的完备性用「子模块是否都在」判定；
  //   其余顶层目录仍按「一个目录一个组件」判定。口径与 buildArchitectureDoc 保持一致。
  const libModules = deriveLibGraph(repoPath).components.map((m) => m.id);
  const sourceRootName = deriveLibGraph(repoPath).sourceRoot || 'lib';
  for (const d of readdirSync(repoPath, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || SKIP_TOP_DIRS.has(d.name)) continue;
    if (d.name === sourceRootName) {
      const missing = libModules.filter((m) => !declared.has(m));
      if (missing.length) issues.push(`${sourceRootName}/ 子模块缺少组件：${missing.join(', ')}`);
      continue;
    }
    if (!declared.has(d.name)) issues.push(`顶层目录 ${d.name}/ 没有对应组件（新增目录需在生成结果中体现）`);
  }
  return issues;
}

/** 输出路径：<repo>/.archify/<name>.architecture.json */
export function outputPath(repoPath, name = basename(resolve(repoPath))) {
  return join(repoPath, '.archify', `${name}.architecture.json`);
}

async function main() {
  const [cmd = 'gen', repoArg = '.', ...rest] = process.argv.slice(2);
  const repoPath = resolve(repoArg);
  const nameIdx = rest.indexOf('--name');
  const name = nameIdx >= 0 ? rest[nameIdx + 1] : basename(repoPath);
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    console.error(`❌ 不是目录：${repoPath}`);
    process.exitCode = 1;
    return;
  }
  const doc = await buildArchitectureDoc(repoPath, name);
  if (cmd === 'gen') { console.log(JSON.stringify(doc, null, 2)); return; }
  if (cmd === 'apply') {
    const out = outputPath(repoPath, name);
    mkdirSync(join(repoPath, '.archify'), { recursive: true });
    writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    console.log(`✅ 已写入 ${out}（${doc.components.length} 组件 / ${doc.connections.length} 连线）`);
    return;
  }
  if (cmd === 'check') {
    const out = outputPath(repoPath, name);
    const errs = existsSync(out)
      ? validateAgainstSpec(JSON.parse(readFileSync(out, 'utf8'))).concat(checkDrift(repoPath, JSON.parse(readFileSync(out, 'utf8'))))
      : [`未找到 ${out}（先运行 apply）`];
    if (errs.length) { console.error('❌ 校验未通过：'); for (const e of errs) console.error(`  - ${e}`); process.exitCode = 1; return; }
    console.log(`✅ ${out} 通过两层校验（规范层 + 事实层）`);
    return;
  }
  console.error(`未知子命令：${cmd}（可用：gen | apply | check）`);
  process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('archify-gen.mjs')) main();
