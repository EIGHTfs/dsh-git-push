# GitHub 第三方登录方案（Device Flow，2026-11-14 设计稿）

> 状态：**设计稿，未实现**。目标是把「让用户手填 GitHub PAT」换成「一次浏览器授权」。
> 参照 `gh auth login`（GitHub 官方 CLI）的 Device Flow 做法。

## 一、为什么不用标准 OAuth 回调

标准 Authorization Code 流程要求一个**固定且可达的 redirect_uri**。对本插件的三个现实约束：

| 约束 | 后果 |
|---|---|
| 用户可能通过**局域网 IP** 访问（`http://10.x.x.x:30800`） | GitHub 对 http 回调基本只接受 `localhost`/`127.0.0.1`，局域网 IP 走不通 |
| 插件可能跑在**无公网入口**的 NAS/内网机 | 回调地址无法被 GitHub 回跳 |
| 每台机器的端口可能不同 | 回调 URL 要逐机注册，不可行 |

**Device Flow 完全不需要回调地址** —— 用户在任意设备的浏览器里输入一个短码即可完成授权。

## 二、四个方案对比

| 方案 | 需回调 URL | 需 client_secret | token 寿命 | 用户操作 | 判定 |
|---|---|---|---|---|---|
| **PAT（现状）** | ✗ | ✗ | 长期（可设过期） | 去网页手建 token 再粘进来 | 可用，但新用户最大卡点 |
| **OAuth 回调** | **要** | 要 | 长期 | 浏览器跳转后自动回跳 | 局域网/无公网场景不可行 |
| **GitHub App** | 要（安装回调） | 要（私钥） | **1 小时**（需刷新） | 浏览器安装到指定仓库 | 最规范，但实现最重 |
| **Device Flow（本方案）** | **✗** | **✗**（公开客户端） | 长期 | 浏览器输 8 位码 → Authorize | **最贴合本场景** |

## 三、完整流程与状态机

```
[插件]                                    [用户]                        [GitHub]
  │                                          │                              │
  │ ① POST /login/device/code                │                              │
  │    {client_id, scope}                    │                              │
  ├─────────────────────────────────────────────────────────────────────────►│
  │ ◄── {device_code, user_code,             │                              │
  │      verification_uri, expires_in:900,   │                              │
  │      interval:5}                         │                              │
  │                                          │                              │
  │ ② UI 显示：                              │                              │
  │    「打开 github.com/login/device        │                              │
  │      输入 WDJB-MJHT」                    │                              │
  ├─────────────────────────────────────────►│                              │
  │                                          │ ③ 输入码 + Authorize         │
  │                                          ├─────────────────────────────►│
  │                                          │                              │
  │ ④ 每 5s POST /login/oauth/access_token   │                              │
  │    {client_id, device_code,              │                              │
  │     grant_type=urn:ietf:params:oauth:    │                              │
  │     grant-type:device_code}              │                              │
  ├─────────────────────────────────────────────────────────────────────────►│
  │ ◄── {error:"authorization_pending"}      │  ← 用户还没点                │
  │ ◄── {error:"slow_down"}                  │  ← 要拉长间隔（+5s）         │
  │ ◄── {access_token, token_type, scope}    │  ← 成功                      │
  │                                          │                              │
  │ ⑤ 存 token → 之后全自动                   │                              │
```

**状态机**（插件侧）：

```
idle ──start()──► awaiting_user ──poll:success──► authorized
                        │
                        ├──poll:authorization_pending──► awaiting_user（继续）
                        ├──poll:slow_down─────────────► awaiting_user（interval += 5）
                        ├──poll:access_denied─────────► denied（用户点了拒绝）
                        ├──poll:expired_token─────────► expired（900s 超时，需重新 start）
                        └──poll:其他错误──────────────► failed(reason)
```

## 四、GitHub API 细节（实现必须按这个来）

### ① 申请设备码

```
POST https://github.com/login/device/code
Accept: application/json
Content-Type: application/x-www-form-urlencoded

client_id=<OAuth App 的 client_id>&scope=repo
```

返回：
```json
{ "device_code": "…", "user_code": "WDJB-MJHT",
  "verification_uri": "https://github.com/login/device",
  "expires_in": 900, "interval": 5 }
```

### ② 轮询取 token

```
POST https://github.com/login/oauth/access_token
Accept: application/json
Content-Type: application/x-www-form-urlencoded

client_id=<client_id>&device_code=<device_code>&grant_type=urn:ietf:params:oauth:grant-type:device_code
```

成功：`{ "access_token": "gho_…", "token_type": "bearer", "scope": "repo" }`
失败：`{ "error": "authorization_pending" | "slow_down" | "expired_token" | "access_denied", "error_description": "…" }`

**必须注意**：
- `slow_down` 时 **interval 要永久 +5 秒**（不是只延迟一次）
- 轮询必须遵守 `interval`，否则 GitHub 会持续 `slow_down`
- `expires_in`（900s）到点后必须停下并提示重新开始，不能无限轮询

### ③ 前置条件

GitHub OAuth App 设置里必须勾 **"Enable Device Flow"**。**不需要填 Callback URL**，也不需要 `client_secret`。

## 五、插件侧设计

### 5.1 新增配置（`config.json`）

