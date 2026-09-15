/**
 * 编译层 · 链接与语义类 kind
 *
 * link-check（文档链接有效性，只报不拦）、semantic（语义占位符检查，最后兜底）。
 * 为何合在一起：两者都是「跨文件/跨上下文才能判定」的检查，与正文正则不是一类。
 */

import { registerCompiler } from '../registry.js';
import { DIMENSIONS, ruleOut, severityLevel, pickDimensions } from './helpers.js';

/* ───────────────────────── 注册：链接判断（link-check，0.2.0） ───────────────────────── */

registerCompiler(
  'link-check',
  (r) => r?.kind === 'link-check' || Boolean(r?.flaky_hosts && r?.status_dead),
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'link-check', severity: r.severity || 'warning',
    level: severityLevel(r.severity || 'warning'),
    message: r.description || r.name || '',
    dimensions: pickDimensions(r, [DIMENSIONS.文档, DIMENSIONS.可维护性]),
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
    dimensions: pickDimensions(r, [DIMENSIONS.健壮性]),
    extra: { detectionMethod: r.detection_method || null },
  }),
);
