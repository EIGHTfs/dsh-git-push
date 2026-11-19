---
name: guide-github-auth
description: dsh-git-push 的 GitHub 授权（Device Flow）：建 OAuth App、授权三步、与手工 PAT 的关系、五种常见失败的现象与处置。处理「改用 GitHub 授权 / 授权失败 / 短码过期 / workflow 权限」类请求时加载。
whenToUse: 要给插件配 GitHub 凭据又不想手工建 PAT、授权页面报错、推送被 workflow 权限拒绝、或要撤销/切换凭据来源时。
updated: 2026-11-19
generatedBy: deepseek-v4.1 · EIGHTfs 2026-11-19
---

# GitHub 授权（guide-github-auth）

> 一句话定位：浏览器里输一次短码换 GitHub token（Device Flow），token 仍写进凭据文件的 `githubToken` 键，与手工 PAT 完全等价、可随时互换。

## 一、能力与边界

| 事 | 说明 |
|---|---|
| 换 token 的方式 | 用户在自己浏览器授权，插件拿 `gho_` 前缀的 OAuth token（长期有效） |
| 存哪 | 凭据文件的 `githubToken` 键（与手工 PAT 同一个键，读取链路零差异） |
| 来源标记 | `githubAuth.mode` = `none` / `pat` / `device-flow`，仅作展示与排查，不参与鉴权 |
| 不需要什么 | 不需要 Client Secret、不需要 Callback URL（这正是选它的原因：局域网/内网机也能用） |
| 不做 | 不做组织策略绕过、不做 token 自动刷新、不调 GitHub 撤销接口 |

## 二、怎么用

### 一次性准备

1. `https://github.com/settings/developers` → **New OAuth App**
2. Homepage URL 填任意地址；**勾选 Enable Device Flow**
3. 复制 **Client ID**，填进插件设置键 `githubAuthClientId`

权限范围默认 `repo,workflow`。**`workflow` 不是可选项**：缺它时，推送里含 `.github/workflows/*` 会被 GitHub 整推拒绝。

### 授权三步

1. 设置页 →「账号」→「GitHub 授权登录」→「打开 GitHub 授权页」（预填短码时一键打开）
2. 另一台设备也能操作：页面上抄 8 位短码到 `https://github.com/login/device` 并点 Authorize
3. 回到设置页：来源徽标变成「GitHub 授权」，显示登录名与授权时间

短码有效期 15 分钟，等待期间页面按服务端给的 `nextPollAtEpochMs` 自动轮询，不要手动刷新。

### 撤销 / 切换

```
POST /api/git-push/auth/revoke   {"confirm": true}     # 清本地凭据（不调 GitHub 撤销接口）
```

- 彻底吊销：GitHub → Settings → Applications → Revoke
- 换回手工 PAT：直接填 `githubToken`，徽标自动变回「手工 PAT」

## 三、排错矩阵

| 现象（原文/界面） | 机制原因 | 处置 |
|---|---|---|
| 返回 `MISSING_CLIENT_ID` / 提示缺 clientId | 设置里没有 `githubAuthClientId` | 填 Client ID 后重试（空 client_id 时 GitHub 只回 404，容易误判成网络问题） |
| 授权页：`This organization forbids third-party applications` | 组织禁用了第三方 OAuth App | 请管理员批准，或改用手工 PAT；**插件不绕过组织策略** |
| push 被拒：`refusing to allow an OAuth App to create or update workflow ... without 'workflow' scope` | 授权时未含 `workflow` 权限 | 重新授权（默认已带 `repo,workflow`）；或本次提交不含 CI 配置文件 |
| 界面：「授权超时：设备码已过期」 | 15 分钟内没在浏览器点 Authorize（`expires_in` 到点硬停） | 点「重新开始」，重新申请短码 |
| 短码输错 / 已过期 | 短码与本次会话绑定且有时效 | 关闭面板重新开始；旧短码不会“再等一会就好了” |
| 撤销后立刻又变回已授权 | 撤销时只清凭据、但进行中的会话还能换出新 token | 撤销会一并销毁会话；若仍复现，重新撤销一次并检查是否有第二个标签页在轮询 |
| 徽标一直显示「手工 PAT」，点授权没反应 | `authMode` 字段缺席（旧后端）时前端整体不渲染该行 | 升级插件后重试 |

## 四、排错时的取证顺序

1. `GET /api/git-push/auth/status` → 看 `mode` / `login` / `inProgress`（`inProgress` 带短码与轮询时刻）
2. `GET /api/git-push/account-status` → 看 `authMode` / `authHint` / `tokenConfigured`
3. 直接看凭据文件里 `githubAuth.mode` 与是否存在 `githubToken` 键
4. 以上都对但仍失败 → 看推送报错原文（多为 scope 或组织策略，不是授权链路）

## 五、红线

- `device_code` 与 `access_token` 都不得出现在任何下发给浏览器的响应、日志或截图里
- 凭据只写 `githubToken` 一个键：另开存储位会让 20+ 处读取点全部读不到（静默故障）
- 认证请求不得走第三方镜像（`client_id` / `device_code` 绝不外发）

## 相关

- 设计稿与协议细节：`docs/2026-11-14-GitHub-DeviceFlow-第三方登录方案.MD`
- 提交推送用法：`skills/guide/guide-commit-push.md`
