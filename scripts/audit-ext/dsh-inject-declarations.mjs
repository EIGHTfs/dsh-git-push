/**
 * DSH 插件审计扩展：inject 声明与导出面。
 *
 * 与 dsh-useful-tools 的 verify_plugin（lib/core/verify-plugin/dsh-rules.mjs）**同源规则、独立实现**：
 *   两个插件不互相 import，各自维护判定逻辑；规则增删改要两边同步（见 useful-tools 的 CONTRACT C-114）。
 *
 * 为什么用扩展脚本而不是 YAML 正则：这两条都需要**跨行读 inject 声明**（`export const inject = [...]`），
 *   纯逐行正则做不到 —— 只能看「有没有 ctx.xxx」，无法判断 xxx 是否已经声明。
 *
 * 两条规则：
 *   dsh/ctx-service-not-injected      （blocker）访问 ctx.<服务> 但 inject 没声明该服务
 *   dsh/plugin-default-export-hides-inject（blocker）入口同时有 default 与命名 inject/apply
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

/** 参与扫描的扩展名。 */
const JS_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);
/** 不扫描的目录（第三方依赖、产物、测试夹具、回收站）。 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.trash', 'test', 'tests', 'audit-history']);
/** 扫描上限：单仓库最多看这么多文件，避免大仓拖慢审计。 */
const MAX_FILES = 400;
/** 单文件大小上限。 */
const MAX_FILE_BYTES = 512 * 1024;

/**
 * cordis Context 自身的内建成员（不是"服务"）：访问它们不需要 inject 声明。
 * 只收确定不会误伤的：事件 API、effect、logger、依赖注入原语、fiber/scope 等。
 */
const CORDIS_BUILTIN_MEMBERS = new Set([
  'on', 'once', 'off', 'emit', 'effect', 'logger', 'inject', 'plugin', 'get', 'set', 'provide',
  'accessor', 'root', 'scope', 'fiber', 'reflect', 'registry', 'runtime', 'dispose', 'extend',
  'isolate', 'waterfall', 'bail', 'parallel', 'serial', 'ctx', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'name', 'config', 'options', 'state',
]);

/** 已知的「错误字段名」：不是 cordis 服务，由 YAML 规则 dsh/ctx-undeclared-property-read 负责。 */
const KNOWN_BAD_CTX_FIELDS = new Set([
  'sessionId', 'sessionID', 'conversationId', 'agentId', 'workspaceRoot', 'dshHome', 'DSH_HOME',
]);

/**
 * 真实存在、通过 ctx 暴露的 cordis 服务（保守清单）。
 * 为什么需要：`ctx` 是极常见的参数名——HTTP 请求、工具执行上下文、遍历累加器都可能叫 ctx，
 *   只靠 `ctx.xxx` 的写法无法区分语义（实测：真实插件被误报 20 条 / 仓库）。只报清单里的服务名。
 */
const KNOWN_CORDIS_SERVICES = new Set([
  'tools', 'fs', 'sessions', 'llm', 'credentials', 'webServer', 'slots', 'locale',
  'storageDomain', 'workspaceRegistry', 'commands', 'sandbox', 'models', 'settings',
  'jobs', 'subagents', 'skills', 'schedule', 'terminals', 'systemPrompt', 'spillStore',
  'pluginManager', 'pluginInventory', 'approval', 'sessionQuery', 'agentLoop',
]);

/** 该文件是不是插件入口：只有入口手里那个 ctx 才确定是 cordis Context。 */
function isPluginEntry(text) {
  return /export\s+(async\s+)?function\s+apply\b/.test(text)
    || /export\s+const\s+inject\b/.test(text);
}

/** 递归列待扫描的 JS 文件（相对仓库根的路径）。 */
function collectFiles(repo) {
  const out = [];
  const walk = (dir) => {
    if (out.length >= MAX_FILES) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!JS_EXTS.has(extname(entry.name))) continue;
      try { if (statSync(full).size > MAX_FILE_BYTES) continue; } catch { continue; }
      out.push({ abs: full, rel: relative(repo, full).replace(/\\/g, '/') });
    }
  };
  walk(repo);
  return out;
}

/**
 * 取 `export const inject = [...]` 声明的服务名。
 * 用括号配对而非单行正则：兼容多行数组与 `[{ required: [...], optional: [...] }]` 形态。
 */
