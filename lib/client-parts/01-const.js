    /* ─────────────────── [1] 常量区（NS/维度表/样式串） ─────────────────── */
    // 面板「忙碌中」状态键的前缀（clone / vis / push 三类操作共用**同一出处**）。
    //   此前这三个字面量散落在组件与类方法里各写一遍，改一处不会同步另一处；
    //   命名带 dshgp_ 前缀，符合本文件的形态铁律（防 combo 拼接撞名）。
    const dshgp_BUSY_CLONE = 'clone:';
    const dshgp_BUSY_VIS = 'vis:';
    const dshgp_BUSY_PUSH = 'push:';
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

    // 逻辑类常量（fetch 超时 / 扫描循环上限 / 提示时长 / 日志截断长度）
    const dshgp_FETCH_TIMEOUT_MS = 30_000;        // fetch 超时（same-origin）
    // 克隆后台化：原先 clone 用 30 分钟长超时（请求一直阻塞到克隆结束，
    //   而带 tools/ffmpeg-lib 的仓库可达 154MB，默认 30s 必然超时）。
    //   现在 repo-clone 提交即返回 202、下载在服务端后台跑，提交本身是快操作，
    //   故该长超时常量已删除——提交用下面的短超时，进度与终态由轮询接管。
    const dshgp_SCAN_WAIT_MAX_ROUNDS = 600;       // 后台扫描等待循环上限（每次挂起等新进度）
    const dshgp_SAVED_MSG_MS = 4000;              // 「已保存」提示显示时长
    const dshgp_LOG_TRUNCATE = 40;                // 调试日志 value 截断长度

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
 // v1 账号块（完全移植 v1 GitPushAccountTop 显示）
      '.dshgp_top{display:flex;flex-direction:column;gap:6px}',
      '.dshgp_toplabel{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.dshgp_acctblock{white-space:pre-wrap;margin:0;font-size:12px;line-height:1.6;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
      '.dshgp_keybtn{padding:3px 10px;font-size:12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}',
      '.dshgp_keybtn:disabled{opacity:.5;cursor:not-allowed}',
 // 账号信息美化面板（设计稿落地：渐变卡片 + GitHub 图标 + 状态徽标 + 凭据状态标签）
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
      '.dshgp_pill{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px}',
      '.dshgp_pill_on{background:color-mix(in srgb,var(--dsw-alias-label-success) 14%,transparent);color:var(--dsw-alias-label-success)}',
      '.dshgp_pill_off{background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 14%,transparent);color:var(--dsw-alias-label-secondary)}',
      // 凭据行「徽标 + 各自有效时间」的容器与时间小字；两用户提示行
      '.dshgp_credwrap{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.dshgp_credtime{font-size:10px;color:var(--dsw-alias-label-tertiary)}',
      '.dshgp_acctnote{margin-top:6px;font-size:10px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
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
      // 克隆预览框新增的两处元素（此前用浏览器默认样式，能显示但与面板风格不一致）：
      //   · 勾选项行：复选框与说明文字横向对齐、字号与小字提示一致；
      //   · 不完整克隆提示：独立一行、留出行距便于阅读。
      '.dshgp_previewopt{display:flex;align-items:center;gap:6px;margin:6px 0 2px;font-size:12px;opacity:.9}',
      '.dshgp_previewopt input{margin:0;cursor:pointer}',
      '.dshgp_previewpartial{margin:4px 0 2px;font-size:12px;opacity:.85;line-height:1.5}',
      // 输入
      '.dshgp_input{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:32px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:13px;width:100%;box-sizing:border-box}',
      '.dshgp_textarea{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:8px 10px;font-size:12px;width:100%;box-sizing:border-box;resize:vertical;min-height:56px}',
      '.dshgp_field{margin:0 0 8px}',
      '.dshgp_label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary);display:block;margin-bottom:4px}',
      '.dshgp_hint{margin:2px 0 0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      // 按钮
      '.dshgp_btn{font:inherit;font-size:12px;border-radius:8px;padding:5px 10px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dshgp_btn:disabled{opacity:.45;cursor:default}',
      // 可见性切换独立确认弹窗（1.5.4 改版）：mask/dialog 复用 browse modal 样式，
      //   按钮行 + 风险提示
      '.dshgp_previewbtns{display:flex;gap:8px;justify-content:flex-end;margin-top:4px}',
      '.dshgp_viswarn{font-size:12px;line-height:1.6;padding:7px 9px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-warning) 11%,transparent);border:.5px solid color-mix(in srgb,var(--dsw-alias-label-warning) 30%,transparent);color:var(--dsw-alias-label-warning)}',
      '.dshgp_btnPrimary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
 // 审计扫描范围单按钮：一个按钮单击切换 diff/full，状态体现在标题 + 颜色
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
 // 规则包列表（榜单样式：模仿 skill 记分榜 表头行 + 定宽右对齐列 + hover）
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
      // 启用/禁用底色加强 + 左侧色条，状态一眼可辨。
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
      // 账号卡片：本地/云端（仓库管理）
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

