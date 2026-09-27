# 诊断：提交前审计 `.auditignore` 对已跟踪文件不生效（缺 --no-index）

> 2026-09-28 实测。影响：提交前审计（`auditChanged`，diff 模式）中 `.auditignore`
> 的目录豁免规则（`templates/js/`、`*/server/`、`vendor/` 等）对 **git 已跟踪文件**全部落空，
> 后端 Node 代码被 `dsh/client-node-builtin-require` 等浏览器规则误报 blocker，提交被拦。

## 现象

- 模板仓库 bench-template 重构后提交被拦：67 个 blocker 全是 `client-node-builtin-require`
  （`require('fs')` 是 Node 服务端正常用法）与 `vendor/artplayer.js` 混淆库误报。
- `.auditignore` 已正确声明 `templates/js/`、`templates/_gallery/server/`、
  `templates/_downloader/_iwara/js/vendor/` 等豁免，但提交审计不认。
- **关键对比**：`code_audit`（全量）blocker=0（.auditignore 生效）；提交前审计 blocker=67（不生效）。

## 根因（两处 check-ignore 调用不一致）

| 路径 | 代码位置 | check-ignore 参数 | 已跟踪文件 |
|---|---|---|---|
| 全量审计 | `lib/audit/collector.js` `tryLoadGitIgnoreSet` / `collectTextFiles` | `--stdin --no-index` | ✅ 命中 `.auditignore` |
| 提交审计 | `lib/audit/orchestrate.js` `auditChanged` 的 `isAuditIgnored` | `-q`（**缺 `--no-index`**） | ❌ 不命中 |

**机制**：`git check-ignore` 默认只对**未跟踪**（untracked）文件生效——已跟踪文件已在索引里，
git 认为「忽略规则管不到已跟踪文件」，退出码 1（不忽略）。加 `--no-index` 后强制忽略索引状态，
纯按路径匹配 ignore 规则，已跟踪文件也能命中。全量审计用了 `--no-index`，提交审计漏了。

## 实测证据（bench-template 仓库）

```bash
# 不带 --no-index（提交审计现状）→ 退出码 1 = 不忽略
git check-ignore -q -- templates/js/core/app.js; echo $?   # 1

# 带 --no-index（全量审计）→ 退出码 0 = 命中 .auditignore
git -c core.excludesFile=.auditignore check-ignore -q --no-index -- templates/js/core/app.js; echo $?   # 0

# 规则本身匹配正确（-v 显示命中行）
git -c core.excludesFile=.auditignore check-ignore -v --no-index -- \
  templates/js/core/app.js \
  templates/_gallery/server/app.js \
  templates/_downloader/_iwara/js/vendor/artplayer.js
# → .auditignore:17:templates/js/    templates/js/core/app.js
# → .auditignore:20:templates/_gallery/server/    templates/_gallery/server/app.js
# → .auditignore:24:...vendor/    templates/_downloader/_iwara/js/vendor/artplayer.js
```

## 修复方案

`lib/audit/orchestrate.js` `auditChanged` 中 `isAuditIgnored` 的 check-ignore 调用补 `--no-index`：

```diff
  const isAuditIgnored = (rel) => {
    if (!hasAuditIgnore) return false;
    try {
-     execFileSync('git', ['-C', repoPath, ...ignoreExtraArgs, 'check-ignore', '-q', '--', rel], {
+     execFileSync('git', ['-C', repoPath, ...ignoreExtraArgs, 'check-ignore', '-q', '--no-index', '--', rel], {
        encoding: 'utf8', timeout: CHECK_IGNORE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
      });
      return true;
    } catch { return false; }
  };
```

**注意**：`--no-index` 对 `.gitignore` 也生效——会额外忽略「已跟踪但想审计」的文件吗？
已跟踪文件本来就不受 .gitignore 约束，加 `--no-index` 后 .gitignore 规则也会命中已跟踪文件。
若担心把「已跟踪但声明忽略」的库文件从提交审计中漏掉，可只把 `core.excludesFile=.auditignore`
的调用补 `--no-index`，或给 isAuditIgnored 单独传 `.auditignore` 而不带 .gitignore（两难，
需按实际仓库验证——bench-template 场景 .gitignore 不含已跟踪代码目录，无副作用）。

## 关联

- `lib/audit/collector.js`：全量审计的 check-ignore 均带 `--no-index`（正确基准）。
- 2026-09-26 修复记录：`.auditignore` 目录豁免对 changed 扫描生效——当时加了 isAuditIgnored
  判定但漏了 `--no-index`，已跟踪文件路径下实际未生效，本诊断为其补完。
