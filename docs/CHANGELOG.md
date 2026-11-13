# 版本列表

> 由 `scripts/doc-version.mjs` 维护：`gen` 打印 / `apply` 更新本节 / `check` 查漂移（git log 聚合版本表）。
>
> ⚠️ **2.5.0 条目的更正说明（人工补充，不被 apply 覆盖）**：下表 2.5.0 行的**前半段**
> 「规模自适应聚合视图（节点>28 自动聚合，边全保留）」与「视图限边 ARCHIFY_MAX_EDGES」是开发中途的**已撤销**做法——
> 它违反 archify 作者契约的两条硬规定：「No node, relationship, source, view, card, or boundary count is a
> target or ceiling」（无任何数量配额）与「fewer routes alone do not justify merging」（不得仅为少画线而合并）。
> 该做法已全部回滚；2.5.0 的**最终形态以 2.5.0 行后半段与提交 `561e15b` 为准**：
> 按作者契约实现**抽象层级自适应**（细粒度 / 归并双档），5 个预览仓库均通过官方 `finalize --quality showcase`。
> 另：自造的定点修复脚本已移入 `.trash`（可恢复），未入库。

<!-- dshgp-version:start -->
## 版本列表

| 版本 | 内容 |
|------|------|
| 2.20.18 | **架构解耦三切面 + 测试结构整理**（2.20.17 之后的一批重构，行为不变）。

· **提交前审计 → 可配置引擎子进程**：`preCommit.{command,args,timeoutMs}` 配置化，换引擎（含换语言重写）只改配置；契约 = stdout 单行 JSON + 退出码 0/1/2；引擎不可用一律 fail-closed；9 场景矩阵逐字节一致。
· **CLI 三侧拆分**：`git-sluice`(17 命令) / `audit-sluice`(7) / `tool-sluice`(4)；跨侧命令明确报错并给可照抄替代，不做静默转发；参数错统一退出码 2。
· **审计 UI 注入契约**：`lib/audit-ui-sdk`（6 符号、深冻结、构建期校验），本版只定义不实施。
· **测试四侧分区**：`test/{git,audit,tool,app}` + `_archived/`，回归入口递归扫描、顶层只允许 `run-tests.mjs`。
· **测试合并不提速**（实测）：文件 174 → 125，但热跑由不可缓存文件数决定（仅 6 个），合并只减进程启动开销（≈9.4s），大单元反而让并行粒度变粗。价值在结构可维护性。
· 修 3 个照抄必失败的旧缺陷：`--no-push` 不可用、`git-sluice git <带 flag>` 报未知参数、2 个测试从不被扫描到（命名不合规）。 |
| 2.20.17 | 修**「DSH 启动后第一次打开「本地」页报 `读取失败: signal timed out`」**。

**现象**：不用点扫描，每次 DSH 启动后首开设置页「本地」标签就失败（前端 `fetch` 被 30s 超时 abort）。

**根因（两层）**：
1. **整表预算拦不住单次调用**：本地列表的 SSH 远端探测有 `LIST_LIVE_BUDGET_MS = 15_000` 整表预算，但它只在**每次探测前**检查一次；`liveRemoteHeadAsync` 内部前两步 `git remote get-url` 与 `git branch --show-current` **没有传 timeoutMs**（只有后面的 `ls-remote` 带了 8s）。冷启动首次 SSH 建连、CIFS 大目录 stat 时这两步可能挂很久 ⇒ 单次探测直接穿透预算 ⇒ 整个请求超 30s。
2. **长轮询挂得比客户端超时还久**：扫描长轮询单次挂起 `SCAN_WAIT_TIMEOUT_MS = 60_000`，而前端 `dshgp_FETCH_TIMEOUT_MS = 30_000` ⇒ 客户端必然先 abort，长轮询变成假失败。既有 `test-repos-live-budget.mjs` 只守住了 `LIST_LIVE_BUDGET_MS`，**漏了这一个**。

**修法（事件驱动，不是加大超时）**：
· **预算传播**：`liveRemoteHeadAsync({ budgetMs })` 把总预算摊到每一步——`stepTimeout(cap) = min(cap, 剩余预算)`，预算耗尽时后续步骤返回 1ms 并**不再发起新的 SSH 尝试**。总时长因此被预算界定，而不是靠「希望某一步不会慢」。
· `applyLiveRemote` 把当前剩余预算作为 `budgetMs` 传入单次探测。
· `SCAN_WAIT_TIMEOUT_MS` 60s → **20s**（≤ 前端超时 80% 余量），长轮询到点返回 `{timeout:true, running:true}` 继续下一轮，推进由 `done` 事件驱动。
· 前端长轮询请求显式给 `dshgp_SCAN_WAIT_FETCH_MS = 25_000`（> 服务端 20s、≤ 默认 30s）。
· **轮次耗尽不再算完成**：`startScan` 只在真的收到 `done` 或独立进程退出时才报「✅ 扫描完成」，否则如实报「⚠️ 未收到结束事件」——旧实现无论是否结束都报完成，等于把「事件永远不来」藏起来。

**验证**：新增 4 例回归（三层超时关系、预算传播行为、源码契约「每处 git 调用必须带 timeoutMs」、既有预算断言），并**反向自证**：把 `SCAN_WAIT_TIMEOUT_MS` 改回 60s 后新用例立刻变红。

注：外部 I/O 的超时属于**产品语义**（对端不可控），保留是对的；本次修的是「超时预算没传播下去」与「长轮询超时大于客户端超时」这两个真缺口，不是简单调大超时。

---

**放行判据加固**（复查时发现的安全弱点，与上面同一次发布）。

**问题**：2.20.17 的放行判据是「无 Origin + JSON CT + **Host 回环**」。但 **Host 头是客户端可控的**——攻击者从局域网发 `POST`，只要带 `Host: 127.0.0.1` 与 `Content-Type: application/json`，就能命中放行分支，等于绕过 CSRF 防护。（实测佐证：宿主转发链路里 Host 有时为空、有时可被改写，把安全性建立在它上面不成立。）

**修法**：本机判定改为**以 TCP 对端地址为准**（`req.socket.remoteAddress`，由内核给出、不可伪造），Host 只在拿不到 socket 地址时兜底（进程内调用/测试）。
· `checkOrigin` 新增第 6 参 `remoteAddress`；`fromLoopback = remoteAddress ? isLoopbackHost(remoteAddress) : isLoopbackHost(host)`；
· `handleHttp` 的 req 契约新增 `remoteAddress`，`adaptHttpHandler` 从 `req.socket.remoteAddress` 取真实值；
· `isLoopbackHost` 补**裸 IPv6**（`::1`）与 **IPv4-mapped**（`::ffff:127.0.0.1`）两个形态——`socket.remoteAddress` 在双栈监听时正是这两种裸形态，`hostNameOf` 的 `^([^/:]+)` 对以 `:` 开头的值会解析成空串，不特判会把本机请求误拒（首版就这么红了）。

**顺带收益**：覆盖「转发链路丢 Host」的场景（实测宿主转发后 host 可能为空）——原判据下这种请求会被误拒，现在凭 socket 地址照常放行。

**验证**：新增 3 例攻击面测试——① 伪造 `Host: 127.0.0.1` + 远端 socket ⇒ **仍拒**；② 本机 socket（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`）+ Host 为空 ⇒ 放行；③ socket 与 Host 冲突时以 socket 为准（双向各一例）。`test-origin-desktop.mjs` 共 17 例全绿。 |
| 2.20.16 | 修**桌面端所有写接口 403 NO_ORIGIN**（外部报告的 issue，桌面版设置页保存全部失效）。

**根因**：DSH 桌面版经自定义协议 `dsh-app://app` 加载 GUI，桌面壳 `forwardWebRequest` 把 `/api/*` 转发到后端时**显式剥离 Origin**（`headers.delete('origin')`，只补 cookie 与 host）。而 `checkOrigin` 对「无 Origin 的写请求」一律 403，且拒绝发生在任何 handler 之前 —— 所以表现为「设置页能读、所有保存/开关/按钮全失效、回显旧值、日志里一条记录都没有」，用户与排查者都无从下手（报告方完整复现并定位到桌面壳源码，附运行中宿主实测补丁）。

**修复判据**（无 Origin 时三条同时成立才放行，CSRF 防护不降级）：
1. **`Content-Type: application/json`** —— 浏览器跨站表单（text/plain / urlencoded / multipart）设不出这个 CT；fetch/XHR 设 JSON CT 属非简单请求 → 触发 CORS 预检，而本 API 从不回 CORS 许可头 ⇒ 预检失败，真实请求发不出去。
2. **Host 是回环地址**（127.0.0.1 / localhost / ::1）—— 桌面壳转发目标恒为 `127.0.0.1:<port>`。**这一条是在报告方建议之上额外收紧的**：若只按「无 Origin + JSON CT」放行，服务监听 `0.0.0.0` 时局域网内任何机器都能发无 Origin 的 JSON 写请求，等于给局域网开 CSRF 口子。
3. 浏览器发起的写请求**必带 Origin** ⇒ 走既有同源/跨源判定，不受本改动影响。

**实现**：`checkOrigin` 新增第 5 参 `contentType`；三处调用点（`handleHttp` / `authPipeline` / 端点骨架路由）补齐 host 与 content-type 透传；配套 helper `hostNameOf`（顺带修好 IPv6 方括号解析，原实现在 `http://[::1]:3080` 上会把主机名读成空）、`isLoopbackHost`、`isJsonContentType`。

**同时修复三个附带问题**：
· **恢复 403 拒绝日志**：新增 `http-rejects.log`（与 `settings-ui.log` 同级、0600），记 method / url / origin / host / code；query 里键名疑似凭据的一律替换为 `(已省略)`，不让日志本身成为泄漏通道。此前 403 完全静默，是本问题卡住两周的直接原因之一。
· **`settings-set` 凭据不再明文回显**：`githubToken` / `sshPub` / `npmToken` 写成功后回 `(已保存)`，口径与 schema 的 `role('secret')` + `redactConfig`（远端读一律打码）保持一致；前端只看 `ok`，不依赖回显值回填。
· **前端保存先确认再提示**：`persistSetting` 改为返回 promise，`save` 先 `await` 两次写入结果再决定提示文案——旧实现不 await 就 `flashSaved('✅ 凭据已保存')`，写失败时用户先看到成功再看到失败，正是「已保存但没生效」这一误解的来源。失败提示改为「❌ 保存失败：请求未写入（详情见 http-rejects.log）。
· **`clone-progress` 改 GET 轮询**：读端点免 Origin 校验，不会再因鉴权静默失败（进度条不刷新会被误判成「克隆卡住」）；后端 `consume` 同时接受 body（POST 旧写法）与 `?consume=1`（GET），两者等价。

**验证**：新增 `test/test-origin-desktop.mjs` 14 例——桌面端形态放行、JSON CT 带 charset、四种写方法全覆盖、localhost/::1 都算回环；以及拒绝侧（非 JSON CT、非回环 Host、跨站 Origin 全仍拒）、既有放行路径不回归、三个 helper 边界、端到端 settings-set 能真正写入 config.json、凭据回显脱敏。相关测试面 77 例全绿。 |
| 2.20.15 | UI 与审计解耦（**文件隔离阶段**）。目标是把审计与 git 侧的文件边界划清，为将来拆成两个独立项目做准备；**行为不变**——后端审计能力完全保留。

**① 客户端分片按侧分目录**
· `lib/client-parts/git/` —— git / 发布 / 工具链侧，**13 片，参与构建**（`PARTS_DIR` 指向它）；
· `lib/client-parts/audit/` —— 审计侧（`audit.js`），**不参与构建**，构建脚本不读也不校验。
不参与构建的实现方式：不在 `PARTS_DIR` 下 ⇒ `readParts` 的「未登记分片」与「缺片」两项检查天然扫不到它，无需为它加任何特例分支（这是「不报错」的最省做法）。

**② 审计 Tab 移出产物**：`page.js` 的 tabs 从三项减为两项（账号信息 / 设置），并删掉 `dshgp_AuditTab` 的 panel 分支。产物 `lib/client.js` 从 3215 行 / 198569 字节降到 **2904 行 / 179164 字节**，`dshgp_AuditTab` / `dshgp_RuleListBlock` / `dshgp_WeightRows` 等审计 UI 符号全部为 0。

**③ 审计设置键单独成文件**：`lib/app/schema-audit.js` 的 `auditConfigShape(Schema)` 承载 14 个审计键（`auditEnabled` / `maxScanFiles` / `injectRequirements` / `auditScanScope` / `auditRuleOrder` / `auditDisabledSlots` / `weightOverrides` / `linkCheckEnabled` / `commentWording*` ×4 / `auditRuleWeights` / `qualityWeights`），`schema.js` 用 `...auditConfigShape(Schema)` 展开合并。**33 个字段与默认值逐一核对一致**（不是「看起来没变」，是逐键比对）。

**④ 审计 UI 测试归档**：`test/test-inject-switch.mjs` / `test-inject-system-prompt.mjs` / `test-sidebar-interaction.mjs` 移入 `test/audit/`（`run-tests.mjs` 只扫 `test/` 顶层的 `test-*.mjs`，故不进常规回归），附 README 说明「为什么归档、怎么手动跑、现在跑会失败属预期」。这些断言的是审计 Tab 的渲染，Tab 已不存在 ⇒ 归档而非删除，将来拆项目时随分片一起搬走。

