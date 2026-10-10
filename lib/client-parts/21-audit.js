    /* ─────────────────── [7] 审计 Tab（WeightRows/RuleRow/AuditSwitchBlock/InjectPromptSwitchBlock/CommentWordingBlock/AuditAdvancedBlock/RuleListBlock/AuditTab） ─────────────────── */
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
 * 规则包行（交互改版）：
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
 // 口径统一为 yml 规则条数：三个数字是「该规则包里各严重级的规则条数」，
      //   不是审计命中数。此前后端在跑过审计时改显命中数，而命中数按**次数**累加、规则数是**条数**，
      //   同排对比会出现「245 警告 / 37 总规则」这类越界假数据；现固定为条数口径，不再分支。
      const countTitle = (kind) => {
        const n = kind === '拦截' ? stats.blocker : (kind === '警告' ? stats.warning : stats.pass);
        return `${name}：${kind}级规则 ${n} 条（共 ${stats.total} 条规则）`;
      };
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
            children: `规则条数：拦截级 ${stats.blocker} 条 · 警告级 ${stats.warning} 条 · 提示级 ${stats.pass} 条（共 ${stats.total} 条规则）`,
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
 /* 审计扫描范围单按钮：**一个按钮单击切换** diff/full，状态体现在
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

 /** 注入总开关块（新增， 语义扩展）：控制 systemPrompt 段 + 上下文注入启停。 */
    function dshgp_InjectPromptSwitchBlock(props) {
      const s = props.state;
      return jsx.jsxs('div', {
        className: 'dshgp_block',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_switchrow',
            children: [
              jsx.jsx('span', { className: 'dshgp_switchlabel', children: '注入系统提示词/上下文' }),
              jsx.jsx('input', {
                type: 'checkbox',
                checked: s.injectSystemPrompt !== false,
                onChange: (ev) => props.toggleInjectSystemPrompt(ev.target.checked),
                'aria-label': '注入系统提示词/上下文',
              }),
            ],
          }),
          jsx.jsx('p', { className: 'dshgp_hint', children: s.injectSystemPrompt !== false
            ? '系统提示词：①插件功能用法（每个工具怎么用 + 凭据由插件托管，避免 AI 绕开插件到处找 token）③提交前 README 核对提醒 + 要求清单。上下文：②环境（工作区目录映射 + 工具安装路径 + skill 总入口一行，每个 agent 首次 step 注入一次；工具按 lib/tool-probes.json 模板探测，路径生成到运行目录 tools.json）。只注入目录/路径级信息，不注入 skill 正文。'
            : '已关闭：不注入任何系统提示词段落与上下文环境信息（AI 仍可调用插件工具，但看不到功能用法与环境目录）。' }),
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

 /** 审计进阶设置块（收敛：只剩「全量扫描文件上限」）。 */
    function dshgp_AuditAdvancedBlock(props) {
      const s = props.state;
      // 修复：React 的 jsx(type, props, key) 第三参数是 **key 不是 children**——
      //   此前写成 jsx('select', props, options.map(...)) 导致 children 丢失、下拉框渲染为空
      //   （页面只剩一个空 <select>，用户看到「下拉没有那三种」）。children 必须放进 props。
      const sel = (key, values) => jsx.jsx('select', {
        className: 'dshgp_input dshgp_inputInline',
        value: s[key],
        onChange: (ev) => props.setAdvanced(key, ev.target.value),
        children: values.map((v) => jsx.jsx('option', { key: v, value: v, children: v })),
      });
      return jsx.jsxs('div', {
        className: 'dshgp_block',
        children: [
          jsx.jsx('p', { className: 'dshgp_h2', children: '审计进阶设置' }),
          // 本块只保留「全量扫描文件上限」一项。
          //   删除项（均为 AI 擅自添加、非用户可配）：审计强度（固定完整流程）、自定规则目录、
          //   硬编码全量扫（该项其实从未接上审计实现，是空开关）。
          //   硬编码扫描范围随审计范围走——审计扫多少，硬编码就扫多少，不再单独控制。
          jsx.jsxs('div', { className: 'dshgp_field', children: [
            jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dshgp-maxfiles', children: '全量扫描文件上限' }),
            jsx.jsx('input', { id: 'dshgp-maxfiles', type: 'number', min: 0, className: 'dshgp_input', value: s.maxScanFiles, onChange: (ev) => props.setAdvanced('maxScanFiles', ev.target.value) }),
            jsx.jsx('p', { className: 'dshgp_hint', children: '全量审计最多扫多少个文件（0=不限）；超限按「变动优先」截断，弱机防卡死。硬编码检查随此范围一并进行。' }),
          ] }),
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
                      jsx.jsx('span', { className: 'dshgp_rulecountRed', title: '该规则包内拦截级（blocker/error）的规则条数', children: '拦截级' }),
                      jsx.jsx('span', { className: 'dshgp_rulecountYellow', title: '该规则包内警告级（warning）的规则条数', children: '警告级' }),
                      jsx.jsx('span', { className: 'dshgp_rulecountGreen', title: '该规则包内提示级（info/notice 等其余严重级）的规则条数', children: '提示级' }),
                      jsx.jsx('span', { className: 'dshgp_rulebadge', children: '状态' }),
                    ],
                  }),
                  order.map((slot, idx) => dshgp_RuleRow(props, slot, idx, order.length)),
                ],
              }),
          jsx.jsx('p', { className: 'dshgp_hint', children: '数字含义：三个数字是该规则包内各严重级的**规则条数**（拦截级 + 警告级 + 提示级 = 规则总数），取自 yml 规则文件，与是否跑过审计无关。想知道实际命中情况请看审计报告。' }),
          s.slotError ? jsx.jsx('p', { className: 'dshgp_error', children: s.slotError }) : null,
        ],
      });
    }

    /**
     * 选项卡二：审计（块组合）。
     * 原单函数 122 行（超可读性阈值 max-function-length）拆为四个块组件 + 权重块；
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
 /* ③ 审计进阶（补齐 UI） */
          jsx.jsx(dshgp_AuditAdvancedBlock, props),
          jsx.jsx(dshgp_RuleListBlock, props),
        ],
      });
    }

    /* ═══════════════════ 选项卡三：设置 ═══════════════════ */
