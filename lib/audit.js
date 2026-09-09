/**
 * dsh-code-audit — L0 静态审计规则（纯函数，可独立单测）
 *
 * 零 token 确定性检查。规则分两级：
 *   blocker —— 必须修（语法错误/解析失败/敏感信息泄露/凭据入库/二进制大文件/npm 包文件入库）
 *   warning —— 提醒（debugger/console.log 过多/TODO）
 *
 * 拦截策略（blockOn）：
 *   'any'     —— 任何 findings 都拦截（严格模式，默认）
 *   'blocker' —— 仅 blocker 级拦截
 *
 * 硬编码（v1.31.0）：hardcode-path / hardcode-ip
 *   代码/配置字面量里的本机绝对路径、局域网 IP → blocker
 *   文档同样命中 → warning（不跟私有库豁免走）
 *
 * 规则插件化（v1.41.0，C 组）：规则数据全部来自规则包（v1.47.0 起为 YAML 规则文件，
 * 归属 EIGHTfs；initAuditRuleset 切换 builtin/file，url 异步装载后 applyRulePack 注入），
 * 本文件只保留引擎逻辑与结构型检查（语法/JSON/YAML/二进制/npm/debugger/TODO/console）。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load as yamlLoad } from 'js-yaml'; // v1.54.0：YAML 默认真实解析（yamlCheckMode='js-yaml'）
import { isBinaryOrLarge, getDiff, hasFileHeaderExempt, hasLineExempt, runGit } from './core.js';
import { getCompiledRulePack, resolveRulesetChoice } from './rule-packs.js';
import { checkFunctionLength, checkSilentCatch, checkSyncInAsync, hasTestFiles, scoreQuality, scoreFile, loadQualityYaml, locateQualityYaml, QUALITY_DEFAULTS } from './quality.js';
import { extractComments, scoreComment, FULLSCAN_DEFAULTS, compileFullScan } from './full-scan.js'; // v1.43.0：全仓扫描附属能力（提交时仅新增行注释评分）

/* ============================================================
 * 规则集引擎（v1.41.0 规则插件化，C 组 C3）
 * 规则数据全部来自规则包（缺省 lib/audit-rules/eightfs.rules.json，归属 EIGHTfs），
 * 本文件只保留引擎逻辑。initAuditRuleset(cfg) 同步切换 builtin/file 来源；
 * url 来源由调用方异步 loadRulePack 后 applyRulePack 注入热替换。
 * 装载失败回退空规则集并记 errors（结果 ruleset.loadErrors 可溯源）。
 * ============================================================ */
let _ruleset = null;

/** 获取当前生效规则集（未初始化时按默认顺序同步装载 YAML 规则集） */
export function getAuditRuleset() {
  if (!_ruleset) {
    _ruleset = getCompiledRulePack('');
  }
  return _ruleset;
}

/** 按配置同步装载并设置生效规则集（'' = 默认顺序 YAML；'nodejs,frontend,...' = 逗号分隔顺序；{order, weights} = 自定义顺序/权重覆盖） */
export function initAuditRuleset(cfg) {
  // v1.47.0：cfg 可为对象 { order, weights }（plugin-setup 传配置解析结果）或旧式字符串/空
  const src = (cfg && typeof cfg === 'object') ? cfg : resolveRulesetChoice(cfg);
  _ruleset = getCompiledRulePack({ order: src.order, weights: src.weights });
  return _ruleset;
}

/** 注入已编译规则集（兼容名保留：plugin-setup 在线注入路径改走 order 后不再需要；直接传编译结构可热替换） */
export function applyRulePack(pack, { source = 'yaml' } = {}) {
  _ruleset = pack && Array.isArray(pack.rules) ? getCompiledRulePack(pack.meta?.order || '') : pack;
  return _ruleset;
}

/** 重置规则集为未初始化（下次 getAuditRuleset 重新装载内置包；测试隔离用） */
export function resetAuditRuleset() {
  _ruleset = null;
}

/** C6（v1.41.0）：规则包来源/归属/规模摘要（审计结果溯源用） */
function rulesetInfo(rs) {
  return {
    name: rs.meta.name,
    owner: rs.meta.owner,
    version: rs.meta.version,
    source: rs.meta.source,
    counts: {
      secret: rs.secretPatterns.length,
      credentialFile: rs.credentialFileRes.length,
      credentialRef: rs.credentialRefPatterns.length,
      wording: rs.wordingPatterns.length,
      docConversation: rs.docConvPatterns.length,
    },
    loadErrors: Array.isArray(rs.errors) && rs.errors.length ? rs.errors : undefined,
  };
}

/** 措辞规则合并：规则包缺省 + overlay 注入（同名覆盖；overlay 支持 {name,pattern} 原始条目） */
function mergeWording(base, overlay) {
  if (!Array.isArray(overlay) || overlay.length === 0) return base;
  const compiled = overlay
    .map((p) => (p && p.name && p.pattern && !(p.re instanceof RegExp) ? { name: p.name, re: safeRe(p.pattern, p.name) } : p))
    .filter((p) => p && p.re && !p.re._invalid);
  const names = new Set(compiled.map((p) => p.name));
  return [...base.filter((p) => !names.has(p.name)), ...compiled];
}

/** 占位符值正则（引擎语义：像占位符的值不算真实凭据） */
const PLACEHOLDER_VALUE = /^(xxx+\.?\.?|your[-_ ]?[a-z]+|example|placeholder|changeme|dummy|test|demo|<[^>]+>|\$\{?[A-Z_]+}?)$/i;
/** 说明类豁免：假凭据值（用于举例/示例，非真实凭据）——值整体像"假值"就不报 */
const FAKE_VALUE = /^(fake|fakeuser|fakepass|fakepassword|faketoken|fakekey|fakepwd|假|假用户|假密码|假账号|假凭据|示例|示例值|样例|演示|演示值|sample|sampledata|demo|dummydata|testing|examplevalue|changeme|123456|abcdef|username|password|passwd|user|pass|token|key)\w*$/i;
/** 说明类豁免：行内含示例词 → 整行视为举例，任何 secret 模式都不报 */
const EXAMPLE_CONTEXT_RE = /(例如|举例|示例|样例|演示|比如|假|fake|sample|demo|example)/i;
/** 备份类豁免清单匹配：exemptRepos 配置项（私有/备份仓库，敏感内容规则跳过） */
function isExemptRepo(repoPath, exemptRepos) {
  if (!Array.isArray(exemptRepos) || exemptRepos.length === 0) return false;
  const rp = String(repoPath).replace(/\/+$/, '');
  const base = rp.split(/[/\\]/).pop() || '';
  return exemptRepos.some((e) => {
    const s = String(e).trim().replace(/\/+$/, '');
    if (!s) return false;
    return rp === s || rp.endsWith('/' + s) || base === s || base.endsWith(s);
  });
}
const DEBUGGER_RE = /(\bdebugger\s*;)|(\bdebugger\s*$)/m;
const CONSOLE_RE = /\bconsole\.(log|debug|info)\b/;
const TODO_RE = /\b(TODO|FIXME|HACK)\s*[:：]/;

