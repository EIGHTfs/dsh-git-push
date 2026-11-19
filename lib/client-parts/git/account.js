    /* ─── 第 6/14 片 · 账号信息 Tab（AcctHead/AuthSourceBadge/DeviceAuthPanel/AccountCard/AccountTab） ─────────────────── */
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

    /* ── GitHub 授权（Device Flow）· 常量与纯函数 ────────────────────────────────
     * 为什么节奏常量放在本片：面板（渲染）在 account.js、轮询排期在 controller.js，
     *   两处要认同一组边界；本片在 PART_ORDER 里先于 controller.js，const（不提升）
     *   声明先于使用。样式同理写内联对象——样式串在 const.js，不在本次改动范围。
     */

    // 轮询节奏三边界。服务端 normally 会回 nextPollAtEpochMs，这里是它缺席/异常时的兜底：
    //   缺字段 → 按 GitHub 默认 interval 5s 走；下限挡掉 0/负值（否则变成忙等，把上游打成 429）；
    //   上限让「人走开但面板没关」的会话不会挂到超出设备码有效期太久。
    const dshgp_AUTH_POLL_FALLBACK_MS = 5_000;
    const dshgp_AUTH_POLL_MIN_MS = 1_000;
    const dshgp_AUTH_POLL_MAX_MS = 60_000;
    // 倒计时显示粒度是秒，按秒重渲染足够；更密只是白烧 CPU
    const dshgp_AUTH_TICK_MS = 1_000;
    // 「已复制」提示停留时长：够看清，又不至于挡着下一次点击
    const dshgp_AUTH_COPIED_MS = 1_600;
    // 撤销凭据是不可逆动作，按钮做成两步确认；超时未二次点击就复原成初始文案
    const dshgp_AUTH_CONFIRM_RESET_MS = 4_000;
    // 短码要人眼抄一遍（另一台设备上输入）：大字号 + 等宽 + 加宽字距，且允许整段选中
    const dshgp_AUTH_CODE_STYLE = {
      fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      fontSize: '24px',
      fontWeight: 600,
      letterSpacing: '3px',
      padding: '6px 12px',
      borderRadius: '10px',
      border: '.5px solid var(--dsw-alias-border-l2)',
      background: 'color-mix(in srgb,var(--dsw-alias-bg-base) 60%,transparent)',
      color: 'var(--dsw-alias-label-primary)',
      userSelect: 'all',
    };
    const dshgp_AUTH_ROW_STYLE = { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' };
    const dshgp_AUTH_LINK_STYLE = { textDecoration: 'none', display: 'inline-block' };

    /**
     * 服务端授权视图 → 面板用的归一形状。
     *
     * 为什么必须归一：面板要按「阶段」分支渲染，而服务端 state 是协议值
     *   （idle/awaiting_user/authorized/denied/expired/failed）；字段还可能整个缺席
     *   （后端未落地/老版本）。这里把两者都收成一条 phase，**缺失一律降级为空/0，绝不抛**——
     *   降级的正确表现是「少显示一块」，不是白屏。
     * @param {object} view 服务端响应（start/poll 同结构）
     * @returns {object} 面板用的扁平视图
     */
    function dshgp_normalizeAuthView(view) {
      const v = (view && typeof view === 'object') ? view : {};
      const state = String(v.state || '');
      let phase = 'unknown';
      if (v.tokenGranted === true || state === 'authorized') phase = 'granted';
      else if (state === 'denied') phase = 'denied';
      else if (state === 'expired') phase = 'expired';
      else if (state === 'failed') phase = 'failed';
      else if (state === 'awaiting_user') phase = 'waiting';
      return {
        phase,
        // 协议值原样留一份：将来服务端多一个状态，面板不至于因为归一表没跟上而显示错阶段
        state,
        reason: String(v.reason || ''),
        userCode: String(v.userCode || ''),
        verificationUri: String(v.verificationUri || ''),
        verificationUriComplete: String(v.verificationUriComplete || ''),
        expiresAtEpochMs: Number(v.expiresAtEpochMs) || 0,
        intervalMs: Number(v.intervalMs) || 0,
        nextPollAtEpochMs: Number(v.nextPollAtEpochMs) || 0,
        throttled: v.throttled === true,
        tokenGranted: v.tokenGranted === true,
        warning: String(v.warning || ''),
        code: String(v.code || ''),
      };
    }

    /**
     * 剩余有效期 → 「mm:ss」。
     * 只吃毫秒数，**不接受 expiresInMs 重新起算**：起算点必须是服务端给的绝对时刻
     *   expiresAtEpochMs，否则刷新页面后倒计时会回到「刚发出时的有效期」，与服务端判断打架。
     * @param {number} remainingMs 剩余毫秒（可为负）
     * @returns {string} 固定宽度的时间文本，非法值回落 '00:00'
     */
    function dshgp_formatAuthCountdown(remainingMs) {
      const numeric = Number(remainingMs);
      const safeMs = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
      const totalSeconds = Math.ceil(safeMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }

    /** ISO 时间 → 本地可读时间；空值/非法值返回空串（调用方据此整段省略，不显示「Invalid Date」）。 */
    function dshgp_formatAuthTime(iso) {
      const text = String(iso || '').trim();
      if (!text) return '';
      const at = new Date(text);
      if (Number.isNaN(at.getTime())) return '';
      return at.toLocaleString();
    }

    /**
     * 把「授权请求失败」翻译成人话。
     *
     * 为什么需要：后端未部署/版本旧时返回的是 HTML 404，`resp.json()` 抛的是
     *   「Unexpected token '<' … is not valid JSON」——原样显示等于把调试信息丢给使用者，
     *   既看不出是版本问题，也不知道该不该重试。
     * @param {unknown} error 捕获到的异常
     * @returns {string} 面向使用者的失败原因
     */
    function dshgp_describeAuthError(error) {
      const text = String((error && (error.message || error)) || '').trim();
      if (/not valid JSON|Unexpected token|JSON/i.test(text)) {
        return '服务端未提供 GitHub 授权接口（插件版本可能过旧，升级后重试）';
      }
      if (/Failed to fetch|NetworkError|network error/i.test(text)) {
        return '网络异常，连不上插件服务（检查连接后重试）';
      }
      if (/timeout|超时/i.test(text)) return '请求超时（插件服务无响应，稍后重试）';
      return text || '未知错误';
    }

    /**
     * 按授权阶段给出一句人话标题（面板第一行）。
     * 抽成纯函数而不是组件里的嵌套三元：嵌套三元改一处就要数括号（实际踩过一次括号少一个直接语法错）。
     * @param {object} view 归一后的授权视图
     * @param {string} phase 阶段（starting/waiting/granted/denied/expired/failed/unknown）
     * @returns {string} 标题文案
     */
    function dshgp_authHeadline(view, phase) {
      if (phase === 'starting') return '正在申请授权码…';
      if (phase === 'waiting') return '在 GitHub 上输入下面的短码完成授权';
      if (phase === 'granted') return '✅ 授权成功，凭据已保存';
      if (phase === 'denied') return '你拒绝了这次授权';
      if (phase === 'expired') return '授权已超时：短码失效了';
      if (phase === 'unknown') {
        // 字段全缺 = 服务端没给授权视图（多半是插件版本旧），比「授权未完成」更能指向原因
        return (view && view.reason) || '服务端未返回授权信息（插件版本可能过旧）';
      }
      return (view && view.reason) || '授权未完成';
    }

    /**
     * 凭据来源徽标：手工 PAT 还是 GitHub 授权流程。
     *
     * authMode 缺席（老后端 / 字段还没落地）⇒ **整体不渲染**：宁可少一行，
     *   也不写「未知来源」这种把「不知道」说成结论的文案。
     * @param {{state: object}} props state = controller 快照（读 authMode/authLogin/authorizedAt）
     */
    function dshgp_AuthSourceBadge(props) {
      const state = props.state || {};
      const mode = String(state.authMode || '');
      const login = String(state.authLogin || '');
      const authorizedAt = dshgp_formatAuthTime(state.authorizedAt);
      const hint = String(state.authHint || '');
      const actions = state.deviceAuthActions || {};
      // 两步确认：撤销会清掉本地凭据（不可逆），第一次点击只换成确认文案
      const [confirming, setConfirming] = react.useState(false);
      react.useEffect(() => {
        if (!confirming) return undefined;
        const timer = setTimeout(() => setConfirming(false), dshgp_AUTH_CONFIRM_RESET_MS);
        return () => clearTimeout(timer);
      }, [confirming]);
      // hooks 之后再早退：条件渲染前面的 hook 数量变化会让 React 报错
      if (mode !== 'pat' && mode !== 'device-flow') return null;
      const isDeviceFlow = mode === 'device-flow';
      const metaParts = [];
      if (login) metaParts.push('登录名 ' + login);
      if (authorizedAt) metaParts.push('授权于 ' + authorizedAt);
      return jsx.jsxs('div', {
        className: 'dshgp_credwrap',
        style: { marginTop: '8px' },
        children: [
          jsx.jsx('span', {
            className: 'dshgp_pill ' + (isDeviceFlow ? 'dshgp_pill_on' : 'dshgp_pill_off'),
            children: isDeviceFlow ? 'GitHub 授权' : '手工 PAT',
          }),
          metaParts.length
            ? jsx.jsx('span', { className: 'dshgp_credtime', children: metaParts.join(' · ') })
            : null,
          // 手工 PAT 的引导语：告诉用户还有「不用自己建 token」的路径
          !isDeviceFlow
            ? jsx.jsx('span', { className: 'dshgp_credtime', children: hint || '可改用 GitHub 授权，不必手工创建 token' })
            : null,
          isDeviceFlow
            ? jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_mini',
                onClick: confirming ? actions.revoke : () => setConfirming(true),
                children: confirming ? '确认撤销？（会清掉本地凭据）' : '撤销本地授权',
              })
            : null,
        ],
      });
    }

    /**
     * 授权面板的操作区：① 打开授权页 ② 输入短码 + 倒计时。
     *
     * 为什么单独成组件：倒计时与复制提示是**视图内状态**，把它们收在这一层后，
     *   面板主体只按阶段分支渲染，不必为了刷新一个秒数把整块面板一起重渲染。
     * @param {{view: object}} props view = 归一后的授权视图
     */
    function dshgp_DeviceAuthSteps(props) {
      const view = props.view || {};
      const expiresAtEpochMs = Number(view.expiresAtEpochMs) || 0;
      const [remainingMs, setRemainingMs] = react.useState(() => (expiresAtEpochMs ? expiresAtEpochMs - Date.now() : 0));
      const [copied, setCopied] = react.useState(false);
      // 剪贴板可能被拒（无权限 / 非安全上下文 / 无头环境）：如实说「请手动选中」，
      //   而不是让点击看起来毫无反应（短码本身已设 userSelect:all，手抄一直可用）
      const [copyFailed, setCopyFailed] = react.useState(false);
      // 倒计时基准 = 服务端给的绝对时刻（不是 expiresInMs 现算）：刷新/切 tab 后都能接着走；
      //   卸载时清 interval，避免面板关掉后每秒 setState。
      react.useEffect(() => {
        if (!expiresAtEpochMs) { setRemainingMs(0); return undefined; }
        const tick = () => setRemainingMs(expiresAtEpochMs - Date.now());
        tick();
        const timer = setInterval(tick, dshgp_AUTH_TICK_MS);
        return () => clearInterval(timer);
      }, [expiresAtEpochMs]);
      // 「已复制」靠状态翻转触发一次定时复原：卸载时 clear，不留悬挂定时器
      react.useEffect(() => {
        if (!copied) return undefined;
        const timer = setTimeout(() => setCopied(false), dshgp_AUTH_COPIED_MS);
        return () => clearTimeout(timer);
      }, [copied]);
      const openUri = view.verificationUriComplete || view.verificationUri;
      const copyLabel = copied ? '已复制' : (copyFailed ? '复制失败，请手动选中' : '复制短码');
      const onCopyCode = () => {
        // 必须把 rejection 收干净：未处理的 promise rejection 会在控制台响，
        //   而使用者那边只是「点了没反应」——两种观感都不对。
        Promise.resolve()
          .then(() => dshgp_copyText(view.userCode))
          .then(() => { setCopyFailed(false); setCopied(true); })
          .catch(() => { setCopied(false); setCopyFailed(true); });
      };
      return jsx.jsxs('div', {
        children: [
          jsx.jsxs('div', { style: dshgp_AUTH_ROW_STYLE, children: [
            jsx.jsx('span', { className: 'dshgp_label', style: { margin: 0 }, children: '① 打开授权页' }),
            openUri
              // verificationUriComplete 自带预填短码，优先用它；没有就退回「打开首页 + 手抄」
              ? jsx.jsx('a', {
                  href: openUri,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                  className: 'dshgp_keybtn dshgp_btnPrimary',
                  style: dshgp_AUTH_LINK_STYLE,
                  children: view.verificationUriComplete ? '一键打开（已预填短码）' : '打开 GitHub 授权页',
                })
              : jsx.jsx('span', { className: 'dshgp_err', children: '服务端未返回授权地址，请重试' }),
          ] }),
          // 没有预填地址时把裸地址也给出：使用者可能要在另一台设备上打开
          !view.verificationUriComplete && view.verificationUri
            ? jsx.jsx('p', { className: 'dshgp_hint', style: { wordBreak: 'break-all' }, children: view.verificationUri })
            : null,
          jsx.jsxs('div', { style: dshgp_AUTH_ROW_STYLE, children: [
            jsx.jsx('span', { className: 'dshgp_label', style: { margin: 0 }, children: '② 输入短码' }),
            view.userCode
              ? jsx.jsx('span', { style: dshgp_AUTH_CODE_STYLE, children: view.userCode })
              : jsx.jsx('span', { className: 'dshgp_err', children: '服务端未返回短码，请重试' }),
            view.userCode
              ? jsx.jsx('button', { type: 'button', className: 'dshgp_keybtn', onClick: onCopyCode, children: copyLabel })
              : null,
          ] }),
          jsx.jsx('p', {
            className: 'dshgp_hint',
            children: expiresAtEpochMs
              ? '有效期剩余 ' + dshgp_formatAuthCountdown(remainingMs) + '（到期后需重新开始授权）'
              : '有效期以服务端为准（未返回到期时刻）',
          }),
        ],
      });
    }

    /**
     * GitHub 授权面板（Device Flow）外壳：标题 + 阶段标题 + 取消/关闭 + 操作区 + 重试。
     *
     * 组件不做任何 fetch、不排轮询——动作与节奏都归 controller（见 controller.startDeviceAuth /
     *   scheduleDeviceAuthPoll）；面板只按快照里的 phase 分支渲染。
     * @param {{state: object}} props state = controller 快照（读 deviceAuth / deviceAuthActions）
     */
    function dshgp_DeviceAuthPanel(props) {
      const state = props.state || {};
      const view = state.deviceAuth || null;
      const actions = state.deviceAuthActions || {};
      if (!view) return null;
      const phase = String(view.phase || 'unknown');
      const waiting = phase === 'waiting';
      const granted = phase === 'granted';
      const showRetry = !waiting && phase !== 'starting' && !granted;
      const headline = dshgp_authHeadline(view, phase);
      // 服务端 reason 比固定文案更具体（如「授权页上没有点 Authorize」）：与标题不重复才补一行，
      //   既给出「为什么」，也避免同一句话显示两遍。
      const detail = view.reason && view.reason !== headline ? view.reason : '';
      return jsx.jsxs('div', {
        className: 'dshgp_block',
        children: [
          jsx.jsxs('div', { style: dshgp_AUTH_ROW_STYLE, children: [
            jsx.jsx('span', { className: 'dshgp_h2', style: { margin: 0 }, children: 'GitHub 授权（Device Flow）' }),
            jsx.jsx('span', { style: { marginLeft: 'auto' } }),
            jsx.jsx('button', {
              type: 'button',
              className: 'dshgp_keybtn',
              // 终态下按钮语义变成「关闭」：面板不自己消失，让使用者看清结果再走
              onClick: actions.cancel,
              children: granted || showRetry ? '关闭' : '取消',
            }),
          ] }),
          jsx.jsx('p', {
            className: granted ? 'dshgp_ok' : (showRetry ? 'dshgp_err' : 'dshgp_desc'),
            style: { margin: '8px 0 0' },
            children: headline,
          }),
          // 具体失败原因 + 服务端补充提示（如凭据落盘告警）：有才显示，没有就不占位
          detail ? jsx.jsx('p', { className: 'dshgp_hint', style: { margin: '4px 0 0' }, children: detail }) : null,
          view.warning ? jsx.jsx('p', { className: 'dshgp_hint', children: view.warning }) : null,
          waiting ? jsx.jsx(dshgp_DeviceAuthSteps, { view }) : null,
          showRetry
            ? jsx.jsxs('div', { style: dshgp_AUTH_ROW_STYLE, children: [
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshgp_keybtn dshgp_btnPrimary',
                  onClick: actions.start,
                  children: '重新开始授权',
                }),
                jsx.jsx('span', { className: 'dshgp_hint', children: '会申请一个新的短码（旧短码随即作废）' }),
              ] })
            : null,
        ],
      });
    }

    /** 账号卡片（渐变面板）渲染：头部 + 状态块 + 凭据标签 + 授权来源/授权面板 + 刷新按钮。 */
    function dshgp_AccountCard(props) {
      const s = props.state;
      const loggedIn = !!s.accountLoggedIn;
      // 「还没读 / 读失败」必须与「读到了、确实没配」分开：前者不能渲染成确定性的否定结论
      const info = (s.uiStatus && s.uiStatus.account) || { state: 'idle', error: '' };
      const unread = info.state === 'idle' || info.state === 'loading';
      const errored = info.state === 'error';
      const loading = !!s.accountLoading || unread;
      const statCls = errored ? 'dshgp_acctstat_warn' : (loggedIn ? 'dshgp_acctstat_ok' : (loading ? 'dshgp_acctstat_warn' : 'dshgp_acctstat_err'));
      const statTxt = errored ? '读取失败' : (loading ? '检测中' : (loggedIn ? '已连接' : '未连接'));
      const blockCls = loggedIn ? 'dshgp_acctblock2_ok' : (loading || errored ? 'dshgp_acctblock2_loading' : 'dshgp_acctblock2_err');
      const blockBody = s.accountBlock
        ? s.accountBlock
        : (unread ? '正在读取账号状态…'
          : (errored ? '账号状态读取失败（可点下方「重试」）'
            : '未配置 Token / SSH 公钥——请到「设置」选项卡填写凭据'));
      // 两条凭据各自独立——Token 与 SSH 可以是**不同 GitHub 用户**；明细（用户名/校验时间/
      //   配额）统一由凭据块（block，后端生成）逐行给出，页面不再另列重复的分项行。
      // 两凭据属不同用户时如实提示：推送实际走 SSH 通道
      const twoUsers = !!(s.tokenStatus && s.tokenStatus.login && s.sshStatus && s.sshStatus.login
        && s.tokenStatus.login !== s.sshStatus.login);
      // 来源徽标只在服务端给出 authMode 时才出现（字段缺席 ⇒ 少一行，而不是写「未知来源」）
      const authMode = String(s.authMode || '');
      // 入口按钮：已经走 GitHub 授权的人不必再看到「改用授权」，其余情形（手工 PAT / 没配 / 字段未落地）
      //   都保留入口 —— 没配凭据的人正好可以靠它一步拿到 token。
      const showAuthEntry = authMode !== 'device-flow';
      return jsx.jsxs('div', {
        className: 'dshgp_acctpanel',
        children: [
          jsx.jsx(dshgp_AcctHead, { statCls, statTxt }),
          jsx.jsx(dshgp_ResourceNotice, {
            info: info,
            what: '账号状态',
            onRetry: errored && props.retryResource ? () => props.retryResource('account') : null,
          }),
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
          jsx.jsx(dshgp_AuthSourceBadge, { state: s }),
          // 授权/撤销的结果提示（成功绿、失败红）：登录名与来源徽标要等下一次读回才更新，
          //   这条提示先把「刚才那一下成了没有」说清楚。
          s.deviceAuthNotice
            ? jsx.jsx('p', { className: s.deviceAuthNoticeOk ? 'dshgp_saved' : 'dshgp_err', children: s.deviceAuthNotice })
            : null,
          s.deviceAuth ? jsx.jsx(dshgp_DeviceAuthPanel, { state: s }) : null,
          jsx.jsxs('div', {
            className: 'dshgp_acctfoot',
            children: [
              jsx.jsxs('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, children: [
                jsx.jsx('button', {
                  type: 'button',
                  className: 'dshgp_keybtn',
                  disabled: loading,
                  onClick: props.recheckAccount,
                  children: [dshgp_refreshIcon, loading ? '检测中…' : '重新检测'],
                }),
                showAuthEntry
                  ? jsx.jsx('button', {
                      type: 'button',
                      className: 'dshgp_keybtn dshgp_btnPrimary',
                      disabled: !!s.deviceAuthBusy,
                      onClick: s.deviceAuthActions ? s.deviceAuthActions.start : undefined,
                      children: authMode === 'pat' ? '改用 GitHub 授权' : '用 GitHub 授权登录',
                    })
                  : null,
              ] }),
              jsx.jsx('span', { className: 'dshgp_accthint', children: loggedIn ? '登录态有效，凭据已生效' : '凭据状态来自保存的 Token / SSH 公钥' }),
            ],
          }),
        ],
      });
    }

 /** 选项卡一：账号信息（拆卡片：渐变面板 AccountCard + 本地/云端 RepoManagerCard）。 */
    function dshgp_AccountTab(props) {
      // §三：条件渲染（tab==='account'）每切回都重挂载 ⇒ 挂载即视为「面板重建」：
      //   补读没读过/已过期的资源（幂等，不产生重复请求）+ 按当前值重放显示态。
      //   这样「切 tab 回来看到空数据」不再需要用户手动点刷新。
      react.useEffect(() => { if (props.panelRebuilt) props.panelRebuilt(); }, []);
      return jsx.jsxs('div', {
        className: 'dshgp_section',
        children: [
          jsx.jsx(dshgp_AccountSwitcher, props),
          // 账号卡片：本地/云端 仓库管理（本地扫描可手动指定路径 / 云端列表可 clone）
          jsx.jsx(dshgp_RepoManagerCard, props),
        ],
      });
    }
