---
name: dsh-git-push
description: dsh-git-push 插件（git 自动提交推送 v1.31.0，README 模板在同级仓 dsh-git-push-User/readme-template.md）的使用手册：git_scan / git_commit_push / git_clone / git_remote_create / code_audit 工具与 /api/git-push API 的调用方法、配置（审计 blockOn/llmAudit、硬编码路径/IP、注入开关 injectFullSkill、自定义忽略 customIgnorePatterns、SSH 邮箱生成公钥）、验证与坑速查。处理"提交推送代码""扫描仓库状态""审计代码""推送前拦截 bug""敏感信息检测""硬编码路径""文档被审计拦截""生成 SSH 公钥""SSH 连不上"类请求时加载；插件不可用/报错排查时必加载（正常情况优先用插件，见 plugin-priority）。上下文注入实现定位：lib/index.js 搜「上下文注入」注释块（agent/pre-step 钩子）。
whenToUse: 需要用插件做 git 提交推送/代码审计但不确定参数/报错排查/插件未装需手做时。
generatedBy: grok-4.6 · 2026-09-03
---

# dsh-git-push 插件手册

> 插件源码：`workspace/dsh-git-push/`（GitHub: EIGHTfs/dsh-git-push）。定位：把"扫描仓库 → **审计** → 一键 commit+push"固化为代码管道（零 token、确定性）。v1.1.0 起内置代码审计门禁（代码审计独立插件已停用并入本插件）。**正常情况优先调插件工具，本 skill 是手册（排查/未装时用）**——见 plugin-priority skill。

## 一、工具（agent 会话内直接调用）

| 工具 | 参数 | 说明 |
|---|---|---|
| `git_scan` | 无 | 扫描 workspace 全部 git 仓库 → 分支/remote/未提交变更数/最近活动 |
| `git_commit_push` | `repo`, `message`(必填), `push?`, `dryRun?`, `audit?`(默认true), `llmAudit?`(默认false) | **先审计** → add -A → commit → push；成功后回传远端最近 3 次 SHA/标题/时间 |
| `code_audit` | `repo`, `llm?` | 手动审计仓库：L0 静态（默认）+ L1 LLM（llm=true） |
| `push_permit_status`（v1.24.0） | 无 | 查「AI 回复推送许可」开关 + 最近一次自动检测/推送记录 |
| `push_permit_config`（v1.24.0） | `enabled`(bool), `pushScope?` | 切推送许可（默认关闭）；`pushScope`=all（默认）/ session |

用法示例：`git_scan` 看改动 → 先 `code_audit {repo:"...", llm:true}` 自查 → `git_commit_push {repo:"...", message:"feat: xxx", push:true}`（审计通过才推）。

## 二、开发者特殊要求门禁（v1.10.0）