/**
 * 文档凭据引用/明文警告（2026-09-06 用户确立，warning 级）：
 * 「插件审计功能以后拦截这些（警告），提示AI文档不要写引用，更不能直接写。
 *  让AI在gitpushuser目录存，找」
 * 触发：文档（md/txt/mdx/markdown）新增行里出现
 *   1) 旧凭据位置引用（.ssh/credentials.md / data/sensitive/ / sudo-key / credentials.md 等）——
 *      提示改为指向插件配置目录内 json；禁止在文档里写凭据引用路径。
 *   2) 凭据明文（密码/token/cookie 值写进文档）——由 secret 规则拦 blocker，
 *      此处对「文档内出现凭据值」再补 warning（含账号+密码同行的账号密码对）。
 * 豁免：行含示例词（例如/示例/fake/xxx 等）、行是代码块分隔符、已在 json 凭据文件内（不适用文档规则）。
 * 规则数据（v1.41.0）：规则包 credential-ref 桶（缺省 EIGHTfs 包 2 条）。
 */

/* ============================================================
 * 代码注释措辞（comment-wording）引擎注释
 * 规则数据全部来自规则包 comment-wording 桶（缺省 EIGHTfs 包 9 条）；
 * 检测 → blocker；commitWithAudit 提交前先 autofix 自动改写，正常流程不拦；
 * autofix 关闭或改写失败时才拦。设置自定义规则/规则文件/在线规则走 overlay
 * 同名覆盖（见 mergeWording）。json 注释行豁免仅对隐私入库类规则生效。
 * ============================================================ */

/** 代码/标记注释行起始标记（//、/*、*、<!--、#）——只查注释，不查代码字符串 */
function isCommentLine(line) {
  const t = String(line).replace(/^\s+/, '');
  return /^(\/\/|\/\*|\*|<!--|#)/.test(t);
}
/** 行内注释起始下标与类型（行注释/块注释/HTML 注释/井号注释），无注释则 null */
function commentStartOf(line) {
  const marks = [
    { type: '//', at: line.indexOf('//') },
    { type: '/*', at: line.indexOf('/*') },
    { type: '<!--', at: line.indexOf('<!--') },
    { type: '#', at: line.indexOf('#') },
  ].filter((m) => m.at >= 0);
  if (marks.length === 0) return null;
  marks.sort((a, b) => a.at - b.at);
  return marks[0];
}


/** 占位符/引用是否豁免（值看起来像占位符或环境变量引用 → 不报） */
function isPlaceholderOrRef(value) {
  if (PLACEHOLDER_VALUE.test(value.trim())) return true;
  // process.env.X / $VAR / env.X 引用
  if (/^(process\.env|env|os\.environ)\./i.test(value.trim())) return true;
  if (/^\$[A-Z_][A-Z0-9_]*$/.test(value.trim())) return true;
  return false;
}

/** 语法检查（node --check），返回错误信息或 null */
function syntaxCheck(filePath) {
  const r = spawnSync('node', ['--check', filePath], { encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'ignore'] });
  if (r.status === 0) return null;
  const first = (r.stderr || r.stdout || '').split('\n').find((l) => l.trim()) || '语法错误';
  return first.slice(0, 300);
}

/**
 * YAML 检查（v1.54.0 双模式）：yamlCheckMode 配置控制——
 *   'js-yaml'（默认）：真实解析器（js-yaml load），能捕获块标量/值/缩进/引号错误，性能 +0.05~0.5ms 可忽略；
 *   'heuristic'：宽松启发式行检查（原 yamlCheck，仅抓行级键值对错误，无块标量状态机会误报多行内容）。
 * 侧边栏「规则引擎」下拉可切（默认 js-yaml；启发式保留作兜底/兼容旧行为）。
 */

/** 宽松 YAML 检查（缩进级联 + 冒号结构），返回错误或 null——启发式模式（v1.54.0 保留） */
function yamlCheck(text) {
  const lines = text.split('\n');
  let error = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---')) continue;
    // 块标量/注释行跳过
    if (/^[-|>]?\s*$/.test(trimmed)) continue;
    // 行内注释：切掉 # 前内容再判断
    const content = trimmed.split(/\s+#/)[0];
    if (content === '') continue;
    // 非映射行（列表项）跳过深度校验
    if (content.startsWith('- ')) continue;
    // 键值对必须含 ":"，且冒号后要么有值要么是嵌套
    if (!content.includes(':')) {
      error = `第 ${i + 1} 行不是合法的 YAML 键值对: ${trimmed.slice(0, 60)}`;
      break;
    }
    const idx = content.indexOf(':');
    const key = content.slice(0, idx).trim();
    if (!key || /\s/.test(key) && !/^["'].*["']$/.test(key)) {
      error = `第 ${i + 1} 行键名非法: ${trimmed.slice(0, 60)}`;
      break;
    }
  }
  return error;
}

/** 真实 YAML 解析（js-yaml，默认模式），返回错误或 null——捕获语法/结构错误，性能实测 +0.05~0.5ms 可忽略 */
function yamlCheckJs(text) {
  try {
    yamlLoad(String(text || ''));
    return null;
  } catch (e) {
    // js-yaml 错误含 mark（行/列），提取人读信息；mark 内容可能带控制字符，截断
    const msg = String(e?.message || e || 'YAML 解析失败').slice(0, 150);
    const mark = e?.mark ? `（行 ${e.mark.line + 1} 列 ${e.mark.column + 1}）` : '';
    return `${msg}${mark}`;
  }
}

/** YAML 检查入口：按 yamlCheckMode 选择解析器（v1.54.0）。 */
function checkYaml(text, mode) {
  return mode === 'heuristic' ? yamlCheck(text) : yamlCheckJs(text);
}

/** 代码文件扩展名（debugger/console/TODO 只查代码，不查文档/配置） */
const CODE_EXTS = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'php', 'rb', 'sh', 'bash']);

/** 文档类扩展名（docs-conversation 规则只查这些） */
const DOC_EXTS = new Set(['md', 'markdown', 'mdx', 'txt']);

/**
 * docs-conversation 规则豁免上下文：命中这些前缀/包裹的措辞不算「沟通记录」——
 * ① skill 来源署名（"EIGHTfs 确立/固化/generatedBy"）是规则溯源，非沟通记录
 * ② 示例（"例：""如""（示例）"）里的会话 ID 是演示，非真实引用
 * ③ 通用占位符（session-xxx）非真实会话
 */
const DOC_CONVERSATION_EXEMPT_RE = [
  /(确立|固化|生成|来源于|generatedBy|whenToUse|description)[：:]\s*[^。\n]*$/i, // 来源/元信息行
  /用户原话|用户确立|用户提供|用户补充|用户点名|用户权威|用户确认(?![\u4e00-\u9fa5])/i,          // skill 来源署名（确认后跟冒号/括号/逗号等非汉字即署名；「用户确认要…」后跟汉字才是沟通转述）
  /^(例|例如|如|示例)[：:：]?/i,                                                     // 示例引导
  /session-[0-9a-f]{8,}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*[（(【]?[^）)】]*[）)】]?$/i, // 带标题的会话 ID 示例
  /session-xxx|session-xxxx|session-xxxxxxxx/i,                                      // 通用占位符
  /^[-*]\s*[^：:]*[（(][^）)]*[）)]$/i,                                               // 表格/列表行（多为条目）
  /(对用户|对 AI|对读者|意思是|即|表示|指|作为|用途)[^。\n]{0,40}/i,               // 解释性语句（说明含义/用途，非沟通记录）
  /session-[0-9a-f]{8,}[^。\n]{0,20}(对用户|对 AI|是|指|表示|即|为)/i,             // 会话 ID 后跟解释（对用户是…/是…意思）
];

