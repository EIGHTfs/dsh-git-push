---
name: dsh-git-push-functions
description: dsh-git-push 插件全部功能说明书（每个功能一份说明）：git_scan / git_commit_push / code_audit / git_gen_readme / git_remote_create / git_set_visibility / git_clone / git_rebuild_history / git_push_rules / push_permit_status / push_permit_config / HTTP API / 提交历史查看器 / 上下文注入 / repo-index 维护 / 敏感忽略 / 自定义忽略 / 硬编码路径与 IP 审计 的用途、参数、返回、注意事项。v1.32.0 起系统提示词只注入精简目录，本文件按需加载（不再强制全文注入）；与 skills/dsh-git-push.md（使用手册）配合，排查/细节以本说明书为准。
whenToUse: 需要了解 dsh-git-push 某个功能怎么用/参数是什么/返回什么；排查插件工具行为；查询某功能用途时直接引用本说明书对应章节。
generatedBy: grok-4.6 · 2026-09-07
---

# dsh-git-push 插件功能说明书

> 本说明书覆盖插件**每个功能**。v1.32.0 起系统提示词只注入**精简目录**（工具名 + 提交前 README 检查），完整正文按需加载本 skill，不再每个会话塞全文。
> 版本：v1.34.0。源码：EIGHTfs/dsh-git-push。上下文注入实现定位：`lib/index.js` 搜「上下文注入」。

---

## 一、agent 工具（会话内直接调用）

### 1. git_scan —— 扫描仓库状态

- **用途**：扫描 workspace 下全部 git 仓库，返回分支/remote/未提交变更数/最近活动
- **参数**：`root`（扫描根，默认 workspaceRoot）/ `paths`（额外仓库绝对路径，逗号分隔）/ `extraReposFile`（配置文件，每行一个仓库路径，# 注释）
- **返回**：`{ count, root, repos: [{ name, path, branch, changes, lastCommit, remote }] }`
- **注意**：`git_scan` 是只读盘点，不提交不推送；写代码前先扫一遍看哪些仓库有未提交改动

### 2. git_commit_push —— 一键提交推送（带审计门禁）

- **用途**：先审计 → 敏感扫描自动 .gitignore → 自定义忽略自动 .gitignore → add -A → commit → push origin
- **参数**：`repo`（仓库绝对路径，必填）/ `message`（commit message，必填）/ `push`（默认 true）/ `dryRun`（只模拟）/ `audit`（默认 true）/ `llmAudit`（LLM 深度审查，默认 false）/ `requirementsConfirmed`（同级仓要求清单核对标记）
- **流程**：README 预览 → 自动清理代码注释措辞（autoClean，豁免 `dsh-skip-sensitive` 文件头）→ L0 静态审计（语法/JSON/YAML/敏感信息/凭据/大文件/文档措辞/硬编码路径与局域网 IP）→ 拦截判断 → commitAndPush（npm 屏蔽 → 敏感忽略 → 自定义忽略 → add → commit → push → repo-index 维护）
- **返回**：`{ ok, committed, commitId, push: { pushed, method, pushedTo }, audit: { blocked, findings, summary }, autoClean, readmeCheck, remoteHeads, remoteHeadsText }`
- **推送通道**：默认 api.github.com Git Data API；token 401 回退 ssh.github.com:443；禁止 github.com 直连
- **注意**：审计拦截返回 `{ok:false, blocked:true}` 不产生提交；远端领先不推。调用前必须核对 README（系统提示词常驻 + 返回 `readmeCheck`）

### 3. code_audit —— 手动审计仓库

- **用途**：对指定仓库执行代码审计（L0 静态：语法/JSON/YAML/敏感信息/凭据入库/二进制大文件/debugger/console/硬编码路径与局域网 IP）
- **参数**：`repo`（必填）/ `llm`（true 追加 LLM 深度审查）
- **返回**：`{ ok, blocked, findings: [{ rule, level, file, line, message }], summary: { blocker, warning, total } }`

### 4. git_gen_readme —— 按模板生成 README

- **用途**：按模板生成 README；模板优先同级仓 `dsh-git-push-User/readme-template.md`，没有用内置
- **参数**：`repo`（必填）/ `writePath`（可选，不传只返回内容不写文件）
- **占位符**：`{name}` `{description}` `{version}` `{toc}` `{versionTable}`（模板语法实际为双花括号包裹；本说明书经 systemPrompt 注入，双花括号会被 DSH 模板引擎解析为变量引用而报错，故此处以单花括号书写，含义不变）

### 5. git_remote_create —— 按项目文件夹创建远程仓库

