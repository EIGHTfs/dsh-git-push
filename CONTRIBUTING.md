# 贡献指南（Contributing）

本插件是 DSH（DeepSeek Harness）的第三方插件。改动请遵循下面的约定——它们来自本仓库实际使用中踩过的坑。

## 一、跑起来

```bash
# 跑全量测试（零依赖，无需安装）
for t in test/*.mjs; do node "$t"; done

# 单跑一个
node test/test-tool-contract.mjs
```

约定：**零运行时依赖**，不引入 npm 依赖，不加构建步骤（源码即产物，改完即生效）。

## 二、提交前必须过三关

1. **全量测试 0 失败**（含新增测试；改了行为就补对应回归）
2. **文档产物同步**：`node scripts/doc-func.mjs apply`、`node scripts/doc-tree.mjs sync && apply`、`node scripts/doc-version.mjs apply`——三项 `check` 必须无漂移
3. **自审无拦截**：`git-sluice audit <仓库>` 或提交时的审计门禁（blocker 必须清零）

## 三、提交信息怎么写

- 写清**做了什么**，不要「update」「fix 一下」这类空泛词；建议 `feat:` / `fix:` / `docs:` / `refactor:` / `test:` 前缀
- **公开仓库的提交信息与文档不要写会话残留**（用户原话/对话转述/AI 许可表述等一律不进仓库）；需要保留需求原句时，只放在提交信息里
- 发版提交的信息里**带版本号**（如 `feat: 2.4.1 — …`），版本表按提交信息聚合，不带版本号就不会出现在版本表里
- 修 bug 的提交请写清**现象 → 根因 → 修法 → 验证**（便于回溯；本仓库的历史提交都是这个结构）

## 四、版本纪律

- 三处版本号必须一致：`lib/self/index.js` 的 `VERSION`、`package.json` 的 `version`、版本表（`docs/CHANGELOG.md` 由 `doc-version` 生成）
- **纯优化不升版本**：可以做多次本地提交建立暂存点，全部完成后压缩成一次提交推送
- 发版时才升版本号，并在 `version-metrics.json` 里补一句量化对比（如「误报 16 → 0」），版本表会带上它

## 五、写代码的约定

- 注释讲**为什么**（背景/坑/取舍），不复述代码；注释一律用 `//` 逐行，不写块注释
- **注释与文档里不写日期**：日期属于 git 提交（`comment/no-date-in-comment` 规则会拦）
- 单文件非必要不超过 400 行；函数复杂度超阈值时优先**提纯函数**而不是加豁免
- 审计规则的作用域字段（`exts` / `include_paths` / `exclude_paths` / `file_patterns`）语义见 `docs/功能-审计规则体系.md`——**自家纪律不要固化成审计规则**（会对任何仓库生效，必然在第三方项目大面积误报）

## 六、加/删工具（公开面变更）

工具是宿主可见的公开接口，增删必须显式同步：

1. `lib/app/command-registry.js` 的 `TOOL_REGISTRY`（宿主工具清单与 CLI 由它单源生成）
2. `test/test-tool-contract.mjs` 的 `EXPECTED_TOOLS` / `EXPECTED_TOOL_COUNT`
3. README 的工具表

`test/test-tool-contract.mjs` 会拦住漏改（数量、命名合法性、必需项、两面一致性、`package.json` 声明的 patch/skills 路径是否真实存在）。

## 七、报问题

- 功能缺陷 / 行为不符：开 issue 并附**复现命令 + 实际输出 + 期望输出**
- 安全问题：见 `SECURITY.md`（请勿开公开 issue）
