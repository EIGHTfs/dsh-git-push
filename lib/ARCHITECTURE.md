# 三层审计架构 · 分层位置

> 本说明块已作为代码注释出现在部分文件头部（lib/ast/*、lib/checks/* 等），此处整理为独立文档随插件发布，
> 供新增规则/检查时对照落地位置（lib 下每个文件夹对应一层功能，lib/audit/ 只做编排引入）。

```js
/*
 * 分层位置（三层审计架构）：
 *   ① 规则声明 → lib/audit-rules/*.yml
 *   ② 具体实现 → lib/ast/*（token 级判定）
 *   ③ 调用包装 → lib/checks/*（本目录，把判定转成 finding）
 *   ④ 编排调度 → lib/audit/*（收集文件、按 kind 调度、汇总）
 */
```

## 新增一条审计规则的落地路径（对应上面四层）

1. **规则声明** `lib/audit-rules/<包>.yml`：声明规则条目（`id` / `name` / `severity` / `patterns` 正则初筛；
   需要语义精筛时加 `astConfirm: true` 或 `astConfirmKind: <名称>`）。
2. **token 级判定** `lib/ast/*`：实现精筛函数（如 `lib/ast/credential.js` 的 `credentialValueLines`、
   `lib/ast/dataflow.js` 的「清空后访问」），返回「应报/应豁免的行号集合」。
3. **调用包装** `lib/checks/*`：检查器消费精筛集合转成 finding——`lib/checks/regex.js` 的
   `checkRegexRules` 按 `astConfirmKind` 分发（`kindFilter` 集合），`lib/checks/common.js` 集中
   注册各行精筛函数；新 kind 在此接线。
4. **编排调度** `lib/audit/*`：`collector.js` 收文件 → `audit-file.js` 按 kind 调度到各检查器 →
   `orchestrate.js` 汇总、按规则包聚合命中数。`lib/audit/` 不驻留具体判定实现。

## 原则

- 规则 yml 只写「声明」，判定逻辑（正则初筛 → token/AST 精筛）全部落在 `lib/ast/` 与 `lib/checks/`。
- 新增 kind 需要注册编译器时：`lib/rule/compilers/<域>.js`（`registerCompiler` 一行），
  `lib/rule/compilers.js` 只做纯再导出。
- 仓库级/文件系统上下文类检查（如读 .gitignore、git 命令）不在逐文件检查器里臆测，
  交给 `lib/audit/` 编排层或 `lib/checks/` 中带上下文参数的入口。

## 审计引擎与提交推送：不拆成两个包，但把边界钉死

**决策（2026-10-24）**：保持单包 `dsh-git-push`，不拆出独立审计 npm 包。

拆包换不到收益：

- 外部使用者的需求是「提交前拦截」这个整体（`git_commit_push` 的门禁 + `code_audit`），不是「只装审计引擎」；
- 「脱离 DSH 跑审计」已由 `cli.mjs`（`git-sluice`，不依赖宿主）覆盖；
- 而拆包的代价是**持续**的：两包版本同步、固定发布顺序、依赖范围约束——同类 monorepo 双包仓库上刚观察到这些成本落地成 bug（版本各升各的、`files` 声明漂移）。

但不拆包 ≠ 放弃边界。实测依赖方向是干净的：

| 方向 | 数量 | 说明 |
|---|---|---|
| 审计层 → git/npm/commit-push | **0** | 审计层完全不知道提交推送存在 |
| git/npm/commit-push → 审计层 | **7** | 唯一耦合面：`commit-push.js` 3 处（audit/exempt/score）+ `git/{ignore,repos,sensitive}.js` 4 处 |

由 `scripts/check.mjs` 的**层边界门禁**钉住（两处都已自证会变红）：

1. 审计层任一文件 import git 层 ⇒ 直接失败；
2. 反向接缝数超过预算 7 ⇒ 失败（要上调必须写明理由）。

**维护约定**：审计层需要 git 能力时（读 `.gitignore`、跑 `git status`），走**自己文件内的轻量
`execFileSync('git', …)`**（如 `lib/audit/collector.js`），不得顺手 `import` `lib/git/` 的
`runGit`/`transport.js`——那 7 处接缝是「提交门禁要调审计」的必需耦合，多一处都是在把它糊掉。
真出现外部只要审计引擎的用户，按这张表拆：动那 7 行 import + 建包，其余是机械操作。
