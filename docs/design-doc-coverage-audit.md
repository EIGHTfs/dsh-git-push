# 设计：新增审计 kind `doc-coverage`（文档覆盖度守卫）

> 状态：**设计稿（待插件维护者实现）** ｜ 提出：2026-10-03 ｜ 提出方：DeepSeekHarness-NAS 侧（EIGHTfs 会话）

## 1. 要解决的问题

项目里"外部需要知道才能正确使用或排障"的机制，**经常只活在代码注释或数据文件的注释里**，
README 没有权威出处。实测（DeepSeekHarness-NAS，2026-10-03 机械审计）：

- 代码中出现的 **63** 个机制标识里，**35 个在 README 出现 0 次**；
- 典型：`build-lib.sh`、`learn-prune-whitelist.sh`、`fix-runtime-deps.sh`、`fix-pnpm-store.sh`、
  `PRUNE_BEFORE_INSTALL`/`PRUNE_BEFORE_BUILD`、`NPM_MODE`、`PRUNE_COMMON_DIR`、`DRY_RUN`；
- 更糟的是**机制说明写在数据文件注释里**（如 `build-prune-whitelist.json` 的 `_extraNote`），
  README 只字未提 —— 新人（含 AI）读码时无从发现，排障时也想不到。

这类问题的特征是：**靠自觉必然漏**，但**完全可机械检查** → 适合做成审计规则。

## 2. 设计原则（与既有架构一致）

1. **逻辑留在被审计的项目仓库，插件只做封装调用** —— 与既有先例 `tree-doc` 一致
   （`tree-doc` 封装 `scripts/tree-doc.mjs`，不重写逻辑）。
   → 本项目已提供 `scripts/check-readme-coverage.py`，**插件不得用 JS 重写同一套逻辑**
   （否则就是两份会漂移的真相）。
2. **kind + 规则**：新增一个 **kind**（检查器实现），规则写在 `lib/audit-rules/audit-rules-docs.yml`
   → 自动进入既有审计门禁（blocker/评分）、`ruleset` 统计与 `commit` 前拦截，无需新子命令。
3. **不联网、确定性**：纯本地文件扫描，可在 CI 与离线环境跑。

## 3. 被封装脚本的契约（已就绪，勿改）

`<项目根>/scripts/check-readme-coverage.py`：

```bash
python3 scripts/check-readme-coverage.py          # 人类可读；有缺口 → 退出码 1
python3 scripts/check-readme-coverage.py --list   # 只列缺口；始终退出码 0
python3 scripts/check-readme-coverage.py --json   # 机器可读
```

`--json` 输出（stdout 单行 JSON）：

```json
{"ok": true, "checked": 44, "exempt": 22, "gaps": []}
{"ok": false, "checked": 44, "exempt": 22,
 "gaps": [{"id": "DRY_RUN", "count": 36, "example": "scripts/fix-pnpm-store.sh"}]}
```

- `ok`：无缺口为 `true`；
- `checked`：参与检查的标识数（已排除豁免）；
- `exempt`：脚本内 `EXEMPT` 集合大小（内部实现变量，已在脚本内注明理由）；
- `gaps[].id`：缺失标识（开关名或脚本名）；`count`：代码中出现次数（可作权重）；
  `example`：一处示例文件（相对项目根的路径）；
- 退出码：`--json` 模式下 `ok=false` → 1（便于 CI 直接串）。

**扫描口径**（脚本内部，插件不必关心）：开关类标识
（`PRUNE_*`/`DSH_*`/`BUILD_STAGE`/`NPM_MODE`/`DRY_RUN` 等）与脚本名
（`build-*`/`gen-*`/`learn-*`/`prune*`/`fix-*`/`clean-*`/`install-*`/`fetch-*`/`verify-*`/`migrate-*`/`promote-*` 的 `.sh`/`.py`）；
跳过 `node_modules`/`.git`/`master-build`/`staging`/`.trash`/`src/`/`tools/pnpm/dist`/`tools/node-dist`/`assets/`。

