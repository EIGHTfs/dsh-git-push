#!/usr/bin/env node
/**
 * scrub-user-wording.mjs —— 清理「用户沟通措辞」独立脚本（非插件入口，AI 可直调）。
 *
 * 背景：dsh-git-push v1.27~v1.44 曾内置 autoCleanCommentWording（提交前自动改写注释措辞），
 * v1.45.0 因「commentStartOf 字符串不感知」三次静默篡改事故（把测试夹具字符串里的
 * `# 用户说…` 当注释改掉）废除，确立「只警告不删改」总原则。本脚本是它的独立复活版：
 * 插件**不注册任何入口**（不进 lib/、不注册工具/API/设置项），仅作为可执行脚本，
 * 供 AI / 用户需要时手动调用。
 *
 * 相比旧实现的关键修复：
 *   1) 词法感知：逐字符扫描区分「字符串字面量 / 注释 / 代码」，只改写注释段——
 *      字符串里的 `'# 用户说…'`、`"// 用户要求"` 不会被误伤（三次事故根因）。
 *   2) md 文档跳过 ``` 围栏代码块（测试夹具/示例代码里的措辞是数据，不是沟通残留），
 *      且 md 措辞可能是来源署名/名词用法（如「是否符合用户要求」），交互确认时会标注风险。
 *   3) 先预览再删改：--apply 进入逐条确认（y/n/a/q），确认后才写盘（每文件 .bak 备份）；
 *      --yes 跳过确认全改（供 AI/非交互场景）；非交互环境无 --yes 拒绝写盘。
 *   4) 与审计同规则豁免：文件头前 3 行含 dsh-skip-sensitive / dsh-skip-residue
 *      整文件跳过；行尾含 dsh-skip-sensitive 本行跳过（故意示例/数据行）。
 *
 * 用法：
 *   node scripts/scrub-user-wording.mjs <路径...>                  # dry-run 报告（默认）
 *   node scripts/scrub-user-wording.mjs <路径...> --apply           # 逐条预览确认后写盘
 *   node scripts/scrub-user-wording.mjs <路径...> --apply --yes     # 非交互强制全改（.bak 备份）
 *   node scripts/scrub-user-wording.mjs --repo <git仓库路径>        # 只处理未提交 diff 涉及的文件
 *   node scripts/scrub-user-wording.mjs --repo <仓库> --apply --yes
 *
 * 退出码：0=无命中或已处理；2=dry-run 有命中；3=非交互环境拒绝写盘。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

/* ── v1.42.0 从 dsh-git-push 旧 lib/audit.js 原样搬来的措辞改写规则表 ────────────
 * 只处理「用户沟通措辞」，保留日期与功能语义；改写后即为中性技术描述。
 * 顺序敏感（先特例后通配，见注释分组）。 */
