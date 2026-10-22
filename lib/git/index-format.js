/**
 * dsh-repo-index 的 JSONL 存储格式（读写 + 旧 JSON 兼容）。
 *
 * 为什么改 JSONL（原为单份 pretty-print JSON 对象）：
 *   ① **流式读写**：JSONL 每行一个独立对象，写入可以按条目逐行生成、读取可以逐行解析，
 *      不必把整份文档拼成一个结构再 parse/stringify——索引随仓库数增长时这一点更重要；
 *   ② **损坏容错**：单份 JSON 只要有一处截断就整份不可用（parse 直接抛），
 *      而 JSONL 可以跳过坏行、保留其余条目，索引不会因为一次半截写而全废；
 *   ③ **可增量**：单仓远端状态更新只需重写它自己那一行，语义上不再绑定「整份文档」。
 *
 * 文件形态（每行一个 JSON 对象，UTF-8，LF 结尾）：
 *   {"_t":"meta","name":…,"description":…,"version":…,"generatedAt":…,"owner":…,"note":…}
 *   {"_t":"repo","name":…,"path":…,"repoUrl":…,"visibility":…,…}      ← 每个仓库一行
 *   {"_t":"localOnly","path":"…"}                                      ← 顶层无远端的目录
 *   {"_t":"recovery","text":"多行恢复说明"}                             ← 收尾（文本整体占一行）
 *
 * 兼容策略：
 *   - 读：优先 `dsh-repo-index.jsonl`；不存在则回退旧 `dsh-repo-index.json`（整份 JSON）；
 *     两种都能解析成同一个内存对象，调用方无感；
 *   - 写：一律写 `.jsonl`；首次写入时把旧的 `.json` 移入同级 `.trash/`（保留可恢复，
 *     避免两份同源索引并存造成漂移）。
 *
 * 不变量：解析结果的对象形状与旧格式**完全一致**（name/description/version/generatedAt/
 *   owner/note/repos/localOnly/recovery），保证前端与其它读取方零改动。
 */
import { existsSync, readFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { writeTextAtomic } from '../core/atomic-json.js';

/** 新格式文件名（JSONL）。 */
export const INDEX_FILE = 'dsh-repo-index.jsonl';
/** 旧格式文件名（整份 JSON，仅读与迁移用）。 */
export const LEGACY_INDEX_FILE = 'dsh-repo-index.json';

/** 把索引对象序列化成 JSONL 文本（meta → repos → localOnly → recovery）。 */
export function serializeIndex(index) {
  const o = index && typeof index === 'object' ? index : {};
  const lines = [];
  const meta = {
    _t: 'meta',
    name: o.name || '',
    description: o.description || '',
    version: o.version || '',
    generatedAt: o.generatedAt || '',
    owner: o.owner || '',
    note: o.note || '',
  };
  lines.push(JSON.stringify(meta));
  for (const r of Array.isArray(o.repos) ? o.repos : []) {
    if (!r || typeof r !== 'object') continue;
    lines.push(JSON.stringify({ _t: 'repo', ...r }));
  }
  for (const p of Array.isArray(o.localOnly) ? o.localOnly : []) {
    lines.push(JSON.stringify({ _t: 'localOnly', path: String(p || '') }));
  }
  // recovery 是给人看的多行命令说明：整体作为一个字段，换行由 JSON 转义承载，仍只占一行
  if (o.recovery !== undefined && o.recovery !== null && o.recovery !== '') {
    lines.push(JSON.stringify({ _t: 'recovery', text: String(o.recovery) }));
  }
  return lines.join('\n') + '\n';
}

/** JSONL 文本 → 索引对象；坏行跳过并计数（不因单行损坏丢弃整份）。 */
export function parseIndex(text) {
  const s = String(text || '');
  const trimmed = s.trim();
  if (!trimmed) return null;
  // 旧格式（整份 JSON）：以 { 或 [ 开头且能整体 parse —— 其中的行不是独立对象
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const whole = JSON.parse(trimmed);
      // 带 _t 的顶层对象不是旧格式（极少见），继续走 JSONL 分支
      if (!(whole && typeof whole === 'object' && whole._t)) {
        return Array.isArray(whole) ? { repos: whole } : whole;
      }
    } catch { /* 不是整份 JSON → 按 JSONL 解析 */ }
  }
  const out = { name: '', description: '', version: '', generatedAt: '', owner: '', note: '', repos: [], localOnly: [], recovery: '' };
  let skipped = 0;
  for (const raw of s.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { skipped += 1; continue; }
    if (!obj || typeof obj !== 'object') { skipped += 1; continue; }
    const t = obj._t;
    if (t === 'meta') {
      out.name = obj.name || out.name;
      out.description = obj.description || out.description;
      out.version = obj.version || out.version;
      out.generatedAt = obj.generatedAt || out.generatedAt;
      out.owner = obj.owner || out.owner;
      out.note = obj.note || out.note;
    } else if (t === 'repo') {
      const { _t, ...rest } = obj;
      out.repos.push(rest);
    } else if (t === 'localOnly') {
      if (obj.path) out.localOnly.push(String(obj.path));
    } else if (t === 'recovery') {
      out.recovery = String(obj.text || '');
    } else {
      skipped += 1;
    }
  }
  if (skipped) out._skippedLines = skipped;
  return out;
}

