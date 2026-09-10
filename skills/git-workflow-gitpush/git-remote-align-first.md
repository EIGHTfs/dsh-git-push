<!-- dsh-skip-sensitive: 规则文档，引用用户决策原文作溯源（豁免仅限敏感内容类规则：措辞/凭据引用；硬编码与质量规则照常） -->

---
name: git-remote-align-first
description: 项目开始前第一件事和远端对齐硬规则（2026-09-07 EIGHTfs 确立，约束所有 AI 所有会话）：**任何项目（新项目/接手/继续开发/排查）动手前第一件事 = 先和远端对齐——git 仓库先 fetch/pull 对齐远端（GitHub 走 api.github.com，token 失效走 ssh.github.com:443），非 git 远端（SFTP/rsync/共享盘等）先拉取/对比远端状态再动手**——防止基于过时基线开发、防止本地旧状态覆盖远端新状态、防止多机多会话冲突。处理「开始新项目」「接手项目」「继续开发」「项目开工前先做什么」「和远端对齐」「远端同步」类请求时加载；与 git-collab-conflict（他人改动审查）、git-project-read-history（读提交历史）、github-api-only（GitHub 走 API）、git-commit-before-batch-ops（批量操作前提交）配套。
whenToUse: 任何项目开工/接手/继续开发/排查的第一步；用户要求先和远端对齐、远端同步；不确定本地与远端是否一致时；多机/多会话协作仓库每次开工前。
generatedBy: user-request 2026-09-07（EIGHTfs：项目开始前第一件事就是和远端对齐，不仅是 github，也可你是 SFTP 等）
---

> ⭐ **先记住我**：任何会话开始前，先读用户档案 `.dsh/skills/remember-me.md`（优先级最高的 skill）：我是谁、我怎么用你、我立过的规矩。

# 项目开始前第一件事：和远端对齐（git-remote-align-first）

> 2026-09-07 用户（EIGHTfs）确立，约束所有 AI 所有会话。
> 核心一句话：**任何项目开工前，第一件事是和远端对齐——git 仓库先 fetch/pull，非 git 远端（SFTP 等）先拉取/对比——对齐后才开始动手。远端不只有 GitHub，还有 SFTP / rsync / 共享盘等一切数据源。**

## 一、规则

| 场景 | 开工前第一动作（必做，先于一切开发动作） |
|---|---|
| git 仓库（GitHub / 任何远端 git） | **先 `git fetch` 看远端是否被推进 → 有差异先 pull/对齐（远端领先必须拉下来），确认一致再开工** |
| 非 git 远端（SFTP / rsync / 共享目录等） | **先拉取/对比远端文件（rsync dry-run / sftp 列表 / 对比 mtime），确认本地与远端一致（或按需先同步下来）再动手** |
| 新项目（本地新建、尚无远端） | 先确认远端是否存在/连通（GitHub 查 api.github.com，SFTP 试连），有则先拉下来；无则先初始化再开工 |
| 继续开发 / 排查项目状态 | 先对齐远端，再读提交历史/状态（git-project-read-history 是下一步，不是第一步） |
| 用户明确说不用对齐 | 按用户指令跳过（user-vs-skill-conflict：用户明确则不强制） |

**核心：开工的第一步动作 = 和远端对齐，不是写代码、不是建目录、不是 git add。**

## 二、为什么（对齐 = 项目开工的基线保障）

1. **防基于过时基线开发**：本地旧版 + 远端已有新提交/新文件，直接在旧基线上开发 = 白干 + 必然冲突
2. **防本地旧状态覆盖远端**：本地散落旧文件不先对齐就推，会把远端新内容覆盖/顶掉（git-collab-conflict 的典型教训）
3. **多机多会话协作**：本机与 NAS/其他机器/其他 AI 会话共享项目，远端才是最新真相；开工前不对齐 = 各自为战
4. **远端不止 GitHub**：项目可能托管在 SFTP 服务器/共享盘/rsync 目录——「和远端对齐」是通用动作，不是只有 git pull
5. **教训**：并行会话互踩、pull 前不看远端是否被推进（git-collab-conflict 实证），根因都是开工前没先对齐

## 三、执行流程

```
收到项目任务（新项目/接手/继续/排查）
    ↓
① 判断远端类型：
    ├─ git 仓库 → git fetch origin（看远端分支/是否被推进）→ 有差异 pull/对齐 → 确认与远端一致
    │    （GitHub 网络规则见 github-api-only：走 api.github.com；token 失效走 ssh.github.com:443）
    └─ 非 git 远端（SFTP/rsync/共享盘）→ 拉取/对比远端（rsync -avn 对比 / sftp 列目录 / 比较 mtime）→ 按需同步下来
    ↓
② 对齐完成，汇报对齐结果（远端有哪些本地没有的变更/文件，已同步什么）
    ↓
③ 才开始正式开发动作（读历史、分析、写代码、git add 等）
（全程不 push，推送需先获授权——对齐是拉不是推）
```

## 四、远端类型速查

| 远端类型 | 开工前对齐动作 | 注意 |
|---|---|---|
| GitHub（api.github.com） | `git fetch` → 看 `origin/<branch>` 与本地差异 → pull | 禁止 github.com 直连（github-api-only）；token 失效走 ssh.github.com:443 |
| 任意 git remote | `git fetch` + 对比 `git log HEAD..origin/<branch>` | 远端领先必须拉，禁止先 push 后对齐 |
| SFTP | `sftp <host>:` 列远端目录 / `lftp` 对比 | 先读远端，不先写远端 |
| rsync 目录 | `rsync -avn --dry-run <remote>/ <local>/` 先看差异 | dry-run 先行（requirements 第 6 条） |
| 共享盘/挂载目录 | 对比两端 mtime/文件清单 | 双向都可能改，先确认哪边新 |

## 五、与其他规则的关系（不重复、互补）

| 规则 | 分工 |
|---|---|
| 本 skill | **项目开工第一步**就对齐远端（所有远端类型通用） |
| `git-collab-conflict` | 对齐时发现远端有他人改动 → 按该规则审查后接纳（本规则负责「先发现」，它负责「后处理」） |
| `git-project-read-history` | 对齐完成后了解项目脉络的第二动作（读提交历史） |
| `github-api-only` | GitHub 类对齐/拉取的具体网络通道（api.github.com，禁 github.com） |
| `git-commit-before-batch-ops` | 批量操作前提交检查点（对齐是开工前，提交检查点是操作前，阶段不同） |

## 六、坑速查

1. ⚠️ 开工直接写代码/建目录，忘了对齐 → 白干 + 冲突，最典型
2. ⚠️ 只对齐 git，忽略 SFTP/共享盘等非 git 远端 → 这些项目同样有远端真相
3. ⚠️ 对齐时远端领先却先 push 本地 → 顶掉远端新内容，禁止
4. ⚠️ GitHub 直连 github.com 拉取 → 网络不通（github-api-only），对齐同样适用该通道规则
5. ⚠️ 对齐完不汇报 → 用户不知道本地缺了什么/同步了什么，开工前必须说清

## 七、配套

- `git-collab-conflict`：对齐发现他人改动后的审查流程
- `git-project-read-history`：对齐后读提交历史了解脉络
- `github-api-only`：GitHub 操作全走 api.github.com
- `git-commit-before-batch-ops`：批量操作前提交检查点
- `bugfix-auto-authority`：commit 可自主、push 需同意（对齐 = 拉取不推送）

## 相关

- remember-me（先记住我）：用户档案，优先级最高的 skill