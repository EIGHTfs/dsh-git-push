# WORKBOARD v2 —— dsh-git-push-v2 重构任务看板

> 状态：**重构进行中**（1.0.0 计划稿已提交 → 1.1.0 框架搭建中）
> 仓库：`工作区/dsh-git-push-v2`（新文件夹，git 已 init，`master` 分支）
> 关系：旧项目 `工作区/dsh-git-push`（v1.60.0）存档保留，作为自检扫描工具 + 经验来源
> 本板内容：总入口架构 → 每入口详细任务（思路 + 验收标准）→ 版本节奏 → 问题清单 → 坑与风险

---

## 〇、状态总览

| # | 总入口 | 状态 | 说明 |
|---|--------|------|------|
| 0 | 1.0.0 计划稿（README） | ✅ 已提交 ccfd1e5 | 10 总入口架构 + 问题对象 + 版本规范 + 问题清单 + 链接规则设计 |
| 1 | 规则总入口 | 🟡 骨架已写 | `lib/rule/registry.js` + `lib/rule/loader.js`；编译函数未注册、yml 槽位未落 |
| 2 | 审计总入口 | 🟡 骨架已写 | `lib/audit/index.js`（auditChanged/auditFull/auditWithScope）；检查实现未接 |
| 3 | git 总入口 | 🟡 骨架已写 | `lib/git/index.js`（runGit/commitAndPush/pushViaApi…）；具体实现待 1.1.3 |
| 4 | 自身总入口 | 🟡 骨架已写 | `lib/self/index.js`（VERSION/readmeTemplate/yamlTemplate）；模板未实现 |
| 5 | 评分总入口 | 🟡 骨架已写 | `lib/score/index.js`（10 维度权重/分维度计数/scoreQuality）；口径待校准 |
| 6 | 豁免总入口 | 🟡 骨架已写 | `lib/exempt/index.js`（7 标记注册表/exemptHint）；未接入审计 |
| 7 | 上下文注入 | 🟡 骨架已写 | `lib/context/index.js`；未接 audit 输出 exemptHint |
| 8 | HTTP API | ⏳ 未开始 | 鉴权设计见 §四-8 |
| 9 | 测试总入口 | ⏳ 未开始 | test/ 空；npm test 脚本已就位（node --test test/*.mjs） |
| 10 | 侧边栏 | ⏳ 未开始 | 复用旧项目 client.js 改造 |

---

## 一、架构回顾（一句话版）

**统一函数入口 + 注册表扩展：加能力不破坏主入口。** 十个总入口各自一个 `lib/<domain>/index.js` 门面 + 内部按 yml 字段/功能拆函数；`compileRule` 主体永不修改，加字段 = 加函数 + 注册一行。

---

## 二、开发纪律（每次提交必须遵守）

1. **不推送、不发布**——v2 全部 commit 只落本地 master
2. **每次提交前**：调旧项目扫描自检 `node ../dsh-git-push/cli.mjs audit . --json`（0 blocker 才提交）
3. **版本节奏**：1.1.0 框架能跑 → **每完成一个入口 commit 一次，第三位 +1**（1.1.1 规则 → 1.1.2 审计 → …）
4. **提交信息**：`<版本> <入口名>：做了什么（可验收）`
5. **README 同步**：每次版本变更后更新 README 版本表（readmeCheck 铁律）
6. **测试同步**：每个入口必须带 test-<name>.mjs，`npm test` 一条命令全绿

---

## 三、版本节奏（定稿）

| 版本 | 内容 | 状态 |
|------|------|------|
| 1.0.0 | README 文档（重构计划） | ✅ ccfd1e5 |
| **1.1.0** | **功能框架搭建完毕能跑**：目录结构 + 各入口骨架 + cli.mjs 最小可用 + npm test 绿 + 本看板 | 🔄 进行中 |
| 1.1.1 | 规则总入口（注册表 + 装载 + 首个编译函数落地） | ⏳ |
| 1.1.2 | 审计总入口（changed/full + 统一问题对象 + exemptHint 接线） | ⏳ |
| 1.1.3 | git 总入口（token/commit/push/clone/建仓/可见性） | ⏳ |
| 1.1.4 | 自身总入口（版本单一事实源 + README 模板 + yml 模板 + CLI 完善） | ⏳ |
| 1.1.5 | 评分总入口（口径校准 + 与审计闭环） | ⏳ |
| 1.1.6 | 豁免总入口（7 标记接入审计全消费点） | ⏳ |
| 1.1.7 | 上下文注入 + HTTP API + 测试总入口（npm test 可复现固化） | ⏳ |
| 1.1.8 | 侧边栏（复用旧 client.js 改造） | ⏳ |
| 1.2.0 | 链接判断 yml 规则（link-check kind，flaky 域名扣分打折） | ⏳ |
| 2.0.0 | 全入口完成：DSH 插件接线（cordis.yml 能挂）+ 双副本同步 + 推送准备 | ⏳ |

> 说明：1.1.0 是「骨架能跑」；1.2.0 把新能力（link-check）落地；2.0.0 才具备与旧项目同等的完整插件能力（可挂 DSH、可推送）。

---

## 四、每入口详细任务（思路 + 验收标准）

### 1. 规则总入口（1.1.1）

**思路**：从旧项目 7 编译函数 if/else 链 → 注册表。不强制 yml 写 kind，字段探测指派；但**显式 kind 优先**。新编译函数声明 `dimensions`（10 维度绑定，支持一字段多维度）。

**文件**：`lib/rule/registry.js`（已写骨架）/ `lib/rule/loader.js`（已写骨架）/ `lib/rule/compilers/*.js`（待写）/ `lib/audit-rules/*.yml`（待落）

**子任务**：
- [x] 注册表骨架：RULE_COMPILERS / registerCompiler / compileRule / compileAllRules
- [x] 装载骨架：loadYamlRuleFile / discoverRuleSlots / loadRuleFiles（后覆盖前）
- [ ] 编译函数 13 种：credential-ref / credential-file / secret / func-lines / min-length / max-lines / max-complexity / max-depth / min-occurrences / repeated-string / regex / path-regex / semantic
- [ ] 字段 → 编译函数映射表落库（三统一：kind kebab-case ↔ 函数 PascalCase ↔ 字段 snake_case）
- [ ] 首个 yml 槽位：audit-rules-nodejs.yml（含 5 条示范规则）
- [ ] 未知规则从「静默跳过」改「报错收集进 ctx.errors」
- [ ] dimensions 声明：每个编译函数返回的 rule 带 `dimensions: []`

**验收标准**：
1. `loadRuleFiles(['nodejs'])` ok，rule 条目编译全部成功
2. 显式 `kind` 优先于字段探测（构造同形状规则验证）
3. 未知字段组合报错进 ctx.errors，不静默
4. 编译产物每条带 dimensions（func-lines → ['可读性','可维护性']）
5. test-rule-packs.mjs：断言 ≥20 条（注册表行为 + kinds + dimensions）
6. `node cli.mjs ruleset` 输出编译统计

### 2. 审计总入口（1.1.2）

**思路**：`auditWithScope(repo, { scope })` 统一调度（默认 diff，设置 auditScanScope 可切 full）。**非 git 目录可查全量**。统一问题对象五要素带齐（file/line/rule/kind/dimensions/severity/exemptHint/scoreImpact）。gitignore 感知（默认排除 git 忽略文件）。

**文件**：`lib/audit/index.js`（骨架已写）+ `lib/audit/checks/*.js`（待写）

**子任务**：
- [ ] auditChanged：git diff HEAD → 逐变更文件跑规则
- [ ] auditFull：目录递归 → listTextFiles（git check-ignore 批量判定 + 缓存）→ 逐文件跑规则
- [ ] 检查器接线：syntax/JSON/YAML + residue + sensitive + style + func-lines + empty-catch
- [ ] 豁免消费：读文件时检查 dsh-skip-*（文件头=整文件 / 位置=单点）
- [ ] makeFinding 统一出口（已写）；结果带 `exemptHint`（来自豁免注册表）
- [ ] summary 统计（blocker/warning/total）+ quality 分数附加

**验收标准**：
1. 非 git 目录 `auditFull(dir)` 能出 findings（不依赖 .git）
2. gitignore 排除文件不出现在收集列表（有 .gitignore 的 fixture 目录验证）
3. 豁免端到端：文件头 dsh-skip-func-length → 该文件 func-lines 不报
4. 每 finding 必带 exemptHint（非空）
5. test-audit.mjs ≥25 断言：changed/full/豁免/gitignore 四象限
6. 与旧项目同 fixture 对比结果一致（回归锚点）

### 3. git 总入口（1.1.3）

**思路**：统一 runGit（数组参数零注入面、stderr 保留供排障——修旧项目 P0：stderr 被丢）。token 解析三层探测。push 默认 api.github.com Git Data API，401 回退 ssh.github.com:443。

**文件**：`lib/git/index.js`（骨架已写）+ `lib/git/github-api.js`（待写）+ `lib/git/credentials.js`（待写）

**子任务**：
- [ ] runGit 定稿（数组参数 + -C cwd + stderr 保留 + 超时）
- [ ] resolveToken：插件配置目录 github-token / env / 项目 .git-push-token → api.github.com token；401 回退 SSH
- [ ] commitAndPush：预检（README 检查 + requirements 门禁 + 敏感字段扫描 .gitignore）→ add → commit → push
- [ ] pushViaApi：blob → tree → commit → ref（Git Data API 四步）
- [ ] cloneViaApi：git/trees + git/blobs 递归拉取（不跟随 tarball 302）
- [ ] ensureRemoteRepo / setVisibility / rebuildHistory / versionHistory
- [ ] origin 去 token 化：检测 remote 内嵌 userinfo → 告警（修旧项目 P2-7）

**验收标准**：
1. runGit 数组参数：注入面为零（构造恶意参数验证无 shell 解释）
2. resolveToken 三层探测顺序固定，无人 token 时返回明确错误
3. commitAndPush 缺 requirements 确认 → 拦截（dryRun 验证）
4. 敏感字段文件自动 .gitignore（fixture 造 token 文件验证）
5. 401 回退 SSH：mock API 401 → 走 ssh.github.com:443
6. test-git.mjs ≥30 断言（git 操作在 /tmp 临时仓跑，不碰真实远端）

### 4. 自身总入口（1.1.4）

**思路**：版本单一事实源（VERSION 常量 + scan-version 校验 package.json 一致性）；README 模板**独立**（README 生成不走拦截 yml——用户明确：有 yml 规则控制的才归规则入口，README 是独立能力）；yml 模板 = 规则模板（示范 kind + dimensions）。

**文件**：`lib/self/index.js`（骨架已写）+ `cli.mjs`（部分已写）+ `scan-version.mjs`（待写）

**子任务**：
- [ ] VERSION 单源：package.json / cli.mjs / lib/self/index.js 三处一致（scan-version.mjs 自动校验）
- [ ] readmeTemplate：{{name}}/{{description}}/{{version}}/{{toc}}/{{versionTable}} 渲染
- [ ] yamlTemplate：规则模板（显式 kind + dimensions 示范）+ 豁免标记速查
- [ ] cli.mjs 完善：version / help / ruleset / scan / audit / commit 子命令 + --depth 解析（修旧项目 P0-3）
- [ ] cli HELP 文本 vs parseArgv 白名单一致（防 --depth 类回归）

**验收标准**：
1. `scan-version.mjs` 通过：三处版本号一致
2. `cli.mjs --help` 每个选项 parseArgv 都认（机器比对 HELP 选项集）
3. `cli.mjs yaml-template` 输出带 kind + dimensions 示范
4. `cli.mjs audit` 非 git 目录可跑
5. test-cli.mjs ≥10 断言

### 5. 评分总入口（1.1.5）

**思路**：10 维度权重沿用旧项目（可读15/可维护15/健壮15/安全18/性能10/测试10/可观测5/部署5/文档4/DX3）。问题 dimensions → 分维度计数 → 加权总分。**口径校准**：修旧项目假阴性（checkSyncInAsync 只认 fs.xxxSync 前缀——v2 改 AST 全量扫描；checkSilentCatch 只看首行——v2 看整函数体）。

**文件**：`lib/score/index.js`（骨架已写）+ 质量检查器（待写）

**子任务**：
- [ ] 权重表 + 分维度计数（已写）验证
- [ ] AST 化质量检查：sync-fs 全量（含 named import）、empty-catch 整函数体、func-lines 行数
- [ ] 评分口径文档化：测试/参考目录不计分（isDeliveryCode）
- [ ] audit 结果附加 quality（attachQualityScore）

**验收标准**：
1. 已知坏样本检出率 100%：构造 sync-fs（named import）、empty-catch（多行注释）、func-lines 超长 → 全中
2. 权重覆盖：qualityWeights 参数覆盖默认
3. 评分算式与旧项目同 fixture 结果一致（回归锚点）
4. test-quality.mjs ≥20 断言

### 6. 豁免总入口（1.1.6）

**思路**：7 标记注册表（已写）接入审计全部消费点。每个标记声明 `blocked`（哪些拦截类型）+ `dimensions`（豁免掉哪些维度）+ `hint`（位置语义）。问题输出自带 exemptHint。

**文件**：`lib/exempt/index.js`（骨架已写）+ audit 消费点（接线待写）

**子任务**：
- [ ] hasHeaderExempt / hasLineExempt 接审计文件读取管线
- [ ] exemptHintFor 反向查询（rule/kind → 标记 + 提示）
- [ ] 位置语义验证：size 只能文件头；func-length 文件头=全文件/函数行尾=单函数
- [ ] test-exempt.mjs ≥15 断言

**验收标准**：
1. 6 类豁免场景端到端通过（同旧项目 v1.60.0 12 个豁免场景）
2. exemptHint 非空且可直接使用（用户照抄即可豁免）
3. 对照：无标记文件出问题、有标记文件不出——逐类验证

### 7. 上下文注入（1.1.7 前半）

**思路**：给 AI 会话注入环境（cwd/项目根/skills 目录），systemPrompt section 组装。旧项目 v1.49.0 的 env 注入三开关沿用。

**文件**：`lib/context/index.js`（骨架已写）+ 插件装配（静态注入文本）

**验收标准**：
1. 注入文本含 cwd / 项目根 / skills 存在性
2. 开关关闭时不注入（配置可控）
3. test-context.mjs ≥5 断言

### 8. HTTP API（1.1.7 后半）

**思路**：修旧项目 P1-2 —— **写端点鉴权**：Origin 校验 + X-DSH-CSRF 头 + 高危端点（rebuild/gen-ssh-key/commit）确认参数。readJson 5MB 上限。路由全部走统一入口函数（不重复实现逻辑）。

**文件**：`lib/http/index.js`（待写）

**子任务**：
- [ ] 鉴权中间件：Origin allowlist + CSRF 头校验
- [ ] 端点：status/scan/audit/commit/rebuild/remote-create/permit/rules/diff/commits/repos/scan-comment-residue
- [ ] 写操作确认参数（rebuild force=true 需 body 带 confirm:true）
- [ ] 5MB body 限制 + 错误统一响应结构

**验收标准**：
1. 无 Origin / 错误 Origin → 403（写操作）
2. rebuild force=true 缺 confirm → 400
3. 超大 body → 413
4. 端点全部复用 lib 函数（零重复逻辑）
5. test-http.mjs ≥15 断言（mock req/res）

### 9. 测试总入口（1.1.7 收尾）

**思路**：`npm test` = `node --test test/*.mjs`（已修——旧项目 P0-2 的直接教训）；每个入口一个 test-<name>.mjs；失败退出非 0。

**子任务**：
- [ ] test-rule-packs / test-audit / test-git / test-cli / test-quality / test-exempt / test-context / test-http
- [ ] npm test 一条命令全绿
- [ ] 测试框架统一 node:test（不用双轨手写）

**验收标准**：
1. `npm test` 退出码 0；任一断言失败退出码 1（验证一个坏断言）
2. 全部套件 ≤ 60 秒
3. 无 test-apply 类「跳过依赖运行时」的花架子（v2 测试全可独立跑）

### 10. 侧边栏（1.1.8）

**思路**：复用旧项目 `lib/client.js` 改造（已定「复用」）：规则引擎槽位 + 权重滑块 + 豁免管理 + 版本信息 + 审计开关（默认关，本项目开发中一致开）。不引入 JSX/bundler（DSH 客户端无编译环境，手写 createElement）。

**子任务**：
- [ ] 移植旧 client.js 骨架（含 GitPushRuleCards / 权重滑块 / 槽位排序）
- [ ] 新增：审计开关（默认 off）+ 豁免标记速查展示
- [ ] controller/store 与配置双向同步

**验收标准**：
1. 侧边栏页零外部资源（纯内联）
2. 审计开关默认关闭；开启后 audit 结果展示
3. 配置变更即时生效（watch 监听）
4. 手写 createElement（无 JSX）通过 DSH 加载

### 11. 链接判断规则（1.2.0，新能力）

**思路**：新 kind `link-check`：扫描项目内 URL → 批量 HEAD 校验 → 报错扣分。**flaky 域名豁免**：github.com/api.github.com/raw.githubusercontent.com/npmjs.com 网络错误扣分打折（×0.2），DNS 失败且 flaky → 只记 debug；404/403 是大扣分（目标真不在）；只跑 warning 不拦截（防网络假阳性 blocker）。

**文件**：`lib/rule/compilers/link-check.js` + url 抓取器（待写）

**子任务**：
- [ ] URL 提取：正则扫文件（http/https 完整链接）
- [ ] HEAD 校验：并发 5、超时 5s、重试 1 次
- [ ] 扣分映射：404=3 / DNS=2 / timeout=1 / other=1，flaky ×0.2
- [ ] 维度绑定：文档
- [ ] domains 白名单配置（可加自己的 flaky 域名）

**验收标准**：
1. fake server 起 404/500 端点 → 正确分级扣分
2. flaky 域名 mock 网络错误 → 扣分打折
3. 断网环境下 run → 不 blocker（warning 上限）
4. 扫描 100 链接 ≤ 30 秒
5. test-link-check.mjs ≥10 断言

---

## 五、问题清单（五份报告 → v2 自检，防再犯）

| # | 已证实问题 | v2 对策 | 覆盖轮次 |
|---|-----------|---------|---------|
| 1 | 死导入/未使用导出 | unused-import/export 自检规则 | 1.1.2 |
| 2 | 真空 catch | empty-catch 检查器（整函数体） | 1.1.2 |
| 3 | js-yaml 未声明 | package.json 显式 (已做) + npm 规则自检 | 1.0.0 已做 |
| 4 | npm test 坏 | test/*.mjs 显式 glob (已做) | 1.0.0 已做 |
| 5 | CLI --depth 文档/实现不符 | cli-help-sync 机器比对 | 1.1.4 |
| 6 | README/工具数滞后 | doc-sync 自检 | 1.1.4 |
| 7 | HTTP 写端点无鉴权 | Origin+CSRF+确认参数 | 1.1.7 |
| 8 | quality 假阴性 | AST 全量检查 + 坏样本回归 | 1.1.5 |
| 9 | 同步 fs 204 处 | sync-fs AST 检查器 | 1.1.5 |
| 10 | 凭据卫生 | credential-in-url 告警 | 1.1.3 |
| 11 | 链接拼接错误 | link-check 规则 | 1.2.0 |
| 12 | 配置被忽略 | config-ignored 自检 | 1.1.3 |
| 13 | 门禁链路漏接 | gateway-chain：全部提交入口强制 requirements | 1.1.3 |
| 14 | 循环依赖 | circular-import 检查 | 1.1.2 |
| 15 | 文档措辞被拦截 | docs-conversation + 输出改写建议 | 1.1.2 |

---

## 六、坑与风险

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| 注册表退化回 if/else | 中 | 高 | 代码审查铁律：compileRule 只有注册表循环；新增规则=注册一行 |
| link-check 网络假阳性 | 中 | 高 | 只 warning 不 blocker + flaky 折扣 + 断网兜底 |
| git 操作污染真实仓库 | 低 | 高 | 测试全部在 /tmp 临时仓；commit 前 git-remote 检查 |
| 侧边栏移植破坏旧 UI | 中 | 中 | 先移植骨架跑通，再逐组件改；DSH 加载验证 |
| 版本号漂移 | 低 | 中 | scan-version.mjs 校验三处一致 |
| 评分口径漂移 | 中 | 中 | 同 fixture 与旧项目对比锚定 |
| 豁免标记语义混乱 | 中 | 中 | 注册表注释 + 测试逐类验证位置语义 |

---

## 七、执行记录

| 版本 | commit | 内容 | 自检 |
|------|--------|------|------|
| 1.0.0 | ccfd1e5 | README 计划稿（架构/问题清单/链接规则） | 旧项目扫描 0/0 ✅ |
| 1.1.0 | （本批） | 框架骨架 8 入口 + cli.mjs + test 16 断言 + scripts/check + 本看板 | 旧项目扫描 0 blocker ✅（初扫 1 blocker docs-conversation 已修） |