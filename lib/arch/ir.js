// ArchFacts —— 本插件**自己的中性中间层**（IR），规范见 docs/ARCH-FACTS-SPEC.md。
//
// 为什么要有它（而不是直接产出某个渲染器的 JSON）：
//   ① 事实层与渲染格式解耦：换渲染器只加一个 to-xxx.js，不动 extract/aggregate/validate
//      （此前吃过亏——同一逻辑写在两处、注释里只能写「改动必须同步」）
//   ② IR 层能独立做「事实校验」（validateFacts），校验的是**事实对不对**，而不是格式合不合规
//   ③ 证据链（evidence）随 IR 走，任何渲染器都能用
//
// IR 里**不出现**：颜色、坐标、图标、布局模式、文件扩展名、variant/sublabel 等渲染器口味。

/** IR 版本号。破坏性改动升版本，转译器按版本分支。 */
export const ARCH_FACTS_SCHEMA = 'arch-facts/1';

/** 节点种类枚举。 */
export const NODE_KINDS = ['module', 'data', 'external'];

/** 边种类枚举。 */
export const EDGE_KINDS = ['import', 'io-read', 'io-write', 'resource', 'external-ref', 'call'];

/**
 * 由「模块事实 + 聚合结果」构造 ArchFacts IR。
 *
 * 输入沿用既有形状（不改动 extract.js / aggregate.js 的输出）：
 *   facts: { modules:[{id,dir,files,fileCount,funcCount,funcNames,maxComplexity,maxFuncLines,ioReads,ioWrites}],
 *            edges:[{from,to,count,kind}], totals, sourceRoot }
 *   agg:   { components:[{id,layer,label,members,anchor,fileCount,funcCount,maxComplexity}], edges, layers, stats }
 *
 * @param {object} agg 聚合结果
 * @param {object} facts 模块事实
 * @param {{name?:string, repoPath?:string, revision?:string, generatedAt?:string,
 *          externals?:{label:string,refs:string[]}[],
 *          dataFiles?:Map<string,{reads:string[],writes:string[]}>}} [opts]
 * @returns {object} ArchFacts IR
 */