- **用途**：检查 GitHub 是否已有同名仓库，没有则创建（private/public）+ 设置 origin 为 api.github.com URL
- **参数**：`repo`（仓库绝对路径）/ `visibility`（public/private，默认 private）/ `dryRun`（只探测不创建）
- **注意**：token 自动探测：同级仓 github-token（设置页写入）优先，其次项目 `.git-push-token`

### 6. git_set_visibility —— 切换仓库公开/私有

- **用途**：PATCH /repos 切换 GitHub 仓库可见性
- **参数**：`repo` / `visibility`（public|private）
- **注意**：改 public 有敏感信息暴露风险，改前确认无凭据

### 7. git_clone —— 从 GitHub 克隆（只走 api.github.com Git Data API）

- **用途**：git/trees + git/blobs 拉取，不跟随 tarball 302、不直连 github.com/codeload
- **参数**：`target`（owner/repo 或 URL）/ `dest`（目标目录，缺省 workspaceRoot，已存在非空拒绝）/ `branch`
- **注意**：/tmp 中转建仓整拷回目标，兼容 CIFS

### 8. git_rebuild_history —— 重建仓库历史

- **用途**：squash-bugfixes（补丁并入主版本）/ drop-versions（删版本区间）/ fresh（当前文件树作为唯一提交，**不改版本号**）
- **参数**：`repo` / `mode` / `dryRun`（预览）/ `dropFrom` / `dropTo` / `force`（true=覆盖远端，须已授权 force push）
- **注意**：破坏性操作，自动打 backup-<timestamp> tag，先 dryRun。force=false 只改本地。v1.34.0 起 fresh 不再把 package.json 改成 1.0.0

### 9. git_push_rules —— comment-wording 规则管理

- **用途**：show（当前规则）/ export（导出 JSON）/ import（json 或 url 导入）
- **参数**：`action` / `json` / `url` / `targetFile`
- **规则优先级**：commentWordingCustom（设置 JSON）> commentWordingRulesFile（本地/URL）> 内置默认

### 10. push_permit_status / push_permit_config —— AI 回复推送许可

- **用途**：AI 回复含「✅ 任务完成」后是否自动 commit+push（默认关）
- **参数**：`enabled`（bool）/ `pushScope`（all/session）
- **注意**：许可开启时回合结束自动对扫描范围有变更仓库走带审计推送；默认关闭绝不自动推

---

