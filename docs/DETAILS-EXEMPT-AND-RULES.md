# 细节补充：豁免注释与规则 yml 用法全录（dsh-git-push v2）

> 本文是 **WORKBOARD-v2.md 的细节补充**，专记「使用者/接手 AI 写代码时最常问的两件事」：
> ① 想让某处代码不报警告，豁免注释怎么写、写哪；
> ② 想加一条审计规则，yml 文件怎么写、字段怎么用、会被哪个编译函数认领。
> 与代码零漂移原则：本文件内容以 `lib/exempt/index.js`、`lib/rule/compilers.js`、`lib/audit-rules/*.yml` 为准，改动代码后同步本文。

---

## 一、豁免注释体系（dsh-skip-*）

### 1.1 两种位置语义

| 位置 | 写法 | 作用域 |
|---|---|---|
| **文件头** | 文件前 **3 行内**任意一行含标记（注释里） | 整文件豁免 |
| **行内单点** | 某一行行尾注释含标记（仅 `lineLevel: true` 的标记支持） | 仅该行豁免 |

```js
// 文件头豁免示例（整文件免敏感扫描）：
// dsh-skip-sensitive: fixture 不含真实凭据
const oauth = "token-would-be-here";        // ← secret 类不再报

// 行内单点豁免示例（仅本行免敏感扫描）：
const akia = "AKIA1234567890ABCDEF";        // dsh-skip-sensitive
```

### 1.2 7 个标记总表（lib/exempt/index.js EXEMPT_MARKERS）

| 标记 | 豁免的 kind/rule | 支持行内 | 维度 |
|---|---|---|---|
| `dsh-skip-sensitive` | credential-file / credential-ref / `[FUNC]`(secret) / path-regex（含私钥路径类） | ✅ 行尾 | 安全性 |
| `dsh-skip-size` | binary / large-file | ❌ 只能文件头 | 可部署性 |
| `dsh-skip-func-length` | func-lines | ✅ 函数定义行行尾 | 可读性+可维护性 |
| `dsh-skip-syntax` | syntax / json-parse / yaml-parse | ❌ 只能文件头 | 健壮性 |
| `dsh-skip-quality` | func-lines / empty-catch / sync-fs | ❌ 只能文件头 | 可读+可维护+健壮+性能 |
| `dsh-skip-residue` | regex 中的 debugger / todo / console 残留 | ✅ 行尾 | 可读性+可维护性 |
| `dsh-skip-style` | regex 中的 style 数值风格规则（min-length / max-lines / max-complexity / max-depth / min-occurrences / repeated-string） | ❌ 只能文件头 | 可读性 |

**判断逻辑**（`exemptForFinding`）：
1. 先查**文件类别豁免**（见 1.3）——命中直接豁免；
2. 取 finding 的 `kind`，比对每个标记的 `blocked[]`；
3. residue/style 是宽声明（blocked 只写 `regex`），实际还要按 `rule` 名细分（含 `debugger|todo|console` / `style-*`）；
4. 文件头命中（前 3 行含标记）→ 整文件豁免；lineLevel 标记且本行含标记 → 单点豁免。

### 1.3 文件类别豁免（CATEGORY_EXEMPT，自动生效）

| 类别 | 路径匹配 | 自动豁免的 rule |
|---|---|---|
| 测试文件 | `(^|\/)test\/` | residue / console-log / sync-fs / empty-catch |
| 脚本/CLI | `(^|\/)(scripts\/|cli\.mjs$)` | residue / console-log / sync-fs |

> 语义：这些类别里「看起来像问题」的写法是刻意的（测试用同步 fs 便于断点、CLI stdout 输出是产品行为）。
> **敏感信息 / 语法 / 大文件等硬问题不豁免**。

### 1.4 规则定义文件自动豁免（0.1.6 起）

`lib/audit-rules/*.yml` 规则定义文件本身会被正则类规则命中（比如规则描述里写 `debugger` 关键词）——
audit 消费时对 `audit-rules-*.yml` 路径跳过 residue 类豁免（规则定义元数据不是真实残留）。

### 1.5 怎么知道某问题该用哪个标记

每个 finding 自带 `exemptHint`（构造时写入），直接照做即可；也可用 `exemptHintFor(ruleOrKind)` 反查。

