---
name: guide-cli-scripts
description: dsh-git-push 功能说明：命令行与脚本（git-sluice CLI、随插件脚本清单与退出码）。处理命令行与脚本类请求时加载。
whenToUse: 要在终端直接用插件能力（审计/提交/扫描/索引），或问脚本都有哪些、怎么调时。
updated: 2026-10-02
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-10-02
---

# 命令行与独立脚本（guide-cli-scripts）

> 一句话定位：**同一套引擎的两个脱离宿主入口**——`git-sluice` 是完整 CLI（审计/提交/扫描/索引），`scripts/` 下是一批可单独执行的小工具。

## 一、独立 CLI：git-sluice

脱离 DSH 独立运行（零第三方依赖，仅需 Node ≥18 与本机 git）。装在 PATH 里后直接敲：

| 子命令 | 作用 | 关键参数 |
|--------|------|----------|
| `version` | 查看版本 | — |
| `ruleset [槽位...]` | 编译规则包并输出统计 | 槽位名（可多个） |
| `scan <root>` | 全量扫描目录（非 git 目录也能查） | `--depth N` |
| `repos <root>` | 扫描本地 git 仓库（尊重 `.gitignore`，被忽略目录整棵跳过） | `--depth N`、`--max N`、`--json` |
| `index <root>` | 重建仓库索引 `dsh-repo-index.json` | `--owner <账号>`、`--depth N`、`--max N`、`--offline`、`--json` |
| `audit <root>` | 审计并输出质量评分与 findings | `--full`、`--level quick\|standard\|deep`、`--ruleset <目录>`、`--weights <JSON>`、`--include-ignored`、`--json` |
| `commit <repo>` | 提交（可选推送） | `-m <msg>`、`--push`/`--no-push`、`--dry-run`、`--force`、`--req-confirm`、`--json` |
| `link-check <路径>` | 检查 md/文本里的链接有效性（只 warning） | — |
| `yaml-template` | 输出规则 yml 模板 | — |
| `readme-template` | 输出 README 模板 | — |
| `self-check` | 版本一致性 + HELP 与参数解析机器比对 | — |

### 「功能一致、结果一致」的硬约定

CLI 是同一引擎的独立入口，**不另写一份逻辑**：

- **同一实现**：`repos` → 插件本地扫描同一函数；`index` → 索引维护同一函数；`audit`/`scan` → 审计编排同一入口
- **同一配置**：读**同一份**插件配置（`<DSH 配置目录>/git-push/config.json`），因此文件上限、规则包顺序、禁用槽位、权重覆盖全部生效
- **同一优先级**：显式 `--weights` > 配置里的权重覆盖 > 默认权重表
- **结果可对齐**：同一仓库同一参数下，CLI 的 `audit . --full` 与插件的 `code_audit{repo, scope:'full'}` 输出应一致（评分、summary、findings 条数）

### 例子

```bash
git-sluice version
git-sluice audit . --full --json
git-sluice repos /path/to/workspace --max 50 --json
git-sluice index /path/to/workspace --owner EIGHTfs --offline
git-sluice commit /path/to/repo -m "fix: 修正 xx" --no-push
git-sluice self-check
```

## 二、随插件发布的独立脚本

脚本**不注册插件入口**（不进工具/API/设置项），只作为可执行脚本供 AI 或人手动调用；随插件发布，安装副本目录里同样能跑。

### 使用者可直接用

| 脚本 | 作用 | 用法要点 |
|------|------|----------|
| `scripts/rule-switch.mjs` | 手动启停安装版本的规则槽位（与侧边栏 UI 启停同一套实现） | `node scripts/rule-switch.mjs <status\|enable\|disable> <槽位>` |
| `scripts/scrub-user-wording.mjs` | 清洗代码注释里的沟通残留措辞（只警告不改、逐条确认、每文件 `.bak`） | `node scripts/scrub-user-wording.mjs <路径...> [--apply [--yes]]`；`--repo <仓库>` 只处理未提交 diff |
| `scripts/audit-runtime-check.mjs` | 三层审计的 L3 运行时检测：动态 import 后清空再访问，抓静态查不出的 bug | `node scripts/audit-runtime-check.mjs <js 文件> [--obj 名]`；`--all <目录>` |
| `scripts/scan-file-io.mjs` | 扫描脚本里的文件读写调用与路径，标四级风险（与审计 `robustness/io-risk` 同标准） | `node scripts/scan-file-io.mjs <路径> [--write]` |
| `scripts/scan-repos.mjs` | 扫描本地 git 仓库清单 | `node scripts/scan-repos.mjs --root <root> --owner <owner> [--depth 10] [--max 200]` |
| `scripts/audit-runner.mjs` | 跑 `scripts/audit-ext/` 下全部审计扩展 | `node scripts/audit-runner.mjs <仓库>` |

### 开发者维护用

| 脚本 | 作用 |
|------|------|
| `scripts/check.mjs` | 语法检查（递归查 lib 与 CLI 入口） |
| `scripts/scan-version.mjs` | 版本一致性校验（三处版本号是否同步） |
| `scripts/doc-func.mjs` / `doc-tree.mjs` / `doc-version.mjs` | 函数列表 / 目录树 / 版本记录 三份文档与代码同步（`check` 查漂移、`apply` 写回） |
| `scripts/readme-gen.mjs` | README 生成 |
| `scripts/gen-preview.mjs` / `watch-preview.mjs` / `preview-server.mjs` | 界面预览页数据生成、变更监听、本地真实后端测试服务 |
| `scripts/browser-page-probe.mjs` | 无头浏览器探针：读页面真实渲染文本 + 抓前端运行时错误（零硬编码路径，自动探测环境） |
| `scripts/sync-plugin.mjs` | 双副本同步（工作区 ↔ 安装副本） |
| `scripts/verify-prestep.mjs` | 上下文注入自检（真实触发 pre-step 校验注入内容） |
| `scripts/rename-locator.mjs` | 变量重命名位置定位（按作用域聚合） |
| `scripts/rules-solo-audit.mjs` | 单条 yml 规则的控制变量评估 |
| `scripts/probe-recheck.mjs` | 「重新检测」按钮链路实测探针（联网） |

## 三、退出码语义（脚本约定）

| 退出码 | 含义 |
|--------|------|
| 0 | 成功 / 无命中 |
| 1 | 失败 / 有命中（如运行时检测抓到 bug、语法检查失败） |
| 2 | dry-run 有命中（措辞清洗）/ 无法检测（运行时检测） |
| 3 | 非交互环境未带 `--yes`，拒绝写盘 |

## 四、边界与坑

- CLI 与插件**读同一份配置**：改设置会同时影响两边；排查「CLI 与插件结果不一致」时先比配置
- 措辞清洗**只改注释段**（词法感知，字符串里的措辞不动），md 会跳过 ``` 围栏代码块；private 仓库的工作留痕措辞通常**不需要**清洗
- 运行时检测只能测模块**导出**的入口，内部闭包需测试钩子；依赖被测文件能安全 import
- 文档同步类脚本（`doc-*`）是**维护动作**：改了代码/提交后要跑 `apply`，否则漂移检查会报
- 脚本路径一律相对插件根；安装副本目录里同样按此相对路径执行

## 五、相关功能

- 审计规则、评分、豁免细节 → `guide/guide-audit`
- 提交推送门禁与返回字段 → `guide/guide-commit-push`
- 仓库索引与克隆 → `guide/guide-clone-repos`