- 启动时 `agent/pre-step` 注入本仓 `skills/` 与同级仓 `dsh-git-push-User` 全部 md（每个 agent 一次；v1.28.0 起受 `injectFullSkill` 开关：勾选=注入全文，默认只列目录清单）
- **功能说明书强制注入（v1.28.1）**：`skills/dsh-git-push-functions.md`（插件每个功能一份说明书）经 `systemPrompt.section` 系统提示词通道**无条件全文注入**每个会话，不受 `injectFullSkill` 设置影响（text 用函数动态读文件，文件更新即生效）。实现定位：`lib/index.js` 搜「上下文注入」
- **README 模板（v1.23.0）**：`git_gen_readme` 读同级仓 `dsh-git-push-User/readme-template.md`（或 `User/<用户名>/readme-template.md`）；没有才用插件内置。占位符 `{name}` `{description}` `{version}` `{toc}` `{versionTable}`（模板语法实际为双花括号包裹；本手册可能被全文注入，双花括号会触发 DSH 模板引擎报错，故以单花括号书写）
- 同级仓 `dsh-git-push-User/requirements.md` 放开发者特殊要求清单（独立私有库，不进插件目录）
- `git_commit_push` 提交前自动读取并逐条核对：未核对（不带 `requirementsConfirmed:true`）直接拦截返回清单；AI 逐条确认达标后重新调用
- 启动时若同级仓缺失，插件用 `git_clone`（api.github.com）拉到工作区与 `dsh-git-push` 同一层级
- **可执行位（v1.18.4）**：启动时 `git config --global core.filemode false`；`runGit`/`gitRaw` 每次带 `-c core.filemode=false`。CIFS 上 100644↔100755 不再进 status/commit
- **设置页凭据（v1.20.0 / v1.21.0 / v1.23.1 / v1.29.0 置顶）**：入口 = 设置 → 插件 → 插件配置 →「Git 提交推送」。**v1.29.0 起账号状态块置顶**：卡片展开自动跑一次 Token/SSH 检测（多行块显示用户名 / id / 主页 / Token 可用性 / SSH 公钥绑定状态），无需手动点「检测可用」（按钮仍保留）。公钥是否已绑：先 GET `/user/keys`；token 无权读列表（常见只有 `repo` → 404）时改打 `ssh.github.com:443`，`Hi <login>!` 即已绑定
- **SSH 邮箱 + 生成公钥 + 一键复制（v1.29.0 / v1.30.0）**：设置卡「SSH 邮箱（生成公钥用）」输入邮箱 → 点「生成公钥」→ 后端 `ssh-keygen -t rsa -b 4096 -C <邮箱>`（写同级仓 `id_rsa` 私钥 600 + `id_rsa.pub` 公钥 644），公钥整行回显在卡片里，**v1.30.0 起点「📋 一键复制」直接复制到剪贴板**（secure context 用 navigator.clipboard，否则 textarea+execCommand 兜底），再粘贴到 GitHub → Settings → SSH and GPG keys → New SSH key 绑定。已存在私钥拒绝（防覆盖），force 时旧密钥改名 `id_rsa.bak-<时间戳>` 备份。生成的公钥绑定后，推送失败回退 SSH / `git fetch github-ssh` 即可用
- **设置页新增项（v1.28.0 / v1.29.0 保存反馈 / v1.30.0 即时生效）**：同卡片下方——①「注入全部 skill 内容」勾选框（injectFullSkill）：勾选 = 每个会话 pre-step 注入两仓全部 skill 正文，不勾选（默认）= 只注入 skill 目录 + 文件清单；②「自定义忽略文件」输入框（customIgnorePatterns）：逗号/换行分隔 gitignore 模式（如 `*.bak*`），提交时自动追加目标仓库 .gitignore。两项**改即存并回显「已保存并生效」**（v1.29.0，4 秒后消失），无需点保存按钮；**v1.30.0 修复**：设置页改动由 settings scope.watch 实时同步到运行期（此前是启动时一次性常量，勾选不生效），改完**立即生效**无需重启
- **推送后远端 ref 维护（v1.29.0）**：Git Data API 推送不会自动更新本地 `refs/remotes/origin/*`（origin 是 api.github.com REST 端点，`git fetch origin` 必 403）——推送成功后自动 `git update-ref refs/remotes/origin/<branch>`（用本地 HEAD sha 内容等价写入，`git log origin/master` 可看远端最新）+ 自动补 `github-ssh` 辅助 remote（`ssh://git@ssh.github.com:443/<owner>/<repo>.git`，标准 `git fetch github-ssh` / `git pull github-ssh <branch>` 可用；同名自设 remote 不覆盖）
- **推送后远端 3 条（v1.21.0 表格）**：`git_commit_push` 推送成功后带 `remoteHeads` + `remoteHeadsText`（Markdown 表格：# / SHA / 标题 / 时间）。AI 必须用表格发给用户，不得改成编号列表

### 推送通道（v1.18.3：默认 api.github.com，token 无效回退 SSH）

- **clone（v1.17.0）**：`git_clone` 走 api.github.com Git Data API（git/trees + git/blobs，不下 tarball；target=owner/repo 或 URL 只解析不访问；自动探测默认分支 master/main；/tmp 中转建仓整拷回 dest 兼容 CIFS；dest 非空拒绝；origin 写成 `https://api.github.com/repos/o/r`）
- **默认通道 = api.github.com Git Data API**（pushViaApi：blob→tree→commit→ref，复用远端已有 blob sha）——统一 `githubFetch`（hostname 硬闸 + 拒绝跟随 302）
- **token 无效回退 SSH（v1.18.3）**：无 token 或 API 返回 401 / Bad credentials 时，用同级仓 `dsh-git-push-User/id_ed25519` 走 `ssh.github.com:443`。禁止 `git push github.com` / HTTPS
- token 多源探测 resolveGitToken：同级仓 `dsh-git-push-User/github-token` → 项目 `.git-push-token` → workspaceRoot data/sensitive → HOME/DSH_HOME 会话目录
- 本机无 SSH 私钥且 token 失效：push 失败，需更新 token 或把公钥加到 GitHub

