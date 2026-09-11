/**
 * dsh-git-push 编译函数注册（规则总入口核心）
 *
 * 三统一：kind kebab-case ↔ 编译函数 PascalCase ↔ yml 字段 snake_case。
 * 每个编译函数声明 dimensions（10 维度绑定，支持一字段多维度）。
 * 注册方式：register(kind, detect, compile) —— 加字段 = 加函数 + 注册一行。
 * 显式 kind 优先；无 kind 走 detect 字段探测（不强制用户写 kind）。
 */
import { registerCompiler } from './registry.js';

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
  '[FUNC]',
  (r) => /^(\[FUNC\]|secret)-/.test(r?.id || ''),
  (r, ctx) => {
    const list = [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])].filter(Boolean)
      .map((p) => safeRe(p, r?.name || r?.id, ctx.errors)).filter(Boolean);
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: '[FUNC]', severity: r.severity,
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
  (r) => r?.id === 'func-lines' || (r?.max_lines !== undefined && /(function|函数)/i.test(r?.name || '')),
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
  ['max-lines', (r) => r?.max_lines !== undefined && !/(function|函数)/i.test(r?.name || ''), (r) => ({ threshold: Number(r.max_lines) }), [DIMENSIONS.可读性, DIMENSIONS.可维护性]],
  ['max-complexity', (r) => r?.max_complexity !== undefined, (r) => ({ threshold: Number(r.max_complexity) }), [DIMENSIONS.可维护性]],
  ['max-depth', (r) => r?.max_depth !== undefined, (r) => ({ threshold: Number(r.max_depth) }), [DIMENSIONS.可维护性]],
  // min-occurrences 与 repeated-string 共享 min_occurrences/ignore 字段；带 ignore_patterns/ignore_values 走 repeated-string
  ['min-occurrences', (r) => r?.min_occurrences !== undefined && !(Array.isArray(r.ignore_patterns) || Array.isArray(r.ignore_values)), (r) => ({ threshold: Number(r.min_occurrences), min_occurrences: Number(r.min_occurrences), ...(r.min_lines !== undefined ? { minLines: Number(r.min_lines) } : {}) }), [DIMENSIONS.可维护性]],
  ['repeated-string', (r) => r?.min_occurrences !== undefined && (Array.isArray(r.ignore_patterns) || Array.isArray(r.ignore_values)), (r, ctx) => ({
    threshold: Number(r.min_occurrences), min_occurrences: Number(r.min_occurrences),
    ...(r.min_lines !== undefined ? { minLines: Number(r.min_lines) } : {}),
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
    // 子模式支持（文档 §13 承诺「可直接落地」）：patterns 条目可为字符串或对象 {id,pattern,message}
    const list = [r.pattern, ...(Array.isArray(r.patterns) ? r.patterns : [])]
      .map((p) => {
        if (typeof p === 'string') return { regex: safeRe(p, r?.name || r?.id, ctx.errors), message: null };
        if (p && typeof p === 'object' && typeof p.pattern === 'string') {
          return { regex: safeRe(p.pattern, r?.name || r?.id, ctx.errors), message: p.message || null };
        }
        return null;
      })
      .filter((x) => x && x.regex);
    if (!list.length) return null; // 无有效 pattern → 编译失败交调用方
    return ruleOut({
      id: r.id, name: r.name || r.id, kind: 'regex', severity: r.severity,
      level: severityLevel(r.severity),
      // 每个条目带 regex + 可选专属 message（checks.js 对 RegExp 条目的向后兼容）
      pattern: list[0].regex, patterns: list.map((x, i) => (i === 0 ? x.regex : x.regex)), // 保持 RegExp 主键兼容
      message: r.description || r.name || '',
      dimensions: [DIMENSIONS.可读性],
      // subPatterns 走 extra 展开（ruleOut 只白名单 id/name/kind/... 顶层字段 + extra）
      extra: {
        subPatterns: list,
        exts: Array.isArray(r.exts) ? r.exts.map((x) => String(x).toLowerCase().replace(/^\./, '')) : undefined,
        examples: r.examples || undefined, // G6 认领：bad/good 示例展示字段
      },
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
/* ───────────────────────── 注册：注释黑名单（comment 槽位，1.0.3） ───────────────────────── */

/**
 * 注释措辞黑名单（comment-wording 分数制）。
 * 认领条件：黑名单数组 pattern+weight 形态（旧项目 comment 槽位总纲规则）。
 * 编译产物：blacklist[]（{pattern, weight} 直接下传检查器，检查器做行级加分扣分判定）。
 */
registerCompiler(
  'blacklist',
  (r) => Array.isArray(r?.blacklist) && r.blacklist.length > 0,
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'blacklist', severity: r.severity || 'warning',
    level: severityLevel(r.severity || 'warning'),
    message: r.description || r.name || '注释措辞审查',
    dimensions: [DIMENSIONS.文档],
    extra: {
      blacklist: Array.isArray(r.blacklist) ? r.blacklist.map((b) => ({ pattern: b.pattern, weight: Number(b.weight) || 0 })) : [],
      whitelist: Array.isArray(r.whitelist) ? r.whitelist.map((w) => ({ pattern: w.pattern, penalty: Number(w.penalty) || 0 })) : [],
      additionalFeatures: Array.isArray(r.additional_features) ? r.additional_features.map((a) => ({ pattern: a.pattern, weight: Number(a.weight) || 0 })) : [],
      // G6 认领：scoring.threshold_suspicious（comment.yml 60）→ threshold，action/suggestions 展示字段透传
      threshold: Number(r.threshold ?? r.scoring?.threshold_suspicious) || undefined,
      scoring: r.scoring || undefined,
      action: r.action || undefined,
      suggestions: Array.isArray(r.suggestions) ? r.suggestions : undefined,
    },
  }),
);

/* ───────────────────────── 注册：目录级审计（folder 槽位，1.0.3） ───────────────────────── */

/**
 * 目录级审计规则（文件夹数量审计：目录总数/单目录文件数/解包特征/.gitignore 覆盖）。
 * 认领条件：category === 'folder' 或带 threshold+exclude_dirs/signatures 组合字段。
 * 编译产物：目录级规则对象（threshold/excludeDirs/signatures/requiredPatterns 下传 checkFolderRules）。
 */
registerCompiler(
  'folder',
  (r) => r?.category === 'folder' || (r?.threshold !== undefined && (Array.isArray(r?.exclude_dirs) || Array.isArray(r?.signatures) || Array.isArray(r?.required_patterns))),
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'folder', severity: r.severity,
    level: severityLevel(r.severity),
    message: r.message || r.description || r.name || '',
    dimensions: [DIMENSIONS.可维护性, DIMENSIONS.可部署性],
    extra: {
      threshold: r.threshold !== undefined ? Number(r.threshold) : undefined,
      excludeDirs: Array.isArray(r.exclude_dirs) ? r.exclude_dirs : [],
      signatures: Array.isArray(r.signatures) ? r.signatures : [],
      requiredPatterns: Array.isArray(r.required_patterns) ? r.required_patterns : [],
    },
  }),
);

/* ───────────────────────── 注册：npm 结构化（npm-json，1.0.3） ───────────────────────── */

/**
 * npm 结构化规则（package.json 真实解析判定）。
 * 认领条件：显式 kind==='npm-json'（旧项目这两条原为「命中即提示」弱 pattern，
 * 引擎未实现真实判定 = 死规则；v2 忠实执行导致对任意 package.json 误报）。
 * 编译产物：保留 id/severity/message，检查器 checkNpmJson 做 JSON 解析判定。
 */
registerCompiler(
  'npm-json',
  (r) => r?.kind === 'npm-json',
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'npm-json', severity: r.severity,
    level: severityLevel(r.severity),
    message: r.description || r.name || '',
    dimensions: [DIMENSIONS.可部署性],
  }),
);

