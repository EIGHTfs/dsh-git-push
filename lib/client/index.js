/**
 * dsh-git-push 侧边栏（设置 UI）总入口
 * dsh-skip-i18n: 插件为中文零依赖 CLI（无 i18n 框架需求），用户可见文案硬编码为产品设计
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
  hardcodeFullScan: false,
  injectSystemPrompt: true, // 注入系统提示词总开关（默认开）
  auditScanScope: 'diff',   // diff | full
  auditLevel: 'standard',    // quick | standard | deep
  maxScanFiles: 3000,        // 全量审计文件数上限（0=不限）；超限按变动优先截断，弱机防卡死
  auditRuleset: '',          // 自定规则目录（空=内置）
  auditRuleOrder: [],        // 槽位加载顺序（空=默认偏好顺序；private 恒末尾强制）
  weightOverrides: '',       // 权重覆盖 JSON（空=默认权重表）
  pushMethod: 'ssh',         // 推送通道：ssh（默认）| api | auto
  // 2026-09-16：defaultScanRoot/commitMessage 设置移除——默认扫描路径复用本地仓库列表
  //   选择路径（前端 localStorage dshgp-scan-path → repos-local?path=），提交信息留空由调用方生成。
};

/** 设置项声明（UI 单一事实源：侧边栏与配置读写共用）。 */
export const SETTINGS_SCHEMA = [
  { key: 'auditEnabled', type: 'boolean', default: false, label: '审计开关', hint: '开启后提交前自动审计（默认关）' },
  { key: 'hardcodeFullScan', type: 'boolean', default: false, label: '硬编码全量扫', hint: '换机前排查存量死路径（默认只扫新增行）' },
  { key: 'injectSystemPrompt', type: 'boolean', default: true, label: '注入系统提示词', hint: '注入工作区目录/工具安装路径 + skill 总入口 + 插件功能用法（每个工具怎么用，含凭据自动处理说明）；关=完全不注入。修改即时保存' },
  { key: 'auditScanScope', type: 'enum', values: ['diff', 'full'], default: 'diff', label: '审计扫描范围', hint: 'diff=仅本次变动；full=全量' },
  { key: 'pushMethod', type: 'enum', values: ['ssh', 'api', 'auto'], default: 'ssh', label: '推送通道', hint: 'ssh=推本地 HEAD（远端 sha 与本地一致，默认）；api=Git Data API 重建提交（远端 sha 与本地不同）；auto=有私钥走 ssh' },
  { key: 'auditLevel', type: 'enum', values: ['quick', 'standard', 'deep'], default: 'standard', label: '审计强度', hint: 'quick=只跑 regex/黑名单；standard=默认全量；deep=+AST 语义检查' },
  { key: 'auditRuleset', type: 'string', default: '', label: '自定规则目录', hint: '空=内置规则包；指向放有 audit-rules-<名>.yml 的目录即整体替换' },
  { key: 'maxScanFiles', type: 'number', default: 3000, label: '全量扫描文件上限', hint: '全量审计最多扫多少个文件（0=不限）；超限时按「变动文件优先」截断，避免弱机扫几万文件卡死' },
  { key: 'auditRuleOrder', type: 'list', default: [], label: '槽位加载顺序', hint: '逗号分隔槽位名；后加载覆盖先加载；private 恒末尾强制；空=默认偏好顺序' },
  { key: 'auditDisabledSlots', type: 'list', default: [], label: '禁用的规则包', hint: '逗号分隔槽位名；nodejs/private 不可禁用' },
  { key: 'weightOverrides', type: 'string', default: '', label: '权重覆盖 JSON', hint: '如 {"安全性":100}；空=默认权重表' },
];

/** 默认配置（由 SETTINGS_SCHEMA 派生，保证 UI 与默认值永不脱节）。 */
export function defaultConfig() {
  const out = { ...DEFAULT_CONFIG };
  for (const schemaEntry of SETTINGS_SCHEMA) out[schemaEntry.key] = schemaEntry.default;
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
    else if (schema.type === 'list') out[k] = Array.isArray(v) ? v : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
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
  const createEl = react.createElement;
  const rows = SETTINGS_SCHEMA.map((item) => {
    if (item.type === 'boolean') {
      return createEl('label', { key: item.key, className: 'dsh-git-push-row' }, [
        createEl('input', {
          key: 'input', type: 'checkbox', checked: config[item.key] === true,
          onChange: (e) => onChange(item.key, e?.target?.checked === true),
        }),
        createEl('span', { key: 'label' }, labels[item.key] || item.label),
      ]);
    }
    if (item.type === 'enum') {
      return createEl('label', { key: item.key, className: 'dsh-git-push-row' }, [
        createEl('select', {
          key: 'input', value: config[item.key],
          onChange: (e) => onChange(item.key, e?.target?.value),
        }, item.values.map((v) => createEl('option', { key: v, value: v }, v))),
        createEl('span', { key: 'label' }, labels[item.key] || item.label),
      ]);
    }
    if (item.type === 'list') {
      return createEl('label', { key: item.key, className: 'dsh-git-push-row' }, [
        createEl('input', {
          key: 'input', type: 'text', value: Array.isArray(config[item.key]) ? config[item.key].join(', ') : '',
          onChange: (e) => onChange(item.key, e?.target?.value ?? ''),
        }),
        createEl('span', { key: 'label' }, labels[item.key] || item.label),
      ]);
    }
    return createEl('label', { key: item.key, className: 'dsh-git-push-row' }, [
      createEl('input', {
        key: 'input', type: 'text', value: config[item.key] ?? '',
        onChange: (e) => onChange(item.key, e?.target?.value ?? ''),
      }),
      createEl('span', { key: 'label' }, labels[item.key] || item.label),
    ]);
  });
  return createEl('div', { className: 'dsh-git-push-settings' }, rows);
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
  for (const match of String(css).matchAll(re)) out.push(match[0]);
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
    // 2026-09-12：只保留 settings.section（设置左侧栏独立页）。
    // settings.plugin.item（插件配置卡）已删除（只保留 settings.section 独立页）。
    slots: ['settings.section'],
    jsx: false,
    externalResources: collectExternalRefs(INLINE_CSS),
    defaultConfig: defaultConfig(),
  };
}