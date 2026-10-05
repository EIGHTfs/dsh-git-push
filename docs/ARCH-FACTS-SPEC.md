# ArchFacts JSON 规范 v1

> 本插件**自己的中性中间层**（IR）。事实层产出 ArchFacts，渲染器由 `to-xxx.js` 转译。
> 实现：`lib/arch/ir.js`（构造 + 枚举常量）；校验：`validateFacts`（见下第 6 节）。

## 1. 设计原则

1. **中性**：IR 里**不出现**渲染器概念——无颜色、坐标、图标、布局模式、文件扩展名、`variant`、`sublabel`
2. **可反查**：每个节点带 `anchor`（真实文件）+ `members`（由谁聚合）+ `evidence`（证据链）
3. **可校验**：不变量能独立验证，**不依赖任何渲染器**
4. **稳定**：换渲染器 IR 不变，靠 `schema` 版本号兜底
5. **确定性**：全部来自「目录 + 真实 import + IO 调用」，**AI 不参与拓扑**

## 2. 顶层结构

```jsonc
{
  "schema": "arch-facts/1",
  "repo": {
    "name": "dsh-git-push",
    "root": "/abs/path",
    "sourceRoot": "lib",            // 推导所得，可为 "."（代码在仓库根）
    "revision": "68bb21d…",         // git HEAD，拿不到则省略
    "generatedAt": "2026-10-05T13:05:00+08:00"
  },
  "totals": { "files": 262, "funcs": 1031, "nodes": 36, "edges": 98 },
  "nodes": [ /* 第 3 节 */ ],
  "edges": [ /* 第 4 节 */ ],
  "groups": [ /* 第 5 节，可选 */ ],
  "meta": { "tool": "dsh-git-push", "schemaDoc": "docs/ARCH-FACTS-SPEC.md" }
}
```

## 3. `nodes[]`

```jsonc
{
  "id": "ast",                      // 稳定标识：slug，^[a-zA-Z][a-zA-Z0-9_-]*$
  "kind": "module",                 // module | data | external
  "label": "ast",                   // 人类可读名
  "layer": "lib/ast",               // 语义分层（当前=目录名）；渲染器**可忽略**
  "members": ["lib/ast/brace.js"],  // 成员文件（可反查）；module 必填非空
  "anchor": "lib/ast/index.js",     // 代表文件（必须真实存在）；data/external 可为 null
  "stats": { "files": 20, "funcs": 142, "maxComplexity": 41, "maxFuncLines": 96 },
  "funcNames": ["matchBrace"],      // 与 docs/FUNCTIONS.md 同一扫描器（scanFileFuncs）
  "io": { "reads": [".env"], "writes": ["pawchive.log"] },
  "evidence": ["lib/ast/index.js"]  // 证据链，≥1
}
```

- `kind='data'`：被读写的文件。**不要求文件在仓库里存在**——运行时文件（如 `.pawchive/creators-cache.json`）
  同样是真实 IO 事实，此时 `anchor` 为 `null`。这条是刻意的：架构图画的是 **IO 事实**，不是「仓库文件清单」。
- `kind='external'`：外部系统（如 `api.github.com`），由源码里出现的 URL 主机名推导。
- `stats.funcs` 与 `funcNames` 必须同源，否则与 `docs/FUNCTIONS.md` 对不上。

## 3.5 事实清单（`files` / `functions` / `urls` / `io` / `apis`）

`nodes`/`edges` 是事实的**图视图**；下面五张清单是事实的**原始形态**——两者同源，任何渲染器可任选。
清单里的每条都带 `file`（+ 尽可能的行号），保证**可反查**。

```jsonc
"files": [
  { "path": "lib/ast/index.js", "module": "ast", "lines": 120, "funcs": 8, "isSource": true }
],

"functions": [
  { "name": "matchBrace", "file": "lib/ast/brace.js", "line": 12, "endLine": 40,
    "kind": "function", "lines": 29, "module": "ast" }
],

"urls": [
  { "url": "https://api.github.com/repos/x", "host": "api.github.com",
    "file": "lib/git/api.js", "line": 33, "module": "git" }
],

"io": [
  { "op": "read",  "path": ".env",                       "file": "cli.js", "line": 50, "module": "cli" },
  { "op": "write", "path": "pawchive.log",               "file": "cli.js", "line": 144, "module": "cli" },
  { "op": "rename","path": "creators-cache.json",        "file": "cli.js", "line": 331, "module": "cli" }
],

"apis": [
  { "method": "GET",  "path": "/api/v1/session", "file": "adapters/KToolBox-webui.js", "line": 128, "module": "adapters", "role": "define" },
  { "method": "POST", "path": "/api/v1/session/login", "file": "adapters/KToolBox-webui.js", "line": 132, "module": "adapters", "role": "define" },
  { "method": "",     "path": "/api/v1/health",  "file": "server.js", "line": 21,  "module": "server",   "role": "reference" }
]
```

`apis[].role`：`define`（注册调用 / `case` / `pathname ===` 里出现 ⇒ 路由定义）或 `reference`（数组、测试里出现 ⇒ 只是引用了这个路径）。
**方法取不到就留空**——实测 Pawchive 的 `server.js:21` 是端点自检数组（`const endpoints=[...]`），那些路径本就没有方法，留空才对（不猜）。

