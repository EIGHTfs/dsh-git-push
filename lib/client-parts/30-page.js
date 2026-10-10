    /* ─────────────────── [9] 页面装配（GitPushPage：三选项卡聚合） ─────────────────── */
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
      // 账号选项卡下的本地/云端卡片需要全部注入动作（scanLocalRepos/loadCloudRepos/
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
          setAdvanced: props.setAdvanced,
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
            setAdvanced: props.setAdvanced,
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

