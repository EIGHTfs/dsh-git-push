---
name: dsh-git-push
description: dsh-git-push 插件手册（v1.x 架构：10 总入口 + 7 工具 + YAML 规则包）。说明 git_scan / git_commit_push / code_audit / git_clone / git_remote_create / git_set_visibility / link_check 七个工具的调用方法，审计规则包（lib/audit-rules/*.yml 动态槽位）、豁免标记（dsh-skip-*）、质量评分（10 维度加权）、HTTP API 鉴权（Origin + confirm）、独立运行（git-sluice CLI）与双副本同步。处理「提交推送代码」「扫描仓库状态」「审计代码」「规则包怎么加规则」「被审计拦截怎么豁免」「链接检查」「插件装了不生效」类请求时加载。
whenToUse: 需要用插件做 git 提交推送 / 代码审计 / 规则包定制 / 报错排查时。
---

# dsh-git-push 插件手册

> 定位：把「扫描仓库 → 审计门禁 → 一键 commit+push」固化为代码管道（零 token、确定性）。
> 本手册是使用说明；正常情况优先直接调用插件工具。

## 一、七个工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `git_scan` | `root?`, `paths?`, `extraReposFile?` | 扫描全部 git 仓库 → 分支/remote/未提交变更数/最近活动 |
| `git_commit_push` | `repo`(必填), `message`(必填), `push?`, `dryRun?`, `audit?`(默认 true), `requirementsConfirmed?` | **先审计** → `git add -A` → commit → push；审计有 blocker 时拦截 |
| `code_audit` | `repo`, `scope?`, `llm?`, `ruleset?`, `auditLevel?`, `weights?` | 审计仓库：L0 静态检查 + 10 维度质量评分；`scope=full` 全量；`ruleset` 指向自定规则目录（整体替换规则包）；`auditLevel=quick/standard/deep` 控强度；`weights` JSON 覆盖权重 |
| `git_clone` | `target`(必填), `dest?`, `branch?` | 经 `api.github.com` Git Data API 克隆（不跟随 302、不直连 codeload） |
| `git_remote_create` | `repo`, `visibility?`(默认 private), `dryRun?` | 按目录名建远程仓库并设 origin（走 api.github.com） |
| `git_set_visibility` | `repo`, `visibility`(必填) | 切换仓库公开/私有（改 public 前先确认无凭据泄露） |
| `link_check` | `repo?`, `paths?` | 检查文档链接：404/403→-3、DNS→-2、超时/5xx→-1；只 warning，永不 blocker |

典型流程：`git_scan` 看改动 → `code_audit` 自查 → `git_commit_push`（审计通过才推）。

## 二、审计规则包（YAML 槽位）

- **位置**：`lib/audit-rules/audit-rules-<槽位名>.yml`
- **槽位全动态**：**放一个 yml 进目录就自动成为槽位**，删除即失效，无需改代码
- **排序偏好**：`lib/rule/loader.js` 的 `SLOT_ORDER_HINT` 只决定加载顺序，不决定「有哪些槽位」
- **环境变量**：`DSH_GIT_PUSH_RULE_SLOTS=nodejs,docs` 可临时指定（脱离 DSH 时用）
- **template**：`audit-rules-template.yml` 是空模板，默认不加载（供自定义参照）

已建槽位：`nodejs`（代码规则）、`docs`（链接与文档规则）。

### 规则字段 → 编译函数（加字段 = 加函数 + 注册一行）

`lib/rule/registry.js` 的 `compileRule` 是统一入口，**永不需要修改**。新增一种规则类型只需：

1. 在 yml 里加字段（如 `max_lines: 50`）
2. 在 `lib/rule/compilers.js` 写一个编译函数
3. `registerCompiler(kind, detect, compile)` 注册一行

`detect` 是认领条件（看 id 前缀或字段存在性），注册表有序匹配。

### 支持的规则字段

| 字段 | kind | 含义 |
|---|---|---|
| `pattern` / `patterns` + id 前缀 `secret-` | `[FUNC]` | 凭据正则（大小写不敏感，驼峰/大写不漏检） |
| id 前缀 `credfile-` / `path_pattern` | `credential-file` | 凭据类文件路径 |
| id 前缀 `credref-` | `credential-ref` | 凭据引用模式 |
| `max_lines` | `func-lines` | 单函数行数上限 |
| `max_lines`(文件级) | `max-lines` | 单文件行数上限 |
| `min_length` | `min-length` | 命名最短长度 |
| `max_complexity` | `max-complexity` | 圈复杂度上限 |
| `max_depth` | `max-depth` | 嵌套深度上限 |
| `min_occurrences` | `repeated-string` / `min-occurrences` | 重复硬编码串/数值 |
| `path_pattern`(非 credfile) | `path-regex` | 文件路径正则 |
| `pattern`(普通) | `regex` | 通用正则 |
| `kind: link-check` | `link-check` | 链接有效性 |
| `semantic` | `semantic` | 语义提示（需人工确认，notice 级） |

**severity 上限规则**：yml 里声明的 `severity` 是上限——规则写 warning，检查器就不会把它升为 blocker。

## 三、豁免标记（dsh-skip-*）

写注释即可豁免，**位置决定范围**：

| 标记 | 豁免什么 | 位置语义 |
|---|---|---|
| `dsh-skip-sensitive` | 凭据/敏感信息（`[FUNC]`/credential-*） | 文件头前 3 行=整文件；行尾=本行 |
| `dsh-skip-func-length` | 函数过长 | 文件头=整文件；函数定义行=该函数 |
| `dsh-skip-residue` | 残留注释措辞 | 文件头=整文件；行尾=本行 |
| `dsh-skip-quality` | 质量类（命名/复杂度/嵌套/重复串） | 文件头=整文件 |
| `dsh-skip-size` | 文件过大 | 只能写文件头（文件大小是整文件属性） |

豁免**只免扫描告警，不免审计门禁本身**——不放行任何凭据入库。

## 四、质量评分

10 维度加权（合计 100）：可读性 15 / 可维护性 15 / 健壮性 15 / 安全性 18 / 性能 10 / 测试覆盖 10 / 可观测性 5 / 可部署性 5 / 文档 4 / 开发者体验 3。

分档：A ≥ 85，B ≥ 70，C ≥ 55，其余 D。问题按 `dimensions` 归属到维度后扣分。

## 五、HTTP API 鉴权

- **写方法**（POST/PUT/PATCH/DELETE）必须带 `Origin` 头，且需与 Host 同源；缺失或跨域 → 403
- **破坏性操作**（重建历史/切可见性/删仓）需 body 带 `confirm: true`，否则 400
- **body > 5 MB** → 413
- GET/OPTIONS 免鉴权（只读探测）

## 六、独立运行（脱离 DSH）

```bash
node cli.mjs version          # 版本
node cli.mjs ruleset          # 编译规则包并输出统计
node cli.mjs scan             # 扫描仓库
node cli.mjs audit . --full   # 全量审计（--full 全量，默认只扫变动）
node cli.mjs link-check       # 链接检查
node cli.mjs self-check       # 自身完整性
```

`package.json` 的 `bin.git-sluice` 指向 `cli.mjs`。

## 七、双副本同步（改动不生效先查这里）

DSH 加载插件的真实位置是 **`<profile>/local-plugins/<插件名>`**（profile 的 `package.json` 写的是 `file:./local-plugins/dsh-git-push`），`node_modules/<插件名>` 是 npm link 产物。**两处都要同步**，否则 UI/行为改动刷新看不到。

```bash
node scripts/sync-plugin.mjs          # dry-run（默认，只打印差异）
node scripts/sync-plugin.mjs --write  # 真同步（两处目标都写）
```

## 八、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 装了插件但设置侧边栏没有 | 只同步了 `node_modules/`，漏了 `local-plugins/`；见第七节 |
| 规则改了不生效 | 槽位是动态发现，确认 yml 文件名是 `audit-rules-<名>.yml` 且放在 `lib/audit-rules/` |
| 新规则被更宽的规则抢走 | 注册表**有序匹配**，宽泛的 detect（如 `regex`）要排在专用 detect 之后，或把 detect 条件写精确 |
| 审计报「0 blocker 0 warning 但 total > 0」 | error 级问题也计入拦截级；看 findings 的 severity 字段 |
| 豁免写了没用 | 标记必须在前 3 行（整文件豁免）或写在**命中那一行**（行级豁免） |
| 链接检查报错 | 链接问题只 warning 不拦截；flaky 域名（github 等）网络错误扣分 ×0.2 |
