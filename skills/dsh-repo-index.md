---
name: dsh-repo-index
description: 本机所有 DSH 插件/项目的 GitHub 源码索引（唯一权威，JSON）。md 表格已废弃。权威文件是插件配置目录 git-push/dsh-repo-index.json（即 DSH_HOME/git-push/dsh-repo-index.json，v1.40.0 起原同级仓 dsh-git-push-User/<owner>/ 废除），由 dsh-git-push 在推送成功后自动生成。任何 AI 遇到「插件文件丢失/需要重新拉取源码/确认某项目仓库地址」时读那个 JSON；其他 skill 写源码位置一律引用本索引，不要各自复制仓库地址。
whenToUse: 需要恢复/克隆某个 dsh-* 插件源码、确认某项目仓库地址与可见性、本地插件目录丢失需要重建、写文档需要引用源码位置时。
generatedBy: grok-4.6 · 2026-09-07 · v1.42.0 迁入插件 skills/ 并修正权威路径
---

# DSH 插件/项目源码索引（dsh-repo-index）

> **md 表格已废弃。** 权威源是 JSON，由 dsh-git-push 自动生成，不要手改。

## 权威文件

插件配置目录：`git-push/dsh-repo-index.json`（解析顺序：`DSH_HOME/git-push/` → `~/.dsh/git-push/`）

- v1.40.0 起原同级仓 `dsh-git-push-User/<owner>/dsh-repo-index.json` 已废除（凭据/索引收敛插件自持）
- 推送成功后自动重写
- 不入 git（插件配置目录整体不入库）
- 会话默认只注入这个文件名；设置「注入 repo-index JSON 全文」才注入正文

## 怎么用

1. 读 JSON 的 `repos[]`：`name` / `repoUrl` / `visibility` / `cloneCmd` / `skills`
2. 公开/私有统一走 `git_clone`（api.github.com Git Data API）
3. 其他 skill 写源码位置只写「见 dsh-repo-index」，不复制地址

## 相关

- 生成代码：`dsh-git-push/lib/repo-index.js`
- 注入开关：设置 → 插件配置 →「注入 repo-index JSON 全文」（`injectRepoIndexFull`）
- 存放规则：本 skill 权威位置 = dsh-git-push 插件 `skills/`；`.dsh/skills/` 是加载副本（部署时同步），不要直接改
