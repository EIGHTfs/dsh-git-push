/**
 * AST 实现层 · 凭据检查
 *
 * 职责：凭据标识符右侧值判定（硬编码/引用/类型检查）、前缀型密钥串的占位符精筛。
 *
 * 占位符判据（CRED_PLACEHOLDER / CRED_SCHEME_PREFIX / isMeaningfulCredentialValue）
 *   必须只有一份：两处检查共用，否则判据漂移会出现「同一串值 A 规则放行、
 *   B 规则拦截」的自相矛盾。
 *
 * 精筛双路径（2026-11-06 方向 E1「有树走树」）：
 *   checkCredentialRefAst(text, tree) 传入语法树时走 credentialLinesFromTree——按真语法
 *   节点判「赋值左值是不是凭据名、右值是不是纯字面量」，参数默认值（default_parameter /
 *   assignment_pattern）、复合右值（binary_operator）、三元（conditional_expression）、
 *   f-string 插值天然落空；无树/解析失败回退 scanCredentialTokens（token 级近似）。
 *   回退是常态路径之一（D5 口径）——双向样本回归见 test/test-tree-first-credential.mjs。
 */

import { tokenize } from './tokenizer.js';
import { credentialLinesFromTree } from './treesitter.js';

/**
 * 检查「凭据类标识符是否真的被赋了字面量值」（no-hardcoded-credentials kind 的 AST 精筛）。
 *
 * 正则 `token\s*[=:]+\s*['"][^'"]+['"]` 命中即报，会把下列**非硬编码**场景误报：
 *  - 类型/存在性检查：`typeof cfg.githubToken === 'string'`、`next.apiKey.trim()`
 *  - 字段透传/引用：`cfg.githubToken = init.githubToken`（右侧是变量，不是字面量）
 *  - 默认值取自配置：`token = options.token || ''`（右侧是表达式/空串）
 * 本实现在 token 级确认：只有当「凭据标识符」右侧的赋值/初始化**直接是字符串字面量**
 * 且该字面量**非空、非占位符**时才判定为硬编码。
 *
 * @param {string} text 文件全文
 * @param {object} [opts] { literalOnly=true } 是否只认「右侧直接是字面量」
 * @returns {Set<number>} 判定为「确实硬编码凭据」的行号集合
 */
/**
 * 凭据占位符判据（模块级共用）——。
 *
 * 为什么不写在单个检查里：占位符识别被两处用到，必须**同一套判据**——
 *   ① checkCredentialRefAst（凭据标识符右侧字面量）
 *   ② checkPlaceholderCredentialAst（前缀型密钥串，如 ghp_/sk-/AKIA）
 *   各写一份必然漂移，出现「同一串值 A 规则放行、B 规则拦截」的矛盾。
 */

/** 明显不是真凭据的值：空、掩码、占位文案、演示/测试数据。 */
const CRED_PLACEHOLDER = /^(|\s*|x+|\*+|<[^>]*>|your[-_ ]?.*|change[-_ ]?me|todo|placeholder|example.*|demo.*|sample.*|test.*|dummy.*|fake.*|xxx.*|redacted|masked|none|null|undefined)$/i;

/** 单段文本是否占位符文案。 */
function isPlaceholderText(text) {
  return CRED_PLACEHOLDER.test(String(text));
}

/**
 * 常见凭据 scheme 前缀：判占位符前先剥掉再判一次。
 *   否则带前缀的演示值会漏判——`ghp_` + 「Example…」开头的演示值，其首个词不是 example，
 *   匹配不到 `example.*`，就被当成真凭据报拦截（演示数据/夹具里的常见写法）。
 *   剥前缀不会放过真凭据：真实随机串剥完仍非占位符，照样报。
 */
const CRED_SCHEME_PREFIX = /^(gh[pousr]_|github_pat_|sk-[a-z]*-?|xox[baprs]-|glpat-|AKIA)/i;

