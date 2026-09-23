# 方案：io-risk 规则推断与准确率评估

> 2026-09-23 记录。内容 = ① 新推断规则设计（五条规则 + 判定矩阵 + 实现代码 + 盲区）
> ② 用该规则集对 dsh-theme-mediascape 项目做人工准确率评估的结论与改进建议。
> 关联实现目录：`lib/audit-rules/`（io-risk 规则）、`lib/audit/`（审计执行）。

---

## 一、新推断规则（用户提供，2026-09-23）

静态扫描无法直接知道文件大小——文件大小是运行时信息，代码里只有路径。但可以用启发式规则推断，准确率能到 80% 左右。

### 规则一：看路径名（最有效）

```javascript
// 小文件特征（命中则豁免）
/\.(json|ya?ml|toml|ini|env|conf|config)$/i
/package\.json$/
/tsconfig\.json$/
/\.env(\.|$)/

// 大文件特征（命中则告警）
/\.(log|sql|csv|zip|tar|gz|mp4|png|jpg|pdf|db|sqlite)$/i
/data\/|logs\/|uploads\/|backup\//
```

命中率：约 70%。配置文件通常小，日志/数据/媒体通常大。

### 规则二：看调用位置

```javascript
// 启动路径 → 推断小文件（豁免）
function apply() { fs.readFileSync(...) }
function init()  { fs.readFileSync(...) }
function main()  { fs.readFileSync(...) }
// 模块顶层 → 通常是配置，豁免
const config = JSON.parse(fs.readFileSync('config.json'))

// 请求路径 → 推断大小不确定（告警）
async function handleRequest(req) { fs.readFileSync(...) }
app.get('/api/...', (req, res) => { fs.readFileSync(...) })
```

命中率：约 85%。启动时读的 99% 是小文件。

### 规则三：看是否在循环内

```javascript
// 循环内 → 不管文件大小，累积阻塞都危险
for (const file of files) {
  fs.readFileSync(file)  // 循环 1000 次，即使每个 1KB 也卡
}
```

命中率：100%。循环内的问题不是文件大小，而是次数累积。

### 规则四：看变量名和注释

```javascript
// 变量名暗示小文件
const config = fs.readFileSync('...')
const pkg = fs.readFileSync('...')
const template = fs.readFileSync('...')

// 变量名暗示大文件
const logContent = fs.readFileSync('...')
const csvData = fs.readFileSync('...')
const imageBuffer = fs.readFileSync('...')
```

命中率：约 60%。不如路径名可靠。

### 规则五：路径是否可静态确定

```javascript
// 路径是字面量 → 可以进一步推断
fs.readFileSync('config.json')        // 路径明确，按扩展名判断
fs.readFileSync('./templates/a.html') // 路径明确

// 路径是变量 → 无法推断
fs.readFileSync(userProvidedPath)     // 无法判断
fs.readFileSync(path.join(dir, name)) // 无法判断
```

路径不可确定时，倾向于告警（宁可误报，不可漏报）。

### 综合判定矩阵

| 路径名 | 调用位置 | 在循环内 | 判定 |
|---|---|---|---|
| .json / .yaml | 启动路径 | 否 | 🟢 豁免 |
| .json / .yaml | 请求路径 | 否 | 🟡 警告（可能是小文件，但位置不对） |
| .log / .csv | 任意 | 否 | 🔴 告警 |
| 任意 | 任意 | 是 | 🔴 告警 |
| 路径是变量 | 请求路径 | 否 | 🟠 需人工复核 |

### 实现代码

```javascript
function classifySyncIO(node, context) {
  const pathArg = extractPathArgument(node)  // 提取路径字面量
  const inLoop = isInsideLoop(node)
  const inStartup = isInsideFunction(context, ['apply', 'init', 'main'])
  const isTopLevel = context.isTopLevel

  // 1. 循环内 → 直接告警
  if (inLoop) return { level: 'error', reason: '循环内同步 I/O' }

  // 2. 启动路径或模块顶层 → 豁免
  if (inStartup || isTopLevel) return { level: 'pass', reason: '启动路径' }

  // 3. 路径是字面量 → 按扩展名判断
  if (pathArg) {
    if (/\.(json|ya?ml|toml|ini|env|conf)$/i.test(pathArg)) {
      return { level: 'warn', reason: '请求路径中的小文件同步 I/O' }
    }
    if (/\.(log|csv|sql|zip|mp4|png|jpg|pdf|db)$/i.test(pathArg)) {
      return { level: 'error', reason: '请求路径中的大文件同步 I/O' }
    }
  }

  // 4. 路径是变量 → 无法判断，倾向告警
  return { level: 'warn', reason: '路径不可静态确定，需人工复核' }
}
```

