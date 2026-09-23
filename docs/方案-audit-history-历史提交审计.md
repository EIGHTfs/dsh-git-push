# 方案：audit --history 历史提交审计（1.7.0）

> 状态：方案草案（未改代码），待确认后按看板执行。版本：1.7.0（升版需确认）。
> 需求来源：EIGHTfs「新增功能 history 模式（--history）——审计历史提交所有代码，按提交 job 后台串行生成落盘报告，参数可指定保存位置，缺省 git 根目录」。
> 补充澄清：**只看历史提交**（不审当前工作区/diff）；**按提交后台串行**，每次提交产出一个审计清单落盘；**三个参数都可缺省**（起始提交 / 结束提交 / 保存位置）。

## 一、目标

- **问题**：现有审计只覆盖当前工作区（`--full`/`diff`），无法「一口气审完 git 历史里每个提交的代码」——历史版本曾引入的缺陷/凭据/大文件，只有逐个提交看才知道。
- **期望**：`audit --history` 遍历指定范围内的历史提交，**对每个提交的代码快照做全量审计**，每个提交产出一份审计清单**落盘**（保存位置可指定，缺省 git 根目录），后台串行执行。
- **成功标准**：①指定范围（起始~结束提交，皆缺省=全部历史）内的每个提交都有一份落盘审计报告（文件名含 short sha）②报告含 summary/quality/findings（与现有审计同构）③串行执行不并发、可中断且已落盘保留 ④保存位置参数生效且缺省落在 git 根目录 ⑤CLI 与插件工具行为一致（独立 CLI 维护纪律）。

## 二、现状实证（2026-09-21）

| 现状 | 位置 | 说明 |
|---|---|---|
| cmdAudit | `cli.mjs` | `--full`=全量 / 缺省=diff；输出 summary/quality/findings/yaml；无历史遍历 |
| 全量审计 | `auditFull(root, opts)`（lib/audit） | 对整个目录树全量扫描 + 评分；对非 git 目录自动 full |
| 后台 job | 宿主 `jobs.start`（apply.js 注入，git_commit_push 先例） | 注册宿主后台 job；CLI 独立进程无宿主，需自跑 |
| 本地后台扫描 | `lib/git/scan-runner.js` | 独立进程扫描 + running 互斥 + wait 增量——串行后台的既有范式（不直接复用其仓库扫描语义，借互斥/进度思想） |
| git 遍历 | `git rev-list`/`git log` | `git log --format=%H --reverse <from>^..<to>` 可拿范围提交串（含两端） |
| 快照取码 | `git archive <sha> \| tar -x -C <tmp>` | 每提交解出独立目录快照，审计后删（不碰工作区、不留 worktree 元数据） |
| 落盘先例 | scan-live.json / dsh-repo-index.json（atomic-json） | 原子写已有可复用，报告写盘走同一套 |

## 三、潜在问题分析

| 风险 | 可能性 | 影响 | 缓解 |
|---|---|---|---|
| 历史提交多 → 总时长长 | 高 | 成百上千提交串行，可能数十分钟 | 后台 job + 逐提交落盘（已完成的保留）；Ctrl+C/中断不丢已落盘 |
| 快照解压占用磁盘 | 中 | 每提交一份副本，大仓叠加 | 每提交独立 tmp 目录、审计完即删；同一时刻只保留一份 |
| 历史 bin/大文件体积 | 中 | archive 解出巨型快照慢/占盘 | 复用 maxScanFiles 截断；快照目录用完删 |
| 范围语义（起始/结束） | 低 | 含不含边界易错 | 测试锁定：`--since <s> --until <t>` 提交串 = `git log --reverse <s>^..<t>`（含两端） |
| 落盘目录写权限 | 低 | 指定只读位置报错 | 建目录失败返回清晰错误；缺省 git 根可写 |
| 审计自身改动被检 | 中 | .dsh 等忽略目录 | 复用现有 skip-dirs/gitignore 语义 |

**边界条件**：
1. 非 git 仓库 / 无提交 → 报错「非 git 仓库或没有提交历史」，不落盘。
2. `--since`/`--until` 指向不存在的 ref → git rev-list 报错，如实返回。
3. `--since` 为空（缺省）→ 从最早提交开始；`--until` 为空 → 到 HEAD。
4. 范围只有 1 个提交 → 正常出一份报告。
5. 中途中断 → 已落盘的报告保留，下次用 --save 位置可续查（不自动续跑，避免复杂）。

## 四、Skill 学习检查

