---
name: git-workflow-gitpush-readme
description: dsh-git-push 工作流 skill 目录说明：本目录放 git 工作流约定类 skill，含来源与已内置化清单。处理「工作流 skill 在哪」类请求时加载。
whenToUse: 想知道 skills/git-workflow-gitpush/ 下有哪些工作流约定、从哪来、哪些已内置化时。
updated: 2026-10-02
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-10-02
---

# git 工作流 skill（dsh-git-push 相关）

> 本目录存放 git 工作流约定类 skill。按 skill 存放规则，插件相关 skill 的唯一位置是插件项目的 `skills/`。

## 来源

- 由独立的 git 工作流规则文档整合进插件项目 `skills/`
- 这些 `.md` 通过插件的「skill 目录注入」进入会话（collectRepoSkillDirs）

## 已内置化

- 开发者要求清单 → `lib/user-requirements.json`（随插件分发；v2 未移植，待验收）
- 仓库索引 → 废弃 md 表格，改用 JSON 索引（生成于插件配置目录的 `dsh-repo-index.json`）
