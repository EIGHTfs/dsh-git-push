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
const CREDENTIAL_FILE = /(^|[/\\])(\.credentials[^/\\]*|\.env|\.env\.[a-z]+|github-token|.*token.*\.(txt|md|json)|\.ssh[/\\][^/\\]+)$/i;
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

/** npm 包文件路径匹配（node_modules/ 下所有文件 + lock 文件）。提交时自动检出并拦截。 */
const NPM_FILE_RE = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|lock\.yaml|bun\.lock|Gemfile\.lock|composer\.lock|Podfile\.lock)/i;
function isNpmPackageFile(filePath) {
  if (NPM_FILE_RE.test(filePath)) return true;
  if (/(^|\/)node_modules\//.test(filePath)) return true;
  return false;
}

/**
 * 审计单个变更文件。file 形如 { path, addedLines, deleted, isBinary }，repoPath 用于读完整文件。
 */
function auditFile(repoPath, file) {
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

  // 2. 凭据文件入库（blocker）
  if (CREDENTIAL_FILE.test(file.path)) {
    findings.push({ rule: 'credential-file', level: 'blocker', file: file.path, message: '凭据/密钥文件出现在变更中，禁止提交' });
  }

  // 3. 语法/解析（blocker，仅文本代码文件）
  if (!file.isBinary && !CREDENTIAL_FILE.test(file.path)) {
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

  // 4. 新增行扫描（secret 全文件；debugger/todo 仅代码文件）
  file.addedLines.forEach((line, idx) => {
    // 敏感信息
    for (const p of SECRET_PATTERNS) {
      const m = line.match(p.re);
      if (!m) continue;
      const value = m[2] ?? m[1] ?? '';
      if (p.name === '密钥键值对' && value && isPlaceholderOrRef(value)) continue;
      findings.push({ rule: 'secret', level: 'blocker', file: file.path, line: lineNumber(file, idx), message: `疑似敏感信息（${p.name}），请确认是否硬编码` });
      break;
    }
    if (!isCode) return;
    if (DEBUGGER_RE.test(line)) {
      findings.push({ rule: 'debugger', level: 'warning', file: file.path, line: lineNumber(file, idx), message: 'debugger 语句残留' });
    }
    if (TODO_RE.test(line)) {
      findings.push({ rule: 'todo', level: 'warning', file: file.path, line: lineNumber(file, idx), message: 'TODO/FIXME 未处理' });
    }
  });

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
 * @returns {{ok:true, repo:string, findings:Array, summary:object, blocked:boolean, passed:boolean}}
 */
export function auditRepo(repoPath, { blockOn = 'any', files } = {}) {
  let fileList = files;
  if (!fileList) {
    const d = getDiff(repoPath);
    if (!d.ok) return { ok: false, error: d.error };
    fileList = d.files;
  }
  if (fileList.length === 0) {
    return { ok: true, repo: repoPath, findings: [], summary: { blocker: 0, warning: 0, total: 0 }, blocked: false, passed: true, note: '无变更' };
  }
  const findings = [];
  for (const f of fileList) {
    findings.push(...auditFile(repoPath, f));
  }
  const summary = {
    blocker: findings.filter((x) => x.level === 'blocker').length,
    warning: findings.filter((x) => x.level === 'warning').length,
    total: findings.length,
  };
  const blocked = blockOn === 'any' ? findings.length > 0 : summary.blocker > 0;
  return { ok: true, repo: repoPath, findings, summary, blocked, passed: !blocked, blockOn };
}
