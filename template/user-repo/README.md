# dsh-git-push-User

本仓库是 **dsh-git-push 插件的用户级配置仓库**，与插件仓库同级存放（不在插件目录内，安装/升级拷贝不会清空）。由 dsh-git-push 自动创建（模板）或 clone（远端已存在）。

## 目录结构

```
dsh-git-push-User/
├── README.md            ← 本文件（仓库说明）
├── .gitignore           ← 通用忽略规则（凭据/生成物不入库）
└── <owner>/             ← 作者文件夹：owner = 你的 GitHub 用户名（自动探测）
    ├── github-token     ← GitHub 个人访问令牌（ghp_ 开头，不入库）
    ├── id_rsa / id_ed25519 / *.pub   ← SSH 密钥对（私钥不入库）
    ├── requirements.md  ← 开发者特殊要求清单（提交前逐条核对）
    └── dsh-repo-index.json  ← 源码索引（插件自动生成，不入库）
```

> `<owner>` 是变量：由插件从本仓库 `origin` 远程地址解析（`https://api.github.com/repos/<owner>/dsh-git-push-User`），
> 解析失败时回退目录名、再回退默认值。**多 GitHub 用户/多设备共用插件时，各自凭据放在自己的作者文件夹。**

## 凭据放置

| 文件 | 用途 | 是否入库 |
|---|---|---|
| `<owner>/github-token` | GitHub API 令牌（git push 默认通道） | ❌ 被 .gitignore 忽略 |
| `<owner>/id_rsa` | SSH 私钥（API 通道失效时回退） | ❌ 被 .gitignore 忽略 |
| `<owner>/id_rsa.pub` | SSH 公钥（绑定 GitHub 账号用） | ✅ 可入库 |
| `<owner>/requirements.md` | 开发者特殊要求（提交门禁） | ✅ 入库 |
| `<owner>/dsh-repo-index.json` | 源码索引（自动生成） | ❌ 被 .gitignore 忽略 |

## 使用

- 首次使用：插件启动时自动创建本仓库（内置模板），填好 token 到 `<owner>/github-token` 即可
- 换机：clone 远端仓库到同级目录，插件自动识别
- 提交：本仓库同样受 dsh-git-push 审计门禁保护（凭据被忽略，不会误提交）