---

## 二、规则 yml 写法全录

### 2.1 槽位（slot）→ 文件

| 槽位 | 文件 | 规则数（2026-09-10 工作区实测） |
|---|---|---|
| nodejs | `lib/audit-rules/audit-rules-nodejs.yml` | 34 |
| frontend | `lib/audit-rules/audit-rules-frontend.yml` | 19 |
| npm | `lib/audit-rules/audit-rules-npm.yml` | 10 |
| version | `lib/audit-rules/audit-rules-version.yml` | 8 |
| dsh | `lib/audit-rules/audit-rules-dsh.yml` | 7 |
| comment | `lib/audit-rules/audit-rules-comment.yml` | 6 |
| folder | `lib/audit-rules/audit-rules-folder.yml` | 4 |
| docs | `lib/audit-rules/audit-rules-docs.yml` | 1 |
| robustness | `lib/audit-rules/audit-rules-robustness.yml` | 1 |
| structure | `lib/audit-rules/audit-rules-structure.yml` | 1 |
| template | `lib/audit-rules/audit-rules-template.yml` | 1（模板，默认不加载） |
| private | `lib/audit-rules/audit-rules-private.yml` | 0（私有拦截清单槽位） |

> 槽位顺序 / 加载 / 合并见 `lib/rule/loader.js`（RULE_SLOTS，后覆盖前）；
> 新增槽位 = 新建 `audit-rules-<名>.yml`，`discoverRuleSlots` 自动发现，**不需要改代码**。

### 2.2 文件骨架

```yaml
metadata:
  name: "槽位名"
  version: "1.0.0"
  language: "javascript"          # 适用语言/场景

rules:
  - id: readability/xxx           # 规则唯一 id（段/名）
    name: "规则名"                 # 人类可读
    category: "readability"        # 分类段
    severity: "warning"           # error=拦截 / warning=警告 / info=提示
    description: "规则说明"        # 同时是 finding 的 message
    pattern: "正则"                # ① 正则类字段
    # 或数值类字段：
    min_length: 2                  # ② 数值类字段（见 2.4）
    exceptions: ["i", "j"]         # 可选：豁免名单
    fixable: false
    mitigation: "怎么改建议"       # 可选：修复建议

severity_map:
  error: "error"
  warning: "warning"
  info: "info"

thresholds:
  max_warnings: 20
  max_errors: 0
  max_info: 50

ignore:                           # 文件级豁免
  - pattern: "**/*.{test,spec}.{js,ts}"
    rules: ["*"]

output:
  format: "json"
```

### 2.3 字段 → 编译函数认领表（lib/rule/compilers.js 全部注册）

> 一个规则**不用写 kind**——按字段自动探测（也可显式 `kind:` 抢跑）。
> 认领顺序：显式 kind → 注册表顺序（凭据→函数→数值→正则→链接→语义→黑名单→目录）。

| 编译 kind | 认领条件（detect 探测字段 / id） | 编译产物关键字段 | 维度 |
|---|---|---|---|
| `credential-ref` | id 前缀 `credref-` | pattern / patterns（RegExp） | 安全性 |
| `credential-file` | id 前缀 `credfile-` | pathPattern | 安全性 |
| `[FUNC]`（secret） | id 前缀 `[FUNC]-` 或 `secret-` | pattern / patterns（RegExp） | 安全性 |
| `func-lines` | id==='func-lines' 或 (max_lines + 名含 function) | threshold + blockThreshold | 可读+可维护 |
| `min-length` | `min_length` 存在 | threshold | 可读性 |
| `max-lines` | `max_lines` 存在且名不含 function | threshold | 可读+可维护 |
| `max-complexity` | `max_complexity` 存在 | threshold | 可维护 |
| `max-depth` | `max_depth` 存在 | threshold | 可维护 |
| `min-occurrences` | `min_occurrences` 存在且无 ignore 字段 | threshold | 可维护 |
| `repeated-string` | `min_occurrences` + ignore_patterns/ignore_values | threshold + ignorePatterns + ignoreValues | 可维护+可读 |
| `regex` | `pattern`/`patterns` 字符串 | pattern / patterns + exts（可选限定扩展名） | 可读性 |
| `path-regex` | `kind==='path-regex'` 或 `path_pattern`（非 credfile） | pathPattern | 可读+可维护 |
| `link-check` | `kind==='link-check'` 或 (flaky_hosts + status_dead) | statusDead/statusTransient/flakyHosts/score*/timeoutMs/concurrency/maxLinks | 文档+可维护 |
| `semantic` | detection_method / category security|accessibility / 名含测试等关键词 / id 含 testing|dependency | detectionMethod | 健壮性 |
| `blacklist` | `blacklist` 数组非空 | blacklist[]（{pattern,weight}）+ whitelist[] | 文档 |
| `folder` | category==='folder' 或 (threshold + exclude_dirs/signatures/required_patterns) | threshold + excludeDirs + signatures + requiredPatterns | 可维护+可部署 |

