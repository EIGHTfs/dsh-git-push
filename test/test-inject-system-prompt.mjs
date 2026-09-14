/**
 * 1.1.9 回归：注入系统提示词（总开关 + 三段内容 + README 版本校验）。
 *
 * 需求（2026-09-13）：①侧边栏「审计」选项卡新增「注入系统提示词」开关（默认开）
 *   ②注入内容只到目录级：工具安装路径 + 工作区目录 + skill 总入口一行 + 插件功能用法
 *   ③原「注入全部 skill 内容 / 注入 repo-index 全文」两开关废弃移除
 *   ④scan-version 增加「README 版本号 vs package.json version」校验。
 *
 * 做法：①沿用 test-inject-switch 的 mock 渲染范式读真实 client.js 渲染出的 input props
 *       ②host 侧门控用源码断言（apply.js 的 text thunk）
 *       ③内容类断言走真实模块导出（inject-text / context）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootClientSrc = readFileSync(join(ROOT, 'client.js'), 'utf8');
const applySrc = readFileSync(join(ROOT, 'lib/app/apply.js'), 'utf8');
const LABEL = '注入系统提示词';

/** 渲染审计页，返回所有 input props（同 test-inject-switch 范式）。 */
function renderAuditInputs(value) {
  let captured = null;
  const prevWindow = globalThis.window;
  globalThis.window = { __ModuleLoader__: { load: ({ id, factory }) => { captured = { id, factory }; } } };
  const reactMock = {
    createElement: (type, props, ...kids) => {
      const p = Object.assign({}, props || {});
      if (kids.length) p.children = kids.length === 1 ? kids[0] : kids;
      return { type, props: p };
    },
    useState: (init) => [init === 'account' ? 'audit' : (typeof init === 'function' ? init() : init), () => {}],
    useEffect: () => {},
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  };
  const req = (name) => {
    if (name === 'react') return reactMock;
    if (name === 'react/jsx-runtime') return { jsx: reactMock.createElement, jsxs: reactMock.createElement };
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconChevronDownOutline14: 'icon-mock' };
    if (name === '@deepseek-ai/dsh-client-store') return {
      createSnapshotStore: (initial) => {
        let cur = initial;
        return { getSnapshot: () => cur, set: (v) => { cur = v; }, subscribe: () => () => {} };
      },
    };
    throw new Error('require: ' + name);
  };
  new Function('require', 'window', rootClientSrc)(req, globalThis.window); // dsh-skip-sensitive: 沙箱执行仓库内 client.js 顶层（受控源码，非外部输入）
  globalThis.window = prevWindow;
  const mod = captured.factory(req);
  const scopeMock = {
    getSnapshot: () => ({ status: 'ready', writable: true, value }),
    subscribe: () => () => {},
    set: async () => {}, mutate: async () => {}, unset: async () => {},
  };
  let renderSection = null;
  const ctx = {
    effect: () => {},
    get: () => { throw new Error('cannot get property without inject'); },
    slots: {
      register: (desc, component) => ({ ...desc, component }),
      inject: (name, registerFn) => { renderSection = registerFn()?.component; },
    },
    settingsScope: { bind: () => scopeMock },
  };
  mod.apply(ctx);
  assert.ok(renderSection, 'settings.section 应注册');
  const inputs = [];
  const walk = (node, depth = 0) => {
    if (node === null || node === undefined || depth > 40) return;
    if (Array.isArray(node)) { node.forEach((c) => walk(c, depth)); return; }
    if (typeof node !== 'object') return;
    let n = node;
    for (let g = 0; n && typeof n === 'object' && typeof n.type === 'function' && g < 25; g += 1) {
      n = n.type(n.props || {});
    }
    if (!n || typeof n !== 'object') return;
    if (n.type === 'input') inputs.push(n.props);
    walk(n.props && n.props.children, depth + 1);
  };
  walk(renderSection());
  return inputs;
}

const findSwitch = (inputs) => inputs.find((p) => p['aria-label'] === LABEL);

/* ───────── ① 侧边栏审计选项卡：注入系统提示词开关 ───────── */

test('审计选项卡：渲染出「注入系统提示词」开关且可点击', () => {
  const sw = findSwitch(renderAuditInputs({ auditEnabled: false }));
  assert.ok(sw, '审计页应有「注入系统提示词」开关');
  assert.equal(typeof sw.onChange, 'function', '开关必须可响应点击');
  assert.notEqual(sw.disabled, true, '开关不应被禁用');
});

