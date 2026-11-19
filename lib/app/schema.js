/**
 * 插件入口层 · 配置 schema
 *
 * Schema 来自宿主提供的 schemastery；宿主没提供时用 makeFallbackSchema 兜一个最小实现，
 *   保证插件在缺依赖的环境下也能加载（Config 是暴露给宿主的配置 schema）。
 * 为什么单独成模块：兜底逻辑涉及 require 宿主模块，与工具定义/HTTP 处理混在一起
 *   会让「插件为什么加载不起来」变得很难查。
 */

import { createRequire } from 'node:module';

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
    // 【属性形状必须与真实 schemastery 对齐，否则密钥脱敏整条失效】
    //   宿主的 redactSecrets（@deepseek-ai/dsh-settings 的 redact.ts）**不看 meta**，它按
    //   node.type 决定要不要下钻、按 node.meta.role === 'secret' 判断密钥位：
    //   顶层先看 type（object/dict/array/union 才继续走），再逐层递归。
    //   fallback 原先只挂了 meta，没有 type ⇒ walk() 在顶层就落进 default 分支原样返回，
    //   **任何** position 的 role('secret') 都不会被删。
    //   触发条件：插件装在没有 `@deepseek-ai/schemastery` 解析路径的目录（如 local-plugins），
    //   于是 createRequire 拿不到依赖、走 fallback；而宿主进程自己有真 schemastery，
    //   脱敏仍然会跑 —— 组合起来就是「解密方用真实现、声明方用残缺实现」，
    //   结果是 githubToken / npmToken 明文随设置快照下发到浏览器。
    //   别为了「省一个属性」删掉它：没有 type 的 fallback 等于把脱敏交还给了运气。
    fn.type = meta.type;
    // 【链式重建必须搬运结构属性】.default() / .description() 都返回**新节点**（只透传 meta），
    //   而 inner / list / dict 挂在节点自身上、不在 meta 里。
    //   实测坑：`Schema.array(Schema.string()).default([])` 一链就把元素 schema 丢了
    //   ——Config.dict.extraRepos 有 type='array' 却没有 inner，宿主 walk 遍历不到数组元素，
    //   元素里的 secret 字段不会被脱敏。真实 schemastery 的链式方法保留这些属性，fallback 必须对齐。
    const rebuild = (patch) => {
      const next = field({ ...meta, ...patch });
      if (fn.inner !== undefined) next.inner = fn.inner;
      if (fn.list !== undefined) next.list = fn.list;
      if (fn.dict !== undefined) next.dict = fn.dict;
      return next;
    };
    fn.default = (d) => rebuild({ default: d });
    fn.description = (d) => rebuild({ description: d });
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
    // 与 field 的 fn.type 同一个理由：redactSecrets 必须看到 type === 'object' 才会去读 dict、
    //   逐个属性递归；dict 里没挂子 schema，它根本不知道「哪些字段存在、谁是密钥位」。
    //   这两行缺任何一行，嵌套字段（如 preCommit.xxx 里将来放敏感项）都不会被脱敏。
    fn.type = 'object';
    fn.dict = shape;
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
    // 容器类型必须把「元素 schema」挂到 inner(array/dict) / list(union) 上：
    //   redactSecrets 的 walk 分别从 node.inner 与 node.list 继续下钻。
    //   fallback 原先**丢弃了传进来的参数**，等于告诉宿主「这个数组/字典里没有 schema」，
    //   于是数组元素或字典值里的 secret 字段不会被删（同类残缺，与 fn.type 一起补）。
    array: (inner) => {
      const fn = field({ type: 'array', default: [] });
      if (inner) fn.inner = inner;
      return fn;
    },
    number: () => field({ type: 'number', default: 0 }),
    dict: (inner) => {
      const fn = field({ type: 'dict', default: {} });
      if (inner) fn.inner = inner;
      return fn;
    },
    any: () => field({ default: undefined }),
    union: (...branches) => {
      const fn = field({ type: 'union', default: undefined });
      // union 的每个分支都走一遍 walk（宿主那边是 reduce），故分支要原样保留在 list 上
      fn.list = branches;
      return fn;
    },
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
  maxCloneFileMB: Schema.number().default(10).description('clone 单文件体积上限(MB)，0=不限'),
  cloneConcurrency: Schema.number().default(6).description('clone 并发下载数'),
  // —— 提交前预处理（可替换的预处理实现，解耦方案 §2.1）——
  // 这里**只剩「跑不跑 + 用哪个引擎」**：预处理开不开是宿主自己的门禁策略，
  //   而「怎么审」（扫描范围 / 权重 / 规则槽位 / 文件上限）属于预处理实现自己的配置，
  //   不在本插件配置里（拆包后审计配置住在 audit-sluice 自己的 config.json）。
  // 三项 command/args/timeoutMs 刻意都是「空 = 内置」而不是「空 = 关闭」：
  //   门禁不能因为漏配字段就悄悄不跑。enable 才决定跑不跑。
  // 解析顺序见 pre-commit-engine.js 的 resolvePreCommitConfig / resolvePreCommitEnabled。
  preCommit: Schema.object({
    enabled: Schema.boolean().default(true).description('提交前预处理（默认开）：提交前调用预处理实现做门禁；关闭时提交照常，不做任何静态检查。未安装任何 provider 时自动跳过并在回执里标注（preprocessSkipped），不阻塞提交'),
    // ── 有序阶段链（新）：数组顺序 = 执行顺序 ──
    //   空数组 = 不启用阶段链 ⇒ 走下面的旧单命令字段（行为与升级前逐字段一致）。
    //   每阶段：provider = provider 注册表里的 id；onFail 留空 ⇒ 用 provider 自己声明的
    //   defaultOnFail ⇒ 再缺省 'block'（宿主不按 provider 名字猜语义）。
    stages: Schema.array(Schema.object({
      provider: Schema.string().default('').description('provider id（providers.js 注册表里的 id，如 audit）'),
      onFail: Schema.string().default('').description("该阶段失败怎么办：block（中断并拒绝提交）| warn（记警告继续）| skip（静默跳过）；空=用 provider 声明的 defaultOnFail，再缺省 block"),
      timeoutMs: Schema.number().default(0).description('该阶段超时毫秒（0=用 provider/全局默认）'),
    })).default([]).description('有序阶段链：按数组顺序执行；空=用单命令模式（command/args）'),
    command: Schema.string().default('').description('预处理引擎命令（单命令模式；空=内置 node；走 PATH 自探测，找不到会显式报错而不是静默降级）'),
    args: Schema.array(Schema.string()).default([]).description('引擎参数（空=预处理实现 CLI）；相对路径按插件根解析'),
    timeoutMs: Schema.number().default(PRE_COMMIT_TIMEOUT_MS_DEFAULT).description('引擎超时毫秒（超时按执行失败处理，fail-closed）'),
  }).description('提交前预处理（开/关 + 阶段链或单命令；空 engine = 内置预处理实现）'),
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
  // Device Flow 授权的**元数据块**——这里刻意不设 token 字段：
  //   device-flow 拿到的 access_token 照旧写顶层 githubToken 键。原因是**全插件 token 读取
  //   只有一个入口 resolveToken()，20+ 处消费点（push / transport / clone / visibility / cred-env…）
  //   全都只认那个键**；token 存到 githubAuth 里，它们一处都读不到，症状是「授权成功但推送
  //   仍用旧凭据」这种不留日志的静默故障（评审第二节的硬结论）。
  //   元数据只回答「这个 token 是哪来的、谁的、什么时候授权、用哪个 clientId 换的」。
  githubAuth: Schema.object({
    mode: Schema.string().default('none').description('凭据来源：none（无凭据）| pat（手工填的 token）| device-flow（GitHub 设备码授权得来）'),
    clientId: Schema.string().default('').description('OAuth App 的公开客户端 ID（Device Flow 不需要 client_secret；留空则授权端点直接报缺配置）'),
    scope: Schema.string().default('').description('授权申请的权限范围（留空=默认 repo,workflow；授权成功后落回真实拿到范围）'),
    login: Schema.string().default('').description('授权得到的 GitHub 登录名（仅展示，不参与鉴权）'),
    authorizedAt: Schema.string().default('').description('授权时间（ISO 字符串，仅展示）'),
  }).description('Device Flow 授权元数据（token 不在这里，仍存顶层 githubToken 键）'),
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