### 静态推断的盲区

| 盲区 | 例子 | 后果 |
|---|---|---|
| 路径拼接 | path.join(dir, name) | 无法判断扩展名 |
| 动态路径 | fs.readFileSync(process.env.CONFIG) | 完全未知 |
| 同名不同大小 | data.json 可能 1KB 也可能 100MB | 扩展名不可靠 |
| 运行时才知道 | 用户上传的文件 | 无法预判 |

这些情况只能运行时检测，静态扫描标注为「需人工复核」。

**最务实的做法**——静态扫描不追求 100% 准确，只做风险分层：

| 层级 | 判定 | 处理 |
|---|---|---|
| 🟢 豁免 | 启动路径 / 顶层 / 明确小文件扩展名 | 不报警 |
| 🟡 警告 | 请求路径 + 小文件扩展名 / 路径不可确定 | 提示，不阻断 |
| 🔴 错误 | 循环内 / 请求路径 + 大文件扩展名 | 阻断，必须改 |

剩下的靠运行时：压测或监控下 fs.readFileSync 耗时可用 perf_hooks 或 APM 测量，真实数据比静态推断准得多。

> 一句话：静态扫描判断不了文件大小，但能判断「路径像不像配置」「在不在启动路径」「在不在循环里」。三条规则组合准确率能到 80%，剩下 20%（路径拼接、动态路径、同名不同大小）标「需人工复核」不强行判断。审计规则的价值不是 100% 准确，而是把风险从「看不见」变成「看得见，分层处理」。

---

## 二、人工准确率评估（dsh-theme-mediascape，2026-09-23）

### 评估方法

用上述五条规则框架，对 dsh-theme-mediascape **生产代码 65 处 io-risk findings** 逐条读实际代码核对，
标记「真警告 vs 误报/过度」，统计规则在本项目的准确率。

（注：test/e2e/ 测试文件 ~78 处按测试目录可豁免，build.cjs 9 处为构建脚本一次性初始化，不计入生产评估。）

### 结果：真警告 2 处（3%） / 误报过度 63 处（97%）

#### ① 真警告（规则正确抓住）—— 2 处

| 位置 | 为什么真 |
|---|---|
| handlers.js L550 `readFileSync` 读日志 | 请求路径 + **wallpaper.log 会持续追加增长**（可能数 MB），全量读 split 后 slice——规则二「请求路径」+ 规则三「循环内」都命中，**正确告警** |
| index.js L51 `statSync` serveStream | 请求路径（视频流式响应），每请求 stat——规则二命中，**轻微但正确** |

#### ①·补 按新规则判定后的「豁免正确准确率」（2026-09-23 补）

用新规则五条对 65 处逐个判定，**聚焦「新规则说豁免 → 实际操作是否无害」**：

| 新规则判定豁免 | 处数 | 实际无害 | 豁免正确 |
|---|---|---|---|
| bootstrap.js（apply 启动迁移） | 12 | 12 | ✓ |
| debug.js（JSON 配置读 + 日志追加/轮转） | 6 | 6 | ✓ |
| labels.js（<1KB JSON tmp+rename 原子写） | 4 | 4 | ✓ |
| handlers.js info（启动清理孤儿 .part + loadLabels） | 9 | 9 | ✓ |
| **合计** | **31** | **31** | **100%** |

**结论**：
- **豁免精确率 = 31/31 = 100%**——新规则放行的全部安全，**安全侧零误放**（没有把危险操作错放过去）。
- **豁免召回 ≈ 61%**（31/51 应豁免的）——online.js 13 处（启动后台下载 rmSync/renameSync 单 .part）
  + handlers.js warning 保守项没被豁免。原因：新规则靠**函数名白名单** apply/init/main 判启动路径，
  `downloadAllOnline`/`copyDirInto` 等自定义名不在名单 → 「该豁免没豁免」。但没豁免只是**保守告警**，
  绝不误放危险项——安全侧宁紧勿松，这正是审计该有的样子。

#### ①·补2 逐处具体对照（新规则判定 ↔ 实际代码依据）

**A. 新规则判定【豁免】且实际无害（31 处，豁免正确率 100%）**

