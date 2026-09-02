# dsh-git-push

DSH（DeepSeek Harness）git 自动提交推送插件。把「扫描仓库 → **审计** → 一键 commit + push → **自动维护 dsh-repo-index 源码索引** → **敏感字段文件自动 .gitignore**」固化为 agent 工具与 HTTP API，**执行零 token 消耗、确定性输出**（相比每次让 AI 手敲 git 命令）。默认推送通道走 **api.github.com**（Git Data API），github.com 直连被网络阻断时仍可推送。

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
- **推送双通道（v1.12.0）**：默认走 **api.github.com Git Data API**（blob → tree → commit → ref，逐 blob 复用远端已有 sha，避免重复上传）；API 无 token/失败时回退 `git push origin`（SSH origin 且有 token 时经 HTTPS+token，GIT_ASKPASS 注入 token 不进命令行）
- **审计体系**：L0 静态（语法/JSON/YAML/敏感信息/凭据/大文件/debugger/文档对话类措辞）+ L1 LLM 深度审查（可选，diff 喂便宜模型）；豁免类型 = 说明类（示例假凭据）+ 备份类（exemptRepos 白名单）
- **用户门禁**：插件 `User/<owner>/requirements.md` 开发者特殊要求，提交前逐条核对，未核对拦截（requirementsConfirmed 机制）

## 文件目录结构及作用

| 路径 | 作用 |
|---|---|
| `lib/core.js` | 纯函数核心：runGit / commitAndPush / scanRepos / auditRepoPath / scanSensitiveFiles / ensureSensitiveIgnored / resolveGitToken / ensureRemoteRepo / pushViaApi / genReadme / rebuildHistory / loadUserRequirements 等 |
| `lib/index.js` | 插件装配：agent 工具（git_scan / git_commit_push / code_audit / git_gen_readme / git_rebuild_history / git_remote_create）+ HTTP API（status / scan / audit / commit / sensitive / remote-create）+ 审计门禁 + repo-index 维护 |
| `lib/audit.js` | 审计规则实现 |
| `lib/repo-index.js` | dsh-repo-index 索引生成/同步 |
| `lib/llm.js` | L1 LLM 深度审查调用 |
| `skills/dsh-git-push.md` | 插件使用手册 skill（推送到会话内可按需加载） |
| `User/<owner>/` | 开发者特殊要求 + 用户级 git skill（git 忽略不入主库，独立备份私有库） |
| `docs/` | 架构图等文档 |
| `test-*.mjs` | 单测（core / audit / apply） |

## 启动脚本

```bash
# 插件随 DSH 主实例自动装载（cordis.patch.yml insert），无需单独启动
curl -s http://127.0.0.1:3083/api/git-push/status   # 验证加载
node --check lib/core.js && node --check lib/index.js  # 改代码后语法自检
node test-core.mjs && node test-audit.mjs && node test-apply.mjs  # 单测
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
| `git_clone`（agent 工具） | — | 远端 clone 默认走 api.github.com（tarball + /tmp 中转建仓，兼容 CIFS；自动探测默认分支） |

**agent 工具**：`git_scan` / `git_commit_push`（含 requirementsConfirmed 参数）/ `code_audit` / `git_gen_readme` / `git_rebuild_history` / `git_remote_create` / `git_clone`（远端 clone 默认走 api.github.com tarball）

**配置键**（cordis.patch.yml insert config）：`workspaceRoot` / `extraRepos` / `depth` / `auditEnabled` / `blockOn` / `llmAudit` / `llmAuditProvider` / `llmAuditModel` / `maxDiffBytes` / `repoIndexEnabled` / `repoIndexTokenPath` / `repoIndexSyncTarget` / `repoIndexLocalOnly` / `exemptRepos`

## 版本列表

| 版本 | 内容 |
|---|---|
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

- **推送通道**：v1.12.0 默认走 api.github.com（需 token，resolveGitToken 多源探测：项目 .git-push-token → workspaceRoot data/sensitive → HOME/DSH_HOME 会话目录）；API 无 token 或失败才回退 git push origin
- **分支免疫（v1.12.2）**：不硬编码 main/master——自动读远端 default_branch，请求分支不存在且不同名时自动改用远端默认分支，防误建新分支
- **clone（v1.13.0）**：git_clone 走 api.github.com tarball 通道（github.com 直连被阻断仍可拉取）；/tmp 中转建仓后整拷回 dest（绕开 CIFS git init EPERM）；dest 非空拒绝防覆盖；clone 后 origin 设置为 https://github.com/o/r.git，可直接走 pushViaApi 推送
- **SSH 443 / HTTPS**：本机无 SSH 私钥只有 GitHub token 时，git push 走 HTTPS+token（GIT_ASKPASS 注入 token 不进命令行）；github.com 直连被网络阻断时 API 通道是唯一可用推送方式
- **远端领先**：拒绝推送（防覆盖），需先 pull 同步
- **CIFS 卷**：每次 git 命令带 `-c safe.directory=<cwd>`（/vol02 只读卷 doubtful ownership）；CIFS 下 `git init`/`git remote add` 写 config.lock 会 chmod EPERM——建库用 /tmp 中转复制 .git，origin 用 node 直写 config
- **敏感扫描豁免（v1.14.0）**：①私有库——GitHub 可见性=private 自动豁免（API 探测失败/无 origin 保守不豁免）；②注释豁免——文件头前 3 行或行内注释带 `dsh-skip-sensitive` 即跳过（审计 secret/凭据文件/对话措辞 + 自动 gitignore 两处同认）；③只认字符串字面量值（表达式/拼接/变量引用不误报）
- **测试环境门禁（v1.14.0 移除）**：原 checkTestEnvCommitGate（DSH_HOME 含 dsh-test-* 禁提交）已删除——commitAndPush/rebuildHistory 不再有测试环境拦截
- **审计**：L1 LLM 依赖 DSH llm 服务已配置，不可用自动跳过；docs-conversation 只查文档类文件新增行；说明类示例假凭据豁免
- **User/ 目录**：git 忽略不入主库，独立备份私有库 `EIGHTfs/dsh-git-push-User`（恢复：`git clone https://github.com/EIGHTfs/dsh-git-push-User.git <插件目录>/User`）
- **API 推送限制**：Git Data API 单仓库 blob 数/请求有 GitHub 限额，超大仓库（千级文件）逐 blob 上传较慢；复用远端已有 sha 已减少重复上传

## 开发计划 / 疑难杂症

- [ ] `ensureRemoteRepo` 的 CIFS remote add 静默失败——补 node 直写 config 回退（当前需手动补 origin）
- [ ] API 推送对空仓库/无 parent 首次推送的孤儿 commit 校验（当前 POST ref 已存在→改 PATCH 已处理，但仍需端到端覆盖测试）
- [ ] pushViaApi 支持大仓库（百+文件）上传进度与失败续传
- [ ] `git_remote_create` 建库后 origin 设置与 API 推送通道的衔接测试
