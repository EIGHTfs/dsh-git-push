// 架构组件聚合（事实层，第二步）。
//
// 输入 extract.js 的细粒度模块（一个目录/文件一个模块），输出 8~15 个**架构组件**。
// 聚合口径**完全确定性**，不含任何 AI 判断：
//   ① 按目录名语义分层（复用 scripts/archify-imports.mjs 同一套关键词规则，口径一致）
//   ② 层内模块合并成一个组件；组件数超过上限时按「模块数」从多到少保留，其余并入「其它」
//   ③ 每个组件保留到「成员模块 + 代表文件」的反查关系——这是「事实保证」：
//      图上任何一个方块都能反查到真实文件，不是 AI 编出来的名字
import { inferLayer } from '../../scripts/archify-imports.mjs';

/**
 * 把细粒度模块聚合成架构组件。
 * @param {{modules:object[],edges:object[],sourceRoot:string|null}} facts extract.js 的产出
 * @param {{min?:number,max?:number}} [opts] 组件数上下限（默认 8~15）
 * @returns {{components:object[],edges:object[],layers:string[],stats:object}}
 */
export function aggregateModules(facts, { min = 8, max = 15 } = {}) {
  const modules = facts?.modules || [];
  if (!modules.length) return { components: [], edges: [], layers: [], stats: { components: 0, modules: 0, edges: 0 } };

  // ① 分层（确定性关键词规则）
  const byLayer = new Map();
  for (const m of modules) {
    const layer = inferLayer(m.id);
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(m);
  }
  // ② 超上限时把最小的层并入「其它」，直到组件数 <= max
  const entries = [...byLayer.entries()].sort((a, b) => b[1].length - a[1].length);
  while (entries.length > max) {
    const tail = entries.pop();
    const other = entries.find(([name]) => name === '其它');
    if (other) other[1].push(...tail[1]);
    else entries.push(['其它', tail[1]]);
  }
  // ③ 组装组件（成员模块 + 代表文件 + 事实统计）
  const layerOf = new Map(); // 模块 id → 组件 id
  const components = entries.map(([layer, mods]) => {
    const id = componentId(layer, mods);
    for (const m of mods) layerOf.set(m.id, id);
    const anchor = mods.flatMap((m) => m.files)[0] || null;
    return {
      id,
      layer,
      label: layer,
      members: mods.map((m) => m.id).sort(),
      // 代表文件用于 archify 的 sources 锚点（必须是真实存在的文件）
      anchor,
      fileCount: mods.reduce((n, m) => n + m.fileCount, 0),
      funcCount: mods.reduce((n, m) => n + m.funcCount, 0),
      maxComplexity: mods.reduce((n, m) => Math.max(n, m.maxComplexity), 0),
    };
  });

  // 边：跨组件的依赖按次数累加；组内依赖丢弃（图上看不到）
  const edgeCount = new Map();
  for (const e of facts.edges || []) {
    const from = layerOf.get(e.from);
    const to = layerOf.get(e.to);
    if (!from || !to || from === to) continue;
    const k = `${from}→${to}`;
    edgeCount.set(k, (edgeCount.get(k) || 0) + (e.count || 1));
  }
  const ids = new Set(components.map((c) => c.id));
  const edges = [...edgeCount.entries()]
    .map(([k, count]) => { const [from, to] = k.split('→'); return { from, to, count, kind: 'import' }; })
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .sort((a, b) => b.count - a.count);

  return {
    components,
    edges,
    layers: components.map((c) => c.layer),
    stats: { components: components.length, modules: modules.length, edges: edges.length, min, max },
  };
}

/** 组件 id：层名是中文，archify 的 id 模式只允许 `^[a-zA-Z][a-zA-Z0-9_-]*$`，故用层名映射英文短名。 */
const LAYER_IDS = {
  入口层: 'entry', 规则层: 'rules', 检查层: 'checks', 审计层: 'audit',
  'git 层': 'git', 客户端层: 'client', 基础层: 'core', 测试层: 'tests', 其它: 'misc',
};

function componentId(layer, mods) {
  if (LAYER_IDS[layer]) return LAYER_IDS[layer];
  // 未识别层：用成员里第一个合法标识符兜底（保证 id 模式合法）
  const first = mods.map((m) => m.id).find((x) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(x));
  return first || 'misc';
}
