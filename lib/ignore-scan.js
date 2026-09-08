// dsh-git-push v1.42.0 — .gitignore 维护与敏感字段扫描（自 core.js 按功能拆分，行为零变化）

import { runGit } from './git-core.js';
import { commitAndPush } from './commit-push.js';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NPM_IGNORE_LINES = [
  'node_modules/',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'npm-debug.log*',
  '.npm/',
  '.pnpm-store/',
];

export function ensureNpmIgnored(repoPath) {
  const giPath = join(repoPath, '.gitignore');
  let existing = '';
  if (existsSync(giPath)) {
    try { existing = readFileSync(giPath, 'utf8'); } catch (_) { existing = ''; }
  }
  const missing = NPM_IGNORE_LINES.filter((line) => !new RegExp(`(^|\\n)${escapeRegExp(line)}(\\n|$)`).test(existing));
  if (missing.length === 0) return { ok: true, added: [] };
  const append = (existing.endsWith('\n') ? '' : '\n') + '# npm 下载产物（dsh-git-push 自动追加，2026-08-20）\n' + missing.join('\n') + '\n';
  try {
    writeFileSync(giPath, existing + append, 'utf8');
    return { ok: true, added: missing };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), added: [] };
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把用户自定义忽略 pattern（如 *.bak*）追加到 .gitignore（2026-09-07 用户需求④）。
 * 幂等：只追加缺失条目；已跟踪文件先 git rm --cached 解除跟踪（工作区文件保留），否则 .gitignore 无效。
 * @param {string} repoPath 仓库绝对路径
 * @param {string|string[]} patterns 逗号/换行分隔的 gitignore pattern，或字符串数组
 * 返回 { ok, added: string[], tracked: string[], unstaged: string[], error? }。
 */

export function ensureCustomIgnored(repoPath, patterns) {
  const list = (Array.isArray(patterns) ? patterns : String(patterns || '').split(/[\n,]/))
    .map((s) => s.trim()).filter(Boolean);
  if (!list.length) return { ok: true, added: [] };
  const giPath = join(repoPath, '.gitignore');
  let existing = '';
  if (existsSync(giPath)) { try { existing = readFileSync(giPath, 'utf8'); } catch { existing = ''; } }
  const missing = list.filter((line) => !new RegExp(`(^|\\n)${escapeRegExp(line)}(\\n|$)`).test(existing));
  if (missing.length === 0) return { ok: true, added: [] };
  const tracked = [];
  const unstaged = [];
  for (const line of missing) {
    // 已跟踪 → 先解除跟踪（git rm --cached --ignore-unmatch），否则 .gitignore 无效
    const ls = runGit(['ls-files', '--error-unmatch', '--', line], repoPath);
    if (ls.status === 0) {
      tracked.push(line);
      const rm = runGit(['rm', '--cached', '--ignore-unmatch', '--', line], repoPath);
      if (rm.status === 0) unstaged.push(line);
    }
  }
  const append = (existing.endsWith('\n') ? '' : '\n') + '# 自定义忽略（dsh-git-push 配置，2026-09-07）\n' + missing.join('\n') + '\n';
  try {
    writeFileSync(giPath, existing + append, 'utf8');
    return { ok: true, added: missing, tracked, unstaged };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), added: [], tracked, unstaged };
  }
}

/* ------------------------------ 敏感字段扫描 + 自动 .gitignore（v1.7.0） ------------------------------ */

/** 递归扫描时跳过的目录（与 npm 屏蔽同源 + 常见忽略） */

const SENSITIVE_SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh', '.trash', 'cache-gifs', 'uploads', 'dist', 'build']);
/** 明显二进制/图片/压缩/媒体扩展名，不当作文本扫描 */

const SENSITIVE_BINARY_EXT = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','svg','zip','7z','rar','gz','tar','xz','pdf','exe','dll','so','dylib','bin','woff','woff2','ttf','otf','mp4','mp3','ogg','wav','flac','db','sqlite','ico']);
/** 敏感字段（cookie / 设备 / 用户名 / 密码 / token-secret），键名大小写不敏感 */

