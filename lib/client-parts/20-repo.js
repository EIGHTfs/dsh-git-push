    /* ─────────────────── [6] 仓库管理卡（RepoManagerCard/RepoLocalPane/RepoCloudPane） ─────────────────── */
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
      // 忙标记前缀与后端约定一致（`<kind>:<repoPath>`）：提取为命名常量，避免同一裸字面量重复。
      const BUSY_PUSH = dshgp_BUSY_PUSH; // 兼容旧引用；新代码请直接用 dshgp_BUSY_PUSH（单一出处）
      const busy = s.repoBusy === BUSY_PUSH + r.path;
      // 修正「推送判定写反」：可推 = 有远端 + 有未推送提交。
      //   ahead>0 → 本地有领先提交，按钮亮；ahead=null → 状态未知（未 fetch/首次推送），
      //   交给后端 ls-remote 精确判定，允许点；ahead=0 → 已同步、没有可推的新提交，灰。
      //   原实现用 `changed === 0`（工作树干净）当可推条件，方向反了：
      //   github push 推的是已提交内容，工作树脏不脏无影响——把「有领先提交但工作树脏」的
      //   仓库拦死（能推的不让推），又把「已同步无新提交」的仓库点亮（不能推的按钮才能点）。
      const canPush = !!r.hasRemote && (r.ahead === null || r.ahead > 0);
      // 语义纠正：stat 只体现「远端有无」与领先关系。
      // 修复「文案写死」：ahead===null 此前一律显示「远端状态未知」，
      //   但后端 null 有**两种完全不同的成因**，必须分开措辞（否则远端明明探到了还说未知）：
      //     ① liveSkipped=true —— 真的没探测（超预算/SSH 熔断/远端不可达），此时才叫未知；
      //     ② liveSkipped 非真 —— 已探到远端（remoteHead 有值），只是本地缺该提交对象
      //        算不出领先/落后（缓存过期/未 fetch），此时应说「已连通，待 fetch 后比较」。
      const remoteKnown = !!r.remoteHead;                       // 远端 HEAD 已真实取到
      const skipped = r.liveSkipped === true;                   // 本轮未探测
      let stat;
      if (!r.hasRemote) stat = '无远端';
      else if (r.ahead === null) {
        stat = skipped
          ? '未探测远端'                                       // 真未知：可点「补查」或 push 时核对
          : (remoteKnown ? '远端 ' + r.remoteHead + ' · 待 fetch 比较' : '远端已连通 · 待比较');
      } else if (r.ahead > 0) stat = '领先 ' + r.ahead;
      else if (r.behind > 0) stat = '落后 ' + r.behind;
      else stat = '同步';
      // 联动仓库索引：本地无 remote/上游时也能显示它的 GitHub 归属
      const idx = r.indexed;
      const idxTag = idx ? ' · 🔗 索引 ' + (idx.owner ? idx.owner + '/' + idx.repo : idx.repo) + '(' + idx.visibility + ')' : '';
      // 云端扫描写索引后透传的云端状态（默认分支 / 云端最后推送时间 / 纯云端标记）
      const cloudAt = r.cloudPushedAt ? ' · 云端更新 ' + String(r.cloudPushedAt).slice(0, 10) : '';
      const cloudTag = (r.defaultBranch ? ' · 默认分支 ' + r.defaultBranch : '') + cloudAt + (r.cloudOnly ? ' · 仅云端' : '');
      // 本地/云端 HEAD 与提交时间并排（后端 liveRemoteHead 真源补 remoteHead/remoteHeadAt）
      const localTime = r.localHeadAt ? new Date(r.localHeadAt).toLocaleString('zh-CN', { hour12: false }) : '';
      const remoteTime = r.remoteHeadAt ? new Date(r.remoteHeadAt).toLocaleString('zh-CN', { hour12: false }) : '';
      const headsStr = (r.localHead ? '本地 ' + r.localHead + (localTime ? ' ' + localTime : '') : '')
        + (r.remoteHead ? ' · 云端 ' + r.remoteHead + (remoteTime ? ' ' + remoteTime : '') : '');
      return jsx.jsxs('div', {
        className: 'dshgp_reprow',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_reprowinfo',
            children: [
              jsx.jsx('span', { className: 'dshgp_reprowpath', title: r.path, children: String(r.path).split('/').pop() || r.path }),
              jsx.jsx('span', { className: 'dshgp_reprowmeta', children: ['分支 ' + r.branch + ' · ' + stat + idxTag + cloudTag + (r.changed > 0 ? ' · 未提交 ' + r.changed : '')] }),
              jsx.jsx('span', { className: 'dshgp_reprowmeta' + (r.synced ? ' dshgp_synced' : ''), children: headsStr || (r.lastCommit ? r.lastCommit : '') }),
            ],
          }),
          jsx.jsxs('div', {
            className: 'dshgp_pushcol',
            children: [
              // commit 按钮与 push 并排——本地提交（复用提交推送的本地提交审计，
              //   精简报拦截/警告）；有未提交改动才可点；push 保持只负责推送。
              jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_keybtn',
                disabled: busy || !(r.changed > 0),
                onClick: () => props.onCommit(r.path),
                children: busy === 'commit:' + r.path ? '提交中…' : 'commit',
              }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_keybtn',
                disabled: !canPush || busy,
                onClick: () => props.onPush(r.path),
                children: busy === dshgp_BUSY_PUSH + r.path ? '推送中…' : 'push',
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
      // key 用 path，空 path 时回退 name（索引里云端-only 条目 path 为空，纯 path 作 key 会
      //   多条撞同一空 key → React「two children with the same key」警告）
      const rows = (s.localRepos || []).map((r) => jsx.jsx(dshgp_RepoLocalRow, { key: r.path || `name:${r.name}`, repo: r, state: s, onPush: props.pushLocalRepo, onCommit: props.commitLocalRepo }));
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
                defaultValue: dshgp_localGet('dshgp-scan-path'),
              }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_keybtn',
                // 扫描中禁用，不可重复点击（后台独立进程扫描链路）
                disabled: s.localLoading || s.localScanning,
                onClick: () => {
                  const el = document.getElementById('dshgp-local-path');
                  // 手动「扫描」= **独立进程后台离线重建 + 逐条追加**：
                  //   扫描进程每登记一个仓库就写进度文件 → 前端只追加新增（不全量重读）。
                  props.startScan(el ? el.value : '');
                },
                children: (s.localLoading || s.localScanning) ? '扫描中…' : '扫描',
              }),
            ],
          }),
          jsx.jsx('p', { className: 'dshgp_repomsg', children: s.localMsg || '扫描目录下的 git 仓库；仓库「领先远端（有未推送提交）」时可手动 push（工作树未提交改动不影响 push，推的是已提交内容）' }),
          rows.length ? jsx.jsxs('div', { className: 'dshgp_replist', children: rows }) : null,
        ],
      });
    }

    /** 云端面板单行：仓库名 + 私有/公开/分支/更新时间 + clone 按钮 + 可见性切换（1.5.4，独立弹窗二次确认）。 */
    function dshgp_RepoCloudRow(props) {
      const r = props.repo;
      const s = props.state;
      // 忙标记前缀与后端约定一致（`<kind>:<repoPath>`）：提取为命名常量，避免同一裸字面量重复。
      const BUSY_CLONE = dshgp_BUSY_CLONE; // 同上：指向单一出处
      const BUSY_VIS = dshgp_BUSY_VIS;
      const busy = s.repoBusy === BUSY_CLONE + r.fullName;
      const visBusy = s.repoBusy === BUSY_VIS + r.fullName;
      const target = r.private ? 'public' : 'private';
      // 云端仓库标记本地是否已有（后端 repos-cloud 附 localExists/localPath）
      const localTag = r.localExists
        ? jsx.jsx('span', { className: 'dshgp_pill dshgp_pill_on', children: '本地已有' })
        : null;
      return jsx.jsxs('div', {
        className: 'dshgp_reprow',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_reprowinfo',
            children: [
              jsx.jsx('span', { className: 'dshgp_reprowpath', children: r.fullName }),
              jsx.jsx('span', { className: 'dshgp_reprowmeta', children: [(r.private ? '🔒 私有' : '🌐 公开') + ' · ' + (r.defaultBranch || '') + (r.pushedAt ? ' · 更新 ' + r.pushedAt.slice(0, 10) : '')] }),
              localTag,
            ],
          }),
          jsx.jsxs('div', {
            className: 'dshgp_pushcol',
            children: [
              jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_keybtn',
                disabled: busy,
                onClick: () => props.onClone(r.fullName),
                children: busy ? '克隆中…' : 'clone',
              }),
              jsx.jsx('button', {
                type: 'button',
                className: 'dshgp_keybtn',
                disabled: visBusy,
                // 二次确认改为**独立弹窗**（Controller.visConfirm + 全局确认面板），
                //   不再行内展开确认条——点击只弹窗，确认动作全在弹窗里完成。
                onClick: () => props.requestVisSwitch(r.fullName, target),
                children: visBusy ? '切换中…' : (r.private ? '切公开' : '切私有'),
              }),
            ],
          }),
        ],
      });
    }

    /**
     * 可见性切换独立确认弹窗（1.5.4 改版：行内确认条 → 独立面板弹出）。
     * 复用 browse modal 的 fixed mask/dialog 风格；确认才调后端，取消/点遮罩关闭。
     */
    function dshgp_VisConfirmDialog(props) {
      const p = props.p || {};
      const fullName = p.fullName || '';
      const target = p.target === 'public' ? '公开' : (p.target === 'private' ? '私有' : '');
      const cur = p.cur === 'public' ? '公开' : (p.cur === 'private' ? '私有' : '');
      const busy = props.busy === true;
      return jsx.jsxs('div', {
        className: 'dshgp_browsemask',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_browsedialog',
            children: [
              jsx.jsxs('div', { className: 'dshgp_browsehead', children: [
                jsx.jsx('span', { className: 'dshgp_browsetitle', children: '切换仓库可见性' }),
                jsx.jsx('button', { type: 'button', className: 'dshgp_browseclose', disabled: busy, onClick: props.onCancel, children: '✕' }),
              ] }),
              jsx.jsx('p', { className: 'dshgp_previewtitle', children: '确认将 ' + fullName + ' 从「' + cur + '」改为「' + target + '」？' }),
              p.target === 'public'
                ? jsx.jsx('p', { className: 'dshgp_viswarn', children: '⚠ 公开后仓库对全网可见，若含 token/密钥/隐私将直接暴露——先确认无敏感信息。' })
                : jsx.jsx('p', { className: 'dshgp_repohint', children: '改为私有后，仅你（及已授予的协作者）可访问。' }),
              jsx.jsxs('div', { className: 'dshgp_previewbtns', children: [
                jsx.jsx('button', { className: 'dshgp_btn', disabled: busy, onClick: props.onConfirm, children: busy ? '切换中…' : '确认切换' }),
                jsx.jsx('button', { className: 'dshgp_btn dshgp_btnghost', disabled: busy, onClick: props.onCancel, children: '取消' }),
              ] }),
            ],
          }),
        ],
      });
    }

    /** 云端面板：账号名下所有 GitHub 仓库（token 拉取），clone 时弹目录选择器选目标目录。 */
    function dshgp_RepoCloudPane(props) {
      const s = props.state;
      const rows = (s.cloudRepos || []).map((r) => jsx.jsx(dshgp_RepoCloudRow, { key: r.fullName, repo: r, state: s, onClone: props.cloneFlow, requestVisSwitch: props.requestVisSwitch })); // bugfix：传参名写错（visSwitch→requestVisSwitch），父 props 无 visSwitch，按钮点击 = undefined() 没反应
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
          // clone 相关设置：跟随 clone 入口（属账号/云端职责）。不放进「审计」选项卡——
          //   那里只保留 maxScanFiles 一项可配（该不变量由 test-sidebar-state 守住）。
          jsx.jsxs('div', { className: 'dshgp_clonecfg', children: [
            jsx.jsxs('label', { className: 'dshgp_label', htmlFor: 'dshgp-maxclone', children: [
              '单文件上限(MB)',
              jsx.jsx('input', { id: 'dshgp-maxclone', type: 'number', min: 0, className: 'dshgp_input dshgp_inputsm', value: s.maxCloneFileMB, onChange: (ev) => props.setAdvanced('maxCloneFileMB', ev.target.value) }),
            ] }),
            jsx.jsxs('label', { className: 'dshgp_label', htmlFor: 'dshgp-cloneconc', children: [
              '并发数',
              jsx.jsx('input', { id: 'dshgp-cloneconc', type: 'number', min: 1, max: 16, className: 'dshgp_input dshgp_inputsm', value: s.cloneConcurrency, onChange: (ev) => props.setAdvanced('cloneConcurrency', ev.target.value) }),
            ] }),
          ] }),
          // clone 进度条：上百 MB 的仓库下载要几分钟，没有进度会被当成卡死。
          //   百分比按字节算（大文件占绝对多数耗时），并显示停滞时长。
          s.cloneProgress ? dshgp_CloneProgress({ p: s.cloneProgress }) : null,
          // clone 预览：先告知「会下载什么、会跳过什么」，确认再开始
          // 修：原先这里用 this.cloneConfirmed / this.publish，但本组件是普通函数
          //   `dshgp_RepoCloudPane(props)`，函数体内**没有 this**（全文件仅本行误用），
          //   ESM 严格模式下 this 为 undefined → 点击直接抛 TypeError → 按钮「点了没反应」。
          //   动作一律走 props（与同文件其余按钮一致）。
          s.clonePreview ? dshgp_ClonePreview({ p: s.clonePreview, history: s.cloneHistory, onHistoryToggle: (v) => { props.setCloneHistory(v); }, onRestart: () => { void props.cloneConfirmed(true); }, onConfirm: () => { void props.cloneConfirmed(); }, onCancel: () => { props.cancelPreview(); } }) : null,
          // 1.5.4 可见性切换独立确认面板（fixed mask + dialog）：确认才调后端
          s.visConfirm ? dshgp_VisConfirmDialog({
            p: s.visConfirm,
            busy: s.repoBusy === dshgp_BUSY_VIS + s.visConfirm.fullName,
            onConfirm: () => { void props.confirmVisSwitch(); },
            onCancel: () => { props.cancelVisSwitch(); },
          }) : null,
          rows.length ? jsx.jsxs('div', { className: 'dshgp_replist', children: rows }) : null,
        ],
      });
    }

    /* ─────────────── clone 进度条 / 预览确认（大仓库人机交互） ─────────────── */

    /**
     * clone 进度条。
     *
     * 上百 MB 的仓库要下几分钟，而前端 fetch 曾固定 30s 超时（用户实测 signal timed out）。
     * 现在由后端记录进度、前端轮询显示；**判失败不靠绝对超时，而看进度是否停滞**——
     * 单个 30MB 文件传得慢但进度在涨，不该被判死。
     */
    function dshgp_CloneProgress(props) {
      const p = props.p || {};
      const mb = (n) => (n / 1024 / 1024).toFixed(1);
      // 停滞超过 45s 才提示「可能卡住」；只提示，不自动中断（交给用户决定）
      const stalled = (p.stalledMs || 0) > 45_000;
      const phaseText = p.phase === 'done' ? '收尾中' : '下载中';
      return jsx.jsxs('div', { className: 'dshgp_cloneprog', children: [
        jsx.jsxs('div', { className: 'dshgp_cloneproghead', children: [
          jsx.jsx('span', { children: phaseText + ' ' + (p.done || 0) + '/' + (p.totalFiles || 0) + ' 个文件' }),
          jsx.jsx('span', { children: mb(p.transferred || 0) + ' / ' + mb(p.totalBytes || 0) + ' MB（' + (p.percent || 0) + '%）' }),
        ] }),
        jsx.jsx('div', { className: 'dshgp_progbar', children:
          jsx.jsx('div', { className: 'dshgp_progfill', style: { width: (p.percent || 0) + '%' } }),
        }),
        stalled ? jsx.jsx('p', { className: 'dshgp_cloneprogwarn', children: '⚠ 已 ' + Math.round((p.stalledMs || 0) / 1000) + ' 秒无新数据，可能网络受限（可继续等待，或取消后重试）' }) : null,
        (p.failed || 0) > 0 ? jsx.jsx('p', { className: 'dshgp_cloneprogwarn', children: '⚠ 已有 ' + p.failed + ' 个文件下载失败' }) : null,
      ] });
    }

    /**
     * clone 预览确认框：列出将下载 / 将跳过的文件，点「开始克隆」后才真正下载。
     *
     * 为什么必须先预览：体积守卫会**主动跳过**超大文件，若不提前告知，用户会以为
     * 克隆完整，直到使用时才发现缺文件（"悄悄少东西"最难排查）。
     */
    function dshgp_ClonePreview(props) {
      const p = props.p || {};
      const mb = (n) => (n / 1024 / 1024).toFixed(1);
      const skipped = p.skipped || [];
      return jsx.jsxs('div', { className: 'dshgp_clonepreview', children: [
        jsx.jsx('p', { className: 'dshgp_previewtitle', children: '将克隆 ' + p.repo + '（分支 ' + p.branch + '）' }),
        jsx.jsxs('ul', { className: 'dshgp_previewlist', children: [
          jsx.jsx('li', { children: '下载 ' + p.downloadCount + ' 个文件，约 ' + mb(p.downloadBytes) + ' MB' }),
          p.skippedCount > 0
            ? jsx.jsx('li', { className: 'dshgp_previewskip', children: '跳过 ' + p.skippedCount + ' 个文件（单个超过 ' + p.maxFileMB + ' MB），约 ' + mb(p.skippedBytes) + ' MB' })
            : null,
        ] }),
        // 跳过清单如实列出：让用户自行判断这些文件是否真的不需要
        skipped.length ? jsx.jsxs('div', { className: 'dshgp_previewskipbox', children: [
          jsx.jsx('p', { children: '以下文件不会下载（可在设置里调大「单文件上限」）：' }),
          jsx.jsx('ul', { children: skipped.slice(0, 8).map((x) => jsx.jsx('li', { children: x.path + '（' + mb(x.size) + ' MB）' }, x.path)) }),
          skipped.length > 8 ? jsx.jsx('p', { children: '…等共 ' + skipped.length + ' 个' }) : null,
        ] }) : null,
        // 全被跳过时强提示：否则用户会得到一个空目录
        p.empty ? jsx.jsx('p', { className: 'dshgp_cloneprogwarn', children: '⚠ 所有文件都超过上限，将得到一个空仓库。请先调大「单文件上限」或设为 0 关闭限制' }) : null,
        // 真实历史模式（可选，默认不勾）：勾选后由后端用 git fetch 取回**原始对象**，
        //   克隆结果与远端 HEAD 逐字节一致（可推回远端、可 git log 读演进）；
        //   不勾则走整树快照（与远端无祖先、不能推回）。两种模式的差别对用户是可见后果，故明写在选项上。
        //   回调做存在性保护：父组件尚未接线时勾选不会抛错（避免半接线状态炸掉整个预览框）。
        jsx.jsxs('label', { className: 'dshgp_previewopt', children: [
          jsx.jsx('input', {
            type: 'checkbox',
            // 与后端默认保持一致：**不勾也带历史**（后端默认开）。显式取消勾选才会退回整树快照。
            //   这样即使父组件尚未接线，界面语义也与真实行为一致（不会出现「看着没勾、其实带历史」）。
            checked: props.history !== false,
            onChange: (e) => { if (typeof props.onHistoryToggle === 'function') props.onHistoryToggle(!!e.target.checked); },
          }),
          jsx.jsx('span', { children: '带真实历史（可推回远端；文件按提交逐个下载，较慢）' }),
        ] }),
        // 目标目录已存在且不完整时，明确告知「默认续传」并给出「重来」
        //   （重来 = 只清 .dsh-parts 分片、不动已下文件与用户内容；后端 restart 语义已验证）
        p.partial ? jsx.jsx('p', { className: 'dshgp_previewpartial', children: '检测到上次未完成的克隆（已下载的文件保留）——默认可直接续传；若要丢弃断点重下，点「重来」。' }) : null,
        jsx.jsxs('div', { className: 'dshgp_previewbtns', children: [
          jsx.jsx('button', { className: 'dshgp_btn', onClick: props.onConfirm, children: '开始克隆' }),
          p.partial ? jsx.jsx('button', { className: 'dshgp_btn dshgp_btnghost', onClick: () => { if (typeof props.onRestart === 'function') props.onRestart(); }, children: '重来' }) : null,
          jsx.jsx('button', { className: 'dshgp_btn dshgp_btnghost', onClick: props.onCancel, children: '取消' }),
        ] }),
      ] });
    }

