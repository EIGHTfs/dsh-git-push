---
name: git-push-live-fix
description: 使用 dsh-git-push 插件时发现问题必须当场提出并改插件（约束所有 AI 所有会话）：调 git_scan / git_commit_push / git_rebuild_history 等工具，一旦行为与文档/参数不符、返回值撒谎、或只能靠手搓 git 绕过，禁止默默绕过完事——先写明插件哪坏了，再改插件源码 + README/skill，再继续原任务。处理「git-push 工具不好用」「重建历史没推远端」「fresh 把版本改成 1.0.0」「force 参数没生效」类场景时加载。
whenToUse: 正在用 dsh-git-push 工具、工具返回与参数不符、只能手搓 git 才完成任务、准备绕过插件时。
generatedBy: grok-4.6 · 2026-09-07
---

# 用 git-push 发现问题要当场改（git-push-live-fix）

> 2026-09-07 确立。核心一句话：**插件不好用就当场说、当场改，不要默默手搓 git 把任务糊过去。**

## 一、规则

| 场景 | 必须做 | 禁止 |
|---|---|---|
| 工具返回与参数/文档不符 | 先写明：哪个工具、哪个参数、实际做了什么 | 假装成功 |
| 只能靠手搓 `git` 才完成任务 | 视为插件 bug：改 `lib/core.js` / 工具描述 / README / 本仓 skill | 只在本任务绕过、不改插件 |
| 参数存在但没接线（如 `force` 声明了却不推远端） | 补接线，补单测 | 继续传这个空参数 |
| 破坏性操作只改了本地、远端仍是旧历史 | 说明缺口；已授权 force 则补强制推 | 回报「已重建」但远端还是旧提交 |

改插件属于 **bugfix-auto-authority**：直接修，修完告知现象/位置/验证。功能/新需求仍先确认。

## 二、本回合反面教材（必须修掉）

1. **`git_rebuild_history` `fresh` 把 `package.json` 改成 1.0.0**  
   「版本不变、覆盖旧提交」= 只重建历史，不是改版本号。fresh 版本号保持当前 `package.json`。
2. **`force: true` 不推远端**  
   工具描述写「强制推送」，实现只打 backup tag + 改本地。已授权覆盖远端时必须 force push（API `force: true` 且新 commit 不挂旧 parent；SSH `git push --force`）。
3. **`git rm -rf .git` 删不掉 `.git` 目录**  
   那是从索引删路径，不是重建仓库。正确姿势：`checkout --orphan` 保留 remote / backup tag。
4. **`pushViaApi` 写死 `force: false`**  
   非快进更新必失败。force 场景必须允许 PATCH `force: true`。

## 三、流程

1. 先用插件工具（plugin-priority），不要一上来手搓
2. 对不上预期 → 立刻在回复里写：**插件问题**（工具名 + 参数 + 实际行为）
3. 改插件源码 + 单测 + README 版本表 + 本仓 skill
4. 用修好的逻辑把原任务做完（或本回合手搓收尾 + 插件下一轮生效）
5. git-push 仓本身也要 commit + push

## 四、相关

- `skills/dsh-git-push.md`：手册
- `skills/dsh-git-push-functions.md`：`git_rebuild_history` 参数
- 通用约定：bugfix-auto-authority（bug 直接修）、plugin-priority（优先用插件）