function isDocConversationExempt(line) {
  return DOC_CONVERSATION_EXEMPT_RE.some((re) => re.test(line));
}

/**
 * 文档「AI 与用户沟通记录」措辞（release-docs-rule ⛔ 硬规则：公开文档只写做了什么，
 * 不写谁让做的/谁同意的/怎么商量的；沟通/需求/移交/待办类文档统一放 data/沟通文档，不进公开仓库）。
 * 命中即 blocker。注意：只匹配「记录性措辞」，避免误伤正常功能描述。
 * 规则数据（v1.41.0）：规则包 doc-conversation 桶（缺省 EIGHTfs 包 5 条）。
 */

/** npm 包文件路径匹配（node_modules/ 下所有文件 + lock 文件）。提交时自动检出并拦截。 */
const NPM_FILE_RE = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|lock\.yaml|bun\.lock|Gemfile\.lock|composer\.lock|Podfile\.lock)/i;
function isNpmPackageFile(filePath) {
  if (NPM_FILE_RE.test(filePath)) return true;
  if (/(^|\/)node_modules\//.test(filePath)) return true;
  return false;
}

/* ============================================================
 * 硬编码审计（hardcode-path / hardcode-ip）
 * 干什么：提交前拦截代码/配置字面量里的本机绝对路径与局域网 IP。
 * 触发原话：「gitpush增加审计硬编码功能，测试就用插件本身」
 * 思路：密钥类硬编码已由 secret 规则拦；本规则补 no-hardcode-config /
 * host-address-convention / skill-no-hardcode-path 的机器闸——可变路径/地址
 * 必须走配置、环境变量或相对路径，禁止写死本机根。
 * 范围：字符串字面量（'…' / "…" / `…`）内的绝对路径与私网 IP。
 * 严重级：代码/配置文件 blocker；文档（md/txt）warning（文档读者也会被误导）。
 * 不跟私有库豁免走：死路径换机必炸，跟仓库公开/私有无关。
 * 豁免：示例词整行、占位符 <…>、$VAR/${VAR}/process.env、相对路径、回环/监听地址。
 * ============================================================ */
/** Unix/mac 本机绝对路径：必须以 / 开头（行首或空白/引号后），避免 workspaceRoot/data 这类相对段误报。 */
const HARDCODE_PATH_RE = /(?:^|[\s"'`=:])(\/(?:vol\d+|home|Users|mnt|media|appshare)(?:\/[^\s'"`]*)?|\/data\/[^\s'"`]+)/;
/** Windows 盘符绝对路径：源码里常见 C:\\Users\\…（字面量转义）或 C:/Users/… */
const HARDCODE_WIN_PATH_RE = /([A-Za-z]:(?:\\\\|\\|\/)(?:Users|home|Program Files|data)(?:\\\\|\\|\/)?[^\s'"`]*)/;
/** 私网/本机专属 IP（不含 127.0.0.1 回环、不含 0.0.0.0 监听）。 */
const HARDCODE_IP_RE = /\b((?:10\.\d{1,3}\.\d{1,3}\.\d{1,3})|(?:192\.168\.\d{1,3}\.\d{1,3})|(?:172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}))\b/;
/** 系统通用绝对路径前缀：不是本机专属，不报。 */
const GENERIC_UNIX_PREFIX = /^\/(tmp|dev|proc|sys|etc|usr|bin|sbin|lib|lib64|var|run)(\/|$)/;
/** 行内字符串字面量抽取（单引/双引/反引）。 */
function stringLiteralsOf(line) {
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(String(line))) !== null) out.push(m[2]);
  return out;
}
/** 一行里要扫的文本：代码文件只扫字符串字面量；文档/yaml/json 扫整行。 */
function hardcodeScanTexts(line, { wholeLine = false } = {}) {
  if (wholeLine) return [String(line)];
  return stringLiteralsOf(line);
}
function isHardcodeExemptLine(line) {
  if (hasLineExempt(line)) return true;
  if (EXAMPLE_CONTEXT_RE.test(line)) return true;
  return false;
}
function collectHardcodeHits(text) {
  const hits = [];
  const s = String(text);
  // 占位符片段本身不算写死（<workspaceRoot> / $HOME / ${DSH_HOME}）
  const stripped = s.replace(/<[^>]+>/g, '<>').replace(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, '');
  const pathM = stripped.match(HARDCODE_PATH_RE);
  if (pathM) {
    const p = pathM[1];
    if (!GENERIC_UNIX_PREFIX.test(p)) hits.push({ kind: 'path', value: p.slice(0, 80) });
  }
  const winM = stripped.match(HARDCODE_WIN_PATH_RE);
  if (winM) hits.push({ kind: 'path', value: winM[1].slice(0, 80) });
  const ipM = stripped.match(HARDCODE_IP_RE);
  if (ipM) hits.push({ kind: 'ip', value: ipM[1] });
  return hits;
}

/** v1.42.0：auditFile 公共上下文——原「文件头判定」段抽出租借（字段与语义原样），供各子检查共享 */
function buildAuditContext(repoPath, file, { exempt = false, commentWordingPatterns, hardcodeFullScan = false, quality = QUALITY_DEFAULTS, ruleset, yamlMode = 'js-yaml' } = {}) {
  const rs = ruleset || getAuditRuleset();
  const findings = [];
  const fullPath = join(repoPath, file.path);
  const ext = file.path.split('.').pop()?.toLowerCase() || '';
  const isCode = CODE_EXTS.has(ext);
  // 2026-09-02：注释豁免——文件头（前 3 行）声明 dsh-skip-sensitive → 整文件跳过敏感内容规则
  let fileHeaderExempt = false;
  if (!file.isBinary) {
    try { fileHeaderExempt = hasFileHeaderExempt(readFileSync(fullPath, 'utf8')); } catch { /* 读不到则按普通文件 */ }
  }
  const skipSensitive = exempt || fileHeaderExempt;
  // v1.41.0（C5）：.json 文件内 // 注释行豁免「隐私入库类」规则（secret/credential-file/credential-ref）；
  // comment-wording / doc-conversation / 代码质量不豁免（既定规则：豁免仅限隐私入库类）。
  const isJsonFile = ext === 'json';
  const isJsonCommentLine = (line) => isJsonFile && /^\s*\/\//.test(String(line));
  // v1.41.0（C3）：措辞规则 = 规则包 wordingPatterns（缺省）+ overlay 注入（auditRepo 已合并同名覆盖）
  const wordingPatterns = Array.isArray(commentWordingPatterns) && commentWordingPatterns.length
    ? commentWordingPatterns
    : rs.wordingPatterns;
  const isCredFile = rs.credentialFileRes.some((re) => re.test(file.path));
  return { repoPath, file, rs, findings, fullPath, ext, isCode, fileHeaderExempt, skipSensitive, isJsonCommentLine, wordingPatterns, isCredFile, hardcodeFullScan, quality, yamlMode };
}