const WORDING_REWRITES = [
  // 1) 括注「用户原话」→ 删除括注，后续冒号保留
  { re: /（用户原话）/g, fn: () => '' },
  { re: /\(用户原话\)/g, fn: () => '' },
  // 2) 日期 + 措辞（原话/约定/加回）→ 只留日期
  { re: /(\d{4}-\d{2}-\d{2}) 用户要求（/g, fn: (m, d) => `${d}（` },
  { re: /(\d{4}-\d{2}-\d{2}) 用户要求加回/g, fn: (m, d) => `${d} 加回` },
  { re: /(\d{4}-\d{2}-\d{2}) 用户要求：/g, fn: (m, d) => `${d}：` },
  { re: /(\d{4}-\d{2}-\d{2}) 用户要求/g, fn: (m, d) => `${d}` },
  { re: /(\d{4}-\d{2}-\d{2}) 用户原话：/g, fn: (m, d) => `${d}：` },
  { re: /(\d{4}-\d{2}-\d{2}) 用户约定：/g, fn: (m, d) => `${d}：` },
  // 3) 措辞 + 「内容」 → 「内容」（引号内容保留）
  { re: /用户原话[：:]?「/g, fn: () => '「' },
  { re: /用户原话「/g, fn: () => '「' },
  // 4) （用户要求…） → （…
  { re: /（用户要求[：:]?/g, fn: () => '（' },
  { re: /\(用户要求[：:]?/g, fn: () => '(' },
  // 5) 「用户要求恢复此形态」→ 删除（恢复标记）
  { re: /用户要求恢复此形态/g, fn: () => '' },
  // 6) 孤立措辞（要求/原话/约定/规定/明确/拍板/说/：）→ 删除
  { re: /用户要求[：:]?/g, fn: () => '' },
  { re: /用户原话[：:]?/g, fn: () => '' },
  { re: /用户约定[：:]?/g, fn: () => '' },
  { re: /用户规定[：:]?/g, fn: () => '' },
  { re: /用户明确[：:]?/g, fn: () => '' },
  { re: /用户拍板[：:]?/g, fn: () => '' },
  { re: /用户说[：:]?/g, fn: () => '' },
  { re: /用户：/g, fn: () => '' },
];

/** 对单段文本应用全部改写规则，返回 { text, count }。 */
function scrubText(text) {
  let c = text;
  let count = 0;
  for (const { re, fn } of WORDING_REWRITES) {
    c = c.replace(re, (...a) => { count++; return fn(...a); });
  }
  return { text: c, count };
}

/* ── 词法分段：只把「注释段」交给 scrub，字符串字面量一律跳过 ────────────── */

/** 代码文件注释语法选择（按扩展名）。 */
function commentSyntax(ext) {
  const slash = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'java', 'kt', 'swift', 'go', 'rs', 'php', 'css'];
  const hash = ['py', 'sh', 'bash', 'rb', 'yaml', 'yml', 'conf', 'ini', 'toml', 'pl', 'lua'];
  const html = ['html', 'htm', 'vue'];
  return {
    slash: slash.includes(ext),
    hash: hash.includes(ext),
    html: html.includes(ext),
  };
}

/**
 * 代码文件：返回注释段区间 [{start,end}]（含注释标记）。
 * 逐字符扫描：先认字符串字面量（' " `，处理 \ 转义），字符串内的 // # /* 不识别；
 * 再认注释（// 行注释、块注释、<!-- -->、# 行注释须在行首/前导空白后）。
 */
function codeCommentRanges(text, syn) {
  const n = text.length;
  const ranges = [];
  let i = 0;
  while (i < n) {
    const ch = text[i];
    // 字符串字面量：整体跳过
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      let j = i + 1;
      while (j < n) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === q) { j++; break; }
        j++;
      }
      i = j;
      continue;
    }
    // 行注释 //
    if (syn.slash && text.startsWith('//', i)) {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      ranges.push({ start: i, end: j });
      i = j;
      continue;
    }
    // 块注释与 HTML 注释
    if (syn.slash && text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const j = end < 0 ? n : end + 2;
      ranges.push({ start: i, end: j });
      i = j;
      continue;
    }
    if (syn.html && text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      const j = end < 0 ? n : end + 3;
      ranges.push({ start: i, end: j });
      i = j;
      continue;
    }
    // # 行注释：须在行首或前导空白后
    if (syn.hash && ch === '#' && (i === 0 || /[\s]/.test(text[i - 1]))) {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      ranges.push({ start: i, end: j });
      i = j;
      continue;
    }
    i++;
  }
  return ranges;
}

