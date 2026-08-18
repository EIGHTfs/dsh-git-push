# dsh-git-push

DSH（DeepSeek Harness）git 自动提交推送插件 v1.1.0。把"扫描仓库 → **审计** → 一键 commit + push"固化为 agent 工具与 HTTP API，**执行零 token 消耗、确定性输出**（相比每次让 AI 手敲 git 命令）。

## 功能

- **git_scan**：扫描 DSH workspace 下全部 git 仓库，返回分支 / remote / 未提交变更数 / 最近活动
- **git_commit_push**：对指定仓库一键 `git add -A → commit → push`，自动处理：
  - **推送前代码审计**（v1.1.0 内置，默认开）：L0 静态检查（语法 / JSON / YAML / 敏感信息硬编码 / 凭据入库 / 二进制大文件 / debugger 残留），发现严重问题**拦截提交**
  - 可选 **L1 LLM 深度审查**（默认关，省 token）：diff 喂便宜模型（如 agnes-2.5-flash / deepseek-chat）找逻辑/安全问题，实测可精准检出越界、空值、除零等 bug
  - 自动识别当前分支（master / main 不硬编码）
  - push 前 `fetch` + `rev-list` 检查 ahead/behind，**远端领先时不推**
  - 无变更自动跳过（不产生空提交）
  - `-c safe.directory=` 兼容 CIFS 只读卷（如 /vol02）
- **code_audit**：手动审计指定仓库（`llm=true` 追加深度审查）
- **HTTP API**：`status` / `scan` / `audit` / `commit`，curl 即可调用，便于外部脚本/定时任务接入

## 安装

```bash
# 1. 源码放 node_modules_local/ 或 workspace 独立目录，注册三要素：
#    package.json 加 "dsh-git-push": "file:./node_modules_local/dsh-git-push"（或相对路径）
#    node_modules 补软链
#    cordis.patch.yml 追加：
- insert:
    - id: git-push
      name: dsh-git-push
      config:
        workspaceRoot: '/vol1/@appshare/DeepSeekHarness/workspace'
        extraRepos: ['/vol02/1000-0-1789e550/gamebanana-mods-downloader']
        # llmAuditProvider: "free"          # 可选：LLM 审查用便宜模型
        # llmAuditModel: "agnes-2.5-flash"  # 如 agnes / deepseek-chat
        # llmAudit: true                    # 默认 false（省钱）
        # blockOn: "blocker"                # 'blocker'=仅严重问题拦截（默认）| 'any'=任何问题拦截
# 2. 重启 DSH（改 patch 必须重启）
```

## API

| 接口 | 说明 |
|---|---|
| `GET /api/git-push/status` | 插件状态（版本 + 配置 + 审计开关 + git 版本） |
| `GET /api/git-push/scan` | 扫描全部仓库状态 |
| `GET /api/git-push/audit?repo=<路径>&llm=true` | 审计指定仓库（llm=true 追加 LLM 深度审查） |
| `POST /api/git-push/commit` | `{repo, message, push?, dryRun?, audit?, llmAudit?}` 审计通过后一键提交推送 |

```bash
# 审计一个仓库（L0 静态）
curl -s 'http://127.0.0.1:3083/api/git-push/audit?repo=/vol1/@appshare/DeepSeekHarness/workspace/ai-work-archive'
# 追加 LLM 深度审查
curl -s 'http://127.0.0.1:3083/api/git-push/audit?repo=...&llm=true'
# 提交（默认先审计，发现严重问题拦截返回 findings）
curl -s -X POST http://127.0.0.1:3083/api/git-push/commit -H 'Content-Type: application/json' \
  -d '{"repo":"/vol1/@appshare/DeepSeekHarness/workspace/ai-work-archive","message":"feat: xxx","audit":true}'
```

## 工具（agent 会话内直接调用）

- `git_scan`：查看哪些仓库有未提交/未推送改动
- `git_commit_push`：`{repo, message, push?, dryRun?, audit?, llmAudit?}` 提交推送（默认先审计）
- `code_audit`：`{repo, llm?}` 手动审计仓库

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `workspaceRoot` | `process.cwd()` | 扫描根目录 |
| `extraRepos` | `[]` | 额外仓库绝对路径（find 范围外） |
| `depth` | `3` | find 深度 |
| `auditEnabled` | `true` | 提交前 L0 静态审计开关 |
| `blockOn` | `'blocker'` | 拦截策略：`blocker`=仅严重问题拦截（语法/敏感信息/凭据/大文件）| `any`=任何问题（含 warning）拦截 |
| `llmAudit` | `false` | L1 LLM 深度审查开关（**默认关，省钱**） |
| `llmAuditProvider` / `llmAuditModel` | `''` | LLM 审查用的便宜模型，如 `free`/`agnes-2.5-flash`、`deepseek`/`deepseek-chat` |
| `maxDiffBytes` | `6000` | LLM 审查的 diff 截断上限 |

## 开发与测试

```bash
node --check lib/core.js && node --check lib/index.js   # 语法
node test-core.mjs    # 核心逻辑 13 项（真实 git 临时仓库）
node test-audit.mjs   # 审计规则 13 项（L0 静态）
node test-apply.mjs   # apply mock 16 项（路由 + 工具 + 审计门禁端到端）
```

真机验证：测试实例 3083 加载 v1.1.0，`status/scan/audit/commit` 全通；LLM 审计（agnes-2.5-flash）真实检出越界/空值/除零等逻辑 bug；commit 对含密钥文件审计拦截。

## 已知边界

- push 依赖 SSH remote（本机 git 缺 `remote-https`，SSH 已全局配置）；HTTPS remote 仓库会 push 失败
- 远端领先时拒绝推送（防覆盖），需先 pull
- L1 LLM 审查依赖 DSH llm 服务可用且已配置 `llmAuditProvider/Model`；不可用时自动跳过（不阻断），L0 不受影响
- 只做"管道"：commit message 等判断留给 LLM

## 版本记录

| 版本 | 内容 |
|---|---|
| 1.1.0 | 内置代码审计门禁（L0 静态 + L1 LLM 可选）：`git_commit_push` 推送前审计拦截、`code_audit` 工具、`/api/git-push/audit` 端点 |
| 1.0.0 | git 扫描 / 一键提交推送 / HTTP API |

