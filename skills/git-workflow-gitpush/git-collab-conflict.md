<!-- dsh-skip-sensitive: 规则文档，引用用户决策原文作溯源（豁免仅限敏感内容类规则：措辞/凭据引用；硬编码与质量规则照常） -->

---
name: git-collab-conflict
description: git 协作冲突审查硬规则（约束所有 AI 所有会话）：开发中若 git 发现他人（其他 AI/协作者）修改过自己开发的文件且自己不知情时，优先审查对方改动找 bug（不直接覆盖/合并/盲目继续），确认无误或修复后再继续，并把冲突与审查经验固化进对应 skill。同时声明元规则：本工作区所有固化的 skill（尤其约定类）对所有 AI 所有会话生效，必须遵守。处理"git 发现别人改了/文件被改过/冲突/被覆盖/merge 冲突/他人提交"类请求时加载。
whenToUse: 任何会话在 git 开发中发现他人修改（pull 后出现他人提交、git status 显示非自己改动、merge 冲突、文件被覆盖）、需要评估他人改动质量、或固化协作约定时。
generatedBy: deepseek-official/deepseek-v4-flash
---

> ⭐ **先记住我**：任何会话开始前，先读用户档案 `.dsh/skills/remember-me.md`（优先级最高的 skill）：我是谁、我怎么用你、我立过的规矩。

# git 协作冲突审查（约束所有 AI）

> 规则（2026-08-18 确立）：**git 中发现他人修改过自己开发的代码且不知情 → 优先检查对方 bug**；**固化的 skill 都是所有 AI 必须遵守的 skill**。核心原则：**他人改动先审查后接纳，不盲目覆盖、不盲目合并、不盲目继续**。

## 〇、元规则（最高优先级）

**本工作区（workspace/.dsh/skills/）固化的所有 skill 对所有 AI 所有会话生效，属强约束**：
- 约定类 skill（本文件、dsh-restart-gate、task-completion-report、user-confirmation-style、host-address-convention、skill-repo-sync、ai-collaboration 等）= 所有 AI 必须遵守的规则，不是参考文档
- 任何 AI 在任何会话做相关操作前必须加载并遵守对应 skill
- 新建/更新 skill 后按 skill-repo-sync 同步归档到 ai-work-archive/skills/ 并提交（所有会话自动生效）

## 一、触发场景（git 发现他人修改）

| 场景 | 判定 |
|---|---|
| `git pull` 后有他人提交（非自己的 commit） | ✅ 触发审查 |
| `git status` / `git diff` 显示文件被改动但自己没改 | ✅ 触发审查 |
| merge 冲突：冲突块来自他人改动 vs 自己改动 | ✅ 触发审查 |
| 文件被覆盖/回退（内容与记忆不符） | ✅ 触发审查 |
| 多人协作仓库（如 ai-work-archive 有并行会话） | 每次 pull 前留意 |

⚠️ **"作为本来的开发者不知道"是关键**：自己开发的项目/文件出现陌生改动 = 必须查对方改了什么、为什么、有没有 bug。

## 二、审查流程（先审查后接纳）

1. **识别改动范围**：
   ```bash
   git log --oneline -10                    # 看最近提交（他人 vs 自己的）
   git log --name-status -3                  # 最近改动涉及哪些文件
   git diff origin/<branch>..HEAD --stat     # 远端 vs 本地差异
   git status --short                        # 工作区未提交改动
   ```
2. **定位他人改了什么**：
   ```bash
   git log --all --oneline -- <file>         # 某文件的全部提交历史
   git diff <他人commit>~1 <他人commit> -- <file>   # 对方具体改动
   ```
3. **优先查对方 bug**（核心，不跳过）：
   - 对方改动是否破坏自己已实现的功能/约定（API 签名、字段名、端口、路径、配置键、时序）
   - 对方改动是否引入明显错误（拼写、未定义变量、错误分支、缺失导入、与 DSH 机制冲突）
   - 对方是否违反本工作区 skill 约定（如 dsh-plugin-dev 的验证状态表、dsh-restart-gate、task-completion-report）
   - 逐项列出"对方改了什么 → 潜在 bug → 影响"，形成审查结论
4. **处理**：
   - 对方改动**有 bug** → 指出 + 修复（或回退对方改动，说明原因）
   - 对方改动**正确** → 采纳（merge/reset 到对方版本），继续自己的开发
   - 对方改动**与自己冲突** → 保留自己版本并说明冲突点，必要时询问用户
5. **固化经验**（规则）：
   - 把"冲突内容 + 对方 bug + 处理方式"提炼进对应项目的 skill（或本 skill 的实战记录节）
   - 若发现的是通用坑（如"并行会话容易覆盖 workspace.json"）→ 写进通用 skill（dsh-backup-restore / ai-collaboration 等）

## 三、典型教训（本机实证）

- **并行会话互踩**：多个 AI 会话同时开发会互相覆盖文件（尤其 `storages/workspace.json`、`cordis.patch.yml`、`lib/index.js`）——pull 前先 `git fetch` 看远端是否被推进（skill-forge 十一节同源）
- **"写了没测试"的他人改动**：对方提交了代码但验证状态不明（mock 过 vs 真机过）——审查时核对对方声称的验证是否属实，不轻信 commit message
- **版本分裂**：同一文件 workspace 版与归档版（~/.dsh/skills vs workspace/.dsh/skills）不同步——以 workspace 为权威源，冲突时用 mtime 最新判定（dsh-plugin-dev 十一节）

## 四、速查

| 情况 | 做法 |
|---|---|
| pull 后有他人提交 | 先 `git log` 看对方改了什么，再决定 merge |
| 文件被改但不知情 | `git diff` 审查对方改动 → 查 bug → 修复/采纳 |
| merge 冲突 | 逐个冲突块判断：对方对 / 自己错 / 需保留自己 |
| 对方改动有 bug | 指出 + 修复 + 固化进 skill |
| 对方改动正确 | 采纳后继续开发 |
| 固化新 skill / 更新 skill | 同步 ai-work-archive 并提交（元规则：所有 AI 遵守） |

## 相关

- remember-me（先记住我）：用户档案，优先级最高的 skill