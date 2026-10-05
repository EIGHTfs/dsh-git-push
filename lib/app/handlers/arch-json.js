// 架构事实导出 handler（工具 arch_json / HTTP POST /api/git-push/arch-json 共用）。
//
// 分工：本插件做「事实导出」——把 lib/arch/* 的四步串起来（extract → aggregate → to-json → validate），
//   产出 archify 的 architecture JSON。渲染交给 archify（或任何 archify 兼容渲染器）。
//
// 红线：不编任何组件/连线。组件来自目录与 git 跟踪状态，连线来自真实 import 与 IO 事实，
//   校验分四层（schema / 引用 / 事实 / 拓扑）。
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

import { extractArchFacts } from '../../arch/extract.js';
import { aggregateModules } from '../../arch/aggregate.js';
import { toArchifyJson } from '../../arch/to-json.js';
import { validateArchJson } from '../../arch/validate.js';

/** 读仓库证据（archify 要求：带 sources 时必须给 meta.repository，且 url 与本地 origin 逐字一致）。 */
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
  // 公开主机才声明 provider；本插件按约定把 origin 写成 api.github.com/... ⇒ 用 local-only 且不声明 provider
  const isPublic = /^https?:\/\/(www\.)?(github\.com|gitee\.com)\//i.test(url);
  if (isPublic) return { url, revision, provider: /gitee\.com/i.test(url) ? 'gitee' : 'github', link_mode: 'web' };
  return { url, revision, link_mode: 'local-only' };
}

/** 读仓库自己的 tree-doc.json（路径 → 一句话介绍），用作组件说明；没有就返回 null。 */
function readTreeDoc(repoPath) {
  try {
    const p = join(repoPath, 'tree-doc.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  } catch { return null; }
}

/**
 * 导出仓库的架构事实 JSON。
 * @param {{repoPath?:string, name?:string, maxFiles?:number, validate?:boolean, allowDangling?:boolean}} args
 * @param {{execFileSync?:Function}} [deps] 便于测试注入
 * @returns {Promise<object>} { ok, repoPath, name, doc, validation, stats }
 */
export async function exportArchJson(args = {}, deps = {}) {
  const repoPath = resolve(String(args.repoPath || '.'));
  if (!existsSync(repoPath)) return { ok: false, error: `目录不存在：${repoPath}` };
  const name = args.name || basename(repoPath);

  const facts = await extractArchFacts(repoPath, { maxFiles: args.maxFiles || 4000 });
  if (!facts.modules.length) return { ok: false, error: `未能提取到任何模块（源码根未识别）：${repoPath}` };
  const agg = aggregateModules(facts);
  const evidence = repositoryEvidence(repoPath, { execFileSync });
  const doc = toArchifyJson(agg, facts, { name, repoPath, evidence, treeDoc: readTreeDoc(repoPath) });

  // 默认跑四层校验；allowDangling 默认 true（分层聚合后孤立组件属正常，环仍报出）
  let validation = null;
  if (args.validate !== false) {
    validation = validateArchJson(doc, { repoPath, allowDangling: args.allowDangling !== false });
  }
  return {
    ok: true,
    repoPath,
    name,
    doc,
    validation,
    stats: {
      ...facts.totals,
      components: agg.stats.components,
      connections: doc.connections.length,
      dataFiles: doc.components.filter((c) => c.type === 'database').length,
      sourceRoot: facts.sourceRoot,
    },
  };
}