const SENSITIVE_KEYS = [
  { name: 'cookie',     keys: ['cookie', 'cookies'],                                  valueMin: 4 },
  { name: 'device',     keys: ['device_id','device-id','deviceid','device_name','device-info','machine_id','machine-id','hardware_id','hardware-id','imei','serial_number','serial-number'], valueMin: 2 },
  { name: 'username',   keys: ['username','user_name','user-name','login_name','login-name','account'], valueMin: 2 },
  { name: 'password',   keys: ['password','passwd','pass_word','pass-word','pwd'],    valueMin: 3 },
  { name: 'token/secret', keys: ['api_key','api-key','apikey','api_secret','api-secret','access_key','access-key','auth_token','auth-token','refresh_token','refresh-token','secret_key','secret-key','client_secret','client-secret'], valueMin: 6 },
];
/** 占位符/示例值：值看起来是假的就不报（防 README/示例误伤） */

const SENSITIVE_PLACEHOLDER_VALUE = /^(your[-_ ]?[a-z]+|xxx+\.?\.?|example|changeme|dummy|sample|demo|placeholder|<[^>]+>|\$\{?[A-Z_][A-Z0-9_]*}?|process\.env\.[A-Z_]+|env\.[A-Z_]+|undefined|null|true|false)$/i;
/** 行内示例上下文：出现即整行豁免（举例/示例/演示） */

const SENSITIVE_EXAMPLE_CONTEXT = /(例如|举例|示例|样例|演示|比如|fake|sample|demo|example|illustration)/i;

/**
 * 敏感扫描注释豁免标记（2026-09-02：敏感信息可通过注释申请豁免）。
 * 写法（注释里带 dsh-skip-sensitive 即豁免，大小写不敏感）：
 *   · 文件头注释（前 3 行内）→ 整个文件跳过敏感字段扫描（如 app.js 里 password 只是
 *     API 字段名不是真凭据，可加文件头注释声明）
 *   · 行尾注释 → 只跳过该行（`password = "xxx" // dsh-skip-sensitive`）
 * 对「自动 gitignore / 审计 secret 报错」两个扫描器同时生效。
 */

export const SENSITIVE_EXEMPT_MARKER = 'dsh-skip-sensitive';

const SENSITIVE_EXEMPT_RE = /dsh-skip-sensitive/i;
/** 行内是否带豁免注释（同行出现即豁免该行） */

export function hasLineExempt(line) {
  return SENSITIVE_EXEMPT_RE.test(line);
}
/** 文件头（前 3 行）是否声明整文件豁免 */

export function hasFileHeaderExempt(text) {
  const head = String(text || '').split('\n').slice(0, 3).join('\n');
  return SENSITIVE_EXEMPT_RE.test(head);
}

/** 单行敏感字段匹配：返回字段名或 null（跳过豁免注释/示例行/占位符值） */

function sensitiveLineMatch(line) {
  if (hasLineExempt(line)) return null; // 2026-09-02：行内注释豁免
  if (SENSITIVE_EXAMPLE_CONTEXT.test(line)) return null;
  const clean = line.replace(/^[#;/\*\s]+/, ''); // 去掉行首注释标记与空白
  for (const k of SENSITIVE_KEYS) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9_])(?:${k.keys.map(escapeRegExp).join('|')})\\s*[:=]\\s*(.*)$`, 'i');
    const m = clean.match(re);
    if (m) {
      // 键值对值必须是「字符串字面量」才算硬编码凭据（2026-09-02 与 audit.js SECRET_PATTERNS 对齐，
      // 根因修复：`password: document.getElementById(...).value` / `cookie: opts.cookie` 这类
      // 表达式/变量引用不是硬编码凭据；`"完整 Cookie: " + cred.cookieChars` 这类文案拼接也不是。
      // 只有 `password: "xxx"` / `cookie: 'sess=...'` 这种「纯净字符串字面量」才算）
      const raw = m[1].trim();
      const qm = raw.match(/^(["'`])([\s\S]*?)\1\s*[,;)\]}\s]*$/);
      if (!qm) continue; // 非字符串字面量（变量/函数调用/表达式）→ 跳过
      let val = qm[2].trim();
      if (/\+|\$\{/.test(val)) continue; // 含字符串拼接/模板插值 = 表达式，不是单一硬编码值 → 跳过
      if (val.length >= k.valueMin && !SENSITIVE_PLACEHOLDER_VALUE.test(val)) return k.name;
    }
  }
  return null;
}

