---
name: git-project-read-history
description: 进入 git 项目目录读提交历史（接手/了解/排查 git 项目第一动作）。任何需要「了解这个项目在干什么/最近改了什么/项目脉络」的场景，先进项目目录用 git log 读提交历史，再决定下一步。处理「进入git项目的目录读提交历史」「看下这个项目提交历史」「接手项目先看提交」「这个仓库最近改了啥」类请求时加载；与 git-commits-viewer（外部插件网页查看器）、git_scan（全仓扫描）、dsh-repo-index（仓库地址权威源）配套。
whenToUse: 用户要求进入 git 项目目录读提交历史；需要快速了解一个 git 项目最近动态/脉络/交接接手；排查项目当前状态前先看历史；输出里要引用某项目提交记录时。
generatedBy: user-request 2026-08-23
---

# 进入 git 项目目录读提交历史（git-project-read-history）

> 2026-08-23 EIGHTfs 确立，约束所有 AI 所有会话。
> 核心一句话：**了解/接手任何 git 项目，第一动作是 cd 进项目目录，用 git log 读提交历史。**

## 一、规则

| 场景 | 动作 |
|------|------|
| 用户说「进入 git 项目目录读提交历史」/「看下这项目提交」 | 直接进项目目录跑 git log（见第三节命令），读完汇报要点，**禁止只报 commit 数/摘要** |
| 接手/了解一个 git 项目 | 第一动作读提交历史（分支 + 最近 N 条提交 + 提交信息类型），从提交信息了解项目脉络与最近动态 |
| 排查项目状态 | 先读提交历史看最近提交在干什么（是功能/修复/文档），再决定排查方向（配套 verify-before-diagnose） |
| 引用某项目提交记录 | 以实际读到的提交为准（短哈希+提交信息），禁止凭印象编造（no-guess-on-user-question） |

## 二、项目目录在哪（2026-08-23 用户新规）

- **GitHub 仓库统一放在「项目」文件夹**：`<project_root>/`（.dsh 同级），不再放 `git/` 等顶层位置；workspace/ 内 dsh-* 插件源码为安装引用路径，不迁移（remember-me 第 23 条）
- 项目目录下每个子目录就是一个 git 仓库（有 `.git`）；顶层也可能有散落脚本/产物文件（非仓库）
- 快速盘点工作区所有仓库：用 `git_scan` 工具（返回仓库名/路径/分支/未提交变更/最近活动）
- 找仓库地址权威源：dsh-repo-index（不要自己记仓库地址）

## 三、读提交历史的标准命令（2026-08-23 实测定型）

```bash
cd <项目目录>/<仓库名>

# ① 看当前分支
git branch --show-current

# ② 读最近 N 条提交历史（简洁格式：短哈希|时间|提交信息，一行一条）
git log --pretty=format:"%h|%ad|%s" --date=format:"%m-%d %H:%M" -20

# ③ 看最近一次提交改了哪些文件（带增删统计）
git show --stat --oneline HEAD | head -20

# ④ 看某条提交具体改动
git show --stat <短哈希>
```

- **提交信息格式**（本机项目通用）：`type(scope): 描述`，type = feat/fix/docs/chore/skill 等；skill 类提交 = 固化经验/补记教训
- **时间列**：`--date=format:"%m-%d %H:%M"` 只显示月-日 时:分，够判断新旧；要完整时间用 `--date=iso`
- 分支：多数仓库 master（ai-work-archive、gbmd-gallery、git-commits-viewer 等），dsh-git-rescue/dsh-repo/EIGHTfs.github.io 是 main——**读历史前先看分支，别假设**

## 四、读完提交历史要汇报什么（本机 2026-08-23 实测示例）

按 5 个仓库读完后的汇报格式：

| 仓库 | 分支 | 最近活动 | 最近提交主线 |
|------|------|----------|--------------|
| dsh-git-rescue | main | 08-22 | credentials_fix 工具 + 负载熔断 loadWatch + guardian LLM 快照 |
| gbmd-gallery | master | 08-22 | 压缩包索引重构（fileIndex.json）+ zip 流式解析 + 编码修复 |
| dsh-uuid-fix | master | 08-22 | apply-group-patches 一键补丁 + 群晖解锁清单 |
| dsh-repo | main | 08-22 | 套件源初始化（spk Release 直链） |
| EIGHTfs.github.io | main | 08-22 | 三平台导航 + 插件商店挪 dsh/store.html |

汇报格式：仓库名 → 分支 → 最近活动日期 → 最近提交主线（3-5 条关键提交概括），让用户一眼看清每个项目最近在干什么。

## 五、坑速查

1. **别在仓库外跑 git log**：先进 `项目/<仓库名>` 目录，否则 git 报 not a git repository
2. **分支别假设**：先 `git branch --show-current` 再读；master/main 都有
3. **只看摘要不算读**：用户说「读提交历史」= 实际跑命令读 N 条提交并汇报要点（full-context-read 精神），不是报 commit 数量
4. **项目目录顶层可能有散落文件**（脚本/mjs/产物），不是仓库；认准有 `.git` 的子目录
5. **workspace 里的 dsh-* 是安装引用路径**，读历史也直接进 workspace 对应目录即可；「项目」文件夹是 GitHub 仓库正式归位处

## 六、配套

- `git-commits-viewer`：外部独立插件（非本插件内置），网页查看器（4000 端口，可视化提交/diff），CLI 读历史的信息补充
- `git_scan`：一键盘点所有仓库状态（未提交变更/最近活动），读历史前的总览
- `dsh-repo-index`：仓库地址权威源
- `verify-before-diagnose`：排查项目先实测（读历史是实测第一步）
- `no-guess-on-user-question`：引用提交记录必须实读，不凭印象
- `full-context-read`：读 = 全文通读，提交历史要读够条数再汇报

## 相关

- remember-me（先记住我）：用户档案，优先级最高的 skill