/** githubAuth 里键名疑似凭据的字段（防御性清洗用，见 redactConfig）。 */
const GITHUB_AUTH_SECRET_KEY_RE = /(token|secret|password|credential)/i;

export function redactConfig(cfg = {}) {
  const out = { ...cfg };
  for (const k of SECRET_CONFIG_FIELDS) delete out[k];
  // githubAuth 只放元数据（来源/登录名/授权时间/clientId），本身不含凭据；但这里仍按键名
  //   做一层防御性清洗——本函数**只删顶层键、不递归**，正是这类事故的成因（评审 B4′）：
  //   一旦有人往 githubAuth 里塞 token，就会随响应明文下发，且宿主侧的脱敏只管它自己
  //   那条 settings 通道、管不到本插件的 HTTP 出口。清洗是浅拷贝，不改 host 侧原配置。
  if (out.githubAuth && typeof out.githubAuth === 'object') {
    const cleanedAuthMeta = {};
    for (const [field, value] of Object.entries(out.githubAuth)) {
      if (!GITHUB_AUTH_SECRET_KEY_RE.test(field)) cleanedAuthMeta[field] = value;
    }
    out.githubAuth = cleanedAuthMeta;
  }
  // 派生布尔位：浏览器拿不到明文，但需要知道「填没填」
  out.tokenConfigured = !!(cfg.githubToken && String(cfg.githubToken).trim());
  out.sshConfigured = !!(cfg.sshPub && String(cfg.sshPub).trim());
  out.npmConfigured = !!(cfg.npmToken && String(cfg.npmToken).trim());
  return out;
}
