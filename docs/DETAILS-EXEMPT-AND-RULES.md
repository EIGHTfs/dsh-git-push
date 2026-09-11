# 细节补充：豁免注释与规则 yml 用法全录（dsh-git-push v2）

<!-- dsh-skip-i18n: 本文含规则 yml 示范文案（description/message 示例），非真实用户界面文案 -->

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

| 槽位 | 文件 | 规则数（2026-09-11 工作区实测） |
|---|---|---|
| nodejs | `lib/audit-rules/audit-rules-nodejs.yml` | 36 |
| frontend | `lib/audit-rules/audit-rules-frontend.yml` | 19 |
| npm | `lib/audit-rules/audit-rules-npm.yml` | 10 |
| version | `lib/audit-rules/audit-rules-version.yml` | 8 |
| dsh | `lib/audit-rules/audit-rules-dsh.yml` | 7 |
| comment | `lib/audit-rules/audit-rules-comment.yml` | 6 |
| i18n | `lib/audit-rules/audit-rules-i18n.yml` | 3 |
| folder | `lib/audit-rules/audit-rules-folder.yml` | 4 |
| performance | `lib/audit-rules/audit-rules-performance.yml` | 2（memory-bomb 7 子模式 + busy-wait） |
| docs | `lib/audit-rules/audit-rules-docs.yml` | 1 |
| robustness | `lib/audit-rules/audit-rules-robustness.yml` | 1 |
| structure | `lib/audit-rules/audit-rules-structure.yml` | 1 |
| template | `lib/audit-rules/audit-rules-template.yml` | 1（模板，默认不加载） |
| private | `lib/audit-rules/audit-rules-private.yml` | 0（私有拦截清单槽位） |

> 槽位全动态：**新建 `audit-rules-<名>.yml` 即自动成为槽位**（`discoverRuleSlots` 扫目录），删文件即移除，不需要改代码。
> 加载/合并/排序细节见 2.6「槽位加载与合并语义」。

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
> 认领顺序：显式 kind → 注册表顺序（凭据→函数→数值→正则→链接→语义→黑名单→目录→npm 结构化）。

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
| `regex` | `pattern`/`patterns` 字符串 **或对象子模式 `{id,pattern,message}`** | pattern / patterns + subPatterns[]（{regex,message}）+ exts | 可读性 |
| `path-regex` | `kind==='path-regex'` 或 `path_pattern`（非 credfile） | pathPattern | 可读+可维护 |
| `link-check` | `kind==='link-check'` 或 (flaky_hosts + status_dead) | statusDead/statusTransient/flakyHosts/score*/timeoutMs/concurrency/maxLinks | 文档+可维护 |
| `semantic` | detection_method / category security|accessibility / 名含测试等关键词 / id 含 testing|dependency | detectionMethod | 健壮性 |
| `blacklist` | `blacklist` 数组非空 | blacklist[]（{pattern,weight}）+ whitelist[] | 文档 |
| `folder` | category==='folder' 或 (threshold + exclude_dirs/signatures/required_patterns) | threshold + excludeDirs + signatures + requiredPatterns | 可维护+可部署 |
| `npm-json` | 显式 kind==='npm-json'（package.json 结构化判定） | detectionMethod / 结构化条件 | 可部署性 |
| `i18n` | 槽位 i18n 规则（pattern→regex / detection_method→semantic） | hardcoded-user-visible / concat-in-t / locale-file-missing | 文档+可维护 |

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

> **正则大小写语义（1.0.0 起）**：默认加 `i` 标志（不区分大小写）——规则本意是匹配「凭据/关键词写法」，`apiKey`/`API_KEY` 等驼峰与大写写法都要命中。
> 需要显式区分大小写：pattern 前缀 `(?-i)`（关掉 i）；同义 `(?i)` 可写可不写（本来就默认 i）。

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

> **min_occurrences 分流**：带 `ignore_patterns`/`ignore_values` → 编译为 `repeated-string`（重复硬编码串，忽略清单内不报）；
> 不带 ignore 字段 → 编译为 `min-occurrences`（简单次数阈值）。同一字段按有无 ignore 自动分流。

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

### 2.6 槽位加载与合并语义（lib/rule/loader.js 全部细节）

**发现（discoverRuleSlots）**：扫 `RULE_YAML_DIR`（=`lib/audit-rules`），凡匹配 `audit-rules-<名>.yml` 即一个槽位，返回 `<名>` 列表。放文件即生效、删文件即移除，**不改代码**。

