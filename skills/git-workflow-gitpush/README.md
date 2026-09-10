# git 工作流 skill（dsh-git-push 相关）

> 2026-09-08 · v1.40.0 迁移：原 dsh-git-push-User/EIGHTfs/ 下的 git 工作流 skill（16 个 .md）整合入插件项目 skills/。
> 依据 skill-repo-index：插件相关 skill 唯一位置 = 插件项目 skills/。
> requirements 门禁清单：v1.x 为 lib/user-requirements.json；**v2 未移植**（见 WORKBOARD 旧验收项，提交门禁当前只做 L0 静态审计）。

## 来源

- 原 dsh-git-push-User/EIGHTfs/*.md（git 提交/检查点/重建历史/API-only 等工作流规则）
- 这些 .md 通过插件「skill 目录注入」进入会话（collectRepoSkillDirs）

## 已内置化

- requirements.md → lib/user-requirements.json（EIGHTfs 7 条开发者要求，随插件分发；**v2 未移植**，待验收项）
- dsh-repo-index.md → 废弃（JSON 索引取代，生成于插件配置目录 dsh-repo-index.json）
