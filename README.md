# dsh-git-push

DSH（DeepSeek Harness）git 自动提交推送插件。把「扫描仓库 → **审计** → 一键 commit + push → **自动维护 dsh-repo-index 源码索引** → **敏感字段文件自动 .gitignore**」固化为 agent 工具与 HTTP API，**执行零 token 消耗、确定性输出**（相比每次让 AI 手敲 git 命令）。**默认走 api.github.com**（clone / push / 建仓 / 可见性 / 打 tag）；**token 无效（401）时 push 回退 ssh.github.com:443**。禁止直连 github.com、codeload.github.com。

## 目录

- [架构设计](#架构设计)
- [文件目录结构及作用](#文件目录结构及作用)
- [启动脚本](#启动脚本)
- [API 总览](#API-总览)
- [版本列表](#版本列表)
- [注意事项](#注意事项)
- [开发计划 / 疑难杂症](#开发计划--疑难杂症)

## 架构设计

- **分层**：`lib/core.js` 纯函数核心（不依赖 ctx，可独立单测）+ `lib/index.js` 插件装配（工具注册 + HTTP API + 审计门禁接线 + repo-index 维护）
- **门禁链**：`commitWithAudit` = README 预览 → L0 静态审计（可选 L1 LLM）→ 拦截判断 → `commitAndPush`（npm 屏蔽 → 敏感字段扫描 .gitignore → add → commit → push → repo-index 更新）
- **推送通道（v1.18.3）**：默认 **api.github.com Git Data API**（blob → tree → commit → ref）；无 token / 401 Bad credentials 时回退 **ssh.github.com:443**（插件配置目录 `git-push/` 下 SSH 私钥）。禁止 `git push github.com` / HTTPS
- **可执行位 / 属主（v1.18.4 / v1.32.0）**：启动写 `git config --global core.filemode false` 与 `safe.directory=*`；每次 git 带 `-c core.filemode=false -c safe.directory=*`，CIFS 权限与属主噪声不进提交
- **审计体系**：L0 静态（语法/JSON/YAML/敏感信息/凭据/大文件/debugger/文档对话类措辞/硬编码路径与局域网 IP）+ **代码质量维度（v1.39.0，依据 `docs/code-quality-checklist.yaml`：函数行数/静默catch/async同步阻塞/测试覆盖）+ 0-100 评分与 A-D 等级**（`quality` 字段，v1.41.0 起如实标注评分口径）+ L1 LLM 深度审查（可选，diff 喂便宜模型）；豁免类型 = 说明类（示例假凭据）+ 备份类（exemptRepos 白名单；硬编码规则不跟私有库豁免）+ json 注释行豁免（v1.41.0：`.json` 内 `//` 注释行豁免**隐私入库类**规则——secret/credential；措辞/对话/质量不豁免）
- **规则包化（v1.47.0）**：审计规则数据全部外置为 **YAML 规则文件**（`lib/audit-rules/audit-rules-{nodejs,frontend,comment}.yml`，四份含 template 模板默认不加载；归属 DeepSeek + 用户自定义），代码只保留引擎逻辑（`lib/rule-packs.js` 装载/校验/编译）。**顺序装载、后覆盖前**：`config.auditRuleOrder` / `auditRuleset`（逗号分隔槽位）控制加载顺序，同 id / pattern 后加载覆盖先加载；severity 映射 `error→blocker(拦截)` / `warning→warning(提醒)` / `info→pass`。**权重可调（v1.47.0 侧边栏）**：comment.yml 黑名单权重 ≥40 进门禁措辞 blocker，`auditRuleWeights` 配置写回覆盖（不影响 YAML 本体）。**私密拦截（v1.48.0 强制槽位）**：`audit-rules-private.yml` 为**强制加载**槽位（不受 `auditRuleOrder` 影响，永远末尾合入优先级最高）——扫描 `git ls-files` **全量跟踪文件**（不依赖 diff），命中私钥/token 类文件时按远端可见性分级：**public → blocker 拦截**（私密文件已可被任何人获取）、**private/unknown → warning 提醒**；`code_audit` / `audit_full_scan` 工具与 `/api/git-push/audit?ruleset=` 支持按调用传槽位顺序临时换装；审计结果带 `ruleset` 溯源。旧 JSON 规则包（eightfs.rules.json）已删除
- **用户门禁（v1.40.0 随插件内置）**：开发者特殊要求清单内置为 `lib/user-requirements.json`（归属 EIGHTfs），提交前逐条核对，未核对拦截（requirementsConfirmed 机制）；可放 `<插件配置目录>/requirements.json` 外挂他人清单
- **设置双位 UI（v1.46.0 起 / v1.49.0 重构）**：①`settings.plugin.item` 插件配置卡（折叠）— v1.49.0 起**只保留 token / SSH key / 登录信息三块**的填写与检测保存；②`settings.section` 侧边栏独立页（v1.46.0 新增入口，v1.49.0 重新设计）— **不复用折叠卡**，平铺展示：顶部登录信息**只读**（不提供填写）+ 引导条「去插件配置填写 →」，下方高级设置（注入三开关 / 自定义忽略 / 规则引擎槽位排序+权重滑块 / 提交历史查看器入口）即时保存；两处共享同一 controller / store，状态一致
- **设置页凭据（v1.20.0 / v1.40.0）**：设置 → 插件 → 插件配置 →「Git 提交推送」填 token；写入插件配置目录 `git-push/github-token`（0600），secret 字段不进 settings.yaml 明文。点「检测可用」时公钥绑定先读 `/user/keys`，无权则 SSH 实测 `ssh.github.com:443`

## 文件目录结构及作用

| 路径 | 作用 |
|---|---|
| `lib/core.js` | 纯函数核心门面（v1.42.0 拆分）：re-export 下方功能模块的 runGit / commitAndPush / scanRepos / auditRepoPath / scanSensitiveFiles / ensureSensitiveIgnored / resolveGitToken / ensureRemoteRepo / pushViaApi / genReadme / rebuildHistory / credentialsDir / maskRemoteUrl / loadRequirements 等，导出面与拆分前一致 |
| `lib/git-core.js` | git 基础执行（v1.42.0 拆分）：runGit / gitRaw / 全局配置（filemode false / safe.directory=*） |
| `lib/github-api.js` | GitHub API 访问（v1.42.0 拆分）：token 解析 / pushViaApi / 可见性 / 账号检查 / SSH 密钥 |
| `lib/repo-scan.js` | 仓库扫描（v1.42.0 拆分）：scanRepos / readExtraReposFile / 变更统计 |
| `lib/ignore-scan.js` | 敏感文件与 .gitignore 维护（v1.42.0 拆分）：scanSensitiveFiles / ensureSensitiveIgnored |
| `lib/commit-push.js` | 提交推送编排（v1.42.0 拆分）：commitAndPush 步骤拆分（预检 / 忽略 / add+commit / push / remote heads） |
| `lib/token-credentials.js` | 凭据持久化（v1.42.0 拆分）：credentialsDir / token 与 SSH 公钥落盘 / requirements 清单 |
| `lib/workspace-context.js` | 环境注入（v1.42.0 拆分）：工作目录映射 / 工具安装路径 / tools-index 同步 |
| `lib/version-history.js` | 重建历史（v1.42.0 拆分）：rebuildHistory（fresh/squash-bugfixes/drop-versions）+ 身份兜底提交 |
| `lib/readme-gen.js` | README 模板生成（v1.42.0 拆分）：genReadme + 版本表构建 |
| `lib/remote-repo.js` | 远端仓库管理（v1.42.0 拆分）：ensureRemoteRepo 建仓 / cloneViaApi（api.github.com Git Data API） |
| `lib/plugin-paths.js` | 插件根路径（v1.42.0 拆分）：PLUGIN_ROOT |
| `lib/index.js` | 插件装配调度器（v1.42.0 拆分）：apply 只负责按序注册；各功能在 plugin-*.js |
| `lib/plugin-config.js` | 插件配置（v1.42.0 拆分）：Config schema + 设置命名空间 + 插件名 + textRender |
| `lib/plugin-setup.js` | 插件初始化（v1.42.0 拆分）：resolvePluginEnv（配置规范化/规则包装载/comment-wording 解析）+ 设置页注册 |
| `lib/plugin-context-inject.js` | 上下文注入（v1.42.0 拆分）：systemPrompt 三段（功能目录/README 检查/环境注入）+ agent/pre-step（skill/repo-index） |
| `lib/repo-index-sync.js` | dsh-repo-index 自动维护（v1.42.0 拆分）：推送成功后重建索引 JSON |
| `lib/plugin-audit.js` | 审计服务（v1.42.0 拆分）：auditRepoPath（可见性定拦截力度）/ fullScan 全仓扫描（v1.43.0）/ isUserRepoPath |
| `lib/plugin-commit-flow.js` | 提交流程（v1.42.0 拆分）：previewReadme + commitWithAudit（审计门禁编排） |
| `lib/plugin-push-permit.js` | 推送许可（v1.42.0 拆分）：turn/end 防抖检测 → 自动 commit+push（带审计） |
| `lib/plugin-http.js` | HTTP API（v1.42.0 拆分）：/git-push/viewer + /api/git-push/* 路由 |
| `lib/plugin-tools.js` | agent 工具（v1.42.0 拆分）：11 个 defineTool 注册 |
| `lib/client.js` | 浏览器半侧：设置 → 插件 → 插件配置 卡片（填 GitHub token + 打开提交历史查看器入口） |
| `lib/viewer.js` | 提交历史查看器（v1.24.0 整合 git-commits-viewer）：只读数据层 getCommitHistory / getCommitDiff + 页面渲染 renderViewerPage（零外部资源，多语言 + 手动选择本地仓库） |
| `lib/viewer-locales.js` | 查看器多语言配置文件（v1.25.0）：zh/en 字典 + 默认中文；新增语言 = 加一个键集合一致的语言对象 |
| `lib/permit.js` | AI 回复推送许可（v1.24.0 整合 dsh-task-completion）：完成标记检测纯函数 + JSON 文件状态持久化（`.dsh/git-push-permit.json`） |
| `lib/audit.js` | 审计引擎（v1.41.0 规则包化）：消费规则包编译产物跑 L0 静态检查；引擎保留结构型检查（语法/JSON/YAML/二进制/npm/debugger/TODO/console/硬编码正则），规则数据零硬编码 |
| `lib/full-scan.js` | 全仓 AI 对话残留注释扫描引擎（v1.43.0 附属能力）：extractComments 行锚定注释提取 / scoreComment 黑加白减评分 / fullScanRepo 只读全仓报告（markdown 表格） / listTextFiles；黑/白名单与阈值来自规则包 `fullScan` 段 |
| `lib/rule-packs.js` | 规则包装载器（v1.41.0）：stripJsonComments / validateRulePack / loadRulePack（builtin/file/url 三来源）/ compileRulePack；非法 pattern 降级记 errors 不崩溃 |
| `lib/audit-rules/audit-rules-*.yml` | 审计规则 YAML 文件（v1.47.0 替换 JSON）：`nodejs` 20 规则 + 7 凭据翻译 / `frontend` 19 规则 / `comment` 关键词权重（黑 22 / 白 22，权重 ≥40 进门禁）/ `template` 空模板默认不加载 / `private`（v1.48.0）私密文件拦截清单（强制加载槽位，不可经 auditRuleOrder 移除）；顺序装载后覆盖前 |
| `lib/repo-index.js` | dsh-repo-index 索引生成/同步 |
| `lib/llm.js` | L1 LLM 深度审查调用 |
| `skills/dsh-git-push.md` | 插件使用手册 skill（推送到会话内可按需加载） |
| `skills/git-workflow-gitpush/` | git 工作流 skill（v1.40.0 自同级仓迁入：提交检查点/重建历史/API-only 等 16 个 .md + README） |
| 插件配置目录 `DSH_HOME/git-push/` | 本机私有数据（v1.40.0 自同级仓收敛）：github-token / SSH 密钥（0600）/ dsh-repo-index.json / tools-index.md / 可选 requirements.json 覆盖清单；不入 git |
| `docs/` | 架构图、开发文档、工作进度看板等 |
| `test/test-*.mjs` | 单测（core / audit / rule-packs / apply / repo-index / viewer / permit / rules / env-inject / quality），node:test 零依赖 |

## 启动脚本

```bash
# 插件随 DSH 主实例自动装载（cordis.patch.yml insert），无需单独启动
curl -s http://127.0.0.1:3083/api/git-push/status   # 验证加载
node --check lib/core.js && node --check lib/index.js  # 改代码后语法自检
node test/test-core.mjs && node test/test-audit.mjs && node test/test-repo-index.mjs && node test/test-rules.mjs && node test/test-env-inject.mjs  # 单测（含硬编码路径/IP；test-apply 需 DSH 运行时依赖）
```

## 独立 CLI（脱离 DSH 运行）

v1.44.0 起引擎层（core/audit/rule-packs/full-scan/quality/repo-index 纯函数模块）可脱离 DSH 直接使用：

```bash
node cli.mjs audit /path/to/repo              # L0 静态审计（blocker 拦截退出码 2）
node cli.mjs full-scan /path/to/repo          # 全仓 AI 对话残留注释扫描（只读表格报告）
node cli.mjs commit /path/to/repo -m "msg"    # 审计门禁 → 提交（默认不 push；--push 推远端；--req-confirm 过门禁）
node cli.mjs scan /path/to/root               # 扫描目录下 git 仓库与变更
node cli.mjs ruleset builtin                  # 规则包自检（校验+编译+规则计数；作者工具）
```

- 通用选项：`--json`（原始 JSON）/ `--ruleset <builtin|本地路径|http(s)://>`（临时换包）/ `--fail-on-warn`（full-scan 有⚠时退出 3，CI 用）
- 退出码：0 成功 / 1 用法错误 / 2 拦截或失败 / 3 full-scan 警告
- 零第三方依赖（Node ≥18）；L1 LLM 深度审查、设置页、HTTP API、推送许可是 DSH 接线层专属，CLI 不含
- 发布为 npm 包后可 `npx git-sluice full-scan <repo>`（bin 字段已配）

## API 总览

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/git-push/status` | GET | 插件状态（版本 + 配置 + 审计开关 + repoIndex + git 版本） |
| `/api/git-push/scan` | GET | 扫描全部仓库状态 |
| `/api/git-push/audit?repo=<路径>&llm=true` | GET | 审计指定仓库（llm=true 追加深度审查） |
| `/api/git-push/sensitive?repo=<路径>` | GET | 手动扫描仓库含敏感字段的文件 |
| `/api/git-push/commit` | POST | `{repo, message, push?, dryRun?, audit?, llmAudit?}` 审计通过后一键提交推送 |
| `/api/git-push/remote-create` | POST/GET | 按项目文件夹创建远程仓库（私有/公开 + 设置 origin） |
| **`/git-push/viewer`** | GET | **提交历史查看器页面**（v1.24.0，只读；设置 → 插件配置 → Git 提交推送 卡片可进入；零外部资源） |
| `/api/git-push/repos` | GET | 查看器用：扫描仓库（`root` / `paths` / `extraReposFile` 可选覆盖） |
| `/api/git-push/commits?repo=<name或path>&limit=100` | GET | 查看器用：仓库提交历史（含每文件 numstat 统计） |
| `/api/git-push/diff?repo=&commit=&file=` | GET | 查看器用：指定提交单文件 diff（行级 JSON；根提交自动回退 git show） |
| `/api/git-push/permit/status` | GET | 推送许可状态（AI 回复 ✅ 是否自动 commit+push；默认关闭） |
| `/api/git-push/permit/config` | POST | `{pushOnComplete: true/false, pushScope?}` 切换推送许可（默认关，绝不自动推） |
| `git_clone`（agent 工具） | — | 远端 clone 只走 api.github.com Git Data API（git/trees + git/blobs，不下 tarball；/tmp 中转建仓，兼容 CIFS；自动探测默认分支） |

**agent 工具**：`git_scan` / `git_commit_push`（含 requirementsConfirmed 参数）/ `code_audit` / `git_gen_readme` / `git_rebuild_history` / `git_remote_create` / `git_set_visibility` / `git_clone` / `push_permit_status` / `push_permit_config`（前 8 个详见 dsh-git-push skill 手册）

**配置键**（cordis.patch.yml insert config）：`workspaceRoot` / `extraRepos` / `depth` / `githubOwner`（v1.40.0：默认 GitHub owner，兜底 EIGHTfs）/ `auditEnabled` / `blockOn` / `auditRuleset`（v1.47.0：审计规则 YAML 槽位顺序——`''`=默认 `nodejs,frontend,comment`、可写逗号分隔槽位如 `comment,nodejs`；template 槽默认不加载，显式列出才加载）/ `auditRuleOrder`（v1.47.0：侧边栏可排序的槽位顺序数组，优先于 auditRuleset）/ `auditRuleWeights`（v1.47.0：侧边栏「调权重」写回——`{blacklist:{pattern:weight}}`，权重≥40 进门禁 blocker）/ `llmAudit` / `llmAuditProvider` / `llmAuditModel` / `maxDiffBytes` / `repoIndexEnabled` / `repoIndexTokenPath` / `repoIndexSyncTarget` / `repoIndexLocalOnly` / `exemptRepos` / `pushScope` / `commentWordingEnabled` / `commentWordingCustom` / `commentWordingRulesFile` / `commentWordingRulesUrl` / `envInjectionEnabled` / `envInjectionTools` / `injectFullSkill`（v1.28.0：pre-step 注入 skill 全文，默认 false 只列目录清单；v1.40.0 起来源 = 插件 skills/ + 技能仓库 git-workflow）/ `injectRepoIndexFull`（v1.35.0：注入 dsh-repo-index.json 正文，默认 false 只注入文件名）/ `customIgnorePatterns`（v1.28.0：自定义忽略 pattern 逗号/换行分隔，提交时自动写 .gitignore）/ `commitMessage`（自动推送提交信息，默认 `chore(ai): 任务完成自动提交`）。注：功能说明书经 systemPrompt 只注入**精简目录**（v1.32.0）；完整 `skills/dsh-git-push-functions.md` 按需加载。环境注入仍走系统提示词通道。

## 版本列表

| 版本 | 内容 |
|---|---|
| **1.55.0**（当前） | **目录结构规范 yml（本地定制版 + 统一单数机器校验）**：①**取舍结论定稿为 audit-rules-structure.yml**（用户指示「保持现状，制定成目录结构 yml，单复数统一单数」）：基于 DeepSeek《项目目录结构规范（最小通用版）》逐条对照本地项目讨论后定稿——`decisions` 段记录 8 项取舍（不引入 src/（纯 JS 无编译，lib/ 即源码）；lib/ 保持 DSH 插件惯例；tool/ 不拆（cli.mjs 根级 + lib/plugin-tools.js 够用）；test/ 平铺不分层（14 个 test-<module>.mjs）；docs/ 存量复数保留、新增目录一律单数；无 script/config/dist/log 空目录；skills/ 保留为 DSH 注入层；client/ 不独立（DSH 命名空间固定））+ `principles`/`directory_roles`/`dependency_rules`（core.js 门面 0 import 等价 shared 层、业务模块不依赖装配层、规则数据驱动）；②**path-regex 新规则类型**：`lib/rule-packs.js` 编译 `kind: path-regex`（对文件路径校验而非新增行），`lib/audit.js` checkStyleRules 加 path-regex 分支——`structure/dir-singular` 规则（warning 不拦截）命中复数目录 `tools/ tests/ scripts/ configs/ libs/ logs/`（docs/ 存量例外不报）；新增槽位动态发现自动生效（RULE_SLOTS 现 9 个：comment,dsh,frontend,nodejs,npm,private,structure,template,version）；执行矩阵 8/8（tools/tests/scripts 命中，docs/lib/test/tool/根级豁免）；test-style-rules +4 断言（17/0）；全量回归 481/0（11 套件）；版本 1.55.0 + README 同步 |
| **1.54.0**（当前） | **YAML 检查双模式（默认真实解析）+ 邮箱隐私入库拦截 + 真实邮箱清理**：①**yamlCheckMode 配置化**（用户指示「希望默认 yaml 解析，做成设置侧边栏下拉」）：新增 `yamlCheckMode` 配置（默认 `js-yaml` 真实解析器 / `heuristic` 宽松启发式兜底），`lib/audit.js` 拆 `yamlCheckJs()`（js-yaml load，捕获块标量/缩进/引号错误，性能实测 +0.05~0.5ms 可忽略）+ 保留原 `yamlCheck()` 启发式，`auditRepo`/`auditFile`/`buildAuditContext` 参数穿透 yamlMode；`lib/plugin-setup.js` env 注入 + settings watch 运行期即时生效；`lib/client.js` 规则引擎卡新增「YAML 解析方式」下拉（js-yaml 真实解析 / 宽松启发式）+ 即时保存；双模式实测 5/5：块标量内容 js-yaml 通过/heuristic 误报、缩进错误 js-yaml 捕获/heuristic 漏报；②**邮箱隐私拦截**（用户指出示例用了真实邮箱）：新增 `secret-email` 规则（error）——真实邮箱入库 blocker（豁免 example.com / users.noreply.github.com / git@github.com 与 git@ssh.github.com SSH 地址 / ghp_ 等 token 前缀 / .local/.lan/.internal/.test 本地虚拟域；命中矩阵 11/11）；private 槽位加 `**/*@*.{md,txt,js,json}` 邮箱形态文件名模式；③**真实邮箱清零**：client.js SSH 邮箱提示与 github-api.js 注释里的真实邮箱改占位符 your-name@example.com，全仓扫 0 残留；rule-packs/cli 断言更新（secret 3→4）；全量回归 476/0；版本 1.54.0 + README 同步 |
| **1.53.0**（当前） | **git_gen_readme 模板 yml 化 + npm 发布 files 白名单修复**：①**README 模板本体收进 yml**（用户指示「git_gen_readme 也 yml 化」）：新增 `lib/readme-templates/readme.yml`（metadata + header 封面区 + sections 章节列表，title/body 结构，{{name}}/{{description}}/{{toc}}/{{versionTable}} 占位符原样保留）——改章节结构/加章/调序只改 yml 不动代码（与审计规则 yml 同思路）；`lib/readme-gen.js` 新增 `loadReadmeTemplateYml()`/`renderReadmeTemplateYml()`（header + sections → markdown 模板文本，## 章节自动生成、toc 同步），`resolveReadmeTemplate` 优先级改为 template/README.md（用户自定义整份 md）> yml 模板（lib/readme-templates/*.yml，source 显示 yml 路径）> 代码兜底 DEFAULT_README_TEMPLATE；genReadme 端到端验证：占位符替换/版本表 git log 组/目录锚点全正常；②**npm files 白名单两处缺失修复**（v1.51 npm 审计标记的硬伤）：`"template"`（不存在）→ `"lib/readme-templates"`、`"audit-rules"`（错路径）→ `"lib/audit-rules"`——npm pack 包内规则与模板齐全；test-core 132/0（resolveReadmeTemplate source 断言接受 yml 来源）；全量回归 476/0；版本 1.53.0 + README 同步 |
| **1.52.0**（当前） | **槽位动态化（配置控制，不再代码写死）+ 版本控制审计规则槽位**：①**槽位动态发现重构**（用户要求「怎么是代码写死的，要动态的配置控制」）：`lib/rule-packs.js` 新增 `discoverRuleSlots()`/`getRuleSlotMeta()`——扫描 `audit-rules/*.yml` 自动得到槽位清单 + 显示名（读 yml metadata.name），`RULE_SLOTS`/`DEFAULT_RULE_ORDER` 由硬编码数组改为动态结果；实测临时放 `audit-rules-release.yml` → 槽位自动出现（含中文显示名）+ 规则自动编译进 styleRules，删除即恢复，**加新规则零代码改动**；`plugin-config.js` Config 加只读 `ruleSlotMeta` 字段 + `plugin-setup.js` registerSettings 初始 entry 注入动态元数据（client 拿不到文件系统，经 config snapshot 读取）；`lib/client.js` 规则卡 SLOT_NAMES 改从 `state.ruleSlotMeta` 动态读（缺省回退内置映射），默认顺序动态构建（排除 template/private）、存量排序自动补新槽位；cli.mjs `ruleset` 校验用 RULE_SLOTS 过滤自动生效；测试动态化（不再写死槽位数/顺序，改断言发现机制 + 核心槽位存在性 + 相对顺序），test-rule-packs 55→65/0；②**版本控制审计槽位**（versioning-rule 落地）：新增 `lib/audit-rules/audit-rules-version.yml`（9 条正则，X.Y.Z 三段、禁止 0.x、tag vX.Y.Z 格式、提交即存档、README 版本记录同步；权威源 skills/git-workflow-gitpush/versioning-rule.md）+ 把该 versioning-rule.md 加入 package.json dsh.skills 声明（此前从未加载，git-workflow-gitpush/ 子目录 16 个 skill 都不在清单）；全量回归 476/0；版本 1.52.0 + README 同步 |
| **1.51.0**（当前） | **npm 插件发布审计规则槽位（默认加载）**：新增 `lib/audit-rules/audit-rules-npm.yml`，8 条正则规则，专扫 package.json / .npmrc（引擎 v1.51.0 起 styleRules regex 支持 per-rule `exts` 目标文件类型 —— json/npmrc 默认不在 styleCode，npm 规则显式放行这两个类型，不误伤代码文件）——①发布清单：files 可疑条目（audit-rules 应写 lib/audit-rules）/files 漏 lib 入口（error）；②依赖声明：`*` 通配版本（error）/ js-yaml 未声明；③凭据防泄漏：.npmrc _authToken（error，js-yaml 缺失场景同源）；④发布语义：private:true 与发布矛盾 / license 缺失 / repository 建议；实测：本仓库 package.json 命中 8 条（files-missing-lib、dependency-star-range 等正是此前诊断的 npm 硬伤），坏 .npmrc 命中 authToken blocker×2；`lib/rule-packs.js`：RULE_SLOTS 加 npm（6→7）+ DEFAULT_RULE_ORDER 改 nodejs,frontend,comment,dsh,npm（默认加载、可排序/移出；template 不默认、private 仍强制末尾）；`lib/client.js` 规则卡 SLOT_NAMES 加 npm 行 + 存量排序自动补 dsh/npm；测试：test-rule-packs 55/0 + 端到端命中验证；版本 1.51.0 + README 同步 |
| **1.50.0**（当前） | **dsh 插件专属审计规则槽位（默认加载）**：新增 `lib/audit-rules/audit-rules-dsh.yml`，7 条正则可执行规则（全部接入引擎 styleRules 逐行扫描新增行）——①依赖红线（error，装载闭包只含 @deepseek-ai/*）：禁止裸名导入 cordis/schemastery；②工具契约（error）：output.render 空实现 / Client 半部 require Node 内置模块；③配置安全（warning）：token/secret/apiKey/password 字段未标注 role('secret')；④patch 语义（warning）：cordis.patch.yml insert 行 id 唯一性 / ⑤Client 入口统一 ModuleLoader 契约；依据官方文档（deepseekdocs.com 插件解剖：插件=cordis 插件+package.json dsh 字段、capability 安全、依赖解析、patch 覆盖语义）；`lib/rule-packs.js`：RULE_SLOTS 加 dsh + DEFAULT_RULE_ORDER 改 nodejs,frontend,comment,dsh（默认加载、侧边栏可排序/移出；template 仍不默认，private 仍强制末尾）；`lib/client.js` 规则卡 SLOT_NAMES 加 dsh 行 + 存量用户已排序规则自动补 dsh 末尾；测试：test-rule-packs 54/0（槽位 6/默认顺序/强制末尾/files 4 份/空配置 order.length 5），端到端实测裸名导入 cordis → style:dsh/import-bare-cordis blocker 命中；版本 1.50.0 + README 同步 |
| **1.49.1**（当前） | **插件配置卡默认展开 + 移除无效跳转按钮**：①客户端设置面板无跨 section 跳转 API（SettingsRoot 的 activeId 为组件本地 state，无服务/事件暴露），侧边栏「去插件配置填写 →」按钮无法跳转 → 移除按钮，改为纯文本引导（sectionGuide + sectionGoConfigHint 提示填写入口路径）；②插件配置卡 `open` 初始值 false → **true（默认展开）**——填写处（token / SSH key / 保存按钮）刷新后直接可见，此前默认收起 body 折叠隐藏填写处，易误判「填写被删」；仍可点头部手动收起；③清理 .dshgp_section_go CSS 与 sectionGoConfig i18n（zh/en）残留 |
| **1.49.0**（当前） | **侧边栏独立 UI + 插件配置精简**：①**插件配置卡（settings.plugin.item）只保留 3 块**——token 填写 / SSH key（生成+公钥）/ 登录信息（检测结果）+ 保存·检测·放弃按钮，注入开关/忽略规则/规则引擎/查看入口四块移出；②**侧边栏设置独立页（settings.section）重新设计平铺 UI**，不复用插件配置折叠卡——顶部「登录信息（只读）」块（复用 AccountTop 只读展示，不提供填写）+ 引导条「去插件配置填写 →」（含路径提示），下方「高级设置（即时保存）」承载注入三开关 / 自定义忽略 / 规则引擎（槽位排序+权重滑块） / 提交历史查看器入口；③两处仍共享同一 GitPushCardController / store（状态一致），折叠卡形态仅保留在插件配置位；被移出的高级组件函数体原样保留（注释声明，防改主意）；④新增 .dshgp_section* 平铺样式 + section* i18n 文案（zh/en） |
| **1.48.0**（当前） | **私密拦截审计（强制槽位）**：①新增 `audit-rules-private.yml` 私密文件清单（私钥 id_ed25519/id_rsa/*.pem/*.key / token github-token/.git-push-token / .env / data/sensitive / .ssh / .dsh/git-push / .npmrc 等 12 条），**强制加载**——`private` 槽位永远末尾合入（优先级最高），用户无法经 `auditRuleOrder`/`auditRuleset`/`resolveRulesetChoice`/`loadRulePack` 任何路径移除（四处统一收口）；②**存量级扫描**：`scanPrivateFilesForVisibility` 跑 `git ls-files` 全量跟踪文件（不依赖 diff，历史已入库私钥本次未改也感知），按远端可见性分级——**public → blocker 拦截提交**、private/unknown → warning 提醒；③`auditRepo` 新增 `visibility` 参数（plugin-audit.js 传已探测值，早退/正常路径统一合并 + `summaryBlockerBlocks` 统一 blocked 判定）；④侧边栏规则卡显示「🔒 私密文件拦截（强制加载）」（不可排序）；⑤测试：test-private-files 新增 11/0（三态 + 全量 glob + 无 diff 早退分支）、test-rule-packs 53/0（强制槽位四处收口断言） |
| **1.47.0** | **审计规则引擎 YAML 化 + 权重可调 + 侧边栏控制**：①规则形态从 JSON 规则包**替换为 YAML 规则文件**（`lib/audit-rules/audit-rules-{nodejs,frontend,comment,template}.yml`，template 是空模板默认不加载），`lib/rule-packs.js` 全部重写（装载/校验/编译/缓存/权重覆盖）；severity 映射 `error→blocker` / `warning→warning` / `info→pass`，Puppeteer 动态检测默认关；②**顺序装载后覆盖前**：`auditRuleOrder` 数组 / `auditRuleset` 逗号分隔槽位控制顺序，同 id/pattern 后加载覆盖先加载；③**权重可调**：comment.yml 黑名单权重 ≥40 进门禁措辞 blocker、<40 只参与 full-scan 评分；侧边栏设置卡新增「规则引擎（YAML）」区块（槽位排序 ↑↓ + 关键词权重滑块），写回 `auditRuleWeights` 配置即时生效（不改 YAML 本体）；④引擎侧 `checkStyleRules` 执行器落地（regex/min-length/max-lines/max-complexity/min-occurrences 各型真实检出，html/css 前端规则纳入可执行范围，ignore 豁免 styleRules，pass 级不产 findings）；⑤历史门禁全量平移：9 条 comment-wording 措辞 + 5 条 doc-conversation 规则翻译进 comment.yml（wordingPatterns 10 条 / docConvPatterns 5 条恢复 blocker 门禁）；⑥测试：test-rule-packs 45/0、test-audit 76/0、test-style-rules 新增 13/0；CLI ruleset 命令改槽位顺序语义；旧 JSON 规则包删除 |
| **1.46.0** | **设置侧边栏独立页 + 独立 CLI 版本同步 + 引擎豁免正则修复**：①新增 `settings.section` 槽注册——「设置 → 侧边栏」出现 Git 提交推送独立页（此前只挂 `settings.plugin.item` 插件配置卡片位，侧边栏从来没有本插件入口；对照 dsh-skill-scoreboard 的 section 挂法），复用同一 `GitPushCard` + `GitPushCardController`（两处共享同一 store，状态一致），`SnapshotStore` 是裸 observable（subscribe/getSnapshot 无 selector hook）故用 `useSyncExternalStore` 自建 uSES 桥补 `useGitPushCard`、自取 `zh` 文案表补 `t`；原 `settings.plugin.item` 卡片保留（F5）；②`cli.mjs` VERSION 同步 1.46.0（上轮漏改）+ test-cli 断言同步；③修复 v1.45.0 删除 autoClean 时误伤 docs-conversation 的 skill 署名豁免正则（丢失 `用户原话|` 前缀致 4 项测试挂），补回并去除 docstring 重复行；④test-full-scan.mjs 夹具复原 + 加 `dsh-skip-sensitive` 文件头豁免（第 2 行，命中 hasFileHeaderExempt 前 3 行判定）——彻底免疫 autoClean 静默篡改
| **1.45.0** | **autoClean 废除（只警告不删改）+ full-scan 收尾行修复**：①废除提交前自动清理措辞（autoCleanCommentWording/cleanCommentWording 连同 WORDING_REWRITES 全链移除）——v1.28.1/1.27.0 两次事故复证实害（本次批次4 test-full-scan 夹具再被静默篡改），确立「只警告、不删改」总原则：提交审计扫**提交新增行**、fullScan 扫**全仓**，两通道皆只出警告报告；②措辞 finding message 去「提交时自动清理」过期承诺（改为手动改成中性描述）；③修复 full-scan 块注释收尾行（`*/` 纯闭合行）产出垃圾文本；④test-audit 清理函数 11 用例移除改审计语义断言（76/0），test-full-scan 夹具恢复 + 收尾回归（27/0） |
| **1.44.0**（当前） | **独立 CLI（脱离 DSH 运行）+ 更名候选 git-sluice**：新增 `cli.mjs` 零依赖 CLI（`audit` / `full-scan` / `commit` / `scan` / `ruleset` 五命令 + `--json`/`--ruleset`/`--push`/`--req-confirm`/`--fail-on-warn`，退出码 0/1/2/3），只 import 纯引擎模块（core/audit/rule-packs/full-scan/quality/repo-index）不 import lib/index.js 接线层——无 DSH 环境可完整跑静态审计/全仓扫描/门禁提交（L1 LLM 与设置页/HTTP/推送许可仍为 DSH 专属）；package.json 增加 `bin: git-sluice`；L1 LLM 无需改造（llm.js 本就只被接线层引用）；test-cli 8 断言（help/ruleset 解包计数/full-scan 表格/门禁拒绝与放行/真实落库） |
| **1.43.0**（当前） | **全仓 AI 对话残留注释扫描（附属能力，D5）**：①**分数制**——规则包 `fullScan` 段黑名单关键词加分（用户指示/原话/客户要求/request 等）、白名单保护词减分（ID/密码/token 等技术词），总分 ≥ `threshold`（默认 60）标⚠警告，规则包没配该段用内置缺省；②**只读不删码**——门禁侧同样只产出 `full-scan` warning 提示、不拦截不删码；③输出按分数降序的 markdown 表格，列出全部命中位置（文件:行号/分数/黑名单命中/白名单减分/文本）；④行锚定注释提取（只认行首 `//`/`#`/块注释/`<!--`，修复字符串 URL 误报），次级信号只认中文引号、版本号与日期不误报；⑤接入：新工具 `audit_full_scan`（repo+ruleset）+ `GET /api/git-push/full-scan?repo=&ruleset=` + 提交审计新增行注释评分 |
| **1.42.0** | **D1 函数拆分 + 文件级模块化（行为零变化）**：①index.js 巨型 apply（1183 行）按功能拆 9 个模块（plugin-config/plugin-setup/plugin-context-inject/repo-index-sync/plugin-audit/plugin-commit-flow/plugin-push-permit/plugin-http/plugin-tools），index.js 只留调度器，副作用注册顺序与拆分前一致；②core.js 2511 行拆 11 个功能模块 + 门面（导出面与拆分前完全一致）；③rebuildHistory/ensureRemoteRepo/cloneViaApi/buildRepoIndex/genReadme 等超长函数全部拆步骤函数，check-fnlen 全库清零（viewer.js 例外待后续重写）；④修复 v1.41.0 引入的 `log` TDZ 雷（apply 启动必崩，`const log` 提前到审计规则块之前）；⑤rebuildHistory squash/drop 分支提交补身份兜底（`-c user.name/user.email`，对齐 fresh 分支） |
| **1.41.0** | **审计规则插件化（规则包）**：①规则数据全部外置 `lib/audit-rules/eightfs.rules.json`（归属 EIGHTfs，支持 `//` 注释；secret×3/credential-file×2/credential-ref×2/comment-wording×9/doc-conversation×5/质量阈值 50-100），代码零硬编码规则；②新模块 `lib/rule-packs.js`：装载（builtin/file/url 三来源，url 8s 超时 2MB 上限）/校验（id 唯一/kind/level/正则可编译）/编译（非法 pattern 降级记 errors）；③`config.auditRuleset` 整体切换第三方规则包，`code_audit` 工具与 `/audit?ruleset=` 按调用临时换包，启动 url 包异步热替换；④json 注释行豁免（用户确立：豁免仅限隐私入库类——secret/credential-file/credential-ref；措辞/对话/质量不豁免），JSONC 文件解析容忍 `//` 注释；⑤审计结果带 `ruleset` 溯源（name/owner/version/source/counts/loadErrors）；⑥quality 评分如实标注口径（measured 5 维 vs fixedValue 5 维） |
| **1.40.0** | **废除同级仓 dsh-git-push-User，凭据/索引收敛插件自持**：①凭据存储改插件配置目录 `DSH_HOME/git-push/`（token/SSH 密钥 0600，`credentialsDir()`）；②repo-index JSON 与 tools-index.md 同步目标改插件配置目录；③开发者要求门禁随插件内置（`lib/user-requirements.json`，可用 `<配置目录>/requirements.json` 外挂他人清单）；④skill 注入源改插件 skills/（新增 `skills/git-workflow-gitpush/` 16 个工作流 skill）+ 技能仓库 ai-work-archive/skills；⑤安全加固：`findGitDirs` 改 spawnSync 数组参数（消命令注入）、`runGit` try/catch+maxBuffer、`readRepoStatus` origin URL 脱敏（`maskRemoteUrl`）、HTTP 请求体 5MB 上限、untracked 二进制/大文件跳过、`docs/code-quality-checklist.yaml` 权重补齐并随包分发；⑥owner 可配置（`config.githubOwner`）。删除 USER_REPO_*/resolveUserDir/userRepoCandidates/inspectUserRepo/scoreUserRepo/loadUserRequirements/ensureUserRepoSibling/createUserRepoTemplate 等 13 个同级仓符号 |
| **1.39.0** | **代码审计按 code-quality-checklist.yaml 增强质量维度**：新增 `lib/quality.js` 纯函数模块——①可读性：单函数 >50 行 warning / >100 行 blocker（func-lines）；②健壮性：空 catch 静默吞错（silent-catch）；③性能：async 路径 fs.*Sync 同步阻塞（sync-in-async）；④测试覆盖：源码变更但仓库无测试 → no-tests warning；⑤**0-100 评分 + A/B/C/D 等级**（按 yaml `dimensions_weight` 加权，`quality` 字段返回 score/level/dimensions/hasTests）。auditRepo 默认开启，`quality:false` 可关；auditFile 对 .js 变更文件逐文件检查，评分带 yaml 权重与等级描述。test-quality 39 项 + 全量回归绿（test-audit 保持 90 项，helper 默认关 quality 专注静态规则） |
| **1.38.0** | **移除设备/用户 json 上下文注入（原 v1.27.0 功能）**：凭据类信息注入不属于 git-push 插件的职责——git-push 只负责提交推送；删除 `buildDeviceUserInjection`（含 maskIp/maskName/maskEmail/maskCredentialFields 与 `agent/pre-step` 里的「本机设备/用户信息」注入块）。设备/站点导航信息如需注入，改由会话插件（dsh-session-conductor）模板注入或用户自行配置，git-push 不再内置。测试同步清理，全量回归通过 |
| **1.37.0** | **审计按远端可见性定拦截力度**：提交前审计先探测 GitHub 远端可见性（`detectRepoVisibility`，token 真校验）——**private 仓 blocker 全部降级为仅警告（blockOn=none，不拦截）**，敏感规则（secret/凭据/对话措辞）仍豁免；**public 仓保持原 blockOn 拦截**（敏感规则照常阻断）；**user 仓（`dsh-git-push-User` 或 `-User` 结尾）特殊照顾**：探测到 public 时自动 `setRepoVisibility` PATCH 改回 private 再继续（自动私有化），避免凭据仓意外公开。审计结果新增 `visibility` / `visibilityRisk` / `userRepoAutoFixed` 字段。探测失败（无 origin/无 token/API 失败）保守按 public 处理照常拦截 |
| **1.36.3** | **User 仓内置模板自动创建**：`dsh-git-push-User` 不存在（首次使用 / 无 token / 远端未建）时插件自动用内置模板建仓——README（用途说明 + 凭据位置表）+ 通用 .gitignore（token/ssh 私钥/clone 元数据/索引不入库）+ `<owner>/` 作者文件夹（owner 变量三级解析：origin → 目录名 → 兜底，不写死路径）+ git init 初始 commit；`<owner>/github-token`、`id_rsa` 等凭据合法位置确认（resolveGitToken/resolveUserSshKey/persist 已按作者文件夹读取）；模板 .gitignore 同时修复往已删目录重建残留的问题 |
| **1.36.2** | **User 仓选仓/Token 探测失效修复**：双副本场景下本地副本 `isSynced` 假象（HEAD 与本地缓存 origin refs 一致但从未 fetch）不再冒充官方仓——选仓新增 `tokenValid` 启发式（token 格式 + 长度 ≥40，失效/截断 token 的副本降权，+800 压过 isSynced 假象）；树内优先条件加 tokenValid；`resolveGitToken` 候选扩展到所有候选仓全列表；新增异步 `resolveValidGitToken`（逐个真校验 `/user`，跳过失效 token，push/索引/可见性探测/建仓/clone 等关键路径改用）。修复后所有 API push 不再因读到失效 token 报 Bad credentials |
| **1.36.1** | **①硬编码审计扫描范围开关**：设置 → 插件 → git-push 新增「硬编码全量扫」——不勾（默认）只扫新增/变更行；勾选后扫整个文件（含既有历史行），换机前排查存量死路径用，运行期即时生效。**②repo-index 可见性全「未知」修复**：索引生成自动用 resolveGitToken 探测的 token（不再依赖可选 repoIndexTokenPath），可见性查询按各仓 remote 的 owner 查（不再硬编码 EIGHTfs，非 EIGHTfs 仓库此前全查错） |
| 1.36.0 | **User 仓纯探测选仓（排除 NAS 旧副本）**：`dsh-git-push-User` 不在同级时，扫工作区/extraRepos 里同名 git 仓。多个候选按 git 比对——官方 remote 优先，**HEAD 与远程 origin refs 一致（isSynced）= 更接近远程默认选它**，再比显式配置/作者挂钩文件/提交数；不硬编码任何排除路径。workspaceRoot 树内只有「与远程一致的官方仓」才树内优先；树内无同步官方仓（如 workspaceRoot 指向 NAS 旧副本）则全池按 isSynced 比对。token / ssh key / skill / repo-index 按作者文件夹 `<owner>/` 布局读取（兼容仓根旧布局） |
| 1.35.0 | **repo-index JSON 注入会话**：md 表格已废弃，权威源是 `dsh-git-push-User/<owner>/dsh-repo-index.json`（推送成功后自动生成）。会话默认只注入文件名；设置「注入 repo-index JSON 全文」才注入正文。不再写 `.dsh/skills/dsh-repo-index.md` |
| 1.34.0 | **重建历史按意图**：`fresh` 当前文件树作为唯一提交，**不改** `package.json` 版本号；用 `checkout --orphan` 保留 remote/backup tag（不再 `git rm .git`）。`force=true` 才覆盖远端（API PATCH force + 不挂旧 parent；失败回退 `git push --force`）。工具描述与实现对齐。新增 skill `git-push-live-fix`：用插件时发现问题当场改，禁止默默手搓 git |
| 1.33.0 | **token 探测改同级仓优先 + SSH 优先 rsa**：设置页写入的 `dsh-git-push-User/github-token` 排在项目内残留 `.git-push-token` 之前。SSH 私钥探测改为 `id_rsa` 优先（设置页生成并已绑定），避免未绑定的 `id_ed25519` 抢先导致「SSH 未认证」 |
| 1.32.0 | **忽略属主/权限噪声 + 提交时 README 检查注入 + 功能说明书改精简注入**：每次 git 带 `safe.directory=*` 与 `core.filemode=false`；启动写全局 `safe.directory=*`（已有则跳过）。`git_commit_push` 返回 `readmeCheck`，系统提示词常驻「提交前核对 README」。功能说明书不再全文塞进系统提示词，只注入工具目录，完整 md 按需加载 |
| 1.31.0 | **硬编码路径/IP 审计**：L0 新增 `hardcode-path` / `hardcode-ip`——代码与 JSON/YAML 字面量写死本机绝对路径或局域网私网 IP 为 blocker，文档为 warning；不跟私有库豁免走。同步修掉插件自身 token 探测、clone 默认 dest、skills 目录探测三处死路径，用插件仓做狗粮测试 |
| 1.30.0 | **设置页开关即时生效修复 + 一键复制 SSH 公钥**：①修复「勾选注入全部 skill 内容（injectFullSkill）不生效」——此前设置页改动只有 token/sshPub 经 settings scope.watch 落盘，injectFullSkill / customIgnorePatterns 是插件启动时的一次性常量，勾选后 pre-step 注入仍是旧值；现 scope.watch 同步覆盖运行期变量，设置页改完**立即生效**（不用重启）；②「生成公钥」结果区新增**一键复制**按钮——navigator.clipboard 写入（secure context），失败自动兜底 textarea + execCommand('copy')，复制成功回显「已复制到剪贴板」 |
| 1.29.0 | **设置卡增强 + 推送后远端 ref 维护**：①「SSH 邮箱 + 生成公钥」——设置卡新增邮箱输入与「生成公钥」按钮，后端 `POST /api/git-push/gen-ssh-key` 执行 `ssh-keygen -t rsa -b 4096 -C <邮箱>`（同级仓 dsh-git-push-User 生成 id_rsa/id_rsa.pub，已存在拒绝、force 时先备份，公钥回显供复制去 GitHub 绑定）；②账号状态检测块置顶 + **每次展开设置卡自动跑一遍**（无需手动点检测）；③`injectFullSkill` / `customIgnorePatterns` 改即存后**即时回显「已保存并生效」**（4 秒消失）；④推送成功后自动 `git update-ref refs/remotes/origin/<branch>` 维护本地 remote-tracking ref（Git Data API 推送不更新本地 ref，现可 `git log origin/master`）+ 自动补 `github-ssh` 辅助 remote（`ssh://git@ssh.github.com:443/<owner>/<repo>.git`，本机可 fetch/pull；幂等不覆盖用户自设） |
| 1.28.1 | **功能说明书 + 环境注入改走系统提示词通道 + autoClean 豁免修复**：①新增 `skills/dsh-git-push-functions.md`（插件每个功能一份说明书），经 **systemPrompt.section 系统提示词通道**无条件全文注入每个会话——text 用函数动态读文件，不受「注入全部 skill 内容」设置影响（与 dsh-session-conductor 的 task-completion-report 同通道，order 990）；②**环境注入（工作目录映射 + 工具安装路径）由 agent/pre-step 迁移到 systemPrompt.section**（order 980，用户要求：注入用户环境和工具目录用系统提示词）——每步组装生效、60s 缓存防每步重新探测、缓存过期同步 tools-index.md；两仓 skill 注入（injectFullSkill 开关）与设备/用户 json 注入保持 pre-step user 消息不变；③修复 autoCleanCommentWording 不认 `dsh-skip-sensitive` 文件头豁免——测试文件把检测目标措辞当输入数据，每次 push 被自动清理导致 comment-wording 测试反复失效（v1.27.0 误删根因），现与审计检测同规则跳过豁免文件，test-audit 67 项稳定全绿 |
| 1.28.0 | **注入全文开关 + 自定义忽略 pattern + 注入处定位注释 + repo-index 不入库**：①设置 → 插件配置 新增「注入全部 skill 内容」开关（injectFullSkill）——勾选 = pre-step 向每个会话注入两仓（dsh-git-push/skills + dsh-git-push-User）全部 skill 正文（恢复 v1.23.x 时期 collectRepoSkillDocs + formatRepoSkillInjection 行为），不勾选（默认）= 只注入 skill 目录 + 文件清单省 token；②新增「自定义忽略文件」输入（customIgnorePatterns，逗号/换行分隔如 `*.bak*`）——commitAndPush 时自动追加到目标仓库 .gitignore（幂等，已跟踪文件自动 git rm --cached 解除跟踪，dryRun 只扫描）；③agent/pre-step 上下文注入入口加醒目注释块（搜「上下文注入」即可定位）；④dsh-repo-index.json 改为不入库（同级仓 .gitignore 忽略 + 解除跟踪，插件自动生成文件不再进 git） |
| 1.27.1 | **推送凭据定位修复**：resolveGitToken 支持 `dsh-git-push-User/<owner>/github-token` 子目录布局（v1.27.0 起 token/凭据 json 在 `<owner>/` 子目录，旧代码只查仓根导致命中失效旧 token 推送失败） |
| 1.27.0 | **设备/用户 json 脱敏注入 + 文档凭据引用审计警告 + repo-index 改 JSON**：①注入——`agent/pre-step` 追加「本机设备/用户信息」：读同级仓 `dsh-git-push-User/<owner>/devices/device-map.json`（设备地图）+ `user.json`（身份）全量注入；`devices/ssh-credentials.json`（设备 SSH 凭据）与 `websites/<站点>.json`（网站凭据按站点分文件）**只注入账号/站点清单，不注入密码明文**（明文注入会发给模型服务商+落会话日志），AI 需要真凭据时先告知用户再按需读文件；②审计——文档（md/txt）新增行出现旧凭据位置引用（`.ssh/credentials.md`/`data/sensitive/`/`sudo-key` 等）或凭据明文键值对 → `credential-ref` 警告，提示凭据统一存 `dsh-git-push-User` 内 json；③repo-index 权威源由 md 表格改 `dsh-repo-index.json`（owner 变量探测，兼容旧 md 解析），同步目标 `dsh-git-push-User/<owner>/dsh-repo-index.json |
| 1.26.0 | **规则配置化 + 环境注入**：①comment-wording 规则可自定义——设置 commentWordingCustom（JSON 文本）/ commentWordingRulesFile（本地路径或 http(s) URL 在线导入）/ `git_push_rules` 工具（show/export/import）+ `/api/git-push/rules` API；②环境注入——`agent/pre-step` 追加注入「工作目录映射（当前 cwd / 项目实际目录 / 父子目录树）+ 工具安装路径（python3/node/git/ffmpeg 等）」，工具清单同步到 `dsh-git-push-User/tools-index.md`，`envInjectionEnabled` / `envInjectionTools` 可关/自定义 |
| 1.25.0 | **查看器多语言 + 手动选择本地仓库**：①多语言配置化——全部 UI 文案抽到 `lib/viewer-locales.js`（zh/en 字典，键集合一致，页面注入后运行时切换 + localStorage 记忆），默认中文；②手动选择——侧边栏输入仓库路径或目录（支持 paths/root 两种只读扫描，复用 `/api/git-push/repos` 参数），手动仓库带「手动」徽标 |
| 1.24.0 | **整合 git-commits-viewer + dsh-task-completion**：①提交历史查看器——设置卡「打开提交历史查看器」入口，`/git-push/viewer` 页面（只读：仓库列表/提交历史/类型过滤/分页/单文件 diff；零外部资源；root/depth/extraRepos 复用插件配置；repo 参数精确匹配防任意路径）；②推送许可——`push_permit_status` / `push_permit_config` 工具 + `/api/git-push/permit/*`，AI 回复 ✅ 且许可开启时回合结束自动 commit+push（**走带审计门禁的 commitWithAudit**，默认关闭；状态持久化 `.dsh/git-push-permit.json`）。旧两仓已下线（无审计旁路/打开页面即 push 等缺陷不复刻） |
| 1.23.2 | core.js listVersionCommits：首个带版本号提交之前的提交归入 1.0.0，不再丢弃 |
| 1.23.1 | **SSH 绑定检测**：token 没有 `admin:public_key` 时 `/user/keys` 会 404，不再当成「未绑定」；改打 `ssh.github.com:443`，`Hi <login>!` 即视为已绑到该账号 |
| 1.23.0 | **README 模板在 User 仓**：`git_gen_readme` 读 `dsh-git-push-User/readme-template.md`（每人习惯不同）；没有才用插件内置骨架 |
| 1.22.0 | **强制读取两仓 skill**：`agent/pre-step` 注入 `dsh-git-push/skills` + `dsh-git-push-User` 全部 md（方案 A，不改框架） |
| 1.21.1 | 插件 skill 只写用法手册（面向所有克隆者） |
| 1.21.0 | **设置页检测可用**：对照 iwara/香蕉网，点「检测可用」调 `/user` 显示用户名/id/主页；SSH 公钥是否绑到该账号。**远端 3 次改表格**（# / SHA / 标题 / 时间） |
| 1.20.0 | **设置页填 GitHub token**（设置 → 插件 → 插件配置 → Git 提交推送）；**推送成功后回传远端最近 3 次**短 SHA / 标题 / 时间（`remoteHeads`）；收尾 skill 强制把这 3 条发给用户 |
| 1.19.0 | **收尾模板迁入插件 skill**：`skills/task-completion-report.md`（分隔线 + ✅ 任务完成 + 交付/验证/遗留）；✅ 即对本会话改过的仓 commit+push 授权；同级仓 `requirements.md` 第 8 条 |
| 1.18.4 | **忽略可执行位**：启动时 `git config --global core.filemode false`；每次 git 命令带 `-c core.filemode=false`。CIFS/trimafs 上 100644↔100755 不再进 status/commit |
| 1.18.3 | **token 无效回退 SSH**：push 默认仍走 api.github.com；无 token 或 401 Bad credentials 时改走 `ssh.github.com:443`（User 仓私钥），禁止 github.com HTTPS |
| 1.18.2 | 工作区干净但本地领先时继续 pushViaApi；userRepoCandidates 从 DSH_HOME 推导同级仓；tokenInfo 提到 push 块级作用域 |
| 1.18.0 | **User 仓离开插件目录**：开发者要求/凭据改到同级私有仓 `dsh-git-push-User`（与 `dsh-git-push` 并列）；启动时若缺失则 `git_clone`（api.github.com）拉到工作区同一层级；安装拷贝不再覆盖这份仓 |
| 1.17.0 | **所有功能默认且仅走 api.github.com**：①统一 `githubFetch`（hostname 硬闸 + 拒绝跟随 302，防 tarball 跳到 codeload）；②`git_clone` 改 Git Data API（git/trees + git/blobs base64，不再下 tarball）；③push 去掉 `git push origin` / HTTPS+token 回退；④`git_remote_create` / clone 后 origin 写成 `https://api.github.com/repos/{owner}/{repo}`；⑤repo-index 恢复命令改为 `git_clone` |
| 1.16.0 | **凭据迁移 User/ 目录 + 自动打 tag + 可见性切换**：①token/SSH 凭据自动从插件 `User/<用户名>/` 目录探测（不硬编码用户名/路径，git 忽略本机专用，替代 data/sensitive）；②`git_set_visibility` 工具——一键切换仓库公开/私有（PATCH /repos，改公开有风险提示）；③自动打 tag——dsh- 前缀项目 push 成功后自动打 `v<package.json version>` tag（Git Data API 建 ref，幂等，已存在跳过）便于官方发现 |
| 1.15.0 | git_scan 扫描路径自由配置：extraReposFile 配置文件（每行一个仓库路径，实时读取）+ 工具 root/paths 参数 + API 查询参数 |
| 1.14.0 | **敏感扫描豁免 + 根因修复**：①私有库豁免——GitHub 可见性=private 时跳过敏感字段自动 .gitignore（只扫描报告不写入）；②注释豁免——文件头/行内含 `dsh-skip-sensitive` 即跳过敏感扫描（审计 + 自动 gitignore 两处同认）；③根因修复——敏感字段值必须是「字符串字面量」（`password: "xxx"`），表达式/变量引用/文案拼接（`password: fn().value`、`"Cookie: " + x`）不再误报；④移除测试环境提交门禁（checkTestEnvCommitGate/isTestEnvHome） |
| 1.13.0 | **git_clone 工具（远端 clone 默认走 api.github.com）**：tarball 下载 → /tmp 中转建仓 → 整拷回 dest（兼容 CIFS）；自动探测远端默认分支 master/main；target 支持 owner/repo 或各类 URL |
| 1.12.2 | **分支免疫**：自动探测远端默认分支（GitHub 可能是 master 或 main）——请求分支在远端不存在且与默认分支不同名时自动改用默认分支（返回 branchAdjusted），杜绝误建错名新分支 |
| 1.12.1 | **修复 gitRaw maxBuffer（默认 1MB→128MB）**——超过 1MB 的二进制 blob（如 session .zstd 日志）读取出错致 API 推送失败 |
| 1.12.0 | **推送默认走 api.github.com**（Git Data API：blob→tree→commit→ref，复用远端 blob sha；github.com 直连被网络阻断仍可推）；API 失败/无 token 回退 git push origin；新增 pushViaApi / parseGithubOwnerRepo / gitRaw |
| 1.11.0 | **SSH origin + 本机只有 token 时 HTTPS+token 回退推送**（GIT_ASKPASS 注入，token 不进命令行；无 SSH 私钥也能 push） |
| 1.10.0 | **开发者特殊要求门禁（User 文件夹）**：`User/<owner>/requirements.md` 提交前逐条核对，未核对拦截返回清单，达标后带 `requirementsConfirmed:true` 重调 |
| 1.9.0 | **按项目文件夹创建远程仓库**：`git_remote_create` 工具 / `remote-create` 端点；token 多源探测；dryRun 预演 |
| 1.7.0 | **敏感字段文件自动 .gitignore**：检测 cookie/device/username/password/token 等字段赋值，命中文件追加 .gitignore + `git rm --cached` |
| 1.6.0 | **npm 下载产物屏蔽**：自动确保 .gitignore 覆盖 node_modules/ + lock 文件 + npm 缓存 |
| 1.5.1 | 修复 exemptRepos 未接线 + status 版本号硬编码 |
| 1.5.0 | 审计豁免类型：说明类（示例假凭据）+ 备份类（exemptRepos 白名单） |
| 1.4.1 | 修复 3 个 agent 工具缺 output.render 致结果无法回显（严重） |
| 1.4.0 | 文档对话类措辞拦截（docs-conversation blocker） |
| 1.3.0 | dsh-repo-index 自动维护（推送成功后生成唯一权威源码索引） |
| 1.2.0 | npm 包文件入库拦截 |
| 1.1.0 | 内置代码审计门禁（L0 静态 + L1 LLM 可选） |
| 1.0.0 | git 扫描 / 一键提交推送 / HTTP API |

## 注意事项

- **推送通道（v1.18.3）**：默认 api.github.com Git Data API（token 多源探测：同级仓 `dsh-git-push-User/github-token` → 项目 .git-push-token → workspaceRoot data/sensitive）；无 token 或 401 时回退 `ssh.github.com:443`（`dsh-git-push-User/id_ed25519`）。禁止 github.com HTTPS
- **分支免疫（v1.12.2）**：不硬编码 main/master——自动读远端 default_branch，请求分支不存在且不同名时自动改用远端默认分支，防误建新分支
- **clone（v1.17.0）**：git_clone 走 api.github.com Git Data API（git/trees + git/blobs，不跟随 tarball 302）；/tmp 中转建仓后整拷回 dest（绕开 CIFS git init EPERM）；dest 非空拒绝防覆盖；clone 后 origin 设置为 `https://api.github.com/repos/o/r`
- **禁止直连 github.com**：REST/Git Data 的 hostname 必须是 api.github.com；token 失效时只允许 ssh.github.com:443，不打 github.com
- **远端领先**：拒绝推送（防覆盖），需先 pull 同步
- **CIFS 卷**：每次 git 命令带 `-c safe.directory=<cwd>`（CIFS 只读卷 doubtful ownership）；CIFS 下 `git init`/`git remote add` 写 config.lock 会 chmod EPERM——建库用 /tmp 中转复制 .git，origin 用 node 直写 config
- **可执行位噪声（v1.18.4）**：CIFS/trimafs 上 chmod 不持久，git 会把 100644↔100755 当成变更。插件启动时执行 `git config --global core.filemode false`；`runGit` / `gitRaw` 每次再带 `-c core.filemode=false`（HOME 只读写不了全局时仍生效）
- **敏感扫描豁免（v1.14.0）**：①私有库——GitHub 可见性=private 自动豁免（API 探测失败/无 origin 保守不豁免）；②注释豁免——文件头前 3 行或行内注释带 `dsh-skip-sensitive` 即跳过（审计 secret/凭据文件/对话措辞 + 自动 gitignore 两处同认）；③只认字符串字面量值（表达式/拼接/变量引用不误报）
- **测试环境门禁（v1.14.0 移除）**：原 checkTestEnvCommitGate（DSH_HOME 含 dsh-test-* 禁提交）已删除——commitAndPush/rebuildHistory 不再有测试环境拦截
- **git_scan 自由配置（v1.15.0）**：①配置 `extraReposFile` 指向文本文件（每行一个仓库绝对路径，`#` 注释），**运行时实时读取，改文件即时生效无需重启**；②工具 `git_scan` 支持 `root`（覆盖扫描根）/ `paths`（逗号分隔临时追加仓库）；③API `/api/git-push/scan` 支持同名查询参数
- **审计**：L1 LLM 依赖 DSH llm 服务已配置，不可用自动跳过；docs-conversation 只查文档类文件新增行；说明类示例假凭据豁免；硬编码路径/IP（v1.31.0）代码 blocker、文档 warning，私有库也不跳过
- **同级仓 dsh-git-push-User（v1.18.0）**：不再放插件目录 `User/`（安装拷贝会清空）。恢复：`git_clone { target: "EIGHTfs/dsh-git-push-User", dest: "<工作区>/dsh-git-push-User" }`（与插件仓同一层级）。本机 `github-token` / SSH 私钥 git 忽略不入库
- **API 推送限制**：Git Data API 单仓库 blob 数/请求有 GitHub 限额，超大仓库（千级文件）逐 blob 上传较慢；复用远端已有 sha 已减少重复上传

## 开发计划 / 疑难杂症

- [ ] API 推送对空仓库/无 parent 首次推送的孤儿 commit 校验（当前 POST ref 已存在→改 PATCH 已处理，但仍需端到端覆盖测试）
- [ ] pushViaApi / cloneViaApi 支持大仓库（百+文件）进度与失败续传
- [x] `git_remote_create` / `git_clone` origin 写成 api.github.com/repos/o/r，与 API 推送通道衔接
- [x] User 仓挪出插件目录：同级 `dsh-git-push-User`（api.github.com clone，安装不覆盖）
