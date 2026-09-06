/**
 * 审计规则管理（comment-wording 规则，v1.26.0）：规则定义不硬编码——
 * 支持内置默认 / 设置配置自定义（JSON 文本）/ 本地规则文件 / 在线规则 URL 四层，
 * 按「在线 URL 缓存 > 本地规则文件 > 配置自定义 > 内置默认」优先级合并，
 * 并提供规则导出（JSON）/ 导入（写本地规则文件）/ 在线同步（拉取并落缓存）。
 * 规则条目格式：{ name: string, pattern: string }，pattern 为合法 JS 正则源码。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** 内置默认规则（与历史行为一致：8 种「记录用户指令」措辞 + 文档对话类 1 组） */
export const DEFAULT_COMMENT_WORDING_PATTERNS = [
  { name: '用户要求', pattern: '用户要求' },
  { name: '用户原话', pattern: '用户原话' },
  { name: '用户说', pattern: '用户说' },
  { name: '用户约定', pattern: '用户约定' },
  { name: '用户规定', pattern: '用户规定' },
  { name: '用户明确', pattern: '用户明确' },
  { name: '用户拍板', pattern: '用户拍板' },
  { name: '用户：', pattern: '用户：' },
];

/** 文档对话类措辞（docs-conversation 规则所用决策来源措辞） */
export const DEFAULT_DOC_CONVERSATION_PATTERNS = [
  { name: '用户决策来源', pattern: '用户(同意|许可|确认|约定|指定|已定调|拍板|让我|要求我|跟我说)' },
];

/**
 * 解析规则源为条目数组：接受
 *  - 已是 [{name,pattern}] 数组（校验字段，丢弃非法项）
 *  - JSON 文本字符串（数组或 {rules:[...]} 包装）
 *  - 逗号分隔的正则源码列表（仅 name 自动编号，兼容简写）
 * @param {*} src
 * @returns {{ ok: boolean, rules?: Array<{name:string, pattern:string}>, error?: string }}
 */
export function parseCommentWordingRules(src) {
  try {
    let arr = null;
    if (Array.isArray(src)) {
      arr = src;
    } else if (typeof src === 'string') {
      const t = src.trim();
      if (t.startsWith('[') || t.startsWith('{')) {
        const parsed = JSON.parse(t);
        arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.rules) ? parsed.rules : null);
        if (arr === null) return { ok: false, error: 'JSON 需为规则数组或 { rules: [...] }' };
      } else {
        // 简写：逗号分隔正则（name 取正则字面量去首尾 //）
        arr = t.split(',').map((x) => x.trim()).filter(Boolean).map((re) => ({
          name: re.replace(/^\/(.*)\/[a-z]*$/i, '$1').slice(0, 24) || re.slice(0, 24),
          pattern: re,
        }));
      }
    } else {
      return { ok: false, error: '规则源类型不支持' };
    }
    const rules = arr
      .filter((x) => x && typeof x.pattern === 'string' && x.pattern.trim())
      .map((x) => ({ name: String(x.name ?? x.pattern).trim() || x.pattern, pattern: x.pattern.trim() }));
    if (rules.length === 0) return { ok: false, error: '没有有效规则条目' };
    // 校验正则合法性
    for (const r of rules) {
      try { new RegExp(r.pattern); } catch (e) { return { ok: false, error: `规则「${r.name}」正则非法: ${e.message}` }; }
    }
    return { ok: true, rules };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** 合并多个规则源（后出现的 name 覆盖先出现的同名项；保序）。 */
export function mergeCommentWordingRules(...sources) {
  const seen = new Map();
  for (const rules of sources) {
    if (!Array.isArray(rules)) continue;
    for (const r of rules) {
      if (r && typeof r.pattern === 'string' && r.pattern.trim()) {
        seen.set(r.name, { name: r.name, pattern: r.pattern.trim() });
      }
    }
  }
  return [...seen.values()];
}

/** 规则条目 → 可写 JSON 文本（导出用，含注释头）。 */
export function exportCommentWordingRules(rules) {
  const body = (rules || []).map((r) => ({ name: r.name, pattern: r.pattern }));
  return JSON.stringify({ version: 1, comment: 'dsh-git-push comment-wording 规则；name 同名覆盖内置；pattern 为 JS 正则源码', rules: body }, null, 2);
}

/** 在线规则 URL 拉取（带超时与大小上限），成功返回解析后的规则数组。 */
export async function fetchCommentWordingRules(url, { timeoutMs = 8000, maxBytes = 64 * 1024 } = {}) {
  if (typeof globalThis.fetch !== 'function') return { ok: false, error: '当前环境无 fetch' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await globalThis.fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > maxBytes) return { ok: false, error: `响应超限(${buf.length}B > ${maxBytes}B)` };
    const text = buf.toString('utf8');
    const parsed = parseCommentWordingRules(text);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return { ok: true, rules: parsed.rules, raw: text };
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? '请求超时' : String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 装载生效规则（同步部分）：按「配置自定义 > 本地规则文件 > 内置默认」解析。
 * 返回 { rules, source }；source ∈ builtin|custom|file。
 */
export function loadCommentWordingRulesSync({ custom = '', rulesFile = '' } = {}) {
  if (typeof custom === 'string' && custom.trim()) {
    const r = parseCommentWordingRules(custom);
    if (r.ok) return { rules: r.rules, source: 'custom' };
  }
  if (rulesFile) {
    try {
      if (existsSync(rulesFile)) {
        const r = parseCommentWordingRules(readFileSync(rulesFile, 'utf8'));
        if (r.ok) return { rules: r.rules, source: 'file' };
      }
    } catch { /* 读不到按内置 */ }
  }
  return { rules: [...DEFAULT_COMMENT_WORDING_PATTERNS], source: 'builtin' };
}

/**
 * 写本地规则文件（导入/同步落盘）。返回 { ok, error? }。
 */
export function saveCommentWordingRulesFile(rules, filePath) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, exportCommentWordingRules(rules), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}
