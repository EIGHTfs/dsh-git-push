---
name: commit-checkpoint-before-push-reorg
description: 提交检查点与推送前整理规则（2026-08-20 EIGHTfs 确立，约束所有 AI 所有会话）：**经过测试的项目都可以提交（commit 作检查点），但正式推送（push）前会撤销（reset）这些提交，重新更规范地整理 README 和提交记录后再正式提交推送**——即「先提交保进度 → 推送前归零重写文档与 commit → 一次规范提交推送」。用户原话：「经过测试的项目都能提交但正式推送前会撤销提交更合理规范的写README和提交记录」。处理「要不要提交/先提交保存进度/推送前整理/撤销提交重写」「提交记录不规范/README 没整理好」类场景时加载；与 bugfix-auto-authority（提交可自主、推送需同意）、dsh-git-push（提交推送纪律）、feature-todo-readme-cycle（README 待办闭环）、release-docs-rule（发布文档规范）配套。
whenToUse: 测试通过要提交保存进度时；正式推送前发现提交记录零散/README 未整理好时；需要「先提交检查点、推送前归零重整理」时。
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-08-20（用户原话固化：「经过测试的项目都能提交但正式推送前会撤销提交更合理规范的写README和提交记录」）
---

> ⭐ **先记住我**：任何会话开始前，先读用户档案 `.dsh/skills/remember-me.md`（优先级最高的 skill）：我是谁、我怎么用你、我立过的规矩。

# 提交检查点 + 推送前整理（commit-checkpoint-before-push-reorg）

> 2026-08-20 用户（EIGHTfs）确立，约束所有 AI 所有会话。
> 核心一句话：**测试过了就提交（先保进度），但要推送时——撤销零散提交，重新规范 README 和提交记录，再一次性正式提交推送。**

## 一、规则（两阶段）

| 阶段 | 动作 | 目的 |
|------|------|------|
| **① 开发期：测试通过即提交** | 经过测试的项目/改动**随时可 commit**（作检查点，保进度、防丢失） | 进度安全；撤销/回退有锚点 |
| **② 推送前：撤销重整理** | 正式 push 前，**撤销（git reset）这些零散提交** → 重新**规范写 README** + **整理提交记录** → 一次干净 commit → push | 提交历史规范、README 与实现一致 |

## 二、执行细节

1. **开发期提交**：测试通过（单测/实测）即可 `git commit`，message 写清「改了什么」，可多次（检查点语义）
2. **推送前归零**：`git reset --soft <基线>`（保留工作区改动，撤销提交）或按需整理——把 N 个零散 commit 合成一个规范提交
3. **规范 README**（推送前必做）：
   - 功能总览表与实现一致（新增功能补行、待办转已完成）
   - 版本号/日期/变更记录更新（versioning-rule）
   - 设计/联动/地址章节与代码对齐（feature-todo-readme-cycle 第三步）
   - 文档语言规范（release-docs-rule：无对话引用、无用户决策描述、脱敏）
4. **规范提交记录**：
   - 一个逻辑变更 = 一个提交；提交信息 `type(scope): 摘要`（feat/fix/docs/chore…）
   - 推送前的最终提交信息要能概括全部变更，供 reviewer/未来自己看懂
5. **提交 vs 推送分工**（衔接 bugfix-auto-authority）：
   - commit：测试通过即可自主执行（本规则阶段①）
   - push：整理完 README/提交记录后，仍等用户明确同意（推送纪律不变）
6. 推送后：按 dsh-repo-index 自动更新（git-push 插件维护）

## 三、实例（2026-08-20）

- dsh-git-rescue 本轮（win32 适配/LLM 自治/救机闭环/管理员密码）：多次 commit 作检查点；正式推送前应撤销为规范提交 + 整理 README（Windows 章节/联动/待办）
- dsh-tasklist（merge 功能 + inbox + docs）：测试 30/30 已提交；推送前需归零整理

## 四、配套

- `bugfix-auto-authority`：提交可自主、推送需同意
- `feature-todo-readme-cycle`：README 待办→实现→重排
- `release-docs-rule`：发布文档规范（脱敏/无对话引用）
- `versioning-rule`：版本号语义
- `dsh-git-push`：提交推送工具与审计

## 相关

- remember-me（先记住我）：用户档案，优先级最高的 skill
