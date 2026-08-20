---
name: git-commits-viewer
description: 工作区所有 git 仓库的发现、提交历史/diff 获取、网页查看器（GitHub Desktop 风格）与手动推送。含 find 扫描方法、根提交 diff 处理、只读卷缓存坑、SSH/HTTPS 推送认证。处理"查看 workspace 下所有 git 项目/提交/diff"或维护 git-commits-viewer 网页时加载。
whenToUse: 任务涉及扫描工作区 git 仓库、获取提交历史或文件 diff、启动/维护 git-commits-viewer 网页（端口 4000）、给多个仓库推送到 GitHub 时。
---

# 工作区 Git 仓库扫描与查看（git-commits-viewer）

> 核心能力：自动发现工作区所有 git 仓库 → 获取提交历史与文件 diff → 网页可视化（GitHub Desktop 风格）→ 手动推送。

## 一、访问地址与启动

- **网页**: `http://10.10.10.121:4000`（本机可用 `http://localhost:4000`；不要用 127.0.0.1 对外）
- **启动**（2026-08-18 起从仓库目录运行，仓库即源码真源）:
  ```bash
  cd /vol1/@appshare/DeepSeekHarness/workspace/git-commits-viewer
  node static-server.js  # HTTP 服务器，端口 4000（建议后台任务运行）
  ```
  `generate.js` 生成 HTML 时同样从仓库目录跑（`node git-commits-viewer/generate.js`），产物仍写到 workspace 根目录 `git-commits.html`（static-server.js 内 WORKSPACE 常量指向根目录用于扫描仓库）
- **改前端代码后无需重启**：`app.js` 每次请求从磁盘读，刷新浏览器即可；改 `generate.js`/`static-server.js` 需重启服务器并重跑 `generate.js`

## 一乙、自助维护架构（2026-08-18 确立，⚠️ 必读）

> 解决"开发位置（workspace 根目录）与 git 仓库位置（git-commits-viewer/）双位置不同步"的维护痛点。

**架构原则**：
- **`workspace/git-commits-viewer/` 是唯一源码真源**（git 管理，remote=`git@github.com:EIGHTfs/git-commits-viewer.git`，分支 master）
- workspace 根目录是**运行/产物位置**（HTML、.diff-cache、扫描仓库用）
- 改代码 → 在仓库目录改（或根目录改后同步）→ 跑 `maintain.sh` 自动同步+提交+推送

**自动维护脚本 `maintain.sh`**（在仓库目录）：
```bash
./maintain.sh            # 同步源码→仓库 + 重新生成HTML + commit + push
./maintain.sh --watch    # 监控模式：每 30s 检测源码变更自动维护（后台常驻）
./maintain.sh --force    # 强制维护一轮
```
- 流程: `cp generate.js static-server.js app.js 到仓库` → `node generate.js` 重新生成 HTML → `git commit` → `git push origin master`
- 监控模式当前以 PID 常驻运行（日志 `.maintain-watch.log`）

**网页自动检测**：app.js 内置每 60s 轮询 `/api/repos`，若某仓库 `shortId` 变化 → 提示"检测到仓库更新"并自动刷新当前仓库数据（无需手动点 Refresh）

**维护后验证**：`curl -s http://localhost:4000/api/repos` 确认仓库数；网页 Ctrl+Shift+R 看更新提示

## 二、扫描工作区所有 git 仓库（核心方法）

```js
// 发现所有 .git（含 .gitmerge/ 等子目录里的仓库）
execSync('find "' + WORKSPACE + '" -maxdepth 3 -name ".git" -type d 2>/dev/null', ...)
```

- **范围**: `/vol1/@appshare/DeepSeekHarness/workspace` 下最多 3 层（顶层仓库 + `.gitmerge/` 子目录仓库）
- **排除**: `node_modules/`、`.dsh/` 目录内的 `.git`（那是 skill/会话，不是用户仓库）
- **去重**: 按仓库名（basename）去重，同名只留第一个——`extracted/workspace/DeepSeekHarness-NAS` 与顶层 `DeepSeekHarness-NAS` 会重复，靠此去重
- **已知补充仓库**（不在 find 范围内，硬编码追加）:
  - `/vol02/1000-0-1789e550/gamebanana-mods-downloader`（只读 CIFS 卷）
  - `/vol1/@appshare/DeepSeekHarness/workspace/extracted/workspace/DeepSeekHarness-NAS`