| 文件 | 行 | 操作 | 所在函数 | 新规则依据 | 实际代码做什么 |
|---|---|---|---|---|---|
| bootstrap.js | L29 | existsSync | loadDirMigrations | 顶层函数被 apply 启动调用 | 检查 dirs 迁移配置是否存在（`DIRS_CONFIG_FILE`） |
| bootstrap.js | L30 | readFileSync | loadDirMigrations | 启动路径 + .json 配置 | 读迁移配置 JSON（小文件） |
| bootstrap.js | L51 | existsSync | copyOnce | 启动路径 | 检查仓库源目录是否存在 |
| bootstrap.js | L54 | existsSync | copyOnce | 启动路径 | 检查目标数据目录是否已存在（幂等跳过） |
| bootstrap.js | L55 | readdirSync | copyOnce | 启动路径 | 读目标目录判断是否非空 |
| bootstrap.js | L59 | mkdirSync | copyOnce | 启动路径 | 创建目标父目录（recursive） |
| bootstrap.js | L70 | existsSync | copyInto | 启动路径 | 检查单文件是否已存在 |
| bootstrap.js | L71 | mkdirSync | copyInto | 启动路径 | 创建父目录（recursive） |
| bootstrap.js | L72 | copyFileSync | copyInto | 启动路径 | 复制单个小文件 |
| bootstrap.js | L77 | mkdirSync | copyDirInto | 启动路径 | 递归建目录 |
| bootstrap.js | L78 | readdirSync | copyDirInto | 启动路径 | 读源目录列表 |
| bootstrap.js | L81 | statSync | copyDirInto | 启动路径 | 判断子项是否目录 |
| debug.js | L46 | readFileSync | readDebugConfig | 启动路径 + .json 配置 | 读 debug.json 配置（<1KB） |
| debug.js | L105 | existsSync | logEnabled | 顶层查询 | 检查日志开关配置存在 |
| debug.js | L107 | existsSync | logEnabled | 顶层查询 | 同上 |
| debug.js | L122 | existsSync | writeLog | 日志路径 | 检查日志文件存在 |
| debug.js | L126 | statSync | writeLog | 日志路径 | 轮转前看大小（小文件 stat） |
| debug.js | L130 | appendFileSync | writeLog | 日志路径 | 追加单行 JSON 日志（流式正常） |
| labels.js | L19 | existsSync | readMap | 小文件（labels JSON） | 检查标签映射文件存在 |
| labels.js | L27 | mkdirSync | writeMap | 小文件 + tmp+rename | 创建标签目录 |
| labels.js | L29 | writeFileSync | writeMap | 原子写模式 | 写 tmp 文件（<1KB JSON） |
| labels.js | L30 | renameSync | writeMap | 原子写模式 | tmp → 正式名（同卷瞬时） |
| handlers.js | L279 | existsSync | cleanupOrphanParts | 启动路径 | 检查孤儿 .part 是否存在 |
| handlers.js | L281 | readdirSync | cleanupOrphanParts | 启动路径 | 列目录找孤儿 .part |
| handlers.js | L284 | statSync | cleanupOrphanParts | 启动路径 | stat 判断 .part |
| handlers.js | L549 | existsSync | handleWallpaperLogRead | 启动/查询 | 检查日志文件存在 |
| handlers.js | L561 | existsSync | loadLabels | 启动/查询 | 检查标签文件存在 |
| handlers.js | L584 | existsSync | savelLabels（清理） | 启动/查询 | 检查标签文件存在 |
| handlers.js | L586 | unlinkSync | savelLabels（清理） | 标签清理 | 删标签映射文件（小文件） |
| handlers.js | L591 | mkdirSync | savelLabels（清理） | 启动/查询 | 建标签目录 |
| handlers.js | L592 | renameSync | savelLabels（清理） | tmp+rename 原子写 | 标签原子写落定 |

**B. 新规则判定【告警/未豁免】但实际无害（28 处，保守告警非误放）**

