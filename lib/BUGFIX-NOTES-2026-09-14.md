# 2026-09-14 Bug 修复说明（接手者必读）

> 本文档记录当天修复的三个实测 bug 的**完整根因链 / 改动点 / 验证 / 遗留坑**，
> 供后续 AI 接手本插件时对照（避免重复踩坑、避免误以为某个行为是设计）。
> 相关改动均已回归（npm test 559/559 全绿）。

---

## Bug 1：提交推送实际全前台任务，会卡住 AI

### 现象
调用 `git_commit_push` 时 AI 长时间卡住（尤其大仓库），用户体感「提交推送是前台任务」。

### 根因（2026-09-14 实测）
`git_commit_push` 的后台化是「**审计同步即时拦截 + commit+push 丢后台**」（见 `lib/app/tool-call.js`
`case 'git_commit_push'` → `runAudit()` 同步执行 → `submitTask()` 后台 commit+push）。
**审计同步本身是设计**（保住提交门禁：blocker 立即拦截），但审计里有个隐藏的全仓扫描：

`lib/audit/orchestrate.js` 的 `auditChanged()`（diff 审计）为了收集 npm 规则的
「js-yaml 已引用但未声明」证据，**无条件**调用：

```js
detectRepoJsYamlImport(collectTextFiles(repoPath, { depth: 10, gitIgnoreRoot: repoPath, testExemptRoot: repoPath }))
```

`collectTextFiles` 全仓遍历目录 + `detectRepoJsYamlImport` 逐个读全文。
**实测**：0 变动文件的大仓库（DeepSeekHarness-NAS，2.1 万文本文件）仍扫 3.2s；
8 万文件仓库更久（遍历 3.6s + 读全文 1.3s+）。这就是每次提交都卡几秒的来源。

### 修复
`lib/audit/orchestrate.js`（auditChanged）：js-yaml 证据收集从「全仓扫」改为「**只在本次变动文件
（targets）里检测**」——diff 审计的语义就是「本次变动」，引用证据同理按变动范围取；
全仓证据（历史遗留引用）由 `auditFull` 负责，diff 不重扫。

**验证**：同一大仓库 runAudit diff 耗时 3211ms → 274ms（约 11 倍提速），结果不变。

### 遗留（接手者可考虑）
- 审计同步仍可能慢于毫秒级：剩余耗时主要在 `checkPrivateFiles`（git ls-files 全量匹配私密
  文件清单）——这是**安全红线**，故意保留全量，**不要**改成只匹配变动文件（否则漏私密文件）。
- 若想进一步提速：可给 `runAudit` 加超时/降级策略（超时跳过非安全类检查），但需谨慎，
  安全类规则（private/secret）不可降级。

---

## Bug 2：审计「变动文件」开启没生效（敏感文件提交不拦截）

### 现象
用户开「审计变动文件（diff）」后，提交含 `.env` / 硬编码凭据的文件不被拦截；
前端也找不到「审计扫描范围」开关可开。

### 根因链（三层，全部实测确认）

**第 1 层：`.env` 等点文件被 diff 审计 targets 过滤掉（最致命）**
`lib/audit/collector.js` 的 `isTextFile()` 用 `extname()` 判定文本扩展名，
但 Node 的 `extname('.env')` 返回**空串**、`extname('.env.local')` 返回 **'.local'**（点文件
extname 只取最后一段）→ 点文件扩展名匹配不到 `TEXT_EXT`（含 'env'）→ `isTextFile=false`
→ `auditChanged` 的 `targets = changed.filter(f => isTextFile(f.full))` 把 `.env` 丢弃
→ 凭据文件路径规则永远审不到它。

**第 2 层：credential-file 检查器读错字段**
`lib/checks/credential-file.js` 的 `checkCredentialFiles()` 只读
`rule.patterns || rule.pattern`，但 `lib/rule/compilers/credential.js` 对 `credfile-*` 规则
编译输出的是 **`pathPattern`**（取自 yml `path_pattern`）→ 字段不匹配，规则**永不触发**。
（`checkPathRegexRules` 在 `lib/checks/regex.js` 读的是 `rule.pathPattern`，是对的；
`checkCredentialFiles` 漏了。）