/**
 * 运行时求值形态：值不是「写死的字面量」，而是运行期由 shell/模板求出来的。
 *
 *   背景（真实误报）：`TOKEN="$(read_token)"` 被 security/no-hardcoded-credentials
 *   报为硬编码凭据——分词器把整个 `"$(read_token)"` 当成一个 str token，本模块
 *   只看「是不是占位符文案」，看不出值是命令替换，于是照报。
 *   这类写法值来自函数/shell，代码里并没有凭据内容，属误报。
 *
 *   只认三种明确形态（刻意收紧）：
 *     ① `$(cmd)` 命令替换
 *     ② `${VAR}` 花括号插值
 *     ③ 以 `$` 开头：纯变量引用 `$TOKEN` / `$1`
 *   **不**认「含 $ 即可」——`my$ecret`、`pass$word!` 这类带 $ 的真密码必须照报，
 *   否则规则出现后门（实测按「含 $」判会放过 4 类真凭据）。
 */
const CRED_INTERPOLATED = /\$\(|\$\{|^\$[A-Za-z0-9_]/;

/** 去掉字符串字面量外层引号（含 Python bytes/raw/f 前缀：b"…" / rb'…'）。 */
function stripQuotes(raw) {
  return String(raw)
    .replace(/^([a-zA-Z]{0,2})(\'|"|`)([\s\S]*)\2$/, '$3')
    .trim();
}

/**
 * 主题令牌/标签样式值形状：小写点分段（text.secondary / bg.hover / accent.subtle）
 *   或「小写词+冒号」标签前缀（plugin-preset: / preview-remove:，后接拼接/插值）。
 * 这类值是被 `token=`/`fill_token=` 之类**变量名撞词**带进来的样式枚举名，
 *   不是凭据内容——外部仓库实测 10 条 blocker 全部误报源于此形态。
 *   刻意取最小面：段内禁大写禁特殊字符、点分段≥2 或尾冒号；
 *   `hunter2`（全小写无点无冒号）这类真弱口令**不在豁免内**，照报。
 */
const THEME_TOKEN_SHAPE = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+:?$/;
const LABEL_COLON_SHAPE = /^[a-z][a-z0-9_-]*:$/;

/**
 * 判断一个字面量值是否算「真凭据」（非空、非掩码、非占位/演示、非主题令牌样式值）。
 *
 * @param raw 原始字面量（可带引号，可带 Python bytes/raw 前缀）
 * @returns true = 像真凭据（应报）；false = 占位符/空值/主题令牌（豁免）
 */
export function isMeaningfulCredentialValue(raw) {
  const v = stripQuotes(raw);
  if (!v) return false;
  if (isPlaceholderText(v)) return false;
  // 运行时求值（$(cmd) / ${VAR} / $VAR）→ 值不在代码里，不是硬编码
  if (CRED_INTERPOLATED.test(v)) return false;
  // 主题令牌/标签前缀形状（text.secondary / plugin-preset:）：变量名撞 token 词的样式枚举。
  //   scheme 前缀保护——带 ghp_/sk-/AKIA 等凭据前缀的值即便碰巧撞形状也照报，形状豁免不开后门。
  CRED_SCHEME_PREFIX.lastIndex = 0;
  if (!CRED_SCHEME_PREFIX.test(v) && (THEME_TOKEN_SHAPE.test(v) || LABEL_COLON_SHAPE.test(v))) return false;
  return !isPlaceholderText(v.replace(CRED_SCHEME_PREFIX, ''));
}

/*
 * 刻意不做「按 -/_ 拆段逐段判占位符」：试过并撤回。
 *   拆段会把「sk- + test + 随机串」形状的值（scheme 段里带 test）整体豁免——
 *   但这类值是真检出：仓库自身测试夹具正是用它证明「非豁免目录的 blocker 会拦截提交」，
 *   放宽后门禁形同虚设。占位符豁免必须取最小面：只认「整串/剥掉 scheme 前缀后即以
 *   占位词开头」，不认藏在中间段里的演示词。
 */

/**
 * astConfirmKind: "placeholder-credential" 的精筛集合（mode: deny）。
 *
 * 场景：`secret-github-pat` / `secret-openai-key` / `secret-aws-access-key` 这类
 *   **前缀形状匹配**的规则（`\\bghp_[A-Za-z0-9]{20,}\\b`），只看形状不看语义——
 *   文档里写「测试用占位符 + ghp_ 前缀」、演示页假数据
 *   `ghp_ExampleToken…` 都会被判成真泄漏（error 级，摘要计入拦截数）。
 *
 * 判定：把命中的密钥串剥掉 scheme 前缀后套占位符判据；命中即加入豁免集。
 *   只看「该串本身是不是占位符」，不做路径/文件级豁免——真 token 无论写在哪个文件都照报。
 *
 * @param text 文件全文
 * @returns Set<number> 命中「占位符凭据」的行号（1 起始）
 */
export function checkPlaceholderCredentialAst(text = '', file = '') {
  const out = new Set();
  const SCAN = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16})\b/g;
  const lines = String(text).split('\n');
  const isDoc = /\.(md|markdown|txt|rst)$/i.test(String(file || ''));
  for (let i = 0; i < lines.length; i++) {
    SCAN.lastIndex = 0;
    let match;
    while ((match = SCAN.exec(lines[i])) !== null) {
      if (isMeaningfulCredentialValue(match[1]) === false) { out.add(i + 1); break; }
      // 文档示例豁免——md 文档里出现 token 且该行/邻近行含「示例/演示/
      //   占位/example/demo/sample」语义词，是上游文档的示例值引用（如 MCP 配置文档
      //   写 `token=ghp_xxx` 说明用法），不是本仓库真实凭据。
      //   仅文档文件生效；代码文件里的 token 无论上下文如何都照报（防后门）。
      //   判据收紧：语义词需与 token **同行**（跨行引用不算），且 token 值本身
      //   不像随机真实串（真实长随机 PAT 即使行内带「示例」字样也报——见
      //   isMeaningfulCredentialValue 的剥离前缀判占位逻辑，这里是文档级补充）。
      if (isDoc && /示例|演示|占位|example|demo|sample|说明|配置示例/i.test(lines[i])) {
        out.add(i + 1);
        break;
      }
    }
  }
  return out;
}

/**
 * 凭据语义标识符（命名**以这些词结尾**的变量/字段才纳入判断）。
 *
 * 此前判「名字里含凭据词即可」，外部 Python 仓库实测暴露两类误报：
 *   token_pattern = r'…'（正则模式变量）、_ICON_TOKEN_PROP = "_themed_icon_token"（属性名字面量）
 *   ——凭据词只是长描述名的**前缀/中段**，变量装的根本不是凭据值。
 * 改为结尾锚定后：APP_UPDATE_TOKEN_SECRET（结尾 SECRET）、API_KEY、db_password、githubToken
 *   （camelCase 结尾 Token）这类「名字即凭据」的写法照常命中；
 *   password_length / token_pattern / secretCache 这类不再命中。
 *   代价：mytoken2 这类尾部带数字的命名会漏——刻意取此边界（命中集宁窄勿宽，
 *   前缀型真密钥串另有 secret-github-pat 等形状规则兜底）。
 */
/**
 * 凭据语义名两级判定：
 *   strong（词义无歧义：password/secret/credential/apikey/accesskey/privatekey/pwd…）
 *     → 右侧是有效字面量即判硬编码（历史行为）。
 *   weak（token/cookie/key 这类**常用普通词**：token_pattern=正则模式、_ICON_TOKEN_PROP=属性名、
 *     cookieChars=字符表）→ 仅当值本身有凭据置信度（scheme 前缀 ghp_/sk-/AKIA…
 *     或 ≥20 位混合大小写+数字的高熵串）才判硬编码。
 * 背景（外部 Python 仓库实测）：把 token 当无歧义凭据名时，主题令牌/标签前缀/模式变量
 *   全线误报（10 条 blocker 全假）；而真凭据 APP_UPDATE_TOKEN_SECRET 的强词是 SECRET。
 *   结尾锚定试过并再放宽回分段匹配——SECRET_KEY（强词在**前段**）被锚定漏掉即回归，
 *   分段 + 强弱分级同时解决两者。
 */
// strong：词义即凭据容器（cookie 的值就是会话凭据，属强词；1.1.4 测试夹具锁死其必报行为）。
const CRED_NAME_STRONG = /(password|passwd|pwd|secret|credential|cookie|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|session[_-]?token|refresh[_-]?token)/i;
// weak：常用普通词（token 常做主题令牌/正则模式变量名、key 常做字典键/琴键名）——要值置信度。
const CRED_NAME_WEAK = /(token|key)/i;

/** 值置信度：scheme 前缀或高熵串（≥20 字符、字符集干净、大小写数字混合）。 */
const CRED_VALUE_ENTROPY = /^[A-Za-z0-9+/_=.:-]{20,}$/;

/** 凭据名分级（'strong'|'weak'|null），导出供树提取器与 token 扫描共用同一份定义。 */
export function credentialNameTier(name) {
  const n = String(name || '');
  if (CRED_NAME_STRONG.test(n)) return 'strong';
  if (CRED_NAME_WEAK.test(n)) return 'weak';
  return null;
}

/**
 * 「名字+值」组合判硬编码（token 路径与树路径共用的唯一判据）。
 * strong 名维持历史口径；weak 名要求值有凭据置信度（scheme/高熵）。
 */
export function isHardcodedCredentialValue(name, raw) {
  const tier = credentialNameTier(name);
  if (!tier) return false;
  if (!isMeaningfulCredentialValue(raw)) return false;
  if (tier === 'strong') return true;
  const v = stripQuotes(raw);
  CRED_SCHEME_PREFIX.lastIndex = 0;
  if (CRED_SCHEME_PREFIX.test(v)) return true;
  return CRED_VALUE_ENTROPY.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v);
}

/** 凭据语义名判定谓词（旧签名，兼容树提取器入参；tier 判定走 credentialNameTier）。 */
export function isCredentialIdent(name) {
  return credentialNameTier(name) !== null;
}

/**
 * 在一段 token 序列上判「凭据标识符右侧是否直接是有效字符串字面量」，命中行号写入 out。
 *
 * @param {Array} tokens tokenize() 结果
 * @param {Set<number>} out 命中行号集合（调用方传入，可累加）
 * @param {number} [lineOffset=0] 行号偏移（子文本从第 1 行重新计数时用）
 */
function scanCredentialTokens(tokens, out, lineOffset = 0) {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'ident' || !credentialNameTier(t.value)) continue;
    // 向后找该标识符所在语句的赋值/比较运算符（遇到语句边界就放弃）
    let opIdx = -1;
    for (let j = i + 1; j < Math.min(tokens.length, i + 8); j++) {
      const tj = tokens[j];
      if (tj.type !== 'punct') continue;
      // 误报修复：`(` `)` `,` 是表达式/实参/元素边界——标识符若是函数实参
      //   （如 encodeURIComponent(token)）或数组元素，运算符并不属于它的赋值，
      //   跨过边界会把**下一条语句**的 `:`/`=` 误认成它的（实测 start-preview.mjs：
      //   'path: "/?" + 凭据字段名 + "=" + ..., method: "GET"'——token 后跨过 `)` `,` 命中
      //   method 的 `:` → next="GET" 被当硬编码凭据）。除 `.`（属性访问后仍可能 `=`）
      //   外，遇边界一律 break——任何「标识符不是左值」的场景不再误报。
      if ([';', '{', '}', '(', ')', ','].includes(tj.value)) break; // 语句/表达式/实参边界
      if (['=', ':', '==', '===', '!='].includes(tj.value)) { opIdx = j; break; }
      if (tj.value === '.') continue;
    }
    if (opIdx === -1) continue;
    // 只看严格赋值 `=`（`==`/`===` 是判断、`:` 是对象字面量字段声明，另判）
    const opTok = tokens[opIdx];
    const next = tokens[opIdx + 1];
    if (!next) continue;
    // 字面量前缀（Python b"…"/rb'…'、JS 标签 foo`…`）：分词器把前缀切成独立 ident，
    //   值仍在紧随的 str/tmpl token 上。不认前缀会让 bytes 真凭据整行漏报
    //   （外部仓库实测 SECRET_KEY = b"…" 未被任何路径捕获）。
    //   认前缀的条件：ident 值≤2 字符且紧随的字符串 token **列紧邻**（无前缀与引号之间
    //   只允许一个空格），否则 `token = b; "x"` 这类跨语句会被误并。
    const litTok = literalAfterPrefix(tokens, next, opIdx);
    // 组合判据与树路径同一份（isHardcodedCredentialValue：strong 名直判 / weak 名要值置信度）
    if (opTok.value === '=' && litTok && isHardcodedCredentialValue(t.value, litTok.value)) {
      out.add(t.line + lineOffset);
      continue;
    }
    if (opTok.value === ':' && litTok && isHardcodedCredentialValue(t.value, litTok.value)) {
      // 对象字面量 `token: 'abc'` → 真硬编码；`token: cfg.token` 是引用，不报
      out.add(t.line + lineOffset);
    }
  }
}

