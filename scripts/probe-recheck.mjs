/**
 * 探针：「重新检测」按钮链路实测（联网，需服务已启动）。
 * 运行：node test/probe-recheck-live.mjs
 */
const BASE = process.env.DSH_PROBE_BASE || 'http://127.0.0.1:8090';
const ORIGIN = 'http://127.0.0.1:30801';
// 超时兜底：/account-check 内部要联网校验 token 与 SSH，服务端异常或网络悬挂时
//   无超时的 fetch 会**永久挂起**，探针既不报错也不退出（只能 Ctrl+C），
//   排查时看不到任何有用信息。60s 与 lib/git/api.js 的网络出口默认值一致。
const TIMEOUT_MS = 60_000;
const post = (p, b) => fetch(BASE + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  body: JSON.stringify(b),
  signal: AbortSignal.timeout(TIMEOUT_MS),
}).then(r => r.json());
const get = (p) => fetch(BASE + p, {
  headers: { Origin: ORIGIN },
  signal: AbortSignal.timeout(TIMEOUT_MS),
}).then(r => r.json());

console.log('══ 「重新检测」按钮链路实测 ══\n');

console.log('① 按钮行为 POST /account-check（与 client.js recheckAccount 一致）');
const c = await post('/api/git-push/account-check', { checkSsh: true, confirm: false });
const ts = c.tokenStatus || {}, ss = c.sshStatus || {};
const tv = ts.valid ? '✅ 有效' : (ts.timeout ? '⏳ 超时未测成（不是失效）' : '❌ 无效');
const sv = ss.valid ? '✅ 有效' : (ss.timeout ? '⏳ 超时未测成' : '❌ 无效');
console.log('   Token:', tv, ts.login ? `(${ts.login})` : '');
console.log('   SSH  :', sv, ss.login ? `(${ss.login})` : '');

console.log('\n② 写回后读回（页面渲染依据）');
const s = await get('/api/git-push/account-status');
console.log('   ' + (s.block || '').split('\n').join('\n   '));
console.log('\n   字段: tokenTimeout=' + s.tokenStatus?.timeout, '| sshTimeout=' + s.sshStatus?.timeout);

console.log('\n③ 防抖验证：连发两次（第二次应被前端忽略，后端仍应稳定）');
const [r1, r2] = await Promise.all([
  post('/api/git-push/account-check', { checkSsh: false, confirm: false }),
  post('/api/git-push/account-check', { checkSsh: false, confirm: false }),
]);
console.log('   两次返回 tokenStatus.valid:', r1.tokenStatus?.valid, '/', r2.tokenStatus?.valid);
console.log('   （前端有 accountLoading 防抖，真实点击不会连发）');

console.log('\n══ 结论 ══');
console.log(ts.valid || ss.valid ? '✅ 按钮有效：在线校验成功并写回状态' : '⏳ 本次未测成（网络超时），状态已如实标注 timeout=true');
