/**
 * dsh-git-push 审计规则包装载器（v1.41.0，C 组规则插件化）
 *
 * 设计（用户指示 5）：审计功能规则做成插件化规则包——以后可以引入别人写的审计功能与配套规则；
 * 当前规则归属 EIGHTfs，代码只负责「读配置 → 装载规则包 → 校验 → 编译」，规则数据全部在 JSON。
 *
 * 规则包 JSON 格式（支持 // 行注释，装载时剥离）：
 * {
 *   "name": "eightfs",
 *   "owner": "EIGHTfs",
 *   "version": "1.41.0",
 *   "description": "...",
 *   "rules": [
 *     { "id": "唯一ID", "kind": "secret|credential-file|comment-wording|doc-conversation|code-quality",
 *       "level": "blocker|warning", "pattern": "正则源码", "name": "展示名", "message": "提示" },
 *     { "id": "func-lines", "kind": "code-quality", "level": "warning", "threshold": 50,
 *       "blockThreshold": 100, "message": "..." }
 *   ]
 * }
 *
 * 来源（source）：
 *   builtin — 插件内置 lib/audit-rules/eightfs.rules.json（缺省）
 *   file    — 本地规则包文件绝对路径
 *   url     — 在线规则包地址（http/https，超时 8s，上限 2MB）
 *
 * 豁免约定（用户指示 2）：.json 文件内 // 注释行豁免「隐私入库类」规则（secret/credential-file）；
 * comment-wording / doc-conversation / 代码质量规则不豁免——豁免由 audit.js 按行实施。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BUILTIN_RULE_PACK_PATH = join(__dirname, 'audit-rules', 'eightfs.rules.json');

export const RULE_KINDS = ['secret', 'credential-file', 'credential-ref', 'comment-wording', 'doc-conversation', 'code-quality'];
export const RULE_LEVELS = ['blocker', 'warning'];

/** 安全编译正则：非法 pattern 返回 null（调用方跳过该条并记 errors，不抛错） */
function safeRe(pattern, name, errors) {
  try {
    return new RegExp(pattern);
  } catch (e) {
    errors.push(`规则「${name}」正则非法: ${String(e?.message || e).slice(0, 120)}`);
    return null;
  }
}

/** 剥离 JSON 内 // 行注释（字符串字面量里的 // 不动；状态机实现） */
export function stripJsonComments(text) {
  const s = String(text || '');
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      if (i < s.length) out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 校验规则包结构。返回 { ok, errors }。
 * 校验：name/owner/version 存在；rules 非空数组；id 唯一；kind/level 合法；
 * pattern/pathPattern 正则可编译；code-quality 阈值为正数。
 */
export function validateRulePack(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['规则包必须是对象'] };
  if (!obj.name || typeof obj.name !== 'string') errors.push('缺少 name');
  if (!obj.owner || typeof obj.owner !== 'string') errors.push('缺少 owner（规则归属）');
  if (obj.version === undefined || obj.version === null || obj.version === '') errors.push('缺少 version');
  if (!Array.isArray(obj.rules) || obj.rules.length === 0) errors.push('rules 必须是非空数组');
  const ids = new Set();
  for (const [i, r] of (obj.rules || []).entries()) {
    const label = r?.id || `#${i}`;
    if (!r || typeof r !== 'object') { errors.push(`规则 ${label} 不是对象`); continue; }
    if (!r.id) errors.push(`规则 #${i} 缺少 id`);
    else if (ids.has(r.id)) errors.push(`规则 id 重复: ${r.id}`);
    else ids.add(r.id);
    if (!RULE_KINDS.includes(r.kind)) errors.push(`规则 ${label} kind 非法: ${r.kind}（允许 ${RULE_KINDS.join('|')}）`);
    if (r.level && !RULE_LEVELS.includes(r.level)) errors.push(`规则 ${label} level 非法: ${r.level}`);
    if (r.pattern !== undefined && typeof r.pattern !== 'string') errors.push(`规则 ${label} pattern 必须是字符串`);
    if (r.pathPattern !== undefined && typeof r.pathPattern !== 'string') errors.push(`规则 ${label} pathPattern 必须是字符串`);
    // 正则可编译性校验（装载期拦截，避免引擎期静默降级）
    for (const key of ['pattern', 'pathPattern']) {
      if (typeof r[key] === 'string') {
        try { new RegExp(r[key]); } catch (e) { errors.push(`规则 ${label} ${key} 正则非法: ${String(e?.message || e).slice(0, 120)}`); }
      }
    }
    if ((r.kind === 'secret' || r.kind === 'comment-wording' || r.kind === 'doc-conversation') && !r.pattern) {
      errors.push(`规则 ${label}（${r.kind}）缺少 pattern`);
    }
    if (r.kind === 'credential-file' && !r.pathPattern) errors.push(`规则 ${label}（credential-file）缺少 pathPattern`);
    if (r.kind === 'credential-ref' && !r.pattern) errors.push(`规则 ${label}（credential-ref）缺少 pattern`);
    if (r.kind === 'code-quality' && r.threshold !== undefined && (!Number.isFinite(r.threshold) || r.threshold <= 0)) {
      errors.push(`规则 ${label} threshold 必须是正数`);
    }
  }
  if (obj.quality) {
    // v1.42.0：文件级评分字段（fileLinesBase/Rate/Cap、fileKbBase/Rate/Cap）同 funcLines* 一样要求正数
    for (const k of ['funcLinesWarn', 'funcLinesBlock', 'fileLinesBase', 'fileLinesRate', 'fileLinesCap', 'fileKbBase', 'fileKbRate', 'fileKbCap']) {
      if (obj.quality[k] !== undefined && (!Number.isFinite(obj.quality[k]) || obj.quality[k] <= 0)) errors.push(`quality.${k} 必须是正数`);
    }
    if (Number.isFinite(obj.quality.funcLinesWarn) && Number.isFinite(obj.quality.funcLinesBlock) && obj.quality.funcLinesWarn >= obj.quality.funcLinesBlock) {
      errors.push('quality.funcLinesWarn 必须小于 funcLinesBlock');
    }
  }
  return { ok: errors.length === 0, errors };
}

