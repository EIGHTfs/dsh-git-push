# dsh-git-push

DSH 的 **git 提交推送插件**：提交、推送、克隆、账号校验、仓库扫描与 npm 发布，一个工具搞定。

提交前可选跑「预处理门禁」：本插件只负责"跑一个命令、按退出码决定放行还是拦截"，
检查内容由可插拔的 provider 决定（审计由独立包 `audit-sluice` 提供）。

## 功能

| 功能 | 做什么 | 入口 |
|---|---|---|
| 提交推送 | 提交并推送；支持 dry-run / force / 指定 remote / 精确路径 | `git_commit_push` / `commit` |
| 仓库扫描 | 列出仓库的未提交、未推送、分叉与近期活动 | `git_scan` / `scan` |
| 克隆仓库 | 按 owner/repo 克隆到指定目录 | `git_clone` / `clone` |
| 克隆预演 | 只看将拉取什么，不落盘 | `git_clone_preview` / `clone-preview` |
| 建远端仓 | 给本地仓库建远端并设置 origin | `git_remote_create` / `remote-create` |
| 可见性 | 切换仓库 public / private | `git_set_visibility` / `set-visibility` |
| Issue | 列 / 建 / 评论 / 关闭（不含删除） | `github_issue` / `issue` |
| PR | 列 / 建 / 评论 / 文件清单 / 提交清单（**不含 merge 与 review**） | `github_pr` / `pr` |
| 改名 | 给远程仓库改名（dryRun 默认开，列出旧名出现位置） | `git_remote_rename` / `rename` |
| tag 管理 | 打 / 推 / 列 / 删 tag（dryRun 默认开；API 优先、git 回退） | `git_tag` / `tag` |
| 凭据与账号 | 校验 GitHub token 与 SSH 公钥、生成密钥对、导出凭据环境变量 | `git_account_check` / `git_gen_ssh_key` / `git_cred_env` |
| GitHub 授权 | 浏览器输一次短码换 token（Device Flow），之后不必手工建 PAT | 设置页 →「账号」→「用 GitHub 授权登录」 |
| 身份改写 | 把历史提交身份统一成登录账号 | `git_identity_rewrite` / `identity-rewrite` |
| 发布 | 发布 npm 包（dryRun 默认只体检；凭据由插件托管，无需 npm login） | `npm_publish` / `npm-publish` |
| 撤包 | 从 registry 撤版本（默认 dryRun 预检，不可逆） | `npm_unpublish` / `unpublish` |
| 忽略权限变动 | 查看/写入 `core.filemode`：CIFS/容器卷上新文件权限与仓库记录不同时，git 会把它们都算成改动（内容未变）——设为忽略即可 | `git_filemode` / `filemode` |
| git 透传 | 执行任意 git 命令，凭据自动注入 | `git_sluice` / `git` |
| HTTP 接口直调 | 调用本插件的 HTTP 接口 | `git_api` / `api` |
| 预处理动作 | 转发到声明该动作的 provider（审计/静态检查等） | `git-sluice preprocess <action>` |
| 静态检查类工具 | `code_audit`（含 `history=true` 逐提交回放）/ `io_scan` / `link_check` / `scope_check` / `exempt`——**实现由 `audit-sluice` 提供，需安装** | 同名工具 |

## 提交前检查（可选，独立包实现）

检查逻辑不在本插件里——由独立包 **`audit-sluice`** 提供（`npm install audit-sluice`）。
装上后本插件自动发现它；**不装也能正常用**，只是不做提交前检查，返回值里会标注"预处理未执行"。

```bash
audit-sluice audit --repo <路径> --scope diff --json   # 也能脱离本插件独立跑：stdout 单行 JSON，exit 0|1|2
audit-sluice config                                    # 它的配置（扫描范围/文件上限/禁用规则包/权重）
```

## GitHub 授权（可选，替代手工 PAT）

> **网络前提：申请短码与轮询换 token 两步由插件在本机发起**（输码那步才在你的浏览器里）。
> 本机 DNS 或网络对 `github.com` 不通时（国内常见，`curl` 该域名返回 `000`），插件会**自动改用官方 IP 候选并发竞速直连**——内置 26 个候选、按健康度自动轮换、连续失败的 IP 冷却 5 分钟后重试；实测在网络只剩一个 IP 可用时仍能在 1 秒内拿到短码。
> 只有全部候选都不可用（极端封锁）时才需要退回「手工 PAT」。
> 应急手段：`DSH_GIT_PUSH_GITHUB_IP=<IP>` 可临时钉死某一个候选。

