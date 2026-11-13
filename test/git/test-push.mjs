/**
 * test-push.mjs —— 同族测试合并（test-push-diagnose.mjs · test-push-transport.mjs）
 *
 * 合并方式：import 按模块归并去重 → 各原文件体**按原顺序平铺**（test() 仍在模块顶层，不包 describe、不进 async 回调）
 *   → 每个原文件体包一层 `{}` 块级作用域，只为隔离同名顶层声明，不改注册时机与执行顺序；
 *     每个 test 名带 `[原文件名] ` 前缀便于溯源。
 * 生成工具：test/helpers/merge-tests.mjs（前置检查用 lib/ast/tokenizer 判定，非正则）。
 */
import { Config } from '../../lib/app/schema.js';
import { defaultConfig, SETTINGS_SCHEMA } from '../../lib/client/index.js';
import { resolveSshKeys, resolveSshKey, credentialsDir } from '../../lib/git/credentials.js';
import { dispatchPush, pushViaSsh, sshReason, isNonFastForward } from '../../lib/git/index.js';
import { classifyPushFailure, describePushDiagnosis, PUSH_FAILURE_CODES } from '../../lib/git/push-diagnose.js';
import { mkdtempTracked } from '../helpers/tmp-dir.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
// ── 原 test-push-diagnose.mjs ──
{
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

  test('[push-diagnose] 真实样本逐条归类（13 条）', () => {
    for (const [text, code, conf] of SAMPLES) {
      const dg = classifyPushFailure(text);
      assert.equal(dg.code, code, `样本分类错：「${text.slice(0, 60)}」应为 ${code}，实得 ${dg.code}`);
      assert.equal(dg.confidence, conf, `样本置信度错：${code} 应为 ${conf}`);
      assert.ok(dg.fact && dg.fact.length > 0, '必须保留原文证据（fact）');
      assert.ok(dg.inference && dg.inference.length > 10, '必须给人话解释（inference）');
      assert.ok(Array.isArray(dg.nextSteps) && dg.nextSteps.length > 0, '必须给可执行下一步');
    }
  });

  test('[push-diagnose] 缺陷防线：「Repository not found」必须标为「不存在或无权限，不可区分」', () => {
    const dg = classifyPushFailure('ERROR: Repository not found. Please make sure you have the correct access rights and the repository exists.');
    assert.equal(dg.code, 'repo-not-found-or-no-access');
    assert.equal(dg.confidence, 'low', '该分类必须降置信度（不可区分）');
    assert.match(dg.inference, /不可区分/, '必须写明「不存在与无权限不可区分」');
    assert.match(dg.inference, /不能据此断定/, '必须明确禁止据此断定「不存在」');
    assert.match(dg.nextSteps.join(' '), /不要据这句话断定/, '下一步里也要提醒不要下「不存在」的结论');
  });

  test('[push-diagnose] 无 remote 用显式标记（不靠猜文本）', () => {
    const dg = classifyPushFailure('无法判定 GitHub remote（origin：不存在）', { noRemote: true });
    assert.equal(dg.code, 'no-remote');
    assert.match(dg.nextSteps.join(' '), /git_remote_create|git remote add/, '应给出建/挂 remote 的下一步');
  });

  test('[push-diagnose] HTTP 状态兜底（API 通道文本无关键字时用状态码）', () => {
    assert.equal(classifyPushFailure('建 commit 失败', { httpStatus: 404 }).code, 'repo-not-found-or-no-access');
    assert.equal(classifyPushFailure('更新 ref 失败', { httpStatus: 401 }).code, 'auth-denied');
    assert.equal(classifyPushFailure('查远端失败', { httpStatus: 429 }).code, 'rate-limited');
    assert.equal(classifyPushFailure('服务异常', { httpStatus: 502 }).code, 'server-error');
  });

  test('[push-diagnose] 信息不足时归 unknown 且置信度低（不许硬猜）', () => {
    const dg = classifyPushFailure('');
    assert.equal(dg.code, 'unknown');
    assert.equal(dg.confidence, 'low');
    assert.match(dg.inference, /信息不足|未能归类/);
  });

  test('[push-diagnose] 分类码表与实现一致（防新增码漏写解释）', () => {
    for (const code of Object.keys(PUSH_FAILURE_CODES)) {
      const dg = classifyPushFailure('触发样本', { noRemote: code === 'no-remote' });
      if (code === 'no-remote') assert.equal(dg.code, 'no-remote');
      assert.ok(PUSH_FAILURE_CODES[code].length > 5, `${code} 缺解释文案`);
    }
  });

  test('[push-diagnose] describePushDiagnosis：一行文本包含分类/置信度/解释/下一步', () => {
    const line = describePushDiagnosis(classifyPushFailure('ERROR: Repository not found.'));
    assert.match(line, /repo-not-found-or-no-access/);
    assert.match(line, /置信度低/);
    assert.match(line, /下一步：/);
  });
}