**顺序（resolveSlotOrder）**：
1. 槽位集合 = `discoverRuleSlots()` 目录实际文件（不是常量表）
2. 顺序 = 配置显式顺序优先（数组或逗号分隔字符串，可经环境变量 `DSH_GIT_PUSH_RULE_SLOTS` 注入）
3. 配置未覆盖的，按 `SLOT_ORDER_HINT` 偏好排序（nodejs→frontend→npm→version→dsh→comment→structure→private→docs→template），未列出的按文件名字典序追加
4. 配置声明但文件不存在的槽位 → **静默跳过**（不报缺失，方便先写配置后放文件）
5. `template` 槽位默认不加载（`includeTemplate:false`），模板保持为空不进默认装载

**合并（loadRuleFiles）**：按顺序逐槽位读取，`rules` 数组**后覆盖前**（同名 id 后者胜）；
`severity_map`/`thresholds` 对象合并；`metadata` 只取第一个非空槽位的；`ignore` 数组追加；
`private_files`（私密拦截清单）**跨文件追加**——private 槽位永远最后加载，天然保证清单累加不覆盖。

**错误收集**：单个槽位 yml 解析失败 → 记入 `errors` 不中断（`ok=false` 当 errors 非空），其余槽位照常加载。

**编译出口形状（ruleOut 白名单）**：编译产物顶层只保留
`id/name/kind/severity/level/message/pattern/patterns/pathPattern/threshold/dimensions`，
**其余 yml 字段必须走 `extra`**（G6 认领：scoring→threshold 兜底 / action / suggestions / examples / minLines 透传等）。
规则里想带自定义字段给检查器 → 在编译函数里挂到 `extra`，检查器从 `rule.extra.xxx` 读。

**severity 映射（severityLevel）**：yml 写 `error` → 引擎级 `blocker`（拦截）；`warning` → `warning`；`info` → `pass`。
**非法正则不炸**：`safeRe` 编译失败记入 errors 返回 null，该规则跳过，全流程不抛异常。

**SLOT_ORDER_HINT vs RULE_SLOTS**：`RULE_SLOTS` 是 deprecated 兼容别名（=排序偏好），**槽位集合永远以 `discoverRuleSlots()` 为准**。

### 2.7 注释措辞黑名单（comment 槽位 → blacklist 编译，1.0.3）

comment 槽位的总纲规则用**加分制黑名单**（不是简单命中即报）：命中黑名单词按 weight 累计分数，
超阈值判「措辞可疑」。yml 形态：

```yaml
- id: comment/wording
  name: "注释措辞审查"
  category: "comment"
  severity: "warning"
  description: "注释/文档中残留对话措辞或自指表述"
  blacklist:                          # 命中加分（weight 越大越可疑）
    - pattern: "按照您的要求"
      weight: 60
  whitelist:                          # 命中减分（正当用法豁免）
    - pattern: "示例"
      penalty: 20
  additional_features:                # 附加特征加权
    - pattern: "第[一二三四五六七八九十]+步"
      weight: 10
  scoring:
    threshold_suspicious: 60          # 超此分 → 报可疑
  threshold: 60                       # 等价写法（优先取 threshold）
  action: "改写为客观陈述"
  suggestions: ["去掉「你/我」", "改为陈述句"]
```

**编译产物**：`blacklist[]`（{pattern,weight}）+ `whitelist[]`（{pattern,penalty}）+ `additionalFeatures[]` + `threshold` + `scoring`/`action`/`suggestions` 透传（展示字段）。
**阈值兜底**：`threshold ?? scoring.threshold_suspicious`（comment.yml 用 60）——只写 `scoring.threshold_suspicious` 也能生效。
**认领条件**：`blacklist` 数组非空（无需写 kind）。维度绑定「文档」。

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
| 8 | 正则莫名匹配大写写法 | `safeRe` 默认加 `i`（不区分大小写），以为写了小写就只匹配小写 | 默认就不区分大小写；**要区分**才写 `(?-i)` 前缀 |
| 9 | yml 自定义字段检查器读不到 | 编译出口 `ruleOut` 只保留固定白名单字段，多余顶层字段被丢弃 | 自定义字段挂 `extra`（检查器读 `rule.extra.xxx`） |
| 10 | yml 写 `severity: error` 想「只提示」 | `error` 被映射为引擎级 **blocker（拦截提交）** | 只警告用 `warning`；`info` 映射为 `pass` |
| 11 | 槽位改了顺序没生效 | 以为 `SLOT_ORDER_HINT` 决定槽位集合 | 集合由目录文件决定；顺序可经配置/环境变量覆盖，未列出的按字典序 |

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

---

## 十、扫描输出 → 豁免方法速查（给用户看的豁免指引）

