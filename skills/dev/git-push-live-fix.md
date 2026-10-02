---
name: git-push-live-fix
description: 用 dsh-git-push 插件时发现问题必须当场提出并改插件，禁止默默手搓 git 绕过。处理插件工具不好用类请求时加载。
whenToUse: 正在用 dsh-git-push 工具、返回与参数/文档不符、只能手搓 git 才完成任务、准备绕过插件时。
updated: 2026-10-02
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-10-02
---

# 用 git-push 发现问题要当场改（git-push-live-fix）

> 核心一句话：**插件不好用就当场说、当场改，不要默默手搓 git 把任务糊过去。**

## 一、规则

| 场景 | 必须做 | 禁止 |
|------|--------|------|
| 工具返回与参数/文档不符 | 先写明：哪个工具、哪个参数、实际做了什么 | 假装成功 |
| 只能靠手搓 `git` 才完成任务 | 视为插件 bug：改实现（`lib/git/`）、工具描述（`lib/app/tools.js`）、README 与本仓 skill | 只在本任务绕过、不改插件 |
| 参数存在但没接线（如声明了 `force` 却不推远端） | 补接线 + 补回归测试 | 继续传这个空参数 |
| 破坏性操作只改了本地、远端仍是旧历史 | 说明缺口；已授权则补强制推 | 回报「已重建」但远端还是旧提交 |

改插件属于 **bugfix-auto-authority**：直接修，修完告知「现象 / 改动位置 / 验证状态」。功能与新需求仍先确认。

## 二、历史反面教材

| 事故 | 教训 |
|------|------|
| 重建历史时把 `package.json` 版本改成 1.0.0 | 「版本不变、覆盖旧提交」= 只重建历史，不动版本号 |
| `force: true` 不推远端 | 工具描述写「强制推送」就必须真的 force push；只打 backup tag 不算 |
| 用 `git rm -rf .git` 想重建仓库 | 从索引删路径 ≠ 重建仓库；正确姿势是 `checkout --orphan` 并保留 remote / backup tag |
| `pushViaApi` 写死 `force: false` | 非快进更新必失败；force 场景必须允许 `force: true` |

## 三、流程

1. 先用插件工具，不要一上来手搓
2. 对不上预期 → 立刻在回复里写明 **插件问题**（工具名 + 参数 + 实际行为）
3. 改插件实现 + 回归测试 + README 版本表 + 本仓 skill
4. 用修好的逻辑把原任务做完（宿主未重启时，本回合手搓收尾 + 插件下一轮生效）
5. 插件仓库本身也要 commit + push

## 四、相关

- `skills/dsh-git-push.md`：插件手册
- `skills/dsh-git-push-functions.md`：各工具参数与返回
- 通用约定：`bugfix-auto-authority`（bug 直接修）、`plugin-priority`（优先用插件）
