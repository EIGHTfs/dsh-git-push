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
    blocked: ['secret', 'credential-file', 'credential-ref', 'path-regex'], // path-regex 含私钥路径类
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