import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------- 命令注册表（方案 B——元数据驱动免维护 CLI，2026-09-30） ----------

import { TOOL_REGISTRY, registryByName, registryByCli, parseRegistryArgs, buildToolsListText } from '../lib/app/command-registry.js';

// 说明：工具**公开面形状**（数量固定 / 命名 provider-safe / 必需清单 / 两面一致 /
//   package.json 声明真实存在）集中在 test/test-tool-contract.mjs 断言；
//   本文件只保留**行为类**断言（唯一性、查找函数、参数解析、清单文本）。
test('registry：name/cli 唯一（形状断言见 test-tool-contract.mjs）', () => {
  const names = new Set(TOOL_REGISTRY.map((t) => t.name));
  assert.equal(names.size, TOOL_REGISTRY.length, 'name 唯一');
  const clis = TOOL_REGISTRY.filter((t) => t.cli).map((t) => t.cli);
  assert.equal(new Set(clis).size, clis.length, 'cli 唯一');
});

test('registry：registryByName / registryByCli 查找', () => {
  assert.equal(registryByName('code_audit').name, 'code_audit');
  // code_audit 无 cli（CLI audit 特例走 lib/cli——独立审计 findings，不依赖宿主 API）
  assert.equal(registryByName('code_audit').cli, undefined);
  assert.equal(registryByCli('audit'), undefined, 'audit 不生成 CLI 命令');
  assert.equal(registryByCli('scan').name, 'git_scan');
  assert.equal(registryByCli('commit').name, 'git_commit_push');
  assert.equal(registryByName('nonexistent'), undefined);
});

test('parseRegistryArgs：positional + --flag + boolean + default', () => {
  const audit = registryByName('code_audit');
  const r1 = parseRegistryArgs(['/repo/a', '--scope', 'diff'], audit.params);
  assert.equal(r1.error, undefined);
  assert.equal(r1.args.repo, '/repo/a');
  assert.equal(r1.args.scope, 'diff');
  const r2 = parseRegistryArgs(['/repo/a', '--json'], audit.params);
  assert.equal(r2.args.json, true);
  assert.equal(r2.args.scope, 'full', 'default 填充');
  const r3 = parseRegistryArgs(['--scope=diff', '/repo/b'], audit.params);
  assert.equal(r3.args.scope, 'diff');
  assert.equal(r3.args.repo, '/repo/b');
});

test('parseRegistryArgs：required / enum / 未知参数校验', () => {
  const audit = registryByName('code_audit');
  assert.match(parseRegistryArgs([], audit.params).error || '', /缺少必填参数 repo/);
  const bad = parseRegistryArgs(['/x', '--scope', 'weird'], audit.params);
  assert.match(bad.error || '', /scope 取值必须为 full\|diff/);
  const unknown = parseRegistryArgs(['/x', '--nope'], audit.params);
  assert.match(unknown.error || '', /未知参数 --nope/);
  const extra = parseRegistryArgs(['/x', 'y'], audit.params);
  assert.match(extra.error || '', /多余的位置参数/);
});

test('parseRegistryArgs：boolean --flag=false 支持', () => {
  const commit = registryByCli('commit');
  const r = parseRegistryArgs(['/r', '--message', 'm', '--push=false'], commit.params);
  assert.equal(r.error, undefined);
  assert.equal(r.args.push, false);
});

test('buildToolsListText：工具清单同源生成（含 name + 描述）', () => {
  const txt = buildToolsListText();
  assert.match(txt, /code_audit/, '含 code_audit');
  assert.match(txt, /审计仓库/, '含描述');
  assert.match(txt, /git_scan/, '含 git_scan');
});