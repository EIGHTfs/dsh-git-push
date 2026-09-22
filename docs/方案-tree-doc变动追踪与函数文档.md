# 方案：tree-doc 变动追踪（记录变动日期 + 工作区变动关注）+ 函数索引与 doc/函数文档自动生成

> 状态：方案草案（未改代码），待确认后按看板执行。
> 来源：用户需求（2026-09-23）——tree-doc 审计时自动调用已实现，希望：①额外关注工作区变动文件、全部文件自动备注记录变动日期（文件还在，注释可能要改）②复用 tree-doc 逻辑 + 找出函数的代码，新增「找出全部函数生成 JSON → 手动补注释 → 自动生成 doc/函数 md 文档」③并回答「tree-doc 文件删了 json 注释怎么处理」。
> 版本：未定（实现时确认是否升版）。

## 一、修改目标

- **问题**：①tree-doc.json 只存 {路径: 描述}，无变动日期/工作区变动感知——文件改了多少次、工作区有哪些未提交变动，JSON 与审计都不体现 ②项目函数无索引——找函数、补函数注释、生成函数文档全靠人工，没有「扫描→JSON→补注释→生成 md」的自动化链。
- **期望**：①tree-doc.json 每文件键自动带「最后变动日期」（git log 最后提交日期），工作区有未提交变动的文件额外标注（M/A/D），审计（tree-doc 自动调用）顺带提示工作区变动文件数 ②`functions` 工具：扫描全部函数 → `functions-index.json`（name/line/signature/comment 空）→ 人工/AI 补 comment → `apply` 生成 `docs/函数/*.md` 函数文档。
- **成功标准**：①tree-doc sync 后 JSON 每文件键含日期（或 _meta 元数据），工作区变动文件有 status 标记，审计 report 显示「工作区 N 文件未提交」提示 ②functions analyze 输出全部函数（function/箭头/对象方法/类方法，与审计 allFns 同覆盖），apply 生成 md（含补的注释）③删除文件仍自动删键（现状保持）④全量测试回归通过。

## 二、现状实证（2026-09-23）

| 现状 | 位置 | 说明 |
|---|---|---|
| tree-doc sync/check | scripts/tree-doc.mjs | sync=gen 文件树合并（新增自动加键、**删除自动删键连带描述**——95-99 行 delete；注释 13 行明确「删除文件自动删键，不再产生孤儿」）；check=漂移报告（missing/stale/注释改动） |
| 审计自动调用 tree-doc | lib/audit/orchestrate.js `appendTreeDocDrift` | auditFull 时调 checkDrift → 漂移产生 structure/tree-doc-drift finding（warning） |
| tree-doc.json 结构 | tree-doc.json | 扁平 `{路径: 描述字符串}`——**无日期/状态字段** |
| 函数提取基础 | lib/ast/tokenizer.js + lib/ast（io-risk 的 allFns 收集全部函数形态） | 分词器 + 函数形态收集（async/sync 函数、箭头、对象方法、类方法）——**可直接复用** |
| 无注释兜底 | tree-doc 现有 | 新键自动加「（待注释）」占位 |

## 三、潜在问题分析

| 风险 | 可能性 | 影响 | 缓解 |
|---|---|---|---|
| 日期备注污染描述（人工描述被自动串改） | 中 | 自动追加日期破坏人工写的干净描述 | 日期放**独立字段**（_meta 或描述后缀统一格式 `（改于 YYYY-MM-DD）` 可剥离）；不覆盖人工描述，只追加/更新尾部日期标记 |
| git log 每文件跑慢（几百文件×逐文件 git log） | 中 | sync 变慢 | `git log --format=%ad --name-only` 一次拿全仓文件最后提交日期表（单次 spawn），不逐文件跑 |
| 函数提取覆盖面（箭头/方法/匿名） | 中 | 漏函数 | 复用 audit allFns 的收集逻辑（tokenizer 词法 + 函数形态识别），匿名函数用「L<行>」命名兜底 |
| 手动补注释的 JSON 与代码漂移（函数改名/删行后索引过期） | 中 | md 与实际不符 | apply 时以当前代码为准重建索引，comment 按 name+行 匹配保留（行漂移可容忍，name 变则注释标记「待更新」） |
| 删除文件键连带注释删除 | 低 | 用户补的注释丢失 | 保持现状语义（与 tree-doc 一致：删除自动删键）——但**函数索引 JSON 单独存**（docs 侧），文件删除时 functions-index 对应条目标 deleted 供 md 归档，不静默丢 |

