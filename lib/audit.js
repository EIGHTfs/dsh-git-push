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
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isBinaryOrLarge, getDiff, hasFileHeaderExempt, hasLineExempt } from './core.js';
import { DEFAULT_COMMENT_WORDING_PATTERNS, DEFAULT_DOC_CONVERSATION_PATTERNS } from './rules.js';

/** 敏感信息正则（宽松匹配 + 排除占位符/环境变量引用） */
const SECRET_PATTERNS = [
  { name: 'GitHub PAT', re: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { name: 'OpenAI/API key', re: /\bsk-(proj-)?[A-Za-z0-9-]{16,}\b/ },
  { name: '密钥键值对', re: /\b(api[_-]?key|api[_-]?secret|secret|password|passwd|client[_-]?secret|access[_-]?token|auth[_-]?token|private[_-]?key|bearer)\b\s*[:=]\s*["']([^"'\s]{8,})["']/i },
];
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
const CREDENTIAL_FILE = /(^|[/\\])(\.credentials[^/\\]*|\.env|\.env\.[a-z]+|github-token|data[/\\]sensitive[/\\][^/\\]+|\.ssh[/\\][^/\\]+)$/i;
/** token 类文件：仅当位于私密目录（data/sensitive、私密配置、.ssh）才视为凭据文件；skills/ 下的规则文档（如 token-saving-mode.md）不是凭据 */
const CREDENTIAL_TOKEN_FILE = /(^|[/\\])(data[/\\]sensitive[/\\]|dsh-private-configs[/\\]|\.ssh[/\\]|private)[/\\][^/\\]*token[^/\\]*\.(txt|md|json)$/i;
function isCredentialFile(path) {
  if (CREDENTIAL_FILE.test(path)) return true;
  if (CREDENTIAL_TOKEN_FILE.test(path)) return true;
  return false;
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
 *      提示改为指向 dsh-git-push-User 内 json；禁止在文档里写凭据引用路径。
 *   2) 凭据明文（密码/token/cookie 值写进文档）——由 SECRET_PATTERNS 拦 blocker，
 *      此处对「文档内出现凭据值」再补 warning（含账号+密码同行的账号密码对）。
 * 豁免：行含示例词（例如/示例/fake/xxx 等）、行是代码块分隔符、已在 json 凭据文件内（不适用文档规则）。
 */
const CREDENTIAL_REF_PATTERNS = [
  { name: '旧凭据文件引用', re: /(\.ssh[\\/]credentials|data[\\/]sensitive[\\/]|credentials\.md|sudo-key|git-rescue[\\/]token)/i },
  { name: '凭据明文入文档', re: /(密码|password|passwd|token|cookie|账号)\s*[:：=]\s*['"]?[A-Za-z0-9_@.\-]{6,}['"]?/i },
];

/* ============================================================
 * 代码注释措辞（comment-wording）规则
 * 代码注释禁止出现「/////
 * //」这类「AI 引用用户指令」的沟通记录措辞；
 * 注释只写做了什么/为什么（release-docs-rule 的代码注释版）。
 * 规则定义可在设置 → 插件 → git-push 里自定义（JSON 文本）、导入导出
 * 本地规则文件、或配置在线规则 URL 拉取合并（见 lib/rules.js）。
 * 检测 → blocker；commitWithAudit 提交前先 autofix 自动改写，
 * 正常流程不会拦；autofix 关闭或改写失败时才拦。
 * 默认内置规则（与历史行为一致）；注入自定义规则时按 name 覆盖同名项。
 * ============================================================ */
/** 默认违规措辞（检测用，name → 预编译 re，与内置规则一致） */
const COMMENT_WORDING_PATTERNS = [
  ...DEFAULT_COMMENT_WORDING_PATTERNS,
  ...DEFAULT_DOC_CONVERSATION_PATTERNS,
].map((r) => ({ name: r.name, re: new RegExp(r.pattern) }));

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

/**
 * 自动清理代码注释措辞（纯函数，可单测）：把注释中「//…
 * 」等措辞改写为中性说明，保留日期与功能语义。
 * 只替换「注释段」内的措辞，代码字符串/标识符不碰。
 * 支持行注释与块注释（/* … * /、<!-- … --> 含 JSDoc 多行）。
 * @param {string} text 文件全文
 * @param {Array<RegExp>} [extraPatterns] 自定义措辞正则（设置/规则文件/在线规则注入），
 *   在内置改写后对注释段再执行一次删除（用于检测规则里新增的措辞）。
 * @returns {{ text: string, count: number }} 清理后文本 + 措辞替换次数
 */
export function cleanCommentWording(text, extraPatterns = []) {
  const lines = String(text).split('\n');
  let block = null; // '/*' | '<!--' —— 当前处于的多行注释状态
  let count = 0;

  const scrub = (comment) => {
    let c = comment;
    // 与历史手工清理同等规则，顺序执行（先特殊后通用）：
    // 1) 括注/ → 删除括注，后续冒号保留
    c = c.replace(/（用户原话）/g, () => { count++; return ''; });
    c = c.replace(/\(用户原话\)/g, () => { count++; return ''; });
    // 2) 日期 + 措辞（/原话/约定/加回）→ 只留日期
    c = c.replace(/(\d{4}-\d{2}-\d{2}) 用户要求（/g, (m, d) => { count++; return `${d}（`; });
    c = c.replace(/(\d{4}-\d{2}-\d{2}) 用户要求加回/g, (m, d) => { count++; return `${d} 加回`; });
    c = c.replace(/(\d{4}-\d{2}-\d{2}) 用户要求：/g, (m, d) => { count++; return `${d}：`; });
    c = c.replace(/(\d{4}-\d{2}-\d{2}) 用户要求/g, (m, d) => { count++; return `${d}`; });
    c = c.replace(/(\d{4}-\d{2}-\d{2}) 用户原话：/g, (m, d) => { count++; return `${d}：`; });
    c = c.replace(/(\d{4}-\d{2}-\d{2}) 用户约定：/g, (m, d) => { count++; return `${d}：`; });
    // 3) 措辞 + 「内容」 → 「内容」（引号内容保留）
    c = c.replace(/用户原话[：:]?「/g, () => { count++; return '「'; });
    c = c.replace(/用户原话「/g, () => { count++; return '「'; });
    // 4) （内容） → （内容）
    c = c.replace(/（用户要求[：:]?/g, () => { count++; return '（'; });
    c = c.replace(/\(用户要求[：:]?/g, () => { count++; return '('; });
    // 5)  → 恢复此形态
    c = c.replace(/用户要求恢复此形态/g, () => { count++; return ''; });
    // 6) 孤立措辞（/原话/约定/规定/明确/拍板/说/：）→ 删除
    c = c.replace(/用户要求[：:]?/g, () => { count++; return ''; });
    c = c.replace(/用户原话[：:]?/g, () => { count++; return ''; });
    c = c.replace(/用户约定[：:]?/g, () => { count++; return ''; });
    c = c.replace(/用户规定[：:]?/g, () => { count++; return ''; });
    c = c.replace(/用户明确[：:]?/g, () => { count++; return ''; });
    c = c.replace(/用户拍板[：:]?/g, () => { count++; return ''; });
    c = c.replace(/用户说[：:]?/g, () => { count++; return ''; });
    c = c.replace(/用户：/g, () => { count++; return ''; });
    // 7) 自定义措辞（规则注入的新增 pattern，对内置改写未覆盖的再删一次）
    for (const re of extraPatterns) {
      if (re instanceof RegExp) {
        const withColon = new RegExp(re.source + '[\uFF1A:]?', re.flags);
        c = c.replace(withColon, () => { count++; return ''; });
      }
    }
    return c;
  };

  const out = lines.map((line) => {
    // 已在块注释内：整行都算注释（JSDoc 中间行 * xxx）
    if (block) {
      let comment = line;
      if (block === '/*' && comment.indexOf('*/') >= 0) block = null;
      if (block === '<!--' && comment.indexOf('-->') >= 0) block = null;
      return scrub(comment);
    }
    const m = commentStartOf(line);
    if (!m) return line; // 无注释，跳过
    const head = line.slice(0, m.at);
    let comment = line.slice(m.at);
    // 多行注释入口：本行未闭合则进入块状态
    if (m.type === '/*' && comment.indexOf('*/') < 0) block = '/*';
    if (m.type === '<!--' && comment.indexOf('-->') < 0) block = '<!--';
    return head + scrub(comment);
  });
  return { text: out.join('\n'), count };
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

/** 宽松 YAML 检查（缩进级联 + 冒号结构），返回错误或 null */
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
 * 文档「AI 与用户沟通记录」措辞模式（release-docs-rule ⛔ 硬规则：公开文档只写做了什么，
 * 不写谁让做的/谁同意的/怎么商量的；沟通/需求/移交/待办类文档统一放 data/沟通文档，不进公开仓库）。
 * 命中即 blocker。注意：只匹配「记录性措辞」，避免误伤正常功能描述。
 */
const DOC_CONVERSATION_PATTERNS = [
  { name: '会话引用', re: /(本会话|本次会话|本对话|开发会话|session-[0-9a-f]{8,})/i },
  { name: '用户决策来源', re: /用户(同意|许可|确认|约定|指定|已定调|拍板|让我|要求我|跟我说)/ },
  { name: 'AI 许可表述', re: /我(同意|许可|确认|答应|承诺|已按你)/ },
  { name: '商量/沟通转述', re: /我们(商量|讨论|约定|沟通|说好|议定)/ },
  { name: '对话/沟通记录', re: /(对话记录|聊天记录|沟通记录|对话内容|聊天内容)/ },
];

/** npm 包文件路径匹配（node_modules/ 下所有文件 + lock 文件）。提交时自动检出并拦截。 */
const NPM_FILE_RE = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|lock\.yaml|bun\.lock|Gemfile\.lock|composer\.lock|Podfile\.lock)/i;
function isNpmPackageFile(filePath) {
  if (NPM_FILE_RE.test(filePath)) return true;
  if (/(^|\/)node_modules\//.test(filePath)) return true;
  return false;
}

/**
 * 审计单个变更文件。file 形如 { path, addedLines, deleted, isBinary }，repoPath 用于读完整文件。
 * exempt=true（备份类豁免命中）：跳过敏感内容规则（secret / 凭据文件 / 对话措辞），其余规则照常。
 */
function auditFile(repoPath, file, { exempt = false, commentWordingPatterns } = {}) {
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
  // 2026-09-06：comment-wording 规则注入（设置自定义/本地规则文件/在线规则合并后的条目）；
  // 缺省用内置 DEFAULT_COMMENT_WORDING_PATTERNS（含 docs-conversation 决策来源措辞）。
  const wordingPatterns = Array.isArray(commentWordingPatterns) && commentWordingPatterns.length
    ? commentWordingPatterns.map((p) => (p && p.name && p.pattern ? { name: p.name, re: typeof p.re === 'object' ? p.re : safeRe(p.pattern, p.name) } : p))
    : COMMENT_WORDING_PATTERNS;

  // 0. npm/包管理器文件入库（blocker）：锁定文件或 node_modules 内容不应直接入库
  if (isNpmPackageFile(file.path)) {
    findings.push({ rule: 'npm-package-file', level: 'blocker', file: file.path, message: 'npm/yarn/pnpm lock 文件或 node_modules 内容入库，应在 .gitignore 中排除' });
  }

  // 1. 二进制/大文件（blocker）
  if (file.isBinary || isBinaryOrLarge(fullPath)) {
    findings.push({ rule: 'binary', level: 'blocker', file: file.path, message: '二进制或大文件（>1MB）入库，检查是否 gitignore' });
  }

  // 2. 凭据文件入库（blocker；备份类/注释豁免跳过）
  if (!skipSensitive && isCredentialFile(file.path)) {
    findings.push({ rule: 'credential-file', level: 'blocker', file: file.path, message: '凭据/密钥文件出现在变更中，禁止提交' });
  }

  // 3. 语法/解析（blocker，仅文本代码文件）
  if (!file.isBinary && !isCredentialFile(file.path)) {
    if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
      const err = syntaxCheck(fullPath);
      if (err) findings.push({ rule: 'syntax', level: 'blocker', file: file.path, message: `JS 语法错误: ${err}` });
    } else if (ext === 'json') {
      try {
        readFileSync(fullPath, 'utf8');
        JSON.parse(readFileSync(fullPath, 'utf8'));
      } catch (e) {
        findings.push({ rule: 'json', level: 'blocker', file: file.path, message: `JSON 解析失败: ${String(e.message || e).slice(0, 150)}` });
      }
    } else if (ext === 'yml' || ext === 'yaml') {
      const text = readFileSync(fullPath, 'utf8');
      const err = yamlCheck(text);
      if (err) findings.push({ rule: 'yaml', level: 'blocker', file: file.path, message: `YAML 异常: ${err}` });
    }
  }

  // 4. 新增行扫描（secret 全文件；debugger/todo 仅代码文件；备份类/注释豁免跳过 secret）
  file.addedLines.forEach((line, idx) => {
    // 敏感信息
    if (!skipSensitive && !hasLineExempt(line)) {
      for (const p of SECRET_PATTERNS) {
        const m = line.match(p.re);
        if (!m) continue;
        // 说明类豁免：示例词上下文整行不报；假凭据值不报
        if (EXAMPLE_CONTEXT_RE.test(line)) continue;
        const value = m[2] ?? m[1] ?? '';
        if (p.name === '密钥键值对' && value && isPlaceholderOrRef(value)) continue;
        if (p.name === '密钥键值对' && value && FAKE_VALUE.test(value.trim())) continue;
        findings.push({ rule: 'secret', level: 'blocker', file: file.path, line: lineNumber(file, idx), message: `疑似敏感信息（${p.name}），请确认是否硬编码` });
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

  // 5. 文档含「AI 与用户沟通记录」措辞（blocker，仅文档文件新增行；备份类/注释豁免跳过）
  if (!skipSensitive && !file.isBinary && DOC_EXTS.has(ext)) {
    file.addedLines.forEach((line, idx) => {
      if (isDocConversationExempt(line)) return; // 来源署名/示例/占位符不报
      for (const p of DOC_CONVERSATION_PATTERNS) {
        if (p.re.test(line)) {
          findings.push({ rule: 'docs-conversation', level: 'blocker', file: file.path, line: lineNumber(file, idx), message: `文档疑似含「AI 与用户沟通」类措辞（${p.name}），公开文档只写做了什么，请改写或移入 data/沟通文档` });
          break;
        }
      }
    });
  }

  // 5b. 代码注释措辞（blocker，仅代码/前端标记文件；comment-wording 规则）
  // 备份类豁免跳过（exempt）；文件头注释豁免（dsh-skip-sensitive）同样跳过——私有/规则文档可保留溯源署名
  // 注意：md/txt 属 5 规则（docs-conversation + 来源署名豁免），此处只查代码注释。
  if (!skipSensitive && !file.isBinary && (CODE_EXTS.has(ext) || ext === 'html' || ext === 'htm' || ext === 'css')) {
    file.addedLines.forEach((line, idx) => {
      if (!isCommentLine(line)) return; // 只查注释行
      for (const p of wordingPatterns) {
        if (p && p.re && p.re.test(line)) {
          findings.push({ rule: 'comment-wording', level: 'blocker', file: file.path, line: lineNumber(file, idx), message: `代码/文档注释含「AI 引用用户指令」措辞（${p.name || '未命名'}），应改为中性功能说明（提交时自动清理）` });
          break;
        }
      }
    });
  }

  // 5a. 文档凭据引用/明文警告（warning，仅文档文件新增行；备份类/注释豁免跳过）
  // 「提示AI文档不要写引用，更不能直接写。让AI在gitpushuser目录存，找」
  // 文档里出现旧凭据位置引用（.ssh/credentials.md / data/sensitive/ / sudo-key 等）
  // 或凭据明文键值对 → 警告，提示改存 dsh-git-push-User 内 json 按需读取。
  if (!skipSensitive && !file.isBinary && DOC_EXTS.has(ext)) {
    file.addedLines.forEach((line, idx) => {
      if (hasLineExempt(line) || EXAMPLE_CONTEXT_RE.test(line)) return;
      for (const p of CREDENTIAL_REF_PATTERNS) {
        if (p.re.test(line)) {
          findings.push({ rule: 'credential-ref', level: 'warning', file: file.path, line: lineNumber(file, idx), message: `文档含凭据引用或明文（${p.name}）：禁止在文档写凭据引用/明文，凭据统一存 dsh-git-push-User 内 json（devices/ssh-credentials.json / websites/<站点>.json），需要时按需读取` });
          break;
        }
      }
    });
  }

  // console.log 数量（warning，仅代码文件）
  if (isCode) {
    const consoleCount = file.addedLines.filter((l) => CONSOLE_RE.test(l)).length;
    if (consoleCount >= 5) {
      findings.push({ rule: 'console', level: 'warning', file: file.path, message: `新增 ${consoleCount} 处 console.log 输出，确认是否需要保留` });
    }
  }

  return findings;
}

/** 粗算新增行号：diff 内累计（非精确，用于定位） */
function lineNumber(file, idx) {
  return idx + 1;
}

/**
 * 审计一个仓库的相对 HEAD 变更。
 * @param {string} repoPath 仓库绝对路径
 * @param {object} [opts]
 * @param {'any'|'blocker'} [opts.blockOn] 拦截策略
 * @param {Array} [opts.files] 预解析的变更文件（测试注入用）
 * @param {Array} [opts.exemptRepos] 备份类豁免仓库清单（路径或名称，敏感内容规则跳过）
 * @returns {{ok:true, repo:string, findings:Array, summary:object, blocked:boolean, passed:boolean}}
 */
export function auditRepo(repoPath, { blockOn = 'any', files, exemptRepos = [], commentWordingPatterns } = {}) {
  const exempt = isExemptRepo(repoPath, exemptRepos);
  let fileList = files;
  if (!fileList) {
    const d = getDiff(repoPath);
    if (!d.ok) return { ok: false, error: d.error };
    fileList = d.files;
  }
  if (fileList.length === 0) {
    const res = { ok: true, repo: repoPath, findings: [], summary: { blocker: 0, warning: 0, total: 0 }, blocked: false, passed: true, note: '无变更' };
    if (exempt) { res.exempted = true; res.note += '；备份类豁免命中（敏感内容规则已跳过）'; }
    return res;
  }
  const findings = [];
  for (const f of fileList) {
    findings.push(...auditFile(repoPath, f, { exempt, commentWordingPatterns }));
  }
  const summary = {
    blocker: findings.filter((x) => x.level === 'blocker').length,
    warning: findings.filter((x) => x.level === 'warning').length,
    total: findings.length,
  };
  const blocked = blockOn === 'any' ? findings.length > 0 : summary.blocker > 0;
  const res = { ok: true, repo: repoPath, findings, summary, blocked, passed: !blocked, blockOn };
  if (exempt) {
    res.exempted = true;
    res.note = '备份类豁免命中：敏感内容规则（secret / 凭据文件 / 对话措辞）已跳过，其余规则照常';
  }
  return res;
}

/** 安全编译正则：自定义规则 pattern 非法时返回 null 匹配正则（不抛错、不误报）。 */
function safeRe(pattern, name) {
  try {
    return new RegExp(pattern);
  } catch {
    return { test: () => false, _invalid: true, name: name || pattern };
  }
}
