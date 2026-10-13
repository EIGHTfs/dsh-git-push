# 2026-10-13 UI 账号信息：NPM 完全对齐 GitHub（滑动切换 + 同款账号卡 + 账号名下包列表可安装）

> 状态：**已确认并执行完毕**（版本 2.8.1）。执行纪律：先学后做、从简到难、每步本地小提交、最后整理成一次提交、推送前先问。

## 一、目标与验收

- **问题**：上一版把 NPM 做成「独立自包含面板」——数据自己 fetch、刷新自成一套，与 GitHub 账号不同源；也没有「账号名下包」这一层。
- **目标**：① 顶部账号区 GitHub ↔ NPM **滑动切换**（同位置、同形态、同一套「离线快照 + 在线校验」获取与刷新逻辑）；② NPM 子页列出**登录账号名下的包**，行样式与 GitHub 云端仓库列表**同款**且**行内可安装**。
- **验收**：后端接口与 GitHub 账号**成对对称**；账号态进入 Controller 统一调度；包列表取真实 registry 数据；行内安装复用既有二次确认与安全默认；全量测试 0 失败 + 门禁四项绿 + 真渲染自检通过。

## 二、后端（对称化）

| GitHub 侧（既有） | NPM 侧（本次） | 语义 |
|---|---|---|
| `GET /account-status` | `GET /npm-account` | **离线**读快照，秒级不联网 |
| `POST /account-check` | `POST /npm-check` | **在线**校验并写快照 |
| `account-status.json` | `npm-account-status.json` | 0600 落凭据目录，不含明文 token |
| 云端仓库列表 | `GET /npm-owned` | 账号名下的**公开包**（registry search `maintainer:` + `author:` 双查合并去重、按日期倒序） |

新增 `lib/npm/account.js`（快照读写 + 账号块渲染，逐行 ✅/⚠️ 与 GitHub 凭据块同规格）、`listOwnedPackages()`；接口数 31 → 33（README / `git_api` 描述 / 接口数断言三处同步）。

## 三、前端（同位置、同链路）

- 顶部账号区 `dshgp_AccountSwitcher`：分段切换 GitHub / NPM，`key` 变化触发一次入场动画（`.dshgp_supview`）；两张卡都**不感知数据来源**（GitHub 卡读 `state.account*`，NPM 卡读映射后的 `state.npmAccount*`）。
- NPM 账号卡与 GitHub 卡同款：渐变面板 + npm 图标块 + 三态徽标（已连接 / 校验未过 / 未配置）+ ✅ 勾选明细块 + 刷新按钮。
- Controller/actions：新增 `npmAccountBlock/LoggedIn/Loading/User`、`npmOwned*`、`npmInstallBusy/Result` 与 `refreshNpmAccount`（离线）/`recheckNpmAccount`（在线）/`loadNpmOwned`/`installNpmPackage`，并纳入 `PARTS` 与 `refresh(parts)` 统一调度。
- NPM 子页「我的包」：行复用 `.dshgp_reprow` + `.dshgp_reprowinfo`（包名 / `v版本 · 日期`）+ `.dshgp_pushcol`（`dshgp_keybtn`「安装」⇒ 走 Controller 动作）。

## 四、安全默认（沿用）

装包默认 `--ignore-scripts`、默认非全局、必须 `confirm:true`、包名拒绝 `-` 开头与路径穿越；token 只存本机 0600，接口只回脱敏值与派生布尔位（实测：40 字符真身未出现在任何响应中）。

## 五、验证（实测）

```
全量测试 0 失败 · 门禁四项绿：scan-version（2.8.1 三处一致）/ doc-drift / check 163/163 / doc-version（提交前即通过）
真实数据：/npm-check 登录校验通过；/npm-owned 返回账号名下 5 个包；三接口均无 token 明文
渲染自检（真 client.js + 真后端）：顶部切换组 [GitHub, NPM]、子标签 [本地, GitHub, NPM]；
  切 NPM ⇒ NPM 账号卡（同款面板/徽标/勾选块/刷新按钮）；子页出现「我的包」与行内安装按钮；滑动容器 ×2
回归：test/e2e-npm-tab-render.mjs 7 例（含滑动切换、同款卡、仓库行样式、Controller 动作）
```

## 六、后续优化清单

- 私有包（需鉴权的接口）、包版本升级/卸载、发布流程 `npm publish`（复用同一套凭据与 npmrc）。
- 滑动切换目前是**过渡动画**；若需要触屏拖拽滑动手势，可作为独立小项补上。

## 七、执行记录

| 日期 | 事件 | 固化到哪个 skill |
|---|---|---|
| 2026-10-13 | 用户纠正「和 GitHub 一样」应指同一套状态/链路，而非只对齐外观 | `dsh-plugin-settings-ui-inject`（教训 4） |
| 2026-10-13 | 用户报「npm 明明配置了却没登录数据」：诊断出「不带 userconfig 调 npm 必 ENEEDAUTH」「最小 PATH 下 npm 起不来（缺 node）」「前端从文案反推状态」三处真因 | `dsh-plugin-settings-ui-inject`（教训 5） |