/**
 * 审计单个变更文件。file 形如 { path, addedLines, deleted, isBinary }，repoPath 用于读完整文件。
 * exempt=true（备份类豁免命中）：跳过敏感内容规则（secret / 凭据文件 / 对话措辞），其余规则照常。
 * hardcodeFullScan=true：硬编码规则扫整个文件（而非只扫新增行）——配置开关「全量扫」。
 */
function auditFile(repoPath, file, { exempt = false, commentWordingPatterns, hardcodeFullScan = false, quality = QUALITY_DEFAULTS, ruleset, yamlMode = 'js-yaml' } = {}) {
  // v1.47.0：纯删除文件（addedLines 空且磁盘已无文件，如 git 删除旧规则包）——没有新增内容可审，跳过
  // （git diff 对 deleted 文件产生 { addedLines: [], deleted: N }，若磁盘文件已删则读盘必 ENOENT）
  if ((!file.addedLines || file.addedLines.length === 0) && (file.deleted || 0) > 0) {
    try { const st = statSync(join(repoPath, file.path)); if (!st.isFile()) return []; } catch { return []; }
  }
  // v1.42.0：拆成「公共上下文 + 九个子检查」（按原规则编号顺序调度，行为零变化），本函数只做调度
  const s = buildAuditContext(repoPath, file, { exempt, commentWordingPatterns, hardcodeFullScan, quality, ruleset, yamlMode });
  checkNpmBinaryCredentialFile(s);
  checkSyntaxAndParse(s);
  scanAddedLineRules(s);
  checkDocsConversation(s);
  checkCommentWordingLines(s);
  checkCredentialRefLines(s);
  countConsoleLogs(s);
  checkHardcodeLines(s);
  checkCodeQuality(s);
  checkStyleRules(s); // v1.47.0：YAML 规则引擎 styleRules 执行器（数值型/正则型；info=pass 不产 findings）
  checkFullScanLines(s); // v1.43.0：新增行注释评分（黑名单加分/白名单减分）→ warning 提示，不拦截
  scoreFileIfReadable(s); // v1.42.0：文件级评分（行数/容量），超基准产出 warning
  return s.findings;
}

/**
 * v1.47.0：YAML styleRules 执行器（数值型 + 正则型代码风格/安全规则）。
 * severity 映射（既定规则）：error→blocker（拦提交）、warning→warning（提醒）、info→pass（通过，不产 findings）。
 * 执行器：
 *   - min-length：新增行变量声明标识符长度 ≥ threshold（exceptions 豁免）
 *   - max-lines：整个文件行数 ≤ threshold（error 级 blocker / warning 级提醒）
 *   - max-complexity：新增行粗算圈复杂度（if/for/while/switch/case/&&/||/?:/catch）
 *   - min-occurrences：重复代码块（简化：同语句块 >1 处，阈值内控制成本）
 *   - regex：正则命中即报（带说明类豁免与占位符豁免，同 secret 语义）
 * ignore glob 匹配文件路径 → 整文件跳过该规则（rules=['*'] 跳过全部 styleRules）
 */
function checkStyleRules(s) {
  const { file, findings, rs, isCode, fullPath, ext } = s;
  if (!Array.isArray(rs.styleRules) || rs.styleRules.length === 0) return;
  // v1.47.0：前端规则（frontend.yml）以 html/css 为目标；isCode 不含 html/css，此处扩展可执行范围
  const styleCode = isCode || ext === 'html' || ext === 'htm' || ext === 'css';
  // v1.47.0：文件头 dsh-skip-sensitive 声明 → 跳过 styleRules（测试文件含目标样本是合法用途）
  if (s.skipSensitive) return;
  const fileIgnored = rs.ignore || [];
  const isIgnored = (ruleId) => fileIgnored.some((ig) => ig.re.test(file.path) && (ig.rules.includes('*') || ig.rules.includes(ruleId)));
  const push = (rule, line, extra) => {
    if (rule.level === 'pass') return; // info=通过：不拦不警告
    findings.push({
      rule: 'style:' + rule.id,
      level: rule.level,
      file: file.path,
      line: line === undefined ? undefined : lineNumber(file, line),
      message: `${rule.message || rule.name}${extra ? `（${extra}）` : ''}`,
    });
  };
  for (const rule of rs.styleRules) {
    if (isIgnored(rule.id)) continue;
    if (rule.kind === 'path-regex') {
      // v1.55.0：目录结构/命名校验——对文件路径本身跑正则（如 tools/、tests/ 复数目录），
      // 不依赖 styleCode 与新增行；命中一次即报（不重复计数）
      for (const re of rule.patterns) {
        if (re.test(file.path)) { push(rule, undefined, '命中 ' + rule.name); break; }
      }
    } else if (rule.kind === 'regex') {
      // v1.51.0：exts 目标文件类型——规则声明只扫指定扩展名（如 npm 审计的 json/npmrc），
      // 显式放行非 styleCode 文件；未声明 exts 保持旧行为（仅 styleCode）
      if (rule.exts) {
        if (!rule.exts.includes(ext)) continue;
      } else if (!styleCode) continue;
      for (const [idx, line] of (file.addedLines || []).entries()) {
        for (const re of rule.patterns) {
          if (re.test(line)) { push(rule, idx, '命中 ' + rule.name); break; }
        }
      }
    } else if (rule.kind === 'min-length') {
      if (!styleCode) continue;
      for (const [idx, line] of (file.addedLines || []).entries()) {
        // 提取声明标识符：const/let/var 名、函数名
        const ids = extractIdentifiers(line);
        for (const id of ids) {
          if (id.length < rule.threshold && !(rule.exceptions || []).includes(id)) {
            push(rule, idx, `标识符「${id}」长度 ${id.length} < ${rule.threshold}`);
            break;
          }
        }
      }
    } else if (rule.kind === 'max-lines') {
      if (rule.id && /file/i.test(rule.id)) {
        // 文件级行数
        let lines = 0;
        try { lines = readFileSync(fullPath, 'utf8').split('\n').length; } catch { continue; }
        if (lines > rule.threshold) push(rule, undefined, `文件 ${lines} 行 > ${rule.threshold}`);
      } else {
        if (!styleCode) continue;
        // 函数级行数（简化：统计 { } 平衡块的最大跨度）
        try {
          const text = readFileSync(fullPath, 'utf8');
          const fnLen = maxFunctionSpan(text);
          if (fnLen > rule.threshold) push(rule, undefined, `最长函数体约 ${fnLen} 行 > ${rule.threshold}`);
        } catch { /* 读不到跳过 */ }
      }
    } else if (rule.kind === 'max-complexity') {
      if (!styleCode) continue;
      for (const [idx, line] of (file.addedLines || []).entries()) {
        const c = complexityOf(line);
        if (c >= rule.threshold) push(rule, idx, `复杂度 ${c} ≥ ${rule.threshold}`);
      }
    } else if (rule.kind === 'max-depth') {
      // v1.56.0：嵌套深度（缩进统计，简化 AST）——整文件最大缩进层级 > 阈值 → 警告（可读性）
      if (!styleCode) continue;
      try {
        const text = readFileSync(fullPath, 'utf8');
        const depth = maxIndentDepth(text);
        if (depth > rule.threshold) push(rule, undefined, `最大嵌套深度 ${depth} 层 > ${rule.threshold}`);
      } catch { /* 读不到跳过 */ }
    } else if (rule.kind === 'min-occurrences') {
      if (!styleCode) continue;
      // 简化重复检测：同语句块（分号结尾语句）在同文件出现 ≥ min_occurrences
      try {
        const text = readFileSync(fullPath, 'utf8');
        const block = repeatedBlock(text, rule.threshold || 3, rule.min_occurrences || 3);
        if (block) push(rule, undefined, `疑似重复代码块「${block}」`);
      } catch { /* 读不到跳过 */ }
    } else if (rule.kind === 'repeated-string') {
      checkRepeatedString(s, rule, push);
    }
  }
}

