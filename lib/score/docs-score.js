/**
 * 文档加分制检查器（2026-09-21）——文档维度从扣分制改纯加分制（0 分起、上限 10）。
 *
 * 原则（需求讨论 DeepSeekHarness/文档加分制.md + docs/方案-文档维度加分制.md）：
 *   · 只奖励「做了」（结构信号 + 交叉验证），不判断「做得好」——内容质量机器判不了
 *   · 检查范围=**文档集**：README.md（约定入口）+ docs/ 下递归 .md（排除 node_modules 等）
 *     + 根级常见文档名白名单（CHANGELOG/INSTALL/GUIDE/UPGRADING/升级记录/快速开始…）
 *   · 版本一致性是唯一硬交叉验证：文档集**任一**版本号 == package.json version
 *     （README 里的 Node 18.0.0 等无关版本不会误加）
 *   · 多文档版本号互相矛盾（README=1.5.6 vs CHANGELOG=1.5.5）：存在性加分照给，
 *     矛盾只进 review（人工复核）**不扣分**——与 version/readme-changelog 口径错开
 * 约束：结果**不进 findings**（不进扣分维度/门禁/问题计数），由 scoreQuality 单独加分。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 根级常见文档名白名单（docs/ 之外的「项目文档」识别）。 */
const ROOT_DOC_NAMES = [
  'CHANGELOG.md', 'INSTALL.md', 'GUIDE.md', 'UPGRADING.md',
  '升级记录.md', '快速开始.md', '安装.md', 'change.log', 'CHANGELOG',
];
/** docs/ 遍历时跳过的目录（复用审计收集器语义，不把依赖/夹具文档当项目文档）。 */
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'test', 'tests', 'dist', 'build', '.git', 'coverage']);
/** 版本号提取（语义与文档讨论一致：v?x.y.z，任一匹配即可）。 */
const VERSION_RE = /v?(\d+\.\d+\.\d+)/g;
/**
 * 「版本记录语境」行：md 标题 / 表格版本列 / version:·版本: 前缀 / CHANGELOG 条目（- 开头）。
 * 用于**不一致检测**——排除正文「Node 18.0.0 支持」这类环境版本（非项目版本口径，
 * 若全提取会频繁误报不一致）；加分（存在性）仍用全文提取的宽松集合。
 */
const VERSION_RECORD_LINE_RE = /^(#+\s.*v?\d+\.\d+\.\d+|.*\|[^|]*v?\d+\.\d+\.\d+[^|]*\|.*|.*\b(version|版本).{0,4}[：:].*v?\d+\.\d+\.\d+.*|[-*]\s+v?\d+\.\d+\.\d+.*)/i;
/** 安装/启动命令结构信号。 */
const INSTALL_RE = /npm install|pnpm add|yarn add|docker run|npm run (start|dev|build|serve)/i;
/** 环境变量清单结构信号。 */
const ENV_RE = /\.env|process\.env|环境变量/i;

/**
 * 收集项目文档集（README + docs/ 下递归 + 根级常见命名），去重、保序。
 * @param {string} root 项目根
 * @returns {string[]} 文档文件绝对路径
 */
export function collectDocFiles(root = '.') {
  const out = [];
  const push = (p) => { try { if (existsSync(p) && statSync(p).isFile()) out.push(p); } catch { /* 忽略 */ } };
  // ① README 入口（大小写兼容）
  push(join(root, 'README.md'));
  push(join(root, 'readme.md'));
  // ② docs/ 递归（排除 SKIP_DIRS）
  const docs = join(root, 'docs');
  if (existsSync(docs)) {
    const walk = (dir) => {
      let ents;
      try { ents = readdirSync(dir); } catch { return; }
      for (const name of ents) {
        if (SKIP_DIRS.has(name)) continue;
        const p = join(dir, name);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) walk(p);
        else if (name.endsWith('.md') || name.endsWith('.markdown')) out.push(p);
      }
    };
    walk(docs);
  }
  // ③ 根级常见文档名
  for (const n of ROOT_DOC_NAMES) push(join(root, n));
  return [...new Set(out)];
}

/** 4 项加分项静态定义（配置 yml audit-rules-docs.yml 与这里一一对应，增删改两处）。 */
export const DOCS_SCORE_ITEMS = [
  { id: 'readme-exists', name: 'README 存在', score: 2.5 },
  { id: 'version-consistent', name: '版本号与 package.json 一致', score: 2.5 },
  { id: 'install-command', name: '有安装/启动命令', score: 2.5 },
  { id: 'env-list', name: '有环境变量清单', score: 2.5 },
];

/**
 * 对项目根跑文档加分检查。
 * @param {string} root 项目根（审计目标目录；仓库根/快照根均适用）
 * @returns {{hits: string[], review: string[], items: Array<{id,name,score,hit}>, files: string[], versions: string[]}}
 */
export function checkDocsScore(root = '.') {
  const files = collectDocFiles(root);
  const texts = [];
  for (const f of files) { try { texts.push(readFileSync(f, 'utf8')); } catch { /* 读失败跳过 */ } }
  const all = texts.join('\n');
  const hits = [];
  const review = [];
  // ① README 存在（约定入口；docs/ 不能替代此项）
  const hasReadme = existsSync(join(root, 'README.md')) || existsSync(join(root, 'readme.md'));
  if (hasReadme) hits.push('readme-exists');
  else if (files.length) review.push('README 缺失（仅有 docs/ 等文档）');
  // ② 版本一致性（交叉验证，最硬）：文档集任一版本号 == pkg.version
  let pkgVersion = '';
  try {
    pkgVersion = String(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || '').trim();
  } catch { /* 无 package.json / 解析失败：版本项跳过，其余照判 */ }
  const versions = [...new Set([...all.matchAll(VERSION_RE)].map((m) => m[1]))];
  if (pkgVersion && versions.includes(pkgVersion)) hits.push('version-consistent');
  // 「版本记录语境」版本集合（标题/表格/version: 行）——不一致检测用它，避免环境版本噪音
  const recordVersions = [...new Set(
    all.split('\n')
      .filter((line) => VERSION_RECORD_LINE_RE.test(line))
      .flatMap((line) => [...line.matchAll(VERSION_RE)].map((m) => m[1])),
  )];
  // ③ 安装/启动命令
  if (INSTALL_RE.test(all)) hits.push('install-command');
  // ④ 环境变量清单
  if (ENV_RE.test(all)) hits.push('env-list');
  // 多文档口径不一致（存在性加分照给，矛盾只提示不扣分；仅看版本记录语境，排除环境版本）
  if (pkgVersion && recordVersions.length > 1) {
    const shown = recordVersions.slice(0, 3).map((v) => (v === pkgVersion ? `${v}(=pkg)` : v)).join(' / ');
    review.push(`文档集版本号不一致（${shown}），请人工核对`);
  } else if (pkgVersion && !versions.length) {
    review.push('文档集未发现版本号（README/CHANGELOG 等应有版本记录）');
  }
  return {
    hits,
    review,
    files,
    versions,
    items: DOCS_SCORE_ITEMS.map((it) => ({ ...it, hit: hits.includes(it.id) })),
  };
}