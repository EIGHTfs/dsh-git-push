/**
 * dsh-git-push 编译函数注册（规则总入口核心）
 *
 * 三统一：kind kebab-case ↔ 编译函数 PascalCase ↔ yml 字段 snake_case。
 * 每个编译函数声明 dimensions（10 维度绑定，支持一字段多维度）。
 * 注册方式：register(kind, detect, compile) —— 加字段 = 加函数 + 注册一行。
 * 显式 kind 优先；无 kind 走 detect 字段探测（不强制用户写 kind）。
 */
import { registerCompiler } from './registry.js';

/** 正则安全编译（非法正则不抛异常，收集错误返回 null）。 */
export function safeRe(pattern, label, errors = []) {
  try {
    return new RegExp(pattern);
  } catch (e) {
    errors.push(`规则「${label}」正则非法 ${pattern}: ${e.message}`);
    return null;
  }
}

export const DIMENSIONS = {
  可读性: '可读性', 可维护性: '可维护性', 健壮性: '健壮性', 安全性: '安全性', 性能: '性能',
  测试覆盖: '测试覆盖', 可观测性: '可观测性', 可部署性: '可部署性', 文档: '文档', 开发者体验: '开发者体验',
};

/** 统一规则对象形状（编译出口）。 */
function ruleOut({ id, name, kind, severity = 'warning', level = 'warning', message, pattern, patterns, pathPattern, threshold, dimensions = [], extra = {} }) {
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

const severityLevel = (s) => ({ error: 'blocker', warning: 'warning', info: 'pass' }[String(s || 'warning')] || 'warning');

/* ───────────────────────── 注册：凭据三类 ───────────────────────── */

registerCompiler(
  'credential-ref',
  (r) => /^credref-/.test(r?.id || ''),
  (r, ctx) => {
    const list = [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])].filter(Boolean)
      .map((p) => safeRe(p, r?.name || r?.id, ctx.errors)).filter(Boolean);
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'credential-ref', severity: r.severity,
      // patterns 必须传编译后 RegExp（checks.js 直接 p.test(line)）
      pattern: list[0], patterns: list.length > 1 ? list.slice(1) : undefined,
      message: r.description || r.name || '凭据引用模式',
      dimensions: [DIMENSIONS.安全性],
    });
  },
);

registerCompiler(
  'credential-file',
  (r) => /^credfile-/.test(r?.id || ''),
  (r, ctx) => {
    const re = safeRe(r?.path_pattern || r?.pathPattern || '', r?.name || r?.id, ctx.errors);
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'credential-file', severity: r.severity,
      pathPattern: re?.source,
      message: r.description || '凭据文件（路径模式）',
      dimensions: [DIMENSIONS.安全性],
    });
  },
);

registerCompiler(
  'secret',
  (r) => /^secret-/.test(r?.id || ''),
  (r, ctx) => {
    const list = [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])].filter(Boolean)
      .map((p) => safeRe(p, r?.name || r?.id, ctx.errors)).filter(Boolean);
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'secret', severity: r.severity,
      // patterns 必须传编译后 RegExp（checks.js 直接 p.test(line)）
      pattern: list[0], patterns: list.length > 1 ? list.slice(1) : undefined,
      message: r.description || `疑似敏感信息（${r.name || r.id}）`,
      dimensions: [DIMENSIONS.安全性],
    });
  },
);

/* ───────────────────────── 注册：函数行数 ───────────────────────── */

registerCompiler(
  'func-lines',
  (r) => r?.id === 'func-lines' || (r?.max_lines !== undefined && /function/i.test(r?.name || '')),
  (r) => {
    const threshold = Number(r.max_lines) || 50;
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'func-lines', severity: r.severity,
      level: severityLevel(r.severity), threshold,
      message: r.description || '单函数超长难读，应拆分',
      dimensions: [DIMENSIONS.可读性, DIMENSIONS.可维护性],
      extra: { blockThreshold: threshold * 2 || 100 },
    });
  },
);

/* ───────────────────────── 注册：数值六类（原 compileNumericRule 拆分） ───────────────────────── */