/** 解析规则包文本（容忍 // 注释），返回 { ok, pack?, error? } */
export function parseRulePackText(text) {
  try {
    const pack = JSON.parse(stripJsonComments(text));
    return { ok: true, pack };
  } catch (e) {
    return { ok: false, error: `规则包 JSON 解析失败: ${String(e?.message || e).slice(0, 150)}` };
  }
}

/** 读本地规则包文件（同步）。返回 { ok, pack?, error? } */
export function loadRulePackFromFile(filePath, { maxBytes = 2 * 1024 * 1024 } = {}) {
  try {
    if (!filePath) return { ok: false, error: '规则包路径为空' };
    if (!existsSync(filePath)) return { ok: false, error: `规则包文件不存在: ${filePath}` };
    const text = readFileSync(filePath, 'utf8');
    if (text.length > maxBytes) return { ok: false, error: `规则包超限(${text.length}B > ${maxBytes}B)` };
    const parsed = parseRulePackText(text);
    if (!parsed.ok) return parsed;
    const v = validateRulePack(parsed.pack);
    if (!v.ok) return { ok: false, error: `规则包校验失败: ${v.errors.join('；')}` };
    return parsed;
  } catch (e) {
    return { ok: false, error: `规则包读取失败: ${String(e?.message || e).slice(0, 150)}` };
  }
}

/** 读插件内置规则包（同步，EIGHTfs）。返回 { ok, pack?, error? } */
export function loadBuiltinRulePack() {
  return loadRulePackFromFile(BUILTIN_RULE_PACK_PATH);
}

