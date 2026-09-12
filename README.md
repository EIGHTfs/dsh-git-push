# dsh-git-push

DSH（DeepSeek Harness）git 提交推送与代码审计插件——提交前自动审计门禁，提交推送全链路自动化。

![账号信息面板](assets/panel-account.png)

> **公开仓库**：EIGHTfs/dsh-git-push（2026-09-13 转 public）｜全量测试 438 全绿（`npm test` 一条命令可复现）
> **设计稿**：`doc/account-panel-design.html`（可独立浏览器打开预览账号面板）

## 目录

- [功能总览](#功能总览)
- [一、提交推送](#一提交推送)
- [二、代码审计](#二代码审计)
- [侧边栏设置](#侧边栏设置)
- [独立 CLI（git-sluice）](#独立-cligit-sluice)
- [安装与要求](#安装与要求)
- [版本列表](#版本列表)
- [注意事项](#注意事项)

## 功能总览

插件围绕 DSH 日常开发的两个高频动作，分为**提交推送**与**代码审计**两大块：

| 功能块 | 做什么 | 入口 |
|---|---|---|
| **提交推送** | token / SSH 密钥管理、提交、推送、clone、建仓、可见性切换、force 强推、版本历史 | `git_commit_push` 工具 / CLI / 侧边栏 |
| **代码审计** | 提交前自动审计门禁、14 个规则槽位 96+ 条规则、10 维度质量评分、豁免机制、链接检查 | `code_audit` 工具 / CLI / 侧边栏 |

## 一、提交推送

Git 全链路自动化，token / SSH 凭据管理 + 提交推送，无需手动敲 git 命令。

### 凭据管理

- **Token**：GitHub token（`ghp_` / `github_pat_` 开头），保存即写入插件配置目录 `credentialsDir()/github-token`（**0600 权限**），不落 settings.yaml 明文
- **SSH 公钥**：保存写入 `credentialsDir()/*.pub`（按类型 id_rsa.pub / id_ed25519.pub）；**一键生成密钥对**（邮箱 → `ssh-keygen` 4096 位，公钥自动填入并复制剪贴板，私钥只落本机）
- **账号检测**：`GET /api/git-push/account-check` 在线校验（token 调 api.github.com + SSH 指纹 + 绑定关系），侧边栏账号面板实时显示登录态

### 提交推送能力

| 能力 | 说明 |
|---|---|
| `git_commit_push` | 一键提交+推送（审计门禁默认开启；敏感文件自动 .gitignore；`--push/--no-push/--dry-run/--force/--req-confirm/--json`） |
| 推送通道 | **api 通道**（Git Data API，blob→tree→commit→ref，分支免疫）优先，401 自动回退 **SSH 通道**（ssh.github.com:443） |
| force 强推 | API 通道重建 commit 去旧 parent / SSH 通道 `git push --force` |
| clone / 建仓 | `cloneViaApi`（trees+blobs 写文件转 git 仓）/ `ensureRemoteRepo`（建仓+设 origin） |
| 可见性 | `setVisibility` PATCH 切换 public/private |
| 网络硬闸 | 只允许 api.github.com（`githubFetch` 拒绝非该域名，不跟随 302） |

### 提交前自动门禁

提交推送前自动跑代码审计（见下节）：**有 blocker 拦截提交**（退出码 2），warning 只提示不拦截。审计通过才执行 commit + push。

## 二、代码审计

提交前自动审计 + 独立全量扫描，规则可扩展，质量可评分。

### 审计入口

- `auditChanged`：变动范围（git diff）——提交前默认
- `auditFull`：全量扫描（非 git 目录可查）
- `code_audit` 工具 / `git-sluice audit` CLI：强度、规则包、权重全覆盖

### 规则引擎（yml 管理）

规则槽位由目录文件驱动：目录里每个 `audit-rules-<名>.yml` 即一个槽位，**放文件即生效、删文件即移除**，无需改代码。内置 14 个槽位：

| 槽位 | 规则数 | 检查内容 |
|---|---|---|
| nodejs | 36 | 凭据硬编码 / 路径穿越 / 魔数 / 依赖 / 异步等 |
| frontend | 19 | 前端安全 / a11y / 依赖 |
| npm | 10 | 依赖声明 / npmrc 凭据 / 测试入口 |
| version | 8 | 版本号规范 |
| dsh | 7 | DSH 插件契约 / 注入通道 |
| comment | 6 | 注释措辞 / 对话残留 |
| folder | 4 | 目录总数 / 单目录文件数 / 解包特征 / .gitignore |
| i18n | 3 | 硬编码文案 / 插值 / 语言包 |
| performance | 2 | memory-bomb / busy-wait |
| docs / robustness / structure / template / private | 各 0-4 | 链接检查 / 写前 mkdir / 循环依赖 / 规则模板 / 私密文件拦截 |

**加规则 = 放文件**；**加字段类型（新 kind）才需加函数**（compilers.js 注册制：`registerCompiler(kind, detect, compile)`，加字段=加函数+注册一行，`compileRule` 主体永不修改）。

### 10 维度质量评分

可读性 / 可维护性 / 健壮性 / 安全性 / 性能 / 测试覆盖 / 可观测性 / 可部署性 / 文档 / 开发者体验，默认合计 100，可在侧边栏调权重（`weightOverrides` JSON）。

- 单维度评分对数衰减防零分塌陷：`max(0.1, 10 - k*ln(1+errorCount))`，k 按维度分级（安全性 1.8 衰减最快）
- 总分 = Σ(维度得分×权重)/Σ权重×10；A/B/C/D/E 五档

### 审计强度三档

| 档位 | 检查范围 |
|---|---|
| `quick` | 正则 / 凭据 / 路径 / 黑名单 / 空 catch / 同步 IO（跳 AST 与语义重检查） |
| `standard` | 全量（默认） |
| `deep` | 当前与 standard 等效，为深度检查预留 |

### 豁免机制

`dsh-skip-*` 注册表（文件头=整文件 / 行内=单点），每个豁免类型声明「能豁免哪些维度」。安全红线不可豁免：`secret-*` / `cred*` / `security/*` 类规则即使标 disabled 也强制加载。

### 链接检查

扫描 md/文本中的 URL 并访问验证（404/403→-3、DNS→-2、超时→-1 分级扣分），只 warning 永不 blocker（网络不可靠防假阳性拦截）。

## 侧边栏设置

设置 → 侧边栏 → **Git 提交推送**，三选项卡（对齐插件市场样式）：

- **账号信息**：渐变卡片 + GitHub 图标 + 状态徽标（已连接/检测中/未连接）+ 检测结果块 + Token/SSH 凭据状态标签 + `⟳ 重新检测`
- **审计**：审计开关 + 10 维度权重编辑 + 规则包列表（↑↓ 调次序、单击展开规则表格）
- **设置**：GitHub token + SSH 公钥 + 邮箱 + 一键生成并复制

设置项以 `lib/index.js` 的 `Config` 为单一事实源，`settingsScope` 读写。凭据保存**同时写插件配置目录**（见「凭据管理」）。

## 独立 CLI（git-sluice）

脱离 DSH 独立运行（零第三方依赖，仅需 Node ≥18 与本机 git）。

```
git-sluice version              查看版本
git-sluice ruleset [槽位...]    编译规则包并输出统计
git-sluice scan <root> [--depth N]   全量扫描目录（非 git 目录可查）
git-sluice audit <root> [--full] [--level quick|standard|deep] [--ruleset <目录>] [--weights <JSON>]
git-sluice commit <repo> -m <msg> [--push|--no-push] [--dry-run] [--force] [--req-confirm] [--json]
git-sluice link-check <路径>    检查 md/文本中的链接有效性（只 warning）
git-sluice yaml-template        输出规则 yml 模板
git-sluice readme-template      输出 README 模板
git-sluice self-check           版本一致性 + HELP↔parseArgv 机器比对
```

`audit` 参数与服务端设置对应：`--full` ↔ `auditScanScope=full`、`--level` ↔ `auditLevel`、`--ruleset` ↔ `auditRuleset`、`--weights` ↔ `weightOverrides`。

## 安装与要求

- **环境**：DSH（DeepSeek Harness）｜Node ≥18 ｜本机 git
- **安装**：`dsh plugin add EIGHTfs/dsh-git-push`（仓库已声明 `dsh.bundle`，可安装）
- **测试**：`npm test` 一条命令复现全绿（438 断言，0 失败）

## 版本列表

| 版本 | 说明 |
|---|---|
| **1.1.0**（当前） | **侧边栏三选项卡**（账号信息 / 审计 / 设置）+ **账号面板美化**（渐变卡片 + GitHub 图标 + 状态徽标，设计稿 doc/account-panel-design.html）+ **凭据落盘修复**（persistGithubToken 写插件配置目录 0600 + persistSshPub 写 *.pub，不再只靠 settings.yaml 明文）+ 审计规则包列表（rule-slots meta author + rule-detail 端点）｜438 全绿 |
| **1.0.14** | 客户端重构（Controller + hooks + 独立 section 页）；修复 scope.use 渲染 TypeError 与 Host 缺 settings.register 两根因；双语取消（纯中文）｜430 全绿 |
| **1.0.13** | 文件健康度矩阵评分规则（kind=file-health，三维分级加权）｜429 全绿 |
| **1.0.12** | client.js 结构拆分 ≤400 行（消除 max-function/file-length）｜421 全绿 |
| **1.0.11** | 修复设置侧边栏空白（apply 崩溃根因）｜421 全绿 |
| **1.0.10** | 规则 disabled 机制 + 安全红线强制加载 + 缺失兜底｜420 全绿 |
| **1.0.9** | 8 类真实误报语义修复（npm-json 全仓证据 / timeout 同调用识别 / loader 契约 / exts 过滤等）+ 10 条回归｜418 全绿 |
| **1.0.8** | 扫描智能提示 + 评分对数衰减（防零分塌陷）｜408 全绿 |
| **1.0.7** | 硬编码魔数检测（版本号/日期/状态码豁免版）｜— |
| **1.0.6** | .test 空文件豁免 + button-bind 按钮事件交叉比对｜— |
| **1.0.5** | 侧边栏账号卡（账号检查/SSH 密钥生成）+ Origin 同源放行 + 评分公式定稿｜394 全绿 |
| **1.0.4** | 规则引擎加固 + 侧边栏配置面：regex 子模式 / performance 槽位 / private 槽位 / 审计强度三档 / 真实接线修复（apply 四段 API 全错→真实 API）｜373 全绿 |
| **1.0.3** | 规则包扩充：9 槽位 86 条 + robustness/folder/i18n 新槽位｜320 全绿 |
| **1.0.2** | 审计健壮性加固（G9-G12：匹配器空值 / 重复串死检测等）｜315 全绿 |
| **1.0.1** | 六个真实缺陷修复（死桶 / 豁免失效 / 槽位半硬编码等）｜278 全绿 |
| **1.0.0** | DSH 插件接线完成（apply + 7 工具 + HTTP 鉴权 + client）｜263 全绿 |
| **0.2.0** | 链接判断落地（link-check kind，分级扣分，flaky 域名打折）｜233 全绿 |
| **0.1.7** | 上下文注入 + HTTP 总入口（Origin 校验 / CSRF / 5MB 限制）｜190 全绿 |
| **0.1.6** | 豁免总入口（dsh-skip-* 注册表驱动全消费）｜153 全绿 |
| **0.1.5** | 评分总入口（AST 质量检查器 + 权重覆盖）｜128 全绿 |
| **0.1.4** | 自身总入口（VERSION 单一事实源 / README 模板 / helpSync）｜97 全绿 |
| **0.1.3** | git 总入口（resolveToken 三层探测 / pushViaApi / cloneViaApi / 建仓）｜79 全绿 |
| **0.1.2** | 审计总入口（auditChanged / auditFull / 豁免接线）｜44 全绿 |
| **0.1.1** | 规则总入口（13 编译函数 + 首个 yml 槽位）｜31 全绿 |
| **0.1.0** | 功能框架搭建完毕能跑（8 入口骨架 + CLI + 测试）｜16 全绿 |
| **0.0.0** | README 文档（开发计划） |

## 注意事项

- **审计默认关闭**：提交前自动审计默认不开，由侧边栏开启
- **规则加载器铁律**：加字段 = 加函数 + 注册一行，`compileRule` 主体永不修改
- **命名格式统一**：一个功能一个根词，各层只做格式转换，对外 API 与函数名完全一致
- **npm 发布完整性**：dependencies（js-yaml 等）显式声明，files 白名单含 cli.mjs，npm test 一条命令可复现
- **凭据卫生**：token 只写插件配置目录 0600；测试用占位符（`ghp_testtokenplaceholder123`），无真实凭据入库