- **过滤**: `rev-list --all --count` 为 0 的空仓库跳过
- 每个仓库收集: name / path / remote / branch / shortId / totalCommits / lastActivity

## 三、获取提交历史

```js
git log --pretty=format:"%H|%h|%s|%an|%ae|%aI" -100        // 提交列表
git log --name-only --pretty=format: -1 <id>              // 每个提交的文件列表
git diff --numstat <id>~1 <id> -- <file>                  // 每个文件的增删行数
```

- **提交类型**（按 message 前缀）: feat/fix/docs/refactor/Revert → 其余 chore
- **numstat 坑**: 根提交（无父提交）`<id>~1` 报 `fatal: bad revision`。必须先检测:
  ```js
  const parent = runGit('rev-parse --verify ' + id + '^', repoPath);
  if (parent) { diffStat = runGit('diff --numstat ' + id + '~1 ' + id + ' -- ' + safeFile, repoPath); }
  ```

## 四、获取文件 diff

- **有父提交**: `git diff <id>~1 <id> -- <file>`（不要用 `<id>^! <id>`，对某些仓库返回空）
- **根提交**: `git show --format= <id> -- <file>`（显示首次提交的全部内容）
- **解析**: 跳过 `diff `/`index `/`---`/`+++`/`Binary` 头；`@@` → hunk；`+` → added；`-` → removed；` ` → context
- **⚠️ 只读卷缓存坑**（关键）: 仓库在 `/vol02`（CIFS 只读）时，往 `repo/.diff-cache/` 写缓存会 EPERM 抛异常，被 catch 吞掉后**静默返回空 diff**（症状：文件明明有 +12/-0 但 diff 0 行）。修复:
  ```js
  const cacheDir = path.join(WORKSPACE, '.diff-cache', path.basename(repoPath)); // 缓存放 workspace，不放仓库
  try { fs.writeFileSync(cachePath, JSON.stringify(result), 'utf8'); } catch (e) {} // 写失败忽略
  ```

## 五、runGit 通用封装（关键）

```js
function runGit(args, cwd) {
    try {
        return execSync('git -c safe.directory=' + cwd + ' ' + args,
            { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    } catch (e) { return ''; }
}
```

- **`-c safe.directory=` 必须加**：`/vol02` 是 CIFS（nobody 所有），不加报 `dubious ownership`。注意：**不能** `git config --global safe.directory`（`~/.gitconfig` 在只读卷上，EPERM 写不进去），只能每次命令带 `-c`
- **`stdio: ['pipe','pipe','ignore']` 必须加**：否则 `git rev-parse --verify <id>^` 对根提交失败时的 `fatal: bad revision` 刷屏到服务器日志（不致命但噪音）

## 六、预加载（打开网页前全部获取）

- `generate.js` 生成 HTML 时对每个仓库跑 `getCommits()`，结果内嵌:
  ```html
  <script>window.REPOS = [...]</script>
  <script>window.COMMITS_MAP = {"repoName": [commits...]}</script>
  ```
- 前端切换仓库**零等待**（数据已在 HTML 里），diff 仍按需 `/api/diff`
- 7 仓库预加载后 HTML 约 70KB，可接受
- 刷新按钮：`delete window.COMMITS_MAP[repo.name]` 后重新 fetch `/api/commits` 并回写

## 七、API 接口（static-server.js）

| 接口 | 说明 |
|------|------|
| `GET /api/repos` | 所有仓库（用同款 find 扫描，见第二节） |
| `GET /api/commits?repo=<name>&limit=100` | 提交历史（含每文件 numstat） |
| `GET /api/diff?repo=<name>&commit=<id>&file=<path>` | 文件 diff（解析为行级 JSON） |
| `GET /api/push?repo=<name>` | 推送：fetch → 检查 ahead/behind → 有 ahead 才 push |

- `resolveRepo(repoParam)`: 用 find 全量扫描匹配 name 或 path，再兜底 knownPaths
- push 逻辑: 先 `fetch origin <branch>`（失败忽略）→ `rev-list --left-right --count branch...origin/branch` → behind>0 提示先 pull → ahead>0 才 push → 无 ahead 返回 `Everything up-to-date`（前端据此禁用 Push 按钮）

## 八、推送认证（多仓库）

- **HTTPS remote 的坑**: 本机 git 缺 `git-remote-https`（`git push` 报 `'remote-https' is not a git command`）。用 HTTPS URL 的仓库必须改用 SSH URL 推送:
  ```bash
  git push git@github.com:EIGHTfs/<repo>.git master
  ```
