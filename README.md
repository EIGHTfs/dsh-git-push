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
- **规则包化（v1.41.0）**：审计规则数据全部外置为规则包 JSON（缺省 `lib/audit-rules/eightfs.rules.json`，归属 EIGHTfs；支持 `//` 注释），代码只保留引擎逻辑（`lib/rule-packs.js` 装载/校验/编译）。`config.auditRuleset` 可整体切换第三方规则包：`''/'builtin'/'eightfs'`=内置包、本地绝对路径=file、`http(s)://`=在线包（8s 超时/2MB 上限，启动后热替换）；`code_audit` 工具与 `/api/git-push/audit?ruleset=` 支持按调用临时换包；审计结果带 `ruleset` 溯源（name/owner/version/source）
- **用户门禁（v1.40.0 随插件内置）**：开发者特殊要求清单内置为 `lib/user-requirements.json`（归属 EIGHTfs），提交前逐条核对，未核对拦截（requirementsConfirmed 机制）；可放 `<插件配置目录>/requirements.json` 外挂他人清单
- **设置页凭据（v1.20.0 / v1.40.0）**：设置 → 插件 → 插件配置 →「Git 提交推送」填 token；写入插件配置目录 `git-push/github-token`（0600），secret 字段不进 settings.yaml 明文。点「检测可用」时公钥绑定先读 `/user/keys`，无权则 SSH 实测 `ssh.github.com:443`

## 文件目录结构及作用

| 路径 | 作用 |
|---|---|
| `lib/core.js` | 纯函数核心：runGit / commitAndPush / scanRepos / auditRepoPath / scanSensitiveFiles / ensureSensitiveIgnored / resolveGitToken / ensureRemoteRepo / pushViaApi / genReadme / rebuildHistory / credentialsDir / maskRemoteUrl / loadRequirements 等 |
| `lib/index.js` | 插件装配：agent 工具 + HTTP API + 审计门禁 + repo-index 维护 + 提交历史查看器路由 + 推送许可触发 + 设置命名空间 `git-push` |
| `lib/client.js` | 浏览器半侧：设置 → 插件 → 插件配置 卡片（填 GitHub token + 打开提交历史查看器入口） |
| `lib/viewer.js` | 提交历史查看器（v1.24.0 整合 git-commits-viewer）：只读数据层 getCommitHistory / getCommitDiff + 页面渲染 renderViewerPage（零外部资源，多语言 + 手动选择本地仓库） |
| `lib/viewer-locales.js` | 查看器多语言配置文件（v1.25.0）：zh/en 字典 + 默认中文；新增语言 = 加一个键集合一致的语言对象 |
| `lib/permit.js` | AI 回复推送许可（v1.24.0 整合 dsh-task-completion）：完成标记检测纯函数 + JSON 文件状态持久化（`.dsh/git-push-permit.json`） |
| `lib/audit.js` | 审计引擎（v1.41.0 规则包化）：消费规则包编译产物跑 L0 静态检查；引擎保留结构型检查（语法/JSON/YAML/二进制/npm/debugger/TODO/console/硬编码正则），规则数据零硬编码 |
| `lib/rule-packs.js` | 规则包装载器（v1.41.0）：stripJsonComments / validateRulePack / loadRulePack（builtin/file/url 三来源）/ compileRulePack；非法 pattern 降级记 errors 不崩溃 |
| `lib/audit-rules/eightfs.rules.json` | 内置审计规则包（归属 EIGHTfs，v1.41.0）：secret ×3 / credential-file ×2 / credential-ref ×2 / comment-wording ×9 / doc-conversation ×5 / 质量阈值 50-100；支持 `//` 注释，可整体替换为第三方包 |
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

**配置键**（cordis.patch.yml insert config）：`workspaceRoot` / `extraRepos` / `depth` / `githubOwner`（v1.40.0：默认 GitHub owner，兜底 EIGHTfs）/ `auditEnabled` / `blockOn` / `auditRuleset`（v1.41.0：审计规则包来源——`''/'builtin'/'eightfs'`=内置 EIGHTfs 包、本地绝对路径=file、`http(s)://`=在线包）/ `llmAudit` / `llmAuditProvider` / `llmAuditModel` / `maxDiffBytes` / `repoIndexEnabled` / `repoIndexTokenPath` / `repoIndexSyncTarget` / `repoIndexLocalOnly` / `exemptRepos` / `pushScope` / `commentWordingEnabled` / `commentWordingCustom` / `commentWordingRulesFile` / `commentWordingRulesUrl` / `envInjectionEnabled` / `envInjectionTools` / `injectFullSkill`（v1.28.0：pre-step 注入 skill 全文，默认 false 只列目录清单；v1.40.0 起来源 = 插件 skills/ + 技能仓库 git-workflow）/ `injectRepoIndexFull`（v1.35.0：注入 dsh-repo-index.json 正文，默认 false 只注入文件名）/ `customIgnorePatterns`（v1.28.0：自定义忽略 pattern 逗号/换行分隔，提交时自动写 .gitignore）/ `commitMessage`（自动推送提交信息，默认 `chore(ai): 任务完成自动提交`）。注：功能说明书经 systemPrompt 只注入**精简目录**（v1.32.0）；完整 `skills/dsh-git-push-functions.md` 按需加载。环境注入仍走系统提示词通道。

## 版本列表

| 版本 | 内容 |
|---|---|
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
