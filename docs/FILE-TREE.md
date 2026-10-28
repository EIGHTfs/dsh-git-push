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
│   │   ├── audit-api.js — 审计结果 API 聚合层（/api/git-push/audit：按规则/文件/严重级/规则包分组 + severity 过滤 + top 截断）
│   │   ├── command-registry.js — 工具命令注册表（方案 B——CLI/宿主工具/帮助同源，免维护）
│   │   ├── constants.js — 插件名与设置命名空间常量
│   │   ├── host-doc-checks.js — （待注释）
│   │   ├── http-handlers.js — HTTP 路由分发（薄 router：前置校验 + switch 各端点调 handlers/ 模块）
│   │   ├── index.js — 插件入口再导出（宿主 main 指向）
│   │   ├── inject-text.js — 注入文本（工具用法提示 FUNCTION_USAGE_HINT）
│   │   ├── repo-ownership.js — （待注释）
│   │   ├── scan-root.js — 默认扫描根解析（配置优先→DSH 家根自动识别）
│   │   ├── schema.js — 配置 schema（宿主导出缺失时兜底）
│   │   ├── settings-bridge.js — 设置读写桥（host scope 共享；绕开 client isLoopback=memory 落盘陷阱）
│   │   ├── slash-commands.js — 用户输入框斜杠命令（目前只注册 /git-audit）
│   │   ├── slot-stats.js — 规则槽位命中统计（模块级状态）
│   │   ├── tool-call.js — 工具调用分发（git_scan/commit_push/audit/status 等全部工具）
│   │   ├── tools.js — 工具定义清单（名称/描述/参数 schema）
│   │   └── …（10 个更深文件）
│   ├── ast/ — AST 实现层（token 级判定：括号/控制流/数据流/凭据/魔数/命名/规模/分词）
│   │   ├── brace.js — 括号配对与区间包含工具
│   │   ├── callgraph.js — 调用链追踪（单文件调用图 + isInRequestPath，io-risk 请求路径判定升级）
│   │   ├── code-lines.js — 代码行判定（真代码 vs 注释/字符串）+ 字符串字面量提取
│   │   ├── consts.js — （待注释）
│   │   ├── control-flow.js — 控制流检查（同步 fs/空 catch/圈复杂度/嵌套深度）
│   │   ├── credential.js — 凭据标识符判定（硬编码/引用/类型检查）
│   │   ├── dataflow.js — 数据流检查（清空后访问，三层审计 L2）
│   │   ├── dup-code.js — （待注释）
│   │   ├── fs-hotspots.js — （待注释）
│   │   ├── index.js — AST 层统一出口
│   │   ├── io-risk-const.js — IO 风险分级·常量与档位工具：fs 调用名集/操作类别/风险标签/搜索窗口与阈值 + raise 升档
│   │   ├── io-risk-fn.js — IO 风险分级·函数边界识别与 token 配对：认普通/箭头/方法简写/类方法，圆括号花括号方括号前后向配对
│   │   ├── io-risk-loop.js — IO 风险分级·循环判定：循环内/迭代器表达式（只执行一次）/小字面量数组降级/collectRanges 范围收集
│   │   ├── io-risk.js — IO 风险分级（四级）判定与评分：scanIoRiskAst 判定上下文/类别 → summarizeIoRisk 统计 → rankIoFixList 优先级清单；并再导出下列三个从属模块的公共符号
│   │   ├── lang.js — 语言路由（2026-10-06）：detectLang 内容启发式检测 + javaKtFuncRanges（Java/Kotlin 方法签名+括号配对函数范围）+ LANG_FUNC_RANGES 主流语言占位
│   │   ├── line-count.js — （待注释）
│   │   ├── magic-number.js — 硬编码魔数识别（豁免版本号/日期/状态码）
│   │   ├── naming.js — 命名检查（标识符长度/函数名过短/受控小文件读取）
│   │   ├── perf.js — （待注释）
│   │   ├── scope.js — 变量作用域分类器（module/function/loop 行号区间 + 模块常量赋值判定）
│   │   ├── shell.js — shell 精筛（cd 动态路径/写操作命中 .gitignore）
│   │   ├── size.js — 规模检查（函数长度/文件长度/重复字符串）
│   │   ├── symbol-index.js — （待注释）
│   │   ├── tokenizer.js — 分词器（token 流 + LRU 缓存）
│   │   ├── treesitter.js — （待注释）
│   ├── audit/ — 审计编排层（文件收集/逐文件检查/槽位聚合/审计出口）
│   │   ├── analysis-coverage.js — （待注释）
│   │   ├── audit-file.js — 单文件审计执行（跑检查+豁免）
│   │   ├── checks.js — 检查器入口（纯引用表）
│   │   ├── client-entry.js — （待注释）
│   │   ├── collector.js — 文件收集（gitignore 感知）
│   │   ├── ext-runner.js — 审计扩展运行器（audit-ext 统一入口动态加载/契约执行/失败降级）
│   │   ├── file-context.js — 文件上下文豁免（外部调用超时/mkdir 同函数/版本路径）
│   │   ├── finding.js — 统一问题对象构造器（makeFinding）
│   │   ├── gitignore-match.js — gitignore 语法匹配器（非 git 目录 .auditignore 兜底，语义与 git 对拍）
│   │   ├── glob.js — glob→RegExp 转换（**/*/? 子集）
│   │   ├── history-report.js — （待注释）
│   │   ├── history.js — （待注释）
│   │   ├── ignore-blind.js — 审计静默失明检测（本地 git 排除配置把整仓判成忽略时告警）
│   │   ├── index.js — 审计层统一出口（auditFull/auditChanged）
│   │   ├── orchestrate.js — 审计编排（收集→检查→汇总）
│   │   ├── ownership.js — （待注释）
│   │   ├── public.js — （待注释）
│   │   ├── repo-level.js — 仓库级语义规则
│   │   ├── report-yaml.js — （待注释）
│   │   ├── slot.js — 按规则包聚合审计命中（拦截/警告/通过）
│   ├── audit-rules/ — 规则包 yml（nodejs/npm/frontend/comment/dsh/private/structure 等动态槽位）
│   │   ├── audit-rules-comment.yml — 注释类规则（黑名单措辞/对话残留）（规则包 comment）
│   │   ├── audit-rules-cpp.yml — C/C++ 规则包（占位：规则待补，槽位就绪）（规则包 cpp）
│   │   ├── audit-rules-csharp.yml — （待注释）
│   │   ├── audit-rules-docs.yml — 文档类规则（README/文档措辞）（规则包 docs）
│   │   ├── audit-rules-dsh.yml — DSH 生态规则（宿主/插件约定）（规则包 dsh）
│   │   ├── audit-rules-filehealth.yml — 文件健康度规则（三维分级）（规则包 filehealth）
│   │   ├── audit-rules-folder.yml — 目录级规则（目录数/单目录文件数）（规则包 folder）
│   │   ├── audit-rules-frontend.yml — 前端规则（按钮绑定/魔数）（规则包 frontend）
│   │   ├── audit-rules-go.yml — Go 规则包（占位：规则待补，槽位就绪）（规则包 go）
│   │   ├── audit-rules-i18n.yml — i18n 规则（文案硬编码检查）（规则包 i18n）
│   │   ├── audit-rules-java.yml — Java/Kotlin 规则（短名/魔数/方法长度/复杂度，exts: [java,kt]）（规则包 java）
│   │   ├── audit-rules-nodejs.yml — Node.js 规则（同步 fs/空 catch）（规则包 nodejs）
│   │   ├── audit-rules-npm.yml — npm 规则（package.json 规范）（规则包 npm）
│   │   ├── audit-rules-paths.yml — （待注释）
│   │   ├── audit-rules-performance.yml — 性能规则（规则包 performance）
│   │   ├── audit-rules-php.yml — PHP 规则包（占位：规则待补，槽位就绪）（规则包 php）
│   │   ├── audit-rules-private.yml — 私密文件规则（凭据/私密清单）（规则包 private）
│   │   ├── audit-rules-python.yml — （待注释）
│   │   ├── audit-rules-robustness.yml — 健壮性规则（规则包 robustness）
│   │   ├── audit-rules-rust.yml — Rust 规则包（占位：规则待补，槽位就绪）（规则包 rust）
│   │   ├── audit-rules-structure.yml — 结构规则（命名/规模/复杂度）（规则包 structure）
│   │   ├── audit-rules-swift.yml — Swift 规则包（占位：规则待补，槽位就绪）（规则包 swift）
│   │   ├── audit-rules-template.yml — 规则模板（新规则包起点）（规则包 template）
│   ├── checks/ — 检查层（按 kind 调用检查器：正则/语义/结构/文件健康/按钮绑定/私密文件）
│   │   ├── button-bind.js — 按钮事件绑定交叉比对（声明了但没绑定）
│   │   ├── common.js — 检查器公共设施（豁免提示/severity 封顶/分组）
│   │   ├── credential-file.js — 凭据文件检查（.env/密钥文件）
│   │   ├── dataflow.js — 数据流规则包装（L2 token 级→finding）
│   │   ├── dispatch.js — 调度（runChecks 按 kind 分发汇总）
│   │   ├── dup-code.js — （待注释）
│   │   ├── dup-const.js — 同名常量跨文件重复定义检查（DRY：findConstDefs 多语言常量提取 + 模块级过滤 + checkDuplicateConst 跨文件聚合——2026-10-02 新规则）
│   │   ├── file-health.js — 文件健康度（行数/字节/行长三维打分）
│   │   ├── filter.js — 规则作用域过滤（exts/exclude_paths）
│   │   ├── folder.js — 目录级检查（文件夹数/单目录文件数/解包特征）
│   │   ├── fs-scanner.js — （待注释）
│   │   ├── hardcoded-path.js — （待注释）
│   │   ├── index.js — 检查层统一出口
│   │   ├── io.js — IO 风险分级包装：checkIoRisk → lib/ast/io-risk.js（转 warning finding，取代 quality/sync-fs）
│   │   ├── magic-number.js — 魔数检查包装（token 判定→finding）
│   │   ├── npm-json.js — package.json 检查（依赖版本/私有包豁免）
│   │   ├── private.js — 私密文件检查（私有仓可见性核对）
│   │   ├── regex.js — 正则类规则执行（regex/path-regex/blacklist）
│   │   ├── semantic.js — 语义类规则执行（patch insert/仓库级语义）
│   │   ├── structural.js — 结构类规则（函数长度/复杂度/嵌套/同步 fs）
│   ├── cli/ — （待注释）
│   │   ├── commands-account.mjs — （待注释）
│   │   ├── commands-audit.mjs — （待注释）
│   │   ├── commands-doc.mjs — （待注释）
│   │   ├── commands-vcs.mjs — （待注释）
│   ├── client/ — 客户端配置（DEFAULT_CONFIG + SETTINGS_SCHEMA 侧边栏设置项定义）
│   │   ├── index.js — 侧边栏设置 UI 总入口（DEFAULT_CONFIG + SETTINGS_SCHEMA）
│   ├── client-parts/ — 客户端分片源码（13 片，拼接成 lib/client.js；产物不入库）
│   │   ├── account.js — （待注释）
│   │   ├── actions.js — （待注释）
│   │   ├── apply.js — （待注释）
│   │   ├── audit.js — （待注释）
│   │   ├── browser.js — （待注释）
│   │   ├── const.js — （待注释）
│   │   ├── controller.js — （待注释）
│   │   ├── icons.js — （待注释）
│   │   ├── loader.js — （待注释）
│   │   ├── npm.js — （待注释）
│   │   ├── page.js — （待注释）
│   │   ├── repo.js — （待注释）
│   │   ├── settings.js — （待注释）
│   │   ├── utils.js — （待注释）
│   ├── context/ — 上下文注入（给 AI 会话注入环境：目录映射/工具路径/skill 入口）
│   │   ├── index.js — 上下文注入入口（环境注入文本）
│   ├── core/ — （待注释）
│   │   ├── atomic-json.js — （待注释）
│   │   ├── config.js — （待注释）
│   │   ├── credentials.js — （待注释）
│   │   ├── endpoints.js — （待注释）
│   │   ├── exec.js — （待注释）
│   │   ├── workspace-paths.js — （待注释）
│   ├── exempt/ — 豁免机制（dsh-skip-* 注释标记解析与文件头/行内语义）
│   │   ├── index.js — 豁免注册表（dsh-skip-* 全标记消费）
│   │   ├── tool.js — （待注释）
│   ├── git/ — Git 执行层（runGit/账号/API/克隆/凭据/推送/扫描/索引维护/敏感扫描/传输通道）
│   │   ├── account-status.js — （待注释）
│   │   ├── account.js — 账号校验（token 在线 + SSH 公钥指纹，输出账号状态块）
│   │   ├── api.js — GitHub REST 调用（githubFetch 统一 token/错误识别）
│   │   ├── atomic-json.js — 统一 JSON 原子读写（readJson/writeJsonAtomic/updateJsonAtomic/writeTextAtomic）
│   │   ├── browse.js — 目录浏览（账号卡片路径选择器后端）
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
│   │   ├── repo-index.js — dsh-repo-index 自动维护（扫描 workspace 生成索引 JSON）
│   │   ├── repos.js — 仓库扫描与展示（describeRepo 分支/远端/领先落后/未提交）
│   │   ├── scan-runner.js — （待注释）
│   │   ├── sensitive.js — 敏感信息扫描（提交前拦截密钥/凭据/私密文件）
│   │   ├── transport.js — 推送通道（dispatchPush 决策：SSH/API/auto + 结果核对）
│   │   ├── visibility.js — （待注释）
│   │   ├── wrapped-git.js — 浅包装 git（自动凭据透传：SSH 私钥/HTTPS token，git-sluice git <args> 与未知命令透传）
│   ├── http/ — HTTP 总入口（鉴权中间件 + 端点处理器骨架）
│   │   ├── index.js — HTTP 总入口（Origin/CSRF/写确认/413/路由分发）
│   ├── link-check/ — 链接判断（文档链接有效性，只 warning 永不 blocker）
│   │   ├── index.js — 链接判断总入口（分级扣分，断网不拦）
│   ├── npm/ — （待注释）
│   │   ├── account.js — （待注释）
│   │   ├── install.js — （待注释）
│   │   ├── npmrc.js — （待注释）
│   │   ├── publish.js — （待注释）
│   │   ├── registry.js — （待注释）
│   ├── plugin/ — Host 侧接线层（插件注册到 DSH：工具/HTTP/配置 schema）
│   │   ├── auto-detect.js — 任务完成自动推送·检测层（纯函数：✅任务完成 触发/❌⚠ 阻断/自定义正则/许可合成判断）
│   │   ├── auto-push.js — 任务完成自动推送·核心（turn/end 监听→检测→autoPushEnabled 开关→调 commitWithAudit 完整门禁，不裸提交）
│   │   ├── index.js — Host 侧接线（插件注册：工具/HTTP/配置注入宿主）
│   ├── rule/ — 规则引擎（yml 装载/编译注册表/同形字符检测/槽位启停）
│   │   ├── compilers.js — 规则编译器注册表（纯引用文件）
│   │   ├── homoglyph.js — 同形字符检测（yml kind/id 防 ASCII 混淆）
│   │   ├── loader.js — 规则总入口（yml 装载/解析/槽位启停）
│   │   ├── registry.js — 规则编译注册表核心（compileRule 主体）
│   │   ├── scope.js — 审计作用域机制层（scope_rules 规范化 + resolveScopeAction）
│   │   └── …（12 个更深文件）
│   ├── score/ — 10 维度加权评分总入口
│   │   ├── docs-score.js — 文档加分制检查器（文档集结构信号 + 版本一致性交叉验证，0 分起上限 10；不进 findings）
│   │   ├── index.js — 评分总入口（10 维度加权）
│   ├── self/ — 插件自身总入口（VERSION/versionInfo/CLI 帮助）
│   │   ├── index.js — 自身总入口（VERSION 一致性/versionInfo）
├── scripts/ — 开发工具脚本（版本校验/双副本同步/预览服务/README 目录树维护）
│   ├── audit-runner.mjs — 审计扩展 CLI 统一入口（独立跑 scripts/audit-ext/ 全部扩展）
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
│   ├── module-splitter.py — 巨型单文件按顶层块拆分脚本（analyze/split/verify 三命令，python3 零依赖；module_splitter 工具与 CLI 的底层实现）
│   ├── picker-repro.mjs — （待注释）
│   ├── platform-scan.mjs — （待注释）
│   ├── probe-recheck.mjs — 探针：「重新检测」按钮链路实测（在线校验 token/SSH）
│   ├── rename-locator.mjs — 变量重命名位置定位工具（按作用域聚合引用——单字母变量人工重命名辅助）
│   ├── rule-switch.mjs — 规则槽位手动启停 CLI
│   ├── rules-solo-audit.mjs — 规则单启控制变量扫描（基准全关+逐规则单启+全量对照，报告供 AI/人工审规则有效性与局限，按需运行非常驻）
│   ├── scan-file-io.mjs — 文件读写扫描器（列出所有 fs 读写调用位置 + 路径参数）
│   ├── scan-fs-hotspots.mjs — （待注释）
│   ├── scan-hardcoded-paths.mjs — （待注释）
│   ├── scan-repos.mjs — （待注释）
│   ├── scan-version.mjs — 版本一致性校验脚本
│   ├── symbol-index.mjs — （待注释）
│   ├── verify-prestep.mjs — 上下文注入自检脚本（真实触发 agent/pre-step 验证注入）
│   ├── version-source.mjs — （待注释）
│   ├── audit-ext/ — （待注释）
│   │   ├── _example-readme-present.mjs — 审计扩展契约示例（_ 前缀：演示不参与实际审计）
│   │   ├── variable-min-length.mjs — 审计扩展：variable-min-length（内置规则抽出试点——统一动态入口）
├── assets/ — 预览页与配图（preview.html 交互模拟页 + 面板截图）
│   ├── start.sh — 预览服务器启停脚本（start/stop/restart/status + --port + PID/日志/健康检查 /preview-ping）
├── test/ — node:test 全量单元测试（541+ 条，覆盖审计/推送/账号/HTTP/后台任务）
│   ├── .test — 空文件豁免标记（目录级豁免 .test 目录）
│   ├── e2e-npm-tab-render.mjs — （待注释）
│   ├── regression-2.4.1.mjs — （待注释）
│   ├── run-tests.mjs — （待注释）
│   ├── test-account-refresh-on-push.mjs — （待注释）
│   ├── test-account-ssh.mjs — 账号检查 + SSH 密钥测试
│   ├── test-analysis-coverage.mjs — （待注释）
│   ├── test-ast-confirm-span.mjs — （待注释）
│   ├── test-audit-api-http.mjs — （待注释）
│   ├── test-audit-api.mjs — （待注释）
│   ├── test-audit-bad-file.mjs — 审计拦截门禁测试（硬编码密码/API key/.env 凭据文件）
│   ├── test-audit-defaults.mjs — （待注释）
│   ├── test-audit-empty.mjs — （待注释）
│   ├── test-audit-exempt-paths.mjs — 提交时按文件临时豁免审计（auditExemptPaths）回归
│   ├── test-audit-ext.mjs — 审计扩展自动接入测试（契约加载/降级/match/auditFull 并入）
│   ├── test-audit-false-positive-guards.mjs — （待注释）
│   ├── test-audit-git-boundary.mjs — （待注释）
│   ├── test-audit-npm-publish-rules.mjs — （待注释）
│   ├── test-audit-push-boundary.mjs — （待注释）
│   ├── test-audit-rules-csharp.mjs — （待注释）
│   ├── test-audit-scope.mjs — 审计作用域/凭据占位符回归测试
│   ├── test-audit-slot-order.mjs — （待注释）
│   ├── test-audit.mjs — 审计总入口测试（auditFull/changed/豁免/gitignore）
│   ├── test-auditignore.mjs — （待注释）
│   ├── test-auto-push.mjs — 任务完成自动推送测试（检测纯函数 + registerAutoPush 门控监听注册）
│   ├── test-build-artifact-skip.mjs — 构建/混淆产物跳过专项测试（Pawchive 样本 fixture）
│   ├── test-build-client.mjs — 分片构建门禁测试（产物一致/幂等/形态铁律/dshgp_ 前缀）
│   ├── test-button-bind-events.mjs — （待注释）
│   ├── test-button-bind.mjs — 按钮绑定交叉比对（jsx 工厂形态/注释过滤/行号归属）
│   ├── test-cli-audit-parity.mjs — CLI 与源码全量审计一致性测试（audit --full --json vs 直接 auditFull，含忽略排除）
│   ├── test-cli-help-registry-sync.mjs — （待注释）
│   ├── test-client-fragment-scope.mjs — 客户端分片作用域推导测试（dsh-client-fragment）
│   ├── test-client.mjs — 侧边栏测试（手写 DOM/零外部资源/开关默认）
│   ├── test-clone-concurrency.mjs — clone 并发互斥/可中止/失败保留文件（14 项，CIFS 对照用例可跳）
│   ├── test-clone-history-defaults.mjs — （待注释）
│   ├── test-clone-history-mode.mjs — （待注释）
│   ├── test-clone-history.mjs — （待注释）
│   ├── test-clone-maxfilemb.mjs — （待注释）
│   ├── test-clone-parts-keep.mjs — （待注释）
│   ├── test-clone-preview-buttons.mjs — clone 预览确认框按钮可点（真渲染+真点击）
│   ├── test-clone-replay-io.mjs — （待注释）
│   ├── test-clone-replay.mjs — （待注释）
│   ├── test-clone-token.mjs — （待注释）
│   ├── test-collector-ignore.mjs — （待注释）
│   ├── test-command-registry.mjs — 命令注册表测试（工具入表/查找/parseRegistryArgs/清单生成）
│   ├── test-commit-message.mjs — （待注释）
│   ├── test-context.mjs — 上下文注入测试
│   ├── test-conv-rule-scope.mjs — （待注释）
│   ├── test-cred-env.mjs — git_cred_env 凭据传递测试（双通道/无明文/askpass 调用/无凭据兜底）
│   ├── test-dataflow.mjs — 三层审计 L2 数据流测试
│   ├── test-doc-func.mjs — （待注释）
│   ├── test-doc-version-release-source.mjs — （待注释）
│   ├── test-doc-version.mjs — （待注释）
│   ├── test-docs-score.mjs — 文档加分制测试（文档集圈法/四检查/公式/不一致 review/不冲突）
│   ├── test-dup-code.mjs — （待注释）
│   ├── test-dup-const-idiom.mjs — （待注释）
│   ├── test-dup-const.mjs — duplicate-const 规则测试（多语言提取 JS/Kotlin/Java/Go/Rust/Python、模块级过滤、跨文件聚合、test 目录排除、同值不同名不报）
│   ├── test-empty-catch-promise.mjs — （待注释）
│   ├── test-empty-catch-single-source.mjs — （待注释）
│   ├── test-exempt-hint-classify.mjs — （待注释）
│   ├── test-exempt-hint-effective.mjs — （待注释）
│   ├── test-exempt-tool.mjs — （待注释）
│   ├── test-exempt.mjs — 豁免总入口测试（7 标记 + 位置语义）
│   ├── test-ext-variable-min-length.mjs — （待注释）
│   ├── test-false-positive-fixes.mjs — 误报修复回归测试
│   ├── test-file-health.mjs — 文件健康度矩阵评分测试
│   ├── test-filter-ext.mjs — （待注释）
│   ├── test-folder-scope.mjs — 目录级审计作用域回归测试
│   ├── test-fs-hotspots.mjs — （待注释）
│   ├── test-func-doc-drift.mjs — （待注释）
│   ├── test-generated-html-artifact.mjs — （待注释）
│   ├── test-git-api-tool.mjs — （待注释）
│   ├── test-git-bin-plan.mjs — （待注释）
│   ├── test-git-identity-rewrite.mjs — （待注释）
│   ├── test-git-identity.mjs — （待注释）
│   ├── test-git-path-args.mjs — （待注释）
│   ├── test-git.mjs — git 总入口测试（runGit/commitAndPush/凭据/克隆）
│   ├── test-gitignore-match.mjs — gitignore 兜底匹配（与真 git 对拍 + 非 git 端到端）
│   ├── test-gitignore-nongit-dir.mjs — （待注释）
│   ├── test-history-audit.mjs — （待注释）
│   ├── test-http.mjs — HTTP 总入口测试（Origin/CSRF/413/路由）
│   ├── test-ignore-e2e.mjs — （待注释）
│   ├── test-index-jsonl.mjs — （待注释）
│   ├── test-init-compat.mjs — （待注释）
│   ├── test-inject-switch.mjs — 注入开发者要求清单子开关回归
│   ├── test-inject-system-prompt.mjs — 注入系统提示词回归
│   ├── test-io-risk.mjs — IO 风险分级测试（四级判定/字段完整性/汇总/排序/finding 转换）
│   ├── test-java-rules.mjs — Java/Kotlin 语言路由与专项规则测试（javaKtFuncRanges/短名/复杂度/规则联动/聚合型降级）
│   ├── test-line-count.mjs — （待注释）
│   ├── test-link-check.mjs — 链接判断测试（分级扣分/断网不拦）
│   ├── test-loop-no-fallback-return.mjs — （待注释）
│   ├── test-magic-number.mjs — 硬编码魔数检测测试
│   ├── test-max-lines-scope.mjs — （待注释）
│   ├── test-mirror-fallback.mjs — （待注释）
│   ├── test-mirror-gates.mjs — （待注释）
│   ├── test-module-splitter-multiline.mjs — （待注释）
│   ├── test-module-splitter.mjs — module_splitter 工具 + CLI 接入测试（契约 + 行为 + 脚本随插件发布）
│   ├── test-multi-remote.mjs — （待注释）
│   ├── test-name-length-scope.mjs — （待注释）
│   ├── test-npm-enobufs.mjs — （待注释）
│   ├── test-npm-install.mjs — （待注释）
│   ├── test-npm-publish.mjs — （待注释）
│   ├── test-npm-registry.mjs — （待注释）
│   ├── test-npm-token-credential.mjs — （待注释）
│   ├── test-perf-loop-collection.mjs — （待注释）
│   ├── test-perf-repeat-call.mjs — （待注释）
│   ├── test-persist-credentials.mjs — 凭据持久化测试
│   ├── test-picker-layout.mjs — （待注释）
│   ├── test-platform-scan.mjs — （待注释）
│   ├── test-plugin.mjs — 插件接线测试（入口导出/工具清单/双副本同步）
│   ├── test-privacy-ownership.mjs — （待注释）
│   ├── test-private-gate.mjs — （待注释）
│   ├── test-project-type-filter.mjs — 项目类型规则适配测试（非 dsh 项目不加载 dsh 槽位/0.x 版本规则、timeout 限 js 系、folder 尊重 gitignore——Pawchive 误报消除驱动）
│   ├── test-push-diagnose.mjs — （待注释）
│   ├── test-push-false-success.mjs — （待注释）
│   ├── test-push-transport.mjs — 推送通道回归（SSH 优先/一致性语义）
│   ├── test-quality.mjs — 评分总入口测试（AST 质量检查器）
│   ├── test-quota-write.mjs — （待注释）
│   ├── test-remote-name-ascii.mjs — （待注释）
│   ├── test-remote-resolve.mjs — （待注释）
│   ├── test-rename-locator.mjs — rename-locator 测试（同名不同作用域分组/模块级/过滤）
│   ├── test-repeated-strings-cs.mjs — （待注释）
│   ├── test-repo-list.mjs — 仓库列表测试（本地扫描/索引读写/HTTP 端点/远端状态）
│   ├── test-repos-live-budget.mjs — （待注释）
│   ├── test-rule-include-paths.mjs — （待注释）
│   ├── test-rule-packs.mjs — 规则总入口测试（编译注册/字段指派）
│   ├── test-scan-hardcoded-paths.mjs — （待注释）
│   ├── test-scope.mjs — 作用域最小实验测试（分类器/机制/magic 接入）
│   ├── test-scrub-conv-wording.mjs — （待注释）
│   ├── test-self.mjs — 自身总入口测试（VERSION/CLI/help 比对）
│   ├── test-settings-persistence.mjs — 设置侧边栏持久化专项测试（L1 提交/L2 白名单/L3 回读/L4 消费四层断言）
│   ├── test-settings-roundtrip.mjs — （待注释）
│   ├── test-sidebar-interaction.mjs — 侧边栏规则包列表交互自检
│   ├── test-slash-commands.mjs — 用户输入框 /git-audit 斜杠命令（解析/接线/对本仓库跑 quick）
│   ├── test-smart-hint.mjs — 扫描智能提示 + 评分对数衰减测试
│   ├── test-status-secret.mjs — token 明文不下发安全回归
│   ├── test-symbol-index.mjs — （待注释）
│   ├── test-symlink-resolution.mjs — 软链安装依赖解析回归测试（默认失败/--preserve-symlinks/NODE_PATH/真实副本四种场景）
│   ├── test-task-queue.mjs — 后台化回归测试（官方 job 注册 / 无 jobs 同步保底 / blocker 拦截）
│   ├── test-test-cache.mjs — （待注释）
│   ├── test-tokenizer-multiline-template.mjs — （待注释）
│   ├── test-tool-contract.mjs — （待注释）
│   ├── test-tool-probes.mjs — （待注释）
│   ├── test-tools-e2e.mjs — （待注释）
│   ├── test-tree-doc.mjs — README 目录树脚本测试（gen/check/apply 闭环）
│   ├── test-treesitter-grammars.mjs — 多语言 AST 接通自检：语法映射与 wasms 包实存核对、每语言 0 ERROR 解析、注释与带引号原始字符串的精筛、以及无语法资产时的回退契约（D5）
│   ├── test-treesitter.mjs — （待注释）
│   ├── test-version-metrics.mjs — （待注释）
│   ├── test-visibility-unified.mjs — （待注释）
│   ├── test-workspace-paths.mjs — （待注释）
│   ├── fixtures/ — （待注释）
│   │   ├── TimeZoneComboBox-CRnoCikG.js — Pawchive 混淆产物样本（hash 文件名——跳过判定 fixture）
│   │   └── …（5 个更深文件）
│   ├── helpers/ — （待注释）
│   │   ├── test-cache.mjs — （待注释）
│   │   ├── tmp-dir.mjs — （待注释）
├── docs/ — 开发文档
│   ├── 2.9.0-design.md — （待注释）
│   ├── 2026-10-09-审计插件性能优化.MD — （待注释）
│   ├── 2026-10-11-单一真源与文档漂移治理方案.MD — （待注释）
│   ├── 2026-10-11-硬编码路径改造为审计引擎方案.MD — （待注释）
│   ├── 2026-10-13-UI账号信息-NPM对齐GitHub方案.MD — （待注释）
│   ├── 2026-10-13-UI账号信息-NPM账号卡片与三标签页.MD — （待注释）
│   ├── 2026-10-28-弃零依赖引入npm与AST优先规则方案.MD — 弃零依赖引入 npm 与 AST 优先规则：决策清单、实测证据、里程碑与新增语言/规则的长期流程
│   ├── 2026-10-29-多语言AST接通实测记录.MD — M2 多语言 AST 接通的改前/改后命中实测：C# 进管道的文件与命中变化、六槽位三档计数（正则初筛/token 级/语法树）与 M3 取舍输入
│   ├── CHANGELOG.md — 版本列表宿主（doc-version apply 写 dshgp-version 标记块）
│   ├── DETAILS-EXEMPT-AND-RULES.md — 细节补充：豁免注释与规则 yml 用法全录
│   ├── FILE-TREE.md — （待注释）
│   ├── FUNCTIONS.md — 函数列表宿主（doc-func apply 写 dshgp-functions 标记块）
│   ├── PERF-BASELINE.md — （待注释）
│   ├── SPEC.md — （待注释）
│   ├── releases.json — （待注释）
│   ├── 功能-仓库索引与账号状态.md — （待注释）
│   ├── 功能-历史提交审计.md — （待注释）
│   ├── 功能-审计规则体系.md — （待注释）
│   ├── 功能-文档与结构追踪.md — （待注释）
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
├── cli.mjs — 独立 CLI（git-sluice，不依赖宿主可独立运行）
├── cordis.patch.yml — DSH 插件组合 patch（loader 注入定义）
├── package-lock.json — 依赖锁文件（npm install --no-bin-links 生成，保证依赖版本与 tree-sitter ABI 配对）
├── package.json — 包声明（dependencies 精确锁版、files 白名单、scripts）
├── tree-doc.json — 目录结构注释映射（路径→一句话介绍，AI 维护）
├── version-metrics.json — （待注释）
```
<!-- dshgp-tree:end -->
