    /* ─────────────────── [2] 工具区（ensureCss/getJson/postJson/tokenConfigured/copyText） ─────────────────── */
    function dshgp_ensureCss() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css="dsh-git-push"]')) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-git-push';
      tag.dataset.pluginCss = 'dsh-git-push';
      tag.textContent = dshgp_css;
      document.head.appendChild(tag);
    }

    /** fetch 封装：GET JSON（same-origin）。 */
    async function dshgp_getJson(url) {
      const resp = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(dshgp_FETCH_TIMEOUT_MS) });
      return resp.json();
    }
    /** fetch 封装：POST JSON（same-origin）。 */
    async function dshgp_postJson(url, payload, timeoutMs) {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        credentials: 'same-origin',
        signal: AbortSignal.timeout((timeoutMs || dshgp_FETCH_TIMEOUT_MS)),
      });
      return resp.json();
    }

    /**
     * token 是否已配置：优先用 host 派生的布尔位。
     * githubToken 标了 role('secret')，远端读不下发明文 → 设置快照里该字段为空，
     *   旧写法（看 githubToken 真值）会永远判成「未配置」。故改为优先读 status 给的
     *   tokenConfigured，明文仍在时（旧 host / 未脱敏环境）沿用旧判断兜底。
     */
    function dshgp_tokenConfigured(value) {
      var v = value || {};
      if (v.tokenConfigured === true) return true;
      return !!(v.githubToken && String(v.githubToken).trim());
    }

    /**
     * 安全 localStorage 读（sandbox iframe 缺 allow-same-origin 时访问即抛 SecurityError，
     *   `window.localStorage` 存在性判断拦不住 getItem 抛错——必须 try/catch 兜底）。
     * @returns {string} 值或 ''（不可用/抛错时静默返回空）
     */
    function dshgp_localGet(key) {
      try { return window.localStorage.getItem(key); } catch { return ''; }
    }

    /** 安全 localStorage 写（同上，不可用/抛错静默忽略）。 */
    function dshgp_localSet(key, value) {
      try { if (value) window.localStorage.setItem(key, value); } catch { /* localStorage 不可用 */ }
    }

    /** 复制文本到剪贴板（优先 Clipboard API，兜底 execCommand）。 */
    function dshgp_copyText(text) {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(String(text || ''));
      }
      return Promise.resolve();
    }

