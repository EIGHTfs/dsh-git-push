    /* ─────────────────── [5] 目录选择器（browseEnsureDom/browseLoad/browseOpen/browseClose/browseAttach） ─────────────────── */
    let dshgp_browseTarget = null; // 当前打开的输入框（null = 走 onPick 回调）
    // 移植 gamebanana-mods-downloader 的 path-picker 小模块：一行接入 📂 按钮 // 当前打开的输入框（null = 走 onPick 回调）
    let dshgp_browseOpt = null;    // { onPick } 确认回调（clone 场景）
    let dshgp_browsePath = '';     // 弹窗当前所在目录
    function dshgp_browseEnsureDom() {
      if (typeof document === 'undefined' || document.getElementById('dshgp-browse-mask')) return;
      const mask = document.createElement('div');
      mask.id = 'dshgp-browse-mask';
      mask.className = 'dshgp_browsemask';
      mask.style.display = 'none';
      mask.innerHTML = ''
        + '<div class="dshgp_browsedialog">'
        + '<div class="dshgp_browsehead"><span class="dshgp_browsetitle">选择目录</span><button type="button" class="dshgp_browseclose" id="dshgp-browse-close">✕</button></div>'
        + '<div class="dshgp_browsepath" id="dshgp-browse-crumb"></div>'
        + '<div class="dshgp_browseup" id="dshgp-browse-up">⬆ 上级目录</div>'
        + '<div class="dshgp_browselist" id="dshgp-browse-list"></div>'
        + '<div class="dshgp_browsefoot"><button type="button" class="dshgp_keybtn" id="dshgp-browse-ok">选择当前目录</button></div>'
        + '</div>';
      document.body.appendChild(mask);
      mask.addEventListener('click', (e) => { if (e.target === mask) dshgp_browseClose(); });
      document.getElementById('dshgp-browse-close').addEventListener('click', dshgp_browseClose);
      document.getElementById('dshgp-browse-up').addEventListener('click', () => {
        const up = document.getElementById('dshgp-browse-up');
        if (up && up.dataset.path) dshgp_browseLoad(up.dataset.path);
      });
      document.getElementById('dshgp-browse-ok').addEventListener('click', () => {
        const onPick = dshgp_browseOpt;
        const target = dshgp_browseTarget;
        dshgp_browseClose();
        if (onPick) onPick(dshgp_browsePath);
        else if (target) target.value = dshgp_browsePath;
      });
    }
    function dshgp_browseGuess() {
      return dshgp_localGet('dshgp-browse-path');
    }
    function dshgp_browseRemember(p) {
      dshgp_localSet('dshgp-browse-path', p);
    }
    async function dshgp_browseLoad(p) {
      const list = document.getElementById('dshgp-browse-list');
      const crumb = document.getElementById('dshgp-browse-crumb');
      const up = document.getElementById('dshgp-browse-up');
      if (!list || !crumb) return;
      crumb.textContent = '读取中…';
      let browseRes;
      try { browseRes = await dshgp_getJson('/api/git-push/browse?path=' + encodeURIComponent(String(p || ''))); }
      catch (e) { crumb.textContent = '读取失败: ' + (e && e.message || e); return; }
      if (!browseRes || !browseRes.ok) { crumb.textContent = (browseRes && browseRes.error) || '读取失败'; return; }
      dshgp_browsePath = browseRes.path;
      dshgp_browseRemember(browseRes.path);
      crumb.textContent = browseRes.path;
      up.style.display = browseRes.parent ? 'block' : 'none';
      up.dataset.path = browseRes.parent || '';
      let html = '';
      if (!browseRes.dirs.length) html += '<div class="dshgp_browsehint">（无子目录）</div>';
      (browseRes.dirs || []).forEach((dirName) => {
        const full = browseRes.path === '/' ? '/' + dirName : browseRes.path + '/' + dirName;
        html += '<div class="dshgp_browsedir" data-path="' + String(full).replace(/"/g, '&quot;') + '">📁 ' + String(dirName).replace(/</g, '&lt;') + '</div>';
      });
      list.innerHTML = html;
      list.querySelectorAll('.dshgp_browsedir').forEach((el) => {
        el.addEventListener('click', () => dshgp_browseLoad(el.dataset.path));
      });
    }
    function dshgp_browseOpen(input, onPick) {
      if (typeof document === 'undefined') return;
      dshgp_browseTarget = input || null;
      dshgp_browseOpt = onPick || null;
      dshgp_browseEnsureDom();
      const mask = document.getElementById('dshgp-browse-mask');
      mask.style.display = 'flex';
      void dshgp_browseLoad(dshgp_browseGuess());
    }
    function dshgp_browseClose() {
      if (typeof document === 'undefined') return;
      const mask = document.getElementById('dshgp-browse-mask');
      if (mask) mask.style.display = 'none';
      dshgp_browseTarget = null;
      dshgp_browseOpt = null;
    }
    function dshgp_browseAttach(inputEl) {
      if (!inputEl || inputEl.dataset.dshgpBrowse) return; // 幂等
      inputEl.dataset.dshgpBrowse = '1';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dshgp_browsebtn';
      btn.textContent = '📂';
      btn.title = '选择目录';
      btn.addEventListener('click', () => dshgp_browseOpen(inputEl, null));
      inputEl.insertAdjacentElement('afterend', btn);
    }

 /* ═══════════════════ 账号卡片：本地/云端 仓库管理 ═══════════════════ */