不想手工建 token 就走这条：浏览器里输一次短码，插件自己把 token 存进凭据文件。**和手工 PAT 共用同一个凭据键，随时可换，不强制迁移。**

### 一、无需配置

插件已内置一个公开的 OAuth App client_id。Device Flow 的 client_id **不是密钥**——它不含 client_secret，且本来就会出现在授权页地址里，公开可查，gh CLI 等公开客户端也是这么做的。所以**不用建 App、不用填 Client ID**，装好就能用。

权限范围固定 `repo,workflow`：只给 `repo` 时，推送含 `.github/workflows/*` 的提交会被 GitHub **整推拒绝**。

需要换成自己的 App（内置那一个被撤下、或所在组织禁止第三方 OAuth App）时，见本节末尾的附录。

### 二、授权三步

1. 设置页 →「账号」→「GitHub 授权登录」→ 点「打开 GitHub 授权页」（有预填短码时是一键打开）
2. 手抄短码路径同样可用：页面会显示 8 位短码与地址，在任意设备的浏览器里输入并点 **Authorize**
3. 回到设置页：来源徽标从「手工 PAT」变成「**GitHub 授权**」，并显示登录名与授权时间

授权有效期 15 分钟（短码过期需重新开始）；等待期间页面自动轮询，不需要手动刷新。

### 三、撤销与切换

```bash
# 让本插件不再持有这份凭据（不会调 GitHub 撤销接口）
curl -X POST "http://<本机IP>:<端口>/api/git-push/auth/revoke" \
  -H 'Content-Type: application/json' -d '{"confirm":true}'
```

- 想彻底吊销：GitHub → Settings → Applications → 该 App → Revoke
- 想换回手工 PAT：直接在设置里填 `githubToken`，来源徽标会变回「手工 PAT」

### 四、常见失败

| 现象 | 原因 | 处置 |
|---|---|---|
| 面板报「申请授权失败：signal timed out」或 `fetch failed` | 本机到 `github.com` 全部候选 IP 都不通（极端封锁） | 插件已内置 26 个候选并发竞速；仍失败就用「手工 PAT」 |
| 返回 `MISSING_CLIENT_ID` | 内置客户端值为空（正常安装不会出现） | 在 `config.json` 的 `githubAuth.clientId` 填自己的 App ID，见附录 |
| 授权页显示「This organization forbids third-party applications」 | 组织禁用了第三方 OAuth App | 请组织管理员批准，或改用「手工 PAT」模式（插件不绕过组织策略） |
| 推送被拒：`refusing to allow an OAuth App to create or update workflow` | 授权时没给 `workflow` 权限 | 重新授权（默认已请求 `repo,workflow`），或对本次提交去掉 CI 配置文件 |
| 提示「授权超时：设备码已过期」 | 15 分钟内没在浏览器点 Authorize | 点「重新开始」，重新获取短码 |
| 短码输错 / 过期 | 短码与本次授权绑定且有时效 | 关闭面板重新开始授权 |
| 授权 8 小时后失效、要重新授权 | 自己建的 OAuth App 勾了 `Expire user access tokens` | 去该 App 设置里取消勾选（插件不处理 refresh_token） |

### 附：换成你自己的 OAuth App（可选）

只有两种情况需要：内置 App 被 GitHub 撤下，或所在组织禁止第三方 OAuth App。

1. 打开 `https://github.com/settings/developers` → **New OAuth App**
2. Application name 随意；Homepage URL 随意
3. **Callback URL 不能留空**（GitHub 强制要求），填任意占位即可（如 `https://github.com`）——Device Flow 不使用它，只在普通 OAuth 回调流程里才用到
4. **勾选 Enable Device Flow**（必勾）
5. **不要勾 `Expire user access tokens`**：勾了 token 8 小时就过期，插件不处理 `refresh_token`，用户每天都要重新授权
6. 创建后复制 **Client ID**，写进插件配置（`githubAuthClientId` 键）：

