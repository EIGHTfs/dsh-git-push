# 方案：dsh-repo-index / account-status 更新收口为独立函数 + UI 联动重读

> 状态：已确认执行（2026-09-20）。实现按 Step 1→4 顺序，每步本地提交，最后整理为一次干净提交。
> 版本：1.5.6（本次不升版；升版需另获许可）。

## 一、目标

1. dsh-repo-index.json 所有更新统一走独立函数 `updateRepoIndex()`——读-改-写（保留既有条目），**不再全量覆盖**成「只剩最新一次扫描子集」。
2. 更新后**自动触发 UI 本地仓库列表重新读取**（经 HTTP 响应 `indexUpdated` 标志驱动）。
3. account-status.json 更新统一走 `writeAccountStatusFromResult()`（返回 `statusUpdated` 标志），触发 UI 账号信息重读（现有 recheckAccount→refreshAccount 闭环保留）。

## 二、现状实证（2026-09-20 scan-file-io + grep）

| 写函数 | 语义 | 调用方 |
|---|---|---|
| `maintainRepoIndex`（repo-index.js:288） | **全量重建覆盖** | http-handlers:209（UI 扫描）· 490（push）· tool-call:84（git_commit_push）· cli.mjs:307（CLI index） |
| `mergeCloudReposIntoIndex`（:320） | 云端合并 | http-handlers:434（UI 云端扫描） |
| `updateRepoRemoteStateInIndex`（:390） | 单条目读-改-写 | http-handlers:403（UI refresh）· 505（push） |
| `writeAccountStatusFromResult`（account-status.js:81） | 写 account-status | http-handlers:762（UI 重新检测） |

UI：本地列表从 /repos-local 读 index；扫描流程收尾对齐 ✓；push 成功/云端扫描后不自动重读（列表停留旧快照）。

## 三、方案要点

- **repo-index.js**：新增 `updateRepoIndex()`——读现有 indexMap → 应用变更（全量重建结果只合并替换命中项，不整文件覆盖）→ `updateJsonAtomic` 写回 → 返回 `{ok, indexUpdated, updated}`；`maintainRepoIndex`/`mergeCloudReposIntoIndex`/`updateRepoRemoteStateInIndex` 改为经它收口。
- **account-status.js**：`writeAccountStatusFromResult` 返回 `{ok, statusUpdated}`。
- **http-handlers.js**：5 个写入口响应带 `indexUpdated` / `statusUpdated`。
- **tool-call.js**：git_commit_push 返回 `indexUpdated`。
- **cli.mjs**：CLI index 输出 `indexUpdated`。
- **client.js**：新增 `loadLocalRepos()` 统一重读；push/云端/refresh 后按标志调用。

## 四、边界与风险

- 原子写复用 `updateJsonAtomic`（.tmp+rename）；写前重读防并发竞争。
- index 缺失/损坏 → 按空处理，全量重建兜底（readJson null 分支）。
- owner 过滤/深度受限的扫描结果 → 只更新命中项，旧条目保留。
- UI 重读是只读 GET（/repos-local），不触发写，无循环。
- HTTP 响应追加字段（不删旧字段），旧 client 忽略即可。

## 五、验证

- 单元：updateRepoIndex 空/损坏兜底、owner 过滤不丢旧条目、并发原子写。
- 集成：模拟 push/云端扫描后 /repos-local 保留旧条目 + 响应带 indexUpdated。
- 人工：侧边栏 push 后列表自动刷新；账号检测后立即最新。
- 回归：全量测试。

## 六、执行看板

- [x] Step 1：account-status 返回 statusUpdated
- [x] Step 2：repo-index.js 新增 updateRepoIndex（读-改-写收口）
- [x] Step 3：http / tool / cli 入口透传标志
- [x] Step 4：client.js 本地列表统一重读
- [x] 阶段三：全量测试 + 契约测试
- [ ] 阶段四：整理提交
