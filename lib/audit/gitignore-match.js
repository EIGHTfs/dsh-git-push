/**
 * dsh-git-push gitignore 语法匹配器（非 git 目录兜底，2026-09-18）
 *
 * 为什么需要：`.auditignore` 原先只走 `git check-ignore`，因此**仅在 git 仓库内生效**——
 *   非 git 目录（解压的源码包、临时导出目录、未 init 的工程）下 `.auditignore` 被完全忽略，
 *   实测同一个 `*.sh` 规则在 `git init` 前后行为相反。本模块提供纯 JS 兜底，
 *   使 `.auditignore` 在无 git 时同样生效。
 *
 * 语义对齐 git（用真 git 建立基准后逐条对齐，见 test/test-gitignore-match.mjs）：
 *   - `*.sh`        匹配**任意层级**（不是只根目录）——gitignore 的 `*` 不跨 `/`，
 *                   但无 `/` 的模式整体可匹配任意深度，故 `*.sh` = 任意层级的 .sh
 *   - `/ + *.sh`       仅根目录（前导 `/` 锚定）
 *   - `sub/*.sh`    含 `/` 的模式从仓库根锚定，`*` 不跨 `/`
 *   - `** + / + *.sh`     任意层级（显式递归）
 *   - `gen/`        目录规则：匹配该目录**及其下全部内容**
 *   - `!xxx`        取反（白名单恢复），**后出现的规则覆盖先出现的**
 *
 * 与 git 的已知差异（有意为之，够用即可）：
 *   - 不处理嵌套 `.gitignore`（只处理传入的单份规则文本）
 *   - `**` 的极端位置组合不保证与 git 逐字节一致
 * 这些差异只影响「非 git 兜底」路径；git 仓库仍走 `git check-ignore`，语义 100% 一致。
 */
import { globToRegex } from './glob.js';

/**
 * 解析 gitignore 文本为规则数组。
 *
 * 逐行处理：去尾随空白、跳过空行与 `#` 注释、识别 `!` 取反与前导 `/` 锚定、
 * 识别尾随 `/` 的目录规则。
 * @param {string} text gitignore 格式文本
 * @returns {Array<{negated:boolean, dirOnly:boolean, anchored:boolean, pattern:string, re:RegExp|null}>}
 */
export function parseGitignore(text) {
  const rules = [];
  for (const raw of String(text || '').split('\n')) {
    let line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let negated = false;
    if (line.startsWith('!')) { negated = true; line = line.slice(1); }
    if (!line) continue;
    let dirOnly = false;
    if (line.endsWith('/')) { dirOnly = true; line = line.replace(/\/+$/, ''); }
    if (!line) continue;
    let anchored = false;
    if (line.startsWith('/')) { anchored = true; line = line.replace(/^\/+/, ''); }
    // 含 `/` 的模式在 gitignore 中天然从根锚定
    if (line.includes('/')) anchored = true;
    if (!line) continue;
    rules.push({ negated, dirOnly, anchored, pattern: line, re: compilePattern(line, anchored) });
  }
  return rules;
}

/**
 * 把单条 pattern 编译为匹配「仓库相对路径」的正则。
 *
 * 无 `/` 的模式（anchored=false）编译为「任意层级」：任意目录前缀 + pattern，
 *   这正是 gitignore 里 `*.sh` 能命中 `deep/a/b/x.sh` 的原因。
 * @param {string} pattern 已剥离 `!`、前导 `/`、尾随 `/` 的模式
 * @param {boolean} anchored 是否从根锚定
 * @returns {RegExp|null}
 */
function compilePattern(pattern, anchored) {
  const body = globToRegex(pattern, false);
  if (!body) return null;
  try {
    return new RegExp(anchored ? `^${body.source}$` : `^(?:.*/)?${body.source}$`);
  } catch {
    return null;
  }
}

/**
 * 判断相对路径是否被规则集忽略。
 *
 * 语义要点：
 *   - 规则**顺序敏感**：后出现的规则覆盖先出现的（`!` 恢复同样受顺序影响）
 *   - 目录规则（`gen/`）命中该目录本身**及其全部子路径**
 *   - 传入的路径统一用 `/` 分隔的仓库相对路径
 * @param {Array} rules parseGitignore 的结果
 * @param {string} relPath `/` 分隔的相对路径
 * @param {boolean} [isDir] 该路径是否为目录（当前仅用于语义自解释，判定不区分）
 * @returns {boolean} true = 被忽略
 */
export function isIgnoredByRules(rules, relPath, isDir = false) {
  const p = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!p) return false;
  let ignored = false;
  for (const r of rules) {
    if (!r.re) continue;
    let hit = r.re.test(p);
    // 目录规则：还命中其下所有后代（gen/ → gen/a/b.js）
    if (!hit && r.dirOnly) {
      const segs = p.split('/');
      for (let i = 1; i < segs.length; i += 1) {
        if (r.re.test(segs.slice(0, i).join('/'))) { hit = true; break; }
      }
    }
    if (hit) ignored = !r.negated;
  }
  return ignored;
}

/**
 * 一次性判断：给定 gitignore 文本与相对路径，是否被忽略。
 * @param {string} text gitignore 格式文本
 * @param {string} relPath `/` 分隔的相对路径
 * @param {boolean} [isDir]
 * @returns {boolean}
 */
export function isIgnored(text, relPath, isDir = false) {
  return isIgnoredByRules(parseGitignore(text), relPath, isDir);
}
