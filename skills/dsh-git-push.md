---
name: dsh-git-push
description: dsh-git-push 插件（git 自动提交推送）的使用手册：git_scan / git_commit_push 工具与 /api/git-push API 的调用方法、配置、验证与坑速查。处理"提交推送代码""扫描仓库状态""用 dsh-git-push 插件"类请求时加载；插件不可用/报错排查时必加载（正常情况优先用插件，见 plugin-priority）。
whenToUse: 需要用插件做 git 提交推送但不确定参数/报错排查/插件未装需手做时。
generatedBy: deepseek-official/deepseek-v4-flash
---

# dsh-git-push 插件手册

> 插件源码：`workspace/dsh-git-push/`（GitHub: EIGHTfs/dsh-git-push）。定位：把"扫描仓库 → 一键 commit+push"固化为代码管道（零 token、确定性）。**正常情况优先调插件工具，本 skill 是手册（排查/未装时用）**——见 plugin-priority skill。

## 一、工具（agent 会话内直接调用）

| 工具 | 参数 | 说明 |
|---|---|---|
| `git_scan` | 无 | 扫描 workspace 全部 git 仓库 → 分支/remote/未提交变更数/最近活动 |
| `git_commit_push` | `repo`(绝对路径), `message`(必填), `push?`, `dryRun?` | add -A → commit → push（自动识别分支、push 前检查 ahead/behind） |

用法示例：`git_scan` 看哪些仓库有改动 → `git_commit_push {repo:"/vol1/@appshare/DeepSeekHarness/workspace/ai-work-archive", message:"feat: xxx", push:true}`。

## 二、HTTP API

| 接口 | 说明 |
|---|---|
| `GET /api/git-push/status` | 插件状态（配置 + git 版本） |
| `GET /api/git-push/scan` | 扫描全部仓库状态 |
| `POST /api/git-push/commit` | `{repo, message, push?, dryRun?}` 一键提交推送（curl 用 `-H 'Content-Type: application/json'`） |

测试实例地址：`http://127.0.0.1:3083/api/git-push/status`（局域网反代 3084）。

## 三、配置（cordis.patch.yml）

```yaml
- insert:
    - id: git-push
      name: dsh-git-push
      config:
        workspaceRoot: '/vol1/@appshare/DeepSeekHarness/workspace'   # 扫描根
        extraRepos: ['/vol02/1000-0-1789e550/gamebanana-mods-downloader']  # find 范围外仓库
        depth: 3
```

## 四、验证与测试

```bash
node --check lib/core.js && node --check lib/index.js  # 语法
node test-core.mjs    # 核心 13 项（真实 git 临时仓库）
node test-apply.mjs   # apply mock 7 项
curl -s http://127.0.0.1:3083/api/git-push/status      # 加载验证
```

## 五、坑速查

| 坑 | 处理 |
|---|---|
| HTTPS remote push 失败 | 本机 git 缺 `remote-https`，必须 SSH remote（`git@github.com:EIGHTfs/<repo>.git`，全局 core.sshCommand 已配） |
| `src refspec main does not match` | 本地分支是 master，插件已自动取 `branch --show-current`，不硬编码 |
| 远端领先不推 | 插件 push 前 `fetch` + `rev-list` 检查 ahead/behind，远端领先返回 reason，需先 pull |
| `/vol02` 只读卷 doubtful ownership | 插件每次命令带 `-c safe.directory=`，无需改全局 config |
| 空提交 | 无变更自动跳过（`committed:false, reason:无变更`） |
| 插件报 404 | 未注册/未重启：检查 cordis.patch.yml insert + package.json file: 依赖 + node_modules 软链 + 重启 |

## 六、边界

- 只做管道：commit message 由 LLM 生成；插件不判断"该不该提交"
- 提交历史/网页查看用 git-commits-viewer skill；跨 AI 冲突审查见 git-collab-conflict skill
