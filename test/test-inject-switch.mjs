/**
 * 1.1.5 交互回归：审计页「注入开发者要求清单」子开关。
 *
 * 原行为（交互缺陷）：父开关「提交前自动审计」关闭时，子开关
 *   ①渲染带 `disabled` → 点不动；②toggleInjectRequirements 里 `if (!auditEnabled) return` → 点了没反应。
 *   结果是「要先点一遍父开关、再点一遍子开关」＝两遍，且关父开关时还会把子开关的勾选静默清掉。
 * 现行为：子开关随时可勾选（一遍）、父关时只置灰（dshgp_subswitchOff）表示暂不生效、
 *   勾选保留；实际是否注入仍由 host 侧 `cfg.auditEnabled && cfg.injectRequirements` 门控。
 *
 * 做法：mock 最小 React + 宿主环境，渲染真实 client.js 的审计页，直接读渲染出的 input props。
 *   实测要点：tab 初值是 'account'，需把它改成 'audit' 才会渲染审计页；
 *   jsx-runtime 的 children 落在 props.children 上。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rootClientSrc = readFileSync(join(ROOT, 'client.js'), 'utf8');
const LABEL = '注入开发者要求清单到系统提示词';

/**
 * 渲染审计页，返回该页所有 input 的 props。
 * @param {object} value settings 快照值（决定父/子开关初态）
 */
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
    // tab 初值 'account' → 'audit'，否则渲染的是账号页、取不到审计页开关
    useState: (init) => [init === 'account' ? 'audit' : (typeof init === 'function' ? init() : init), () => {}],
    useEffect: () => {},
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  };
  const req = (name) => {
    if (name === 'react') return reactMock;
    if (name === 'react/jsx-runtime') return { jsx: reactMock.createElement, jsxs: reactMock.createElement };
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconChevronDownOutline14: 'icon-mock' };
    if (name === '@deepseek-ai/dsh-client-store') return {
      // 真 store：set 必须更新当前值，否则 controller.publish() 后快照不前进，
      //   渲染层读到的永远是构造时的初始 state（本测试曾因此误判 checked 不回显）。
      createSnapshotStore: (initial) => {
        let cur = initial;
        return { getSnapshot: () => cur, set: (v) => { cur = v; }, subscribe: () => () => {} };
      },
    };
    throw new Error('require: ' + name);
  };
  new Function('require', 'window', rootClientSrc)(req, globalThis.window);
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

const findChild = (inputs) => inputs.find((p) => p['aria-label'] === LABEL);

test('父开关关闭：子开关不置灰禁用（一遍即可勾选）', () => {
  const inputs = renderAuditInputs({ auditEnabled: false, injectRequirements: false });
  const child = findChild(inputs);
  assert.ok(child, '审计页应有注入要求子开关');
  assert.notEqual(child.disabled, true,
    '父开关关闭时不得 disabled——否则用户点不动，必须先点父开关再点它（两遍）');
  assert.equal(typeof child.onChange, 'function', '子开关必须可响应点击');
});

test('父开关关闭但子开关已勾选：勾选如实回显（不因父关而丢）', () => {
  const child = findChild(renderAuditInputs({ auditEnabled: false, injectRequirements: true }));
  assert.equal(child.checked, true, '已勾选状态必须回显（勾选保留，与父开关无关）');
});

test('父开关开启：子开关可点、勾选如实回显', () => {
  const child = findChild(renderAuditInputs({ auditEnabled: true, injectRequirements: true }));
  assert.equal(child.checked, true);
  assert.notEqual(child.disabled, true);
});

test('父开关关闭：提示语说明「已勾选但暂不生效」', () => {
  const inputs = renderAuditInputs({ auditEnabled: false, injectRequirements: true });
  const child = findChild(inputs);
  assert.ok(String(child.title || '').includes('暂不生效'), 'title 应提示已勾选但暂不生效');
});

test('源码防退化：子开关不再早退、关父开关不再清空勾选', () => {
  assert.ok(!/toggleInjectRequirements\(checked\)\s*\{\s*if \(!this\.auditEnabled\) return/.test(rootClientSrc),
    'toggleInjectRequirements 不得再因父开关关闭而直接 return（点了没反应＝要按两遍）');
  assert.ok(!/if \(!this\.auditEnabled && this\.injectRequirements\)/.test(rootClientSrc),
    'toggleAudit 不得再把子开关勾选静默清成 false');
  assert.ok(rootClientSrc.includes('dshgp_subswitchOff'), '父关闭时应只置灰（整行变灰类名）');
});

test('host 侧仍按父开关门控：父关时勾选了也不会真的注入', () => {
  const applySrc = readFileSync(join(ROOT, 'lib/app/apply.js'), 'utf8');
  assert.ok(/cfg\.auditEnabled && cfg\.injectRequirements \?/.test(applySrc),
    '注入文本必须由 auditEnabled && injectRequirements 双条件门控——UI 允许勾选，但父关时不注入');
});