### 同级仓 dsh-git-push-User（v1.18.0，不再进插件目录）

- 开发者特殊要求 + git skill + 本机凭据（token/SSH）在独立私有库 **`EIGHTfs/dsh-git-push-User`**
- **不要**再 clone 进插件 `User/`：安装拷贝会清空插件目录。恢复到与插件同一层级：
  ```
  git_clone { target: "EIGHTfs/dsh-git-push-User", dest: "<工作区>/dsh-git-push-User" }
  ```
- clone 仍走 **api.github.com**；push 在 token 失效时才用 SSH 443，不用 github.com HTTPS

## 三、审计（v1.1.0 内置，重点）

- **npm 下载产物屏蔽（v1.6.0，add 前自动）**：每次 commitAndPush 先调用 `ensureNpmIgnored()`——确保仓库 .gitignore 幂等覆盖 `node_modules/` + 常见 lock 文件（package-lock/yarn.lock/pnpm-lock.yaml/bun.lock）+ npm 缓存/日志（.npm/、.pnpm-store/、npm-debug.log*）。不覆盖已有 .gitignore 内容，只追加缺失条目。效果：「上传推送检查屏蔽下载的一堆 npm 包」——npm 产物不进变更、不进审计、不进 git。**单测 + 端到端（真实 git 仓库 + node_modules + lock）均通过**。
- **L0 静态检查（零 token，默认开）**：JS 语法（node --check）/ JSON / YAML / 敏感信息硬编码（GitHub PAT、sk- key、密钥键值对）/ **本机路径与局域网 IP 硬编码（v1.31.0：hardcode-path / hardcode-ip）** / 凭据文件入库（.env/.credentials）/ 二进制大文件（>1MB）/ debugger 残留 / console.log≥5 / TODO/FIXME
- **文档措辞拦截 docs-conversation（v1.4.0，blocker）**：对文档文件（md/markdown/mdx/txt）的**新增行**检查「AI 与用户沟通过程」类措辞（会话引用 / 用户决策来源 / AI 许可表述 / 商量转述等），命中即拦截——公开仓库只提交「做了什么」，沟通/需求/移交/待办类文档统一放 `data/沟通文档`（清单见 release-docs-rule）
- **L1 LLM 深度审查（默认关，省钱）**：diff 喂便宜模型找逻辑/安全问题，实测 agnes-2.5-flash 精准检出越界/空值/除零/fetch 未检查 res.ok 等 bug
- **硬编码路径/IP（v1.31.0，hardcode-path / hardcode-ip）**：代码/JSON/YAML 字符串字面量出现本机绝对路径（NAS 卷、用户家目录、挂载点、数据根）或局域网私网 IP → **blocker**；文档同样命中 → **warning**。**不跟私有库豁免走**（换机必炸与可见性无关）。豁免：文件头 `dsh-skip-sensitive`、示例词整行、占位符 `<workspaceRoot>` / `$HOME`、临时目录与系统通用路径、回环/监听地址、环境变量与相对路径
- **拦截策略 blockOn**：`blocker`（默认，仅严重问题拦截）/ `any`（任何问题拦截）
- 审计范围 = 工作区相对 HEAD 变更（**含 untracked 新文件**，LLM 也看得到）
- 拦截时 commit 返回 `{ok:false, error:{code:'AUDIT'}, findings}`，不产生提交

### 豁免类型（v1.5.0 已实现为机器闸门，防误伤）

