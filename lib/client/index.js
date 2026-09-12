/**
 * dsh-git-push 侧边栏（设置 UI）总入口
 *
 * 0.1.8：手写 createElement（**不用 JSX**，无需构建步骤）；**零外部资源**
 * （不引 CDN / 外部字体 / 图片 / 图标字体，图标走 DSH primitives）。
 * 审计开关**默认关**（permitPush 默认关：AI 回复推送许可需用户显式开启）。
 * 配置即时生效：setConfig 立即写回并在同一次 tick 内反映到 UI 模型。
 *
 * 本模块为纯逻辑 + 组件工厂（可注入 mock react 单测，不依赖真实 DOM）：
 *   - SETTINGS_SCHEMA：设置项声明（键/类型/默认值/文案）——UI 与配置的单一事实源
 *   - defaultConfig()：默认配置（含审计开关默认关）
 *   - resolveConfig(patch)：合并用户配置（即时生效）
 *   - createSettingsCard(react, ctx)：用 createElement 组装设置卡片（无 JSX）
 *   - collectExternalRefs()：零外部资源自检（列出所有外链引用，应为空）
 */

/** 审计/推送开关默认值（关键：默认关）。 */
export const DEFAULT_CONFIG = {
  auditEnabled: false,      // 审计开关默认关
  pushPermitEnabled: false, // AI 回复推送许可默认关
  llmAudit: false,
  hardcodeFullScan: false,
  injectFullSkill: false,
  injectRepoIndexFull: false,
  auditScanScope: 'diff',   // diff | full
  commitMessage: '',
};

/** 设置项声明（UI 单一事实源：侧边栏与配置读写共用）。 */
export const SETTINGS_SCHEMA = [
  { key: 'auditEnabled', type: 'boolean', default: false, label: '审计开关', hint: '开启后提交前自动审计（默认关）' },
  { key: 'pushPermitEnabled', type: 'boolean', default: false, label: 'AI 回复推送许可', hint: '回复含「任务完成」后自动提交推送（默认关）' },
  { key: 'llmAudit', type: 'boolean', default: false, label: 'LLM 深度审查', hint: '需配置 provider/model（默认关）' },
  { key: 'hardcodeFullScan', type: 'boolean', default: false, label: '硬编码全量扫', hint: '换机前排查存量死路径（默认只扫新增行）' },
  { key: 'injectFullSkill', type: 'boolean', default: false, label: '注入全部 skill 内容', hint: '默认只注目录+清单，正文按需读取省 token' },
  { key: 'injectRepoIndexFull', type: 'boolean', default: false, label: '注入 repo-index 全文', hint: '默认只注文件名' },
  { key: 'auditScanScope', type: 'enum', values: ['diff', 'full'], default: 'diff', label: '审计扫描范围', hint: 'diff=仅本次变动；full=全量' },
  { key: 'commitMessage', type: 'string', default: '', label: '自动提交信息', hint: '留空则用 AI 生成的消息' },
];

/** 默认配置（由 SETTINGS_SCHEMA 派生，保证 UI 与默认值永不脱节）。 */
export function defaultConfig() {
  const out = { ...DEFAULT_CONFIG };
  for (const item of SETTINGS_SCHEMA) out[item.key] = item.default;
  return out;
}

/**
 * 合并用户配置（即时生效：未知键丢弃，类型按 schema 校正）。
 * @param {object} patch 用户配置片段
 * @param {object} [base] 基线（默认 defaultConfig）
 * @returns {object} 合并后配置
 */
export function resolveConfig(patch = {}, base = defaultConfig()) {
  const out = { ...base };
  const byKey = new Map(SETTINGS_SCHEMA.map((s) => [s.key, s]));
  for (const [k, v] of Object.entries(patch || {})) {
    const schema = byKey.get(k);
    if (!schema) continue; // 未知键丢弃
    if (schema.type === 'boolean') out[k] = v === true;
    else if (schema.type === 'enum') out[k] = schema.values.includes(v) ? v : schema.default;
    else out[k] = String(v ?? '');
  }
  return out;
}

/**
 * 组装设置卡片元素树（手写 createElement，无 JSX）。
 * @param {object} react React 兼容对象（需有 createElement；测试可注入 mock）
 * @param {object} [opts] { config, onChange, labels }
 * @returns {object} React 元素（mock 下为 {type,props} 形状）
 */
export function createSettingsCard(react, { config = defaultConfig(), onChange = () => {}, labels = {} } = {}) {
  if (!react || typeof react.createElement !== 'function') {
    throw new Error('createSettingsCard 需要 react.createElement（不支持 JSX 构建）');
  }
  const h = react.createElement;
  const rows = SETTINGS_SCHEMA.map((item) => {
    if (item.type === 'boolean') {
      return h('label', { key: item.key, className: 'dsh-git-push-row' }, [
        h('input', {
          key: 'input', type: 'checkbox', checked: config[item.key] === true,
          onChange: (e) => onChange(item.key, e?.target?.checked === true),
        }),
        h('span', { key: 'label' }, labels[item.key] || item.label),
      ]);
    }
    if (item.type === 'enum') {
      return h('label', { key: item.key, className: 'dsh-git-push-row' }, [
        h('select', {
          key: 'input', value: config[item.key],
          onChange: (e) => onChange(item.key, e?.target?.value),
        }, item.values.map((v) => h('option', { key: v, value: v }, v))),
        h('span', { key: 'label' }, labels[item.key] || item.label),
      ]);
    }
    return h('label', { key: item.key, className: 'dsh-git-push-row' }, [
      h('input', {
        key: 'input', type: 'text', value: config[item.key] ?? '',
        onChange: (e) => onChange(item.key, e?.target?.value ?? ''),
      }),
      h('span', { key: 'label' }, labels[item.key] || item.label),
    ]);
  });
  return h('div', { className: 'dsh-git-push-settings' }, rows);
}

/**
 * 零外部资源自检：收集设置 UI 中引用的外部资源（http(s):// / //cdn / url(...)）。
 * 应为空数组（不引 CDN、外部字体/图片）；测试断言用。
 * @param {string} [css] 内联样式文本（可选）
 * @returns {string[]} 命中的外部引用
 */
export function collectExternalRefs(css = '') {
  const out = [];
  const re = /(https?:\/\/[^\s'")]+|\/\/[a-z0-9.-]+\/[^\s'")]*|url\([^)]*\))/gi;
  for (const m of String(css).matchAll(re)) out.push(m[0]);
  return out;
}

/** 侧边栏内联样式（零外部资源：纯内联 CSS，无 @import / 无外链）。 */
export const INLINE_CSS = `
.dsh-git-push-settings { display: flex; flex-direction: column; gap: 8px; }
.dsh-git-push-row { display: flex; align-items: center; gap: 8px; }
.dsh-git-push-row span { font-size: 13px; }
`;

/** 导出模块描述（DSH 客户端插件接线用，1.0.0 接线时消费）。 */
export function clientModuleInfo() {
  return {
    id: 'dsh-git-push',
    settingsNamespace: 'git-push',
    slots: ['settings.section', 'settings.plugin.item'],
    jsx: false,
    externalResources: collectExternalRefs(INLINE_CSS),
    defaultConfig: defaultConfig(),
  };
}