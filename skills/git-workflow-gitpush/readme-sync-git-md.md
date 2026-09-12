# 写 README 必须转述 git 提交 md 内容（readme-sync-git-md）

> 2026-08-23 EIGHTfs 确立，约束所有 AI 所有会话。
> 用户原话：「固化skill 写README文档一定要把git提交的发挥作用的md内容转述写进README」。

## 规则

任何「写 README / 更新 README / 发布文档」任务，必须：

1. **先查 git 提交涉及的 md**：`git log --name-only` 看最近提交改过哪些 `.md`（docs/ 留痕、skills/ 经验、提交说明），列出清单。
2. **把 md 内容转述写进 README 正文，不是只写文件名**：这些 md 承载的功能/经验/教训/设计决策，必须用 README 自己的话转述整合进去（功能表、API、路径规则、设计要点），让 README 成为「git 提交全部 md 内容的汇集入口」；禁止只写「详见 docs/xxx.md」了事。
3. **README 与代码/提交不得脱节**（code-truth-over-md）：README 描述的功能必须以实际提交的代码为准；README 写错/过时（如"已移除某功能"但代码仍读它）必须顺手修正。
4. **完成后重新整理 README**（feature-todo-readme-cycle）：新功能待办转已完成、更新功能表/设计/地址。

## 处理场景

「写 README」「README 更新」「README 要写什么」「文档和提交对不上」「README 过时」类任务时加载。
