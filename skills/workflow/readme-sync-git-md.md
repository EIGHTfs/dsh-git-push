---
name: readme-sync-git-md
description: 写 README 必须转述 git 提交涉及的 md 内容（禁止只写文件名），且 README 与代码/提交不得脱节。处理写 README 类请求时加载。
whenToUse: 写/更新 README、发布文档，或发现 README 与提交、代码对不上时。
updated: 2026-10-02
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-10-02
---

# 写 README 必须转述 git 提交 md 内容（readme-sync-git-md）

> 核心一句话：README 要成为「git 提交里那些 md 的内容汇集入口」，而不是一份文件清单。

## 一、规则

任何「写 README / 更新 README / 发布文档」任务，必须：

| 步骤 | 必须做的 |
|------|----------|
| 1. 先查提交涉及的 md | `git log --name-only` 看最近提交改过哪些 `.md`（docs 留痕、skills 经验、提交说明），列出清单 |
| 2. 转述内容，不是列文件名 | 把这些 md 承载的功能/经验/教训/设计决策，用 README 自己的话整合进正文（功能表、API、路径规则、设计要点）；**禁止只写「详见 docs/xxx.md」了事** |
| 3. 与代码/提交对齐 | README 描述的功能以实际提交的代码为准；发现 README 过时（例如写「已移除某功能」但代码仍在用）必须顺手修正 |
| 4. 完成后重新整理 | 新功能待办转已完成，更新功能表 / 设计 / 地址 |

## 二、配套 skill

- `git-project-read-history`：进项目先读提交历史
- `code-truth-over-md`：代码是真相，README 过时以代码为准
- `feature-todo-readme-cycle`：README 待办闭环
