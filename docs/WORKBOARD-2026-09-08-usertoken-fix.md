# 工作进度看板：User 仓选仓 / Token 探测失效修复（v1.36.2）

> 任务：修复双副本场景下 resolveUserDir 选中失效 token 副本（isSynced 假象）导致 API push 全 Bad credentials 的问题。修复以「token 实际可用」为准：失效 token 副本不再冒充官方仓，多副本自动选有效 token 仓，resolveGitToken 跳过失效 token 继续找下一个。
> 目标版本：1.36.2 ｜ 开始：2026-09-08 ｜ 方案确认：✅（用户已回复「确认」）

## 〇、总体状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| 根因确认 | ✅ 完成 | 本地副本 HEAD 9920a45 === refs/remotes/origin/master 9920a45（旧缓存值，从未 fetch）→ isSynced 假象；其 token len 24/401 失效；NAS 副本 token len 41/200 有效但被树内优先规则排除 |
| 方案提案 | ✅ 完成 | 已按 docs/方案模板.md 输出并获「确认」 |
| lib/core.js probeTokenValid | ✅ 完成 | 新增 token 校验函数（githubFetch /user、2s 超时、60s 缓存） |
| inspectUserRepo + tokenValid | ✅ 完成 | 读 token 调校验，存 tokenValid 字段 |
| scoreUserRepo 加权 | ✅ 完成 | tokenValid +800，压过 isSynced+300 假象 |
| resolveUserDir 池规则 | ✅ 完成 | 树内优先条件加 tokenValid |
| resolveGitToken 全候选探测 | ✅ 完成 | userRepoCandidates 全列表 + 失效跳过 |
| 单测 4 场景 | ✅ 完成 | test-core 87/0（新增双副本/异步校验场景） | mock 校验函数 |
| 全量回归 | ✅ 完成 | core 87 / audit 86 / repo-index 27 / permit 29 / viewer 43 / rules / env-inject 全过 | test-core/test-audit/test-repo-index |
| 数据修复（快进本地副本 refs） | ✅ 完成 | 本地副本 reset 至 88e74d5 与 NAS 一致；40 位有效 token 已拷入 | 消除 isSynced 假象 |
| README/版本 v1.36.2 | ✅ 完成 | |
| 同步 profile + 提交推送 | ✅ 完成 | 3d54625 推 api.github.com（tag v1.36.2）；两副本已同步至 88e74d5 | requirementsConfirmed=true |

图例：✅ 完成 ｜ 🔄 进行中 ｜ ⏳ 待办

## 一、根因摘要

1. `inspectUserRepo.isSynced` = HEAD 与**本地缓存的** `refs/remotes/origin/master` 比对——只证明「自上次 fetch 未动」，不代表与真实远端一致。本地副本从未 fetch（SSH 无 key），ref 停在旧值 → 永远 isSynced=true。
2. `resolveUserDir` 树内优先条件 `matchesTarget && isSynced` 命中本地副本 → pool 只剩树内 → NAS 副本（有效 token）被排除。
3. `resolveGitToken` 只从 resolveUserDir 选中仓读 token → 读到失效 token → API push Bad credentials。

## 二、修复要点

- `probeTokenValid(token)`：githubFetch `/user`，timeout 2s，60s 缓存
- `inspectUserRepo` 加 `tokenValid` 字段
- `scoreUserRepo`：tokenValid +800（单候选校验失败不降级）
- `resolveUserDir` 池规则：`matchesTarget && isSynced && tokenValid` 才树内优先
- `resolveGitToken`：候选扩展到 userRepoCandidates 全列表，失效跳过继续
