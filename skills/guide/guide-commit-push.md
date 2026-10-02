---
name: guide-commit-push
description: dsh-git-push 功能说明：提交推送（凭据、提交前门禁、自动推送、返回字段）。处理提交推送类请求时加载。
whenToUse: 要提交/推送代码、查凭据放哪、被门禁拦住要放行、或想开任务完成自动推送时。
updated: 2026-10-02
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-10-02
---

# 提交推送（guide-commit-push）

> 一句话定位：把「审计门禁 → add/commit → 推送」固化成一次工具调用，凭据由插件托管，AI 不必手敲 git 命令。

## 一、这个功能能干什么

| 能力 | 说明 |
|---|---|
| 一键提交推送 | `git_commit_push` 一条调用完成 add + commit + push（默认全量暂存，也可只暂存指定路径） |
| 提交前审计门禁 | 先跑代码审计，命中 blocker 立即拦截、**不执行任何 git 操作**；warning/notice 只提示不拦 |
| 凭据托管 | GitHub token 与 SSH 公钥统一存在插件配置目录，推送时自动注入，无需手动配 git 凭据 |
| 推送通道 | `ssh`（默认，推本地 HEAD，远端 sha 与本地一致）/ `api`（Git Data API 重建提交）/ `auto`（有私钥走 ssh，否则 api） |
| 后台任务 | commit+push 注册为宿主官方后台 job，工具立即返回 `jobId`；宿主无 job 控制器时同步执行保底 |
| 门禁开关 | `requirementsConfirmed`（开发者要求核对）、`pushConfirmed`（推送门禁放行）、`force`（强推）、`dryRun`（只预演） |
| 任务完成自动推送 | 开关开启后，AI 回合结束的回复里含指定完成文案，自动对目标仓库走同一套门禁提交推送 |
| 私有库豁免 | 远端可见性 = private 时，审计只报告不拦截；敏感文件只扫描报告、不改写忽略配置 |

## 二、怎么用

### 参数表（工具 `git_commit_push`）

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `repo` | string | ✅ | — | 本地 git 仓库根目录路径 |
| `message` | string | ✅ | — | commit message；空/纯空白直接拒绝 |
| `push` | boolean | — | `true` | `false` = 只提交不推送 |
| `audit` | boolean | — | 取配置 `auditEnabled`（默认关） | `true` 强制审计、`false` 跳过本次审计 |
| `dryRun` | boolean | — | `false` | 只预演：跑门禁与流程、不写盘、不 commit、不 push |
| `force` | boolean | — | `false` | 强推覆盖远端历史（SSH 用 `--force`；API 通道重建提交、不挂旧 parent） |
| `ignorePatterns` | string | — | 空 | 追加进 `.gitignore` 的自定义忽略项（逗号/换行分隔，幂等） |
| `requirementsConfirmed` | boolean | — | `false` | 开发者要求清单已逐条核对达标才置 `true`，否则被拦 |
| `pushConfirmed` | boolean | — | `false` | 推送门禁（配置 `pushGate`）开启时，推必须显式放行 |
| `paths` | string | — | 空 | 精确 add 路径（逗号分隔，相对仓库）；空 = 全量暂存 |

### 返回字段（即时返回）

| 字段 | 说明 |
|---|---|
| `ok` | 调用是否被受理/成功；被门禁拦截时为 `false` |
| `async` | `true` = 已注册后台 job（结果完成会自动回传）；`false` = 同步执行完 |
| `jobId` | 后台任务 id（如 `git-push-1`），可用宿主 `job_output` / `job_list` / `job_kill` 查询或中止 |
| `jobFallback` | `true` = 宿主后台 job 不可用，已自动降级为同步执行（结果就在 `result`） |
| `audit` | 审计摘要（`summary` 各级数量 / `quality` 评分 / `blocked` 拦截明细 / `privateExempt` 私有库豁免标记）；未开审计时为 `null` |
| `hint` | 查询提示文案 |
| `error` / `blocked` / `code` | 失败或拦截说明；`code` 取值 `USER_REQUIREMENTS`、`PUSH_GATE` |

### 返回字段（最终结果 `result`——后台 job 完成输出，或同步执行直接返回）