/** v1.58.0：重复硬编码字符串检测（repeated-string）——统计字符串字面量出现 ≥ min_occurrences，
 * ignorePatterns / ignoreValues 白名单豁免（纯数字/布尔/空值/单字符等）。抽独立函数控制 checkStyleRules 行数。 */
function checkRepeatedString(s, rule, push) {
  const { file, findings, fullPath, isCode, ext } = s;
  const styleCode = isCode || ext === 'html' || ext === 'htm' || ext === 'css';
  if (!styleCode) return;
  try {
    const text = readFileSync(fullPath, 'utf8');
    const literals = text.split('\n').flatMap((l) => stringLiteralsOf(l));
    const counts = new Map();
    for (const lit of literals) counts.set(lit, (counts.get(lit) || 0) + 1);
    const threshold = rule.min_occurrences || 3;
    for (const [lit, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      if (count < threshold) continue;
      if (rule.ignoreValues && rule.ignoreValues.includes(lit)) continue;
      if (rule.ignorePatterns && rule.ignorePatterns.some((re) => re.test(lit))) continue;
      push(rule, undefined, `重复硬编码字符串「${lit}」出现 ${count} 次 ≥ ${threshold}，应提取为常量`);
    }
  } catch { /* 读不到跳过 */ }
}

/** 提取声明标识符：const/let/var 声明名、函数名、参数名（简化正则，不引 AST） */
function extractIdentifiers(line) {
  const out = [];
  for (const m of line.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) out.push(m[1]);
  for (const m of line.matchAll(/\bfunction\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) out.push(m[1]);
  return out;
}

/** 粗算圈复杂度（新增行视角，行内计数） */
function complexityOf(line) {
  let c = 0;
  for (const re of [/\bif\b/g, /\bfor\b/g, /\bwhile\b/g, /\bswitch\b/g, /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g, /\?.*:/g]) {
    for (const m of line.matchAll(re)) c++;
  }
  return c;
}

/** 最大函数体跨度（{} 平衡，简化估算；非精确 AST） */
function maxFunctionSpan(text) {
  const lines = text.split('\n');
  let max = 0;
  let depth = 0, start = -1;
  for (let i = 0; i < lines.length; i++) {
    const open = (lines[i].match(/\{/g) || []).length;
    const close = (lines[i].match(/\}/g) || []).length;
    if (start < 0 && open > 0) { start = i; depth = open; }
    else if (start >= 0) {
      depth += open - close;
      if (depth <= 0) { const span = i - start + 1; if (span > max) max = span; start = -1; depth = 0; }
    }
  }
  return max;
}

/** 简化重复代码检测：找出现 ≥ minOccurrences 次的语句行前缀（长度 ≥ minLen 字符） */
function repeatedBlock(text, minLen, minOccurrences) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length >= minLen);
  const seen = new Map();
  for (const l of lines) {
    const key = l.slice(0, 40);
    seen.set(key, (seen.get(key) || 0) + 1);
    if (seen.get(key) >= minOccurrences) return l.slice(0, 40);
  }
  return null;
}

/** v1.56.0：最大嵌套深度（缩进统计，简化 AST）——非空行的前导空白层级最大值 */
function maxIndentDepth(text) {
  let max = 0;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const indent = line.match(/^(\s*)/)[1].replace(/\t/g, '  ').length / 2;
    if (indent > max) max = indent;
  }
  return max;
}

/**
 * v1.43.0：新增行注释评分（fullScan 附属能力的提交时形态）。
 * 黑名单命中加分、白名单命中减分，总分 ≥ 阈值记 warning（不拦截、不删码，只提示）。
 * 上下文信号（前注释/后代码）在 diff 场景不可得，仅评文本分；规则包 fullScan 段缺省用内置。
 */
function checkFullScanLines(s) {
  const { file, findings, ext, skipSensitive, rs } = s;
  if (skipSensitive) return; // 与措辞类一致：dsh-skip-sensitive 头豁免
  const fs = rs.fullScan || compileFullScan(FULLSCAN_DEFAULTS);
  if (!fs.keywords.length) return;
  const ext0 = String(ext || '').toLowerCase();
  for (const line of file.addedLines || []) {
    const raw = String(line);
    const m = /^(\s*)(\/\/|#|\*|\/\*|<!--)\s?(.*)$/.exec(raw);
    if (!m) continue;
    // 扩展名过滤：# 仅 hash-like，/* 与 // 仅 c-like，<!-- 仅 html-like（与全仓扫描同一套规则）
    const marker = m[2];
    const okHash = ['py', 'sh', 'yml', 'yaml'].includes(ext0);
    const okC = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'css'].includes(ext0);
    const okHtml = ['html', 'vue', 'md'].includes(ext0);
    if ((marker === '#' && !okHash) || ((marker === '//' || marker === '/*' || marker === '*') && !okC) || (marker === '<!--' && !okHtml)) continue;
    const text = m[3].trim();
    if (!text) continue;
    const { score, hits, protects } = scoreComment({ text, prevBlankOrComment: true, nextIsCode: true }, fs);
    if (!hits.length || score < fs.threshold) continue;
    findings.push({
      rule: 'full-scan',
      level: 'warning',
      file: file.path,
      message: `疑似 AI 对话残留注释（评分 ${score} ≥ 阈值 ${fs.threshold}；命中：${hits.join('、')}${protects.length ? `；白名单减分：${protects.join('、')}` : ''}）——请改写为中性技术描述（本条仅提醒，不拦截）`,
      score,
    });
  }
}

/**
 * v1.42.0：文件级自动评分（scoreFile，行数基准 200 / 容量基准 30KB，规则包 quality.file* 可覆盖）。
 * 仅对可读文本执行；评分结果挂 ctx.fileScore（auditRepo 汇总），扣分>0 产出 file-score warning。
 */
function scoreFileIfReadable(s) {
  if (s.file.isBinary) return;
  let content = '';
  try { content = readFileSync(s.fullPath, 'utf8'); } catch { return; } // 读不到（已删除等）不评分
  const sf = scoreFile(content, s.quality || {});
  s.fileScore = sf;
  for (const d of sf.deductions) {
    s.findings.push({
      rule: 'file-score',
      level: 'warning',
      file: s.file.path,
      message: `${d}，文件评分 ${sf.score}（${sf.grade} 级）`,
      score: sf.score,
      grade: sf.grade,
    });
  }
}

