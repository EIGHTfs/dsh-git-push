---
name: skill.git-rescue
description: git-push 联动 git-rescue 契约（按 linkage-skill-convention 规范）：git-push 的测试环境提交门禁借用 git-rescue 的 isTestHomePath 判定规则（lib/test-home.js），保证两插件对环境判定口径一致。处理「git-push 门禁为什么这么判」「测试环境判定规则从哪来」「改判定规则要注意什么」时加载。
whenToUse: 需要理解/修改 git-push 的测试环境判定、确认 git-push 与 git-rescue 的环境口径一致性、或排查门禁误判时。
generatedBy: user-request 2026-08-20（EIGHTfs：a联动b，a中是skill.b.md；契约独立存）
---

# git-push 联动 git-rescue（契约）

> 联动方向：**git-push ──▶ git-rescue**（借用其测试环境判定规则）
> 按 linkage-skill-convention：本文件是契约（接口速查+联动方式+验证），git-rescue 完整档案见其仓库 `dsh-git-rescue.md`，不重复。

## 一、git-rescue 是什么（一句话）
git 版本管理 + 崩溃自动救援插件（含独立 guardian 守护进程）。

## 二、接口速查（git-push 实际用到的部分）
- `lib/test-home.js` → `isTestHomePath(dshHome)`：DSH_HOME 含 `dsh-test-*`（home/rc7/clean）返回 `true`
- 语义：判定某 DSH_HOME 是否为测试环境（路径含 `dsh-test-home` / `dsh-test-rc7` / `dsh-test-home-clean` 变体）

## 三、联动方式
- `dsh-git-push/lib/core.js` → `isTestEnvHome()`：**复制实现** git-rescue `isTestHomePath` 的同规则（当前非 import 调用）
- 门禁 `checkTestEnvCommitGate()`：测试环境（isTestEnvHome=true）→ 拦截 `commitAndPush()`，返回 `{blocked:true, error:'测试环境禁止 git 提交…走任务清单交接主环境'}`
- 拦截后的交接流程见通用约定（linkage-skill-convention 第六节）

## 四、验证方法
- 测试环境（DSH_HOME 含 dsh-test-*）调用 `commitAndPush` → `blocked:true`
- 主环境（DSH_HOME=/vol1/@appshare/DeepSeekHarness/.dsh）→ `blocked:false`，正常走提交

## 五、⚠️ 修改注意（坑）
- 两处判定规则（git-push `lib/core.js` / git-rescue `lib/test-home.js`）必须**保持一致**——改一方需同步另一方，否则测试/主环境判定口径漂移（门禁误放行或误拦截）
- 长期建议：git-push 改为真正 import git-rescue 的 `isTestHomePath`（消除复制漂移），当前未做
