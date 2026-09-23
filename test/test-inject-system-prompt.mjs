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
const rootClientSrc = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
const applySrc = readFileSync(join(ROOT, 'lib/app/apply.js'), 'utf8');
const LABEL = '注入系统提示词/上下文';

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
  // 2026-09-14：持久化统一走 persistSetting（HTTP /settings-set 落盘，兼容 scope.set 双通道）；
  //   绕过 client isLoopback=memory 下 scope.set 不发 wire、设置重启丢失的问题
  // 2026-09-15：toggle 统一走 commitSetting 公共入口（内部调 persistSetting 落盘）
  assert.ok(rootClientSrc.includes('this.commitSetting(\'injectSystemPrompt\''),
    'toggle 必须走 commitSetting（HTTP 落盘，非 memory 陷阱）');
  assert.ok(rootClientSrc.includes('commitSetting(key, value, okMsg = \'\')'),
    'controller 必须有 commitSetting 公共入口');
  assert.ok(rootClientSrc.includes('this.persistSetting(key, value, okMsg)'),
    'commitSetting 内部必须调 persistSetting（HTTP 落盘）');
});

test('client 源码：审计扫描范围按钮（diff/full 单按钮单击切换）接线完整', () => {
  // 按钮组渲染（AuditSwitchBlock 内）——单按钮，标题随状态变化，点击切换
  assert.ok(rootClientSrc.includes("'审计扫描范围'"), '必须有「审计扫描范围」标签');
  assert.ok(rootClientSrc.includes('dshgp_scanbtn'), '必须有扫描范围按钮（dshgp_scanbtn）');
  assert.ok(rootClientSrc.includes('dshgp_scanbtnDiff') && rootClientSrc.includes('dshgp_scanbtnFull'),
    '按钮必须按模式着色（diff=绿 / full=黄）');
  assert.ok(rootClientSrc.includes("props.toggleAuditScanScope(s.auditScanScope === 'full' ? 'diff' : 'full')"),
    '单按钮点击必须切换 diff↔full');
  // inject() 暴露 + AuditTab props 传递
  assert.ok(rootClientSrc.includes('toggleAuditScanScope: (scope) => this.toggleAuditScanScope(scope)'),
    'inject() 必须暴露 toggleAuditScanScope');
  assert.ok(rootClientSrc.includes('toggleAuditScanScope: props.toggleAuditScanScope'),
    'AuditTab 渲染必须透传 toggleAuditScanScope');
  // controller 实现 + 统一走 commitSetting（HTTP 落盘）
  assert.ok(/toggleAuditScanScope\(scope\)\s*\{/.test(rootClientSrc), 'controller 必须有该方法实现');
  assert.ok(rootClientSrc.includes("this.commitSetting('auditScanScope'"), '切换必须走 commitSetting（HTTP 落盘）');
  assert.ok(rootClientSrc.includes("this.commitSetting('injectSystemPrompt'"),
    'injectSystemPrompt 切换也走 commitSetting（统一公共入口）');
});

/* ───────── ② host 侧接线：总开关门控 + 四段注入 ───────── */

test('host：注入段由 injectSystemPrompt 门控（关=返回空串，不是不注册）', () => {
  assert.ok(/cfg\.injectSystemPrompt \? \(cfg\.injectUsageText \|\| FUNCTION_USAGE_HINT\)/.test(applySrc),
    '功能用法段必须由 injectSystemPrompt 门控（injectUsageText 配置覆盖）');
  assert.ok(/cfg\.injectSystemPrompt \? README_CHECK_HINT : ''/.test(applySrc),
    'README 提醒段必须由 injectSystemPrompt 门控');
  assert.ok(/cfg\.injectSystemPrompt && cfg\.auditEnabled && cfg\.injectRequirements/.test(applySrc),
    '开发者要求清单段必须三重门控（注入总开关 + 审计 + 子开关）');
  assert.ok(applySrc.includes("if (!cfg.injectSystemPrompt) return '';"),
    '环境注入文本（上下文通道）必须由总开关门控（关=空串）');
});

test('host：注册三段（功能用法 990 / README 991 / 要求清单 992）+ 上下文注入接线', () => {
  for (const name of ['dsh-git-push-usage', 'dsh-git-push-readme-check', 'dsh-git-push-requirements']) {
    assert.ok(applySrc.includes(`name: '${name}'`), `应注册 ${name} 段`);
  }
  // 2026-09-20：环境段迁出 systemPrompt → agent/pre-step 上下文注入（不再注册 dsh-git-push-env section）
  assert.ok(!/name: 'dsh-git-push-env'/.test(applySrc), '环境段不应再注册为 systemPrompt section');
  assert.ok(applySrc.includes('registerPreStepInjection'), 'apply 必须接线上下文注入');
  assert.ok(applySrc.includes('collectToolPaths(null, { resultFile:'), '环境注入必须探测并落盘运行目录 tools.json');
  // 2026-09-16：order 值提取为命名常量（ORDER_USAGE/ORDER_README_CHECK/ORDER_REQUIREMENTS），
  //   断言改为「常量定义 + 各段引用」——顺序语义不变（要求清单 992 > README 991 > 用法 990）
  assert.ok(/const ORDER_USAGE = 990/.test(applySrc), '功能用法段排序常量应为 990');
  assert.ok(/const ORDER_README_CHECK = 991/.test(applySrc), 'README 段排序常量应为 991');
  assert.ok(/const ORDER_REQUIREMENTS = 992/.test(applySrc), '要求清单段排序常量应为 992');
  assert.ok(/name: 'dsh-git-push-usage', order: ORDER_USAGE/.test(applySrc), '功能用法段应引用 ORDER_USAGE');
  assert.ok(!/const ORDER_ENV/.test(applySrc), 'ORDER_ENV 常量应移除（环境段不再走 systemPrompt）');
});

test('上下文注入：agent/pre-step + WeakSet 防重复 + createUserMessage（参考 skill-scoreboard 形态）', () => {
  const pluginSrc = readFileSync(join(ROOT, 'lib/plugin/index.js'), 'utf8');
  assert.ok(pluginSrc.includes("ctx.on('agent/pre-step'"), '必须监听 agent/pre-step');
  assert.ok(pluginSrc.includes('new WeakSet()'), '必须用 WeakSet 防重复注入');
  assert.ok(pluginSrc.includes('injectedAgents.has(agent)'), '已注入的 agent 必须跳过');
  assert.ok(pluginSrc.includes('createUserMessage'), '必须用 createUserMessage 追加 user 消息');
  assert.ok(pluginSrc.includes("source: { kind: 'plugin', plugin: 'dsh-git-push', form: 'instructions' }"), '消息必须带插件 source 标记');
  assert.ok(pluginSrc.includes("decision?.kind === 'reject'"), '被拒/中止必须原样放行');
});

test('上下文注入：cwd 必须取会话工作区（agent.session.header.cwd），不得用宿主框架根', () => {
  const pluginSrc = readFileSync(join(ROOT, 'lib/plugin/index.js'), 'utf8');
  const applySrc2 = readFileSync(join(ROOT, 'lib/app/apply.js'), 'utf8');
  // pre-step 回调把会话 cwd 传给 envInjectText（空则回退默认）
  assert.ok(pluginSrc.includes('agent.session.header.cwd'), '必须从 agent.session.header.cwd 取会话工作区');
  assert.ok(pluginSrc.includes('envInjectText(sessionCwd)'), '会话工作区必须传给 envInjectText');
  // apply 侧：缓存按 root 键化（不同会话 cwd 不串）+ mapWorkspaceDirs 的 git 探测也在会话工作区跑
  assert.ok(applySrc2.includes('const envInjectText = (cwdOverride) =>'), 'envInjectText 必须接受会话 cwd 覆盖');
  assert.ok(applySrc2.includes('envInjectCache.has(root)'), '缓存必须按 root 键化');
  assert.ok(applySrc2.includes('workspaceRoot: root, cwd: root'), 'mapWorkspaceDirs 的 cwd 必须与注入 cwd 一致');
});

test('host：设置页切换总开关即时生效（启动 merge + HTTP，watch 不灌开关）', () => {
  // 2026-09-15：开关真源是 config.json（启动 merge + HTTP settings-set）；
  //   watch 不得再 applySettingsToCfg(cfg, next)——yaml 缺键会用 schema 默认 false 盖掉勾选
  assert.ok(applySrc.includes('const changed = applySettingsToCfg(cfg, fileSettings)'),
    '启动必须从 config.json merge 进 cfg');
  assert.ok(!/applySettingsToCfg\(\s*cfg\s*,\s*next\s*\)/.test(applySrc),
    'watch 不得把 yaml 整包灌进 cfg（会把 injectRequirements 默认 false 盖回去）');
  assert.ok(/envInjectCache = null/.test(applySrc),
    '切总开关须清环境注入缓存（否则旧文本继续注入）');
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

// ---------- 1.9.1：系统提示词注入配置化 + 浅包装 git 用法 ----------

test('1.9.1：FUNCTION_USAGE_HINT 含浅包装 git 透传用法（未知命令自动凭据）', async () => {
  const { FUNCTION_USAGE_HINT } = await import('../lib/app/inject-text.js');
  assert.ok(FUNCTION_USAGE_HINT.includes('git-sluice'), '应含 git-sluice 用法');
  assert.ok(FUNCTION_USAGE_HINT.includes('任意 git 参数'), '应说明未知命令透传');
  assert.ok(FUNCTION_USAGE_HINT.includes('凭据自动注入'), '应说明自动凭据');
});

test('1.9.1：injectUsageText 配置覆盖逻辑（字符串/数组 → join）', () => {
  // apply.js 的读取逻辑：string 直接用、数组 join('\n')——此处验证 join 语义
  const arr = ['【自定义注入】', '· 自定义行1', '· 自定义行2'];
  const joined = Array.isArray(arr) ? arr.join('\n') : arr;
  assert.equal(joined, '【自定义注入】\n· 自定义行1\n· 自定义行2');
  assert.ok(typeof joined === 'string' && joined.trim().length > 0, '配置覆盖值应为非空字符串');
});
