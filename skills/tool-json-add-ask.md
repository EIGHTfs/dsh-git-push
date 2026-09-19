---
name: tool-json-add-ask
description: 工具 json 清单新增询问规则（2026-09-20 EIGHTfs 确立）：本机新增工具（用户提到装了新工具/探测发现新工具/工具使用场景需要）时，先询问用户是否新增到工具 json 清单，不擅自加；清单分两层——运行目录 <配置目录>/tools.json（本机探测结果，不入库、可热改）与源码区 lib/tool-probes.json 模板（随仓库提交）——源码区仅在「工作区有该工具源码/实际使用」时才追加，否则只进运行目录。处理「装了 xx 工具」「把 xx 加进工具清单」「tools.json / tool-probes.json」「探测工具」「工具清单更新」类场景时加载。
whenToUse: 用户提到本机装了新工具、探测发现新工具、或需要把某工具纳入环境注入清单时；改 lib/tool-probes.json 或运行目录 tools.json 前。
generatedBy: deepseek-v4-flash · 2026-09-20
---

# 工具 json 清单新增询问规则（tool-json-add-ask）

> 权威源 = `dsh-git-push/skills/tool-json-add-ask.md`（插件 skill，随插件版本管理）。
> 背景：dsh-git-push 环境注入的工具清单分两层——**源码区模板** `lib/tool-probes.json`（只 key、随仓库提交，决定探测范围）与**运行目录结果** `<配置目录>/tools.json`（key→本机实测路径，不入库、可热改）。本规则约束「什么时候、把什么加进哪一层」。

## 规则

1. **先问，不擅自加**：本机出现新增工具信号（用户说「装了 xx」「用 xx 处理」、探测发现新工具、工具使用场景需要某工具）时，先用 `ask_user_question` 询问是否把它纳入工具 json 清单——列候选工具名与两层落点，用户确认后再动。

2. **两层落点不同**：
   - **运行目录** `<配置目录>/tools.json`（本机探测结果，不入库、可热改）：任何本机已装工具都可进——改 `lib/tool-probes.json` 模板后由探测落盘，或直接热改 tools.json。
   - **源码区** `lib/tool-probes.json` 模板（随仓库提交，决定所有机器探测范围）：**仅限「工作区有该工具的源码/实际使用」才追加**——项目代码里 import 了该工具（如 playwright/puppeteer）、bin/ 或 tool/ 里有它的调用脚本、测试依赖它。工作区没有源码的纯本机工具（如临时装的 CLI），只进运行目录，**不追加进源码模板**。

3. **询问时给出两层选项**：候选工具名 + 「仅本机运行目录」/「连源码模板一起加（需工作区有源码）」/「都不加」；用户选择后执行。

4. **追加模板的提交纪律**：源码模板加了 key → 同步副本 + commit + push（git 纪律）；仅运行目录 → 不入库不提交，探测结果本就只落本机。

## 实例

- ✅ 工作区 dsh-session-migrate 用到 `7z`（代码里调 7z 解压）→ 询问后把 `7z` 加进源码模板。
- ⚠️ 用户说「我本机装了 chromium 截图用」但当前工作区无 chromium 调用源码 → 询问后只进运行目录 tools.json，源码模板不动。
- 2026-09-20 实测：chromium/playwright/puppeteer 加入模板（48 key）——本机未装时探测跳过（found:false 不写盘），装了的机器重启会话后环境注入出现 `chromium=/path/to/chromium`。

## 配套

- `dsh-git-push-functions.md`（插件功能说明书：环境注入与 tools.json 机制）
- `skill-source-rule` / `skill-classification`（插件相关 skill 只放插件项目 skills/）
- `ask-with-options`（询问必须弹选项）
