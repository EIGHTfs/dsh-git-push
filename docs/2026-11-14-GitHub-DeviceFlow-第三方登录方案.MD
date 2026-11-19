# GitHub 第三方登录方案（Device Flow，2026-11-14 设计稿）

> 状态：**已实现（2026-11-19）**。实现落点见本文第十一节；使用手册见 README「GitHub 授权」一节。
>
> **运行前提与兜底（实测补充）**：Device Flow 的「申请短码」与「轮询换 token」两步由插件在**本机**发起
> （只有输码那步在用户浏览器里）。注意这与「API 能通」是两回事：Device Flow 端点不在 `api.github.com` 上。
>
> 本机 DNS 被污染或 HTTPS 被阻断时（`curl` 该域名返回 `000`），插件改用**官方 IP 候选并发竞速直连**
> （见第十一节）：只用 IP 建 TCP 连接，**SNI 与证书校验仍按 github.com**，不是跳过证书校验。
> 实测这批 IP 的可用性在十分钟内从 9 个掉到 1 个，所以必须「清单够宽 + 并发竞速 + 健康度冷却」——
> 单个 IP 写死会立刻失效；串行逐个试则会拖到 49 秒且失败。全部候选不可用时才退回手工 PAT。
> 目标是把「让用户手填 GitHub PAT」换成「一次浏览器授权」。
> 参照 `gh auth login`（GitHub 官方 CLI）的 Device Flow 做法。
>
> **2026-11-19 评审修订**：token 存储位由「新开 `githubAuth.token`」改为「照旧写 `githubToken`」，
> 并补齐 3 处协议细节（`verification_uri_complete`、`gho_` 前缀、`workflow` scope）。
> 理由与证据见 `docs/2026-11-19-DeviceFlow设计稿评审.MD`。

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

client_id=<OAuth App 的 client_id>&scope=repo,workflow
```

返回：
```json
{ "device_code": "…", "user_code": "WDJB-MJHT",
  "verification_uri": "https://github.com/login/device",
  "verification_uri_complete": "https://github.com/login/device?user_code=WDJB-MJHT",
  "expires_in": 900, "interval": 5 }
```

`verification_uri_complete`（2026-11-19 补）：GitHub 会一并返回**预填好短码**的地址。
UI 应该直接把它做成「一键打开授权页」按钮——用户点开只需按 Authorize，不必手抄 8 位码。
`gh` CLI 就是这么做的，体验差距明显。手抄码路径（显示 `user_code` + `verification_uri`）作为兜底保留
（用户可能在另一台设备上操作，需要把码念过去）。

### ② 轮询取 token

```
POST https://github.com/login/oauth/access_token
Accept: application/json
Content-Type: application/x-www-form-urlencoded

