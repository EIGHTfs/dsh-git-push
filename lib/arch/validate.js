// 四层校验（事实层收口）。
//
// 为什么要四层：单靠「schema 过没过」不够——JSON 可以完全合法却全是编的。
//   本插件的价值就在后三层：**引用能对上、事实真实存在、拓扑自洽**。
//   · L1 schema：必填字段 / 枚举 / id 模式（对齐 archify 的 architecture + common schema）
//   · L2 引用完整性：每条连线的 from/to 必须是已声明组件；无自环
//   · L3 事实：每个组件的 sources 路径必须**在仓库里真实存在**（存在即证据）
//   · L4 拓扑：依赖图无环（DAG）——环意味着层级关系被编错了
//
// 返回值按层分组，便于工具/HTTP 直接回传与前端展示。
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const COMPONENT_TYPES = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
const VARIANTS = ['default', 'emphasis', 'security', 'dashed'];
const BOUNDARY_KINDS = ['region', 'security-group'];
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/** L1：schema 校验（对齐 archify 的 architecture.schema.json + common.schema.json）。 */
function validateSchema(doc) {
  const errs = [];
  if (doc?.schema_version !== 1) errs.push('schema_version 必须为 1');
  if (doc?.diagram_type !== 'architecture') errs.push('diagram_type 必须为 "architecture"');
  if (!doc?.meta?.title) errs.push('meta.title 必填');
  if (!doc?.meta?.output) errs.push('meta.output 必填');
  if (!Array.isArray(doc?.components) || !doc.components.length) errs.push('components 必须是非空数组');
  for (const c of doc?.components || []) {
    if (!c.id || !c.type || !c.label) errs.push(`组件缺必填字段（id/type/label）：${JSON.stringify(c).slice(0, 60)}`);
    else if (!ID_RE.test(c.id)) errs.push(`组件 id 不符合 ^[a-zA-Z][a-zA-Z0-9_-]*$：${c.id}`);
    if (c.type && !COMPONENT_TYPES.includes(c.type)) errs.push(`组件 ${c.id} 的 type 不在枚举内：${c.type}`);
  }
  for (const e of doc?.connections || []) {
    if (!e.from || !e.to) errs.push(`连线缺必填字段（from/to）：${JSON.stringify(e).slice(0, 60)}`);
    if (e.variant && !VARIANTS.includes(e.variant)) errs.push(`连线 variant 不在枚举内：${e.variant}`);
  }
  for (const b of doc?.boundaries || []) {
    if (!b.kind || !b.label || !Array.isArray(b.wraps)) errs.push('boundary 缺必填字段（kind/label/wraps）');
    else if (!BOUNDARY_KINDS.includes(b.kind)) errs.push(`boundary kind 不在枚举内：${b.kind}`);
  }
  return errs;
}

/** L2：引用完整性（连线的两端必须是已声明组件；不允许自环）。 */
function validateReferences(doc) {
  const errs = [];
  const ids = new Set((doc?.components || []).map((c) => c.id));
  for (const e of doc?.connections || []) {
    if (e.from && !ids.has(e.from)) errs.push(`连线 from 引用了不存在的组件：${e.from}`);
    if (e.to && !ids.has(e.to)) errs.push(`连线 to 引用了不存在的组件：${e.to}`);
    if (e.from && e.from === e.to) errs.push(`不允许自环：${e.from}`);
  }
  return errs;
}

/** L3：事实（每个组件的 sources 路径必须在仓库里真实存在）。 */
function validateFacts(doc, repoPath) {
  const errs = [];
  if (!repoPath) return errs; // 没给仓库就不做事实层（调用方明确表示跳过）
  for (const c of doc?.components || []) {
    for (const s of c.sources || []) {
      const p = typeof s === 'string' ? s : s?.path;
      if (!p) { errs.push(`组件 ${c.id} 的 sources 项缺少 path`); continue; }
      if (!existsSync(join(repoPath, p))) errs.push(`组件 ${c.id} 声明的路径不存在：${p}`);
    }
  }
  return errs;
}

/** L4：拓扑（依赖图无环——环说明层级被编错了）。 */
function validateTopology(doc) {
  const errs = [];
  const ids = (doc?.components || []).map((c) => c.id);
  const adj = new Map(ids.map((id) => [id, []]));
  for (const e of doc?.connections || []) {
    if (adj.has(e.from) && adj.has(e.to) && e.from !== e.to) adj.get(e.from).push(e.to);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(ids.map((id) => [id, WHITE]));
  const cyclePath = [];
  const dfs = (node, stack) => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adj.get(node) || []) {
      if (color.get(next) === GRAY) { cyclePath.push([...stack, next].join(' → ')); return true; }
      if (color.get(next) === WHITE && dfs(next, stack)) return true;
    }
    color.set(node, BLACK);
    stack.pop();
    return false;
  };
  for (const id of ids) {
    if (color.get(id) === WHITE && dfs(id, [])) break;
  }
  if (cyclePath.length) errs.push(`依赖图存在环：${cyclePath[0]}`);
  // 悬空：一条连线都没有的组件（图里看不出它与谁有关系）
  const linked = new Set((doc?.connections || []).flatMap((e) => [e.from, e.to]));
  const dangling = ids.filter((id) => !linked.has(id));
  if (dangling.length) errs.push(`孤立组件（无任何连线）：${dangling.join(', ')}`);
  return errs;
}

/**
 * 四层校验。
 * @param {object} doc archify architecture 文档
 * @param {{repoPath?:string, allowDangling?:boolean}} [opts]
 *   repoPath 给了才做 L3；allowDangling=true 时 L4 的孤立组件只记提示不算错
 * @returns {{ok:boolean, layers:{schema:string[],references:string[],facts:string[],topology:string[]}, errors:number}}
 */
export function validateArchJson(doc, { repoPath = '', allowDangling = false } = {}) {
  const topologyErrs = validateTopology(doc);
  const layers = {
    schema: validateSchema(doc),
    references: validateReferences(doc),
    facts: validateFacts(doc, repoPath),
    topology: allowDangling ? topologyErrs.filter((m) => !m.startsWith('孤立组件')) : topologyErrs,
  };
  const errors = Object.values(layers).reduce((n, arr) => n + arr.length, 0);
  return { ok: errors === 0, layers, errors };
}