```jsonc
{
  "githubAuth": {
    "mode": "pat" | "device-flow",     // 缺省 pat（向后兼容）
    "clientId": "",                     // Device Flow 模式必填（插件内置默认值）
    "token": "",                        // 授权后写入；PAT 模式沿用现有 githubToken
    "scope": "repo",
    "login": "",                         // 授权成功后记录用户名，便于 UI 显示
    "authorizedAt": ""                   // ISO 时间
  }
}
```

**与现有 `githubToken` 的关系**：`githubAuth.mode === 'pat'` 时继续读 `githubToken`；切到 `device-flow` 后优先用 `githubAuth.token`。**两条路并存，不强制迁移。**

### 5.2 新增 HTTP 端点（放 `/api/git-push/*`，属共享/账户侧）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/git-push/auth/device/start` | POST | 申请设备码，返回 `{user_code, verification_uri, expiresIn}` |
| `/api/git-push/auth/device/poll` | POST | 前端轮询用；内部按 interval 节流；返回状态机状态 |
| `/api/git-push/auth/status` | GET | 当前认证状态（`pat` / `device-flow` / `none` + 用户名） |
| `/api/git-push/auth/revoke` | POST | 清除本地 token（**不**调 GitHub 撤销接口，仅本地失效） |

**为什么轮询放服务端**：`device_code` 与 `interval` 状态不该下发给前端；且前端多标签会重复轮询。

### 5.3 UI（设置页「账户」标签）

```
┌─ GitHub 认证 ────────────────────────────┐
│ 当前：PAT（fluquormyosotis）              │
│                                          │
│ [ 改用 GitHub 授权（更安全） ]            │
│                                          │
│  ── 点击后 ──                             │
│  ① 打开 github.com/login/device           │
│  ② 输入：WDJB-MJHT                        │
│  ⏳ 等待授权…（剩余 14:32）                │
│  [ 取消 ]                                 │
└──────────────────────────────────────────┘
```

要求：
- 短码**大字号 + 可一键复制**
- 显示倒计时（跟着 `expires_in`）
- `slow_down` 时默默拉长间隔，不打扰用户
- `access_denied` / `expired_token` 要明确提示并给「重新开始」按钮

## 六、错误处理矩阵

| GitHub 返回 | 插件行为 | 用户看到 |
|---|---|---|
| `authorization_pending` | 继续轮询 | 无变化（倒计时继续） |
| `slow_down` | interval += 5s，继续 | 无变化 |
| `expired_token` | 停止轮询，清理 device_code | 「授权超时，请重新开始」+ 重试按钮 |
| `access_denied` | 停止，清理 | 「你拒绝了授权」 |
| 网络错误 | 指数退避重试 3 次后停 | 「网络异常，请重试」 |
| 401/403（token 无效） | 清理本地 token | 「授权已失效，请重新授权」 |

## 七、安全考虑

| 项 | 做法 |
|---|---|
| **token 存储** | 写 `config.json`（该文件已有 0600 权限与 `redactConfig` 脱敏）；**不回传**给前端（沿用现有敏感键策略：回 `(已保存)`） |
| **client_id 是否算秘密** | **不算**（Device Flow 的公开客户端设计），可内置到插件 |
| **不保存 device_code 到磁盘** | 只存内存，进程重启即失效（避免"半途授权态"被复用） |
| **scope 最小化** | 只要 `repo`；`workflow`（改 CI 配置）按需另配 |
| **撤销** | 本地清 token + 提示用户去 GitHub → Settings → Applications 撤销 App 授权（**插件不调撤销 API**，避免拿 token 做不该做的事） |
| **不日志 token** | 沿用现有 `http-rejects.log` 的凭据打码策略 |

## 八、边界（本方案不做什么）

1. **不做 GitHub App**（installation token + JWT 刷新）—— 对"单用户本机插件"过重
2. **不支持组织级授权**（组织若禁用第三方 OAuth App，用户需请管理员批准；插件侧只报错，不绕过）
3. **不自动刷新 token**（Device Flow 的 user token 长期有效，无需 refresh；过期则重新授权）
4. **不替代 PAT**（保留 PAT 模式，两条路并存）
5. **不实现**（本文档只是设计稿）

## 九、实施计划（将来做时按这个顺序）

| 阶段 | 内容 | 验收 |
|---|---|---|
| 1 | `lib/git/auth-device.js`：两个端点封装 + 状态机（**纯函数，可单测**，用 mock fetch） | 覆盖 6 种 GitHub 返回 + 网络错误 |
| 2 | HTTP 三端点 + config 读写 | 手测：start → 浏览器授权 → poll 拿到 token |
| 3 | UI（设置页账户卡） | 短码可见可复制、倒计时、错误提示 |
| 4 | 与现有 PAT 并存 + 迁移提示 | 两种模式都能 push/clone |
| 5 | 文档：README + SPEC + skill | 用户按文档能自己授权成功 |

## 十、参考实现

- **GitHub 官方 CLI `gh`**：`gh auth login` 选 GitHub.com → HTTPS → **Login with a web browser** 即走 Device Flow
  - 行为特征：显示 8 位码、自动开浏览器、轮询期间显示 spinners、超时后提示重来
- **GitHub 官方文档**：`https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow`