**第 3 层：error 级不升 blocker，runAudit 不拦**
`lib/rule/compilers/credential.js` 编译 `credfile-*` 时没设 `level`（ruleOut 默认 'warning'），
而文档契约（docs/DETAILS-EXEMPT-AND-RULES.md）规定「yml 写 `error` → 引擎级 `blocker`（拦截）」。
`checkCredentialFiles` 原来用 `capSeverity(rule.severity, 'blocker')`——capSeverity 对 'error'
**恒返回 'error'**，`runAudit`（lib/commit-push.js）只认 `severity === 'blocker'` → error 级凭据
文件不拦截。（对照：`checkPathRegexRules` 用 `rule.level === 'blocker' ? 'blocker' : rule.severity`，
因为 regex 编译器调了 `severityLevel()`。）

### 修复（三处对齐契约）
1. `lib/audit/collector.js` `isTextFile()`：点文件（base 以 `.` 开头）优先取
   「去首点后第一段」作为扩展名（`.env` → env；`.env.local` → env；`.tmp-x.js` 仍按
   extname 得 js，不误伤）。验证：`.env`/`.env.local`/`x/.env.local`/`.tmp-x.js` 全 true，
   `a.png` false。
2. `lib/checks/credential-file.js` `checkCredentialFiles()`：`pathPattern` 优先，
   `patterns/pattern` 兼容旧规则。
3. `lib/rule/compilers/credential.js`：`credfile-*` 编译补 `level: severityLevel(r.severity)`
   （error → blocker）；`checkCredentialFiles` severity 改读 `rule.level === 'blocker' ? 'blocker' : capSeverity(...)`
   （与 `checkPathRegexRules` 同契约）。

**验证**：真实 `.env` / `.env.local` / `config/.env` 全部 `blocked: true`（审计拦截：1 个 blocker）；
硬编码密码 / API key 测试恢复拦截；回归 553/553 全绿。

### 前端缺开关（未做，接手者可补）
`lib/client/index.js` 的 `SETTINGS_SCHEMA` 声明了 `auditScanScope`（diff|full）与
`hardcodeFullScan`，但 `client.js` 的 `dshgp_AuditTab` **没有渲染这两个开关**——用户想
「开启审计变动文件」无从下手（默认值就是 diff，但无 UI 可确认/切换）。
接手者可在审计 tab 加枚举开关（照 `toggleAudit` 模式：`scope.set('auditScanScope', v)`，
apply.js 的 `scope.watch` 已接 `cfg.auditScanScope`，保存即时生效）。

<!-- 2026-09-14 追加：本项已在下方 Bug 3 一并修复（审计 tab 加「审计扫描范围」按钮组） -->

---

## Bug 3：非 loopback（反代）访问时设置不落盘，重启全丢

### 现象
用户通过**反代地址**（http://10.10.10.4:3080 之类经 121000 进程转发到 127.0.0.1:30801）访问
主 GUI 设置页：勾选「注入开发者要求清单到系统提示词」等开关后，**每次重启都要重新打开**；
打开设置侧边栏时所有开关都是未勾选态。凭据类保存也「写不进 settings.yaml，只能手动写」
（这正是 apply.js 里 2026-09-13 注释记录的旧现象）。

### 根因（2026-09-14 实测，藏在宿主 DSH 源码里）
DSH web GUI 的 settings 持久化由 **client 侧**决定（`packages/client/ui-settings/src/client/index.ts:58`）：

```ts
const persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'
```

- **loopback 直连**（浏览器访问 127.0.0.1:30801）→ `persistence='host'` → 前端
  `scope.set()` 经 wire 发到宿主写盘 ✓
- **非 loopback**（经反代 10.10.10.4 访问 → host 判定 isLoopback=false）→
  `persistence='memory'` → 前端 `scope.set()` **只改页面内存**：`settings-scope.ts`
  的 `enqueue()` 对 memory persistence **直接 return（不发 wire、不写盘）**，且
  Controller 构造时 `if (persistence === 'host')` 才订阅 mirror + derive → **store
  恒 unavailable、读值恒 undefined**。

