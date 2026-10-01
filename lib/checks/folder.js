/**
 * 检查层 · 目录级检查
 *
 * 职责：文件夹数量/单目录文件数/解包特征/.gitignore 覆盖等目录级审计。
 *   与文件级检查不同，本模块以目录为输入单位。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { globToRegex } from '../audit/glob.js';
import { makeFinding } from '../audit/index.js';
import { capSeverity, HINT_SIZE } from './common.js';

/**
 * 目录级审计（folder 槽位，1.0.3）。
 * 统计：源码目录总数（排除 excludeDirs）/ 单目录文件数 / 解包特征目录 / .gitignore 覆盖。
 * 由 auditFull 在文件行级检查之外追加调用（目录层规则无法按文件行跑）。
 * @param {object} opts { root, rules, gitignoreText, excludeDirsBase }
 * @returns {Array} findings（每条 file=根目录，line=1）
 */
export function checkFolderRules({ root, rules, gitignoreText = '' }) {
  const findings = [];
  if (!root) return findings;

  const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

  // 排除目录（各规则 exclude_dirs 的并集）——**在遍历时剪枝**，不是收集后按名过滤。
  //
 // 修复的缺陷：原实现先递归收集全部目录、再 `dirs.filter(d => !exclude.has(d.name))`
  //   只按目录**名**过滤，不阻止递归 → 被排除目录的**子目录全被计入源码目录**
  //   （实测：树内只有 src、lib 两个真源码目录，却因 node_modules/pkg-a、
  //   node_modules/pkg-b/node_modules/nested、dist/sub、coverage/x 等子目录被计入而报 9 个）。
  //   后果：任何带 node_modules 的仓库恒定超阈值 30 → folder/total-count 恒误报。
  //   同理 folder/file-count-per-dir 会把 node_modules 里的大目录当"单目录文件过多"报出。
  const excludedNames = new Set(['.git']);
  for (const r of rules || []) for (const n of r.excludeDirs || []) excludedNames.add(n);

  // ── 全量目录/文件统计（一次遍历供多规则复用）──
  const dirCounts = { total: 0, byDir: new Map() }; // 单目录文件数
  const signatureHits = [];
  const dirs = [];
  (function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    let fileCount = 0;
    for (const e of entries) {
      // 排除目录：不入 dirs、不递归、文件也不计数（其内容不属于项目源码）
      if (excludedNames.has(e.name)) continue;
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) { dirs.push({ dir, name: e.name, full }); walk(full); }
      else fileCount++;
    }
    if (fileCount > 0 || dir !== root) dirCounts.byDir.set(dir, fileCount);
    dirCounts.total++;
  })(root);

  for (const rule of rules || []) {
    const exclude = new Set(rule.excludeDirs || []);
    // 规则 1：源码目录总数 ≤ threshold（排除 excludeDirs）
    if (rule.threshold !== undefined && dirs.length) {
      const sig = rule.id.includes('total-count');
      if (sig) {
        // 包结构目录排除（2026-10-06，Java/Kotlin 误报修复）：Maven/Gradle 标准源码根
        //   src/main/java、src/main/kotlin、src/test/java 之下的目录是**包层级**（每个
        //   包一个目录，如 com/perol/asdpl/pixivez/**），不是「项目源码目录」——Android/
        //   Maven 项目天然几十个包目录，total-count 阈值 30 恒误报（防解包产物混入的
        //   本意对包结构不适用）。判定按路径子串：含 /src/(main|test|androidTest)/(java|kotlin)/
        //   前缀的目录全部不计（含其子目录——包目录逐层都在其下）。
        // 工程/资源目录按**名称**过滤（2026-10-06）：gradle/docs/res/assets 等是构建系统/
        //   文档/资源/CI 配置目录，不是「项目源码目录」。⚠️ 不能进 exclude_dirs——那会被
        //   collector 的 SKIP_DIRS 消费导致全局跳过审计（实测回归）；只在计数时过滤。
        //   res/ 资源**子目录**（res/layout、res/values-xx、res/drawable-xxhdpi 等）按路径
        //   过滤（/res/ 之下是资源不是源码——Android 多语言 values 目录天然十几个）。
        const isPackageDir = (d) => /\/src\/(?:main|test|androidTest)\/(?:java|kotlin)\//.test(d.full)
          || /\/res\//.test(d.full);
        const ENGINE_DIRS = new Set(['gradle', 'wrapper', '.github', 'docs', 'res', 'assets', 'resources', 'help', 'preview', 'donation', '.idea', '.gradle']);
        const srcDirs = dirs.filter((d) => !exclude.has(d.name) && !isPackageDir(d) && !ENGINE_DIRS.has(d.name)).length;
        if (srcDirs > rule.threshold) {
          findings.push(makeFinding({
            file: root, line: 1, rule: rule.id, kind: 'folder',
            severity: capSeverity(rule.severity || 'warning', 'warning'),
            message: (rule.message || rule.name || '').replace('{count}', srcDirs).replace('{threshold}', rule.threshold),
            dimensions: rule.dimensions || ['可维护性'],
            exemptHint: HINT_SIZE,
            scoreImpact: 1,
          }));
        }
      }
    }
    // 规则 2：单目录文件数 > threshold
    if (rule.id.includes('file-count-per-dir') && rule.threshold !== undefined) {
      for (const [dir, cnt] of dirCounts.byDir) {
        if (cnt <= rule.threshold) continue;
        findings.push(makeFinding({
          file: `${root}/…`, line: 1, rule: rule.id, kind: 'folder',
          severity: capSeverity(rule.severity || 'warning', 'warning'),
          message: (rule.message || '').replace('{path}', dir.replace(root, '')).replace('{count}', cnt).replace('{threshold}', rule.threshold),
          dimensions: rule.dimensions || ['可维护性'],
          exemptHint: HINT_SIZE,
          scoreImpact: 1,
        }));
      }
    }
    // 规则 3：解包特征目录
    if (Array.isArray(rule.signatures)) {
      for (const sig of rule.signatures) {
        const pat = String(sig.pattern || '').replace(/\*\*/g, '**').replace(/^\*\*\/?/, '');
        const hit = dirs.find((d) => {
          const rel = d.full.replace(root, '').replace(/^\//, '');
          if (pat.includes('package/package.json')) return rel === 'package' && existsSync(`${d.full}/package.json`); // dsh-skip-residue（签名规则条数极少且 find 短路）
          const base = pat.split('/')[0];
          return rel === base || rel.startsWith(`${base}/`);
        });
        if (hit) {
          findings.push(makeFinding({
            file: `${root}/…`, line: 1, rule: rule.id, kind: 'folder',
            severity: capSeverity(rule.severity || 'warning', 'warning'),
            message: sig.message || `${rule.name}: ${sig.pattern}`,
            dimensions: rule.dimensions || ['可维护性'],
            exemptHint: HINT_SIZE,
            scoreImpact: 1,
          }));
        }
      }
    }
    // 规则 4：.gitignore 覆盖检查
    // 修误报：旧实现要求 .gitignore **含全部** required_patterns
    //   （node_modules/dist/build/coverage/*.log/.env）——纯 JS 零依赖插件没有构建
    //   产物，dist/build/coverage/.env 根本不存在，报「缺少忽略项」属误报。
    //   正确语义：只报「仓库里**实际存在**的产物目录/文件」还没被忽略的项。
    if (Array.isArray(rule.requiredPatterns) && gitignoreText) {
      const lines = gitignoreText.split('\n').map((l) => l.trim());
      const isIgnored = (p) => lines.some((l) => l === p || l === p.replace(/^\*/, '') || l.replace(/\/$/, '') === p);
      const missing = rule.requiredPatterns.filter((p) => {
        if (isIgnored(p)) return false;                 // 已忽略 → 无需报
        // 未忽略：仅当该项在仓库里实际存在时才报（不存在则本项目本就不需要忽略它）
        const probe = p.replace(/^\*/, '').replace(/^\//, '');
        const hitDir = dirs.some((d) => {
          const rel = d.full.replace(root, '').replace(/^\//, '');
          return rel === probe || rel.startsWith(`${probe}/`);
        });
        const hitFile = existsSync(join(root, probe)); // dsh-skip-residue（required_patterns 条数少，每 pattern 一次判定）
        return hitDir || hitFile;
      });
      if (missing.length) {
        findings.push(makeFinding({
          file: `${root}/.gitignore`, line: 1, rule: rule.id, kind: 'folder',
          severity: capSeverity(rule.severity || 'warning', 'warning'),
          message: (rule.message || rule.name || '').replace('{missing}', missing.join(', ')),
          dimensions: rule.dimensions || ['可维护性'],
          exemptHint: HINT_SIZE,
          scoreImpact: 1,
        }));
      }
    }
  }
  return findings;
}