/** 数值字段 → kind 映射（一函数一类型，detect 各查各字段）。 */
const numericKinds = [
  ['min-length', (r) => r?.min_length !== undefined, (r) => ({ threshold: Number(r.min_length) }), [DIMENSIONS.可读性]],
  ['max-lines', (r) => r?.max_lines !== undefined && !/function/i.test(r?.name || ''), (r) => ({ threshold: Number(r.max_lines) }), [DIMENSIONS.可读性, DIMENSIONS.可维护性]],
  ['max-complexity', (r) => r?.max_complexity !== undefined, (r) => ({ threshold: Number(r.max_complexity) }), [DIMENSIONS.可维护性]],
  ['max-depth', (r) => r?.max_depth !== undefined, (r) => ({ threshold: Number(r.max_depth) }), [DIMENSIONS.可维护性]],
  // min-occurrences 与 repeated-string 共享 min_occurrences/ignore 字段；带 ignore_patterns/ignore_values 走 repeated-string
  ['min-occurrences', (r) => r?.min_occurrences !== undefined && !(Array.isArray(r.ignore_patterns) || Array.isArray(r.ignore_values)), (r) => ({ threshold: Number(r.min_occurrences), min_occurrences: Number(r.min_occurrences) }), [DIMENSIONS.可维护性]],
  ['repeated-string', (r) => r?.min_occurrences !== undefined && (Array.isArray(r.ignore_patterns) || Array.isArray(r.ignore_values)), (r, ctx) => ({
    threshold: Number(r.min_occurrences), min_occurrences: Number(r.min_occurrences),
    ignorePatterns: (r.ignore_patterns || []).map((p) => safeRe(p, r?.name || r?.id, ctx.errors)).filter(Boolean),
    ignoreValues: (r.ignore_values || []).map(String),
  }), [DIMENSIONS.可维护性, DIMENSIONS.可读性]],
];

for (const [kind, detect, field, dimensions] of numericKinds) {
  registerCompiler(
    kind,
    detect,
    (r, ctx) => {
      const f = field(r, ctx);
      return ruleOut({
        id: r.id, name: r.name || r.id, kind, severity: r.severity,
        level: severityLevel(r.severity), message: r.description || r.name || '',
        dimensions, extra: { ...f, exceptions: Array.isArray(r.exceptions) ? r.exceptions : [] },
      });
    },
  );
}

/* ───────────────────────── 注册：正则两类 ───────────────────────── */

registerCompiler(
  'regex',
  (r) => Array.isArray(r?.patterns) || typeof r?.pattern === 'string',
  (r, ctx) => {
    const list = [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])].filter((p) => typeof p === 'string')
      .map((p) => safeRe(p, r?.name || r?.id, ctx.errors)).filter(Boolean);
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'regex', severity: r.severity,
      level: severityLevel(r.severity),
      // patterns 必须传编译后 RegExp（checks.js 直接 p.test(line)）
      pattern: list[0], patterns: list.length > 1 ? list.slice(1) : undefined,
      message: r.description || r.name || '',
      dimensions: [DIMENSIONS.可读性],
      extra: { exts: Array.isArray(r.exts) ? r.exts.map((x) => String(x).toLowerCase().replace(/^\./, '')) : undefined },
    });
  },
);

registerCompiler(
  'path-regex',
  (r) => r?.kind === 'path-regex' || (r?.path_pattern && !/^credfile-/.test(r?.id || '')),
  (r, ctx) => {
    const re = safeRe(r.path_pattern, r?.name || r?.id, ctx.errors);
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'path-regex', severity: r.severity,
      level: severityLevel(r.severity), pathPattern: re?.source,
      message: r.description || r.name || '',
      dimensions: [DIMENSIONS.可读性, DIMENSIONS.可维护性],
    });
  },
);

/* ───────────────────────── 注册：链接判断（link-check，0.2.0） ───────────────────────── */

registerCompiler(
  'link-check',
  (r) => r?.kind === 'link-check' || Boolean(r?.flaky_hosts && r?.status_dead),
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'link-check', severity: r.severity || 'warning',
    level: severityLevel(r.severity || 'warning'),
    message: r.description || r.name || '',
    dimensions: [DIMENSIONS.文档, DIMENSIONS.可维护性],
    extra: {
      statusDead: r.status_dead || [],
      statusTransient: r.status_transient || [],
      flakyHosts: r.flaky_hosts || [],
      flakyFactor: r.flaky_factor,
      scoreDead: r.score_dead, scoreDns: r.score_dns, scoreTransient: r.score_transient,
      timeoutMs: r.timeouts_ms, concurrency: r.concurrency, maxLinks: r.max_links,
    },
  }),
);

/* ───────────────────────── 注册：语义规则（最后兜底） ───────────────────────── */

registerCompiler(
  'semantic',
  (r) => Boolean(r?.detection_method || r?.category === 'security' || r?.category === 'accessibility'
    || /\b(路径穿越|path-traversal|test-file|测试|known-vulnerability|漏洞依赖|label|可访问名称)\b/i.test(r?.name || '')
    || /testing\//i.test(r?.id || '') || /dependency\//i.test(r?.id || '')),
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'semantic', severity: r.severity,
    level: severityLevel(r.severity), message: r.description || r.name || '',
    dimensions: [DIMENSIONS.健壮性],
    extra: { detectionMethod: r.detection_method || null },
  }),
);

/** 注册表最终导出（供 ruleset 统计用）。 */
export function listRegisteredKinds() {
  // 延迟 import 避免循环（registry.js 不反向依赖 compilers）
  return import('./registry.js').then((m) => m.RULE_COMPILERS.map((e) => e.kind));
}