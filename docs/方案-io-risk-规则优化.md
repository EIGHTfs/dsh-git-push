# 方案：io-risk 规则优化（对照「规则推断与准确率评估」的差距分析）

> 状态：方案草案（未改代码），待确认后执行。
> 来源：`docs/方案-io-risk规则推断与准确率评估.md`（2026-09-23 并行会话诊断：theme 65 处 io-risk findings 仅 2 真警告、97% 误报 + 5 条改进建议）+ 实测现状（theme 当前 159 处 io-risk / 全部 534 findings，占 30%）。
> 本方案 = 逐条对照「第三节 5 条改进建议」vs 现有 `lib/ast/io-risk.js`（295 行）/ `io-risk-const.js`（83 行）的**差距分析** + 改动点 + 影响面，供确认后实施。

## 一、现状（实测，2026-09-23）

- io-risk 规则定义：`lib/audit-rules/audit-rules-nodejs.yml`（robustness/io-risk，L1 正则初筛 `lib/audit/io-risk-filter.js` → 定级 `lib/ast/io-risk.js`）
- 定级模型：四级（safe/low/medium/high）+ 上下文（异步/循环/请求/启动）+ 操作类别（KIND_BY_FN 只分 write/delete/rename，其余默认 read）
- theme 实测：io-risk findings **159 处**（全部 534 的 30%）——误报源头集中在「请求路径 + 查询型操作」（existsSync/statSync/readdirSync）与「请求路径 + 单文件 rename/unlink/mkdir」

## 二、5 条建议 vs 现状差距对照

| # | 方案建议 | 现状（io-risk.js 实际实现） | 差距判定 |
|---|---|---|---|
| 1 | 启动路径识别升级（函数名白名单 → AST 调用图） | `inStartup = !inAsync && !inLoop && !inRequest`（94 行）——**非请求/非循环/非异步即算启动**，比函数名白名单更宽松（不靠 apply/init/main 名字）；detectRequestContext 用 REQUEST_PATTERNS 文本回溯（103-108） | **已超越建议**，无需 AST 调用图；待实测 theme 的 `downloadAllOnline` 等自定义名启动函数是否已被豁免（方案评估时 13 处「该豁免没豁免」应为旧版规则，现宽松式应已放行） |
| 2 | rename/unlink/mkdir 降级（单文件元数据操作） | 写/删/改名**仅 repeated（循环或请求）时加权**（149 行）；启动一次性不加权（原子写已豁免 146-148）；但**请求路径 + rename/unlink/mkdir** → medium（141）+ repeated 加权 = high——theme DELETE 壁纸 renameSync 移 .trash、unlinkSync 清 .part 被误报 | **差距**：请求路径单文件 rename/unlink/mkdir(recursive) 仍过度加权 |
| 3 | 保留循环内强规则 | 循环内多维分级（128-140）：smallFixed low / 同步 medium-high / Promise.all 并行 low / 请求 await high——**完整保留** | **无差距** |
| 4 | tmp+rename 原子写 / appendFile 日志追加 / mkdir(recursive) 幂等豁免 | 原子写已豁免（146-148，实测 25 条 atomic 写全不被误升档）；appendFileSync 归类 write + 非 repeated 不加权 ✓；mkdirSync **不在 KIND_BY_FN**（默认 read）→ 请求路径 mkdir = medium（不豁免也不当加权） | **部分差距**：mkdir/rmdir/stat/exists/readdir 未分类，无「元数据操作」概念 |
| 5 | 元数据操作分档（stat/exists/readdir/unlink(single)/rename/mkdir 统一低风险 vs 数据读写高风险） | KIND_BY_FN（io-risk-const.js 26-33 行）只分 write/delete/rename；**查询型**（existsSync/statSync/readdirSync/accessSync/realpathSync）默认 read → 请求路径一律 medium（141 行）——theme 大量 existsSync/statSync 请求路径误报的**根源** | **核心差距**：需新增「元数据操作」档 |

**结论**：5 条建议中 1/3 已达标（现状更优），**核心差距集中在建议 2 + 5（元数据操作分档 + 请求路径单文件元数据降级）**，建议 4 补 mkdir/rmdir 分类。改进后 theme 65 处中约 60 处降为豁免/低风险（方案预期），真告警聚焦「循环读日志」「请求读大文件」。

## 三、改动方案

### 3.1 `lib/ast/io-risk-const.js`（+8 行）

- 新增 `META_FS_FNS`（查询/元数据/目录操作集——「元数据操作」档）：
  ```js
  export const META_FS_FNS = new Set([
    // 查询型：单文件 stat 微秒级
    'existsSync', 'statSync', 'lstatSync', 'readdirSync', 'accessSync', 'realpathSync',
    'exists', 'stat', 'lstat', 'readdir', 'access', 'realpath',
    // 目录/幂等操作：mkdir(recursive) 幂等、rmdir 目录级
    'mkdirSync', 'rmdirSync', 'mkdir', 'rmdir',
  ]);
  ```
