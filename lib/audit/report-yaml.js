/**
 * 审计结果 YAML 报告（2026-09-16 新增）。
 *
 * 把平铺 findings 聚合成层级 YAML：summary → 拦截级别 → 目录 → 文件 → 规则明细。
 * 供 CLI --json / 插件工具 code_audit 返回体携带，便于人读与机器解析。
 */

import { dump as yamlDump } from '../vendor/js-yaml/js-yaml.mjs';

/** 拦截级别顺序（聚合时按此排布；未知级别归入其他）。 */
const SEVERITY_ORDER = ['blocker', 'warning', 'notice', 'info'];

/**
 * 从发现列表构建层级聚合的 YAML 文本。
 *
 * 层级：
 *   summary: { blocker, warning, notice, info, total }   —— 拦截级别计数
 *   blocker:                                             —— 每级别一个键
 *     <目录>:                                            —— 文件所在目录（相对路径或不含文件名的路径段）
 *       <文件名>:                                        —— 具体文件
 *         rules:                                         —— 该文件命中明细
 *           - rule / line / message
 *
 * @param {Array} findings 统一问题对象数组（file/line/rule/severity/message）
 * @param {object} [opts] { includeMessage: true } —— message 过长时可截断
 * @returns {string} YAML 文本（js-yaml dump，noRefs + 不换行）
 */
export function findingsToYaml(findings = [], { includeMessage = true, maxMessageLen = 200 } = {}) {
  const list = Array.isArray(findings) ? findings : [];
  // 1) 按拦截级别分组
  const bySeverity = new Map(); // severity → Map(dir → Map(file → rules[]))
  for (const f of list) {
    const sev = f.severity === 'error' ? 'blocker' : (String(f.severity || 'warning'));
    if (!bySeverity.has(sev)) bySeverity.set(sev, new Map());
    const dirFile = bySeverity.get(sev);
    const rel = String(f.file || '');
    // 目录 = 路径去掉最后一段（文件）；根级文件目录记 ''（YAML 里用 ./）
    const slash = rel.lastIndexOf('/');
    const dir = slash > 0 ? rel.slice(0, slash + 1) : '';
    const file = slash >= 0 ? rel.slice(slash + 1) : rel;
    if (!dirFile.has(dir)) dirFile.set(dir, new Map());
    const fileMap = dirFile.get(dir);
    if (!fileMap.has(file)) fileMap.set(file, []);
    const entry = { rule: f.rule || '', line: f.line || 0 };
    if (includeMessage) entry.message = String(f.message || '').slice(0, maxMessageLen);
    fileMap.get(file).push(entry);
  }
  // 2) 计数 summary
  const summary = { blocker: 0, warning: 0, notice: 0, info: 0, total: list.length };
  for (const sev of bySeverity.keys()) {
    const n = countSeverity(bySeverity.get(sev) || new Map());
    if (sev === 'blocker') summary.blocker = n;
    else if (sev === 'warning') summary.warning = n;
    else if (sev === 'notice') summary.notice = n;
    else summary.info += n;
  }
  // 3) 组装层级对象（按 SEVERITY_ORDER 排布 + 未知级别）
  const tree = { summary };
  const keyOrder = [...SEVERITY_ORDER, ...new Set([...bySeverity.keys()].filter((s) => !SEVERITY_ORDER.includes(s)))];
  for (const sev of keyOrder) {
    const dirMap = bySeverity.get(sev);
    if (!dirMap || !dirMap.size) {
      tree[sev] = sev === 'blocker' || sev === 'warning' || sev === 'notice' || sev === 'info' ? [] : null;
      continue;
    }
    const sevNode = {};
    for (const [dir, fileMap] of [...dirMap.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      const dirKey = dir || './';
      sevNode[dirKey] = {};
      for (const [file, rules] of [...fileMap.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
        sevNode[dirKey][file] = { rules };
      }
    }
    tree[sev] = sevNode;
  }
  return yamlDump(tree, { noRefs: true, lineWidth: -1 });
}

/** 统计一个级别的 dir→file→rules 聚合法命中总数。 */
function countSeverity(dirMap) {
  let n = 0;
  for (const fileMap of dirMap.values()) {
    for (const rules of fileMap.values()) n += rules.length;
  }
  return n;
}