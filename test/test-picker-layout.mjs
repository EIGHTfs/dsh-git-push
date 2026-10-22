/**
 * 目录选择器（PathPicker）布局回归。
 *
 * 现象（2026-10-23 用户截图报告）：目录条目多时弹窗被**撑穿**——列表从「⬆ 上级目录」
 *   下面一直延伸到屏幕外，「选择当前目录」按钮被挤到屏幕最下方，无法操作。
 *
 * 根因（CSS flex 经典坑）：`.dshgp_browselist` 与 `.dshgp_browsedialog` 都是
 *   **flex 子项**，而 flex 子项的 `min-height` 默认是 `auto`（不小于内容高度）。
 *   于是：`max-height:38vh` 只想封顶，`min-height:auto` 却在保底——73 条目录
 *   （约 1752px）把 list 顶到内容高度，dialog 的 `max-height:70vh` 同样被顶破，
 *   `overflow-y:auto` 完全失效（容器压根没被约束，无从滚动）。
 *   纯按 max-height 手算会算出「342px + 滚动条」的正常结果，与截图不符——差别就在
 *   min-height:auto 这一行默认值。
 *
 * 修法：显式 `min-height:0`，让 max-height 真正说话；另配 overscroll-behavior
 *   防滚动链穿透，面包屑改单行省略号（长路径不再挤占高度），并加单层条数上限。
 *
 * 本文件把这三件事锁死，防回归。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 分片文件名不带数字序号（顺序唯一权威 = scripts/build-client.mjs 的 PART_ORDER）
const cssSrc = readFileSync(join(ROOT, 'lib/client-parts/const.js'), 'utf8');
const pickerSrc = readFileSync(join(ROOT, 'lib/client-parts/browser.js'), 'utf8');

/** 从 CSS 源码里取某条规则的声明体（.{cls}{...} → {...} 内容）。 */
function ruleBody(cls) {
  const m = cssSrc.match(new RegExp('\\.' + cls + '\\{([^}]*)\\}'));
  return m ? m[1] : '';
}

test('browselist 必须显式 min-height:0（flex 子项默认 auto 会顶破 max-height）', () => {
  const body = ruleBody('dshgp_browselist');
  assert.ok(body, '应能找到 .dshgp_browselist 规则');
  // 核心判据：这一行缺失 = 条目多时弹窗被撑穿（本次 bug 的根因）
  assert.ok(/min-height:\s*0(?:px)?[;}]/.test(body), `browselist 必须 min-height:0，实际：${body}`);
  // 封顶与滚动必须都在（否则列表无界增长）
  assert.ok(/max-height:/.test(body), 'browselist 应保留 max-height 封顶');
  assert.ok(/overflow-y:\s*auto/.test(body), 'browselist 应保留 overflow-y:auto');
  // 不该再出现 min-height:120px 这类正值（那正是把容器撑高的旧值）
  assert.ok(!/min-height:\s*(?:[1-9]\d{2,})px/.test(body), `browselist 不应有大的 min-height，实际：${body}`);
});

test('browsedialog 同样必须 min-height:0（它是 mask flex 容器的子项）', () => {
  const body = ruleBody('dshgp_browsedialog');
  assert.ok(body, '应能找到 .dshgp_browsedialog 规则');
  assert.ok(/min-height:\s*0(?:px)?[;}]/.test(body), `dialog 必须 min-height:0，实际：${body}`);
  assert.ok(/max-height:/.test(body), 'dialog 应保留 max-height');
  // flex 列布局是「头/路径/上级/列表/底部」结构的前提
  assert.ok(/flex-direction:\s*column/.test(body), 'dialog 应为纵向 flex');
});

test('browsepath 单行省略号（长路径不挤占弹窗高度）', () => {
  const body = ruleBody('dshgp_browsepath');
  assert.ok(body, '应能找到 .dshgp_browsepath 规则');
  assert.ok(/white-space:\s*nowrap/.test(body), '路径应单行不换行');
  assert.ok(/text-overflow:\s*ellipsis/.test(body), '路径应省略号截断');
  assert.ok(!/word-break:\s*break-all/.test(body), `路径不应 break-all（会占多行高度），实际：${body}`);
  assert.ok(/flex-shrink:\s*0/.test(body), '路径区不应被压缩');
});

test('browselist 防滚动链穿透（overscroll-behavior:contain）', () => {
  const body = ruleBody('dshgp_browselist');
  assert.ok(/overscroll-behavior:\s*contain/.test(body), `list 应 overscroll-behavior:contain，实际：${body}`);
});

test('单层目录条数有上限（防 node_modules 等深目录卡死弹窗）', () => {
  assert.ok(/dshgp_BROWSE_MAX_DIRS\s*=/.test(pickerSrc), '应定义 dshgp_BROWSE_MAX_DIRS');
  const m = pickerSrc.match(/dshgp_BROWSE_MAX_DIRS\s*=\s*(\d+)/);
  assert.ok(m, '应能解析出上限数值');
  const n = Number(m[1]);
  assert.ok(n >= 50 && n <= 1000, `上限应合理（50~1000），实际 ${n}`);
  // 截断后必须明示剩余数量（否则用户不知道还有目录没显示）
  assert.ok(/另有/.test(pickerSrc), '截断时应提示「另有 N 个目录未显示」');
  assert.ok(/\.slice\(0,\s*dshgp_BROWSE_MAX_DIRS\)/.test(pickerSrc), '应按上限 slice');
});

test('目录名渲染做了 XSS 转义（< 和 > 都要转）', () => {
  // 旧代码只转了 <，目录名含 > 时可注入属性/文本。
  // 注意：这里用字符串 includes 而非正则——正则字面量里的 `/</g` 会被 JS 提前当成结束符。
  assert.ok(pickerSrc.includes(".replace(/</g, '&lt;')"), '目录名应转义 <');
  assert.ok(pickerSrc.includes(".replace(/>/g, '&gt;')"), '目录名应转义 >');
  assert.ok(pickerSrc.includes(".replace(/\"/g, '&quot;')"), 'data-path 应转义双引号');
});

test('面包屑超长路径有 title 提示（hover 看全量）', () => {
  assert.ok(/crumb\.title\s*=/.test(pickerSrc), 'crumb 应设 title（截断后仍可看全路径）');
});
