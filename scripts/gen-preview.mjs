/**
 * preview.html 数据自动生成器（新增——此前 __SLOTS__/__FAKE__ 数据手工维护，
 * 每次新增规则槽位都要手改 33K 行的 JSON 串，漏改即 test-rule-slots-render 失败）。
 *
 * 数据契约：与 test/test-rule-slots-render.mjs 的「预览页：槽位数据取自真实规则文件」
 *   断言一致——preview.html 的 __SLOTS__（槽位 meta）与 __FAKE__._order（槽位顺序）
 *   必须等于真实 listRuleSlots() 的结果。本脚本从同一数据源（lib/app/handlers/meta.js
 *   的 listRuleSlots）生成，保证永远一致。
 *
 * 命令：
 *   node scripts/gen-preview.mjs            # 打印将生成的 __SLOTS__/__FAKE__（不写盘）
 *   node scripts/gen-preview.mjs --write    # 同步 preview.html（替换两段数据）
 *   node scripts/gen-preview.mjs check      # 查漂移：preview.html 与真实数据不一致则报错
 *
 * 什么时候跑：新增/删除/改名规则槽位（audit-rules-*.yml）后跑 --write；
 *   提交前跑 check 防漏（门禁不拦，warning 提示）。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRuleSlots } from '../lib/app/handlers/meta.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PREVIEW = join(ROOT, 'assets', 'preview.html');

/** 从真实规则文件生成槽位数据（与测试同一数据源）。 */
export function buildPreviewSlotData() {
  const real = listRuleSlots(undefined, [], null);
  const realOrder = real.order.filter((s) => s !== 'template');
  const slotsJson = JSON.stringify(real.meta);
  // __FAKE__ 保留原快照字段，只更新 _order（新槽位追加/顺序对齐真实生效顺序）
  const fake = { _order: realOrder };
  return { slotsJson, order: realOrder, fakeJson: JSON.stringify(fake), meta: real.meta, realOrder };
}

/** 读当前 preview.html 里的 __SLOTS__/__FAKE__（供 check 比对）。 */
export function readPreviewSlotData(html = readPreviewHtml()) {
  const metaMatch = html.match(/window\.__SLOTS__ = (\{.*?\});/s);
  const fakeMatch = html.match(/window\.__FAKE__ = (\{.*?\});/s);
  if (!metaMatch || !fakeMatch) return null;
  try {
    return {
      meta: JSON.parse(metaMatch[1]),
      order: JSON.parse(fakeMatch[1])._order || [],
    };
  } catch { return null; }
}

function readPreviewHtml() {
  if (!existsSync(PREVIEW)) return '';
  return readFileSync(PREVIEW, 'utf8');
}

/** 生成（打印）或写盘。 */
export function genPreview({ write = false } = {}) {
  const slotData = buildPreviewSlotData();
  const html = readPreviewHtml();
  if (!html) return { ok: false, error: `preview.html 缺失: ${PREVIEW}` };
  const cur = readPreviewSlotData(html);
  const drift = cur && (JSON.stringify(cur.meta) !== slotData.slotsJson || JSON.stringify(cur.order) !== slotData.fakeJson);
  if (write) {
    const out = html
      .replace(/window\.__SLOTS__ = \{.*?\};/s, 'window.__SLOTS__ = ' + slotData.slotsJson + ';')
      .replace(/window\.__FAKE__ = \{.*?\};/s, 'window.__FAKE__ = ' + slotData.fakeJson + ';');
    writeFileSync(PREVIEW, out, 'utf8');
  }
  return { ok: true, write, drift, order: slotData.realOrder, metaCount: Object.keys(slotData.meta).length };
}

/** check：preview.html 数据与真实规则文件是否漂移。 */
export function checkPreviewDrift() {
  const html = readPreviewHtml();
  if (!html) return { ok: false, drift: true, message: `preview.html 缺失: ${PREVIEW}` };
  const cur = readPreviewSlotData(html);
  if (!cur) return { ok: false, drift: true, message: 'preview.html 缺少 __SLOTS__/__FAKE__ 数据段' };
  const slotData = buildPreviewSlotData();
  const keysDrift = JSON.stringify(Object.keys(cur.meta).sort()) !== JSON.stringify(Object.keys(slotData.meta).sort());
  const orderDrift = JSON.stringify(cur.order) !== JSON.stringify(slotData.realOrder);
  const nameDrift = slotData.realOrder.some((s) => cur.meta[s]?.name !== slotData.meta[s]?.name);
  if (keysDrift || orderDrift || nameDrift) {
    const msg = `preview.html 槽位数据与真实规则文件漂移：`
      + `${keysDrift ? `槽位集合 ${Object.keys(cur.meta).length} vs ${Object.keys(slotData.meta).length}；` : ''}`
      + `${orderDrift ? '顺序不一致；' : ''}${nameDrift ? '显示名不一致；' : ''}`
      + `运行 node scripts/gen-preview.mjs --write 重新生成`;
    return { ok: false, drift: true, message: msg };
  }
  return { ok: true, drift: false, message: `preview.html 槽位数据与真实一致（${slotData.realOrder.length} 槽位）` };
}

// ---------- CLI 入口 ----------
if (process.argv[1] && basenameSafe(process.argv[1]) === 'gen-preview.mjs') {
  const arg = process.argv[2] || '';
  if (arg === 'check') {
    const r = checkPreviewDrift();
    console.log(r.ok ? `✅ ${r.message}` : `❌ ${r.message}`);
    process.exitCode = r.ok ? 0 : 1;
  } else {
    const r = genPreview({ write: arg === '--write' });
    if (!r.ok) { console.error(r.error); process.exitCode = 1; }
    else console.log(`${r.write ? '✅ 已写盘' : '预览数据（未写盘，--write 才落盘）'}：${r.metaCount} 槽位 / order ${r.order.length} 项${r.drift ? '（原数据有漂移，已生成最新）' : ''}`);
  }
}

function basenameSafe(p) {
  const s = String(p || '').replace(/\\/g, '/');
  return s.split('/').pop();
}