client_id=<client_id>&device_code=<device_code>&grant_type=urn:ietf:params:oauth:grant-type:device_code
```

成功：`{ "access_token": "gho_…", "token_type": "bearer", "scope": "repo,workflow" }`
失败：`{ "error": "authorization_pending" | "slow_down" | "expired_token" | "access_denied", "error_description": "…" }`

**必须注意**：
- `slow_down` 时 **interval 要永久 +5 秒**（不是只延迟一次）
- 轮询必须遵守 `interval`，否则 GitHub 会持续 `slow_down`
- `expires_in`（900s）到点后必须停下并提示重新开始，不能无限轮询
- **返回的 token 前缀是 `gho_`**（OAuth access token）。现有校验正则
  `^(gh[pous]_|github_pat_)` 的字符类 `[pous]` 含 `o`，所以 `gho_` **能过**——但
  `lib/app/schema.js` 与 `lib/core/credentials.js` 的报错文案都写「`ghp_`/`github_pat_` 开头」。
  实现时把这处文案一并改成「`ghp_` / `gho_` / `github_pat_` 开头」，否则后来人照着文案
  「收紧」校验，会把 Device Flow 直接弄挂。
- 拿到 token 后**调用现有 `persistGithubToken()` 写入 `githubToken` 键**（理由见 5.1），
  不要自己另写一个持久化函数。

### ③ 前置条件

GitHub OAuth App 设置里必须勾 **"Enable Device Flow"**。**不需要填 Callback URL**，也不需要 `client_secret`。

**scope 建议默认要 `repo,workflow`（2026-11-19 补）**：只给 `repo` 时，一旦 push 的提交包含
`.github/workflows/*` 文件，GitHub 会**拒绝整个 push**，报错原文类似
`refusing to allow an OAuth App to create or update workflow ... without 'workflow' scope`——
这句话对用户极其难懂，且现象是「推代码失败」，很容易被误判成凭据失效。

两种处理，建议都做：
1. 默认 scope 直接请求 `repo,workflow`（`workflow` 只影响能不能改 CI 配置，对单用户本机插件是合理范围）
2. 在 `lib/git/push-diagnose.js` 里识别这条错误文本，直接提示「重新授权时勾选 workflow 权限」，而不是把原文抛给用户

## 五、插件侧设计

### 5.1 新增配置（`config.json`）

```jsonc
{
  "githubAuth": {
    "mode": "pat" | "device-flow",     // 缺省 pat（向后兼容）
    "clientId": "",                     // 可空：留空即用插件内置的公开客户端（用户无需建 App）；填了则覆盖内置值
    "scope": "repo,workflow",           // 见 4.③：缺 workflow 时含 CI 配置的 push 会被整推拒绝
    "login": "",                         // 授权成功后记录用户名，便于 UI 显示
    "authorizedAt": ""                   // ISO 时间
  }
}
```

**token 存哪：仍然只存 `githubToken` 键（2026-11-19 修订）**

`githubAuth` **不存放 token**。Device Flow 拿到 `access_token` 后照旧调用
`persistGithubToken()` 写入 `githubToken` 键；`githubAuth.mode` 只记录「这个 token 是怎么来的」。

为什么这么定（三条硬理由）：

| 理由 | 具体后果 |
|---|---|
| `githubToken` 是「唯一真源」 | `lib/core/credentials.js` 明文写着这条铁律，且同一文件记录了历史教训：曾有「github-token 平铺文件」这第二个存储位，出现「两处状态打架、残留占位符被误当真凭据」，最终整段废除。新开第二个 token 位等于重演 |
| `resolveToken()` 是唯一读取入口 | 被 20+ 处调用（push / transport / remote / cloud / visibility / clone / rename / repos / repo-actions / account …），全部读 `githubToken` 键。token 存别处 ⇒ 这 20+ 处**一处都读不到** |
| 插件自己的 HTTP 出口只删顶层键 | `lib/app/schema.js` 的 `redactConfig()` 按 `SECRET_CONFIG_FIELDS` 删**顶层**键，不递归。嵌套的 `githubAuth.token` 会被 `/api/git-push/status` 与 `/settings-get` **明文下发到浏览器**（宿主侧脱敏只管它自己的 settings 通道，管不到插件的端点） |

**与现有 PAT 的关系**：`mode === 'pat'` 时 `githubToken` 由用户手填；`mode === 'device-flow'` 时由授权流程写入。两种来源共用同一个键，因此**读取链路零改动**，UI 靠 `mode` 区分来源徽标。**不强制迁移**。

### 5.2 新增 HTTP 端点（放 `/api/git-push/*`，属共享/账户侧）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/git-push/auth/device/start` | POST | 申请设备码，返回 `{userCode, verificationUri, verificationUriComplete, expiresIn, nextPollAt}`（**不返回** `deviceCode`） |
| `/api/git-push/auth/device/poll` | POST | 前端轮询用；内部按 interval 节流；返回 `{state, nextPollAt, login?}`。**必须幂等**：多标签/多窗口同时 poll 时，同一 `device_code` 只向上游发一次请求，其余直接回上次结果 + `nextPollAt`（否则 `slow_down` 会被顶上来） |
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
- 有 `verification_uri_complete` 时优先给「一键打开授权页」按钮（见 4.①）

### 5.4 实现陷阱（2026-11-19 评审补充）

下面这些点是**不经过 `resolveToken()` 的旁路**，实现时逐个确认，漏一个就是静默故障：

| # | 位置 | 现状 | 为什么必须看 |
|---|---|---|---|
| 1 | `lib/git/cred-env.js:63` | askpass 脚本用**正则从 config.json 文本里抓 `"githubToken"`**，不调 `resolveToken` | token 若不在 `githubToken` 键，脚本抓不到 ⇒ 工具报 `hasToken=true` 但 git 认证失败；PAT 仍在则静默抓到**旧 PAT** |
| 2 | `lib/app/schema.js` `redactConfig()` | 按 `SECRET_CONFIG_FIELDS` 删**顶层**键，不递归 | 插件自己的 HTTP 出口（`/status`、`/settings-get`）由它负责；放嵌套 token 就会明文下发（宿主脱敏管不到插件端点） |
| 3 | `lib/app/handlers/account.js` | `fileHasToken` 由 `resolveToken().token` 推导 | token 不在 `githubToken` ⇒ UI 凭据徽标恒显示「未填写」 |
| 4 | `lib/client.js` 与 `lib/client-parts/git/*.js` | 前端是 14 个分片 + 构建产物，`test/tool/test-build-client.mjs` 守着 | 改 UI **必须改分片再 build**，手改 `lib/client.js` 会被下次构建覆盖 |

补充两条：

- **轮询节奏不能照抄前端既有定时器**：`lib/client-parts/git/controller.js` 里 clone / npm 轮询都是固定
  1s，Device Flow 必须用服务端回的 `nextPollAt`（respect `interval`，`slow_down` 后 +5s 永久生效）。
- **认证请求必须显式 `noMirror`**：`lib/core/endpoints.js` 的 `withMirror()` 默认会把
  `https://github.com/` 前缀改写成第三方镜像（默认开）。设备码与换 token 都是 POST，
  方法闸门天然拦住了，但代码里仍要显式标注 `noMirror` + 注释——否则将来有人把它改成 GET 复用，
  会把 `client_id` 与 `device_code` 送给第三方镜像。

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
| **token 存储** | 写 `config.json` 的 **`githubToken` 键**（唯一真源；该文件已有 0600 权限与 `redactConfig` 脱敏）；**不回传**给前端（沿用现有敏感键策略：回 `(已保存)`） |
| **client_id 是否算秘密** | **不算**（Device Flow 是公开客户端设计：无 client_secret，且它会出现在授权页地址里）。**插件内置一个公开 client_id**——目的是让用户装上就能用，不必先学注册 OAuth App。代价是共享凭据：仓库里谁都能取用，App 被撤下时需换新值发版。因此仍保留配置覆盖（`githubAuth.clientId`），用于组织禁止第三方 App 或换用自有 App 的场景 |
| **不保存 device_code 到磁盘** | 只存内存，进程重启即失效（避免"半途授权态"被复用） |
| **scope 最小化** | `repo,workflow`。`workflow` 不是可选项：缺它时含 `.github/workflows/*` 的提交会被 GitHub 整推拒绝（理由与报错原文见 4.③） |
| **撤销** | 本地清 token + 提示用户去 GitHub → Settings → Applications 撤销 App 授权（**插件不调撤销 API**，避免拿 token 做不该做的事） |
| **不日志 token** | 沿用现有 `http-rejects.log` 的凭据打码策略 |

## 八、边界（本方案不做什么）

1. **不做 GitHub App**（installation token + JWT 刷新）—— 对"单用户本机插件"过重
2. **不支持组织级授权**（组织若禁用第三方 OAuth App，用户需请管理员批准；插件侧只报错，不绕过）
3. **不自动刷新 token**（Device Flow 的 user token 长期有效，无需 refresh；过期则重新授权）
4. **不替代 PAT**（保留 PAT 模式，两条路并存）
5. **不做 token 自动刷新**（user token 长期有效；两端都失效时重新授权即可）

## 九、实施计划（将来做时按这个顺序）

| 阶段 | 内容 | 验收 |
|---|---|---|
| 1 | `lib/git/auth-device.js`：两个端点封装 + 状态机（**纯函数，可单测**，用 mock fetch） | 覆盖 6 种 GitHub 返回 + 网络错误 |
| 2 | HTTP 四端点（5.2）+ config 读写 | 手测：start → 浏览器授权 → poll 拿到 token |
| 3 | UI（设置页账户卡） | 短码可见可复制、倒计时、错误提示 |
| 4 | 与 PAT 并存：两种来源共用 `githubToken` 键，UI 加「来源」徽标（`githubAuth.mode`） | 两种模式都能 push/clone，徽标正确反映来源 |
| 5 | 文档：README + SPEC + skill | 用户按文档能自己授权成功 |

各阶段对应的真实文件坐标（改哪个文件、加在哪个 switch、测试放哪），见
`docs/2026-11-19-DeviceFlow设计稿评审.MD` 第五节「工程落点」。

## 十、参考实现

- **GitHub 官方 CLI `gh`**：`gh auth login` 选 GitHub.com → HTTPS → **Login with a web browser** 即走 Device Flow
  - 行为特征：显示 8 位码、自动开浏览器、轮询期间显示 spinners、超时后提示重来
- **GitHub 官方文档**：`https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow`

## 十一、实现落点（2026-11-19）

协议核心、HTTP 端点、数据面与前端四层各司其职，改任何一层都不必动其它层：

| 层 | 文件 | 负责什么 |
|---|---|---|
| 协议核心 | `lib/git/auth-device.js` | 两个端点封装 + 状态机（`idle → awaiting_user → authorized/denied/expired/failed`）；`slow_down` 间隔永久 +5s、`expires_in` 到点硬停、`device_code` 只活闭包；fetch/时钟/sleep 全部注入，单测零网络 |
| HTTP 端点 | `lib/app/handlers/auth.js` | `auth/device/start` · `auth/device/poll` · `auth/status` · `auth/revoke`；进程内会话单例 + 服务端节流/幂等；授权成功后调 `persistGithubToken()` 写 `githubToken`，并写 `githubAuth` 元数据（`mode`/`login`/`authorizedAt`/`clientId`/`scope`） |
| 数据面 | `lib/app/handlers/account.js` + `lib/git/account-status.js` | `/account-status` 暴露 `authMode`（`none`/`pat`/`device-flow`）/`authLogin`/`authorizedAt`/迁移提示；快照 `account-status.json` 局部覆盖落盘（只动来源三项） |
| 前端 | `lib/client-parts/git/account.js` + `lib/client-parts/git/controller.js` | 来源徽标、授权面板（短码大字号 + 一键打开 + 倒计时）、启动/轮询/取消/重试；轮询节奏取服务端 `nextPollAtEpochMs`，不自行定时 |

配套落点与约束：

- **设置键**：`githubAuthClientId`（写入嵌套 `githubAuth.clientId`）；`githubAuth` 块只放元数据，**不含 token**
- **凭据唯一真源**：仍是 `config.json` 的 `githubToken` 键（`resolveToken()` 是唯一读取入口，20+ 处消费点只认它）
- **认证请求不镜像**：两个端点走 `withMirror(..., { noMirror: true })`，`client_id` / `device_code` 绝不经第三方镜像
- **测试**：`test/git/test-auth-device.mjs`（协议 14 例）· `test/app/test-auth-status.mjs`（数据面三态 + 双出口无明文）

