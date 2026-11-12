/**
 * 插件入口层 · 配置 schema
 *
 * Schema 来自宿主提供的 schemastery；宿主没提供时用 makeFallbackSchema 兜一个最小实现，
 *   保证插件在缺依赖的环境下也能加载（Config 是暴露给宿主的配置 schema）。
 * 为什么单独成模块：兜底逻辑涉及 require 宿主模块，与工具定义/HTTP 处理混在一起
 *   会让「插件为什么加载不起来」变得很难查。
 */

import { createRequire } from 'node:module';

// 审计侧设置键单独成文件（文件隔离阶段；展开合并后仍是同一个 Config 对象）
import { auditConfigShape } from './schema-audit.js';
// 引擎默认超时取单一来源（与运行期兜底共用），避免 schema 默认值漂移
import { PRE_COMMIT_TIMEOUT_MS_DEFAULT } from './constants.js';

/**
 * schemastery 条件加载（peerDependency 由 DSH 宿主提供）：
 *   - DSH 插件运行期：宿主 node_modules 提供 → 用真实 Schema（Standard Schema v1）
 *   - 源码仓本地测试 / CLI（零依赖）：缺失 → 降级为最小 schema（见 makeFallbackSchema）
 * 零依赖仓库设计：不把 peer 依赖装进 v2，缺失时插件入口仍可 import 不崩。
 */
const require2 = createRequire(import.meta.url);

let Schema = null;

try {
  Schema = require2('@deepseek-ai/schemastery');
} catch { Schema = null; }
if (Schema && typeof Schema.object !== 'function') Schema = null; // 防加载到残缺包

/** schemastery 缺失时的最小 schema（仅保留测试用到的语义：可调用返回默认值 + toJSON 形状）。 */
function makeFallbackSchema() {
  const field = (meta = {}) => {
    const fn = (v) => (v === undefined ? meta.default : v);
    fn.meta = meta; // 让 toJSON 能读到 description（schemastery 的 refs 走 meta.description）
    fn.default = (d) => field({ ...meta, default: d });
    fn.description = (d) => field({ ...meta, description: d });
    // role(r)：与 schemastery 同名 API。fallback 路径必须也能链式调用——
    //   否则缺 schemastery 的环境里 Config 定义到 .role('secret') 就抛错，整个插件起不来。
    fn.role = (r) => { meta.role = r; return fn; };
    return fn;
  };
  const objectSchema = (shape = {}) => {
    const fn = (v = {}) => {
      const out = {};
      for (const [k, spec] of Object.entries(shape)) {
        const s = typeof spec === 'function' ? spec : field();
        out[k] = s(v[k]);
      }
      return out;
    };
    fn.toJSON = () => ({
      type: 'object',
      refs: Object.entries(shape).map(([k, s]) => ({ key: k, meta: s?.meta || {} })),
    });
    // 嵌套对象也要能链 .description()：真实 schemastery 的 object 支持链式描述，
    //   兜底实现缺这一条时，任何「嵌套对象 + 描述」的 schema 定义（如 preCommit）都会在
    //   缺依赖环境里抛 TypeError: fn.description is not a function —— 整个插件直接起不来。
    fn.description = (d) => { fn.meta = { ...(fn.meta || {}), description: d }; return fn; };
 // 【修复 】fallback schema 必须带 ~standard 标记，否则 DSH cordis 的
    // resolveConfig 读 Config['~standard'].validate 时 undefined 崩溃
    // （"Cannot read properties of undefined (reading 'validate')"）。
    // 真实 schemastery 加载时自带该标记；fallback 路径补上等价实现，双路都稳。
    fn['~standard'] = { version: 1, vendor: 'dsh-git-push', validate: fn };
    return fn;
  };
  return {
    object: objectSchema,
    string: () => field({ type: 'string', default: '' }),
    boolean: () => field({ type: 'boolean', default: false }),
    array: () => field({ type: 'array', default: [] }),
    number: () => field({ type: 'number', default: 0 }),
    dict: () => field({ type: 'dict', default: {} }),
    any: () => field({ default: undefined }),
    union: (...fns) => field({ default: undefined }),
  };
}

// 兼容旧引用：Schema 缺失时用 fallback（Config 定义处不感知）
if (!Schema) Schema = makeFallbackSchema();

