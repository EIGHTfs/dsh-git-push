/**
 * 检查层 · 按钮事件绑定交叉比对
 *
 * 职责：HTML 里的按钮/选择器与 JS 里的事件绑定交叉比对，识别「声明了但没绑定」等缺陷。
 */

import { join } from 'node:path';

import { makeFinding } from '../audit/index.js';
import { HINT_QUALITY } from './common.js';

/* ═══════════════ 按钮事件绑定检查（button-bind，2026-09-11 油猴脚本版） ═══════════════ */

/**
 * 油猴脚本/浏览器扩展按钮事件绑定交叉比对（同文件内）。
 * 场景：HTML 以字符串形式内嵌在 JS（innerHTML=/insertAdjacentHTML/模板字符串/createElement），
 * 事件在 JS 里用 addEventListener/onclick= 赋值绑定——不能只看 HTML 里有没有 inline onclick。
 *
 * 三步：
 *   1. 从 JS 文本提取「HTML 字符串中的按钮」（inline onclick 降级 info 不计为绑定证据）
 *   2. 从同一文本提取「绑定证据」：addEventListener('click' / .onclick= 赋值 / 自定义 on* 函数调用 pattern
 *   3. 交叉比对：按钮 id/class/text 能在绑定证据中找到 → 已绑定；找不到 → unbound warning
 *
 * 只报 warning 不阻断（手工确认绑定方式），inline onclick 场景报 info 建议。
 * 输入规则约定（yml 声明 kind: button-bind，或 category: 'button' 无 patterns）：
 *   - rule.extra.buttonInsertPatterns / bindPatterns 可选覆盖（默认内置油猴常用模式）
 * @param {object} opts { file, text, rules }
 * @returns {Array} findings
 */
