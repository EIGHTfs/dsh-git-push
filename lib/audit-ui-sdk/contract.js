/**
 * contract.js —— 审计 UI 契约：什么算一个可插拔的审计面板、缺什么算构建失败。
 *
 * 为什么契约单独成文件、并且只有常量 + 校验函数（照 dsh-model-team 的 ui/theme-sdk 范式）：
 * 面板实现是「别人写的代码」，它只应该依赖这一层。契约一旦散落到 SDK 各处，
 * 作者就得靠读实现来猜哪些能用 —— 那等于没有契约。
 * 校验发生在**构建期**（将来接回 UI 时由构建脚本调 defineAuditPanel），运行期不再重复校验：
 * 坏实现应该在打包时被挡住，而不是等宿主里白屏才被发现。
 *
 * 校验项刻意只覆盖「构建期一定能判」的部分（形状与版本），**不猜作者意图**：
 * 猜意图的校验（例如「Panel 是否真的渲染了 summary」「styles 里有没有外链 CSS」）
 * 会在真实实现上误报，最后逼人把校验关掉 —— 那比没有校验更糟。
 *
 * 本文件零依赖（不 import 任何模块）：它既要能进构建脚本，也要能进浏览器产物，
 * 任何 Node 专有 API 都会让它两边都用不了。test/test-audit-ui-contract.mjs 钉住这条。
 *
 * 契约形状（与 docs/SPEC.md 第十一节同源）：
 * defineAuditPanel({ meta: { id, name, contractVersion }, Panel, styles?, setup? })
 * Panel(props) 收到的 props 分三组，键名见下方三个常量：
 * data    —— 执行侧/宿主给的面板只读数据（summary / quality / findings / ruleSlots）
 * actions —— 面板可以调的动作（reload / toggleRule / editWeight / toggleDisabled）
 * state   —— 宿主状态快照（loading / error / auditEnabled / auditScanScope）
 * 数据只读、状态只读、要改状态走 actions —— 面板不自己保存这些状态。
 */

/** 契约版本：SDK 的破坏性改动就 +1，构建期用它拒掉按旧契约写的实现。 */
export const AUDIT_UI_CONTRACT_VERSION = 1;

/** meta.id 的合法形状：小写字母开头 + [a-z0-9-]，2~32 字符。
 *  用做样式命名空间（写进 [data-audit-panel="id"]），所以必须是能当 CSS 属性值的形状。 */
export const AUDIT_PANEL_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/** 面板拿到的只读数据键（与引擎返回字段同名，不再做二次改名）；导出成常量而非只写注释，
 *  宿主与实现都从这里取键名，改名只改一处。 */
export const AUDIT_PANEL_DATA_KEYS = Object.freeze(['summary', 'quality', 'findings', 'ruleSlots']);

/** 面板可以调的动作（实现只读地拿到这些函数；要不要用是实现的自由）。 */
export const AUDIT_PANEL_ACTION_KEYS = Object.freeze(['reload', 'toggleRule', 'editWeight', 'toggleDisabled']);

/** 面板能看到的宿主状态（只读快照；面板自己不应保存这些状态）。 */
export const AUDIT_PANEL_STATE_KEYS = Object.freeze(['loading', 'error', 'auditEnabled', 'auditScanScope']);

/** meta 只认这三个字段：未登记的键不会带进产物（契约面就是这三个，不是"随便加"）。 */
const META_KEYS = Object.freeze(['id', 'name', 'contractVersion']);

/**
 * 校验 meta 三个字段。
 * 每一项单独报错并带上字段名与要求 —— 契约可用性的一半在错误信息：
 *   只说「meta 非法」会让人回去翻文档，说清「要求 /^[a-z][a-z0-9-]{1,31}$/」才修得动。
 * @param {object} meta 面板定义的 meta
 */
function assertMetaShape(meta) {
  if (!meta || typeof meta !== 'object') {
    throw new Error('[audit-ui] 缺少 meta（要求 { id, name, contractVersion }）');
  }
  if (typeof meta.id !== 'string' || !AUDIT_PANEL_ID_PATTERN.test(meta.id)) {
    throw new Error(`[audit-ui] meta.id 非法：${JSON.stringify(meta.id)}（要求 ${String(AUDIT_PANEL_ID_PATTERN)}；小写字母开头、只含 [a-z0-9-]、2~32 字符）`);
  }
  if (typeof meta.name !== 'string' || meta.name.trim() === '') {
    throw new Error(`[audit-ui] meta.name 必须是非空字符串（收到 ${JSON.stringify(meta.name)}）`);
  }
  if (meta.contractVersion !== AUDIT_UI_CONTRACT_VERSION) {
    throw new Error(`[audit-ui] meta.contractVersion 不匹配：面板写的是 ${JSON.stringify(meta.contractVersion)}，当前 SDK 是 ${AUDIT_UI_CONTRACT_VERSION}（按旧契约写的实现要跟着改）`);
  }
}

/**
 * 校验必填项：Panel 必须是函数。
 * 只判「是不是函数」——判不了「它渲染得对不对」，后者要跑起来才知道，属于运行期的事。
 * @param {object} definition 面板定义
 */
function assertRequiredParts(definition) {
  if (typeof definition.Panel !== 'function') {
    throw new Error(`[audit-ui] Panel 必须是函数组件（收到 ${typeof definition.Panel}）`);
  }
}

/**
 * 校验可选项：出现即必须是约定类型（缺省 = 不启用该能力）。
 * @param {object} definition 面板定义
 */
function assertOptionalParts(definition) {
  if (definition.styles !== undefined && typeof definition.styles !== 'string') {
    throw new Error(`[audit-ui] styles 若存在必须是字符串（收到 ${typeof definition.styles}；自带 CSS 文本，不要引外部 CSS 文件）`);
  }
  if (definition.setup !== undefined && typeof definition.setup !== 'function') {
    throw new Error(`[audit-ui] setup 若存在必须是函数（收到 ${typeof definition.setup}；返回值可作为卸载清理函数）`);
  }
}

/**
 * 声明并校验一个审计面板（构建期调用）。
 *
 * 返回值是**冻结的新对象**（只含契约内的字段）：
 *   · 运行期有人往面板对象上挂字段 → 严格模式下直接抛错，而不是静默生效后被别处读到；
 *   · 未登记的字段不会被带进产物 —— 「契约面有哪几个字段」是确定的，不随作者顺手加键而膨胀。
 *
 * @param {object} definition { meta, Panel, styles?, setup? }
 * @returns {{meta: object, Panel: Function, styles?: string, setup?: Function}} 冻结后的面板定义
 */
export function defineAuditPanel(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new Error('[audit-ui] defineAuditPanel 需要一个对象参数（形如 { meta, Panel, styles?, setup? }）');
  }
  assertMetaShape(definition.meta);
  assertRequiredParts(definition);
  assertOptionalParts(definition);
  // meta 只保留契约字段：多写的键不进产物，避免「产物里有、契约里没有」的暗面
  const meta = {};
  for (const key of META_KEYS) meta[key] = definition.meta[key];
  return Object.freeze({
    meta: Object.freeze(meta),
    Panel: definition.Panel,
    styles: definition.styles,
    setup: definition.setup,
  });
}
