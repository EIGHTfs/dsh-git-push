/**
 * 侧边栏规则包列表交互自检（2026-09-13 交互改版）。
 *
 * 锁定的三条交互契约：
 *   ① 详细信息 = 悬停浮层（.dshgp_hovercard，由 .dshgp_ruleinfo:hover 触发显示），
 *      不再常显 meta 行、不再占用行高；
 *   ② 启用/禁用只由行尾启停按钮（.dshgp_powerBtn）触发——整行不再有切换状态的 onClick，
 *      避免「想看详情/拖选」时误触状态；
 *   ③ 状态底色：启用 = 绿（.dshgp_rowOn），禁用 = 红（.dshgp_rowOff），各带左侧色条。
 *
 * 验证方式：从源码提取真实的 dshgp_RuleRow 函数体，用最小 jsx 替身**实际渲染规则行**，
 * 再对渲染出的节点树断言（DOM 结构级，不是字符串匹配）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const clientSrc = readFileSync(join(ROOT, 'client.js'), 'utf8');

/** 记录式 jsx 替身：返回可遍历节点树。
 * 注意：本仓客户端用 jsx-runtime 风格（jsx(type, props) / jsxs(type, props)），
 * children 在 props.children 里，不是可变参数——替身必须按此形状还原。 */
function makeJsx() {
  const createElement = (type, props) => {
    const kids = props && props.children !== undefined
      ? (Array.isArray(props.children) ? props.children : [props.children])
      : [];
    return { type, props: props || {}, children: kids.flat(Infinity).filter((c) => c !== null && c !== undefined) };
  };
  return { jsx: createElement, jsxs: createElement };
}

/** 从源码按大括号配平提取函数体文本。 */
function extractFunction(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `未找到函数: ${signature}`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('函数体未闭合: ' + signature);
}

/** 渲染一行规则包（真实函数体 + 替身 jsx）。 */
function renderRow({ disabled = false, slot = 'frontend', stats, locked = false } = {}) {
  const fnText = extractFunction(clientSrc, 'function dshgp_RuleRow(props, slot, idx, len) {');
  const jsx = makeJsx();
  // eslint-disable-next-line no-new-func
  const dshgp_RuleRow = new Function('jsx', 'return ' + fnText)(jsx);
  const props = {
    state: {
      slotMeta: {
        [slot]: {
          name: slot === 'nodejs' ? 'Node.js 规则包' : '前端规则包',
          author: 'EIGHTfs',
          description: '针对前端代码的审计规则集',
          disabled: locked ? true : disabled,
          stats: stats || { blocker: 1, warning: 2, pass: 30, total: 33, source: 'audit' },
        },
      },
    },
    toggleDisabled: () => { toggled.push(slot); },
    moveSlot: () => {},
  };
  const toggled = [];
  const tree = dshgp_RuleRow(props, slot, 0, 3);
  return { tree, props, toggled };
}

/** 深度遍历节点树，收集所有节点。 */
function walk(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => walk(n, out)); return out; }
  out.push(node);
  if (node.children) walk(node.children, out);
  return out;
}

const clsOf = (n) => String((n.props && n.props.className) || '');
const findClass = (tree, cls) => walk(tree).find((n) => clsOf(n).includes(cls));

// ────────────────────────── ① 悬停浮层 ──────────────────────────

test('规则行：详细信息在悬停浮层里（不再常显 meta 行）', () => {
  const { tree } = renderRow({});
  const card = findClass(tree, 'dshgp_hovercard');
  assert.ok(card, '行内应有悬停浮层 .dshgp_hovercard');
  // 浮层内含名称/作者/描述/统计口径/状态提示
  const texts = walk(card).map((n) => (typeof n.children?.[0] === 'string' ? n.children[0] : '')).join(' | ');
  assert.ok(texts.includes('EIGHTfs'), '浮层显示作者');
  assert.ok(texts.includes('针对前端代码的审计规则集'), '浮层显示描述');
  // 2026-09-18：浮层口径由「最近一次审计命中」改为「规则条数」——
  //   三列改为 yml 各严重级的规则条数（与是否跑过审计无关）。
  assert.ok(texts.includes('规则条数'), '浮层显示规则条数口径说明');
  assert.ok(!texts.includes('最近一次审计命中'), '不再出现已废弃的命中数口径文案');
  // 常显区不应再有 dshgp_rulemeta（原「作者: xx · 描述」常显行已移入浮层）
  assert.ok(!findClass(tree, 'dshgp_rulemeta'), '常显 meta 行已移除（信息移入浮层）');
});

