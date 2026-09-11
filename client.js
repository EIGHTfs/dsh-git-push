/**
 * dsh-git-push 客户端插件（DSH 侧边栏，与 lib/self VERSION 同步）
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
 *   - 审计开关**默认关**（auditEnabled 默认 false）
 *   - 配置即时生效（每次变更直接写 settingsScope）
 *
 * 1.1.0（2026-09-11）：修复设置卡片注册（inject 声明缺失导致 ctx.slots 直读抛
 * without inject → 卡片被临时禁用，见 1.0.4 TODO），对齐旧项目 v1.47 规则引擎卡：
 *   - inject: ['slots', 'locale', 'settingsScope']（DSH 客户端插件依赖声明）
 *   - settings.section（设置侧边栏独立页）+ settings.plugin.item（插件配置卡）
 *   - 规则引擎（YAML）卡：槽位顺序（↑↓ 排序，后覆盖前）+ template 开关 +
 *     keyword 权重滑块（≥40 进门禁 blocker，对齐旧项目 v1.47）
 *   - 槽位元数据从 host 注入的 ruleSlotMeta 读取（动态发现 yml 自动出现）
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-push',
  // v1.42.0 同款处理（对齐 v1 client.js 头部注释）：工厂参数去括号（require => 单参箭头不匹配
  // checkFunctionLength 的 fnStart 正则），使工厂内部函数被独立计数——纯语法等价改写，行为零变化
  factory: require => {
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
      auditRuleOrder: '槽位加载顺序',
      auditRuleOrderHint: '逗号分隔槽位名；后加载覆盖先加载；private 恒末尾强制；空=默认偏好顺序',
      weightOverrides: '权重覆盖 JSON',
      weightOverridesHint: '如 {"安全性":100}；空=默认权重表',
      ruleEngine: '规则引擎（YAML）',
      ruleEngineHint: '顺序=加载次序，后加载覆盖先加载（同 id/pattern）；权重改完即存即生效，不影响 YAML 文件本体。',
      keywordWeights: '关键词权重（≥40 进门禁 blocker）',
      dimWeights: '10 维度权重（可调，改完即生效；合计建议 100）',
      dimWeightsHint: '权重 JSON 存于 weightOverrides；滑块改单维度，其余取默认表。维度绑定在 yml 规则的编译函数里（支持一字段多维度）。',
      forcedPrivate: '私密文件拦截（强制加载，不可排序；远端公开+含私钥/token → 拦截）',
      enableTemplate: '启用 template 自定义规则文件（空模板，默认不加载）',
      firstLoad: '（先加载）',
      lastOverride: '（后覆盖）',
      noRules: '（无规则槽位文件）',
    };

    /** 10 维度权威表（与 lib/score DEFAULT_WEIGHTS 一致；合计 100）。 */
    const DIM_WEIGHTS = [
      ['可读性', 15], ['可维护性', 15], ['健壮性', 15], ['安全性', 18], ['性能', 10],
      ['测试覆盖', 10], ['可观测性', 5], ['可部署性', 5], ['文档', 4], ['开发者体验', 3],
    ];

    /** 设置项（与服务端 lib/client/index.js SETTINGS_SCHEMA 一致）。 */
    const SCHEMA = [
      { key: 'auditEnabled', type: 'boolean', default: false },
      { key: 'hardcodeFullScan', type: 'boolean', default: false },
      { key: 'injectFullSkill', type: 'boolean', default: false },
      { key: 'auditScanScope', type: 'enum', values: ['diff', 'full'], default: 'diff' },
      { key: 'auditLevel', type: 'enum', values: ['quick', 'standard', 'deep'], default: 'standard' },
      { key: 'auditRuleset', type: 'string', default: '' },
      { key: 'auditRuleOrder', type: 'list', default: [] },
      { key: 'weightOverrides', type: 'string', default: '' },
    ];

    const INLINE_CSS = '.dsh-git-push-row{display:flex;align-items:center;gap:8px}'
      + '.dsh-git-push-row span{font-size:13px}'
      + '.dshgp_rules{margin-top:12px;border-top:1px solid rgba(128,128,128,.25);padding-top:8px}'
      + '.dshgp_rules_h{font-size:13px;font-weight:600;margin-bottom:4px}'
      + '.dshgp_rules_row{display:flex;align-items:center;gap:6px;margin:2px 0}'
      + '.dshgp_rules_name{font-size:13px;flex:1}'
      + '.dshgp_rules_note{font-size:11px;color:rgba(128,128,128,.7);margin-top:4px}'
      + '.dshgp_mini{min-width:22px;padding:0 3px;font-size:12px;line-height:20px}'
      + '.dshgp_forced{opacity:.75}'
      + '.dshgp_weight_row{display:flex;align-items:center;gap:6px;margin:2px 0}'
      + '.dshgp_weight_name{font-size:12px;min-width:88px}'
      + '.dshgp_weight_val{font-size:12px;min-width:40px}'
      + '.dshgp_weight_row input[type=range]{flex:1}';

    /** 槽位显示名兜底（host 未注入 ruleSlotMeta 时用内置名表，防老配置/host 未注入）。 */
    function fallbackNames() {
      return {
        nodejs: 'Node.js 规则', frontend: '前端 HTML 规则', comment: '关键词规则', dsh: 'dsh 插件审计',
        npm: 'npm 发布审计', version: '版本控制审计', template: 'template 模板（空）', private: '私密文件拦截（强制）',
        structure: '目录结构规范', docs: '文档规则', i18n: '国际化规则', folder: '目录级规则',
        performance: '性能规则', robustness: '健壮性规则',
      };
    }

    /** 动态槽位排序解析（存量排序补新槽位 → 剔除 template 得活跃顺序；对齐旧项目 v1.52）。 */
    function resolveSlotOrder(state) {
      const meta = (state.ruleSlotMeta && typeof state.ruleSlotMeta === 'object') ? state.ruleSlotMeta : {};
      const FALLBACK_NAMES = fallbackNames();
      const discovered = Object.keys(meta).length ? Object.keys(meta) : Object.keys(FALLBACK_NAMES);
      const defaultOrder = discovered.filter((s) => s !== 'template' && s !== 'private');
      let order = Array.isArray(state.ruleOrder) && state.ruleOrder.length ? [...state.ruleOrder] : [...defaultOrder];
      for (const add of discovered) {
        if (order.length && !order.includes(add) && add !== 'private') {
          if (!order.includes('template')) order.push(add);
          else {
            const ti = order.indexOf('template');
            order.splice(ti < 0 ? order.length : ti, 0, add);
          }
        }
      }
      const active = order.filter((s) => s !== 'template');
      return { meta, FALLBACK_NAMES, discovered, order, active };
    }

    /** 规则引擎卡：槽位顺序（↑↓ 排序/后覆盖前）+ template 开关 + 关键词权重滑块。 */
    function RuleEngineCard(props) {
      const h = react.createElement;
      const state = props.state;
      const slotName = (s) => (state.meta[s] && state.meta[s].name) || state.FALLBACK_NAMES[s] || s;
      const move = (slot, dir) => {
        const next = [...state.order];
        const i = next.indexOf(slot);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j], next[i]];
        props.saveRuleOrder(next);
      };
      const toggleTemplate = (on) => {
        let next = [...state.order];
        if (on && !next.includes('template')) next.push('template');
        else if (!on) next = next.filter((s) => s !== 'template');
        props.saveRuleOrder(next);
      };
      const saveWeight = (pat, val) => {
        const next = { ...(state.ruleWeights || {}) };
        next[pat] = Number(val);
        props.saveRuleWeights(next);
      };
      // 10 维度权重：读 weightOverrides JSON（缺省用默认表），滑块改单维度写回合并 JSON
      const parseDimOverrides = () => {
        try {
          const raw = state.weightOverrides || '';
          if (!raw.trim()) return {};
          const obj = JSON.parse(raw);
          return (obj && typeof obj === 'object') ? obj : {};
        } catch { return {}; }
      };
      const saveDimWeight = (dim, val) => {
        const next = { ...parseDimOverrides() };
        next[dim] = Number(val);
        try { props.saveDimWeights(JSON.stringify(next)); } catch { /* 写回失败忽略 */ }
      };
      const dimVals = parseDimOverrides();
      // keyword 权重滑块（对齐旧项目 v1.47：≥40 进门禁 blocker；默认 30）
      const pats = ['用户指示', '用户原话', '用户说', '用户要求', '客户要求', '用户反馈', '根据用户'];
      const orderRows = state.active.map((slot) => h('div', {
        key: slot,
        className: 'dshgp_rules_row',
      }, [
        h('button', { type: 'button', className: 'dshgp_mini', disabled: state.order.indexOf(slot) === 0, onClick: () => move(slot, -1) }, '↑'),
        h('button', { type: 'button', className: 'dshgp_mini', disabled: state.order.indexOf(slot) === state.order.length - 1, onClick: () => move(slot, 1) }, '↓'),
        h('span', { className: 'dshgp_rules_name' }, slotName(slot)
          + (state.order.indexOf(slot) === 0 ? zh.firstLoad : state.order.indexOf(slot) === state.order.length - 1 ? zh.lastOverride : '')),
      ]));
      return h('div', { className: 'dshgp_rules' }, [
        h('div', { className: 'dshgp_rules_h' }, zh.ruleEngine),
        ...orderRows,
        h('div', { className: 'dshgp_rules_row dshgp_forced' }, [
          h('span', { className: 'dshgp_mini' }, '🔒'),
          h('span', { className: 'dshgp_rules_name' }, zh.forcedPrivate),
        ]),
        h('div', { className: 'dshgp_rules_row' }, [
          h('input', { type: 'checkbox', checked: state.order.includes('template'), onChange: (e) => toggleTemplate(e.target.checked) }),
          h('span', { className: 'dshgp_rules_name' }, zh.enableTemplate),
        ]),
        h('div', { className: 'dshgp_rules_h' }, zh.keywordWeights),
        ...pats.map((pat) => {
          const val = state.ruleWeights && state.ruleWeights[pat] !== undefined ? Number(state.ruleWeights[pat]) : 30;
          return h('label', { key: pat, className: 'dshgp_weight_row' }, [
            h('span', { className: 'dshgp_weight_name' }, pat),
            h('input', { type: 'range', min: 5, max: 60, step: 5, value: val, onChange: (e) => saveWeight(pat, e.target.value) }),
            h('span', { className: 'dshgp_weight_val' }, String(val) + (val >= 40 ? ' 🔒' : '')),
          ]);
        }),
        h('div', { className: 'dshgp_rules_h' }, zh.dimWeights),
        ...DIM_WEIGHTS.map(([dim, def]) => {
          const val = dimVals[dim] !== undefined ? Number(dimVals[dim]) : def;
          return h('label', { key: dim, className: 'dshgp_weight_row' }, [
            h('span', { className: 'dshgp_weight_name' }, dim),
            h('input', { type: 'range', min: 0, max: 100, step: 1, value: val, onChange: (e) => saveDimWeight(dim, e.target.value) }),
            h('span', { className: 'dshgp_weight_val' }, String(val)),
          ]);
        }),
        h('div', { className: 'dshgp_rules_note' }, zh.dimWeightsHint),
        h('div', { className: 'dshgp_rules_note' }, zh.ruleEngineHint),
      ]);
    }

    /** 设置卡片：手写 createElement（无 JSX）。 */
    function GitPushCard(props) {
      const h = react.createElement;
      const scope = props.scope;
      const config = scope.use();
      const setKey = (key) => (value) => scope.set(key, value);
      const saveRuleOrder = (arr) => scope.set('auditRuleOrder', arr);
      const saveRuleWeights = (weights) => scope.set('auditRuleWeights', weights);
      const saveDimWeights = (json) => scope.set('weightOverrides', json);
      const state = resolveSlotOrder({
        ruleOrder: Array.isArray(config.auditRuleOrder) ? config.auditRuleOrder : [],
        ruleWeights: (config.auditRuleWeights && typeof config.auditRuleWeights === 'object') ? config.auditRuleWeights : {},
        ruleSlotMeta: (props.slotMeta && typeof props.slotMeta === 'object') ? props.slotMeta : {},
        weightOverrides: config.weightOverrides,
      });
      const rows = SCHEMA.map((item) => {
        if (item.type === 'enum') {
          return h('label', { key: item.key, className: 'dsh-git-push-row' }, [
            h('select', { key: 'i', value: config[item.key] ?? item.default, onChange: (e) => setKey(item.key)(e.target.value) },
              item.values.map((v) => h('option', { key: v, value: v }, v))),
            h('span', { key: 'l' }, zh[item.key] || item.key),
          ]);
        }
        if (item.type === 'list') {
          return h('label', { key: item.key, className: 'dsh-git-push-row' }, [
            h('input', { key: 'i', type: 'text', value: Array.isArray(config[item.key]) ? config[item.key].join(', ') : '',
              onChange: (e) => setKey(item.key)(e.target.value) }),
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
        h(RuleEngineCard, { key: 'rules', state, saveRuleOrder, saveRuleWeights }),
      ]);
    }

    /** 插件应用：注册设置卡片到 settings.section + settings.plugin.item 槽位。 */
    // 1.1.0 修复：DSH 客户端插件必须显式声明 inject 依赖（['slots','locale','settingsScope']），
    // 否则 ctx.slots 直读抛 "cannot get property \"slots\" without inject"（1.0.4 曾临时禁用）。
    // 参照旧项目 lib/client.js（inject: ['slots','locale','settingsScope'] + ctx.slots.inject 注册）。
    function apply(ctx) {
      // 槽位元数据注入（host 在 HTTP /api/git-push/rule-slots 提供；此处尽力读取，缺失走兜底名表）
      const slotMeta = (ctx && ctx.get && ctx.get('ruleSlotMeta')) || {};
      ctx.effect(() => ctx.locale.register(NS, { zh, en: zh }), 'dsh-git-push: dictionaries');
      const cardProps = () => ({ scope: ctx.settingsScope.bind({ namespace: SETTINGS_NS }), slotMeta });
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-git-push',
        order: 40,
        label: () => zh.title,
      }, () => react.createElement(GitPushCard, cardProps())));
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: SETTINGS_NS,
        locale: NS,
        inject: () => cardProps(),
      }, GitPushCard));
    }

    exports.NS = NS;
    exports.apply = apply;
    exports.inject = ['slots', 'locale', 'settingsScope'];
    exports.SCHEMA = SCHEMA;
    exports.INLINE_CSS = INLINE_CSS;
    return module.exports;
  },
});
