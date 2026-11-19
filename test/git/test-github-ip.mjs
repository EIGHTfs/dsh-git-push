/**
 * GitHub IP 候选清单与健康度学习（lib/core/github-ip-store.js）回归。
 *
 * 为什么值得单测：这套逻辑的每一步都会在真实网络里「看起来正常」——
 *   停用算错 → 本来能用的 IP 被永久跳过（表现为「明明能通却一直失败」）；
 *   冷却算错 → 被封的 IP 永远不再尝试（网络恢复后仍然慢）；
 *   env 覆盖失效 → 人工钉死某个 IP 的应急手段失灵。
 * 所以全部用临时状态文件 + 明确时间戳来测，不碰真实状态、不发网络请求。
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IP_COOLDOWN_MS, MAX_IP_FAILURES, invalidateIpCache, listIpCandidates, normalizeIp,
  readIpSeed, readIpState, recordIpOutcome, usableGithubIps, writeIpState,
} from '../../lib/core/github-ip-store.js';

let workDir = '';
let seedPath = '';
let stateFile = '';
let previousStateEnv;

const seed = (candidates) => {
  writeFileSync(seedPath, JSON.stringify({ version: 1, candidates }), 'utf8');
};

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'dshgp-ip-'));
  seedPath = join(workDir, 'seed.json');
  stateFile = join(workDir, 'state.json');
  if (previousStateEnv === undefined) previousStateEnv = process.env.DSH_GIT_PUSH_IP_STATE;
  process.env.DSH_GIT_PUSH_IP_STATE = stateFile;
  delete process.env.DSH_GIT_PUSH_GITHUB_IP;
  invalidateIpCache();
  seed([
    { ip: '140.82.112.4', note: 'a' },
    { ip: '20.27.177.113', note: 'b' },
  ]);
  return () => {
    if (previousStateEnv === undefined) delete process.env.DSH_GIT_PUSH_IP_STATE;
    else process.env.DSH_GIT_PUSH_IP_STATE = previousStateEnv;
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
  };
});

test('normalizeIp：只接受合法 IPv4，域名/占位符/越界段一律拒绝', () => {
  assert.equal(normalizeIp('140.82.112.4'), '140.82.112.4');
  assert.equal(normalizeIp('  20.27.177.113  '), '20.27.177.113');
  for (const bad of ['github.com', '999.1.1.1', '<IP>', '', null, '1.2.3']) {
    assert.equal(normalizeIp(bad), '', `${String(bad)} 应被拒绝`);
  }
});

test('readIpSeed：文件缺失或损坏时返回空清单，不抛错', () => {
  writeFileSync(seedPath, '{ 坏 JSON', 'utf8');
  assert.deepEqual(readIpSeed(seedPath), []);
  assert.deepEqual(readIpSeed(join(workDir, 'nope.json')), []);
});

test('usableGithubIps：按清单顺序返回未停用的 IP', () => {
  assert.deepEqual(usableGithubIps({ seedPath, stateFile }), ['140.82.112.4', '20.27.177.113']);
});

test('连续失败达上限即停用，之后不再出现在候选里', () => {
  for (let i = 0; i < MAX_IP_FAILURES; i += 1) {
    recordIpOutcome('140.82.112.4', { ok: false, error: 'timeout', stateFile });
    invalidateIpCache();
  }
  const state = readIpState(stateFile);
  assert.equal(state['140.82.112.4'].disabled, true, '连续失败应置 disabled');
  assert.deepEqual(usableGithubIps({ seedPath, stateFile }), ['20.27.177.113']);
});

test('成功一次即清零失败计数并恢复', () => {
  recordIpOutcome('140.82.112.4', { ok: false, error: 'timeout', stateFile });
  recordIpOutcome('140.82.112.4', { ok: true, stateFile });
  invalidateIpCache();
  const state = readIpState(stateFile);
  assert.equal(state['140.82.112.4'].failures, 0);
  assert.equal(state['140.82.112.4'].disabled, false);
  assert.ok(usableGithubIps({ seedPath, stateFile }).includes('140.82.112.4'));
});

test('停用超过冷却期后重新纳入，且排在健康 IP 之后', () => {
  const staleAt = new Date(Date.now() - IP_COOLDOWN_MS - 60_000).toISOString();
  writeIpState({
    '140.82.112.4': { failures: MAX_IP_FAILURES, disabled: true, lastOkAt: null, lastFailAt: staleAt, lastError: 'timeout' },
  }, stateFile);
  invalidateIpCache();
  const ips = usableGithubIps({ seedPath, stateFile });
  assert.deepEqual(ips, ['20.27.177.113', '140.82.112.4'], '冷却到期的应回到候选末尾，而不是继续缺席');
});

test('停用但尚未到冷却期：仍被排除（别让刚失败的抢首选位）', () => {
  const freshAt = new Date(Date.now() - 1000).toISOString();
  writeIpState({
    '140.82.112.4': { failures: MAX_IP_FAILURES, disabled: true, lastOkAt: null, lastFailAt: freshAt, lastError: 'timeout' },
  }, stateFile);
  invalidateIpCache();
  assert.deepEqual(usableGithubIps({ seedPath, stateFile }), ['20.27.177.113']);
});

test('环境变量钉死某个 IP 时优先于清单（应急手段）', () => {
  process.env.DSH_GIT_PUSH_GITHUB_IP = '4.237.22.38';
  invalidateIpCache();
  assert.deepEqual(usableGithubIps({ seedPath, stateFile }), ['4.237.22.38']);
  delete process.env.DSH_GIT_PUSH_GITHUB_IP;
  invalidateIpCache();
});

test('全部停用时返回空数组（调用方据此回退 DNS 直连）', () => {
  writeIpState({
    '140.82.112.4': { failures: 3, disabled: true, lastOkAt: null, lastFailAt: new Date().toISOString(), lastError: 'x' },
    '20.27.177.113': { failures: 3, disabled: true, lastOkAt: null, lastFailAt: new Date().toISOString(), lastError: 'x' },
  }, stateFile);
  invalidateIpCache();
  assert.deepEqual(usableGithubIps({ seedPath, stateFile }), []);
});

test('清单视图带上健康度字段（供设置页/排错查看）', () => {
  recordIpOutcome('140.82.112.4', { ok: false, error: 'timeout', stateFile });
  invalidateIpCache();
  const view = listIpCandidates({ seedPath, stateFile });
  assert.equal(view[0].ip, '140.82.112.4');
  assert.equal(view[0].failures, 1);
  assert.equal(view[0].lastError, 'timeout');
  assert.equal(view[1].failures, 0);
});
