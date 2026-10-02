---
name: dsh-repo-index
description: 本机 DSH 插件/项目源码索引（权威 JSON）：位置、字段、用法与存放规则。处理查仓库地址或恢复源码类请求时加载。
whenToUse: 需要恢复/克隆某个插件源码、确认某项目仓库地址与可见性、本地插件目录丢失需重建、写文档要引用源码位置时。
updated: 2026-10-02
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-10-02
---

# DSH 插件/项目源码索引（dsh-repo-index）

> 核心一句话：**仓库地址与源码位置的唯一权威是 JSON 索引，不是 md 表格、更不是各处复制的地址。**

## 一、权威文件

插件配置目录下的 `git-push/dsh-repo-index.json`（解析顺序：`DSH_HOME/git-push/` → `~/.dsh/git-push/`）

| 事实 | 说明 |
|------|------|
| md 表格 | 已废弃，不要用 |
| 旧位置 | 同级仓 `dsh-git-push-User/<owner>/dsh-repo-index.json` 已废除（索引与凭据收敛到插件自持） |
| 入 git | 不入库（插件配置目录整体不入库） |
| 注入 | 会话默认只注入该文件名；开启「注入 repo-index JSON 全文」才注入正文 |
| 生成 | 由插件生成，不要手改；「推送后自动重写」尚未实现，读既有 JSON 即可 |

## 二、怎么用

1. 读 JSON 的 `repos[]`：`name` / `repoUrl` / `visibility` / `cloneCmd` / `skills`
2. 公开与私有统一走 `git_clone`（走 GitHub API，不直连 github.com）
3. 其他 skill 写源码位置只写「见 dsh-repo-index」，不复制地址

## 三、相关

- 生成实现：`lib/git/repo-index.js`
- 注入开关：设置 → 插件配置 →「注入 repo-index JSON 全文」（`injectRepoIndexFull`）
- 存放规则：本 skill 权威位置是插件项目 `skills/`；`.dsh/skills/` 是加载副本（部署时同步），不要直接改副本
