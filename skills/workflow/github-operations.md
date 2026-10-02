---
name: github-operations
description: GitHub 操作规则：全走 api.github.com、项目丢失从 GitHub 恢复、置顶仓库（无 API 只能网页操作）。处理 GitHub 操作类请求时加载。
whenToUse: 要访问 GitHub、项目/插件源码本地丢失需重新拉取、或要置顶仓库/展示代表作时。
updated: 2026-10-02
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-10-02
---

# GitHub 操作（github-operations）

> 核心一句话：**GitHub 一切操作走 `api.github.com`（token 失效回退 `ssh.github.com:443`），永远不走 `github.com`；项目丢了就去 GitHub 找；置顶只能网页手动。**

## 一、铁律：全走 api.github.com

实测结论：本机网络下 `api.github.com:443` 通、`github.com:443` 超时（两者是独立边缘节点，把 `github.com` 强解析到 api 的 IP 也会被拒）。dsh-git-push 的 clone / push / 建仓 / 可见性 / 打 tag 全部走 GitHub API，不跟随 302 到 codeload。

### 允许（走 api.github.com）

| 操作 | 端点 |
|------|------|
| 下载仓库 ZIP | `GET /repos/{owner}/{repo}/zipball/{ref}` |
| 下载 Release 文件 | `GET /repos/{owner}/{repo}/releases` |
| 查看文件内容 | `GET /repos/{owner}/{repo}/contents/{path}` |
| 查看目录树 | `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` |
| 搜索仓库 | `GET /search/repositories?q={keyword}` |
| 查看 Issue / PR | `GET /repos/{owner}/{repo}/issues` |
| 查看分支 / 提交 / Actions | `/branches`、`/commits`、`/actions/runs` |
| push（token 失效时） | `ssh://git@ssh.github.com:443/{owner}/{repo}.git` |

### 禁止（走 github.com）

| 操作 | 原因 |
|------|------|
| `git clone https://github.com/...` | git 协议走 github.com，不通 |
| 浏览器访问 `https://github.com/...` | 网页版不通 |
| `raw.githubusercontent.com` | 不同域名，可能不通（插件仅在续传时尝试） |

必须拿代码时：用 API 下 ZIP 再解压，或直接用插件的 `git_clone`（走 Git Data API，不直连 github.com）。

```bash
# 连通性与限流自查
curl -sI --connect-timeout 5 https://api.github.com/rate_limit | head -3
curl -s "https://api.github.com/rate_limit" | jq '.resources.core'
```

## 二、项目丢失从 GitHub 恢复

| 项 | 内容 |
|----|------|
| 触发 | 项目/插件源码本地不存在：目录丢失、损坏、新机未克隆、迁移后缺文件 |
| 默认动作 | 去用户 GitHub 账号找对应仓库并克隆回来（优先用插件的 `git_clone`） |
| 地址权威源 | `dsh-repo-index`（仓库地址 / 可见性 / 恢复命令的唯一权威）——不凭记忆写地址 |
| 找不到时 | 如实告知「GitHub 也没有」→ 查部署副本（node_modules）、本地备份，或询问用户 |
| 归属判定 | 以 `dsh-repo-index` 清单为准；个别项目随主仓库打包分发，但源码仍是独立仓库 |

步骤：查 `dsh-repo-index` 确认仓库与可见性 → 公开仓库直接克隆，私有仓库带凭据（插件自动注入，**不要手抄 token**）→ 恢复后按插件的安装流程装回主环境。

边界：**无 GitHub 远端的项目**（本地 only）找不回来，如实告知，不凭空说找到了；仓库名与本地目录名可能不同，以索引为准；新机恢复顺序是「先 skill → 再项目 → 最后会话」。

## 三、置顶仓库（无 API，只能网页）

硬性事实：GitHub REST 与 GraphQL 都只能**读取**置顶状态（GraphQL 的 `pinnedAt` / `Pinnable`），没有任何写置顶的接口；社区所谓「脚本置顶」是浏览器自动化模拟点击，不建议代跑。所以接「帮我置顶 XX」时，可交付的是：精确步骤 + 文案素材 + 替代展示方案，最后一步由用户在浏览器点。

步骤（约 30 秒）：

1. 打开 `https://github.com/<用户名>` → Pinned 区 → **Customize your pins**
2. 勾选要置顶的仓库（上限 **6 个**）→ **Save pins**
3. 点卡片 ✏️ 可写**自定义简介**（显示在仓库名下方）

| 对象 | 能否置顶 |
|------|----------|
| 自己的仓库 | ✅ 最多 6 个，公开/私有均可（私有仅自己可见），无需 Star |
| Gist | ✅ 主页 Pinned 区同样可 pin |
| 别人的仓库 | ❌ 只能 Star / 加列表 |
| Trending 榜单 | ❌ 无法手动设置，由 Star 增速与社区热度决定 |

6 个位不够时用 **Profile README**：建与用户名同名仓库 `<用户名>/<用户名>`，README 写自我介绍 + 代表作列表，展示在主页顶部（比置顶区更靠前）；可配 github-readme-stats 卡片、shields.io 徽章、项目表格。

## 四、边界与坑

- 不要把「置顶无 API」解释成「接口坏了 / 404」——是没有这个能力
- 私有仓库置顶对访客无意义：接置顶任务先确认仓库公开
- 私有仓库克隆必须带凭据，无凭据必失败；凭据由插件托管，不要手抄进命令行或文档
- 恢复前先确认目标目录是否已存在（可能只是路径变了，而不是真丢了）

## 五、配套 skill

- `dsh-repo-index`：仓库地址 / 可见性唯一权威
- `git-project-startup`：开工前先读提交历史、先与远端对齐
- `readme-craft`：README 写作与包装
- `check-local-before-download` / `network-check-before-download`：下载前先查本地、先测网络
