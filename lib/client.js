window.__ModuleLoader__.load({
  id: 'dsh-git-push',
  // v1.42.0：参数去括号（require => 单参箭头不匹配函数行数计数的 fnStart 正则），
  // 使工厂内部函数被 checkFunctionLength 独立计数——纯语法等价改写，行为零变化。
  factory: require => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    const jsx = require('react/jsx-runtime');
    const react = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const store = require('@deepseek-ai/dsh-client-store');

    const NS = 'settings.gitPush';
    const SETTINGS_NS = 'git-push';
    const Icon = primitives.IconChevronDownOutline14;

    const zh = {
      title: 'Git 提交推送',
      description: '填写 GitHub token。保存后写入插件配置目录 git-push/github-token（0600），不进公开配置。',
      token: 'GitHub token',
      tokenHint: 'ghp_ / github_pat_ 开头。保存后明文不会留在设置页。',
      sshPub: 'SSH 公钥',
      sshHint: 'ssh-ed25519 / ssh-rsa 整行。保存到同级仓 *.pub，不回传明文。',
      tokenSet: '已配置',
      tokenUnset: '未配置',
      check: '检测可用',
      checking: '检测中…',
      expand: '展开设置',
      collapse: '收起设置',
      save: '保存',
      saving: '保存中…',
      discard: '放弃',
      unsaved: '未保存',
      saveFailed: '未写入成功，请检查 token 格式后重试。',
      viewer: '打开提交历史查看器',
      viewerHint: '查看 workspace 全部 git 仓库的提交历史与文件 diff（只读）。',
      injectFullSkill: '注入全部 skill 内容',
      injectFullSkillHint: '勾选 = 每个会话注入插件 skills + 技能仓库（ai-work-archive/skills 的 git-workflow 部分）全部 skill 正文；不勾选（默认）= 只注入 skill 目录+文件清单，正文按需读取，省 token。修改即时保存。',
      hardcodeFullScan: '硬编码全量扫',
      hardcodeFullScanHint: '勾选 = 审计硬编码（本机绝对路径/局域网 IP）时扫整个文件（含既有历史行），用于换机前排查存量死路径；不勾选（默认）= 只扫本次新增/变更行。修改即时保存。',
      injectRepoIndexFull: '注入 repo-index JSON 全文',
      injectRepoIndexFullHint: '勾选 = 每个会话注入 dsh-repo-index.json 正文；不勾选（默认）= 只注入文件名/路径，正文按需读取。md 表格已废弃，权威源是 JSON。修改即时保存。',
      saved: '✅ 已保存并生效',
      savedFullSkillOn: '✅ 已开启：下次会话起每会话注入两仓 skill 全文',
      savedFullSkillOff: '✅ 已关闭：只注入 skill 目录+文件清单（省 token）',
      savedRepoIndexOn: '✅ 已开启：下次会话起注入 dsh-repo-index.json 正文',
      savedRepoIndexOff: '✅ 已关闭：只注入 dsh-repo-index.json 文件名',
      savedHardcodeOn: '✅ 已开启：硬编码审计全量扫整个文件',
      savedHardcodeOff: '✅ 已关闭：硬编码审计只扫新增/变更行',
      savedIgnore: '✅ 自定义忽略已保存：提交时自动写入目标仓库 .gitignore',
      savedRuleOrder: '✅ 规则加载顺序已保存：下次审计按新顺序生效（后覆盖前）',
      savedRuleWeight: '✅ 关键词权重已保存：≥40 进门禁 blocker，下次审计生效',
      accountTopHint: '账号状态（Token / SSH 公钥检测结果，进入设置自动检测）',
      sshEmail: 'SSH 邮箱（生成公钥用）',
      sshEmailHint: '如 862434889@qq.com。生成 ssh-rsa 4096 密钥对，私钥留本机，公钥复制到 GitHub → Settings → SSH and GPG keys → New SSH key。',
      genKey: '生成公钥',
      genKeying: '生成中…',
      genKeyDone: '✅ 公钥已生成并写入同级仓 *.pub，可复制下面公钥去 GitHub 绑定',
      genKeyFail: '生成失败: ',
      pubPreview: '生成的公钥（一键复制去 GitHub 绑定）',
      copyKey: '📋 一键复制',
      copyKeyDone: '✅ 已将公钥复制到剪贴板，去 GitHub 粘贴即可',
      copyKeyFail: '❌ 复制失败（请手动选中复制）: ',
      ignorePatterns: '自定义忽略文件',
      ignorePatternsHint: '逗号或换行分隔的 gitignore 模式（如 *.bak*、*.tmp）。提交时自动追加到目标仓库 .gitignore，已跟踪文件自动解除跟踪。修改即时保存。',
      // v1.49.0：侧边栏独立页——只读登录信息 + 引导去插件配置填写（不复用插件配置折叠卡）
      // v1.49.1：客户端无跨 section 跳转 API（设置面板 section 切换为组件本地 state），「去插件配置填写」按钮无法跳转 → 移除按钮，保留纯文本引导
      sectionGuideTitle: '登录信息（只读）',
      sectionGuide: 'Token 与 SSH 公钥的填写、检测、保存在插件配置里进行，本页只读展示登录状态。',
      sectionGoConfigHint: '填写入口：侧边栏 → 设置 → 插件 → 插件配置 → Git 提交推送',
      sectionAdvanced: '高级设置（即时保存）',
    };
    const en = {
      title: 'Git push',
      description: 'GitHub token. Saved to the plugin config dir (git-push/github-token, 0600), not the public settings document.',
      token: 'GitHub token',
      tokenHint: 'Starts with ghp_ or github_pat_. The literal is not kept on this page after save.',
      sshPub: 'SSH public key',
      sshHint: 'Full ssh-ed25519 / ssh-rsa line. Stored as sibling *.pub.',
      tokenSet: 'Configured',
      tokenUnset: 'Not set',
      check: 'Check',
      checking: 'Checking…',
      expand: 'Show settings',
      collapse: 'Hide settings',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      unsaved: 'Unsaved',
      saveFailed: 'The token was not stored. Check the format and try again.',
      viewer: 'Open commit history viewer',
      viewerHint: 'Browse commit history and file diffs of all workspace git repos (read-only).',
      injectFullSkill: 'Inject full skill content',
      injectFullSkillHint: 'Checked = inject the full text of all skills from the plugin skills dir + the skill repo (ai-work-archive/skills git-workflow part) into every session; unchecked (default) = inject only skill dirs + file lists, read bodies on demand to save tokens. Saved immediately.',
      hardcodeFullScan: 'Hardcode full scan',
      hardcodeFullScanHint: 'Checked = when auditing hardcoded local absolute paths / LAN IPs, scan the entire file (including pre-existing lines) to hunt legacy dead paths before migrating machines; unchecked (default) = scan only newly added/changed lines. Saved immediately.',
      injectRepoIndexFull: 'Inject full repo-index JSON',
      injectRepoIndexFullHint: 'Checked = inject the body of dsh-repo-index.json; unchecked (default) = inject only the file path. Markdown tables are retired. Saved immediately.',
      saved: '✅ Saved and active',
      savedFullSkillOn: '✅ ON: every session injects full skill texts of both repos',
      savedFullSkillOff: '✅ OFF: only skill dirs + file lists (token saving)',
      savedRepoIndexOn: '✅ ON: inject dsh-repo-index.json body',
      savedRepoIndexOff: '✅ OFF: inject dsh-repo-index.json path only',
      savedHardcodeOn: '✅ ON: hardcode audit scans the whole file',
      savedHardcodeOff: '✅ OFF: hardcode audit scans only added lines',
      savedIgnore: '✅ Custom ignore saved: appended to target repo .gitignore on commit',
      savedRuleOrder: '✅ Rule load order saved: next audit uses the new order (later overrides earlier)',
      savedRuleWeight: '✅ Keyword weight saved: ≥40 enters commit gate (blocker)',
      accountTopHint: 'Account status (Token / SSH key check, auto-runs on opening settings)',
      sshEmail: 'SSH email (for key generation)',
      sshEmailHint: 'e.g. 862434889@qq.com. Generates ssh-rsa 4096 keypair; private key stays local, copy the public key to GitHub → Settings → SSH and GPG keys → New SSH key.',
      genKey: 'Generate key',
      genKeying: 'Generating…',
      genKeyDone: '✅ Key generated and written to sibling *.pub; copy the public key below to GitHub',
      genKeyFail: 'Generation failed: ',
      pubPreview: 'Generated public key (one-click copy to bind on GitHub)',
      copyKey: '📋 Copy',
      copyKeyDone: '✅ Public key copied to clipboard — paste it on GitHub',
      copyKeyFail: '❌ Copy failed (select and copy manually): ',
      ignorePatterns: 'Custom ignore patterns',
      ignorePatternsHint: 'Comma or newline separated gitignore patterns (e.g. *.bak*, *.tmp). Appended to the target repo .gitignore on commit; tracked matches are untracked automatically. Saved immediately.',
      // v1.49.0：侧边栏独立页——只读登录信息 + 引导去插件配置填写（不复用插件配置折叠卡）
      // v1.49.1：客户端无跨 section 跳转 API（设置面板 section 切换为组件本地 state），「去插件配置填写」按钮无法跳转 → 移除按钮，保留纯文本引导
      sectionGuideTitle: 'Account status (read-only)',
      sectionGuide: 'Token and SSH public key are entered, checked and saved in the plugin config page; this page only shows the login status read-only.',
      sectionGoConfigHint: 'Entry point: Sidebar → Settings → Plugins → Plugin config → Git push',
      sectionAdvanced: 'Advanced settings (saved immediately)',
    };

    const cssText = [
      '.dshgp_card{list-style:none;border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:var(--dsw-alias-bg-layer-3)}',
      '.dshgp_open{background:var(--dsw-alias-bg-layer-2)}',
      '.dshgp_header{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px}',
      '.dshgp_head{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
      '.dshgp_name{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshgp_desc{font-size:13px;color:var(--dsw-alias-label-tertiary)}',
      '.dshgp_badge{border-radius:999px;padding:1px 8px;font-size:11px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}',
      '.dshgp_body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding:12px 0 8px;display:flex;flex-direction:column;gap:8px}',
      '.dshgp_label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.dshgp_input{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px}',
      '.dshgp_hint{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.dshgp_fail{margin:0;font-size:12px;color:var(--dsw-alias-label-error)}',
      '.dshgp_block{white-space:pre-wrap;margin:0;font-size:12px;line-height:1.6;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
      '.dshgp_ok{color:var(--dsw-alias-label-primary)}',
      '.dshgp_err{color:var(--dsw-alias-label-error)}',
      '.dshgp_foot{display:flex;justify-content:flex-end;gap:8px;padding-top:8px;flex-wrap:wrap}',
      '.dshgp_btn{font:inherit;font-size:13px;border-radius:8px;padding:6px 12px;cursor:pointer}',
      '.dshgp_viewer{display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap}',
      '.dshgp_viewerbtn{font:inherit;font-size:13px;border-radius:8px;padding:8px 14px;cursor:pointer;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l4)}',
      '.dshgp_viewerbtn:hover{background:var(--dsw-alias-bg-layer-3)}',
      '.dshgp_check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.dshgp_checkbox{width:16px;height:16px;accent-color:var(--dsw-alias-accent,var(--dsw-alias-label-primary));cursor:pointer}',
      '.dshgp_saved{margin:0;font-size:12px;color:var(--dsw-alias-label-success,var(--dsw-alias-label-primary));padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3)}',
      '.dshgp_top{display:flex;flex-direction:column;gap:6px}',
      '.dshgp_toplabel{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.dshgp_row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.dshgp_email{flex:1;min-width:160px}',
      '.dshgp_pub{white-space:pre-wrap;word-break:break-all;margin:0;font-size:11px;line-height:1.5;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);max-height:120px;overflow:auto}',
      '.dshgp_keybtn{font:inherit;font-size:13px;border-radius:8px;padding:6px 14px;cursor:pointer;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l4)}',
      '.dshgp_keybtn:hover{background:var(--dsw-alias-bg-layer-3)}',
      '.dshgp_keybtn:disabled{opacity:.6;cursor:default}',
      // v1.47.0：规则引擎卡样式（顺序排序 + 权重滑块）
      '.dshgp_rules{display:flex;flex-direction:column;gap:6px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:10px}',
      '.dshgp_rules_h{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshgp_rules_h2{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);margin-top:4px}',
      '.dshgp_rules_order{display:flex;flex-direction:column;gap:4px}',
      '.dshgp_rules_row{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.dshgp_rules_tpl{gap:8px}',
      '.dshgp_rules_forced{gap:8px;color:var(--dsw-alias-label-secondary,inherit)}',
      '.dshgp_mini_lock{display:inline-grid;place-items:center;line-height:1;font-size:12px}',
      '.dshgp_mini{font:inherit;font-size:12px;line-height:1;width:22px;height:22px;border-radius:6px;cursor:pointer;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l4)}',
      // v1.49.0：侧边栏独立页样式（平铺，无折叠头）
      '.dshgp_section{display:flex;flex-direction:column;gap:14px}',
      '.dshgp_sectionblock{border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-layer-3);padding:12px 14px;display:flex;flex-direction:column;gap:8px}',
      '.dshgp_section_h{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0}',
      '.dshgp_section_guide{display:flex;flex-direction:column;gap:4px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:8px}',
      '.dshgp_mini:disabled{opacity:.4;cursor:default}',
      '.dshgp_rules_name{flex:1}',
      '.dshgp_rules_weights{display:flex;flex-direction:column;gap:4px}',
      '.dshgp_weight_row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.dshgp_weight_name{width:64px;flex-shrink:0}',
      '.dshgp_weight_val{width:64px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',
      '.dshgp_rules_note{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
    ].join('');

    function ensureCss() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css="dsh-git-push"]')) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-git-push';
      tag.dataset.pluginCss = 'dsh-git-push';
      tag.textContent = cssText;
      document.head.appendChild(tag);
    }

    /** v1.42.0：git-push 设置卡片——拆成 8 个子组件（渲染输出与 hooks 行为零变化），本函数只组装 */
    function GitPushCard(props) {
      ensureCss();
      const t = props.t;
      const state = props.useGitPushCard((s) => s);
      // v1.49.1：插件配置卡默认展开（填写处 token/SSH key/保存按钮刷新后直接可见，仍可点头部手动收起）——
      // 此前默认收起，刷新后 body 被折叠隐藏，用户误以为填写处被删
      const [open, setOpen] = react.useState(true);
      // v1.29.0 需求③：每次展开设置卡片自动跑一次账号检测（check 内部有 checking 防重）
      react.useEffect(() => {
        if (open) props.check();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [open]);
      if (!state.available) return null;
      const title = t('title');
      const cardProps = { ...props, state, open, setOpen, title };
      return jsx.jsxs('li', {
        className: 'dshgp_card' + (open ? ' dshgp_open' : ''),
        children: [
          GitPushHeader(cardProps),
          open
            ? jsx.jsxs('div', {
              className: 'dshgp_body',
              children: [
                /* v1.49.0：插件配置卡只保留 token / SSH key / 登录信息三块（其余高级设置移入侧边栏独立页 GitPushSectionPage） */
                GitPushAccountTop(cardProps),
                GitPushKeyGen(cardProps),
                GitPushTokenFields(cardProps),
                GitPushActionButtons(cardProps),
              ],
            })
            : null,
        ],
      });
    }

    /** v1.42.0：设置卡片头部按钮（名称/描述/已配置·未保存徽标/展开图标）——GitPushCard 拆出的子组件（渲染输出零变化） */
    function GitPushHeader(props) {
      const t = props.t;
      const state = props.state;
      const open = props.open;
      const setOpen = props.setOpen;
      const title = props.title;
      return (
          jsx.jsxs('button', {
            type: 'button',
            className: 'dshgp_header',
            'aria-expanded': open,
            'aria-label': (open ? t('collapse') : t('expand')) + ': ' + title,
            onClick: () => setOpen(!open),
            children: [
              jsx.jsxs('span', {
                className: 'dshgp_head',
                children: [
                  jsx.jsx('span', { className: 'dshgp_name', children: title }),
                  jsx.jsx('span', { className: 'dshgp_desc', children: t('description') }),
                ],
              }),
              state.configured ? jsx.jsx('span', { className: 'dshgp_badge', children: t('tokenSet') }) : jsx.jsx('span', { className: 'dshgp_badge', children: t('tokenUnset') }),
              state.dirty ? jsx.jsx('span', { className: 'dshgp_badge', children: t('unsaved') }) : null,
              Icon ? jsx.jsx(Icon, {}) : null,
            ],
          })
      );
    }

    /** v1.42.0：账号状态检测块（v1.29.0 需求③置顶展示）——GitPushCard 拆出的子组件（渲染输出零变化） */
    function GitPushAccountTop(props) {
      const t = props.t;
      const state = props.state;
      return (
                // v1.29.0 需求③：账号状态检测块置顶 + 默认进入自动查（check 已挂 useEffect）
                jsx.jsxs('div', {
                  className: 'dshgp_top',
                  children: [
                    jsx.jsx('p', { className: 'dshgp_toplabel', children: t('accountTopHint') }),
                    state.block
                      ? jsx.jsx('pre', { className: 'dshgp_block ' + (state.loggedIn ? 'dshgp_ok' : 'dshgp_err'), children: state.block })
                      : jsx.jsx('pre', { className: 'dshgp_block', children: state.checking ? t('checking') + '…' : t('tokenUnset') }),
                  ],
                })
      );
    }

    /** v1.42.0：SSH 邮箱 + 生成公钥 + 公钥回显/一键复制（v1.29.0 需求① / v1.30.0）——GitPushCard 拆出的子组件（渲染输出零变化） */
    function GitPushKeyGen(props) {
      const t = props.t;
      const state = props.state;
      return (
                // v1.29.0 需求①：SSH 邮箱 + 生成公钥（ssh-keygen -t rsa -b 4096 -C 邮箱）
                jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dsh-git-push-ssh-email', children: t('sshEmail') }),
                jsx.jsxs('div', {
                  className: 'dshgp_row',
                  children: [
                    jsx.jsx('input', {
                      id: 'dsh-git-push-ssh-email',
                      className: 'dshgp_input dshgp_email',
                      type: 'text',
                      autoComplete: 'off',
                      placeholder: 'you@example.com',
                      value: state.sshEmail,
                      disabled: state.genKeying,
                      onChange: (ev) => props.editSshEmail(ev.target.value),
                    }),
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dshgp_keybtn',
                      disabled: state.genKeying || !state.sshEmail.trim(),
                      onClick: () => props.genKey(state.sshEmail.trim()),
                      children: t(state.genKeying ? 'genKeying' : 'genKey'),
                    }),
                  ],
                }),
                jsx.jsx('p', { className: 'dshgp_hint', children: t('sshEmailHint') }),
                state.genKeyError ? jsx.jsx('p', { className: 'dshgp_fail', children: t('genKeyFail') + state.genKeyError }) : null,
                state.generatedPub
                  ? jsx.jsxs('div', {
                    className: 'dshgp_top',
                    children: [
                      jsx.jsx('p', { className: 'dshgp_saved', children: t('genKeyDone') }),
                      jsx.jsx('p', { className: 'dshgp_toplabel', children: t('pubPreview') }),
                      jsx.jsx('pre', { className: 'dshgp_pub', children: state.generatedPub }),
                      // v1.30.0：一键复制公钥（navigator.clipboard + execCommand 兜底）
                      jsx.jsx('button', {
                        type: 'button',
                        className: 'dshgp_keybtn',
                        onClick: () => props.copySshPub(),
                        children: t('copyKey'),
                      }),
                    ],
                  })
                  : null
      );
    }

    /** v1.42.0：保存反馈 + GitHub token / SSH 公钥输入——GitPushCard 拆出的子组件（渲染输出零变化） */
    function GitPushTokenFields(props) {
      const t = props.t;
      const state = props.state;
      return (
                state.savedMsg ? jsx.jsx('p', { className: 'dshgp_saved', children: t(state.savedMsg) }) : null,
                jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dsh-git-push-token', children: t('token') }),
                jsx.jsx('input', {
                  id: 'dsh-git-push-token',
                  className: 'dshgp_input',
                  type: 'password',
                  autoComplete: 'off',
                  value: state.text,
                  disabled: !state.writable || state.saving,
                  onChange: (ev) => props.edit(ev.target.value),
                }),
                jsx.jsx('p', { className: 'dshgp_hint', children: t('tokenHint') }),
                jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dsh-git-push-ssh', children: t('sshPub') }),
                jsx.jsx('input', {
                  id: 'dsh-git-push-ssh',
                  className: 'dshgp_input',
                  type: 'text',
                  autoComplete: 'off',
                  value: state.sshPub,
                  disabled: !state.writable || state.saving,
                  onChange: (ev) => props.editSsh(ev.target.value),
                }),
                jsx.jsx('p', { className: 'dshgp_hint', children: t('sshHint') })
      );
    }

    /** v1.42.0：注入全文 / 注入 repo-index / 硬编码全量扫三个开关——GitPushCard 拆出的子组件（渲染输出零变化） */
    function GitPushCheckFields(props) {
      const t = props.t;
      const state = props.state;
      return (
                jsx.jsx('label', { className: 'dshgp_check', htmlFor: 'dsh-git-push-inject-full', children: [
                  jsx.jsx('input', {
                    id: 'dsh-git-push-inject-full',
                    className: 'dshgp_checkbox',
                    type: 'checkbox',
                    checked: !!state.injectFullSkill,
                    disabled: !state.writable,
                    onChange: (ev) => props.toggleFullSkill(ev.target.checked),
                  }),
                  t('injectFullSkill'),
                ] }),
                jsx.jsx('p', { className: 'dshgp_hint', children: t('injectFullSkillHint') }),
                jsx.jsx('label', { className: 'dshgp_check', htmlFor: 'dsh-git-push-inject-repo-index', children: [
                  jsx.jsx('input', {
                    id: 'dsh-git-push-inject-repo-index',
                    className: 'dshgp_checkbox',
                    type: 'checkbox',
                    checked: !!state.injectRepoIndexFull,
                    disabled: !state.writable,
                    onChange: (ev) => props.toggleRepoIndexFull(ev.target.checked),
                  }),
                  t('injectRepoIndexFull'),
                ] }),
                jsx.jsx('p', { className: 'dshgp_hint', children: t('injectRepoIndexFullHint') }),
                jsx.jsx('label', { className: 'dshgp_check', htmlFor: 'dsh-git-push-hardcode-full', children: [
                  jsx.jsx('input', {
                    id: 'dsh-git-push-hardcode-full',
                    className: 'dshgp_checkbox',
                    type: 'checkbox',
                    checked: !!state.hardcodeFullScan,
                    disabled: !state.writable,
                    onChange: (ev) => props.toggleHardcodeFull(ev.target.checked),
                  }),
                  t('hardcodeFullScan'),
                ] }),
                jsx.jsx('p', { className: 'dshgp_hint', children: t('hardcodeFullScanHint') })
      );
    }

    /** v1.42.0：自定义忽略 pattern 输入 + 保存失败提示——GitPushCard 拆出的子组件（渲染输出零变化） */
    function GitPushIgnoreField(props) {
      const t = props.t;
      const state = props.state;
      return (
                jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dsh-git-push-ignore-patterns', children: t('ignorePatterns') }),
                jsx.jsx('input', {
                  id: 'dsh-git-push-ignore-patterns',
                  className: 'dshgp_input',
                  type: 'text',
                  autoComplete: 'off',
                  placeholder: '*.bak*, *.tmp',
                  value: state.ignorePatterns,
                  disabled: !state.writable,
                  onChange: (ev) => props.editIgnorePatterns(ev.target.value),
                }),
                jsx.jsx('p', { className: 'dshgp_hint', children: t('ignorePatternsHint') }),
                state.failed ? jsx.jsx('p', { className: 'dshgp_fail', children: t('saveFailed') }) : null
      );
    }

    /** v1.42.0：提交历史查看器入口——GitPushCard 拆出的子组件（渲染输出零变化） */
    function GitPushViewerButtons(props) {
      const t = props.t;
      const state = props.state;
      return (
                jsx.jsxs('div', {
                  className: 'dshgp_viewer',
                  children: [
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dshgp_viewerbtn',
                      title: t('viewerHint'),
                      onClick: () => window.open(location.origin + '/git-push/viewer', '_blank', 'noopener'),
                      children: t('viewer'),
                    }),
                    jsx.jsx('p', { className: 'dshgp_hint', children: t('viewerHint') }),
                  ],
                })
      );
    }

    /** v1.42.0：底部检测 / 放弃 / 保存按钮——GitPushCard 拆出的子组件（渲染输出零变化） */
    function GitPushActionButtons(props) {
      const t = props.t;
      const state = props.state;
      return (
                jsx.jsxs('div', {
                  className: 'dshgp_foot',
                  children: [
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dshgp_btn',
                      disabled: state.checking || state.saving,
                      onClick: props.check,
                      children: t(state.checking ? 'checking' : 'check'),
                    }),
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dshgp_btn',
                      disabled: !state.dirty || state.saving,
                      onClick: props.discard,
                      children: t('discard'),
                    }),
                    jsx.jsx('button', {
                      type: 'button',
                      className: 'dshgp_btn',
                      disabled: !state.dirty || state.saving || (!state.text.trim() && !state.sshPub.trim()),
                      onClick: props.save,
                      children: t(state.saving ? 'saving' : 'save'),
                    }),
                  ],
                })
      );
    }


    /** v1.47.0：审计规则引擎卡——槽位顺序（可排序/开关，后覆盖前）+ comment 关键词权重（滑块，≥40 进门禁） */
    function GitPushRuleCards(props) {
      const state = props.state;
      if (!state.available) return null;
      // 规则槽位：可排序多身份（nodejs/frontend/comment/dsh/template）+ 强制槽位 private（v1.48.0 私密拦截，不可排序）
      const SLOT_NAMES = { nodejs: 'Node.js 规则', frontend: '前端 HTML 规则', comment: '关键词规则', dsh: 'dsh 插件审计（v1.50.0）', template: 'template 模板（空）', private: '私密文件拦截（强制）' };
      // v1.50.0：dsh 槽位加入默认顺序；存量用户若之前排序过（ruleOrder 不含 dsh）自动补在末尾，保证新规则默认生效
      let order = Array.isArray(state.ruleOrder) && state.ruleOrder.length ? [...state.ruleOrder] : ['nodejs', 'frontend', 'comment', 'dsh'];
      if (order.length && !order.includes('dsh') && !order.includes('template')) order.push('dsh');
      else if (order.length && !order.includes('dsh')) {
        const ti = order.indexOf('template');
        order.splice(ti < 0 ? order.length : ti, 0, 'dsh');
      }
      const active = order.filter((s) => s !== 'template');
      // 权重表：pattern → 当前生效值（覆盖优先）
      const weights = (state.ruleWeights && state.ruleWeights.blacklist) || {};
      const move = (slot, dir) => {
        const next = [...order];
        const i = next.indexOf(slot);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= next.length) return;
        [next[i], next[j]] = [next[j], next[i]];
        props.saveRuleOrder(next);
      };
      const toggleTemplate = (on) => {
        let next = [...order];
        if (on && !next.includes('template')) next.push('template');
        else if (!on) next = next.filter((s) => s !== 'template');
        props.saveRuleOrder(next);
      };
      return jsx.jsxs('div', {
        className: 'dshgp_rules',
        children: [
          jsx.jsx('div', { className: 'dshgp_rules_h', children: '规则引擎（YAML）' }),
          // 顺序行
          jsx.jsxs('div', {
            className: 'dshgp_rules_order',
            children: [
              active.map((slot) => jsx.jsxs('div', {
                key: slot,
                className: 'dshgp_rules_row',
                children: [
                  jsx.jsx('button', { type: 'button', className: 'dshgp_mini', disabled: order.indexOf(slot) === 0, onClick: () => move(slot, -1), children: '↑' }),
                  jsx.jsx('button', { type: 'button', className: 'dshgp_mini', disabled: order.indexOf(slot) === order.length - 1, onClick: () => move(slot, 1), children: '↓' }),
                  jsx.jsx('span', { className: 'dshgp_rules_name', children: (SLOT_NAMES[slot] || slot) + (order.indexOf(slot) === 0 ? '（先加载）' : order.indexOf(slot) === order.length - 1 ? '（后覆盖）' : '') }),
                ],
              })),
              jsx.jsxs('div', {
                className: 'dshgp_rules_row dshgp_rules_forced',
                children: [
                  jsx.jsx('span', { className: 'dshgp_mini dshgp_mini_lock', children: '🔒' }),
                  jsx.jsx('span', { className: 'dshgp_rules_name', children: '私密文件拦截（强制加载，不可排序；远端公开+含私钥/token → 拦截）' }),
                ],
              }),
              jsx.jsxs('div', {
                className: 'dshgp_rules_row dshgp_rules_tpl',
                children: [
                  jsx.jsx('input', { type: 'checkbox', checked: order.includes('template'), onChange: (e) => toggleTemplate(e.target.checked) }),
                  jsx.jsx('span', { className: 'dshgp_rules_name', children: '启用 template 自定义规则文件（空模板，默认不加载）' }),
                ],
              }),
            ],
          }),
          // 权重块（comment 黑名单 Top——权重 ≥40 进提交门禁措辞）
          jsx.jsx('div', { className: 'dshgp_rules_h2', children: '关键词权重（≥40 进门禁 blocker）' }),
          jsx.jsxs('div', {
            className: 'dshgp_rules_weights',
            children: [
              ['用户指示', '用户原话', '用户说', '用户要求', '客户要求', '用户反馈', '根据用户'].map((pat) => {
                const val = weights[pat] !== undefined ? Number(weights[pat]) : 30;
                return jsx.jsxs('label', {
                  key: pat,
                  className: 'dshgp_weight_row',
                  children: [
                    jsx.jsx('span', { className: 'dshgp_weight_name', children: pat }),
                    jsx.jsx('input', {
                      type: 'range', min: 5, max: 60, step: 5, value: val,
                      onChange: (e) => props.saveRuleWeight(pat, e.target.value),
                    }),
                    jsx.jsx('span', { className: 'dshgp_weight_val', children: String(val) + (val >= 40 ? ' 🔒门禁' : '') }),
                  ],
                });
              }),
            ],
          }),
          jsx.jsx('div', { className: 'dshgp_rules_note', children: '顺序=加载次序，后加载覆盖先加载（同 id/pattern）；权重改完即存即生效，不影响 YAML 文件本体。' }),
        ],
      });
    }

    class GitPushCardController {
      constructor(scope) {
        this.scope = scope;
        this.text = '';
        this.sshPub = '';
        this.saving = false;
        this.failed = false;
        this.checking = false;
        this.block = '';
        this.loggedIn = false;
        // v1.28.0 新增设置项：注入全部 skill 正文开关 + 自定义忽略 pattern（改即存）
        this.injectFullSkill = false;
        this.injectRepoIndexFull = false;
        this.hardcodeFullScan = false;
        this.ignorePatterns = '';
        // v1.47.0 审计规则引擎：槽位顺序（auditRuleOrder）+ 权重覆盖（auditRuleWeights）
        this.ruleOrder = [];
        this.ruleWeights = {};
        // v1.29.0 需求①：SSH 邮箱 + 生成公钥（本地状态，不入设置）
        this.sshEmail = '';
        this.genKeying = false;
        this.genKeyError = '';
        this.generatedPub = '';
        // v1.29.0 需求②：即时保存反馈（savedMsg，3 秒后自动清）
        this.savedMsg = '';
        this.savedTimer = null;
        this.store = store.createSnapshotStore(this.project());
        this.unsubscribe = scope.subscribe(() => {
          const snap = this.scope.getSnapshot();
          if (snap && snap.value) {
            this.injectFullSkill = !!snap.value.injectFullSkill;
            this.injectRepoIndexFull = !!snap.value.injectRepoIndexFull;
            this.hardcodeFullScan = !!snap.value.hardcodeFullScan;
            this.ignorePatterns = String(snap.value.customIgnorePatterns || '');
            this.ruleOrder = Array.isArray(snap.value.auditRuleOrder) ? snap.value.auditRuleOrder : [];
            this.ruleWeights = (snap.value.auditRuleWeights && typeof snap.value.auditRuleWeights === 'object') ? snap.value.auditRuleWeights : {};
          }
          this.publish();
        });
      }
      project() {
        const snap = this.scope.getSnapshot();
        const configured = !!(snap.value && snap.value.tokenConfigured);
        return {
          available: snap.status === 'ready',
          writable: !!snap.writable,
          configured,
          text: this.text,
          sshPub: this.sshPub,
          injectFullSkill: this.injectFullSkill,
          injectRepoIndexFull: this.injectRepoIndexFull,
          hardcodeFullScan: this.hardcodeFullScan,
          ignorePatterns: this.ignorePatterns,
          ruleOrder: this.ruleOrder,
          ruleWeights: this.ruleWeights,
          sshEmail: this.sshEmail,
          genKeying: this.genKeying,
          genKeyError: this.genKeyError,
          generatedPub: this.generatedPub,
          savedMsg: this.savedMsg,
          dirty: this.text.trim().length > 0 || this.sshPub.trim().length > 0,
          saving: this.saving,
          failed: this.failed,
          checking: this.checking,
          block: this.block,
          loggedIn: this.loggedIn,
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
      publish() {
        this.store.set(this.project());
      }
      // v1.42.0：设置项保存的通用流程——本地赋值 → scope.set → flashSaved / 失败标记（原 toggle*/editIgnorePatterns 内嵌流程抽出租借）
      // field=本地字段；value=原样赋值（布尔或字符串，不做转换）；setField=scope 键名（缺省同 field）
      saveToggle(field, value, savedOn, savedOff, setField) {
        this[field] = value;
        void this.scope.set(setField || field, this[field]).then(() => {
          this.flashSaved(this[field] ? savedOn : savedOff);
        }).catch(() => {
          this.failed = true;
          this.publish();
        });
        this.publish();
      }
      inject() {
        return {
          hooks: { gitPushCard: this.store },
          edit: (text) => {
            this.text = String(text || '');
            this.failed = false;
            this.publish();
          },
          editSsh: (text) => {
            this.sshPub = String(text || '');
            this.failed = false;
            this.publish();
          },
          toggleFullSkill: (checked) => {
            this.saveToggle('injectFullSkill', checked, 'savedFullSkillOn', 'savedFullSkillOff');
          },
          toggleRepoIndexFull: (checked) => {
            this.saveToggle('injectRepoIndexFull', checked, 'savedRepoIndexOn', 'savedRepoIndexOff');
          },
          toggleHardcodeFull: (checked) => {
            this.saveToggle('hardcodeFullScan', checked, 'savedHardcodeOn', 'savedHardcodeOff');
          },
          editIgnorePatterns: (text) => {
            this.saveToggle('ignorePatterns', String(text || ''), 'savedIgnore', 'savedIgnore', 'customIgnorePatterns');
          },
          // v1.47.0：规则槽位顺序保存（数组 → auditRuleOrder）。顺序按下移=优先级降（越靠前越先加载，被后面覆盖）
          saveRuleOrder: (order) => {
            const arr = Array.isArray(order) ? order : [];
            this.ruleOrder = arr;
            this.publish();
            void this.scope.set('auditRuleOrder', arr).then(() => {
              this.flashSaved('savedRuleOrder');
            }).catch(() => {
              this.failed = true;
              this.publish();
            });
          },
          // v1.47.0：单条权重保存（pattern → auditRuleWeights.blacklist[pattern]）
          saveRuleWeight: (pattern, weight) => {
            const w = { ...(this.ruleWeights && this.ruleWeights.blacklist ? this.ruleWeights.blacklist : {}) };
            w[pattern] = Number(weight);
            const next = { blacklist: w };
            this.ruleWeights = next;
            this.publish();
            void this.scope.set('auditRuleWeights', next).then(() => {
              this.flashSaved('savedRuleWeight');
            }).catch(() => {
              this.failed = true;
              this.publish();
            });
          },
          editSshEmail: (text) => {
            this.sshEmail = String(text || '');
            this.genKeyError = '';
            this.publish();
          },
          genKey: (email) => {
            void this.genKey(email);
          },
          copySshPub: () => {
            void this.copySshPub();
          },
          discard: () => {
            this.text = '';
            this.sshPub = '';
            this.failed = false;
            this.publish();
          },
          save: () => {
            void this.save();
          },
          check: () => {
            void this.check();
          },
        };
      }
      async check() {
        if (this.checking) return;
        this.checking = true;
        this.block = '检测中…';
        this.publish();
        try {
          const payload = {};
          if (this.text.trim()) payload.githubToken = this.text.trim();
          if (this.sshPub.trim()) payload.sshPub = this.sshPub.trim();
          const body = JSON.stringify(payload);
          const res = await fetch('/api/git-push/account-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            credentials: 'same-origin',
          });
          const data = await res.json();
          this.loggedIn = !!data.loggedIn;
          this.block = data.block || data.detail || JSON.stringify(data);
        } catch (e) {
          this.loggedIn = false;
          this.block = '❌ 检测失败: ' + (e && e.message || e);
        }
        this.checking = false;
        this.publish();
      }
      async save() {
        const raw = this.text.trim();
        const pub = this.sshPub.trim();
        if ((!raw && !pub) || this.saving) return;
        this.saving = true;
        this.failed = false;
        this.publish();
        try {
          if (raw) await this.scope.set('githubToken', raw);
          if (pub) await this.scope.set('sshPub', pub);
          this.text = '';
          this.sshPub = '';
          this.saving = false;
          this.publish();
        } catch (_e) {
          this.saving = false;
          this.failed = true;
          this.publish();
        }
      }
      // v1.29.0 需求①：按邮箱生成 SSH 密钥对（调后端 ssh-keygen），回显公钥供绑定 GitHub
      async genKey(email) {
        if (this.genKeying || !email) return;
        this.genKeying = true;
        this.genKeyError = '';
        this.generatedPub = '';
        this.publish();
        try {
          const res = await fetch('/api/git-push/gen-ssh-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, force: false }),
            credentials: 'same-origin',
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            this.genKeyError = (data.error && data.error.message) || data.error || ('HTTP ' + res.status);
          } else {
            this.generatedPub = data.pub || '';
            this.sshEmail = '';
          }
        } catch (e) {
          this.genKeyError = (e && e.message) || String(e);
        }
        this.genKeying = false;
        this.publish();
      }
      // v1.30.0：一键复制生成的公钥到剪贴板（navigator.clipboard 优先，execCommand 兜底）
      async copySshPub() {
        const pub = (this.generatedPub || '').trim();
        if (!pub) return;
        try {
          let done = false;
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            // 需 secure context（https / localhost）；失败静默转 execCommand 兜底
            try {
              await navigator.clipboard.writeText(pub);
              done = true;
            } catch (_e) { /* 转兜底 */ }
          }
          if (!done) {
            const ta = document.createElement('textarea');
            ta.value = pub;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-9999px';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            done = ok;
          }
          if (done) {
            this.flashSaved('copyKeyDone');
          } else {
            this.genKeyError = '浏览器未授予剪贴板权限，请手动全选复制';
            this.publish();
          }
        } catch (e) {
          this.genKeyError = (e && e.message) || String(e);
          this.publish();
        }
      }
    }

    const inject = ['slots', 'locale', 'settingsScope'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-git-push: dictionaries');
      const card = new GitPushCardController(ctx.settingsScope.bind({ namespace: SETTINGS_NS }));
      const store = card.store;
      // 翻译兜底：settings.section 页不经过插件配置槽的 locale 注入，自取 zh 文案表
      const t = (key) => (zh[key] != null ? zh[key] : key);
      // SnapshotStore 是裸 observable（subscribe/getSnapshot，无 selector hook）——
      // 用 useSyncExternalStore 自建 uSES 桥，等价于槽系统为 hooks 生成的 useGitPushCard。
      const useCardState = (selector) => {
        const snap = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
        return selector ? selector(snap) : snap;
      };
      const cardProps = () => Object.assign({ t: t, useGitPushCard: useCardState, check: () => { void card.check(); } }, card.inject());
      // v1.49.0：设置侧边栏独立页（settings.section 槽）——不复用插件配置折叠卡，重新设计平铺 UI：
      //   上方 = 登录信息只读展示 + 引导去插件配置填写（不提供编辑）；下方 = 全部高级设置（开关/忽略/规则引擎/查看入口），即时保存。
      // 两处仍是同一 controller / store（状态一致）。v1.46.0 曾复用 GitPushCard（折叠），已弃用。
      function GitPushSectionPage() {
        ensureCss();
        const state = useCardState((s) => s);
        if (!state.available) return null;
        const props = Object.assign({ t: t, useGitPushCard: useCardState, check: () => { void card.check(); } }, card.inject());
        const cp = { ...props, state };
        return jsx.jsxs('div', {
          style: { padding: '0 4px' },
          children: [
            jsx.jsxs('h2', { style: { margin: '0 0 12px', fontSize: '14px' }, children: [t('title')] }),
            jsx.jsxs('div', {
              className: 'dshgp_section',
              children: [
                /* ① 登录信息（只读）：复用同一 AccountTop 展示块，无 token/公钥输入框，不提供填写 */
                jsx.jsxs('div', {
                  className: 'dshgp_sectionblock',
                  children: [
                    jsx.jsx('p', { className: 'dshgp_section_h', children: t('sectionGuideTitle') }),
                    GitPushAccountTop(cp),
                    jsx.jsxs('div', {
                      className: 'dshgp_section_guide',
                      children: [
                        jsx.jsx('p', { className: 'dshgp_hint', children: t('sectionGuide') }),
                        jsx.jsx('p', { className: 'dshgp_hint', children: t('sectionGoConfigHint') }),
                      ],
                    }),
                  ],
                }),
                jsx.jsx('p', { className: 'dshgp_section_h', children: t('sectionAdvanced') }),
                jsx.jsx('div', { className: 'dshgp_sectionblock', children: GitPushCheckFields(cp) }),
                jsx.jsx('div', { className: 'dshgp_sectionblock', children: GitPushIgnoreField(cp) }),
                jsx.jsx('div', { className: 'dshgp_sectionblock', children: GitPushRuleCards(cp) }),
                jsx.jsx('div', { className: 'dshgp_sectionblock', children: GitPushViewerButtons(cp) }),
              ],
            }),
          ],
        });
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-git-push',
        order: 40,
        label: () => t('title'),
      }, () => react.createElement(GitPushSectionPage, null)));
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: SETTINGS_NS,
        locale: NS,
        inject: () => card.inject(),
      }, GitPushCard));
    }

    exports.NS = NS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
