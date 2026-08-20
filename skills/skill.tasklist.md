---
name: skill.tasklist
description: git-push 联动 dsh-tasklist 契约（按 linkage-skill-convention 规范）：测试环境提交被门禁拦截时，把待提交改动写进任务清单（POST /api/tasklist/create）交接主环境执行 commit+push。处理「测试环境提交被拦后清单怎么生成」「交接清单走 tasklist API 还是手写」「git-push 与任务清单的衔接」时加载。
whenToUse: 在测试环境会话收到 git-push 门禁拦截、需要生成交接清单、或确认 git-push 与 dsh-tasklist 的衔接方式时。
generatedBy: user-request 2026-08-20（EIGHTfs：a联动b，a中是skill.b.md；契约独立存）
---

> ⭐ **先记住我**：任何会话开始前，先读用户档案 `.dsh/skills/remember-me.md`（优先级最高的 skill）：我是谁、我怎么用你、我立过的规矩。

# git-push 联动 dsh-tasklist（契约）

> 联动方向：**git-push ──▶ dsh-tasklist**（门禁拦截后的交接清单由任务清单插件管理）
> 按 linkage-skill-convention：本文件是契约，dsh-tasklist 完整档案见其仓库 `skills/dsh-tasklist.md`，不重复。

## 一、dsh-tasklist 是什么（一句话）
任务清单插件：自动维护「任务」工作区（目录+会话+注册表），代码级 API 管理任务清单 md。

## 二、接口速查（git-push 用到的部分）
- `POST /api/tasklist/create`：创建清单 `{type, title, sections:{repos[], items[]}, content?, overwrite?}`
- `GET /api/tasklist/list`：扫描全部清单（含勾选进度）；`GET /api/tasklist/read?name=`：读单份
- `POST /api/tasklist/done`：勾选 `{name, index, checked}`
- 清单根目录：`/vol1/@appshare/DeepSeekHarness/任务`（.dsh 同层级）

## 三、联动方式
- 测试环境（DSH_HOME 含 dsh-test-*）会话改动代码 → git-push 门禁 `checkTestEnvCommitGate()` 拦截 commit/push
- 正确姿势：**调 `/api/tasklist/create` 生成交接清单**（type=`git-handoff` 或「提交」，sections.repos 写涉及仓库，items 写待提交文件）→ 主环境会话按清单执行 commit+push
- 无 dsh-tasklist 插件时兜底：按 linkage-skill-convention 第六节手写同格式 md 到「任务」文件夹

## 四、验证方法
- 创建后 `GET /api/tasklist/list` 能看到新清单（name 符合 `任务清单-<类型>-<主题>-<日期>.md`）
- 主环境按清单提交推送成功后，勾选对应项（done）或删除清单

## 五、完整档案
- dsh-tasklist 档案：`dsh-tasklist/skills/dsh-tasklist.md`（本项目）
- 通用交接流程：`linkage-skill-convention.md` 第六节
