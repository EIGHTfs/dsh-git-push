---
name: guide-clone-repos
description: dsh-git-push 功能说明：克隆与仓库（预览、进度、断点续传、扫描、建远端、可见性）。处理克隆与仓库管理类请求时加载。
whenToUse: 要克隆仓库、查克隆进度/中止、扫描本地仓库、建远端或改可见性、查账号与配额时。
updated: 2026-10-02
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-10-02
---

# 克隆与仓库管理（guide-clone-repos）

> 一句话定位：把「从 GitHub 拿代码」和「本机仓库台账」做成一整套工具 + 后台接口——克隆走 GitHub Git Data API（不直连 github.com），大仓库放后台跑、进度可轮询、断了能续传、少文件如实报告。

## 一、这个功能能干什么

| 能力 | 说明 |
|---|---|
| 克隆仓库 | `git_clone` 按 `owner/repo` 或 URL 拉整仓到目标目录，末尾自动 `git init` + `git add -A` + 建初始提交，并把 `origin` 指向 `api.github.com/repos/<owner>/<repo>` |
| 克隆预演 | `git_clone_preview` 只读远端文件树，报告「将下载几个文件/多少字节、会跳过哪些超大文件」，**不下载、不落盘** |
| 后台 job | 工具侧注册宿主官方后台 job（立即返回 jobId，用 `job_output`/`job_list`/`job_kill` 查/停）；HTTP 侧 `/repo-clone` 立即返回 202 + jobId，用 `/clone-progress` 轮询 |
| 断点续传 | 分片目录 `.dsh-parts` 内按 blob sha 存 `<sha>.part`，中断后按 `Range` 续传；已下完的成品按长度直接复用，不重下 |
| 体积守卫 | 单文件超过阈值（默认 10MB，HTTP 端可配 `maxCloneFileMB`，0=不限）直接跳过并**如实回传**，不静默少文件 |
| 本地仓库扫描 | `git_scan` 逐层下钻列仓库：分支 / 远端（脱敏）/ 未提交数 / 最近提交 / 领先落后 |
| 远端仓库管理 | `git_remote_create` 建仓（默认 private，已存在则复用并设 origin）；`git_set_visibility` 切 public/private |
| 账号与配额 | 账号状态（离线读快照）/ 在线校验 / API 配额查询（`/rate_limit`，不消耗配额） |
| 仓库索引 | 推送成功、云端加载、本地扫描时维护 `dsh-repo-index.json`；本地仓库列表据此标注每个仓库的 GitHub 归属 |

## 二、怎么用（工具 + HTTP 接口参数表与返回字段）

### 2.1 工具 `git_clone`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `target` | string | ✅ | — | `owner/repo` 或完整 GitHub URL |
| `dest` | string | — | 省略时落到「进程当前工作目录/<仓库名>」 | **目标目录本身**（不是父目录）；目录已存在且非空会拒绝覆盖 |
| `branch` | string | — | 仓库默认分支 | 分支名 |

即时返回：

| 字段 | 说明 |
|---|---|
| `ok` | 是否受理 |
| `async` | `true` = 已注册后台 job；`false` = 同步执行完（宿主无 job 控制器时） |
| `jobId` | 后台 job id（如 `git-clone-1`） |
| `jobFallback` | `true` = 已降级同步执行，结果在 `result` |
| `result` | 同步执行时的克隆结果（字段同 job 完成输出） |
| `hint` | 查询提示文案 |

job 完成输出（JSON 字符串）：成功 `{ok,owner,repo,branch,commitSha,dest,files,total,method:"api",skipped[],skippedCount,modePreserved,metadataSupported}`；失败 `{ok:false,error,cause,retriable,files,total,failed:[{path,status,reason}],failedCount,skipped[],skippedCount,kept:true,resumable:true}`。

### 2.2 工具 `git_clone_preview`

参数 `target`（必填）、`branch`。返回 `{ok,owner,repo,branch,totalFiles,downloadCount,downloadBytes,skipped[],skippedCount,skippedBytes,maxFileMB,empty}`——`empty:true` 表示文件全被体积阈值跳过（会得到一个空目录，要强提示）。