/** 在线拉取规则包（异步，8s 超时 / 2MB 上限）。返回 { ok, pack?, error? } */
export async function loadRulePackFromUrl(url, { timeoutMs = 8000, maxBytes = 2 * 1024 * 1024 } = {}) {
  if (typeof globalThis.fetch !== 'function') return { ok: false, error: '当前环境无 fetch' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await globalThis.fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > maxBytes) return { ok: false, error: `响应超限(${buf.length}B > ${maxBytes}B)` };
    const parsed = parseRulePackText(buf.toString('utf8'));
    if (!parsed.ok) return parsed;
    const v = validateRulePack(parsed.pack);
    if (!v.ok) return { ok: false, error: `规则包校验失败: ${v.errors.join('；')}` };
    return parsed;
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? '请求超时' : String(e?.message || e).slice(0, 150) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析 auditRuleset 配置为来源描述（C3）。
 * '' / 'builtin' / 'eightfs' → builtin；'http(s)://…' → url；其他字符串 → 本地文件路径。
 */
export function resolveRulesetChoice(cfg) {
  const s = String(cfg || '').trim();
  if (!s || s === 'builtin' || s === 'eightfs' || s === 'default') return { source: 'builtin' };
  if (/^https?:\/\//i.test(s)) return { source: 'url', url: s };
  return { source: 'file', path: s };
}

/** 按来源装载规则包（file/builtin 同步、url 异步）。返回 { ok, pack?, error?, source } */
export async function loadRulePack(choice = {}) {
  const c = typeof choice === 'string' ? resolveRulesetChoice(choice) : (choice || { source: 'builtin' });
  if (c.source === 'url') return { ...(await loadRulePackFromUrl(c.url)), source: 'url' };
  if (c.source === 'file') return { ...loadRulePackFromFile(c.path), source: 'file' };
  const r = loadBuiltinRulePack();
  return { ...r, source: r.ok ? 'builtin' : 'builtin-missing' };
}

/**
 * 编译规则包 → 引擎消费结构（audit.js 用）。非法 pattern 收进 errors 并跳过该条。
 * @returns {{ meta, secretPatterns, credentialFileRes, credentialRefPatterns, wordingPatterns,
 *   docConvPatterns, quality, codeQuality, errors }}
 */
export function compileRulePack(pack, { source = 'builtin' } = {}) {
  const errors = [];
  const meta = { name: pack?.name || '(unnamed)', owner: pack?.owner || '(unknown)', version: String(pack?.version ?? '0'), source };
  const out = {
    meta,
    secretPatterns: [],
    credentialFileRes: [],
    credentialRefPatterns: [],
    wordingPatterns: [],
    docConvPatterns: [],
    quality: {
      funcLinesWarn: Number(pack?.quality?.funcLinesWarn) || 50,
      funcLinesBlock: Number(pack?.quality?.funcLinesBlock) || 100,
      // v1.42.0：文件级评分阈值（scoreFile 用；缺省=内置基准）
      fileLinesBase: Number(pack?.quality?.fileLinesBase) || 200,
      fileLinesRate: Number(pack?.quality?.fileLinesRate) || 0.05,
      fileLinesCap: Number(pack?.quality?.fileLinesCap) || 40,
      fileKbBase: Number(pack?.quality?.fileKbBase) || 30,
      fileKbRate: Number(pack?.quality?.fileKbRate) || 0.2,
      fileKbCap: Number(pack?.quality?.fileKbCap) || 30,
    },
    codeQuality: {},
    errors,
  };
  for (const r of (pack?.rules || [])) {
    const label = r?.name || r?.id || '(unnamed)';
    if (r.kind === 'secret') {
      const re = safeRe(r.pattern, label, errors);
      if (re) out.secretPatterns.push({ name: label, re, message: r.message || `疑似敏感信息（${label}），请确认是否硬编码` });
    } else if (r.kind === 'credential-file') {
      const re = safeRe(r.pathPattern, label, errors);
      if (re) out.credentialFileRes.push(re);
    } else if (r.kind === 'credential-ref') {
      const re = safeRe(r.pattern, label, errors);
      if (re) out.credentialRefPatterns.push({ name: label, re, message: r.message || '' });
    } else if (r.kind === 'comment-wording') {
      const re = safeRe(r.pattern, label, errors);
      if (re) out.wordingPatterns.push({ name: label, re });
    } else if (r.kind === 'doc-conversation') {
      const re = safeRe(r.pattern, label, errors);
      if (re) out.docConvPatterns.push({ name: label, re });
    } else if (r.kind === 'code-quality') {
      // 阈值型/正则型质量规则，按 id 归桶供 quality.js 与 auditFile 消费
      out.codeQuality[r.id] = {
        id: r.id,
        level: r.level || 'warning',
        threshold: r.threshold,
        blockThreshold: r.blockThreshold,
        min: r.min,
        max: r.max,
        message: r.message || '',
        re: r.pattern ? safeRe(r.pattern, label, errors) : null,
      };
    }
  }
  return out;
}

/** 规则包缓存（进程内，按 choice 键；clearRulePackCache 测试清理） */
const _cache = new Map();

/** 获取编译后规则集（带缓存）。装载失败返回 errors 标记的空规则集（引擎可判 errors 决定兜底）。 */
export async function getCompiledRulePack(choice) {
  const c = typeof choice === 'string' ? resolveRulesetChoice(choice) : (choice || { source: 'builtin' });
  const key = JSON.stringify(c);
  if (_cache.has(key)) return _cache.get(key);
  const loaded = await loadRulePack(c);
  const compiled = loaded.ok
    ? compileRulePack(loaded.pack, { source: loaded.source })
    : compileRulePack({ name: '(load-failed)', owner: '(unknown)', version: '0', rules: [] }, { source: loaded.source });
  if (!loaded.ok) compiled.errors = [loaded.error || '规则包装载失败'];
  _cache.set(key, compiled);
  return compiled;
}

/** 清空规则包缓存（测试用）。 */
export function clearRulePackCache() {
  _cache.clear();
}