## 二、HTTP API

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/git-push/status` | GET | 插件状态（版本+配置+审计开关+repoIndex+git 版本） |
| `/api/git-push/scan` | GET | 扫描全部仓库状态 |
| `/api/git-push/audit?repo=&llm=true` | GET | 审计指定仓库 |
| `/api/git-push/sensitive?repo=` | GET | 手动扫描含敏感字段文件 |
| `/api/git-push/commit` | POST | `{repo, message, push?, dryRun?, audit?, llmAudit?}` 审计通过后提交推送 |
| `/api/git-push/remote-create` | POST/GET | 创建远程仓库 |
| `/api/git-push/permit/status` | GET | 推送许可状态 |
| `/api/git-push/permit/config` | POST | 切换推送许可 |
| `/api/git-push/rules` | GET/POST | comment-wording 规则查看/导入 |
| `/api/git-push/gen-ssh-key` | POST | v1.29.0：按邮箱生成 SSH 密钥对（`{email, force?}` → ssh-keygen -t rsa -b 4096 -C email；返回公钥整行供复制去 GitHub 绑定；已存在拒绝，force 时旧密钥先改名备份） |
| `/git-push/viewer` | GET | 提交历史查看器页面（只读） |
| `/api/git-push/repos` / `commits` / `diff` | GET | 查看器数据层 |

---

## 三、设置页（设置 → 插件 → 插件配置 →「Git 提交推送」）

| 控件 | 配置键 | 说明 |
|---|---|---|
| 账号状态（置顶） | — | v1.29.0：卡片展开时**自动跑一次** Token/SSH 检测，结果块显示在设置卡最上方（Token 可用性 + 用户名/id/主页 + SSH 公钥是否绑定，`ssh -T git@ssh.github.com` 实测） |
| SSH 邮箱 + 生成公钥 | — | v1.29.0：输入邮箱点「生成公钥」→ 后端 ssh-keygen -t rsa -b 4096 -C 邮箱，公钥回显复制去 GitHub 绑定（私钥留本机同级仓）；v1.30.0：回显区新增**一键复制**按钮（navigator.clipboard + execCommand 兜底） |
| GitHub token | githubToken | secret，存同级仓 github-token，不进 settings 明文 |
| SSH 公钥 | sshPub | 存同级仓 *.pub |
| 注入全部 skill 内容 | injectFullSkill | 勾选=pre-step 注入两仓 skill 全文；默认只列目录清单；改即存并**回显「已保存并生效」**（v1.29.0 反馈）；**v1.30.0：设置页改动实时同步到运行期（scope.watch 覆盖），勾选/取消立即生效，无需重启** |
| 注入 repo-index JSON 全文 | injectRepoIndexFull | v1.35.0：勾选=注入 `dsh-repo-index.json` 正文；默认只注入文件名。md 表格已废弃 |
| 自定义忽略文件 | customIgnorePatterns | 逗号/换行分隔 gitignore 模式（如 *.bak*），提交时自动写目标仓库 .gitignore，已跟踪文件自动解除跟踪；改即存并回显「已保存」；**v1.30.0：同 injectFullSkill，设置页改动实时生效** |

---

## 四、上下文注入（agent/pre-step，每个会话首次注入）

注入内容（按顺序一条 user 消息）：
1. **功能目录精简注入（v1.32.0，强制）**：只列工具名；完整说明书本文件按需加载（不再全文注入）
2. **两仓 skill**（dsh-git-push/skills + dsh-git-push-User 的 .md）：`injectFullSkill=true` 注入全文，默认只列目录+文件清单
3. **dsh-repo-index JSON**（v1.35.0）：默认只注入文件名；`injectRepoIndexFull=true` 注入正文。md 表格已废弃
4. **环境注入**（v1.26.0）：工作目录映射 + 工具安装路径（envInjectionEnabled 可关，tools-index.md 同步同级仓）
5. **提交前 README 检查（v1.32.0）**：系统提示词常驻；`git_commit_push` 返回 `readmeCheck`

> v1.38.0：移除「设备/用户 json 注入」（原 v1.27.0）——凭据类信息注入不属于 git-push 职责；需要设备/站点导航信息时由会话插件/模板注入另行处理。

实现位置：`lib/index.js` 搜「上下文注入」注释块。

---

## 五、repo-index 维护与忽略机制

- **repo-index**：git_commit_push 推送成功后自动重生成 `dsh-git-push-User/<owner>/dsh-repo-index.json`（v1.27.0 起 JSON 权威源，md 表格已废弃）；该文件**不入库**（同级仓 .gitignore 忽略，v1.28.0）。会话注入由 `injectRepoIndexFull` 开关控制（默认文件名，勾选正文）
- **npm 屏蔽（ensureNpmIgnored）**：node_modules/ + lock 文件自动写 .gitignore（幂等）
- **敏感字段忽略（ensureSensitiveIgnored）**：扫 cookie/device/username/password/token，命中文件自动 .gitignore + git rm --cached 解除跟踪（私有库豁免：private 仓库只报告不写）
- **自定义忽略（ensureCustomIgnored，v1.28.0）**：设置里 customIgnorePatterns 的模式自动写目标仓库 .gitignore，已跟踪文件解除跟踪
- **豁免标记 dsh-skip-sensitive**：文件头前 3 行或行内注释带此标记 → 跳过敏感扫描/comment-wording 检测/autoClean 清理（测试文件、示例文档常用）
- **推送后远端 ref 维护（v1.29.0）**：Git Data API 推送不更新本地 remote-tracking ref（origin 是 api.github.com REST 端点，`git fetch origin` 必 403）——推送成功后会自动 `git update-ref refs/remotes/origin/<branch>`（`git log origin/master` 可看远端最新）+ 自动补 `github-ssh` 辅助 remote（`ssh://git@ssh.github.com:443/<owner>/<repo>.git`，标准 `git fetch github-ssh` / `git pull github-ssh <branch>` 可用；同名 remote 已存在则不覆盖）
- **属主/权限噪声（v1.32.0）**：每次 git 带 `safe.directory=*` + `core.filemode=false`；启动写全局 `safe.directory=*`（已有则跳过）

---

## 六、坑速查

1. 提交被审计拦截 → 看 `findings` 逐条修；文档措辞类走 `release-docs-rule`（公开仓库只写做了什么）；硬编码路径/IP 改配置、环境变量或相对路径（私有库也不豁免）
2. 推送失败 Bad credentials → token 失效自动回退 ssh.github.com:443（需同级仓 id_ed25519）
3. autoClean 会清理代码注释里的「记录用户指令」措辞 → 测试输入含这些措辞时给文件头加 `dsh-skip-sensitive`
4. 设置页改动立即保存（token/SSH 除外，需点保存按钮）
5. `git fetch origin` 会 403（origin 是 API 端点非 git 地址）→ 想标准 fetch/pull 用 `github-ssh` 辅助 remote（v1.29.0 推送后自动补）
6. SSH 检测显示「未能实测」→ 通常是没有私钥（只有 .pub 公钥）→ 用设置卡「生成公钥」先 ssh-keygen 生成密钥对，再把公钥绑到 GitHub

## 相关

- dsh-git-push（使用手册，与本文档配套）