> 目的：AI 把扫描 findings 汇报给用户时，**每条问题都附「被哪条规则拦 → 怎么豁免」**，
> 让用户不困惑、可自助豁免（豁免只影响提醒，不掩盖硬问题——敏感/语法/大文件不豁免）。

### 10.1 正则/残留类 → 两种豁免姿势

| finding 的 rule/kind | 被谁拦截 | 豁免方法（写哪） |
|---|---|---|
| `[FUNC]`(secret-*) / `credential-ref-*` / `credential-file-*` / 私钥路径 | **dsh-skip-sensitive** | 行尾 `// dsh-skip-sensitive`（仅本行）或文件头（整文件） |
| `func-lines` 函数过长 | **dsh-skip-func-length** | 函数定义行行尾（单函数）或文件头（整文件） |
| debugger / todo / console 残留（regex 类） | **dsh-skip-residue** | 行尾（本行）或文件头（整文件） |
| style-* 数值风格（min-length/max-lines/max-complexity/max-depth/…） | **dsh-skip-style** | 只能文件头 |
| sync-fs / empty-catch / func-lines（质量类） | **dsh-skip-quality** | 只能文件头 |
| binary / large-file | **dsh-skip-size** | 只能文件头 |
| syntax / json-parse / yaml-parse | **dsh-skip-syntax** | 只能文件头 |

### 10.2 测试/脚本自动豁免（不用写标记）

| 文件位置 | 自动豁免的规则 |
|---|---|
| `test/**` | residue / console-log / sync-fs / empty-catch |
| `scripts/**`、`cli.mjs` | residue / console-log / sync-fs |

### 10.3 汇报话术模板

```
⚠️ 警告（rule=xxx，kind=yyy）：<message>
   豁免：<该 kind 对应标记>（文件头=整文件 / 行尾=单点）——若确属刻意写法可加，否则建议修复
```

> 每 finding 已自带 `exemptHint`，AI 汇报时直接引用即可，无需查表。

---

## 十一、审计功能默认关（用户侧说明）

| 开关 | 位置 | 默认 | 说明 |
|---|---|---|---|
| 审计开关 `auditEnabled` | 设置 → 侧边栏 → 审计开关 | **关** | 开启后提交前自动审计（默认关，本机一致开由用户显式打开） |
| 推送许可 `pushPermitEnabled` | 设置 → 侧边栏 → AI 回复推送许可 | **关** | 回复含「任务完成」才自动提交推送 |

> 两条默认关是**产品决策**：不在用户不知情时自动拦截提交 / 自动推送。
> 需要自动审计的部署，在侧边栏打开即可，配置即时生效（无需重启）。

---

## 十二、10 维度字段绑定（问题字段 ↔ 维度）

> 设计：**所有问题都归入 10 个维度**；每个 yml 字段在**对应编译函数里写维度绑定**，
> 支持**一个字段绑定多个维度**（如 repeated-string → 可维护性+可读性）。

### 12.1 绑定位置 = 编译函数（compilers.js），不是 yml

| kind | 维度绑定（compilers.js 内声明） |
|---|---|
| credential-ref / credential-file / `[FUNC]` | 安全性 |
| func-lines | 可读性 + 可维护性 |
| min-length | 可读性 |
| max-lines | 可读性 + 可维护性 |
| max-complexity | 可维护性 |
| max-depth | 可维护性 |
| min-occurrences | 可维护性 |
| repeated-string | 可维护性 + 可读性 |
| regex | 可读性 |
| path-regex | 可读性 + 可维护性 |
| link-check | 文档 + 可维护性 |
| semantic | 健壮性 |
| blacklist | 文档 |
| folder | 可维护性 + 可部署性 |

### 12.2 为什么绑定写在字段函数里

- **yml 保持纯数据**：规则作者不用懂维度，只管写 pattern/阈值；
- **一处声明全链生效**：编译产物直接带 `dimensions[]`，评分 `countByDimension` 直接消费；
- **加新字段 = 加函数 + 注册一行**（compileRule 主体永不改）。

---

## 十三、示例规则：performance/memory-bomb（内存爆炸检测）

> 完整规则定义（含子模式级 message + mitigation），可直接落进任意槽位 yml。
> **已兑现（1.0.4）**：本示例已落地为 `lib/audit-rules/audit-rules-performance.yml`，
> regex 编译器支持对象子模式（patterns 条目可为 `{id, pattern, message}`），
> 命中时输出 per-pattern 专属 message（详见 §2.3 认领表 subPatterns 行）。