test('默认开：快照未存该字段时开关呈勾选态（缺省即注入）', () => {
  const sw = findSwitch(renderAuditInputs({ auditEnabled: false }));
  assert.equal(sw.checked, true, 'injectSystemPrompt 缺省视为 true（默认注入）');
});

test('存 false：开关呈未勾选态', () => {
  const sw = findSwitch(renderAuditInputs({ injectSystemPrompt: false }));
  assert.equal(sw.checked, false, '显式 false 必须回显未勾选');
});

test('存 true：开关呈勾选态', () => {
  const sw = findSwitch(renderAuditInputs({ injectSystemPrompt: true }));
  assert.equal(sw.checked, true);
});

test('client 源码：toggle 动作在 inject() 中暴露（漏了会 onChange 到 undefined）', () => {
  assert.ok(rootClientSrc.includes('toggleInjectSystemPrompt: (checked) => this.toggleInjectSystemPrompt(checked)'),
    'inject() 必须暴露 toggleInjectSystemPrompt');
  assert.ok(/toggleInjectSystemPrompt\(checked\)\s*\{/.test(rootClientSrc), 'controller 必须有该方法实现');
  assert.ok(rootClientSrc.includes("this.scope.set('injectSystemPrompt'"), 'toggle 必须写回 scope');
});

/* ───────── ② host 侧接线：总开关门控 + 四段注入 ───────── */

test('host：注入段由 injectSystemPrompt 门控（关=返回空串，不是不注册）', () => {
  assert.ok(/cfg\.injectSystemPrompt \? FUNCTION_USAGE_HINT : ''/.test(applySrc),
    '功能用法段必须由 injectSystemPrompt 门控');
  assert.ok(/cfg\.injectSystemPrompt \? README_CHECK_HINT : ''/.test(applySrc),
    'README 提醒段必须由 injectSystemPrompt 门控');
  assert.ok(/cfg\.injectSystemPrompt && cfg\.auditEnabled && cfg\.injectRequirements/.test(applySrc),
    '开发者要求清单段必须三重门控（注入总开关 + 审计 + 子开关）');
});

test('host：注册四段（功能用法 990 / 环境 980 / README 991 / 要求清单 992）', () => {
  for (const name of ['dsh-git-push-usage', 'dsh-git-push-env', 'dsh-git-push-readme-check', 'dsh-git-push-requirements']) {
    assert.ok(applySrc.includes(`name: '${name}'`), `应注册 ${name} 段`);
  }
  assert.ok(/order: 990/.test(applySrc), '功能用法段应为 order 990');
});

test('host：设置页切换总开关即时生效（watch 同步 + 清环境注入缓存）', () => {
  assert.ok(/typeof next\.injectSystemPrompt === 'boolean'/.test(applySrc), 'watch 必须同步 injectSystemPrompt');
  assert.ok(/envInjectCache = null/.test(applySrc), '切开关须清缓存（否则旧文本继续注入）');
});

test('host：text thunk 全部同步（async 会让模型看到 [object Promise]）', () => {
  const seg = applySrc.slice(applySrc.indexOf('const sectionCount = registerContext'), applySrc.indexOf('// 3) HTTP API'));
  assert.ok(seg.length > 0);
  assert.ok(!/text:\s*async/.test(seg), 'section.text 不得为 async');
});

/* ───────── ③ 废弃开关彻底移除 ───────── */

test('废弃：injectFullSkill / injectRepoIndexFull 不再出现在配置与 UI', () => {
  const schemaSrc = readFileSync(join(ROOT, 'lib/app/schema.js'), 'utf8');
  const libClientSrc = readFileSync(join(ROOT, 'lib/client/index.js'), 'utf8');
  for (const key of ['injectFullSkill', 'injectRepoIndexFull']) {
    assert.ok(!schemaSrc.includes(key), `schema.js 不应再有 ${key}`);
    assert.ok(!libClientSrc.includes(key), `lib/client/index.js 不应再有 ${key}`);
    assert.ok(!rootClientSrc.includes(key), `client.js 不应再有 ${key}`);
  }
});

/* ───────── ④ 注入内容：功能用法 + 目录级环境 ───────── */

test('功能用法段：覆盖全部 10 个工具（AI 才知道插件有什么）', async () => {
  const { FUNCTION_USAGE_HINT } = await import('../lib/app/inject-text.js');
  for (const tool of ['git_scan', 'git_commit_push', 'code_audit', 'git_gen_readme', 'git_clone',
    'git_remote_create', 'git_set_visibility', 'link_check', 'git_account_check', 'git_gen_ssh_key']) {
    assert.ok(FUNCTION_USAGE_HINT.includes(tool), `功能用法段应包含 ${tool}`);
  }
});

test('功能用法段：明确「凭据由插件托管、不要到处找凭据」', async () => {
  const { FUNCTION_USAGE_HINT } = await import('../lib/app/inject-text.js');
  assert.ok(FUNCTION_USAGE_HINT.includes('不要到处找凭据'), '必须点名痛点：不要到处找凭据');
  assert.ok(FUNCTION_USAGE_HINT.includes('凭据由插件托管'), '必须说明凭据由插件托管');
  assert.ok(FUNCTION_USAGE_HINT.includes('git_account_check'), '查登录态应指向 git_account_check');
  assert.ok(!/PRIVATE KEY|ghp_[A-Za-z0-9]{10}/.test(FUNCTION_USAGE_HINT), '注入文本不得含真实凭据形状');
});

test('环境注入：工作区根 + 子目录行（只注目录，不注 skill 正文）', async () => {
  const { createEnvInjectionText, parseEnvInjection } = await import('../lib/context/index.js');
  const text = createEnvInjectionText({
    cwd: '/ws', projectRoot: '/ws',
    tools: [{ name: 'git', path: '/usr/bin/git', found: true }],
    workspace: { workspaceRoot: '/ws', children: ['a', 'b'] },
  });
  assert.ok(text.includes('- 工作区根目录：/ws'), '应注入工作区根目录');
  assert.ok(text.includes('- 工作区子目录：a / b'), '应注入工作区子目录');
  const back = parseEnvInjection(text);
  assert.equal(back.workspaceRoot, '/ws');
  assert.deepEqual(back.children, ['a', 'b']);
  assert.equal(back.tools.git, '/usr/bin/git');
});

test('环境注入：探测失败的工具不进文本（只列 found 的）', async () => {
  const { createEnvInjectionText } = await import('../lib/context/index.js');
  const text = createEnvInjectionText({
    cwd: '/ws', projectRoot: '/ws',
    tools: [{ name: 'git', path: '/usr/bin/git', found: true }, { name: '7z', path: '', found: false }],
  });
  assert.ok(text.includes('git=/usr/bin/git'));
  assert.ok(!text.includes('7z='), '未探测到的工具不应出现');
});

test('环境注入：skill 只给总入口路径（不列 skill 文件清单）', async () => {
  const { createEnvInjectionText } = await import('../lib/context/index.js');
  const text = createEnvInjectionText({ cwd: '/ws', projectRoot: '/ws', tools: [] });
  assert.ok(text.includes('skills 目录：'), '应给 skill 总入口');
  assert.ok(!/\.md/.test(text), '不应列出任何 skill 文件名（只到目录级）');
});

/* ───────── ⑤ scan-version：README 版本号 vs package.json ───────── */

test('scan-version：优先认「（当前）」标记行', async () => {
  const { readmeVersion } = await import('../scripts/scan-version.mjs');
  const r = readmeVersion('## 版本列表\n\n| **1.2.3**（当前） | 说明 |\n| 1.2.2 | 旧 |\n');
  assert.equal(r.version, '1.2.3');
  assert.equal(r.source, '（当前）标记行');
});

test('scan-version：无标记行时取版本列表章节内最高版本', async () => {
  const { readmeVersion } = await import('../scripts/scan-version.mjs');
  const r = readmeVersion('正文\n## 版本列表\n| **1.0.2** | a |\n| **1.0.9** | b |\n## 其他\n| 9.9.9 | 不该算 |\n');
  assert.equal(r.version, '1.0.9', '超出章节的 9.9.9 不得计入');
});

test('scan-version：无版本号时 found=false（调用方给明确报错）', async () => {
  const { readmeVersion } = await import('../scripts/scan-version.mjs');
  assert.equal(readmeVersion('没有任何版本号的文档').found, false);
  assert.equal(readmeVersion('').found, false);
});

test('scan-version：README 版本与 package.json 一致（仓库自检）', async () => {
  const { readmeVersion } = await import('../scripts/scan-version.mjs');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const r = readmeVersion(readme);
  assert.ok(r.found, 'README 应有版本列表');
  assert.equal(r.version, pkg.version, 'README 版本号必须与 package.json version 一致');
});
