/**
 * 跨平台可移植性扫描器（独立工具，可对**任意仓库**跑）
 *
 * 定位：找出「只在 Linux/macOS 能跑」与「只在 Windows 能跑」的代码，并区分
 *   **代码**（会真炸）与**注释**（只是说明，降级为提示）；同时统计已做平台分支的位置。
 *
 * 用法：
 *   node scripts/platform-scan.mjs <目标目录> [--json] [--strict] [--top N] [--ext .js,.mjs,.ts]
 *     --json    机器可读输出（file/line/rule/category/severity/snippet）
 *     --strict  发现「代码里的平台专属写法」时以退出码 1 结束（可用于 CI 门禁）
 *     --top N   文本输出里每类最多列几个文件（默认 8）
 *
 * 判据来源：把实测踩过的坑固化成规则 —— 例如 `process.env.PATH.split(':')`（Windows 用 ';'，
 *   会永远找不到可执行文件，却报成「找不到 git」这种看起来像环境问题的误导结论）、
 *   硬编码 `/tmp`、`sh -c`、`C:\Windows` 断言、`cmd /c` 等。
 *
 * 说明：正则判据是「线索」不是「判决」——例如夹具字符串里的 `/tmp` 也会命中（本工具按
 *   注释/代码分层给出提示，最终由人判断）。跨平台**正确**的写法（`os.tmpdir()`、`path.join`、
 *   `path.delimiter`、`process.platform` 分支）不会被判为问题，只计入「已平台分支」。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tokenize } from '../lib/ast/tokenizer.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash', '.codegraph', 'dist', 'build', '__pycache__', '.test-cache', '.archify']);
const DEFAULT_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sh', '.ps1', '.bat', '.cmd', '.py'];

/** 规则表：id / 类别 / 严重级 / 判据 / 为什么。 */
const RULES = [
  // ── 只在 POSIX（Linux/macOS）成立 ──
  { id: 'posix-tmp', category: 'posix-only', severity: 'warning', re: /['"`]\/tmp\//, why: "硬编码 /tmp：Windows 无此路径（应 os.tmpdir()）" },
  { id: 'posix-devnull', category: 'posix-only', severity: 'warning', re: /['"`]\/dev\/null/, why: '硬编码 /dev/null：Windows 用 NUL' },
  { id: 'posix-shell', category: 'posix-only', severity: 'warning', re: /(\/bin\/(sh|bash)|\bsh\s+-c\b|\bbash\s+-c\b|#!\/bin\/(sh|bash)|(exec(File)?Sync|spawn(Sync)?)\(\s*['"](sh|bash|zsh|fish)['"])/, why: '依赖 POSIX shell：Windows 无 sh/bash（应走 execFile 数组参数）' },
  { id: 'posix-cmd', category: 'posix-only', severity: 'warning', re: /(exec(File)?Sync|spawn(Sync)?)\(\s*['"](chmod|chown|readlink|sed|awk|grep|which|stat|kill|df|du|uname)['"]/, why: '调用 POSIX 专有命令' },
  { id: 'path-split-colon', category: 'posix-only', severity: 'warning', re: /PATH[^\n]*\.split\(\s*['"]:['"]\s*\)|\.split\(\s*['"]:['"]\s*\)[^\n]*PATH/, why: "PATH 用 ':' 切分：Windows 是 ';'（应 path.delimiter）" },
  { id: 'posix-abs', category: 'posix-only', severity: 'notice', re: /['"`]\/(usr|etc|var|opt|bin|sbin|proc|sys)\//, why: '硬编码 POSIX 系统路径（Windows 无对应位置）' },
  { id: 'posix-symlink', category: 'posix-only', severity: 'notice', re: /\b(symlinkSync|symlink)\s*\(/, why: '符号链接：Windows 需特权/开发者模式（应提供降级）' },
  { id: 'posix-sudo', category: 'posix-only', severity: 'notice', re: /\bsudo\s+/, why: 'sudo：Windows 无此命令' },
  { id: 'posix-tilde-ssh', category: 'posix-only', severity: 'notice', re: /['"`]~\/\.ssh\//, why: '~/.ssh 字面量：Windows 家目录形式不同（应 os.homedir()）' },
  // ── 只在 Windows 成立 ──
  { id: 'win-drive', category: 'windows-only', severity: 'warning', re: /['"`][A-Za-z]:[\\/]/, why: '硬编码盘符路径：Linux/macOS 不存在（应 path.parse/os.homedir）' },
  { id: 'win-cmd', category: 'windows-only', severity: 'warning', re: /(cmd(\.exe)?\s+\/c\b|powershell(\.exe)?\b|\bstart\s+['"]{2}|(exec(File)?Sync|spawn(Sync)?)\(\s*['"](cmd|cmd\.exe|powershell|powershell\.exe)['"])/, why: '调用 Windows 专有 shell（cmd/powershell）' },
  { id: 'win-exe', category: 'windows-only', severity: 'notice', re: /['"][^'"\n]*\.(exe|bat|cmd)['"]/, why: '硬编码 .exe/.bat/.cmd：POSIX 上无扩展名（应探测候选名）' },
  { id: 'win-where', category: 'windows-only', severity: 'notice', re: /\b(where|tasklist|wmic|reg\s+query)\b\s+/, why: 'Windows 专有命令（POSIX 对应 which/ps）' },
  { id: 'win-env', category: 'windows-only', severity: 'notice', re: /%[A-Z_]+%/, why: '%VAR% 环境变量写法：仅 Windows cmd 展开' },
  { id: 'win-path32', category: 'windows-only', severity: 'notice', re: /path\.win32\b/, why: '显式使用 Windows 路径语义（若未做平台分支则在 POSIX 上错误）' },
  // ── 已做平台分支（正确做法，仅统计） ──
  { id: 'platform-gated', category: 'gated', severity: 'info', re: /process\.platform\s*[!=]==?\s*['"](win32|linux|darwin)['"]|os\.platform\(\)|os\.tmpdir\(\)|path\.delimiter|path\.(join|resolve|sep)\b/, why: '已使用跨平台写法/平台分支' },
];

/** 递归收集待扫描文件（相对路径）。 */
function collectFiles(root, exts, dir = root, out = []) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st = null;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) collectFiles(root, exts, full, out);
    else if (exts.includes(extname(name))) out.push(relative(root, full).replace(/\\/g, '/'));
  }
  return out;
}

/** 该行是否位于注释里（用 tokenizer 判定，避免把注释当代码）。 */
function commentLineSet(text) {
  const set = new Set();
  try {
    for (const t of tokenize(text)) {
      if (t.type === 'comment') for (let l = t.line; l <= t.line + (String(t.value).split('\n').length - 1); l++) set.add(l);
    }
  } catch { /* tokenize 失败就当没有注释信息 */ }
  return set;
}

/**
 * 扫描一个仓库。
 * @param {string} root 目标目录
 * @param {{exts?:string[]}} [opts]
 * @returns {{findings:Array, summary:object}}
 */
export function scanPlatformCode(root, { exts = DEFAULT_EXTS } = {}) {
  const files = collectFiles(root, exts);
  const findings = [];
  for (const rel of files) {
    let text = '';
    try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    const comments = commentLineSet(text);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 400) continue; // 压缩产物行：跳过（噪声）
      for (const rule of RULES) {
        if (!rule.re.test(line)) continue;
        // 注释里的命中降级为 info（说明性文字，不是可执行代码）
        const inComment = comments.has(i + 1);
        const severity = rule.category === 'gated' ? 'info' : (inComment ? 'info' : rule.severity);
        findings.push({
          file: rel, line: i + 1, rule: rule.id, category: rule.category, severity,
          inComment, why: rule.why, snippet: line.trim().slice(0, 120),
        });
      }
    }
  }
  const byCategory = {};
  for (const f of findings) byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  const actionable = findings.filter((f) => f.category !== 'gated' && !f.inComment && f.severity !== 'info');
  const filesAffected = [...new Set(actionable.map((f) => f.file))];
  return { root, files: files.length, findings, summary: { total: findings.length, byCategory, actionable: actionable.length, filesAffected: filesAffected.length } };
}

/** 解析命令行参数。 */
function parseArgs(argv) {
  const args = { exts: DEFAULT_EXTS, json: false, strict: false, top: 8 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--top') args.top = Number(argv[++i] || 8);
    else if (a === '--ext') args.exts = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--')) throw new Error(`未知参数: ${a}`);
    else positional.push(a);
  }
  args.root = positional[0];
  return args;
}

/** 文本输出（按类别分组 + 每类文件 top）。 */
function printReport(result, top) {
  const { summary, findings } = result;
  console.log(`目标: ${result.root}（扫描 ${result.files} 个文件）`);
  console.log(`命中 ${summary.total} 条｜其中「代码里的平台专属写法」${summary.actionable} 条，涉及 ${summary.filesAffected} 个文件`);
  console.log(`分类: ${JSON.stringify(summary.byCategory)}`);
  for (const [cat, title] of [['posix-only', '只在 POSIX（Linux/macOS）成立'], ['windows-only', '只在 Windows 成立'], ['gated', '已做平台分支/跨平台写法（正面）']]) {
    const rows = findings.filter((f) => f.category === cat);
    if (!rows.length) continue;
    console.log(`\n── ${title}：${rows.length} 条`);
    const byFile = new Map();
    for (const r of rows) byFile.set(r.file, (byFile.get(r.file) || 0) + 1);
    for (const [file, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) {
      console.log(`  ${file}（${n} 条）`);
      for (const r of rows.filter((x) => x.file === file).slice(0, 3)) {
        console.log(`    :${r.line} [${r.rule}]${r.inComment ? '（注释）' : ''} ${r.snippet}`);
      }
    }
  }
}

// ── CLI 入口 ──
// 注意：必须用 fileURLToPath（路径含中文/空格时 new URL().pathname 会变成 %XX 编码，比较恒不相等）
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root) {
    console.error('用法: node scripts/platform-scan.mjs <目标目录> [--json] [--strict] [--top N] [--ext .js,.mjs]');
    process.exit(2);
  }
  const result = scanPlatformCode(resolve(args.root), { exts: args.exts });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else printReport(result, args.top);
  process.exit(args.strict && result.summary.actionable > 0 ? 1 : 0);
}