function declaredInjectNames(text) {
  const names = new Set();
  const anchor = /export\s+const\s+inject\s*=\s*/.exec(text);
  if (!anchor) return names;
  const start = anchor.index + anchor[0].length;
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    } else if (ch === ';' && depth === 0) { end = i; break; }
  }
  const block = text.slice(start, end === -1 ? Math.min(start + 600, text.length) : end + 1);
  for (const quoted of block.matchAll(/['"`]([^'"`]+)['"`]/g)) names.add(quoted[1]);
  return names;
}

/** 去掉行内注释，保留字符串内容（字符串里的 `//` 不能当注释起点）。 */
function stripTrailingComment(line) {
  let out = '';
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === '\\') { out += line[i + 1] || ''; i += 1; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; continue; }
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch === '/' && line[i + 1] === '*') {
      const close = line.indexOf('*/', i + 2);
      if (close < 0) break;
      i = close + 1;
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

/** 规则 A：访问 ctx.<服务> 但没在 inject 里声明。返回命中行号数组。 */
function ctxServiceNotInjectedHits(text) {
  // 只在插件入口检查：非入口文件里的 ctx 多半是别的语义（HTTP 请求 / 工具上下文 / 累加器），
  //   逐一判断不了，宁可漏报也不误报。
  if (!isPluginEntry(text)) return [];
  const declared = declaredInjectNames(text);
  const hits = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(raw)) continue;
    const code = stripTrailingComment(raw);
    if (!code.includes('ctx')) continue;
    for (const match of code.matchAll(/\bctx\s*\??\.\s*([A-Za-z_$][\w$]*)/g)) {
      const member = match[1];
      if (CORDIS_BUILTIN_MEMBERS.has(member)) continue;
      if (KNOWN_BAD_CTX_FIELDS.has(member)) continue;
      if (!KNOWN_CORDIS_SERVICES.has(member)) continue;
      if (declared.has(member)) continue;
      hits.push({ line: i + 1, text: raw.trim().slice(0, 200) });
      break;
    }
  }
  return hits;
}

/** 规则 B：同时有 export default 与命名 inject/apply（DSH 取 default 后命名导出失效）。 */
function defaultExportConflictLine(text) {
  const hasDefault = /(^|\n)\s*export\s+default\b/.test(text);
  const hasNamedInject = /(^|\n)\s*export\s+(const|let|var)\s+inject\b/.test(text);
  const hasNamedApply = /(^|\n)\s*export\s+(async\s+)?function\s+apply\b/.test(text);
  if (!hasDefault || !(hasNamedInject || hasNamedApply)) return 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*(\/\/|\*|\/\*)/.test(lines[i])) continue;
    if (/(^|\n)\s*export\s+default\b/.test(lines[i])) return i + 1;
  }
  return 1;
}

export const auditExt = {
  name: 'dsh-inject-declarations',
  match: (repo) => Boolean(repo && repo !== '.'),
  run: async (repo) => {
    const findings = [];
    for (const file of collectFiles(repo)) {
      let text = '';
      try { text = readFileSync(file.abs, 'utf8'); } catch { continue; }

      for (const hit of ctxServiceNotInjectedHits(text)) {
        findings.push({
          file: file.rel,
          line: hit.line,
          rule: 'dsh/ctx-service-not-injected',
          severity: 'blocker',
          scoreImpact: 0,
          message: '访问 ctx 上未 inject 的服务：cordis 会直接抛 cannot get property … without inject，插件整条不激活；'
            + '需模块级 export const inject = [\'服务名\']，或改用 ctx.get(\'服务名\')',
          dimensions: ['健壮性'],
        });
      }

      const conflictLine = defaultExportConflictLine(text);
      if (conflictLine) {
        findings.push({
          file: file.rel,
          line: conflictLine,
          rule: 'dsh/plugin-default-export-hides-inject',
          severity: 'blocker',
          scoreImpact: 0,
          message: '入口同时存在 export default 与命名 inject/apply：DSH 装载取 module.default || module，'
            + '有 default 时命名 inject/name 全部失效 ⇒ 访问服务直接抛错、插件不激活；入口只保留命名导出',
          dimensions: ['健壮性'],
        });
      }
    }
    return findings;
  },
};
