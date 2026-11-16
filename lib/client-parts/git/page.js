    /* ─── 第 11/14 片 · 页面装配（GitPushPage：两选项卡聚合；审计 Tab 已移出构建） ─── */
    /**
     * 首屏骨架（R2：读回早于渲染）。
     *
     * 为什么必须有它：读回是异步的，若首帧直接渲染"真内容"，那内容里的字段全是默认值 ——
     *   用户看到的就成了「未配置」「未连接」这类**确定性的否定结论**，而事实是"还没读"。
     *   骨架明确表达"正在读"，读完由 ready 门禁切到真内容。
     */
    function dshgp_LoadingSkeleton() {
      const block = (key) => jsx.jsxs('div', { className: 'dshgp_skelblock', children: [
        jsx.jsx('div', { className: 'dshgp_skelline dshgp_skelline_m' }),
        jsx.jsx('div', { className: 'dshgp_skelline' }),
        jsx.jsx('div', { className: 'dshgp_skelline dshgp_skelline_s' }),
      ] }, key);
      return jsx.jsxs('div', {
        className: 'dshgp_skeleton',
        children: [
          jsx.jsxs('h2', { style: { margin: '0 0 10px', fontSize: '14px' }, children: ['Git 提交推送'] }),
          jsx.jsx('p', { className: 'dshgp_hint', children: '正在读取插件状态…' }),
          jsx.jsxs('div', { className: 'dshgp_skel', children: [block('a'), block('b')] }),
        ],
      });
    }

    function dshgp_GitPushPage(props) {
      dshgp_ensureCss();
      const [tab, setTab] = react.useState('account');
      // 两选项卡：审计 Tab 随审计侧解耦一起移出构建（分片在 lib/client-parts/audit/，
      //   不进产物 ⇒ UI 上不出现）。后端审计能力不受影响，提交门禁照常。
      const tabs = [
        { id: 'account', label: '账号信息' },
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

