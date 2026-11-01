#!/usr/bin/env node
/**
 * 本地 npm registry 的命令行入口（实现在 `lib/npm/local-registry.js`）。
 *
 * 用途：把本机当"npm 网站"做**发布彩排**——publish → install → 加载公开面，全程不写公共 registry。
 *
 * 用法：
 *   node scripts/local-registry.mjs --selftest      # 一条命令跑完整彩排（推荐）
 *   node scripts/local-registry.mjs --port=4873     # 前台起服务（Ctrl-C 结束）
 *
 * 要真发到公网请用 `npm_publish`（含发布前冒烟）；这里只做彩排，结束即清理临时目录。
 */
import { fileURLToPath } from 'node:url';
import { startLocalRegistry, runLocalPreview } from '../lib/npm/local-registry.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);

if (args.includes('--selftest')) {
  const r = await runLocalPreview({
    dir: repo,
    tag: 'beta',
    entrySpecs: ['dsh-git-push', 'dsh-git-push/audit'],
  });
  for (const s of r.steps) console.log(`  ${s.ok ? 'OK  ' : 'FAIL'} ${s.step}${s.distTags ? ` → dist-tags ${JSON.stringify(s.distTags)}` : ''}`);
  if (r.failures.length) console.log('失败：\n' + r.failures.map((f) => `  - ${f}`).join('\n'));
  else console.log(`彩排通过（${r.packument?.name}@${r.packument?.distTags?.beta || '?'}）；临时目录已清理，公网零痕迹`);
  process.exit(r.ok ? 0 : 1);
} else {
  const portArg = args.find((a) => a.startsWith('--port='));
  const port = Number(portArg ? portArg.split('=')[1] : 4873);
  const reg = await startLocalRegistry({ port });
  console.log(`本地 npm registry: ${reg.url}（Ctrl-C 结束）`);
  const stop = async () => { await reg.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
