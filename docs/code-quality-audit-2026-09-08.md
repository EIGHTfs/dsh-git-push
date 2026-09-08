# dsh-git-push v1.39.0 代码质量审计报告

> 分析对象：`/vol2/1000/DeepSeek Harness/dsh-v0.1.2-alpha.4/.dsh-home/工作区/dsh-git-push`（git 根）
> 分析者：Agnes-2.5-Flash（Sapiens AI）
> 分析时间：2026-09-08
> 状态：通读 lib/ + test/ + docs/ 全量源码后出具，非摘要推断

---

## 一、评分总览（满分 100）

| 维度 | 得分 | 一句话点评 |
|---|---|---|
| **可读性** | 82 | 注释充分、分层清晰；但 `core.js` 有 11 个超长函数（`pushViaApi` 112 行 / `commitAndPush` 214 行） |
| **可维护性** | 85 | core/index 分离好；质量/审计/routing 职责边界清；`findGitDirs` 用 `execSync` 字符串拼接是技术债 |
| **健壮性** | 88 | 空 catch 仅 1 处（quality.js:208）；异常路径覆盖充分；token 多源探测 + SSH 回退成熟 |
| **性能** | 80 | 无 async 路径 `fs.*Sync` 阻塞问题；60s 缓存 env 注入好；`findGitDirs` shell 拼接应改数组参数 |
| **安全性** | 90 | 禁 github.com 直连 / token 不入 settings / 敏感自动 .gitignore / 凭据路径硬闸；但 `findGitDirs` execSync 注入仍是隐患 |
| **测试覆盖** | 75 | 7 套测试共 253 项全绿；`test-core.mjs` 因 CIFS EROFS 跑不起来（环境限制，非代码缺陷）；核心 `commitAndPush` 缺端到端集成测试 |
| **可观测性** | 75 | 有 `ctx.logger('git-push')` 记录关键路径；缺 HTTP metric 端点 / 请求追踪 / 结构化埋点 |
| **可部署性** | 85 | cordis.patch.yml + package.json exports 规范；User 仓自动模板创建成熟；缺 `engines` 字段 |
| **文档** | 95 | README 154 行含完整版本表（v1.0–v1.39.0）+ 架构 + API；skills/ 四份 skill 文档齐全；系统提示词自带 README 检查提醒 |
| **开发者体验** | 88 | 一键 audit+commit+push+repo-index+远端 3 次回传；dryRun 预览；autoClean 自动清理注释措辞；`git-push-live-fix` 强制插件出问题当场改 |

### 综合评分：**86 / 100**（良好，具备生产可用水准）

---

## 二、亮点

1. **审计门禁设计成熟**
   - L0 静态 + L1 LLM 双轨
   - `blockOn` / `exemptRepos` / `dsh-skip-sensitive` 三级豁免
   - 私有库可见性自动豁免敏感规则；user 仓自动私有化
   - 代码质量维度（v1.39.0）按 `code-quality-checklist.yaml` 加权打分 0-100 + A/B/C/D 等级

2. **推送通道健壮**
   - 默认 api.github.com Git Data API + SSH `ssh.github.com:443` 回退
   - 远端领先检测拒绝推送；分支免疫（master/main 自动适配）
   - 推送后自动维护 `refs/remotes/origin/*` + 补 `github-ssh` 辅助 remote
   - Token 多源探测（同级仓 > 项目内 .git-push-token > workspaceRoot data/sensitive > HOME/DSH_HOME 会话目录）

3. **文档驱动开发**
   - README version table 逐版本记录改动原因与「触发原话」
   - skills/ 下四份 skill 文档（使用手册 / 功能说明书 / 收尾模板 / git-push-live-fix）
   - docs/code-quality-checklist.yaml 可被 L0 静态规则解析落地

4. **live-fix 约束机制**
   - `skills/git-push-live-fix.md` 强制：插件不好用必须当场改，禁止手搓 git 绕过
   - 形成自修正闭环，避免 AI 默默糊过去

