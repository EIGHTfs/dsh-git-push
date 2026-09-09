# dsh-git-push 工作区代码独立分析报告（2026-09-09）

> 本报告为独立源码审读 + 本机实测结论，未参考 docs/ 下任何既有分析报告。
> 分析对象：`/vol2/1000/DeepSeek Harness/dsh-v0.1.2-alpha.4/.dsh-home/工作区/dsh-git-push`（v1.60.0，约 1.4 万行源码 + 14 个测试文件）。
> 方法：通读全部 lib/*.js（30 个模块）、cli.mjs、scan-version.mjs、审计规则 YAML、前端 client.js/viewer.js，并运行语法检查、CLI 冒烟、`npm test`、插件自审（`node cli.mjs audit . --json`）验证发现。

---

## 一、总体结论

插件功能面完整、工程组织清晰（v1.42.0 文件级拆分后模块职责明确），测试量大（手写断言 533 + node:test 39），审计门禁本身可运行。但存在以下短板，按严重度分级：

| 级别 | 数量 | 代表问题 |
|------|------|----------|
| 🔴 功能缺陷（实测复现） | 4 | `npm test` 脚本坏、CLI `--depth` 文档与实现不符、viewer 远程链接拼接错误、`auditRuleWeights` schema 重复键 |
| 🟠 安全/隐私风险 | 3 | origin remote 内嵌明文 token、HTTP 写接口无鉴权、全局 `safe.directory=*` 放宽 |
| 🟡 一致性与文档不同步 | 7 | 默认 blockOn 注释与实现矛盾、工具数注释滞后（11 vs 12）、quality 手写 YAML 解析与全项目 js-yaml 不一致、`npm test` 与 README 声称不符 |
| 🟡 性能 | 2 | viewer 每提交每文件 3 次 git 子进程、scanRepos 每仓库 4+ 次 spawnSync |
| 🟠 测试盲区 | 1 | 6 个关键模块（commit-push/github-api/plugin-http/plugin-tools/version-history/remote-repo）无专属测试文件 |

---

## 二、功能性缺陷（实测确认）

### 2.1 `package.json` 的 `npm test` 脚本本机不可用 🔴

- **位置**：`package.json` L27 `"test": "node --test test/"`
- **实测**：在仓库根执行 `npm test` → `Error: Cannot find module '.../dsh-git-push/test'`，测试套件整体失败（exit 0 但 `✖ fail 1`）。Node v24.19.0 下 `node --test test/` 不识别目录参数，必须 `node --test test/*.mjs`（实测通过）或 `node --test` 自动发现。
- **影响**：README 声称「全量回归 503/0（11 套件）」，但官方测试入口一跑就挂；CI/交接方照 README 跑会得到假失败。
- **建议**：改为 `node --test test/*.mjs`，并把 README 的套件数/断言数同步为实测值。

### 2.2 CLI `scan --depth N` 文档承诺但未实现 🔴

- **位置**：`cli.mjs` L60（HELP 写 `scan [root] [--depth N]`）、L167-170（`cmdScan` 读 `flags.depth`）、L32-50（`parseArgv` 无 `--depth` 分支）。
- **实测**：`node cli.mjs scan . --depth 2` → `未知参数: --depth` 并打印 HELP 退出；`--depth` 永远解析不到，`cmdScan` 里 `flags.depth` 恒为 `undefined`，回退 depth=3。
- **影响**：用户按帮助文档使用即踩坑；`--depth` 相关代码是死路径。
- **建议**：`parseArgv` 增加 `--depth` 分支（或从 HELP 移除该选项）。

### 2.3 viewer 提交页仓库链接拼接错误 🔴

- **位置**：`lib/viewer.js` L330：`'https://github.com/' + esc(repo.remote)`。
- **实测推演**：`repo.remote` 来自 `readRepoStatus` 的 `maskRemoteUrl(origin)`，v1.40.0 后 origin 形态为 `https://api.github.com/repos/EIGHTfs/dsh-git-push` 或 SSH 443。拼接结果 = `https://github.com/https://api.github.com/repos/...`（双协议前缀）或 `https://github.com/git@ssh.github.com:443/...` —— 均为无效链接。
- **影响**：查看器「点击仓库名跳 GitHub」功能实际不可用（且掩码后的 URL 本来也不该拼到 github.com）。
- **建议**：用 `parseGithubOwnerRepo(remote)` 解析 owner/repo 后拼 `https://github.com/{owner}/{repo}`，解析失败则不渲染链接。

### 2.4 `plugin-config.js` schema 重复键 `auditRuleWeights` 🔴

- **位置**：`lib/plugin-config.js` L33 与 L45 各定义一次 `auditRuleWeights: z.dict(z.any()).default({})`。
- **实测**：JS 对象字面量重复键静默后者覆盖前者，行为恰好一致所以未爆雷；但这是复制粘贴残留（v1.47.0 注释两处一模一样），schema 自文档化失真——后续若只改一处会踩「改了没生效」的坑。
- **建议**：删除 L45 重复定义（或保留一处并加版本注释）。

---

## 三、安全 / 隐私风险

### 3.1 origin remote 内嵌明文 GitHub token 🟠

- **实测**：`git remote get-url origin` 返回 `https://ghp_****@github.com/EIGHTfs/dsh-git-push.git`——token 明文写在 `.git/config`。
- **代码面**：`maskRemoteUrl`（token-credentials.js L393）只在输出/会话展示层脱敏；`parseGithubOwnerRepo`（github-api.js L106）会解析含凭据 URL；插件 v1.18.3 后新 origin 虽改走 api.github.com 无凭据，但对存量「token 内嵌 origin」仓库无主动迁移/清理工具。
- **影响**：任何能读该目录文件的人/进程/备份可直接取得有效 token；`.git/config` 常随仓库目录整体备份/打包泄露。
- **建议**：提供一键「origin 去凭据化」（rewrite 为 api.github.com/repos/o/r 或 ssh 443），或 push 路径检测到 userinfo 时告警。

### 3.2 HTTP 写接口无鉴权（依赖本机信任边界）🟠

- **位置**：`lib/plugin-http.js` L295-303（commit）、L269-281（rebuild 可 force 覆盖远端）、L283-293（remote-create）、L128-138（permit/config）。
- **代码面**：所有 POST 路由直接执行，无 token/签名/来源校验；仅 readJson 有 5MB 上限。`/api/git-push/rebuild` 支持 `force=true` 重建并覆盖远端历史，`/api/git-push/commit` 可对任意路径提交推送。
- **影响**：DSH webServer 若暴露到非本机网络（或同网段浏览器可访问该端口），任意调用方可触发提交/重建/创建远程仓库；viewer 虽然只读，但写接口与它同源开放。
- **建议**：写操作路由至少加 Host/Origin 白名单校验 + 可选共享密钥；文档明示「仅限本机信任环境」。

### 3.3 全局 git 配置副作用 `safe.directory=*` 🟠

- **位置**：`lib/index.js` L62-69 / `lib/git-core.js` L41-64（`ensureGlobalSafeDirectoryStar` 写全局 `--add safe.directory=*`）。
- **影响**：插件启动即放宽**全局** git 对「可疑属主仓库」的拒绝（不只本机目录），任何用户目录的 git 仓库都被视为安全。对单用户 NAS 场景是便利，但对多用户/共享机器是放开攻击面。已用 `DSH_GIT_ENFORCE_PASS` 限定内部调用，但全局配置本身影响其他 git 使用者。
- **建议**：改按需 `-c safe.directory=<cwd>` 精确注入（runGit 已带），仅保留 filemode 全局写；或在 README 风险节注明。

---

## 四、一致性 / 文档不同步

### 4.1 默认 `blockOn` 注释与实现矛盾 🟡

- `lib/audit.js` L8-10 文件头注释：「拦截策略（blockOn）：'any' —— 任何 findings 都拦截（**严格模式，默认**）」；
- 实际默认：`lib/plugin-setup.js` L18 `config.blockOn === 'any' ? 'any' : 'blocker'`（默认 **blocker**），README 与 `lib/index.js` L24 也写默认 blocker。
- 即 audit.js 头部注释是 v1.48.0 改默认值前的残留，读源码者会被误导。

### 4.2 工具注册数与注入目录不一致（11 vs 12）🟡

- `lib/index.js` L13 注释「agent 工具注册（11 个 defineTool）」、`lib/workspace-context.js` L89 `FUNCTION_MANUAL_COMPACT` 列 11 个工具名——均缺 `audit_full_scan`；
- 实际 `lib/plugin-tools.js` 注册 **12** 个（含 `audit_full_scan`，L105-121）。
- systemPrompt 注入的功能目录会少列一个工具，AI 侧感知与实际能力不一致。

### 4.3 quality.js 手写 YAML 解析与全项目 js-yaml 方向背道而驰 🟡

- `lib/quality.js` L50-86 `loadQualityYaml` 用缩进+正则行解析，注释称「无第三方依赖」；但同项目 audit.js/rule-packs.js/readme-gen.js 均已 `import js-yaml`（v1.54.0 起 audit 默认真实解析）。
- 行解析对带引号的值、块标量、`#` 注释内冒号等会漏/错（如维度名带引号 `"可读性": 15` 会解析失败回退默认权重）；两个解析器并存导致同一份 checklist.yaml 两种解释。
- 建议统一为 js-yaml（依赖已在 peer/运行时存在）。

### 4.4 README 声称与实测不符 🟡

- README 声称「全量回归 503/0（11 套件）」；实测：14 个测试文件、`node --test test/*.mjs` 全通过（断言数 533 手写 + 39 node:test），`npm test` 坏（见 2.1）。
- 套件数与断言数至少一项过时；`npm test` 不可用是硬伤。

### 4.5 `package.json` description 版本滞后 🟡

- `package.json` L4 description 仍描述 v1.40.0 的能力（「v1.40.0：审计规则包插件化…凭据收敛…去同级仓依赖」），当前版本 1.60.0，用户/市场页看到的能力摘要滞后 20 个版本。

### 4.6 cli.mjs 头部「零第三方依赖」声明不实 🟡

- `cli.mjs` L7「零第三方依赖；Node ≥18」；但 import 链 `rule-packs.js` / `audit.js` 均 `import js-yaml`——脱离 DSH 的裸 Node 环境跑 `git-sluice` 会 `Cannot find package 'js-yaml'`。要么改为仅纯引擎子集（剥离 YAML），要么修正声明为「依赖 js-yaml」。

### 4.7 `docs/1.js` 游离 CommonJS 脚本 🟡

- `docs/1.js`（457 行，CommonJS `require('fs')`/`module.exports`）被 git 跟踪、无任何模块引用、无测试，风格与全项目 ESM 无关，疑似早期工具残留；放 docs/ 下还会被全仓扫描/审计规则波及（非 .md 也进文本扫描范围）。
- 建议移入 `scripts/` 或归档/删除。

---

## 五、性能问题

### 5.1 viewer 提交历史读取为 O(提交 × 文件 × 3) 次 git 子进程 🟡

- `lib/viewer.js` L48-83 `getCommitHistory`：每提交先 `log --name-only`（L61），再逐文件 `rev-parse` 判父（L63/L29）+ `diff --numstat`（L68）。limit=100、每提交 10 个文件 ≈ 1000+ 次 `spawnSync('git')`，HTTP 查看器首屏会显著卡顿。
- 建议：用单次 `git log --numstat --name-status --pretty=format:...` 合并取数，或限制每提交文件数/延迟加载。

### 5.2 scanRepos / readRepoStatus 每仓库 4+ 次 spawnSync 🟡

- `lib/repo-scan.js` L52-68：branch / remote / rev-parse / status / log 各一次独立子进程；N 仓库全量扫描 = 4N+ 次 git 启动。`git_scan`、HTTP repos、repo-index 重建、push-permit 目标解析都会触发全量扫。
- 建议：合并为 `git status --porcelain -b --branch` 单次调用解析多字段；仓库量大时加并发/缓存。

---

## 六、测试盲区与质量评分口径

### 6.1 6 个关键模块无专属测试 🟠

- 现有测试文件（14 个）覆盖：core/audit/cli/env-inject/full-scan/permit/private-files/quality/repo-index/rule-packs/rules/style-rules/viewer/apply。
- **无专属测试**：`commit-push.js`（提交编排主链路）、`github-api.js`（pushViaApi/SSH 回退/可见性）、`plugin-http.js`（12 条路由）、`plugin-tools.js`（12 个工具接线）、`version-history.js`（squash/drop/fresh 破坏性重建）、`remote-repo.js`（创建/克隆）。这些恰是高风险模块，全靠 test-core 间接覆盖。
- 例证：2.3 viewer 链接 bug、2.1 npm test bug 都未被任何测试捕获。

### 6.2 质量评分「无问题即高分」口径 🟡

- `lib/quality.js` L255-296 `scoreQuality`：安全性固定 9 分、可观测/可部署/文档/DX 各固定 7 分（共 5 维 39 分固定值）；「没测到问题」即得高分。
- 插件自审实测：`code_audit` 对当前仓库给出 quality 90 分 A 级，但同一次审计有 2 个 blocker（docs-conversation）——评分与拦截结论脱节（评分不含 docs-conversation/secret 等规则维度）。
- 建议：评分输出保留现有「measured/fixedValue」标注（已有），但在 README/工具描述中明示「高分不代表无安全/逻辑问题，只代表静态可测维度未见扣分」。

---

## 七、其他观察（低优先级）

1. `lib/audit.js` 顶部大段注释（L29-35）描述「缺省 lib/audit-rules/eightfs.rules.json」，实际 v1.47.0 已改 YAML 多槽位——注释残留旧设计。
2. `lib/index.js` L22-24 描述里「L0 静态 + L1 LLM」与 L24 拦截策略说明重复且与 plugin-setup 默认值对齐但 audit.js 头部不一致（见 4.1）。
3. `test/test-rules.mjs` 断言最薄（node:test 用例集中在解析/合并，`fetchCommentWordingRules` 在线拉取靠本机 http 服务模拟，覆盖偏少但方向正确）。
4. `scan-version.mjs` 未挂进 package.json scripts，版本同步检查依赖人工运行；README 版本表一行最长 2657 字符，可读性差。
5. `.tmp-run/` 已有 gitignore 兜底；`docs/` 下 17 份报告 + 4 份未提交报告堆积，报告型文档建议移入归档目录避免污染源码审计范围（本次自审的 2 个 docs-conversation blocker 正来自 docs/ 未提交报告）。
6. `gitIgnoreCache`（full-scan.js L158）与 `_tokenValidCache`（token-credentials.js L431）为无上限 Map，缓存键数量与仓库/token 数成正比，长期运行内存增长（量级小，可接受）。

---

## 八、改进建议优先级

| 优先级 | 事项 | 工作量 | 受益 |
|--------|------|--------|------|
| P0 | 修复 `npm test` 脚本（`test/*.mjs` glob） | 1 行 | CI/交接可用 |
| P0 | CLI `--depth` 解析（或删文档承诺） | 3 行 | 帮助文档可信 |
| P0 | viewer 链接用 owner/repo 重拼 | 5 行 | 功能恢复 |
| P1 | origin token 去凭据化工具 + push 告警 | 0.5 天 | 消除明文凭据面 |
| P1 | HTTP 写路由 Origin/Host 白名单 | 0.5 天 | 写接口防跨源调用 |
| P1 | 删除 `auditRuleWeights` 重复键、同步注释（blockOn/工具数/description/cli 依赖声明） | 0.5 天 | 文档与代码一致 |
| P1 | commit-push / github-api / plugin-http 补专属测试 | 1-2 天 | 高风险主链路有回归保护 |
| P2 | quality.js 换 js-yaml 解析 | 2 小时 | 解析口径统一 |
| P2 | viewer/scanRepos 合并 git 子进程调用 | 1 天 | 首屏/扫描提速 |
| P3 | docs/1.js 归档、docs 报告移目录 | 30 分钟 | 仓库整洁 |

---

## 附：验证过程记录（可复现）

```bash
# 语法检查（全部通过）
node --check lib/index.js lib/audit.js lib/rule-packs.js lib/client.js lib/viewer.js cli.mjs scan-version.mjs

# CLI 冒烟
node cli.mjs ruleset          # 规则包编译 OK，secret=4/credentialFile=2/credentialRef=2/wording=10/docConv=5

# npm test（失败复现）
npm test                      # Cannot find module '.../test'，✖ fail 1

# 正确姿势（通过）
node --test test/*.mjs        # 37 组 node:test + 手写断言全部通过

# CLI --depth 缺陷复现
node cli.mjs scan . --depth 2 # 未知参数: --depth

# 插件自审当前仓库
node cli.mjs audit . --json   # summary {blocker:2, warning:4}, blocked:true, quality 90/A
                              # blocker 来源: docs/ 未提交报告的 docs-conversation 命中

# 版本一致性
grep -n "1.60.0" cli.mjs      # VERSION = '1.60.0' 与 package.json 一致（cli 手动同步，靠 scan-version.mjs 辅助）
```

> 免责：本报告所有「实测」均在本机（Node v24.19.0）执行；「代码审读」结论标注了文件:行号，未运行破坏性命令（无真实推送/重建）。
