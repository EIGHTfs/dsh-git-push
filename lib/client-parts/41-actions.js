      setStatus(msg) {
        this.statusMsg = String(msg || '');
        if (this.statusTimer) clearTimeout(this.statusTimer);
        this.statusTimer = setTimeout(() => {
          this.statusMsg = '';
          this.publish();
        }, dshgp_SAVED_MSG_MS);
      }

      /** 上下调整规则包次序（下覆盖上）。 */
      moveSlot(slot, dir) {
        const arr = [...this.ruleOrder];
        const i = arr.indexOf(slot);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        this.ruleOrder = arr;
        this.publish();
        // 次序持久化走 HTTP settings-set（写插件私有 config.json）。
        //   不再 scope.set——scope.set 会把 auditRuleOrder 写进公共 settings.yaml
        //   （跨实例锁竞争 + isLoopback=memory 陷阱，见 settings-bridge.js 头部说明）。
        this.persistSetting('auditRuleOrder', arr);
        this.setStatus('✅ 规则包次序已保存：' + arr.join(' → '));
      }

      /**
       * 前端设置写入通用入口（抽公共函数消除 toggle 系列重复）。
       * 统一四件套：标记 editedKeys（防 loadSettingsFromHttp 异步 GET 旧值覆盖弹回）
       *   → publish（UI 立即反映）→ persistSetting（HTTP 落盘 config.json + loopback scope 双通道）。
       * @param {string} key 设置键
       * @param {unknown} value 值
       * @param {string} okMsg flashSaved 成功文案（空=静默）
       */
      commitSetting(key, value, okMsg = '') {
        this.editedKeys.add(key);
        this.publish();
        this.persistSetting(key, value, okMsg);
      }

      /** 审计开关（写回 auditEnabled）。 */
      toggleAudit(checked) {
        this.auditEnabled = !!checked;
        // 交互修正：关闭父开关时**不再**把子开关的勾选抹掉。
        //   子开关的勾选是用户偏好，父开关只管「此刻生不生效」（host 侧注入由
        //   cfg.auditEnabled && cfg.injectRequirements 门控）。原实现静默清勾选，
        //   用户重开父开关时还得再点一遍子开关，且看不出勾选是被谁清掉的。
        this.commitSetting('auditEnabled', this.auditEnabled, this.auditEnabled
          ? '✅ 已开启：提交前自动审计'
          : '✅ 已关闭：提交前不审计');
      }

      /**
       * 设置持久化统一入口（**零 scope.set**，单通道走 host HTTP /settings-set → 写插件私有
 * config.json）。彻底移除 scope.set：
       *   ① scope.set 会把设置写进公共 settings.yaml（跨实例写锁竞争 + isLoopback=memory 陷阱）；
       *   ② loopback 直连时 scope.set 会写公共 yaml、反代时 memory 不落盘——两条路都不对，
       *      HTTP settings-set 与访问方式无关、无宿主锁竞争、重启从文件读回，是唯一可靠通道。
       * @param {string} key 设置键
       * @param {unknown} value 值
       * @param {string} okMsg flashSaved 成功文案（空=静默）
       */
      persistSetting(key, value, okMsg = '') {
        // 凭据防线（第三层）：凭据键**绝不发送脱敏值/空值**——防止把回显用的
        //   「ghp_…XYZ」这类打码串写回 config.json 覆盖真凭据（服务端 persistGithubToken/
        //   persistSshPub 另有 isMaskedValue 拦截，这里是 UI 侧提前拦住不发请求）。
        if (key === 'githubToken' || key === 'sshPub') {
          const sv = String(value ?? '').trim();
          if (!sv) return;                                  // 空值：不动该键（留空=保持不变）
          if (sv.includes('…') || sv.includes('****') || /^gh[pous]_…/.test(sv)) {
            this.failed = true;
            this.flashSaved('❌ 拒绝写入：这是脱敏显示值，请输入完整凭据');
            this.publish();
            return;
          }
        }
        // UI 提交调试日志（浏览器控制台可见；服务端另有 settings-ui.log 持久留痕）
        if (typeof console !== 'undefined' && console.debug) {
          try { console.debug('[dsh-git-push] UI 提交', key, '=', String(value).slice(0, dshgp_LOG_TRUNCATE) + (String(value).length > dshgp_LOG_TRUNCATE ? '…' : '')); } catch { /* 控制台不可用时跳过调试输出 */ }
        }
        void dshgp_postJson('/api/git-push/settings-set', { key, value }).then((data) => {
          if (data && data.ok) {
            if (okMsg) this.flashSaved(okMsg);
          } else {
            this.failed = true;
            this.publish();
          }
        }).catch(() => {
          this.failed = true;
          this.publish();
        });
      }

      /**
       * 注入开发者要求清单开关（auditEnabled 的子开关）。
       * 父开关关闭时**仍可勾选**（保留偏好、只置灰、不注入）——原实现在这里直接 return，
       * 用户点了没任何反应，必须先开父开关再点一次（两遍）。
       */
      toggleInjectRequirements(checked) {
        this.injectRequirements = !!checked;
        this.commitSetting('injectRequirements', this.injectRequirements, this.injectRequirements
          ? (this.auditEnabled ? '✅ 已开启：注入开发者要求清单' : '✅ 已勾选：待开启「提交前自动审计」后生效')
          : '✅ 已关闭：不注入要求清单');
      }

      /**
       * 注入总开关（写回 injectSystemPrompt；默认开）。
       * 关 = host 侧 systemPrompt 段全部返回空串 + 上下文注入不注入；
       *   开 = 功能用法/README 提醒/要求清单走系统提示词，环境（工作区/工具/skill 入口）走上下文首条注入。
       * 注入段里的「开发者要求清单」仍受 auditEnabled + injectRequirements 双重门控。
       */
      toggleInjectSystemPrompt(checked) {
        this.injectSystemPrompt = !!checked;
        // 走 commitSetting 公共入口（自动含 editedKeys 标记 + publish + persistSetting）；
        //   此前漏了 editedKeys 标记，loadSettingsFromHttp 异步 GET 可能用旧值把它覆盖回去
        this.commitSetting('injectSystemPrompt', this.injectSystemPrompt, this.injectSystemPrompt
          ? '✅ 已开启：注入系统提示词/上下文'
          : '✅ 已关闭：不注入');
      }

      /**
 * 审计扫描范围切换：diff=仅本次变动（auditChanged，默认）/ full=全量（auditFull）。
       * 按钮式单击切换；持久化走 host HTTP（persistence=memory 陷阱绕开方案，见 settings-bridge.js）。
       */
      toggleAuditScanScope(scope) {
        const next = scope === 'full' ? 'full' : 'diff';
        if (this.auditScanScope === next) return;
        this.auditScanScope = next;
        this.commitSetting('auditScanScope', next, next === 'full'
          ? '✅ 已切换：审计扫描范围 = 全量（auditFull）'
          : '✅ 已切换：审计扫描范围 = 部分（auditChanged，仅本次变动）');
      }

      /** 权重维度编辑（合并写回 weightOverrides JSON）。 */
      editWeight(key, value) {
        this.weightValues = { ...(this.weightValues || {}), [key]: value };
        const json = JSON.stringify(this.weightValues);
        this.commitSetting('weightOverrides', json, '✅ 权重已保存（合计 ' + dshgp_DIMENSIONS.reduce((a, d) => a + (this.weightValues[d.key] != null ? this.weightValues[d.key] : d.def), 0) + '），下次审计生效');
      }

      /**
       * 新增 / 收敛：审计进阶 / 推送通道设置项通用提交。
       * 更新本地镜像 → 走 commitSetting（HTTP settings-set → config.json）→ 即时反馈。
       * @param {string} key maxScanFiles|pushMethod
       * @param {unknown} value 新值
       */
      setAdvanced(key, value) {
        const ok = /^(maxScanFiles|maxCloneFileMB|cloneConcurrency|pushMethod|pushGate|autoPushEnabled|autoPushTriggerText|autoPushScope)$/.test(key);
        if (!ok) { this.setStatus('❌ 未知设置键: ' + key); return; }
        const numKeys = { maxScanFiles: 1, maxCloneFileMB: 1, cloneConcurrency: 1 };
        const boolKeys = { pushGate: 1, autoPushEnabled: 1 };
        const enumKeys = { pushMethod: ['ssh', 'api', 'auto'], autoPushScope: ['session', 'all'] };
        let v = value;
        if (boolKeys[key]) v = value === true;
        else if (numKeys[key]) v = Number(value) || 0;
        else if (enumKeys[key]) {
          const allowed = enumKeys[key];
          v = allowed.includes(value) ? value : this[key];
          if (v !== value) { this.setStatus('❌ 非法取值: ' + value); return; }
        } else v = String(value ?? '');
        this[key] = v;
        this.commitSetting(key, v, '✅ ' + key + ' 已保存，下次生效');
      }

      edit(text) { this.text = String(text || ''); this.failed = false; this.publish(); }
      editSsh(text) { this.sshPub = String(text || ''); this.failed = false; this.publish(); }
      editEmail(text) { this.sshEmail = String(text || ''); this.failed = false; this.publish(); }

      /** 保存 token / 公钥到插件配置（settingsScope）。 */
      async save() {
        const raw = this.text.trim();
        const pub = this.sshPub.trim();
        if ((!raw && !pub) || this.saving) return;
        this.saving = true;
        this.failed = false;
        this.publish();
        try {
          // 凭据持久化走 persistSetting（纯 HTTP /settings-set → 服务端
          //   writeSettingsKey 写 config.json + persistGithubToken/persistSshPub 落插件目录，
          //   不 scope.set——scope.set 会把凭据写进公共 settings.yaml 明文，反代下还不落盘）。
          if (raw) this.persistSetting('githubToken', raw);
          if (pub) this.persistSetting('sshPub', pub);
          this.text = '';
          this.sshPub = '';
          this.saving = false;
          // 保存后**刷新凭据与密钥的「已填写」状态**——此前只在写入 token 时本地置位
          //   tokenConfigured、sshConfigured 从不置位（保存公钥后徽标仍显示未填写），且本地置位
          //   无法反映服务端规范化/落盘失败。统一走 refresh('account') 从 account-status 真源读回。
          //   顺序：先弹「已保存」提示，再异步读回状态（读回过程不遮挡保存成功的反馈）。
          this.flashSaved('✅ 凭据已保存');
          await this.refresh('account');
        } catch (_e) {
          this.saving = false;
          this.failed = true;
        }
        this.publish();
      }

      discard() { this.text = ''; this.sshPub = ''; this.failed = false; this.publish(); }

      /** 一键生成 SSH 密钥对（/gen-ssh-key）：公钥保存到 sshkey 并复制。 */
      async genKey() {
        const email = this.sshEmail.trim();
        if (!email || this.genKeying) return;
        this.genKeying = true;
        this.genKeyError = '';
        this.publish();
        try {
          const genRes = await dshgp_postJson('/api/git-push/gen-ssh-key', { email });
          if (genRes && genRes.ok && genRes.pub) {
            this.sshPub = genRes.pub;
            this.publish();
            await dshgp_copyText(genRes.pub);
            this.genKeying = false;
            this.flashSaved('✅ 公钥已生成：已填入 SSH 公钥框并复制到剪贴板');
          } else {
            this.genKeying = false;
            this.genKeyError = (genRes && genRes.error) || '生成失败';
            this.publish();
          }
        } catch (e) {
          this.genKeying = false;
          this.genKeyError = '生成失败: ' + (e && e.message || e);
          this.publish();
        }
      }

      /** 挂到槽系统的 hooks（供组件注入）。 */
      inject() {
        return {
          hooks: { gitPushCard: this.store },
          edit: (text) => this.edit(text),
          editSsh: (text) => this.editSsh(text),
          editEmail: (text) => this.editEmail(text),
          save: () => { void this.save(); },
          discard: () => this.discard(),
          genKey: () => { void this.genKey(); },
          toggleAudit: (checked) => this.toggleAudit(checked),
          // 子开关动作必须在这里暴露：页面 props 来自 inject()，漏了会让 onChange 调到 undefined
          toggleInjectRequirements: (checked) => this.toggleInjectRequirements(checked),
          toggleInjectSystemPrompt: (checked) => this.toggleInjectSystemPrompt(checked),
          toggleAuditScanScope: (scope) => this.toggleAuditScanScope(scope),
          editWeight: (key, value) => this.editWeight(key, value),
          setAdvanced: (key, value) => this.setAdvanced(key, value),
          moveSlot: (slot, dir) => this.moveSlot(slot, dir),
          toggleDisabled: (slot) => { void this.toggleDisabled(slot); },
          // 统一刷新入口（参数控制刷哪部分）——设置 / 账号 / 本地仓库 / 云端 / 槽位
          refresh: (parts, opts) => { void this.refresh(parts, opts); },
          refreshAccount: () => { void this.refresh('account'); }, // 离线读 json（启动/push后/渲染）
          recheckAccount: () => { void this.recheckAccount(); }, // 在线校验写 json（「重新检测」）
          // 账号卡片：本地/云端 动作
          scanLocalRepos: (path, rebuild) => { void this.refresh('repos', { path, rebuild }); },
          startScan: (path) => { void this.startScan(path); }, // 扫描按钮：独立进程后台扫描 + 逐条追加
          loadCloudRepos: () => { void this.refresh('cloud'); },
          pushLocalRepo: (path) => { void this.pushLocalRepo(path); },
          commitLocalRepo: (path) => { void this.commitLocalRepo(path); }, // 本地 commit（复用提交审计）
          cloneFlow: (repo) => this.cloneFlow(repo),
          requestVisSwitch: (fullName, target) => this.requestVisSwitch(fullName, target), // 弹独立确认面板（1.5.4）
          confirmVisSwitch: () => { void this.confirmVisSwitch(); },
          cancelVisSwitch: () => { this.cancelVisSwitch(); },
          cloneConfirmed: () => { void this.cloneConfirmed(); }, // 预览确认框「开始克隆」
          // 预览框勾选「带真实历史」：只改本地选择并重绘，真正的参数在提交时随 history 一起发出
          setCloneHistory: (v) => { this.cloneHistory = (v === true); this.publish(); },
          cancelPreview: () => { this.cancelPreview(); },        // 预览确认框「取消」
        };
      }
    }

    const inject = ['slots'];