### 2.3 HTTP 接口

| 接口 | 方法 | 请求体 | 状态码 | 返回关键字段 |
|---|---|---|---|---|
| `/api/git-push/repo-clone` | POST | `{target, dir, confirm:true}` | 202 / 400 / 409 | 202 `{ok,async:true,jobId,target,dest,totalFiles,totalBytes,hint}`；400 缺 target/dir/解析失败/预演失败；409 已有克隆在跑 `{cause:"busy",retriable:false,running}` |
| `/api/git-push/clone-preview` | POST | `{target, maxFileMB?}` | 200 / 400 | 同 2.2 的预演结果；进程内缓存 60 秒 |
| `/api/git-push/clone-progress` | GET/POST | `{consume?}` | 200 | `{ok,state:"running"\|"done"\|"idle", progress?, result?}`；`consume:true` 取走终态后清空 |
| `/api/git-push/clone-logs` | GET/POST | `{limit?}` | 200 | `{ok,logs:[{at,event,...}]}`，默认 200 条（环形缓冲上限 200） |
| `/api/git-push/clone-abort` | POST | — | 200 | `{ok,aborted:true\|false}` |
| `/api/git-push/account-status` | GET | — | 200 | 离线快照 `{ok,offline:true,loggedIn,username,tokenConfigured,sshConfigured,tokenStatus,sshStatus,checkedAt,apiQuota,block}` |
| `/api/git-push/account-check` | POST | `{githubToken?,sshPub?,checkSsh?}` | 200 | 在线校验并写快照 `{ok,loggedIn,username,name,profileUrl,publicRepos,plan,tokenStatus,sshStatus,apiQuota,block,statusUpdated,status}` |
| `/api/git-push/api-quota` | GET | `?refresh=1` | 200 | `{ok,core{limit,remaining,resetAt},search,graphql,codeSearch,fetchedAt,cached,statusUpdated}` |

- `progress` 字段：`target/dest/phase/done/totalFiles/transferred/totalBytes/failed/elapsedMs/stalledMs/percent`（`percent` 按字节算、上限 99；`phase` 取值 `downloading` → `done`）。
- `result`（终态）：`{ok,error,finishedAt,…终态进度快照}`。
- `/repo-clone` 属破坏性端点，body 必须显式带 `confirm:true`，否则 400 `NEED_CONFIRM`。
- 账号状态查询：`/account-status` 是**离线读** json 快照（秒级、不联网），`/account-check` 才联网校验并回写快照；登录判定为 `token 有效 || ssh 有效`。

### 2.4 仓库扫描与远端管理

- `git_scan`：参数 `root`（省略时用配置 `defaultScanRoot`，未配置则自动识别 DSH 家根）、`paths`（额外仓库路径，逗号分隔）、`extraReposFile`（清单文件，每行一个路径、`#` 注释）。返回 `{ok,root,count,paths,extraReposFile,repos[]}`；`repos` 项字段 `name/path/branch/remote(脱敏)/changed/lastCommit/hasRemote/upstream/ahead/behind`。扫描跳过 `node_modules`、隐藏目录、被 `.gitignore` 忽略的目录，depth 20、最多 200 个仓库。
- `git_remote_create`：参数 `repo`（本地仓库路径，必填）、`visibility`（`public|private`，默认 `private`）、`dryRun`。三种返回：已存在 `{ok:true,exists:true,owner,name,visibility,reason:"已存在同名仓库"}`；预演 `{ok:true,dryRun:true,wouldCreate:true,owner,name,visibility}`；新建 `{ok:true,created:true,owner,name,visibility,origin}`。
- `git_set_visibility`：参数 `repo`（本地仓库路径）、`visibility`（`public|private`，必填）。从本地 `origin` 解析 owner/repo，返回 `{ok,owner,repo,visibility,to}`；需要 token。

## 三、可直接复制的例子（真实调用 + 预期结果）

**① 先预演，再克隆（工具）**

