# SPEC：当前有效规格

> 本文件是插件的**契约规格唯一入口**：写清对外接口（工具 / HTTP / 设置键 / 数据文件）与不变量。
> 设计过程的留痕（方案与诊断）已归档到技能仓库的开发者文档，不在本仓库维护。
> 规格以**代码为准**；本文件与代码不符时以代码为准并回来修正本文件。

## 一、身份

| 项 | 值 |
|---|---|
| 插件名 | `dsh-git-push` |
| 入口 | `lib/index.js`（导出 `name` / `Config` / `apply` / `callTool` / `handleHttp` / `listTools` / `listRuleSlots` …） |
| 依赖 | **零运行时依赖**（不引入 npm 包，无构建步骤） |
| 装载声明 | `package.json` 的 `dsh.bundle.patch` → `./cordis.patch.yml`；`dsh.client` 声明 web 端注入；`dsh.skills` 列出随包发布的 skill |
| 配置目录 | `<DSH_HOME>/git-push/`（凭据与状态文件都落在这里） |

## 二、工具（14 个，宿主可见公开面）

| 工具 | CLI 名 | 用途 |
|---|---|---|
| `git_scan` | `scan` | 扫描工作区 git 仓库（分支/远端/未提交/未推送/活动） |
| `git_commit_push` | `commit` | 一键提交+推送（先审计，blocker 拦截） |
| `code_audit` | `audit` | 全量/变动审计（规则包/权重可传） |
| `git_clone` | `clone` | 从 GitHub 克隆（Git Data API，走认证通道） |
| `git_remote_create` | `remote-create` | 按项目目录建远端仓库并设 origin |
| `git_set_visibility` | `set-visibility` | 切换仓库 public/private |
| `io_scan` | `file-io` | I/O 风险扫描（四级分级） |
| `git_clone_preview` | `clone-preview` | 克隆预演（不落盘，报告将拉什么） |
| `link_check` | `link-check` | 文档链接有效性检查 |
| `module_splitter` | `module-splitter` | 巨型单文件按顶层块拆分 |
| `git_account_check` | `account-check` | 账号与凭据在线校验 |
| `git_cred_env` | `cred-env` | 输出凭据环境变量前缀（不含明文） |
| `git_gen_ssh_key` | `gen-ssh-key` | 生成 SSH 密钥对（私钥不出本机） |
| `git_sluice` | `git` | git 命令透传（凭据自动注入） |

**不变量**：工具名唯一且匹配 `^[a-zA-Z0-9_-]+$`；CLI 名唯一；宿主注册面（`listTools`）与注册表（`TOOL_REGISTRY`）同名同数——由 `test/test-tool-contract.mjs` 门禁。增删工具必须同步该测试与 README 工具表。

## 三、HTTP 接口（28 条，前缀 `/api/git-push/`）

```
status  scan  browse
repos-local  repos-local-scan  repos-local-scan-wait  repos-local-refresh  repos-cloud
repo-visibility  repo-push  repo-commit  repo-clone
clone-logs  clone-abort  clone-preview  clone-progress
tools  tool-probes  rule-slots  rule-detail  audit  toggle-rule
account-status  account-check  api-quota  gen-ssh-key
settings-get  settings-set
```

**不变量**：

- 写类方法必须带**同源 Origin**（缺了返回 403 `NO_ORIGIN`，防 CSRF）；
- 破坏性操作（`repo-clone` / `repo-push` / `repo-commit` / `repo-visibility` / `rebuild` / `rollback`）需 body 显式 `confirm: true`，否则 400 `NEED_CONFIRM`；
- 请求体大小有上限（超限拒绝）；
- 返回统一为 `{ ok, … }` 形状；错误带 `code` 与 `message`。

## 四、设置键（18 个，`settings-set` 白名单）

```
审计：auditEnabled  auditScanScope  maxScanFiles  weightOverrides  auditRuleOrder  auditDisabledSlots
克隆：maxCloneFileMB  cloneConcurrency
推送：pushMethod  pushGate
凭据：githubToken  sshPub
注入：injectRequirements  injectSystemPrompt
自动推送：autoPushEnabled  autoPushTriggerText  autoPushScope  autoPushMessage
```

**不变量**：只有白名单内的键可写（其余拒绝）；设置持久化走宿主 HTTP（反代访问下 client 侧 scope 快照恒为 memory，不能用它判可用/可写）。

## 五、数据文件（配置目录内）

| 文件 | 内容 | 写入时机 |
|---|---|---|
| `config.json` | 设置与凭据真源 | `settings-set` / 凭据工具 |
| `account-status.json` | 凭据校验快照（有效性/登录名/时间/配额） | **每次推送/提交验证账号时刷新**；侧边栏打开只读 |
| `dsh-repo-index.json` | 工作区仓库索引 | 扫描/刷新；推送成功后先全量重建再精确回写 |
| `scan-live.json` | 扫描进度 | 扫描进行中 |

**不变量**：写只走收口函数（账号状态 `writeAccountStatusFromResult` / `updateAccountStatusQuota`；索引走索引维护模块）；落盘走**原子写**；「是否已配置凭据」一律查凭据真源，不看快照。

## 六、审计规则体系

- **21 个槽位 / 122 条规则**，声明在 `lib/audit-rules/audit-rules-<槽位>.yml`；判定在 `lib/ast/*`；产出 finding 在 `lib/checks/*`；调度汇总在 `lib/audit/*`。
- 作用域字段：`exts` / `include_paths`（路径白名单，按文件名或路径前后缀）/ `exclude_paths` / `file_patterns`（**内容**初筛）。
- 分级：`blocker` / `warning` / `info`；评分 10 维度加权得 0-100 + 等级。
- 豁免标记 9 个（`dsh-skip-*`），判定入口 `lib/exempt/index.js`；finding 的 `exemptHint` 必须与实际生效的标记一致。
- 详细用法见 `docs/功能-审计规则体系.md`；豁免与规则字段全录见 `docs/DETAILS-EXEMPT-AND-RULES.md`。

## 七、文档产物（生成物，勿手改）

| 产物 | 生成脚本 | 校验测试 |
|---|---|---|
| README 目录结构块 | `scripts/doc-tree.mjs` | `test/test-tree-doc.mjs` |
| `docs/FUNCTIONS.md` | `scripts/doc-func.mjs` | `test/test-doc-func.mjs` |
| `docs/CHANGELOG.md` | `scripts/doc-version.mjs`（数据源含 `version-metrics.json`） | `test/test-doc-version.mjs` |

三个脚本统一 `gen` / `apply` / `check`；`check` 有漂移即非零退出。

## 八、版本纪律

- 三处版本号一致：`lib/self/index.js` 的 `VERSION` ≡ `package.json` 的 `version` ≡ 版本表；
- 纯优化不升版本（多次本地提交 → 收尾压缩一次推送）；
- 发版在 `version-metrics.json` 补量化对比，版本表会带上。

## 九、测试基线

- 全量 `test/*.mjs` **必须 0 失败**；新增/修改行为必须带回归；
- 公开面由 `test/test-tool-contract.mjs` 门禁；版本行为基线由 `test/regression-<版本>.mjs` 汇总；
- 工具层端到端见 `test/test-tools-e2e.mjs`（最小 env/cfg 直接驱动 `callTool`）。