**边界条件**：
1. 无 git 历史（新仓库）→ 变动日期取文件 mtime 兜底；无 git 仓库 → 全 mtime。
2. 工作区干净 → status 全空，无变动标注（正常）。
3. 函数无注释 → md 该函数节显示「（无注释，待补）」；`functions apply --skip-empty` 可跳过。
4. 非 js/mjs/ts 文件 → 函数索引不扫（tree-doc 变动日期仍覆盖所有文件）。

## 四、Skill 学习检查

| 检查项 | 结果 | 说明 |
|---|---|---|
| 类似功能 skill | 有 | `module-splitter`（analyze/split/verify 三态模式——functions 沿用 analyze/apply）、`func-index-targeted-read`（函数索引定位——本方案代码化其索引能力） |
| 同类解决方案 | 有 | audit `lib/ast` 的 allFns（io-risk 2026-09 已实现全函数形态收集）——函数提取直接复用不新造；tokenizer.js 分词 |
| 现成工具 | 有 | `git log --name-only`（一次拿全仓文件日期）、tokenizer + allFns、tree-doc 现有 merge/check 逻辑 |

**学习结论**：复用 tree-doc 的 sync/check/merge（不新写文件树逻辑）+ audit 的 tokenizer/allFns（不新写 AST 解析）；functions 工具仿 module-splitter 的 analyze/apply 两态（analyze 生成 JSON、apply 落盘 md）。

## 五、涉及文件汇总

| 文件 | 操作 | 预估 | 说明 |
|---|---|---|---|
| `scripts/tree-doc.mjs` | 修改 | +60 | sync 加「变动日期 + 工作区 status」：git log --name-only 一次取全仓日期表 + git status 变动集 → 键值描述追加日期/状态标记（可剥离后缀） |
| `lib/audit/orchestrate.js`（appendTreeDocDrift） | 修改 | +10 | checkDrift 结果带工作区变动文件数 → finding/提示「工作区 N 文件未提交」 |
| `scripts/functions-index.mjs`（新增） | 新增 | +180 | 扫描 js/mjs/ts → tokenizer+allFns 提取全部函数 → 输出 `functions-index.json`（file/name/kind/line/signature/comment） |
| `scripts/functions-doc.mjs`（新增） | 新增 | +120 | 读 functions-index.json（含人工补的 comment）→ 生成 `docs/函数/<文件>.md` 函数文档 |
| `cli.mjs` | 修改 | +40 | `git-sluice functions <analyze|apply> [--path 文件] [--skip-empty] [--json]`（KNOWN_FLAGS/HELP 同步） |
| 工具 | 修改 | +10 | tools.js 加 `functions_index` 工具（analyze 返回 JSON；apply 写 docs） |
| `test/test-functions-index.mjs`（新增） | 新增 | +80 | 函数覆盖（function/箭头/方法/类方法/匿名兜底）/索引 JSON 结构/apply 生成 md/comment 保留 |
| README/tree-doc | 修改 | 小 | 功能说明/新文件登记 |

## 六、逐文件改动要点

### 6.1 `scripts/tree-doc.mjs`（工作区变动文件记录修改时间 + 变动标识）

> 用户 2026-09-23 细化：每次 tree-doc，把 **git 工作区变动文件**（未提交的 M/A/D）的**修改时间**记录进 json 并**标识变动**——目的 = **提示该文件的注释可能要更新**；apply 到 README 仍只同步原描述内容（日期/变动标识不进 README）。

- sync 新增（保持 merge/删除键逻辑不动）：
  - `git status --porcelain` → 工作区变动集 {M/A/D 文件路径}
  - 对**变动文件**：记录 mtime（文件修改时间）进 json **独立 `_meta` 段**（`{"_meta": {"worktree": {"lib/foo.js": {"status": "M", "mtime": "2026-09-23T06:30:00", "note": "注释可能需更新"}}}}`）——**不污染描述字符串**（避免 check 漂移误报）
  - 描述（人工写的内容）原样保留；`_meta` 只做变动提示元数据
  - **apply 同步到 README 树块仍只输出原描述内容**（路径 + 描述），`_meta` 不进 README
- check 扩展：报告工作区变动文件清单（N 个）+ 提示「这些文件注释可能需更新」——供审计/人工核对

### 6.2 审计联动（appendTreeDocDrift）

- checkDrift 返回加 `worktreeChanges: {count, files: [{path, status, mtime}]}`（工作区未提交变动数 + 修改时间）→ finding（info/notice）：`工作区 N 个文件有未提交变动（M x / A y / D z），tree-doc 已记录修改时间——相关文件注释可能需更新`——不拦提交（notice）

### 6.3 函数提取（复用现成 `scripts/func-index.js`，不新写）

