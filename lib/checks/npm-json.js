/**
 * 检查层 · package.json 检查
 *
 * 职责：npm 包规范检查（结构化读取 JSON，不靠正则猜）、依赖版本范围、私有包豁免。
 */

import { join } from 'node:path';

import { existsSync } from 'node:fs';

import { makeFinding } from '../audit/index.js';
import { HINT_SENSITIVE } from './common.js';

/**
 * 找出依赖声明里用 "*" 或 ^0.x（版本不可控）的条目。
 * 只查 dependencies / peerDependencies / optionalDependencies（devDependencies 不随包发布，不在管辖内）。
 *
 * @param {object} pkg 解析后的 package.json
 * @returns {Array<string>} 有问题的依赖名列表（形如 `@scope/name@*`）
 */
function starRangeDeps(pkg) {
  const out = [];
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [depName, range] of Object.entries(deps)) {
      if (typeof range !== 'string') continue;
      const spec = range.trim();
      if (spec === '*' || spec === 'x' || spec === 'latest' || /^\^0\./.test(spec)) out.push(`${depName}@${spec}`);
    }
  }
  return out;
}

/**
 * npm 结构化检查（npm-json kind，1.0.3）。
 * 对 package.json 做真实解析判定（替代「命中即提示」弱 pattern）：
 *   - npm/files-missing-lib：main/exports 指向 lib/ 下入口时，files 数组须包含 lib（或对应入口文件）
 *   - npm/undeclared-js-yaml：lib 代码 import 'js-yaml' 时，dependencies 须已声明（文件级仅能验 dependencies 存在性；
 *     import 证据属全仓语义，证据法见规则描述，文件级 fallback 只验「dependencies 含 js-yaml」）
 * 仅对扩展名为 json 且文件名为 package.json 的目标执行。
 */
/**
 * 在 package.json 文本里定位某个键（或含某个值的行）的行号，供 finding 定位。
 * 找不到时回退第 1 行。
 * @param {string} text package.json 全文
 * @param {string} key 键名（如 'files'）
 * @param {string} [valueHint] 值片段（用于定位具体条目行）
 * @returns {number} 1-based 行号
 */
function findJsonKeyLine(text, key, valueHint) {
  const lines = String(text || '').split('\n');
  if (valueHint) {
    const i = lines.findIndex((l) => l.includes(valueHint));
    if (i >= 0) return i + 1;
  }
  const j = lines.findIndex((l) => new RegExp(`"${key}"\\s*:`).test(l));
  return j >= 0 ? j + 1 : 1;
}

