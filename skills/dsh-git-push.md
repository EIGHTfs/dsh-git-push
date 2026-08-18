---
name: dsh-git-push
description: dsh-git-push 插件（git 自动提交推送 v1.1.0，内置代码审计门禁）的使用手册：git_scan / git_commit_push / code_audit 工具与 /api/git-push API 的调用方法、配置（审计 blockOn/llmAudit）、验证与坑速查。处理"提交推送代码""扫描仓库状态""审计代码""推送前拦截 bug""敏感信息检测"类请求时加载；插件不可用/报错排查时必加载（正常情况优先用插件，见 plugin-priority）。
whenToUse: 需要用插件做 git 提交推送/代码审计但不确定参数/报错排查/插件未装需手做时。
generatedBy: deepseek-official/deepseek-v4-flash
---

# dsh-git-push 插件手册

> 插件源码：`workspace/dsh-git-push/`（GitHub: EIGHTfs/dsh-git-push）。定位：把"扫描仓库 → **审计** → 一键 commit+push"固化为代码管道（零 token、确定性）。v1.1.0 内置代码审计门禁（源自 dsh-code-audit 实测验证，该独立插件已停用并入本插件）。**正常情况优先调插件工具，本 skill 是手册（排查/未装时用）**——见 plugin-priority skill。

## 一、工具（agent 会话内直接调用）

| 工具 | 参数 | 说明 |
|---|---|---|
| `git_scan` | 无 | 扫描 workspace 全部 git 仓库 → 分支/remote/未提交变更数/最近活动 |
| `git_commit_push` | `repo`, `message`(必填), `push?`, `dryRun?`, `audit?`(默认true), `llmAudit?`(默认false) | **先审计** → add -A → commit → push（自动识别分支、ahead/behind 检查） |
| `code_audit` | `repo`, `llm?` | 手动审计仓库：L0 静态（默认）+ L1 LLM（llm=true） |

用法示例：`git_scan` 看改动 → 先 `code_audit {repo:"...", llm:true}` 自查 → `git_commit_push {repo:"...", message:"feat: xxx", push:true}`（审计通过才推）。

## 二、审计（v1.1.0 内置，重点）

- **L0 静态检查（零 token，默认开）**：JS 语法（node --check）/ JSON / YAML / 敏感信息硬编码（GitHub PAT、sk- key、密钥键值对）/ 凭据文件入库（.env/.credentials）/ 二进制大文件（>1MB）/ debugger 残留 / console.log≥5 / TODO/FIXME
- **L1 LLM 深度审查（默认关，省钱）**：diff 喂便宜模型找逻辑/安全问题，实测 agnes-2.5-flash 精准检出越界/空值/除零/fetch 未检查 res.ok 等 bug
- **拦截策略 blockOn**：`blocker`（默认，仅严重问题拦截）/ `any`（任何问题拦截）
- 审计范围 = 工作区相对 HEAD 变更（**含 untracked 新文件**，LLM 也看得到）
- 拦截时 commit 返回 `{ok:false, error:{code:'AUDIT'}, findings}`，不产生提交

## 三、HTTP API

| 接口 | 说明 |
|---|---|
| `GET /api/git-push/status` | 插件状态（版本 + 配置 + 审计开关 + git 版本） |
| `GET /api/git-push/scan` | 扫描全部仓库状态 |
| `GET /api/git-push/audit?repo=<路径>&llm=true` | 审计指定仓库（llm=true 追加深度审查） |
| `POST /api/git-push/commit` | `{repo, message, push?, dryRun?, audit?, llmAudit?}` 审计通过后提交推送（curl 用 `-H 'Content-Type: application/json'`） |

测试实例地址：`http://127.0.0.1:3083/api/git-push/status`（局域网反代 3084）。

## 四、配置（cordis.patch.yml）

```yaml
- insert:
    - id: git-push
      name: dsh-git-push
      config:
        workspaceRoot: '/vol1/@appshare/DeepSeekHarness/workspace'   # 扫描根
        extraRepos: ['/vol02/1000-0-1789e550/gamebanana-mods-downloader']
        auditEnabled: true          # L0 静态审计开关
        blockOn: 'blocker'          # 'blocker'=仅严重拦截 | 'any'=严格
        llmAudit: false             # L1 LLM 审查（默认关省钱）
        llmAuditProvider: 'free'    # LLM 审查用便宜模型
        llmAuditModel: 'agnes-2.5-flash'   # 如 agnes / deepseek-chat
        maxDiffBytes: 6000          # LLM 审查 diff 截断
```

## 五、验证与测试

```bash
node --check lib/core.js && node --check lib/index.js  # 语法
node test-core.mjs    # 核心 13 项（真实 git 临时仓库）
node test-audit.mjs   # 审计规则 13 项（L0 静态）
node test-apply.mjs   # apply mock 16 项（含审计门禁端到端）
curl -s http://127.0.0.1:3083/api/git-push/status      # 加载验证
```

## 六、坑速查

| 坑 | 处理 |
|---|---|
| HTTPS remote push 失败 | 本机 git 缺 `remote-https`，必须 SSH remote（全局 core.sshCommand 已配） |
| `src refspec main does not match` | 本地分支是 master，插件已自动取 `branch --show-current` |
| 远端领先不推 | 插件 push 前 `fetch` + `rev-list`，远端领先返回 reason，需先 pull |
| `/vol02` 只读卷 doubtful ownership | 插件每次命令带 `-c safe.directory=` |
| commit 被 AUDIT 拦截 | 看返回 `findings` 修掉问题重推；确认误报可 `audit:false`（不推荐）或调 blockOn |
| LLM 审查没跑 | 检查 `llmAudit` 开关 + `llmAuditProvider/Model` 配置 + DSH llm 服务可用（.credentials.yaml 有 key）；不可用自动跳过不阻断 |
| 空提交 | 无变更自动跳过（`committed:false, reason:无变更`） |
| 插件报 404 | 未注册/未重启：检查 patch insert + file: 依赖 + 软链 + 重启 |
| code-audit 独立插件 | 已停用并入本插件（v1.1.0），测试实例不再加载；不要再 install dsh-code-audit |

## 七、边界

- 只做管道：commit message 由 LLM 生成；插件不判断"该不该提交"
- LLM 审计默认关（省钱）：需要深度审查时显式 `llmAudit:true` 或 `code_audit {llm:true}`
- 提交历史/网页查看用 git-commits-viewer skill；跨 AI 冲突审查见 git-collab-conflict skill
