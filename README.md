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
| 凭据与账号 | 校验 GitHub token 与 SSH 公钥、生成密钥对、导出凭据环境变量 | `git_account_check` / `git_gen_ssh_key` / `git_cred_env` |
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
| `GET /api/git-push/account-status` | 账号状态快照 |
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
