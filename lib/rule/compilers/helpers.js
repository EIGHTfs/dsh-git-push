/**
 * 编译层 · 共享助手
 *
 * safeRe（正则编译 + 错误收集）、DIMENSIONS（评分维度表）、
 *   ruleOut（编译结果统一出参结构）、severityLevel（严重度 → 评分等级映射）。
 * 各 kind 编译器共用这些助手，故独立成模块避免互相 import。
 */

/**
 * 正则安全编译（非法正则不抛异常，收集错误返回 null）。
 *
 * 1.0.0 修复：默认加 `i` 标志——规则本意是匹配「凭据/关键词写法」，
 * 大小写不敏感才正确（原实现漏检 apiKey / API_KEY 等驼峰与大写写法）。
 * 规则可用 `(?i)`（同义）、或 `(?-i)` 显式要求大小写敏感。
 */
export function safeRe(pattern, label, errors = []) {
  try {
    let src = String(pattern);
    let flags = 'i';
    if (src.startsWith('(?-i)')) { flags = ''; src = src.slice(5); }
    else if (src.startsWith('(?i)')) src = src.slice(4);
    return new RegExp(src, flags);
  } catch (e) {
    errors.push(`规则「${label}」正则非法 ${pattern}: ${e.message}`);
    return null;
  }
}

export const DIMENSIONS = {
  可读性: '可读性', 可维护性: '可维护性', 健壮性: '健壮性', 安全性: '安全性', 性能: '性能',
  测试覆盖: '测试覆盖', 可观测性: '可观测性', 可部署性: '可部署性', 文档: '文档', 开发者体验: '开发者体验',
};

/**
 * 维度统一解析（2026-09-15 统一维度绑定机制）：
 * yml 规则条目显式声明 dimensions 时优先（支持一字段多维度）；
 * 未声明则回退编译器内置默认维度。
 * 校验：非数组/空数组/含非 10 维度名的条目 → 报错收集 + 回退默认（防静默错绑）。
 * @param {object} r yml 规则条目
 * @param {string[]} fallback 编译器默认维度
 * @param {string[]} [errors] 编译错误收集（可选）
 */
export function pickDimensions(r = {}, fallback = [], errors = []) {
  const declared = Array.isArray(r.dimensions) ? r.dimensions : undefined;
  if (!declared || !declared.length) return [...fallback];
  const valid = Object.values(DIMENSIONS);
  const bad = declared.filter((d) => !valid.includes(String(d)));
  if (bad.length) {
    errors.push(`规则「${r?.id || r?.name || '?'}」dimensions 含未知维度（${bad.join('、')}），回退默认 [${fallback.join('、')}]`);
    return [...fallback];
  }
  return [...new Set(declared.map(String))];
}

/** 统一规则对象形状（编译出口）。 */
export function ruleOut({ id, name, kind, severity = 'warning', level = 'warning', message, pattern, patterns, pathPattern, threshold, dimensions = [], extra = {} }) {
  return {
    ok: true,
    rule: {
      id, name, kind, severity, level, message,
      ...(pattern ? { pattern } : {}),
      ...(patterns?.length ? { patterns } : {}),
      ...(pathPattern ? { pathPattern } : {}),
      ...(threshold !== undefined ? { threshold } : {}),
      dimensions: [...new Set(dimensions)],
      ...extra,
    },
  };
}

export const severityLevel = (s) => ({ error: 'blocker', warning: 'warning', info: 'pass' }[String(s || 'warning')] || 'warning');
