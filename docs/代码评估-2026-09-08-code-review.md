# dsh-git-push 工作区代码评估报告

> 评估人：DeepSeek Harness 代码审查代理（deepseek-v4-flash）
> 日期：2026-09-08
> 性质：只读评估，未修改任何现有文件（本报告为唯一新增文件）
> 评估对象：`workspace/dsh-git-push/`（GitHub: EIGHTfs/dsh-git-push，v1.39.0）

---

## 一、评估范围与方法

**覆盖**：`lib/` 全部 12 个 JS 模块（约 5900 行）+ 9 个测试文件 + README（154 行）/ package.json / skills×4 / docs×5 / template 2 文件，全部全文通读。

**方法**：主代理逐文件全文通读 + 3 个子代理独立深读交叉印证（分别负责 core.js 2714 行、index.js 1237 行、测试/文档/发布配置），并实测运行全部 9 个测试。

**说明**：`code_audit` 工具仅扫描未提交变更行（当前工作树干净故返回空），不构成全量评估依据，未采纳其结果。

**结论可信度**：三个独立子代理的报告与主代理自行通读结论交叉一致；测试运行结果为实测，非推测。

---

## 二、总评分：54 / 100（等级 C —— 可用但有明显技术债，建议逐步还债）

按仓库自带 `docs/code-quality-checklist.yaml` 权重加权（安全性 20% 权重最高）。

| 维度 | 得分 | 等级 | 一句话结论 |
|---|---|---|---|
| 可读性 | 75 | B | 中文注释/JSDoc 全、模块切分清晰，但考古式注释噪音 + 超长函数 |
| 可维护性 | 65 | B- | 12 模块单一职责做得好，但重复逻辑多处整块复制 |
| 健壮性 | 55 | C+ | 防御细节丰富，但 runGit 无兜底、破坏性路径不查 exit code |
| 性能 | 35 | D | **全链路 19 处同步子进程阻塞事件循环，是最突出的短板** |
| 安全性 | 40 | C- | 凭据处理有亮点，但 **HTTP API 零鉴权零 CSRF** + 多处 shell 拼接 |
| 测试覆盖 | 55 | C+ | 真实断言水准上游，但 **test-core 当前红**、GitHub 链路零覆盖、无 CI |
| 可观测性 | 40 | C- | core.js 零日志、静默 catch 遍地、错误不脱敏 |
| 可部署性 | 50 | C | CIFS/NAS 适配出色，但 **files 白名单缺运行时必需文件** |
| 文档 | 75 | B | README 教科书级，但 skills 版本漂移、注册不全 |
| 开发者体验 | 60 | C+ | 结构化报错友好，但 26 个配置项无首配引导、测试会污染真实凭据仓 |

**加权总分：54.2 ≈ 54/100**（按 checklist.yaml 的 dimensions_weight 计算：可读15/可维护15/健壮15/性能10/安全20/测试10/观测5/部署5/文档3/DX2）。十个维度简单平均 55 分，两个口径一致。

---

## 三、各维度详解（关键问题均带行号）

### 🔴 安全性 40/100 —— 最需要立即处理的维度

**Blocker 级**

1. **HTTP API `/api/git-push/*` 零鉴权、零 CSRF**（`lib/index.js:789-972`）
   - `GET /api/git-push/gen-readme?write=<任意路径>` 可任意写文件（core.js:1879-1882 无路径校验）
   - `rebuild+force=true` 可改写远端历史（index.js:940-950）
   - `commit` 不校验 repo 是否在扫描范围内（index.js:960-966）
   - `permit/config` 可一键开启全仓自动推送
   - 组合 = 本地任意端口可达时"任意文件写 + 数据外泄 + 历史破坏"攻击链；本机 127.0.0.1:30801 页面被恶意网页 CSRF 触发即可利用。

2. **origin URL 含 token 会被原样回显**：`readRepoStatus`（core.js:548）把 `git remote get-url origin` 原样塞进返回值 → `git_scan`/HTTP scan 整份回传。评估时发现本工作区 origin 即内嵌一个 ghp_ 明文 token——每次调用插件工具都会把它带进 AI 会话。需 `maskRemoteUrl` 脱敏。

3. **shell 拼接注入面**：
   - `findGitDirs`（core.js:526）`execSync(\`find "${root}" -maxdepth ${depth} ...\`)`——root 来自配置/HTTP 参数，含 `"`/`$(...)` 即注入
   - `GIT_SSH_COMMAND`（core.js:120/185）拼 `ssh -i "${keyPath}"` 进 env 由 git 内部 shell 执行

**Warning 级**

