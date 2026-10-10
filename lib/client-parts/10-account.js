    /* ─────────────────── [4] 账号信息 Tab（AcctHead/AccountCard/AccountTab） ─────────────────── */
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
      // 两条凭据各自独立——Token 与 SSH 可以是**不同 GitHub 用户**；明细（用户名/校验时间/
      //   配额）统一由凭据块（block，后端生成）逐行给出，页面不再另列重复的分项行。
      // 两凭据属不同用户时如实提示：推送实际走 SSH 通道
      const twoUsers = !!(s.tokenStatus && s.tokenStatus.login && s.sshStatus && s.sshStatus.login
        && s.tokenStatus.login !== s.sshStatus.login);
      return jsx.jsxs('div', {
        className: 'dshgp_acctpanel',
        children: [
          jsx.jsx(dshgp_AcctHead, { statCls, statTxt }),
          jsx.jsx('pre', { className: 'dshgp_acctblock2 ' + blockCls, children: blockBody }),
          // Token / SSH 公钥的登录名与校验时间已在**凭据块内**逐行给出（Token 那行还带 API 配额后缀），
          //   此处不再另列一遍分项行——同一份登录信息展示两遍正是之前的重复问题。
          // 两条凭据可属不同 GitHub 用户（都有效），这条提示不在块内，单独保留。
          twoUsers
            ? jsx.jsx('div', {
                className: 'dshgp_acctnote',
                children: `Token 属 ${s.tokenStatus.login}，SSH 属 ${s.sshStatus.login}——推送走 SSH 通道（${s.sshStatus.login}）`,
              })
            : null,
          jsx.jsxs('div', {
            className: 'dshgp_acctfoot',
            children: [
              jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_keybtn',
                disabled: loading,
                onClick: props.recheckAccount,
                children: [dshgp_refreshIcon, loading ? '检测中…' : '重新检测'],
              }),
              jsx.jsx('span', { className: 'dshgp_accthint', children: loggedIn ? '登录态有效，凭据已生效' : '凭据状态来自保存的 Token / SSH 公钥' }),
            ],
          }),
        ],
      });
    }

 /** 选项卡一：账号信息（拆卡片：渐变面板 AccountCard + 本地/云端 RepoManagerCard）。 */
    function dshgp_AccountTab(props) {
      // 账号信息/本地仓库列表的读取时机已收敛到三种（不再每次切 tab 重读）：
      //   ①插件启动时（apply 里一次性读：refreshAccount + scanLocalRepos）
      //   ②云端 push 完成时（pushLocalRepo 成功后顺延重读）
      //   ③本地仓库手动「扫描」完成索引重建后（扫描按钮 rebuild=true 自带重读）
      //   因此这里**不再**挂载时刷新——条件渲染（tab==='account'）每次切回都重挂载，
      //   若在此触发会「一直刷新」；读取全部改由 Controller 层显式调用。
      return jsx.jsxs('div', {
        className: 'dshgp_section',
        children: [
          jsx.jsx(dshgp_AccountCard, props),
          // 账号卡片：本地/云端 仓库管理（本地扫描可手动指定路径 / 云端列表可 clone）
          jsx.jsx(dshgp_RepoManagerCard, props),
        ],
      });
    }