| 字段 | 说明 |
|---|---|
| `result.commitSha` | 本次提交的 sha（无变更/预演时可能没有） |
| `result.pushed` | 是否真的推送到远端 |
| `result.committed` | 是否产生了新提交（无变更跳过时为 `false`） |
| `result.push.method` | 实际走的通道：`ssh` / `api` / `ssh-fallback` |
| `result.push.owner` / `repo` / `branch` | 推送目标（从 origin 解析） |
| `result.push.fallbackReason` | 主通道失败回落另一通道的原因 |
| `result.push.remoteRef` / `auxRemote` | 本地远端跟踪引用更新结果 / 辅助 SSH remote（`github-ssh`）就绪情况 |
| `result.autoTag` | 推送成功后对 `dsh-` 前缀项目按 `package.json` 版本自动打 tag 的结果 |
| `result.remoteHeads` | 远端该分支最近 3 条提交（核对远端真实状态用） |
| `result.indexUpdated` | `true` = 推送成功后本地仓库索引已重建 |
| `result.steps` | 逐步痕迹：`预检` / `敏感文件 .gitignore` / `private-exempt(...)` / `add` / `commit` / `push` / `pushed-via-ssh` 等 |
| `result.message` / `error` | 跳过原因（如「无变更，跳过提交」）或失败原因 |

## 三、可直接复制的例子

**① 标准提交推送**（要求清单存在时必须带核对标记）

```js
git_commit_push({ repo: "<仓库路径>", message: "feat: 新增 XX 能力", requirementsConfirmed: true })
```

预期：`{ ok:true, async:true, jobId:"git-push-1", audit:{ summary:{...}, quality:{...} } }`；job 完成后输出 `{ ok:true, commitSha:"a1b2c3d…", pushed:true, push:{ method:"ssh", branch:"master" }, indexUpdated:true }`。

**② 只提交不推送 / 先预演 / 只提交指定文件**

```js
git_commit_push({ repo: "<仓库路径>", message: "docs: 更新说明", push: false, requirementsConfirmed: true })
git_commit_push({ repo: "<仓库路径>", message: "feat: 试跑", dryRun: true })
git_commit_push({ repo: "<仓库路径>", message: "fix: 修正解析", paths: "src/parser.js,README.md", requirementsConfirmed: true })
```

预演预期：`{ ok:true, async:true, jobId:"git-push-2" }`，完成后 `{ ok:true, dryRun:true, steps:["预检","commit","push"] }`（无任何写入）。

**③ 推送门禁已开启时显式放行 / 强推**

```js
git_commit_push({ repo: "<仓库路径>", message: "chore: 同步", requirementsConfirmed: true, pushConfirmed: true })
git_commit_push({ repo: "<仓库路径>", message: "chore: 重写历史后同步", force: true, requirementsConfirmed: true, pushConfirmed: true })
```

**④ 被拦后的典型返回**

```json
{ "ok": false, "blocked": true, "error": "审计拦截：2 个 blocker → src/a.js:12（凭据硬编码）；docs/b.md:3（沟通措辞残留）" }
{ "ok": false, "blocked": true, "code": "USER_REQUIREMENTS", "error": "开发者特殊要求未核对：…" }
{ "ok": false, "blocked": true, "code": "PUSH_GATE", "commitSha": "a1b2c3d…", "push": { "pushed": false, "reason": "push-gate" } }
```

## 四、边界与坑

