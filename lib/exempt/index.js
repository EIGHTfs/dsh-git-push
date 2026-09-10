/**
 * dsh-git-push 豁免总入口
 *
 * dsh-skip-* 注册表：每个豁免类型声明「能豁免哪些维度/拦截类型」。
 * 位置语义：文件头注释（前 3 行）= 整文件豁免；对应位置注释 = 单点豁免。
 * 扫描问题输出自带 exemptHint。
 */
export const EXEMPT_MARKERS = {
  'dsh-skip-sensitive': {
    dimensions: ['安全性'],
    blocked: ['secret', 'credential-file', 'credential-ref'],
    hint: '文件头注释=整文件；行尾注释=本行免敏感扫描',
  },
  'dsh-skip-size': {
    dimensions: ['可部署性'],
    blocked: ['binary', 'large-file'],
    hint: '只能写文件头（文件大小是整文件属性）',
  },
  'dsh-skip-func-length': {
    dimensions: ['可读性', '可维护性'],
    blocked: ['func-lines'],
    hint: '文件头=全文件；函数定义行尾=单函数',
  },
  'dsh-skip-syntax': {
    dimensions: ['健壮性'],
    blocked: ['syntax', 'json', 'yaml'],
    hint: '只能写文件头',
  },
  'dsh-skip-quality': {
    dimensions: ['可读性', '可维护性', '健壮性', '性能'],
    blocked: ['func-lines', 'empty-catch', 'sync-fs'],
    hint: '文件头=整文件免质量评分',
  },
  'dsh-skip-residue': {
    dimensions: ['可读性', '可维护性'],
    blocked: ['debugger', 'todo', 'console'],
    hint: '行尾=本行；文件头=整文件',
  },
  'dsh-skip-style': {
    dimensions: ['可读性'],
    blocked: ['style-rules'],
    hint: '文件头=整文件免全部 styleRules',
  },
};

/** 文件头豁免检测：读文件前 3 行是否含任一标记。 */
export function hasHeaderExempt(text, marker) {
  if (!text) return false;
  const head = text.split('\n').slice(0, 3).join('\n');
  return head.includes(marker);
}

/** 行级豁免检测：某行是否含标记（行尾注释）。 */
export function hasLineExempt(line, marker) {
  return typeof line === 'string' && line.includes(marker);
}

/** 按问题 rule/kind 反查豁免标记（生成 exemptHint 用）。 */
export function exemptHintFor(ruleOrKind) {
  for (const [marker, meta] of Object.entries(EXEMPT_MARKERS)) {
    if (meta.blocked.includes(ruleOrKind)) return `${marker} — ${meta.hint}`;
  }
  return 'dsh-skip-sensitive（行尾=本行 / 文件头=整文件）';
}