- `functions analyze <目录>` = 调 `node scripts/func-index.js <目录> --out functions-index.json`（目录递归扫 *.js/*.cjs/*.mjs；识别 function/箭头/对象方法/类方法/模块方法）
- **已修 func-index.js 的 ESM 漏识别**（`^function` 漏 `export function`，实测 lib/score/index.js 0→2 函数）；`--out` 输出项补 `comment: ""`（人工补注释载体）+ `signature`（defLine 行原文）
- 输出 `functions-index.json`（仓库根，git 忽略可选）；增量保留：已补的 comment 按 name+defLine 匹配回填（人工注释不丢）

### 6.4 `scripts/functions-doc.mjs`（doc/函数md 生成）

- `apply(projectRoot)`：读 functions-index.json → 按文件生成 `docs/函数/<文件相对路径>.md`：
  ```
  # 函数索引 · lib/foo.js
  | name | kind | L行 | 签名 |
  ## bar(a, b)（L42）
  <comment 或「（无注释，待补）」>
  ```
- 文件删除 → 对应 md 归档 `docs/函数/_archived/`（不静默丢人工注释）

### 6.5 CLI/工具

- `git-sluice functions analyze [--path <文件>]` → 生成/刷新 functions-index.json
- `git-sluice functions apply [--skip-empty]` → 生成 docs/函数/*.md
- 工具 `functions_index`（analyze/apply 两动作，返回生成路径/函数数）

## 七、影响分析

| 维度 | 程度 | 说明 |
|---|---|---|
| 现有功能 | 中 | tree-doc sync/check 行为兼容（日期/状态为追加标注，删除删键语义不变）；审计新增 notice 提示（不拦提交） |
| 性能 | 低 | sync 多 1~2 次 git spawn（日期表 + status）；函数 analyze 按需跑 |
| 兼容性 | 中 | tree-doc.json 键值含日期/状态后缀——check 剥离后缀比对避免误漂移；旧 JSON 无缝升级（sync 自动补日期） |
| 安全性 | 低 | 只读 git 元数据/代码，无新输入面 |
| 可维护性 | 低 | functions 两脚本职责单一；复用 tokenizer/allFns 不重复 AST |

## 八、任务看板（确认后执行，从简到难，每步小提交）

### 阶段一：准备
- [x] skill 学习（module-splitter analyze/apply 模式、func-index-targeted-read 索引化、audit allFns 复用）见第四节
- [x] 现有测试基准：770/768 pass
- [ ] 确认版本（默认不升；升版需许可）

### 阶段二：代码修改（每步本地提交）
- ☐ Step 1（最简单）：tree-doc sync 加「工作区变动文件 mtime + 状态标识」_meta 记录（描述不动）+ apply 只同步原内容 + check 提示变动文件——现有 tree-doc 测试回归
- ☐ Step 2：审计联动（checkDrift 返回工作区变动数 → notice 提示）
- ☐ Step 3：func-index.js 补 `--out` comment/signature 字段（ESM 已修）→ `functions analyze` 复用调用——单测
- ☐ Step 4（最复杂）：`functions-doc.mjs` apply（docs/函数/*.md 生成 + 删除归档）+ CLI/工具接入 + README/tree-doc 登记
- ☐ 阶段三：全量回归 + 契约（KNOWN_FLAGS/HELP）
- ☐ 阶段四：整理提交（含版本确认）

## 九、验证方案

- 单元：tree-doc sync 日期/状态标注（临时 git 仓库：改文件 → sync → 键含「改于 日期」+「工作区:已修改」；check 不误报）；functions analyze 函数覆盖（function/箭头/对象方法/类方法/匿名兜底）/comment 回填；apply 生成 md（含注释 + 无注释待补 + 删除归档）
- 集成：真实项目（dsh-git-push）跑 functions analyze → 索引 JSON 函数数 ≈ 审计 max-function-length 覆盖；apply → docs/函数/ 生成；tree-doc sync → 日期标注
- 回归：全量测试

## 十、中断与插入管理

- 执行中插入新需求：暂停→分析→默认不执行等确认。
- 发现新问题（如 git log --name-only 大仓性能）：非阻塞记「后续优化清单」继续。

## 十一、后续优化清单（本次不处理）

- ☐ 函数索引前端/HTTP 展示（设置页函数浏览器）
- ☐ comment 自动生成（LLM 初稿，人工复核后 apply）——本次只做「人工补注释」链
- ☐ 变动日期粒度到行（git blame 级别）——本次只到文件级

## 十二、是否执行？

请回复 **确认** 或 **修改方案**（调整点如：日期放描述后缀 vs 独立 _meta、functions 是否升版、doc 目录命名）。
若回复含新需求，触发「中断管理」流程，默认不执行并继续原任务。
