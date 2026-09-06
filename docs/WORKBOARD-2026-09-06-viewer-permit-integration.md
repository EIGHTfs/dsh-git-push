# 工作进度看板：查看器 + 推送许可整合进 dsh-git-push

> 任务：把 git-commits-viewer（提交历史/diff 网页查看器）与 dsh-task-completion（✅ 自动推送许可）的功能整合进 dsh-git-push 插件。网页入口放「设置 → 插件配置 → Git 提交推送」卡片内；复用插件现有配置与已验证 git 逻辑；**逐条避开旧实现已分析的全部漏洞**。
> 目标版本：1.24.0 ｜ 开始：2026-09-06

## 〇、总体状态

| 阶段 | 状态 | 说明 |
|---|---|---|
| 源码分析（两旧仓 + 插件现状） | ✅ 完成 | 旧仓各 ~1600/~700 行通读，插件 index/client/core 已读 |
| 架构设计与漏洞规避映射 | ✅ 完成 | 见下表「漏洞规避」 |
| 数据层 lib/viewer.js | ✅ 完成 | getCommitHistory（%x1f 分隔防 message 含 \|）/ getCommitDiff / parseDiffLines / resolveViewerRepo / renderViewerPage |
| 服务端路由 | ✅ 完成 | /git-push/viewer 页面 + /api/git-push/{repos,commits,diff,permit/*} |
| 设置页入口（client.js） | ✅ 完成 | 卡片加「打开提交历史查看器」按钮（中英文 + 只读提示） |
| 推送许可整合 | ✅ 完成 | lib/permit.js（检测 + JSON 持久化）+ config + push_permit_* 工具 + permit API + turn/end 触发（走 commitWithAudit） |
| 测试 | ✅ 完成 | test-viewer.mjs 32 项 / test-permit.mjs 29 项全过；test-core 45 / test-audit 36 / test-repo-index 21 无回归 |
| README/版本/skill 同步 | ✅ 完成 | v1.24.0（package.json/README/skill 手册/坑速查） |
| 提交推送 | ✅ 完成 | 9d3ff51 + 8b91af4 推 api.github.com（tag v1.24.0） |
| v1.25.0 多语言 + 手动选择 | ✅ 完成 | 查看器多语言配置文件化（lib/viewer-locales.js，默认中文，运行时切换 localStorage 记忆）+ 侧边栏手动选择本地仓库（paths/root 只读扫描，手动徽标）；test-viewer 43 项全过（+11）；待推送与重启生效 |

图例：✅ 完成 ｜ 🔄 进行中 ｜ ⏳ 待办

## 一、目标与范围

**整合内容**
1. **提交历史查看器**（来自 git-commits-viewer）：仓库列表 → 提交历史（类型过滤/分页）→ 单文件 diff。只读，无任何写操作。
2. **推送许可开关**（来自 dsh-task-completion）：AI 回复 ✅ 后是否自动 commit+push。默认关闭；开启后自动推送**必须走带审计门禁的 commitWithAudit 通道**。

**入口**：设置 → 插件 → 插件配置 →「Git 提交推送」卡片内「打开提交历史查看器」按钮（新窗口打开 `/git-push/viewer`）。

**不整合**（有意裁掉，理由见漏洞规避表）
- 查看器不做 push 按钮 / push API（推送仅经 git_commit_push 工具，带审计）
- 不做无人值守的静默 auto-push 旁路（旧 dsh-task-completion 的 lib/git.js 是 dsh-git-push 的无审计复制版）

## 二、漏洞规避映射（旧实现缺陷 → 本次做法）

| # | 旧实现缺陷（git-commits-viewer / dsh-task-completion） | 本次做法 |
|---|---|---|
| 1 | 打开页面即真实 push（checkPushStatus 调 /api/push 直接推送） | 查看器零写操作；无 push 路由。页面顶部明示「只读」 |
| 2 | /api/push 无认证、任意触发 | 无 push API；repo 参数仅接受 scanRepos 精确匹配（name/path），拒绝任意路径 |
| 3 | 机器级硬编码 WORKSPACE/SSH 路径 | 全量复用插件 config：workspaceRoot / depth / extraRepos / extraReposFile |
| 4 | generate.js / static-server.js 双份重复代码 | 单文件 lib/viewer.js 唯一实现 |
| 5 | 无测试 | 配套 test-viewer.mjs（数据层纯函数 + 真实临时 git 仓库） |
| 6 | 无版本号 | 随插件 1.24.0 版本管理，页面显示插件版本 |
| 7 | runGit 静默吞错（空 diff 无法区分） | 只读失败返回结构化 error，前端展示错误信息 |
| 8 | 任意 shell 拼接（命令注入面） | 全部经 core.js runGit（spawnSync 数组参数），commit id 正则白名单校验 |
| 9 | 无审计自动推送旁路（dsh-task-completion lib/git.js 复制版） | 自动推送复用 commitWithAudit（L0 审计 + 敏感扫描 + npm ignore），审计拦截即跳过并记录 |
| 10 | 检测逻辑粗糙（✅ 全文本匹配、防抖 800ms 时序脆弱） | 推送许可默认关闭；开启走显式工具/API/设置项，回合级触发见「四、许可整合」 |

## 三、架构设计

```
浏览器（设置页 → 打开 /git-push/viewer 新窗口）
   │
   ├─ GET /git-push/viewer            → lib/viewer.js renderViewerPage()（服务端渲染，零外部资源）
   ├─ GET /api/git-push/repos         → core.js scanRepos（复用 config，含 extraReposFile 实时读取）
   ├─ GET /api/git-push/commits?repo= → viewer.js getCommitHistory()（git log + 逐文件 numstat）
   └─ GET /api/git-push/diff?repo=&commit=&file= → viewer.js getCommitDiff()（根提交自动回退 git show）

写操作面（仅 git_commit_push 工具 / POST /api/git-push/commit）：
   commitWithAudit（L0 审计 → add -A → commit → push 前 ahead/behind 检查 → push + repo-index 维护）
```

- **git 执行**：core.js `runGit`（spawnSync 数组、-c safe.directory、core.filemode=false、SSH 自动探测、门禁放行）——杜绝 shell 拼接
- **页面**：服务端渲染完整 HTML（style+script 内嵌），不依赖外部静态资源、不依赖 client bundle 重打包；前端 fetch 只读 API
- **设置入口**：client.js 设置卡（settings.plugin.item slot）加链接按钮，`window.open(location.origin + '/git-push/viewer')`
- **client bundle 生效方式**：平台在启动时快照 lib/client.js 字节（rev=内容哈希，见 packages/client/modules ClientModuleRegistry）；非 dev 模式改 client.js 需重启插件/实例才生效（测试实例验证先行）

## 四、推送许可整合（dsh-task-completion 功能）

| 项 | 设计 |
|---|---|
| 配置 | `pushOnComplete`（默认 false，保守）；`pushScope`（all/session，默认 all） |
| 持久化 | storageDomain domain `dsh_git_push_permit`（重启保留开关与最近一次触发记录） |
| 工具 | `push_permit_status`（查开关/最近触发）/ `push_permit_config`（切开关） |
| API | `GET /api/git-push/permit/status` 、 `POST /api/git-push/permit/config` |
| 触发 | 监听 `session/event` turn/end → 检测最后一条 assistant 文本含 ✅ 且许可开 → **逐个有变更仓库走 commitWithAudit（push=true）**；审计拦截/远端领先等失败逐仓记录，不静默 |
| 阻断 | 回复含 ❌ / ⚠️ 未完成 → 不触发（沿用 task-completion-report 语义） |
| 去重/并发 | 回合去重（sessionId+turn）+ 并发闸（同时只跑一个自动推送） |
| 安全边界 | 自动授权只做可逆操作（commit+push）；删除/force/公开化不在授权内 |

## 五、任务清单

- [x] 通读插件现状（index.js / client.js / core.js / 设置注册机制 / client bundle 加载机制）
- [x] 确认复用点：runGit（数组 spawn、safe.directory、filemode）、scanRepos（extraReposFile）、webServer prefix/exact 路由、settings.plugin.item slot
- [x] 写 lib/viewer.js（getCommitHistory / getCommitDiff / parseDiffLines / resolveViewerRepo / renderViewerPage）
- [ ] index.js：页面路由 exact /git-push/viewer + prefix /api/git-push 增 repos/commits/diff 三分支
- [ ] client.js：卡片加「打开提交历史查看器」按钮（含中英文文案）
- [ ] 许可整合：config 读取 + storageDomain 持久化 + push_permit_* 工具 + permit API + turn/end 触发（走 commitWithAudit）
- [ ] test-viewer.mjs：提交历史/根提交 diff/参数校验/页面渲染断言（真实临时仓库）
- [ ] permit 相关测试（mock ctx：开关持久化、✅ 触发走审计通道、❌ 阻断）
- [ ] node --check 全部改动文件
- [ ] README：v1.24.0 功能表 + 版本记录表 + 配置表增补
- [ ] skills/dsh-git-push.md：增补查看器 + 推送许可章节
- [ ] 全量测试（test-core/test-audit/test-apply/test-viewer/test-permit）通过
- [ ] 提交推送（git_commit_push，审计门禁）

## 六、验收标准

1. 设置 → 插件配置 → Git 提交推送 卡片可见「打开提交历史查看器」，点击新窗口打开 `/git-push/viewer`
2. 查看器展示仓库列表（来自插件配置扫描范围），能看提交历史、类型过滤、分页、单文件 diff（含根提交）
3. 查看器全程只读：无 push 按钮，无任何写 git 的 API 路径
4. repo 参数只接受扫描仓库精确匹配；非法 commit id 被拒绝（4-40 hex）
5. 推送许可默认关闭；开启后 ✅ 回合触发自动推送，且逐仓经过审计门禁（拦截仓库跳过并记录原因）
6. 全部既有测试 + 新增测试通过；node --check 无语法错误
7. README 版本记录表更新至 v1.24.0，技能手册同步

## 七、坑与风险

- **client.js 生效需重启**：非 dev 模式平台启动时快照 bundle，改 client.js 后需重启 DSH（测试实例先行，主实例重启需明确同意）
- **commit message 含 `|` 分号**：git log --pretty 自定义格式按前 5 个分隔符解析，message 允许含 `|`（已处理，不按 split 硬切）
- **根提交 diff**：无父提交时 `git diff <id>~1` 报 fatal，先 `rev-parse --verify <id>^` 预检，回退 `git show --format=`
- **大仓库性能**：每提交逐文件跑 numstat（上限 500 条/100 条默认），不做持久 diff 缓存（避免写工作区），必要时后续可加内存级缓存
- **自动推送误伤**：许可开启时 pushScope=all 会推全部有变更仓库——默认关 + 界面明示 + 审计兜底；敏感文件由 ensureSensitiveIgnored/审计拦截