```yaml
- id: performance/memory-bomb
  name: "检测可能导致内存爆炸的代码"
  category: "performance"
  severity: "warning"
  description: "短时间内占用大量内存的代码模式"
  patterns:
    - id: full-file-read
      pattern: "fs\\.(readFileSync|readFile)\\s*\\("
      message: "全量读入文件可能占用大量内存，建议用流式处理"
    - id: unbounded-push
      pattern: "\\.push\\s*\\("
      message: "检查 push 是否有清理机制或上限控制"
    - id: array-spread
      pattern: "\\[\\s*\\.\\.\\.\\w+\\s*,\\s*\\.\\.\\.\\w+\\s*\\]"
      message: "展开多个大数组会一次性创建新数组"
    - id: infinite-loop
      pattern: "while\\s*\\(\\s*true\\s*\\)"
      message: "无限循环需确认有 break 条件和内存控制"
    - id: exec-sync
      pattern: "execSync\\s*\\("
      message: "execSync 输出全部进内存，建议用 spawn + 流"
    - id: json-stringify-large
      pattern: "JSON\\.stringify\\s*\\([^)]{50,}\\)"
      message: "大对象序列化会瞬间产生等量字符串"
  fixable: false
  mitigation: |
    - 大文件用 fs.createReadStream 流式处理
    - 数组累积加 maxLength 上限，超出时丢弃旧数据
    - 缓存加 TTL 或 LRU 淘汰机制
    - 递归加深度限制
    - 子进程用 spawn + 流式读取
```

### 13.1 检测方式对比（为什么正则为主、AST 补充）

| 检测方式 | 能检测什么 | 局限 |
|---|---|---|
| 正则扫描 | 可疑模式（push、while true、readFileSync） | 误报多，无法判断实际内存量 |
| AST 分析 | 循环内分配、递归缺终止、闭包捕获 | 需要解析器，实现复杂 |
| 动态监控 | 真实内存增长、泄漏、OOM | 需要运行环境，无法静态发现 |
| 压力测试 | 高并发下的内存峰值 | 需要测试基础设施 |

### 13.2 AST 补充检测思路（@babel/parser，将来扩展 semantic kind 用）

```js
// 用 @babel/parser 检测：
// 1. 循环内是否有内存分配  2. 递归函数是否有终止条件  3. 闭包是否捕获大对象
traverse(ast, {
  // 检测循环内 push
  CallExpression(path) {
    const isPush = path.node.callee.property?.name === 'push'
    const insideLoop = path.findParent(p =>
      p.isForStatement() || p.isWhileStatement() || p.isForOfStatement()
    )
    if (isPush && insideLoop) {
      console.warn(`⚠️ 循环内 push（第 ${path.node.loc.start.line} 行），检查是否有上限`)
    }
  },
  // 检测递归调用
  FunctionDeclaration(path) {
    const fnName = path.node.id?.name
    if (!fnName) return
    let isRecursive = false
    path.traverse({
      CallExpression(inner) {
        if (inner.node.callee.name === fnName) isRecursive = true
      }
    })
    if (isRecursive) {
      const hasBaseCase = path.node.body.body.some(stmt =>
        stmt.type === 'IfStatement' && stmt.alternate?.type === 'ReturnStatement'
      )
      if (!hasBaseCase) {
        console.error(`🔴 递归函数 ${fnName}（第 ${path.node.loc.start.line} 行）缺少终止条件`)
      }
    }
  }
})
```

---

## 十四、待办设计：git push 通道自主选择（AI 填参数，去掉默认 api 硬推）

> **决策记录（2026-09-10，仅设计不实施）**：原设计「所有功能默认 api.github.com + 401 自动回退 SSH」改为
> **AI 填参数自主选择通道**，不保留隐式默认主通道。

### 14.1 目标签名（将来 commitAndPush 增加 transport）

```
commitAndPush({ repoPath, message, push?, dryRun?, token?, transport: 'api'|'ssh'|'auto' })
```

| transport | 行为 |
|---|---|
| `api` | 只走 Git Data API（api.github.com），失败即失败，不自动回退（AI 显式选 API = 认定 token 可用） |
| `ssh` | 只走 SSH（ssh.github.com:443），失败即失败，不自动回退 |
| `auto` | AI 未指定时兜底：先 API，401/失败再回退 SSH（保留旧行为但仅为显式兜底，非默认主通道） |

### 14.2 需要同步改的点（清单）

