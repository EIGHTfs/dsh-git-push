---
name: guide-slash-completion
description: dsh-git-push 功能说明：斜杠命令与任务收尾（收尾格式、✅ 即授权推送）。处理斜杠命令与收尾汇报类请求时加载。
whenToUse: 要在输入框用 /git-* 命令，或需要标准任务收尾汇报格式时。
updated: 2026-10-02
generatedBy: deepseek-official/deepseek-v4-flash · EIGHTfs 2026-10-02
---

# 斜杠命令与任务收尾（guide-slash-completion）

> 一句话定位：**输入框里能直接敲的只读查询命令 + 每个任务收尾时的标准汇报格式**——前者给人快速自查，后者让交付有据可查、并决定能否推送。

## 一、斜杠命令（6 条，全部只读）

会话输入框敲 `/` 会弹出发现菜单，本插件注册以下命令：

| 命令 | 作用 | 参数 | 示例 |
|------|------|------|------|
| `/git-audit` | 审计仓库（规则检查 + 质量评分） | `[路径] [--full]` | `/git-audit`（审当前工作区本次变动）、`/git-audit <repo> --full` |
| `/git-scan` | 列出各仓库分支 / 未提交 / 未推送 | `[路径]` | `/git-scan` |
| `/git-io-scan` | 扫描脚本里的文件读写调用与路径，标四级风险 | `[路径] [--write]` | `/git-io-scan --write` |
| `/link-check` | 检查文档内链接有效性 | `[文件或目录]` | `/link-check README.md` |
| `/git-account` | 校验 GitHub 账号与凭据 | — | `/git-account` |
| `/git-clone-preview` | 预览 clone 将下载 / 跳过哪些文件（**不落盘**） | `<owner/repo> [--branch 名]` | `/git-clone-preview EIGHTfs/dsh-git-push` |

**为什么只有只读命令**：输入框一条命令就改远端（提交、建仓、改可见性）风险过高——写类操作一律走 agent 工具，会经过审计门禁、开发者要求清单与推送门禁。唯一与远端交互的是 `/git-clone-preview`，它只读远端文件树回报将下载什么，不下载、不落盘。

### 共同规则

- **默认路径 = 当前会话工作区**；`/git-scan` 不带路径时用插件配置的默认扫描根
- **未分类会话**（无工作区）必须写路径，否则报错退出——不会去扫 DSH 家根
- 相对路径接到会话工作区；无工作区时只能用绝对路径
- `/git-audit` 的目标必须是 git 仓库（含 `.git` 或向上能找到仓库根）；非仓库直接拒绝
- `/git-io-scan` 与审计的 `robustness/io-risk` 同一套 AST 四级标准，默认跳过注释行
- 结果只显示在命令层，**不进模型历史**（官方命令协议）
- 改动命令注册后需**重启实例**，输入框才会出现新命令

## 二、任务收尾汇报（硬约定）

每个有交付物或实质结论的任务，回复结尾必须用**一整行 ═ 分隔线**收尾，并给出状态标记与三要素：

```
══════════════════════════
✅ 任务完成

交付：
- <文件路径 / 功能 / 结论>

验证：
<实测通过 / 单测通过 / 待人工确认——必须如实>

遗留：
<已知边界 / 待办 / 坑；没有可省略>
══════════════════════════
```

| 状态 | 什么时候用 |
|------|-----------|
| ✅ 任务完成 | 目标达成、验证过 |
| ⚠️ 未完成 | 部分达成、有明确遗留 |
| ❌ 失败 | 没达成且已确认原因 |

纯咨询、闲聊可简化为一行「✅ 已解答」。

### 两个配套工具

| 工具 | 用途 | 参数 |
|------|------|------|
| `task_completion_render` | 渲染标准收尾块（分隔线 + 状态 + 三要素），把返回值原样贴到回复结尾 | `delivered`、`verified`、`remaining`、`status`（done/partial/failed） |
| `task_completion_check` | 自检一段收尾文本是否符合格式（分隔线/完成标记/交付/验证/遗留），返回缺失项 | `text` |

推荐流程：先写正文 → 调 `task_completion_render` 拿收尾块 → 贴到结尾（必要时用 `task_completion_check` 自检）。

## 三、✅ 即授权推送

**回复中出现 `✅ 任务完成` 这个标记，即视为对本轮改过的仓库授权 `commit + push`。**

边界：

- 只授权**本会话改过的**仓库，不是全机扫描出的所有仓库
- 只授权**本次任务范围**的改动，不含顺手夹带的无关改动
- 没写收尾块、或写的是 ⚠️/❌ 时，**不构成推送授权**——此时推送仍需单独征得同意
- 提交前仍要过插件自己的门禁：审计拦截、开发者要求清单（提交信息写清做了什么、敏感信息不入库、README 同步等）

## 四、可直接复制的例子

```
# 输入框里自查（不进模型历史）
/git-audit
/git-scan
/git-io-scan --write
/link-check README.md
/git-account
/git-clone-preview ww-rm/azurlane_spinepainting
```

```
# 收尾（agent 侧）
task_completion_render({
  delivered: "修复克隆断点续传：分片不再每轮被清空",
  verified: "新增回归测试 2/2 通过，回退修复即失败",
  remaining: "宿主需重启后生效",
  status: "partial",
})
```

## 五、边界与坑

- 命令**只在输入框可用**，agent 不能调斜杠命令；agent 侧请用同名工具（`code_audit` / `git_scan` / `io_scan` / `link_check` / `git_account_check` / `git_clone_preview`）
- `/git-audit` 不带 `--full` 时审的是「本次变动」，工作区干净时结果会很短，属正常
- 收尾块里的「验证」必须如实——没实测就写「待人工确认」，不要写「实测通过」
- 收尾块是给人快速扫的，正文该讲的细节仍要讲，不要把全部内容塞进收尾块

## 六、相关功能

- 提交推送门禁与返回字段 → `guide/guide-commit-push`
- 审计规则、评分、豁免 → `guide/guide-audit`
- 克隆预览与续传 → `guide/guide-clone-repos`