```js
git_clone_preview({ target: "EIGHTfs/dsh-git-push" })
// → { ok:true, branch:"master", totalFiles:312, downloadCount:310, downloadBytes:1234567,
//     skipped:[{ path:"assets/demo.mp4", size:52428800, sha:"…" }], skippedCount:2, skippedBytes:52428800, maxFileMB:10, empty:false }

git_clone({ target: "EIGHTfs/dsh-git-push", dest: "<目标目录>", branch: "master" })
// → { ok:true, async:true, jobId:"git-clone-1", hint:"已注册宿主后台 job…" }
// job 完成后：{ ok:true, owner:"EIGHTfs", repo:"dsh-git-push", branch:"master", commitSha:"…",
//              dest:"<目标目录>", files:310, total:312, method:"api", skippedCount:2, modePreserved:true }
```

**② HTTP 后台克隆 + 轮询进度 + 取终态**

```bash
curl -s -X POST "$BASE/api/git-push/repo-clone" -H 'content-type: application/json' \
  -d '{"target":"EIGHTfs/dsh-git-push","dir":"<父目录>","confirm":true}'
# → 202 {"ok":true,"async":true,"jobId":"clone-1a2b3c","dest":"<父目录>/dsh-git-push","totalFiles":312,"totalBytes":153800000}

curl -s -X POST "$BASE/api/git-push/clone-progress" -d '{}'
# → {"ok":true,"state":"running","progress":{"phase":"downloading","done":120,"totalFiles":310,
#     "transferred":73400320,"totalBytes":153800000,"failed":0,"percent":47,"stalledMs":820,"elapsedMs":41000}}

curl -s -X POST "$BASE/api/git-push/clone-progress" -d '{"consume":true}'
# → {"ok":true,"state":"done","result":{"ok":true,"finishedAt":…,"dest":"…"}}
```

**③ 中止 / 看克隆日志 / 查配额**

```bash
curl -s -X POST "$BASE/api/git-push/clone-abort" -d '{}'           # → {"ok":true,"aborted":true}
curl -s -X POST "$BASE/api/git-push/clone-logs" -d '{"limit":20}'  # → {"ok":true,"logs":[{"at":"…","event":"start",…}]}
curl -s "$BASE/api/git-push/api-quota?refresh=1"                   # → {"ok":true,"core":{"limit":5000,"remaining":4821,"resetAt":"…"}}
```

**④ 扫仓库 / 建远端 / 改可见性**

```js
git_scan({ root: "<扫描根>", paths: "<额外仓库路径>" })
git_remote_create({ repo: "<本地仓库路径>", dryRun: true })      // 先预演：只探测，不建
git_remote_create({ repo: "<本地仓库路径>", visibility: "private" })
git_set_visibility({ repo: "<本地仓库路径>", visibility: "private" })
```

## 四、断点续传与失败重试（怎么判断进度、失败怎么办）

**判断进度**：`percent` 按已传字节算（总量未知时退回文件数）；`stalledMs` = 距上次**有字节增长**的毫秒数，用来判「卡死」——比绝对超时合理（大文件传得慢但进度在涨不算卡死）。`phase` 只有 `downloading` → `done`。

**续传三层机制**：

1. **分片**：每个文件先写 `.dsh-parts/<sha>.part`，长度校验通过才原子 rename 到最终路径——最终路径上不会出现半截文件。
2. **Range 续传**：`.part` 存在且小于远端 size → 请求带 `Range: bytes=<已有字节>-`；远端回 206 就追加写，回 200（忽略 Range / 文件已变）就清空重下。
3. **成品复用**：最终路径文件长度 == 远端 size → 直接判成功，不再重下。

**失败保留与自愈**：有失败项时**保留** `.dsh-parts`（下轮继续续传），只有全部成功才清分片目录；克隆失败**不删目录**，返回 `kept:true` / `resumable:true`，已下好的文件全部留着。再次克隆时，目录内有进行中标记 `.dsh-git-push-cloning` 且没有有效 HEAD（或目录里只剩 `.dsh-parts`）→ 判为上次残留，自动续传，不会撞「目录非空」拒绝。

