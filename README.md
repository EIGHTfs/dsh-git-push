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
- [设置项（侧边栏 / 插件配置）](#设置项侧边栏--插件配置)
- [独立 CLI（git-sluice）](#独立-cligit-sluice)
- [版本列表](#版本列表)
- [注意事项](#注意事项)

## 架构设计

**核心思想：统一函数入口 + 注册表扩展，加能力不破坏主入口。**

- **规则总入口（yml 管理）**：所有 yml 规则槽位（nodejs/npm/html/comment/dsh/private/structure/version/template 等）统一装载→解析→编译；**加字段=加函数，compileRule 主体永不修改**；每个字段函数自带 `dimensions` 维度绑定（支持一字段多维度）
- **审计总入口**：`auditChanged`（变动，git diff）/ `auditFull`（全量，非 git 目录可查）；`auditWithScope` 统一调度；设置项控制扫描范围（`auditScanScope`：diff/full）、强度（`auditLevel`：quick 跳 AST 语义重检查 / standard 全量 / deep 扩展位）、规则包目录（`auditRuleset`：空=内置，指向含 `audit-rules-<名>.yml` 的目录即整体替换）
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

## 设置项（侧边栏 / 插件配置）

设置项三处同源保持同步：`lib/index.js` 的 `Config`（服务端 schema）、`lib/client/index.js` 的 `SETTINGS_SCHEMA`（纯逻辑 + 单测）、`client.js` 的 `SCHEMA` + 中文文案（浏览器侧内联，无法 import 服务端 ESM）。新增设置项必须三处同加，一致性由 test-client.mjs 断言守着。

| 设置项 | 类型 | 默认 | 作用 |
|---|---|---|---|
| `auditEnabled` | boolean | false | 提交前自动审计门禁（关=只提交不审计） |
| `hardcodeFullScan` | boolean | false | 硬编码全量扫（换机前排查存量死路径） |
| `injectFullSkill` | boolean | false | 注入全部 skill 正文（默认只注目录+清单省 token） |
| `injectRepoIndexFull` | boolean | false | 注入 repo-index 全文（默认只注文件名） |
| `auditScanScope` | enum | diff | 扫描范围：diff=仅本次变动 / full=全量 |
| `auditLevel` | enum | standard | 审计强度：见下节三档语义 |
| `auditRuleset` | string | '' | 自定规则目录：空=内置规则包 |
| `weightOverrides` | string | '' | 权重覆盖 JSON：如 `{"安全性":100}`，空=默认权重表 |
| `commitMessage` | string | '' | 自动提交信息（留空则用调用方传入的 message） |

### 审计强度三档（auditLevel）

| 档位 | 检查范围 | 适用场景 |
|---|---|---|
| `quick` | 正则 / 凭据 / 路径 / 黑名单 / 空 catch / 同步 IO（**跳过 AST 与语义重检查**：函数行数、圈复杂度、嵌套深度、文件行数、重复串、语义规则、凭据文件、命名长度） | 大仓快速门禁、冒烟自检 |
| `standard` | 全量（默认，与 v1.0.3 行为一致） | 日常提交前审计 |
| `deep` | 当前与 standard 等效（全量）；为后续追加深度检查预留 | 需要最严格检查时 |

流程：配置或工具参数（`code_audit` 的 `auditLevel`）→ `code_audit` / `git_commit_push` 传入 `auditWithScope({ auditLevel })` → `auditFull` / `auditChanged` → `auditFile(..., { level })` → `runChecks({ grouped }, { level })` 按档位跳过重检查。基础安全项（凭据、路径穿越、空 catch）在任何档位都不降级。

### 自定规则包（auditRuleset）与动态槽位

规则槽位由目录文件驱动：目录里每个 `audit-rules-<名>.yml` 即一个槽位，放文件即生效、删文件即移除——「导入/导出/删除规则包」就是对该目录的文件操作，无需改代码。内置槽位 14 个（nodejs 36 / frontend 19 / npm 10 / version 8 / dsh 7 / comment 6 / folder 4 / i18n 3 / performance 2 / docs 1 / robustness 1 / structure 1 / template 1 / private 0 条私有拦截清单）。

流程：`auditRuleset` 指向目录 → `loadRuleFiles(order, { dir })` 从该目录装载（默认 `lib/audit-rules/`）→ 编译注册表认领字段 → 审计消费。指向不存在或空的目录会装载 0 条规则（`loaded.errors` 有记录），不会静默沿用内置规则包。

**槽位加载与合并语义**（细节全录见 `docs/DETAILS-EXEMPT-AND-RULES.md` §2）：

- **发现**：`discoverRuleSlots()` 扫目录取 `audit-rules-<名>.yml`，槽位集合以**目录实际文件**为准（常量表只是排序偏好，非槽位清单）
- **顺序**：配置显式顺序优先（数组 / 逗号串 / 环境变量 `DSH_GIT_PUSH_RULE_SLOTS`）→ 未覆盖的按 `SLOT_ORDER_HINT` 偏好排（nodejs→frontend→npm→version→dsh→comment→structure→private→docs→template）→ 仍未列出的按文件名字典序；配置声明但文件不存在静默跳过；`template` 槽位默认不加载
- **合并**：按顺序逐槽位装载，`rules` **后覆盖前**（同 id 后者胜）；`severity_map`/`thresholds` 对象合并；`metadata` 取第一个非空；`ignore` 追加；`private_files` 跨文件**追加**（private 槽位恒最后加载 → 清单累加不覆盖）
- **容错**：单槽位 yml 解析失败记入 `errors` 不中断，其余槽位照常加载；非法正则由 `safeRe` 收集错误返回 null，该规则跳过不抛异常
- **编译出口**：`ruleOut` 顶层只保留 `id/name/kind/severity/level/message/pattern/patterns/pathPattern/threshold/dimensions`，其余 yml 字段必须挂 `extra` 供检查器读取
- **severity 映射**：yml `error` → 引擎级 `blocker`（拦截）；`warning` → `warning`；`info` → `pass`
- **正则默认不区分大小写**：`safeRe` 默认加 `i`（`apiKey`/`API_KEY` 都命中）；要区分大小写写前缀 `(?-i)`

### 权重覆盖（weightOverrides）

评分默认 10 维度权重表（合计 100，见「架构设计」）。`weightOverrides` 传 JSON（如 `{"安全性":100}`）→ `scoreQuality(findings, weights)` 与默认表合并（未指定维度保持默认）→ 输出 `quality.dims`（0-10 原始维度得分）与总分随之变化。JSON 非法时回退默认权重，不中断审计。

**最终得分公式（用户 2026-09-11 权威）：`最终得分 = Σ(维度得分 × 权重) / Σ权重 × 10`**（满分 100；维度得分 = 10 - 该维度问题计数，warning 扣 1 / blocker 扣 2，下限 0）。侧边栏 10 维度滑块（min 0 / max 100 / step 1）逐维写回 weightOverrides JSON，改完即生效。

## 独立 CLI（git-sluice）

脱离 DSH 独立运行（零第三方依赖，仅需 Node ≥18 与本机 git）。`git-sluice self-check` 做版本一致性 + `HELP ↔ parseArgv` 机器比对（选项白名单必须与 HELP 文本一致）。

```
git-sluice version              查看版本
git-sluice ruleset [槽位...]    编译规则包并输出统计（默认全部槽位）
git-sluice scan <root> [--depth N]   全量扫描目录（非 git 目录可查）
git-sluice audit <root> [--full] [--level quick|standard|deep] [--ruleset <目录>] [--weights <JSON>]
                                审计目录（默认 diff 范围）
git-sluice commit <repo> -m <msg> [--push|--no-push] [--dry-run] [--force] [--req-confirm] [--json]
                                审计门禁 → 提交（默认只 commit 不 push；--push 推远端；--force 强推覆盖远端历史）
git-sluice link-check <路径>    检查 md/文本中的链接有效性（只 warning）
git-sluice yaml-template        输出规则 yml 模板（含 kind + dimensions 示范）
git-sluice readme-template      输出 README 模板（{{name}} {{version}} 占位符）
git-sluice self-check           版本一致性 + HELP↔parseArgv 机器比对
```

`audit` 参数与服务端设置项对应：`--full` ↔ `auditScanScope=full`、`--level` ↔ `auditLevel`（非法取值直接报错，不静默降级）、`--ruleset` ↔ `auditRuleset`（自定规则目录）、`--weights` ↔ `weightOverrides`（非法 JSON 回退默认权重表并提示）。

## 版本列表

| 版本 | 说明 |
|---|---|
| **1.0.7**（当前 · 硬编码魔数检测·版本号豁免版） | **魔数检测智能升级（整合进原有 audit-rules-nodejs.yml，kind=magic-number-smart）**：检测 `\b\d{2,}\b` / `\b0x[0-9a-fA-F]+\b` / `\b\d+\.\d+\b`，但**自动豁免**五类：① 版本号（v1.2.3 / 1.2.3 / VERSION 常量 / version 上下文）② 日期时间（2026-09-12 / 时间戳 / 时间 / year~time 上下文）③ HTTP 状态码（100-504 清单，http/status 上下文）④ 常见合法常量（0/1/-1/60/100/1000/1024/3600/86400/65535 等）⑤ 状态枚举（pending/completed 等字符串）；**上下文关键字分流**：magic_number_hints（timeout/retry/max/min/limit/size/count/port/interval/delay/duration/threshold/buffer/chunk，前缀匹配兼容 maxRetry/max_count 组合词）内数字报魔数，legitimate_hints（version/date/year/month/day/hour/minute/second/http/status）内数字豁免；**同一数字文件内出现 ≥3 次强制标记**（跨行合并 1 条，重复计数按 1 个算——scoring_impact 可维护性）；与既有 readability/magic-number（纯 regex 快速版）并存，纯 regex 无法豁免版本号/日期的痛点由 smart 版补齐；实测：`timeout=30000`/`limit=100` 命中、`VERSION="1.2.3"`/`status===404`/`KB=1024` 豁免、`777×3` 合并 1 条 ｜ test-magic-number.mjs 5 例 + auditFull 集成实测 |
| **1.0.6**（规则机制 .test 豁免 + 按钮绑定交叉比对） | **规则引擎两项机制升级**：① **.test 空文件豁免**（整目录扫描跳过）：目录放 0 字节 `.test` 空文件 → 审计（collectTextFiles）与敏感扫描（scanSensitiveFiles）**双通道整目录跳过**（含子目录），比 .samples「照常出结果不拦截」更强——.samples 出结果只不拦截，.test 完全跳过；防逃逸（非空 .test 文件不豁免）；② **button-bind 交叉比对 kind**（按钮事件归属）：同文件交叉比对 HTML 按钮（innerHTML/outerHTML/insertAdjacentHTML 赋值 chunk + 模板字符串 chunk + createElement('button'/'input')）与 JS 绑定证据（addEventListener/onclick/onChange 赋值 + jQuery `$("#id")`/`$(".cls")` + `querySelectorAll("button[data-x]")` 属性选择器 + `.closest()` 事件委托）——识别出绑定即不报，识别出事件委托（addEventListener('click') 或 .closest()）整文件豁免；油猴脚本（HTML 在 JS 字符串、事件 addEventListener/委托绑定）不再误报「按钮无事件」；扩展场景（popup.html 按钮在 popup.js 绑定）forms/button-missing-event 降级 info；③ **7 条 button/* 规则**：inline-binding-in-string（JS 字符串内联绑定，负向后瞻排除 `.on(` 方法链）/ unbound（无绑定）/ create-element-binding（createElement 绑定）/ event-delegation-detected（事件委托）/ dynamic-selector（querySelector+拼接等动态选择器）/ wrapped-binding / csp-compatible（CSP 兼容 info）｜实测 gamebanana-mods-downloader：unbound=0 误报 0、button/* 8 条 info 均不阻断 |
| **1.0.5**（侧边栏账号卡） | **侧边栏账号/SSH 能力补齐（对齐 v1 账号区）+ Origin 同源放行 + 评分公式定稿**：① **侧边栏账号卡**（client.js）：`AccountCheckCard`（填 GitHub Token / SSH 公钥 → POST `/api/git-push/account-check` 在线校验账号状态）+ `AccountKeyGenCard`（填邮箱 → POST `/api/git-push/gen-ssh-key` 生成 ssh-rsa 4096 密钥对，公钥整行回显 + 一键复制；私钥只落本机插件配置目录）；React 状态本地化（token/公钥仅浏览器内存，关闭即消失，不进配置）；两组件均 ≤50 行防 func-lines；② **Origin 同源放行（D35 升级）**：checkOrigin 新增第 4 参 `host`——写请求 Origin 主机 ≡ 请求 Host 头即同源放行（局域网 GUI 10.10.10.4 下侧边栏按钮 POST 不再 403），跨站 Origin 仍拒、本机回环白名单兜底，CSRF 防护语义不削弱；③ **评分公式定稿（用户权威公式）**：`最终得分 = Σ(维度得分×权重)/Σ权重×10`，`quality.dims` 存 0-10 原始维度得分，侧边栏 10 维度滑块逐维写回 weightOverrides JSON（修复 saveDimWeights 未传 props 的接线 bug，滑块此前改值不生效）；④ **账号/SSH 工具与端点（D34 补齐）**：工具 `git_account_check` / `git_gen_ssh_key` + HTTP 端点 `/api/git-push/account-check`、`/api/git-push/gen-ssh-key`（maskToken/readSshPub/persistSshPub/checkGithubAccount/generateSshKey/formatGithubAccountBlock 迁入 lib/git/index.js）+ test-account-ssh.mjs 13 例 + test-http.mjs Origin 同源 4 例；⑤ **敏感扫描修复（2026-09-12）**：只认真实硬编码凭据——`account: '账号检查'` 等 UI 文案键名不再误判（username 键组移除 account + 值含中文即排除，实测 client.js 由误判 → 0 命中）；扫描到敏感文件**只报告不改动 .gitignore/不解除跟踪**（基线 node_modules 与自定义忽略照常写）｜394 全绿 |
| **1.0.4**（规则引擎加固 + 侧边栏配置面） | **规则引擎 + 配置面双线**：① **regex 子模式**：patterns 支持对象子模式 `{id, pattern, message}`，命中输出 per-pattern 专属 message；② **performance 槽位**（新）：memory-bomb 7 子模式（全量读入/循环内 push/链式 push/数组展开/无限循环/execSync/大对象序列化）+ busy-wait，push 宽正则 91 假阳性 → 精确子模式降噪；③ **同形字符防再犯（G3）**：lib/rule/homoglyph.js 西里尔/希腊→ASCII 映射表（28 项）+ compileRule 入口拦截 kind/id 同形（с→c/д→d），静默失效 → 显式报错；④ **规则字段全认领（G6）**：旧项目 29 字段逐一核对，scoring→threshold 兜底 / action / suggestions / examples / minLines 走 extra 透传，blacklist 阈值 40→60 真实生效；⑤ **private 槽位**（T1-T33 考古验收）：loader 合并顶层 private_files 13 条 + lib/audit/glob.js（**/*/{a,b} 零依赖 glob→RegExp）+ checkPrivateFiles（git ls-files 全量 × 分级 public→blocker / private→warning），auditFull/auditChanged 双路径接线；⑥ **侧边栏三项（G7）**：审计强度 quick/standard/deep（quick 跳 AST/语义重检查）+ 自定规则目录 auditRuleset（放 yml 即整体替换规则包）+ 权重覆盖 weightOverrides（JSON），三处同步（Config / SETTINGS_SCHEMA / client.js 内联）；⑦ i18n 降噪新增 dsh-skip-i18n 豁免标记；⑧ dual-scan 补旧项目 full-scan 通道；⑨ **真实接线修复（装后实测）**：apply 四段注册 API 全错且静默失效（工具用 `ctx.tools.define`、注入 callback 返回对象而非调 `section()`、HTTP 用 `ctx.http.route`、虚构 `ctx.inject(['slots'])`）→ 全部改为真实 API（`ctx.inject(['tools'])`→`get('tools').register(defineTool(...))` / `systemPrompt.section({name,order,text})` / `webServer.register({kind:'prefix'})`），新增独立接线层 `lib/plugin/index.js` 并以 mock ctx 单测断言「真 API 被调用」；⑩ **git_gen_readme 迁移**（工具 7→8）：`lib/readme-gen/index.js`（模板优先级 template/README.md > readme.yml > 内置兜底；版本表 git log 版本号聚合，补丁并入主版本）+ `lib/readme-templates/readme.yml`；⑪ **.samples 目录豁免**：目录放 0 字节 `.samples` 空文件 → 整目录照常出审计/敏感扫描结果但不构成提交推送拦截（blocker 不算门禁、敏感文件不写 .gitignore）；⑫ **CLI commit 子命令 + force 强推**（对齐 v1 CLI）：`git-sluice commit <repo> -m <msg>`（复用 commitWithAudit，审计独立调用；--push/--no-push/--dry-run/--force/--req-confirm/--json），工具 git_commit_push 与 pushViaSsh 同步支持 force（覆盖远端历史）｜373 全绿 | **regex 子模式 + performance 槽位**：① patterns 支持对象子模式 `{id, pattern, message}`（文档 §13 承诺兑现），命中输出 per-pattern 专属 message；② 新槽位 performance：memory-bomb（7 子模式：全量读入/循环内 push/链式 push/数组展开/无限循环/execSync/大对象序列化）+ busy-wait；③ push 误报降噪：`\.push` 宽正则（91 假阳性）→ 循环内 push + 链式 push 精确子模式；④ test/ 自动豁免补 performance（测试 fixture 含危险模式样本做断言）｜323 全绿 |
| **1.0.3**（规则包对齐） | **旧项目规则包全量复制 + 3 新槽位 + 同名函数扩展**：① 复制旧项目 9 槽位 86 条规则（nodejs/frontend/npm/version/dsh/comment/structure/private/template），v2 规则从 12 条 → 96 条；② 新槽位 **robustness**（mkdir-before-write 写文件目录保障）、**folder**（文件夹数量审计 4 条：目录总数/单目录文件数/解包特征/.gitignore 覆盖，目录级检查器挂 auditFull）、**i18n**（国际化审计 3 条：硬编码文案 t() 包裹/插值/语言包分文件）；③ 新 kind 按「同名函数 + 注册一行」铁律：**blacklist**（comment 槽位黑名单加分制，24 黑名单+22 白名单+6 附加特征）+ **folder** + **npm-json**（两条旧「命中即提示」死规则改为 JSON 结构化真判定）+ **npm-json**（files 含 lib / js-yaml 已声明依赖即不报）；④ 修复测试暴露的真缺陷：`dsh-skip-sensitive` 对 regex 宽声明的安全类规则豁免失效（17 条假阳性）、func-lines/max-lines 识别中文「函数」名（旧项目 34 条规则误归类）、detectionMethod 顶层展开读取（test-file/locale-file 三处 `rule.extra?` 失效）；⑤ 保留 v2 独有能力（secret-aws-access-key 等合并回 nodejs 槽位防覆盖丢失）；⑥ skill 文档措辞中性化（去除文档中的对话措辞残留，符合 comment 审计规则）+ 新增 docs/DETAILS-EXEMPT-AND-RULES.md 细节权威；⑦ 测试 315→320 断言全绿（含 5 个新 kind 编译断言）｜双扫描 0 blocker（旧项目扫描 v2 区 0 blocker） |
| **1.0.2**（修 bug） | **测试按入口重组 + 审计健壮性加固**：① 测试一脚本对一入口（test-framework 溶解归位：注册表/装载→规则、评分→评分、豁免→豁免、CLI/同步/打包→自身，test-cli 更名 test-self）；② **G9 匹配器空值崩溃**（`checkRegexRules`/`checkPathRegexRules` 收 `rules=undefined` 抛 `rules is not iterable`）→ `rules \|\| []`；③ **G10 重复串死检测**（tokenizer 产出 `str`/`tmpl`，检查器却过滤 `string`/`number` → 永不命中）→ 按实际类型名收集 + `tmpl` 入列 + 去引号；④ **G11 重复串泛滥**（修复后自审 343 条，多为文档数字/域名词汇）→ 排除 `num`/纯标识符/dotfile/短期望词 + 文档/测试目录豁免 maintainability 检查；⑤ **G12 `node_modules.orig` 入 .gitignore**：`ensureGitignore` 基线忽略 `node_modules/`+`node_modules.orig/`，扫描器跳过该目录（用户定稿）；⑥ 提取 `HINT_QUALITY`/`MSG_REPO_REQUIRED` 常量消除重复字面量；⑦ 审计入口测试 13→33 断言（315 总全绿） |
| **1.0.1**（修 bug） | **六个真实缺陷修复**：① `summarize` 漏统 error 级（出现「0 blocker 0 warning 但 total=3」矛盾统计）→ error 归拦截级 + notice 单列；② **9 个 kind 死桶**（编译后无人消费，旧项目被批评的同一问题）→ 补 `checkNameLengthAst`/`checkComplexityAst`/`checkNestingDepthAst`/`checkFileLines`/`checkRepeatedStringsAst` 5 个 AST 检查器 + `credential-file`/`min-length`/`max-complexity`/`max-depth`/`max-lines`/`repeated-string`/`min-occurrences`/`semantic` 全接线；③ `[FUNC]-` 规则被 `regex` 抢走（detect 前缀 `/^[FUNC]-/` 是字符集非字面量）→ `/^(\[FUNC\]\|secret)-/`；④ **豁免完全失效**——`checks`/`exempt` 读的键名与编译产出 kind 不一致（`secret` vs `[FUNC]`），全仓统一；⑤ 槽位仍半硬编码（`RULE_SLOTS` 当默认基准）→ 纯动态发现 + `SLOT_ORDER_HINT` 仅排序偏好，放 yml 即生效；⑥ 同步漏真实加载源（只同步 `node_modules/`）→ `detectTargets` 双目标（`local-plugins/` 优先 + `node_modules/`），修旧项目「改动刷新看不到」根因；另加 `capSeverity` 规则 severity 上限约束（规则声明 warning 不得被检查器升为 blocker）｜278 断言全绿 |
| **1.0.0**（首发） | **DSH 插件接线完成**：lib/index.js（apply + 7 工具注册 + HTTP 鉴权分发 + Config schema）+ client.js（DSH 客户端插件，手写 createElement/零外部资源/开关默认关）+ scripts/sync-plugin.mjs（双副本同步，默认 dry-run）+ cordis.patch.yml + scanRepos；test-plugin 25 + test-client 21 断言（263 总全绿） |
| **0.2.0** | **链接判断落地**：lib/link-check/index.js（extractLinks 去重去占位符 / gradeResult 分级：404·403→-3、DNS→-2、超时·5xx→-1 / flaky 域名网络错误 ×0.2 / probeLinks 并发受限 / checkLinks 统一问题对象，**只 warning 永不 blocker**）+ audit-rules-docs.yml 槽位（link-check kind）+ CLI `link-check <路径>`；test-link-check 24 断言（233 总全绿） |
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