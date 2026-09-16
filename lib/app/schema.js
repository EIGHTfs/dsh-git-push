/**
 * 插件入口层 · 配置 schema
 *
 * Schema 来自宿主提供的 schemastery；宿主没提供时用 makeFallbackSchema 兜一个最小实现，
 *   保证插件在缺依赖的环境下也能加载（Config 是暴露给宿主的配置 schema）。
 * 为什么单独成模块：兜底逻辑涉及 require 宿主模块，与工具定义/HTTP 处理混在一起
 *   会让「插件为什么加载不起来」变得很难查。
 */

import { createRequire } from 'node:module';

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
    // 【修复 2026-09-11】fallback schema 必须带 ~standard 标记，否则 DSH cordis 的
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
  auditEnabled: Schema.boolean().default(false).description('提交前审计（默认关）'),
  // 提交前审计的子开关：开启后在系统提示词注入「开发者特殊要求」清单全文，AI 常驻可见、
  // 不必等门禁拦截才去读清单（省一次失败的工具往返）。auditEnabled 关闭时本项不生效。
  maxScanFiles: Schema.number().default(3000).description('全量审计文件数上限（0=不限）；超限按变动文件优先截断，防止弱机扫大仓卡死'),
  injectRequirements: Schema.boolean().default(false).description('注入开发者要求清单到系统提示词（可直接勾选；父开关「提交前审计」关闭时置灰且不注入，勾选保留；默认关）'),
  auditScanScope: Schema.string().default('diff').description('diff | full'),
  auditLevel: Schema.string().default('standard').description('审计强度：quick | standard | deep（默认 standard）'),
  auditRuleset: Schema.string().default('').description('自定规则目录（空=内置规则包；放 audit-rules-<名>.yml 即整体替换）'),
  auditRuleOrder: Schema.array(Schema.string()).default([]).description('规则槽位加载顺序（后加载覆盖先加载；空=默认偏好顺序；private 恒末尾强制）'),
  auditDisabledSlots: Schema.array(Schema.string()).default([]).description('UI 禁用的规则槽位（设置页单击切换；nodejs/private 安全红线不可禁用）'),
  weightOverrides: Schema.string().default('').description('权重覆盖 JSON（如 {"安全性":100}，空=默认权重表）'),
  linkCheckEnabled: Schema.boolean().default(false).description('链接检查（默认关，需网络）'),
  pushMethod: Schema.string().default('ssh').description('推送通道：ssh（默认，推本地 HEAD、远端 sha 与本地一致）| api（Git Data API 重建提交）| auto（有私钥走 ssh，否则 api）'),
  // —— v1 全量移植字段（2026-09-12：客户端完全移植 v1，Config 补全 v1 卡片读写键）——
  // role('secret')：DSH 的远端读（settings-controller 一律 redactSecrets:true）不会把该字段值
  //   下发给浏览器；host 侧 scope.get/watch 仍是明文，token 功能不受影响。
  githubToken: Schema.string().role('secret').description('GitHub token（ghp_/github_pat_ 开头；存插件配置目录 0600；明文不下发浏览器）'),
  sshPub: Schema.string().description('SSH 公钥整行（存同级仓 *.pub）'),
  commentWordingEnabled: Schema.boolean().default(true).description('提交信息措辞检查'),
  commentWordingCustom: Schema.string().default('').description('自定义措辞规则'),
  commentWordingRulesFile: Schema.string().default('').description('措辞规则文件路径'),
  commentWordingRulesUrl: Schema.string().default('').description('措辞规则 URL'),
  auditRuleWeights: Schema.dict(Schema.any()).default({}).description('规则权重（{ blacklist: { pattern: weight } }）'),
  qualityWeights: Schema.dict(Schema.number()).default({}).description('质量维度权重覆盖（{ 维度名: weight }）'),
  // 2026-09-13：注入总开关（侧边栏可勾）。开启后注入三段：环境（工作区/工具目录）、
  //   skill 总入口（仅目录路径）、插件功能用法（每个工具怎么用）。
  //   原「注入全部 skill 正文 / 注入 repo-index 全文」两开关已废弃移除（不做全量注入）。
  injectSystemPrompt: Schema.boolean().default(true).description('注入系统提示词（工作区/工具目录 + skill 总入口 + 插件功能用法；默认开）'),
  customIgnorePatterns: Schema.string().default('').description('自定义 gitignore 模式（逗号/换行分隔）'),
  hardcodeFullScan: Schema.boolean().default(false).description('硬编码审计全量扫（默认只扫新增/变更行）'),
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
export const SECRET_CONFIG_FIELDS = ['githubToken'];

export function redactConfig(cfg = {}) {
  const out = { ...cfg };
  for (const k of SECRET_CONFIG_FIELDS) delete out[k];
  // 派生布尔位：浏览器拿不到明文，但需要知道「填没填」
  out.tokenConfigured = !!(cfg.githubToken && String(cfg.githubToken).trim());
  out.sshConfigured = !!(cfg.sshPub && String(cfg.sshPub).trim());
  return out;
}