叠加 schemastery「未知键忽略」→ 前端 decode 不报错，但**每次打开设置页都读到默认值
（未勾选）**，设置从未真正落盘 settings.yaml → 重启全丢。这不是本插件 bug，是 DSH
宿主对「非 loopback 页面设置不持久化」的设计，任何第三方插件设置页都会中招。

### 修复（绕开 client persistence，走 host scope 真源）
1. **新增 `lib/app/settings-bridge.js`**：apply 时把 `settings.register('git-push')`
   返回的 **host 侧 scope** 存模块级引用（`setSettingsScope`），暴露 `readSettings()`
   与 `writeSettingsKey(key, value)`——host 侧 `scope.update()` 走宿主完整写盘链路
   （settings-file provider，与 client isLoopback 判定**无关**）。
2. **http-handlers.js 新增两端点**：
   - `GET /api/git-push/settings-get`：读 host scope 快照（redactConfig 掩码凭据）
   - `POST /api/git-push/settings-set`：白名单键（含 auditEnabled/injectRequirements/
     injectSystemPrompt/auditScanScope/auditLevel/weightOverrides/githubToken/sshPub 等）→
     `writeSettingsKey` → `scope.update` → **真正写 settings.yaml + 触发 watch 同步 cfg**
   - scope 未注册时 503（降级不崩）、非白名单键 400（防越权）。
3. **client.js**：
   - 构造尾部新增 `loadSettingsFromHttp()`：启动即 `GET settings-get` 读回已落盘
     开关/扫描范围/权重，覆盖前端字段 → **重启后勾选保持**；
   - 新增 `persistSetting(key, value, okMsg)`：`scope.set`（loopback 兼容通道，静默）
     + `dshgp_postJson('/api/git-push/settings-set')`（可靠通道）双写；所有
     toggle（audit/injectRequirements/injectSystemPrompt）+ editWeight + save 改写
     走它（原 `scope.set().then(flashSaved)` 模式替换）。
4. **审计扫描范围按钮组**（原 Bug 2「前端缺开关」一并修复）：`dshgp_AuditSwitchBlock`
   「提交前自动审计」卡片下加 `diff=部分（本次变动）/ full=全量` 双按钮单击切换
   （当前模式高亮），父开关关闭时整行置灰但仍可保留选择；持久化走 persistSetting。
   Controller 新增 `toggleAuditScanScope(scope)`，inject()/AuditTab props 透传。

**验证**：新增 5 个 settings 端点单测（未注册 503、白名单 400、GET 空 key 400 等）
+ 1 个按钮接线源码断言；回归 **559/559 全绿**（基线 553 + 6 新增）；
`node --check` 全通过；NM 主环境 19 个文件 md5 全一致。

### 遗留 / 接手者注意
- settings-set 白名单是硬编码集合，新增设置键时记得同步加进去（否则前端 save 404/400）。
- 前端 `persistSetting` 走 HTTP 的同时仍保留 `scope.set` 双通道：loopback 环境下
  host 会收到两路写（幂等，无副作用）；请不要为了「看起来干净」删掉其中一路，
  那会让另一类访问方式（直连 or 反代）退回旧坑。
- `settings.yaml` 里 git-push 段的 `enabled: false` / `allowedModels` / `maxParallelToolCalls`
  实际属于 `subagent-model-selection` / `agent-loop` 命名空间（awk 按行截取易误读）；
  段内 `qualityWeights`/`auditRuleWeights` 是 v1 旧键残留，无害但勿依赖。
- **2026-09-15 修正（重要）**：本 Bug 3 的初版方案是「host scope.update 写 settings.yaml」，
  实测在用户环境发现**公共 settings.yaml 跨实例写锁竞争**（多 DSH 实例共享 DSH_HOME 时，
  `atomic-write: timed out waiting for the writer lock`，任何写都失败）。处理方式：
  **不写公共 settings.yaml，插件设置自管到插件私有 `$DSH_HOME/git-push/config.json`**
  （0600，与凭据同级）。settings-bridge 已重写为纯文件读写（无 scope 依赖、无锁竞争），
  详见下方 **Bug 4**。

