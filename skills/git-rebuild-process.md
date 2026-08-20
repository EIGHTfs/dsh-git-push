---
name: git-rebuild-process
description: 重新建库流程（2026-08-21 EIGHTfs 确立，权威；权威源 = dsh-git-push 插件项目 skills/）——在数据文件夹新建 git 仓库 → 按原始项目每次提交重新分析合理提交点 → 建立长期任务分步骤按顺序还原到提交点复制进新 git → 走 gitpush 提交流程（不推送）→ 全部转移完成推送 → 仓库移到根目录（.dsh 同级）「项目」文件夹。处理「重新建库」「重建仓库」「按提交点还原重建」「迁移仓库到项目文件夹」类任务时加载。
whenToUse: 用户说「重新建库/重建仓库」、原仓库需按提交历史重梳理还原、项目仓库要迁移到「项目」文件夹、需要分步骤按提交点重建 git 时。
generatedBy: EIGHTfs 2026-08-21（用户原话整理，已确认理解；权威归属经用户确认 = dsh-git-push 插件权威 skill）
---

# 重新建库流程（git-rebuild-process）

> 2026-08-21 用户（EIGHTfs）确立。开发者文档留档：`ai-work-archive/开发者文档/重新建库流程-20260821.md`。
> 配套：dsh-git-push（提交纪律）、commit-checkpoint-before-push-reorg（推送前整理）、multi-task-todo-queue（长期任务）、task-data-dirs-rule（目录纪律）。

## 一、流程（7 步，按序执行）

1. **建库**：在数据文件夹新建 git 仓库（`/vol1/@appshare/DeepSeekHarness/数据/`，可建子目录如 `数据/重建仓库`）
2. **分析提交点**：按原始项目**每次提交**重新分析合理提交点（原始提交可能杂乱，重梳理出有意义的 commit 点）
3. **长期任务**：建立任务清单，分步骤按顺序还原到提交点
4. **还原+复制**：每步还原一个提交点的文件状态 → 复制进新建 git
5. **提交**：新建 git 走 dsh-git-push 提交流程——**只 commit 不推送**
6. **推送**：全部转移完成后才推送新位置的仓库
7. **归位**：仓库移到根目录（.dsh 同级）「项目」文件夹（`/vol1/@appshare/DeepSeekHarness/项目/`）

## 二、目录约定

| 名称 | 路径 | 角色 |
|------|------|------|
| 数据文件夹 | `/vol1/@appshare/DeepSeekHarness/数据/` | 重建暂存 git 位置 |
| 根目录（.dsh 同级） | `/vol1/@appshare/DeepSeekHarness/` | 归位上级 |
| 项目文件夹 | `/vol1/@appshare/DeepSeekHarness/项目/` | 重建后仓库最终位置（2026-08-21 新建，0700） |

## 三、纪律

- git 纪律：**未同意不推送**；提交可自主作检查点（bugfix-auto-authority）
- 推送前可撤销整理 README/提交记录再正式提交推送（commit-checkpoint-before-push-reorg）
- 长期任务分步骤不跳序（multi-task-todo-queue）
- 还原 = 复制不动原始项目，全程可回退
