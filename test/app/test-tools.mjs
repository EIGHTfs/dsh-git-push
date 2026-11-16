/**
 * test-tools.mjs —— 工具公开面契约 + 工具探测
 *
 * 两条原则（本文件是它们的样板）：
 *   ① **不写死清单与数量**：工具会随能力搬迁/新增而变。这里只断言**关系**
 *      （宿主注册面 ≡ 注册表）与**迁移事实**（已迁出的名字不得回潮）；
 *   ② **不猜路径**：所有路径从 `import.meta.dirname` / `package.json` 派生，
 *      文件改名或搬家时测试自动跟随，无需改断言。
 *
 * 分工：本文件只锁「公开面形状 + 探测接口」；工具行为见 test-command-registry.mjs。
 *      审计能力（评分/规则命中/拦截结论）不属宿主测试职责，见 audit-sluice 自己的测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TOOL_REGISTRY } from '../../lib/app/command-registry.js';
import { handleHttp } from '../../lib/app/http-handlers.js';
import { probeToolPath } from '../../lib/context/index.js';
import { listTools } from '../../lib/index.js';

const ROOT = join(import.meta.dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** 已迁出宿主的工具（按**名字**断言，不按数量）：它们搬去了别的包，不得回潮到宿主注册表。 */
const MIGRATED_OUT_TOOLS = ['module_splitter'];

// ───────────────────────── 公开面契约 ─────────────────────────

test('[tool-contract] 注册表形状：非空、每项有非空 name', () => {
  assert.ok(TOOL_REGISTRY.length > 0, '注册表不能为空');
  for (const entry of TOOL_REGISTRY) {
    assert.equal(typeof entry.name, 'string', '每项必须有字符串 name');
    assert.ok(entry.name.length > 0, 'name 不能为空串');
  }
});

test('[tool-contract] 工具名 provider-safe（只允许字母数字下划线连字符）', () => {
  const bad = TOOL_REGISTRY.map((entry) => entry.name).filter((toolName) => !/^[a-zA-Z0-9_-]+$/.test(toolName));
  assert.deepEqual(bad, [], `以下工具名含非法字符（宿主/provider 可能拒绝注册）：${bad.join(', ')}`);
});

test('[tool-contract] name 与 cli 各自唯一（cli 允许缺省）', () => {
  const names = TOOL_REGISTRY.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length,
    `工具 name 必须唯一，重复项：${names.filter((toolName, index) => names.indexOf(toolName) !== index).join(', ')}`);
  const cliNames = TOOL_REGISTRY.map((entry) => entry.cli).filter((cliName) => cliName !== undefined);
  assert.equal(new Set(cliNames).size, cliNames.length,
    `CLI 命令名必须唯一，重复项：${cliNames.filter((cliName, index) => cliNames.indexOf(cliName) !== index).join(', ')}`);
});

test('[tool-contract] 宿主注册面与注册表一一对应（防两面漂移）', () => {
  const hostNames = listTools().map((tool) => tool.name).sort();
  const registryNames = TOOL_REGISTRY.map((entry) => entry.name).sort();
  assert.deepEqual(hostNames, registryNames,
    'listTools()（宿主注册面）与 TOOL_REGISTRY（CLI/文档面）必须完全一致——'
    + '不一致意味着「注册表里有但宿主注册不上」或反之');
});

test('[tool-contract] 已迁出的工具不得回潮（按名字断言）', () => {
  const names = TOOL_REGISTRY.map((entry) => entry.name);
  for (const migratedName of MIGRATED_OUT_TOOLS) {
    assert.ok(!names.includes(migratedName),
      `${migratedName} 已迁出宿主（搬去了独立包），不应再出现在宿主注册表`);
  }
});

test('[tool-contract] package.json 声明的 bundle patch 与 skills 路径真实存在', () => {
  const dshBlock = pkg.dsh || {};
  const patchPath = dshBlock.bundle && dshBlock.bundle.patch;
  assert.ok(patchPath, 'package.json 必须声明 dsh.bundle.patch（否则宿主装载时找不到补丁）');
  assert.ok(existsSync(join(ROOT, patchPath)), `dsh.bundle.patch 指向的文件不存在：${patchPath}`);

  const skillsPaths = Array.isArray(dshBlock.skills) ? dshBlock.skills : [];
  const missingPaths = skillsPaths.filter((relativePath) => !existsSync(join(ROOT, relativePath)));
  assert.deepEqual(missingPaths, [],
    `dsh.skills 里以下路径不存在（插件随包发布，缺文件即装不全）：${missingPaths.join(', ')}`);
});

// ───────────────────────── 工具探测 ─────────────────────────

test('[tool-probes] GET /tool-probes 返回探测清单（只读免 origin）', async () => {
  const response = await handleHttp({ method: 'GET', url: '/api/git-push/tool-probes' }, { workspaceRoot: ROOT }, {});
  assert.equal(response.status, 200, 'GET 属只读，不应要求 origin');
  assert.equal(response.body.ok, true);
  assert.ok(Array.isArray(response.body.probes), 'probes 应为数组');
  assert.ok(response.body.probes.length > 0, '探测清单不应为空');
});

test('[tool-probes] 清单里 node/git 已探测到且路径非空', async () => {
  const response = await handleHttp({ method: 'GET', url: '/api/git-push/tool-probes' }, { workspaceRoot: ROOT }, {});
  const found = response.body.probes.filter((probe) => probe.found);
  const nodeProbe = found.find((probe) => probe.name === 'node');
  assert.ok(nodeProbe, 'node 应被探测到（PATH 无 node 时靠 execPath 兜底）');
  assert.ok(nodeProbe.path && nodeProbe.path.length > 0, 'node 路径非空');
  const gitProbe = found.find((probe) => probe.name === 'git');
  assert.ok(gitProbe && gitProbe.found, 'git 应被探测到');
});

test('[tool-probes] probeToolPath(node) 走 process.execPath 兜底（不依赖 PATH）', () => {
  const result = probeToolPath('node', ['--version']);
  assert.equal(result.found, true, 'node 应 found:true');
  assert.ok(result.path && result.path.length > 0, 'node 路径非空');
  assert.ok(result.version, 'node 版本非空（--version）');
});

test('[tool-probes] probeToolPath 对任意工具都返回完整结构（存在与否都不断言 found）', () => {
  const result = probeToolPath('curl', ['--version']);
  // curl 在多数环境存在；不存在时也应返回结构完整的探测结果（而不是抛错）
  assert.equal(typeof result.found, 'boolean');
  assert.equal(result.name, 'curl');
  assert.equal(typeof result.path, 'string');
});
