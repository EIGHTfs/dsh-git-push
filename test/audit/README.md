# test/audit/ —— 审计侧 UI 测试（归档，不参与常规测试）

> 2026-11-08 UI 与审计解耦时归档。

## 为什么在这里

`test/run-tests.mjs` 只扫 `test/` **顶层**的 `test-*.mjs`，本目录因此**不进入常规回归**
（与 `lib/client-parts/audit/` 分片不进构建同口径：审计侧代码保留可查、但不参与运行）。

这三个文件断言的是**审计 Tab 的 UI 渲染**（注入开关、扫描范围按钮、规则行悬停浮层与启停）：

- `test-inject-switch.mjs` —— 注入要求清单的父/子开关联动
- `test-inject-system-prompt.mjs` —— 审计选项卡渲染、扫描范围按钮接线
- `test-sidebar-interaction.mjs` —— 规则行悬停浮层、调序、锁定包、状态配色

审计 Tab 已移出构建（`lib/client-parts/audit/audit.js` 不进产物），这些断言**当前不成立**，
故归档而非删除——将来审计拆成独立项目时，它们随分片一起搬走即可恢复。

## 怎么手动跑

```bash
node --test test/audit/test-inject-switch.mjs
```

注意：**现在跑会失败**（UI 已不存在），属预期。恢复前提是审计 Tab 重新进构建。

## 与后端审计的关系

后端审计能力（`code_audit` / 提交门禁 / 规则体系 / 评分）**完全不变**，
其测试仍在 `test/` 顶层正常运行（`test-audit-*.mjs`、`test-io-risk.mjs` 等）。
本目录只归档「UI 渲染」这一类断言。