/** v1.42.0：规则 0/1/2——npm 包文件入库 / 二进制大文件 / 凭据文件入库（行为原样） */
function checkNpmBinaryCredentialFile(s) {
  const { file, findings, fullPath, skipSensitive, isCredFile } = s;

  // 0. npm/包管理器文件入库（blocker）：锁定文件或 node_modules 内容不应直接入库
  if (isNpmPackageFile(file.path)) {
    findings.push({ rule: 'npm-package-file', level: 'blocker', file: file.path, message: 'npm/yarn/pnpm lock 文件或 node_modules 内容入库，应在 .gitignore 中排除' });
  }

  // 1. 二进制/大文件（blocker）
  if (file.isBinary || isBinaryOrLarge(fullPath)) {
    findings.push({ rule: 'binary', level: 'blocker', file: file.path, message: '二进制或大文件（>1MB）入库，检查是否 gitignore' });
  }

  // 2. 凭据文件入库（blocker；备份类/注释豁免跳过；json 注释行豁免只影响行扫描，文件级规则不豁免注释）
  if (!skipSensitive && isCredFile) {
    findings.push({ rule: 'credential-file', level: 'blocker', file: file.path, message: '凭据/密钥文件出现在变更中，禁止提交' });
  }
}

/** v1.42.0：规则 3——JS/JSON/YAML 语法与解析（blocker，仅文本代码文件；json 容忍 // 注释行 v1.41.0 C5）（行为原样） */
/** v1.41.0（C5）：JSONC 剥离——行首 // 注释行移除后 JSON.parse（v1.47.0 从 rule-packs 内置移到此处，JSONC 豁免为审计能力不随规则包形态废弃） */
function stripJsonComments(text) {
  return String(text || '').split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
}
function checkSyntaxAndParse(s) {
  const { file, findings, fullPath, ext, isCredFile } = s;
  if (file.isBinary || isCredFile) return;
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    const err = syntaxCheck(fullPath);
    if (err) findings.push({ rule: 'syntax', level: 'blocker', file: file.path, message: `JS 语法错误: ${err}` });
  } else if (ext === 'json') {
    // v1.41.0（C5）：json 容忍 // 注释行——stripJsonComments 剥离后再 parse
    try {
      JSON.parse(stripJsonComments(readFileSync(fullPath, 'utf8')));
    } catch (e) {
      findings.push({ rule: 'json', level: 'blocker', file: file.path, message: `JSON 解析失败: ${String(e.message || e).slice(0, 150)}` });
    }
  } else if (ext === 'yml' || ext === 'yaml') {
    const text = readFileSync(fullPath, 'utf8');
    const err = checkYaml(text, s.yamlMode); // v1.54.0：按 yamlCheckMode 选择解析器
    if (err) findings.push({ rule: 'yaml', level: 'blocker', file: file.path, message: `YAML 异常: ${err}` });
  }
}

/** v1.42.0：规则 4——新增行扫描：secret（全文件；备份/注释豁免；v1.41.0 规则来自规则包 secret 桶；json // 注释行豁免 C5）+ debugger/todo（仅代码文件）（行为原样） */
function scanAddedLineRules(s) {
  const { file, findings, rs, isCode, skipSensitive, isJsonCommentLine } = s;
  file.addedLines.forEach((line, idx) => {
    // 敏感信息
    if (!skipSensitive && !hasLineExempt(line) && !isJsonCommentLine(line)) {
      for (const p of rs.secretPatterns) {
        const m = line.match(p.re);
        if (!m) continue;
        // 说明类豁免：示例词上下文整行不报；假凭据值不报
        if (EXAMPLE_CONTEXT_RE.test(line)) continue;
        const value = m[2] ?? m[1] ?? '';
        // 键值对形态（pattern 带「值」捕获组）才做占位符/假值豁免
        if (m[2] !== undefined && value && isPlaceholderOrRef(value)) continue;
        if (m[2] !== undefined && value && FAKE_VALUE.test(value.trim())) continue;
        findings.push({ rule: 'secret', level: 'blocker', file: file.path, line: lineNumber(file, idx), message: p.message || `疑似敏感信息（${p.name}），请确认是否硬编码` });
        break;
      }
    }
    if (!isCode) return;
    if (DEBUGGER_RE.test(line)) {
      findings.push({ rule: 'debugger', level: 'warning', file: file.path, line: lineNumber(file, idx), message: 'debugger 语句残留' });
    }
    if (TODO_RE.test(line)) {
      findings.push({ rule: 'todo', level: 'warning', file: file.path, line: lineNumber(file, idx), message: 'TODO/FIXME 未处理' });
    }
  });
}

/** v1.42.0：规则 5——文档含「AI 与用户沟通记录」措辞（blocker，仅文档文件新增行；备份类/注释豁免跳过）（行为原样） */
function checkDocsConversation(s) {
  const { file, findings, rs, ext, skipSensitive } = s;
  if (!skipSensitive && !file.isBinary && DOC_EXTS.has(ext)) {
    file.addedLines.forEach((line, idx) => {
      if (isDocConversationExempt(line)) return; // 来源署名/示例/占位符不报
      for (const p of rs.docConvPatterns) {
        if (p.re.test(line)) {
          findings.push({ rule: 'docs-conversation', level: 'blocker', file: file.path, line: lineNumber(file, idx), message: `文档疑似含「AI 与用户沟通」类措辞（${p.name}），公开文档只写做了什么，请改写或移入 data/沟通文档` });
          break;
        }
      }
    });
  }
}

/** v1.42.0：规则 5b——代码注释措辞（blocker；comment-wording 规则；备份类/文件头豁免跳过；md/txt 属 5 规则）（行为原样） */
function checkCommentWordingLines(s) {
  const { file, findings, ext, skipSensitive, wordingPatterns } = s;
  // 备份类豁免跳过（exempt）；文件头注释豁免（dsh-skip-sensitive）同样跳过——私有/规则文档可保留溯源署名
  if (!skipSensitive && !file.isBinary && (CODE_EXTS.has(ext) || ext === 'html' || ext === 'htm' || ext === 'css')) {
    file.addedLines.forEach((line, idx) => {
      if (!isCommentLine(line)) return; // 只查注释行
      for (const p of wordingPatterns) {
        if (p && p.re && p.re.test(line)) {
          findings.push({ rule: 'comment-wording', level: 'blocker', file: file.path, line: lineNumber(file, idx), message: `代码/文档注释含「AI 引用用户指令」措辞（${p.name || '未命名'}），应改为中性功能说明（v1.45.0 起只警告不自动改写，需手动改成中性技术描述）` });
          break;
        }
      }
    });
  }
}

/** v1.42.0：规则 5a——文档凭据引用/明文警告（warning，仅文档文件新增行；备份类/注释豁免跳过）（行为原样） */
function checkCredentialRefLines(s) {
  const { file, findings, rs, ext, skipSensitive } = s;
  if (!skipSensitive && !file.isBinary && DOC_EXTS.has(ext)) {
    file.addedLines.forEach((line, idx) => {
      if (hasLineExempt(line) || EXAMPLE_CONTEXT_RE.test(line)) return;
      for (const p of rs.credentialRefPatterns) {
        if (p.re.test(line)) {
          findings.push({ rule: 'credential-ref', level: 'warning', file: file.path, line: lineNumber(file, idx), message: p.message || `文档含凭据引用或明文（${p.name}）：禁止在文档写凭据引用/明文，凭据统一存插件配置目录（DSH_HOME/git-push/，0600 权限），需要时按需读取` });
          break;
        }
      }
    });
  }
}