export function toArchFacts(agg, facts, opts = {}) {
  const repoPath = opts.repoPath || '';
  const nodes = [];
  const edges = [];

  // ① 模块节点：来自聚合组件（若没有聚合结果就退回原始模块），每个都带 members + anchor + evidence
  const comps = agg?.components?.length
    ? agg.components
    : (facts.modules || []).map((m) => ({
      id: m.id, layer: m.id, label: m.id, members: m.files || [], anchor: m.files?.[0] || null,
      fileCount: m.fileCount, funcCount: m.funcCount, maxComplexity: m.maxComplexity,
    }));
  const byId = new Map((facts.modules || []).map((m) => [m.id, m]));
  for (const c of comps) {
    const src = byId.get(c.id);
    // 聚合结果的 c.members 是**模块 id**，而 IR 规范要求 members 是**文件列表**（可反查）
    //   —— 实测踩过：直接用模块 id 会被 validateFacts 判「成员不存在」。
    const memberFiles = (c.members || []).flatMap((mid) => byId.get(mid)?.files || []).filter(Boolean);
    const members = (memberFiles.length ? memberFiles : (src?.files || [])).slice();
    nodes.push({
      id: c.id,
      kind: 'module',
      label: c.label || c.id,
      layer: c.layer || c.id,
      members,
      anchor: c.anchor || src?.files?.[0] || null,
      stats: {
        files: c.fileCount ?? src?.fileCount ?? members.length,
        funcs: c.funcCount ?? src?.funcCount ?? 0,
        maxComplexity: c.maxComplexity ?? src?.maxComplexity ?? 0,
        maxFuncLines: src?.maxFuncLines ?? 0,
      },
      funcNames: (src?.funcNames || []).slice(),
      io: { reads: (src?.ioReads || []).slice(), writes: (src?.ioWrites || []).slice() },
      evidence: members.slice(0, 8),
    });
  }

  // ② 数据文件节点（kind='data'）：来自 IO 事实；**不要求文件在仓库里存在**——
  //    运行时文件（如 .pawchive/creators-cache.json）也是真实 IO 事实，anchor 为 null。
  for (const [path, slot] of opts.dataFiles || []) {
    // 与 to-json.js 的 dataFileId 同一口径：**id 必须有长度上限**。
    //   原来这里不截断，长路径会生成超长 id，官方 validate 拿 id 回显时报「标签比组件宽」。
    const base = String(path).split('/').pop() || 'file';
    let hash = 0;
    for (let i = 0; i < String(path).length; i += 1) hash = (hash * 31 + String(path).charCodeAt(i)) >>> 0;
    const id = `data-${base.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 14) || 'file'}-${hash.toString(36).slice(0, 4) || '0'}`;
    if (nodes.some((n) => n.id === id)) continue;
    nodes.push({
      id, kind: 'data', label: String(path).split('/').pop() || path, layer: 'data',
      members: [path], anchor: null,
      stats: { files: 1, funcs: 0, maxComplexity: 0, maxFuncLines: 0 },
      io: { reads: [], writes: [] }, evidence: [path],
    });
    for (const from of new Set(slot.reads || [])) {
      edges.push({ from, to: id, kind: 'io-read', count: 1, evidence: [`${from}:io`] });
    }
    for (const from of new Set(slot.writes || [])) {
      edges.push({ from, to: id, kind: 'io-write', count: 1, evidence: [`${from}:io`] });
    }
  }

  // ③ 外部系统节点（kind='external'）：来自「源码里出现的 URL 主机名」
  for (const ext of opts.externals || []) {
    const id = `ext-${String(ext.label).replace(/[^a-zA-Z0-9]/g, '-')}`;
    if (nodes.some((n) => n.id === id)) continue;
    nodes.push({
      id, kind: 'external', label: ext.label, layer: 'external',
      members: (ext.refs || []).slice(), anchor: null,
      stats: { files: (ext.refs || []).length, funcs: 0, maxComplexity: 0, maxFuncLines: 0 },
      io: { reads: [], writes: [] }, evidence: (ext.refs || []).slice(0, 8),
    });
  }

  // ④ import 边：沿用事实层的边，补 kind 与 evidence（行号信息由提取器提供时使用）
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of facts.edges || []) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    edges.push({
      from: e.from,
      to: e.to,
      kind: e.kind === 'resource' ? 'resource' : 'import',
      count: e.count || 1,
      evidence: (e.evidence || []).slice(),
    });
  }

  return {
    schema: ARCH_FACTS_SCHEMA,
    repo: {
      name: opts.name || '',
      root: repoPath,
      sourceRoot: facts.sourceRoot ?? null,
      ...(opts.revision ? { revision: opts.revision } : {}),
      ...(opts.generatedAt ? { generatedAt: opts.generatedAt } : {}),
    },
    totals: {
      files: facts.totals?.files ?? 0,
      funcs: facts.totals?.funcs ?? 0,
      nodes: nodes.length,
      edges: edges.length,
    },
    nodes,
    edges,
    // 五张事实清单（规范第 3.5 节）：图的**原始形态**，与 nodes/edges 同源、逐条可反查。
    //   事实层已产出（extractArchFacts），这里原样透传——渲染器要列表就用列表，要图就用图。
    files: (facts.files || []).slice(),
    functions: (facts.functions || []).slice(),
    urls: (facts.urls || []).slice(),
    io: (facts.io || []).slice(),
    apis: (facts.apis || []).slice(),
    groups: (opts.groups || []).slice(),
    meta: { tool: 'dsh-git-push', schemaDoc: 'docs/ARCH-FACTS-SPEC.md' },
  };
}