| 豁免类型 | 说明 | 示例 |
|---|---|---|
| **说明类（示例凭据）** | 文档/README/示例代码中**用于举例的假凭据**不报敏感信息——值含 假/fake/示例/演示/sample/demo 或占位符（your- 前缀、xxx、example 等），或行内含「例如/举例/示例」等示例词整行豁免 | 「用户名: 假用户 / 密码: 假密码」（中文假值）或 `user: your-username / password: your-password`（占位符） |
| **备份类（私有库）** | 配置 `exemptRepos` 白名单（仓库绝对路径或目录名）后，命中的**私有/备份仓库**跳过敏感内容规则（secret / 凭据文件 / 对话措辞），其余规则照常；审计结果标注 `exempted:true` | `exemptRepos: ['ai-work-archive']`（私有归档可存 token/会话总结） |
| **私有库自动豁免（v1.14.0）** | commitAndPush 自动探测 GitHub 仓库可见性（GET /repos/{o}/{r} 读 private 字段，复用 resolveGitToken）：**private → 敏感字段自动 .gitignore 只扫描报告不写入**（`sensitiveExempted` 标注），审计同步跳过敏感内容规则；探测失败/无 origin/无 token → 保守不豁免 | `EIGHTfs/dsh-git-push`（private）提交含密码字段的源码不再被自动 gitignore |
| **注释豁免（v1.14.0）** | 敏感信息可通过注释申请豁免：**文件头前 3 行**或**行内注释**带 `dsh-skip-sensitive` 即跳过敏感扫描（自动 gitignore + 审计 secret/凭据/对话措辞/硬编码路径 IP 同认） | `// dsh-skip-sensitive` 放文件头 → 整文件豁免；`password = "x" // dsh-skip-sensitive` → 仅该行豁免 |

**判定原则**：公开仓库只提交「做了什么」，示例凭据必须是**假的**（真实凭据哪怕一行也禁止）；私有备份仓库的敏感信息上传通过 `exemptRepos` 白名单放行（语法/JSON/YAML/大文件检查仍生效）；v1.14.0 起私有库可见性=private 自动豁免敏感自动 gitignore，源码文件如需入库可加 `dsh-skip-sensitive` 注释声明（或依赖只认字符串字面量的根因修复）。

## 三、HTTP API

| 接口 | 说明 |
|---|---|
| `GET /api/git-push/status` | 插件状态（版本 + 配置 + 审计开关 + git 版本） |
| `GET /api/git-push/scan` | 扫描全部仓库状态 |
| `GET /api/git-push/audit?repo=<路径>&llm=true` | 审计指定仓库（llm=true 追加深度审查） |
| `POST /api/git-push/commit` | `{repo, message, push?, dryRun?, audit?, llmAudit?}` 审计通过后提交推送（curl 用 `-H 'Content-Type: application/json'`） |
| `GET /git-push/viewer`（v1.24.0） | **提交历史查看器页面**（只读；设置 → 插件配置 → Git 提交推送 卡片「打开提交历史查看器」进入） |
| `GET /api/git-push/repos`（v1.24.0） | 查看器用：扫描仓库（支持 `root`/`paths`/`extraReposFile` 查询参数覆盖） |
| `GET /api/git-push/commits?repo=&limit=`（v1.24.0） | 查看器用：仓库提交历史（含每文件 numstat） |
| `GET /api/git-push/diff?repo=&commit=&file=`（v1.24.0） | 查看器用：单文件 diff（行级 JSON；根提交自动回退 git show） |
| `GET /api/git-push/permit/status`（v1.24.0） | 推送许可状态（AI 回复 ✅ 是否自动 commit+push；默认关闭） |
| `POST /api/git-push/permit/config`（v1.24.0） | `{pushOnComplete: true/false, pushScope?}` 切换推送许可 |

测试实例地址：`http://127.0.0.1:3083/api/git-push/status`（局域网反代 3084）。查看器：`http://127.0.0.1:3083/git-push/viewer`。

## 三乙、提交历史查看器（v1.24.0 整合 git-commits-viewer；v1.25.0 多语言 + 手动选择）

