// dsh-skip-func-length: NPM 子页为自包含组件（自有 useState/useEffect，不依赖 controller），拆分会改动 hook 顺序与状态归属，风险高于收益
    /* ─── 第 8/14 片 · NPM 面板（账号卡 + 装包表单 + 已装列表 + npm 凭据字段） ───────────────────
     * 设计取舍：完全自包含（自己 useState/useEffect + 直接走 HTTP），不碰 40-controller（884 行）与 41-actions，
     *   把 Step 4 的改动面压到最小；数据源：/npm-account、/npm-packages、/npm-install、/settings-set、/status。
     * 安全默认与后端一致：`ignore-scripts` 默认勾选（不执行 postinstall）、默认非全局、**安装需二次确认**。
     * 复用既有 CSS 类（dshgp_block/field/label/input/hint/btn/suptab），不新增样式。
     */

    /** npm 账号卡（与 GitHub 账号卡**同款**：渐变面板 + 图标块 + 状态徽标 + 勾选明细块 + 底部操作）。 */
    function dshgp_NpmAccountCard(props) {
      const a = props.acct || {};
      const busy = !!props.busy;
      const okState = !!(a.configured && a.loggedIn);
      // 三态与 GitHub 卡同规格：已连接（ok）/ 读取中或凭据未过校验（warn）/ 未配置（err）
      const statCls = okState ? 'dshgp_acctstat_ok' : (busy || a.configured ? 'dshgp_acctstat_warn' : 'dshgp_acctstat_err');
      const statTxt = okState ? '已连接' : (busy ? '读取中' : (a.configured ? '校验未过' : '未配置'));
      const blockCls = okState ? 'dshgp_acctblock2_ok' : (busy ? 'dshgp_acctblock2_loading' : 'dshgp_acctblock2_err');
      // 明细逐行给出（成功 ✅ / 缺配置或失败 ⚠️），与 GitHub 卡那几行 ✅ 同一形态
      const blockBody = busy
        ? '正在读取 npm 登录态…'
        : (okState
          ? `✅ 凭据可用\n✅ npm token：${a.user}｜registry ${a.registry || ''}\n✅ 登录态：npm whoami 通过${a.maskedToken ? `（${a.maskedToken}）` : ''}`
          : (a.configured
            ? `⚠️ npm token 已配置但校验未通过\n⚠️ registry：${a.registry || ''}\n⚠️ 原因：${a.error || '未知'}`
            : `⚠️ 未配置 npm token\n⚠️ registry：${a.registry || ''}\n⚠️ 到「设置 → 凭据与密钥」填写 npm token 后可显示登录态`));
      return jsx.jsxs('div', {
        className: 'dshgp_acctpanel',
        children: [
          jsx.jsxs('div', {
            className: 'dshgp_accthead',
            children: [
              // 图标块复用同一套 .dshgp_acctic（npm 官方 logo 就是 npm 字样，故用文字形式落进图标块）
              jsx.jsx('div', {
                className: 'dshgp_acctic',
                children: jsx.jsx('span', { style: { fontSize: '13px', fontWeight: 700, letterSpacing: '-.5px' }, children: 'npm' }),
              }),
              jsx.jsxs('div', {
                children: [
                  jsx.jsx('p', { className: 'dshgp_accttitle', children: 'NPM 账号' }),
                  jsx.jsx('p', { className: 'dshgp_acctsub', children: 'Token / registry 检测结果 · 保存后点刷新' }),
                ],
              }),
              jsx.jsxs('span', { className: 'dshgp_acctstat ' + statCls, children: [jsx.jsx('span', { className: 'dshgp_acctdot' }), statTxt] }),
            ],
          }),
          jsx.jsx('pre', { className: 'dshgp_acctblock2 ' + blockCls, children: blockBody }),
          jsx.jsxs('div', {
            className: 'dshgp_acctfoot',
            children: [
              jsx.jsx('button', {
                type: 'button', className: 'dshgp_keybtn', disabled: busy,
                onClick: props.onRefresh, children: [dshgp_refreshIcon, busy ? '读取中…' : '刷新'],
              }),
              jsx.jsx('span', { className: 'dshgp_accthint', children: okState ? '凭据有效，可用于安装与发布' : '凭据只存本机配置目录（0600），不回传明文' }),
            ],
          }),
        ],
      });
    }

    /** 装包表单：包名 + 目标目录 + 全局/脚本开关 + 二次确认 + 回执。 */
    function dshgp_NpmInstallForm(props) {
      const st = props.st;
      return jsx.jsxs('div', {
        className: 'dshgp_block',
        children: [
          jsx.jsx('p', { className: 'dshgp_h2', style: { margin: 0 }, children: '安装包' }),
          jsx.jsx('div', {
            className: 'dshgp_field',
            children: [
              jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dshgp-npm-names', children: '包名（多个用空格或逗号分隔；支持 @scope/name@版本）' }),
              jsx.jsx('input', {
                id: 'dshgp-npm-names', type: 'text', autoComplete: 'off', spellCheck: false, className: 'dshgp_input',
                placeholder: '如 left-pad 或 @scope/pkg@1.2.3', value: st.names, disabled: st.busy,
                onChange: (ev) => st.setNames(ev.target.value),
              }),
            ],
          }),
          jsx.jsx('div', {
            className: 'dshgp_field',
            children: [
              jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dshgp-npm-dir', children: '安装到目录（全局安装时忽略）' }),
              jsx.jsx('input', {
                id: 'dshgp-npm-dir', type: 'text', autoComplete: 'off', spellCheck: false, className: 'dshgp_input',
                placeholder: '默认：当前工作区', value: st.dir, disabled: st.busy,
                onChange: (ev) => st.setDir(ev.target.value),
              }),
            ],
          }),
          jsx.jsxs('div', {
            className: 'dshgp_field',
            style: { display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' },
            children: [
              jsx.jsxs('label', { className: 'dshgp_label', style: { display: 'flex', gap: '6px', alignItems: 'center' }, children: [
                jsx.jsx('input', { type: 'checkbox', checked: st.global, disabled: st.busy, onChange: (ev) => st.setGlobal(ev.target.checked) }),
                jsx.jsx('span', { children: '全局安装（-g，会影响宿主 node 环境）' }),
              ] }),
              jsx.jsxs('label', { className: 'dshgp_label', style: { display: 'flex', gap: '6px', alignItems: 'center' }, children: [
                jsx.jsx('input', { type: 'checkbox', checked: st.ignoreScripts, disabled: st.busy, onChange: (ev) => st.setIgnoreScripts(ev.target.checked) }),
                jsx.jsx('span', { children: '不执行安装脚本（--ignore-scripts，推荐）' }),
              ] }),
            ],
          }),
          jsx.jsxs('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }, children: [
            jsx.jsx('button', {
              type: 'button', className: 'dshgp_btn', disabled: st.busy || !st.names.trim(),
              onClick: () => st.setConfirming(true), children: st.busy ? '安装中…' : '安装',
            }),
            st.confirming ? jsx.jsx('button', {
              type: 'button', className: 'dshgp_btn', disabled: st.busy, onClick: st.doInstall, children: '确认安装（二次确认）',
            }) : null,
            st.confirming ? jsx.jsx('button', { type: 'button', className: 'dshgp_btn', disabled: st.busy, onClick: () => st.setConfirming(false), children: '取消' }) : null,
          ] }),
          st.confirming ? jsx.jsx('p', { className: 'dshgp_hint', children: '即将执行 npm install' + (st.global ? '（全局）' : '') + '；装包会写入目标目录并在默认关闭脚本的前提下不执行 postinstall。确认后不可撤销。' }) : null,
          st.result ? jsx.jsxs('div', {
            className: 'dshgp_field',
            children: [
              jsx.jsx('label', { className: 'dshgp_label', children: st.result.ok ? '安装成功' : '安装失败' }),
              jsx.jsx('p', { className: 'dshgp_hint', children: (st.result.ok ? '' : (st.result.error || '') + ' ') + (st.result.logPath ? '日志：' + st.result.logPath : '') }),
              st.result.stdout ? jsx.jsx('pre', { className: 'dshgp_hint', style: { whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto' }, children: st.result.stdout }) : null,
            ],
          }) : null,
        ],
      });
    }

    /** NPM 子页：登录账号名下的包列表（与 GitHub 云端仓库列表**同款行**）+ 手动安装框。 */
    function dshgp_NpmPanel(props) {
      const s = (props && props.state) || {};
      const [acct, setAcct] = react.useState(null);
      const [pkgs, setPkgs] = react.useState(null);
      const [dir, setDir] = react.useState('');
      const [names, setNames] = react.useState('');
      const [global, setGlobal] = react.useState(false);
      const [ignoreScripts, setIgnoreScripts] = react.useState(true);
      const [confirming, setConfirming] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [result, setResult] = react.useState(null);
      const [err, setErr] = react.useState('');

      /** 读账号态 + 已装依赖；d 为空时沿用当前目录（服务端默认工作区）。 */
      const load = react.useCallback(async (d) => {
        setBusy(true);
        try {
          const a = await dshgp_getJson('/api/git-push/npm-account');
          const p = await dshgp_getJson('/api/git-push/npm-packages' + (d ? '?dir=' + encodeURIComponent(d) : ''));
          setAcct(a || null);
          setPkgs(p || null);
          if (p && p.dir) setDir(p.dir);
          setErr('');
        } catch (e) {
          setErr(String((e && e.message) || e));
        } finally {
          setBusy(false);
        }
      }, []);
      // 只在挂载时读一次（与既有 tab 的读取时机约定一致：不在每次切 tab 时重复触发）
      react.useEffect(() => { load(''); }, [load]);

      const doInstall = async () => {
        setBusy(true);
        setResult(null);
        try {
          const body = { names: names.split(/[\s,]+/).filter(Boolean), confirm: true, global, ignoreScripts };
          if (!global && dir.trim()) body.dest = dir.trim();
          // 超时给 320s（服务端安装默认 300s），避免前端先断
          const r = await dshgp_postJson('/api/git-push/npm-install', body, 320000);
          setResult(r || null);
          setConfirming(false);
          await load(dir.trim());
        } catch (e) {
          setResult({ ok: false, error: String((e && e.message) || e) });
        } finally {
          setBusy(false);
        }
      };

      const st = {
        names, setNames, dir, setDir, global, setGlobal, ignoreScripts, setIgnoreScripts,
        confirming, setConfirming, busy, result, doInstall,
      };
      const deps = (pkgs && Array.isArray(pkgs.dependencies)) ? pkgs.dependencies : [];
      return jsx.jsxs('div', {
        className: 'dshgp_section',
        children: [
          // 账号卡已上移到顶部账号区（与 GitHub 卡**同位置、滑动切换**）⇒ 这里不再重复渲染
          // 说明：原先自创的「安装包」表单（包名输入 + 目录输入 + 两个复选框）已**停用**——
          //   改为照 GitHub 的四段交互：行内「安装」→ 选择目录 / 全局安装 → 进度轮询 → 回执。
          //   组件 dshgp_NpmInstallForm 的源码暂留备查，不再渲染（comment-not-delete：只停用不删代码）。
          jsx.jsxs('div', {
            className: 'dshgp_block',
            children: [
              jsx.jsx('p', { className: 'dshgp_h2', style: { margin: 0 }, children: '已装依赖（' + (pkgs && pkgs.name ? pkgs.name : '当前目录') + '）' }),
              pkgs && pkgs.hasPackageJson === false
                ? jsx.jsx('p', { className: 'dshgp_hint', children: '该目录没有 package.json —— 安装会在目录下新建依赖树（建议先初始化）。' })
                : null,
              jsx.jsx('p', { className: 'dshgp_hint', children: 'node_modules：' + (pkgs && pkgs.nodeModules ? '已存在' : '不存在') + ' · 依赖 ' + deps.length + ' 个' }),
              deps.length
                ? jsx.jsx('div', { className: 'dshgp_field', children: deps.map((d) => jsx.jsx('div', { key: d.name, className: 'dshgp_hint', children: d.name + '  ' + d.range })) })
                : jsx.jsx('p', { className: 'dshgp_hint', children: '（无已装依赖）' }),
            ],
          }),
          jsx.jsxs('div', {
            className: 'dshgp_block',
            children: [
              jsx.jsxs('div', {
                style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' },
                children: [
                  jsx.jsx('p', { className: 'dshgp_h2', style: { margin: 0 }, children: '我的包（' + (s.npmAccountUser || '未登录') + '）' }),
                  jsx.jsx('button', { type: 'button', className: 'dshgp_keybtn', disabled: !!s.npmOwnedLoading, onClick: () => props.refreshNpmOwned(), children: s.npmOwnedLoading ? '读取中…' : '刷新列表' }),
                ],
              }),
              (Array.isArray(s.npmOwned) && s.npmOwned.length)
                ? jsx.jsx('div', {
                    children: s.npmOwned.map((p) => jsx.jsxs('div', {
                      className: 'dshgp_reprow',
                      children: [
                        jsx.jsxs('div', {
                          className: 'dshgp_reprowinfo',
                          children: [
                            jsx.jsx('span', { className: 'dshgp_reprowpath', children: p.name }),
                            jsx.jsx('span', { className: 'dshgp_reprowmeta', children: 'v' + (p.version || '?') + (p.date ? ' · ' + String(p.date).slice(0, 10) : '') }),
                          ],
                        }),
                        jsx.jsxs('div', {
                          className: 'dshgp_pushcol',
                          children: [
                            jsx.jsx('button', {
                              type: 'button', className: 'dshgp_keybtn',
                              disabled: !!s.npmInstallBusy,
                              onClick: () => props.openInstallFlow(p.name),
                              children: s.npmInstallBusy === p.name ? '安装中…' : '安装',
                            }),
                          ],
                        }),
                      ],
                    })),
                  })
                : jsx.jsx('p', { className: 'dshgp_hint', children: s.npmOwnedError || '（没有取到包：先在上方账号卡点「刷新」完成登录校验）' }),
            ],
          }),
          // 选择段（照抄 GitHub 可见性切换的遮罩对话框）：选择目录 / 全局安装 / 取消
          s.npmInstallDialog ? jsx.jsx('div', {
            className: 'dshgp_browsemask',
            children: [jsx.jsxs('div', {
              className: 'dshgp_browsedialog',
              children: [
                jsx.jsx('div', { className: 'dshgp_browsehead', children: jsx.jsx('span', { className: 'dshgp_browsetitle', children: '安装 ' + (s.npmInstallDialog.name || '') }) }),
                jsx.jsxs('div', {
                  className: 'dshgp_field',
                  children: [
                    jsx.jsx('p', { className: 'dshgp_hint', children: '选择安装位置：装到某个目录（弹目录选择器），或全局安装（-g，会影响宿主 node 环境）。默认不执行安装脚本（--ignore-scripts）。' }),
                    jsx.jsxs('div', {
                      style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' },
                      children: [
                        jsx.jsx('button', { type: 'button', className: 'dshgp_keybtn', onClick: () => props.chooseInstallDir(), children: '选择目录…' }),
                        jsx.jsx('button', { type: 'button', className: 'dshgp_keybtn', onClick: () => props.confirmInstallGlobal(), children: '全局安装' }),
                        jsx.jsx('button', { type: 'button', className: 'dshgp_keybtn', onClick: () => props.cancelInstallDialog(), children: '取消' }),
                      ],
                    }),
                  ],
                }),
              ],
            })],
          }) : null,
          // 进度段（照抄 clone 进度框样式）：运行中实时显示 npm 输出尾部
          (s.npmInstallProgress && s.npmInstallProgress.state) ? jsx.jsxs('div', {
            className: 'dshgp_cloneprog',
            children: [
              jsx.jsxs('div', {
                className: 'dshgp_cloneproghead',
                children: [
                  jsx.jsx('span', { children: '安装 ' + (s.npmInstallProgress.name || '') + ' · ' + s.npmInstallProgress.state }),
                  jsx.jsx('span', { children: Math.round((s.npmInstallProgress.elapsedMs || 0) / 1000) + 's' }),
                ],
              }),
              jsx.jsx('pre', {
                className: 'dshgp_hint',
                style: { whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto' },
                children: (s.npmInstallProgress.lines || []).slice(-12).join('\n') || '（等待 npm 输出…）',
              }),
            ],
          }) : null,
          err ? jsx.jsx('p', { className: 'dshgp_hint', children: '读取失败：' + err }) : null,
        ],
      });
    }

    /**
     * 顶部账号区：**GitHub 账号 ↔ NPM 账号 滑动切换**（同位置、同款卡片、同一套「离线读 + 在线校验」语义）。
     * 两个卡片都不感知数据来源：GitHub 卡读 props.state.account*，NPM 卡读 props.state.npmAccount*（映射后传入）。
     */
    function dshgp_AccountSwitcher(props) {
      const s = props.state || {};
      const [which, setWhich] = react.useState('github');
      const seg = [{ id: 'github', label: 'GitHub' }, { id: 'npm', label: 'NPM' }];
      const block = String(s.npmAccountBlock || '');
      const npmAcct = {
        // 直接采用后端返回的 configured 布尔（**不再从块文案反推**：旧后端不返回 block 时会误判「未配置」）
        configured: !!s.npmConfigured,
        loggedIn: !!s.npmAccountLoggedIn,
        user: s.npmAccountUser || '',
        registry: '',
        maskedToken: '',
        block,
        error: '',
      };
      return jsx.jsxs('div', {
        children: [
          jsx.jsx('div', {
            className: 'dshgp_suptabs',
            children: seg.map((t) => jsx.jsxs('button', {
              key: t.id,
              type: 'button',
              className: which === t.id ? 'dshgp_suptab dshgp_suptabOn' : 'dshgp_suptab',
              onClick: () => setWhich(t.id),
              children: [t.label],
            })),
          }),
          jsx.jsx('div', {
            className: 'dshgp_supview',
            key: which,
            children: [
              which === 'github'
                ? jsx.jsx(dshgp_AccountCard, props)
                : jsx.jsx(dshgp_NpmAccountCard, { acct: npmAcct, busy: !!s.npmAccountLoading, onRefresh: props.recheckNpmAccount }),
            ],
          }),
        ],
      });
    }

    /** 设置页「npm token / registry」字段（自包含：直接 POST /settings-set，不依赖设置快照）。 */
    function dshgp_NpmCredFields() {
      const [token, setToken] = react.useState('');
      const [registry, setRegistry] = react.useState('');
      const [msg, setMsg] = react.useState('');
      const [saving, setSaving] = react.useState(false);
      react.useEffect(() => {
        dshgp_getJson('/api/git-push/status').then((s) => {
          const c = (s && s.config) || {};
          setRegistry(c.npmRegistry || '');
          setMsg(c.npmConfigured ? '已配置（明文不回传，可覆盖填写）' : '');
        }).catch(() => { /* status 读失败不阻塞设置页 */ });
      }, []);
      const save = async () => {
        setSaving(true);
        try {
          if (registry.trim()) await dshgp_postJson('/api/git-push/settings-set', { key: 'npmRegistry', value: registry.trim() });
          if (!token.trim()) {
            setMsg(registry.trim() ? 'registry 已保存' : '没有要保存的内容');
          } else {
            const r = await dshgp_postJson('/api/git-push/settings-set', { key: 'npmToken', value: token.trim() });
            if (r && r.ok === false) setMsg('保存失败：' + (r.error || '未知错误'));
            else { setToken(''); setMsg('npm token 已保存（明文不回传）'); }
          }
        } catch (e) {
          setMsg('保存失败：' + String((e && e.message) || e));
        } finally {
          setSaving(false);
        }
      };
      return jsx.jsxs('div', {
        className: 'dshgp_field',
        children: [
          jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dshgp-npm-token', children: ['npm token', msg ? jsx.jsx('span', { className: 'dshgp_configured', children: msg }) : null] }),
          jsx.jsx('input', {
            id: 'dshgp-npm-token', type: 'text', autoComplete: 'off', spellCheck: false, className: 'dshgp_input',
            placeholder: 'npm_… （自建 registry 的 token 亦可）', value: token, disabled: saving,
            onChange: (ev) => setToken(ev.target.value),
          }),
          jsx.jsx('input', {
            id: 'dshgp-npm-registry', type: 'text', autoComplete: 'off', spellCheck: false, className: 'dshgp_input',
            placeholder: 'registry（默认 https://registry.npmjs.org/）', value: registry, disabled: saving,
            onChange: (ev) => setRegistry(ev.target.value),
          }),
          jsx.jsxs('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }, children: [
            jsx.jsx('button', { type: 'button', className: 'dshgp_btn', disabled: saving, onClick: save, children: saving ? '保存中…' : '保存 npm 凭据' }),
          ] }),
          jsx.jsx('p', { className: 'dshgp_hint', children: 'token 与 GitHub token 存同一份 config.json（0600，原子写入互不覆盖），接口不回传明文；调用 npm 时才物化成独立 npmrc。' }),
        ],
      });
    }