/** v1.42.0：console.log 数量（warning，仅代码文件；≥5 处才报）（行为原样） */
function countConsoleLogs(s) {
  const { file, findings, isCode } = s;
  if (!isCode) return;
  const consoleCount = file.addedLines.filter((l) => CONSOLE_RE.test(l)).length;
  if (consoleCount >= 5) {
    findings.push({ rule: 'console', level: 'warning', file: file.path, message: `新增 ${consoleCount} 处 console.log 输出，确认是否需要保留` });
  }
}

/**
 * v1.42.0：规则 6——硬编码本机路径 / 局域网 IP（行为原样）。
 * 拦代码字面量与文档里的死路径/死 IP；代码/配置 blocker，文档 warning；
 * 相对路径、/tmp、127.0.0.1、占位符、示例词不报。
 * v1.36.1：hardcodeFullScan 开关（默认 false 只扫新增行；勾选后扫整个文件含既有历史行，config 按整行扫）。
 */
function checkHardcodeLines(s) {
  const { file, findings, ext, fullPath, fileHeaderExempt, hardcodeFullScan } = s;
  if (fileHeaderExempt || file.isBinary) return;
  const isDoc = DOC_EXTS.has(ext);
  const isConfig = ext === 'json' || ext === 'yml' || ext === 'yaml';
  const wholeLine = isDoc || isConfig;
  const level = isDoc ? 'warning' : 'blocker';
  let scanLines = [];
  if (hardcodeFullScan) {
    try {
      scanLines = readFileSync(fullPath, 'utf8').split('\n').map((l, idx) => ({ text: l, idx }));
    } catch { /* 读不到则退回新增行 */ }
  }
  if (!scanLines.length) {
    scanLines = file.addedLines.map((l, idx) => ({ text: l, idx }));
  }
  scanLines.forEach(({ text: line, idx }) => {
    if (isHardcodeExemptLine(line)) return;
    const texts = hardcodeScanTexts(line, { wholeLine });
    for (const t of texts) {
      const hits = collectHardcodeHits(t);
      for (const h of hits) {
        const rule = h.kind === 'ip' ? 'hardcode-ip' : 'hardcode-path';
        const hint = h.kind === 'ip'
          ? '局域网 IP 禁止写死，改配置/环境变量或 hostname 探测'
          : '本机绝对路径禁止写死，改配置/环境变量/相对路径';
        findings.push({
          rule,
          level,
          file: file.path,
          line: lineNumber(file, idx),
          message: `硬编码${h.kind === 'ip' ? 'IP' : '路径'}（${h.value}）：${hint}`,
        });
      }
      if (hits.length) break;
    }
  });
}

/** v1.42.0：规则 7——代码质量维度（v1.39.0；仅 .js/.mjs/.cjs 全文，文件头豁免跳过）（行为原样） */
function checkCodeQuality(s) {
  const { file, findings, ext, fullPath, quality, fileHeaderExempt } = s;
  if (quality?.enabled === false || fileHeaderExempt) return;
  if ((ext !== 'js' && ext !== 'mjs' && ext !== 'cjs') || file.isBinary) return;
  let text = '';
  try { text = readFileSync(fullPath, 'utf8'); } catch { /* 读不到跳过质量规则 */ }
  if (!text) return;
  // 可读性：单函数行数（>50 warning，>100 blocker）
  for (const f of checkFunctionLength(text, { warn: quality.funcLinesWarn, block: quality.funcLinesBlock })) {
    findings.push({
      rule: 'func-lines',
      level: f.level,
      file: file.path,
      line: f.line,
      message: `单函数 ${f.len} 行（阈值 ${f.level === 'blocker' ? quality.funcLinesBlock : quality.funcLinesWarn}）：超长函数难读，应拆分（code-quality-checklist 可读性）`,
    });
  }
  // 健壮性：静默吞错
  for (const c of checkSilentCatch(text)) {
    findings.push({
      rule: 'silent-catch',
      level: 'warning',
      file: file.path,
      line: c.line,
      message: '空 catch 静默吞错：应记录错误（console.error）或降级处理（code-quality-checklist 健壮性）',
    });
  }
  // 性能：async 路径同步 fs 调用
  for (const p of checkSyncInAsync(text)) {
    findings.push({
      rule: 'sync-in-async',
      level: 'warning',
      file: file.path,
      line: p.line,
      message: `async 路径中使用 ${p.call} 同步阻塞，应改用 fs.promises 异步（code-quality-checklist 性能）`,
    });
  }
}

/** 粗算新增行号：diff 内累计（非精确，用于定位） */
function lineNumber(file, idx) {
  return idx + 1;
}

/**
 * 审计一个仓库的相对 HEAD 变更。
 * @param {string} repoPath 仓库绝对路径
 * @param {object} [opts]
 * @param {'any'|'blocker'|'none'} [opts.blockOn] 拦截策略
 * @param {Array} [opts.files] 预解析的变更文件（测试注入用）
 * @param {Array} [opts.exemptRepos] 备份类豁免仓库清单（路径或名称，敏感内容规则跳过；硬编码规则不跳过）
 * @param {boolean} [opts.hardcodeFullScan] 硬编码规则全量扫（默认 false 只扫新增行）
 * @param {object} [opts.ruleset] 显式注入编译规则集（测试隔离用；缺省 getAuditRuleset()）
 * @returns {{ok:true, repo:string, findings:Array, summary:object, blocked:boolean, passed:boolean, ruleset:object}}
 */
export function auditRepo(repoPath, { blockOn = 'any', files, exemptRepos = [], commentWordingPatterns, hardcodeFullScan = false, quality, ruleset, visibility = 'unknown', yamlMode = 'js-yaml' } = {}) {
  const rs = ruleset || getAuditRuleset();
  // v1.41.0（C3）：措辞规则 = 规则包缺省 + overlay（设置自定义/规则文件/在线规则）同名覆盖
  const mergedWording = Array.isArray(commentWordingPatterns) && commentWordingPatterns.length
    ? mergeWording(rs.wordingPatterns, commentWordingPatterns)
    : undefined; // undefined → auditFile 用规则包缺省
  // 质量阈值：内置默认 → 规则包 quality 覆盖 → 调用方显式参数再覆盖
  const qualityEff = { ...QUALITY_DEFAULTS, ...rs.quality, ...(quality || {}) };
  const exempt = isExemptRepo(repoPath, exemptRepos);
  let fileList = files;
  if (!fileList) {
    const d = getDiff(repoPath);
    if (!d.ok) return { ok: false, error: d.error };
    fileList = d.files;
  }
  if (fileList.length === 0) {
    const res = { ok: true, repo: repoPath, findings: [], summary: { blocker: 0, warning: 0, total: 0 }, blocked: false, passed: true, note: '无变更', ruleset: rulesetInfo(rs) };
    if (exempt) { res.exempted = true; res.note += '；备份类豁免命中（敏感内容规则已跳过）'; }
    // v1.48.0：存量级私密拦截（不依赖 diff——历史已入库的私钥/token 本次未改也要感知）
    const priv = scanPrivateFilesForVisibility(repoPath, { visibility, ruleset: rs });
    if (priv.findings.length) {
      res.findings = priv.findings;
      res.summary = { blocker: priv.findings.filter((x) => x.level === 'blocker').length, warning: priv.findings.filter((x) => x.level === 'warning').length, total: priv.findings.length };
      res.blocked = blockOn === 'any' ? priv.findings.length > 0 : summaryBlockerBlocks(blockOn, priv.findings);
      res.passed = !res.blocked;
      res.note = '无 diff 变更；存量私密文件检查命中';
    }
    return res;
  }
  const findings = [];
  for (const f of fileList) {
    findings.push(...auditFile(repoPath, f, { exempt, commentWordingPatterns: mergedWording, hardcodeFullScan, quality: qualityEff, ruleset: rs, yamlMode }));
  }
  // v1.48.0：存量级私密拦截（不依赖 diff——历史已入库的私钥/token 本次未改也要感知）
  const priv = scanPrivateFilesForVisibility(repoPath, { visibility, ruleset: rs });
  for (const f of priv.findings) findings.push(f);
  const summary = {
    blocker: findings.filter((x) => x.level === 'blocker').length,
    warning: findings.filter((x) => x.level === 'warning').length,
    total: findings.length,
  };
  // blockOn：'none'（不拦截，仅警告）/ 'any'（任何问题拦截）/ 'blocker'（默认，仅严重拦截）
  const blocked = summaryBlockerBlocks(blockOn, findings);
  const res = { ok: true, repo: repoPath, findings, summary, blocked, passed: !blocked, blockOn, ruleset: rulesetInfo(rs) };
  if (exempt) {
    res.exempted = true;
    res.note = '备份类豁免命中：敏感内容规则（secret / 凭据文件 / 对话措辞）已跳过，其余规则照常';
  }
  if (priv.findings.length) res.privateFiles = priv.files;
  // v1.39.0：代码质量评分（code-quality-checklist.yaml 维度权重；v1.41.0 阈值可由规则包 quality 覆盖）
  // v1.42.0：评分与 no-tests 提醒抽为 attachQualityScore（行为原样）
  if (qualityEff?.enabled !== false) {
    attachQualityScore(res, { repoPath, findings, summary, fileList });
  }
  return res;
}

