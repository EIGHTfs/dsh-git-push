/**
 * 仓库级检查：逐文件扫描实现过多（`kind: multi-file-scanners`）
 *
 * 【判据】同一函数体内**同时**出现 `readdir` 与 `stat` ⇒ 一个「逐文件取属性」的扫描实现。
 *   全仓这类实现数 > `min_occurrences`（规则字段，默认 3）⇒ 报 **一条** notice：
 *   「同一职责是否被各处独立实现了一遍」交人工判断（不是「你有 N 个 bug」✗）。
 *
 * 【为什么只报一处】这是**整个仓库**的属性（与 duplicate-code 同性质）。逐文件报会在 N 个
 *   文件上产出 N 条同义提示，把真实问题淹掉 ⇒ 只在代表文件上报一次，其余实现列进 message ✓
 *   （代表文件 = 路径字典序最小者，由 orchestrate 的 pickRepoLevelAnchorFile 决定语义）。
 *
 * 【口径单一】判据实现只在 `lib/ast/fs-hotspots.js` 一份 —— 独立 CLI
 *   `scripts/scan-fs-hotspots.mjs` 用的是同一个函数，不存在「规则一套、脚本一套」的漂移 ✗
 *
 * @param {Array<{path:string,text:string}>} fileTexts 全仓代码文件文本
 * @param {Array} rules 该 kind 下的规则（取第一条；阈值读 min_occurrences / extra.minOccurrences）
 * @returns {Array} findings
 */
import { scanFsHotspots } from '../ast/fs-hotspots.js';

export function checkMultiFileScanners(fileTexts = [], rules = null) {
  const findings = [];
  if (!Array.isArray(fileTexts) || fileTexts.length < 2) return findings; // 单文件谈不上「多实现」
  const rule = Array.isArray(rules) && rules.length ? rules[0] : null;
  if (!rule) return findings;

  const threshold = Number(rule?.extra?.minOccurrences ?? rule?.minOccurrences ?? 3) || 3;
  const severity = 'notice'; // 恒 notice：这是启发式提示（不同用途的扫描器是合法的）⇒ 只提示不警告

  let agg;
  try {
    agg = scanFsHotspots(fileTexts);
  } catch {
    return findings; // 单个异常不影响整轮审计
  }
  const scanners = agg.scanners || [];
  if (scanners.length <= threshold) return findings;

  // 代表文件 = 路径字典序最小者（与 repo-level 语义一致，保证同一仓库每次报同一处）
  const sorted = [...scanners].sort((a, b) => String(a.file).localeCompare(String(b.file)));
  const first = sorted[0];
  const rest = sorted.slice(1);
  const list = rest.map((s) => `${s.file}::${s.fn}()`).join('、');
  findings.push({
    rule: rule.id,
    severity,
    file: first.file,
    line: first.line,
    message: `仓库内「同一函数里既 readdir 又 stat」的逐文件扫描实现共 ${scanners.length} 个`
      + `（阈值 ${threshold}）：${first.file}::${first.fn}()`
      + (list ? ` 等 —— 其余：${list}` : '')
      + '。提示：同一职责被各处独立实现时，合并成一层遍历/索引可省掉重复 readdir 与重复 stat'
      + '（不同用途的扫描器属正常，需人工判断）',
    dimensions: rule?.dimensions,
  });
  return findings;
}
