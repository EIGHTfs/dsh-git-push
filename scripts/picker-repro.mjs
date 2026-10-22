/**
 * 目录选择器布局自检页生成器（无依赖、离线）。
 *
 * 为什么需要：选择器弹窗的「条目多时被压扁」是**纯布局缺陷**——CSS 文本看着没问题
 *   （`max-height` + `overflow-y:auto` 都在），只有真实渲染才暴露。实测 73 条目录在
 *   1080px 视口下，行高从应有的 27px 被压到 10px、容器根本不滚动，而任何
 *   「断言 CSS 里有某条声明」的单元测试都会通过。
 *
 *   本脚本用**真实 CSS**（直接从 lib/client-parts/const.js 抽取 .dshgp_* 规则）拼一个
 *   最小复现页：只有 mask/dialog/path/up/list/foot 六层与 N 个目录行。
 *   在浏览器里打开即可目测；配合一段测量脚本可拿到行高/可滚动性等硬指标。
 *
 * 用法：
 *   node scripts/picker-repro.mjs                  # 生成 /tmp/dshgp-picker-repro.html（默认 73 条）
 *   node scripts/picker-repro.mjs --count 300      # 指定条目数
 *   node scripts/picker-repro.mjs --out <路径>
 *   node scripts/picker-repro.mjs --serve          # 生成后用本机 http 起服务并打印地址
 *
 * 判读标准（在浏览器控制台跑 MEASURE_SNIPPET）：
 *   rowHeight           应 ≈ 26-28px（12px 字 + 上下 5px padding + 行高）
 *   listScrollable      true（条目超容器时必须能滚，而不是压扁）
 *   footerInViewport    true（「选择当前目录」必须留在视口内）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONST_FILE = join(ROOT, 'lib', 'client-parts', 'const.js');
const DEFAULT_OUT = '/tmp/dshgp-picker-repro.html';
const DEFAULT_COUNT = 73;

/** 从 const.js 抽取全部 .dshgp_* 规则原文（保证自检页与真实样式同源）。 */
export function extractCss(src = readFileSync(CONST_FILE, 'utf8')) {
  return [...src.matchAll(/'\.(dshgp_[a-z0-9_]+)\{([^}]*)\}'/g)]
    .map((m) => `.${m[1]}{${m[2]}}`)
    .join('\n');
}

/** 生成复现页 HTML。 */
export function buildReproHtml({ count = DEFAULT_COUNT, css = extractCss() } = {}) {
  const rows = Array.from({ length: count }, (_, i) => {
    const name = `项目目录-${String(i + 1).padStart(2, '0')}-很长的中文目录名用于测试挤压`;
    return `<div class="dshgp_browsedir" data-path="/x/${name}">📁 ${name}</div>`;
  }).join('');
  // 暗色变量只是为了目测接近真实主题，不参与布局判定
  const vars = ':root{--dsw-alias-border-l4:#444;--dsw-alias-border-l2:#333;'
    + '--dsw-alias-bg-layer-3:#1b1b2a;--dsw-alias-bg-layer-2:#222;--dsw-alias-bg-base:#111;'
    + '--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#aaa;'
    + '--dsw-alias-label-tertiary:#888;--dsw-alias-brand-primary:#7c5cff}';
  return '<!doctype html><meta charset="utf-8"><title>picker repro</title>'
    + `<style>${vars}${css}</style>`
    + '<body style="margin:0;height:100vh;background:#0d0d14">'
    + '<div class="dshgp_browsemask"><div class="dshgp_browsedialog">'
    + '<div class="dshgp_browsehead"><span class="dshgp_browsetitle">选择目录</span>'
    + '<button type="button" class="dshgp_browseclose">✕</button></div>'
    + '<div class="dshgp_browsepath">/volume1/VirtualDSM/DeepSeekHarness/工作区</div>'
    + '<div class="dshgp_browseup">⬆ 上级目录</div>'
    + `<div class="dshgp_browselist" id="list">${rows}</div>`
    + '<div class="dshgp_browsefoot"><button type="button" class="dshgp_keybtn">选择当前目录</button></div>'
    + '</div></div></body>';
}

/** 浏览器控制台测量脚本（返回硬指标 JSON）。 */
export const MEASURE_SNIPPET = `(() => {
  const list = document.getElementById('list');
  const rows = [...list.children];
  const lb = list.getBoundingClientRect();
  const f = rows[0].getBoundingClientRect();
  const foot = document.querySelector('.dshgp_browsefoot').getBoundingClientRect();
  return {
    rows: rows.length,
    rowHeight: Math.round(f.height * 10) / 10,
    rowFlexShrink: getComputedStyle(rows[0]).flexShrink,
    listClientH: list.clientHeight,
    listScrollH: list.scrollHeight,
    listScrollable: list.scrollHeight > list.clientHeight,
    visibleRows: Math.round(lb.height / f.height),
    footerInViewport: foot.bottom <= innerHeight,
  };
})()`;

function argOf(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function main() {
  const count = Number(argOf('--count', String(DEFAULT_COUNT))) || DEFAULT_COUNT;
  const out = argOf('--out', DEFAULT_OUT);
  const html = buildReproHtml({ count });
  writeFileSync(out, html, 'utf8');
  console.log(`✅ 已生成复现页：${out}（${count} 条目录，${html.length} 字节）`);
  console.log('');
  console.log('浏览器打开后，控制台粘贴以下脚本取硬指标：');
  console.log(MEASURE_SNIPPET);
  console.log('');
  console.log('判读：rowHeight≈26-28px · listScrollable=true · footerInViewport=true');
  if (!process.argv.includes('--serve')) return 0;
  const port = Number(argOf('--port', '31399'));
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  server.listen(port, '127.0.0.1', () => console.log(`\n服务已启动：http://127.0.0.1:${port}/（Ctrl+C 结束）`));
  return null; // 挂起，等待手动结束
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = main();
  if (code !== null) process.exitCode = code;
}