1. `lib/git/index.js`：`commitAndPush` 加 `transport` 参数 + 分支逻辑；`pushViaApi` 去掉内部 401→SSH 回退（上移到 auto 分支）；文件头注释「默认 api 硬闸」改「通道由 AI 选择」
2. `lib/index.js`：工具 schema `git_commit_push` 加 `transport` 参数并透传；description 去掉「默认 api」
3. **相关 skill**：`skills/dsh-git-push.md`（git_commit_push 行加 transport、git_clone/git_remote_create 的「走 api.github.com」改「通道按参数」）、`skills/dsh-git-push-functions.md`（L57/L68/L180 的「只走 api.github.com」同步改）
4. 测试：test-git.mjs 补 transport 三分支断言
5. 本板 §五 token 探测不变（token 与通道解耦：api 用 token，ssh 用私钥）

> 说明：本清单是**设计备忘**，实施时机由开发者决定，不在本次落码。

---

## 十五、设计：单次硬编码提醒（复用第三等级 info，2026-09-10 确立 4 项）

> **背景**：repeated-string 现在只对「重复 ≥ min_occurrences 的硬编码值」出 warning。
> 新增设计：**单次出现的硬编码值也扫**，不警告、只「提醒」——提示该硬编码值
> 是否需要转成变量/配置文件/常量。正好利用 severity 第三级 **info**（单列、不拦门禁）。

### 15.1 四项设计决策（2026-09-10 已确认）

| # | 决策点 | 定案 |
|---|---|---|
| 1 | 触发范围 | **路径 + 纯数字**（URL/域名/端口/绝对路径/`:8080`/`127.0.0.1` 等值型特征 + 纯数字字面量放开 `num` 类型） |
| 2 | 档位边界 | **可配置阈值**（yml 加 `min_remind` 字段：`count ≥ min_remind` → info 提醒；`count ≥ min_occurrences` → warning 警告） |
| 3 | 评分影响 | **计 0 分**（提醒不进评分、不进 blocker/warning 统计，仅单列展示） |
| 4 | 实现形态 | **同 kind 双档恒开**（repeated-string 检查器同时产 warning + info，不加开关字段） |

### 15.2 目标设计（将来实施）

**切换逻辑（checkRepeated 内）**：
```
对每个硬编码字面量命中：
  count ≥ min_occurrences（默认 3）→ severity='warning'，scoreImpact=1（原行为不变）
  min_remind ≤ count < min_occurrences → severity='info'，scoreImpact=0（新增提醒档）
```
- 范围放宽：`checkRepeatedStringsAst` 对应处放开 `num`（纯数字）与路径/URL 类值型特征；
  仍排除：纯标识符、dotfile、2-4 字汉字维度词、`len<4` 短串（噪音过滤基线保留）
- `countByDimension`：`info`/`notice` 计 0（当前非 blocker 一律计 1，需加 severity 分支）
- `summarize`：info 已单列 notice（无需改）
- **评分盲点预警**：放开 num 会把大量数字字面量计入计数——`count=1` 的纯数字若全提醒会噪音爆炸，
  实施时建议对纯数字再设长度/语义过滤（如仅提醒 `≥4 位` 或含小数/科学计数，`1/2/3` 等小整数仍忽略）

### 15.3 yml 字段（min_remind，repeated-string 编译函数认领）

```yaml
- id: security/no-repeated-hardcoded-literals
  name: "检测重复硬编码 + 单次硬编码提醒"
  category: "security"
  severity: "warning"
  description: "重复 ≥ min_occurrences 警告（建议配置化）；单次硬编码（路径/纯数字）info 提醒（是否转常量/配置）"
  min_occurrences: 3          # warning 阈值（现有）
  min_remind: 1               # 新增：info 提醒阈值（count≥1 即提醒单次硬编码）
  ignore_patterns: [ ... ]    # 现有 ignore 逻辑对两档同时生效
```

### 15.4 修改面清单（涉及文件）

1. `lib/audit-rules/audit-rules-nodejs.yml`：`no-repeated-hardcoded-literals` 加 `min_remind: 1`
2. `lib/rule/compilers.js`：repeated-string 编译函数增加 `min_remind` 字段透传（extra.remindThreshold）
3. `lib/audit/checks.js`：`checkRepeated` 切双档（≥min_occurrences→warning；min_remind≤count<min_occurrences→info，scoreImpact=0）
4. `lib/score/ast.js`：`checkRepeatedStringsAst` 放开 num/路径类筛选（按 15.2 噪音控制）
5. `lib/score/index.js`：`countByDimension` info/notice 计 0
6. `test/test-quality.mjs` / `test/test-rule-packs.mjs`：补双档断言
7. skill `skills/dsh-git-push.md` repeated-string 描述同步

> 说明：本清单是**设计备忘**，实施时机由开发者决定，不在本次落码。