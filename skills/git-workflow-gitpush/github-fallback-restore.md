---
name: github-fallback-restore
description: 项目丢失回退到 GitHub 规则（2026-08-23 EIGHTfs 确立，约束所有 AI 所有会话）：**项目/插件源码本地不存在（丢失/损坏/新机未克隆）时，默认去用户 GitHub（EIGHTfs 账号）上找并 clone 回来**——先查 dsh-repo-index（仓库地址权威源）确认地址与可见性，再按公开/私有通道克隆；找不到的如实告知并查部署副本/本地备份。处理「项目不见了」「重新克隆项目」「新机怎么拉项目」「本地没有这个插件」「去 GitHub 找」类场景时加载。
whenToUse: 项目/插件目录丢失或损坏、新设备需要重建项目、本地找不到某项目源码、判断某项目是否在 GitHub 有远端时。
generatedBy: EIGHTfs 2026-08-23（用户直接指令固化）
---

# 项目丢失回退到 GitHub（github-fallback-restore）

> 2026-08-23 用户（EIGHTfs）确立，约束所有 AI 所有会话。
> 核心一句话：**项目本地不存，就去我的 GitHub 上找（EIGHTfs 账号）**——GitHub 是本机所有项目源码的权威恢复源。

## 一、规则

| 项 | 内容 |
|----|------|
| 触发场景 | 项目/插件源码**本地不存在**：目录丢失 / 损坏 / 新机未克隆 / 迁移后缺文件 |
| 默认动作 | **去用户 GitHub（EIGHTfs 账号）找**对应仓库并 `git clone` 回来 |
| 地址权威源 | **dsh-repo-index**（唯一权威：仓库地址/可见性/恢复命令，见 dsh-git-push 插件维护的索引）——不凭记忆写地址 |
| 找不到时 | 如实告知用户「GitHub 也没有」→ 查部署副本（node_modules）/ 本地备份 / 询问用户 |
| 归属判定 | 项目在 GitHub 的归属以 dsh-repo-index 清单为准；个别项目随主仓库打包（如 dsh-uuid-fix 随 DeepSeekHarness-NAS 应用补丁）但源码仍是独立仓库 |

## 二、执行步骤（项目丢失时）

1. **查 dsh-repo-index**：确认项目名 → 仓库地址 → 可见性（公开/私有）
2. **公开仓库**：
   ```bash
   git clone git@github.com:EIGHTfs/<项目名>.git
   # 或 ssh 通道（本机实测可用）
   git clone ssh://git@ssh.github.com:443/EIGHTfs/<项目名>.git
   ```
3. **私有仓库**（多数 dsh-* 插件）：
   ```bash
   TOKEN=$(cat <workspace_root>/data/sensitive/github-token 2>/dev/null | head -1)
   git clone https://${TOKEN}@github.com/EIGHTfs/<项目名>.git
   # 或走 ssh.github.com:443（有 SSH key 时）
   git clone ssh://git@ssh.github.com:443/EIGHTfs/<项目名>.git
   ```
4. **克隆后归属**：确认仓库含 `.EIGHTfs/` 标记或属 EIGHTfs 名下（project-owner-marker 规则）；按 dsh-repo-index 恢复命令核对
5. **插件项目**：恢复后按 dsh-plugin-main-install 三要素装回主环境（测试实例先行 + 接管式重启）

## 三、已知项目 GitHub 归属速查（2026-08-23 实测）

| 项目 | 可见性 | 恢复命令 |
|------|--------|----------|
| ai-work-archive | 私有 | `git clone ssh://git@ssh.github.com:443/EIGHTfs/ai-work-archive.git` |
| DeepSeekHarness-NAS | 公开 | `git clone git@github.com:EIGHTfs/DeepSeekHarness-NAS.git` |
| dsh-git-rescue | 公开 | `git clone git@github.com:EIGHTfs/dsh-git-rescue.git` |
| gamebanana-mods-downloader-server | 公开 | `git clone ssh://git@ssh.github.com:443/EIGHTfs/gamebanana-mods-downloader-server.git` |
| EIGHTfs.github.io | 公开 | `git clone https://<token>@github.com/EIGHTfs/EIGHTfs.github.io.git` |
| dsh-bili-publisher / dsh-git-push / dsh-image-preview / dsh-link-bridge / dsh-private-configs / dsh-session-manager / dsh-tasklist / dsh-test-sync-plugin / git-commits-viewer / dsh-repo / gbmd-gallery | 私有 | `git clone https://<token>@github.com/EIGHTfs/<项目名>.git` |
| **dsh-uuid-fix** | **无 GitHub remote（本地 only）** | ⚠️ 源码独立仓库但未推送 GitHub；补丁随 DeepSeekHarness-NAS 打包应用（NAS 仓库 git 不含其源码）——丢失需找本地备份/部署副本 |
| dsh-host-perf / dsh-test-home / workspace 等 | 无 remote | 本地 only，删除不可恢复 |

> ⚠️ 以上速查表仅为快捷引用，**权威地址以 dsh-repo-index 为准**（插件自动维护，本表可能滞后）。

## 四、边界与坑

1. **私有仓库必须 token/SSH key**：无凭据 clone 必失败；token 位置 `workspace/data/sensitive/github-token`（600 权限）
2. **无 GitHub 的项目**（dsh-uuid-fix / dsh-host-perf 等本地 only）：GitHub 找不到 = 如实告知，查部署副本/本地备份，**不凭空说找到了**
3. **仓库名 ≠ 目录名**：个别项目目录名与仓库名不同，以 dsh-repo-index 为准
4. **归属关系别混淆**：某项目「随主仓库打包应用」≠「源码在主仓库里」——如 dsh-uuid-fix 补丁打进 DeepSeekHarness-NAS 的 bin/，但源码仍是独立 dsh-uuid-fix 项目
5. **新机恢复顺序**：先 skill（dsh-repo-index 等）→ 再项目（git clone）→ 最后会话（restore-order-skill-project-session）

## 五、配套

- `dsh-repo-index`：仓库地址/可见性唯一权威（本 skill 的查表来源）
- `project-owner-marker`：克隆后确认项目归属（.EIGHTfs 标记）
- `restore-order-skill-project-session`：恢复顺序（skill → 项目 → 会话）
- `dsh-plugin-main-install`：插件恢复后装回主环境
- `dsh-git-rescue`：.dsh 仓库恢复（另一恢复通道）
