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

### 10.3 「按文件缓存 findings」（原计划 ⑤）—— **量化后判死，不实现**
- **原假设**：审计慢在逐文件规则 ⇒ 按「文件指纹 + 规则集指纹」缓存 file-local findings，重复审计近零成本。
- **量化实测**（外部稳定仓 dsh-codegraph，70 文件 / 1433KB）：
  ```
  逐文件 auditFile 合计 = 35ms（70 文件）        ← 只占全量审计的 ≈1.4%
  连续两次全量审计       = 2520ms / 1252ms       ← 第二次快一倍（存在进程内一次性成本）
  ```
- **结论**：**不做** ✗ —— 文件内规则只占约 1%，即使 100% 命中缓存也只能省 ~1%，收益远低于
  「缓存失效判据写错就会隐藏 findings」的风险（审计结论错误比慢更严重）。
- **顺带发现（比 ⑤ 本身更重要）**：同一进程内**冷/温审计差 1268ms** ✗ ⇒ 存在一次性成本。
  已**逐项排除**：`loadRuleFiles` 25ms + `compileAllRules` 9ms = **34ms**（实测，不是它 ✗）；
  结合"第 2 次就到位、无 findings 缓存也如此"，主要成因是 **JIT 预热**（首次全走未优化代码）+ 首次的
  忽略集/目录遍历（后者已有进程内缓存）。**长期驻留宿主里的插件只有首次审计付这笔钱** ✗，
  CLI/一次性进程每次都付 ⇒ 若要继续优化，应盯**冷启动**而不是逐文件缓存。
- **教训**：**性能假设必须先量化到"占比"再动手** ✓ —— 我原以为逐文件规则是大头，实测只有 1.4%；
  若直接开做，会花大力气换来 1% 且引入审计错误风险 ✗。

## 十一、第三批（2026-10-09）量化结论与下一步目标

| 项 | 实测（外部稳定仓 dsh-codegraph：70 文件 / 1433KB） | 结论 |
|---|---|---|
| 逐文件 `auditFile` 合计 | **35ms = 1.4%** | **⑤「按文件缓存 findings」判死** —— 上限收益 ~1%，不值得冒"缓存失效隐藏 findings"的风险 |
| 同进程连跑三次全量审计 | **2323 / 1212 / 1162ms** | 第 2 次即到平台期 ⇒ 一次性成本 ≈**1.1s**（JIT 预热 + 首次遍历） |
| 规则加载 + 编译 | **34ms**（loadRuleFiles 25 + compileAllRules 9；119 条规则） | **排除**：不是一次性成本的主因 ✗ |
| 冷启动（原目标③） | **import 插件入口 247ms**（149 个 lib 文件）＋ 首次审计 2270ms ⇒ 合计 2519ms | 宿主进程长驻 ⇒ 用户实际感受的是**温审计 ≈1.2s**；CLI/一次性进程才付全额 2.5s |
| **温审计 CPU profile**（只统计第 2 次运行的采样） | **tokenizer ≈18%**（`consumeLexeme` 9.8 + `tokenizeUncached` 6.2 + `tokenize` 2.0）｜`checkRegexRules` 7.4%｜GC 5.3%｜`readFileUtf8` 2.8%｜`lineStats` 2.7%｜`spawnSync` 2.0% | 下一目标锁定 **② tokenize 快路径** |

**温跑 profile 的解析方法（可复用）**：`node --cpu-prof` 一次跑两次审计，按「冷/温时长比例」切分 samples，
**只聚合第 2 次（温跑）的采样** ⇒ 得到用户实际感受路径的热点。
⚠️ 冷却 profile 会误导：冷跑里混着 JIT 预热与一次性工作（本次冷 profile 里 tokenizer 看着只有 15%，温跑实为 18%）。

### 11.1 ② tokenize 快路径：字符码查表替代逐字符正则 —— **保留（实测 +15~18%）**

- **热点**：`lib/ast/tokenizer.js` 的 `consumeLexeme` 对**每个字符**跑正则（`/[0-9]/`、`/[0-9._a-zA-Z]/`、
  `/[A-Za-z_$\u4e00-\u9fa5]/`…）✗，另一处对每个标点线性扫 26 个多字符运算符 ✗。
- **改动**：①三张 128 项 ASCII 表（**由同样的正则**在模块加载时生成一次）+ CJK 区间判断替代逐字符正则；
  ②多字符运算符**按首字符分桶**（桶内保持原数组顺序 ⇒ 最长匹配语义不变）。
- **等价性（三层证明）**：
  1. 全仓 302 个 .js/.cjs 文件 token 流 sha256 与改前基线比对：**301 一致，1 个"不一致"= `tokenizer.js` 自己**
     （因为它的内容被本次改动改了 ✗）；
  2. **严格证明那 1 个是假阳性**：用 `git show HEAD:lib/ast/tokenizer.js` 取**旧内容**喂**新算法** ⇒
     token 数 1889（= 基线 1889）、**哈希一致 ✓** ⇒ 算法逐字节等价；
  3. 真审计结果 sha256 = `763a93d3ac0bd306…`（与硬标尺一致 ✓）。
- **提速（A/B）**：
  ```
  纯 tokenize（302 文件 / 2151KB）:  219 / 225ms  →  128 / 137ms   （≈1.7×）
  真审计温跑（外部仓 70 文件）:      1212 / 1162ms →  1143 / 978 / 988ms（≈−15%）
  ```
- **回归**：全量 `--all` 仅 1 条老熟人失败（`checkFuncDrift`，因新增辅助函数）⇒ `doc-func apply` 后复跑
  漂移组 24/24、AST 组 15/15 全绿。