/** md/txt：返回围栏代码块行区间（跳过不 scrub）。支持 ``` 与 ~~~；未闭合按到文件尾。 */
function markupFenceLines(text) {
  const lines = text.split('\n');
  const fenceLines = new Set();
  let fence = null;
  let start = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const m = lines[idx].match(/^[ \t]*(```+|~~~+)/);
    if (m) {
      if (fence === null) { fence = m[1][0]; start = idx; }
      else if (m[1][0] === fence) {
        for (let k = start; k <= idx; k++) fenceLines.add(k);
        fence = null;
      }
    }
  }
  if (fence !== null) for (let k = start; k < lines.length; k++) fenceLines.add(k);
  return fenceLines;
}

/** 文件头豁免：前 3 行含 dsh-skip-sensitive / dsh-skip-residue → 整文件跳过。 */
function fileHeaderExempt(text) {
  const head = text.split('\n').slice(0, 3).join('\n');
  return /dsh-skip-(?:sensitive|residue)/i.test(head);
}

/** 行尾豁免：本行含 dsh-skip-sensitive → 本行跳过（故意示例/数据）。 */
function lineExempt(line) {
  return /dsh-skip-sensitive/i.test(line);
}

const MARKUP_EXTS = ['md', 'markdown', 'txt'];
const SKIP_DIRS = new Set(['.git', '.trash', 'node_modules', '.npm', '.pnpm-store']);
const SKIP_FILES_RE = /\.(bak\d*|orig)$/i;

/**
 * 处理单个文件：返回
 *   { path, isMd, original, candidates: [{ n, before, after, start?, end? }], count }
 * 或 null（跳过/无命中）。candidates 中 code 文件带原文件坐标 start/end（段级），
 * md 文件只有行号 n（行级）；before/after 仅用于预览。
 */
function processFile(filePath) {
  let text;
  try { text = readFileSync(filePath, 'utf8'); } catch { return null; }
  if (fileHeaderExempt(text)) return null;
  const ext = extname(filePath).slice(1).toLowerCase();
  const candidates = [];

  if (MARKUP_EXTS.includes(ext)) {
    const fenceLines = markupFenceLines(text);
    const lines = text.split('\n');
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (fenceLines.has(idx) || lineExempt(line)) continue;
      const r = scrubText(line);
      if (r.count > 0 && r.text !== line) {
        candidates.push({ n: idx + 1, before: line, after: r.text });
      }
    }
    if (candidates.length === 0) return null;
    return { path: filePath, isMd: true, original: text, candidates, count: candidates.length };
  }

  const syn = commentSyntax(ext);
  if (!syn.slash && !syn.hash && !syn.html) return null; // 未知类型不处理
  const ranges = codeCommentRanges(text, syn);
  if (ranges.length === 0) return null;
  for (const { start, end } of ranges) {
    const seg = text.slice(start, end);
    // 行尾豁免：该注释段所在行若含 dsh-skip-sensitive 则跳过本段
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = text.indexOf('\n', end);
    const wholeLine = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    if (lineExempt(wholeLine)) continue;
    const r = scrubText(seg);
    if (r.count > 0) {
      candidates.push({
        n: text.slice(0, start).split('\n').length,
        before: seg,
        after: r.text,
        start,
        end,
      });
    }
  }
  if (candidates.length === 0) return null;
  return { path: filePath, isMd: false, original: text, candidates, count: candidates.length };
}

/** 按确认的候选下标集合重建文件文本（code 段级替换 / md 行级替换）。 */
function applyConfirmed(file, confirmedSet) {
  if (file.isMd) {
    const lines = file.original.split('\n');
    for (let i = 0; i < file.candidates.length; i++) {
      if (confirmedSet.has(i)) lines[file.candidates[i].n - 1] = file.candidates[i].after;
    }
    return lines.join('\n');
  }
  let out = file.original;
  const ordered = [...file.candidates].map((c, i) => ({ ...c, idx: i })).filter((c) => confirmedSet.has(c.idx));
  // 从后往前替换，避免坐标漂移
  for (const c of ordered.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, c.start) + c.after + out.slice(c.end);
  }
  return out;
}

/** 递归收集可处理文件列表。 */
function collectFiles(root, out = []) {
  let st;
  try { st = statSync(root); } catch { return out; }
  if (st.isFile()) {
    if (!SKIP_FILES_RE.test(basename(root))) out.push(root);
    return out;
  }
  for (const name of readdirSync(root)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES_RE.test(name)) continue;
    collectFiles(join(root, name), out);
  }
  return out;
}

/** --repo 模式：取未提交 diff 涉及的文件（含未跟踪文件）。 */
function repoDiffFiles(repoPath) {
  const r1 = spawnSync('git', ['-C', repoPath, 'diff', '--name-only', '--diff-filter=ACMRT'], { encoding: 'utf8' });
  const r2 = spawnSync('git', ['-C', repoPath, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  const set = new Set();
  if (r1.status === 0) for (const f of r1.stdout.split('\n')) if (f.trim()) set.add(f.trim());
  if (r2.status === 0) for (const f of r2.stdout.split('\n')) if (f.trim()) set.add(f.trim());
  return [...set];
}

async function main(argv) {
  const args = argv.slice(2);
  const apply = args.includes('--apply');
  const yes = args.includes('--yes');
  const paths = args.filter((a) => a !== '--apply' && a !== '--yes');
  if (paths.length === 0) {
    console.error('用法: node scripts/scrub-user-wording.mjs <路径...|--repo <仓库>> [--apply [--yes]]');
    process.exit(1);
  }

  let files = [];
  if (paths[0] === '--repo' && paths[1]) {
    const repo = paths[1];
    const rels = repoDiffFiles(repo);
    files = rels.map((f) => join(repo, f));
  } else {
    for (const p of paths) files = files.concat(collectFiles(p));
  }

  const report = [];
  for (const f of files) {
    const r = processFile(f);
    if (r) report.push(r);
  }

  if (report.length === 0) {
    console.log('无命中：所有文件均无沟通措辞（或已豁免/已清理）。');
    process.exit(0);
  }

  const totalCount = report.reduce((n, r) => n + r.count, 0);
  for (const r of report) {
    console.log(`\n${r.path}（${r.count} 处）`);
    for (const h of r.candidates.slice(0, 8)) {
      console.log(`  行${h.n}: ${(h.before || '').trim().slice(0, 90)}`);
      console.log(`        → ${(h.after || '').trim().slice(0, 90)}`);
    }
    if (r.candidates.length > 8) console.log(`  …另有 ${r.candidates.length - 8} 处`);
  }
  console.log(`\n共 ${report.length} 文件、${totalCount} 处措辞命中。`);

  if (!apply) {
    console.log('（dry-run 未改任何文件；加 --apply 进入逐条确认，--apply --yes 强制全改）');
    process.exit(2);
  }

  // ── 先预览再删改：逐条确认后才写盘 ──
  if (!yes && !process.stdin.isTTY) {
    console.error('非交互环境（stdin 非 TTY）：--apply 需要逐条确认，已拒绝写盘。');
    console.error('请用 --apply --yes 强制全改，或先不加 --apply 跑 dry-run 预览。');
    process.exit(3);
  }

  let written = 0;
  let writtenCount = 0;
  if (yes) {
    for (const r of report) {
      const all = new Set(r.candidates.map((_, i) => i));
      const text = applyConfirmed(r, all);
      writeFileSync(r.path + '.bak', readFileSync(r.path)); // 备份原文件
      writeFileSync(r.path, text);
      written++;
      writtenCount += r.count;
    }
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((res) => rl.question(q, res));
    let allRemaining = false; // a=本文件及之后所有候选一律确认，跨文件生效
    let quitAll = false; // q=退出确认，后续文件一律不写
    for (const r of report) {
      const confirmed = [];
      for (let idx = 0; idx < r.candidates.length; idx++) {
        const h = r.candidates[idx];
        if (allRemaining) { confirmed.push(idx); continue; }
        const risk = r.isMd ? '（md 文档：措辞可能是来源署名/名词用法，注意人工复核）' : '';
        console.log(`\n${r.path}:${h.n}${risk}`);
        console.log(`  - ${(h.before || '').trim().slice(0, 110)}`);
        console.log(`  + ${(h.after || '').trim().slice(0, 110)}`);
        const raw = await ask('改这条? [y改/n跳过/a改余下/q退出, 默认y] ');
        const ans = (raw == null ? 'q' : String(raw)).trim().toLowerCase(); // EOF 视为退出
        if (ans === 'n') continue;
        if (ans === 'a') { allRemaining = true; confirmed.push(idx); continue; }
        if (ans === 'q') { quitAll = true; break; }
        confirmed.push(idx);
      }
      if (quitAll) break;
      if (confirmed.length > 0) {
        const text = applyConfirmed(r, new Set(confirmed));
        writeFileSync(r.path + '.bak', readFileSync(r.path)); // 备份原文件
        writeFileSync(r.path, text);
        written++;
        writtenCount += confirmed.length;
      }
    }
    rl.close();
  }
  console.log(`已改写 ${written} 个文件、${writtenCount} 处（原文件备份为 *.bak，可还原）。`);
  process.exit(0);
}

main(process.argv);
