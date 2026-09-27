# 版本列表

> 由 `scripts/doc-version.mjs` 维护：`gen` 打印 / `apply` 更新本节 / `check` 查漂移（git log 聚合版本表）。

<!-- dshgp-version:start -->
## 版本列表

| 版本 | 内容 |
|------|------|
| 1.11.0 | 审计规则按语言划分 + 检查器语言化（Python 落地）——①AST 精筛三豁免：magic-number 豁免 Python 枚举成员/i18n 键与路由路径（repeated）/文档示例凭据（placeholder-credential）；②检查器 Python 化：min-length 认 def/name=、func-lines 统一走 funcRangesAst（合并 Python 缩进函数范围）、complexity 行级分支统计、nesting 行级缩进统计、magic-number 全大写常量豁免；③新增 audit-rules-python.yml（python/* 规则），nodejs 的 6 条语言无关规则 exts 移除 py（让位）；④cli.mjs 结构化减重（798→309 行）；审计长尾优化（大鱼函数拆分 + dsh-skip-complexity 豁免标记 + docs-score 版本宿主比对 + 提交审计 --no-index + residue 补 io-risk），警告 136→123；文档集版本不一致误报消除；新增重复代码检测规则 + scan-version 分体式适配 |
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