| 现象 | 原因 | 处理 |
|---|---|---|
| `ok:false, blocked:true`（审计拦截） | 审计命中 blocker（凭据硬编码、语法错误、沟通措辞等） | 先按 `audit.blocked` 列表修文件，再重调；`public`/`unknown` 可见性一律保守拦截 |
| 返回 `code:"USER_REQUIREMENTS"` | 存在开发者要求清单，但未带 `requirementsConfirmed:true` | 逐条核对达标后置 `true` 重调 |
| 返回 `code:"PUSH_GATE"` | 配置 `pushGate` 已开启，未带 `pushConfirmed:true` | 确认要推时带 `pushConfirmed:true` 重调（**可沿用本次 commit，不会重复提交**） |
| `非 git 仓库` / `commit message 必填` | `repo` 下无 `.git`，或 `message` 为空 | 先确认仓库路径、补 message |
| `HEAD 处于 detached 状态` | 当前在游离 HEAD 上 | 先 `git checkout <分支>` 再提交 |
| 推送失败且 `push.diverged:true` | 远端已分叉（non-fast-forward） | **不会静默回落 API**：先 fetch 整合远端；确认要覆盖再带 `force:true` |
| `pushed:false` + `reason:"无新提交可推送"` | 远端内容与本地一致（内容级短路） | 正常情况，不是错误 |
| `message:"无变更，跳过提交"` | 工作区干净 | 正常情况；若本地领先远端，仍会继续推送 |
| 返回 `jobFallback:true` | 宿主后台 job 控制器不可用/不服务当前会话 | 已自动同步执行，直接看 `result`，无需再查 job |
| `push.method:"api"` + `fallbackReason` | SSH 无可用私钥或 SSH 推送失败，回落 API | 远端 sha 与本地不同属正常；要远端 sha 一致就配好 SSH 私钥 |
| 私有库仍报敏感文件 | 扫描是**只报告**，不改 `.gitignore`、不解除跟踪 | 按报告自行决定移除或转私有 |
| 私有库审计不拦 | 远端可见性 = `private` → 审计只报告不拦截（返回 `privateExempt`） | 转公开前必须先把私密文件清掉 |

**凭据管理要点**

- 存放位置：插件配置目录 `<配置目录>/config.json`（即 `DSH_HOME/git-push/config.json`，无 `DSH_HOME` 时退到 `HOME/.dsh/git-push/`）。
- token 存 `githubToken` 键（`ghp_` / `github_pat_` 开头，0600）；SSH **公钥**存 `sshPub` 键；SSH **私钥**是文件 `<配置目录>/id_rsa`（也支持 `id_ed25519` / `id_ecdsa`），不进 json。
- token 解析优先级：显式传入 → 环境变量 `DSH_GIT_PUSH_TOKEN` / `GITHUB_TOKEN` → 显式指定的文件 / 仓库内 `.git-push-token` → `config.json` 的 `githubToken`。
- SSH 私钥优先级：`id_rsa` → `id_ed25519` → `id_ecdsa`；推送时**逐把尝试**，直到某把能推（未登记到 GitHub 的那把会跳过）。
- 脱敏值（含 `…` / `****`）会被拒绝写入，防止把回显的打码串覆盖成真凭据。
- 推送通道与推送门禁在插件设置里改：`pushMethod`（`ssh` 默认 / `api` / `auto`）、`pushGate`（默认关）。

**任务完成自动推送**

- 开关 `autoPushEnabled`（**默认关**）；触发文本 `autoPushTriggerText`（默认 `✅任务完成`，支持正则如 `✅(任务完成|已解答)`）；范围 `autoPushScope`（`session` 默认＝仅会话 cwd 所在仓库 / `all`＝工作区全部有变更仓库）；提交信息 `autoPushMessage`（默认 `chore(ai): 任务完成自动提交`）。
- 触发时机：AI 回合结束（`turn/end`）→ 提取最后一条回复 → 命中触发文本才推送；`❌` / `⚠️ 未完成` 等不触发，无完成标记不触发。
- 走的是**同一套门禁**：强制审计 + 自动带要求核对标记与推送放行；并发闸（同时只跑一个）+ 同回合去重 + 防抖。
- 开关关闭时完全不动作；会话目录不在任何 git 仓库内时报「无推送目标」而不推。

## 五、相关功能

| 功能 | 关系 |
|---|---|
| `git_scan` | 先扫「哪个仓库有未提交/未推送」，再决定提交哪个 |
| `code_audit` | 独立审计（可 `scope:"full"`、`includeFindings`、历史提交审计），提交前自查用 |
| `git_account_check` | 校验 token/SSH 是否有效、以谁的身份推；改凭据前后用 |
| `git_cred_env` | 输出凭据环境变量前缀（不含明文），外部 git 命令粘贴使用 |
| `git_remote_create` | 仓库还没远端时先建远端并设 origin（默认 private） |
| `git_set_visibility` | 切换 public/private；改 public 前先确认无私密内容 |
| `git_clone` | 从 GitHub 克隆仓库（Git Data API，不直连 github.com） |
| `git_sluice` | 浅包装 git 透传（log/diff/branch/tag 等只读或低频命令），凭据自动注入 |
| CLI | `git-sluice commit <仓库> -m "msg"` 与工具同源（审计门禁一致）；CLI 默认只提交，加 `--push` 才推 |