export function checkButtonBindings({ file, text, rules }) {
  const findings = [];
  if (!text) return findings;

  const btns = [];
  const binds = new Set();
  let hasDelegation = false;

  // ── 1. 提取 HTML 字符串中的按钮 ──
  // innerHTML='...' 或 innerHTML="..."（含模板字符串反引号）
  const htmlChunks = [];
  const chunkRe = /(?:innerHTML|outerHTML|insertAdjacentHTML\s*\([^)]*\))\s*=\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
  let match;
  while ((match = chunkRe.exec(text)) !== null) {
    htmlChunks.push({ html: match[1], start: match.index });
  }
  // 模板字符串里的 <button ...>...</button>（不局限于 innerHTML 赋值）
  const tplChunks = [];
  const tplRe = /`[^`]*<button[^`]*`/g;
  while ((match = tplRe.exec(text)) !== null) tplChunks.push({ html: match[0], start: match.index });

  const btnRe = /<button\b([^>]*)>([\s\S]*?)<\/button\s*>|<input\b[^>]*type\s*=\s*['"](?:button|submit)['"][^>]*>/gi;
  // JSX/React 事件属性（onClick=/onChange= 等驼峰 on[A-Z]）→ 声明式绑定，视为已绑定（防 React 代码误报 unbound）
  const jsxEventRe = /\bon[A-Z][\w]*\s*=\s*[\{'"`]/;
  for (const chunk of htmlChunks.concat(tplChunks)) {
    let bm;
    while ((bm = btnRe.exec(chunk.html)) !== null) {
      const attrs = bm[1] || '';
      const line = text.slice(0, chunk.start + bm.index).split('\n').length;
      btns.push({
        line,
        id: (attrs.match(/\bid=["']([^"']+)["']/i) || [])[1] || '',
        class: (attrs.match(/\bclass=["']([^"']+)["']/i) || [])[1] || '',
        text: (bm[2] || '').replace(/<[^>]*>/g, '').trim().slice(0, 30),
        hasInline: /\bonclick\s*=/.test(attrs),
        jsxBound: jsxEventRe.test(attrs), // React 声明式事件（onClick 等驼峰）
      });
    }
  }
  // createElement('button') 创建的按钮：后续调用 addEventListener 才算绑定
  const created = [];
  const createRe = /createElement\s*\(\s*['"](button|input)['"]\s*\)/g;
  while ((match = createRe.exec(text)) !== null) {
    created.push({ line: text.slice(0, match.index).split('\n').length, tag: match[1] });
  }

  // ── 2. 提取绑定证据（选择器引用 + 绑定调用 + 事件委托）──
  // 覆盖：getElementById / querySelector / querySelectorAll（含属性选择器）/ jQuery $() / .onclick= / .addEventListener('click'
  const bindRe = /(?:getElementById\s*\(\s*['"]([^'"]+)['"]|querySelector(?:All)?\s*\(\s*['"]([^'"]+)['"]|\$\s*\(\s*['"]([^'"]+)['"]|\.addEventListener\s*\(\s*['"]click['"]|\.onclick\s*=|\.on\s*\(\s*['"\]click['"])/g;
  while ((match = bindRe.exec(text)) !== null) {
    for (const sel of [match[1], match[2], match[3]]) {
      if (sel) binds.add(sel);
      if (sel && sel.startsWith('#')) binds.add(sel.slice(1)); // #id 同时存 id
      if (sel && sel.startsWith('.')) binds.add(sel); // .class 已存；供 class 匹配
    }
    if (match[0].includes('addEventListener') || match[0].includes('.onclick') || match[0].includes('.on(')) binds.add('__has_click_handler__');
  }
  // 事件委托识别（更宽）：父级 .addEventListener('click' + e.target.closest('选择器') 任一出现即视为委托面
  // 覆盖：document.body.addEventListener('click' / container.addEventListener('click' / ev.target.closest('.btn') 分发
  const delegationRe = /\.addEventListener\s*\(\s*['"]click['"]|\.closest\s*\(\s*['"][^'"]+['"]\)/g;
  if (delegationRe.test(text)) hasDelegation = true;
  // 委托分发选择器（ev.target.closest('.mm-retry-btn')）也入 binds——按 class 匹配绑定面
  const closestRe = /\.closest\s*\(\s*['"]([^'"]+)['"]\)/g;
  while ((match = closestRe.exec(text)) !== null) {
    if (match[1]) binds.add(match[1]);
    if (match[1] && match[1].startsWith('#')) binds.add(match[1].slice(1));
  }
  // 属性选择器引用（querySelectorAll("button[data-dl]")）→ 按钮 data-* 匹配用
  const attrSelRe = /querySelector(?:All)?\s*\(\s*['"]([^'"]*(?:\[[a-z-]+\][^'"]*)?)['"]\)/g;
  while ((match = attrSelRe.exec(text)) !== null) {
    const ms = match[1]?.match(/\[([a-z][\w-]*)\]/g) || [];
    for (const at of ms) binds.add(at); // [data-dl] 等原样存入
  }

  // ── 3. 交叉比对 ──
  for (const btn of btns) {
    // JSX/React 声明式事件：onClick 等驼峰属性 = 已绑定（React 虚拟 DOM 内声明式，非油猴场景）
    if (btn.jsxBound) continue;
    // inline onclick：有绑定但建议改（info）
    if (btn.hasInline) {
      findings.push(makeFinding({
        file, line: btn.line, rule: 'button/inline-binding-in-string', kind: 'button-bind',
        severity: 'notice',
        message: `油猴脚本 HTML 字符串中的按钮含 inline onclick（行 ${btn.line}）：通常无法访问闭包作用域且易违反 CSP，建议改 addEventListener/事件委托`,
        dimensions: ['可读性'], exemptHint: HINT_QUALITY, scoreImpact: 0,
      }));
      continue;
    }
    // 事件委托覆盖：父级监听了 click（含 closest 分发）→ 默认视为已覆盖
    if (hasDelegation) continue;
    let matched = false;
    if (btn.id && (binds.has(btn.id) || binds.has(`#${btn.id}`))) matched = true;
    if (!matched && btn.class) {
      for (const cls of btn.class.split(/\s+/)) {
        if (cls && binds.has(`.${cls}`)) { matched = true; break; }
      }
    }
    if (!matched && created.length) {
      // createElement 按钮：要求同一文件存在 addEventListener/onclick 痕迹
      matched = binds.has('__has_click_handler__');
    }
    if (!matched) {
      findings.push(makeFinding({
        file, line: btn.line, rule: 'button/unbound', kind: 'button-bind',
        severity: 'warning',
        message: `按钮「${btn.text || btn.id || '(无文本)'}」（行 ${btn.line}）在 HTML 字符串中但未在 JS 中找到绑定证据——若通过事件委托/封装函数绑定请加豁免标记`,
        dimensions: ['可维护性'], exemptHint: HINT_QUALITY, scoreImpact: 1,
      }));
    }
  }
  // createElement('button'/'input') 创建的按钮：文件无任何点击绑定痕迹 → 未绑定
  if (created.length && !binds.has('__has_click_handler__')) {
    const lineNos = [...new Set(created.map((c) => c.line))].sort((a, b) => a - b);
    findings.push(makeFinding({
      file, line: lineNos[0], rule: 'button/create-element-binding', kind: 'button-bind',
      severity: 'warning',
      message: `createElement('${created[0].tag}') 创建了按钮（行 ${lineNos.join('/')}）但同文件未找到 addEventListener/onclick 绑定——请在 appendChild 前绑定事件`,
      dimensions: ['可维护性'], exemptHint: HINT_QUALITY, scoreImpact: 1,
    }));
  }
  return findings;
}