- 从 `KIND_BY_FN` 语义不变（write/delete/rename 数据类照旧）；META 独立集，优先级高于默认 read

### 3.2 `lib/ast/io-risk.js`（+10 行）

- `judgeIoToken`（96 行）：kind 判定加 meta 分支——`const kind = META_FS_FNS.has(t.value) ? 'meta' : (KIND_BY_FN[t.value] || 'read');`
- `gradeRisk`（121-154 行）：新增 meta 档判定（放在 inRequest 之前）：
  ```js
  // 元数据/查询/幂等目录操作：单文件 stat/exists/readdir、mkdir(recursive)、rename 同卷、
  //   单文件 unlink——微秒级，不构成请求路径阻塞风险 → 请求路径降 low
  if (kind === 'meta' && (isSync || inAsync)) { risk = 'low'; reason = '元数据/查询/幂等操作（微秒级，无数据内容搬运）'; }
  ```
- `repeated` 加权（149 行）：**meta 类不参与写/删/改名加权**（它本不在 KIND_BY_FN 的 write/delete/rename——无需改，但确认 mkdir/rmdir 进 META 后不误入加权）

### 3.3 保持不动

- 循环内多维分级（建议 3 ✓）、启动路径宽松判定（建议 1 ✓）、原子写豁免（建议 4 已有 ✓）
- REQUEST_PATTERNS / 循环识别 / 并行识别——不动

## 四、潜在问题分析

| 风险 | 可能性 | 影响 | 缓解 |
|---|---|---|---|
| meta 降档漏真问题（请求路径 readdirSync 大目录 + 后续循环处理） | 低 | 大目录 list 微秒级；若循环内处理 → 循环内仍 high（不受影响） | meta 只影响「非循环」档；循环内路径完全保留 |
| serveStream 的 statSync（方案列「轻微但正确」）降 low 后不提示 | 中 | 每请求 stat 轻微 | 接受（方案自己评「轻微」）；真风险是流式本体（已 async） |
| 评分波动（io-risk 误报大降 → 性能/可读性维度分变化） | 中 | 各项目 audit 分数可能上升/下降 | 全量回归 + 抽查 2 个项目评分对比 |
| 旧测试断言（test-io-risk.mjs 期望某档位）失效 | 中 | 测试红 | 按新档位更新断言（meta 类期望 low） |

**边界**：META 与 KIND_BY_FN 重叠（renameSync 是 rename 非 meta——rename 移 .trash 的同卷改名仍算 rename？方案建议 rename 单文件降级——rename 进不进 META？**决策**：rename 保持 rename 类（不进 META），但其「请求路径单文件」误报靠「repeated 加权仅对数据不可逆」已有逻辑（rename 同卷移 .trash 是一次性 rename 非循环——请求路径 + rename：medium + repeated(请求) + 加权 → high 仍误报）。**修正**：请求路径加权仅对 **write/delete**（数据内容不可逆），**rename 同卷改名为元数据级**（不进 META 但降档）——见 3.2 补充：`if (repeated && kind === 'rename') 不加权`（rename 同卷瞬时非拷贝）。

## 五、涉及文件

| 文件 | 操作 | 预估 | 说明 |
|---|---|---|---|
| `lib/ast/io-risk-const.js` | 修改 | +10 | 新增 META_FS_FNS（查询/目录/幂等操作集） |
| `lib/ast/io-risk.js` | 修改 | +12 | judgeIoToken kind meta 分支 + gradeRisk meta 档 + rename 不再 repeated 加权 |
| `test/test-io-risk.mjs` | 修改 | +15 | 新增 meta 档用例（请求路径 existsSync → low；请求路径 readFileSync → medium 保持；rename 移 .trash → 不升 high；循环内 readdirSync+处理 → high 保持） |
| README/tree-doc | 修改 | 小 | 规则说明补「元数据操作档」 |

## 六、验证方案

- 单测：test-io-risk.mjs 新档位断言（meta 请求路径 low / 数据读写请求路径 medium / 循环内 high 不变 / rename 同卷不加权）
- 集成：theme 全量审计 io-risk 159 → 预期大降（误报收敛，真警告 2 处保留）；抽查 dsh-git-push 自身 io-risk 数对比
- 回归：全量测试 + 评分抽查
- 预期效果（方案第三节）：65 处中约 60 处降豁免/低风险，precision 3% → 大幅提升

## 七、是否执行？

请回复 **确认** 或 **修改方案**（调整点：meta 档范围是否含 readdir/mkdir、rename 是否降档、请求路径 meta 是否降 low 还是 medium）。