- `cloneViaApi`（core.js:2652）用 GitHub tree 的 `e.path` 直接 `join` 写盘，未拒绝 `../` 路径穿越；repo 名允许 `..`
- `gen-ssh-key force=true`（index.js:860-868）可把现有 `id_rsa` 改名废掉；响应字段 `privateKey` 实为路径（core.js:1171），命名误导
- `account-check` POST（index.js:854）未校验即 `persistSshPub` 覆盖 User 仓公钥
- 启动即写 `git config --global safe.directory=*`（index.js:360-367）——全局取消 git 目录信任保护，共享机器上是提权面
- token 长度校验三处不一致（core.js:2015 只认前缀 / 2262 前缀+长度 / 2424 要求 ≥40），截断 token 会被部分路径当有效

**亮点（正面）**：token 只走 Authorization header 不回显；凭据文件落盘 0600；`githubFetch` 硬闸 api.github.com + 拒跟 302（core.js:218-220）；git 调用全部参数数组化（无 `shell:true` 拼命令）；敏感扫描/自动 .gitignore/私有库豁免机制完善；`checkGithubAccount` 只回传 maskToken。

### 🔴 性能 35/100

- **全文件 19 处 `spawnSync`/`execSync` 同步调用**（core.js:21 起）——`gitRaw` 超时 600s、`runGit` 120s、ssh 探测 15s，任何一次卡住 = DSH 单进程事件循环冻结。这是全仓最突出的架构问题。
- **`runGit` 每次调用级联整套 User 仓探测**（core.js:118）：resolveUserSshKey → resolveUserDir → 多轮嵌套 spawn，一次 `git status` 背后 3~6+ 个子进程，无缓存。
- `pushViaApi` 逐 blob **串行** HTTPS 上传（core.js:449-463），上千文件仓库 N 次往返。
- `getDiff`（core.js:1919-1936）对 untracked 大文件全量 `readFileSync` 读入内存拼 diff——`isBinaryOrLarge`（core.js:1939）已定义却未调用，大日志/二进制直接撑爆。
- `githubFetch` 无重试/退避（core.js:213-247），5xx/429 一次失败。

### 🟠 健壮性 55/100

- **`runGit` 无 try/catch、无 maxBuffer**（core.js:116-131）：git 缺失（ENOENT）或输出超默认 1MB（如 core.js:1489 `git log --reverse` 全量）直接抛异常穿透所有调用方。
- **`rebuildHistory` 破坏性路径 exit code 大量未检查**（core.js:1675-1735）：tag/add/checkout --orphan/read-tree/commit 失败均静默继续，read-tree 失败会产出残缺历史还报告 ok。
- `autoCleanCommentWording` **审计前先写盘**（index.js:598-603），审计拦截/后续失败后改写残留不还原，逐文件半写状态。
- `resolveValidGitToken`（core.js:2028-2064）对每个候选 token 顺序 await 网络探测（每候选 2s 超时，最坏 ~20s），且网络异常一律判"无效"→ 有效 token 被跳过误走 SSH 回退。
- `readJson`（index.js:764-770）无 body 大小上限、无 error/aborted 监听 → 本地 DoS + handler 永不返回。
- `createUserRepoTemplate`（core.js:2593）`rmSync(dest, {recursive,force})` 与非空检查间有 TOCTOU。

### 🟡 测试覆盖 55/100

实测结论（子代理运行验证）：

- ✅ 8/9 测试独立可跑且**全绿**：audit 90 项 / viewer 43 / permit 29 / repo-index 27 / quality 39 / rules / env-inject。断言是**真实断言 + 真实临时 git 仓库**，不是走过场；test-audit 还自带"插件自身狗粮"自审，同类插件里属上游水准。
- ❌ **`test-core.mjs` 当前红**：`persistGithubToken`（test-core:181-189）越过 fixture 写到**真实同级仓 dsh-git-push-User**（resolveUserDir 按分数选中真实仓）——本机 EROFS 直接崩；可写机器上会把假 token 写进真实凭据仓。**测试隔离缺陷 + 真实污染风险。**
- ❌ **`test-apply.mjs` 跑不起来**：顶层 import `@deepseek-ai/dsh-tools` 等，但 package.json 无 devDependencies → ERR_MODULE_NOT_FOUND。**index.js 全部工具注册/门禁链路实际零可运行覆盖。**
- ❌ **零覆盖**：`client.js`、`llm.js` 无任何测试；core.js 的 GitHub 全链路（pushViaApi / cloneViaApi / fetchRemoteHeads / detectRepoVisibility / setRepoVisibility / checkGithubAccount）**无 mock、零覆盖**——而这是插件核心价值所在。
- ❌ 无 `scripts.test`、无 devDependencies、无 CI（`.github` 不存在）。

### 🟡 可部署性 50/100

