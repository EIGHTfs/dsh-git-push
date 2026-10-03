# 版本列表

> 由 `scripts/doc-version.mjs` 维护：`gen` 打印 / `apply` 更新本节 / `check` 查漂移（git log 聚合版本表）。

<!-- dshgp-version:start -->
## 版本列表

| 版本 | 内容 |
|------|------|
| 2.4.1 | 2.4.1 — 插件自身优化批次（误报修复 / 公共常量收口 / 复杂度拆分 / 豁免提示一致性） |
| 2.4.0 | 2.4.0 — clone 链路三修（工具漏传 token / 防护顺序 / 互斥判定）+ 账号与读改写回归测试；2.4.0 版本表同步（doc-version 聚合入表） |
| 2.3.0 | 版本兼容自动切换——client 不再依赖 settingsScope 注入服务（DSH 0.2.0 移除，entry pending 报 Failed to load plugins），特性检测 0.1.6 真 scope / 0.2.0 fallback；配置真源本就走 HTTP config.json 行为一致；版本表同步（doc-version 聚合入表 2.3.0）；DSH 0.2.0 兼容修复——settings API 版本自动切换 + client 改 ctx.get 防御式读取 + apply 常驻诊断层 |
| 2.2.1 | token API 配额实时查询显示 + 凭据区去重 + 预览服务 --local 免重启模式 |
| 2.2.0 | git_clone 后台 job 化 + UI 显示 API 通道配额 |
| 2.1.4 | 插件自身优化 + 存量债务整理（合并 4 批本地提交为一次推送） |
| 2.1.3 | versioning 规则重设计——0.x 合法开发期（SemVer §4 + Go/Cargo 官方，调研驱动） |
| 2.1.2 | 项目类型规则适配——非 dsh 项目误报消除（Pawchive 539→512/blocker 10→3） |
| 2.1.1 | 复杂度规则口径优化——阈值 10 + blocker 50 真生效 + 算法补全 + message 分档 |
| 2.1.0 | Java/Kotlin 专项规则 + AST 语言路由 + 误报批量修复 + preview 数据自动生成；版本表 doc-version 聚合同步（2.1.0 由 git log 权威生成入表） |
| 2.0.8 | 修 /git-audit 斜杠命令「无摘要」回归（format 适配 code_audit 新返回）→ 2.0.8 |
| 2.0.6 | 工具清单单源化 + 14 工具描述精简全面重写 → 2.0.6 |
| 2.0.5 | 新手指引——README + CLI help 加「快速开始」（第一次用不用查源码）→ 2.0.5 |
| 2.0.4 | code_audit 恢复全量审计结果输出（includeFindings=true 参数化）→ 2.0.4 |
| 2.0.3 | API 指引 curl 加 -L（跟随反代 302 中转——直接复制可用）→ 2.0.3 |
| 2.0.2 | external 字段值规范化——布尔 true 不合法，改为具体标识（扩展脚本名）→ 2.0.2 |
| 2.0.1 | external 通道补构建/混淆产物豁免（Pawchive 混淆误报）→ 2.0.1 + 跳过混淆专项测试 |
| 2.0.0 | 方案 B——命令注册表元数据驱动（免维护 CLI + 独立于 DSH）→ 2.0.0 |
| 1.12.6 | external 机制修正——yml 具体字段路由到 ext 引擎（不经 groupByKind 过滤）→ 1.12.6 |
| 1.12.5 | 内置审计规则抽出试点——variable-min-length 经 audit-ext 统一动态入口执行 → 1.12.5 |
| 1.12.4 | 审计 API 指引可选参数提示——groupBy 选择性参数默认填好 + 可选项说明 → 1.12.4 |
| 1.12.3 | 审计输出 API 指引参数自动填充——repo/scope/groupBy + 真实 IP 直接可用（去占位符）→ 1.12.3 |
| 1.12.2 | 变量重命名位置定位工具（按作用域聚合引用——单字母变量人工重命名辅助）→ 1.12.2 |
| 1.12.1 | 误报批量修复（Pawchive 全量核对驱动）——构建产物 hash 豁免 + magic 配置类形态豁免 → 1.12.1；magic-number 豁免扩展（Pawchive 驱动——env 兜底已 1.12.1，本次收剩余形态）→ 2.0.7 |
| 1.12.0 | 审计扩展自动接入重构——统一入口动态加载 scripts/audit-ext/ 独立脚本 → 1.12.0 |
| 1.11.5 | 审计输出改为聚合 API 查询指引——不再内联审计内容（数量+评分+API 用法）→ 1.11.5 |
| 1.11.4 | 侧边栏设置页反代空白修复（available/writable 与 scope 快照解耦恒 true，绕开 isLoopback=memory 陷阱）+ git_sluice 透传工具化（注册为 AI 直接调用工具，凭据自动注入）+ 软链安装依赖解析回归测试 |
| 1.11.3 | 新增审计规则 comment/no-date-in-comment（注释禁止写日期）+ 固化注释规范 skill |
| 1.11.2 | git-sluice 符号链接场景入口静默不执行 + sync-plugin 自动恢复 cli.mjs 可执行权限 + no-eval 豁免 Playwright API |
| 1.11.1 | 审计误报批量修复（KToolBox/Pawchive 实测驱动）+ 评审①②③④落地合并 |
| 1.11.0 | 审计规则按语言划分 + 检查器语言化（Python 落地）+ 审计长尾优化合并 |
| 1.10.5 | 1.10.5 全量合并为一次提交——①拆分 http-handlers.js 巨型 switch（923→122）到 lib/app/handlers/ 6 模块；②分体式文档：git_gen_readme 抽独立脚本 readme-gen.mjs 并移除工具；tree-doc.mjs 改名 doc-tree.mjs（统一 doc- 前缀）+ 自动探测宿主 md；新增 doc-func.mjs（函数列表）/ doc-version.mjs（版本列表）三兄弟生成器，写入 docs/版本表.md + docs/函数列表.md（带标记块），README 链接引用；审计新增分体检查（findMarkedHostMd 公共函数复用）；③废弃删除旧函数文档体系（functions_index 工具/func-index/functions-doc/docs/函数/*.md）；④sync-plugin.mjs 支持 --source 读源项目 package.json files；回归 853 全绿；分体式宿主文档改英文名（docs/CHANGELOG.md + docs/FUNCTIONS.md，标记块驱动探测不受文件名影响）；/git-audit 参数解析兼容单横线 flag（-full/-force 等价 --full/--force，未知横线参数报用法而非当路径）；doc-version 版本表清洗沟通措辞——scrubConvWording 剔除提交标题里的许可类词，消除 CHANGELOG 4 个 conv-user-decision blocker；黑名单词字符类拆分防自举误报；审计 blocker 4→0（评分 79/B）；审计优化三批次——短变量/魔数/重复串提取 + doc-version 修复 |
| 1.10.4 | 工具探测补 node 兜底（execPath）+ 新增 /api/git-push/tool-probes 探测 API + 短变量改名，回归 846 全绿 |
| 1.10.3 | 魔数规则再修 3 类误报——对象字面量常量定义/rgba 色值/CLI JSON 输出豁免，warning 244→237 |
| 1.10.2 | 审计误报专项优化——重复规则去重/exs 文档豁免/vague 词表剔 res/循环变量豁免，warning 281→245 且不放过真实问题 |
| 1.10.1 | audit-api 变量命名清理 + sync-plugin fileContentEqual 异步化（async 内 existsSync→access） |
| 1.10.0 | 审计结果 API 化 + 自定义聚合——/api/git-push/audit（groupBy=rule/file/severity/slot + severity 过滤 + top + 明细）；修复 sync-plugin 漏同步 .auditignore（安装副本豁免失效） |
| 1.9.5 | 全量审计低风险优化——重复硬编码/短变量/魔数提取常量 + 真高风险 I/O 异步化，评分 76.8→A 级 |
| 1.9.4 | 自动推送范围下拉选项渲染为空（jsx 第三参数是 key 非 children）→ 1.9.4 |
| 1.9.3 | 任务完成自动推送内置（合并删除独立仓 dsh-task-completion）→ 1.9.3 |
| 1.9.2 | 软链加载诊断结论 + 恢复 peerDependencies（DSH 宿主注入信号）→ 1.9.2 |
| 1.9.1 | 系统提示词注入配置化（config.json injectUsageText 覆盖）+ 浅包装 git 用法入注入文本 → 1.9.1 |
| 1.9.0 | 浅包装 git——未知命令透传为 git（自动注入凭据，无需 token 参数）→ 1.9.0 |
| 1.8.16 | 作用域 P4 闭包双重作用域——return/this/exports 暴露的函数按模块级（不享受 startup 豁免）→ 1.8.16 |
| 1.8.15 | 作用域 P3 调用链追踪——io-risk 请求路径判定升级（修公共函数漏报）→ 1.8.15 |
| 1.8.14 | 作用域 P1+P2——启动路径豁免大函数/圈复杂度 + 参数短名豁免（scope_rules 首次接入真实规则）→ 1.8.14 |
| 1.8.13 | 审计作用域判断·最小实验（Scope 分类器 + scope_rules 机制 + magic 模块常量豁免）→ 1.8.13 |
| 1.8.12 | git_set_visibility 工具修复——支持 repoPath 从 origin 解析 owner/repo（此前传 repoPath 恒报「缺 owner/repo」）→ 1.8.12 |
| 1.8.11 | UI 切公开/私有按钮点击没反应——RepoCloudRow props 传参名写错（visSwitch→requestVisSwitch）→ 1.8.11 |
| 1.8.10 | countByDimension 去重粒度细化——规则级（每文件每规则每维度计 1）+ tree-doc 测试适配 → 1.8.10 |
| 1.8.9 | 评分公平性修复——countByDimension 文件级去重（大项目小问题不再线性累加）+ collectFnBodies 拆分 → 1.8.9 |
| 1.8.8 | 大函数拆分（cmdClone/applySettingsToCfg/checkSyncFs）+ 测试适配 → 1.8.8（评分 74.8） |
| 1.8.7 | 审计评分提分 68.9→74.7（README 豁免/阈值校准/建议类降级/CLI main 表驱动重构）→ 1.8.7 |
| 1.8.6 | 方案文档措辞修复——conv-user-decision blocker 清零 → 1.8.6 |
| 1.8.5 | io-risk 元数据操作档优化（对照诊断 97% 误报）——请求路径元数据/查询/幂等目录操作降 low，rename 同卷改名不升档 → 1.8.5 |
| 1.8.4 | 规则单启控制变量扫描工具（scripts/rules-solo-audit.mjs，按需运行非测试常驻）→ 1.8.4 |
| 1.8.3 | tree-doc 审计漂移修复——生成物豁免 + 新增文件 missing 降 notice，消除 git_commit_push 审计环境瞬时 tree-doc-drift warning → 1.8.3 |
| 1.8.2 | CLI 新增 tree-doc 子命令 + CLI/源码全量审计一致性自动测试 + 版本纪律修订（每次提交默认升第三位）→ 1.8.2 |
| 1.8.1 | --root 外调写盘落错目录 + 中文路径 quotepath 转义污染键（bump 1.8.1） |
| 1.8.0 | git_cred_env 凭据传递（AI 执行外部 git 不接触明文）——bump 1.8.0 |
| 1.7.0 | audit --history 历史提交审计（逐提交快照全量 + 落盘报告，三参数皆可缺省）——bump 1.7.0 |
| 1.6.0 | git_commit_push / CLI commit 支持精确 add 路径（paths）——bump 1.6.0 |
| 1.5.6 | 重写两点有价值功能（从 1.5.6 提交提取，剔除 start.sh/link 安装等误改）；版本保持 1.5.4（1.5.6 两提交已备份至 backup/1.5.6-rollback）；module_splitter 工具 + CLI 接入（模块拆分器复用为 AI 工具）——bump 1.5.6 |
| 1.5.5 | bump 1.5.5——cwd 注入修正 + tree-doc --root 两功能版本号同步 |
| 1.5.4 | 1.5.4 设置侧边栏云端仓库可见性切换（二次确认）+ /git-audit 新增 --force 强制扫描非 git 目录 |
| 1.5.3 | bump 1.5.3——io-risk 括号配对重构 + 版本号三处同步（lib/self / package.json / README 版本表） |
| 1.5.2 | 工具探测改上下文注入 + 工具清单 json 化（lib/tool-probes.json 模板只 key，运行时 which/where 实测落盘运行目录 tools.json，Windows 自动补 .exe；环境段从 systemPrompt 迁出改 agent/pre-step 首条注入，WeakSet 防重复 + createUserMessage + source 标记；新增 scripts/verify-prestep.mjs 自检脚本） |
| 1.5.1 | client.js 移入 lib/，版本号改为 1.5.1 |
| 1.4.3 | 修 jsx 按钮检测的三类误报（1.4.3 引入）+ 该检查首次纳入测试 |
| 1.3.8 | v1.3.8 版本号同步（本轮噪音治理与实质修复存档） |
| 1.3.4 | v1.3.4 凭据统一收进 config.json + 统一 JSON 原子读写 + 索引只存本地仓库 + 局域网地址修正 + 文件读写扫描器 |
| 1.3.3 | v1.3.3 本地扫描完自动补查远端状态 + tree-doc 漂移并入审计 + 侧边栏预读修复 + 推送门禁开关 |
| 1.3.2 | v1.3.2 审计结果 YAML 报告（按拦截级别→目录→文件聚合）+ 评分防空扫描满分 |
| 1.3.1 | v1.3.1 云端扫描写索引 + 本地远端状态刷新 + 代码质量清扫（命名/魔数）+ 魔数双规则合并 |
| 1.3.0 | v1.3.0 审计忽略全链路修复（黑名单初筛+白名单补充）+ 统一跳过目录模块 + CLI 与插件审计同源同参 + 推送通道下拉修正 |
| 1.2.2 | v1.2.2 合并提交——官方 ctx.jobs 后台推送、/git-audit 斜杠命令、rules yml dimensions 统一绑定、文件行数注释行统计、仓库索引路径修正（dsh-git-push-User 废弃）、tree-doc sync、设置私有 config.json、健壮性/安全告警清零 |
| 1.2.1 | v1.2.1 设置落盘改插件私有 config.json、推送判定按 ahead、审计 blocker 列文件、live ls-remote |
| 1.2.0 | v1.2.0 — 远端状态修复/推送分叉检查/审计配置传递/tree-doc 目录树/preview-server 静态 serve |
| 1.1.7 | 修正推送失败语义：分叉不再回落 API，remote-tracking 引用取真实 sha |
| 1.1.6 | 推送默认走 SSH，远端 sha 与本地一致；补凭据内嵌检查与 README |
| 1.1.5 | status 端点脱敏 token；审计页注入子开关一遍可勾选 |
| 1.1.4 | 实现按职责拆到各文件夹（六处入口退化为纯再导出） |
| 1.1.3 | 规则作用域字段收口 + 大仓扫描降级 + 要求清单注入开关（1.1.3） |
| 1.1.2 | 规则包列表交互改版 + 5 类审计误报修复 |
| 1.1.1 | 用户沟通词 blocker 规则（取消分数制/白名单豁免/黑名单直拦）+ 审计选项卡开关 + 测试目录豁免 + k 系数 5 档调低 |
| 1.1.0 | 侧边栏三选项卡 + 账号面板美化 + 凭据落盘修复 |
| 1.0.5 | 侧边栏增强 + 误报清理 + 客户端重写 |
| 1.0.4 | 规则引擎加固 + 侧边栏配置面 + 提交推送对齐 |
| 1.0.0 | 首发接线 + 缺陷修复 + 规则包对齐 |

<!-- dshgp-version:end -->