/**
 * 扫描仓库全部文本文件，找出含敏感字段（cookie/device/username/password/token-secret）的文件。
 * 返回 [{ path, fields: string[] }]。只扫 ≤512KB 的文本文件（跳过二进制/图片/压缩/忽略目录）。
 */

export function scanSensitiveFiles(repoPath) {
  const hits = [];
  const walk = (dir, rel) => {
    let items;
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const relPath = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory()) {
        if (SENSITIVE_SKIP_DIRS.has(it.name)) continue;
        walk(join(dir, it.name), relPath);
      } else if (it.isFile()) {
        try {
          const st = statSync(join(dir, it.name));
          if (st.size > 512 * 1024) continue;
        } catch { continue; }
        const dot = it.name.lastIndexOf('.');
        const ext = dot >= 0 ? it.name.slice(dot + 1).toLowerCase() : '';
        if (SENSITIVE_BINARY_EXT.has(ext)) continue;
        let text;
        try { text = readFileSync(join(dir, it.name), 'utf8'); } catch { continue; }
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) continue; // 二进制内容
        if (hasFileHeaderExempt(text)) continue; // 2026-09-02：文件头声明 dsh-skip-sensitive → 整文件豁免
        const fields = [];
        for (const line of text.split('\n')) {
          const r = sensitiveLineMatch(line);
          if (r && !fields.includes(r)) fields.push(r);
          if (fields.length === SENSITIVE_KEYS.length) break;
        }
        if (fields.length) hits.push({ path: relPath, fields });
      }
    }
  };
  walk(repoPath, '');
  return hits;
}

/**
 * 扫描敏感字段并把命中文件追加到 .gitignore（幂等；已跟踪文件自动 git rm --cached 解除跟踪，工作区文件保留）。
 * @param {string} repoPath 仓库绝对路径
 * @param {{skipWrite?: boolean}} [opts] skipWrite=true → 只扫描报告（hits），不写 .gitignore、不解除跟踪（2026-09-02 私有库豁免用）
 * 返回 { ok, added: string[], hits, tracked: string[], unstaged: string[], skipped?: string }。
 */

export function ensureSensitiveIgnored(repoPath, { skipWrite = false } = {}) {
  const hits = scanSensitiveFiles(repoPath);
  const added = [];
  const tracked = [];
  const unstaged = [];
  if (hits.length && !skipWrite) {
    const giPath = join(repoPath, '.gitignore');
    let existing = '';
    if (existsSync(giPath)) { try { existing = readFileSync(giPath, 'utf8'); } catch { existing = ''; } }
    const toAdd = [];
    for (const h of hits) {
      const line = h.path;
      if (new RegExp(`(^|\\n)${escapeRegExp(line)}(\\n|$)`).test(existing)) continue;
      // 已跟踪 → 先解除跟踪（git rm --cached --ignore-unmatch），否则 .gitignore 无效
      const ls = runGit(['ls-files', '--error-unmatch', '--', line], repoPath);
      if (ls.status === 0) {
        tracked.push(line);
        const rm = runGit(['rm', '--cached', '--ignore-unmatch', '--', line], repoPath);
        if (rm.status === 0) unstaged.push(line);
      }
      toAdd.push(line);
    }
    if (toAdd.length) {
      const append = (existing.endsWith('\n') ? '' : '\n') + '# 敏感字段文件（dsh-git-push 自动追加，2026-09-01）\n' + toAdd.join('\n') + '\n';
      try {
        writeFileSync(giPath, existing + append, 'utf8');
        added.push(...toAdd);
      } catch (e) {
        return { ok: false, error: String(e?.message || e), hits, tracked, added: [], unstaged };
      }
    }
  }
  return { ok: true, added, hits, tracked, unstaged, skipped: skipWrite ? 'private-repo-exempt' : undefined };
}

/**
 * 一键提交推送：
 *   ensureNpmIgnored → git add -A → 检查变更 → git commit -m message → push 前 fetch + ahead/behind 检查 → push origin <branch>
 * 返回结构化结果；dryRun 只走扫描统计不执行写入。
 */
/** commitAndPush 前置校验：参数 / .git / message / 开发者要求门禁 / detached 检查；拦截时返回 { ret }。 */
