/**
 * dsh-git-push v2 设置侧边栏（settings.section 独立页）
 * ============================================================================
 * 2026-09-12 重写（三选项卡版）：
 *   - 纯中文：删 zh/en 键值对字典，用户可见文案直接硬编码中文（产品设计）。
 *   - 三选项卡（对齐插件市场 .tabs/.tab/.on 样式，参考 skill 记分板）：
 *       ① 账号信息（纯展示）：token/SSH 公钥检测 → GitHub 登录态/用户名/套餐
 *       ② 审计：审计开关 + 10 维度权重 + 规则包列表（上下调次序、下覆盖上、
 *          动态加载全部 yml（模板不显示）、规则名后直接显示 描述/作者/拦截/警告/通过 数量、
 *          单击整行切换禁用/启用（auditDisabledSlots，nodejs/private 安全红线不可禁用））
 *       ③ 设置：token / sshkey / 邮箱 + 一键生成（保存按钮在标题右侧、放弃已删）
 *   - 只保留 settings.section 注册；settings.plugin.item（插件配置卡）已删除。
 *
 * ⛔ 形态铁律（client-modules 聚合 bundle 兼容）：
 *   1. window.__ModuleLoader__.load 必须在文件第 1 行。
 *   2. 全部代码在 factory 函数体内，文件顶层【零声明】（防 combo 拼接撞名）。
 *   3. 内部命名专属前缀 dshgp_（防与其他插件同名声明撞名）。
 *   4. 手写 jsx-runtime（jsx/jsxs），禁止 JSX 构建步骤；零外部资源。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-push',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    const jsx = require('react/jsx-runtime');
    const react = require('react');
    const store = require('@deepseek-ai/dsh-client-store');

    const NS = 'git-push';
    const SETTINGS_NS = 'git-push';

    /** 10 维度质量评分权重（合计 100；与 lib/score/index.js DEFAULT_WEIGHTS 一致）。 */
    const dshgp_DIMENSIONS = [
      { key: '可读性', def: 15 },
      { key: '可维护性', def: 15 },
      { key: '健壮性', def: 15 },
      { key: '安全性', def: 18 },
      { key: '性能', def: 10 },
      { key: '测试覆盖', def: 10 },
      { key: '可观测性', def: 5 },
      { key: '可部署性', def: 5 },
      { key: '文档', def: 4 },
      { key: '开发者体验', def: 3 },
    ];

    const dshgp_css = [
      // 选项卡条（对齐插件市场）
      '.dshgp_tabs{display:flex;align-items:flex-end;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2);margin:0 0 12px}',
      '.dshgp_tab{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-bottom:2px solid transparent;padding:7px 12px;font-size:13px}',
      '.dshgp_tab:hover{color:var(--dsw-alias-label-primary)}',
      '.dshgp_tabOn{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}',
      // 区块
      '.dshgp_section{display:flex;flex-direction:column;gap:10px}',
      '.dshgp_block{border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3);padding:12px 14px}',
      '.dshgp_h2{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshgp_desc{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.6;white-space:pre-wrap}',
      '.dshgp_ok{color:var(--dsw-alias-label-primary)}',
      '.dshgp_err{color:var(--dsw-alias-label-error)}',
      // v1 账号块（2026-09-13 完全移植 v1 GitPushAccountTop 显示）
      '.dshgp_top{display:flex;flex-direction:column;gap:6px}',
      '.dshgp_toplabel{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.dshgp_acctblock{white-space:pre-wrap;margin:0;font-size:12px;line-height:1.6;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
      '.dshgp_keybtn{padding:3px 10px;font-size:12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}',
      '.dshgp_keybtn:disabled{opacity:.5;cursor:not-allowed}',
      // 账号信息美化面板（2026-09-13 设计稿落地：渐变卡片 + GitHub 图标 + 状态徽标 + 凭据状态标签）
      '.dshgp_acctpanel{position:relative;overflow:hidden;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:linear-gradient(160deg,var(--dsw-alias-bg-layer-3),var(--dsw-alias-bg-layer-2));padding:14px 14px 12px}',
      '.dshgp_acctpanel::before{content:"";position:absolute;inset:0;background:radial-gradient(420px 140px at 15% -20%,color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent),transparent 70%),radial-gradient(300px 120px at 95% 115%,color-mix(in srgb,var(--dsw-alias-label-success) 10%,transparent),transparent 70%);pointer-events:none}',
      '.dshgp_accthead{position:relative;display:flex;align-items:center;gap:10px}',
      '.dshgp_acctic{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent),color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent));border:.5px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 25%,transparent);color:var(--dsw-alias-brand-primary)}',
      '.dshgp_accttitle{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshgp_acctsub{margin:2px 0 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.dshgp_acctstat{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}',
      '.dshgp_acctstat_ok{background:color-mix(in srgb,var(--dsw-alias-label-success) 14%,transparent);color:var(--dsw-alias-label-success)}',
      '.dshgp_acctstat_warn{background:color-mix(in srgb,var(--dsw-alias-label-warning) 14%,transparent);color:var(--dsw-alias-label-warning)}',
      '.dshgp_acctstat_err{background:color-mix(in srgb,var(--dsw-alias-label-error) 14%,transparent);color:var(--dsw-alias-label-error)}',
      '.dshgp_acctdot{width:6px;height:6px;border-radius:50%;background:currentColor}',
      '.dshgp_acctblock2{position:relative;margin:12px 0 0;padding:11px 13px;border-radius:12px;font-size:12px;line-height:1.7;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border:.5px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent);color:var(--dsw-alias-label-primary)}',
      '.dshgp_acctblock2_ok{border-color:color-mix(in srgb,var(--dsw-alias-label-success) 30%,transparent)}',
      '.dshgp_acctblock2_err{border-color:color-mix(in srgb,var(--dsw-alias-label-error) 30%,transparent);color:var(--dsw-alias-label-error)}',
      '.dshgp_acctblock2_loading{color:var(--dsw-alias-label-secondary)}',
      '.dshgp_acctmeta{position:relative;display:flex;flex-direction:column;gap:5px;margin:9px 0 0}',
      '.dshgp_acctmetarow{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dshgp_acctmetak{color:var(--dsw-alias-label-tertiary);min-width:64px}',
      '.dshgp_pill{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px}',
      '.dshgp_pill_on{background:color-mix(in srgb,var(--dsw-alias-label-success) 14%,transparent);color:var(--dsw-alias-label-success)}',
      '.dshgp_pill_off{background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 14%,transparent);color:var(--dsw-alias-label-secondary)}',
      '.dshgp_acctfoot{position:relative;display:flex;align-items:center;justify-content:space-between;margin-top:10px}',
      '.dshgp_accthint{font-size:10px;color:var(--dsw-alias-label-tertiary)}',
      // 已填写徽标（token/SSH 配置后提示，不显示内容）
      '.dshgp_configured{margin-left:6px;border-radius:999px;padding:1px 8px;font-size:10px;background:color-mix(in srgb,var(--dsw-alias-label-success) 14%,transparent);color:var(--dsw-alias-label-success);white-space:nowrap}',
      // 开关行
      '.dshgp_switchrow{display:flex;align-items:center;justify-content:space-between;gap:10px}',
      '.dshgp_switchlabel{font-size:13px;color:var(--dsw-alias-label-primary)}',
      /* 子开关：缩进显示从属关系；父开关关闭时整体置灰且不可点 */
      '.dshgp_subswitch{padding-left:18px;margin-top:2px}',
      '.dshgp_subswitchOff{opacity:.45}',
      '.dshgp_subswitchOff .dshgp_switchlabel{cursor:not-allowed}',
      '.dshgp_subswitchOff input{cursor:not-allowed}',
      // 输入
      '.dshgp_input{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:32px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:13px;width:100%;box-sizing:border-box}',
      '.dshgp_textarea{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 10px;font-size:12px;width:100%;box-sizing:border-box;resize:vertical;min-height:56px}',
      '.dshgp_field{margin:0 0 8px}',
      '.dshgp_label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary);display:block;margin-bottom:4px}',
      '.dshgp_hint{margin:2px 0 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      // 按钮
      '.dshgp_btn{font:inherit;font-size:12px;border-radius:8px;padding:5px 10px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dshgp_btn:disabled{opacity:.45;cursor:default}',
      '.dshgp_btnPrimary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      // 审计扫描范围单按钮（2026-09-14）：一个按钮单击切换 diff/full，状态体现在标题 + 颜色
      '.dshgp_scanbtn{font:inherit;font-size:12px;border-radius:8px;padding:5px 12px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);display:inline-flex;align-items:center;gap:6px;transition:border-color .15s,color .15s,background-color .15s}',
      '.dshgp_scanbtn:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.dshgp_scanbtnDiff{color:var(--dsw-alias-label-success);border-color:color-mix(in srgb,var(--dsw-alias-label-success) 55%,transparent)}',
      '.dshgp_scanbtnFull{border-color:color-mix(in srgb,var(--dsw-alias-label-warning) 55%,transparent);color:var(--dsw-alias-label-warning);background:color-mix(in srgb,var(--dsw-alias-label-warning) 8%,transparent)}',
      '.dshgp_scanbtnOff{opacity:.45;cursor:not-allowed}',
      '.dshgp_foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}',
      // 权重
      '.dshgp_weightrow{display:flex;align-items:center;gap:8px;margin:3px 0}',
      '.dshgp_weightkey{flex:1;font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.dshgp_weightinput{width:64px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:26px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:6px;padding:0 6px;font-size:12px;text-align:right}',
      '.dshgp_weighttotal{margin:6px 0 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      // 规则包列表
      // 规则包列表（2026-09-13 榜单样式：模仿 skill 记分榜 表头行 + 定宽右对齐列 + hover）
      '.dshgp_rulenext{list-style:none;margin:0;padding:0;border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}',
      '.dshgp_ruleheadrow{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.dshgp_rulerow{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:13px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
      '.dshgp_rulerow:last-child{border-bottom:0}',
      '.dshgp_rulerow:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshgp_mini{font:inherit;font-size:12px;border:0;background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:1px 5px;border-radius:4px}',
      '.dshgp_mini:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dshgp_mini:disabled{opacity:.3;cursor:default}',
      '.dshgp_ruleinfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.dshgp_ruleheadrowinfo{flex:1;min-width:0}',
      '.dshgp_rulename{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
      '.dshgp_rulemeta{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.dshgp_rulecount{flex-shrink:0;width:56px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}',
      '.dshgp_rulecountRed{flex-shrink:0;width:56px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-error)}',
      '.dshgp_rulecountYellow{flex-shrink:0;width:56px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-warning)}',
      '.dshgp_rulecountGreen{flex-shrink:0;width:56px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-success)}',
      '.dshgp_rulebadge{flex-shrink:0;width:48px;text-align:right}',
      '.dshgp_badge{border-radius:999px;padding:1px 8px;font-size:10px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dshgp_badgeRed{background:color-mix(in srgb,var(--dsw-alias-label-error) 14%,transparent);color:var(--dsw-alias-label-error)}',
      '.dshgp_badgeYellow{background:color-mix(in srgb,var(--dsw-alias-label-warning) 14%,transparent);color:var(--dsw-alias-label-warning)}',
      '.dshgp_badgeGreen{background:color-mix(in srgb,var(--dsw-alias-label-success) 14%,transparent);color:var(--dsw-alias-label-success)}',
      // 规则明细表格（对齐记分榜表格）
      '.dshgp_table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}',
      '.dshgp_table th{text-align:left;font-weight:600;color:var(--dsw-alias-label-secondary);padding:4px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:11px}',
      '.dshgp_table td{padding:5px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);vertical-align:top}',
      '.dshgp_table tr:last-child td{border-bottom:none}',
      '.dshgp_tdname{font-weight:500}',
      '.dshgp_tddesc{color:var(--dsw-alias-label-secondary)}',
      '.dshgp_tdsev{white-space:nowrap}',
      // 统计条
      '.dshgp_stats{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 4px}',
      '.dshgp_loading{padding:12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      // 2026-09-13：启用/禁用底色加强 + 左侧色条，状态一眼可辨。
      //   启用 = 绿底 + 绿左条；禁用 = 红底 + 红左条（禁用行不再整体降透明度，保持可读）。
      '.dshgp_rowOn{background:color-mix(in srgb,var(--dsw-alias-label-success) 13%,transparent);border-left:3px solid var(--dsw-alias-label-success)}',
      '.dshgp_rowOff{background:color-mix(in srgb,var(--dsw-alias-label-error) 15%,transparent);border-left:3px solid var(--dsw-alias-label-error)}',
      // 行内浮层 tooltip（悬停显示详细信息：描述/作者/统计口径）——不占布局、不推挤下方行。
      '.dshgp_ruleinfo{position:relative}',
      '.dshgp_hovercard{display:none;position:absolute;left:0;top:100%;z-index:40;min-width:260px;max-width:420px;margin-top:6px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 6px 20px rgba(0,0,0,.18);font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:normal}',
      '.dshgp_ruleinfo:hover .dshgp_hovercard{display:block}',
      '.dshgp_hoverTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:2px}',
      '.dshgp_hoverRow{margin-top:2px}',
      // 启停按钮（行内唯一可点击切换状态的位置）——绿/红实色胶囊，一眼看出点它会切到哪一侧
      '.dshgp_powerBtn{flex-shrink:0;font:inherit;font-size:11px;border:.5px solid transparent;border-radius:999px;padding:2px 10px;cursor:pointer;white-space:nowrap}',
      '.dshgp_powerOn{background:var(--dsw-alias-label-success);color:#fff}',
      '.dshgp_powerOff{background:var(--dsw-alias-label-error);color:#fff}',
      '.dshgp_powerBtn:disabled{opacity:.45;cursor:default}',
      '.dshgp_powerBtn:hover:not(:disabled){filter:brightness(1.08)}',
      '.dshgp_error{margin:8px 0 0;font-size:12px;color:var(--dsw-alias-label-error)}',
      '.dshgp_saved{margin:6px 0 0;font-size:12px;color:var(--dsw-alias-label-success)}',
      // 2026-09-14 账号卡片：本地/云端（仓库管理）
      '.dshgp_repocard{position:relative;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3);padding:10px 12px 12px}',
      '.dshgp_suptabs{display:flex;gap:2px;border-bottom:.5px solid var(--dsw-alias-border-l2);margin:0 0 10px}',
      '.dshgp_suptab{font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-bottom:2px solid transparent;padding:5px 14px}',
      '.dshgp_suptabOn{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.dshgp_repanepane{display:flex;flex-direction:column;gap:8px}',
      '.dshgp_repobar{display:flex;align-items:center;gap:8px}',
      '.dshgp_pickinput{flex:1;min-width:0;font:inherit;font-size:12px;padding:5px 9px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.dshgp_repohint{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.dshgp_repomsg{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.5}',
      '.dshgp_pushcol{display:flex;flex-direction:column;align-items:flex-end;gap:3px;max-width:46%;min-width:100px}',
      '.dshgp_fb{font-size:11px;line-height:1.35;word-break:break-all;text-align:right}',
      '.dshgp_fbok{color:#2fa84f}',
      '.dshgp_fbfail{color:#d64545}',
      '.dshgp_replist{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow-y:auto}',
      '.dshgp_reprow{display:flex;align-items:center;gap:8px;padding:7px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent)}',
      '.dshgp_reprowinfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.dshgp_reprowpath{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
      '.dshgp_reprowmeta{font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all}',
      '.dshgp_browsebtn{flex-shrink:0;font-size:12px;padding:4px 8px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}',
      // 目录选择弹窗（移植 gbmd path-picker：一行接入 📂 按钮）
      '.dshgp_browsemask{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4)}',
      '.dshgp_browsedialog{width:min(480px,88vw);max-height:70vh;display:flex;flex-direction:column;gap:8px;padding:14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:14px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 12px 40px rgba(0,0,0,.35)}',
      '.dshgp_browsehead{display:flex;align-items:center;justify-content:space-between}',
      '.dshgp_browsetitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshgp_browseclose{font:inherit;font-size:13px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;padding:2px 6px}',
      '.dshgp_browsepath{font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base)}',
      '.dshgp_browseup{font-size:12px;color:var(--dsw-alias-brand-primary);cursor:pointer;padding:3px 2px}',
      '.dshgp_browselist{flex:1;min-height:120px;max-height:38vh;overflow-y:auto;display:flex;flex-direction:column;gap:2px}',
      '.dshgp_browsedir{font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer;padding:5px 8px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dshgp_browsedir:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}',
      '.dshgp_browsehint{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:8px}',
      '.dshgp_browsefoot{display:flex;justify-content:flex-end}',
    ].join('');

    function dshgp_ensureCss() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css="dsh-git-push"]')) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-git-push';
      tag.dataset.pluginCss = 'dsh-git-push';
      tag.textContent = dshgp_css;
      document.head.appendChild(tag);
    }

    /** fetch 封装：GET JSON（same-origin）。 */
    async function dshgp_getJson(url) {
      const res = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(30_000) });
      return res.json();
    }
    /** fetch 封装：POST JSON（same-origin）。 */
    async function dshgp_postJson(url, payload) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        credentials: 'same-origin',
        signal: AbortSignal.timeout(30_000),
      });
      return res.json();
    }

    /**
     * token 是否已配置：优先用 host 派生的布尔位。
     * 2026-09-13：githubToken 标了 role('secret')，远端读不下发明文 → 设置快照里该字段为空，
     *   旧写法（看 githubToken 真值）会永远判成「未配置」。故改为优先读 status 给的
     *   tokenConfigured，明文仍在时（旧 host / 未脱敏环境）沿用旧判断兜底。
     */
    function dshgp_tokenConfigured(value) {
      var v = value || {};
      if (v.tokenConfigured === true) return true;
      return !!(v.githubToken && String(v.githubToken).trim());
    }

    /** 复制文本到剪贴板（优先 Clipboard API，兜底 execCommand）。 */
    function dshgp_copyText(text) {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(String(text || ''));
      }
      return Promise.resolve();
    }

    /* ═══════════════════ 选项卡一：账号信息（2026-09-13 美化版：渐变卡片 + GitHub 图标 + 状态徽标） ═══════════════════ */
    const dshgp_ghIcon = jsx.jsx('svg', {
      width: '22', height: '22', viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: '1.8', strokeLinecap: 'round', strokeLinejoin: 'round',
      children: jsx.jsx('path', { d: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22' }),
    });
    const dshgp_refreshIcon = jsx.jsx('svg', {
      width: '13', height: '13', viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round',
      children: jsx.jsx('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6' }),
    });
    /** 账号卡片头部：GitHub 图标 + 标题 + 状态徽标。 */
    function dshgp_AcctHead(props) {
      return jsx.jsxs('div', {
        className: 'dshgp_accthead',
        children: [
          jsx.jsx('div', { className: 'dshgp_acctic', children: dshgp_ghIcon }),
          jsx.jsxs('div', {
            children: [
              jsx.jsx('p', { className: 'dshgp_accttitle', children: 'GitHub 账号' }),
              jsx.jsx('p', { className: 'dshgp_acctsub', children: 'Token / SSH 公钥检测结果 · 进入设置自动检测' }),
            ],
          }),
          jsx.jsxs('span', { className: 'dshgp_acctstat ' + props.statCls, children: [jsx.jsx('span', { className: 'dshgp_acctdot' }), props.statTxt] }),
        ],
      });
    }

    /** 账号卡片（渐变面板）渲染：头部 + 状态块 + 凭据标签 + 刷新按钮。 */
    function dshgp_AccountCard(props) {
      const s = props.state;
      const loggedIn = !!s.accountLoggedIn;
      const loading = !!s.accountLoading;
      const statCls = loggedIn ? 'dshgp_acctstat_ok' : (loading ? 'dshgp_acctstat_warn' : 'dshgp_acctstat_err');
      const statTxt = loggedIn ? '已连接' : (loading ? '检测中' : '未连接');
      const blockCls = loggedIn ? 'dshgp_acctblock2_ok' : (loading ? 'dshgp_acctblock2_loading' : 'dshgp_acctblock2_err');
      const blockBody = s.accountBlock
        ? s.accountBlock
        : (loading ? '正在检测 Token / SSH 公钥…' : '未配置 Token / SSH 公钥——请到「设置」选项卡填写凭据');
      const tokenPill = s.tokenConfigured
        ? jsx.jsx('span', { className: 'dshgp_pill dshgp_pill_on', children: '已配置' })
        : jsx.jsx('span', { className: 'dshgp_pill dshgp_pill_off', children: '未配置' });
      const sshPill = s.sshConfigured
        ? jsx.jsx('span', { className: 'dshgp_pill dshgp_pill_on', children: '已配置' })
        : jsx.jsx('span', { className: 'dshgp_pill dshgp_pill_off', children: '未配置' });
      return jsx.jsxs('div', {
        className: 'dshgp_acctpanel',
        children: [
          jsx.jsx(dshgp_AcctHead, { statCls, statTxt }),
          jsx.jsx('pre', { className: 'dshgp_acctblock2 ' + blockCls, children: blockBody }),
          jsx.jsxs('div', {
            className: 'dshgp_acctmeta',
            children: [
              jsx.jsxs('div', { className: 'dshgp_acctmetarow', children: [jsx.jsx('span', { className: 'dshgp_acctmetak', children: 'Token' }), tokenPill] }),
              jsx.jsxs('div', { className: 'dshgp_acctmetarow', children: [jsx.jsx('span', { className: 'dshgp_acctmetak', children: 'SSH 公钥' }), sshPill] }),
            ],
          }),
          jsx.jsxs('div', {
            className: 'dshgp_acctfoot',
            children: [
              jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_keybtn',
                disabled: loading,
                onClick: props.refreshAccount,
                children: [dshgp_refreshIcon, loading ? '检测中…' : '重新检测'],
              }),
              jsx.jsx('span', { className: 'dshgp_accthint', children: loggedIn ? '登录态有效，凭据已生效' : '凭据状态来自保存的 Token / SSH 公钥' }),
            ],
          }),
        ],
      });
    }

    /** 选项卡一：账号信息（2026-09-14 拆卡片：渐变面板 AccountCard + 本地/云端 RepoManagerCard）。 */
    function dshgp_AccountTab(props) {
      return jsx.jsxs('div', {
        className: 'dshgp_section',
        children: [
          jsx.jsx(dshgp_AccountCard, props),
          // 2026-09-14 账号卡片：本地/云端 仓库管理（本地扫描可手动指定路径 / 云端列表可 clone）
          jsx.jsx(dshgp_RepoManagerCard, props),
        ],
      });
    }

    /* ═══════════════════ 目录选择弹窗（2026-09-14 移植 gamebanana-mods-downloader 的 path-picker 小模块：一行接入 📂 按钮） ═══════════════════ */
    let dshgp_browseTarget = null; // 当前打开的输入框（null = 走 onPick 回调）
    let dshgp_browseOpt = null;    // { onPick } 确认回调（clone 场景）
    let dshgp_browsePath = '';     // 弹窗当前所在目录
    function dshgp_browseEnsureDom() {
      if (typeof document === 'undefined' || document.getElementById('dshgp-browse-mask')) return;
      const mask = document.createElement('div');
      mask.id = 'dshgp-browse-mask';
      mask.className = 'dshgp_browsemask';
      mask.style.display = 'none';
      mask.innerHTML = ''
        + '<div class="dshgp_browsedialog">'
        + '<div class="dshgp_browsehead"><span class="dshgp_browsetitle">选择目录</span><button type="button" class="dshgp_browseclose" id="dshgp-browse-close">✕</button></div>'
        + '<div class="dshgp_browsepath" id="dshgp-browse-crumb"></div>'
        + '<div class="dshgp_browseup" id="dshgp-browse-up">⬆ 上级目录</div>'
        + '<div class="dshgp_browselist" id="dshgp-browse-list"></div>'
        + '<div class="dshgp_browsefoot"><button type="button" class="dshgp_keybtn" id="dshgp-browse-ok">选择当前目录</button></div>'
        + '</div>';
      document.body.appendChild(mask);
      mask.addEventListener('click', (e) => { if (e.target === mask) dshgp_browseClose(); });
      document.getElementById('dshgp-browse-close').addEventListener('click', dshgp_browseClose);
      document.getElementById('dshgp-browse-up').addEventListener('click', () => {
        const up = document.getElementById('dshgp-browse-up');
        if (up && up.dataset.path) dshgp_browseLoad(up.dataset.path);
      });
      document.getElementById('dshgp-browse-ok').addEventListener('click', () => {
        const onPick = dshgp_browseOpt;
        const target = dshgp_browseTarget;
        dshgp_browseClose();
        if (onPick) onPick(dshgp_browsePath);
        else if (target) target.value = dshgp_browsePath;
      });
    }
    function dshgp_browseGuess() {
      try { return window.localStorage.getItem('dshgp-browse-path') || ''; } catch { return ''; }
    }
    function dshgp_browseRemember(p) {
      try { if (p) window.localStorage.setItem('dshgp-browse-path', p); } catch { /* localStorage 不可用 */ }
    }
    async function dshgp_browseLoad(p) {
      const list = document.getElementById('dshgp-browse-list');
      const crumb = document.getElementById('dshgp-browse-crumb');
      const up = document.getElementById('dshgp-browse-up');
      if (!list || !crumb) return;
      crumb.textContent = '读取中…';
      let data;
      try { data = await dshgp_getJson('/api/git-push/browse?path=' + encodeURIComponent(String(p || ''))); }
      catch (e) { crumb.textContent = '读取失败: ' + (e && e.message || e); return; }
      if (!data || !data.ok) { crumb.textContent = (data && data.error) || '读取失败'; return; }
      dshgp_browsePath = data.path;
      dshgp_browseRemember(data.path);
      crumb.textContent = data.path;
      up.style.display = data.parent ? 'block' : 'none';
      up.dataset.path = data.parent || '';
      let html = '';
      if (!data.dirs.length) html += '<div class="dshgp_browsehint">（无子目录）</div>';
      (data.dirs || []).forEach((d) => {
        const full = data.path === '/' ? '/' + d : data.path + '/' + d;
        html += '<div class="dshgp_browsedir" data-path="' + String(full).replace(/"/g, '&quot;') + '">📁 ' + String(d).replace(/</g, '&lt;') + '</div>';
      });
      list.innerHTML = html;
      list.querySelectorAll('.dshgp_browsedir').forEach((el) => {
        el.addEventListener('click', () => dshgp_browseLoad(el.dataset.path));
      });
    }
    function dshgp_browseOpen(input, onPick) {
      if (typeof document === 'undefined') return;
      dshgp_browseTarget = input || null;
      dshgp_browseOpt = onPick || null;
      dshgp_browseEnsureDom();
      const mask = document.getElementById('dshgp-browse-mask');
      mask.style.display = 'flex';
      void dshgp_browseLoad(dshgp_browseGuess());
    }
    function dshgp_browseClose() {
      if (typeof document === 'undefined') return;
      const mask = document.getElementById('dshgp-browse-mask');
      if (mask) mask.style.display = 'none';
      dshgp_browseTarget = null;
      dshgp_browseOpt = null;
    }
    function dshgp_browseAttach(inputEl) {
      if (!inputEl || inputEl.dataset.dshgpBrowse) return; // 幂等
      inputEl.dataset.dshgpBrowse = '1';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dshgp_browsebtn';
      btn.textContent = '📂';
      btn.title = '选择目录';
      btn.addEventListener('click', () => dshgp_browseOpen(inputEl, null));
      inputEl.insertAdjacentElement('afterend', btn);
    }

    /* ═══════════════════ 账号卡片：本地/云端 仓库管理（2026-09-14） ═══════════════════ */
    function dshgp_RepoManagerCard(props) {
      const s = props.state;
      const [view, setView] = react.useState('local');
      // 每次渲染后为路径输入框挂 📂 按钮（attach 幂等）
      react.useEffect(() => {
        const el = document.getElementById('dshgp-local-path');
        if (el) dshgp_browseAttach(el);
      });
      const subTabs = [
        { id: 'local', label: '本地' },
        { id: 'cloud', label: '云端' },
      ];
      return jsx.jsxs('div', {
        className: 'dshgp_repocard',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_suptabs',
            children: subTabs.map((t) => jsx.jsxs('button', {
              key: t.id,
              type: 'button',
              className: view === t.id ? 'dshgp_suptab dshgp_suptabOn' : 'dshgp_suptab',
              onClick: () => setView(t.id),
              children: [t.label],
            })),
          }),
          view === 'local'
            ? jsx.jsx(dshgp_RepoLocalPane, props)
            : jsx.jsx(dshgp_RepoCloudPane, props),
        ],
      });
    }

    /** 本地面板单行：路径 + 分支/领先状态 + push 按钮（领先远端可点；工作树未提交改动无影响）。 */
    function dshgp_RepoLocalRow(props) {
      const r = props.repo;
      const s = props.state;
      const busy = s.repoBusy === 'push:' + r.path;
      // 2026-09-15 修正「推送判定写反」：可推 = 有远端 + 有未推送提交。
      //   ahead>0 → 本地有领先提交，按钮亮；ahead=null → 状态未知（未 fetch/首次推送），
      //   交给后端 ls-remote 精确判定，允许点；ahead=0 → 已同步、没有可推的新提交，灰。
      //   原实现用 `changed === 0`（工作树干净）当可推条件，方向反了：
      //   github push 推的是已提交内容，工作树脏不脏无影响——把「有领先提交但工作树脏」的
      //   仓库拦死（能推的不让推），又把「已同步无新提交」的仓库点亮（不能推的按钮才能点）。
      const canPush = !!r.hasRemote && (r.ahead === null || r.ahead > 0);
      // 2026-09-14 语义纠正：stat 只体现「远端有无」与领先关系；有远端但本地
      //   未 fetch/无同名分支（无法比较）时显示「远端状态未知」，不称上游
      const stat = !r.hasRemote ? '无远端' : (r.ahead === null ? '远端状态未知' : (r.ahead > 0 ? '领先 ' + r.ahead : (r.behind > 0 ? '落后 ' + r.behind : '同步')));
      // 2026-09-14 联动仓库索引：本地无 remote/上游时也能显示它的 GitHub 归属
      const idx = r.indexed;
      const idxTag = idx ? ' · 🔗 索引 ' + (idx.owner ? idx.owner + '/' + idx.repo : idx.repo) + '(' + idx.visibility + ')' : '';
      return jsx.jsxs('div', {
        className: 'dshgp_reprow',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_reprowinfo',
            children: [
              jsx.jsx('span', { className: 'dshgp_reprowpath', title: r.path, children: String(r.path).split('/').pop() || r.path }),
              jsx.jsx('span', { className: 'dshgp_reprowmeta', children: ['分支 ' + r.branch + ' · ' + stat + idxTag + (r.changed > 0 ? ' · 未提交 ' + r.changed : '') + (r.lastCommit ? ' · ' + r.lastCommit : '')] }),
            ],
          }),
          jsx.jsxs('div', {
            className: 'dshgp_pushcol',
            children: [
              jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_keybtn',
                disabled: !canPush || busy,
                onClick: () => props.onPush(r.path),
                children: busy ? '推送中…' : 'push',
              }),
              (s.repoFeedback && s.repoFeedback[r.path])
                ? jsx.jsx('span', { className: s.repoFeedback[r.path].ok ? 'dshgp_fb dshgp_fbok' : 'dshgp_fb dshgp_fbfail', children: s.repoFeedback[r.path].msg })
                : null,
            ],
          }),
        ],
      });
    }

    /** 本地面板：默认扫描工作区目录，可手动指定路径（📂 选择器）；仓库领先 + 无未提交改动可手动 push。 */
    function dshgp_RepoLocalPane(props) {
      const s = props.state;
      const rows = (s.localRepos || []).map((r) => jsx.jsx(dshgp_RepoLocalRow, { key: r.path, repo: r, state: s, onPush: props.pushLocalRepo }));
      return jsx.jsxs('div', {
        className: 'dshgp_repanepane',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_repobar',
            children: [
              jsx.jsx('input', {
                id: 'dshgp-local-path',
                type: 'text',
                className: 'dshgp_pickinput',
                placeholder: '扫描路径（默认 DSH 家根）',
                defaultValue: typeof window !== 'undefined' && window.localStorage ? (window.localStorage.getItem('dshgp-scan-path') || '') : '',
              }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_keybtn',
                disabled: s.localLoading,
                onClick: () => {
                  const el = document.getElementById('dshgp-local-path');
                  props.scanLocalRepos(el ? el.value : '');
                },
                children: s.localLoading ? '扫描中…' : '扫描',
              }),
            ],
          }),
          jsx.jsx('p', { className: 'dshgp_repomsg', children: s.localMsg || '扫描目录下的 git 仓库；仓库「领先远端（有未推送提交）」时可手动 push（工作树未提交改动不影响 push，推的是已提交内容）' }),
          rows.length ? jsx.jsxs('div', { className: 'dshgp_replist', children: rows }) : null,
        ],
      });
    }

    /** 云端面板单行：仓库名 + 私有/公开/分支/更新时间 + clone 按钮。 */
    function dshgp_RepoCloudRow(props) {
      const r = props.repo;
      const s = props.state;
      const busy = s.repoBusy === 'clone:' + r.fullName;
      return jsx.jsxs('div', {
        className: 'dshgp_reprow',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_reprowinfo',
            children: [
              jsx.jsx('span', { className: 'dshgp_reprowpath', children: r.fullName }),
              jsx.jsx('span', { className: 'dshgp_reprowmeta', children: [(r.private ? '🔒 私有' : '🌐 公开') + ' · ' + (r.defaultBranch || '') + (r.pushedAt ? ' · 更新 ' + r.pushedAt.slice(0, 10) : '')] }),
            ],
          }),
          jsx.jsx('button', {
            type: 'button',
            className: 'dshgp_keybtn',
            disabled: busy,
            onClick: () => props.onClone(r.fullName),
            children: busy ? '克隆中…' : 'clone',
          }),
        ],
      });
    }

    /** 云端面板：账号名下所有 GitHub 仓库（token 拉取），clone 时弹目录选择器选目标目录。 */
    function dshgp_RepoCloudPane(props) {
      const s = props.state;
      const rows = (s.cloudRepos || []).map((r) => jsx.jsx(dshgp_RepoCloudRow, { key: r.fullName, repo: r, state: s, onClone: props.cloneFlow }));
      return jsx.jsxs('div', {
        className: 'dshgp_repanepane',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_repobar',
            children: [
              jsx.jsx('span', { className: 'dshgp_repohint', children: '账号名下仓库（按最近更新）' }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_keybtn',
                disabled: s.cloudLoading,
                onClick: () => props.loadCloudRepos(),
                children: s.cloudLoading ? '加载中…' : '加载仓库列表',
              }),
            ],
          }),
          jsx.jsx('p', { className: 'dshgp_repomsg', children: s.cloudMsg || '点仓库行的 clone，弹出目录选择器选定目标目录后克隆' }),
          rows.length ? jsx.jsxs('div', { className: 'dshgp_replist', children: rows }) : null,
        ],
      });
    }

    /* ═══════════════════ 选项卡二：审计 ═══════════════════ */
    /** 10 维度权重行（值来自 state.weightValues，改即写回 weightOverrides JSON）。 */
    function dshgp_WeightRows(props) {
      const s = props.state;
      const rows = dshgp_DIMENSIONS.map((d) => jsx.jsxs('div', {
        key: d.key,
        className: 'dshgp_weightrow',
        children: [
          jsx.jsx('span', { className: 'dshgp_weightkey', children: d.key }),
          jsx.jsx('input', {
            type: 'number', min: 0, max: 100,
            className: 'dshgp_weightinput',
            value: s.weightValues[d.key] != null ? s.weightValues[d.key] : d.def,
            onChange: (ev) => props.editWeight(d.key, Number(ev.target.value) || 0),
          }),
          jsx.jsx('span', { className: 'dshgp_rulemeta', children: '默认 ' + d.def }),
        ],
      }));
      const total = dshgp_DIMENSIONS.reduce((a, d) => a + (s.weightValues[d.key] != null ? s.weightValues[d.key] : d.def), 0);
      return jsx.jsxs('div', {
        children: [
          rows,
          jsx.jsx('p', { className: 'dshgp_weighttotal', children: '合计 ' + total + '（建议 100；保存后下次审计生效）' }),
        ],
      });
    }

    /**
     * 规则包行（2026-09-13 交互改版）：
     *   ① 详细信息改为**悬停浮层**（.dshgp_hovercard，悬停行内信息区显示描述/作者/统计口径），
     *      常显只留「名称 + 拦截/警告/通过」——不再占用行高、不推挤列表。
     *   ② 启用/禁用**只由行尾的启停按钮**触发（.dshgp_powerBtn）；整行不再可点击切换，
     *      避免想拖选/看详情时误触状态。
     *   ③ 状态底色：启用 = 绿底 + 绿左条，禁用 = 红底 + 红左条（见 CSS .dshgp_rowOn/.dshgp_rowOff）。
     * 其余：↑↓ 调次序；nodejs/private 为安全红线锁定不可禁用。
     */
    function dshgp_RuleRow(props, slot, idx, len) {
      const s = props.state;
      const meta = (s.slotMeta && s.slotMeta[slot]) || {};
      const name = meta.name || slot;
      const author = meta.author || '';
      const stats = (meta && meta.stats) || { blocker: 0, warning: 0, pass: 0, total: 0, source: 'rules' };
      // 数字口径随 stats.source 区分——'audit' = 最近一次审计的实际命中数
      //   （拦截/警告 = 命中的问题数，通过 = 没查出问题的规则数）；'rules' = 未审计时的规则条数口径。
      const fromAudit = stats.source === 'audit';
      const countTitle = (kind) => (fromAudit
        ? `${name} 在最近一次审计中命中 ${kind} ${kind === '拦截' ? stats.blocker : (kind === '警告' ? stats.warning : stats.pass)} 条（共 ${stats.total} 条规则）`
        : `${name} 共 ${stats.total} 条规则（${kind} 条 ${kind === '拦截' ? stats.blocker : (kind === '警告' ? stats.warning : stats.pass)}）——跑一次审计后显示命中数`);
      // 禁用态 = yml 顶层 disabled（后端 listRuleSlots 解析）；点击即时反馈靠 toggleDisabled
      //   本地翻转 slotMeta，loadSlots 对账 yml 真实状态。
      const disabled = !!meta.disabled;
      const locked = slot === 'nodejs' || slot === 'private';
      const move = (dir) => props.moveSlot(slot, dir);
      // 悬停浮层内容：描述/作者/统计口径说明（原常显 meta 行移到这里）
      const hoverCard = jsx.jsxs('div', {
        className: 'dshgp_hovercard',
        children: [
          jsx.jsx('div', { className: 'dshgp_hoverTitle', children: name }),
          author ? jsx.jsx('div', { className: 'dshgp_hoverRow', children: '作者: ' + author }) : null,
          meta.description ? jsx.jsx('div', { className: 'dshgp_hoverRow', children: meta.description }) : null,
          jsx.jsx('div', {
            className: 'dshgp_hoverRow',
            children: fromAudit
              ? `最近一次审计命中：拦截 ${stats.blocker} · 警告 ${stats.warning} · 未命中规则 ${stats.pass}（共 ${stats.total} 条规则）`
              : `规则条数口径：拦截 ${stats.blocker} · 警告 ${stats.warning} · 规则 ${stats.pass}（共 ${stats.total} 条）——跑一次审计后显示命中数`,
          }),
          jsx.jsx('div', { className: 'dshgp_hoverRow', children: locked ? '安全红线：nodejs/private 不可禁用' : (disabled ? '当前禁用——点右侧按钮启用' : '当前启用——点右侧按钮禁用') }),
        ],
      });
      // 启停按钮：行内唯一可切换状态的位置（整行 onClick 已移除）
      const powerBtn = jsx.jsx('button', {
        type: 'button',
        className: 'dshgp_powerBtn ' + (disabled ? 'dshgp_powerOff' : 'dshgp_powerOn'),
        disabled: locked,
        onClick: (ev) => { ev.stopPropagation(); props.toggleDisabled(slot); },
        title: locked ? 'nodejs/private 安全红线，不可禁用' : (disabled ? '点击启用该规则包' : '点击禁用该规则包'),
        'aria-label': (disabled ? '启用规则包 ' : '禁用规则包 ') + name,
        'aria-pressed': !disabled,
        children: disabled ? '禁用' : '启用',
      });
      return jsx.jsxs('li', {
        key: slot,
        className: 'dshgp_rulerow ' + (disabled ? 'dshgp_rowOff' : 'dshgp_rowOn'),
        children: [
          jsx.jsx('button', { type: 'button', className: 'dshgp_mini', disabled: idx === 0, onClick: (ev) => { ev.stopPropagation(); move(-1); }, 'aria-label': name + ' 上移', children: '↑' }),
          jsx.jsx('button', { type: 'button', className: 'dshgp_mini', disabled: idx === len - 1, onClick: (ev) => { ev.stopPropagation(); move(1); }, 'aria-label': name + ' 下移', children: '↓' }),
          jsx.jsxs('div', {
            className: 'dshgp_ruleinfo',
            children: [
              jsx.jsx('span', { className: 'dshgp_rulename', children: name }),
              hoverCard,
            ],
          }),
          jsx.jsx('span', { className: 'dshgp_rulecountRed', title: countTitle('拦截'), children: String(stats.blocker) }),
          jsx.jsx('span', { className: 'dshgp_rulecountYellow', title: countTitle('警告'), children: String(stats.warning) }),
          jsx.jsx('span', { className: 'dshgp_rulecountGreen', title: countTitle('通过'), children: String(stats.pass) }),
          jsx.jsx('span', { className: 'dshgp_rulebadge', children: powerBtn }),
        ],
      });
    }

    /** 审计开关块：提交前自动审计 + 注入开发者要求清单子开关。 */
    function dshgp_AuditSwitchBlock(props) {
      const s = props.state;
      return jsx.jsxs('div', {
        className: 'dshgp_block',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_switchrow',
            children: [
              jsx.jsx('span', { className: 'dshgp_switchlabel', children: '提交前自动审计' }),
              jsx.jsx('input', { type: 'checkbox', checked: !!s.auditEnabled, onChange: (ev) => props.toggleAudit(ev.target.checked), 'aria-label': '提交前自动审计' }),
            ],
          }),
          jsx.jsx('p', { className: 'dshgp_hint', children: '开启后 git_commit_push 提交前自动跑 L0 静态检查 + 10 维度质量评分；有 blocker 拦截提交。' }),
          /* 审计扫描范围单按钮（2026-09-14）：**一个按钮单击切换** diff/full，状态体现在
           按钮标题 + 颜色（diff=绿色「部分」，full=黄色「全量」）。父开关关闭时置灰
           （不生效但保留选择）。持久化走 host HTTP（persistence=memory 陷阱绕开方案）。 */
          jsx.jsxs('div', {
            className: 'dshgp_scanrow' + (s.auditEnabled ? '' : ' dshgp_subswitchOff'),
            children: [
              jsx.jsx('span', { className: 'dshgp_switchlabel', children: '审计扫描范围' }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_scanbtn '
                  + (s.auditScanScope === 'full' ? 'dshgp_scanbtnFull' : 'dshgp_scanbtnDiff')
                  + (s.auditEnabled ? '' : ' dshgp_scanbtnOff'),
                onClick: () => props.toggleAuditScanScope(s.auditScanScope === 'full' ? 'diff' : 'full'),
                children: s.auditScanScope === 'full' ? '🔴 全量（auditFull）' : '🟢 部分（本次变动）',
                'aria-label': '审计扫描范围：' + (s.auditScanScope === 'full' ? '全量' : '仅本次变动') + '（单击切换）',
                title: s.auditScanScope === 'full'
                  ? '当前：全量扫描（auditFull）——单击切回「部分」（仅本次变动，快）'
                  : '当前：仅本次变动（auditChanged，diff）——单击切换「全量」（慢但彻底）',
                disabled: !s.auditEnabled,
              }),
            ],
          }),
          jsx.jsx('p', { className: 'dshgp_hint', children: s.auditScanScope === 'full'
            ? '全量扫描（auditFull）：涵括历史遗留文件与全仓 js-yaml 引用证据；大仓库耗时明显。'
            : '部分扫描（auditChanged，diff）：只审提交相关的文件，最快（默认）。' }),
          /* 子开关：注入开发者要求清单。
             2026-09-13 交互修正：原来父开关关闭时 `disabled` + toggle 直接 return，等于
             「点不动、点了也没反应」，必须先点一次父开关再点它（两遍）。现改为：
             **一遍即可勾选并保留**（勾选是偏好，与父开关无关），父开关关闭时只把整行置灰
             （dshgp_subswitchOff）表示「暂不生效」，host 侧注入本身由
             `cfg.auditEnabled && cfg.injectRequirements` 门控，不会真的注入。 */
          jsx.jsxs('div', {
            className: 'dshgp_switchrow dshgp_subswitch' + (s.auditEnabled ? '' : ' dshgp_subswitchOff'),
            children: [
              jsx.jsx('span', { className: 'dshgp_switchlabel', children: '↳ 注入开发者要求清单到系统提示词' }),
              jsx.jsx('input', {
                type: 'checkbox',
                checked: !!s.injectRequirements,
                onChange: (ev) => props.toggleInjectRequirements(ev.target.checked),
                'aria-label': '注入开发者要求清单到系统提示词',
                title: s.auditEnabled ? '' : '已勾选但暂不生效：需开启上方「提交前自动审计」',
              }),
            ],
          }),
          jsx.jsx('p', { className: 'dshgp_hint', children: s.auditEnabled
            ? '开启后把「开发者特殊要求」清单注入系统提示词，AI 常驻可见、不必等提交被拦截才去读清单（省一次失败的工具往返）。'
            : (s.injectRequirements
              ? '已勾选，但上方「提交前自动审计」未开启 → 暂不注入（勾选已保留，开启父开关即生效）。'
              : '可直接勾选；「提交前自动审计」未开启时置灰、暂不注入。') }),
        ],
      });
    }

    /** 注入系统提示词总开关块（2026-09-13 新增）：控制整组 systemPrompt 注入段启停。 */
    function dshgp_InjectPromptSwitchBlock(props) {
      const s = props.state;
      return jsx.jsxs('div', {
        className: 'dshgp_block',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_switchrow',
            children: [
              jsx.jsx('span', { className: 'dshgp_switchlabel', children: '注入系统提示词' }),
              jsx.jsx('input', {
                type: 'checkbox',
                checked: s.injectSystemPrompt !== false,
                onChange: (ev) => props.toggleInjectSystemPrompt(ev.target.checked),
                'aria-label': '注入系统提示词',
              }),
            ],
          }),
          jsx.jsx('p', { className: 'dshgp_hint', children: s.injectSystemPrompt !== false
            ? '注入三段：①插件功能用法（每个工具怎么用 + 凭据由插件托管，避免 AI 绕开插件到处找 token）②环境（工作区目录映射 + 工具安装路径 + skill 总入口一行）③提交前 README 核对提醒。只注入目录/路径级信息，不注入 skill 正文。'
            : '已关闭：不注入任何系统提示词段落（AI 仍可调用插件工具，但看不到功能用法与环境目录）。' }),
        ],
      });
    }

    /** 代码禁用户沟通词开关块（控制 comment 槽位启停）。 */
    function dshgp_CommentWordingBlock(props) {
      const s = props.state;
      return jsx.jsxs('div', {
        className: 'dshgp_block',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_switchrow',
            children: [
              jsx.jsx('span', { className: 'dshgp_switchlabel', children: '代码禁用户沟通词（命中 Block 提交）' }),
              jsx.jsx('input', { type: 'checkbox', checked: !((s.slotMeta && s.slotMeta['comment']) || {}).disabled, onChange: () => props.toggleDisabled('comment'), 'aria-label': '代码禁用户沟通词' }),
            ],
          }),
          jsx.jsx('p', { className: 'dshgp_hint', children: '代码注释/文档出现沟通残留措辞（见 comment 规则包黑名单）→ blocker 拦截提交；白名单业务词（用户ID/用户登录等）自动豁免。' }),
        ],
      });
    }

    /** 规则包列表块：列表容器 + 榜单表头 + 逐行渲染（dshgp_RuleRow）。 */
    function dshgp_RuleListBlock(props) {
      const s = props.state;
      const order = Array.isArray(s.ruleOrder) ? s.ruleOrder : [];
      return jsx.jsxs('div', {
        className: 'dshgp_block',
        children: [
          jsx.jsx('p', { className: 'dshgp_h2', children: '规则包列表（↑↓ 调整次序，单击切换启用/禁用）' }),
          s.statusMsg ? jsx.jsx('p', { className: 'dshgp_saved', children: s.statusMsg }) : null,
          order.length === 0
            ? jsx.jsx('div', { className: 'dshgp_loading', children: s.slotLoading ? '加载中…' : '（无规则包）' })
            : jsx.jsxs('ul', {
                className: 'dshgp_rulenext',
                children: [
                  /* 榜单表头（模仿 skill 记分榜） */
                  jsx.jsxs('li', {
                    className: 'dshgp_ruleheadrow',
                    children: [
                      jsx.jsx('span', { className: 'dshgp_ruleheadrowinfo', children: '规则包' }),
                      jsx.jsx('span', { className: 'dshgp_rulecountRed', title: '该规则包在最近一次审计中命中的拦截级（blocker）问题数', children: '拦截' }),
                      jsx.jsx('span', { className: 'dshgp_rulecountYellow', title: '该规则包在最近一次审计中命中的警告级（warning）问题数', children: '警告' }),
                      jsx.jsx('span', { className: 'dshgp_rulecountGreen', title: '该规则包内没查出问题的规则条数', children: '通过' }),
                      jsx.jsx('span', { className: 'dshgp_rulebadge', children: '状态' }),
                    ],
                  }),
                  order.map((slot, idx) => dshgp_RuleRow(props, slot, idx, order.length)),
                ],
              }),
          jsx.jsx('p', { className: 'dshgp_hint', children: '数字含义：拦截/警告 = 该规则包在最近一次审计中命中的问题数，通过 = 没查出问题的规则条数（未做过审计时显示规则条数口径，行尾标注「规则」）。跑一次 code_audit 或全量扫描即刷新。' }),
          s.slotError ? jsx.jsx('p', { className: 'dshgp_error', children: s.slotError }) : null,
        ],
      });
    }

    /**
     * 选项卡二：审计（块组合）。
     * 2026-09-14：原单函数 122 行（超可读性阈值 max-function-length）拆为四个块组件 + 权重块；
     *   **渲染输出零变化**——拆分前后同一预览页审计 tab 的 DOM 逐字节比对为空。
     */
    function dshgp_AuditTab(props) {
      return jsx.jsxs('div', {
        className: 'dshgp_section',
        children: [
          jsx.jsx(dshgp_AuditSwitchBlock, props),
          jsx.jsx(dshgp_InjectPromptSwitchBlock, props),
          jsx.jsx(dshgp_CommentWordingBlock, props),
          /* ② 审计权重（10 维度） */
          jsx.jsxs('div', {
            className: 'dshgp_block',
            children: [
              jsx.jsx('p', { className: 'dshgp_h2', children: '审计权重（10 维度）' }),
              jsx.jsx(dshgp_WeightRows, { state: props.state, editWeight: props.editWeight }),
            ],
          }),
          jsx.jsx(dshgp_RuleListBlock, props),
        ],
      });
    }

    /* ═══════════════════ 选项卡三：设置 ═══════════════════ */
    function dshgp_SettingsTab(props) {
      const s = props.state;
      return jsx.jsxs('div', {
        className: 'dshgp_section',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_block',
            children: [
              // 2026-09-12：保存按钮放「凭据与密钥」标题后面（右侧）；放弃按钮已删
              jsx.jsxs('div', {
                style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' },
                children: [
                  jsx.jsx('p', { className: 'dshgp_h2', style: { margin: 0 }, children: '凭据与密钥' }),
                  jsx.jsx('button', { type: 'button', className: 'dshgp_btn', disabled: !s.dirty || s.saving, onClick: props.save, children: s.saving ? '保存中…' : '保存' }),
                ],
              }),
              jsx.jsx('div', {
                className: 'dshgp_field',
                children: [
                  jsx.jsxs('label', { className: 'dshgp_label', htmlFor: 'dshgp-token', children: ['GitHub token', s.tokenConfigured ? jsx.jsx('span', { className: 'dshgp_configured', children: '已填写' }) : null] }),
                  jsx.jsx('input', {
                    id: 'dshgp-token', type: 'password', autoComplete: 'off', className: 'dshgp_input',
                    value: s.text, disabled: !s.writable || s.saving,
                    onChange: (ev) => props.edit(ev.target.value),
                  }),
                  jsx.jsx('p', { className: 'dshgp_hint', children: 'ghp_ / github_pat_ 开头。保存后写入插件配置目录（0600），不在设置页留明文。' }),
                ],
              }),
              jsx.jsx('div', {
                className: 'dshgp_field',
                children: [
                  jsx.jsxs('label', { className: 'dshgp_label', htmlFor: 'dshgp-ssh', children: ['SSH 公钥', s.sshConfigured ? jsx.jsx('span', { className: 'dshgp_configured', children: '已填写' }) : null] }),
                  jsx.jsx('textarea', {
                    id: 'dshgp-ssh', className: 'dshgp_textarea', rows: 3,
                    value: s.sshPub, disabled: !s.writable || s.saving,
                    onChange: (ev) => props.editSsh(ev.target.value),
                  }),
                  jsx.jsx('p', { className: 'dshgp_hint', children: 'ssh-ed25519 / ssh-rsa 整行。保存到同级仓 *.pub，不回传明文。' }),
                ],
              }),
              // 2026-09-12：邮箱 + 一键生成同一行（编辑框宽度减少，按钮放编辑框后面）
              jsx.jsxs('div', {
                className: 'dshgp_field',
                children: [
                  jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dshgp-email', children: 'SSH 邮箱（一键生成用）' }),
                  jsx.jsxs('div', {
                    style: { display: 'flex', alignItems: 'center', gap: '8px' },
                    children: [
                      jsx.jsx('input', {
                        id: 'dshgp-email', type: 'text', autoComplete: 'off', className: 'dshgp_input',
                        style: { flex: '1 1 40%', maxWidth: '200px', minWidth: '120px' },
                        value: s.sshEmail, disabled: s.genKeying,
                        onChange: (ev) => props.editEmail(ev.target.value),
                      }),
                      jsx.jsx('button', { type: 'button', className: 'dshgp_btn dshgp_btnPrimary', disabled: s.genKeying || !s.sshEmail.trim(), onClick: props.genKey, children: s.genKeying ? '生成中…' : '一键生成并复制' }),
                    ],
                  }),
                ],
              }),
              s.failed ? jsx.jsx('p', { className: 'dshgp_error', children: '保存失败：请检查格式后重试。' }) : null,
              s.savedMsg ? jsx.jsx('p', { className: 'dshgp_saved', children: s.savedMsg }) : null,
              s.genKeyError ? jsx.jsx('p', { className: 'dshgp_error', children: s.genKeyError }) : null,
            ],
          }),
        ],
      });
    }

    /* ═══════════════════ 页面装配：三选项卡 ═══════════════════ */
    function dshgp_GitPushPage(props) {
      dshgp_ensureCss();
      const [tab, setTab] = react.useState('account');
      const tabs = [
        { id: 'account', label: '账号信息' },
        { id: 'audit', label: '审计' },
        { id: 'settings', label: '设置' },
      ];
      const tabBar = jsx.jsxs('div', {
        className: 'dshgp_tabs',
        children: tabs.map((t) => jsx.jsxs('button', {
          key: t.id,
          type: 'button',
          role: 'tab',
          'aria-selected': tab === t.id,
          className: tab === t.id ? 'dshgp_tab dshgp_tabOn' : 'dshgp_tab',
          onClick: () => setTab(t.id),
          children: [t.label],
        })),
      });
      // 2026-09-14：账号选项卡下的本地/云端卡片需要全部注入动作（scanLocalRepos/loadCloudRepos/
      //   pushLocalRepo/cloneFlow），只传 state+refreshAccount 会导致卡片按钮 onClick 报
      //   「props.xxx is not a function」——整包传 props（state + 全部注入动作）。
      const panel = tab === 'account' ? jsx.jsx(dshgp_AccountTab, props)
        : tab === 'audit' ? jsx.jsx(dshgp_AuditTab, {
          state: props.state,
          toggleAudit: props.toggleAudit,
          toggleInjectRequirements: props.toggleInjectRequirements,
          toggleInjectSystemPrompt: props.toggleInjectSystemPrompt,
          toggleAuditScanScope: props.toggleAuditScanScope,
          editWeight: props.editWeight,
          moveSlot: props.moveSlot,
          toggleDisabled: props.toggleDisabled,
        })
          : jsx.jsx(dshgp_SettingsTab, {
            state: props.state,
            edit: props.edit,
            editSsh: props.editSsh,
            editEmail: props.editEmail,
            save: props.save,
            discard: props.discard,
            genKey: props.genKey,
          });
      return jsx.jsxs('div', {
        style: { padding: '0 4px' },
        children: [
          jsx.jsxs('h2', { style: { margin: '0 0 10px', fontSize: '14px' }, children: ['Git 提交推送'] }),
          tabBar,
          panel,
        ],
      });
    }

    /* ═══════════════════ Controller：状态机 + 数据加载 ═══════════════════ */
    class dshgp_Controller {
      constructor(scope) {
        this.scope = scope;
        this.text = '';
        this.sshPub = '';
        this.sshEmail = '';
        this.saving = false;
        this.failed = false;
        this.savedMsg = '';
        this.savedTimer = null;
        this.auditEnabled = false;
        this.injectRequirements = false;
        // 注入系统提示词总开关（默认开；2026-09-13 新增）
        this.injectSystemPrompt = true;
        // 2026-09-14：审计扫描范围（diff|full）——设置持久化走 host HTTP，前端本地字段镜像
        this.auditScanScope = 'diff';
        this.ruleOrder = [];
        this.slotMeta = {};
        this.weightValues = {};
        // 2026-09-13：禁用态不再前端变量存储，以 yml 顶层 disabled 为准（listRuleSlots 解析）
        this.statusMsg = '';
        this.statusTimer = null;
        // 账号信息（纯展示）
        this.tokenConfigured = false;
        this.sshConfigured = false;
        this.accountBlock = '';
        this.accountLoggedIn = false;
        this.accountLoading = false;
        // 2026-09-14 账号卡片：本地/云端（本地扫描 / 云端列表）
        this.localPath = '';
        this.localRepos = [];
        this.localLoading = false;
        this.localMsg = '';
        this.cloudRepos = [];
        this.cloudLoading = false;
        this.cloudMsg = '';
        this.repoBusy = '';
        this.repoFeedback = {}; // { path: {ok, msg} } push 结果反馈（成功绿/失败红）
        // 规则包加载
        this.slotLoading = false;
        this.slotError = '';
        this.genKeying = false;
        this.genKeyError = '';
        // 2026-09-14：本次编辑会话已触达的设置键集合——loadSettingsFromHttp 的异步 GET
        //   返回旧值时跳过这些键，防止「点开关被初始化响应弹回」（回弹根因：GET 发出后
        //   点击发生，POST 未落盘前 GET 旧值先把本地覆盖回去）
        this.editedKeys = new Set();
        this.store = store.createSnapshotStore(this.project());
        this.unsubscribe = scope.subscribe(() => {
          const snap = this.scope.getSnapshot();
          if (snap && snap.value) {
            // 2026-09-15：开关/扫描范围/权重真源是 HTTP + config.json，
            //   **不再**从 scope 快照覆盖——yaml 缺键时 schema 默认 false 会把勾选弹回。
            // 2026-09-13：已填写提示 = 只看是否存在（不读明文回显）
            this.tokenConfigured = this.tokenConfigured || dshgp_tokenConfigured(snap.value);
            this.sshConfigured = !!(snap.value.sshPub && String(snap.value.sshPub).trim());
            // 2026-09-13 修复「规则包统计全是 0」：slotMeta 与 ruleOrder 同理，也不再从 scope 覆盖。
            //   snap.value.ruleSlotMeta 是 schema 里声明为「host 启动填充」的字段，但**宿主从未写入**，
            //   于是每次 scope 发布都把它（空对象）赋给 slotMeta，刚由 loadSlots() 拉到的真实统计被清空，
            //   所有规则包行回退到 {blocker:0,warning:0,pass:0,total:0} 兜底值 → 列表里数字全是 0。
            //   权威来源 = loadSlots() 的后端结果（动态发现全部 yml 并带 stats）；启停的即时反馈由
            //   toggleDisabled 自己改 slotMeta、随后 loadSlots 对账。
          }
          this.publish();
        });
        // 初次同步：开关可从快照种一次（单测无 HTTP）；之后只信 HTTP / 本地 commitSetting，
        //   subscribe 不再覆盖——yaml 缺键默认 false 会把勾选弹回。
        const snap0 = this.scope.getSnapshot();
        if (snap0 && snap0.value) {
          if (typeof snap0.value.auditEnabled === 'boolean') this.auditEnabled = snap0.value.auditEnabled;
          if (typeof snap0.value.injectRequirements === 'boolean') this.injectRequirements = snap0.value.injectRequirements;
          if (typeof snap0.value.injectSystemPrompt === 'boolean') this.injectSystemPrompt = snap0.value.injectSystemPrompt;
          if (typeof snap0.value.auditScanScope === 'string') this.auditScanScope = snap0.value.auditScanScope;
          const wo0 = String(snap0.value.weightOverrides || '');
          if (wo0.trim()) { try { this.weightValues = JSON.parse(wo0) || {}; } catch { /* 忽略 */ } }
          this.tokenConfigured = this.tokenConfigured || dshgp_tokenConfigured(snap0.value);
          this.sshConfigured = !!(snap0.value.sshPub && String(snap0.value.sshPub).trim());
        }
        // 若 loadSlots 尚未返回，先用已发现的槽位做占位显示（不含 private/template）
        if (!this.ruleOrder.length && Object.keys(this.slotMeta).length) {
          this.ruleOrder = Object.keys(this.slotMeta).filter((s) => s !== 'private' && s !== 'template');
        }
        void this.loadSlots();
        void this.loadCredentialFlags();
        void this.refreshAccount();
        // 2026-09-14：设置持久化走 HTTP 读宿主 scope（绕开 client isLoopback=memory 陷阱——
        //   反代访问时 scope 快照恒 unavailable，从宿主侧读已落盘设置，重启后开关保持勾选）
        void this.loadSettingsFromHttp();
      }
      project() {
        const snap = this.scope.getSnapshot();
        return {
          available: snap.status === 'ready',
          writable: !!snap.writable,
          text: this.text,
          sshPub: this.sshPub,
          sshEmail: this.sshEmail,
          auditEnabled: this.auditEnabled,
          injectRequirements: this.injectRequirements,
          injectSystemPrompt: this.injectSystemPrompt,
          auditScanScope: this.auditScanScope,
          ruleOrder: this.ruleOrder,
          slotMeta: this.slotMeta,
          weightValues: this.weightValues,
          tokenConfigured: this.tokenConfigured,
          sshConfigured: this.sshConfigured,
          accountBlock: this.accountBlock,
          accountLoggedIn: this.accountLoggedIn,
          accountLoading: this.accountLoading,
          slotLoading: this.slotLoading,
          slotError: this.slotError,
          statusMsg: this.statusMsg,
          genKeying: this.genKeying,
          genKeyError: this.genKeyError,
          localPath: this.localPath,
          localRepos: this.localRepos,
          localLoading: this.localLoading,
          localMsg: this.localMsg,
          cloudRepos: this.cloudRepos,
          cloudLoading: this.cloudLoading,
          cloudMsg: this.cloudMsg,
          repoBusy: this.repoBusy,
          repoFeedback: this.repoFeedback,
          dirty: this.text.trim().length > 0 || this.sshPub.trim().length > 0,
          saving: this.saving,
          failed: this.failed,
          savedMsg: this.savedMsg,
        };
      }
      flashSaved(msg) {
        this.savedMsg = String(msg || '');
        if (this.savedTimer) clearTimeout(this.savedTimer);
        this.savedTimer = setTimeout(() => {
          this.savedMsg = '';
          this.publish();
        }, 4000);
        this.publish();
      }
      publish() { this.store.set(this.project()); }

      /**
       * 2026-09-14：从宿主读已落盘设置（/settings-get，host scope.get 快照）。
       * 背景：非 loopback 访问（反代）时 client settingsScope 恒 unavailable（memory 模式），
       *   插件直读 scope 拿不到任何已保存值 → 打开设置页时开关全回默认（现象：重启后勾选丢失，
       *   需重新打开）。host 侧 scope 才是真源，经 HTTP 读回后覆盖前端字段、保持勾选状态。
       * 2026-09-14 追加：**用户已编辑过的键跳过**（this.editedKeys）——本请求是异步的，
       *   若用户在响应回来前点了开关，GET 返回的是 host 旧值，直接覆盖会把刚点的勾选弹回。
       */
      async loadSettingsFromHttp() {
        try {
          const data = await dshgp_getJson('/api/git-push/settings-get');
          if (!data || !data.ok || !data.settings) return;
          const v = data.settings;
          if (typeof v.auditEnabled === 'boolean' && !this.editedKeys.has('auditEnabled')) this.auditEnabled = v.auditEnabled;
          if (typeof v.injectRequirements === 'boolean' && !this.editedKeys.has('injectRequirements')) this.injectRequirements = v.injectRequirements;
          if (typeof v.injectSystemPrompt === 'boolean' && !this.editedKeys.has('injectSystemPrompt')) this.injectSystemPrompt = v.injectSystemPrompt;
          if (typeof v.auditScanScope === 'string' && !this.editedKeys.has('auditScanScope')) this.auditScanScope = v.auditScanScope;
          if (typeof v.auditLevel === 'string' && !this.editedKeys.has('auditLevel')) this.auditLevel = v.auditLevel;
          if (typeof v.weightOverrides === 'string' && v.weightOverrides.trim() && !this.editedKeys.has('weightOverrides')) {
            try { this.weightValues = JSON.parse(v.weightOverrides) || {}; } catch { /* 忽略 */ }
          }
          // 凭据布尔位不受编辑守卫影响：只读派生标记，无回弹风险
          if (typeof v.tokenConfigured === 'boolean') this.tokenConfigured = v.tokenConfigured;
          if (typeof v.sshConfigured === 'boolean') this.sshConfigured = v.sshConfigured;
          this.publish();
        } catch (_e) { /* 端点不可用/未注册时沿用 scope 兜底 */ }
      }

      /** 加载规则包清单（/rule-slots，动态发现 yml）。 */
      /** 凭据状态（/status）：token 明文不下发浏览器，靠 host 派生的布尔位知道「填没填」。 */
      async loadCredentialFlags() {
        try {
          const data = await dshgp_getJson('/api/git-push/status');
          const cfg = (data && data.config) || {};
          if (typeof cfg.tokenConfigured === 'boolean') {
            this.tokenConfigured = cfg.tokenConfigured;
            this.publish();
          }
        } catch (_e) { /* 取不到就沿用设置快照的兜底判断 */ }
      }

      async loadSlots() {
        this.slotLoading = true;
        this.slotError = '';
        this.publish();
        try {
          const data = await dshgp_getJson('/api/git-push/rule-slots');
          if (data && data.ok && data.slots) {
            const meta = data.slots.meta || {};
            // 用后端返回的生效顺序；private 恒末尾
            const list = Array.isArray(data.slots.order) ? data.slots.order : [];
            const order = list.filter((s) => s !== 'template');
            const forced = Array.isArray(data.slots.forced) ? data.slots.forced : [];
            this.slotMeta = meta;
            this.ruleOrder = order;
            if (forced.includes('private') && !this.ruleOrder.includes('private')) this.ruleOrder.push('private');
          } else {
            this.slotError = (data && data.message) || '规则包加载失败';
          }
        } catch (e) {
          this.slotError = '规则包加载失败: ' + (e && e.message || e);
        }
        this.slotLoading = false;
        this.publish();
      }

      /** 刷新账号信息（/account-check，纯展示）。 */
      async refreshAccount() {
        this.accountLoading = true;
        this.publish();
        try {
          const data = await dshgp_getJson('/api/git-push/account-check');
          this.accountBlock = (data && data.block) || ((data && data.detail) || '（无信息）');
          this.accountLoggedIn = !!(data && data.loggedIn);
        } catch (e) {
          this.accountBlock = '检测失败: ' + (e && e.message || e);
          this.accountLoggedIn = false;
        }
        this.accountLoading = false;
        this.publish();
      }

      /** 扫描本地仓库（默认工作区；可手动指定路径）。 */
      async scanLocalRepos(path) {
        this.localLoading = true;
        this.localMsg = '';
        this.publish();
        try {
          const p = String(path || '').trim();
          try { if (p) window.localStorage.setItem('dshgp-scan-path', p); } catch { /* 忽略 */ }
          const data = await dshgp_getJson('/api/git-push/repos-local' + (p ? '?path=' + encodeURIComponent(p) : ''));
          if (data && data.ok) {
            this.localPath = data.root || p;
            this.localRepos = Array.isArray(data.repos) ? data.repos : [];
            this.localMsg = this.localRepos.length
              ? '扫描到 ' + this.localRepos.length + ' 个仓库（' + (data.root || '') + '）'
              : '该路径下没有 git 仓库: ' + (data.root || '');
          } else {
            this.localRepos = [];
            this.localMsg = '❌ ' + ((data && data.error) || '扫描失败');
          }
        } catch (e) {
          this.localRepos = [];
          this.localMsg = '❌ 扫描失败: ' + (e && e.message || e);
        }
        this.localLoading = false;
        this.publish();
      }

      /** 拉取云端仓库列表（/repos-cloud，token 列账号名下仓库）。 */
      async loadCloudRepos() {
        this.cloudLoading = true;
        this.cloudMsg = '';
        this.publish();
        try {
          const data = await dshgp_getJson('/api/git-push/repos-cloud');
          if (data && data.ok) {
            this.cloudRepos = Array.isArray(data.repos) ? data.repos : [];
            this.cloudMsg = '共 ' + this.cloudRepos.length + ' 个仓库（按最近更新排序）';
          } else {
            this.cloudRepos = [];
            this.cloudMsg = '❌ ' + ((data && data.error) || '拉取失败');
          }
        } catch (e) {
          this.cloudRepos = [];
          this.cloudMsg = '❌ 拉取失败: ' + (e && e.message || e);
        }
        this.cloudLoading = false;
        this.publish();
      }

      /** 本地仓库手动 push（领先 + 工作树干净才允许，后端校验）。 */
      async pushLocalRepo(path) {
        this.repoBusy = 'push:' + path;
        this.publish();
        let ok = false;
        let msg = '';
        try {
          const data = await dshgp_postJson('/api/git-push/repo-push', { path, confirm: true });
          ok = !!(data && data.ok);
          if (ok) {
            msg = '✅ 推送成功 ' + path;
          } else {
            // 显示详细错误信息（含 ahead/behind）
            const err = (data && (data.error || (data.push && data.push.reason))) || '推送失败';
            const extra = [];
            if (data && data.ahead > 0) extra.push('领先 ' + data.ahead);
            if (data && data.behind > 0) extra.push('落后 ' + data.behind);
            msg = '⚠️ ' + err + (extra.length ? '（' + extra.join('，') + '）' : '');
          }
          this.localMsg = msg;
        } catch (e) {
          msg = '❌ 推送失败: ' + (e && e.message || e);
          this.localMsg = msg;
        }
        // 2026-09-14 push 反馈：行内绿/红醒目提示（成功/失败）
        this.repoFeedback = Object.assign({}, this.repoFeedback, { [path]: { ok, msg } });
        this.repoBusy = '';
        void this.scanLocalRepos(this.localPath); // 刷新领先/落后状态
        this.publish();
      }

      /** 云端仓库 clone：先弹目录选择器选目标目录，确认后克隆。 */
      cloneFlow(repo) {
        dshgp_browseOpen(null, (dir) => { void this.cloneCloudRepo(repo, dir); });
      }
      async cloneCloudRepo(repo, dir) {
        this.repoBusy = 'clone:' + repo;
        this.publish();
        try {
          const data = await dshgp_postJson('/api/git-push/repo-clone', { target: repo, dir, confirm: true });
          this.cloudMsg = data && data.ok
            ? '✅ 已克隆 ' + repo + ' → ' + ((data && data.dest) || dir)
            : '❌ ' + ((data && data.error) || '克隆失败');
        } catch (e) {
          this.cloudMsg = '❌ 克隆失败: ' + (e && e.message || e);
        }
        this.repoBusy = '';
        this.publish();
      }

      /** 单击规则包行：切换禁用/启用（2026-09-13 改为写 yml 顶层 disabled，不存 scope 变量）。 */
      async toggleDisabled(slot) {
        if (slot === 'nodejs' || slot === 'private') {
          this.setStatus('⚠️ nodejs/private 安全红线槽位不可禁用');
          return;
        }
        const meta = (this.slotMeta && this.slotMeta[slot]) || {};
        const nowDisabled = !!(meta.disabled);
        // 即时反馈：先本地翻转（行绿/红 + 顶部提示），不等后端响应
        this.slotMeta = { ...(this.slotMeta || {}), [slot]: { ...meta, disabled: !nowDisabled } };
        this.setStatus(!nowDisabled ? '✅ 已禁用 ' + slot + '（该槽位规则不再加载）' : '✅ 已启用 ' + slot);
        this.publish();
        try {
          const res = await dshgp_postJson('/api/git-push/toggle-rule', { slot, disabled: !nowDisabled });
          if (res && res.ok) {
            void this.loadSlots(); // 后台重载对账（yml 解析结果）
          } else {
            this.setStatus('❌ 切换失败：' + ((res && res.error) || '未知错误'));
            this.loadSlots();
          }
        } catch (e) {
          this.setStatus('❌ 切换失败：' + (e && e.message || e));
          void this.loadSlots(); // 恢复 yml 真实状态
        }
      }

      /** 审计 tab 顶部即时反馈（区别于设置 tab 的 flashSaved）。 */
      setStatus(msg) {
        this.statusMsg = String(msg || '');
        if (this.statusTimer) clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(() => {
          this.statusMsg = '';
          this.publish();
        }, 4000);
      }

      /** 上下调整规则包次序（下覆盖上）。 */
      moveSlot(slot, dir) {
        const arr = [...this.ruleOrder];
        const i = arr.indexOf(slot);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        this.ruleOrder = arr;
        this.publish();
        // 2026-09-15：次序持久化走 HTTP settings-set（写插件私有 config.json）。
        //   不再 scope.set——scope.set 会把 auditRuleOrder 写进公共 settings.yaml
        //   （跨实例锁竞争 + isLoopback=memory 陷阱，见 settings-bridge.js 头部说明）。
        this.persistSetting('auditRuleOrder', arr);
        this.setStatus('✅ 规则包次序已保存：' + arr.join(' → '));
      }

      /**
       * 2026-09-15：前端设置写入通用入口（抽公共函数消除 toggle 系列重复）。
       * 统一四件套：标记 editedKeys（防 loadSettingsFromHttp 异步 GET 旧值覆盖弹回）
       *   → publish（UI 立即反映）→ persistSetting（HTTP 落盘 config.json + loopback scope 双通道）。
       * @param {string} key 设置键
       * @param {unknown} value 值
       * @param {string} okMsg flashSaved 成功文案（空=静默）
       */
      commitSetting(key, value, okMsg = '') {
        this.editedKeys.add(key);
        this.publish();
        this.persistSetting(key, value, okMsg);
      }

      /** 审计开关（写回 auditEnabled）。 */
      toggleAudit(checked) {
        this.auditEnabled = !!checked;
        // 2026-09-13 交互修正：关闭父开关时**不再**把子开关的勾选抹掉。
        //   子开关的勾选是用户偏好，父开关只管「此刻生不生效」（host 侧注入由
        //   cfg.auditEnabled && cfg.injectRequirements 门控）。原实现静默清勾选，
        //   用户重开父开关时还得再点一遍子开关，且看不出勾选是被谁清掉的。
        this.commitSetting('auditEnabled', this.auditEnabled, this.auditEnabled
          ? '✅ 已开启：提交前自动审计'
          : '✅ 已关闭：提交前不审计');
      }

      /**
       * 设置持久化统一入口（**零 scope.set**，单通道走 host HTTP /settings-set → 写插件私有
       *   config.json）。2026-09-15 彻底移除 scope.set：
       *   ① scope.set 会把设置写进公共 settings.yaml（跨实例写锁竞争 + isLoopback=memory 陷阱）；
       *   ② loopback 直连时 scope.set 会写公共 yaml、反代时 memory 不落盘——两条路都不对，
       *      HTTP settings-set 与访问方式无关、无宿主锁竞争、重启从文件读回，是唯一可靠通道。
       * @param {string} key 设置键
       * @param {unknown} value 值
       * @param {string} okMsg flashSaved 成功文案（空=静默）
       */
      persistSetting(key, value, okMsg = '') {
        // 2026-09-15：UI 提交调试日志（浏览器控制台可见；服务端另有 settings-ui.log 持久留痕）
        if (typeof console !== 'undefined' && console.debug) {
          try { console.debug('[dsh-git-push] UI 提交', key, '=', String(value).slice(0, 40) + (String(value).length > 40 ? '…' : '')); } catch { /* 控制台不可用时跳过调试输出 */ }
        }
        void dshgp_postJson('/api/git-push/settings-set', { key, value }).then((data) => {
          if (data && data.ok) {
            if (okMsg) this.flashSaved(okMsg);
          } else {
            this.failed = true;
            this.publish();
          }
        }).catch(() => {
          this.failed = true;
          this.publish();
        });
      }

      /**
       * 注入开发者要求清单开关（auditEnabled 的子开关）。
       * 父开关关闭时**仍可勾选**（保留偏好、只置灰、不注入）——原实现在这里直接 return，
       * 用户点了没任何反应，必须先开父开关再点一次（两遍）。
       */
      toggleInjectRequirements(checked) {
        this.injectRequirements = !!checked;
        this.commitSetting('injectRequirements', this.injectRequirements, this.injectRequirements
          ? (this.auditEnabled ? '✅ 已开启：注入开发者要求清单' : '✅ 已勾选：待开启「提交前自动审计」后生效')
          : '✅ 已关闭：不注入要求清单');
      }

      /**
       * 注入系统提示词总开关（写回 injectSystemPrompt；默认开）。
       * 关 = host 侧所有注入段返回空串；开 = 注入功能用法/环境/README 提醒三段。
       * 注入段里的「开发者要求清单」仍受 auditEnabled + injectRequirements 双重门控。
       */
      toggleInjectSystemPrompt(checked) {
        this.injectSystemPrompt = !!checked;
        // 2026-09-15：走 commitSetting 公共入口（自动含 editedKeys 标记 + publish + persistSetting）；
        //   此前漏了 editedKeys 标记，loadSettingsFromHttp 异步 GET 可能用旧值把它覆盖回去
        this.commitSetting('injectSystemPrompt', this.injectSystemPrompt, this.injectSystemPrompt
          ? '✅ 已开启：注入系统提示词'
          : '✅ 已关闭：不注入系统提示词');
      }

      /**
       * 审计扫描范围切换（2026-09-14）：diff=仅本次变动（auditChanged，默认）/ full=全量（auditFull）。
       * 按钮式单击切换；持久化走 host HTTP（persistence=memory 陷阱绕开方案，见 settings-bridge.js）。
       */
      toggleAuditScanScope(scope) {
        const next = scope === 'full' ? 'full' : 'diff';
        if (this.auditScanScope === next) return;
        this.auditScanScope = next;
        this.commitSetting('auditScanScope', next, next === 'full'
          ? '✅ 已切换：审计扫描范围 = 全量（auditFull）'
          : '✅ 已切换：审计扫描范围 = 部分（auditChanged，仅本次变动）');
      }

      /** 权重维度编辑（合并写回 weightOverrides JSON）。 */
      editWeight(key, value) {
        this.weightValues = { ...(this.weightValues || {}), [key]: value };
        const json = JSON.stringify(this.weightValues);
        this.commitSetting('weightOverrides', json, '✅ 权重已保存（合计 ' + dshgp_DIMENSIONS.reduce((a, d) => a + (this.weightValues[d.key] != null ? this.weightValues[d.key] : d.def), 0) + '），下次审计生效');
      }

      edit(text) { this.text = String(text || ''); this.failed = false; this.publish(); }
      editSsh(text) { this.sshPub = String(text || ''); this.failed = false; this.publish(); }
      editEmail(text) { this.sshEmail = String(text || ''); this.failed = false; this.publish(); }

      /** 保存 token / 公钥到插件配置（settingsScope）。 */
      async save() {
        const raw = this.text.trim();
        const pub = this.sshPub.trim();
        if ((!raw && !pub) || this.saving) return;
        this.saving = true;
        this.failed = false;
        this.publish();
        try {
          // 2026-09-15：凭据持久化走 persistSetting（纯 HTTP /settings-set → 服务端
          //   writeSettingsKey 写 config.json + persistGithubToken/persistSshPub 落插件目录，
          //   不 scope.set——scope.set 会把凭据写进公共 settings.yaml 明文，反代下还不落盘）。
          if (raw) this.persistSetting('githubToken', raw);
          if (pub) this.persistSetting('sshPub', pub);
          if (raw) this.tokenConfigured = true;   // 刚写入即视为已配置（明文不回传，本地直接置位）
          this.text = '';
          this.sshPub = '';
          this.saving = false;
          this.flashSaved('✅ 凭据已保存');
        } catch (_e) {
          this.saving = false;
          this.failed = true;
        }
        this.publish();
      }

      discard() { this.text = ''; this.sshPub = ''; this.failed = false; this.publish(); }

      /** 一键生成 SSH 密钥对（/gen-ssh-key）：公钥保存到 sshkey 并复制。 */
      async genKey() {
        const email = this.sshEmail.trim();
        if (!email || this.genKeying) return;
        this.genKeying = true;
        this.genKeyError = '';
        this.publish();
        try {
          const data = await dshgp_postJson('/api/git-push/gen-ssh-key', { email });
          if (data && data.ok && data.pub) {
            this.sshPub = data.pub;
            this.publish();
            await dshgp_copyText(data.pub);
            this.genKeying = false;
            this.flashSaved('✅ 公钥已生成：已填入 SSH 公钥框并复制到剪贴板');
          } else {
            this.genKeying = false;
            this.genKeyError = (data && data.error) || '生成失败';
            this.publish();
          }
        } catch (e) {
          this.genKeying = false;
          this.genKeyError = '生成失败: ' + (e && e.message || e);
          this.publish();
        }
      }

      /** 挂到槽系统的 hooks（供组件注入）。 */
      inject() {
        return {
          hooks: { gitPushCard: this.store },
          edit: (text) => this.edit(text),
          editSsh: (text) => this.editSsh(text),
          editEmail: (text) => this.editEmail(text),
          save: () => { void this.save(); },
          discard: () => this.discard(),
          genKey: () => { void this.genKey(); },
          toggleAudit: (checked) => this.toggleAudit(checked),
          // 子开关动作必须在这里暴露：页面 props 来自 inject()，漏了会让 onChange 调到 undefined
          toggleInjectRequirements: (checked) => this.toggleInjectRequirements(checked),
          toggleInjectSystemPrompt: (checked) => this.toggleInjectSystemPrompt(checked),
          toggleAuditScanScope: (scope) => this.toggleAuditScanScope(scope),
          editWeight: (key, value) => this.editWeight(key, value),
          moveSlot: (slot, dir) => this.moveSlot(slot, dir),
          toggleDisabled: (slot) => { void this.toggleDisabled(slot); },
          refreshAccount: () => { void this.refreshAccount(); },
          // 2026-09-14 账号卡片：本地/云端 动作
          scanLocalRepos: (path) => { void this.scanLocalRepos(path); },
          loadCloudRepos: () => { void this.loadCloudRepos(); },
          pushLocalRepo: (path) => { void this.pushLocalRepo(path); },
          cloneFlow: (repo) => this.cloneFlow(repo),
        };
      }
    }

    const inject = ['slots', 'settingsScope'];

    function apply(ctx) {
      const controller = new dshgp_Controller(ctx.settingsScope.bind({ namespace: SETTINGS_NS }));
      const store = controller.store;
      // uSES 桥：SnapshotStore 是裸 observable，用 useSyncExternalStore 自建 selector hook
      const useCardState = (selector) => {
        const snap = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
        return selector ? selector(snap) : snap;
      };
      // 统一 props：组件层不感知 controller，全走 store + 动作注入
      const makeProps = (state) => Object.assign({ state, useGitPushCard: useCardState }, controller.inject());
      function SectionPage() {
        const state = useCardState((s) => s);
        if (!state.available) return null;
        const props = makeProps(state);
        return jsx.jsx(dshgp_GitPushPage, props);
      }
      // 只注册 settings.section（独立侧边栏页）；settings.plugin.item（插件配置卡）已删除
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-git-push',
        order: 40,
        label: () => 'Git 提交推送',
      }, () => react.createElement(SectionPage, null)));
    }

    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});