- **`files` 白名单与运行期依赖脱节（发版必炸）**：package.json:12-16 只含 `lib/skills/cordis.patch.yml`，但 `core.js:2572-2573` 运行期读 `PLUGIN_ROOT/template/user-repo/*`（createUserRepoTemplate）→ **npm 安装后该功能必炸**。
- **`docs/code-quality-checklist.yaml` 被 .gitignore 排除且从未入库**，但 audit.js:617（`standard` 字段）、quality.js、README:21、test-quality:121-126 三处依赖它——克隆/npm 安装后 `locateQualityYaml` 返回 ''，测试直接红，评分回退默认权重。README 说"依据 yaml 权重"与真实行为不符。
- 硬编码 `/tmp` + 依赖外部 `find`/`cp -a`/`ssh-keygen`（core.js:184/526/1327/2704）——Windows 必炸，README 未声明平台限制。
- 无 `engines`/`license`/`repository` 字段。
- **亮点**：CIFS/NAS 适配（filemode=false、safe.directory、/tmp 中转建仓规避 chmod EPERM）是全仓最好的工程实践之一。

### 🟡 文档 75/100

- **README 是教科书级**：功能表、54 条版本记录、API 总览、配置、坑速查齐全——全仓质量最高的文档。
- 但：skills 版本漂移（`dsh-git-push.md` 标 v1.35.0、functions 标 v1.34.0，实际 1.39.0）；配置表缺 `injectRepoIndexFull`/`hardcodeFullScan`/`blockOn='none'` 新键；**`package.json dsh.skills` 只注册 4 个 skill 里的 2 个**（dsh-git-push-functions / git-push-live-fix 未注册，按名加载会失败）；README:49 单测命令漏 test-viewer/test-permit/test-quality 且含已红的 test-core；版本表漏 1.8.0；WORKBOARD-2026-09-06 状态表全 ✅ 但任务清单多项仍 `[ ]`，自相矛盾。

### 🟡 开发者体验 60/100

- 结构化错误返回（`{ok, error, findings, audit, remoteHeads}`）、回退链清晰、设置页引导完整——好。
- 但：约 26 个配置键无"核心/进阶/遗留"分组、无安装与首次配置章节；`requirementsConfirmed` 强门禁无引导（新用户首个提交大概率被拦）；**跑测试会写真实凭据仓**（最劝退）；错误返回形状 4 种混用（{ok,error} / {status,stdout,stderr} / {pushed,reason} / {ok,pushed,reason}）。

### 🟢 可读性 75 / 可维护性 65

- 亮点：12 个模块单一职责、纯函数可单测（core.js 不依赖 ctx）、每个函数有中文 JSDoc、变更溯源注释（"原代码/改为/思路"）让历史决策可追溯。
- 扣分：`commitAndPush` 214 行单函数嵌套 5 层；runGit/spawnGit 双封装重复（core.js:116 vs 2203）；drop-versions 过滤逻辑两处整块复制（1606/1704）；14 处重复 `remote get-url origin`；一文件 4 个版本声称（index.js L2 v1.36.0 / L68 v1.36.1 / L335 v1.38.0 / package.json 1.39.0）；20+ 处考古注释已成噪音；魔法数字（超时/计分权重）散落。

---

## 四、优先修复建议（按性价比排序）

1. **HTTP API 鉴权/CSRF**（安全性 blocker）：写操作端点加 Origin 白名单 + CSRF token；`gen-readme write` 限定仓库目录内；`rebuild`/`commit` 校验 repo 在扫描范围。
2. **`test-core` 隔离**（测试红 + 污染风险）：fixture 加 origin refs 抬高分数，或注入可替换的 `userRepoCandidates`，让 `persistGithubToken` 测试绝不触碰真实仓。
3. **`files` 白名单补 `template/` 与 yaml**（部署必炸）：把 `docs/code-quality-checklist.yaml` 入库（去掉 .gitignore 里过时的"YAML 非法"注释），files 补 `template`；发版前 `npm pack --dry-run` 核对。
4. **`runGit` 兜底**（健壮性）：try/catch + maxBuffer 16MB + `{status:null,error}` 返回。
5. **同步子进程异步化**（性能，长期）：至少把热路径（scanRepos/commitAndPush）改 `spawn`+Promise，User 仓探测加缓存。
6. **补 `scripts.test` + devDependencies + 最小 CI**：让 test-apply 可跑、让 GitHub 链路有 mock 测试。
7. **文档同步一次**：skills frontmatter 版本号、`dsh.skills` 注册全 4 个、README 测试命令对齐。

---

## 五、验证说明

- 所有 `lib/*.js`、`test/*.mjs`、README、package.json、4 个 skills、docs/ 全部文件、template 2 文件均已全文通读（core.js 2714 行分 6 段读满；index.js 1237 行读满）。
- 三个独立子代理分别对 core.js、index.js、测试/文档/发布配置做了全文深读并实测测试运行结果，与主代理自行通读的结论交叉一致。
- `code_audit` 工具仅扫描未提交变更行，当前工作树干净故返回空，不构成评估依据（已说明）。
- 全程只读，`git status` 干净，未修改任何文件；本报告为评估产生的唯一新增文件。

---

*本报告由 DeepSeek Harness 代码审查代理（deepseek-v4-flash）于 2026-09-08 生成，基于对 dsh-git-push v1.39.0 工作区代码的全文通读与独立子代理交叉审查。*