### 3.1 Skill 检索清单

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 类似功能 skill？ | 有 | `module-splitter`（无）、`verify-before-diagnose`（方案先实测现状）、`feature-todo-readme-cycle`（新功能 README 待办→实现→重排闭环） |
| 同类问题解决方案？ | 有 | 插件自身后台 job 先例：`git_commit_push` 走宿主 `jobs.start` 后台化；`scan-runner.js` 本地后台扫描（running 互斥 + wait 增量）——串行后台的既有范式 |
| 官方推荐做法？ | 有 | 项目纪律：审计入口统一 `auditFull`/`auditWithScope`，report 走 atomic-json 原子写；CLI 与插件行为一致（cli-help-sync 机器比对） |
| 现成库/工具？ | 有 | 全用 node 内置 + git 命令：`git log --format=%H --reverse`（遍历）、`git archive <sha> \| tar -x`（快照开出）、`mkdtempSync`/`rmSync`（临时目录） |

### 3.2 学习结论

- 学到的关键点：
  1. 现有审计（`auditFull`）对任意目录树全量扫描——历史快照解出临时目录后可直接复用它，**不新增第二套审计逻辑**。
  2. 宿主后台 job（`jobs.start`）与本地 scan-runner 的「running 互斥 + 进度/落盘」是既有的串行后台范式；CLI 独立进程无宿主，用同步串行循环 + 逐提交落盘实现同等效果。
  3. 报告落盘走 atomic-json（.tmp+rename）保证中断/崩溃不出现半文件。
- 决定复用：`git archive` 快照 + `auditFull` + atomic-json 原子写。
- 决定不用及原因：不写「只审每个提交的 diff 变更」模式（需求是「所有代码」= 快照全量，非增量）；不用 git worktree（会在仓库 .git/worktrees 留元数据，archive 更干净）；不入库报告（`audit-history/` 进 .gitignore）。

## 五、涉及文件汇总

| 文件 | 操作 | 预估 | 说明 |
|---|---|---|---|
| `lib/audit/history.js`（新增） | 新增 | +220 | 核心：遍历提交范围 → 每提交 git archive 快照 → auditFull → 组装报告对象 |
| `lib/audit/history-report.js`（新增） | 新增 | +120 | 报告落盘（JSON/MD 清单；原子写；目录参数缺省 git 根） |
| `cli.mjs` | 修改 | +40 | `audit --history [--since] [--until] [--out]`（KNOWN_FLAGS + HELP + cmdAudit 分支） |
| `lib/app/tool-call.js` | 修改 | +30 | code_audit 加 history 三参数（宿主 jobs.start 后台执行，返回 jobId） |
| `lib/app/tools.js` | 修改 | +8 | code_audit 参数声明（history/since/until/out） |
| `lib/app/http-handlers.js` | 修改 | +20 | HTTP 端点 /audit-history（可选：前端触发）——若本轮做则加，否则留后续 |
| `test/test-history-audit.mjs`（新增） | 新增 | +80 | 范围语义/快照审计/落盘/默认位置/参数缺省 |
| `audit-rules*` 不动 | - | - | 规则复用 |

## 六、逐文件改动要点

### 6.1 `lib/audit/history.js`（核心）

- `listHistoryCommits(repoPath, { since = '', until = '' })` → sha 数组（`git log --format=%H --reverse <since>^..<until>`；since/until 空 = 全历史 == HEAD；解析失败抛错）。
- `auditHistoryCommit(repoPath, sha, opts)`：`git archive <sha> | tar -x -C <mkdtemp>` → `auditFull(tmpDir, opts)` → 返回 `{ sha, short, subject, date, author, summary, quality, findings, fileCount }` → finally 删 tmp。
- `runHistoryAudit(repoPath, { since, until, outDir, onCommit, signal })`：串行遍历（for 循环，非并发），每提交调 auditHistoryCommit + 落盘 + onCommit(进度)；`signal.aborted` 时停（已落盘保留）。
- 快照目录放系统的 tmp（`mkdtempSync(os.tmpdir())`），用完 rmSync。

### 6.2 `lib/audit/history-report.js`

- `resolveReportDir(repoPath, outDir)`：outDir 缺省 = `join(repoPath, 'audit-history')`（git 根目录下约定子目录，即需求「缺省 git 根目录存所有提交的分析」）。
- `writeCommitReport(dir, entry)`：每提交一份 `<shortsha>-<yyyymmdd-HHMMSS>.json`（完整 findings）+ `<shortsha>.md`（可读清单：summary/quality/每次发现 file:line rule message）。
- 用 atomic-json 原子写；目录不存在 mkdir -p。
- `writeHistoryIndex(dir, entries)`：`SUMMARY.json`（全部提交的 summary/quality 汇总，供快速浏览）。

### 6.3 `cli.mjs`

