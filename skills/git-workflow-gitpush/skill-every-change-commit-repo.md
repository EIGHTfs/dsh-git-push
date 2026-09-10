<!-- dsh-skip-sensitive: 规则文档，引用用户决策原文作溯源（豁免仅限敏感内容类规则：措辞/凭据引用；硬编码与质量规则照常） -->

---
name: skill-every-change-commit-repo
description: skill 每次变动都提交 git 规则（2026-08-21 EIGHTfs 确立，约束所有 AI 所有会话）：**skill 一旦变动（新建/修改/删除/重命名），必须立即提交（commit）到其所在 git 仓库**——通用 skill 在技能仓库 ai-work-archive（唯一位置）、插件 skill 在插件项目仓库（唯一位置），每次变动当场提交，不等批量、不等收尾；提交不推送（推送需授权，bugfix-auto-authority/commit-checkpoint-before-push-reorg）。处理「skill 改完要不要提交仓库」「skill 仓库落后」「提交 skill 变更」「skill 归档同步」类场景时加载；与 skill-archive-rule（存放位置）、bugfix-auto-authority（提交可自主）、commit-checkpoint-before-push-reorg（推送前整理）配套。
whenToUse: skill 新增/修改/删除/重命名后；技能仓库或插件项目与本地不一致时；用户说「skill 变动要提交仓库」时。
generatedBy: user-request 2026-08-21（EIGHTfs：固化skill skill每次变动都提交 skill仓库）；2026-09-02 更新（去掉「主.dsh→仓库副本」双份同步，skill 只在唯一位置提交）
---

> ⭐ **先记住我**：任何会话开始前，先读用户档案 `.dsh/skills/remember-me.md`（优先级最高的 skill）：我是谁、我怎么用你、我立过的规矩。

# skill 每次变动都提交 git（skill-every-change-commit-repo）

> 2026-08-21 用户（EIGHTfs）确立，约束所有 AI 所有会话。
> 核心一句话：**skill 一改，当场 commit 到它所在的仓库——不等批量、不推送。**

## 一、规则

| 触发 | 动作 |
|---|---|
| 通用 skill **新增/修改/删除/重命名** | 在技能仓库 `ai-work-archive/skills/` 直接改 + **git commit** |
| 插件 skill **新增/修改/删除/重命名** | 在插件项目 `workspace/<插件>/skills/` 直接改，随插件 git 版本管理 + **git commit** |

**"每次变动都提交"**：skill 每次变动（含新固化、批量补录、修改）当场提交到它所在仓库，不等批量、不等收尾、不等用户提醒。

**提交 vs 推送**：commit 可自主执行（bugfix-auto-authority：提交不推送）；**push 必须获授权**（commit-checkpoint-before-push-reorg：推送前会撤销重写整理）。

## 二、目标仓库

| skill 类型 | 唯一位置 | 提交到 |
|---|---|---|
| 通用 skill | `ai-work-archive/skills/`（skill-archive-rule） | 技能仓库 |
| 插件 skill | `workspace/<插件>/skills/` | 插件项目仓库 |

## 三、执行方法

```bash
# 通用 skill：在技能仓库直接改后提交（不推送）
ARCHIVE=<workspace_root>/ai-work-archive
cd "$ARCHIVE" && git add -A && git commit -m "docs: 同步 skill——<本次变动摘要>"

# 插件 skill：在插件项目直接改后随项目提交
cd <插件项目根> && git add -A && git commit -m "docs: 更新 skill——<本次变动摘要>"
```

## 四、为什么

1. **单一位置即版本管理**：skill 只存一处（通用→技能仓库、插件→插件项目），随所在仓库 git 版本管理，每次变动提交才有历史可回退
2. **与同步链配套**：主 skill 变动 → ①测试/纯净救援环境（main-skill-sync-envs 实时）②所在仓库（本 skill 当场提交）
3. **提交纪律**：commit 作检查点可自主，push 需同意——只提交不推送是默认态

## 五、配套

- `main-skill-sync-envs`：同步测试/纯净救援环境（另一条链）
- `skill-archive-rule`：skill 存放位置（唯一，不双份）
- `bugfix-auto-authority`：commit 可自主、push 需同意
- `commit-checkpoint-before-push-reorg`：推送前撤销重写整理
- `skill-concept-audit-existing`：固化涉及规范时审查存量 skill（审查后的改动同样要提交）

## 六、坑

- ⚠️ skill 变动只同步测试/纯净、漏提交所在仓库 → 仓库版本落后无历史
- ⚠️ 提交忘了 `git add -A` 或漏新文件 → 提交不完整
- ⚠️ 误 push → 推送需授权，未授权一律不 push

## 相关

- remember-me（先记住我）：用户档案，优先级最高的 skill