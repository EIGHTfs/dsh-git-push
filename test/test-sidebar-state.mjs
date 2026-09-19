/**
 * 设置侧边栏状态自检（2026-09-17）。
 *
 * 背景：这一轮连续踩了三个「界面显示与配置真源不一致」的坑，且都属于**人工点页面才发现**
 * 的类型——本测试把它们固化成可回归的断言，改完直接 `node --test test/test-sidebar-state.mjs`：
 *   ① 推送门禁（pushGate）勾了、重开页面又变未勾选 → 根因：loadSettingsFromHttp 回读列表漏了 pushGate；
 *   ② 凭据/密钥「已填写」误报未填写 → 根因：account-status 用在线校验快照判断，而非配置真源；
 *   ③ 保存凭据后徽标不刷新 → 根因：保存流程只本地置位 tokenConfigured，sshConfigured 从不更新。
 *
 * 断言方式（与 test-sidebar-interaction.mjs 同范式，不连浏览器）：
 *   · 源码级契约：关键实现必须存在且按约定书写（回读键齐全、判断用真源、保存后刷新）；
 *   · 交叉比对：schema 定义的设置键 ↔ 前端回读键，防止再漏；
 *   · 行为级：真实调用 readSshPub/resolveToken/redactConfig，验证「已填写」判断口径正确。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
const schemaSrc = readFileSync(join(ROOT, 'lib/app/schema.js'), 'utf8');
const httpSrc = readFileSync(join(ROOT, 'lib/app/http-handlers.js'), 'utf8');

/** 提取 loadSettingsFromHttp 函数体文本。 */
function loadSettingsBody() {
  const start = clientSrc.indexOf('async loadSettingsFromHttp()');
  assert.ok(start >= 0, '未找到 loadSettingsFromHttp');
  const end = clientSrc.indexOf('\n      async refresh(', start);
  return clientSrc.slice(start, end > 0 ? end : start + 6000);
}