---

## Bug 4：公共 settings.yaml 写锁竞争（跨实例）→ 设置迁插件私有 config.json

### 现象
Bug 3 修复后用户实测「**开关点了直接回弹**」（新改动回归）。curl 直打主实例
`POST /api/git-push/settings-set` 稳定复现：

```json
{ "ok": false, "code": "WRITE_FAIL",
  "error": "settings 写入失败: atomic-write: timed out waiting for the writer lock at .../settings.yaml.lock" }
```

且写 **auditEnabled / injectSystemPrompt 等任意键都一样失败**——不是单个开关的问题。

### 根因（2026-09-15 实测）
`$DSH_HOME/.dsh/settings.yaml` 被**多个 DSH 实例共享**（主实例 30801 + 反代进程 121000 + 其他
实例 114009/5435 的 DSH_HOME 各自独立、但主实例自身的 settings-file 写锁与读侧竞争）；
`packages/settings/settings-file` 的 atomic-write 用**跨进程 writer lock**（锁超时即失败），
任何 `scope.update` 都可能撞锁。这解释了「设置页保存后插件文件没写入」的旧现象——
不是 client memory 单点问题，而是 **settings.yaml 这把公共锁在并发下根本不可靠**。
（前端「回弹」的次级原因也有：`loadSettingsFromHttp()` 异步 GET 返回旧值、在用户点击后
覆盖本地新值——已用 `editedKeys` 集合守卫修复：用户编辑过的键 GET 不再覆盖。）

### 修复（用户 2026-09-15 拍板：不写公共 settings.yaml）
1. **`lib/app/settings-bridge.js` 重写为纯文件读写**：`readSettings()/writeSettingsKey(key,value)`
   直接操作 `$DSH_HOME/git-push/config.json`（0600，`credentialsDir()`，与 github-token/id_rsa
   同级）。无宿主 scope 依赖、无锁竞争、无 isLoopback 陷阱、重启读回。
   新增 `applySettingsToCfg(cfg, patch)`：**三处共用同一张「键 → cfg 字段」映射表**
   （apply.js 启动 merge / scope.watch / http settings-set），消除重复漂移；
   新增 `appendSettingsLog()`：**UI 提交日志**（`settings-ui.log` 0600，凭据打码，
   每次设置页提交留痕，重启后验证「提交确实发生」）。
2. **apply.js**：启动时 `readSettings()` merge 进 cfg（注入/审计设置重启保持）；
   `setSettingsScope` 删除（不再依赖 host scope 持久化）；watch 改用 applySettingsToCfg。
3. **http-handlers.js**：settings-get 读 config.json、settings-set 写 config.json + 同步 cfg；
   写盘后 appendSettingsLog。
4. **client.js**：
   - 新增 `commitSetting(key,value,okMsg)` 公共入口（**消除 toggle 四件套重复**：
     改字段→editedKeys→publish→persistSetting；injectSystemPrompt 原来的 toggle
     漏了 editedKeys 标记也顺带修复）；
   - `loadSettingsFromHttp` 用 `editedKeys` 守卫跳过用户已编辑的键（防回弹）；
   - 审计扫描范围按钮组改为**单按钮单击切换**（标题/颜色随状态变，
     diff=🟢 部分 / full=🟡 全量，父开关关闭置灰），不再双按钮。

### 验证
settings 单测从「依赖 scope」改为「config.json 临时目录」语义：200 闭环 / 白名单 400 /
日志落盘打码等 6 条；真实 git 场景验证「工作树脏 + 领先也能推」（见 Bug 5）；
回归 **560/560 全绿**；NM 主环境 6 个改动文件 md5 全一致（可安装重启验证）。

### 遗留 / 接手者注意
- config.json 已有旧内容（用户曾手动维护 auditEnabled/auditScanScope/auditLevel）——
  写入采用「读现有+合并」语义，不会清掉旧键；`applySettingsToCfg` 只认类型正确的键。
