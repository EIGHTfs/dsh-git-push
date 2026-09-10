/**
 * dsh-git-push 客户端插件（DSH 侧边栏，1.0.0）
 * dsh-skip-i18n: 插件为中文零依赖 CLI（无 i18n 框架需求），用户可见文案硬编码为产品设计
 *
 * 形态：DSH 客户端模块加载器入口（`__ModuleLoader__.load({ id, factory })`）。
 * 与 lib/client/index.js（纯逻辑/可单测）的关系：本文件是**浏览器侧适配层**，
 * 负责把设置项渲染成 DSH 设置页卡片；设置项 schema 与默认值在此内联（浏览器侧
 * 无法 import 服务端 ESM），两侧一致性由 test-client.mjs / test-plugin.mjs 断言。
 *
 * 约束（0.1.8 决策，本文件遵守）：
 *   - 手写 createElement，**不用 JSX**（无需构建步骤）
 *   - **零外部资源**：不引 CDN / 外部字体 / 图片；内联 CSS 无 @import / url()
 *   - 审计开关**默认关**（auditEnabled / pushPermitEnabled 均 false）
 *   - 配置即时生效（每次变更直接写 settingsScope）
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-push',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require('react');

    const NS = 'settings.gitPush';
    const SETTINGS_NS = 'git-push';

    const zh = {
      title: 'Git 提交推送',
      description: 'dsh-git-push：一键提交推送 + 审计门禁。开关默认关闭。',
      auditEnabled: '审计开关',
      auditEnabledHint: '开启后提交前自动审计（默认关）',
      pushPermitEnabled: 'AI 回复推送许可',
      pushPermitEnabledHint: '回复含「任务完成」后自动提交推送（默认关）',
      llmAudit: 'LLM 深度审查',
      llmAuditHint: '需配置 provider/model（默认关）',
      hardcodeFullScan: '硬编码全量扫',
      hardcodeFullScanHint: '换机前排查存量死路径（默认只扫新增行）',
      injectFullSkill: '注入全部 skill 内容',
      injectFullSkillHint: '默认只注目录+清单，正文按需读取省 token',
      auditScanScope: '审计扫描范围',
      auditScanScopeHint: 'diff=仅本次变动；full=全量',
      auditLevel: '审计强度',
      auditLevelHint: 'quick=只跑 regex/黑名单；standard=默认全量；deep=+AST 语义检查',
      auditRuleset: '自定规则目录',
      auditRulesetHint: '空=内置规则包；指向放有 audit-rules-<名>.yml 的目录即整体替换',
      weightOverrides: '权重覆盖 JSON',
      weightOverridesHint: '如 {"安全性":100}；空=默认权重表',
    };

    /** 设置项（与服务端 lib/client/index.js SETTINGS_SCHEMA 一致）。 */
    const SCHEMA = [
      { key: 'auditEnabled', type: 'boolean', default: false },
      { key: 'pushPermitEnabled', type: 'boolean', default: false },
      { key: 'llmAudit', type: 'boolean', default: false },
      { key: 'hardcodeFullScan', type: 'boolean', default: false },
      { key: 'injectFullSkill', type: 'boolean', default: false },
      { key: 'auditScanScope', type: 'enum', values: ['diff', 'full'], default: 'diff' },
      { key: 'auditLevel', type: 'enum', values: ['quick', 'standard', 'deep'], default: 'standard' },
      { key: 'auditRuleset', type: 'string', default: '' },
      { key: 'weightOverrides', type: 'string', default: '' },
    ];

    const INLINE_CSS = '.dsh-git-push-row{display:flex;align-items:center;gap:8px}'
      + '.dsh-git-push-row span{font-size:13px}';

    /** 设置卡片：手写 createElement（无 JSX）。 */
    function GitPushCard(props) {
      const h = react.createElement;
      const scope = props.scope;
      const config = scope.use();
      const setKey = (key) => (value) => scope.set(key, value);
      const rows = SCHEMA.map((item) => {
        if (item.type === 'enum') {
          return h('label', { key: item.key, className: 'dsh-git-push-row' }, [
            h('select', { key: 'i', value: config[item.key] ?? item.default, onChange: (e) => setKey(item.key)(e.target.value) },
              item.values.map((v) => h('option', { key: v, value: v }, v))),
            h('span', { key: 'l' }, zh[item.key] || item.key),
          ]);
        }
        if (item.type === 'string') {
          return h('label', { key: item.key, className: 'dsh-git-push-row' }, [
            h('input', { key: 'i', type: 'text', value: config[item.key] ?? item.default ?? '',
              onChange: (e) => setKey(item.key)(e.target.value) }),
            h('span', { key: 'l' }, zh[item.key] || item.key),
          ]);
        }
        return h('label', { key: item.key, className: 'dsh-git-push-row' }, [
          h('input', { key: 'i', type: 'checkbox', checked: config[item.key] === true, onChange: (e) => setKey(item.key)(e.target.checked) }),
          h('span', { key: 'l' }, zh[item.key] || item.key),
        ]);
      });
      return h('div', { className: 'dsh-git-push-card' }, [
        h('div', { key: 't', className: 'dsh-git-push-title' }, zh.title),
        h('div', { key: 'd', className: 'dsh-git-push-desc' }, zh.description),
        h('style', { key: 's' }, INLINE_CSS),
        ...rows,
      ]);
    }

    /** 插件应用：注册设置卡片到 settings.plugin.item 槽位。 */
    // 【临时禁用 2026-09-11】ctx.slots 直读抛 "cannot get property \"slots\" without inject"，
    // 先注释恢复实例可用；副作用：设置页不显示 git-push 卡片，插件工具/审计/推送功能不受影响。
    // 【TODO】确认 DSH 客户端插件 inject 的正确声明入口后恢复。
    function apply() {
      // ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      //   name: 'settings.plugin.item',
      //   key: SETTINGS_NS,
      //   locale: NS,
      // }, GitPushCard));
    }

    exports.NS = NS;
    exports.apply = apply;
    exports.SCHEMA = SCHEMA;
    exports.INLINE_CSS = INLINE_CSS;
    return module.exports;
  },
});
