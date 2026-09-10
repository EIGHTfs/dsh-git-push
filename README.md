# dsh-git-push

DSH（DeepSeek Harness）git 自动提交推送插件——统一函数入口架构（从零开发的独立实现）。

> **状态**：开发中（v0.0.0 计划稿 → v0.1.0 框架 → 每完成一个入口递增第三位）
> **基线**：`../dsh-git-push`（v1.60.1，存档+自检扫描用，五份外部审计报告已核对，问题清单见 §五）
> **血缘**：本项目按统一函数入口架构从零开发，参考既有经验与五份外部报告的教训独立实现。

## 目录

- [架构设计](#架构设计)
- [总入口清单](#总入口清单)
- [统一问题对象](#统一问题对象)
- [版本规划](#版本规划)
- [问题清单（五份报告 → v2 自检）](#问题清单五份报告--v2-自检)
- [链接判断规则设计](#链接判断规则设计)
- [文件目录结构及作用](#文件目录结构及作用)
- [版本列表](#版本列表)
- [注意事项](#注意事项)

## 架构设计

**核心思想：统一函数入口 + 注册表扩展，加能力不破坏主入口。**

- **规则总入口（yml 管理）**：所有 yml 规则槽位（nodejs/npm/html/comment/dsh/private/structure/version/template 等）统一装载→解析→编译；**加字段=加函数，compileRule 主体永不修改**；每个字段函数自带 `dimensions` 维度绑定（支持一字段多维度）
- **审计总入口**：`auditChanged`（变动，git diff）/ `auditFull`（全量，非 git 目录可查）；`auditWithScope` 统一调度，`auditScanScope` 设置项控制
- **git 总入口**：token / sshkey / 提交 / 推送 / clone / 建仓 / 可见性 / 版本历史 / 重建历史
- **自身总入口**：版本控制（单一事实源）/ README 模板（独立，不走拦截 yml）/ yml 模板（规则模板 + 豁免速查）/ 独立运行能力（CLI，npm test 可复现）
- **评分总入口**：10 维度加权（可读性 15 / 可维护性 15 / 健壮性 15 / 安全性 18 / 性能 10 / 测试覆盖 10 / 可观测性 5 / 可部署性 5 / 文档 4 / 开发者体验 3，合计 100），问题(dimensions) → 分维度计数 → 加权总分
- **豁免总入口**：`dsh-skip-*` 注册表（每个豁免类型声明「能豁免哪些维度」），扫描问题输出自带 `exemptHint`
- **上下文注入入口**：给 AI 会话注入环境（工作目录映射 / 工具路径 / skill 清单）
- **HTTP API 入口**：鉴权（Origin 校验 / CSRF / 写操作确认）
- **测试总入口**：`npm test` 一条命令可复现全绿，失败退出非 0
- **侧边栏（设置 UI）**：复用既有 client.js 骨架改造

## 总入口清单

| # | 入口 | 职责 | 状态 |
|---|------|------|------|
| 1 | 规则总入口 | 所有 yml 字段解析 + yml 衍生新字段，编辑函数按字段指派 | ⏳ 规划 |
| 2 | 审计总入口 | 变动/全量/非 git 目录，默认关闭，侧边栏开关 | ⏳ 规划 |
| 3 | git 总入口 | token/sshkey/提交/推送/clone/建仓/可见性/历史 | ⏳ 规划 |
| 4 | 自身总入口 | 版本控制/README 模板/yml 模板/CLI | ⏳ 规划 |
| 5 | 侧边栏 | 设置 UI（复用旧 client.js） | ⏳ 规划 |
| 6 | 评分总入口 | 10 维度加权 | ⏳ 规划 |
| 7 | 豁免总入口 | dsh-skip-* 注册表 + exemptHint | ⏳ 规划 |
| 8 | 上下文注入 | AI 会话环境注入 | ⏳ 规划 |
| 9 | HTTP API | 鉴权端点 | ⏳ 规划 |
| 10 | 测试总入口 | npm test 可复现 | ⏳ 规划 |

## 统一问题对象

```
问题 = {
  file, line,
  rule, kind,
  dimensions: ['可读性', '可维护性'],   // 字段函数里写绑定，支持一字段多维度
  severity,                            // blocker / warning / info
  exemptHint,                          // 怎么豁免（含位置语义：文件头=整文件 / 位置=单点）
  scoreImpact,                         // 该问题对 10 维度评分的影响
}
```

每个编译函数（字段函数）声明 `dimensions`——`func-lines` 字段 → `['可读性','可维护性']`，`empty-catch` → `['健壮性','可观测性']`。

## 版本规划

| 版本 | 内容 |
|------|------|
| **0.0.0** | README 文档（本文件）：开发计划 + 问题清单 + 链接规则设计 |
| **0.1.0** | 功能框架搭建完毕能跑（目录结构 + 入口骨架 + npm test 绿） |
| **1.1.x** | 每完成一个入口 commit 一次，第三位 +1（一次一入口） |
| … | 全部入口完成后按实际功能跳版本 |

**开发纪律**：每次提交**不推送**，提交前调用旧项目（`../dsh-git-push`）扫描本目录自检；旧项目发现的问题修复后再提交。

## 问题清单（五份报告 → v2 自检）

五份外部报告（code-quality-audit / code-analysis / 代码不足分析报告-实测版 / 代码不足分析-源码实测 / CODE-ANALYSIS-independent）已逐条实测核对。已证实问题转化为 v2 规则引擎的**内置自检规则**：

| # | 已证实问题（来源） | v2 自检规则 | 规则槽位 |
|---|---|---|---|
| 1 | 死导入/未使用导出（execSync/commitAndPush/readdirSync/gitRaw） | `unused-import` / `unused-export` | nodejs |
| 2 | 真空 catch / 静默吞错（readme-gen:166） | `empty-catch` | robustness |
| 3 | 依赖未声明（js-yaml，三份报告都中） | `declared-dependency` | npm |
| 4 | npm test 入口坏（三份报告都中） | `test-entry` | npm |
| 5 | CLI 文档 vs 实现不一致（--depth，三份报告都中） | `cli-help-sync` | npm |
| 6 | README/注释/工具数滞后（11 vs 12） | `doc-sync` | dsh |
| 7 | HTTP 写端点无鉴权 | `http-auth` | dsh |
| 8 | quality 规则自身假阴性（checkSyncInAsync 前缀匹配等） | `quality-rule-selfcheck` | dsh |
| 9 | 同步 fs 204 处阻塞 | `sync-fs`（AST 全量） | performance |
| 10 | 凭据卫生（origin 内嵌 token、/tmp PID） | `credential-in-url` / `tmp-symlink` | security |
| 11 | 链接拼接错误（viewer 双协议前缀） | **`link-check`** | 新 kind |
| 12 | 配置被忽略（githubOwner） | `config-ignored` | dsh |
| 13 | 门禁链路漏接（requirementsConfirmed 只工具传） | `gateway-chain` | dsh |
| 14 | 循环依赖（git-core⇆github-api） | `circular-import` | structure |
| 15 | 文档措辞被自家拦截 | `docs-conversation` + **输出附带一键改写建议** | comment |

**自检闭环**：v2 自己提交前跑一遍上面的 self-check = 等价于一次外部审计——「别人发现问题」→「自己每天发现」。

## 链接判断规则设计

**新规则 kind：`link-check`**——扫描项目内所有 URL，访问验证，报错扣分。

```yaml
- id: link/valid-url
  kind: link-check
  severity: warning
  retries: 1
  timeout_ms: 5000
  flaky_domains:            # 不稳定的知名域名，网络错误扣分打折
    - github.com
    - api.github.com
    - raw.githubusercontent.com
    - npmjs.com
  dimension: 文档            # 绑 10 维度
  concurrent: 5
```

| 错误类型 | 基准扣分 | flaky 域名打折 | 绑定维度 |
|---|---|---|---|
| 404/403（连得上但目标不在） | 3 | 1.0（不打折） | 文档×3 |
| DNS 解析失败 | 2 | 0.3 | 文档×2 |
| 连接超时 | 1 | 0.2 | 文档×1 |
| 网络层其他 | 1 | 0.2 | 文档×1 |

**boundary（防误报核心）**：github 系列域名天然不稳 → flaky 域名网络错误扣分 ×0.2；DNS 失败且域名在 flaky 列表 → 只记 debug 不记分。**链接检查只跑 warning 不拦截**（网络不可靠，blocker 会造成假阳性拦截）。

## 文件目录结构及作用

（框架搭建后填充——0.1.0 起按实际模块更新本表并 commit）

| 路径 | 作用 |
|---|---|
| `lib/` | 引擎模块（按总入口划分） |
| `lib/audit-rules/` | yml 规则槽位 |
| `test/` | 测试（test-<module>.mjs，npm test 可复现） |
| `docs/` | 文档（本计划 / 看板 / 报告） |
| `cli.mjs` | 独立 CLI（git-sluice） |

## 版本列表

| 版本 | 说明 |
|---|---|
| **1.0.0**（当前 · 首发） | **DSH 插件接线完成**：lib/index.js（apply + 7 工具注册 + HTTP 鉴权分发 + Config schema）+ client.js（DSH 客户端插件，手写 createElement/零外部资源/开关默认关）+ scripts/sync-plugin.mjs（双副本同步，默认 dry-run）+ cordis.patch.yml + scanRepos；test-plugin 25 + test-client 21 断言（263 总全绿） |
| **0.2.0** | **链接判断落地**：lib/link-check/index.js（extractLinks 去重去占位符 / gradeResult 分级：404·403→-3、DNS→-2、超时·5xx→-1 / flaky 域名网络错误 ×0.2 / probeLinks 并发受限 / checkLinks 统一问题对象，**只 warning 永不 blocker**）+ audit-rules-docs.yml 槽位（link-check kind）+ CLI `link-check <路径>`；test-link-check 24 断言（233 总全绿） |
| **0.1.8** | **侧边栏落地**：lib/client/index.js 手写 createElement（无 JSX，无需构建）+ 零外部资源（纯内联 CSS，无 CDN/外链字体图标）+ 审计开关默认关（auditEnabled/pushPermitEnabled 等全 false）+ 配置即时生效（onChange 立即回调、类型校正、未知键丢弃）+ 不实施 viewer；test-client 16 断言（208 总全绿） |
| **0.1.7** | **上下文注入 + HTTP 总入口落地**：lib/http/index.js 纯函数鉴权（checkOrigin 同源判定忽略端口/路径 → 无 Origin/跨源 403、checkWriteConfirm 破坏性操作缺 confirm → 400、checkBodySize 5MB → 413、authPipeline、routeRequest 路由分发、readJsonBody 流式 413 防护）+ lib/context/index.js（createEnvInjectionText/parseEnvInjection/isWithinRoot 防目录穿越）；test-http 30 + test-context 7 断言（190 总全绿）+ 旧项目扫描 0 blocker |
| **0.1.6** | **豁免总入口落地**：exemptForFinding 注册表驱动统一消费（7 标记全接入，blocked/lineLevel/hint 声明式）+ 位置语义（文件头前 3 行=整文件 / sensitive/func-length/residue 行内单点）+ residue/style 仅代码文件生效 + audit-rules-*.yml 规则定义文件自动豁免自举命中（修复 §2.5 记录的 6 个 debugger 假阳性）；test-exempt 25 断言（153 总全绿）+ v2 自审 0 blocker（98/100 A）+ 旧项目扫描 0 blocker |
| **0.1.5** | **评分总入口落地**：lib/score/ast.js 轻量 tokenizer（字符串/模板/注释感知）+ AST 质量检查器（checkSyncFs 修 named-import 假阴性、checkEmptyCatchAst 修多行空块、checkFuncLinesAst 精确行数）+ runChecks 接入（func-lines 行数+语句密度互补）+ scoreQuality weights 覆盖；test-quality 31 断言（128 总全绿）+ 旧项目扫描 0 blocker |
| **0.1.4** | **自身总入口落地**：VERSION 单一事实源 + versionInfo 机器校验（scripts/scan-version.mjs，三处一致）/ readmeTemplate（{{name}} {{version}} {{versionTable}} 占位符渲染）/ yamlTemplate（kind+dimensions 示范）/ helpSync（HELP↔parseArgv 机器比对，防 --depth 类回归）/ parseArgv --depth 缺值报错 / CLI 新增 yaml-template/readme-template/self-check 子命令；test-cli 18 断言（97 总全绿）+ 旧项目扫描 0 blocker |
| **0.1.3** | **git 总入口落地**：runGit（数组参数零注入）/ resolveToken（三层：显式→env→配置目录/项目 token，格式校验）/ commitAndPush（预检+敏感文件自动 .gitignore+add+commit+push）/ pushViaApi（Git Data API blob→tree→commit→ref，分支免疫，401→pushViaSsh 回退 ssh.github.com:443）/ cloneViaApi（trees+blobs 写文件转 git 仓）/ ensureRemoteRepo（建仓+设 origin，dryRun）/ setVisibility（PATCH）/ githubFetch（api.github.com 硬闸拒 302）+ parseGithubOwnerRepo + isBadCredentials；test-git 35 断言（79 总全绿）+ 旧项目扫描 0 blocker |
| **0.1.2** | **审计总入口落地**：collector（gitignore 感知 + collectChangedFiles 变动收集）/ checks 全部检查器（regex/path-regex/func-lines 含单行多语句识别/empty-catch）/ auditFile 豁免接线 / auditFull（非 git 可查）/ auditChanged 真 git diff（git status --porcelain，删除文件跳过）/ 统一问题对象 + exemptHint；44 测试全绿 + 旧项目扫描 0 blocker；修 §2.5 patterns→RegExp 卡点 |
| **0.1.1** | **规则总入口落地**：13 编译函数注册（credential-ref/file/secret/func-lines/6 数值/regex/path-regex/semantic）+ 三统一（kind kebab-case ↔ 函数 ↔ 字段）+ dimensions 声明（一字段多维度）+ 首个 yml 槽位 audit-rules-nodejs.yml（11 条规则示范）+ 未知规则报错不静默；31 测试全绿 |
| **0.1.0** | **功能框架搭建完毕能跑**：8 入口骨架（规则/审计/git/自身/评分/豁免/上下文）+ cli.mjs 最小可用（version/ruleset/scan/audit + --depth/--full 解析）+ scripts/check.mjs 全量语法检查 + test/test-framework.mjs 16 断言全绿；详细任务看板 docs/WORKBOARD-v2.md（每入口含思路与验收标准） |
| **0.0.0** | **README 文档（开发计划）**：10 总入口架构确定、统一问题对象确定、版本规范确定、15 条自检问题清单（五份报告已核对）、链接判断规则设计（flaky 域名扣分打折） |

## 注意事项

- **开发中不推送、不发布**；每次提交前用旧项目（`../dsh-git-push`）扫描自检
- **规则加载器铁律**：加字段 = 加函数 + 注册一行，`compileRule` 主体永不修改
- **命名格式统一**：一个功能一个根词，各层（函数/服务字段/工具/路由/yml 段）只做格式转换，对外 API 与函数名完全一致、无别名
- **审计默认关闭**：审计功能默认不开，由侧边栏设置开启（本项目自身开发中保持一致开启）
- **npm 发布完整性**：dependencies（js-yaml 等）显式声明，files 白名单含 cli.mjs，npm test 一条命令可复现