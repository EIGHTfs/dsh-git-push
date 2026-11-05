#!/usr/bin/env node
/**
 * 拼接产物作用域撞名检查（独立 CLI；判定与策略逻辑在 lib/，与 `git-sluice scope-check` 同一份）。
 *
 * 用法：
 *   node scripts/check-js-scope.mjs <file.js> [...] [--prefix=dshgp_] [--allowlist=a,b] [--top=true|false] [--json]
 *   node scripts/check-js-scope.mjs --config package.json      # 读该 package.json 的 dshScopeCheck.files
 *
 * 参数名与 `git-sluice scope-check` 对齐（allowlist，旧写法 --allow 仍认）。
 * 约定按**文件所属项目**取：别人项目没声明 dshScopeCheck 时只查「同帧重名」，
 *   不会拿本项目的 dshgp_ 前缀去要求它（实测：那会刷一屏与它无关的告警）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runScopeCheck } from '../lib/app/scope-check.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(['config', 'prefix', 'allowlist', 'allow', 'top']);

const { flags, positional } = (() => {
  const out = { flags: new Map(), positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { out.positional.push(token); continue; }
    const body = token.slice(2);
    if (body.includes('=')) {
      const [k, ...rest] = body.split('=');
      out.flags.set(k, rest.join('='));
      continue;
    }
    if (VALUE_FLAGS.has(body) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out.flags.set(body, argv[i + 1]);
      i += 1;
      continue;
    }
    out.flags.set(body, 'true');
  }
  return out;
})();
const wantJson = flags.has('json');

/** --config 指定的项目：只用它的 files 列表，**不**把它的 prefix 套给别的项目文件。 */
function filesFromConfig(path) {
  if (!path || !existsSync(path)) return [];
  try {
    const cfg = JSON.parse(readFileSync(path, 'utf8'))?.dshScopeCheck;
    const base = dirname(resolve(path));
    return Array.isArray(cfg?.files) ? cfg.files.map((f) => resolve(base, f)) : [];
  } catch { return []; }
}

const configPath = flags.get('config') || '';
const targets = positional.length ? positional.map((f) => resolve(f)) : filesFromConfig(configPath);
if (!targets.length) {
  console.error('用法：node scripts/check-js-scope.mjs <file.js> [...] [--prefix=dshgp_] [--allowlist=a,b] [--json]');
  console.error('   或 node scripts/check-js-scope.mjs --config package.json（读 dshScopeCheck.files）');
  process.exit(2);
}

const topFlag = flags.get('top');
const result = runScopeCheck({
  files: targets,
  prefix: flags.get('prefix') || '',
  // allowlist 为主名（与 git-sluice scope-check 对齐），allow 是旧写法别名
  allowlist: String(flags.get('allowlist') || flags.get('allow') || '').split(',').map((x) => x.trim()).filter(Boolean),
  ...(topFlag === 'true' || topFlag === 'false' ? { topLevelMustBeEmpty: topFlag === 'true' } : {}),
});

if (wantJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  // 输出头自证策略来源：避免「继承了本项目默认值」被误读成对方的约定
  for (const src of result.policySources) console.log(`策略来源：${src}`);
  for (const r of result.reports) {
    const rel = r.file.replace(process.cwd() + '/', '');
    if (r.ok) {
      console.log(`✔ ${rel}：${r.declarations.length} 个声明，无同帧重名`);
    } else {
      console.error(`✗ ${rel}：`);
      for (const v of r.violations) console.error(`    - ${v}`);
    }
  }
}
process.exit(result.ok ? 0 : 1);
