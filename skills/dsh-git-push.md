---
name: dsh-git-push
description: dsh-git-push 插件（git 自动提交推送 v1.17.0，内置代码审计门禁，所有 GitHub 操作走 api.github.com）的使用手册：git_scan / git_commit_push / git_clone / git_remote_create / code_audit 工具与 /api/git-push API 的调用方法、配置（审计 blockOn/llmAudit）、验证与坑速查。处理"提交推送代码""扫描仓库状态""审计代码""推送前拦截 bug""敏感信息检测""文档被审计拦截"类请求时加载；插件不可用/报错排查时必加载（正常情况优先用插件，见 plugin-priority）。
whenToUse: 需要用插件做 git 提交推送/代码审计但不确定参数/报错排查/插件未装需手做时。
generatedBy: deepseek-official/deepseek-v4-flash
---

> ⭐ **先记住我**：任何会话开始前，先读用户档案 `.dsh/skills/remember-me.md`（优先级最高的 skill）：我是谁、我怎么用你、我立过的规矩。

# dsh-git-push 插件手册

> 插件源码：`workspace/dsh-git-push/`（GitHub: EIGHTfs/dsh-git-push）。定位：把"扫描仓库 → **审计** → 一键 commit+push"固化为代码管道（零 token、确定性）。v1.1.0 内置代码审计门禁（源自 dsh-code-audit 实测验证，该独立插件已停用并入本插件）。**正常情况优先调插件工具，本 skill 是手册（排查/未装时用）**——见 plugin-priority skill。

## 一、工具（agent 会话内直接调用）

| 工具 | 参数 | 说明 |
|---|---|---|
| `git_scan` | 无 | 扫描 workspace 全部 git 仓库 → 分支/remote/未提交变更数/最近活动 |
| `git_commit_push` | `repo`, `message`(必填), `push?`, `dryRun?`, `audit?`(默认true), `llmAudit?`(默认false) | **先审计** → add -A → commit → push（自动识别分支、ahead/behind 检查） |
| `code_audit` | `repo`, `llm?` | 手动审计仓库：L0 静态（默认）+ L1 LLM（llm=true） |

用法示例：`git_scan` 看改动 → 先 `code_audit {repo:"...", llm:true}` 自查 → `git_commit_push {repo:"...", message:"feat: xxx", push:true}`（审计通过才推）。

## 二、开发者特殊要求门禁（v1.10.0）

- 插件内 `User/<GitHub用户名>/`（如 `User/EIGHTfs/requirements.md`）放开发者特殊要求清单（git 忽略不入库）
- `git_commit_push` 提交前自动读取并逐条核对：未核对（不带 `requirementsConfirmed:true`）直接拦截返回清单；AI 逐条确认达标后重新调用
- 多用户支持：按仓库 remote owner 自动匹配对应 User 子目录

### 推送通道（v1.17.0：所有功能只走 api.github.com）

- **clone（v1.17.0）**：`git_clone` 走 api.github.com Git Data API（git/trees + git/blobs，不下 tarball；target=owner/repo 或 URL 只解析不访问；自动探测默认分支 master/main；/tmp 中转建仓整拷回 dest 兼容 CIFS；dest 非空拒绝；origin 写成 `https://api.github.com/repos/o/r`）
- **默认通道 = api.github.com Git Data API**（pushViaApi：blob→tree→commit→ref，复用远端已有 blob sha）——统一 `githubFetch`（hostname 硬闸 + 拒绝跟随 302）
- API 无 token / 失败时**不再回退** `git push origin`（避免直连 github.com）
- token 多源探测 resolveGitToken：插件 `User/<用户名>/github-token` → 项目 `.git-push-token` → workspaceRoot data/sensitive → HOME/DSH_HOME 会话目录
- 本机无 SSH 私钥只有 GitHub token：clone/push **只走 api.github.com**，不用 SSH 443 / HTTPS github.com

### User/ 目录备份与恢复（dsh-git-push-User 私有库）

- User/（开发者特殊要求 requirements.md + 各用户 git 相关 skill）**本机专用、git 忽略不入主库**，独立备份在私有库 **`EIGHTfs/dsh-git-push-User`**（private，内容 = 插件 User/<用户名>/ 目录）
- 恢复：`git_clone` 该私有库到插件目录即可，如
  ```
  git_clone { target: "EIGHTfs/dsh-git-push-User", dest: "<插件目录>/User" }
  ```
- 注意：clone/push 只走 **api.github.com**，不用 SSH 443 / github.com HTTPS

## 三、审计（v1.1.0 内置，重点）

