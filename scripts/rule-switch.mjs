/**
 * 手动启停「安装版本」规则槽位（2026-09-14）。
 *
 * 与侧边栏 UI 的规则包启停完全同一套实现（lib/rule/loader.js setSlotDisabled：
 * 修改规则 yml 顶层 `disabled: true` / 删除该行），只是以命令行方式直接调用，
 * 不依赖 GUI。规则装载每次审计实时读 yml —— 改完**立即生效、无需重启实例**。
 *
 * 默认操作目标 = 部署安装副本（<DSH>/.dsh-home/.dsh/profiles/web/node_modules/dsh-git-push/
 * lib/audit-rules），即 GUI 实际加载的规则；--target 可指向任意规则目录
 * （如工作区 lib/audit-rules 用 --workspace）。强制槽位 nodejs/private 不可禁用
 * （安全红线，setSlotDisabled 拦截，与 UI 行为一致）。
 *
 * 用法：
 *   node scripts/rule-switch.mjs list [--workspace|--target <规则目录>]
 *   node scripts/rule-switch.mjs status <slot> [--target <规则目录>]
 *   node scripts/rule-switch.mjs disable <slot> [--target <规则目录>]
 *   node scripts/rule-switch.mjs enable <slot> [--target <规则目录>]
 *
 * 示例：
 *   node scripts/rule-switch.mjs list                 # 列出安装版本全部槽位状态
 *   node scripts/rule-switch.mjs disable comment      # 禁用安装版本的 comment 槽位
 *   node scripts/rule-switch.mjs enable comment       # 重新启用
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setSlotDisabled } from '../lib/rule/loader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..');
// 工作区模式推导 DSH 根：<DSH>/.dsh-home/工作区/<项目> → 上溯三级
const DSH_ROOT = resolve(PLUGIN_ROOT, '..', '..', '..');
const DEPLOYED_RULES = join(DSH_ROOT, '.dsh-home', '.dsh', 'profiles', 'web', 'node_modules', 'dsh-git-push', 'lib', 'audit-rules');

/** 解析规则目录：--target 优先，--workspace 指工作区，缺省部署安装副本。 */
function resolveRulesDir(argv) {
  const ti = argv.indexOf('--target');
  if (ti >= 0 && argv[ti + 1]) return resolve(process.cwd(), argv[ti + 1]);
  if (argv.includes('--workspace')) return join(PLUGIN_ROOT, 'lib', 'audit-rules');
  return DEPLOYED_RULES;
}

/** 扫描目录内全部 audit-rules-<slot>.yml 槽位及状态。 */
function listSlots(dir) {
  const slots = [];
  for (const f of readdirSync(dir)) {
    const m = f.match(/^audit-rules-(.+)\.yml$/);
    if (!m) continue;
    const text = readFileSync(join(dir, f), 'utf8');
    const disabled = /^disabled:\s*true\s*$/m.test(text);
    slots.push({ slot: m[1], file: f, disabled });
  }
  return slots.sort((a, b) => a.slot.localeCompare(b.slot));
}

function main(argv = process.argv.slice(2)) {
  const cmd = argv[0] || 'list';
  const dir = resolveRulesDir(argv);
  console.log(`规则目录：${dir}`);
  if (!readdirSync(dir).some((f) => f.startsWith('audit-rules-') && f.endsWith('.yml'))) {
    console.error(`❌ 目录无规则文件（audit-rules-*.yml）：${dir}`);
    process.exit(1);
  }
  if (cmd === 'list') {
    const slots = listSlots(dir);
    for (const { slot, disabled } of slots) {
      console.log(`  ${disabled ? '✖ 禁用' : '✔ 启用'}  ${slot}`);
    }
    console.log(`共 ${slots.length} 个槽位（改完立即生效，无需重启；强制槽位 nodejs/private 不可禁用）`);
    return;
  }
  if (cmd === 'status') {
    const slot = argv[1];
    if (!slot) { console.error('用法: status <槽位>'); process.exit(1); }
    const found = listSlots(dir).find((s) => s.slot === slot);
    if (!found) { console.error(`❌ 槽位不存在: ${slot}`); process.exit(1); }
    console.log(`  ${found.disabled ? '✖ 禁用' : '✔ 启用'}  ${slot}`);
    return;
  }
  if (cmd === 'disable' || cmd === 'enable') {
    const slot = argv[1];
    if (!slot) { console.error(`用法: ${cmd} <槽位>`); process.exit(1); }
    const wantDisabled = cmd === 'disable';
    const res = setSlotDisabled(slot, wantDisabled, { dir });
    if (!res.ok) {
      console.error(`❌ ${res.error}`);
      process.exit(1);
    }
    console.log(`✅ ${slot} 已${wantDisabled ? '禁用' : '启用'}（写入 ${dir}/audit-rules-${slot}.yml 顶层 disabled，审计实时生效、无需重启）`);
    return;
  }
  console.error(`未知命令: ${cmd}（支持 list / status <槽位> / disable <槽位> / enable <槽位>）`);
  process.exit(1);
}

main();