**失败成因决定要不要重试**（看返回的 `cause` / `retriable`）：

| `cause` | 触发 | `retriable` | 怎么办 |
|---|---|---|---|
| `auth` | 401 | ❌ | 换 token / 确认该仓库权限 |
| `notfound` | 404 | ❌ | 确认 owner/repo 是否正确、token 是否可见该仓库 |
| `ratelimit` | 403 / 429 | ✅ | 等限流窗口过去再试 |
| `server` | 5xx | ✅ | 稍后重试 |
| `network` | status 0（超时 / 断网） | ✅ | 直接重试（分片会续传） |
| `disk` | 本地写盘 / 软链失败 | ✅ | 查目标目录权限与磁盘空间 |

**双通道**：常态先走 `api.github.com`（稳定，但忽略 Range），需要续传（已有分片）或 api 失败时退 `raw.githubusercontent.com`（支持 Range，并发不稳）——首个成功即用，全失败才报错。分片以 sha 命名，sha 变了自然换文件，不会把新旧内容拼成损坏文件。

## 五、边界与坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 409 `cause:"busy"` | 同一时刻只允许一个克隆任务（内存态单任务，不区分目标目录） | 等当前任务结束，或先调 `/clone-abort` |
| 400 `NEED_CONFIRM` | `/repo-clone` 是破坏性端点，body 没带 `confirm:true` | 补 `confirm:true` |
| 400 目标目录已存在且非空 | 目录不是本插件的失败残留（无进行中标记） | 换目录，或自行清空后重试 |
| 拒绝克隆到既有 git 仓库内 | 目标目录落在某仓库工作树里，末尾 `git init/add/commit` 会写进父仓库历史 | 换到仓库外的目录 |
| 克隆成功但可执行位没保住 | 目标文件系统（CIFS）不支持元数据 | 看返回 `modePreserved:false` / `metadataSupported:false`，属如实回报不是失败 |
| 少文件 | 单文件超过体积阈值被跳过 | 看 `skipped` / `skippedCount`；要全量就调大阈值或设 0（**HTTP 端读配置 `maxCloneFileMB`/`cloneConcurrency`；`git_clone` 工具固定用默认 10MB、并发 6**） |
| 进度查不到 | 进度是内存态，随进程存亡，进程重启即丢 | 重启后重新发起克隆（已下文件与分片仍会续传） |
| `skipped` / `failed` 列表不全 | 返回列表有上限（跳过 50 条、失败 20 条） | 用 `skippedCount` / `failedCount` 判断真实规模 |
| `origin` 是 `api.github.com/repos/...` | 走 Git Data API 建仓，origin 写 API 地址（插件凭据通道用） | 属正常；用 `git_sluice` 执行 git 命令时凭据自动注入 |
| 账号状态显示未配置但推送正常 | `/account-status` 是**离线读**的旧快照 | 调 `/account-check` 在线校验，或点侧边栏「重新检测」 |

## 六、相关功能

| 功能 | 关系 |
|---|---|
| `git_commit_push` | 克隆完成后的提交推送（审计门禁 + 凭据注入）；推送成功会重建仓库索引 |
| `git_sluice` | 在克隆下来的仓库里执行 log/diff/branch 等 git 命令（凭据自动注入） |
| `git_account_check` / `git_cred_env` | 克隆私有库前先确认 token/SSH 可用；外部命令取凭据环境前缀 |
| `dsh-repo-index.json` | 仓库索引（权威源码索引，存插件配置目录 `DSH_HOME/git-push/`）：记录每个项目的仓库地址、可见性、恢复命令 `cloneCmd`、skills 与本地 `path`，`version` 恒为 1、`generatedAt` 每次刷新；源码丢失时按它 `git_clone` 恢复，本地列表据此标注仓库归属 |
| 侧边栏「账号信息 → 仓库管理」 | 本地子选项卡按索引标注归属并可 `push`；云端子选项卡「加载仓库列表」选目录后走同一套后台克隆 |