| 文件 | 行 | 操作 | 所在函数 | 实际代码做什么 | 为何无害 |
|---|---|---|---|---|---|
| handlers.js | L44 | existsSync | handleUpload | 上传前检查对应 .part 是否存在（断点续传） | 单文件 stat 微秒级 |
| handlers.js | L49 | existsSync | handleUpload | 同上 | 单文件 stat 微秒级 |
| handlers.js | L56 | mkdirSync | handleDelete | 删除壁纸建 .trash 目录（recursive） | mkdir 幂等微秒级 |
| handlers.js | L57 | renameSync | handleDelete | 壁纸文件移到 .trash（同卷） | rename 非数据搬运，同卷瞬时 |
| handlers.js | L74 | existsSync | handleList | 检查壁纸目录存在 | 单文件 stat |
| handlers.js | L82 | readdirSync | handleList | 列壁纸目录 | 小目录 list |
| handlers.js | L90 | statSync | handleList | 取每个壁纸 mtime+size 算 etag | 小文件 stat |
| handlers.js | L107 | existsSync | handleList(online) | 检查在线目录 | 单 stat |
| handlers.js | L109 | readdirSync | handleList(online) | 列在线目录 | 小 list |
| handlers.js | L122 | statSync | handleList(online) | 在线项 stat | 小 stat |
| handlers.js | L150 | existsSync | handleWallpaperLog | 检查日志文件 | 单 stat |
| handlers.js | L158 | readdirSync | handleUpload 启动清理 | 列目录查孤儿 .part | 小 list |
| handlers.js | L247 | unlinkSync | streamToPart abort | 上传超限清 .part（异常路径） | 罕见触发 + 单文件 |
| handlers.js | L268 | unlinkSync | streamToPart error | 上传出错清 .part（异常路径） | 罕见触发 + 单文件 |
| handlers.js | L324 | unlinkSync | handleUpload cancel | 用户取消清 .part | 单文件 unlink |
| handlers.js | L332 | existsSync | handleUpload cancel | 检查 cancel part 存在 | 单 stat |
| handlers.js | L435 | mkdirSync | handleMusicUpload | 音乐上传建目录（recursive） | mkdir 幂等 |
| handlers.js | L568 | unlinkSync | handleDelete | 删除壁纸后清磁盘文件 | 单文件 unlink（用户主动删） |
| index.js | L51 | statSync | serveStream | 视频流式响应取 total 算 Range | 前置元数据（流式本体已 async） |
| index.js | L199 | existsSync | 静态资源 | 404 前检查文件存在 | 单 stat |
| online.js | L32 | existsSync | loadOnlineSources | 检查在线源配置存在 | 单 stat |
| online.js | L33 | readFileSync | loadOnlineSources | 读 sources.json（小文件，启动一次） | 配置小文件 |
| online.js | L58 | mkdirSync | downloadOne | 建在线下载目录（recursive） | mkdir 幂等 |
| online.js | L67 | existsSync | downloadOne | 检查 .part 存在 | 单 stat |
| online.js | L71 | existsSync | downloadOne | 检查最终文件存在 | 单 stat |
| online.js | L73 | rmSync | downloadOne | 清残留 .part（单文件） | 单文件删 |
| online.js | L89 | existsSync | prehash | 检查 .part 存在 | 单 stat |
| online.js | L96 | statSync | prehash | 取 .part 大小 | 小 stat |
| online.js | L114 | rmSync | handleResponse | Range 不支持重下前清 .part | 单文件删 |
| online.js | L138 | rmSync | handleResponse | 超限清 .part | 单文件删 |
| online.js | L148 | rmSync | handleResponse | SHA-1 不匹配清 .part | 单文件删 |
| online.js | L152 | renameSync | handleResponse | 下载完成 .part → 正式名（同卷） | rename 非拷贝 |
| online.js | L182 | mkdirSync | downloadAllOnline | 启动建在线目录 | mkdir 幂等 |

**C. 真问题（规则应当告警，实际确认有害）—— 2 处**

| 文件 | 行 | 操作 | 所在函数 | 实际危害 |
|---|---|---|---|---|
| handlers.js | L550 | readFileSync | handleWallpaperLogRead | 请求路径**循环读 wallpaper.log 全量**再 split；日志持续追加可能数 MB，阻塞事件循环 |
| index.js | L51 | statSync | serveStream | 请求路径每视频请求 stat（轻微；流式本体已 async，仅前置元数据） |

> 对照结论：新规则在 65 处上「豁免 31 处 → 100% 无害」「未豁免 34 处 → 其中 28 处实际无害（保守告警不误放）、2 处真问题（告警正确但 index.js 那条偏轻微）」。整体**未出现「豁免了危险项」的漏放**。

#### ② 误报/过度（规则错杀）—— 63 处

