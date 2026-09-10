// dsh-skip-residue: 豁免注册表元数据含 debugger/console 关键词声明（规则定义，非真实残留）
/**
 * dsh-git-push 豁免总入口
 *
 * dsh-skip-* 注册表：每个豁免类型声明「能豁免哪些维度/拦截类型（blocked）」。
 * 位置语义：文件头注释（前 3 行）= 整文件豁免；对应行行内注释 = 单点豁免（仅部分标记支持）。
 * 消费：auditFile 统一调 exemptForFinding(finding, text) 判定是否豁免；扫描问题自带 exemptHint。
 * 场景对照（旧项目 12 场景，见 docs/WORKBOARD-v2.md §3.6）：
 *   整文件豁免：dsh-skip-sensitive/size/func-length/syntax/quality/residue/style 写文件头
 *   单点豁免：dsh-skip-sensitive/residue 行内注释（行尾）→ 本行对应检查关闭
 */
export const EXEMPT_MARKERS = {
  'dsh-skip-sensitive': {
    dimensions: ['安全性'],
    blocked: ['[FUNC]', 'credential-file', 'credential-ref', 'path-regex', 'regex'], // path-regex 含私钥路径类；regex 是宽声明（安全类按 rule 名细分）
    // regex 宽声明：旧项目 security/* 规则带 pattern 字段编译成 regex kind，
    // 需按 rule 名细分（含 security/credential/secret/password/hardcoded 等安全词才算敏感类）
    sensitiveRules: ['security', 'credential', 'credref', 'credfile', 'secret', 'password', 'hardcoded'],
    lineLevel: true, // 支持行内单点豁免
    hint: '文件头注释=整文件；行尾注释=本行免敏感扫描',
  },
  'dsh-skip-size': {
    dimensions: ['可部署性'],
    blocked: ['binary', 'large-file'],
    lineLevel: false,
    hint: '只能写文件头（文件大小是整文件属性）',
  },
  'dsh-skip-func-length': {
    dimensions: ['可读性', '可维护性'],
    blocked: ['func-lines'],
    lineLevel: true, // 函数定义行行尾可豁免单函数
    hint: '文件头=全文件；函数定义行行尾=单函数',
  },
  'dsh-skip-syntax': {
    dimensions: ['健壮性'],
    blocked: ['syntax', 'json-parse', 'yaml-parse'],
    lineLevel: false,
    hint: '只能写文件头',
  },
  'dsh-skip-quality': {
    dimensions: ['可读性', '可维护性', '健壮性', '性能'],
    blocked: ['func-lines', 'empty-catch', 'sync-fs'],
    lineLevel: false,
    hint: '文件头=整文件免质量评分（func-lines/empty-catch/sync-fs）',
  },
  'dsh-skip-residue': {
    dimensions: ['可读性', '可维护性'],
    blocked: ['regex'], // 需按 rule 前缀细分（debugger/todo/console 残留）
    residueRules: ['debugger', 'todo', 'console'],
    lineLevel: true, // 行尾注释=本行
    hint: '行尾=本行；文件头=整文件免 debugger/todo/console 残留',
  },
  'dsh-skip-style': {
    dimensions: ['可读性'],
    blocked: ['regex'], // 需按 rule 前缀细分（style-* 数值风格规则）
    styleRules: ['min-length', 'max-lines', 'max-complexity', 'max-depth', 'min-occurrences', 'repeated-string'],
    lineLevel: false,
    hint: '文件头=整文件免全部 styleRules',
  },
  'dsh-skip-i18n': {
    dimensions: ['文档'],
    blocked: ['regex'], // 需按 rule 前缀细分（i18n/* 国际化审计规则）
    i18nRules: ['i18n'],
    lineLevel: true, // 行尾注释=本行免 i18n 硬编码；文件头=整文件
    hint: '文件头=整文件免 i18n 审计（无国际化需求的项目/文件）；行尾=本行硬编码文案',
  },
};

/** 文件头豁免检测：读文件前 3 行是否含任一标记。 */
export function hasHeaderExempt(text, marker) {
  if (!text) return false;
  const head = text.split('\n').slice(0, 3).join('\n');
  return head.includes(marker);
}

/** 行级豁免检测：某行是否含标记（行内注释）。 */
export function hasLineExempt(line, marker) {
  return typeof line === 'string' && line.includes(marker);
}

