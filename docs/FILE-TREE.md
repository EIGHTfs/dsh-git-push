# 目录结构

本文件由 `scripts/doc-tree.mjs` 自动维护（标记块 `dshgp-tree`，`apply` 覆盖、`check` 查漂移）。

<!-- dshgp-tree:start -->
```text
dsh-git-push/
├── lib/ — 核心实现（10 总入口 + 审计引擎 + git 执行层 + 规则编译层）
│   ├── ARCHITECTURE.md — 架构说明文档
│   ├── BUGFIX-NOTES-2026-09-14.md — Bug 修复说明（diff 审计提速 / 凭据文件拦截三层根因）
│   ├── audit-defaults.js — （待注释）
│   ├── commit-push.js — 审计提交总入口（commitWithAudit + runAudit 同步审计）
│   ├── fsx.js — 文件系统适配层（CIFS/SMB 兼容：copyFile 读写回退、chmod 尽力而为、元数据能力探测）
│   ├── index.js — 插件入口（DSH 接线，再导出全部能力）
│   ├── skip-dirs.js — 跳过目录统一判定（硬编码基线 + yml exclude_dirs 并集 + gitignore 白名单恢复）
│   ├── tool-probes.json — 工具探测清单模板（工具为 key、值为空；运行时实测生成运行目录 tools.json）
│   ├── user-requirements.json — 开发者特殊要求清单（提交推送前逐条核对）
│   ├── app/ — 插件入口层（apply/HTTP 处理/工具调用分发/注入文本/默认扫描根）
│   │   ├── apply.js — 插件装载入口（注册 schema/工具/HTTP/注入钩子）
│   │   ├── command-registry.js — 工具命令注册表（方案 B——CLI/宿主工具/帮助同源，免维护）
│   │   ├── constants.js — 插件名与设置命名空间常量
│   │   ├── http-handlers.js — HTTP 路由分发（薄 router：前置校验 + switch 各端点调 handlers/ 模块）
│   │   ├── index.js — 插件入口再导出（宿主 main 指向）
│   │   ├── inject-text.js — 注入文本（工具用法提示 FUNCTION_USAGE_HINT）
│   │   ├── ownership.js — （待注释）
│   │   ├── preprocess-client.js — （待注释）
│   │   ├── repo-ownership.js — （待注释）
│   │   ├── scan-root.js — 默认扫描根解析（配置优先→DSH 家根自动识别）
│   │   ├── schema-audit.js — （待注释）
│   │   ├── schema.js — 配置 schema（宿主导出缺失时兜底）
│   │   ├── settings-bridge.js — 设置读写桥（host scope 共享；绕开 client isLoopback=memory 落盘陷阱）
│   │   ├── severity.js — （待注释）
│   │   ├── slash-commands.js — 用户输入框斜杠命令（目前只注册 /git-audit）
│   │   ├── slot-stats.js — 规则槽位命中统计（模块级状态）
│   │   ├── tool-call.js — 工具调用分发（git_scan/commit_push/audit/status 等全部工具）
│   │   ├── tools.js — 工具定义清单（名称/描述/参数 schema）
│   │   └── …（11 个更深文件）
│   ├── cli/ — （待注释）
│   │   ├── commands-account.mjs — （待注释）
│   │   ├── commands-doc.mjs — （待注释）
│   │   ├── commands-preprocess.mjs — （待注释）
│   │   ├── commands-tool.mjs — 工具链命令实现（模板生成与 self-check）
│   │   ├── commands-vcs.mjs — （待注释）
│   │   ├── shared.mjs — 三个 CLI 共用的公共层（参数解析/结果打印/HELP 渲染/版本/跨侧指引）
│   ├── client/ — 客户端配置（DEFAULT_CONFIG + SETTINGS_SCHEMA 侧边栏设置项定义）
│   │   ├── index.js — 侧边栏设置 UI 总入口（DEFAULT_CONFIG + SETTINGS_SCHEMA）
│   ├── client-parts/ — 客户端分片源码（按侧分目录：git/ 参与构建，audit/ 只归档不进产物）
│   │   └── …（14 个更深文件）
│   ├── commit-push/ — 提交推送编排（runAudit 门禁 + commitWithAudit/commitMany）
│   │   ├── pre-commit-engine.js — 提交前预处理引擎适配层：spawn 引擎、拼参数、退出码映射、超时与 fail-closed
│   ├── context/ — 上下文注入（给 AI 会话注入环境：目录映射/工具路径/skill 入口）
│   │   ├── index.js — 上下文注入入口（环境注入文本）
│   ├── core/ — （待注释）
│   │   ├── atomic-json.js — （待注释）
│   │   ├── config.js — （待注释）
│   │   ├── credentials.js — （待注释）
│   │   ├── endpoints.js — （待注释）
│   │   ├── exec.js — （待注释）
│   │   ├── mirror-candidates.json — （待注释）
│   │   ├── mirror-store.js — （待注释）
│   │   ├── workspace-paths.js — （待注释）
│   ├── git/ — Git 执行层（runGit/账号/API/克隆/凭据/推送/扫描/索引维护/敏感扫描/传输通道）
│   │   ├── account-status.js — （待注释）
│   │   ├── account.js — 账号校验（token 在线 + SSH 公钥指纹，输出账号状态块）
│   │   ├── api.js — GitHub REST 调用（githubFetch 统一 token/错误识别）
│   │   ├── atomic-json.js — 统一 JSON 原子读写（readJson/writeJsonAtomic/updateJsonAtomic/writeTextAtomic）
│   │   ├── browse.js — 目录浏览（账号卡片路径选择器后端）
│   │   ├── ci.js — （待注释）
│   │   ├── clone-download.js — 并发下载 + .part 断点续传 + 体积守卫 + 进度回调
│   │   ├── clone-history-mode.js — （待注释）
│   │   ├── clone-history.js — （待注释）
│   │   ├── clone-jobs.js — clone 进度/预览内存态（供前端轮询）
│   │   ├── clone-replay-io.js — （待注释）
│   │   ├── clone-replay.js — （待注释）
│   │   ├── clone.js — 克隆（Git Data API，不依赖本地凭据）
│   │   ├── cloud.js — 云端仓库列表（/user/repos 供手动 clone）
│   │   ├── commit-message.js — （待注释）
│   │   ├── config.js — 路径与配置（PLUGIN_ROOT + 开发者要求清单读取）
│   │   ├── cred-env.js — 凭据传递工具（SSH 私钥路径 GIT_SSH_COMMAND / HTTPS askpass 脚本，AI 执行外部 git 不接触明文）
│   │   ├── credentials.js — 凭据解析（token/SSH 私钥：环境变量→凭据文件→settings）
│   │   ├── endpoints.js — （待注释）
│   │   ├── exec.js — git 进程调用（runGit 统一超时/错误规整 + gitRaw 原始字节）
│   │   ├── exempt-markers.js — （待注释）
│   │   ├── hooks.js — （待注释）
│   │   ├── identity-rewrite.js — （待注释）
│   │   ├── identity.js — （待注释）
│   │   ├── ignore.js — .gitignore 兜底（DEFAULT_IGNORE_PATTERNS 补齐）
│   │   ├── index-format.js — （待注释）
│   │   ├── index.js — Git 执行层统一出口
│   │   ├── init-compat.js — （待注释）
│   │   ├── module-splitter.js — （待注释）
│   │   ├── post-push.js — 推送后增强（remote-tracking ref/aux remote/tag）
│   │   ├── push-diagnose.js — （待注释）
│   │   ├── push.js — 提交推送编排（commitAndPush 全流程：敏感扫描→add/commit→推送）
│   │   ├── remote-resolve.js — （待注释）
│   │   ├── remote.js — 远端仓库管理（建仓默认 private/可见性切换）
│   │   ├── rename.js — （待注释）
│   │   ├── repo-index.js — dsh-repo-index 自动维护（扫描 workspace 生成索引 JSON）
│   │   ├── repos.js — 仓库扫描与展示（describeRepo 分支/远端/领先落后/未提交）
│   │   ├── scan-runner.js — （待注释）
│   │   ├── sensitive.js — 敏感信息扫描（提交前拦截密钥/凭据/私密文件）
│   │   ├── transport.js — 推送通道（dispatchPush 决策：SSH/API/auto + 结果核对）
│   │   ├── visibility.js — （待注释）
│   │   ├── wrapped-git.js — 浅包装 git（自动凭据透传：SSH 私钥/HTTPS token，git-sluice git <args> 与未知命令透传）
│   ├── http/ — HTTP 总入口（鉴权中间件 + 端点处理器骨架）
│   │   ├── index.js — HTTP 总入口（Origin/CSRF/写确认/413/路由分发）
│   ├── npm/ — （待注释）
│   │   ├── account.js — （待注释）
│   │   ├── install.js — （待注释）
│   │   ├── local-registry.js — （待注释）
│   │   ├── npmrc.js — （待注释）
│   │   ├── publish.js — （待注释）
│   │   ├── registry.js — （待注释）
│   │   ├── smoke.js — （待注释）
│   │   ├── unpublish.js — （待注释）
│   ├── plugin/ — Host 侧接线层（插件注册到 DSH：工具/HTTP/配置 schema）
│   │   ├── auto-detect.js — 任务完成自动推送·检测层（纯函数：✅任务完成 触发/❌⚠ 阻断/自定义正则/许可合成判断）
│   │   ├── auto-push.js — 任务完成自动推送·核心（turn/end 监听→检测→autoPushEnabled 开关→调 commitWithAudit 完整门禁，不裸提交）
│   │   ├── index.js — Host 侧接线（插件注册：工具/HTTP/配置注入宿主）
│   ├── preprocess/ — （待注释）
│   │   ├── providers.js — （待注释）
│   ├── self/ — 插件自身总入口（VERSION/versionInfo/CLI 帮助）
│   │   ├── index.js — 自身总入口（VERSION 一致性/versionInfo）
├── scripts/ — 开发工具脚本（版本校验/双副本同步/预览服务/README 目录树维护）
│   ├── audit-runtime-check.mjs — 三层审计 L3 运行时检测脚本
│   ├── browser-page-probe.mjs — （待注释）
│   ├── build-client.mjs — 客户端分片拼接（PART_ORDER + --check 门禁 + 形态铁律自检）
│   ├── bump-version.mjs — （待注释）
│   ├── check.mjs — 语法检查脚本（npm run check）
│   ├── clean-date-comments.py — （待注释）
│   ├── cpu-sample.mjs — （待注释）
│   ├── doc-drift.mjs — （待注释）
│   ├── doc-func.mjs — （待注释）
│   ├── doc-tree.mjs — （待注释）
│   ├── doc-version.mjs — （待注释）
│   ├── hot-path-probe-cjs.cjs — （待注释）
│   ├── hot-path-probe-fs-shim.mjs — （待注释）
│   ├── hot-path-probe-fsp-shim.mjs — （待注释）
│   ├── hot-path-probe.mjs — （待注释）
│   ├── local-registry.mjs — （待注释）
│   ├── module-splitter.py — 巨型单文件按顶层块拆分脚本（analyze/split/verify 三命令，python3 零依赖；module_splitter 工具与 CLI 的底层实现）
│   ├── picker-repro.mjs — （待注释）
│   ├── probe-recheck.mjs — 探针：「重新检测」按钮链路实测（在线校验 token/SSH）
│   ├── scan-repos.mjs — （待注释）
│   ├── scan-version.mjs — 版本一致性校验脚本
│   ├── verify-prestep.mjs — 上下文注入自检脚本（真实触发 agent/pre-step 验证注入）
│   ├── version-source.mjs — （待注释）
├── test/ — node:test 全量单元测试（541+ 条，覆盖审计/推送/账号/HTTP/后台任务）
│   ├── .test — 空文件豁免标记（目录级豁免 .test 目录）
│   ├── run-tests.mjs — （待注释）
│   ├── app/ — （待注释）
│   │   ├── test-auto-push.mjs — （待注释）
│   │   ├── test-context.mjs — （待注释）
│   │   ├── test-http-audit-split.mjs — （待注释）
│   │   ├── test-http.mjs — （待注释）
│   │   ├── test-plugin.mjs — （待注释）
│   │   ├── test-preprocess-consumption.mjs — （待注释）
│   │   ├── test-settings-persistence.mjs — （待注释）
│   │   ├── test-settings-roundtrip.mjs — （待注释）
│   │   ├── test-slash-commands.mjs — （待注释）
│   │   ├── test-status-secret.mjs — （待注释）
│   │   ├── test-symlink-resolution.mjs — （待注释）
│   │   ├── test-task-queue.mjs — （待注释）
│   │   ├── test-tools-e2e.mjs — （待注释）
│   │   ├── test-tools.mjs — （待注释）
│   │   ├── test-workspace-paths.mjs — （待注释）
│   ├── audit/ — 审计侧 UI 测试归档（不参与常规回归——run-tests 只扫 test/ 顶层）
│   │   ├── test-analysis-coverage.mjs — （待注释）
│   │   ├── test-ignore-e2e.mjs — （待注释）
│   │   ├── test-preprocess-render.mjs — （待注释）
│   │   ├── test-privacy-ownership.mjs — （待注释）
│   ├── fixtures/ — （待注释）
│   │   ├── TimeZoneComboBox-CRnoCikG.js — Pawchive 混淆产物样本（hash 文件名——跳过判定 fixture）
│   │   ├── mock-preprocess-cli.mjs — （待注释）
│   │   └── …（5 个更深文件）
│   ├── git/ — （待注释）
│   │   ├── test-account-refresh-on-push.mjs — （待注释）
│   │   ├── test-account-ssh.mjs — （待注释）
│   │   ├── test-audit-bad-file.mjs — （待注释）
│   │   ├── test-audit-boundary.mjs — （待注释）
│   │   ├── test-ci-wait.mjs — （待注释）
│   │   ├── test-cifs-init.mjs — （待注释）
│   │   ├── test-clone-concurrency.mjs — （待注释）
│   │   ├── test-clone-history.mjs — （待注释）
│   │   ├── test-clone-mirror.mjs — （待注释）
│   │   ├── test-clone-replay.mjs — （待注释）
│   │   ├── test-commit-message.mjs — （待注释）
│   │   ├── test-cred-env.mjs — （待注释）
│   │   ├── test-git-api-tool.mjs — （待注释）
│   │   ├── test-git-core.mjs — （待注释）
│   │   ├── test-git-identity.mjs — （待注释）
│   │   ├── test-git.mjs — （待注释）
│   │   ├── test-index-jsonl.mjs — （待注释）
│   │   ├── test-init-compat.mjs — （待注释）
│   │   ├── test-mirror.mjs — （待注释）
│   │   ├── test-multi-remote.mjs — （待注释）
│   │   ├── test-npm-install.mjs — （待注释）
│   │   ├── test-npm-publish.mjs — （待注释）
│   │   ├── test-origin-desktop.mjs — （待注释）
│   │   ├── test-persist-credentials.mjs — （待注释）
│   │   ├── test-pre-commit-engine.mjs — （待注释）
│   │   ├── test-private-gate.mjs — （待注释）
│   │   ├── test-push-false-success.mjs — （待注释）
│   │   ├── test-push.mjs — （待注释）
│   │   ├── test-quota-write.mjs — （待注释）
│   │   ├── test-remote-name-ascii.mjs — （待注释）
│   │   ├── test-remote-resolve.mjs — （待注释）
│   │   ├── test-repo-list.mjs — （待注释）
│   │   ├── test-repos-live-budget.mjs — （待注释）
│   │   ├── test-visibility-unified.mjs — （待注释）
│   ├── helpers/ — （待注释）
│   │   ├── merge-tests.mjs — （待注释）
│   │   ├── mock-preprocess.mjs — （待注释）
│   │   ├── provider-available.mjs — （待注释）
│   │   ├── test-cache.mjs — （待注释）
│   │   ├── test-scan.mjs — （待注释）
│   │   ├── tmp-dir.mjs — （待注释）
│   ├── tool/ — （待注释）
│   │   ├── test-build-client.mjs — （待注释）
│   │   ├── test-cli.mjs — （待注释）
│   │   ├── test-client-fragment-scope.mjs — （待注释）
│   │   ├── test-doc-func.mjs — （待注释）
│   │   ├── test-doc-version-release-source.mjs — （待注释）
│   │   ├── test-doc-version.mjs — （待注释）
│   │   ├── test-func-doc-drift.mjs — （待注释）
│   │   ├── test-module-splitter.mjs — （待注释）
│   │   ├── test-npm-tab-render.mjs — （待注释）
│   │   ├── test-picker-layout.mjs — （待注释）
│   │   ├── test-scan-and-cache.mjs — （待注释）
│   │   ├── test-scrub-conv-wording.mjs — （待注释）
│   │   ├── test-self.mjs — （待注释）
│   │   ├── test-smoke-import-specs.mjs — （待注释）
│   │   ├── test-tree-doc.mjs — （待注释）
│   │   ├── test-tree-first.mjs — （待注释）
│   │   ├── test-version-metrics.mjs — （待注释）
├── docs/ — 开发文档
│   ├── 2.9.0-design.md — （待注释）
│   ├── 2026-10-09-审计插件性能优化.MD — （待注释）
│   ├── 2026-10-11-单一真源与文档漂移治理方案.MD — （待注释）
│   ├── 2026-10-11-硬编码路径改造为审计引擎方案.MD — （待注释）
│   ├── 2026-10-13-UI账号信息-NPM对齐GitHub方案.MD — （待注释）
│   ├── 2026-10-13-UI账号信息-NPM账号卡片与三标签页.MD — （待注释）
│   ├── 2026-10-28-弃零依赖引入npm与AST优先规则方案.MD — 弃零依赖引入 npm 与 AST 优先规则：决策清单、实测证据、里程碑与新增语言/规则的长期流程
│   ├── 2026-10-29-多语言AST接通实测记录.MD — M2 多语言 AST 接通的改前/改后命中实测：C# 进管道的文件与命中变化、六槽位三档计数（正则初筛/token 级/语法树）与 M3 取舍输入
│   ├── 2026-11-06-审计插件本体审视与优化方向讨论.案例d3dx.md — （待注释）
│   ├── 2026-11-13-提交前预处理与审计引擎解耦方案.MD — 提交前预处理与审计引擎解耦方案：引擎契约（配置化入口/退出码）、UI 注入契约、职责切分与分阶段落地
│   ├── 2026-11-14-GitHub-DeviceFlow-第三方登录方案.MD — GitHub 第三方登录方案（Device Flow 设计稿）：四方案对比、完整流程与状态机、GitHub API 细节、插件侧配置/端点/UI 设计、错误矩阵、安全与边界
│   ├── 2026-11-15-gitpush与审计分家方案.MD — gitpush 与审计分家方案（设计稿）：两包职责切分（探留 gitpush / 判归审计）、审计包三形态（library/CLI/MCP）、契约改动、文件迁移约对半、兼容与风险
│   ├── 2026-11-15-审计中间层与引擎声明分层方案.MD — 审计中间层与引擎声明分层方案：豁免+评分抽成同库中间层，引擎只产 findings + 声明 scoreSpec；三契约、5 调用点收敛、自研引擎改造、进程形态对比
│   ├── CHANGELOG.md — 版本列表宿主（doc-version apply 写 dshgp-version 标记块）
│   ├── DETAILS-EXEMPT-AND-RULES.md — 细节补充：豁免注释与规则 yml 用法全录
│   ├── FILE-TREE.md — （待注释）
│   ├── FUNCTIONS.md — 函数列表宿主（doc-func apply 写 dshgp-functions 标记块）
│   ├── PERF-BASELINE.md — （待注释）
│   ├── PLAN-2026-11-01-auditignore-scoped.md — （待注释）
│   ├── SPEC.md — （待注释）
│   ├── releases.json — （待注释）
│   ├── 功能-发布与工具链.md — 提交推送、克隆、npm 发布、仓库索引与账号状态、文档生成脚本的功能介绍
│   ├── 功能-审计引擎.md — 审计引擎功能介绍：规则体系、树化判定、评分、外部 linter 委托、豁免通道
│   ├── 功能-审计规则体系.md — （待注释）
├── skills/ — 插件权威 skill（功能手册/规则/使用说明，安装副本的 skills/ 同步）
│   ├── dsh-repo-index.md — dsh-repo-index skill（源码索引权威说明）
│   ├── dev/ — （待注释）
│   │   ├── audit-rule-authoring.md — （待注释）
│   │   ├── dsh-git-push.md — （待注释）
│   │   ├── git-push-live-fix.md — （待注释）
│   ├── guide/ — （待注释）
│   │   ├── guide-audit.md — （待注释）
│   │   ├── guide-cli-scripts.md — （待注释）
│   │   ├── guide-clone-repos.md — （待注释）
│   │   ├── guide-commit-push.md — （待注释）
│   │   ├── guide-inject-ui.md — （待注释）
│   │   ├── guide-slash-completion.md — （待注释）
│   ├── workflow/ — （待注释）
│   │   ├── README.md — （待注释）
│   │   ├── git-commit-discipline.md — （待注释）
│   │   ├── git-project-startup.md — （待注释）
│   │   ├── git-rebuild-process.md — （待注释）
│   │   ├── github-operations.md — （待注释）
│   │   ├── readme-sync-git-md.md — （待注释）
│   │   ├── task-completion-report.md — （待注释）
│   │   ├── tool-json-add-ask.md — （待注释）
│   │   ├── versioning-rule.md — （待注释）
├── .github/ — （待注释）
│   ├── workflows/ — （待注释）
│   │   ├── test.yml — （待注释）
├── audit-samples/ — （待注释）
│   ├── .samples — （待注释）
│   ├── js-bad.js — （待注释）
│   ├── py-bad.py — （待注释）
├── .auditignore — 审计豁免清单（不影响 git 入库，仅跳过审计扫描）——排除内置第三方代码
├── .gitignore — 忽略规则（node_modules/产物/备份/回收站等）
├── CONTRIBUTING.md — （待注释）
├── LICENSE — （待注释）
├── README.md — 插件 README（功能总览/用法/版本记录）
├── SECURITY.md — （待注释）
├── cli-tool.mjs — 工具链 CLI 入口（bin tool-sluice：module-splitter/yaml-template/readme-template/self-check）
├── cli.mjs — 独立 CLI（git-sluice，不依赖宿主可独立运行）
├── cordis.patch.yml — DSH 插件组合 patch（loader 注入定义）
├── package-lock.json — 依赖锁文件（npm install --no-bin-links 生成，保证依赖版本与 tree-sitter ABI 配对）
├── package.json — 包声明（dependencies 精确锁版、files 白名单、scripts）
├── tree-doc.json — 目录结构注释映射（路径→一句话介绍，AI 维护）
├── version-metrics.json — （待注释）
```
<!-- dshgp-tree:end -->