**⑤ 测试适配**：`test-client` 的 select 阈值 3→2（审计进阶 sel 已移出）、Host Config 读取列表补 `schema-audit.js`；`test-picker-layout` / `e2e-npm-tab-render` / `test-repos-live-budget` 改为从 `build-client.mjs` 导入 `PARTS_DIR`，不再硬编码 `lib/client-parts/xxx.js`（分片再挪目录测试自动跟随）。

**验证**：全量回归 **1496 tests / pass 1490 / fail 0 / skipped 6**；`checkDrift` 0 issues；`scan-version` 三处一致；diff 审计 0 blocker。

**未发 npm**：本项目已定为不发包（计划重构成两个新项目），本次仅 git 提交推送。 |
| 2.20.14 | 按用户明确口径收口：

1. **硬编码路径规则禁止任何场景豁免**：删除 2.20.12 引入的 `isReasonableAbsolutePath` 整段（曾排除 `/tmp`、`/usr/bin`、`/var/packages/`、Windows 程序目录等）。规则保持 `blocker`，**只保留文档类降级 warning**（`.md/.txt/.rst` 及 `docs/` 下文件）。个别误报由代码侧用行级临时豁免注释逐处标注，不在规则里开白名单。

2. **删掉写坏/无用的测试**：移除 `test/test-hardcoded-path-blocker.mjs`（我新增、多轮环境耦合）、`test/test-scan-hardcoded-paths.mjs` 与其唯一实现脚本 `scripts/scan-hardcoded-paths.mjs`。这批测试连续造成 CI 红（run 67/68），根因是夹具依赖 `os.tmpdir` 的本机形态，两地结论相反。

3. **清理死文件**：`assets/` 整个目录（预览页/启停脚本整套已废弃，生成脚本早已移入 `.trash`）从仓库移除；同步清理 `skills/guide/guide-inject-ui.md` 的 2.6 预览节、`docs/FILE-TREE.md`、`tree-doc.json`（含 `_meta.worktree`）中的悬空引用。

4. **教训固化**：`ai-work-archive/skills/ops-self-bootstrap-运维自举/tool-self-detection.md` 新增第七节——「自探测 ≠ 硬编码一堆绝对路径候选清单」：候选应由 PATH 分段与平台根常量**派生**，不把 `/usr/bin/x`、`C:\\Program Files\\x` 这类具体路径写进源码；不因「合法写法」给规则加豁免，规则改 severity 前先跑该规则全部相关测试。 |
| 2.20.13 | 两项修复。

**① 精确化「硬编码路径」的排除面**（修 2.20.12 引入的过宽排除）。2.20.12 为不误伤工具探测候选，把 `/var/packages/` **整目录**排除，但套件的数据/配置路径写死同样是「换机即失效」，属真问题；实测副作用：`test-scan-hardcoded-paths.mjs` 用 `/var/packages/<pkg>/tmp/…/exists.txt`（真实存在的临时文件）验证「相对路径换算基准 = 文件所在目录」，被整体排除后该用例丢失可访问样本，5 项断言失败。
现改为只排除**含 `bin`/`sbin`/`lib` 段**的路径（可执行与库目录），数据/配置路径照常报 blocker。

**② npm registry 空串防护**（并发改动，一并收录）。未配置 registry 时传 `undefined` 而非空串；`npmrcText` 新增 `effectiveRegistry` 归一化（空串/纯空白/undefined → 默认 registry）。原因：`registry=` 写进 npmrc 后，npm 构建 nerf-dart 时 `new URL('')` 直接抛 `ERR_INVALID_URL`，**所有 npm 子命令全部不可用**，而报错信息完全看不出根因（实测撤包工具因此跑不起来）。

验收：`test-scan-hardcoded-paths`（含相对路径换算/--write/dry-run）**全部通过**；hardcoded-path-blocker 4 例、tree-doc 13 例、audit-api 相关、npm 发布门禁 8 例 —— 合计 **38 例全绿**。 |
| 2.20.12 | 两项变更。

**① `paths/hardcoded-absolute-path` 提升为 blocker**。动机：代码里写死**本机数据/资源目录**（`/volume1/xxx`、`/home/<user>`、`C:\\Users\\…`、UNC 共享）换机或换挂载点必然失效，属真实故障形态。

但**不能简单提级**——实测本仓 35 条命中**全是合理写法**（CI 的 `/tmp/test-run.log`、启动脚本的 node 多候选探测、工具路径清单），一提就会产生 35 条误报，把正确做法判成缺陷。因此判据分两层：
· 精筛排除「合理绝对路径」（`isReasonableAbsolutePath`）：临时目录 `/tmp` `/var/tmp` `/dev/shm`、伪文件系统 `/proc` `/sys` `/dev`、系统工具目录 `/usr/bin` `/usr/local/bin` `/bin` `/sbin` `/opt/<任意>/bin` `/var/packages/…`、Windows `C:/Windows` `C:/Program Files` `C:/ProgramData`、macOS `/System` `/Library` —— 前两类跨机语义一致，系统工具目录出现在**多候选探测清单**里是 `tool-self-detection` 要求的正确做法。
· 文档/数据文档降级为 warning：`.md/.txt/.rst` 及 `docs/` 下任意文件（示例路径属说明内容）。

实测效果：本仓从 **35 条（含 5 blocker 误报）→ 8 条全 warning、0 blocker**；而真·数据路径（`/volume1/MyData`、`C:\\Users\\bob`、UNC）仍正确报 blocker。
新增 `test/test-hardcoded-path-blocker.mjs` 4 例（真数据路径 blocker / Windows·UNC blocker / 合理写法不报 / 文档降级）。

**② 审计输出默认反转：默认带详细**。此前 `code_audit` 默认只给评分+摘要+API 指引，要看明细得传 `includeFindings=true`；现改为**默认返回 findings + yaml**，需要精简时传 `includeFindings=false` 或 `summaryOnly=true`。理由：调用方拿到的就该是能直接读的问题明细，多一跳就多一次漏看的可能。

测试同步更新（`test-audit-api.mjs`：原断言「默认不返回 findings」改为「默认返回、传 false 才精简」）。 |
| 2.20.11 | 修 **CI 真因**（run 57~65 连续失败，本地一直绿）。

失败项：`not ok 237 - 登记后外部裸 git 可用；注销后恢复；重复登记幂等`。

根因（典型「测试隐含依赖本机既有状态」）：测试直接
`execFileSync('git', ['config','--global','--get-all','safe.directory'])`。
而 **`git config --get-all` 在键不存在时退出码为 1**，`execFileSync` 会直接抛异常。
CI runner 是全新 HOME（从未配过 safe.directory）⇒ 必抛；本地开发机往往早已有该键（CIFS 仓库登记过）⇒ 一直绿。
这解释了「本地全绿、CI 必红」的全部现象，也与 2.20.3 引入该测试的时间点吻合。

修法：新增 `readGlobalSafeDirs`（try/catch 包裹，无键即返回空列表），两处读取统一走它。

**验证方式改为复刻 CI 条件**，而不是只跑本地：
`HOME=$(mktemp -d) node --test test/test-cifs-init.mjs` ⇒ **7 例全通过**（全新 HOME、无 safe.directory 键）。

过程记录（方法教训）：前几版我靠本地盘模拟猜失败项，因为拿不到 CI 日志（logs 下载需 token）。本版给 workflow 加了 `::error::` annotation，才通过 
`/repos/{owner}/{repo}/check-runs/{id}/annotations` 匿名读到真实失败测试名 —— **远程排障要先让 CI 自己说话，不要靠本地推断**。 |
| 2.20.10 | 敏感文件扫描**不再享有「强制全仓」特权**，改为与所有审计规则**同一地位**。

此前的状态是特权式的：`commitAndPush` 只要有改动就**无条件**调 `ensureGitignore` → `scanSensitiveFiles` 递归全仓扫（与 `audit` 开关无关、与 `auditScanScope` 无关），这正是 2.20.9 那个「卡 15 分钟」的结构前提。2.20.9 已把它收窄到「本次将提交的文件」，本版补齐剩下的那一半——**开关归属**。

改法（贯通三层）：
· `tool-call.js` → 按 `cfg.auditEnabled !== false` 传 `scanSensitive`；
· `commitAndPush` 接收并传给 `ensureGitignore` / private 豁免分支；
· `ensureGitignore` 透传给 `scanSensitiveFiles`（false ⇒ 直接返回空，不读任何文件）。

语义即用户口径：「审计关 ⇒ 不扫」「审计开 ⇒ 只扫将要入库的内容（diff 语义）」，与其他规则完全一致，不再有绕过审计开关独自全仓扫描的特权路径。
缺省 `scanSensitive = true` 仅为兼容直接调用方（CLI/测试），工具路径一律显式传入。

验收：push/ignore/auditignore/transport 相关 12 个测试文件 **86 例全绿**。 |
| 2.20.9 | 修 **「有改动的提交卡分钟级」**（CIFS/SMB 上可卡满 15 分钟仍未返回）。

**根因（代码级，非网络/git/锁/钩子）**：`commitAndPush` 在「工作区有改动」分支里会调 `ensureGitignore` → `scanSensitiveFiles(repoPath)`，而后者**递归遍历全仓并逐个 readFile 读内容**。在 CIFS/SMB 挂载上每个文件都是一次网络往返，实测约 1 秒/文件 ⇒ 724 个文件的仓库 ≈ 12 分钟以上。这也解释了此前所有观测：**0 改动秒回**（`cleanSkipCommit` 把整段跳过，根本不扫）、**与改动文件数无关**（扫的是全仓，单文件改动一样慢）、git 自身很快（status 2 秒有 index 缓存，不读内容）。

**实测对照**（同一仓库、724 文件、CIFS）：
· 修复前全仓扫描：限时 60 秒**跑不完**；
· 修复后只扫变更集：**26 毫秒**（2000 倍以上差距）。

**修法**：`scanSensitiveFiles(repoPath, { onlyPaths })` 新增只扫指定路径的分支；`ensureGitignore` 透传 `onlyPaths`；`commitAndPush` 传入「本次将提交的文件」——`paths` 精确模式直接用 pathList，否则解析 `git status --porcelain` 的变更集（含重命名 `old -> new` 取新名、目录项跳过）。语义上也更准：提交只关心**将要入库的内容**，无关文件本就不该扫。
缺省不传 `onlyPaths` 时保持原全仓行为，其它调用方（如独立的敏感文件巡检）不受影响。

验收：push/ignore/auditignore/transport 相关 **12 个测试文件 86 例全绿**；实测同一仓库 26ms vs 原 60s+ 跑不完。 |
| 2.20.8 | 修 **CI 假红**（run 57~61 连续失败，而本地一直绿）。

根因：`test/test-cifs-init.mjs` 的幂等断言把跳过原因**写死**成 `'已登记'`——那是 CIFS 卷的行为（目录属主是挂载用户、与进程 uid 不一致，所以需要登记过才有该文案）。CI 跑在本地盘、属主与进程 uid 一致，走的是另一条分支（「属主与当前进程一致，git 不会判 dubious」），于是 `assert.equal(r2.skipped, '已登记')` 在 CI 上**恒失败**。讽刺的是原注释里已经写明「若本机本就同 uid 则报『一致』」，但断言只写了前一种——想到了没写进去，属测试断言的环境耦合。

修法：断言改为按环境分支匹配 `/已登记|一致/`，并在两处都写明为什么不能写死。

验证（这次刻意把 CI 条件搬回本地跑，而不是只靠本地 CIFS 绿就推）：
① 本地 CIFS：test-cifs-init **7 例全绿**；
② **完整复刻 CI 条件**（/tmp 本地盘 + 属主与进程同 uid）逐条断言：建仓 ok、裸 git 可用、重复登记 registered=false、skipped 匹配、global 最多一条、注销 removed=true、注销后无残留 —— **7/7 全通过**。

教训：**环境分支的断言必须按分支写，不能把某一个环境的返回值当唯一真值**；本地绿不等于 CI 绿，涉及文件系统属性的测试尤其如此。 |
| 2.20.7 | 修 `dataflow/clear-then-access` 的**第六类**系统性误报：**`reset` 被当作清空方法**。

与 `.empty` 同类：`reset` 在业务代码里绝大多数是「**恢复默认值 / 重置状态**」而不是「清空容器」——重置后对象**仍有内容**，之后读取完全安全。实测证据（外部 Python 仓库）：配置类 `reset -> bool`，测试断言 `cfg.reset` 之后 `cfg.get("general.theme") == "dark"`（拿到的是有效默认值，不是空）；该语料 13 条命中里 **12 条**都源于把 `reset` 当清空。

处置：从 `CLEAR_METHODS` 移除 `reset`（保留 `clear`/`flush`/`purge`）。真正的容器清空在各语言里用 `clear`；若某库确把 `reset` 用作清空，宁可漏报（本规则宁漏不误）。

验收：`test-dataflow-clear-fp.mjs` 新增 A2 用例（`reset` 后读取不报 + `clear` 仍必须报），与 dataflow 三套测试合计 **25 例全绿**。真实语料同口径复测：clear-then-access **13 → 5**，剩余 5 条全部位于 `tests/` 且形态是 `results = []` → 循环 `append` → 读 `results[0]`（测试惯用的局部变量初始化），属**另一类**（写回识别）问题，已记录待后续处理，不在本版范围。

补充：本版曾尝试用「首次绑定判定」一并解决那 5 条，但实测会压制真缺陷（`def f(c): c = []` 里参数 c 已绑定，被误判成首次绑定），**已完整回退**——宁可留 5 条待处理，也不接受把真问题一起修掉。 |
| 2.20.6 | 修 `dataflow/clear-then-access` 的**第五类**系统性误报：**Python 缩进式函数体从未被识别**。