### 2.4 正则类 vs 数值类：加一条规则的两种写法

**正则类（最简单，一行字段）**：
```yaml
- id: readability/console-no-log
  name: "禁止 console.log 进生产"
  category: "readability"
  severity: "warning"
  description: "生产代码不应残留 console.log"
  pattern: "console\\.(log|debug|warn)\\("
  fixable: true
```

**数值类**：
```yaml
- id: readability/max-function-length
  name: "函数长度不超过 50 行"
  category: "readability"
  severity: "warning"
  description: "过长的函数难以理解和维护"
  max_lines: 50
  exceptions: ["i", "j", "k", "n", "e", "cb"]   # 数值规则共享
  fixable: true
```

### 2.5 链接判断规则（link-check，0.2.0 起）

```yaml
- id: docs/link-health
  name: "文档链接有效性"
  category: "docs"
  severity: "warning"
  kind: "link-check"                  # 建议显式写 kind
  status_dead: [404, 403]             # 死链状态码 → score_dead 大扣分
  status_transient: [500, 502, 503]   # 临时态 → score_transient 小扣分
  flaky_hosts: ["github.com", "api.github.com", "raw.githubusercontent.com", "npmjs.com"]
  flaky_factor: 0.2                   # flaky 域名网络错误扣分打折
  score_dead: 3
  score_dns: 2
  score_transient: 1
  timeouts_ms: 8000
  concurrency: 8
  max_links: 100
```
> 分级：404/403=死链 -3（不打折）；DNS 失败 -2（flaky×0.2）；超时 -1（×0.2）；
> 只 warning 不 blocker；断网整体扣分很少（防假阳性）。

---

## 三、写代码时的高频坑（写规则 yml / 豁免注释前必读）

| # | 坑 | 说明 | 正解 |
|---|---|---|---|
| 1 | yml 正则单反斜杠 | `"\\.pem"` 写成 `\.pem` → js-yaml 解析报 unknown escape | yml 里正则反斜杠写 `\\.` |
| 2 | 规则 id 用斜杠风格 | detect 前缀匹配的是 dash 风格（`secret-`/`credfile-`） | id 用 dash 风格（`secret-aws-key`）而非 `secret/aws` |
| 3 | pattern 存的是字符串 | checks 层 `p.test(line)` 需要 RegExp | 编译函数必须传编译后 RegExp（registry 已保证） |
| 4 | 零豁免但报敏感 | 想豁免的 kind 没在标记 blocked 里 | 查 1.2 总表；敏感类只有 dsh-skip-sensitive |
| 5 | 行内豁免不生效 | 标记 `lineLevel: false`（size/syntax/quality/style） | 换文件头写法 |
| 6 | func-lines 豁免整文件 | 只想豁免单函数却写了文件头 | 函数定义行行尾 `dsh-skip-func-length` |
| 7 | 规则定义文件自举命中 | yml 描述里写 debugger/todo 关键词 → 被 residue 命中 | 规则定义文件已自动豁免（0.1.6） |

---

## 四、快速自查命令

```bash
# 看某个槽位编译出哪些 kind（验证新增规则被正确认领）
node cli.mjs ruleset nodejs

# 全量语法检查（写 yml/code 后跑，10/10 通过才算过）
npm run check

# 全量测试（写规则/豁免后必须 315+ 全绿）
npm test

# 自审本仓（0 blocker 才提交；version/major-zero 属本项目版本口径豁免项）
cd ../dsh-git-push && node cli.mjs audit ../dsh-git-push-v2 --json
```

---

