# Device Flow 设计稿评审（2026-11-19）

> 评审对象：`docs/2026-11-14-GitHub-DeviceFlow-第三方登录方案.MD`
> 状态：**评审完成，未改动任何代码**。本文只给结论与落点，供将来实现时对照。
> 结论一句话：协议层写法准确、可直接实施；**唯一需要改的是 token 存储位**（5.1 节），改对之后工作量与第九节的 5 阶段基本重合。

## 一、判定

| 维度 | 评价 |
|---|---|
| Device Flow 协议细节 | **准确**（`slow_down` 永久 +5s、`expires_in` 硬停、公开客户端无 `client_secret`、`device_code` 不下发前端、轮询放服务端防多标签） |
| 方案选型 | **正确**（局域网 IP / 无公网入口 / 端口不固定三个约束下，回调式 OAuth 确实走不通） |
| 令牌存储设计 | **需修订**（见第二节：新开第二个 token 存储位，破坏「config.json 的 githubToken 是唯一真源」） |
| 工程落点 | 第九节阶段划分成立，坐标见第五节 |
| 安全设计 | 主体成立，但插件**自己的** HTTP 出口不会自动脱敏嵌套字段（见第三节 B4′） |

## 二、架构级问题：不要新开第二个 token 存储位

`lib/core/credentials.js` 文件头把这件事写成了铁律：

```
 * **凭据只读写 config.json**（彻底收敛）：
 *   - token   → config.json `githubToken` 键（唯一真源；不再读/写 github-token 平铺文件）
```

同一文件第 78-79 行、146-148 行记录了这条铁律的**历史代价**：曾经存在「配置目录 github-token 平铺文件」这个第二存储位，结果出现「两处状态打架、平铺文件残留占位符被误当真凭据」，最终被整段废除。

文档 5.1 提议的 `githubAuth.token` 就是同一类错误的最小版本。

**关键事实**：`resolveToken()` 是全插件 token 读取的唯一入口，被 20+ 处调用（`tool-call` / `push` / `transport` / `remote` / `cloud` / `visibility` / `clone` / `rename` / `repos` / `repo-actions` / `account` / `cred-env` …）。它们全部读 `githubToken` 键。token 只写 `githubAuth.token` 的话，这 20+ 处**一处都读不到**。

**建议的修订（本文档第四节已同步写进设计稿）**：

- Device Flow 拿到 token 后，**照旧写入 `githubToken` 键**
- `githubAuth` 只存来源元数据：`mode` / `login` / `authorizedAt` / `clientId` / `scope`
- UI 依据 `githubAuth.mode` 显示「这 token 是手工填的还是授权来的」
- 收益：一处改动替代二十处改动，单一真源铁律不变

## 三、4 个绕过 `resolveToken` 的硬编码点

即使采纳第二节建议，下面这些点仍要在实现时逐个确认（它们是**不经过 `resolveToken` 的旁路**）。

### B1 · `lib/git/cred-env.js:63`（askpass 脚本）

现状：`git_cred_env` 生成的 askpass 脚本用**正则从 config.json 文本里抓 `"githubToken"`**：

