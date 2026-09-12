<!-- dsh-skip-sensitive: 规则文档，引用用户决策原文作溯源（豁免仅限敏感内容类规则：措辞/凭据引用；硬编码与质量规则照常） -->

---
name: file-organize-git-first
description: 整理文件任务第一步必须先 git 提交的硬规则（2026-08-23 EIGHTfs 确立，约束所有 AI 所有会话）：**任何「整理文件/整理目录/归档归类/批量移动删除/清理文件」类任务，动手前第一步就是先 git 提交当前状态（检查点，不推送）；非 git 目录先做备份**——防止 AI 一次性大量操作误伤文件，留下可回退的锚点。处理「帮忙整理文件」「整理目录/归档归类/批量移动/清理文件/整理分类」类请求时强制加载；与 git-commit-before-batch-ops（批量操作前提交）、move-delete-git-checkpoint（移动删除前建还原点）、safe-delete-trash（删除进回收站）、git-rebuild-process（重建仓库）配套。
whenToUse: 用户要求整理文件/目录、归档归类、批量移动/删除/重命名、清理散落文件时；任何「整理」类任务的开始阶段（不等到批量操作时才提交）。
generatedBy: user-request 2026-08-23
---

> ⭐ **先记住我**：任何会话开始前，先读用户档案 `.dsh/skills/remember-me.md`（优先级最高的 skill）：我是谁、我怎么用你、我立过的规矩。

# 整理文件第一步先 git 提交（file-organize-git-first）

> 2026-08-23 用户（EIGHTfs）确立，约束所有 AI 所有会话。
> 核心一句话：**「帮忙整理文件」的第一步永远是 git 提交（检查点）——先把现状钉住，再动手，防止 AI 一次性大量误伤。**

## 一、规则

| 场景 | 第一步动作（动手前必做） |
|---|---|
| git 仓库内整理文件/目录 | **先 `git add -A` + `git commit`（检查点，不推送）**，再开始整理 |
| 非 git 目录整理文件 | **先做目录备份**（`cp -r` 到 `数据/备份/`，或按 move-delete-git-checkpoint 兜底 .trash） |
| 整理过程涉及删除 | 删除仍走安全删除（safe-delete-trash：移入 .trash 可恢复，禁止 rm -rf） |
| 用户明确说不建还原点 | 按用户指令跳过提交（user-vs-skill-conflict：用户明确则不建） |

**核心：整理任务的第一句话动作 = git 提交，不是先动文件。**

## 二、为什么（整理 = 高风险批量操作）

1. **整理必然大量移动/删除/重命名**：一次整理可能动几十上百个文件，任何误判（归类错、覆盖、删错）都难以手工恢复
2. **git 检查点是唯一可靠还原点**：整理前 commit 后，出错可 `git checkout` / `git log` 找回原状
3. **防 AI 一次性误伤**：AI 批量整理时可能出现「按目录名归错类」「跨游戏/跨角色误移」「覆盖同名文件」等系统性错误——整理前的 commit 让整体回退成为可能
4. **教训**：历史上有批量移动数百项后需整体回滚的实战（gbmd mod 整理），靠的就是操作前的基线 commit

## 三、执行流程

```
收到「整理文件/整理目录/归档归类/清理文件」任务
    ↓
① 第一步：定位目录，判断是否 git 仓库
    ├─ 是 git 仓库 → git add -A && git commit -m "checkpoint: <目录>整理前基线"（不推送）
    └─ 非 git 仓库 → cp -r 备份到 数据/备份/<时间戳>-<目录名>（并告知用户无法建 git 还原点）
    ↓
② 分析整理方案（列清单：哪些移动/删除/重命名，逐个确认归属，禁止凭名字批量迁移）
    ↓
③ 执行整理（删除走 .trash 回收站，禁止 rm -rf）
    ↓
④ 验证（数量核对/抽查/回读）
    ↓
⑤ git status 查看整理产生的变更，必要时再 commit 一次记录整理结果
（全程不 push，等用户同意）
```

## 四、与其他规则的关系（不重复、互补）

| 规则 | 分工 |
|---|---|
| 本 skill | **任务一开始**就提交（整理类任务的默认第一步，用户已授权不再询问） |
| `git-commit-before-batch-ops` | 批量复制/删除/移动/覆盖操作前的提交纪律（本规则是其「整理场景」的前置强化） |
| `move-delete-git-checkpoint` | 移动/删除前询问用户是否建还原点（本规则覆盖「整理文件」类请求的询问环节：默认第一步就提交） |
| `safe-delete-trash` | 删除必须进回收站可恢复（与 git 双保险） |
| `gbmd-mod-ownership` | 跨游戏/跨角色 mod 归类归属判断（整理 mod 时必读，禁止只凭目录名迁移） |
| `gbmd-scattered-origin` | 散落文件产生机制（整理散落文件前读，避免产生无意义哈希目录） |

## 五、配套

- `git-commit-before-batch-ops`：批量操作前先提交
- `move-delete-git-checkpoint`：移动/删除前建还原点
- `safe-delete-trash`：删除进回收站
- `bugfix-auto-authority`：commit 可自主、push 需同意
- `dsh-git-push`：提交走审计门禁（git_commit_push）

## 相关

- remember-me（先记住我）：用户档案，优先级最高的 skill