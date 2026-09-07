window.__ModuleLoader__.load({
  id: 'dsh-git-push',
  factory: (require) => {
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
      description: '填写 GitHub token。保存后写入同级仓 dsh-git-push-User/github-token，不进公开配置。',
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
      injectFullSkillHint: '勾选 = 每个会话注入两仓（dsh-git-push/skills + dsh-git-push-User）全部 skill 正文；不勾选（默认）= 只注入 skill 目录+文件清单，正文按需读取，省 token。修改即时保存。',
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
    };
    const en = {
      title: 'Git push',
      description: 'GitHub token. Saved to sibling dsh-git-push-User/github-token, not the public settings document.',
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
      injectFullSkillHint: 'Checked = inject the full text of all skills from both repos (dsh-git-push/skills + dsh-git-push-User) into every session; unchecked (default) = inject only skill dirs + file lists, read bodies on demand to save tokens. Saved immediately.',
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

    function GitPushCard(props) {
      ensureCss();
      const t = props.t;
      const state = props.useGitPushCard((s) => s);
      const [open, setOpen] = react.useState(false);
      // v1.29.0 需求③：每次展开设置卡片自动跑一次账号检测（check 内部有 checking 防重）
      react.useEffect(() => {
        if (open) props.check();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [open]);
      if (!state.available) return null;
      const title = t('title');
      return jsx.jsxs('li', {
        className: 'dshgp_card' + (open ? ' dshgp_open' : ''),
        children: [
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
          }),
          open
            ? jsx.jsxs('div', {
              className: 'dshgp_body',
              children: [
                // v1.29.0 需求③：账号状态检测块置顶 + 默认进入自动查（check 已挂 useEffect）
                jsx.jsxs('div', {
                  className: 'dshgp_top',
                  children: [
                    jsx.jsx('p', { className: 'dshgp_toplabel', children: t('accountTopHint') }),
                    state.block
                      ? jsx.jsx('pre', { className: 'dshgp_block ' + (state.loggedIn ? 'dshgp_ok' : 'dshgp_err'), children: state.block })
                      : jsx.jsx('pre', { className: 'dshgp_block', children: state.checking ? t('checking') + '…' : t('tokenUnset') }),
                  ],
                }),
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
                  : null,
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
                jsx.jsx('p', { className: 'dshgp_hint', children: t('sshHint') }),
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
                jsx.jsx('p', { className: 'dshgp_hint', children: t('hardcodeFullScanHint') }),
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
                state.failed ? jsx.jsx('p', { className: 'dshgp_fail', children: t('saveFailed') }) : null,
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
                }),
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
                }),
              ],
            })
            : null,
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
            this.injectFullSkill = !!checked;
            void this.scope.set('injectFullSkill', this.injectFullSkill).then(() => {
              this.flashSaved(this.injectFullSkill ? 'savedFullSkillOn' : 'savedFullSkillOff');
            }).catch(() => {
              this.failed = true;
              this.publish();
            });
            this.publish();
          },
          toggleRepoIndexFull: (checked) => {
            this.injectRepoIndexFull = !!checked;
            void this.scope.set('injectRepoIndexFull', this.injectRepoIndexFull).then(() => {
              this.flashSaved(this.injectRepoIndexFull ? 'savedRepoIndexOn' : 'savedRepoIndexOff');
            }).catch(() => {
              this.failed = true;
              this.publish();
            });
            this.publish();
          },
          toggleHardcodeFull: (checked) => {
            this.hardcodeFullScan = !!checked;
            void this.scope.set('hardcodeFullScan', this.hardcodeFullScan).then(() => {
              this.flashSaved(this.hardcodeFullScan ? 'savedHardcodeOn' : 'savedHardcodeOff');
            }).catch(() => {
              this.failed = true;
              this.publish();
            });
            this.publish();
          },
          editIgnorePatterns: (text) => {
            this.ignorePatterns = String(text || '');
            void this.scope.set('customIgnorePatterns', this.ignorePatterns).then(() => {
              this.flashSaved('savedIgnore');
            }).catch(() => {
              this.failed = true;
              this.publish();
            });
            this.publish();
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