| 类 | 处数 | 实际真相 | 规则哪里失灵 |
|---|---|---|---|
| bootstrap.js 全部 12 处 | 12 | **启动路径**（apply() 一次性数据目录迁移），规则二明确「启动→豁免」 | 审计只按**函数名白名单** apply/init/main 识别启动，本项目用 `copyDirInto`/`loadDirMigrations` 等自定义名 → 漏判启动语义 |
| handlers.js renameSync L57 | 1 | DELETE 壁纸 → **rename 移 .trash**，同卷元数据操作微秒级，非数据拷贝 | rename 一律加权「高风险」——但 rename 不是数据搬运 |
| handlers.js unlinkSync L247/268/324 | 3 | 上传**异常/cancel 路径**清 .part（罕见触发 + 单小文件） | 「请求路径 delete 加权」→ 但 unlink 单文件微秒级，且只发生在出错时 |
| handlers.js mkdirSync L435 | 1 | 音乐上传**创建目录** recursive（通常已存在，零开销） | 「异步路径同步 I/O 加权」→ 但 mkdir 幂等微秒级 |
| online.js 全部 13 处 | 13 | **启动后台下载**（apply 触发 downloadAllOnline），rmSync/renameSync 单 .part 文件微秒级 | 同 bootstrap：`downloadAllOnline` 不入启动名单漏判；rename 加权错杀 |
| debug.js 6 处 | 6 | 日志读写（appendFileSync 单行 / 轮转前 stat）小文件高频合理 | 「写路径加权」→ 但日志写入本就是 append 流式 |
| labels.js 4 处 | 4 | `writeMap` 标签 JSON **tmp+rename 原子写**（标准模式，文件 <1KB） | rename 加权错杀原子写模式 |
| index.js L199 existsSync | 1 | 静态文件 404 检查，请求路径 stat 小文件 | 微秒级元数据，规则二「请求路径」过度 |

### 准确率统计

```
实际真问题: 2 处（日志循环读 + serveStream stat）
规则告警:  65 处
真告警率（precision）: 2/65 ≈ 3%
漏报（recall）: 大体无漏（真正危险的大文件流式读写均已 async）
```

---

## 三、核心失灵点与改进建议

### 失灵点

1. **启动路径豁免靠函数名白名单**（apply/init/main）——本项目启动代码用 `bootstrapDataDirs`/`downloadAllOnline` 等自定义名 → 启动语义漏判，**12+13=25 处误报的根源**。
2. **rename/unlink/mkdir 的「加权高风险」对单文件元数据操作错杀**——rename 非拷贝、unlink 单文件、mkdir 幂等，均微秒级，不应与「读大文件」同权。
3. 「请求路径 + 任何 I/O」一刀切——但 stat/exists/readdir 单个小文件本来就是服务端常规写法（毫秒级），不应告警。

### 改进建议

1. **启动路径识别升级**：从「函数名字面量」升级为「**调用链可达 apply/init/main**」——即识别 `bootstrapDataDirs()` 被 `apply()` 调用，则 bootstrapDataDirs 内所有同步 I/O 视为启动路径豁免。需 AST 调用图。
2. **rename/unlink/mkdir 降级**：单文件元数据操作（rename/unlink/mkdir recursive）降为**中/低风险**，除非：目标文件扩展名属大文件（.log/.mp4 等）或**在循环内**。
3. **保留强规则**：「循环内任何同步 I/O」分析一个循环体对单个文件重读累加时告警；「请求路径 + 大文件扩展名」告警。
4. **新增弱豁免**：`tmp + rename` 原子写模式（writeMap 类）、`appendFileSync` 日志追加、`mkdirSync(recursive)` 幂等创建——识别为惯用安全模式直接豁免。
5. **抽象出「单文件微秒级元数据操作」概念**：stat/exists/readdir/unlink(single)/rename/mkdir(recursive) 统一归为「元数据操作」低风险档，与「读/写数据内容」的 readFileSync/writeFileSync/流式 I/O 分档。

### 预期效果

按上述改进，本项目 65 处中约 60 处会降为可接受的豁免/低风险，真告警聚焦到「循环读日志」「请求读大文件」等真正危险点，precision 从 3% 大幅提升。

---

## 相关

- 实现：`lib/audit-rules/`（io-risk 规则定义）、`lib/audit/`（审计执行与评分）
- 配套：`docs/方案-audit-history-历史提交审计.md`、`docs/方案-文档维度加分制.md`
- 验证脚本：`test/test-io-risk.mjs`