- **npm 下载产物屏蔽（v1.6.0，add 前自动）**：每次 commitAndPush 先调用 `ensureNpmIgnored()`——确保仓库 .gitignore 幂等覆盖 `node_modules/` + 常见 lock 文件（package-lock/yarn.lock/pnpm-lock.yaml/bun.lock）+ npm 缓存/日志（.npm/、.pnpm-store/、npm-debug.log*）。不覆盖已有 .gitignore 内容，只追加缺失条目。效果：「上传推送检查屏蔽下载的一堆 npm 包」——npm 产物不进变更、不进审计、不进 git。**单测 + 端到端（真实 git 仓库 + node_modules + lock）均通过**。
- **L0 静态检查（零 token，默认开）**：JS 语法（node --check）/ JSON / YAML / 敏感信息硬编码（GitHub PAT、sk- key、密钥键值对）/ 凭据文件入库（.env/.credentials）/ 二进制大文件（>1MB）/ debugger 残留 / console.log≥5 / TODO/FIXME
- **文档措辞拦截 docs-conversation（v1.4.0，blocker）**：对文档文件（md/markdown/mdx/txt）的**新增行**检查「AI 与用户沟通过程」类措辞（会话引用 / 用户决策来源 / AI 许可表述 / 商量转述等），命中即拦截——公开仓库只提交「做了什么」，沟通/需求/移交/待办类文档统一放 `data/沟通文档`（清单见 release-docs-rule）
- **L1 LLM 深度审查（默认关，省钱）**：diff 喂便宜模型找逻辑/安全问题，实测 agnes-2.5-flash 精准检出越界/空值/除零/fetch 未检查 res.ok 等 bug
- **拦截策略 blockOn**：`blocker`（默认，仅严重问题拦截）/ `any`（任何问题拦截）
- 审计范围 = 工作区相对 HEAD 变更（**含 untracked 新文件**，LLM 也看得到）
- 拦截时 commit 返回 `{ok:false, error:{code:'AUDIT'}, findings}`，不产生提交

### 豁免类型（v1.5.0 已实现为机器闸门，防误伤）

| 豁免类型 | 说明 | 示例 |
|---|---|---|
| **说明类（示例凭据）** | 文档/README/示例代码中**用于举例的假凭据**不报敏感信息——值含 假/fake/示例/演示/sample/demo 或占位符（your- 前缀、xxx、example 等），或行内含「例如/举例/示例」等示例词整行豁免 | 「用户名: 假用户 / 密码: 假密码」（中文假值）或 `user: your-username / password: your-password`（占位符） |
| **备份类（私有库）** | 配置 `exemptRepos` 白名单（仓库绝对路径或目录名）后，命中的**私有/备份仓库**跳过敏感内容规则（secret / 凭据文件 / 对话措辞），其余规则照常；审计结果标注 `exempted:true` | `exemptRepos: ['ai-work-archive']`（私有归档可存 token/会话总结） |
| **私有库自动豁免（v1.14.0）** | commitAndPush 自动探测 GitHub 仓库可见性（GET /repos/{o}/{r} 读 private 字段，复用 resolveGitToken）：**private → 敏感字段自动 .gitignore 只扫描报告不写入**（`sensitiveExempted` 标注），审计同步跳过敏感内容规则；探测失败/无 origin/无 token → 保守不豁免 | `EIGHTfs/dsh-git-push`（private）提交含密码字段的源码不再被自动 gitignore |
| **注释豁免（v1.14.0）** | 敏感信息可通过注释申请豁免：**文件头前 3 行**或**行内注释**带 `dsh-skip-sensitive` 即跳过敏感扫描（自动 gitignore + 审计 secret/凭据/对话措辞两处同认） | `// dsh-skip-sensitive` 放文件头 → 整文件豁免；`password = "x" // dsh-skip-sensitive` → 仅该行豁免 |

**判定原则**：公开仓库只提交「做了什么」，示例凭据必须是**假的**（真实凭据哪怕一行也禁止）；私有备份仓库的敏感信息上传通过 `exemptRepos` 白名单放行（语法/JSON/YAML/大文件检查仍生效）；v1.14.0 起私有库可见性=private 自动豁免敏感自动 gitignore，源码文件如需入库可加 `dsh-skip-sensitive` 注释声明（或依赖只认字符串字面量的根因修复）。

## 三、HTTP API

| 接口 | 说明 |
|---|---|
| `GET /api/git-push/status` | 插件状态（版本 + 配置 + 审计开关 + git 版本） |
| `GET /api/git-push/scan` | 扫描全部仓库状态 |
| `GET /api/git-push/audit?repo=<路径>&llm=true` | 审计指定仓库（llm=true 追加深度审查） |
| `POST /api/git-push/commit` | `{repo, message, push?, dryRun?, audit?, llmAudit?}` 审计通过后提交推送（curl 用 `-H 'Content-Type: application/json'`） |

