# dsh-git-push

DSH 的 git 提交推送与代码审计插件：提交前自动过审计门禁，提交、推送、发包一条命令完成。

## 功能

| 功能 | 做什么 | 入口 |
|---|---|---|
| 提交推送 | 审计通过后提交并推送，支持 dry-run / force / 指定 remote | `git_commit_push` / `commit` |
| 仓库扫描 | 列出仓库的未提交、未推送、分叉与近期活动 | `git_scan` / `scan` |
| 代码审计 | 静态检查 + 质量评分，diff 或全量两种范围 | `code_audit` / `audit` / `/git-audit` |
| 历史提交审计 | 逐提交回放审计并落盘报告 | `code_audit --history` / `audit --history` |
| 克隆仓库 | 按 owner/repo 克隆到指定目录 | `git_clone` / `clone` |
| 克隆预演 | 只看将拉取什么，不落盘 | `git_clone_preview` / `clone-preview` |
| 建远端仓 | 给本地仓库建远端并设置 origin | `git_remote_create` / `remote-create` |
| 可见性 | 切换仓库 public / private | `git_set_visibility` / `set-visibility` |
| 凭据与账号 | 校验 GitHub token 与 SSH 公钥、生成密钥对 | `git_account_check` / `git_gen_ssh_key` |
| 身份改写 | 把历史提交身份统一成登录账号 | `git_identity_rewrite` / `identity-rewrite` |
| npm 发包 | 发布前体检，默认 dry-run，真发需二次确认 | `npm_publish` / `npm-publish` |
| 豁免标记 | 给文件加/删豁免注释并校验是否真生效 | `exempt` |
| I/O 风险扫描 | 扫描读写操作的风险分级 | `io_scan` / `file-io` |
| 链接检查 | 检查文档里的 URL 是否有效 | `link_check` / `link-check` |
| 巨型文件拆分 | 按顶层块拆分单文件并校验导出一致 | `module_splitter` / `module-splitter` |
| git 透传 | 执行任意 git 命令，凭据自动注入 | `git_sluice` / `git` |
| HTTP 接口直调 | 调用本插件的全部 HTTP 接口 | `git_api` / `api` |
| 审计结果查询 | 按规则/文件/严重级/规则包聚合审计结果 | `GET /api/git-push/audit` |

## 环境要求

| 宿主 | 运行时 | 平台 |
|---|---|---|
| DSH >=0.1.6-0 <0.3.0-0 | Node >= 18.0.0 | 无限制 |

## 用法

### 侧边栏面板

- **账号信息**：GitHub 与 npm 账号状态、凭据与 SSH 公钥
- **审计面板**：规则包启停、排序、命中数
- **设置**：审计开关、扫描范围、评分权重、自动推送开关

### 聊天框指令

```
/git-audit                 # 审计当前仓库（默认 diff 范围）
/git-audit --full          # 全量审计
/link-check                # 检查文档里的链接
```

### AI 工具

```js
git_scan({ root })                                  // root 可空：空=自动识别家目录
code_audit({ repo, scope, includeFindings })         // repo 必填；scope 可空（空=full）；includeFindings 可空（空=精简输出）
git_commit_push({ message, repo, push, dryRun })     // message 必填；repo 可空（空=当前目录）；push 可空（空=推送）；dryRun 可空（空=真提交）
git_clone({ target, dest, branch, history })         // target 必填（owner/repo 或完整 URL）；dest 可空（空=工作区根）；history 可空（空=整树快照）
git_clone_preview({ target, branch })                // target 必填；branch 可空（空=默认分支）
git_api({ path, method, query, body })               // path 可空（空=列出全部接口）；method 可空（空=GET）
git_sluice({ args })                                 // args 必填：与 git 一致的参数串
git_account_check({ token, sshPub })                 // 两者都可空：不传则自动解析本机凭据
git_gen_ssh_key({ email, force })                    // email 必填；force 可空（空=已存在时不覆盖）
git_identity_rewrite({ paths, dryRun, write, push }) // 全可空：dryRun 默认只报告，write 才改写
git_remote_create({ repo, visibility, dryRun })      // repo 必填；visibility 可空（空=private）
git_set_visibility({ repo, visibility })             // 两者必填
npm_publish({ dir, dryRun, confirm, tag, otp })      // dryRun 默认 true（只体检）；真发需 confirm=true 且 dryRun=false
exempt({ action, rule, path, scope, line, reason })  // action 与 rule 必填；path 可数组；scope=header（文件头）或 line
io_scan({ repo, writeOnly })                         // 两者都可空：writeOnly 空=读写都看
link_check({ path })                                 // path 可空：空=整个工作区
module_splitter({ command, file, plan, dryRun })     // command 必填（analyze/split/verify）；dryRun 可空
```

### 独立 CLI（git-sluice）

```
git-sluice account-check              # 校验本机 GitHub 凭据
git-sluice scan <目录>                 # 列出该目录下的 git 仓库
git-sluice audit <仓库> --full         # 全量审计（加 --json 拿明细）
git-sluice commit <仓库> -m "msg"      # 提交并推送（自动过审计门禁）
git-sluice help                        # 全部命令
```

## API

38 个端点，统一前缀 `/api/git-push/`。常用：

| 端点 | 做什么 |
|---|---|
| `GET /api/git-push/status` | 插件状态与配置概览 |
| `GET /api/git-push/scan` | 仓库扫描结果 |
| `GET /api/git-push/audit` | 审计结果（支持 scope / groupBy / severity / top） |
| `GET /api/git-push/repos` | 本地仓库列表 |
| `GET /api/git-push/account-status` | 账号状态快照 |
| `POST /api/git-push/credentials` | 写入凭据 |
| `GET /api/git-push/tools` | 工具清单 |

```bash
# 审计一个仓库（按规则聚合）
curl "http://<本机IP>:<端口>/api/git-push/audit?repo=<仓库绝对路径>&scope=diff&groupBy=rule"

# 列出全部可用接口
curl "http://<本机IP>:<端口>/api/git-push/api"
```

## 文档索引

- [docs/SPEC.md](docs/SPEC.md) — 规格唯一入口（工具、接口、设置键、数据文件、规则体系）
- [docs/FILE-TREE.md](docs/FILE-TREE.md) — 目录结构（自动生成）
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — 版本列表（自动生成）
- [docs/FUNCTIONS.md](docs/FUNCTIONS.md) — 函数列表（自动生成）