- **SSH 密钥**（已配全局，`git push origin` 直接可用）:
  - 有效位置: `/vol1/@appshare/DeepSeekHarness/.ssh/id_ed25519`（全局 `core.sshcommand` 指向它）
  - 备份位置: `/vol1/@appshare/DeepSeekHarness/workspace/extracted/.ssh/id_ed25519`（`extracted` 是从 dsh.zip 解压的，权限 777 时 ssh 报 `bad permissions`，需 `chmod 600`）
  - 公钥已注册 GitHub（key title: fnOS），`ssh -T git@github.com` 返回 `Hi EIGHTfs!`
- **GitHub token**: `/vol1/@appshare/DeepSeekHarness/.ssh/github-token`（classic PAT，**绝不提交 git**）。用途: `api.github.com` 建仓库/加公钥/查仓库列表。注意 `curl -H "Authorization: token $TOKEN"` 时 token 文件第一行是注释 `# GitHub token（classic PAT）`，要用 `grep -v "^#"` 过滤
- ⚠️ **本地分支 ≠ 远端默认分支（master vs main）**: 本机部分仓库（ai-work-archive、git-commits-viewer）默认分支是 **master**，不是 main。脚本/插件若硬编码 `git push origin main` 会报 `error: src refspec main does not match any`（commit 成功但 push 失败）。修法:
  ```bash
  git branch --show-current        # 先确认实际分支
  git push origin $(git branch --show-current)
  ```
  实例: dsh-ai-work-archive 插件的 `gitSync` 硬编码 `push origin main`（2026-08-18 实测失败）——用脚本/插件推送前先核对分支名，或推送时显式带分支参数。

## 九、仓库清单（GitHub 账号 EIGHTfs）

| 仓库 | 路径（工作区） | 分支 | 可见性 | 内容 |
|------|--------------|------|--------|------|
| gamebanana-mods-downloader | `/vol02/1000-0-1789e550/...`（只读） | skill | 公开 | gbmd 下载器主项目 |
| DeepSeekHarness-NAS | `workspace/extracted/workspace/...` | main | 公开 | NAS 安装文档 + fpk |
| ai-work-archive | `workspace/ai-work-archive` | master | 私有 | AI 个人留档 |
| git-commits-viewer | `workspace/git-commits-viewer` | master | 私有 | 本查看器自身 |
| dsh-git-rescue | `workspace/.gitmerge/dsh-git-rescue` | main | 公开 | **统一仓库**：git 版本管理+崩溃救援插件；含分支 dsh-snapshot-archive / dsh-guardian |

> 2026-08-18 已删仓库（内容并入 dsh-git-rescue）：`dsh-snapshot-archive`、`dsh-guardian`、`dsh-snapshot-guardian`（GitHub 上已 404，勿再引用）。

## 十、文件结构

```
workspace/
├── generate.js      # 扫描仓库 + 预加载提交 → 生成 git-commits.html
├── static-server.js # HTTP 服务器（端口 4000）+ API
├── app.js           # 前端（仓库切换/提交/diff/Push）
├── git-commits.html # 生成产物（含 REPOS + COMMITS_MAP 内嵌数据）
├── .diff-cache/     # diff 缓存（放 workspace，不放只读仓库）
└── .dsh/skills/git-commits-viewer.md  # 本 skill
```

## 十一、常见坑速查

1. diff 空结果 → 先查 `.diff-cache` 缓存路径是否落在只读卷（修法见第四节）
2. `fatal: bad revision` 刷屏 → `runGit` 没加 `stdio: ignore` 或没检测根提交
3. 切换仓库慢 → 没走 `window.COMMITS_MAP` 预加载（重跑 generate.js）
4. `git push` 报 remote-https 不存在 → 仓库 remote 是 HTTPS URL，改用 SSH URL 推送
5. 仓库重复出现 → 扫描没按 name 去重（extracted 副本与顶层同名）
6. 新仓库不进列表 → 在 find 范围（maxdepth 3）之外，加进 knownPaths 硬编码
7. `ssh: bad permissions` → extracted 里的 key 是 777，chmod 600（用 `/vol1/@appshare/DeepSeekHarness/.ssh/` 那份最稳）
8. push 报 `src refspec main does not match any` → 本地分支是 master，脚本硬编码了 main（见第八节）
