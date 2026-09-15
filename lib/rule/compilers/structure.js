/**
 * 编译层 · 结构类 kind（三个）
 *
 * 注释黑名单（comment 槽位）、目录级审计（folder 槽位：目录数/单目录文件数）、
 *   npm 结构化（npm-json：license/repository/files 字段判定）。
 */

import { registerCompiler } from '../registry.js';
import { DIMENSIONS, ruleOut, severityLevel, pickDimensions } from './helpers.js';

/* ───────────────────────── 注册：注释黑名单（comment 槽位，1.0.3） ───────────────────────── */

/**
 * 注释措辞黑名单（comment-wording 分数制）。
 * 认领条件：黑名单数组 pattern+weight 形态（comment 槽位总纲规则）。
 * 编译产物：blacklist[]（{pattern, weight} 直接下传检查器，检查器做行级加分扣分判定）。
 */
registerCompiler(
  'blacklist',
  (r) => Array.isArray(r?.blacklist) && r.blacklist.length > 0,
  (r) => ruleOut({
    id: r.id, name: r.name || r.id, kind: 'blacklist', severity: r.severity || 'warning',
    level: severityLevel(r.severity || 'warning'),
    message: r.description || r.name || '注释措辞审查',
    dimensions: pickDimensions(r, [DIMENSIONS.文档]),
    extra: {
      blacklist: Array.isArray(r.blacklist) ? r.blacklist.map((b) => ({ pattern: b.pattern, ...(b.weight !== undefined ? { weight: Number(b.weight) || 0 } : {}) })) : [],
      whitelist: Array.isArray(r.whitelist) ? r.whitelist.map((w) => ({ pattern: w.pattern, ...(w.penalty !== undefined ? { penalty: Number(w.penalty) || 0 } : {}) })) : [],
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
    dimensions: pickDimensions(r, [DIMENSIONS.可维护性, DIMENSIONS.可部署性]),
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
 * 认领条件：显式 kind==='npm-json'（这两条原为「命中即提示」弱 pattern，
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
    dimensions: pickDimensions(r, [DIMENSIONS.可部署性]),
  }),
);
