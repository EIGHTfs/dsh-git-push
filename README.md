# dsh-git-push

DSH（DeepSeek Harness）git 自动提交推送插件。把"扫描仓库 → 一键 commit + push"固化为 agent 工具与 HTTP API，**执行零 token 消耗、确定性输出**（相比每次让 AI 手敲 git 命令）。

## 功能

- **git_scan**：扫描 DSH workspace 下全部 git 仓库，返回分支 / remote / 未提交变更数 / 最近活动
- **git_commit_push**：对指定仓库一键 `git add -A → commit → push`，自动处理：
  - 自动识别当前分支（master / main 不硬编码）
  - push 前 `fetch` + `rev-list` 检查 ahead/behind，**远端领先时不推**
  - 无变更自动跳过（不产生空提交）
  - `-c safe.directory=` 兼容 CIFS 只读卷（如 /vol02）
- **HTTP API**：`status` / `scan` / `commit`，curl 即可调用，便于外部脚本/定时任务接入

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
# 2. 重启 DSH（改 patch 必须重启）
```

## API

| 接口 | 说明 |
|---|---|
| `GET /api/git-push/status` | 插件状态（配置 + git 版本） |
| `GET /api/git-push/scan` | 扫描全部仓库状态 |
| `POST /api/git-push/commit` | `{repo, message, push?, dryRun?}` 一键提交推送 |

## 工具（agent 会话内直接调用）

- `git_scan`：查看哪些仓库有未提交/未推送改动
- `git_commit_push`：`{repo, message, push?, dryRun?}` 提交推送（repo 传绝对路径，可用 git_scan 查）

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `workspaceRoot` | `process.cwd()` | 扫描根目录 |
| `extraRepos` | `[]` | 额外仓库绝对路径（find 范围外） |
| `depth` | `3` | find 深度 |

## 开发与测试

```bash
node --check lib/core.js && node --check lib/index.js   # 语法
node test-core.mjs    # 核心逻辑 13 项（真实 git 临时仓库）
node test-apply.mjs   # apply mock 7 项（路由 + 工具注册）
```

真机验证：测试实例 3083 加载，`status/scan/commit` 全通（真实扫描 17 仓库、真实提交）。

## 已知边界

- push 依赖 SSH remote（本机 git 缺 `remote-https`，SSH 已全局配置）；HTTPS remote 仓库会 push 失败
- 远端领先时拒绝推送（防覆盖），需先 pull
- 只做"管道"：commit message 等判断留给 LLM
