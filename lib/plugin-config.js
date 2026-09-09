/**
 * dsh-git-push — 插件配置卡片定义（v1.42.0 自 index.js 按功能拆分，行为零变化）
 *
 * Config：设置 → 插件 → 插件配置 卡片的 schema（z / @deepseek-ai/schemastery）。
 * GIT_PUSH_SETTINGS_NS：设置页命名空间，须与客户端 settings.plugin.item 一致。
 * textRender：dsh-tools 工具输出渲染契约（必填 output.render）。
 * __VERSION__：读插件 package.json 版本号（HTTP status / permit 展示用）。
 */
import z from '@deepseek-ai/schemastery';
import { readFileSync } from 'node:fs';

export const __VERSION__ = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const name = 'dsh-git-push';

/** 设置页命名空间：设置 → 插件 → 插件配置 卡片 key，须与客户端 settings.plugin.item 一致。 */
export const GIT_PUSH_SETTINGS_NS = 'git-push';

export const Config = z.object({
  githubToken: z.string().role('secret'),
  sshPub: z.string(),
  tokenConfigured: z.boolean().default(false),
  commentWordingEnabled: z.boolean().default(true),
  commentWordingCustom: z.string().default(''),
  commentWordingRulesFile: z.string().default(''),
  commentWordingRulesUrl: z.string().default(''),
  // v1.47.0 审计规则引擎 YAML 化：来源改为「四份 YAML 顺序」。'' = 默认顺序 nodejs,frontend,comment；
  // 可写逗号分隔槽位（如 'comment,nodejs'）；template 默认不加载（用户自定义入口，显式列出才加载）
  auditRuleset: z.string().default(''),
  // v1.47.0：侧边栏可排序的规则槽位顺序（等价 auditRuleset 的数组形态；后覆盖前）
  auditRuleOrder: z.array(z.string()).default([]),
  // v1.47.0：侧边栏「调权重」写回——{ blacklist: { pattern: weight } }（pattern 为 comment.yml 黑名单原文）
  auditRuleWeights: z.dict(z.any()).default({}),
  // v1.26.0 环境注入：agent/pre-step 注入「工作目录映射 + 工具安装路径」+ 同步 tools-index.md
  envInjectionEnabled: z.boolean().default(true),
  envInjectionTools: z.string().default(''), // 逗号分隔自定义工具名；空=用内置清单
  // v1.28.0 注入模式开关：injectFullSkill=true → pre-step 注入两仓 skill 全文（collectRepoSkillDocs，
  // 即 v1.23.x 时期行为）；false（默认）→ 只注入 skill 目录+文件清单，正文由 AI 按需读取。
  injectFullSkill: z.boolean().default(false),
  // v1.35.0：repo-index JSON 注入开关。false（默认）只注入文件名；true 注入 JSON 正文。
  injectRepoIndexFull: z.boolean().default(false),
  // v1.28.0 自定义忽略 pattern（逗号/换行分隔，如 *.bak*）：提交时自动追加到目标仓库 .gitignore
  customIgnorePatterns: z.string().default(''),
  // v1.47.0：侧边栏「调权重」写回——{ blacklist: { pattern: weight } }（pattern 为 comment.yml 黑名单原文）
  auditRuleWeights: z.dict(z.any()).default({}),
  // v1.52.0：动态槽位元数据（只读注入，host 启动时由 plugin-setup 填充）——
  // { slot: { name, description } }，client 规则卡显示名/清单从它读，不再硬编码 SLOT_NAMES
  ruleSlotMeta: z.dict(z.any()).default({}),
  // v1.36.1：硬编码审计扫描范围开关。false（默认）只扫新增/变更行；true 全量扫整个文件
  // （含既有历史行），用于换机前排查存量死路径。对应设置页「硬编码全量扫」。
  hardcodeFullScan: z.boolean().default(false),
  // v1.54.0：YAML 检查模式——'js-yaml'（默认，真实解析器，能捕获块标量/值/缩进/引号错误，性能 +0.05~0.5ms 可忽略）
  // ｜ 'heuristic'（宽松启发式行检查，原 yamlCheck，无块标量状态机会误报多行内容，保留作兜底）。
  // 侧边栏「规则引擎」卡下拉可切；改 apply 时经 settings watch 同步 env，运行期即时生效。
  yamlCheckMode: z.string().default('js-yaml'),
});

/**
 * 工具输出渲染：dsh-tools（rc.6 起）契约要求 defineTool 的 output.render 必填——
 * 缺省时包装函数调用 undefined 会抛 `userRender is not a function`（工具执行正常但结果无法回显）。
 * 必须返回内容块数组（block.content 落盘校验要求数组，纯字符串会损坏会话日志，见 dsh-session-manager 同款注释）。
 */
export function textRender(args, value) {
  return [{ type: 'text', text: String(value) }];
}