// ── 原 test-push-transport.mjs ──
{
  /**
   * 推送通道回归：默认 SSH 优先、ssha 一致性语义、通道可配置。
   *
   * 背景：原先 push.js 无条件先走 API（Git Data API 在远端 blob→tree→commit **重建**提交），
   *   SSH 仅在 token 401 时兜底 → 推完远端 sha 与本地必然不同，本地 origin/<branch> 引用
   *   与实际远端对不上，每次都要额外对齐。
   * 现行为：dispatchPush 单点决策，pushMethod 默认 'ssh'（推本地 HEAD，远端 sha == 本地 sha），
   *   无可用私钥才回落 API，并把回落原因记进 fallbackReason。
   */

  const require = createRequire(import.meta.url);


  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  /** 建一个只有一次提交、无 origin 的临时仓库。 */
  function tempRepo() {
    const dir = mkdtempTracked(join(tmpdir(), 'dshgp-sshprobe-'));
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 'probe@test');
    git('config', 'user.name', 'probe');
    writeFileSync(join(dir, 'a.txt'), 'probe\n');
    git('add', '-A');
    git('commit', '-qm', 'probe init');
    return dir;
  }

  test('[push-transport] 默认通道是 ssh（配置 / schema / 设置项三处一致）', () => {
    assert.equal(defaultConfig().pushMethod, 'ssh', 'defaultConfig 默认应为 ssh');
    const item = SETTINGS_SCHEMA.find((x) => x.key === 'pushMethod');
    assert.ok(item, 'SETTINGS_SCHEMA 应有推送通道设置项');
    assert.equal(item.default, 'ssh', '设置项默认应为 ssh');
    assert.deepEqual(item.values, ['ssh', 'api', 'auto'], '可选值应为 ssh/api/auto');
    const refs = (Config.toJSON ? Config.toJSON().refs : []) || [];
    const f = refs.find((r) => r.key === 'pushMethod');
    assert.ok(f, 'Host Config 应有 pushMethod');
    assert.equal(f.meta.default, 'ssh', 'Host schema 默认应为 ssh');
  });

  test('[push-transport] commitAndPush 与 commitWithAudit 默认走 ssh（防退回 API 优先）', () => {
    const pushSrc = readFileSync(join(ROOT, 'lib/git/push.js'), 'utf8');
    assert.ok(/pushMethod = 'ssh'/.test(pushSrc), 'commitAndPush 的 pushMethod 默认应为 ssh');
    assert.ok(pushSrc.includes('dispatchPush('), 'commitAndPush 应经 dispatchPush 决策通道');
    assert.ok(!/const pr = await pushViaApi\(/.test(pushSrc),
      '不得再无条件先调 pushViaApi（那会在远端重建提交 → sha 不一致）');
    const cpSrc = readFileSync(join(ROOT, 'lib/commit-push.js'), 'utf8');
    assert.ok(/pushMethod: pushMethod \|\| cfg\.pushMethod \|\| 'ssh'/.test(cpSrc),
      'commitWithAudit 应把配置里的 pushMethod 透传下去，缺省 ssh');
  });

  test('[push-transport] dispatchPush：三档语义正确（无 origin 时如实报错不崩）', async () => {
    const repo = tempRepo();
    const ssh = await dispatchPush({ repoPath: repo, pushMethod: 'ssh' });
    assert.equal(ssh.ok, false, '无 origin 应失败');
    assert.ok(String(ssh.reason).includes('origin'), '应说明是 origin 解析问题');
    const api = await dispatchPush({ repoPath: repo, pushMethod: 'api' });
    assert.equal(api.ok, false);
    assert.equal(api.method, 'api', 'api 档优先尝试 API，method 应记 api');
    const auto = await dispatchPush({ repoPath: repo, pushMethod: 'auto' });
    assert.equal(auto.ok, false, 'auto 无 origin 也应失败');
  });

  test('[push-transport] dispatchPush：pushMethod 缺省即 ssh（不传参也走 SSH 优先）', async () => {
    const repo = tempRepo();
    const r = await dispatchPush({ repoPath: repo });
    // 无 origin 时两条通道都会失败，但 method 字段反映「先试的是谁」
    assert.equal(r.method, 'ssh', '缺省应优先 SSH（method=ssh）');
  });

  test('[push-transport] pushViaSsh：多密钥逐个尝试（避免有可用密钥却推不动）', () => {
    const keys = resolveSshKeys();
    assert.ok(Array.isArray(keys), 'resolveSshKeys 应返回数组');
    for (const k of keys) {
      assert.ok(k.keyPath && k.kind, '每项应有 keyPath/kind');
    }
    // 与首个可用密钥语义一致（resolveSshKey 是 resolveSshKeys 的首元素）
    const first = resolveSshKey();
    if (keys.length) assert.equal(first.keyPath, keys[0].keyPath, 'resolveSshKey 应等于候选列表首个');
    const src = readFileSync(join(ROOT, 'lib/git/transport.js'), 'utf8');
    assert.ok(/for \(const \{ keyPath, kind \} of keys\)/.test(src),
      'pushViaSsh 应逐个尝试候选密钥');
  });

  test('[push-transport] 凭据目录自探测：脚本自己找 token/密钥，无需用户填路径', () => {
    const src = readFileSync(join(ROOT, 'lib/core/credentials.js'), 'utf8');
    assert.ok(/export function credentialsDir/.test(src), 'credentialsDir 应存在');
    assert.ok(/export function resolveSshKeys/.test(src), 'resolveSshKeys 应存在');
    assert.ok(/export function resolveToken/.test(src), 'resolveToken 应存在');
    const dir = credentialsDir();
    assert.ok(typeof dir === 'string' && dir.length > 0, 'credentialsDir 应返回路径');
  });

  test('[push-transport] SSH 成功后也做推送后增强（remoteRef/auxRemote/autoTag）', () => {
    const src = readFileSync(join(ROOT, 'lib/git/push.js'), 'utf8');
    // 原先 SSH 分支只 fetchRemoteHeads，不更新 remote-tracking ref → 走 SSH 时引用错位
    const sshOnlyHeads = /if \(ssh\.ok\) \{\s*const heads = await fetchRemoteHeads/.test(src);
    assert.ok(!sshOnlyHeads, 'SSH 成功分支不得只拉 heads 而不做 remoteRef/auxRemote 增强');
    assert.ok(/steps\.push\(`pushed-via-/.test(src), '应记录实际生效的通道');
  });

  test('[push-transport] 安全：remote URL 不得内嵌明文凭据（token/密码）', () => {
    // 实测发现 6 个仓库的 origin 曾被写成 https://ghp_xxx@github.com/...——
    //   明文落在 .git/config，且那把 token 已失效（HTTP 401）纯属负担。
    //   推送凭据应由凭据目录自探测提供（token/密钥），不进 remote URL。
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('git', ['remote', '-v'], { cwd: ROOT, encoding: 'utf8' });
    assert.ok(!/gh[pous]_[A-Za-z0-9]{20,}/.test(out), 'remote URL 不得内嵌 ghp_ 类 token');
    assert.ok(!/github_pat_[A-Za-z0-9_]{20,}/.test(out), 'remote URL 不得内嵌 github_pat_ 类 token');
    assert.ok(!/https:\/\/[^\s/@]+:[^\s/@]+@/.test(out), 'remote URL 不得内嵌 user:password 形式凭据');
  });

  test('[push-transport] 安全：.git/config 不得落盘明文 token', () => {
    const cfgPath = join(ROOT, '.git', 'config');
    if (!existsSync(cfgPath)) return; // 非 git 检出（打包副本）跳过
    const cfg = readFileSync(cfgPath, 'utf8');
    assert.ok(!/gh[pous]_[A-Za-z0-9]{20,}/.test(cfg), '.git/config 不得出现明文 token');
  });

  test('[push-transport] 分叉识别：中英文 non-fast-forward 都能认出，鉴权失败不误判', () => {
    // 真实报错文本：本地与远端各有对方没有的提交时 git 的两种输出
    assert.ok(isNonFastForward(' ! [rejected]        HEAD -> master (fetch first)'), '英文 fetch first');
    assert.ok(isNonFastForward('提示：更新被拒绝，因为远程仓库包含您本地尚不存在的提交。'), '中文提示');
    assert.ok(isNonFastForward('error: failed to push some refs ... non-fast-forward'), '英文 non-fast-forward');
    // 不得把鉴权/网络类失败误判成分叉（那会挡住本该发生的 API 回落）
    assert.equal(isNonFastForward('git@ssh.github.com: Permission denied (publickey).'), false, '鉴权失败');
    assert.equal(isNonFastForward('Could not resolve hostname ssh.github.com'), false, '域名解析失败');
    assert.equal(isNonFastForward(''), false, '空串');
  });

  test('[push-transport] 分叉时不回落 API（回落会在远端重建提交、加剧分叉）', () => {
    const src = readFileSync(join(ROOT, 'lib/git/transport.js'), 'utf8');
    // SSH 失败后必须先判分叉，再考虑 API 回落
    const sshFail = src.indexOf('const sshRes = trySsh();');
    const nff = src.indexOf('if (isNonFastForward(sshRes.reason))');
    const apiCall = src.indexOf('const apiRes = await tryApi();', sshFail);
    assert.ok(sshFail >= 0 && nff > sshFail, 'SSH 失败后应先判分叉');
    assert.ok(apiCall > nff, 'API 回落必须排在分叉判定之后（分叉时直接返回、不回落）');
    assert.ok(/diverged: true/.test(src), '分叉结果应带 diverged 标记供调用方判断');
  });

  test('[push-transport] sshReason：剥掉 known_hosts 告警与 git 提示段，保住真正的失败原因', () => {
    const noisy = "Warning: Permanently added '[ssh.github.com]:443' (ED25519) to the list of known hosts.\n"
      + 'To ssh://ssh.github.com:443/EIGHTfs/x.git\n'
      + ' ! [rejected]        HEAD -> master (fetch first)\n'
      + '错误：无法推送一些引用\n'
      + '提示：更新被拒绝，因为远程仓库包含您本地尚不存在的提交。\n'
      + '提示：详见 git push --help';
    const r = sshReason(noisy);
    assert.ok(!r.includes('Permanently added'), '不应保留 known_hosts 告警');
    assert.ok(!/(^|\s)提示：/.test(r), '不应保留 git 的「提示：」建议段');
    assert.ok(r.includes('rejected') || r.includes('被拒绝'), '应保留真正的失败原因');
    assert.ok(r.length <= 320, '长度应受控');
  });

  test('[push-transport] 真实分叉仓库：dispatchPush 如实报 diverged 而非静默回落 API', async () => {
    // 用真远端做端到端验证成本高且会改动远端，故此处只断言「分叉分支返回结构」的字段约定；
    //   端到端行为已在本机 dsh-skill-scoreboard（远端 2f4b3cb / 本地 0093b89 两条链）实测确认。
    const src = readFileSync(join(ROOT, 'lib/git/transport.js'), 'utf8');
    assert.ok(/localHead: localHead \|\| ''/.test(src), '应回传 localHead');
    assert.ok(/remoteHead:\s*remoteHead(?:\s*\|\| '')?|remoteHead,\s*\n/.test(src), '应回传 remoteHead');
    assert.ok(/已阻止回落 API/.test(src), '错误信息应说明为何不回落');
  });

  test('[push-transport] API 推送后 remote-tracking 引用指向远端真实 sha（不写本地代理）', () => {
    const src = readFileSync(join(ROOT, 'lib/git/push.js'), 'utf8');
    // 旧实现无条件用 localHead 当 refTarget：API 在远端重建提交后本地没有该对象，
    //   于是这个「代理 sha」让 ahead/behind 谎报 0/0，把已分叉的仓库显示成同步。
    assert.ok(/async function fetchRemoteBranchRef/.test(src), '应有取回远端对象的函数');
    assert.ok(/\+refs\/heads\/\$\{branch\}:refs\/remotes\/origin\/\$\{branch\}/.test(src),
      'fetch 应用 + 前缀写 remote-tracking 引用（远端跟踪引用的语义就是镜像远端）');
    assert.ok(/if \(pr\.method === 'api'\)/.test(src), '仅 API 通道需要取回真实对象');
    assert.ok(/代理 sha/.test(src), '取回失败时应如实标注为代理，不冒充真实');
    // SSH 通道推的就是本地对象，refTarget 保持 localHead 即可
    assert.ok(/let refTarget = localHead \|\| pr\.commitSha/.test(src), '默认仍以本地 HEAD 为准');
  });

  test('[push-transport] API 推送后引用真实性：取回失败不静默（标注代理 + 远端实际 sha）', () => {
    const src = readFileSync(join(ROOT, 'lib/git/push.js'), 'utf8');
    assert.ok(/取回失败，远端实际/.test(src), '应写明远端实际 sha');
    assert.ok(/取回远端对象异常/.test(src), '异常路径也要标注');
    // 不能因为取回失败就中断推送成功流程
    assert.ok(/catch \(e\) \{\s*refNote/.test(src), '取回异常不应抛出中断');
  });
}