/** 插件配置 schema（Standard Schema v1，DSH cordis 校验必需；schemastery 提供 ~standard 标记）。 */
export const Config = Schema.object({
  // —— v2 特有字段 ——
  enabled: Schema.boolean().default(true).description('启用插件'),
  workspaceRoot: Schema.string().default('').description('扫描根目录（空=DSH workspaceRoot）'),
  extraRepos: Schema.array(Schema.string()).default([]).description('额外仓库路径（数组）'),
  extraReposFile: Schema.string().default('').description('额外仓库清单文件（每行一个绝对路径，# 注释；运行时实时读取）'),
  // —— 审计侧设置键（集中在 lib/app/schema-audit.js，此处展开合并）——
  ...auditConfigShape(Schema),
  maxCloneFileMB: Schema.number().default(10).description('clone 单文件体积上限(MB)，0=不限'),
  cloneConcurrency: Schema.number().default(6).description('clone 并发下载数'),
  // —— 提交前预处理引擎（可替换审计引擎，解耦方案 §2.1）——
  // 三项刻意都是「空 = 内置」而不是「空 = 关闭」：门禁不能因为漏配字段就悄悄不审计。
  // 注意本项是**高级文件配置**，不进 UI 设置项；解析顺序见 pre-commit-engine.js 的 resolvePreCommitConfig。
  preCommit: Schema.object({
    command: Schema.string().default('').description('审计引擎命令（空=内置 node；走 PATH 自探测，找不到会显式报错而不是静默降级）'),
    args: Schema.array(Schema.string()).default([]).description('引擎参数（空=内置 scripts/audit-gate.mjs）；相对路径按插件根解析'),
    timeoutMs: Schema.number().default(PRE_COMMIT_TIMEOUT_MS_DEFAULT).description('引擎超时毫秒（超时按执行失败处理，fail-closed）'),
  }).description('提交前预处理引擎（空=内置；换引擎只改这里）'),
  pushMethod: Schema.string().default('ssh').description('推送通道：ssh（默认，推本地 HEAD、远端 sha 与本地一致）| api（Git Data API 重建提交）| auto（有私钥走 ssh，否则 api）'),
  // 推送门禁（类似会话指挥家写操作拦截）——开启后 AI 推送必须带 pushConfirmed:true
  //   （已显式放行 pushConfirmed:true），否则 git_commit_push 拦截推送步骤（commit 可做，push 被挡）。
  pushGate: Schema.boolean().default(false).description('推送门禁（默认关）：开启后 push 需显式放行（带 pushConfirmed:true 才推，否则拦截）'),
  // —— 任务完成自动推送（内置自 dsh-task-completion）——
  // 检测 AI 回复「✅任务完成」且本开关开启 → 自动 commit+push（复用 commitWithAudit 门禁，
  //   不裸提交）。默认关（保守）；开关/触发文本/范围经 config.json 持久化（settings-bridge）。
  autoPushEnabled: Schema.boolean().default(false).description('任务完成自动推送（默认关）：开启后 AI 回复「autoPushTriggerText」触发自动 commit+push'),
  autoPushTriggerText: Schema.string().default('✅任务完成').description('完成触发文本（正则，可自定义；默认「✅任务完成」；在 UI 门禁开关旁设置）'),
  autoPushScope: Schema.string().default('session').description('自动推送范围：session（默认，仅会话 cwd 仓库）| all（workspace 全部有变更仓库）'),
  autoPushMessage: Schema.string().default('chore(ai): 任务完成自动提交').description('自动提交 message'),
  // —— v1 全量移植字段（客户端完全移植 v1，Config 补全 v1 卡片读写键）——
  // role('secret')：DSH 的远端读（settings-controller 一律 redactSecrets:true）不会把该字段值
  //   下发给浏览器；host 侧 scope.get/watch 仍是明文，token 功能不受影响。
  githubToken: Schema.string().role('secret').description('GitHub token（ghp_/github_pat_ 开头；存插件配置目录 0600；明文不下发浏览器）'),
  sshPub: Schema.string().description('SSH 公钥整行（存同级仓 *.pub）'),
  npmToken: Schema.string().role('secret').description('npm token（存插件配置目录 0600；明文不下发浏览器；与 githubToken 同文件，写入走原子读改写）'),
  npmRegistry: Schema.string().default('https://registry.npmjs.org/').description('npm registry 地址（默认官方源；用私有源时改这里）'),
 // 注入总开关（侧边栏可勾）。拆分两通道：
  //   systemPrompt 注入三段（功能用法/skill 入口/要求清单）；环境信息（工作区目录 + 工具
  //   安装路径）改走上下文注入（agent/pre-step 首次注入）。工具探测清单 = lib/tool-probes.json
  //   模板（只 key）→ 实测 → 结果落盘运行目录 tools.json。
  //   原「注入全部 skill 正文 / 注入 repo-index 全文」两开关已废弃移除（不做全量注入）。
  injectSystemPrompt: Schema.boolean().default(true).description('注入总开关（默认开）：插件功能用法/提醒/要求清单走系统提示词，工作区目录/工具安装路径/skill 总入口走上下文首条注入'),
  customIgnorePatterns: Schema.string().default('').description('自定义 gitignore 模式（逗号/换行分隔）'),
  yamlCheckMode: Schema.string().default('js-yaml').description('YAML 检查模式：js-yaml（默认）| heuristic'),
});

/**
 * 远端（浏览器/HTTP）可见的配置 = 全字段去掉 schema 声明为密钥的位。
 *
 * 为什么需要：`/api/git-push/status` 原先直接 `config: cfg` 整包回吐，GitHub token 随响应
 *   明文出门（实测一条 curl 就能取到）；而浏览器并不需要明文——它只用「是否已配置」渲染标签。
 * 覆盖面：本函数只管插件自己的 HTTP 出口；浏览器读设置那条路径由 schema 的 role('secret')
 *   负责（DSH settings-controller 的远端读一律 redactSecrets:true）。
 * @param {object} cfg host 侧真实配置（含明文）
 * @returns {object} 可安全下发的配置副本（密钥位删除 + 派生布尔位）
 */
export const SECRET_CONFIG_FIELDS = ['githubToken', 'npmToken'];

export function redactConfig(cfg = {}) {
  const out = { ...cfg };
  for (const k of SECRET_CONFIG_FIELDS) delete out[k];
  // 派生布尔位：浏览器拿不到明文，但需要知道「填没填」
  out.tokenConfigured = !!(cfg.githubToken && String(cfg.githubToken).trim());
  out.sshConfigured = !!(cfg.sshPub && String(cfg.sshPub).trim());
  out.npmConfigured = !!(cfg.npmToken && String(cfg.npmToken).trim());
  return out;
}