## 4. 建议的 kind 实现要点

### 4.1 规则声明（示例，写进 `audit-rules-docs.yml`）

```yaml
  - id: doc-coverage
    kind: doc-coverage
    name: "文档覆盖度（脚本/开关必须在 README 出现）"
    category: "documentation"
    severity: "warning"        # 建议先 warning 观察一段；稳定后可升 error
    description: "扫描代码里的开关名/脚本名，逐个检查是否在 README 出现；缺失列清单并计分。"
    script: "scripts/check-readme-coverage.py"   # 相对项目根；缺省即此值
    python: "python3"                             # 解释器可配
    max_gaps_reported: 40                         # 输出上限（避免刷屏）
    score_per_gap: -0.5                           # 每条缺失扣分
    score_cap: -5                                 # 扣分下限（防单规则压垮总分）
    ignore_ids: []                                # 项目侧临时豁免（应优先改脚本 EXEMPT 并写明理由）
    timeout_ms: 30000
```

### 4.2 执行与解析

1. 定位脚本：`<审计根>/<script>`；**不存在则返回 `skipped`**（不是失败 —— 未采用该约定的项目应静默跳过，避免噪音）。
2. 执行：`python3 scripts/check-readme-coverage.py --json`，cwd = 审计根；捕获 stdout/stderr、退出码、耗时；
   超时按 `timeout_ms` 终止并记 `error`。
3. 解析：取 **stdout 最后一行**做 `json.loads`（脚本可能先打印别的行；容错解析，解析失败 → `error` 并附 stderr 尾部）。
4. 映射：
   - `ok=true` → `pass`，`score=0`，`note="checked=N exempt=M"`；
   - `ok=false` → 按 `gaps` 生成条目：每条 `message="<id> 未在 README 出现（代码 N 次，例：<example>）"`，
     `severity` 取规则值，`score += score_per_gap`（受 `score_cap` 约束）；
   - 退出码 2（脚本自身错误，如 README 缺失）→ `error`，附 stderr。
5. `ignore_ids` 命中的 gap 不计数，但要在报告里标注 `ignored`（可见即可追溯）。

### 4.3 与门禁的关系

- `severity: warning` 时只扣分不拦提交 ✓（推荐起步）；
- 若项目想硬拦，把规则改成 `severity: error` 即可进入 blocker 体系；
- 与 `link-check` 的分工：`link-check` 管**链接有效性**（联网、flaky），本 kind 管**机制是否被文档覆盖**（离线、确定）。

## 5. 验收标准

1. 在 **DeepSeekHarness-NAS** 仓库上跑 `audit`：本 kind 输出 `pass`，`checked=44`（该仓库当前状态）；
2. 人为制造缺口（例如在任一脚本里新增 `DSH_FOO_BAR` 且不写进 README）→ 规则报 1 条 gap、按 `score_per_gap` 扣分、退出码/评分符合预期；
3. 在**没有** `scripts/check-readme-coverage.py` 的仓库上跑：`skipped`，**不产生噪音、不失败**；
4. 脚本超时/异常时：`error` 且附 stderr 尾部，**不把审计整体弄崩**；
5. `ruleset` 统计里能看到该规则（槽位 `docs`）。

## 6. 参考

- 被封装脚本：`DeepSeekHarness-NAS/scripts/check-readme-coverage.py`
- README 侧规范章（锚点）：`DeepSeekHarness-NAS/README.md#prune-whitelist`（"裁剪白名单：三层来源 + 自动学习"，含**失败症状对照**表）
- 既有同类先例：`tree-doc` 封装 `scripts/tree-doc.mjs`；`link-check` 的 kind 实现与规则写法
- 背景数据：63 个机制标识中 35 个 README 0 次（2026-10-03 审计）；收敛到 0 的过程：
  `d9f42f5`（守卫脚本）→ `ae845f6`（CI 接入 + 豁免）→ `76caff3`（--json 修复）
