/**
 * 推送失败诊断回归测试（真实样本驱动）。
 *
 * 样本来源：① 本次实测复现（推一个不存在的仓库名，GitHub 真回了 Repository not found）
 *          ② git/ssh 的常见真实 stderr（社区与官方文档均为这些字符串）
 *          ③ 参考已有实现里已固化的判据（lib/git/api.js 的 isBadCredentials、
 *             lib/git/transport.js 的 isNonFastForward、lib/git/clone.js 的 401/404 归一）
 *
 * 最关键的一条断言（用户实测缺陷的防线）：
 *   `Repository not found.` **只能**归到 `repo-not-found-or-no-access`，
 *   且必须**明确写出「不存在或无权限，不可区分」**并降置信度 ⇒
 *   任何把这句话断言成「仓库不存在」的措辞都会让本测试变红 ✗。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyPushFailure, describePushDiagnosis, PUSH_FAILURE_CODES,
} from '../lib/git/push-diagnose.js';

/** 真实样本表：[样本原文, 期望分类码, 期望置信度]。 */
const SAMPLES = [
  // ① 本次实测复现：推不存在的仓库（GitHub 的原文）
  ['id_rsa: ERROR: Repository not found. fatal: Could not read from remote repository. Please make sure you have the correct access rights and the repository exists.',
    'repo-not-found-or-no-access', 'low'],
  // ② 同一语义的另一句（无权限时 GitHub 也可能给这句）
  ['remote: Repository not found. fatal: repository \'https://github.com/EIGHTfs/xxx/\' not found',
    'repo-not-found-or-no-access', 'low'],
  // ③ https 无凭据（本次 spine-multi-viewer 实测原文）
  ["fatal: could not read Username for 'https://github.com': No such device or address",
    'auth-missing', 'high'],
  // ④ SSH 公钥未登记
  ['git@ssh.github.com: Permission denied (publickey). fatal: Could not read from remote repository.',
    'auth-denied', 'high'],
  // ⑤ 主机密钥校验失败
  ['Host key verification failed. fatal: Could not read from remote repository.',
    'host-key', 'high'],
  // ⑥ DNS
  ['fatal: unable to access \'https://github.com/x/y.git/\': Could not resolve host: github.com',
    'dns', 'high'],
  // ⑦ 网络超时 / 拒绝
  ['ssh: connect to host ssh.github.com port 443: Connection timed out',
    'network', 'high'],
  ['fatal: unable to access \'https://github.com/x/y.git/\': Failed to connect to github.com port 443: Connection refused',
    'network', 'high'],
  // ⑧ 分叉
  ['! [rejected] main -> main (non-fast-forward) error: failed to push some refs',
    'diverged', 'high'],
  // ⑨ 保护分支
  ['remote: error: GH006: Protected branch update failed for refs/heads/main.',
    'protected', 'high'],
  // ⑩ 限流与服务端
  ['API: 429 rate limit exceeded', 'rate-limited', 'high'],
  ['remote: Internal Server Error fatal: remote end hung up unexpectedly', 'server-error', 'high'],
];

test('真实样本逐条归类（13 条）', () => {
  for (const [text, code, conf] of SAMPLES) {
    const dg = classifyPushFailure(text);
    assert.equal(dg.code, code, `样本分类错：「${text.slice(0, 60)}」应为 ${code}，实得 ${dg.code}`);
    assert.equal(dg.confidence, conf, `样本置信度错：${code} 应为 ${conf}`);
    assert.ok(dg.fact && dg.fact.length > 0, '必须保留原文证据（fact）');
    assert.ok(dg.inference && dg.inference.length > 10, '必须给人话解释（inference）');
    assert.ok(Array.isArray(dg.nextSteps) && dg.nextSteps.length > 0, '必须给可执行下一步');
  }
});

test('缺陷防线：「Repository not found」必须标为「不存在或无权限，不可区分」', () => {
  const dg = classifyPushFailure('ERROR: Repository not found. Please make sure you have the correct access rights and the repository exists.');
  assert.equal(dg.code, 'repo-not-found-or-no-access');
  assert.equal(dg.confidence, 'low', '该分类必须降置信度（不可区分）');
  assert.match(dg.inference, /不可区分/, '必须写明「不存在与无权限不可区分」');
  assert.match(dg.inference, /不能据此断定/, '必须明确禁止据此断定「不存在」');
  assert.match(dg.nextSteps.join(' '), /不要据这句话断定/, '下一步里也要提醒不要下「不存在」的结论');
});

test('无 remote 用显式标记（不靠猜文本）', () => {
  const dg = classifyPushFailure('无法判定 GitHub remote（origin：不存在）', { noRemote: true });
  assert.equal(dg.code, 'no-remote');
  assert.match(dg.nextSteps.join(' '), /git_remote_create|git remote add/, '应给出建/挂 remote 的下一步');
});

test('HTTP 状态兜底（API 通道文本无关键字时用状态码）', () => {
  assert.equal(classifyPushFailure('建 commit 失败', { httpStatus: 404 }).code, 'repo-not-found-or-no-access');
  assert.equal(classifyPushFailure('更新 ref 失败', { httpStatus: 401 }).code, 'auth-denied');
  assert.equal(classifyPushFailure('查远端失败', { httpStatus: 429 }).code, 'rate-limited');
  assert.equal(classifyPushFailure('服务异常', { httpStatus: 502 }).code, 'server-error');
});

test('信息不足时归 unknown 且置信度低（不许硬猜）', () => {
  const dg = classifyPushFailure('');
  assert.equal(dg.code, 'unknown');
  assert.equal(dg.confidence, 'low');
  assert.match(dg.inference, /信息不足|未能归类/);
});

test('分类码表与实现一致（防新增码漏写解释）', () => {
  for (const code of Object.keys(PUSH_FAILURE_CODES)) {
    const dg = classifyPushFailure('触发样本', { noRemote: code === 'no-remote' });
    if (code === 'no-remote') assert.equal(dg.code, 'no-remote');
    assert.ok(PUSH_FAILURE_CODES[code].length > 5, `${code} 缺解释文案`);
  }
});

test('describePushDiagnosis：一行文本包含分类/置信度/解释/下一步', () => {
  const line = describePushDiagnosis(classifyPushFailure('ERROR: Repository not found.'));
  assert.match(line, /repo-not-found-or-no-access/);
  assert.match(line, /置信度低/);
  assert.match(line, /下一步：/);
});