export function checkNpmJson({ file, text, rules, repoHasJsYamlImport, repoPath }) {
  const findings = [];
  const base = String(file || '').split(/[/\\]/).pop();
  if (base !== 'package.json') return findings;
  let pkg = null;
  try { pkg = JSON.parse(text); } catch { return findings; } // JSON 语法错误有 syntax 检查器兜底
  for (const rule of rules || []) {
    const sev = rule.severity === 'error' ? 'blocker' : rule.severity || 'warning';
    if (rule.id === 'npm/files-missing-lib') {
      const mainTarget = typeof pkg.main === 'string' ? pkg.main : null;
      const exportsTargets = pkg.exports && typeof pkg.exports === 'object'
        ? Object.values(pkg.exports).filter((v) => typeof v === 'string') : [];
      const targets = [mainTarget, ...exportsTargets].filter(Boolean);
      const entryInLib = targets.some((t) => /^lib\//.test(t));
      const files = Array.isArray(pkg.files) ? pkg.files : null;
      const libCovered = files ? files.some((f) => f === 'lib' || f === 'lib/' || targets.some((t) => f === t)) : true; // files 缺省=npm 默认全含
      if (entryInLib && files && !libCovered) {
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'npm-json',
          severity: sev,
          message: `${rule.message || rule.name}（main=${mainTarget || 'n/a'}，files 未见 lib）`,
          dimensions: rule.dimensions || ['可部署性'],
          exemptHint: HINT_SENSITIVE,
          scoreImpact: sev === 'blocker' ? 2 : 1,
        }));
      }
    } else if (rule.id === 'npm/undeclared-js-yaml') {
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      // 规则语义 =「import 了 js-yaml 但未声明依赖」。全仓没有任何
      // js-yaml import/require 时（零依赖项目），文件级 fallback 不应报——
      // 否则每个零依赖插件的 package.json 都被误报 blocker（纯净安装根本不会
      // 出现 Cannot find module 'js-yaml'，因为没有代码引用它）。
      if (repoHasJsYamlImport && !deps['js-yaml']) {
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'npm-json',
          severity: sev,
          message: `${rule.message || rule.name}（dependencies/devDependencies 均未声明 js-yaml）`,
          dimensions: rule.dimensions || ['可部署性'],
          exemptHint: HINT_SENSITIVE,
          scoreImpact: sev === 'blocker' ? 2 : 1,
        }));
      }
    } else if (rule.id === 'npm/license-field-check') {
      // 2026-09-13：真实判定——license 字段缺失才报。
      //   旧实现是 pattern「命中 "version" 行即提示核对」，任何 package.json 都命中
      //   → 对已声明 license 的包恒定误报（规则名/描述与实际判定不符）。
      const lic = pkg.license;
      const hasLicense = (typeof lic === 'string' && lic.trim() !== '')
        || (Array.isArray(lic) && lic.length > 0);
      if (!hasLicense) {
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'npm-json',
          severity: sev,
          message: `${rule.message || rule.name}（package.json 缺 license 字段）`,
          dimensions: rule.dimensions || ['可部署性'],
          exemptHint: HINT_SENSITIVE,
          scoreImpact: sev === 'blocker' ? 2 : 1,
        }));
      }
    } else if (rule.id === 'npm/repository-field-check') {
      // 2026-09-13：真实判定——repository 字段缺失才报（旧实现命中 "homepage" 即报）。
      const repo = pkg.repository;
      const hasRepo = (typeof repo === 'string' && repo.trim() !== '')
        || (repo && typeof repo === 'object' && typeof repo.url === 'string' && repo.url.trim() !== '');
      if (!hasRepo) {
        findings.push(makeFinding({
          file, line: 1, rule: rule.id, kind: 'npm-json',
          severity: sev,
          message: `${rule.message || rule.name}（package.json 缺 repository 字段）`,
          dimensions: rule.dimensions || ['可部署性'],
          exemptHint: HINT_SENSITIVE,
          scoreImpact: sev === 'blocker' ? 2 : 1,
        }));
      }
    } else if (rule.id === 'npm/dependency-star-range') {
      // 2026-09-13：真实判定——只对**会发布**的包报「peer 用 *」。
      //   本地私有插件（private: true，如 workspace 下自研插件）的 peerDependencies 是
      //   「声明由宿主提供、不随包安装」的约定写法，写 "*" 不影响任何安装解析结果
      //   （包不发布、不装依赖），报出来是误报。公开包（无 private 或 false）仍严格报。
      //   ^0.x 的判定同样只在可发布包上执行（^0.x 会让 0.x 次要版本漂移）。
      if (pkg.private === true) {
        // 私有包：跳过 * 与 ^0.x 判定（非发布物，版本范围无实际影响）
      } else {
        const starDeps = starRangeDeps(pkg);
        if (starDeps.length) {
          const line = findJsonKeyLine(text, 'peerDependencies') || findJsonKeyLine(text, 'dependencies');
          findings.push(makeFinding({
            file, line, rule: rule.id, kind: 'npm-json',
            severity: sev,
            message: `${rule.message || rule.name}（${starDeps.join(', ')}）`,
            dimensions: rule.dimensions || ['可部署性'],
            exemptHint: HINT_SENSITIVE,
            scoreImpact: sev === 'blocker' ? 2 : 1,
          }));
        }
      }
    } else if (rule.id === 'npm/files-suspicious-entry') {
      // 2026-09-13：真实判定——files 数组里逐条核对路径是否存在。
      //   旧实现是 pattern「命中 "files": [ 或 "audit-rules" 即报」，任何有 files
      //   白名单的包都报（规则本意是查「条目路径写错导致漏打包」）。
      const files = Array.isArray(pkg.files) ? pkg.files : null;
      if (files && files.length) {
        const repoRoot = repoPath;
        for (const entry of files) {
          if (typeof entry !== 'string' || !entry.trim()) continue;
          if (!repoRoot) break; // 无仓库根时不做判定（避免臆测路径）
          const clean = entry.replace(/^\.\//, '').replace(/\/$/, '');
          const abs = join(repoRoot, clean);
          if (!existsSync(abs)) {
            const line = findJsonKeyLine(text, 'files', entry);
            findings.push(makeFinding({
              file, line, rule: rule.id, kind: 'npm-json',
              severity: sev,
              message: `${rule.message || rule.name}（files 条目「${entry}」在仓库中不存在）`,
              dimensions: rule.dimensions || ['可部署性'],
              exemptHint: HINT_SENSITIVE,
              scoreImpact: sev === 'blocker' ? 2 : 1,
            }));
            break; // 同一 package.json 只报一次（避免逐条刷屏）
          }
        }
      }
    }
  }
  return findings;
}