```bash
curl -X POST "http://<本机IP>:<端口>/api/git-push/settings-set" \
  -H 'Content-Type: application/json' \
  -d '{"key":"githubAuthClientId","value":"<Client ID>"}'
```

配了就用你的，配空则回落内置值。

完整协议与设计细节见 [docs/2026-11-14-GitHub-DeviceFlow-第三方登录方案.MD](docs/2026-11-14-GitHub-DeviceFlow-第三方登录方案.MD)。

## 环境要求

| 宿主 | 运行时 | 平台 |
|---|---|---|
| DSH >=0.1.6-0 <0.3.0-0 | Node >= 18.0.0 | 无限制 |

## 用法

### 侧边栏面板

- **账号信息**：GitHub 与 npm 账号状态、凭据与 SSH 公钥、本地/云端仓库列表
- **设置**：凭据与密钥、推送通道、推送门禁、自动推送、**提交前预处理开关**（其余审计项归 `audit-sluice` 自己的配置）

### 聊天框指令

```
/git-scan                  # 扫描工作区里的 git 仓库
/git-account               # 校验 GitHub 账号与凭据
/git-clone-preview <owner/repo>   # 克隆预演
```

### AI 工具

```js
git_scan({ root })                                  // root 可空：空=自动识别家目录
git_commit_push({ repo, message, push, dryRun })     // repo/message 必填；其余可空
git_clone({ target, dest, branch, history })         // target 必填（owner/repo 或完整 URL）
git_clone_preview({ target, branch })                // target 必填；branch 可空
git_api({ path, method, query, body })               // path 可空（空=列出全部接口）
git_sluice({ args })                                 // args 必填：与 git 一致的参数串
git_account_check({ token, sshPub })                 // 两者都可空：不传则自动解析本机凭据
git_cred_env({})                                     // 输出凭据环境变量前缀（不含明文）
git_gen_ssh_key({ email, force })                    // email 必填
git_identity_rewrite({ paths, dryRun, write, push }) // 全可空：dryRun 默认只报告
git_remote_create({ repo, visibility, dryRun })      // repo 必填
github_issue({ action, repo, number, title, body, labels, dryRun })  // action=list|create|comment|close
                                                   // create/comment/close 默认 dryRun：只回将发出的 method/path/body；
                                                   // 确认无误后传 dryRun:false 才真提交（避免在真仓库上试错）
github_pr({ action, repo, number, title, head, base, draft })  // action=list|create|comment|files|commits
git_set_visibility({ repo, visibility })             // 两者必填
git_tag({ repo, tag: "v3.2.1" })                     // dryRun 可空（缺省 true=只预演）；sha 可空（缺省 HEAD）
git_tag({ repo, tag: "v3.2.1", message: "release", push: true, dryRun: false })  // message 可空；给了即建 annotated tag
git_tag({ repo, action: "list", remoteTags: true })   // action 可空（缺省 create）；remoteTags 可空
git_tag({ repo, tag: "v3.2.1", action: "delete", dryRun: false, confirm: true }) // confirm 必填才真删（不可逆）
npm_publish({ dir, dryRun, confirm, tag, otp })      // dryRun 默认 true（只体检，不写 registry）
npm_unpublish({ name, version, dryRun, confirm })    // dryRun 默认 true
// 以下需安装 audit-sluice（未装时返回可诊断错误，不影响其他工具）
code_audit({ repo, scope, includeFindings })
io_scan({ repo, writeOnly })
link_check({ path })
scope_check({ files, repo, prefix, allowlist, topLevelMustBeEmpty })
exempt({ action, rule, path, scope, line, reason })
```

### 提交前预处理链（可选）

`preCommit.stages` 按数组顺序跑多个阶段（如"先格式化、再审计"）；也可以**按次**用工具参数
`preprocessStages` 覆盖配置（优先级更高）：

```js
git_commit_push({
  repo, message,
  preprocessStages: [
    { command: 'node', args: ['tools/fmt.mjs', '{filesFile}'], onFail: 'warn' },
    { provider: 'audit', args: { exemptPaths: ['vendor/a.js'], reason: '第三方代码' }, onFail: 'block' },
  ],
})
```

