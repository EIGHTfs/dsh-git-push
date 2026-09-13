/**
 * 1.1.7 渲染回归：规则包列表的统计数字不得因 scope 发布被清空。
 *
 * 原缺陷：客户端在 settings scope 订阅回调里写
 *   `this.slotMeta = snap.value.ruleSlotMeta ... : {}`
 * 而 `ruleSlotMeta` 在 schema 里被声明为「host 启动填充，只读」，**宿主侧从未写入**——
 * 于是每次 scope 发布（保存设置、切换开关等都会触发）都把它（空对象）赋给 slotMeta，
 * 刚由 loadSlots() 拉到的真实统计与显示名被整体清空：规则包名退化成原始槽位名
 * （nodejs / comment / npm…），三个统计数字全部回退到 {0,0,0} 兜底值。
 *
 * 复现要点：覆盖发生在 loadSlots() 之后的某次 scope 发布上，所以测试必须在数据到位后
 *   手动调用一次订阅回调——只在挂载时渲染的话看不到该缺陷（这也是它此前没被发现的原因）。
 *
 * 做法：mock 最小 React + 宿主环境，渲染真实 client.js 的审计页，读渲染出的统计数字。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = readFileSync(join(ROOT, 'client.js'), 'utf8');

/** /rule-slots 的假返回：统计数字刻意取非 0，便于断言「有没有被清空」。 */
const SLOT_META = {
  nodejs: { name: 'Node.js 通用', author: 'EIGHTfs', stats: { blocker: 12, warning: 40, pass: 300, total: 352, source: 'audit' } },
  comment: { name: '代码禁沟通词', author: 'EIGHTfs', stats: { blocker: 3, warning: 5, pass: 0, total: 8, source: 'audit' } },
  private: { name: '私密文件', author: 'EIGHTfs', stats: { blocker: 1, warning: 2, pass: 0, total: 3, source: 'rules' } },
};
const SLOT_ORDER = ['nodejs', 'comment', 'private'];

/**
 * 渲染审计页的规则包列表，返回每行的 {name, nums}。
 * @param {object} value settings 快照值（本用例刻意不含 ruleSlotMeta——与真实宿主一致）
 * @param {boolean} publishAfterLoad 数据到位后是否再触发一次 scope 发布（复现覆盖的关键一步）
 */
async function renderRuleRows(value, { publishAfterLoad = false } = {}) {
  let captured = null;
  const prevWindow = globalThis.window;
  const prevFetch = globalThis.fetch;
  globalThis.window = { __ModuleLoader__: { load: ({ id, factory }) => { captured = { id, factory }; } } };

  const reactMock = {
    createElement: (type, props, ...kids) => {
      const p = Object.assign({}, props || {});
      if (kids.length) p.children = kids.length === 1 ? kids[0] : kids;
      return { type, props: p };
    },
    // tab 初值 'account' → 'audit'，否则渲染账号页、规则包列表不出现
    useState: (init) => [init === 'account' ? 'audit' : (typeof init === 'function' ? init() : init), () => {}],
    useEffect: () => {},
    // useSyncExternalStore 必须真的订阅，便于触发重渲染
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
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, slots: { order: SLOT_ORDER.slice(), meta: SLOT_META, forced: ['private'] } }),
  });

  new Function('require', 'window', clientSrc)(req, globalThis.window);
  globalThis.window = prevWindow;

  const subs = [];
  const scopeMock = {
    getSnapshot: () => ({ status: 'ready', writable: true, value }),
    subscribe: (cb) => { subs.push(cb); return () => {}; },
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

  try {
    const mod = captured.factory(req);
    mod.apply(ctx);
    assert.ok(renderSection, 'settings.section 应注册');
    // 等 loadSlots() 的 fetch 落定 + 状态发布
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // 关键一步：数据到位后再发布一次（真实宿主保存设置/切开关即如此）
    if (publishAfterLoad) for (const f of subs) f();

    const rows = [];
    const walk = (node, depth = 0) => {
      if (node === null || node === undefined || depth > 40) return;
      if (Array.isArray(node)) { node.forEach((c) => walk(c, depth)); return; }
      if (typeof node !== 'object') return;
      let n = node;
      for (let g = 0; n && typeof n === 'object' && typeof n.type === 'function' && g < 25; g += 1) {
        n = n.type(n.props || {});
      }
      if (!n || typeof n !== 'object') return;
      if (typeof n.props?.className === 'string' && n.props.className.includes('dshgp_rulename')) {
        rows.push({ name: String(n.props.children), nums: null });
      }
      if (typeof n.props?.className === 'string' && /dshgp_rulecount(Red|Yellow|Green)/.test(n.props.className)) {
        if (rows.length && rows[rows.length - 1].nums === null) rows[rows.length - 1].nums = [];
        if (rows.length) rows[rows.length - 1].nums.push(String(n.props.children));
      }
      walk(n.props && n.props.children, depth + 1);
    };
    walk(renderSection());
    return rows;
  } finally {
    globalThis.fetch = prevFetch;
  }
}

