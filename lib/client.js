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
                state.failed ? jsx.jsx('p', { className: 'dshgp_fail', children: t('saveFailed') }) : null,
                state.block ? jsx.jsx('pre', { className: 'dshgp_block ' + (state.loggedIn ? 'dshgp_ok' : 'dshgp_err'), children: state.block }) : null,
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
        this.store = store.createSnapshotStore(this.project());
        this.unsubscribe = scope.subscribe(() => {
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
          dirty: this.text.trim().length > 0 || this.sshPub.trim().length > 0,
          saving: this.saving,
          failed: this.failed,
          checking: this.checking,
          block: this.block,
          loggedIn: this.loggedIn,
        };
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
