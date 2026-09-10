---
name: task-completion-report
description: dsh-git-push 使用说明：任务收尾必须用分隔线 + ✅ 任务完成 + 交付/验证/遗留；输出 ✅ 即授权对本会话改过的仓 commit+push。处理任务收尾汇报、提交推送授权时加载。
whenToUse: 每次完成有交付物的任务后收尾；调用 git_commit_push 前；用户问「怎么汇报完成」「✅ 能不能推送」时。
generatedBy: grok-4.6 · 2026-09-03
---

# 任务完成汇报（dsh-git-push 使用说明）

> 权威源 = `dsh-git-push/skills/task-completion-report.md`（插件 skill，随插件版本管理）。
> 同时是 dsh-git-push 插件的开发者要求：调用 `git_commit_push` 前必须按本格式收尾（或即将收尾），✅ 即提交推送授权（v1.40.0 起要求清单随插件内置 `lib/user-requirements.json`，原同级仓 requirements.md 废除）。
> 本说明 skill 由插件作者从回复模板提取固化，作为 dsh-git-push 的使用说明与插件要求。

## 一、收尾格式（强制）

任务结束后，回复**结尾**（最后一段）必须包含：

1. **醒目分隔线**：一整行，如 `══════════════════════════`
2. **完成标记**：`✅ 任务完成`（失败/未完成用 `⚠️ 未完成` / `❌ 失败`，并说明卡在哪）
3. **三要素**（每项可省略为一行）：
   - **交付**：文件路径 / 功能 / 结论
   - **验证**：实测通过 / 单测通过 / 待人工确认（必须如实）
   - **遗留**：已知边界 / 待办 / 坑

示例：

```
══════════════════════════
✅ 任务完成（项目：dsh-git-push）

交付：`dsh-git-push/skills/task-completion-report.md`（收尾模板）
验证：单测/语法自检按本次改动跑过则如实写
遗留：无
══════════════════════════
```

要点：醒目；如实区分实测/单测/待确认；三要素各一两行；用户用中文就中文；失败也要汇报。纯闲聊可用一行 `✅ 已解答`。

## 二、项目归属

收尾必须声明本次属于哪个项目/仓库。跨项目分别写主项目 / 涉及项目。归属按 Group、cwd、用户明示的项目名。

## 三、✅ = 提交推送授权

> 约定（2026-08-18）：AI 输出 `✅ 任务完成` 即代表作者同意对本会话改过的仓库提交推送。

- 输出 `✅ 任务完成` 后，**默认即获授权**对本会话改过的每个 git 仓 `git_commit_push`（commit + push），不必再问「可以提交吗」
- 配套 `commit-push-modified-projects`：漏仓不算完成
- 走插件工具 `git_commit_push`，不手敲 git；开发者要求清单（v1.40.0 起内置 `lib/user-requirements.json`，可外挂插件配置目录 `requirements.json`）逐条核对后带 `requirementsConfirmed:true`
- **不在此授权内**：删远端仓库、force push、改生产配置、覆盖他人未拉取的历史、把凭据推进**公开**仓

## 四、推送后必须把远端最近 3 次发给用户

> 约定：每次推送远端后，把远端库最近 3 次推送的 head、标题、推送时间发给作者。

`git_commit_push` 成功后结果里有 `remoteHeads.heads` 和 `remoteHeadsText`（Markdown 表格）。收尾或推送汇报里必须用**表格**发给作者（约定：回复用表格形式），优先原样贴 `remoteHeadsText`：

```
**远端最近 3 次（owner/repo）**

| # | SHA | 标题 | 时间 |
|---|-----|------|------|
| 1 | `abcdef1` | feat: xxx | 2026-09-03T01:00:00Z |
| 2 | `bbbbbbb` | fix: yyy | 2026-09-02T01:00:00Z |
| 3 | `ccccccc` | docs: zzz | 2026-09-01T01:00:00Z |
```

拉不到时写明 `remoteHeads.error`，不要假装有。禁止改成编号列表。

## 相关

- `dsh-git-push/skills/dsh-git-push.md`：工具参数与审计
- 插件配置目录 `DSH_HOME/git-push/`（v1.40.0 起，原同级仓废除）：开发者要求清单（内置）+ 本机凭据（私有，不随本公开仓分发）
