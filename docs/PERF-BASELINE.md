# 性能基线（dsh-git-push · git 侧）

> 用途：git 侧（提交/推送/克隆/仓库扫描）性能优化的对照标尺。
> 审计引擎的性能基线属审计实现包，见 `audit-sluice` 的 `docs/PERF-BASELINE.md`。
> 采集口径：命令后台执行并落日志；探针 = 项目自带 `scripts/hot-path-probe.mjs`。

## 一、被测对象与口径

| 项 | 值 |
|---|---|
| 仓库 | 本插件仓库自身 |
| 注册工具 | 20 个 |
| Node | v22 |
| 单次 git 子进程 | **~8ms**（实测 5 次 `git rev-parse` 共 39ms） |

## 二、多仓扫描只读并发（`lib/git/repos.js`）

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
