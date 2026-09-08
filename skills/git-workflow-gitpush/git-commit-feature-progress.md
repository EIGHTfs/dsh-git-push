---
name: git-commit-feature-progress
description: git 提交说明必须写明功能进度三态清单的硬规则（2026-08-23 EIGHTfs 确立，约束所有 AI 所有会话）：**每次 git commit 的提交说明中，除「本次改了什么」外，必须列出项目当前功能进度——开发中的功能 / 已开发完的功能 / 未开始的功能**，让提交记录本身成为项目进度快照，后续 AI/用户看 git log 即可掌握全貌。处理「git 提交写什么」「commit message 格式」「提交说明要包含进度」「开发到哪了」「当前在开发哪些功能」类场景时加载；与 commit-checkpoint-before-push-reorg（提交检查点）、feature-todo-readme-cycle（README 待办闭环）、dsh-git-push（提交推送纪律）配套。
whenToUse: 任何 git commit 时（开发期检查点提交、推送前规范提交均适用）；需要从 git 历史了解项目功能进度时。
generatedBy: user-request 2026-08-23
---

> ⭐ **先记住我**：任何会话开始前，先读用户档案 `.dsh/skills/remember-me.md`（优先级最高的 skill）：我是谁、我怎么用你、我立过的规矩。

# git 提交写明功能进度三态（git-commit-feature-progress）

> 2026-08-23 用户（EIGHTfs）确立，约束所有 AI 所有会话。
> 核心一句话：**git 提交说明里除了写「这次改了什么」，还要写明项目当前功能进度——开发中 / 已开发完 / 未开始。**

## 一、规则

每次 git commit，提交说明（commit message）包含两部分：

1. **本次变更**：这次提交改了什么（常规摘要）
2. **功能进度三态清单**：项目当前功能状态——
   - 🔄 **开发中**：当前正在开发的功能有哪些
   - ✅ **已开发完**：已开发完成的功能有哪些
   - ⬜ **未开始**：尚未开始开发的功能有哪些

## 二、格式

```markdown
<type>(<scope>): 本次变更摘要

功能进度：
- 开发中：<功能A>、<功能B>…
- 已开发完：<功能C>、<功能D>…
- 未开始：<功能E>、<功能F>…
```

示例：

```
feat(session-manager): 新增会话归档 API

功能进度：
- 开发中：会话价值分析、高峰期省钱模式
- 已开发完：会话归档、会话删除、工作区分组
- 未开始：错峰定时任务、会话关键词置顶
```

## 三、为什么

1. **提交记录 = 项目进度快照**：git log 一拉，当前开发到哪、还有哪些没做，一目了然
2. **跨会话/接手续航**：后续 AI 或用户接手项目，不需要翻 README/任务清单，git 历史本身就是进度文档
3. **与现有纪律衔接**：配合 commit-checkpoint-before-push-reorg（检查点提交）与 feature-todo-readme-cycle（README 待办闭环），提交说明承载进度、README 承载正式文档

## 四、执行要点

1. 每次 commit 都带三态清单（小改动、单文件提交同样适用，功能清单可精简）
2. 三态按当前真实进度写，不照抄上次——开发中的功能完成一个就移到「已开发完」
3. 未开始清单列项目已知规划中的功能；无则写「无」
4. 推送前重写规范提交时（commit-checkpoint-before-push-reorg），三态清单同样重写为最新
5. 与 dsh-git-push 插件工具配合（git_commit_push 提交时 message 中带三态）

## 五、配套

- `commit-checkpoint-before-push-reorg`：提交检查点 + 推送前整理（重写提交时进度同步更新）
- `feature-todo-readme-cycle`：README 待办→实现→重排（正式文档侧）
- `dsh-git-push`：提交推送工具与审计门禁
- `git-commit-before-batch-ops`：批量操作前先提交

## 相关

- remember-me（先记住我）：用户档案，优先级最高的 skill