/**
 * 读索引文件（JSONL 优先，旧 JSON 回退）。
 * @returns {{index: object|null, path: string, format: 'jsonl'|'json'|'none'}}
 */
export function readIndexFile(dir) {
  const jsonlPath = join(dir, INDEX_FILE);
  if (existsSync(jsonlPath)) {
    try { return { index: parseIndex(readFileSync(jsonlPath, 'utf8')), path: jsonlPath, format: 'jsonl' }; } catch { /* 落到旧格式 */ }
  }
  const legacyPath = join(dir, LEGACY_INDEX_FILE);
  if (existsSync(legacyPath)) {
    try { return { index: parseIndex(readFileSync(legacyPath, 'utf8')), path: legacyPath, format: 'json' }; } catch { /* 无可用索引 */ }
  }
  return { index: null, path: '', format: 'none' };
}

/**
 * 写入索引（一律 JSONL）。
 *
 * 旧 `.json` 的处理：首次成功写入 `.jsonl` 后，把旧文件移入同级 `.trash/<时间戳>-<名>`
 *   （可恢复），避免「两份同源索引并存」——两者不一致时无法判断哪份是真源。
 * @returns {{ok:boolean, path:string, migratedFrom?:string}}
 */
export function writeIndexFile(dir, index) {
  const target = join(dir, INDEX_FILE);
  const wr = writeTextAtomic(target, serializeIndex(index));
  if (!wr.ok) return { ok: false, path: target };
  const legacyPath = join(dir, LEGACY_INDEX_FILE);
  let migratedFrom = '';
  if (existsSync(legacyPath)) {
    try {
      const trashDir = join(dir, '.trash');
      mkdirSync(trashDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      let dest = join(trashDir, `${stamp}-${LEGACY_INDEX_FILE}`);
      if (existsSync(dest)) dest = join(trashDir, `${stamp}-${process.pid}-${LEGACY_INDEX_FILE}`);
      renameSync(legacyPath, dest);
      migratedFrom = dest;
    } catch { /* 移不动就留着（不影响 JSONL 读取优先级） */ }
  }
  return { ok: true, path: target, ...(migratedFrom ? { migratedFrom } : {}) };
}

/** 目录里是否存在任一格式的索引文件。 */
export function indexFileExists(dir) {
  return existsSync(join(dir, INDEX_FILE)) || existsSync(join(dir, LEGACY_INDEX_FILE));
}

/** 找目录下的索引文件路径（JSONL 优先）；都没有返回 null。 */
export function findIndexPath(dir) {
  const jsonlPath = join(dir, INDEX_FILE);
  if (existsSync(jsonlPath)) return jsonlPath;
  const legacyPath = join(dir, LEGACY_INDEX_FILE);
  if (existsSync(legacyPath)) return legacyPath;
  return null;
}

/** 兼容旧调用：整份 JSON 文本（部分调用方只做正则扫描，JSONL 每行也是合法 JSON 片段）。 */
export function indexAsJsonText(index) {
  return serializeIndex(index);
}

/** 列出目录里残留的索引文件（自检用：正常只有一个）。 */
export function listIndexFiles(dir) {
  try {
    return readdirSync(dir).filter((f) => f === INDEX_FILE || f === LEGACY_INDEX_FILE);
  } catch { return []; }
}

/** 索引文件所在目录（便于测试与调试定位）。 */
export function indexDirOf(filePath) {
  return dirname(String(filePath || ''));
}