/** 该函数体内回读（editedKeys.has(...)）的全部键名。 */
function readbackKeys() {
  const body = loadSettingsBody();
  return [...new Set([...body.matchAll(/editedKeys\.has\('([^']+)'\)/g)].map((m) => m[1]))];
}

/** schema 里定义的设置键名。 */
function schemaKeys() {
  return [...new Set([...schemaSrc.matchAll(/^\s+(\w+):\s*Schema\./gm)].map((m) => m[1]))];
}

/* ─────────────────── ① 推送门禁回读 ─────────────────── */

test('推送门禁 pushGate 在设置回读列表中（修：勾了刷新又变未勾选）', () => {
  const keys = readbackKeys();
  assert.ok(keys.includes('pushGate'),
    'loadSettingsFromHttp 必须回读 pushGate，否则刷新页面后门禁勾选被默认值 false 覆盖');
  // 契约写法：类型守卫 + editedKeys 防回弹（用户已改的键不被旧值覆盖）
  const body = loadSettingsBody();
  assert.match(body, /typeof v\.pushGate === 'boolean' && !this\.editedKeys\.has\('pushGate'\)/,
    'pushGate 回读必须带布尔类型守卫与 editedKeys 防回弹判断');
});

/* ─────────────────── ② 设置键回读覆盖面 ─────────────────── */

test('UI 可编辑的布尔/字符串设置键都在回读列表中（防再次遗漏）', () => {
  // 只要求「用户可在设置页改、且属于本插件界面状态镜像」的键必须回读；
  // 排除服务端专用/凭据明文/文件路径类（由各自专用通道处理）。
  // 2026-09-17：审计强度 / 自定规则目录 / 硬编码全量扫三项已从设置中删除（非用户可配项），
  //   故不再要求回读——它们必须彻底消失，见下方「已删除项不得复活」断言。
  const mustReadback = [
    'auditEnabled', 'injectRequirements', 'injectSystemPrompt',
    'auditScanScope', 'maxScanFiles', 'pushMethod', 'pushGate',
  ];
  const keys = readbackKeys();
  const missing = mustReadback.filter((k) => !keys.includes(k));
  assert.deepEqual(missing, [], `以下设置键缺少回读，刷新后会回到默认值：${missing.join(', ')}`);
});

test('已删除的设置项不得复活（审计强度/自定规则目录/硬编码全量扫）', () => {
  // 契约：这三项属于「AI 擅自添加、非用户可配」，必须同时从 UI、设置声明、白名单里消失。
  //   审计强度 = 固定完整流程（正则初筛 + AST）；硬编码扫描范围随审计范围走。
  const removed = ['auditLevel', 'auditRuleset', 'hardcodeFullScan'];

  // ① 前端不再回读、不再有状态镜像
  const keys = readbackKeys();
  for (const k of removed) {
    assert.ok(!keys.includes(k), `前端仍在回读已删除的设置键 ${k}——该项不应存在`);
  }
  const start = clientSrc.indexOf('project() {');
  const project = clientSrc.slice(start, start + 2500);
  for (const k of removed) {
    assert.ok(!new RegExp(`\\b${k}:`).test(project), `project() 仍在镜像已删除的 ${k}`);
  }

  // ② 后端设置声明与写入路径不得残留
  const schemaSrc2 = readFileSync(join(ROOT, 'lib/app/schema.js'), 'utf8');
  for (const k of removed) {
    assert.ok(!new RegExp(`^\\s+${k}:\\s*Schema\\.`, 'm').test(schemaSrc2),
      `schema 仍声明已删除的设置键 ${k}`);
  }
  const bridgeSrc = readFileSync(join(ROOT, 'lib/app/settings-bridge.js'), 'utf8');
  for (const k of removed) {
    assert.ok(!new RegExp(`cfg\\.${k}\\s*=`).test(bridgeSrc),
      `settings-bridge 仍在写入已删除的 ${k}`);
  }

  // ③ 面板 UI 不得再有对应控件
  for (const label of ['自定规则目录', '硬编码全量扫']) {
    assert.ok(!clientSrc.includes(`children: '${label}'`), `设置面板仍有「${label}」控件`);
  }
});

test('审计只保留「全量扫描文件上限」一项可配（其余固定）', () => {
  const block = clientSrc.slice(
    clientSrc.indexOf('function dshgp_AuditAdvancedBlock'),
    clientSrc.indexOf('function dshgp_RuleListBlock'),
  );
  assert.match(block, /全量扫描文件上限/, '必须保留「全量扫描文件上限」');
  assert.match(block, /setAdvanced\('maxScanFiles'/, '该项必须可写（setAdvanced）');
  // 此外不应再有其它可写设置项
  const writes = [...block.matchAll(/setAdvanced\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(writes)], ['maxScanFiles'],
    `审计进阶块不应再有其它可配项，实际发现：${[...new Set(writes)].join(', ')}`);
});

test('回读键必须在 schema 中有定义（不得读不存在的键）', () => {
  const defined = new Set(schemaKeys());
  const unknown = readbackKeys().filter((k) => !defined.has(k) && !['tokenConfigured', 'sshConfigured'].includes(k));
  assert.deepEqual(unknown, [], `回读了 schema 未定义的键：${unknown.join(', ')}`);
});

/* ─────────────────── ③ 凭据「已填写」判断口径 ─────────────────── */

test('account-status 的「已填写」判断用配置真源，不用在线校验快照', () => {
  const start = httpSrc.indexOf("case '/api/git-push/account-status':");
  assert.ok(start >= 0, '未找到 account-status 分支');
  const end = httpSrc.indexOf("case '/api/git-push/account-check':", start);
  const block = httpSrc.slice(start, end > 0 ? end : start + 3000);

  // 必须读凭据真源
  assert.match(block, /fileHasToken|fileHasSsh/, 'account-status 必须从凭据文件真源判断「是否已填写」');
  assert.match(block, /resolveToken\(/, 'token 的已填写判断必须查配置真源（resolveToken）');
  assert.match(block, /readSshPub\(/, 'SSH 公钥的已填写判断必须查配置真源（readSshPub）');

  // 契约：readSshPub 返回对象，必须取 .configured（历史上误当字符串 .trim() 抛异常被吞 → 恒 false）
  assert.match(block, /readSshPub\([^)]*\)\s*\??\.configured/,
    'readSshPub 返回对象，必须读 .configured；直接当字符串处理会抛异常导致「已填写」恒为 false');
  assert.doesNotMatch(block, /readSshPub\([^)]*\)\s*\|\|\s*''\s*\)\s*\.trim\(\)/,
    '不得把 readSshPub 的返回值当字符串做 .trim()');

  // 不得退回「只看快照」的旧口径
  assert.doesNotMatch(block, /const hasToken = snap && \(snap\.token/,
    '不得用快照 checkedAt/login 作为「已填写」的唯一依据（那是在线校验结果，未检测时应仍显示已填写）');
});

test('redactConfig 的凭据布尔位仍以配置有值为准（与 account-status 口径一致）', async () => {
  const { redactConfig } = await import('../lib/app/schema.js');
  const r = redactConfig({ githubToken: 'ghp_abc', sshPub: 'ssh-rsa AAAA' });
  assert.equal(r.tokenConfigured, true);
  assert.equal(r.sshConfigured, true);
  assert.equal(r.githubToken, undefined, '密钥位必须删除，不得下发明文');

  const empty = redactConfig({ githubToken: '', sshPub: '   ' });
  assert.equal(empty.tokenConfigured, false, '空白串不算已填写');
  assert.equal(empty.sshConfigured, false, '空白串不算已填写');
});

/* ─────────────────── ④ 保存后刷新凭据状态 ─────────────────── */

test('保存凭据后刷新「已填写」状态（修：保存公钥后徽标不变）', () => {
  // 定位凭据保存方法（save 凭据块：persistSetting('githubToken'|'sshPub')）
  const saveStart = clientSrc.indexOf("this.persistSetting('githubToken', raw)");
  assert.ok(saveStart >= 0, '未找到凭据保存实现');
  const block = clientSrc.slice(saveStart, saveStart + 1400);

  assert.match(block, /await this\.refresh\('account'\)/,
    '保存凭据后必须刷新账号状态（统一入口 refresh("account")），否则「凭据/密钥已填写」徽标不更新');
  assert.doesNotMatch(block, /^\s*if \(raw\) this\.tokenConfigured = true;/m,
    '不得只用「本地置位 tokenConfigured」的旧写法（sshConfigured 从不更新，且无法反映服务端落盘结果）');
});

/* ─────────────────── ⑤ 统一刷新入口契约 ─────────────────── */

test('统一刷新入口 refresh(parts) 存在且支持五部分与 all', () => {
  assert.match(clientSrc, /async refresh\(parts = 'all', opts = \{\}\)/,
    '必须存在统一刷新入口 async refresh(parts, opts)');
  const start = clientSrc.indexOf('async refresh(parts');
  const block = clientSrc.slice(start, start + 2200);
  for (const p of ['settings', 'account', 'repos', 'cloud', 'slots']) {
    assert.ok(block.includes(`'${p}'`), `refresh 必须支持部分 '${p}'`);
  }
  assert.match(block, /PARTS\.slice\(\)/, "'all' 应展开为全部部分");

  // 子刷新函数需支持 silent（后台静默刷新不闪 loading）
  for (const sig of [
    /async loadSlots\(\{ silent = false \} = \{\}\)/,
    /async refreshAccount\(\{ silent = false \} = \{\}\)/,
    /async scanLocalRepos\(path, rebuild, \{ silent = false \} = \{\}\)/,
    /async loadCloudRepos\(\{ silent = false \} = \{\}\)/,
  ]) {
    assert.match(clientSrc, sig, `子刷新函数签名缺少 silent 选项：${sig}`);
  }
});

test('构造阶段与保存流程都走统一入口（不再各自 fetch）', () => {
  assert.match(clientSrc, /void this\.refresh\(\['settings', 'slots'\]\)/,
    '构造阶段必须走统一入口一次刷设置与槽位');
  // 旧的分散调用不应再出现在构造/保存路径
  assert.doesNotMatch(clientSrc, /void this\.loadSettingsFromHttp\(\)/,
    '不应再单独调 loadSettingsFromHttp（已并入统一入口）');
});

/* ─────────────────── ⑥ 前端产物与源码同步 ─────────────────── */

test('assets/preview.html 与 client.js 同步（重新生成过）', () => {
  const previewPath = join(ROOT, 'assets/preview.html');
  let preview;
  try { preview = readFileSync(previewPath, 'utf8'); } catch { return; } // 未生成则跳过

  // 本次三处修复的关键实现必须已进入产物
  const markers = [
    ['统一刷新入口', /async refresh\(parts/],
    ['pushGate 回读', /typeof v\.pushGate === 'boolean'/],
    ['保存后刷新账号状态', /await this\.refresh\('account'\)/],
  ];
  for (const [label, re] of markers) {
    assert.match(preview, re, `preview.html 未包含最新实现「${label}」——改完 client.js 需重新执行 node assets/preview-gen.mjs`);
  }
});

// ---------- 1.5.4 仓库可见性切换（云端状态 → 二次确认 → 切换） ----------

test('1.5.4 可见性切换：前端注入 visSwitch 动作 + 行内二次确认', () => {
  // ① Controller 注入 visSwitch 动作（云端行按钮消费）
  assert.match(clientSrc, /visSwitch:\s*\(fullName,\s*target\)\s*=>\s*this\.switchVisibility\(fullName,\s*target\)/,
    'Controller 动作注入缺 visSwitch');
  // ② 行内二次确认条（「确认将 … 从「…」改为「…」？」）+ 确认后 confirm:true POST
  assert.match(clientSrc, /确认将 '\s*\+ r\.fullName/, '云端行缺二次确认文案');
  assert.match(clientSrc, /visibility:\s*target,\s*confirm:\s*true/, '切换请求必须带 confirm:true');
  // ③ 就地更新列表（成功后刷新该项私有/公开徽标）
  assert.match(clientSrc, /item\.private\s*=\s*res\.visibility\s*===\s*'private'/, '切换成功后应就地更新列表状态');
});

test('1.5.4 可见性切换：后端端点挂 writeConfirmOps 写确认门禁', () => {
  // 破坏性写端点必须在 writeConfirmOps 清单（无 confirm:true → 400 NEED_CONFIRM）
  assert.match(httpSrc, /writeConfirmOps\s*=\s*\[[^\]]*'\/api\/git-push\/repo-visibility'/, 'repo-visibility 未挂写确认门禁');
  assert.match(httpSrc, /case '\/api\/git-push\/repo-visibility'/, '缺少 repo-visibility 端点');
});
