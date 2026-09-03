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
      tokenSet: '已配置',
      tokenUnset: '未配置',
      expand: '展开设置',
      collapse: '收起设置',
      save: '保存',
      saving: '保存中…',
      discard: '放弃',
      unsaved: '未保存',
      saveFailed: '未写入成功，请检查 token 格式后重试。',
    };
    const en = {
      title: 'Git push',
      description: 'GitHub token. Saved to sibling dsh-git-push-User/github-token, not the public settings document.',
      token: 'GitHub token',
      tokenHint: 'Starts with ghp_ or github_pat_. The literal is not kept on this page after save.',
      tokenSet: 'Configured',
      tokenUnset: 'Not set',
      expand: 'Show settings',
      collapse: 'Hide settings',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      unsaved: 'Unsaved',
      saveFailed: 'The token was not stored. Check the format and try again.',
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
      '.dshgp_foot{display:flex;justify-content:flex-end;gap:8px;padding-top:8px}',
      '.dshgp_btn{font:inherit;font-size:13px;border-radius:8px;padding:6px 12px;cursor:pointer}',
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
                state.failed ? jsx.jsx('p', { className: 'dshgp_fail', children: t('saveFailed') }) : null,
                jsx.jsxs('div', {
                  className: 'dshgp_foot',
                  children: [
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
                      disabled: !state.dirty || state.saving || !state.text.trim(),
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
        this.saving = false;
        this.failed = false;
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
          dirty: this.text.trim().length > 0,
          saving: this.saving,
          failed: this.failed,
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
          discard: () => {
            this.text = '';
            this.failed = false;
            this.publish();
          },
          save: () => {
            void this.save();
          },
        };
      }
      async save() {
        const raw = this.text.trim();
        if (!raw || this.saving) return;
        this.saving = true;
        this.failed = false;
        this.publish();
        try {
          await this.scope.set('githubToken', raw);
          this.text = '';
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