/* ───────────────────────── 注册：按钮事件绑定（button-bind，1.0.5 油猴脚本版） ───────────────────────── */

/**
 * 按钮事件绑定交叉比对（油猴脚本/浏览器扩展专用）。
 * 认领条件：显式 kind==='button-bind'，或 category==='button' 且无 patterns/path_pattern（交叉比对型）。
 * 编译产物：保留 id/severity/message/extra（checkButtonBindings 做同文件交叉比对）。
 * 场景：HTML 以字符串内嵌 JS（innerHTML/insertAdjacentHTML/模板字符串/createElement），
 * 事件在 JS 里 addEventListener/onclick= 绑定——不能只看 inline onclick。
 */
registerCompiler(
  'button-bind',
  (r) => r?.kind === 'button-bind' || (r?.category === 'button' && !Array.isArray(r?.patterns) && !r?.pattern && !r?.path_pattern),
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'button-bind', severity: r.severity || 'warning',
    level: severityLevel(r.severity || 'warning'),
    message: r.description || r.name || '',
    dimensions: [DIMENSIONS.可维护性],
    extra: {
      buttonInsertPatterns: Array.isArray(r?.insertion_patterns) ? r.insertion_patterns : [],
      bindPatterns: Array.isArray(r?.binding_patterns) ? r.binding_patterns : [],
    },
  }),
);
