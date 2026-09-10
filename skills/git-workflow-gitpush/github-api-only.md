<!-- dsh-skip-sensitive: 规则文档，引用用户决策原文作溯源（豁免仅限敏感内容类规则：措辞/凭据引用；硬编码与质量规则照常） -->

# GitHub 相关操作全走 api.github.com（2025-09-01 EIGHTfs 确立）

> **铁律：GitHub 相关操作默认走 `api.github.com`，禁止使用 `github.com` 域名。**
>
> 2026-09-02：dsh-git-push v1.17.0 已把 clone / push / 建仓 / 可见性 / 打 tag 接到 api.github.com（Git Data API），不跟随 tarball 302 到 codeload。
>
> 2026-09-02：v1.18.0 本组 skill 不再嵌在插件 `User/` 目录（安装拷贝会清空）。v1.40.0 起权威位置 = 本插件 `skills/git-workflow-gitpush/`（原工作区同级 `dsh-git-push-User` 仓已废除）。v2 恢复方式相同：`git_clone { target: "EIGHTfs/dsh-git-push" }` 后取 skills/。
>
> 2026-09-02：v1.18.3 token 无效（401 Bad credentials）时，push 允许回退 `ssh.github.com:443`（本仓 `id_ed25519`）。仍禁止 `github.com` HTTPS。

## 为什么

实测验证（2025-09-01）：
- `api.github.com:443` → ✅ 通（HTTP 200，0.15秒响应）
- `github.com:443` → ❌ 超时（TCP 连接失败）
- 强制解析 `github.com` 到 `api.github.com` 的 IP → ❌ HTTP 400（边缘节点拒绝）

**结论**：`api.github.com` 和 `github.com` 虽然解析到相近的 Azure IP（20.205.243.166/168），但它们是独立的边缘节点。用户网络中 `api.github.com` 与 `ssh.github.com:443` 可达，`github.com` 被封锁。token 失效时走 SSH 443，不走 github.com。

## 操作清单

### ✅ 允许（走 api.github.com；token 无效时走 ssh.github.com:443）

| 操作 | API 端点 |
|------|----------|
| 下载仓库 ZIP | `GET /repos/{owner}/{repo}/zipball/{ref}` |
| 下载 Release 文件 | `GET /repos/{owner}/{repo}/releases` |
| 查看文件内容 | `GET /repos/{owner}/{repo}/contents/{path}` |
| 查看目录树 | `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1` |
| 搜索仓库 | `GET /search/repositories?q={keyword}` |
| 查看 Issue/PR | `GET /repos/{owner}/{repo}/issues` |
| 查看所有分支 | `GET /repos/{owner}/{repo}/branches` |
| 查看提交历史 | `GET /repos/{owner}/{repo}/commits` |
| 查看 Actions | `GET /repos/{owner}/{repo}/actions/runs` |
| push（token 401） | `ssh://git@ssh.github.com:443/{owner}/{repo}.git` |

### ❌ 禁止（走 github.com）

| 操作 | 原因 |
|------|------|
| `git clone https://github.com/...` | git 协议走 github.com，不通 |
| 浏览器访问 `https://github.com/...` | 网页版不通 |
| 访问 `raw.githubusercontent.com` | 不同域名，可能不通 |

### ⚠️ 替代方案

如果必须 `git clone`：
1. 用 API 下载 ZIP 代替：`curl -L "https://api.github.com/repos/{owner}/{repo}/zipball/{branch}" -o repo.zip`
2. 解压后操作：`unzip -q repo.zip && mv {repo}-* repo`

如果必须下载 Release：
```bash
# 获取 asset ID
curl -s "https://api.github.com/repos/{owner}/{repo}/releases/latest" | jq '.assets[] | {name, id}'
# 下载
curl -L -o file.tar.gz "https://api.github.com/repos/{owner}/{repo}/releases/assets/{id}"
```

## 验证命令

```bash
# 测试连通性
curl -sI --connect-timeout 5 https://api.github.com/rate_limit | head -3

# 检查限流
curl -s "https://api.github.com/rate_limit" | jq '.resources.core'
```

## 相关文件

- APK 分析：`会话/github_apk_analysis/GitHub_1.203.0_analysis.txt`
- 连通性测试记录：实测记录

## 配套规则

- 此规则与 `check-local-before-download` 配合：下载前先确认走哪个域名
- 此规则与 `verify-before-diagnose` 配合：网络问题先实测再下结论
- 此规则与 `no-guess-on-user-question` 配合：不猜测 API 是否可用，先 curl 实测