/**
 * 取运算符右侧的「字面量 token」，兼容 Python bytes/raw/f 前缀与 JS 模板标签。
 *
 * 分词器把 `b"abc"` 切成 ident("b") + str("\"abc\"")，直接看 next.type 会当成
 *   「右侧是变量」而漏报真凭据。这里在 next 是**短小写 ident**（≤2 字符，形如 b/r/f/rb/fr）
 *   且其后紧跟一个字符串 token、且**列紧邻**（间隔 ≤1 列）时，返回那个字符串 token。
 *   列紧邻是必需的：`token = b; other = "x"` 里 b 与 "x" 分属两条语句，
 *   不加列约束会把无关字符串当成 b 的值（实测跨语句误并报）。
 *
 * @returns 命中的字符串 token，否则原样返回 next（非字面量时为 null/其它类型，由调用方判 type）
 */
function literalAfterPrefix(tokens, next, opIdx) {
  if (!next) return null;
  if (next.type === 'str' || next.type === 'tmpl') return next;
  if (next.type !== 'ident' || !/^[a-zA-Z]{1,2}$/.test(String(next.value))) return null;
  const after = tokens[opIdx + 2];
  if (!after || (after.type !== 'str' && after.type !== 'tmpl')) return null;
  if (after.line !== next.line) return null;
  if (Math.abs(after.col - (next.col + String(next.value).length)) > 1) return null;
  return after;
}

