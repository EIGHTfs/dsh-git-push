# DEVELOPMENT-2026-08-19-exemption-types

> 主题：审计豁免类型（说明类示例凭据 / 备份类私有库）v1.5.0
> 日期：2026-08-19

## 背景

审计的敏感信息检测会误伤两类合法场景：
1. **说明类**：文档/README/示例代码用假用户名密码举例说明格式，被「密钥键值对」模式误报为硬编码凭据。
2. **备份类**：备份到私有仓库时，敏感信息（token 归档、会话总结、凭据文件）正是私有库的存放目的，
   被「凭据入库 / secret / 对话措辞」规则拦截。

## 改动

1. `lib/audit.js`：
   - 说明类豁免：`FAKE_VALUE`（假值特征：fake/假/示例/演示/sample/demo/占位符 等）豁免「密钥键值对」；
     `EXAMPLE_CONTEXT_RE`（行内含 例如/举例/示例/演示/比如/假 等示例词）整行豁免所有 secret 模式。
   - 备份类豁免：`exemptRepos` 白名单（`isExemptRepo` 按路径/目录名匹配），命中的仓库跳过
     secret / 凭据文件 / 对话措辞 三条敏感内容规则，语法/JSON/YAML/大文件检查照常；结果标注 `exempted:true`。
2. `lib/index.js`：读取 `config.exemptRepos` 并传入审计。
3. `test-audit.mjs`：新增 9 个用例（示例词整行豁免 / 假值豁免 / 真实凭据仍拦 / 豁免仓库放行 / 非豁免仍拦 / 豁免仓库语法仍查），
   全部通过（36/36）。
4. `package.json` / `README.md` / `skills/dsh-git-push.md`：版本 1.4.1 → 1.5.0，功能条目、配置表（exemptRepos）、版本记录同步。
5. `skills/release-docs-rule.md`（用户级权威 + 副本）：新增「豁免类型」约束小节。

## 验证

- `node test-audit.mjs`：36 通过 / 0 失败
- `node test-core.mjs`：13 通过；`node test-repo-index.mjs`：20 通过
- 三个仓库自审通过（dsh-git-push / dsh-git-rescue / ai-work-archive 无新增命中）

## 关联

- skill 副本同步：主环境/测试环境插件副本 + ai-work-archive + dsh-git-rescue docs 副本。
- 运行中会话的 skill 目录不热更新：新会话生效，主环境重启后全量刷新。

## 遗留

- 主环境/测试环境需部署 v1.5.0（测试环境验证 → 主环境接管式重启）。
- `exemptRepos` 主环境配置默认未填（需按需加私有库，如 ai-work-archive）。
