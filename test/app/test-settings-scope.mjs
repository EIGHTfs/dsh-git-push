/**
 * 设置项 githubAuthScope 回归
 *
 * 为什么单独测：scope 与 clientId / mode / login 同处 `githubAuth` 一个嵌套块。
 *   写入若整块覆盖而非键级合并，改一次 scope 就把「token 从哪来、谁的、何时授权」全抹掉，
 *   界面退回未授权状态——preCommit 块踩过同款。
 * 另一个易漏点：scope 是**字符串列表**，非法值必须在落盘前拦住，
 *   否则会带着 GitHub 不认的 scope 去授权，失败点跑到浏览器那边、插件侧毫无线索。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setSettingsFileOverride } from '../../lib/app/settings-bridge.js';
import { handleSettingsSet } from '../../lib/app/handlers/settings.js';

const env = { workspaceRoot: '/tmp' };

/** 造一个带完整 githubAuth 块的临时配置，验证「只改 scope、不冲其它字段」。 */
function withConfig(initial) {
  const dir = mkdtempSync(join(tmpdir(), 'dshgp-scope-'));
  const file = join(dir, 'config.json');
  writeFileSync(file, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
  setSettingsFileOverride(file);
  return {
    read: () => JSON.parse(readFileSync(file, 'utf8')),
    cleanup: () => { setSettingsFileOverride(null); try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ } },
  };
}

const setKey = (key, value) => handleSettingsSet({ body: { key, value }, env, cfg: {} });

test('写 githubAuthScope：生效，且不冲掉 mode/login/clientId/authorizedAt 与凭据键', async () => {
  const ctx = withConfig({
    githubAuth: {
      mode: 'device-flow', clientId: 'Iv1.abc12345', scope: 'repo,workflow',
      login: 'octocat', authorizedAt: '2026-11-19T02:53:25.580Z',
    },
    githubToken: 'gho_placeholder',
  });
  try {
    const result = await setKey('githubAuthScope', 'repo,workflow,read:org');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const saved = ctx.read();
    assert.equal(saved.githubAuth.scope, 'repo,workflow,read:org');
    assert.equal(saved.githubAuth.mode, 'device-flow', 'mode 不能被冲掉');
    assert.equal(saved.githubAuth.login, 'octocat', 'login 不能被冲掉');
    assert.equal(saved.githubAuth.clientId, 'Iv1.abc12345', 'clientId 不能被冲掉');
    assert.equal(saved.githubAuth.authorizedAt, '2026-11-19T02:53:25.580Z', 'authorizedAt 不能被冲掉');
    assert.equal(saved.githubToken, 'gho_placeholder', '凭据键不能被牵连');
  } finally { ctx.cleanup(); }
});

test('非法 scope：落盘前被拒（400 + BAD_SCOPE），磁盘旧值不动', async () => {
  const ctx = withConfig({ githubAuth: { scope: 'repo,workflow' } });
  try {
    const result = await setKey('githubAuthScope', 'repo, bad scope!');
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'BAD_SCOPE');
    assert.equal(ctx.read().githubAuth.scope, 'repo,workflow', '被拒时不许改盘');
  } finally { ctx.cleanup(); }
});

test('空串：允许清空（回落代码默认），且不影响同块其它字段', async () => {
  const ctx = withConfig({ githubAuth: { scope: 'repo,workflow,read:org', mode: 'device-flow' } });
  try {
    const result = await setKey('githubAuthScope', '');
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const saved = ctx.read();
    assert.equal(saved.githubAuth.scope, '', '清空应写入空串');
    assert.equal(saved.githubAuth.mode, 'device-flow', '清空 scope 不该影响 mode');
  } finally { ctx.cleanup(); }
});

test('scope 覆盖优先级：写入后 cfg 立即生效（不用等重启读盘）', async () => {
  const ctx = withConfig({ githubAuth: { scope: 'repo,workflow' } });
  try {
    const liveCfg = { githubAuth: { scope: 'repo,workflow' } };
    const result = await handleSettingsSet({ body: { key: 'githubAuthScope', value: 'repo,workflow,read:org' }, env, cfg: liveCfg });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(liveCfg.githubAuth.scope, 'repo,workflow,read:org',
      '运行期 cfg 必须同步更新，否则 resolveScope 会继续用旧值挡住新配置');
  } finally { ctx.cleanup(); }
});
