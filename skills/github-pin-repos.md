---
name: github-pin-repos
description: GitHub 个人主页置顶仓库与代表作展示（Pinned Repositories / Profile README）。含置顶步骤、上限与限制、自定义简介文案、Gist 置顶、Profile README 替代方案；核心事实是无置顶 API、只能网页手动操作。处理"把 X 置顶到 GitHub"、"怎么设置热门作品/代表作"、"pin repository"、"置顶不了怎么办"类请求时加载。
whenToUse: 用户要求置顶某个仓库（如"置顶 dsh-git-rescue"）、问如何展示主页项目、或问能否用脚本/API 置顶时加载。
generatedBy: agnes/agnes-2.5-flash
---

> ⭐ **先记住我**：任何会话开始前，先读用户档案 `.dsh/skills/remember-me.md`（优先级最高的 skill）：我是谁、我怎么用你、我立过的规矩。

# GitHub 置顶仓库（Pinned Repositories）

> 经验来源：2026-08-18 会话（用户问"GitHub 上能否设置热门作品/代表作"→"置顶 dsh-git-rescue"）。核心原则：**置顶是纯网页手动操作，无任何官方 API**；agent 能交付的是精确步骤、文案素材与替代展示方案，不是替用户点击。

## 一、硬性事实（先讲清楚，避免浪费时间）

- **无置顶 API**：GitHub REST 与 GraphQL 都只能**读取**置顶状态（GraphQL 的 `pinnedAt` 字段、`Pinnable` 接口），没有任何 mutation/REST 端点可写置顶。网上搜"GitHub pin repository API"出来的文档全部是查询类。
- 社区"脚本置顶"= 浏览器自动化模拟点击（Puppeteer/Selenium），需要用户自己的登录态，不建议代跑。
- 因此接"帮用户置顶 XX"任务时，可行交付 = ① 精确步骤 ② 简介/README 文案 ③ 替代展示方案，并明确告知"最后一步需用户在浏览器点"。

## 二、置顶步骤（浏览器，约 30 秒）

1. 打开 `https://github.com/<用户名>`（个人主页）
2. **Pinned / 置顶** 区域 → **Customize your pins / 定制你的置顶**
3. 勾选要置顶的仓库（上限 **6 个**）→ **Save pins**
4. 点置顶卡片的 ✏️ 编辑，可为每个仓库写**自定义简介**（显示在仓库名下方）
5. 挑选排序可用：最近更新 / Star 数 / 名字

## 三、可置顶对象与限制

| 对象 | 说明 |
|---|---|
| 自己的仓库 | ✅ 最多 6 个；公开/私有均可（私有仅自己可见）；无需有 Star |
| Gist | ✅ 个人主页 Pinned 区同样可 pin，适合代码片段 |
| 别人的仓库 | ❌ 不能置顶到自己的主页（只能 Star / 加到自己的仓库列表） |
| Trending 榜单 | ❌ 置顶无效；由 Star 增长速度与社区热度决定，无法手动设置（真正的"热门"） |

## 四、替代/增强方案：Profile README

6 个置顶位不够或想更显眼时，建与用户名**同名仓库** `<用户名>/<用户名>`，README 写自我介绍 + 代表作列表，展示在主页顶部（比置顶区更靠前）：

- 增强组件：**github-readme-stats** 卡片（Star 总数、最常用语言）、**shields.io** 徽章、项目表格（链接 + 一句话简介）
- 实例文案（EIGHTfs/dsh-git-rescue 置顶简介，实测推荐）：
  > DSH 崩溃自动救援：git 版本管理 + guardian 守护进程，kill -9 / 配置损坏 5 秒自愈

## 五、执行边界（agent 接"置顶 XX"任务时）

1. 先确认该仓库**公开**（私有置顶对访客无意义）；如未公开，先引导公开化
2. 给出步骤 + 可复制文案，明确"最后一步需浏览器人工操作"
3. 用户要求"你能做的自动化"时：改为起草 Profile README 段落、加 ⭐ Star 引导按钮、更新仓库 README 门面
4. 不要把"无 API"解释成"接口坏了/404"；顺带注意：官方仓库 Discussions 发帖对非协作者 POST 返回 404（见 dsh-git-rescue skill 的权限坑），置顶相关别走 API 路线

## 六、速查

- 置顶上限：**6 个**仓库（+ 若干 Gist）
- 操作路径：`https://github.com/<用户名>` → Pinned 区 → Customize your pins
- 文档参考（仅只读）：GitHub GraphQL 的 `pinnedAt` / `Pinnable`（Enterprise 文档同样适用）
- 关联 skill：README 写作与包装见 `readme-craft`；本项目发布状态见 `dsh-git-rescue`