- KNOWN_FLAGS 加 `--history --since --until --out`；HELP audit 行补说明。
- `cmdAudit(root, flags)`：`flags.history === true` 时走 `runHistoryAudit`（同步串行循环，逐提交 `console.log('[n/N] <short> summary=…')` + 落盘），结束打印汇总与报告目录；`--json` 输出总览。

### 6.4 插件工具（code_audit）

- tools.js：code_audit 加 `history/since/until/outDir` 参数。
- tool-call.js：history=true → 注册宿主后台 job（jobs.start，串行循环 + 落盘），立即返回 `{ ok:true, async:true, jobId, reportDir }`（与 git_commit_push 后台化同模式）；宿主无 jobs 时同步降级执行完返回。

## 七、影响分析

| 维度 | 程度 | 说明 |
|---|---|---|
| 现有功能 | 低 | 仅新增 --history 分支，--full/diff 不变 |
| 性能 | 中 | 历史全量审计耗时随提交数线性；后台 + 可中断 + 逐提交落盘缓解 |
| 兼容性 | 低 | 纯新增参数；落盘目录不入 git（.gitignore + audit-history/） |
| 安全性 | 低 | 报告含 findings（可能含敏感文件名/行号）——落在 git 根目录需注意私有库豁免同理；不写 .gitignore 外 |
| 可维护性 | 低 | 两个新模块职责单一（遍历+审计 / 落盘）；复用 auditFull 不重复规则 |

## 八、任务看板（确认后执行，从简到难，每步小提交）

### 阶段一：准备
- [x] 检索 skill / 记录学习结论（见第三节）
- [x] 运行现有测试记录基准（全量 756/754 pass / 0 fail）
- [ ] 确认版本升 1.7.0（version-discipline：需用户明确许可；本方案「是否执行」确认即含此许可）
- [ ] 注意：本项目直接在 master 小步提交（commit-push-modified-projects，无需建 feature 分支）

### 阶段二：代码修改（从简到难，每步本地提交）
- ☐ Step 1（最简单）：history-report.js 落盘（报告对象结构 + 原子写 + 默认目录解析）——单测
- ☐ Step 2：history.js 提交遍历 + 快照审计（listHistoryCommits / auditHistoryCommit / runHistoryAudit）——单测（临时 git 仓库 3 提交，范围语义断言）
- ☐ Step 3：CLI `audit --history`（KNOWN_FLAGS + HELP + cmdAudit 分支 + 进度打印）——CLI 集成用例
- ☐ Step 4（最复杂）：插件 code_audit history 后台 job（tools/tool-call/jobs.start 降级）
- ☐ 阶段三：全量回归 + 契约测试（KNOWN_FLAGS/HELP 同步 via cli-help-sync）
- ☐ 阶段四：版本 1.7.0 三处（self/package.json/README 版本表）+ README 功能说明 + tree-doc + 提交推送

## 九、验证方案

- 单元：listHistoryCommits 范围（含两端/缺省=全历史/无提交报错）；auditHistoryCommit 快照审计返回结构与清理；report 落盘原子写与默认目录。
- 集成：临时 git 仓库 3 个提交（第 2 个故意放进凭据/超长函数）→ `audit --history` 落盘 3 份报告，第 2 份含对应 findings；`--out` 指定目录生效；`--since/--until` 只落指定范围。
- 人工：CLI 打印逐提交进度 + 汇总；中断后已落盘保留。
- 回归：全量测试；KNOWN_FLAGS/HELP 一致性（cli-help-sync 机器自检）。

## 十、中断与插入管理

- 9.1 执行中插入新需求（会话中途接入的外部需求）：暂停当前执行 → 分析是否与本任务冲突/可合并 → 独立功能建议延后、阻塞前置先处理、可合并增强并入 → 默认不执行插入需求，等待确认是否切换。
- 9.2 执行中发现新问题（如审计历史快照里既有规则误报）：判断是否阻塞本目标；非阻塞记入「后续优化清单」继续。
- 9.3 中断记录：历史审计中途 Ctrl+C → 已落盘报告保留；下次用同 `--out` 目录可查历史结果（不自动续跑）。

## 十一、后续优化清单（本次不处理）

- HTTP 端点 `/audit-history`（前端侧边栏触发 + 进度查询）——本期不做，CLI/工具优先。
- 报告增量续跑（上次到哪、断点续传）——先全量，后续加 `--resume`。
- 只审「每个提交引入的 diff 变更」的轻量模式（`--history-diff`）——与「所有代码」口径并存可选。

## 十二、是否执行？

请回复 **确认** 或 **修改方案**，我将按确认结果执行；若修改方案，请指明调整点（如报告缺省位置是否直接用 git 根而非 `audit-history/` 子目录、是否本轮加 HTTP 端点）。
若回复含新需求，将触发「中断管理」流程，默认不执行并继续原任务。