根因（结构性）：函数体区间收集只有两段，且都只认 JS 风格——`collectDeclaredFnBodies` 找 `function` 关键字、`collectArrowMethodBodies` 找 `) {`。Python 用 `def f:` + 缩进，两段都不命中 ⇒ `fnRanges` 为空 ⇒ `mergeFnRanges` 第 3 步退化成「整个文件一个 token 区间」⇒ 同文件内**任意位置**的清空与访问都会被配成一对数据流。实测证据：clear 在 `invalidate`(L126)、访问在 `build_index`(L303)，相距 177 行仍被报为「清空后访问」；另两例同样是跨方法误连。这不是「宁漏不误」能辩护的，是把不相关代码当数据流。

修法：新增 `collectPythonDefBodies(text, tokens)`，按**缩进**解析 `def`/`async def` 块范围（从 def 行起，到首个非空非注释且缩进 ≤ def 缩进的行为止），把行号换算成 token 区间，与花括号语言并存。两个刻意的边界：① `def` 必须落在真 token 上（避免三引号字符串/注释里的假 def）；② **闭包不拆**——嵌套 def 捕获外层变量属同一份数据流，仍合并为一个体（`def outer: buf=[]; def inner: return buf[0]` 确实会 IndexError，报它是对的）。

验收：新增 `test/test-dataflow-py-bodies.mjs` 4 例（跨方法不连 / 同方法内仍连 / 闭包必须连 / 花括号语言回归），与既有 `test-dataflow.mjs`、`test-dataflow-clear-fp.mjs` 合计 **24 例全绿**。真实语料同口径复测：**13 → 1 条**，剩余 1 条经人工核对源码属 D3 设计边界内的合理提示（`_config.reset` 之后另有 `self._load_settings` 重新填充，但「某个调用会重填」需跨方法推断，规则明定不做），不是系统性误报。 |
| 2.20.5 | 修 `dataflow/clear-then-access` 的四类**系统性**误报。真实语料实测（外部 Python 仓库约 1300 文件）：同批 8 个文件 11 条命中里 **8 条是误报**，四类根因互不相同，且都不是「规则思路错」而是判据缺口：

**A. `.empty` 被当作清空方法** —— `CLEAR_METHODS` 含 `empty`，但 `empty` 在各语言都是**查询**（Python `Queue.empty` / C++ `vector.empty` 返回 bool）。实测 `while not q.empty:` 之后的 `q.get` 被误报成「清空后访问」。已从常量表移除，并注明「若某库确把 empty 用作清空，宁可漏报」。

**B. 写目标被当读访问** —— `self._status[mid] = X` 里 `[mid]` 是**写入下标**，而 `applyAccessAfterClear` 只看 `obj[` 就报，从不检查配对 `]` 后面是否跟 `=`。现在按「配对 `]` 后是 `=`/复合赋值 ⇒ 视为重新填充（与 push/set 同口径）撤销清空标记」，不是简单跳过。

**C. 类型注解位参与判定** —— PEP 526 `self._x: list = []` 让注解里的 `list` 被当作对象名记入清空表，随后 `-> list[str]` 返回注解里的 `list[str]` 被当作读访问。修法：赋值目标前若是注解冒号则跳过；**并且 `:` 前必须是标识符**——Python 函数定义的 `def f(c):` 也用冒号，但其前是 `)`，不加这条会压制真缺陷（`def f(c): c = []` 后 `c[0]` 本该报却不报，实测踩到）。

**D. 多目标解包错位** —— `result, last = [], {}` 中 `last` 后面紧跟 `=`，规则把 `[]` 算到 last 头上（实际 last 拿到 `{}`），后续 `last.get` 误报。判据：obj 前是 `,` ⇒ 属解包目标之一，rhs 不归它。

**验收**：新增 `test/test-dataflow-clear-fp.mjs` 6 例（四类 FP 各一 + 两条正样本），与既有 `test-dataflow.mjs` 14 例合计 20 例全绿。同批真实文件命中 11 → **3**，剩余 3 条经人工核对源码均为真命中（`clear` 后无重新填充即读取，正是规则该提示的形态），**真缺陷未被压制**。 |
| 2.20.4 | 树化迁移第二条（方向 E，A 档）：**short-func-name 精筛改吃语法树**。实测缺口是**漏报不是误报**——token 级只认「function 关键字后的标识符」，于是 `class A { gh {} }`、`const o = { ef {} }` 这类方法短名完全查不到（同样是「名字猜不出含义」的缺陷，却静默放行）。

实现同 credential 那条：`treesitter.js::shortFunctionNamesFromTree(tree, isShort)` 以谓词注入接收判定语汇（长度阈值 + 公认缩写白名单仍只在 naming.js 一份定义），function_declaration / generator_function_declaration / function_expression / method_definition / method_signature 五类节点取 name 字段；arrow_function、if_statement 无 name ⇒ 天然不误伤；naming.js 有树走树、无树回退（D5）。

两条踩坑记录（都是结构性坑，不是笔误）：① **初筛 pattern 不放宽则树化完全无效**——allow 语义下 pattern 必须先把候选行捞进来，而方法行不含 function 关键字，实测 `  gh {` 对原 pattern 恒 false；补 `^\s*[a-zA-Z_$][a-zA-Z0-9_$]{0,1}\s*\(` 做**粗筛**，是否真是定义交给树精筛，故 `ab(1)` 调用、`label: "x"` 属性、`return 1` 进不了候选（实测逐一核验）；② **get/set 访问器必须显式排除**——其 name 是属性名而非函数名，且 `get x/set x(v)` 是框架存取器极常见惯例；第一版靠初筛侥幸挡住，放宽 pattern 后立刻变成误报源，现按 children[0] 的 get/set 节点类型显式跳过，并钉进测试。

TREE_FIRST_KINDS 增登记 short-func-name（否则 .js 文件按 astConfirmSpan 门槛不建树，改了也白改）。回归验证：本仓全量 funcname 命中 0（新粗 pattern 未刷 FP）；d3dx 命中 0 属预期（该规则 exts 限 JS，样本是纯 Python 仓库）。新增 `test-tree-first-funcname.mjs` 4 例：红基线记录（token 级只报 L1）/ 树化后 [1,11,17]（函数+类方法+对象方法）/ 无树对照（语法资产缺失时 L11、L17 漏报重现 + L1 仍报，证明干净结果来自树而非规则变哑）/ 访问器与 async·生成器方法边界。与既有 `test-tree-first-credential.mjs` 三条合计 7 例全绿。权威文档「三层结构」节同步改为「语法树优先、token 级回退」并列出已迁移 kind 清单与迁移门槛六条。 |
| 2.20.3 | 修 CIFS/SMB 挂载上「建仓成功、仓库却对外不可用」。**根因实测**（git 2.55.0，本机 CIFS forceuid 卷）：目录属主被映射成挂载用户（`杜渊`/uid 1026），而进程 uid 是套件用户（284371），git 2.35+ 的所有权检查对**任何**命令报 `detected dubious ownership`。插件内部走 runGit（GIT_GLOBAL_ARGS 带 `-c safe.directory=*`）完全感觉不到，于是 `ensureUsableLocalRepo` 报告 create/keep 成功、`isUsableRepo` 也判可用，但仓库交出去后用户一敲 git 就挂——与历史事故「remote add 失败却返回成功」同型的假成功。

**三条决定性实测**（决定方案形态，不是猜的）：① 仓库级 `[safe] directory` **不生效**——所有权检查发生在读取该仓库 config 之前，被检查的目录无法自证可信（写了该段的仓库，裸 git status 仍 fatal）；② `-c safe.directory=<绝对路径>` 生效，global 写同一条同样生效；③ 同 uid 的本地盘本来就可信，不需要登记（否则会污染用户配置）。因此第一版实现（往降级 config 里写 `[safe] directory`）被实测证伪后重写为 global 路线。

新增 `registerTrustedRepo(dir)` / `unregisterTrustedRepo(dir)` 成对能力：只登记**这一个具体路径**（不是 `*`，不改用户对所有仓库的信任策略）；读现有列表判幂等（`safe.directory` 是可重复键，重复调用不堆条目）；先用 `statSync` 比属主 uid，一致直接 skipped 不写任何东西；无 getuid 的平台（Windows）跳过。注销按正则需要转义路径里的特殊字符，且不动别人的条目。`ensureUsableLocalRepo` 三条路径（keep / create / repair）统一调用并把结果放进返回值 `trusted`——keep 也要登记，因为历史建仓和标准 git init 都没写过这条目。

测试零污染：临时目录会被删除，若只登记不注销就会在**用户真实 gitconfig** 里留死路径（实测跑一轮堆了 5 条，已手工清理并把这条列为测试纪律）。`withDir` 收尾改成「先 unregister 再 rm」（注销需要目录还在才能算出同一绝对路径）。新增 2 例：登记后裸 git 必须可用 + 幂等 + 注销后不残留；同 uid 目录不登记。init-compat / cifs-init / clone-concurrency 三文件 32 例全绿，跑完 `git config --global --get-all safe.directory` 与跑前逐字节一致。 |
| 2.20.2 | 修委托层自身的「灯下黑」：`tools/ruff` 缺可执行位时，`detectLinters` 旧行为静默返回 `[]`，报告里与「项目压根没配 ruff」**完全无法区分**——而委托层宣称要防的正是静默空转（linted/treeUsage 那套）。

触发实测：宿主 0.2.1→0.2.2 升级后，部署副本 `tools/ruff` 权限从 755 变成 600（同步/拷贝不保 mode），委托层当场失效且毫无提示；`chmod 755` 恢复后 `ruff --version` 正常。这类问题在 CIFS 挂载 + 部署副本迁移的组合下会反复出现。

修复：① 新增 `detectLinterStatus(repo)` 返回 `{ok, unavailable}`，`unavailable` 项带具体成因与修复动作（分两档：**文件存在但不可执行** ⇒ 指向该路径并提示 `chmod 755`；**一个候选都没有** ⇒ 提示放 tools/ 或 `export DSH_GIT_PUSH_RUFF=路径`）；② `runLintAdapters` 把 unavailable 也记进 `linted`（count=0、unavailable:true、note 以「未委托」开头，与「委托成功但判定无问题」在文案上分开）；③ `detectLinters` 保留为 `detectLinterStatus(...).ok`，旧调用方无感。

顺带消除双份真相：四律候选清单原先在 `resolveBin` 与 `resolveBinDetailed` 各写一份（改一处漏一处会出现「详版找得到、简版找不到」的自相矛盾），现合并为 `binCandidates` 单一来源，两处共用。

另修一处运行期缺陷：`runLintAdapters` 里 `const linters` 被后续重新赋值（`node --check` 抓不到，实际调用即抛 TypeError），改 `let` 并注释原因。

测试：`test-lint-adapter` 新增第 6 例——剥夺 tools/ruff 的 x 位后断言 ok=[]、unavailable 长度 1 且 reason 指向 chmod、linted 记 unavailable、并以「项目没配 ruff ⇒ unavailable 为空」作对照（两种沉默必须可区分）。6 例全绿。 |
| 2.20.1 | 外部 linter 委托层（方向 A 骨架，新增 `lib/lint-adapter/`：detect.js 探测 / runner.js 调用+适配 / index.js 聚合）。目标：被审项目自带官方 linter 时用它当判定源，把风格类精度交给工具链、切断自研规则的误报-补丁增量源头。

探测三段（tool-self-detection 四律）：① 项目配置指纹（pyproject 的 [tool.ruff] 段或 ruff.toml）② 工具可执行自探测——env 覆盖 → 插件 tools/ 副本 → 项目 tools/ → PATH 扫段 → 常见绝对路径，每条候选校验 X_OK 而非仅存在（CIFS/noexec 上会存在但跑不了）；③ 有配置但跑不起来 ⇒ 该 linter 不委托、降级回自研（不报错）。PLUGIN_ROOT 统一从 core/config.js 导入（不在委托层自己 resolve，避免 ext-runner 修过的 duplicate-constant 复发）。

两条硬约束：**① 只进评分与报告、绝不进拦截门禁**——所有外部 finding 的 severity 恒封顶 warning，即便 ruff 判 error 级规则（E902 语法错误）也一样，isBlockerFinding 恒 false，别人的规则集不裁决本仓能否提交；**② 任何失败一律降级空**——可执行缺失/超时（60s 上限）/输出非 JSON/退出码≥2 全部返回 {findings:[], note:降级原因}。其中退出码语义单独处理：ruff 的 1=有 lint 问题（stdout 合法 JSON，必须采纳），≥2 才是真错误；**关键防的是假阴性**：若把「ruff 崩了 + stdout 空」当成「外部权威源判定无问题」，是最隐蔽的失败，故崩溃路径绝不产出空判定结果冒充健康。

适配映射：ruff 规则码前缀 → 本引擎维度（E/W/I→可读性、F→健壮性+可维护性、B/SIM/UP/RUF→可维护性、C4→性能、S→安全性，未知兜底可维护性）；filename 转相对仓库根正斜杠（root 外的绝对路径取文件名兜底，不外泄他人机器路径）；rule id 带 `ruff/` 前缀、source 标 `linter:ruff`。noqa/per-file-ignores 由 ruff 自身遵守（被抑制项不输出），委托层不重复实现第二套豁免。仅 full 范围委托：外部 linter 是全仓扫描器，diff 语义不符且会拖慢提交门禁（与 analysisCoverage 同口径）。