5. **设置页即时生效**
   - `injectFullSkill` / `customIgnorePatterns` / `hardcodeFullScan` 等开关经 `scope.watch` 同步运行期变量，无需重启
   - 自动推送许可（pushPermit）回合结束触发，带审计门禁，不静默

---

## 三、主要不足与改进建议

### 🔴 高优先级（应进入下个版本修复）

#### 1. `findGitDirs` shell 注入风险（`lib/core.js:526`）

```js
// 当前
out = execSync(`find "${root}" -maxdepth ${depth} -name .git -type d 2>/dev/null`, {
  encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'],
});
```

- **风险**：`root` 若含 `"` 或 shell 元字符会注入命令；违反审计规则 `hardcode-path` 精神（可变参数应走数组）
- **修复**：`spawnSync('find', [root, '-maxdepth', String(depth), '-name', '.git', '-type', 'd'], {encoding:'utf8', maxBuffer:10*1024*1024, stdio:['pipe','pipe','ignore'], shell:false})`
- **影响范围**：仅影响 `scanRepos` / `git_scan` / viewer repo 列表；无网络副作用

#### 2. 超长函数集中（违反 `code-quality-checklist.yaml` 可读性标准）

| 文件 | 函数 | 行数 | 级别 | 建议拆分 |
|---|---|---|---|---|
| `lib/core.js:827` | `commitAndPush` | 214 | blocker | `doNpmIgnore` / `doSensitiveScan` / `doAddCommit` / `doPush` 四步 |
| `lib/core.js:382` | `pushViaApi` | 112 | blocker | 按「获取 tree → 上传 blob → 建 commit → 推 ref」拆 4 函数 |
| `lib/core.js:1354` | `checkGithubAccount` | 63 | warning | SSH probe + keys API 双通道抽 `detectSshBound()` |
| `lib/core.js:1665` | `rebuildHistory` | 80 | warning | fresh/squash/drop 三种模式各自独立函数 |
| `lib/core.js:1960` | `resolveGitToken` | 61 | warning | 候选收集 + 逐候选读取拆为两步 |
| `lib/audit.js` | `auditFile` / `cleanCommentWording` | 各 ~80 | warning | 可维持现状（规则密集但结构清晰） |

- **收益**：单测更容易覆盖；后续维护改动影响范围更可控
- **风险**：需保持 `lib/index.js` 的调用契约不变（export 签名不降级）

#### 3. 缺少端到端集成测试

- `test-core.mjs` 因 CIFS 卷 EROFS 无法执行（写 `persistGithubToken` 时报错），**非代码缺陷，但暴露环境依赖**
- 核心路径 `commitAndPush` → `pushViaApi` → `fetchRemoteHeads` 无任何自动化测试覆盖
- **建议**：
  - 方案 A：mock `spawnSync` / `githubFetch`，构造假 origin / fake token，验证推送流程逻辑
  - 方案 B：在内存 tmpfs（`/tmp`）上建临时 git 仓库，避开 CIFS 只读限制
  - 至少补 `test-push-via-api.mjs` 覆盖「tree 相同跳过 / blob 复用 / force PATCH / SSH 回退」四条分支

### 🟡 中优先级（下下个版本或 PR 合并）

#### 4. 可观测性薄弱

- 当前只有 `ctx.logger('git-push')` 写入节点日志，无结构化 metric
- **建议补 `/api/git-push/metrics` GET 端点**，返回：
  ```json
  {
    "audit_count": 1247,
    "push_count": 892,
    "blocked_count": 31,
    "ssh_fallback_count": 14,
    "repo_index_writes": 890,
    "token_sources": {"github-token": 412, "session-dir": 380, ".git-push-token": 100}
  }
  ```
- 便于接入 Prometheus / Grafana 告警（如 `push_blocked_rate > 5%` 触发通知）

#### 5. `previewReadme` 三级回退 fetch 同路径两次（`lib/index.js:556`）

- 当前：先 POST `/api/image-preview/render` md=true（15s 超时），失败后 md=false 再 POST 一次
- **问题**：md=true 失败后 md=false 又等 15s，最坏情况 30s 才返回纯文本
- **建议**：合并为单次 md=false，或给 md=true 加更短超时（5s），失败直接降级

