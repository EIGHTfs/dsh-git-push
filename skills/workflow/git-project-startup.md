---
name: git-project-startup
description: 项目开工三件事：先和远端对齐、再读提交历史、发现他人改动先审查后接纳。处理项目开工/接手/协作冲突类请求时加载。
whenToUse: 任何项目开工、接手、继续开发、排查状态前；git 里发现他人改动或冲突时。
updated: 2026-10-02
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-10-02
---

# 项目开工与协作（git-project-startup）

> 核心一句话：**开工第一件事是和远端对齐，第二件事是读提交历史，开发中发现他人改动先审查再接纳。**

## 一、开工第一步：和远端对齐

**开工的第一个动作 = 和远端对齐**，不是写代码、不是建目录、不是 `git add`。

| 场景 | 开工前第一动作 |
|------|----------------|
| git 仓库（GitHub 或任何远端 git） | 先 `git fetch` 看远端是否被推进 → 有差异先 `pull` 对齐 → 确认一致再开工 |
| 非 git 远端（SFTP / rsync / 共享目录） | 先拉取或对比远端（`rsync -avn` dry-run / `sftp` 列目录 / 比对 mtime），确认一致再动手 |
| 新项目（尚无远端） | 先确认远端是否存在/连通，有则先拉下来，无则先初始化 |
| 继续开发 / 排查 | 先对齐远端，再读提交历史（读历史是第二步） |
| 用户明确说不用对齐 | 按用户指令跳过 |

为什么：防基于过时基线开发（白干 + 必冲突）、防本地旧状态覆盖远端新内容、防多机多会话各自为战；**远端不止 GitHub**，SFTP / 共享盘 / rsync 目录同样是远端真相。

| 远端类型 | 对齐动作 | 注意 |
|----------|----------|------|
| GitHub | `git fetch` → 看 `origin/<branch>` 差异 → pull | 禁止 `github.com` 直连，走 api.github.com；token 失效走 `ssh.github.com:443` |
| 任意 git remote | `git fetch` + `git log HEAD..origin/<branch>` | 远端领先必须拉，禁止先 push |
| SFTP | 列远端目录 / 对比 | 先读远端，不先写远端 |
| rsync 目录 | `rsync -avn` dry-run 先看差异 | dry-run 先行 |
| 共享盘 / 挂载目录 | 比对两端 mtime / 文件清单 | 双向都可能改，先确认哪边新 |

对齐完成后**必须汇报**：远端有哪些本地没有的变更、已同步了什么。对齐是「拉」不是「推」，推送仍需授权。

## 二、第二动作：读提交历史

| 场景 | 动作 |
|------|------|
| 用户说「进项目读提交历史 / 看下这项目提交」 | 进目录跑 `git log`，读完汇报要点；**禁止只报 commit 数或摘要** |
| 接手 / 了解项目 | 读分支 + 最近 N 条提交 + 提交信息类型，从提交信息看项目脉络 |
| 排查项目状态 | 先看最近提交在做什么（功能/修复/文档），再定排查方向 |
| 引用某项目提交记录 | 以实读为准（短哈希 + 提交信息），禁止凭印象编造 |

```bash
cd <项目目录>/<仓库名>
git branch --show-current                                  # 先看分支，别假设 master
git log --pretty=format:"%h|%ad|%s" --date=format:"%m-%d %H:%M" -20
git show --stat --oneline HEAD | head -20                  # 最近一次改了哪些文件
git show --stat <短哈希>                                    # 某条提交的具体改动
```

- 提交信息格式：`type(scope): 描述`（feat/fix/docs/chore/skill 等）
- 分支：master 与 main 都有，**读之前先看分支**
- 汇报格式：仓库名 → 分支 → 最近活动 → 最近提交主线（3~5 条概括），让用户一眼看清每个项目最近在干什么
- 快速盘点所有仓库：用插件的 `git_scan`；仓库地址权威源：`dsh-repo-index`

坑：别在仓库外跑 `git log`；只看摘要不算读；项目目录顶层可能有散落脚本/产物文件（非仓库），认准有 `.git` 的子目录。

## 三、发现他人改动：先审查后接纳

**触发**：`git pull` 后出现非自己的提交、`git status`/`git diff` 显示自己没改过的改动、merge 冲突、文件被覆盖。判定关键是「**作为本来的开发者却不知道**」——出现陌生改动就必须查对方改了什么、为什么、有没有 bug。

审查流程：

1. 识别范围：`git log --oneline -10`、`git log --name-status -3`、`git diff origin/<branch>..HEAD --stat`、`git status --short`
2. 定位改动：`git log --all --oneline -- <file>`、`git diff <他人commit>~1 <他人commit> -- <file>`
3. **优先查对方 bug**（不跳过）：是否破坏自己已实现的功能/约定（API 签名、字段名、端口、路径、配置键、时序）、是否引入明显错误、是否违反本工作区 skill 约定；逐项列出「改了什么 → 潜在 bug → 影响」
4. 处理：有 bug → 指出并修复（或回退并说明）；正确 → 采纳后继续；与自己冲突 → 保留自己版本并说明冲突点，必要时问用户
5. 固化：把「冲突 + 对方 bug + 处理方式」提炼进对应 skill

典型教训：并行会话容易互踩（同一配置文件/入口文件被覆盖）→ pull 前先 `git fetch` 看远端是否被推进；「写了没测试」的他人改动，审查时核对验证状态是否属实，不轻信 commit message；同一文件两份副本不同步时，以权威源为准。

## 四、元规则：skill 是强约束

本工作区固化的所有 skill（尤其约定类）**对所有 AI 所有会话生效**，是必须遵守的规则而不是参考文档；任何 AI 在做相关操作前必须加载并遵守。新建/更新 skill 后按存放规则同步并提交。

## 五、配套 skill

- `github-operations`：GitHub 操作通道（api.github.com）与项目恢复
- `git-commit-discipline`：提交检查点、批量操作前提交、提交信息规范
- `dsh-repo-index`：仓库地址与可见性权威源
- `verify-before-diagnose`：排查先实测
- `bugfix-auto-authority`：commit 可自主、push 需同意