/**
 * 文件类别豁免清单（1.0.0）：某些文件类别里「看起来像问题」的写法其实是刻意的。
 *   - 测试文件（test/**）：同步 fs 便于断点断言、console.log 便于失败定位
 *   - 脚本/CLI（scripts/**、cli.mjs）：命令行工具本就同步执行 + stdout 输出是产品行为
 * 只豁免这些类别里**确属刻意**的规则；敏感信息/语法/大文件等硬问题不豁免。
 */
export const CATEGORY_EXEMPT = {
  test: { pathMatch: /(^|\/)test\//, rules: ['residue', 'console-log', 'sync-fs', 'empty-catch', 'performance'] },
  script: { pathMatch: /(^|\/)(scripts\/|cli\.mjs$)/, rules: ['residue', 'console-log', 'sync-fs'] },
};

/**
 * 判定 finding 是否属文件类别豁免（路径 + 规则双条件）。
 * @param {object} finding 统一问题对象（需含 file 与 rule/kind）
 * @returns {boolean} true=豁免
 */
export function isCategoryExempt(finding = {}) {
  const file = String(finding.file || '');
  const target = `${finding.rule || ''} ${finding.kind || ''}`.toLowerCase();
  for (const meta of Object.values(CATEGORY_EXEMPT)) {
    if (!meta.pathMatch.test(file)) continue;
    if (meta.rules.some((r) => target.includes(r))) return true;
  }
  return false;
}

/**
 * 判定单个 finding 是否被豁免。
 * 整文件豁免（文件头前 3 行含标记）→ 该 finding 的 kind 命中 blocked 即豁免；
 * 行级豁免（finding.line 所在行含标记，且标记支持 lineLevel）→ 豁免。
 * residue/style 走 rule 前缀细分（blocked=['regex'] + 规则名含 debugger/todo/console / style-*）。
 * @param {object} finding 统一问题对象
 * @param {string} text 文件全文（用于取文件头与行）
 * @returns {boolean} true=豁免（应丢弃该 finding）
 */
export function exemptForFinding(finding, text = '') {
  if (!finding) return false;
  if (isCategoryExempt(finding)) return true; // 文件类别豁免（测试/脚本的刻意用法）
  const lines = String(text).split('\n');
  const kind = finding.kind || '';
  const rule = finding.rule || '';
  for (const [marker, meta] of Object.entries(EXEMPT_MARKERS)) {
    const blockedHit = meta.blocked.includes(kind);
    // residue/style：blocked=['regex'] 是宽声明，需 rule 前缀细分
    let kindHit = blockedHit;
    if (blockedHit && meta.residueRules && meta.residueRules.length) {
      kindHit = meta.residueRules.some((r) => rule.toLowerCase().includes(r));
    }

    if (blockedHit && meta.styleRules && meta.styleRules.length) {
      kindHit = meta.styleRules.some((r) => rule.toLowerCase().includes(r));
    }
    if (kind === 'regex' && meta.i18nRules && meta.i18nRules.length) {
      kindHit = meta.i18nRules.some((r) => rule.toLowerCase().includes(r));
    }
    // sensitive 细分只在 regex 宽声明时生效（直接 kind 命中如 [FUNC]/credential-*/path-regex 不受 rule 名约束）
    if (kind === 'regex' && meta.sensitiveRules && meta.sensitiveRules.length) {
      kindHit = meta.sensitiveRules.some((r) => rule.toLowerCase().includes(r));
    }
    if (!kindHit) continue;
    // 整文件豁免（文件头前 3 行）
    if (hasHeaderExempt(lines.slice(0, 3).join('\n'), marker)) return true;
    // 行级豁免（支持 lineLevel 且本行含标记）
    if (meta.lineLevel) {
      const line = lines[finding.line - 1] || '';
      if (hasLineExempt(line, marker)) return true;
    }
  }
  return false;
}

/** 按问题 rule/kind 反查豁免标记（生成 exemptHint 用）。 */
export function exemptHintFor(ruleOrKind) {
  for (const [marker, meta] of Object.entries(EXEMPT_MARKERS)) {
    if (meta.blocked.includes(ruleOrKind)) return `${marker} — ${meta.hint}`;
  }
  return 'dsh-skip-sensitive（行尾=本行 / 文件头=整文件）';
}