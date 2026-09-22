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