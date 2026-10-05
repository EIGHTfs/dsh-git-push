// validateFacts —— ArchFacts IR 的**事实校验**（规范 docs/ARCH-FACTS-SPEC.md 第 6 节 8 条不变量）。
//
// 与 validateArchJson 的区别（这是分层的关键）：
//   · validateFacts 校验「**事实对不对**」——不依赖任何渲染器，是核心资产
//   · validateArchJson 校验「**转译后的渲染格式合不合规**」——那层可以用渲染器自带的 schema
// 两层分开后：换渲染器只需换转译器，事实校验原封不动。
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ARCH_FACTS_SCHEMA, NODE_KINDS, EDGE_KINDS } from './ir.js';

/** 取 evidence 条目里的文件部分（`path:line` 或 `path` 或 `module:io` 占位）。 */
function evidenceFile(entry) {
  const s = String(entry || '');
  if (!s) return '';
  const i = s.lastIndexOf(':');
  // 仅当冒号后是纯数字时才算行号，否则整串当路径（兼容 Windows 盘符与 `module:io` 占位）
  if (i > 0 && /^\d+$/.test(s.slice(i + 1))) return s.slice(0, i);
  return s;
}

/**
 * 校验 ArchFacts IR 的事实正确性。
 * @param {object} ir toArchFacts 的产出
 * @param {{repoPath?:string}} [opts] 给了 repoPath 才能校验「文件真实存在」类不变量
 * @returns {{ok:boolean, errors:string[], warnings:string[], counts:object}}
 */
export function validateFacts(ir, { repoPath = '' } = {}) {
  const errors = [];
  const warnings = [];
  if (ir?.schema !== ARCH_FACTS_SCHEMA) errors.push(`schema 必须是 ${ARCH_FACTS_SCHEMA}，实得 ${ir?.schema}`);
  const nodes = Array.isArray(ir?.nodes) ? ir.nodes : [];
  const edges = Array.isArray(ir?.edges) ? ir.edges : [];
  if (!nodes.length) errors.push('nodes 不能为空');

  const ids = new Set();
  const exists = (p) => !repoPath || !p || existsSync(join(repoPath, p));

  for (const n of nodes) {
    // ⑧ kind 取值合法
    if (!NODE_KINDS.includes(n.kind)) errors.push(`节点 ${n.id} 的 kind 非法：${n.kind}`);
    if (ids.has(n.id)) errors.push(`节点 id 重复：${n.id}`);
    ids.add(n.id);
    // ① anchor 必须真实存在（data/external 允许为 null）
    if (n.anchor && !exists(n.anchor)) errors.push(`节点 ${n.id} 的 anchor 不存在：${n.anchor}`);
    if (n.kind === 'module' && !n.anchor) errors.push(`模块节点 ${n.id} 缺少 anchor`);
    // ② module 节点的 members 非空且成员文件存在
    if (n.kind === 'module') {
      if (!Array.isArray(n.members) || !n.members.length) errors.push(`模块节点 ${n.id} 的 members 为空`);
      for (const m of n.members || []) {
        if (!exists(m)) errors.push(`节点 ${n.id} 的成员不存在：${m}`);
      }
    }
    // ③ evidence 每条非空、文件部分存在（行号越界容忍）
    if (!Array.isArray(n.evidence) || !n.evidence.length) errors.push(`节点 ${n.id} 缺少 evidence`);
    for (const e of n.evidence || []) {
      if (!String(e || '').trim()) errors.push(`节点 ${n.id} 的 evidence 含空项`);
      else if (!exists(evidenceFile(e))) errors.push(`节点 ${n.id} 的 evidence 文件不存在：${e}`);
    }
  }

  const adj = new Map();
  for (const e of edges) {
    // ⑧ kind 取值合法
    if (!EDGE_KINDS.includes(e.kind)) errors.push(`边 ${e.from}→${e.to} 的 kind 非法：${e.kind}`);
    // ④ 两端都在 nodes 里
    if (!ids.has(e.from)) errors.push(`边 from 引用了不存在的节点：${e.from}`);
    if (!ids.has(e.to)) errors.push(`边 to 引用了不存在的节点：${e.to}`);
    // ⑤ 无自环
    if (e.from === e.to) errors.push(`不允许自环：${e.from}`);
    // ③ evidence 非空（允许 `module:io` 这类占位，只要求非空）
    if (!Array.isArray(e.evidence) || !e.evidence.length) errors.push(`边 ${e.from}→${e.to} 缺少 evidence`);
    if (ids.has(e.from) && ids.has(e.to) && e.from !== e.to) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from).push(e.to);
    }
  }

  // ⑥ 无环（DAG）。**只在模块级判错**：聚合层环是常态（层与层互相依赖），记为 warning。
  //    这里用 kind/layer 区分：节点带 members 超过 1 个视为「聚合节点」。
  const isAggregated = new Set(nodes.filter((n) => (n.members || []).length > 1).map((n) => n.id));
  const WHITE = 0; const GRAY = 1; const BLACK = 2;
  const color = new Map(nodes.map((n) => [n.id, WHITE]));
  const cyclePath = [];
  const dfs = (node, stack) => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adj.get(node) || []) {
      if (color.get(next) === GRAY) { cyclePath.push([...stack, next]); return true; }
      if (color.get(next) === WHITE && dfs(next, stack)) return true;
    }
    color.set(node, BLACK);
    stack.pop();
    return false;
  };
  for (const n of nodes) if (color.get(n.id) === WHITE && dfs(n.id, [])) break;
  for (const cyc of cyclePath) {
    const allAgg = cyc.every((id) => isAggregated.has(id));
    const msg = `依赖环：${cyc.join(' → ')}`;
    if (allAgg) warnings.push(`${msg}（聚合层环，属正常：层与层互相依赖）`);
    else errors.push(`${msg}（模块级环，属设计问题）`);
  }

  // ⑦ totals 自洽
  const t = ir?.totals || {};
  if (t.nodes !== nodes.length) errors.push(`totals.nodes=${t.nodes} 与 nodes 长度 ${nodes.length} 不一致`);
  if (t.edges !== edges.length) errors.push(`totals.edges=${t.edges} 与 edges 长度 ${edges.length} 不一致`);

  const counts = {
    nodes: nodes.length,
    edges: edges.length,
    module: nodes.filter((n) => n.kind === 'module').length,
    data: nodes.filter((n) => n.kind === 'data').length,
    external: nodes.filter((n) => n.kind === 'external').length,
  };
  return { ok: errors.length === 0, errors, warnings, counts };
}