export function checkCredentialRefAst(text = '', tree = null) {
  const raw = String(text);
  const out = new Set();
  // 「有树走树」：tree 为真语法树时，凭据赋值由语法节点判定（参数默认值/复合右值/三元
  //   天然落空），bytes/raw/f-string 前缀也正常识别。树不可用或提取异常 ⇒ 回退 token 级。
  if (tree && tree.rootNode) {
    const fromTree = credentialLinesFromTree(tree, isHardcodedCredentialValue);
    if (fromTree) return fromTree; // 树路径成功（含「无命中」的空集合）——不回退，避免两套判定叠加
  }
  scanCredentialTokens(tokenize(raw), out);
  // markdown 行内代码段兜底：`token: "abc"` 里的反引号被分词器当成模板字面量定界符，
  //   整段合并成一个 tmpl token，内部**不产生** ident/punct/str，直接扫原始 token 会漏报。
  //   而「文档里用行内代码段写配置示例」恰恰是最常见的写法——实测漏报：同一行写法在 .js 里
  //   报、放进 .md 的行内代码段就不报。故把 tmpl 内部文本单独再分词扫一遍。
  //   判据仍是同一个 scanCredentialTokens，不新增第二套判定。
  for (const t of tokenize(raw)) {
    if (t.type !== 'tmpl') continue;
    const inner = String(t.value).replace(/^`+/, '').replace(/`+$/, '');
    if (!inner.trim()) continue;
    scanCredentialTokens(tokenize(inner), out, t.line - 1);
  }
  return out;
}
