/**
 * test-tools.mjs —— 同族测试合并（test-tool-contract.mjs · test-tool-probes.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { TOOL_REGISTRY } from '../../lib/app/command-registry.js';
import { handleHttp } from '../../lib/app/http-handlers.js';
import { probeToolPath } from '../../lib/context/index.js';
import { listTools } from '../../lib/index.js';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// ── 原 test-tool-contract.mjs ──
{
  // 工具公开面契约门禁（对照外部项目 dsh-normify 的 ci-contract-check.cjs 思路）。
  //
  // 为什么单独一个文件：工具的「公开面」——数量、命名合法性、必需项、以及
  //   「宿主注册面（listTools）↔ 注册表（TOOL_REGISTRY）」一致性、package.json 声明的
  //   bundle patch 与 skills 路径真实存在——一旦静默漂移，宿主里就会出现「工具没注册上」
  //   「名字不合法被 provider 拒」「声明指向不存在的文件」这类只在运行时才暴露的问题。
  //   本文件把公开面形状集中锁死：改公开面必须显式改这里（失败信息会告诉你改哪）。
  //
  // 分工：本文件只断言**公开面形状**；工具行为（查找函数/参数解析）见 test-command-registry.mjs。


  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  // 公开面基线：新增/删除工具时**必须**同步改这里（以及 README 的工具表）——
  //   这是刻意的：工具是宿主可见的公开接口，变更应当显式而不是悄悄发生。
  const EXPECTED_TOOL_COUNT = 21;
  const EXPECTED_TOOLS = [
    'git_scan', 'git_commit_push', 'code_audit', 'git_clone', 'git_remote_create',
    'git_set_visibility', 'io_scan', 'git_clone_preview', 'link_check', 'module_splitter',
    'git_account_check', 'git_cred_env', 'git_gen_ssh_key', 'git_sluice', 'git_identity_rewrite',
    'git_api', 'npm_publish', 'exempt', 'git_remote_rename', 'npm_unpublish', 'scope_check',
  ];

  test('[tool-contract] 契约：工具数量固定（改公开面须同步本测试与 README 工具表）', () => {
    assert.equal(TOOL_REGISTRY.length, EXPECTED_TOOL_COUNT,
      `工具数应为 ${EXPECTED_TOOL_COUNT}，实得 ${TOOL_REGISTRY.length}。`
      + '新增/删除工具时请同步：本文件的 EXPECTED_TOOLS/EXPECTED_TOOL_COUNT、README 工具表、docs/FUNCTIONS.md');
  });

  test('[tool-contract] 契约：工具名 provider-safe（只允许字母数字下划线连字符）', () => {
    const bad = TOOL_REGISTRY.map((t) => t.name).filter((n) => !/^[a-zA-Z0-9_-]+$/.test(n));
    assert.deepEqual(bad, [], `以下工具名含非法字符（宿主/provider 可能拒绝注册）：${bad.join(', ')}`);
  });

  test('[tool-contract] 契约：name 与 cli 各自唯一（cli 允许缺省，不参与唯一性）', () => {
    const names = TOOL_REGISTRY.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, `工具 name 必须唯一，重复项：${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);
    const clis = TOOL_REGISTRY.map((t) => t.cli).filter((c) => c !== undefined);
    assert.equal(new Set(clis).size, clis.length, `CLI 命令名必须唯一，重复项：${clis.filter((c, i) => clis.indexOf(c) !== i).join(', ')}`);
  });

  test('[tool-contract] 契约：必需工具一个都不能少', () => {
    const names = TOOL_REGISTRY.map((t) => t.name);
    const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
    assert.deepEqual(missing, [], `缺少必需工具：${missing.join(', ')}`);
    // 反向：注册表里不该出现未登记的额外工具（防「加了但没登记」）
    const extra = names.filter((n) => !EXPECTED_TOOLS.includes(n));
    assert.deepEqual(extra, [], `出现未登记的工具（请补进 EXPECTED_TOOLS）：${extra.join(', ')}`);
  });

  test('[tool-contract] 契约：宿主注册面与注册表同名同数（防两面漂移）', () => {
    const host = listTools().map((t) => t.name).sort();
    const reg = TOOL_REGISTRY.map((t) => t.name).sort();
    assert.deepEqual(host, reg,
      'listTools()（宿主注册面）与 TOOL_REGISTRY（CLI/文档面）必须完全一致——'
      + '两面不一致意味着「文档里有但宿主注册不上」或反之');
  });

  test('[tool-contract] 契约：package.json 声明的 bundle patch 与 skills 路径真实存在', () => {
    const dsh = pkg.dsh || {};
    const patch = dsh.bundle && dsh.bundle.patch;
    assert.ok(patch, 'package.json 必须声明 dsh.bundle.patch（否则宿主装载时找不到补丁）');
    assert.ok(existsSync(join(ROOT, patch)), `dsh.bundle.patch 指向的文件不存在：${patch}`);

    const skills = Array.isArray(dsh.skills) ? dsh.skills : [];
    const missing = skills.filter((p) => !existsSync(join(ROOT, p)));
    assert.deepEqual(missing, [], `dsh.skills 里以下路径不存在（插件随包发布，缺文件即装不全）：${missing.join(', ')}`);
  });
}

// ── 原 test-tool-probes.mjs ──
{
  /**
   * 工具探测 API + node 兜底测试
   *
   * 覆盖：
   *   · /api/git-push/tool-probes 端点（GET 只读，返回 48 工具探测清单）
   *   · probeToolPath('node') 在 PATH 无 node 时回退 process.execPath（DSH 宿主自带 node）
   *   · 探测结果为「真实路径 + 版本」，found:true 者 path 非空
   */
  // dsh-skip-sensitive: 测试只断言工具路径/版本，无凭据

  // 改相对路径派生（此前硬编码机器绝对路径 /volume1/...，换机即失效）
  const ROOT = join(import.meta.dirname, '..', '..');

  test('[tool-probes] /api/git-push/tool-probes：GET 返回探测清单（只读豁免 origin）', async () => {
    const r = await handleHttp({ method: 'GET', url: '/api/git-push/tool-probes' }, { workspaceRoot: ROOT }, {});
    assert.equal(r.status, 200, 'GET 不需 origin 豁免，应 200');
    const b = r.body;
    assert.equal(b.ok, true);
    assert.ok(Array.isArray(b.probes) && b.probes.length >= 5, `应返回 ≥5 个工具（得 ${b.probes?.length}）`);
  });

  test('[tool-probes] /api/git-push/tool-probes：存在已探测到的工具（node/git 路径非空）', async () => {
    const r = await handleHttp({ method: 'GET', url: '/api/git-push/tool-probes' }, { workspaceRoot: ROOT }, {});
    const found = r.body.probes.filter((p) => p.found);
    const node = found.find((p) => p.name === 'node');
    assert.ok(node, 'node 应被探测到（本机 PATH 可能无 node，靠 execPath 兜底）');
    assert.ok(node.path && node.path.length > 0, 'node 路径非空');
    const git = found.find((p) => p.name === 'git');
    assert.ok(git && git.found, 'git 应探测到');
  });

  test('[tool-probes] probeToolPath：node 走 process.execPath 兜底（返回宿主 node 路径）', () => {
    const r = probeToolPath('node', ['--version']);
    assert.equal(r.found, true, 'node 应 found:true（execPath 兜底不依赖 PATH）');
    assert.ok(r.path && r.path.length > 0, 'node 路径非空');
    assert.ok(r.version, 'node 版本非空（--version）');
  });

  test('[tool-probes] probeToolPath：非 node 工具正常 which 探测', () => {
    const r = probeToolPath('curl', ['--version']);
    // curl 在多数环境存在；若不存在只断言「返回结构完整」而非必 found
    assert.equal(typeof r.found, 'boolean');
    assert.equal(r.name, 'curl');
    assert.ok(typeof r.path === 'string');
  });
}