- `settings-ui.log` 会持续增长：按需加轮转（当前仅逐行追加，量很小，暂不需要）。
- 前端 `persistSetting` 仍保留 `scope.set` 双通道（loopback 兼容），核心落盘靠 HTTP。

---

## Bug 5：账号卡片「push 判定写反」——能推的不让推，不能推的按钮才能点

### 现象
设置侧边栏「账号 → 本地」面板：**能推的仓库按钮灰着，不能推的仓库按钮却亮着**。

### 根因（2026-09-15 实测）
判定把「**工作树干净**」(`changed === 0`) 当成了「能推」的条件——但 `git push` 推的是
**已提交**内容，工作树脏不脏与本次推送无关（未提交改动仍留本地，下次提交再推）。
真实数据印证：
- `ahead=0`（已同步、无新提交）的仓库按钮却亮 → 点了后端返回「未领先」no-op → **不能推的按钮才能点**；
- 有领先提交但工作树脏（`changed>0`）的仓库被拦 → **能推的不让推**。

### 修复
- **后端 `lib/git/push.js`**：删除 `if (changed > 0) return 先提交再推送` 拦截；
  可推与否只由 `ahead>0`（有未推送提交）决定，工作树脏不再拦。
- **前端 `client.js`**：`canPush = hasRemote && (ahead === null || ahead > 0)`
  （ahead=null 状态未知可点，交后端 ls-remote 判定；ahead=0 已同步灰置）。
- **`runAudit`（lib/commit-push.js）**：audit 结果带 `findings`，拦截时 error 直接列出
  被拦文件+规则（和全量审计一致，不再只说「N 个 blocker」说不清是哪些）；
  blocker 过滤抽成一次 `blocked` 变量（消除重复 filter）。

### 验证
真实 git 场景：临时仓库 + bare remote，提交 2 个后弄脏工作树 → `pushCurrentBranch`
不再被「先提交再推送」拦截（放行到推送通道）；测试改前 2 个失败文件恢复全绿。

---

## 测试改动

- `test/test-audit-bad-file.mjs`（新增，未跟踪）：`.env` 拦截测试**必须用真实 `.env` 文件名**——
  `credfile-common` 的 path_pattern `(^|[\\/])\.env` 要求「.env 前是路径开头或斜杠」，
  `.tmp-test-bad.env` 这类前缀名会绕过规则模式（曾因此误以为修复无效）。
- `README.md` test/ 树补 `test-audit-bad-file.mjs` 条目（否则 `scripts/tree-doc.mjs` 的
  checkDrift 报漂移，导致 test-tree-doc.mjs 两个测试失败——**新增文件后必须同步 README 树**）。

---

## 相关文件清单（本次改动）

| 文件 | 改动 |
|---|---|
| `lib/audit/orchestrate.js` | auditChanged 证据收集收窄到变动文件（Bug 1 提速） |
| `lib/audit/collector.js` | isTextFile 点文件扩展名（Bug 2 第 1 层） |
| `lib/checks/credential-file.js` | pathPattern 读取 + level 契约（Bug 2 第 2、3 层） |
| `lib/rule/compilers/credential.js` | credfile-* 补 level（Bug 2 第 3 层） |
| `lib/app/settings-bridge.js` | **新增**：host scope 设置读写桥（Bug 3） |
| `lib/app/http-handlers.js` | 新增 settings-get/settings-set 端点（Bug 3） |
| `lib/app/apply.js` | apply 时 setSettingsScope(scope)（Bug 3） |
| `client.js` | loadSettingsFromHttp + persistSetting + 扫描范围按钮组（Bug 3 + Bug 2 前端补开关） |
| `test/test-audit-bad-file.mjs` | .env 测试改用真实文件名 |
| `test/test-plugin.mjs` | 新增 5 个 settings 端点单测（Bug 3） |
| `test/test-inject-system-prompt.mjs` | 断言改 persistSetting + 新增扫描按钮接线断言（Bug 3） |
| `README.md` | lib/app 树补 settings-bridge.js + test 树条目 |
