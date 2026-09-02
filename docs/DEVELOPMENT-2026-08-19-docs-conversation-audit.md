# DEVELOPMENT-2026-08-19-docs-conversation-audit

> 主题：L0 审计新增「文档对话类措辞」拦截规则（v1.4.0）
> 日期：2026-08-19

## 背景

git 提交历史中反复出现包含内部沟通过程、需求记录、人员信息的 md 文档入库（公开 GitHub 仓库尤其敏感）。
release-docs-rule 已有「文档只写做了什么」约定，但只有约定、无机器闸门，无法阻止。

## 改动

1. `lib/audit.js`：新增 `docs-conversation` 规则（blocker）——对文档文件（md/markdown/mdx/txt）的**新增行**
   扫描 5 类措辞模式（会话引用 / 用户决策来源 / AI 许可表述 / 商量转述 / 沟通类记录），命中即拦截；
   只查新增行、只查文档类文件，避免误伤正常功能描述与代码。
2. `test-audit.mjs`：新增 6 个用例（命中拦截、正常文档放行、代码文件不误报、正常用户操作描述不误报），
   全部通过（27/27）。
3. `package.json` / `README.md`：版本 1.3.0 → 1.4.0，功能条目、版本表、测试数量同步。
4. `skills/dsh-git-push.md`：补规则说明与坑速查（含 git_scan 渲染 bug 记录）。

### v1.4.1 追加：修复工具结果无法回显 bug（严重）

5. `lib/index.js`：3 个 agent 工具（git_scan / git_commit_push / code_audit）补 `output.render`——
   dsh-tools（rc.6）契约要求 render 必填，缺省时 defineTool 包装函数调用 undefined 抛
   `userRender is not a function`（工具执行正常但结果回不来，实测复现）。按 dsh-session-manager
   同款写法返回内容块数组 `[{type:'text', text:String(value)}]`；status API 硬编码版本号同步 1.4.1。

## 验证

- `node test-audit.mjs`：27 通过 / 0 失败
- `node test-core.mjs`：13 通过
- `node test-repo-index.mjs`：20 通过
- test-apply.mjs 需 DSH 运行时依赖（@deepseek-ai/dsh-tools），独立目录无法运行（既有限制，非本次改动引入）

## 关联约定

- release-docs-rule 扩展「适用范围」：任何进 git 的 md 都适用「只写做了什么」；沟通/需求/移交/待办/教训类文档
  统一放 `data/沟通文档`（本地工作区专用，不进公开仓库）。
- 存量清理：dsh-git-rescue 仓库移除已入库的移交文档；工作区根目录游离沟通类文档归位 `data/沟通文档`；
  skill-understanding-* 分析报告归位 `data/analysis/`。

## 遗留

- 主环境（3081）插件副本未同步（本次只改源码），v1.4.0 新审计规则与 v1.4.1 渲染修复均在下次部署/重启后生效。