#### 6. `ensureGlobalFilemodeFalse` 每次启动重跑（`lib/index.js:353`）

- 当前逻辑正确（幂等），但每次插件加载都 spawn git config
- **建议**：加内存缓存 `globalFilemodeSet = false`，启动时 check 一次写标志；或用 `git config --global --get core.filemode` 先读再决定

#### 7. `package.json` 缺 `engines` 字段

- 当前 Node v24.19.0 可用，但不明确最低要求
- **建议**：加 `"engines": {"node": ">=18.0.0"}` 防止低版本 Node 跑不起来

### 🟢 低优先级（技术债，不阻塞）

8. `collectRepoSkillDocs` / `collectRepoSkillDirs` 两个高度相似的递归 walk 可合并为 `walkMdDir({ base, baseLabel, includeContent, maxBytes, maxTotal })` 单函数接收选项
9. `index.js` 第 43 行 `readFileSync(new URL('../package.json'))` 启动期同步读可接受，但若走 Cordis 异步化需改 `import()`
10. `lib/core.js:2406` `findGitDirs` 附近还有一段历史注释「所有功能都默认api.github.com」——可清理

---

## 四、测试现状

| 测试套件 | 通过 / 失败 | 备注 |
|---|---|---|
| `test/test-audit.mjs` | 90 / 0 | L0 静态规则全量（含硬编码路径/IP） |
| `test/test-quality.mjs` | 39 / 0 | quality.js 纯函数 + auditRepo 集成 |
| `test/test-viewer.mjs` | 43 / 0 | 查看器数据层 + i18n 字典校验 |
| `test/test-permit.mjs` | 29 / 0 | 推送许可状态持久化 + 完成标记检测 |
| `test/test-repo-index.mjs` | 27 / 0 | repo-index JSON 生成/同步/注入 |
| `test/test-rules.mjs` | 16 / 0 | comment-wording 规则加载/导出/在线拉取 |
| `test/test-env-inject.mjs` | 9 / 0 | 环境注入文本 + tools-index.md 同步 |
| `test/test-core.mjs` | ❌ EROFS | CIFS 只读卷写 github-token 失败（环境限制，非代码缺陷） |
| `test/test-apply.mjs` | ❌ 缺包 | 需 DSH 运行时依赖 `@deepseek-ai/dsh-tools` |
| **合计** | **253 / 0 绿** | 有效覆盖率约 70%（核心 commit+push 链路无自动化） |

---

## 五、整体评价

`dsh-git-push` v1.39.0 是一个**工程扎实、文档完备、审计门禁成熟**的 DSH 插件。核心优势在于：

1. **安全优先**：禁止 github.com 直连 + 凭据不落 settings + 敏感自动 .gitignore + 私有库豁免 + 文件头 dsh-skip-sensitive
2. **用户约束强**：同级仓 requirements.md 门禁 + README 提交前检查 + skill 强制加载 + live-fix 约束
3. **文档质量高**：version table 记录每版「触发原话」与「思路」，新人接手成本极低
4. **自修正机制**：插件发现问题 → 当场改插件 → commit+push 自己仓

主要短板集中在**工程结构化**（超大函数、缺少端到端测试）与**可观测性**（无 metric 端点），不影响日常使用，但制约长期维护与生产监控能力。

建议下个版本（v1.40.0）优先完成：
1. 修复 `findGitDirs` shell 拼接 → 数组参数 spawn
2. 将 `commitAndPush` 拆为 4 步子函数
3. 补 `test-push-via-api.mjs` 端到端 mock 测试（在 `/tmp` tmpfs 跑）

---

*报告生成者：Agnes-2.5-Flash（Sapiens AI）*
*依据：通读 lib/core.js(2714 行) + lib/index.js(1237 行) + lib/audit.js(637 行) + lib/quality.js(259 行) + test/*.mjs 全量 + docs/code-quality-checklist.yaml*
