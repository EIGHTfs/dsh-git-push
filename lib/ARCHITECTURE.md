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
