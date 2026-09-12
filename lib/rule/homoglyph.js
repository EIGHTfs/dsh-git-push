/**
 * dsh-git-push 同形字符检测（G3 防再犯，1.0.4）
 *
 * 背景：规则 yml 的 kind/id 是引擎匹配键（registerCompiler 的 kind 用 ASCII 注册）。
 * 若 yml 里 kind/id 夹带西里尔/希腊同形字符（如 с→c、е→e、а→a），视觉上几乎相同，
 * 但 `RULE_COMPILERS.find(e => e.kind === rule.kind)` 匹配不上 → 规则静默失效（编译报
 * 「未知规则类型」或字段探测落空），且无任何提示。本模块在 compileRule 入口检测，
 * 把「静默失效」变为「显式报错」。
 *
 * 用法：findHomoglyphs('credential-ref') → [{ ch:'с', ascii:'c', index:1 }]（空数组=纯 ASCII）
 */
export const HOMOGLYPH_MAP = {
  // 西里尔（Cyrillic，U+0400–U+04FF）→ 视觉同形 ASCII
  'а': 'a', 'б': 'b', 'д': 'd', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
  'у': 'y', 'х': 'x', 'в': 'B', 'г': 'r', 'з': '3', 'н': 'H', 'к': 'K',
  'м': 'M', 'т': 'T', 'і': 'i', 'ѕ': 's', 'ј': 'j', 'ɡ': 'g',
  // 希腊（Greek，U+0370–U+03FF）→ 视觉同形 ASCII
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'σ': 'o', 'τ': 't', 'ν': 'v', 'χ': 'x',
  'ε': 'e', 'κ': 'k', 'μ': 'm', 'ι': 'i', 'β': 'B', 'δ': 'D', 'γ': 'y',
  // 常用混淆（易误录）
  'İ': 'I', 'ı': 'i', 'ł': 'l', 'ø': 'o', 'Ø': 'O', 'æ': 'ae',
};

/** 组合正则：匹配任一非 ASCII 同形字符。 */
export const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPH_MAP).join('')}]`, 'g');

/**
 * 检测字符串中的同形字符。
 * @param {string} text 待检文本（如规则 id / kind）
 * @returns {Array<{ch:string, ascii:string, index:number}>} 命中列表（空=纯 ASCII）
 */
export function findHomoglyphs(text) {
  if (typeof text !== 'string' || !text) return [];
  const hits = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (HOMOGLYPH_MAP[ch]) hits.push({ ch, ascii: HOMOGLYPH_MAP[ch], index: i });
  }
  return hits;
}

/** 检测文本是否含非 ASCII 同形字符（布尔，供文件级扫描用）。 */
export function hasHomoglyphs(text) {
  return typeof text === 'string' && HOMOGLYPH_RE.test(text);
}