- `preprocessStages: []` = **这一次不跑任何预处理**
- `command` 形态的 `args` 是字符串数组，支持占位符 `{repo}` / `{filesFile}` / `{filesCount}` / `{stage}`
- `provider` 形态的 `args` 是**该实现自己的参数**（自由字典）：键名由实现决定（`audit` 用 `exemptPaths` / `reason`），
  宿主原样透传并按实现声明的映射翻成它的命令行参数
- 传了没人声明的参数会直接报 `参数不存在：xxx`

宿主同时注入 `PREPROCESS_REPO` / `PREPROCESS_CHANGED_FILES` 等环境变量；回执里
`preprocessStages` / `preprocessChanges` / `stagesSource` 如实反映"哪个阶段改了什么、本次链来自参数还是配置"。
契约见 [docs/SPEC.md](docs/SPEC.md) 第十七章。

### 忽略权限变动（CIFS / 容器卷）

```bash
git-sluice filemode <仓库> --check     # 只读：当前 core.filemode + 有多少条「纯权限变动」
git-sluice filemode <仓库> --apply     # 写入（默认只改当前仓库；--global 才改 ~/.gitconfig）
git-sluice filemode <仓库> --apply --compare   # 反向：恢复「比较权限位」
```

代价：设成忽略后，**真实的 `chmod +x` 变更也不再被记录**。只适合「权限位本来就不可信」的挂载盘。

### 独立 CLI

```
git-sluice account-check                  # 校验本机 GitHub 凭据
git-sluice scan <目录>                     # 列出该目录下的 git 仓库
git-sluice commit <仓库> --message "msg"   # 提交（默认只 commit；--push 推远端）
git-sluice preprocess <action> ...        # 转发到 provider（如 audit / io_scan / link_check）
git-sluice help                          # git 侧全部命令

tool-sluice self-check                    # 两入口 HELP/参数/命令集一致性自检
```

## API

统一前缀 `/api/git-push/`（git 侧与共享），预处理侧统一前缀 `/api/preprocess/`。常用：

| 端点 | 做什么 |
|---|---|
| `GET /api/git-push/status` | 插件状态与配置概览 |
| `GET /api/git-push/scan` | 仓库扫描结果 |
| `GET /api/git-push/repos-local` | 本地仓库列表（默认只读索引快照，毫秒级；`?live=1` 才同步探测远端） |
| `GET /api/git-push/account-status` | 账号状态快照（含凭据来源 `authMode` / `authLogin` / `authorizedAt`） |
| `POST /api/git-push/auth/device/start` | 申请授权短码（返回 `userCode` / `verificationUriComplete` / 轮询时刻） |
| `POST /api/git-push/auth/device/poll` | 轮询一次授权结果（服务端节流，多标签安全） |
| `GET /api/git-push/auth/status` | 当前授权态（`mode` = `none` / `pat` / `device-flow`） |
| `POST /api/git-push/auth/revoke` | 清本地凭据（需 `confirm:true`，不调 GitHub 撤销接口） |
| `POST /api/git-push/settings-set` | 写单个设置键 |
| `GET /api/git-push/tools` | 工具清单 |
| `GET /api/preprocess/<action>` | 预处理端点（动作清单来自各 provider 的 manifest） |

```bash
# 预处理动作清单
curl "http://<本机IP>:<端口>/api/git-push/api"

# 审计结果（需安装 audit-sluice）
curl "http://<本机IP>:<端口>/api/preprocess/audit?repo=<仓库绝对路径>&scope=diff&groupBy=rule"
```

## 文档索引

- [docs/SPEC.md](docs/SPEC.md) — 规格唯一入口（工具、接口、设置键、数据文件、与 audit-sluice 的耦合面）
- [docs/功能-发布与工具链.md](docs/功能-发布与工具链.md) — 提交推送、克隆、npm 发布、仓库索引、文档生成
- [docs/PERF-BASELINE.md](docs/PERF-BASELINE.md) — git 侧性能基线
- [docs/PLAN-UI状态工厂.md](docs/PLAN-UI状态工厂.md) — UI 状态层改造计划与交付记录
- [docs/FILE-TREE.md](docs/FILE-TREE.md) — 目录结构（自动生成）
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — 版本列表（自动生成）
- [docs/FUNCTIONS.md](docs/FUNCTIONS.md) — 函数列表（自动生成）

审计实现文档（规则体系、评分、豁免、性能基线）属独立包，见 `audit-sluice` 仓库的 `docs/`。
