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
import { isBinaryOrLarge, getDiff } from './core.js';

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
 * ① skill 来源署名（"EIGHTfs 确立/用户原话固化/generatedBy"）是规则溯源，非沟通记录
 * ② 示例（"例：""如""（示例）"）里的会话 ID 是演示，非真实引用
 * ③ 通用占位符（session-xxx）非真实会话
 */
const DOC_CONVERSATION_EXEMPT_RE = [
  /(确立|固化|生成|来源于|generatedBy|whenToUse|description)[：:]\s*[^。\n]*$/i, // 来源/元信息行
  /用户原话|用户确立|用户提供|用户补充|用户点名|用户权威|用户确认[：:]/i,          // skill 来源署名
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
function auditFile(repoPath, file, { exempt = false } = {}) {
  const findings = [];
  const fullPath = join(repoPath, file.path);
  const ext = file.path.split('.').pop()?.toLowerCase() || '';
  const isCode = CODE_EXTS.has(ext);

  // 0. npm/包管理器文件入库（blocker）：锁定文件或 node_modules 内容不应直接入库
  if (isNpmPackageFile(file.path)) {
    findings.push({ rule: 'npm-package-file', level: 'blocker', file: file.path, message: 'npm/yarn/pnpm lock 文件或 node_modules 内容入库，应在 .gitignore 中排除' });
  }

  // 1. 二进制/大文件（blocker）
  if (file.isBinary || isBinaryOrLarge(fullPath)) {
    findings.push({ rule: 'binary', level: 'blocker', file: file.path, message: '二进制或大文件（>1MB）入库，检查是否 gitignore' });
  }

  // 2. 凭据文件入库（blocker；备份类豁免跳过）
  if (!exempt && isCredentialFile(file.path)) {
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

  // 4. 新增行扫描（secret 全文件；debugger/todo 仅代码文件；备份类豁免跳过 secret）
  file.addedLines.forEach((line, idx) => {
    // 敏感信息
    if (!exempt) {
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

  // 5. 文档含「AI 与用户沟通记录」措辞（blocker，仅文档文件新增行；备份类豁免跳过）
  if (!exempt && !file.isBinary && DOC_EXTS.has(ext)) {
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
export function auditRepo(repoPath, { blockOn = 'any', files, exemptRepos = [] } = {}) {
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
    findings.push(...auditFile(repoPath, f, { exempt }));
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