防静默空转：`linted`（委托了哪些 linter/版本/各产出条数/降级原因）随审计结果返回，口径同 2.19.0 的 treeUsage——项目自带 ruff 却长期 linted=[] 在报告里看得见。`lint-adapter` 已纳入层边界门禁 AUDIT_DIRS（编排层直接依赖它 ⇒ 属审计子图，同样不得伸手 git 层），实测审计层对 git 层仍 0 依赖、反向接缝 7/7 未膨胀。

`opts.linters` 是测试注入口，已在代码里写明**不得接进 API/CLI**（buildAuditOpts 是字段白名单，外部 args 到不了编排层），否则等于开「让审计引擎执行调用方指定二进制」的后门。

本轮按「先写骨架」口径**未下载 ruff 本体**（本机 PATH/常见路径/tools 均无，PyPI 通道已探测可用）；测试全部用假 ruff 二进制驱动真实 spawn/execFile 路径。新增 `test/test-lint-adapter.mjs`（5 例：探测三态 / 适配映射 / error 级也封顶 warning / 四类降级含崩溃不当无问题 / 端到端并入且 blocker 不增 + linted 可见）。 |
| 2.20.0 | 评分诚实度（方向 B）：**零规则维度权重记 0**。此前评分对「无命中维度」一律给满分 10 并按设定权重计入总分，于是「本次生效规则集里一条规则都没绑定该维度」（= 对本仓库没有检测能力）也被算成质量高——实测外部 PySide6 仓库：测试覆盖/可观测性/开发者体验三维 0 条规则绑定却齐贡献满分，把分抬到 85/A，而人工核实存在 6 个真问题（含压缩包路径穿越与凭据双向失灵）。

口径：编排层按**生效规则集**（已按仓库语言/槽位/豁免过滤的 grouped，不是全量规则表）统计每维度绑定规则数 computeDimRuleCounts，绑定数=0 的维度实际权重记 0（等价于剔出分母），并回传 uncoveredDimensions 供报告显式标注。判据用生效规则集是为了不误伤：纯 Python 仓库没有 C# 专属规则属正常，不该因此把可维护性记 0。

两道护栏：①**全塌保护**——十维绑定数全为 0（自定义规则集不声明 dimensions）或传 {} 时整条口径不启用、退回旧行为，避免把满分仓库算成 0 分；②**向后兼容**——不传 dimRuleCounts（旧调用方/独立调用）逐位等价于改造前，全维度有绑定时分数也与旧口径完全一致。五个评分消费点（audit-api / tool-call / CLI commands-audit / history / commit-push 门禁）统一接线，commit-push 此前连 dimFileCounts 都没传，一并补齐同口径。

实测效果（d3dx 同一份 findings）：84.199 → 76.929，uncoveredDimensions=[测试覆盖, 可观测性, 开发者体验]——分数的下降不是代码变差，是**假满分被剥离**。新增 test/test-score-zero-rule-dims.mjs（5 例：记 0 与标注 / 诚实性抬降方向 / 全绑定逐位一致 / 全塌保护 / 旧调用方兼容）。 |
| 2.19.0 | 审计「有树走树」（方向 E1-E3 落地）：凭据精筛 credential-value 改以 tree-sitter 语法树为主路径，无语法/解析失败回退 token 级（D5 口径不变）。

误报消除三类（外部 PySide6 仓库实测 10 条 blocker 全误报 → 0）：函数参数默认值（def _icon(name, token="text.secondary")）、拼接复合右值（token="前缀:"+uuid）、三元分支——语法树上分别不是赋值语句/右值是 binary_operator 非纯字面量，一眼排除；同时凭据名改**强弱分级**：strong（password/secret/cookie…）右侧有效字面量即报，weak（token/key 这类常用普通词）要求值有凭据置信度（ghp_/sk-/AKIA 等 scheme 前缀，或 ≥20 位大小写数字混合高熵串）——token_pattern/cookieChars 这类「凭据词只是普通变量名一部分」不再命中，APP_UPDATE_TOKEN_SECRET 仍命中。树与 token 两条路径共用同一份组合判据（credential.js isHardcodedCredentialValue，唯一真源）。

漏报修复：Python bytes/raw 前缀真凭据（SECRET_KEY = b"…"）此前初筛正则（= 与引号间隔 b 断链）与精筛（b 被切成 ident）两处都到不了报告路径，现初筛允许 ≤2 字符字符串前缀、精筛按字面量邻接/树节点识别；下划线复合凭据名（SECRET_KEY/API_KEY_ID 词尾段）初筛加 (?![A-Za-z])\w* 进候选（tokenizer 类「凭据词只是单词前缀」仍排除）。f-string 插值串不判硬编码（值来自变量）。

建树触发与 astConfirmSpan 解耦（E2）：编排层按 TREE_FIRST_KINDS（credential-value 起步）判定「规则要吃树就预解析建树」，此前 .py 因槽位无 astConfirmSpan 规则而从不建树、凭精筛永远吃 token 级。treeUsage 状态进审计结果（E3 防再哑）：needTree/hasGrammar/parsed/noGrammar/parseFailed/coverage 计数随每次审计返回——「声明吃树却没吃到树」不再静默（语法资产完好时 coverage 应恒为 1，测试直接断言），实测 d3dx 全仓 981 文件 894 建树。

新增 test/test-tree-first-credential.mjs 三向样本回归：有树主路径（报必报含 bytes、不报必不报）/ treeUsage 断言 / 无树对照（语法资产缺失时拼接右值误报形态重现，证明干净结果来自树而非规则变哑）。test-audit-bad-file.mjs 同步改造为独立临时 git 仓库执行（零污染纪律：旧写法进程被杀会留 .tmp-test-*.js 于真实仓库 index，并被 doc-tree sync 收进映射键，制造 stale/orphan 假漂移）。 |
| 2.18.3 | 新增 **`scope_check` 工具 + `kind: scope-collision` 审计规则**（拼接产物作用域撞名）。多段 JS 拼进同一作用域（插件分片拼 factory / 多个 `<script>` 引入 / `cat a.js b.js > bundle.js`）时，同帧内 `function`/`const`/`let`/`class` 同名会让后者顶掉前者、或让整份产物在加载时 SyntaxError；纯 `var` 重复按 warning 报（同一声明重复写入，运行时无害），其余按规则严重度走（`severity: error` ⇒ blocker 拦提交）。

判定按**真实作用域帧**而不是缩进/深度：`var`/`function` 绑最近的函数帧，`const`/`let`/`class` 绑当前块帧，`for (…)` 与 `for await (…)` 头部绑该语句的专属帧——兄弟循环里同名合法，不误报（自审计实测：不这样处理会在本仓刷 16 条假 blocker）。

契约与规则分层：命名前缀、顶层零声明、产物文件清单一律从**被审项目自己**的 `package.json` → `dshScopeCheck` 读（`lib/audit/scope-policy.js`），规则 yml 只声明「查不查」。规则包跨仓库共享，把 `dshgp_` 写进 yml 会给所有被审项目刷「缺少 dshgp_ 前缀」；项目没声明时只查同帧重名（通用项）。

入口由注册表单源派生（一条注册表 = 宿主工具 + CLI 同时生效，不碰 HELP/KNOWN_FLAGS/COMMANDS）：`scope_check` 工具 / `git-sluice scope-check`——无参数时读项目 `dshScopeCheck.files`，有违规退出码 1（可直接当门禁）；`scripts/check-js-scope.mjs` 与 `scripts/check.mjs` 的构建期门禁共用同一份判定。审计侧经 `kind → 编译器 → 检查器 → 调度` 常规管线接入，作用域（exts/exclude_paths/file_patterns）由统一补齐继承。

新增 `test/test-scope-collisions.mjs`（23 例：帧判定 / 兄弟 for 循环 / for await / 项目契约三态 / 审计端到端 / 豁免标记生效 / 注册表 / CLI 退出码）。 |
| 2.18.2 | 审计扩展新增两条 DSH 插件 blocker 规则（`scripts/audit-ext/dsh-inject-declarations.mjs`）：`dsh/ctx-service-not-injected`（访问 `ctx.<服务>` 但 `inject` 未声明 —— cordis 直接抛 cannot get property，插件整条不激活，用假 ctx 的单测测不出来）与 `dsh/plugin-default-export-hides-inject`（入口同时有 `export default` 与命名 `inject`/`apply` —— DSH 装载取 `module.default || module`，命名导出全失效）。两条都要跨行读 `export const inject`，纯逐行正则做不到，故用扩展脚本承载；判定口径与 dsh-useful-tools 的 `verify_plugin` 一致（契约 C-114 要求两边同源维护）。规则带两条保守边界：只查插件入口文件（含 `export function apply` 或 `export const inject`）、只报已知 cordis 服务名 —— `ctx` 在真实代码里常是 HTTP 请求对象 / 工具上下文 / 遍历累加器，不收窄会每仓库误报 20 条。实测：违规样例命中 2 处，真实仓库（dsh-useful-tools / dsh-session-conductor）零误报。 |
| 2.18.1 | 修发布前冒烟的选择逻辑（新增 `selectImportSpecs`：按目标扩展名与条件导出挑出真正能被 Node 加载的入口）。实测两次误判：① 包 exports 里登记了 `./cordis.patch.yml`，冒烟对它 import 得到 ERR_UNKNOWN_FILE_EXTENSION，把正常包拦在发布前；② 点出口 `.` 被 continue 跳过，主入口从未被测、门禁形同虚设。现按扩展名与条件导出过滤：非 JS 资源（.yml/.json/.css/图片）不进 import 列表，点出口不再跳过，无 exports 时回退主入口，纯 CLI 包无库入口时跳过不报错；配 6 项断言（资源与浏览器入口过滤 / 无 exports 回退 / 纯 CLI 无库入口 / 条件导出取 import|default / 缺 name 不抛）。 |
| 2.18.0 | 新增 **`npm_unpublish`**（撤包，独立工具）。撤包**不可逆**：同一 `包@版本` 撤掉后永久不能再发，撤掉 `latest` 会让 `npm i <包>` 拿不到东西——所以工具**默认 dryRun**，只做预检并说明后果。

预检项（只查 registry 元数据）：版本是否存在、是否被 dist-tag 指向（撤掉会悬空）、发布距今是否在官方 **72h 窗口**内、是否该包**唯一版本**（撤光会让包名冷却 24h），并按官方政策给出 `policyHint`——超 72h 只有「无依赖者 + 近一周下载<300 + 单一维护者」三者同时满足才允许撤，否则只能 `npm deprecate`。预检**不能**判「有没有别的包依赖它」（公共 registry 无 reverse-deps 接口），这一条由服务端判定，失败时把 npm 的原始报错回传。

真撤需同时传 `dryRun:false` 与 `confirm:true`（与发布同一套双门禁）；整包撤要显式 `wholePackage:true`（加 `--force`）。公开面 19 → 20 个工具（契约测试 / 宿主注册断言 / README 工具表 / SPEC 计数同步）。

新增 `test/test-npm-unpublish.mjs`（7 例：入参校验 / 72h 窗口内外 / dist-tag 警告 / 唯一版本冷却 / 版本不存在 / 包不存在）。 |
| 2.17.0 | 推送后可以**等 CI 结果**（`git_commit_push` 新增 `waitCi` / `ciTimeoutSec`，默认不等）。背景：推送成功只代表代码到了远端；实测一次提交推送成功、CI 在**同一个 SHA** 上挂了（新增的一个测试假设了 CIFS 特性，在 ext4 runner 上必然失败），只看推送回执完全发现不了。

实现（`lib/git/ci.js`）：按 **head_sha** 查 `GET /actions/runs`（不查「最新一次」——并发提交会拿错结果），多 workflow 时**任一失败即 failure**，`neutral`/`skipped` 不算红；刚推上去 run 可能还没创建，给 grace 期（默认 60s）再判定「该提交未触发 CI」；超时单独给 `timeout`（既不判失败也不判通过）。回执带 `ci: {conclusion, runs, failing, url}`，失败时附 `ciFailed: true`、步骤里记 `ci-failure`。

同时修掉 2.16.0 引入的 CI 红：`test-cifs-init` 里断言「降级路径会把 origin 写进 config」，而该路径只在**不支持 chmod** 的文件系统上走（本机 CIFS 成立、GitHub runner 的 ext4 不成立）——已改为与文件系统无关的断言，origin 由 `prepareLocalRepoForRemote` 统一保证。

新增 `test/test-ci-wait.mjs`（8 例：汇总语义 / 按 sha 查询 / pending→success 轮询 / 失败带 URL / 无 CI 不算失败 / 超时 / 缺 owner-repo 不发请求）。 |
| 2.16.1 | 发布前彩排/冒烟改为**按包形态验证**，修掉「纯 CLI 包被误判成坏包」。问题：历史实现一律 `import('<包名>')` 探测公开面，而只有 `bin`、没有 `main`/`exports` 的 CLI 包必然报 `Cannot find package .../index.js`，彩排失败并输出「安装后加载失败」——包本身完全正常（真实用法是 `npx <命令>`），报错还会让调用方以为包坏了。

改法：新增 `classifyPackageForm` 判形态——有库入口（`main`/`exports`）→ 逐个子路径 import；只有 `bin` → **真跑** `node <安装位>/<bin> --version`（断言输出含 package.json 版本）与 `--help`（断言退出码 0）；两者皆无 → 明确报「没有任何可验证入口」，不再含糊地说「加载失败」。`entrySpecsOf` 对无库入口的包返回空数组（此前无条件返回包名）。真跑 bin 还补上了 import 永远测不到的一类故障：bin 判据用字面路径、而 npm 安装的是符号链接，导致执行静默 exit 0、零输出、服务不起。

