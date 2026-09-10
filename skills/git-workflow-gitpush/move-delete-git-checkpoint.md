<!-- dsh-skip-sensitive: 规则文档，引用用户决策原文作溯源（豁免仅限敏感内容类规则：措辞/凭据引用；硬编码与质量规则照常） -->

---
name: move-delete-git-checkpoint
description: 移动/删除操作前先询问是否建立本地 git 还原点规则（2026-08-23 EIGHTfs 确立，约束所有 AI 所有会话）：**任何「移动」和「删除」文件/目录操作动手前，必须先确认是否要本地 git 建立还原点（commit 检查点）**——确认建立 → 先 `git add -A` + `git commit`（不推送）；确认跳过 → 直接执行但删除仍走安全删除（safe-delete-trash，.trash 可恢复）。非 git 目录（如 SA6400 gbmd 无 git CLI）如实说明无法建还原点，改用 .trash 回收站兜底。处理「移动/删除前要不要提交」「建立还原点」「批量移动删除前先备份」类场景时加载；与 safe-delete-trash（删除进回收站）、git-commit-before-batch-ops（批量操作前先提交）、bugfix-auto-authority（提交可自主不推送）、user-vs-skill-conflict（用户明确不建则跳过）配套。
whenToUse: 任何移动（move/rename/拖入分类）或删除（delete/remove/清理）操作执行前；被问「移动/删除要不要先备份/建还原点」时。
generatedBy: EIGHTfs 2026-08-23（指令：「固化skill 移动和删除操作前询问是否本地git建立还原点」）
---

# 移动/删除前先询问是否建本地 git 还原点（move-delete-git-checkpoint）

> 2026-08-23 EIGHTfs 确立，约束所有 AI 所有会话。
> 核心一句话：**移动/删除动手前，先问「要不要本地 git 建还原点」，同意先 commit。**

## 一、规则

| 操作 | 动作 |
|---|---|
| 移动文件/目录（move/rename/整理归类） | 动手前先问：是否本地 git 建立还原点（commit） |
| 删除文件/目录（delete/remove/清理） | 动手前先问：是否本地 git 建立还原点（commit） |
| 确认建还原点 | `git add -A` + `git commit`（**不推送**，推送仍需授权）后执行 |
| 用户跳过/不同意 | 不建还原点直接执行，但**删除仍走 safe-delete-trash**（.trash 可恢复） |
| 非 git 目录 | 如实告知「该目录无本地 git 仓库，无法建还原点」，删除用 .trash 兜底 |

## 二、判断依据

- 该目录是 git 仓库（`ls -d .git` / `git rev-parse --git-dir` 实测）→ 可建还原点
- 不是 git 仓库（如 SA6400 gbmd：无 git CLI、代码未纳入版本管理）→ 无法建还原点，如实说明 + .trash 兜底
- 还原点内容：`git add -A && git commit -m "checkpoint: <操作说明> <日期>"`（提交不推送）

## 三、配套

- `safe-delete-trash`：删除即使不建还原点，也必须进 .trash 可恢复
- `git-commit-before-batch-ops`：git 项目内批量文件操作前先 commit 检查点
- `bugfix-auto-authority`：提交可自主（不推送），推送需授权
- `analyze-then-confirm` / `ask-with-options`：询问用选项式提问（推荐「建还原点」）

## 四、与其它规则的边界

- 用户明确说「不用/直接删/直接移」→ 按用户指令执行，不反复追问（user-vs-skill-conflict：用户指令优先于 skill，但删除仍走 .trash 安全删除）
- 只是读取/预览/查看 → 不触发本规则（仅移动、删除触发）