/** v1.48.0：统一 blocked 判定（早退/正常路径共用）——blockOn：'none' 不拦 / 'any' 有 finding 即拦 / 默认仅 blocker 拦 */
function summaryBlockerBlocks(blockOn, findings) {
  if (blockOn === 'none') return false;
  if (blockOn === 'any') return findings.length > 0;
  return findings.some((x) => x.level === 'blocker');
}

/**
 * v1.48.0：存量级私密文件拦截审计（私密拦截，强制槽位）。
 * 不依赖 diff——跑 `git ls-files` 列全部跟踪文件，匹配规则集 privateFiles（YAML 配置/内置兜底）；
 * 命中时按远端可见性分级：public → blocker（私密文件已可被任何人获取），private/unknown → warning。
 * 返回 { findings, files }；files = 命中的私密文件路径列表（供界面展示）。
 */
export function scanPrivateFilesForVisibility(repoPath, { visibility = 'unknown', ruleset } = {}) {
  const rs = ruleset || getAuditRuleset();
  const out = { findings: [], files: [] };
  if (!Array.isArray(rs.privateFiles) || rs.privateFiles.length === 0) return out;
  let tracked;
  try {
    const r = runGit(['ls-files'], repoPath);
    tracked = (r.stdout || '').split('\n').filter(Boolean);
  } catch { return out; }
  if (!tracked.length) return out;
  const hits = [];
  for (const p of tracked) {
    for (const pf of rs.privateFiles) {
      if (pf.re.test(p)) { hits.push(p); break; }
    }
  }
  if (!hits.length) return out;
  out.files = hits;
  const publicGate = visibility === 'public';
  for (const p of hits) {
    out.findings.push(publicGate
      ? { rule: 'private-file-public', level: 'blocker', file: p, message: `仓库跟踪私密文件 ${p} 且远端公开（public）——私钥/凭据已可被任何人获取，禁止推送；请移除该文件或转为私有仓库` }
      : { rule: 'private-file-in-repo', level: 'warning', file: p, message: `仓库跟踪私密文件 ${p}（远端 ${visibility === 'private' ? '私有' : '未确认'}）；私有边界内仅提醒，若未来转公开请先移除` });
  }
  return out;
}

/**
 * v1.42.0：把质量评分写入 auditRepo 结果（原 auditRepo 内嵌段抽出租借，行为零变化）。
 * 评分 = checklist.yaml 维度权重 × 静态可测计数；核心源码变更但仓库无测试 → 追加 no-tests warning。
 */
function attachQualityScore(res, { repoPath, findings, summary, fileList }) {
  const yamlPath = locateQualityYaml(repoPath);
  const qy = loadQualityYaml(yamlPath);
  const hasSrcChange = fileList.some((f) => /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(f.path || ''));
  const testing = hasTestFiles(repoPath);
  const qualityFindings = findings.filter((x) => ['func-lines', 'silent-catch', 'sync-in-async'].includes(x.rule));
  const counts = {
    readability: qualityFindings.filter((x) => x.rule === 'func-lines').length,
    robustness: qualityFindings.filter((x) => x.rule === 'silent-catch').length,
    performance: qualityFindings.filter((x) => x.rule === 'sync-in-async').length,
    testing,
  };
  // v1.42.0：文件级评分汇总——file-score warning 已由 auditFile 产出，这里按文件去重取最低分
  const fileScoreMap = new Map();
  for (const f of findings) {
    if (f.rule === 'file-score' && typeof f.score === 'number') {
      const prev = fileScoreMap.get(f.file);
      if (!prev || f.score < prev.score) fileScoreMap.set(f.file, { file: f.file, score: f.score, grade: f.grade });
    }
  }
  const q = scoreQuality(counts, qy);
  res.quality = {
    score: q.score,
    level: q.level,
    levelDesc: q.levelDesc,
    dimensions: q.dimensions,
    hasSrcChange,
    hasTests: testing,
    standard: 'docs/code-quality-checklist.yaml',
    // v1.41.0（C7）：如实标注评分口径——只有 4 个维度静态可测，其余为固定中间值
    scoringBasis: {
      measured: ['可读性', '可维护性', '健壮性', '性能', '测试覆盖'],
      fixedValue: ['安全性', '可观测性', '可部署性', '文档', '开发者体验'],
      note: '打分维度=静态可测（函数行数/静默catch/sync-in-async/测试覆盖），固定值维度仅代表「未见问题」基线分，不代表已验证',
    },
    // v1.42.0：文件级评分（scoreFile：行数基准 200 / 容量基准 30KB），只列被扣分的文件，最低分在前
    fileScores: [...fileScoreMap.values()].sort((a, b) => a.score - b.score),
  };
  // 核心源码变更但仓库无测试 → warning 提醒（不参与 blockOn 拦截）
  if (hasSrcChange && !testing) {
    res.quality.noTestsWarning = true;
    findings.push({ rule: 'no-tests', level: 'warning', file: '(repo)', message: '本次变更含源码但仓库无测试文件——核心逻辑建议补测试（code-quality-checklist 测试覆盖）' });
    summary.warning += 1;
    summary.total += 1;
  }
}

/** 安全编译正则：自定义规则 pattern 非法时返回 null 匹配正则（不抛错、不误报）。 */
function safeRe(pattern, name) {
  try {
    return new RegExp(pattern);
  } catch {
    return { test: () => false, _invalid: true, name: name || pattern };
  }
}