- **入口**：设置 → 插件 → 插件配置 →「Git 提交推送」卡片内「打开提交历史查看器」按钮（新窗口 `/git-push/viewer`）
- **功能**：仓库列表（来自插件扫描配置，含 extraReposFile 实时读取）→ 提交历史（类型过滤 / 分页 / 每提交文件与增删统计）→ 单文件 diff（行级）
- **多语言（v1.25.0）**：UI 文案在 `lib/viewer-locales.js` 配置文件（zh/en 字典，键集合必须一致——test-viewer 校验）；**默认中文**；右上角「中/EN」按钮运行时切换，localStorage 记忆偏好，刷新后保持
- **手动选择本地仓库（v1.25.0）**：侧边栏输入框填仓库绝对路径或含 .git 的目录 → 只读扫描（先 `paths=` 单仓库、再 `root=` 目录，复用 `/api/git-push/repos` 参数）；手动仓库带「手动」徽标，可直接看提交/diff
- **只读**：无 push 按钮、无任何写 git 的 API；推送一律走 `git_commit_push` 工具（带审计）
- **安全**：repo 参数接受扫描仓库精确匹配 + 手动输入路径（仅做只读 git log/diff，无写操作）；commit id 白名单 4-40 hex；git 全部经 core.js runGit（spawnSync 数组，无 shell 拼接）
- **避坑**：单份实现（不复刻旧 generate.js/static-server.js 双份代码）；路径全复用插件配置（不硬编码）；页面内嵌样式脚本零外部资源；页面显示插件版本号

## 三丙、AI 回复推送许可（v1.24.0，整合 dsh-task-completion）

- **语义**：AI 回复输出 ✅（任务完成/已解答）且许可开启 → 回合结束自动 commit+push；❌ / ⚠️ 未完成 → 阻断不触发
- **默认关闭**（pushOnComplete=false）：关闭时只记录 `lastAttempt`，绝不自动推；开启走 `push_permit_config` 工具 / `POST /api/git-push/permit/config`
- **走审计通道**：自动推送逐个仓库调用 commitWithAudit（L0 审计 + 敏感扫描 + npm ignore + ahead/behind 检查），拦截/失败的仓库逐仓记录到 `lastAutoPush.results`，不静默
- **pushScope**：`all`（默认，全部有变更仓库）/ `session`（仅会话 cwd 所在仓库）
- **持久化**：`.dsh/git-push-permit.json`（JSON 文件，零新依赖；重启保留）
- **安全边界**：自动授权只做可逆操作（commit+push）；删除仓库 / force push / 公开化不在授权内；并发闸（同时只跑一个自动推送）+ 回合去重

## 四、配置（cordis.patch.yml）

```yaml
- insert:
    - id: git-push
      name: dsh-git-push
      config:
        workspaceRoot: '<workspace_root>'   # 扫描根（本机 DSH 工作区绝对路径）
        extraRepos: ['<另一项目绝对路径>']
        extraReposFile: '<dsh-home>/git-extra-repos.txt'   # 自由配置：每行一个仓库绝对路径，实时读取
        auditEnabled: true          # L0 静态审计开关
        blockOn: 'blocker'          # 'blocker'=仅严重拦截 | 'any'=严格
        llmAudit: false             # L1 LLM 审查（默认关省钱）
        llmAuditProvider: 'free'    # LLM 审查用便宜模型
        llmAuditModel: 'agnes-2.5-flash'   # 如 agnes / deepseek-chat
        maxDiffBytes: 6000          # LLM 审查 diff 截断
        exemptRepos: ['ai-work-archive']   # v1.5.0 备份类豁免：私有/备份仓库（跳过敏感内容规则）
        # pushScope: 'all'          # v1.24.0 推送许可 scope：'all'（默认）/ 'session'
        # commitMessage: 'chore(ai): 任务完成自动提交'   # v1.24.0 自动推送提交信息
        # injectFullSkill: false    # v1.28.0 勾选=pre-step 注入两仓 skill 全文；false（默认）只列目录清单省 token
        # customIgnorePatterns: '*.bak*, *.tmp'   # v1.28.0 自定义忽略 pattern（逗号/换行分隔），提交时自动写目标仓库 .gitignore（已跟踪文件自动解除跟踪）
        # envInjectionEnabled: true  # v1.28.1 环境注入（工作目录映射+工具路径）走 systemPrompt.section 系统提示词通道，每步组装生效（60s 缓存防重复探测），不受 injectFullSkill 影响；false 关闭
```

## 五、验证与测试