测试实例地址：`http://127.0.0.1:3083/api/git-push/status`（局域网反代 3084）。

## 四、配置（cordis.patch.yml）

```yaml
- insert:
    - id: git-push
      name: dsh-git-push
      config:
        workspaceRoot: '/vol1/@appshare/DeepSeekHarness/workspace'   # 扫描根
        extraRepos: ['/vol02/1000-0-1789e550/gamebanana-mods-downloader']
        extraReposFile: '/vol1/@appdata/deepseek-harness-NAS/0.1.1-rc.2/.dsh/git-extra-repos.txt'   # 自由配置：每行一个仓库绝对路径，实时读取
        auditEnabled: true          # L0 静态审计开关
        blockOn: 'blocker'          # 'blocker'=仅严重拦截 | 'any'=严格
        llmAudit: false             # L1 LLM 审查（默认关省钱）
        llmAuditProvider: 'free'    # LLM 审查用便宜模型
        llmAuditModel: 'agnes-2.5-flash'   # 如 agnes / deepseek-chat
        maxDiffBytes: 6000          # LLM 审查 diff 截断
        exemptRepos: ['ai-work-archive']   # v1.5.0 备份类豁免：私有/备份仓库（跳过敏感内容规则）
```

## 五、验证与测试

```bash
node --check lib/core.js && node --check lib/index.js  # 语法
node test-core.mjs    # 核心 13 项（真实 git 临时仓库）
node test-audit.mjs   # 审计规则 27 项（L0 静态，含文档措辞拦截）
node test-apply.mjs   # apply mock 16 项（含审计门禁端到端）
curl -s http://127.0.0.1:3083/api/git-push/status      # 加载验证
```

## 六、坑速查

| 坑 | 处理 |
|---|---|
| HTTPS remote push 失败 | 已废弃 github.com HTTPS 回退；推送只走 api.github.com（需 token）。无 token 会返回明确错误，不再 git push origin |
| `src refspec main does not match` | 本地分支是 master，插件已自动取 `branch --show-current` |
| 远端领先不推 | 插件 push 前 `fetch` + `rev-list`，远端领先返回 reason，需先 pull |
| `/vol02` 只读卷 doubtful ownership | 插件每次命令带 `-c safe.directory=` |
| commit 被 AUDIT 拦截 | 看返回 `findings` 修掉问题重推；确认误报可 `audit:false`（不推荐）或调 blockOn |
| LLM 审查没跑 | 检查 `llmAudit` 开关 + `llmAuditProvider/Model` 配置 + DSH llm 服务可用（.credentials.yaml 有 key）；不可用自动跳过不阻断 |
| 空提交 | 无变更自动跳过（`committed:false, reason:无变更`） |
| 插件报 404 | 未注册/未重启：检查 patch insert + file: 依赖 + 软链 + 重启 |
| code-audit 独立插件 | 已停用并入本插件（v1.1.0），测试实例不再加载；不要再 install dsh-code-audit |
| git_scan 等工具报 `userRender is not a function` | **已修复（v1.4.1）**：3 个工具缺 `output.render`（dsh-tools rc.6 起契约必填）导致结果无法回显，已补 render 返回内容块数组；未部署的旧实例仍报错时先用 git 命令或 status API 绕过 |
| 文档被 docs-conversation 拦下 | 改写为客观表述（只写做了什么）；沟通/需求/移交/待办类文档移入 `data/沟通文档`。注意：描述本规则时用「对话类措辞」等概括表述，避免字面写出禁用措辞被自身规则自命中 |
| 规则类文档本体入库被拦 | release-docs-rule 等规则文档自身含禁用措辞示例，新规则部署后整文件重入库会被 docs-conversation 拦下：私有归档仓库可用 `audit:false` 放行，或改写示例为概括表述 |

## 七、边界

- 只做管道：commit message 由 LLM 生成；插件不判断"该不该提交"
- LLM 审计默认关（省钱）：需要深度审查时显式 `llmAudit:true` 或 `code_audit {llm:true}`
- git 相关操作/冲突审查/版本号等约定已移入本插件 User/EIGHTfs/（本机专用，git 忽略不入库）：git-commits-viewer（提交历史/网页查看）、git-collab-conflict（跨 AI 冲突审查）、versioning-rule（版本号）、dsh-repo-index（源码索引）等

## 相关

- remember-me（先记住我）：用户档案，优先级最高的 skill