实测：对真实包 `zipcalm`（bin-only）跑彩排 → 判为 `cli`，publish → install → `bin --version`/`--help` 全通过；新增 `test/test-npm-cli-package.mjs`（5 例：形态判定 / 纯 CLI 彩排通过 / 版本不符被拦 / 无入口报准确错 / entrySpecsOf 语义）。 |
| 2.16.0 | 修复「CIFS/SMB 挂载上建仓后本地不可用」。根因（实测）：smb2 上 `git init` 在写 `.git/config` 时 `chmod config.lock` 失败而**半途退出**，留下没有 HEAD/objects 的残缺 `.git`；老实现只判 `existsSync('.git')` 就去 `git remote add`，于是报「not a git repository」却仍返回成功——用户看到「建仓成功」但本地根本不能用。

改动：①`init-compat` 抽公共入口 `ensureUsableLocalRepo`（已可用=keep / 残缺=repair / 没有=create）与 `isUsableRepo`（用 `rev-parse --show-toplevel` 校验**仓库根就是这个目录**，避免把父仓库误判成自己的，并把 CIFS 降级路径「手写 .git 绕开 chmod」复用到建仓侧——这是 clone 早已在用的同一套）；②`ensureRemoteRepo` 改用该入口，`origin` 设置失败时在回执里给出 `originOk:false` 与 `warning`，不再谎报；③`git_remote_create` 新增 `pushInitial`：本地没有提交时先做一次本地提交（提交身份用 `-c` 传入，**不写 config**，因为写 config 在 CIFS 上必然失败），再走已有的 Git Data API 上传通道（`transport.pushInitialContent` → `pushViaApi`），整条链在 CIFS 上不依赖 `git remote add` / `git config`。

新增 `test/test-cifs-init.mjs`（5 例，临时目录建在**工作区根**即真实 CIFS 挂载上：全新目录可初始化 / 残缺 .git 被修复 / 已可用保持 keep / origin 指向正确 / 本地提交可行）。 |
| 2.15.3 | 本地 registry 接成 `npm_publish` 的选项 `localPreview`（默认关）。开启后发布前会：真实 `npm publish` 到本机 registry → 校验 packument（dist-tags/versions）→ 从该 registry `npm install` → 加载公开面，任一步失败即拦（`blocked: local-preview-failed`），**不写公共 registry**。registry 实现从 `scripts/local-registry.mjs` 提到 `lib/npm/local-registry.js`（脚本退化为 CLI 壳，单一实现），运行期随机生成认证令牌（不在仓库里留任何像凭据的字面量）。与发布前冒烟的分工：冒烟验「包内容」（pack→本地装→import，秒级）；本地彩排验「真实发布/安装语义」（版本冲突 403、dist-tags、exports、依赖解析，分钟级）。新增 `test/test-npm-local-registry.mjs`（6 例协议测试：PUT 201 / 同版本 403 / 多版本叠加与 dist-tags / tarball 字节一致 / 404 / ping）。 |
| 2.15.2 | 新增**本地 npm registry**（`scripts/local-registry.mjs`，零依赖）：把本机当 npm 网站做发布彩排——`npm publish` 到本地（真实 201/版本冲突 403/dist-tags 语义）→ 从本地 `npm install` → 加载公开面，全程不写公共 registry，结束即删临时目录（公网零痕迹）。协议面只实现必要的三条：`PUT /:name`（收 base64 tarball）、`GET /:name`（packument）、`GET /:name/-/:file`（tarball）；未知包**透传公网**（当镜像用），否则安装依赖时会 404。

`node scripts/local-registry.mjs --selftest` 一条命令跑完全链路。实现里两个坑已固化：① 调用方与 registry 同进程时**不能用 spawnSync**（会阻塞事件循环 → npm 等响应、这边等 npm，死锁）；② npm publish 需要 `--userconfig` 指定一份含该 registry 认证令牌的 npmrc（只在环境变量里给令牌，客户端仍报 ENEEDAUTH）。 |
| 2.15.1 | `npm_publish` 增加**发布前冒烟**（默认执行，`skipSmoke:true` 可关）。干跑只回答「哪些文件会进包」，不回答「装上能不能用」——真实踩过的两类问题都在那之后才暴露：①依赖漏声明 / 子路径依赖缺失（`js-yaml`、`tree-sitter-wasms/out/*.wasm`）；②`exports` 收窄后按内部路径 import 会直接 ERR_PACKAGE_PATH_NOT_EXPORTED。现在发布前会：`npm pack` 出真实 tarball → 建干净 consumer 工程 `npm i <tgz>` → 按 `exports` 公开面**逐个 import** → 校验声明的 dependencies 是否真被装进 `node_modules`（只判装没装，不判 bare 名能否解析——像 tree-sitter-wasms 这种 main 未发布、只提供子路径的包会被误判）。失败即拦（`blocked: smoke-failed`）并给出原因，不写 registry。浏览器端入口（`./client`）在 Node 里必然 window is not defined，单独标为 `browserEntries` 跳过而不是判失败。新增 `test/test-npm-smoke.mjs`（5 例：公开面推导 / 浏览器入口识别 / 无 exports 回退），并用「注入一个指向不存在文件的 exports」自证门禁会红。 |
| 2.15.0 | **挂载盘采集提速 + git 钩子探针**（同机会话实测移交驱动）。①**采集改走 git 快路径**：CIFS/SMB 上「231 个文本文件」的 readdir+stat 递归实测 **103.8s**（sys 29s，几乎全耗在跨网 stat），而 `git ls-files --cached --others --exclude-standard` 列 733 个路径只要 **0.046s**。现在 git 仓库里改用 git 自己维护的路径清单，再用同一套过滤（扩展名/1MB 上限/硬跳过目录/测试豁免）筛文本文件，同仓实测 **103.8s → 0.1s**。语义与原遍历对齐：已跟踪 ∪ 未跟踪未被忽略收全，`.gitignore`/`.auditignore` 照旧生效，非 git 目录仍走原遍历；`DSH_AUDIT_NO_GIT_FASTPATH=1` 可强制回退。顺带修掉旧遍历的漏判：文件级 ignore 规则命中时（如 `web-install/install-config.json`）旧路径会误收，新路径正确排除。②**git 钩子探针**：提交与 dryRun 预览的回执里列出「本次会触发哪些钩子」，并识别**坏钩子**（shebang 解释器不存在、或脚本引用了已不存在的机器路径，如迁移前 `/volume13/...`）。只有确认坏掉时才为该次提交注入 `LEFTHOOK=0` 并说明原因——正常钩子（pre-commit 的 lint/格式化）一律照跑，不替用户关。刻意不走 `git config core.hooksPath`：实测 CIFS 上 `.git/config.lock` 的 chmod 会 EPERM。新增 `test/test-audit-fastpath.mjs`（4 例，含与旧遍历逐条等价断言）与 `test/test-git-hooks.mjs`（8 例）。

③**新增 `git_remote_rename`（远程仓库改名）**：`PATCH /repos/{owner}/{repo}` 的 name 字段。改名不可逆，故 **dryRun 默认开**：只报告「当前名 → 新名」、会改哪些本地 remote，并**逐条列出旧名在仓库里出现的位置**（`git grep` 扫全仓，URL 形态与普通文字分开统计，URL 形态优先展示）；真改成功后自动把 origin 等 remote 同步到新地址，任一条更新失败会在回执里点名提示。顺带说明：改名后旧地址只做 301 跳转，npm 包元数据/第三方文档里的地址需自行更新。新增 `test/test-git-rename.mjs`（6 例：参数校验、旧名扫描与 URL 分类、remote 识别，全程不触网）。 |
| 2.14.2 | `mkdir-before-write` 作用域判定修正——外部复测显示 2.14.1 后该规则从 16 涨到 21，实测定位到三处硬伤：①「非函数关键字」的负向前瞻**没有词边界**，`if (!x) {` 会从第二个字符 `f (!x) {` 被当成函数起点、`} catch (e) {` 会从 `atch (e) {` 被匹配，作用域一步错后面全盘错（实测 config.mjs 作用域被算成 82..89，而写语句在 93 行）；②数花括号前未剔除字符串/注释里的括号，配平被 `'{'`、`// }` 带偏；③解构参数 `function f({ a, b }) {` 里的花括号把深度配平到 0，作用域当场结束在本行（实测 writeResult 算成 31..31）。另新增两层：**作用域并入「包含写语句的顶层函数」**（写语句常落在嵌套回调/循环体里，而目录由外层函数建好——实测 diag-upload 的 mkdir 在 128 行、写在 199 行的回调里），以及 **best-effort 写入**（写在 try 里、catch 明确兜底）降级为提示而非警告（样本：LRU 时间戳更新失败不影响功能）。函数起点同时补上 `function*` 与词边界。实测 ModelStage：21 条 → **1 条**，剩余那条的 mkdir 在另一个顶层函数里（跨函数静态证明不了，属合理保留）。新增 5 例（紧邻上一行 / 私有 ensureDir + for 循环体 / try 内 best-effort / 非 best-effort / 不得跨顶层函数借用）。 |
| 2.14.1 | `mkdir-before-write` 大幅降误报（外部会话逐行样本驱动）。旧判定只认 `mkdir(Sync)(` / `ensureDataDir(` 字面量，且作用域窗口仅 20/60 行，于是两类常规写法被误报：①写语句上一行就是 `ensureDir(...)`，而 `ensureDir` 的函数体里有 `mkdirSync`（同模块导出的封装，调用点自然没有字面量）；②目录建在同一函数的更早处（相距 70+ 行）。现在判定按三层：**命名家族**（`mkdir`/`mkdirSync`/`mkdirp`/`mkdtemp`/`ensure*Dir`，含 `recursive: true`）、**一层间接**（本文件内「函数体含 mkdir」的 helper 被调用即视为已建目录，刻意不做跨文件分析）、**整个外层函数体**（按花括号配平取范围，不再用固定窗口）。同时补全函数起点识别：`export function name(...)` 这类形态此前匹配不到，会导致作用域退化成整文件、把「别的函数里的 mkdir」借过来（实测会把真问题洗掉，已用用例锁死）。规则措辞软化：不再断言「写前未建目录」，改为「本函数体内未见建目录调用，若由自定义 helper 或调用方准备请确认后忽略」。实测：ModelStage 反馈的 `src/server/http/atomic-json.mjs` 第 49/75 行现在均判定为已建目录。新增 4 例（封装命名 / 远距离 mkdir / 真无 mkdir 仍报 / 不得跨函数借用）。 |
| 2.14.0 | `.auditignore` 支持**细粒度豁免**：`路径 : 规则[,规则]  # 理由`，只免指定规则、其余照审（支持 `slot/*` 通配）；规则段必须形如 slot/rule，否则整行按文件模式处理（`C:\`、`https://`、`a:b` 不误判）。命中后 finding 标记 `exempted`（**标记而非丢弃**），summary / 维度计数 / 命中文件数 / 规则包统计全部跳过它，报告单列「已确认豁免 N 条（不扣分）」并带理由——解决了「整文件豁免连带把其它问题藏掉」和「分不清已确认豁免与未处理」两个痛点。采集期只把整文件条目喂给 excludesFile，细粒度条目不会让文件整体消失。另修一类纯误报：所有正则规则默认丢弃落在**注释**里的命中（`comment/*`、`documentation/*`、`comment-density`、`no-date-in-comment` 等注释类规则除外）——只剔注释、不剔字符串，避免把 paths/凭据类规则整体废掉；候选行必须传全部行，否则 `isCode` 只对规则自身候选行成立，会把代码里的真实命中误判成注释内（实测硬编码密码 blocker 直接消失，已修复并有回归）。自证：本仓库 `lib/score/index.js` 从整文件豁免改为细粒度后，7 条标记已确认豁免，另 3 条（日期注释 ×2、圈复杂度）重新可见。新增 `test/test-auditignore-rules.mjs`（9 例）。 |
| 2.13.4 | 镜像改**候选清单 + 健康度学习**，终结「单一镜像坏掉就没退路」。背景：旧实现把镜像硬编码成 gh-proxy.com，实测它对一个 8MB 文件返回 total=590454 的截断缓存（真实 8059635），单点故障导致该文件永远拉不完。新增 `lib/core/mirror-candidates.json`（出厂清单，只写优先级，随仓库入库）与 `lib/core/mirror-store.js`（选择 + 学习）：① 选择优先级 = `DSH_GIT_MIRROR_PREFIX` 显式值 > 清单首个未停用 > **全部停用则直连**（宁可不加速也不用已知会返回坏数据的源）；② 停用判据以**数据校验**为准而非 HTTP 状态（坏镜像的特征正是「状态正常、内容不对」）：声明总长不符或 blob sha 不符各记一次失败，连续 3 次停用、一次成功清零；③ 学习结果落 `<配置目录>/mirror-state.json`，与出厂清单分离（不写脏入库文件，部署副本被覆盖也不丢）；④ clone-download 三处埋点（total 不符 / sha 不符 / 成功），并只记**真正经镜像**的请求（api 直连不计）；⑤ **同一文件的救援链扩展到全部可用候选镜像**（当前镜像 → 其它候选 → api 全量兜底）：否则候选清单只影响「选谁」，单个文件撞上某镜像的坏缓存时链里只剩 api 重下、续传能力白费；⑥ 热路径加进程内缓存（5s TTL）+「状态无变化不写盘」，7374 个文件不会触发 7374 次读/写 JSON。

