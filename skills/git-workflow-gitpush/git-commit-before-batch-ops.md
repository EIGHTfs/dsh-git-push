<!-- dsh-skip-sensitive: 规则文档，引用用户决策原文作溯源（豁免仅限敏感内容类规则：措辞/凭据引用；硬编码与质量规则照常） -->

---
name: git-commit-before-batch-ops
description: Git 项目里批量文件操作（复制/删除/移动/重命名/覆盖）前必须先提交（不推送）的硬纪律。任何 AI 在 git 仓库内做批量文件操作前先 commit 检查点，操作出错可 git 回退；提交不推送（推送仍需用户同意）。
whenToUse: 任务涉及 git 仓库内的批量复制/删除/移动/重命名/覆盖文件、批量整理目录、批量迁移文件、批量覆盖配置时。
generatedBy: user-request 2026-08-22
---

# Git 项目批量文件操作前先提交（不推送）（git-commit-before-batch-ops）

> 2026-08-22 用户（EIGHTfs）确立，约束所有 AI 所有会话。
> 核心一句话：**在 git 仓库里做「批量文件复制/删除/移动」之前，先把当前状态 commit 掉（不推送）——批量操作有副作用，先留检查点才能回退。**

## 一、规则

| 操作类型 | 前置要求 |
|---|---|
| **批量复制**（cp 多个文件/目录进仓库） | 先 `git commit` 当前状态（检查点），再复制 |
| **批量删除**（rm 多个文件/目录） | 先 commit，再删（删除后可 `git checkout` 恢复） |
| **批量移动/重命名**（mv 多个） | 先 commit，再移（移错可回退） |
| **批量覆盖/重写**（覆盖配置、重写文件） | 先 commit，再覆盖（旧版本保留在 git 历史） |
| **批量整理目录结构**（重组文件夹层级） | 先 commit，再重组 |
| 单个/少量（≤2 文件）低风险改动 | 可不必先 commit（但仍建议留痕） |

**提交原则**：
- **提交不推送**：commit 可自主执行（bugfix-auto-authority 铁律），**push 仍需用户同意**（dsh-git-push 纪律）
- commit message 说明「批量操作前检查点」（如 `checkpoint: 批量整理前备份`）
- 走 dsh-git-push 插件审计门禁（git_commit_push 默认开审计）

## 二、为什么（批量 = 副作用放大）

1. **可回退**：批量复制/删除/移动出错时，git 历史就是唯一可靠还原点（`git checkout -- <path>` / `git log` 找回）
2. **对照基线**：commit 后 diff 清晰——批量操作改了哪些一清二楚（`git status` / `git diff`）
3. **防不可逆**：删除/覆盖是破坏性操作，无检查点 = 永久丢失（CIFS/卷级无回收站时尤其危险）
4. **教训**：历史上有批量移动 558 项后需整体回滚的实战（gbmd mod 整理），靠的就是操作前的基线

## 三、执行流程

```
git 仓库内要做批量文件操作（cp/rm/mv/覆盖 ≥ 3 个）
    ↓
① git status 确认当前变更
② git add -A && git commit -m "checkpoint: <描述>（批量操作前基线）"   ← 可自主，不推送
③ 执行批量操作（cp/rm/mv/覆盖）
④ 验证结果（数量核对/抽查/回读）
⑤ git status 查看操作产生的变更，必要时再 commit 一次记录操作结果
（全程不 push，等用户同意）
```

## 四、边界与配套

- **不是 git 仓库**（无 .git）：不适用，但建议先做目录备份（cp -r 到数据/备份/）
- **单文件改动**：不强制（低风险），但删除/覆盖单个重要文件仍建议先 commit
- **与 git 纪律配套**：bugfix-auto-authority（提交可自主、推送需同意）、commit-checkpoint-before-push-reorg（推送前整理提交记录）、dsh-git-push（审计门禁）
- **跨卷/挂载**：CIFS 只读卷无法 commit（需在真实盘操作）；批量操作前确认目标卷可写

## 五、相关

- `bugfix-auto-authority`：git 提交可自主、推送需同意
- `dsh-git-push`：提交走审计门禁
- `commit-checkpoint-before-push-reorg`：正式推送前撤销重写提交
- `analyze-then-confirm`：有副作用操作先确认（本规则是「批量前先 commit」的额外保险，不替代确认）