```js
`TOKEN=$(${NODE} -e "...readFileSync(process.argv[1],'utf8').match(/\\"githubToken\\"\\s*:\\s*\\"([^\\"]+)\\"/)..."`
```

后果（若 token 存到别处）：脚本抓不到 → 工具报 `hasToken=true` 但 git 认证失败；更糟的是若 PAT 仍在 config 里，脚本会静默抓到**旧 PAT**，症状是「授权成功了，实际推上去用的还是旧凭据」——不报错、不留日志。

### B2 · `lib/app/handlers/account.js:26,100`

`fileHasToken` 由 `resolveToken(...).token` 推导。token 不在 `githubToken` 键 → UI 凭据徽标恒显示「未填写」。

### B3 · `lib/app/schema.js:126`（schema 声明）

`githubToken` 标了 `.role('secret')`。若新增 `githubAuth.token`，嵌套字段必须同样标 `.role('secret')`，否则 DSH 的脱敏链路管不到它。

### B4′ · `lib/app/schema.js:152-158`（**本文最需要注意的一条**）

```js
export const SECRET_CONFIG_FIELDS = ['githubToken', 'npmToken'];

export function redactConfig(cfg = {}) {
  const out = { ...cfg };
  for (const k of SECRET_CONFIG_FIELDS) delete out[k];   // ← 只删顶层键
  ...
}
```

**这是插件自己的 HTTP 出口**，被 `/api/git-push/status`（`lib/app/http-handlers.js`）与 `/api/git-push/settings-get`（`lib/app/handlers/settings.js:16`）使用。它只删顶层键，**不递归**。

所以：`githubAuth.token` 会被这条路径**明文下发到浏览器**。宿主侧的脱敏帮不上忙——宿主只管它自己那条 settings 通道（见 B4″），插件的 HTTP 端点由插件自己负责。

修法二选一：
1. token 仍写 `githubToken`（推荐，B4′ 自动消失）
2. 扩展 `redactConfig` 支持点路径删除（如 `['githubToken', 'npmToken', 'githubAuth.token']`），并扩测试

### B4″ · 宿主侧脱敏实测结论（原「未核实项」，已核实）

**结论：宿主会递归脱敏嵌套 `role('secret')`，这一层不是问题。**

证据链（相对 DSH 实现仓库根 `packages/`）：

1. `settings/settings/src/redact.ts:51-95` —— `walk()` 按 `node.type` 递归 `object` / `dict` / `array` / `union` / `intersect` / `transform`；命中 `node.meta?.role === 'secret'` 时把值置 `undefined` 并把 `path` 记入 `secrets` 侧车
2. `vendor/schemastery/lib/types/index.js:35-51` —— `Schema` 是函数工厂，`Object.assign(schema, options)` ⇒ `type` / `dict` / `inner` / `list` 都是实例自有属性
3. 同文件 `:602` `Schema.extend('object', (data, { dict }, ...))` ⇒ `Schema.object()` 实例确实满足 `type === 'object'` 且带 `dict`
4. 同文件 `:239-241` `Schema.prototype.role = function role(role, extra) { schema.meta = { ...schema.meta, role, extra } }` ⇒ `role('secret')` 落到 `meta.role`

三点合起来：`redactSecrets` 对 `githubAuth: Schema.object({ token: Schema.string().role('secret') })` 会正确删除 `githubAuth.token`，侧车里记 `path=['githubAuth','token'], set=<是否已填>`。

> 验证方式说明：这是**源码契约级实测**（逐行读权威实现 + 属性契约对齐），不是运行时 A/B（要跑真实例得先造一个带嵌套 secret 的插件，超出「只读评审」范围）。

**顺带发现（既有缺陷，非本方案引入）**：`lib/app/schema.js` 的 `makeFallbackSchema()` 给每个字段返回的函数**没有 `.type` / `.dict` / `.inner` / `.list` 属性**。在 schemastery 缺失的环境（零依赖本地测试 / CLI），`redactSecrets` 的 `walk()` 会在 `node.type === undefined` 时走 `default` 分支原样返回 ⇒ **DSH 侧的脱敏整条失效**。插件自己的 `redactConfig` 仍在，所以 HTTP 出口还安全，但两套 schema 的脱敏契约不对等。修法：fallback 的 `field` / `objectSchema` 补上 `type` 与 `dict`（或 `inner`）属性即可。

## 四、协议核对：3 处需补

| # | 缺项 | 为什么要补 |
|---|---|---|
| C1 | `verification_uri_complete` | GitHub 的响应里会一并返回预填码的 URL，可用它做「一键打开授权页」。`gh` CLI 就是这么做，体验差距明显 |
| C2 | `gho_` 前缀文案不一致 | 校验正则 `^(gh[pous]_|github_pat_)` 的字符类 `[pous]` 含 `o`，`gho_` **能过**。但 `lib/app/schema.js:126` 与 `lib/core/credentials.js:157` 的文案都写「`ghp_`/`github_pat_` 开头」——后来人照着文案「收紧」校验，就会把 Device Flow 直接弄挂 |
| C3 | `scope` 缺 `workflow` 会整推被拒 | push 含 `.github/workflows/*` 时 GitHub 拒绝**整个** push，报错（`refusing to allow an OAuth App to create or update workflow`）对用户极难懂。建议默认请求 `repo,workflow`；或至少在 `lib/git/push-diagnose.js` 里识别这条错误并提示「重新授权时勾 workflow」 |

## 五、工程落点（第九节各阶段对应的真实坐标）

| 文档阶段 | 真实落点 |
|---|---|
| 1 纯函数状态机 | 新增 `lib/git/auth-device.js`；测试 `test/git/test-auth-device.mjs`（对齐现有 `test/git/*.mjs` 风格） |
| 2 HTTP 四端点 | `lib/app/http-handlers.js` 的 `switch`（第 137-183 行）加 case；新增 `lib/app/handlers/auth.js`。**revoke 属写操作**，建议并入第 131 行的 `writeConfirmOps` |
| 3 UI | `lib/client-parts/git/account.js` 的 `dshgp_AccountCard`（现有「重新检测」旁加「改用 GitHub 授权」）。轮询有先例（`controller.js:1070` clone 轮询、`:504` npm install 轮询），但必须按服务端给的 `nextPollAt`，**不能照抄固定 1s** |
| 4 与 PAT 并存 | 若采纳第二节建议，本阶段退化为「加一个来源徽标」 |
| 5 文档 | README + `docs/` + 项目 `skills/` |

**约束**：前端是 14 个分片 + 构建产物（`test/tool/test-build-client.mjs` 守着），改 UI 必须走 `lib/client-parts/git/*.js` 分片再 build，**不能手改 `lib/client.js`**。

## 六、风险清单

| # | 风险 | 处理 |
|---|---|---|
| 1 | `client_id` 内置 = 共享凭据 | 写死在仓库谁都能取用；被撤销则所有用户失效。**最终决策：内置**（用户明确要求「其他用户也能直接登录」，不为每个用户增加注册 OAuth App 的手续），风险接受，并保留「自定义 clientId」覆盖项兜底 |
| 2 | `device_code` 只存内存 | 单机单实例成立；多窗口靠服务端轮询兜住，但 poll 必须**幂等**并返回 `nextPollAt`，否则多标签会把 GitHub 的 `slow_down` 顶上来 |
| 3 | 镜像污染 | `lib/core/endpoints.js` 的 `withMirror` 默认把 `https://github.com/` 改写为 `gh-proxy`（默认开）。设备码/换 token 都是 POST，方法闸门天然不镜像；但代码里要**显式 `noMirror`** + 注释说明，防将来复用成 GET |
| 4 | 测试缺口 | `test/app/test-status-secret.mjs` 只覆盖 `githubToken`。新增任何凭据字段必须扩这个用例，否则「token 明文下发」能逃逸 |
| 5 | 时钟/间隔 | `interval += 5` 必须永久生效（文档已写）；`expires_in` 到点必须停并清 `device_code` |
| 6 | 组织禁用第三方 App | 文档已声明只报错不绕过，成立 |

## 七、工作量对比

| 走法 | 改动面 |
|---|---|
| 采纳「token 仍写 `githubToken`」 | 1 个新模块（约 200 行纯函数）+ 1 个 handler 文件 + 4 个 case + account 卡改造 + 一组单测 = 与第九节 5 阶段重合 |
| 照 5.1 原样（新开 `githubAuth.token`） | 上述之外，还要改 20+ 处 `resolveToken` 消费点，外加上面 B1/B2/B4′ 三处旁路；漏一处就是「授权成功但用旧凭据」的静默故障 |

## 八、验证记录

本次评审读过并核对的真实代码（不是推断）：

- `lib/core/credentials.js` 全文（token 唯一真源、`resolveToken` 覆盖顺序、校验正则）
- `lib/git/cred-env.js` 全文（askpass 脚本生成，B1 的依据）
- `lib/app/schema.js` 全文（`SECRET_CONFIG_FIELDS`、`redactConfig`、`makeFallbackSchema`）
- `lib/app/handlers/settings.js` 全文（`ALLOWED_SETTING_KEYS`、敏感键回显脱敏）
- `lib/app/handlers/account.js` 80-160 行（`handleAccountStatus` 的 `tokenConfigured` 推导）
- `lib/app/http-handlers.js` 120-184 行（路由 switch 与 `writeConfirmOps`）
- `lib/core/endpoints.js` 全文（`GH_WEB` / `withMirror` 闸门）
- DSH 实现：`packages/settings/settings/src/redact.ts` 全文、`vendor/schemastery/lib/types/index.js` 35-60 / 239-241 / 602 行
- `git_api` 列出当前已注册 HTTP 接口 32 个（确认无 `auth/*` 端点）
- 全仓 grep：`githubAuth|device_code|device-flow|deviceFlow|clientId` → 仅设计稿内命中，代码零实现
- 全仓 grep：`DSH_GIT_PUSH_TOKEN|tokenConfigured|resolveToken|readGithubToken` → 72 条命中，据此统计消费面

## 九、改动记录

| 日期 | 事件 |
|---|---|
| 2026-11-19 | 评审初版；同日把 B4″ 的「未核实项」实测掉，结论为「宿主递归脱敏成立」，问题改落到插件自己的 `redactConfig`（B4′） |