| 清单 | 来源（确定性） | 说明 |
|---|---|---|
| `files` | 文件扫描（`lib/audit/collector.js` + git 跟踪过滤） | `isSource` 区分源码与数据文件 |
| `functions` | `scripts/doc-func.mjs` 的 `scanFileFuncs` | **与 `docs/FUNCTIONS.md` 同一扫描器**，两处必须一致 |
| `urls` | 源码里的 `https?://…` 字面量 | `host` 用于聚合出 `kind:'external'` 节点 |
| `io` | `lib/ast/io-risk.js` 的调用分类 + 路径解析（同行字面量 / 本文件变量回填） | `op` ∈ read/write/rename/delete/**meta**（meta 指 `existsSync`/`statSync` 这类只读元信息调用，实测存在） |
| `apis` | 源码里的路由字面量（`'/api/...'`）+ 邻近的 HTTP 方法 | 无路由字面量则为空数组（不猜） |

**硬约束**：五张清单都**不允许为空数组以外的编造**——取不到就是空数组，并在 `meta.warnings` 里注明原因。

## 4. `edges[]`

```jsonc
{
  "from": "checks",
  "to": "ast",
  "kind": "import",                 // import | io-read | io-write | resource | external-ref | call
  "count": 12,
  "evidence": ["lib/checks/structural.js:15"]   // 文件:行号，≥1
}
```

- **kind 与渲染的对应由转译器决定**（例：`to-archify` 把 `io-read` 画虚线、`io-write` 画实线）——IR 不管
- 无自环（`from === to` 非法）；同一对端点可有**多条不同 kind** 的边
- `evidence` 的行号：`import` 边记首次出现行，`io-*` 边记调用行（提取器未提供时写 `path:io` 占位）

## 5. `groups[]`（可选分组）

```jsonc
{ "kind": "dir", "label": "lib/checks", "wraps": ["structural", "common"] }
```

只描述「哪些节点属于一组」，**不含坐标/尺寸**；渲染器自己决定画框还是上色。

## 6. 不变量（`validateFacts(ir)` 逐条校验）

| # | 不变量 | 违反判定 |
|---|---|---|
| 1 | `anchor` 非 null 时必须**真实存在于仓库** | 事实错误 |
| 2 | `module` 节点的 `members` 非空，且每个成员文件存在 | 事实错误 |
| 3 | `evidence` 每条非空；文件部分存在（行号越界容忍） | 事实错误 |
| 4 | 每条 edge 的 `from`/`to` 都在 `nodes` 里 | 悬空 |
| 5 | 无自环（`from !== to`） | 拓扑错误 |
| 6 | 依赖图无环（DAG）；**聚合层环**允许，但记入 `meta.warnings` | 拓扑提示 |
| 7 | `totals` 与 `nodes`/`edges` 长度自洽 | 内部一致 |
| 8 | `kind`/`layer` 取值合法（枚举） | 规范错误 |

> 第 6 条**刻意区分**「模块级环（错误）」与「聚合层环（正常）」：按目录聚合后层与层互相依赖是常态，
> 报成错误会逼着人「为了好看改事实」。

## 7. 迁移映射（现有数据 → IR）

| 现字段 | IR 字段 | 处理 |
|---|---|---|
| `facts.modules[]` | `nodes[]`（`kind:'module'`） | 直接映射；`anchor` 用 `moduleAnchor` |
| `facts.edges[]` | `edges[]`（`kind:'import'`） | 补 `evidence` |
| `agg.components[]` | `nodes[]` 的聚合形态 | 带 `members`/`anchor` |
| IO（现为每模块数组） | `nodes[].io` + `edges[]`（`io-read`/`io-write`）+ `nodes[]`（`kind:'data'`） | **新物化**（原先只在 to-json 里做，且被存在性过滤误杀） |
| `to-json.js` 的 `variant/sublabel/type` | **不进 IR** | 由 `to-archify.js` 现算 |

## 8. 版本与兼容

- `schema: "arch-facts/1"`；破坏性改动升 `2`，转译器按版本分支
- 旧入口 `toArchifyJson` 保留一个版本作为兼容别名
- 新增渲染器 = 新增 `to-xxx.js`，**不动** `extract.js` / `aggregate.js` / `validate.js`

### 8.1 非 git 仓库的处理（已定）

- **非 git 仓库照样产出完整 JSON**（实测：事实层 / IR / archify JSON 三层都能出）
- **`meta.repository` 允许缺省**：非 git 拿不到 `url` 与 40-hex `revision`，此时**照写各组件的 `sources`、省略 `meta.repository`**
- 已知代价（如实记录）：archify 官方 validate 的规则是「有 `sources` 就必须有 `meta.repository`」，
  因此这种产物过不了**渲染器侧**的 schema 校验。这是**格式层**的限制，**不影响事实层**——
  事实（组件锚点、成员、证据）依然完整可反查，换任何不强制 repository 的渲染器都能用。
  取舍：宁可保留事实（`sources`），也不为过校验而删掉锚点。

## 9. 落地阶段

| 阶段 | 内容 | 硬验收 |
|---|---|---|
| S1 | 本规范 + `lib/arch/ir.js` | 文档与代码枚举常量一致 |
| S2 | `validateFacts(ir)` + `test/test-arch-ir.mjs`（8 条不变量逐条测） | 本仓库 0 错；负例能报错 |
| S3 | `to-json.js` → `to-archify.js`（留兼容别名），消费方切换 | `arch_json` 输出与改前**逐字节一致** |
| S4 | `scripts/archify-imports.mjs` 退役，模块划分下沉 `extract.js` | 工具侧与脚本侧对同一仓库输出**一致** |
