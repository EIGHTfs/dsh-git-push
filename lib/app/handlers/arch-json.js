// 架构事实导出 handler（工具 arch_json 共用）。
//
// 定位（边界声明，2026-10-09 收敛）：
//   本插件**只产出我们自己的中性事实 JSON**（ArchFacts，规范见 docs/ARCH-FACTS-SPEC.md）。
//   渲染器（archify 等）的东西**一律不出现在插件里**——组件类型枚举、坐标 pos/size、boundary、
//   渲染器 schema 校验，都属于渲染器侧，交给**独立翻译脚本**处理
//   （ai-work-archive/scripts/archify-translate.mjs：读本文件产出 → 写 archify JSON）。
//   ⇒ 换渲染器时插件不用动；插件也不依赖任何渲染器。
//
// 分工：extract（扫源码得事实）→ aggregate（聚合成组件与边）→ 落盘 ArchFacts。
//   红线：不编任何组件/连线。组件来自目录与 git 跟踪状态，连线来自真实 import 与 IO 事实。
//
// 产出：`<repo>/.dsh-archfacts/<name>.facts.json`（**不入库**，见 .gitignore）
//   { schema, name, repoPath, revision, facts:{modules,totals,sourceRoot}, agg:{components,edges,stats}, stats }
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

import { extractArchFacts } from '../../arch/extract.js';
import { aggregateModules } from '../../arch/aggregate.js';

/** ArchFacts 落盘目录名（相对仓库根；已 gitignore）。 */
export const ARCH_FACTS_DIR = '.dsh-archfacts';

/** 读仓库证据（revision 取 HEAD，保证产出可复现——不写生成时间戳）。 */
function repositoryEvidence(repoPath, { execFileSync }) {
  const run = (args) => {
    try {
      const out = execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return String(out || '').trim();
    } catch { return ''; }
  };
  const url = run(['remote', 'get-url', 'origin']);
  const revision = run(['rev-parse', 'HEAD']);
  if (!url || !/^[a-fA-F0-9]{40}$/.test(revision)) return null;
  return { url, revision };
}

/** 读仓库自己的 tree-doc.json（路径 → 一句话介绍），用作组件说明；没有就返回 null。 */
function readTreeDoc(repoPath) {
  try {
    const p = join(repoPath, 'tree-doc.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  } catch { return null; }
}

/**
 * 导出仓库的 ArchFacts（我们自己的规范）。
 *
 * 性能约定（实测本仓 314 文件 ~3s / 峰值 ~159MB，逐文件 AST 检查 ⇒ 调用方把它放进宿主后台 job）：
 *   · 默认**落盘**到 `<repo>/.dsh-archfacts/<name>.facts.json`（不入库）；
 *   · 返回值只给**摘要**（stats + 落盘路径），整份事实可能几十 KB，避免回灌对话；
 *     确实要全量时显式传 `inline: true`。
 * @param {{repoPath?:string, name?:string, maxFiles?:number, write?:boolean, inline?:boolean}} args
 * @returns {Promise<object>} 摘要 { ok, repoPath, name, outPath, stats }；inline:true 时附 factsDoc
 */
export async function exportArchFacts(args = {}) {
  const repoPath = resolve(String(args.repoPath || '.'));
  if (!existsSync(repoPath)) return { ok: false, error: `目录不存在：${repoPath}` };
  const name = args.name || basename(repoPath);

  const facts = await extractArchFacts(repoPath, { maxFiles: args.maxFiles || 4000 });
  if (!facts.modules.length) return { ok: false, error: `未能提取到任何模块（源码根未识别）：${repoPath}` };
  const agg = aggregateModules(facts);
  const evidence = repositoryEvidence(repoPath, { execFileSync });
  const treeDoc = readTreeDoc(repoPath);
  const factsDoc = {
    schema: 'dsh-archfacts/1',
    name,
    repoPath,
    // 用提交号而非时间戳：同样的代码产出逐字节一致（可复现、可 diff、可做新鲜度校验）
    revision: evidence?.revision || '',
    evidence: evidence ? { ...evidence, treeDoc } : { treeDoc },
    facts: { modules: facts.modules, totals: facts.totals, sourceRoot: facts.sourceRoot },
    agg: { components: agg.components, edges: agg.edges, stats: agg.stats },
    stats: {
      ...facts.totals,
      components: agg.stats.components,
      connections: agg.edges.length,
      sourceRoot: facts.sourceRoot,
    },
  };

  let outPath = '';
  let writeError = '';
  if (args.write !== false) {
    try {
      const dir = join(repoPath, ARCH_FACTS_DIR);
      mkdirSync(dir, { recursive: true });
      outPath = join(dir, `${name}.facts.json`);
      writeFileSync(outPath, JSON.stringify(factsDoc, null, 2), 'utf8');
    } catch (e) {
      writeError = String((e && e.message) || e);
    }
  }
  const summary = {
    ok: true,
    repoPath,
    name,
    outPath,
    ...(writeError ? { writeError } : {}),
    schema: factsDoc.schema,
    revision: factsDoc.revision,
    stats: factsDoc.stats,
  };
  return args.inline === true ? { ...summary, factsDoc } : summary;
}

/** 兼容旧名（工具侧历史 import：arch_json 的语义已从「archify 导出」收敛为「导出我们的事实」）。 */
export const exportArchJson = exportArchFacts;