**真实验证**（现场残留分片）：一个 8,059,635 字节的文件，从 6,823,103 字节（84.7%）的断点续传，7 秒完成（只补下 1.24MB），最终 `git hash-object` 与远端 blob sha 完全一致、JSON 可解析（32,400 条记录）、分片目录无残留——证明「换源 + 续传 + 内容校验」这条链路端到端可用。另：`test/run-tests.mjs` 改**分批执行**（默认 40 文件/批，`--batch-size` 可调）——旧实现把 150 个测试文件塞进**一个** `node --test` 子进程，堆跨文件只涨不还，在 8GB 机器（宿主常驻 5GB+）上曾把整机推到 swap 抖动、影响其他会话；分批后每批进程退出即归还堆，且每批加 1GB 堆上限（`DSH_TEST_HEAP_MB` 可调）兜住单文件失控。缓存失效精度同步收紧：从「本轮全剔」改为**只剔失败批次**的文件。新增 `--only=<子串>` 便于单组调试。新增 `test/test-mirror-store.mjs`（14 例：环境变量优先级 / 清单顺序与停用跳过 / 3 次失败停用与一次成功恢复 / 全停用回退直连 / 出厂清单不被写脏 / 探测以内容总长为判据，含注入自证）。 |
| 2.13.3 | 修大仓库克隆「死在同一文件、每轮从 0 重来」（外部会话实测报告登记）。根因（实测取证）：默认镜像 gh-proxy.com 对一个 8MB 文件返回 total=590454 的**截断缓存**——带 Range 续传时每轮「已到该源 total、无法增长」，长度校验永远失败、分片停在半截；且脏前缀一旦拼进分片就永远凑不出正确文件。clone-download 加三重防御：①**声明总量校验**——206 取 content-range 的 /total、200 取 content-length，与仓库记录的 size 不符 ⇒ cancel 响应体、**绝不写入分片**、自动换候选通道 rescue（api 直连优先），全不符则本轮判失败并留证「疑似代理截断缓存」；②**git blob sha 增量校验**——流式 update（header 为 git object 头「blob 空格 size 空格 NUL」按 latin1 单字节，+ 已有分片前缀 + 新字节），与 tree 记录的 sha 比对：长度对但内容错（镜像旧缓存）也当场**废弃分片**，下轮从 0 走 api 直连自愈（分片文件名即 sha，换通道后天然落在干净的新分片上）；③失败保留分片的既有语义不变。新增 `test/test-clone-mirror-truncation.mjs` 4 例（脏半截 rescue 成功且内容全来自 api、无分片起步、全通道异常报错留证不污染分片、正常 206 续传不受影响），桩用真实 git blob 哈希自洽；注入自证（关掉 total 校验 → 2 条转红）。顺带修既有测试两处桩缺陷：两个文件共用同一内容 ⇒ 同一 sha ⇒ `.part` 文件名撞车（全成功清理用例假失败）；预置分片写在不匹配的文件名上。 |
| 2.13.2 | 动态权重分母改按**该维度可作用文件数**（口径 A）：总文件数里混着大量数据资产——实测某资源仓库进入审计管道的文件里清单 json 占比极高，可读性规则声明 `exts=js/mjs/ts…` 却按总文件数摊薄权重 ⇒ 代码问题被数据文件数量稀释（json 越多分越好看，口径失真）。新增 `computeDimFileCounts`（编排层按规则 exts 声明统计每维度分母，取扩展名与 `filterRulesByExt` 同一条 basename 口径）；`scoreQuality` 的 context 新增 `dimFileCounts`，优先用维度分母、缺该维度或未提供时回退总文件数（旧调用方行为逐位不变）；audit-api / tool-call / CLI / history 四条调用链全部传入。**未声明 exts 的规则按代码文件（CODE_EXTS）计**——这批规则（复杂度、变量名、魔法数、eval、secret 扫描等）实际只会作用代码文件，不限扩展名只是没声明，不该反过来让 json 数量撑满分母。修复两处自证发现的口径 bug：①未声明规则误按全部文件计（分母虚高）；②同一文件对同一维度双重 +1（实测可读性分母 741 > 总文件数 374）。新增 `test/test-dim-denominator.mjs`（8 例：exts 匹配 / 代码文件口径 / 并集去重 / 带点目录取 ext / 同 id 去重 / dimFileCounts 生效与回退 / 权重上限，含注入自证）；ModelStage 端到端实测：分母 374→可读性 367/可维护性 297（≤总数 ✓ 无双重计数），79.832 B → 78.029 B（惩罚回归真实）。 |
| 2.13.1 | 修大仓库克隆永远拉不完的根因：`runGit` 是 execFileSync + 死超时（默认 120s），而 6.9GB / 7374 文件的仓库 `git fetch` 要跑十几分钟、期间一直在正常下载（`--progress` 持续刷百分比），固定超时必然半途而废（报 `spawnSync git ETIMEDOUT`）。新增 `runGitStream`：spawn + 流式读 stderr，**按「无进展」判停摆**——只要有输出就把看门狗往后推，连续 `stallLimit` 完全无输出才结束进程（SIGTERM → 3s → SIGKILL），**没有总时长上限**；与 `runGit` 同前置参数（GIT_GLOBAL_ARGS）、同镜像注入、同 `DSH_GIT_ENFORCE_PASS` 门禁，返回 `{ ok, stdout, stderr, stalled, ms }`。停摆阈值优先级：显式传参 > 环境变量 `DSH_GIT_FETCH_STALL_MS` > 默认 300s（现场可放宽，无需改代码重发版）；停摆时按**进程组**结束（`detached` + `process.kill(-pid)`），避免 git 派生的传输子进程残留把下载拖在后台。`clone-history-mode` 的 fetch 改用 `runGitStream` 并加 `--progress`，steps 记录 `ms` / `stalled` / `lastProgress`；失败文案区分停摆（「可重试续传，已下载部分不丢」，消费方自带兜底并去重）与真失败（仓库/网络错误不报成停摆）。另加固两点：①进度回调抛错不再变成 data 事件的未捕获异常（常驻宿主进程不会被一个进度回调带走）；②修 `git_clone` 的 history 描述漂移——description 写「默认关」，而三条入口（工具/HTTP/CLI）实际 `default: true`，底层 `cloneViaApi({history})` 保持 false，现描述已与实现一致。新增 `test/test-git-stream.mjs`（9 例：正常命令 / 真失败不误判停摆 / 回调抛错不影响执行 / 进度回调收到输出 / 环境变量阈值 / 停摆文案与 steps 标记 / 真失败文案 / 上游无文案时兜底续传提示 + 成功路径，并做注入自证：去掉 stalled 分流会转红 2 条）。 |
| 2.13.0 | 质量评分引入**动态权重**：实际权重 = 设定权重 × 动态权重，动态权重 = 命中文件数 ÷ 扫描文件数（按 file 去重，衡量问题覆盖面而非问题条数——条数已由对数衰减承担）。三条口径缺一不可：①**无命中的维度不缩放**（用设定权重）——否则满分维度被自己的 0 权重拖成 0 分；②**分母用 Σ实际权重**——否则全绿时有效权重全为 0、满分被算成 0 分；③**文档维度也参与**，其命中文件数取 docsScore.files ÷ 总文件数（文档是加分制，没有「命中问题的文件」概念），无文档文件信息时回退不缩放。不设下限，完全按覆盖面比例。效果：同一处问题只在少数文件出现时扣分轻，铺满全仓时动态权重=1 退化为纯静态口径、与历史分数逐位一致；不传 files 的旧调用方全部不缩放（向后兼容）。新增 countHitFilesByDimension + scoreQuality 返回 dynamicWeights（便于观察实际权重）+ test/test-dynamic-weight.mjs（13 例，覆盖三条口径、单调性、向后兼容、文档维度、去重与空目录，并做两处注入自证确认会变红）；评分口径写入 docs/SPEC.md 的「审计规则体系」条目（README 维持使用手册定位：机制与公式一律只进 docs，不在 README 展开）。 |
| 2.12.3 | M4 移除 vendored 包袱：删除 assets/tree-sitter（3.7MB，含 runtime js+wasm 与 3 个语法）与 lib/vendor/js-yaml（108KB），运行时统一走 npm 依赖；配套删掉已成死代码的迁移期兜底、把「vendored 运行时已落库」断言改为「npm 包可解析且版本锁定 0.25.10」、订正三处指向已删路径的注释与 .auditignore 条目。发布体积 1.4MB/6.5MB/291 → 911.4kB/2.6MB/281。 |
| 2.12.2 | M3：新建 audit-rules-csharp.yml，按实证口径收 3 条 C# 规则（throw-ex 4/4、generic-exception 38→37、lock-on-self-or-type 2/2，全走 astConfirm+astConfirmSpan 列级精筛）；评估后不收 11 项并记入文档（含第一版误收又撤回的 GC.Collect）。语料 findings 453→496、blocker 不变。另修文档计数口径：澄清 168 条为声明数、默认实际加载 164 条（i18n 槽位 disabled、template 槽位需显式开启）。 |
| 2.12.1 | 修 C# 插值串被当硬编码文本（M3 前置阻塞）：tokenizer 识别 $\"…\" / $@\"…\" / @$\"…\" 为插值串、产出 tmpl（与 JS 模板串同口径），洞内按花括号深度判定并跳过嵌套字符串，避免在洞内引号处截断；@\"…\"（verbatim 不插值）仍为 str 照常统计。实测 C# 语料 no-repeated-hardcoded-literals 41→31（少掉的 10 条全是插值表达式，如 {musicId}.csv、<error: {ex.Message}>），4 条纯字面量真命中（Change Joint Limits / Open File / Position Weight / Mouse X）仍报；本仓库自身审计 889 条与改前完全一致（JS 侧零回归）。新增 test-repeated-strings-cs.mjs（5 例，回退 tokenizer 即 3 红）。 |
| 2.12.0 | M2 接通 10 语言 AST：EXT_TO_GRAMMAR 补 cs→c_sharp / c / cpp 族 / go / java / kt→kotlin / php / rs / swift（.h 归 cpp，因 C 是 C++ 子集、交 c 语法解析合法 C++ 头会出 ERROR 使整树作废）；TEXT_EXT 补 cs/cc/cxx/hh/hxx/mts/cts；CODE_EXTS 补 c/cpp 族与 cs/phtml（此前这些扩展名在收集白名单里却不在 CODE_EXTS ⇒ semantic 类检查整体跳过，等于把 C/C++ 当文档审，属既有缺口）。新增 test/test-treesitter-grammars.mjs：多语言真机解析自检（0 ERROR 节点）+ 永久门禁「EXT_TO_GRAMMAR 每键必在 TEXT_EXT」（反向不设，已自证删 cs 即红）。实测：C# 语料 files 26→694、findings 8→463、blocker 增量 0、分析覆盖率 0%→2.9%；本仓库开/关新扩展名两次全量均 889 条、按规则增量为空（自家无 C 系文件，补齐零噪声）。M3 前置阻塞已记：no-repeated-hardcoded-literals 在 C# 插值字符串稳定误报 10/41。 |
| 2.11.1 | 修依赖切换后的两处加载缺陷：①runtime 在 vendored/env 覆盖布局下仍走裸 specifier，导致「只拷插件目录未装 dependencies」的部署端语法读得到、runtime 拿不到、AST 整条失效——改为按目录分流（目录内有 tree-sitter.js 就按文件路径加载，否则走 npm）；②补迁移期兜底：npm 包缺失时回落到仓库内仍保留的 vendored 资产，避免代码已切源而依赖未装的窗口期 AST 直接失效（M4 删包袱后自然收敛到依赖）。实测两种布局均可解析。 |
| 2.11.0 | 弃零依赖：tree-sitter 与 js-yaml 改 npm 依赖（精确锁版 web-tree-sitter 0.25.10 / tree-sitter-wasms 0.1.13 / js-yaml 4.1.0；实测 0.27.1 与本套语法 ABI 不兼容）。AST 加载改用 import.meta.resolve 定位包目录，保留 env 覆盖与「取不到即回退」。下线两个作废功能：README 模板生成（readme-gen）与措辞清洗脚本（scrub-user-wording），数据表与专测一并移除；仍被 doc-version 门禁使用的版本源探测与版本表聚合拆到 scripts/version-source.mjs。实测：9 语言语法 ABI 自检 0 ERROR。 |
| 2.10.5 | 隐私/凭据类规则只对自有仓库生效（他人仓库等同关闭）：克隆的第三方仓库里第三方 LICENSE/ReadMe 的作者邮箱不再成片报 blocker（实测某 Unity 项目 3 条 blocker 全由此而来）；判不出归属时照旧生效（保守）。归属探测放装配层 lib/app/repo-ownership.js（依赖 git 层），审计层 lib/audit/ownership.js 只留纯函数并消费注入的归属字符串，守住『lib/audit 不依赖 lib/git』边界；CLI 与插件工具同参注入，保证两边结果一致。新增 scripts/bump-version.mjs：一键升版（默认 dry-run、--apply 才写盘），把散在三处的版本号收口，并自动重生成派生文档。另含 2.10.4 的 CIFS 克隆修复。 |
| 2.10.4 | 修掉「克隆到 CIFS/SMB 挂载失败」。根因：git init 末尾要把探测到的 core.filemode 写入 .git/config，写 config 走 config.lock→chmod→rename，而挂载带 nounix 时 chmod 恒 EPERM ⇒ git 直接 fatal，目标目录只留下未初始化的空 .git，整个克隆失败。新增 lib/git/init-compat.js：①fsSupportsChmod 真去 chmod 一个临时文件探测能力（比看 mount 类型可靠）；②不支持时 writeMinimalGitDir 手工搭最小 .git 结构——HEAD + config[filemode=false] + 空 objects/refs/info，且 remote 段一并手写（git remote add 同样要写 config，一样会失败）；③initRepoCompat 统一入口，并做 rev-parse --git-dir 自检，结构搭不好就显式失败，杜绝「以为成功其实是空壳」。三处 init 调用点（clone.js / clone-history-mode.js / clone-replay-io.js）统一改走该兼容层，deps 可注入 chmodOk 便于测试固定分支。新增 test/test-init-compat.mjs（6 例）：两条分支分开走、降级结构必须是真仓库（add/commit/log/status/remote 全通）、未给 remoteUrl 不写 remote 段、自检失败必须 ok:false；已自证（强制走标准 init ⇒ 降级两例转红）。实测：katboi01/UmaViewer（157MB / 2257 文件）经插件成功克隆到 CIFS 挂载 /volume1/Download/GIT，HEAD 07f82e9 与远端一致、脏文件 0、origin 正确、core.filemode=false。全量 1335 项 0 失败。 |
| 2.10.3 | 补上忽略链路（.gitignore / .auditignore）的端到端回归。排查结论：**当前忽略规则没有失效**（full / diff / 非 git 三种链路实测都正确排除，对照组 keep.js 照常被拦）。但发现测试缺口：此前 7 个忽略相关用例**全部只测 collectTextFiles 内部函数**，而历史上三次回归都发生在接线层——①1.0.4 以空 stdin 调 check-ignore（忽略集恒空）；②大仓库降级把全量枚举改成目录级判定、漏了文件级兜底；③调用方漏传 gitIgnoreRoot（默认 null 等于显式关掉忽略）。这三类内部函数测试天然失明，所以反复回归。新增 test/test-ignore-e2e.mjs：从真实入口（auditFull / runAudit）跑，三条链路各一例（full 走 gitIgnoreRoot、diff 走 collectChangedFiles 独立路径、非 git 目录靠 parseGitignore 纯 JS 兜底），并带**对照组断言**（该被审的必须被审到，否则「全体被排除」会让测试假通过）。样本入库为 test/fixtures/ignore-e2e/（用 .js.fixture / .rules 后缀，避免同目录 .gitignore 让样本自身无法入库）。已自证有效：把 gitIgnoreRoot 强制改 null ⇒ 两条用例转红。guide-audit 增 §15 记录该纪律，含「直接调 collectTextFiles 传 repoPath 而非 gitIgnoreRoot 会造出忽略全失效的假象」这条排查坑。实测：全量 1329 项 0 失败。 |
| 2.10.2 | 架构决策落地并钉成门禁：审计引擎与提交推送**保持单包**（评估过拆出 dsh-audit-core——使用者要的是「提交前拦截」这个整体，而「脱离 DSH 跑审计」已由 cli.mjs 的 git-sluice 覆盖；双包的代价却是持续的：版本互相同步、发布顺序固定、依赖范围约束，同类 monorepo 双包仓库刚把这些成本落地成真实 bug）。但不拆 ≠ 不设界：实测审计层对 git 层是 **0 依赖**，据此在 scripts/check.mjs 新增两条门禁——①审计层任何文件 import git/npm/commit-push 即失败；②反向接缝（提交门禁调审计的 7 处必需耦合）超过预算 7 即失败。两项均已自证（注入违规、调低预算都会变红）而非摆设。lib/ARCHITECTURE.md 新增章节记录决策依据、7 处接缝清单与维护约定：审计层需要 git 能力时走文件内轻量 execFileSync，不得 import lib/git。 |
| 2.10.1 | 按插件架构修订审计规则（外部项目实测反馈；只改判定逻辑，不以豁免代偿）：①button-bind 按元素类型分流——button 要求 click 类绑定；input 接受 change/input/submit/pointerdown 等表单控件标准事件；<input type=file> 由原生 label.click 触发、存在程序化触发即视为已接好（实测三处文件选择框不再误报）；自定义分片目录降级 info（标准 client-parts 由 exclude_dirs 跳过，完整判定交产物）。②函数范围识别补齐箭头函数/方法简写/async 体：此前只认 function 关键字，maxFunctionLength 对纯箭头文件返回 0，导致 max-file-length 把「60 个 rec(...) 用例」的聚合型测试文件判成臃肿型、文案「最大函数 0 行（臃肿型：文件大因藏着超大函数）」自相矛盾且 scoreImpact=2；现在该形态为 info/0，无函数时文案改为「顶层语句堆叠」。同时修掉箭头长函数的漏报。③button-bind 补进 dsh-skip-quality.blocked——此前该 kind 不在任何标记里，而规则 exemptHint 指向它，用户按提示写标记完全不生效。④新增 test-button-bind-events.mjs（7 例，含四条边界与门禁自证）、skills/guide/guide-audit.md 增 §14（插件架构适配表 + 性价比取舍 + 「grep 判定引用要 -i，但规则内标识符匹配必须大小写敏感」）。实测：全量 1326 项 0 失败。 |
| 2.10.0 | ①仓库索引改 JSONL 存储：文件名 dsh-repo-index.jsonl，每行一个独立 JSON 对象（_t=meta/repo/localOnly/recovery）。动机：流式读写（逐行生成/解析，不必整份 stringify/parse）、损坏容错（单行坏只跳过该行并记 _skippedLines，不像整份 JSON 一处截断就全废）、可增量（单仓远端状态只关心自己那行）。旧的 dsh-repo-index.json 只读兼容，首次写入自动移入同级 .trash（可恢复）避免两份同源索引并存；解析出的对象形状与旧格式完全一致，前端与其它读取方零改动。②修本地仓库列表「❌ 读取失败: signal timed out」：applyLiveRemote 的预算判据把绝对时间戳 deadline 又加了一次起点（now > probeStart + deadline），判据恒为 false ⇒ 15s 预算从未生效，26 个仓库串完 SSH 探测后突破前端 30s fetch 超时。改为 isProbeOverBudget(deadline) 直比当前时间，超预算仓库标 liveSkipped（下次刷新补）。新增 test-index-jsonl.mjs（8 例：往返保真/坏行容错/旧格式兼容/迁移）与 test-repos-live-budget.mjs（4 例：预算语义/禁回退判据/预算<前端超时），两者均含门禁自证。实测：真实索引迁移为 .jsonl（31 行，26 仓）并被 readRepoIndexMap 正确读出；端点耗时 16.3s 内、3 仓按预算跳过；全量回归 0 失败。 |
| 2.9.12 | 修目录选择器「条目多时行被压扁」的真正根因：.browselist 是纵向 flex 容器，.browsedir 作为 flex 子项默认 flex-shrink:1，而行上为省略号截断写了 overflow:hidden——这会让子项的 automatic minimum size 归零，于是条目超出容器时行被无限压扁、容器根本不滚动。实测（真实渲染，73 条 / 1080px 视口）：行高从应有的 27px 被压到 10px，文字几乎不可读，正是「列表内容非常多时才积压」的现象。修法：.dshgp_browsedir 加 flex:0 0 auto 禁止收缩，溢出交给容器的 overflow-y:auto 滚动。2.9.11 的 min-height:0 只解决了容器被内容顶破，没解决子项收缩，因此单独发版。另新增 scripts/picker-repro.mjs（从真实 const.js 抽取 CSS 生成最小复现页 + 内置测量脚本），使布局类缺陷可脱离宿主快速自检；test-picker-layout 新增 flex:0 0 auto 门禁（回退该项即转红）。实测：全量 1307 项 0 失败。 |
| 2.9.11 | ①修目录选择器被撑穿：flex 子项默认 min-height:auto 会把 max-height 顶破，目录条目多时列表溢出屏幕、底部「选择当前目录」被挤出视口；显式 min-height:0 让封顶生效，另配 overscroll-behavior:contain 防滚动链穿透、面包屑单行省略号（长路径不再挤占高度 + title 看全量）、单层条数上限 200（防 node_modules 类深目录卡死）、目录名补 > 转义。新增 test/test-picker-layout.mjs（7 条，含「把 min-height 改回旧值即转红」的门禁自证）。②client-parts 14 个分片去掉数字序号（00-loader.js → loader.js）：序号前缀会漂移，顺序唯一权威收敛到 scripts/build-client.mjs 的 PART_ORDER + 每片头「第 N/14 片」锚点；产物 lib/client.js 逐字节等价；新增 2 条门禁（禁序号文件名 / 每片必须有锚点）。③清理 4 处交流残留措辞（git mv 使分片以新增身份进 diff 审计，历史遗留被扫出）；npm.js 的 151 行自包含组件加 dsh-skip-func-length 豁免（拆分会动 hook 顺序）。实测：全量 1306 项 0 失败；diff 审计 blocker 7 → 0。 |
| 2.9.10 | npm_publish 成功判定改为「上传成功即成功」：以 npm publish 返回码为准，不再把 registry 可见性当成败（发布后可见延迟几分钟是已知现象）。可见性降级为附加信息（visible / visibleNote）；新增可选 waitVisible（默认 false；true 时每分钟查一次、最多 5 分钟，等待可见性仅作确认）。job 完成文案同步改写。实测：test-npm-publish 8/8。 |
| 2.9.9 | npm_publish 真发后轮询 registry 确认版本可见：每分钟 1 次、最多 5 分钟；远端更新即返回（verified=true），超时输出原结果（verified=false + pollTimeout + pollNote，结果以 npm 返回为准），轮询过程写 npm-publish.log。dryRun 不触发轮询。实测：test-npm-publish 8/8。 |
| 2.9.8 | ①git_commit_push 支持 remote 参数（多 remote / fork 场景）：推送与核验使用同一 remote，修复「origin=上游无写权限 → 推失败 + 核验拿到上游 SHA 误报未落地」；新增 resolveRemoteTarget 解析指定 remote。②新增 exempt 注释豁免工具（add/remove/list/check）：按 rule 自动选标记（写错拒绝并给正确标记）、写前校验（块注释/字符串/越界拒绝）、多文件原子、check 识别死标记；标记映射读同进程 EXEMPT_MARKERS（单一真源）。实测：test-multi-remote 3/3、test-exempt-tool 6/6；1293 项回归 0 失败。 |
| 2.9.7 | 提交时按文件临时豁免（auditExemptPaths/auditExemptReason，含 blocker、不落盘、结果回显 files/count/rules）+ 只读端点 GET /api/git-push/exempt-hint（按 rule/kind 反查可用豁免标记，供外部工具避免复制注册表）；规则误报修复：max-nesting-depth 归属改用 function 栈（模块级嵌套不再归到已结束的旧函数）、no-repeated-hardcoded-literals 跳过模板字符串（生成代码排版不再算重复字面量）。实测：dsh-useful-tools 误报 33→31（模板串 2 条消失、归属修正）；1284 项回归 0 失败。 |
| 2.9.6 | 私有库统一前置判断：可见性（GitHub API）决定走不走 gh-proxy 镜像——克隆/真实历史 fetch、ls-remote 探针、推送核验三处共用 accessPlan；私有或未知一律不走镜像（改 SSH 形态 ssh.github.com:443）。修复「私有库经镜像必然 404/认证失败」导致的克隆失败、探针失明、核验未完成三类同源问题。实测：私有库克隆改用 SSH 后成功拿到 10 条真实历史；探针 ok=true（via id_rsa）；推送核验一致。 |
| 2.9.5 | 修复推送后远端核验的两处失明：① 核验用 token 增加插件凭据兜底——pushViaSsh 成功时 pr.token 为空，原先以空 token 请求 API ⇒ 401/404 ⇒ 明明推成功却报「未能核验远端」；② ls-remote 探针增加 SSH 通道（与推送同源），origin 是 https 且本机 https 不通时不再永久「失明」。实测：探针 ok=true（via id_rsa）、API 200、远端 SHA 与本地一致。 |
| 2.9.4 | 修「文件头豁免提示的标记写了不生效」（全量自证实测 24 种组合：按 finding 提示写了文件头标记仍然照报）。根因是提示与判定两处表达脱节 + 注册表本身缺 kind：exemptHint 是各检查器写死的字符串，而能否生效取决于豁免注册表的 blocked 清单。修法：① lib/exempt/index.js 抽出**唯一判定口径** markerCovers，exemptForFinding 与新增的反查 exemptHintForFinding / exemptMarkerCovers 三者共用；② 补齐注册表缺口——dsh-skip-quality 增加 semantic / dataflow / duplicate-const / repeated-string 与「非安全类 regex」兜底（安全类由 excludeRules 排除，安全 finding 仍必须写 dsh-skip-sensitive，不许被质量标记顺手静默），dsh-skip-style 的 blocked 补 min-length / max-lines / max-complexity / max-depth / repeated-string（其 styleRules 与文档表本就列了这些），dsh-skip-sensitive 补 semantic（security/* 语义类此前无任何标记可豁免）；③ lib/audit/finding.js 新增 normalizeExemptHints，在**全部 finding 产出之后**（tree-doc/func-doc/split-docs/ignore/ext 五处追加都在其后）把提示校正为「真能豁免它的标记」：原提示有效则保留、无效则换真标记、都没有则如实说明；④ lib/checks/regex.js 的兜底提示不再写死 dsh-skip-residue（residue 只覆盖 debugger/todo/console/io-risk 窄集合）。结果：写了不生效的组合 24 → 0；新增 test/test-exempt-hint-effective.mjs（4 例：24 种组合矩阵反查必真豁免 / 安全类不被质量标记吞掉 / 校正幂等 / 端到端全条校验）把这条不变量钉成机器门禁 |
| 2.9.3 | FS 热点静态扫描并入审计（由 bench-template 的 scan-fs-hotspots 交接而来）：判据②并入 performance/repeat-identical-call —— 作用域从「同一循环体」扩到「循环体 ∪ 同一函数体」，并新增 fs 属性类收窄白名单（stat/lstat/readdir/exists/access/realpath 及 Sync 变体）与第三方资产排除（assets/vendor/third_party/dist/build）⇒ 同一函数内重复 statSync 同一表达式必报（实测自身仓库 57 处命中里 37 处来自第三方资产，故排除）；新增**仓库级**规则 performance/multi-file-scanners（notice · 默认开 · 阈值 min_occurrences=3）：全仓「同一函数内既有 readdir 又有 stat」的逐文件扫描实现超阈值即报一条并列出各实现位置（实测某对照仓 48 文件里 9 处各自遍历，扫描实现数与交接基线一致）；新增判据单一实现 lib/ast/fs-hotspots.js（审计规则与 CLI 共用，防两处漂移）+ 独立 CLI scripts/scan-fs-hotspots.mjs（①stat 热点排序 ④遍历入口 + ②③⑤ 明细，--json/--top/--include/--exclude/--include-tests，恒退出码 0）。修两个自造 bug：抽取器先整文件再逐函数各收一遍导致**双重计数**（CLI 统计虚高近一倍）；新规则的 kind 未在 RULE_COMPILERS 登记被**静默丢弃**（规则整条不生效）。已知边界：遍历入口识别只覆盖 function 声明与箭头常量，对象方法/类方法暂不识别；WALKERS 仍是名字白名单 |
| 2.9.2 | 版本表改为**文件驱动（不读 git log）**：scripts/readme-gen.mjs 的 buildReadmeVersionTable 不再从提交标题聚合，改为 docs/releases.json（每版一行说明）+ 版本真源文件（package.json 等）+ version-metrics.json；版本源探测统一迁入 readme-gen 并由 doc-version 再导出。为什么：行内容原先取自 git log 提交标题 ⇒ 任何不带版本号的普通提交都会改动「最新行」⇒ 版本表门禁报漂移 ⇒ 逼着「为门禁升版本」（把版本号变成讨好门禁的产物）。改为文件驱动后普通提交完全不动表。另：补齐 5 个占位语言规则包首版真规则（go/rust/cpp/php/swift 共 26 条，选型依据对真实样本仓的模式出现次数实测）+ 修 lib/audit/collector.js 的 TEXT_EXT（缺 php/phtml/swift/kt ⇒ 这两个语言的文件从未进过审计管道、规则永不命中）+ 加 astConfirm 防注释误报（rust/unimplemented-macro 16→2、cpp/raw-new 与 php/error-suppression 的注释误报清零） |
| 2.9.1 | AI 自设工作区路径（数组 + API）：新增 lib/core/workspace-paths.js（状态 <配置目录>/workspace-paths.json，校验绝对路径/必须存在且为目录/去重/上限 20，原子写入）+ 端点 GET/POST /api/git-push/workspace-paths（set/add/remove/clear）；环境注入**优先显示自设清单**（多路径逐条 + 修改入口），会话 cwd 降级标注为「仅兜底，可能陈旧」、注入缓存键带上自设清单。修 lib/app/http-handlers.js 的 readBody：原实现只接受对象，而工具/CLI 内部调用传 JSON **字符串** ⇒ body 被静默丢成 {} ⇒ **所有 POST 端点经工具/CLI 都收不到参数**（浏览器路径正常 ⇒ 两条路径行为分叉）。副本漂移检查补「文件清单」维度（只比 lib/、assets/、package.json、cordis.patch.yml）：硬链接孪生下新建文件只落一边 ⇒ 插件整体 failed to import，此前完全查不出。新增 test/test-workspace-paths.mjs（8 例，含 handleHttp 字符串 body 回归） |
| 2.9.0 | 审计引擎接入 tree-sitter（方案 C 阶段 2，**语法树优先、token 级回退**）：新增 lib/ast/treesitter.js（懒加载 WASM 运行时与语法、按扩展名映射、内容 hash 缓存语法树、descendantForPosition + 祖先链判定「命中处是否不透明构造」、任何失败返回 used:false 由调用方回退）；编排层（async）预解析后把**同步**确认函数传入检查器（lib/audit/orchestrate.js → audit-file.js → checks/dispatch.js → checks/regex.js），只在「扩展名有语法 + 本文件规则集确实声明 astConfirmSpan」时解析；assets/tree-sitter/ 落库运行时与 javascript/typescript/python 三语法（**运行时钉 0.25.10**——实测 0.27.1 与 tree-sitter-wasms@0.1.13 的语法在 getDylinkMetadata 处不兼容，0.26.0 同样失败；且 Language.load 必须传字节，传路径会静默失败）；assets 已入 package.json files 白名单；新增 test/test-treesitter.mjs 三断言（加载器 / 端到端双向 / **判别用例**：正则字面量里的 while(true) 有资产时不报、无资产时报回来 ⇒ 同时证明语法路径在跑与回退生效）。体积：assets 3.7MB，整包由约 950KB 增至约 4.4MB |
| 2.8.9 | 审计精筛升级为**列级**（方案 A，为后续 tree-sitter 接入打底）：tokenizer 的 token 新增 col（1-based 列）；lib/ast/code-lines.js 新增 makeCodeSpanFilter（在行级判定之上，用 str/tmpl/comment token 构造不透明区间，isCodeHit(line,col) 判「命中那一处是不是代码」）并由 ast/index.js 导出；lib/checks/regex.js 报命中时改用 exec 取列，按**规则 opt-in 的新字段 astConfirmSpan** 做列级过滤，且绝不覆盖具名精筛（astConfirmKind: allow）——performance/memory-bomb 与 performance/busy-wait-loop 开启它，消除「字符串字面量里的 while(true)」误报。踩坑记录：把列级判定无条件挂到 astConfirm 上会让 paths/hardcoded-absolute-path 的 findings 从 5 条掉到 0 条（硬编码绝对路径本来就写在字符串里 ✗）——这正是必须 opt-in 的原因。新增 test/test-ast-confirm-span.mjs（列级单测 + 端到端双向：字符串内不报、真实空体死循环仍报） |
| 2.8.8 | 修 2.8.7 引入的误报：node_modules 副本的判定从「是不是真实目录」改为「内容是否漂移」——pnpm 的 file: 目录依赖落在 node_modules 时实测是与真源**同 inode 的硬链接副本**（stat 同 inode、链接数 2，内容即真源本身），属正常安装产物，旧判据会误报；现只在副本与真源内容不一致（package.json / lib/self/index.js / lib/app/command-registry.js 任一不同）时输出 nm-drift（只报告不动盘）。另记录事故机理：profile 的 pnpm-lock.yaml 把 dsh-git-push 钉在旧 GitHub tarball（f61ecbc5，远早于 2.8.0），与 package.json 的 file:local-plugins 声明不一致 ⇒ 任何一次非 frozen 安装都会把旧版落成 node_modules 真实目录顶掉真源（实测宿主 git_api status 报 2.6.9、npm_publish 等新工具整批消失）；已按 DSH 自带安装流程把 lockfile 对齐为 file:local-plugins，frozen 复跑通过 |
| 2.8.7 | 安装位置只认 local-plugins：同步脚本不再建/改 node_modules 软链——真源 = local-plugins 真实目录，node_modules 入口由 DSH/pnpm 安装流程按 profile 的 file:local-plugins 声明生成；新增「node_modules 下残留真实目录副本」报警（实测事故：旧副本 2.6.9 顶掉 2.8.6，宿主 git_api status 报 2.6.9、npm_publish 等新工具整批消失）；--fix 只修 local-plugins 侧形态（解软链 / 建真实目录），node_modules 相关只报告不动盘 |
| 2.8.6 | CPU 现场采样脚本（scripts/cpu-sample.mjs：零依赖只读 /proc，按 --seconds/--interval 采样，记录系统 CPU% 与每进程占整机百分比、命令行、常驻内存、chrome/browsersvc 数量、宿主进程占用；输出控制台逐样本 + JSONL 明细 + 结束汇总）；审计性能规则误报修复（performance/memory-bomb 与 performance/busy-wait-loop 声明 astConfirm，命中行再经 token 级确认真在代码里，消除注释行误报——第三方插件副本实测 569→567 条）；规则注释写明已知边界（匹配落在字符串字面量内仍会报，影响面仅测试脚本 1 处，评估后不修） |
| 2.8.5 | 修 npm 发包跑错目录：runNpm 未传 cwd ⇒ npm pack / npm publish 执行在**宿主进程的工作目录**（本机为 DSH 安装目录 /volume1/@appstore/DeepSeekHarness-NAS），而不是 dir 指定的目标包目录。该目录有 package.json ⇒ npm 去打包整棵 DSH 树、输出 2,101,740 字节（2.1MB）超过 spawnSync 默认 maxBuffer（1MB）⇒ ENOBUFS，npm_publish 的体检与真发全部失败（该目录无 package.json 时则报 ENOENT）。现 publish 的 packDryRun 与 publish 两个调用点显式传 cwd=目标包目录，并给 runNpm 加 16MB maxBuffer。实测：修复后 dsh-session-conductor@1.0.10 成功发布到 npm，registry 上的 shasum 与本地打包逐字节一致。 |
| 2.8.4 | 推送失败封装（新增 lib/git/push-diagnose.js）：把「原文事实」与「推断」分开——GitHub 对「仓库不存在」与「凭据无访问权限」故意返回同一句 Repository not found，该分类只输出「不存在或无权限，二者不可区分」并把置信度降为 low，禁止断言「仓库不存在」；pushViaSsh 与 push.js 的失败回执都带 diagnosis（分类 + 置信度 + 可执行下一步），工具回执按「事实 + 分类 + 下一步」渲染。推送后核验补齐证据标准：ls-remote 探针改三态 {ok, sha}，仅「探针成功返回为空」或「取到具体 sha 且 ≠ 本次推送」才判未落地，探针失明（无凭据/网络/权限）时返回 verified:null（未核验，回执写明「未核验 ≠ 失败」，不再输出无证据的「远端可能是空仓库」）。提交信息数组化（新增 lib/git/commit-message.js）：message 支持字符串（原样透传，向后兼容）/ 数组（元素为字符串或 {what,type?,scope?,why?,verify?,refs?} 混用）/ {subject?,items:[...]}，仅 what 必填，缺 what 的条目被忽略而不臆造内容；commitAndPush 在预检处单点组装，工具 schema 以 anyOf 暴露 string | array | object 三种形态（type 仍为 string，不影响 CLI/HTTP 解析层）。 |
| 2.8.3 | 文案修正：把「零改动 / 无新提交」明确写成**正常成功路径**（不会报错、返回 ok:true + committed:false 或 pushed:false、本地领先远端的提交照样会推），覆盖 AI 注入用法、git_commit_push 工具描述、README（补「零改动也安全」能力行与常见误解提示）、提交推送指南与开发文档；并修 job 输出自相矛盾——cleanSkipCommit 路径此前缺 committed 字段，导致「已提交，未推送」的误导文案（现如实输出「无变更：工作区无改动，未产生新提交」） |
| 2.8.2 | 推送前自动指定正确的 GitHub remote：新增 lib/git/remote-resolve.js（按「归属一致 + 本机可用形态 ssh:443 + 名字优先级 origin>github-ssh」评分，必要时自动 remote set-url 或新建，dryRun 只报告不写盘；归属不符的 origin 绝不覆盖，改走 github-ssh）；transport 的 SSH/API 推送与两处 liveRemoteHead 全部改用解析结果，回执带 remote/remoteAction/remoteReasons；另：README 移除界面配图与入库的图片资源、删除 screenshots.json |
| 2.8.1 | CLI 真发姿势补齐（npm-publish --no-dry-run 需配 --confirm、新增 --json）与 npm 端点经 api 通道可用；doc-drift 增「工具清单完整性」校验并把「N 条 HTTP API」「HTTP 接口（N 条…）」纳入计数模式（本次即抓出 SPEC 工具表缺行）；发包回归改用未发布过的 fixture 包，断言不放松；发版收尾序列补齐三条防再犯（压缩后重跑版本表 / 缩行需 --force / 压缩改信息别用 --amend --no-edit） |
| 2.8.0 | 账号信息新增 NPM 面板：本地/GitHub/NPM 三标签，顶部 GitHub↔NPM 账号卡滑动切换（同位置、同款卡、同一套离线快照 + 在线校验链路）；npm token/registry 设置（与 githubToken 同文件、原子读改写）；账号名下包列表（与 GitHub 仓库列表同款行、行内可安装）；npm 装包（默认 --ignore-scripts、二次确认、日志留痕）；npm 发包 API 与工具（后台 job、默认 dryRun、真发需 confirm + dryRun:false）；新增 lib/npm/*（registry 探测 / npmrc 物化 / 安装编排 / 发包编排 / 账号快照） |
| 2.7.3 | 发版拆环：版本列表最新行改由本文件提供（生成与校验在提交前即成立，不再需要「先提交再生成再 amend」） |
| 2.7.1 | 审计按独立包设计落地——对外门面 + 子路径导出 + 审计侧与仓库脚本解耦 + 边界门禁扩列 |

<!-- dshgp-version:end -->