## 五、git token 三层探测（lib/git/index.js resolveToken）

调用链上所有 GitHub 身份（push / clone / 建仓 / 可见性）都先过 `resolveToken()`，
**依次取首个可读**（`{ token, source }` 返回，只回传来源标识，不回透明文）：

| 序 | 来源 | 判定 |
|---|---|---|
| 1 | `opts.token` 显式传入 | 非空 trim 即用，source=`explicit` |
| 2 | 环境变量 `DSH_GIT_PUSH_TOKEN` → `GITHUB_TOKEN` | 非空即用，source=`env:xxx` |
| 3 | 配置目录 `github-token` / `token` → `tokenPath` → 项目 `.git-push-token`（配置目录 = `$DSH_HOME/git-push` → `$HOME/.dsh/git-push` → `cwd/.dsh/git-push`） | 读取 + 前缀校验 `gh[pous]_`/`github_pat_` |

配套：`resolveSshKey()` 同目录找 `id_rsa`/`id_ed25519`/`id_ecdsa`（401 回退 pushViaSsh 用）。
**earliest 规则**：找不到 token 时返回 `{ token:'', source:'' }`，上层决定报错或走 SSH 兜底。

## 六、评分：10 维度权重 + 公式（lib/score/index.js）

| 维度 | 权重 | 维度 | 权重 |
|---|---|---|---|
| 可读性 | 15 | 可维护性 | 15 |
| 健壮性 | 15 | 安全性 | **18**（最高） |
| 性能 | 10 | 测试覆盖 | 10 |
| 可观测性 | 5 | 可部署性 | 5 |
| 文档 | 4 | 开发者体验 | 3 |

- 求和恒为 **100**；`countByDimension` 分维度计数（**blocker 计 2**，warning 计 1）
- 公式：`score = round(dimSum / (10 × totalWeight) × 100)`
- 等级：A ≥ 85 / B ≥ 70 / C ≥ 55 / D 以下

## 七、CLI 子命令全表（cli.mjs main 分发）

| 子命令 | 别名 | 作用 |
|---|---|---|
| `version` | `-v` / `--version` | 版本（三处一致校验） |
| `ruleset [槽位]` | — | 编译统计（验证新增规则被正确认领） |
| `scan [root] [--depth]` | — | 全量文件扫描 |
| `audit [root] [--full] [--json]` | — | 审计 + 评分（默认仅 git 变动手） |
| `link-check [root]` | — | 链接有效性探测（0.2.0，并发+flaky 打折） |
| `yaml-template` | — | 输出规则槽位 yml 模板 |
| `readme-template` | — | 输出 README 模板 |
| `self-check` | — | 自检（help 与 parseArgv 机器比对防 --depth 回归） |
| `help` / 无参 | -h / --help | 帮助 |

**parseArgv 白名单**：只认 `--depth` / `--full`，未知参数直接报错（防静默吞参）。

## 八、HTTP 总入口安全规则（lib/http/index.js）

| 规则 | 触发 | 返回 |
|---|---|---|
| Origin 校验 | 写请求（POST/PUT/PATCH/DELETE）**无 Origin** | 403 `NO_ORIGIN`（防 CSRF） |
| 跨源 | Origin 不在允许列表 | 403 `CROSS_ORIGIN` |
| 写确认 | 破坏性操作（rebuild/rollback）body 缺 `confirm:true` | 400 `NEED_CONFIRM` |
| 体长 | 请求体超 **5MB** | 413 `TOO_LARGE`（防恶意大 body 打爆内存） |
| 非法长度 | content-length 非法 | 400 `BAD_LENGTH` |

统一入口 `authPipeline({method, origin, contentLength, isWriteConfirmOp})` → 通过后进 `routeRequest`。
> 设计动机：HTTP 端点=插件对外审计门禁，写操作必须三件套（同源 + 确认 + 有界 body）。

## 九、侧边栏/开关默认值（lib/client/index.js）

| 键 | 默认 | 语义 |
|---|---|---|
| `auditEnabled` | **false** | 审计开关默认关（本机一致开由用户显式打开） |
| `pushPermitEnabled` | **false** | AI 回复推送许可默认关（回复含「任务完成」才触发） |

> 侧边栏零外部资源、无 JSX（手写 createElement）、配置即时生效、无 viewer。