```bash
node --check lib/core.js && node --check lib/index.js  # 语法
node test/test-core.mjs    # 核心（真实 git 临时仓库）
node test/test-audit.mjs   # 审计规则（L0 静态，含文档措辞 + 硬编码路径/IP + 插件自身狗粮）
node test/test-viewer.mjs  # 查看器数据层（真实临时仓库：提交历史/diff/根提交/防注入/页面渲染）
node test/test-permit.mjs  # 推送许可（完成检测/JSON 持久化/损坏回退）
# test/test-apply.mjs 需 DSH 运行时依赖（@deepseek-ai/dsh-tools），工作区单独跑会缺包
```

## 六、坑速查

| 坑 | 处理 |
|---|---|
| `/git-push/viewer` 404 / 设置卡无查看器按钮 | 插件版本 <1.24.0 或 client.js 改动未生效：非 dev 模式平台启动时快照 client bundle，改 client.js 后需重启插件/实例（测试实例先行） |
| 查看器某仓库无提交 | 仓库为空仓库（rev-list 0）被扫描跳过，属预期 |
| 自动推送没跑 | `push_permit_status` 看 `pushOnComplete`（默认关）；`lastAttempt.reason` 看未触发原因；许可开时看 `lastAutoPush.results` 逐仓结果（审计拦截/远端领先/无 remote 都会记录） |
| HTTPS remote push 失败 | 禁止 github.com HTTPS。默认 api.github.com；token 401 时回退 ssh.github.com:443 |
| `src refspec main does not match` | 本地分支是 master，插件已自动取 `branch --show-current` |
| 远端领先不推 | 插件 push 前 `fetch` + `rev-list`，远端领先返回 reason，需先 pull |
| CIFS 只读卷 doubtful ownership | 插件每次命令带 `-c safe.directory=` |
| 提交被 hardcode-path / hardcode-ip 拦 | 代码里的本机绝对路径/局域网 IP 改成配置、环境变量或相对路径；文档 warning 改占位符或主机名；测试夹具可加文件头 `dsh-skip-sensitive` |
| CIFS 上 status 全是 `mode change 100644 => 100755` | 启动时 `git config --global core.filemode false`；每次 git 带 `-c core.filemode=false`（v1.18.4） |
| commit 被 AUDIT 拦截 | 看返回 `findings` 修掉问题重推；确认误报可 `audit:false`（不推荐）或调 blockOn |
| LLM 审查没跑 | 检查 `llmAudit` 开关 + `llmAuditProvider/Model` 配置 + DSH llm 服务可用（.credentials.yaml 有 key）；不可用自动跳过不阻断 |
| 空提交 | 无变更自动跳过（`committed:false, reason:无变更`） |
| 插件报 404 | 未注册/未重启：检查 patch insert + file: 依赖 + 软链 + 重启 |
| 代码审计独立插件 | 已停用并入本插件（v1.1.0），测试实例不再加载；不要再单独安装 |
| git_scan 等工具报 `userRender is not a function` | **已修复（v1.4.1）**：3 个工具缺 `output.render`（dsh-tools rc.6 起契约必填）导致结果无法回显，已补 render 返回内容块数组；未部署的旧实例仍报错时先用 git 命令或 status API 绕过 |
| 文档被 docs-conversation 拦下 | 改写为客观表述（只写做了什么）；沟通/需求/移交/待办类文档移入 `data/沟通文档`。注意：描述本规则时用「对话类措辞」等概括表述，避免字面写出禁用措辞被自身规则自命中 |
| 规则类文档本体入库被拦 | release-docs-rule 等规则文档自身含禁用措辞示例，新规则部署后整文件重入库会被 docs-conversation 拦下：私有归档仓库可用 `audit:false` 放行，或改写示例为概括表述 |
| 检测可用显示公钥未绑定 | token 只有 `repo` 时 GET `/user/keys` 404，v1.23.1 改 SSH 实测；`Hi <login>!` 即已绑定 |

## 七、边界

- 只做管道：commit message 由 LLM 生成；插件不判断"该不该提交"
- LLM 审计默认关（省钱）：需要深度审查时显式 `llmAudit:true` 或 `code_audit {llm:true}`
- git 相关操作/冲突审查/版本号等约定在同级仓 `dsh-git-push-User`（独立私有库）：git-commits-viewer、git-collab-conflict、versioning-rule、dsh-repo-index 等

## 相关

- `skills/task-completion-report.md`：收尾模板（分隔线 + ✅ 任务完成 + 交付/验证/遗留）；✅ = 提交推送授权
