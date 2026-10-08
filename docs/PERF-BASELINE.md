# 性能基线（dsh-git-push，2026-10-09）

> 用途：性能优化的**对照标尺**。任何"更快了"的结论都必须与本文数字对照；
> 任何"行为没变"的结论都必须与本文的**参考哈希**逐字节比对。
> 采集方式：一切命令后台执行并落日志（`/tmp/dsh-*.log`）；探针 = 项目自带 `scripts/hot-path-probe.mjs`。

## 一、被测对象与口径

| 项 | 值 |
|---|---|
| 仓库 | 本插件仓库自身（`lib/*.js` 149 文件 / 25079 行；审计范围内 files=252） |
| 审计规则 | 21 条（`lib/audit-rules/*.yml`） |
| 注册工具 | 16 个 |
| Node | v22.23.3 |
| 单次 git 子进程 | **~8ms**（实测 5 次 `git rev-parse` 共 39ms） |

## 二、墙钟基线

| 场景 | 命令 | 耗时 | 备注 |
|---|---|---|---|
| 全量审计 | `auditFull(repo, {})` | **5228ms** | files=252，findings=519，结果 216300 字节（≈21ms/文件） |
| diff 审计（常用） | `auditWithScope(repo, { scope:'diff' })` | **976ms** | files=2，findings=11 |
| 多仓扫描 | `describeRepo × 27 仓` | **2718ms** | 每仓约 6 次 spawn ⇒ 约 162 次子进程 ✗ |
| 冷启动（模块加载） | 见第三节 | 待补 | 本次未单列 |

## 三、fs 调用画像（auditFull 全量，探针口径）

| 调用 | 次数 | 判读 |
|---|---|---|
| `readFileSync` | 1659 | 约为文件数 6.6 倍 ✗（同一文件被多处重复读） |
| **`statSync`** | **1560** | **约每文件 6 次同步 stat** ✗✗ 头号热点（阻塞事件循环） |
| `existsSync` | 365 | 可用 stat 结果复用替代 |
| `stat`（异步） | 298 | 收集阶段的目录遍历 |
| `readdirSync` | 293 | 目录枚举 |
| `readdir`（异步） | 31 | 同上 |
| `writeFileSync` | 1 | 报告落盘 |

## 四、参考哈希（等价性硬标尺）

```
auditFull(repo, {}) 结果 JSON 的 sha256 =
a293348762c016ad2532f2a531ad6b57402169ba1c08063c181a89ace4a3e2eb
存档：/tmp/dsh-audit-ref-result.json（216300 字节，files=252，findings=519）
```
> 优化后必须与上表一致；若因**非性能改动**（如文档漂移修复）导致 findings 变化，
> 须先在同一状态下重取参考哈希，再开始优化，避免把"内容变化"误判为"行为漂移"。

## 五、优化目标（与方案一致）

1. 全量审计 **5228ms → ≤3660ms（−30% 以上）**；
2. `statSync` **1560 → 接近 0**（改为复用目录项 / 异步 stat）；
3. 多仓扫描 **2718ms → ≤1350ms（−50% 以上）**（合并子进程 + 只读并发）；
4. 冷启动不增；
5. 参考哈希**逐字节不变**。

## 六、复现命令（原样可跑）

```bash
# 全量审计 + 哈希 + 探针（后台落日志）
HOT_PATH_PROBE='{"modules":{},"fs":true}' node --import ./scripts/hot-path-probe.mjs --input-type=module -e "
import { createHash } from 'node:crypto';
const { auditFull } = await import('file://<repoRoot>/lib/audit/index.js');
const t = Date.now(); const r = await auditFull('<repoRoot>', {}); const ms = Date.now() - t;
const json = JSON.stringify(r);
console.error('墙钟=' + ms + ' findings=' + r.findings.length + ' sha256=' + createHash('sha256').update(json).digest('hex'));
"

# diff 审计
node --input-type=module -e "
import { auditWithScope } from 'file://<repoRoot>/lib/audit/index.js';
const t = Date.now(); const r = await auditWithScope('<repoRoot>', { scope: 'diff' });
console.log(Date.now() - t, r.files, r.findings.length);
"
```

## 七、后续复测记录

| 日期 | 状态 | auditFull（本仓） | auditFull（外部稳定仓） | 多仓扫描 | 等价性 |
|---|---|---|---|---|---|
| 2026-10-09 | 基线（Step 1 后） | 5228ms | 23892ms | 2718ms | 外部仓 sha256 = `763a93d3ac0bd306…` |
| 2026-10-09 | **历史 bug 修复后** | **3576ms（−32%）** | **2363ms（10.1×）** | 2718ms（未动） | 外部仓 sha256 **完全一致 ✓** |
| 2026-10-09 | **Step 5 多仓并发后** | 3576ms | 2363ms | **886ms（3.1×）** | `git_scan` 25 仓输出**逐字节等价 ✓** |

## 九、Step 5：多仓扫描只读并发（`lib/git/repos.js`）

