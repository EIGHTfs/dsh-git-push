// archify JSON 映射（事实层，第三步）。
//
// 把 aggregate 出来的组件/边映射成 archify 的 architecture JSON。
// 事实保证（与红线一致）：
//   · 每个 component 都能反查到真实文件（anchor + sources）；不编任何组件
//   · 每条 connection 都来自 extract 的确定性事实（import 边 / IO 读写边）；不编任何连线
//   · IO 事实（ioReads/ioWrites）映射成**数据文件节点 + 读写边**：读=虚线、写=实线
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_VERSION = 1;
const DIAGRAM_TYPE = 'architecture';
/** 路径哈希用的进制（36 = 0-9a-z，让 id 后缀短且合法）。 */
const HASH_RADIX = 36;
/** 组件副标题最大字符数（长文本会让标签超出组件宽度，官方 validate 会报 Label is wider than component）。 */
const SUB_LABEL_MAX = 22;
// archify 的组件类型枚举（common.schema.json#/$defs/componentType）
const TYPE_ENUM = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];

/** 数据文件节点的 id：路径 → 合法标识符（archify 的 id 模式不允许 / 与中文）。 */
export function dataFileId(path) {
  // id 也必须有长度上限：官方 validate 会拿 id 回显报错（实测 `data-archify-THIRD-PARTY-NOTICES-md`
  //   这类长 id 被当成标签宽度测量对象，报 `Label ... is wider than component`）。
  //   保留 basename 前 14 字符（可读）+ 路径哈希 4 位（保唯一），总长可控。
  const raw = String(path);
  const base = (raw.split('/').pop() || 'file').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  const suffix = h.toString(HASH_RADIX).slice(0, 4) || '0';
  return `data-${base.slice(0, 14) || 'file'}-${suffix}`;
}

/**
 * 收集「值得上图」的数据文件：来自 IO 事实里**仓库内**的相对路径。
 *
 * 两道事实过滤（实测不加会爆炸：本仓库曾映射出 133 个数据文件节点，把测试夹具
 *   a.js / hello.txt / secret.log 全算进来了）：
 *   ① 文件必须**真实存在**（repoPath 给了才判）——数据文件节点也是事实，不存在就不上图
 *   ② 排除测试夹具（test/ 下的临时文件是构造出来的样本，不是架构的一部分）
 * @returns {Map<string, {reads:string[], writes:string[]}>} 路径 → 哪些组件读/写它
 */
export function collectDataFiles(agg, facts, { repoPath = '' } = {}) {
  const out = new Map();
  const byComponent = new Map();
  for (const m of facts.modules || []) {
    const comp = (agg.components || []).find((c) => c.members.includes(m.id));
    if (!comp) continue;
    if (!byComponent.has(comp.id)) byComponent.set(comp.id, { reads: new Set(), writes: new Set() });
    const slot = byComponent.get(comp.id);
    for (const p of m.ioReads || []) slot.reads.add(p);
    for (const p of m.ioWrites || []) slot.writes.add(p);
  }
  for (const [compId, slot] of byComponent) {
    for (const p of slot.reads) {
      if (!isRepoRelative(p, repoPath)) continue;
      if (!out.has(p)) out.set(p, { reads: [], writes: [] });
      out.get(p).reads.push(compId);
    }
    for (const p of slot.writes) {
      if (!isRepoRelative(p, repoPath)) continue;
      if (!out.has(p)) out.set(p, { reads: [], writes: [] });
      out.get(p).writes.push(compId);
    }
  }
  return out;
}

/** 只认仓库内相对路径（排除绝对路径、node: 前缀、纯选项词），并做存在性/夹具过滤。 */
function isRepoRelative(p, repoPath = '') {
  const s = String(p || '');
  if (!s || s.startsWith('/') || s.startsWith('node:') || s.startsWith('http')) return false;
  if (s.startsWith('test/') || s.includes('node_modules')) return false; // 测试夹具与依赖目录不是架构
  // 注意别写成 `![/.]/.test(s)`：`!` 后紧跟 `/` 会让解析器把 `/[/.]/` 当正则开头，实测直接语法错误
  const hasSlashOrDot = s.includes('/') || s.includes('.');
  if (!hasSlashOrDot) return false;
  if (repoPath && !existsSync(join(repoPath, s))) return false; // 不存在就不算事实
  return true;
}

/**
 * 映射为 archify architecture 文档。
 * @param {{components:object[],edges:object[]}} agg aggregate.js 的产出
 * @param {object} facts extract.js 的产出
 * @param {{name?:string, repoPath?:string, evidence?:object|null, treeDoc?:object|null}} opts
 * @returns {object} archify JSON（可直接交给 archify 的 render/validate）
 */
export function toArchifyJson(agg, facts, { name = 'repo', repoPath = '', evidence = null, treeDoc = null } = {}) {
  const src = (p) => (evidence && p ? { sources: [{ path: p }] } : {});
  const components = [];
  const idMap = new Map(); // 组件 id → 图上的 id
  for (const c of agg.components || []) {
    const id = c.id;
    idMap.set(id, id);
    const desc = treeDoc ? (treeDoc[`${facts.sourceRoot}/${(c.members || [])[0]}`] || treeDoc[c.id]) : null;
    components.push({
      id,
      type: 'backend',
      label: c.layer || c.id,
      sublabel: String(desc || `${c.members?.length || 0} 模块 · ${c.fileCount} 文件 · ${c.funcCount} 函数`).slice(0, SUB_LABEL_MAX),
      ...src(c.anchor),
    });
  }
  // 数据文件节点（来自 IO 事实）
  const dataFiles = collectDataFiles(agg, facts, { repoPath });
  for (const p of dataFiles.keys()) {
    const anchorExists = repoPath ? existsSync(join(repoPath, p)) : false;
    components.push({
      id: dataFileId(p),
      type: 'database',
      label: p.split('/').pop(),
      sublabel: `数据文件 · ${p}`.slice(0, SUB_LABEL_MAX),
      ...src(anchorExists ? p : null),
    });
  }
  // 依赖边 + IO 读写边
  const ids = new Set(components.map((c) => c.id));
  const connections = [];
  for (const e of agg.edges || []) {
    if (!ids.has(idMap.get(e.from)) || !ids.has(idMap.get(e.to))) continue;
    connections.push({ from: idMap.get(e.from), to: idMap.get(e.to), variant: 'default' });
  }
  for (const [p, slot] of dataFiles) {
    const dId = dataFileId(p);
    for (const from of new Set(slot.reads)) connections.push({ from, to: dId, variant: 'dashed' });   // 读=虚线
    for (const from of new Set(slot.writes)) connections.push({ from, to: dId, variant: 'default' }); // 写=实线
  }
  return {
    schema_version: SCHEMA_VERSION,
    diagram_type: DIAGRAM_TYPE,
    layout: { mode: 'grid' },
    meta: {
      title: `${name} — 架构`,
      output: `${name}.architecture.html`,
      ...(evidence ? { repository: evidence } : {}),
    },
    components,
    connections,
  };
}
