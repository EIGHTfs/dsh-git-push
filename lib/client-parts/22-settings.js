    /* ─────────────────── [8] 设置 Tab（SettingsTab） ─────────────────── */
    function dshgp_CredentialBlock(props) {
      const s = props.state;
      return jsx.jsxs('div', {
        className: 'dshgp_block',
        children: [
          // 保存按钮放「凭据与密钥」标题后面（右侧）；放弃按钮已删
          jsx.jsxs('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' },
            children: [
              jsx.jsx('p', { className: 'dshgp_h2', style: { margin: 0 }, children: '凭据与密钥' }),
              jsx.jsx('button', { type: 'button', className: 'dshgp_btn', disabled: !s.dirty || s.saving, onClick: props.save, children: s.saving ? '保存中…' : '保存' }),
            ],
          }),
          jsx.jsx('div', {
            className: 'dshgp_field',
            children: [
              jsx.jsxs('label', { className: 'dshgp_label', htmlFor: 'dshgp-token', children: ['GitHub token', s.tokenConfigured ? jsx.jsx('span', { className: 'dshgp_configured', children: '已填写' }) : null] }),
              jsx.jsx('input', {
                // token 编辑框改为**普通编辑框**（原 type=password 掩码显示，
                //   粘贴长 token 时无法核对是否粘全/粘对；改为可见后可直接比对）。
                //   明文仍只在输入态存在：保存后落 config.json（0600），接口不回传明文。
                id: 'dshgp-token', type: 'text', autoComplete: 'off', className: 'dshgp_input',
                placeholder: 'ghp_… 或 github_pat_…', spellCheck: false,
                value: s.text, disabled: !s.writable || s.saving,
                onChange: (ev) => props.edit(ev.target.value),
              }),
              jsx.jsx('p', { className: 'dshgp_hint', children: 'ghp_ / github_pat_ 开头。保存后写入插件配置目录的 config.json（0600），不回传明文、不在设置页留存。' }),
            ],
          }),
          jsx.jsx('div', {
            className: 'dshgp_field',
            children: [
              jsx.jsxs('label', { className: 'dshgp_label', htmlFor: 'dshgp-ssh', children: ['SSH 公钥', s.sshConfigured ? jsx.jsx('span', { className: 'dshgp_configured', children: '已填写' }) : null] }),
              jsx.jsx('textarea', {
                id: 'dshgp-ssh', className: 'dshgp_textarea', rows: 3,
                value: s.sshPub, disabled: !s.writable || s.saving,
                onChange: (ev) => props.editSsh(ev.target.value),
              }),
              jsx.jsx('p', { className: 'dshgp_hint', children: 'ssh-ed25519 / ssh-rsa 整行。保存后写入 config.json（与 token 同份配置，互不覆盖），不回传明文。' }),
            ],
          }),
          // 邮箱 + 一键生成同一行（编辑框宽度减少，按钮放编辑框后面）
          jsx.jsxs('div', {
            className: 'dshgp_field',
            children: [
              jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dshgp-email', children: 'SSH 邮箱（一键生成用）' }),
              jsx.jsxs('div', {
                style: { display: 'flex', alignItems: 'center', gap: '8px' },
                children: [
                  jsx.jsx('input', {
                    id: 'dshgp-email', type: 'text', autoComplete: 'off', className: 'dshgp_input',
                    style: { flex: '1 1 40%', maxWidth: '200px', minWidth: '120px' },
                    value: s.sshEmail, disabled: s.genKeying,
                    onChange: (ev) => props.editEmail(ev.target.value),
                  }),
                  jsx.jsx('button', { type: 'button', className: 'dshgp_btn dshgp_btnPrimary', disabled: s.genKeying || !s.sshEmail.trim(), onClick: props.genKey, children: s.genKeying ? '生成中…' : '一键生成并复制' }),
                ],
              }),
            ],
          }),
          s.failed ? jsx.jsx('p', { className: 'dshgp_error', children: '保存失败：请检查格式后重试。' }) : null,
          s.savedMsg ? jsx.jsx('p', { className: 'dshgp_saved', children: s.savedMsg }) : null,
          s.genKeyError ? jsx.jsx('p', { className: 'dshgp_error', children: s.genKeyError }) : null,
        ],
      });
    }

 /** 推送与默认值区块（收敛：只保留推送通道；默认扫描路径复用本地仓库列表选择路径）。 */
    function dshgp_PushDefaultsBlock(props) {
      const s = props.state;
      return jsx.jsxs('div', {
        className: 'dshgp_block',
        children: [
          jsx.jsx('p', { className: 'dshgp_h2', children: '推送与默认值' }),
          jsx.jsxs('div', { className: 'dshgp_field', children: [
            jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dshgp-pushmethod', children: '推送通道' }),
            // 下拉标签带括号注释（选项 value 仍是 ssh/api/auto，不改值——
            //   兼容 config.json 已保存的 pushMethod；对外显示用「token」称 api 通道）。
            jsx.jsx('select', {
              id: 'dshgp-pushmethod', className: 'dshgp_input dshgp_inputInline',
              value: s.pushMethod, onChange: (ev) => props.setAdvanced('pushMethod', ev.target.value),
              children: [
                { value: 'ssh', label: 'ssh（默认）' },
                { value: 'api', label: 'token' },
                { value: 'auto', label: 'auto（先 ssh 再 token）' },
              ].map((o) => jsx.jsx('option', { key: o.value, value: o.value, children: o.label })),
            }),
            jsx.jsx('p', { className: 'dshgp_hint', children: 'ssh = 只走 SSH 私钥（默认）；token = 先走 Git Data API（用 token 推），失败回落 SSH；auto = 先 ssh、失败再回落 token。远端分叉时不静默回落，如实报错。' }),
          ] }),
          // 推送门禁（类似会话指挥家写操作拦截）——开启后 AI 推送必须
          //   先取得显式放行（带 pushConfirmed:true 重推），否则推送步骤被拦截。
          jsx.jsxs('div', { className: 'dshgp_field', children: [
            jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dshgp-pushgate', children: '推送门禁' }),
            jsx.jsx('input', {
              id: 'dshgp-pushgate', type: 'checkbox', className: 'dshgp_check',
              checked: !!s.pushGate, onChange: (ev) => props.setAdvanced('pushGate', ev.target.checked),
            }),
            jsx.jsx('p', { className: 'dshgp_hint', children: '开启后：commit 可正常提交，但 push 前必须显式传 pushConfirmed:true 放行——未放行的推送被拦截并提示「推送门禁已开启，需确认后重试」。用于防止未经放行直接推远端。' }),
          ] }),
          // 任务完成自动推送（内置自 dsh-task-completion）：开关 + 自定义触发文本 + 范围。
          jsx.jsxs('div', { className: 'dshgp_field', children: [
            jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dshgp-autopush', children: '自动推送(✅任务完成)' }),
            jsx.jsx('input', {
              id: 'dshgp-autopush', type: 'checkbox', className: 'dshgp_check',
              checked: !!s.autoPushEnabled, onChange: (ev) => props.setAdvanced('autoPushEnabled', ev.target.checked),
            }),
            jsx.jsx('p', { className: 'dshgp_hint', children: '开启后：AI 回复含指定完成文案（默认「✅任务完成」，可自定义）自动 commit+push——复用审计门禁（blocker 拦截、requirements 核对、pushGate 放行），不裸提交；默认关。' }),
          ] }),
          jsx.jsxs('div', { className: 'dshgp_field', children: [
            jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dshgp-autopush-trigger', children: '自动推送触发文本' }),
            jsx.jsx('input', {
              id: 'dshgp-autopush-trigger', type: 'text', className: 'dshgp_input',
              value: s.autoPushTriggerText ?? '✅任务完成', onChange: (ev) => props.setAdvanced('autoPushTriggerText', ev.target.value),
            }),
            jsx.jsx('p', { className: 'dshgp_hint', children: '检测「任务完成」的文本/正则（默认「✅任务完成」），可写成 ✅(任务完成|已解答) 等' }),
          ] }),
          jsx.jsxs('div', { className: 'dshgp_field', children: [
            jsx.jsx('label', { className: 'dshgp_label', htmlFor: 'dshgp-autopush-scope', children: '自动推送范围' }),
            // 修复：jsx(type, props, key) 第三参数是 key 不是 children——
            //   此前把 options 数组放第三参数导致 children 丢失、下拉渲染为空（与 2026-09-16 同坑）。
            //   children 必须放进 props，与 pushMethod/审计进阶 sel 的写法对齐。
            jsx.jsx('select', {
              id: 'dshgp-autopush-scope', className: 'dshgp_input',
              value: s.autoPushScope ?? 'session', onChange: (ev) => props.setAdvanced('autoPushScope', ev.target.value),
              children: ['session', 'all'].map((v) => jsx.jsx('option', { key: v, value: v, children: String(v) })),
            }),
            jsx.jsx('p', { className: 'dshgp_hint', children: 'session=仅会话 cwd 所在仓库（默认，最安全）；all=workspace 全部有变更仓库' }),
          ] }),
        ],
      });
    }

    function dshgp_SettingsTab(props) {
      const s = props.state;
      return jsx.jsxs('div', {
        className: 'dshgp_section',
        children: [
          jsx.jsx(dshgp_CredentialBlock, Object.assign({}, props)),
          jsx.jsx(dshgp_PushDefaultsBlock, Object.assign({}, props)),
        ],
      });
    }