test('规则包列表：scope 发布后统计数字不被清空（loadSlots 为权威源）', async () => {
  // 快照刻意不含 ruleSlotMeta——与真实宿主一致（schema 声明该字段由 host 填充，实际从未写入）
  const rows = await renderRuleRows({ auditEnabled: true }, { publishAfterLoad: true });
  assert.ok(rows.length > 0, '审计页应渲染出规则包列表');
  const nodejs = rows.find((r) => r.name === 'Node.js 通用');
  assert.ok(nodejs, `应显示规则包显示名而非原始槽位名，实际: ${rows.map((r) => r.name).join(' / ')}`);
  assert.deepEqual(nodejs.nums, ['12', '40', '300'], '统计数字应为真实值（被清空时是 0/0/0）');
  const anyNonZero = rows.some((r) => (r.nums || []).some((n) => n !== '0'));
  assert.ok(anyNonZero, '不得所有行统计都是 0');
});

test('规则包列表：显示名来自后端 meta，不是退回原始槽位名', async () => {
  const rows = await renderRuleRows({ auditEnabled: true }, { publishAfterLoad: true });
  const names = rows.map((r) => r.name);
  assert.ok(names.includes('Node.js 通用'), '应用后端 meta.name');
  assert.ok(names.includes('代码禁沟通词'), '应用后端 meta.name');
  assert.ok(!names.includes('comment'), '不得退回原始槽位名 comment');
  assert.ok(!names.includes('nodejs'), '不得退回原始槽位名 nodejs');
});

test('源码：slotMeta 不得由 scope 快照覆盖（与 ruleOrder 同规则）', () => {
  // 该字段从未被宿主写入，任何「从 scope 取值覆盖 slotMeta」的写法都会把已拉到的数据清空
  const bad = /this\.slotMeta\s*=\s*\(?\s*snap\d?\.value\.ruleSlotMeta/;
  assert.ok(!bad.test(clientSrc), 'client.js 不得用 snap.value.ruleSlotMeta 覆盖 slotMeta');
  assert.ok(!/ruleSlotMeta/.test(clientSrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')),
    'client.js 代码中不应再出现 ruleSlotMeta（仅在说明注释里可以提及）');
  // 权威来源必须是 loadSlots
  assert.ok(/this\.slotMeta = meta;/.test(clientSrc), 'loadSlots 应把后端 meta 写入 slotMeta');
});

test('schema：不再保留无人读写的死字段 ruleSlotMeta', () => {
  const schema = readFileSync(join(ROOT, 'lib/app/schema.js'), 'utf8');
  assert.ok(!/^\s*ruleSlotMeta:/m.test(schema),
    'schema.js 不应再有 ruleSlotMeta 字段（宿主从未填充、客户端已改为不读）');
});

test('预览页：槽位数据取自真实规则文件，不得与真实实例脱节', async () => {
  // 手写槽位清单曾只写 6 个 → 预览里只显示 6 个槽位，被误当成「只显示 6 个」的回归。
  //   这里比对生成的 preview.html 与真实 listRuleSlots() 结果，锁死两者一致。
  const { listRuleSlots } = await import('../lib/app/http-handlers.js');
  const real = listRuleSlots(undefined, [], null);
  const realOrder = real.order.filter((s) => s !== 'template');

  const html = readFileSync(join(ROOT, 'assets/preview.html'), 'utf8');
  const metaMatch = html.match(/window\.__SLOTS__ = (\{.*?\});/s);
  const fakeMatch = html.match(/window\.__FAKE__ = (\{.*?\});/s);
  assert.ok(metaMatch, 'preview.html 应包含 __SLOTS__ 假数据');
  assert.ok(fakeMatch, 'preview.html 应包含 __FAKE__ 快照假数据');
  const previewMeta = JSON.parse(metaMatch[1]);
  const previewOrder = JSON.parse(fakeMatch[1])._order || [];

  assert.deepEqual(previewOrder, realOrder, '预览的槽位顺序应与真实生效顺序一致');
  assert.deepEqual(Object.keys(previewMeta).sort(), Object.keys(real.meta).sort(),
    '预览的槽位集合应与真实一致');
  for (const slot of realOrder) {
    assert.equal(previewMeta[slot]?.name, real.meta[slot]?.name, `${slot} 的显示名应与真实一致`);
  }
});