test('规则行：浮层默认隐藏、仅在悬停信息区时显示（CSS :hover 触发）', () => {
  assert.ok(/\.dshgp_hovercard\{display:none/.test(clientSrc), '浮层默认 display:none');
  assert.ok(/\.dshgp_ruleinfo:hover \.dshgp_hovercard\{display:block\}/.test(clientSrc),
    '悬停 .dshgp_ruleinfo 时浮层 display:block');
  // 触发悬停的容器必须是行内信息区（名称所在处），不是整行
  const { tree } = renderRow({});
  const info = findClass(tree, 'dshgp_ruleinfo');
  assert.ok(info, '行内有 .dshgp_ruleinfo（悬停触发区）');
  assert.ok(findClass(info, 'dshgp_hovercard') === findClass(tree, 'dshgp_hovercard'),
    '浮层挂在信息区内（悬停名称/信息区即显示）');
});

// ────────────────────────── ② 仅按钮可切换 ──────────────────────────

test('规则行：整行无切换 onClick，只有启停按钮能切换状态', () => {
  const { tree, toggled, props } = renderRow({ disabled: false, slot: 'frontend' });
  // 信息区不得带 onClick（原整行点击切换已移除）
  const info = findClass(tree, 'dshgp_ruleinfo');
  assert.ok(info, '有信息区');
  assert.ok(!info.props.onClick, '信息区不得有切换 onClick');
  assert.ok(!clsOf(info).includes('dshgp_rowClickable'), '信息区不得带可点击类');
  // li 本身也不得带 onClick
  assert.equal(tree.type, 'li');
  assert.ok(!tree.props.onClick, '整行 li 不得有切换 onClick');
  // 启停按钮存在且点击真的触发 toggleDisabled
  const power = findClass(tree, 'dshgp_powerBtn');
  assert.ok(power, '有启停按钮');
  assert.equal(power.type, 'button', '启停按钮是 button 元素');
  power.props.onClick({ stopPropagation: () => {} });
  assert.deepEqual(toggled, ['frontend'], '点启停按钮调用 toggleDisabled(slot)');
  void props;
});

test('规则行：↑↓ 调序按钮不冒泡切换状态', () => {
  const { tree, toggled } = renderRow({ slot: 'frontend' });
  const minis = walk(tree).filter((n) => clsOf(n).includes('dshgp_mini'));
  assert.equal(minis.length, 2, '有上移/下移两个按钮');
  let stopped = 0;
  minis.forEach((b) => b.props.onClick({ stopPropagation: () => { stopped++; } }));
  assert.equal(stopped, 2, '↑↓ 点击都 stopPropagation（不冒泡到行）');
  assert.deepEqual(toggled, [], '↑↓ 不触发状态切换');
});

test('规则行：锁定规则包（nodejs/private）启停按钮禁用', () => {
  const { tree } = renderRow({ slot: 'nodejs', locked: true });
  const power = findClass(tree, 'dshgp_powerBtn');
  assert.ok(power, '锁定行仍有启停按钮（可见但不可点）');
  assert.equal(power.props.disabled, true, '锁定行按钮 disabled');
  assert.equal(power.props['aria-pressed'], false, '锁定行 aria-pressed=false（当前禁用态）');
});

// ────────────────────────── ③ 红绿底色 ──────────────────────────

test('规则行：启用 = 绿底+绿左条，禁用 = 红底+红左条（渲染类名 + CSS 配色）', () => {
  const on = renderRow({ disabled: false }).tree;
  const off = renderRow({ disabled: true }).tree;
  assert.ok(clsOf(on).includes('dshgp_rowOn'), '启用行挂 .dshgp_rowOn');
  assert.ok(clsOf(off).includes('dshgp_rowOff'), '禁用行挂 .dshgp_rowOff');
  // CSS：绿/红底 + 左侧色条
  assert.ok(/\.dshgp_rowOn\{background:color-mix\(in srgb,var\(--dsw-alias-label-success\) 13%/.test(clientSrc), '启用行绿底');
  assert.ok(/\.dshgp_rowOff\{background:color-mix\(in srgb,var\(--dsw-alias-label-error\) 15%/.test(clientSrc), '禁用行红底');
  assert.ok(/\.dshgp_rowOn\{[^}]*border-left:3px solid var\(--dsw-alias-label-success\)/.test(clientSrc), '启用行绿色左条');
  assert.ok(/\.dshgp_rowOff\{[^}]*border-left:3px solid var\(--dsw-alias-label-error\)/.test(clientSrc), '禁用行红色左条');
  // 按钮配色：启用态绿、禁用态红
  const onBtn = findClass(on, 'dshgp_powerBtn');
  const offBtn = findClass(off, 'dshgp_powerBtn');
  assert.ok(clsOf(onBtn).includes('dshgp_powerOn'), '启用行按钮挂 .dshgp_powerOn');
  assert.ok(clsOf(offBtn).includes('dshgp_powerOff'), '禁用行按钮挂 .dshgp_powerOff');
  assert.ok(/\.dshgp_powerOn\{background:var\(--dsw-alias-label-success\)/.test(clientSrc), '启用态按钮绿色');
  assert.ok(/\.dshgp_powerOff\{background:var\(--dsw-alias-label-error\)/.test(clientSrc), '禁用态按钮红色');
});

test('规则行：统计三列与状态按钮齐备（名称 + 拦截/警告/通过 + 启停）', () => {
  const { tree } = renderRow({ disabled: false });
  for (const cls of ['dshgp_rulename', 'dshgp_rulecountRed', 'dshgp_rulecountYellow', 'dshgp_rulecountGreen', 'dshgp_rulebadge']) {
    assert.ok(findClass(tree, cls), `行内应有 ${cls}`);
  }
  const name = findClass(tree, 'dshgp_rulename');
  assert.equal(name.children[0], '前端规则包', '行内显示规则包名');
  assert.equal(String(findClass(tree, 'dshgp_rulecountRed').children[0]), '1', '拦截列显示命中数');
  assert.equal(String(findClass(tree, 'dshgp_rulecountYellow').children[0]), '2', '警告列显示命中数');
  assert.equal(String(findClass(tree, 'dshgp_rulecountGreen').children[0]), '30', '通过列显示数');
});