- **基线**：`describeRepo` 每仓 6 次 git 子进程（单次约 8ms）且**串行**；25~27 仓实测 **2718ms**（本次复测 3462ms，含机器负载）。
- **根因**：`runGit` 是 `execFileSync`（同步阻塞）——**在 Promise 里调用并不会真正并行**（一个 worker 独占事件循环直到子进程结束）。
- **修复**：新增 `describeRepoAsync`（用已有的 `runGitAsync` 异步取数）+ `scanReposAsync`（有界并发）；
  并把 `scanRepos` 拆成「`collectRepoPaths` 收集路径」+「描述」，**同步与并发共用同一 walk 与同一解析函数**
  `parseRepoInfo`（避免两套口径漂移）。并发数走 `opts.concurrency` → 环境变量 `DSH_GIT_PUSH_SCAN_CONCURRENCY` → 默认 8（不硬编码）。
- **实测**：同步 3462ms → 并发 **783ms（4.4×）**；工具入口 `git_scan` 端到端 **886ms**；
  并发档位 2/4/8/16 = 786/765/751/738ms（**2 并发即吃完收益**，默认 8 稳妥）；
  **25 仓输出逐字节等价 ✓**（`JSON.stringify` 全等）。
- **回归教训**：新增导出后**必须同步 barrel**（`lib/git/index.js`）——漏加会让 `tool-call.js`
  在**加载期**报 `does not provide an export named 'scanReposAsync'`，两个测试文件整包失败（不是断言失败）。
  以后凡是"在子模块新增导出"，同一提交内必须改 barrel。

## 八、已修的历史 bug（性能类）

### 8.1 `lib/checks/dup-const.js` — 顶层判定二次复杂度（占全量审计 89.8%）

- **现象**：外部稳定仓全量审计 **23892ms**；Node 内置 `--cpu-prof` 显示 **89.8% 自耗时**集中在
  `lib/checks/dup-const.js:155` 的 `atTopLevel`。
- **根因**：该闭包**每次调用**都执行 `String(text).split('\n')`，而它被**每个 token** 调用
  ⇒ 复杂度 **O(tokens × 文件长度)**，大文件上呈二次爆炸。
- **修复**：只 split 一次（`lines[line-1]` 为 O(1)，`/^\S/` 锚定行首亦为 O(1)）⇒ 复杂度降回线性。
- **验证**：外部稳定仓 23892ms → **2363ms（10.1×）**，结果 sha256 **逐字节一致**；
  本仓全量 5228ms → 3576ms。
- **判读**：这是"行为正确但复杂度写错"的典型——**结果对、代价错**，常规测试（断言结果）永远抓不到，
  只有 CPU profile 能定位。定位手段：`node --cpu-prof --cpu-prof-dir=<dir>` + 按自耗时聚合 samples。

## 十、失败的实验（负结果同样留档，2026-10-09）

### 10.1 共享行数组缓存（line-cache）—— 等价性满分但收益为负，已回滚

- **假设**：审计路径约 20 处 `String(text).split('\n')`，同一份文本被 tokenizer / 行数统计 / 多条规则反复切，
  每次切都新建等长数组 ⇒ 认为这是「GC 占 9.1%」的主要来源，共享一份行数组即可减少分配。
- **做法**：新增 `lib/ast/line-cache.js`（按文本内容缓存行数组）+ `tokenizer`、`lineStats` 改为使用它。
- **等价性**：20 个真实文件的 token 流与原实现**逐字节一致** ✓，行数组与原 `split` 逐字节一致 ✓。
- **收益 A/B**（外部稳定仓，各 3 次）：
  ```
  带缓存 2378ms（2324 / 2508 / 2301）
  无缓存 2338ms（2306 / 2348 / 2361）
  ⇒ 带缓存慢 1.7%（在噪声带内，但反复测都不是赢）
  ```
- **结论**：**回滚**（两处改动撤销、`line-cache.js` 移入 `.trash/`），负结果记在此处避免后人重复踩。
- **原因推断**：①缓存键是**全文** ⇒ 每次调用都要对整个文本做哈希/比较，成本抵消收益；
  ②行数组被缓存**长期持有** ⇒ 常驻内存与 GC 反而升高；而原先 tokenizer 里的 `lines` 是**短命对象**，
  在分代 GC 下极廉价。
- **教训**：**「减少重复分配」≠「减少 GC」** —— 短命对象便宜，长命缓存更贵；
  凡「加缓存」类优化**必须 A/B 实测**（本次等价性满分却收益为负 —— 只证等价会得出错误结论）。

### 10.2 保留项：`readText` 指纹读缓存（Step ①，实测 +7.5% 保留）

同一批里另一个改动（`lib/audit/collector.js` 的 `readText`）**保留**：readFileSync 441 → 301 次（−32%）、
墙钟 2504 → 2317ms（−7.5%）、结果 sha256 与基线逐字节一致 ✓。差别在于它缓存的是**读盘结果**
（省掉真实 I/O，NAS/CIFS 上收益更大），而 10.1 缓存的是**纯 CPU 派生物**（省不掉算力还多占内存）。
