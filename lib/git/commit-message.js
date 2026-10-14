/**
 * Git 执行层 · 提交信息组装（message 参数支持「数组 / 结构化条目」）。
 *
 * 背景：`message` 原先只接受一个字符串，多项变更只能手写成一坨自由文本，
 *   于是「改了什么 / 为什么改 / 怎么验证的」只能靠人自觉，格式也难统一。
 *   现在改为：**传数组**，由插件统一组装成规范提交信息（标题 + 正文 + 脚注）。
 *
 * 支持的入参形态（向后兼容，字符串原样透传）：
 *   ① string                       —— 原样使用（不改一个字符，保证既有调用/CLI/auto-push 行为不变）
 *   ② Array<string | object>       —— 混用：字符串即「一条变更」，对象见下
 *   ③ { subject?: string, items: Array<string | object> }
 *                                  —— 显式指定标题；此时**所有** items 都落正文
 *
 * 条目对象的字段（仅 what 必填，其余可空）：
 *   · what   （必填）这一条改了什么，一句话
 *   · type   （可空）feat / fix / docs / chore …（不写则不加前缀，不臆造类型）
 *   · scope  （可空）影响范围，如 push / npm
 *   · why    （可空）为什么改（问题/背景）——汇总到「为什么改」段
 *   · verify （可空）怎么验证的（测试/门禁/实测）——汇总到「验证」段
 *   · refs   （可空）关联项，如 `Closes #45` —— 作为末尾脚注
 *
 * 组装规则（可预测，不猜）：
 *   · 标题：显式 subject 优先；否则取首条（`type(scope): what`，无 type 时就是 what）
 *   · 正文要点：未被用作标题的条目，逐条 `- what`（显式 subject 时全部进要点）
 *   · 「为什么改」「验证」段：收集所有条目的 why / verify（去重，保留顺序）
 *   · 脚注：收集所有条目的 refs
 *
 * 设计约束：纯函数、零 IO；不联网、不读配置；不做格式校验（校验是另一件事，本模块只管组装）。
 */

/** 允许的 type（用于组装标题前缀；未在表内的 type 不推断、原样透传）。 */
export const COMMIT_TYPES = ['feat', 'fix', 'docs', 'test', 'refactor', 'perf', 'chore', 'release', 'build', 'ci', 'style', 'revert'];

/** 取字符串字段（trim；非字符串返回空串）。 */
function str(v) {
  return typeof v === 'string' ? v.trim() : (v === undefined || v === null ? '' : String(v).trim());
}

/** 去重且保留首次出现顺序。 */
function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const k = String(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/**
 * 归一化单个条目。字符串 → { what }；对象 → 取 what/title/desc 中第一个非空的作为 what。
 * 无效条目（缺 what）返回 null，由调用方过滤——**不报错、不臆造内容**。
 */
function normalizeItem(el) {
  if (typeof el === 'string') {
    const what = el.trim();
    return what ? { what } : null;
  }
  if (el && typeof el === 'object' && !Array.isArray(el)) {
    // 容错接受 title / desc 作为 what 的别名（调用方习惯不同，但语义只有一个：改了什么）
    const what = str(el.what) || str(el.title) || str(el.desc);
    if (!what) return null;
    return {
      type: str(el.type),
      scope: str(el.scope),
      what,
      why: str(el.why),
      verify: str(el.verify),
      refs: str(el.refs),
    };
  }
  return null;
}

/** 生成标题：有 type 且合法时用 `type(scope): what`，否则只给 what（不臆造类型）。 */
export function titleOf(item) {
  const t = str(item && item.type);
  const scope = str(item && item.scope);
  const what = str(item && item.what);
  if (!t) return what;
  const known = COMMIT_TYPES.includes(t);
  const prefix = `${t}${scope ? `(${scope})` : ''}: `;
  // 未知 type 也保留（调用方可能用团队自定义前缀），只在标题里原样带上
  return `${prefix}${what}${known ? '' : ''}`;
}

/**
 * 组装提交信息。
 * @param {string|Array|{subject?:string,items?:Array}} input
 * @returns {{ok:boolean, message?:string, subject?:string, itemCount?:number, error?:string}}
 */
export function buildCommitMessage(input) {
  // ① 字符串：**原样透传**（保证既有调用方行为逐字节不变）
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return { ok: false, error: 'commit message 必填（字符串为空）' };
    return { ok: true, message: s, subject: s.split('\n')[0], itemCount: 1 };
  }
  // ② 数组 / ③ 带 subject 的对象
  let subject = '';
  let raw = [];
  if (Array.isArray(input)) {
    raw = input;
  } else if (input && typeof input === 'object') {
    subject = str(input.subject);
    if (Array.isArray(input.items)) raw = input.items;
    else if (input.items !== undefined && input.items !== null) raw = [input.items];
    else if (!subject && str(input.what)) raw = [input]; // 容错：直接传单个条目对象
  } else {
    return { ok: false, error: 'commit message 必填（应为字符串、数组，或 { subject, items }）' };
  }
  const norm = raw.map(normalizeItem).filter(Boolean);
  if (!subject && norm.length === 0) {
    return { ok: false, error: 'commit message 必填（数组内没有有效条目：每个对象至少要有 what）' };
  }
  // 标题与要点：显式 subject 时全部条目进要点；否则首条当标题
  let head = subject;
  let bodyItems = norm;
  if (!head) {
    head = titleOf(norm[0]);
    bodyItems = norm.slice(1);
  }
  const parts = [];
  const bullets = bodyItems.map((it) => `- ${it.what}`);
  if (bullets.length) parts.push(bullets.join('\n'));
  const whys = uniq(norm.map((i) => i.why).filter(Boolean));
  if (whys.length) parts.push(`为什么改：\n${whys.map((w) => `- ${w}`).join('\n')}`);
  const verifies = uniq(norm.map((i) => i.verify).filter(Boolean));
  if (verifies.length) parts.push(`验证：\n${verifies.map((v) => `- ${v}`).join('\n')}`);
  const refs = uniq(norm.map((i) => i.refs).filter(Boolean));
  if (refs.length) parts.push(refs.join('\n'));
  const message = [head, ...(parts.length ? ['', ...parts.flatMap((p, i) => (i ? ['', p] : [p]))] : [])].join('\n').trim();
  return { ok: true, message, subject: head, itemCount: norm.length };
}

/** 给工具/CLI 展示用的形态说明（一句）。 */
export function describeMessageForms() {
  return 'message 可传：① 字符串 ② 数组（元素为字符串或 {what,type?,scope?,why?,verify?,refs?}）③ {subject?, items:[...]}；仅 what 必填';
}
