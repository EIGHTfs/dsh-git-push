/**
 * dsh-git-push — 全仓 AI 对话残留注释扫描（附属能力，D5，v1.43.0）
 *
 * 设计（用户确立）：
 *   - 分数制：命中黑名单关键词加分，命中白名单保护词减分，总分 ≥ 阈值记「警告」（warning 级，不拦截）
 *   - 只读不删：纯扫描报告，代码零改动；提交门禁侧同样只产出 warning 提示
 *   - 输出：所有命中位置列成 markdown 表格（文件/行号/分数/命中/文本），按分数降序
 *   - 规则可配：黑/白名单与阈值来自规则包 fullScan 段（lib/rule-packs.js 编译注入），无则用内置缺省
 *
 * 与 comment-wording 门禁的分工：comment-wording = 提交门禁的策展正则（blocker）；
 * 本模块 = 离线全仓清洗报告 + 提交时新增行注释的温和提醒（warning）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

/** 内置缺省（规则包 fullScan 段缺省时的兜底；与 eightfs.rules.json 保持一致） */
export const FULLSCAN_DEFAULTS = {
  threshold: 60,
  keywords: [
    { name: '用户指示词', pattern: '用户指示|用户原话|用户反馈|根据用户|客户要求|用户说|原话|指示|拍板', score: 40 },
    { name: '英文请求词', pattern: '\\brequest\\b|\\brequire user\\b|\\bas user said\\b', score: 40, flags: 'i' },
  ],
  protectWords: [
    { name: '技术词', pattern: 'ID|密码|登录|状态|验证|权限|token|session', score: 30, flags: 'i' },
  ],
  // 次级信号分（黑/白名单之外的辅助证据）
  signals: { number: 20, quote: 20, context: 20, short: 10 },
};

/** 目录跳过清单（全仓扫描不入） */
export const FULLSCAN_DIR_SKIP = /^(node_modules|\.git|\.svn|dist|build|out|coverage|__pycache__|snapshots|vendor|\.dsh|\.tmp-build|\.next)$/;
/** 参与扫描的文本扩展名 */
export const FULLSCAN_TEXT_EXTS = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'py', 'sh', 'yml', 'yaml', 'json', 'md', 'txt', 'html', 'css']);
const C_LIKE = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'css']);
const HASH_LIKE = new Set(['py', 'sh', 'yml', 'yaml']);
const HTML_LIKE = new Set(['html', 'vue', 'md']);

/**
 * 逐行提取注释（行锚定，修复原版脚本的最大误报源：字符串里的 // 与 URL）。
 * c-like：行首 //、/* 块（跨行，含续行 * 前缀）；hash-like：行首 #（跳过 shebang）；
 * html-like：<!-- --> 块。行尾注释（code // xxx）不取——误报高，报告场景宁可少报。
 * @returns {Array<{line:number, text:string, prevBlankOrComment:boolean, nextIsCode:boolean}>}
 */
export function extractComments(content, ext) {
  const out = [];
  const lines = String(content ?? '').split('\n');
  const isC = C_LIKE.has(ext), isHash = HASH_LIKE.has(ext), isHtml = HTML_LIKE.has(ext);
  if (!isC && !isHash && !isHtml) return out;
  let inBlock = false; // c-like /* 或 html <!-- 块中
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const at = (k) => (lines[k] ? lines[k].trim() : '');
    const prevBlankOrComment = i === 0 || !at(i - 1) || /^\s*(\/\/|#|\*|\/\*|<!--)/.test(lines[i - 1]);
    const nextIsCode = i + 1 < lines.length && !!at(i + 1) && !/^\s*(\/\/|#|\*|\/\*|<!--)/.test(lines[i + 1]);
    if (isC) {
      if (inBlock) {
        const end = t.indexOf('*/');
        // v1.45.0：收尾行（'*/' 或 '* /' 纯闭合）只闭合块，不产出空壳/垃圾文本
        if (!/^\*?\s*\*\/\s*$/.test(t)) {
          const text = t.replace(/^\*+\s?/, '').replace(/\*\/\s*$/, '').trim();
          if (text) out.push({ line: i + 1, text, prevBlankOrComment, nextIsCode });
        }
        if (end >= 0) inBlock = false;
        continue;
      }
      if (t.startsWith('/*')) {
        const body = t.slice(2).replace(/\*\/\s*$/, '').trim();
        if (body) out.push({ line: i + 1, text: body, prevBlankOrComment, nextIsCode });
        if (!t.includes('*/') || t.indexOf('*/') < 2) inBlock = true;
        continue;
      }
      if (t.startsWith('//')) {
        out.push({ line: i + 1, text: t.slice(2).trim(), prevBlankOrComment, nextIsCode });
        continue;
      }
    } else if (isHash) {
      if (t.startsWith('#') && !t.startsWith('#!')) {
        out.push({ line: i + 1, text: t.slice(1).trim(), prevBlankOrComment, nextIsCode });
        continue;
      }
    }
    if (isHtml) {
      if (inBlock) {
        const end = t.indexOf('-->');
        out.push({ line: i + 1, text: t.replace(/-->\s*$/, '').trim(), prevBlankOrComment, nextIsCode });
        if (end >= 0) inBlock = false;
        continue;
      }
      if (t.startsWith('<!--')) {
        const body = t.slice(4).replace(/-->\s*$/, '').trim();
        if (body) out.push({ line: i + 1, text: body, prevBlankOrComment, nextIsCode });
        if (!t.includes('-->')) inBlock = true;
        continue;
      }
    }
  }
  return out.filter((c) => c.text);
}

/**
 * 单条注释评分：黑名单命中加分（可叠加多条），白名单命中减分，次级信号补证据。
 * @param {{text:string, prevBlankOrComment?:boolean, nextIsCode?:boolean}} item
 * @param {object} fs 编译后的 fullScan 段 { threshold, keywords:[{name,re,score}], protectWords:[{name,re,score}], signals }
 * @returns {{score:number, hits:string[], protects:string[]}}
 */
export function scoreComment(item, fs) {
  const s = fs?.signals || FULLSCAN_DEFAULTS.signals;
  let score = 0;
  const hits = [];
  const protects = [];
  const text = String(item?.text ?? '');
  for (const k of fs?.keywords || []) {
    try { if (k.re.test(text)) { score += k.score; hits.push(k.name); } } catch { /* 非法正则跳过（编译期已降级） */ }
  }
  for (const p of fs?.protectWords || []) {
    try { if (p.re.test(text)) { score -= p.score; protects.push(p.name); } } catch { /* 同上 */ }
  }
  // 次级信号：两位以上数字（排除版本号/日期上下文）、中文引号、上下文、短注释
  if (/\b\d{2,}\b/.test(text) && !/\d+\.\d+/.test(text) && !/(20\d{2}|19\d{2})[-/.年]/.test(text)) score += s.number;
  if (/[“”『』「」]/.test(text)) score += s.quote; // 只认中文引号，半角引号不加分（修复原版误报）
  if (item?.prevBlankOrComment) score += Math.round(s.context / 2);
  if (item?.nextIsCode) score += Math.round(s.context / 2);
  if (text.length > 0 && text.length < 50) score += s.short;
  return { score: Math.max(0, score), hits, protects };
}

/** 递归收集文本文件（相对路径；跳过 FULLSCAN_DIR_SKIP 目录与超 1MB 文件）。
 *  v1.60.0：默认排除 git 忽略的文件（git check-ignore 批量判定，尊重 .gitignore 全部语法含 negation；
 *  非 git 目录自动跳过该逻辑——没有 .gitignore 就全量收集）。 */
export function listTextFiles(repoPath, root = repoPath, gitIgnored = null) {
  const out = [];
  let entries;
  try { entries = readdirSync(repoPath, { withFileTypes: true }); } catch { return out; }
  // v1.60.0：git 忽略集合只算一次（根层探测，子层递归透传），避免每层重复 spawn git
  if (gitIgnored === null) gitIgnored = tryLoadGitIgnoreSet(repoPath);
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.dsh') continue;
    if (e.isDirectory()) {
      if (FULLSCAN_DIR_SKIP.test(e.name)) continue;
      out.push(...listTextFiles(join(repoPath, e.name), root, gitIgnored));
    } else if (e.isFile()) {
      const ext = e.name.split('.').pop()?.toLowerCase() || '';
      if (!FULLSCAN_TEXT_EXTS.has(ext)) continue;
      const p = join(repoPath, e.name);
      const rel = relative(root, p).split(sep).join('/');
      if (gitIgnored && gitIgnored.has(rel)) continue;
      try { if (statSync(p).size > 1024 * 1024) continue; } catch { continue; }
      out.push({ path: rel, ext, full: p });
    }
  }
  return out;
}

/** v1.60.0：收集 git 忽略文件相对路径集合（git check-ignore --stdin 批量；非 git 目录返回 null 表示不启用）。
 *  按 repoPath 缓存（Map）：git 目录存忽略集合，非 git 目录存 null——避免跨目录误共享、递归重复 spawn。 */
const gitIgnoreCache = new Map();
function tryLoadGitIgnoreSet(repoPath) {
  const key = repoPath;
  if (gitIgnoreCache.has(key)) return gitIgnoreCache.get(key);
  let result = null;
  try {
    const probe = spawnSync('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (probe.status !== 0 || probe.stdout.trim() !== 'true') { gitIgnoreCache.set(key, null); return null; }
    // 收集当前目录全部文件路径喂给 check-ignore（只做相对路径判定，不开新进程）
    const all = [];
    const walk = (dir) => {
      let es;
      try { es = readdirSync(join(repoPath, dir), { withFileTypes: true }); } catch { return; }
      for (const en of es) {
        if (en.isDirectory()) {
          if (FULLSCAN_DIR_SKIP.test(en.name)) continue;
          walk(join(dir, en.name));
        } else {
          all.push(relative(repoPath, join(repoPath, dir, en.name)).split(sep).join('/'));
        }
      }
    };
    walk('');
    if (!all.length) {
      result = new Set();
    } else {
      const r = spawnSync('git', ['-C', repoPath, 'check-ignore', '--stdin'], { input: all.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      // 不带 --non-matching：stdout 只包含「被忽略的文件路径」；status 0=有忽略 1=无忽略
      result = new Set((r.stdout || '').split('\n').filter(Boolean));
    }
  } catch {
    result = null;
  }
  gitIgnoreCache.set(key, result);
  return result;
}

/** markdown 表格行截断 */
function brief(text, n = 60) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * 全仓扫描：所有命中黑名单的注释位置 → 表格报告（分数降序；score ≥ threshold 标⚠警告）。
 * 纯只读——不修改任何文件。
 * @param {string} repoPath 仓库绝对路径
 * @param {object} [opts] { fullScan?: 编译后的 fullScan 段（缺省内置 FULLSCAN_DEFAULTS 编译）, files?: 限定文件清单 }
 * @returns {{ok:true, repo, threshold, scanned:number, totalComments:number, hits:Array, warnCount:number, table:string}}
 */
export function fullScanRepo(repoPath, opts = {}) {
  const fs = opts.fullScan || compileFullScan(FULLSCAN_DEFAULTS);
  const files = opts.files || listTextFiles(repoPath);
  const hits = [];
  let totalComments = 0;
  for (const f of files) {
    let content = '';
    try { content = readFileSync(f.full, 'utf8'); } catch { continue; }
    const comments = extractComments(content, f.ext);
    totalComments += comments.length;
    for (const c of comments) {
      const { score, hits: ks, protects } = scoreComment(c, fs);
      if (ks.length === 0) continue; // 只列黑名单命中位置
      hits.push({ file: f.path, line: c.line, score, hits: ks, protects, warn: score >= fs.threshold, text: brief(c.text) });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const warnCount = hits.filter((h) => h.warn).length;
  const rows = hits.map((h) => `| ${h.warn ? '⚠' : ''} ${h.score} | ${h.file}:${h.line} | ${h.hits.join('、')} | ${h.protects.join('、') || '—'} | ${h.text.replace(/\|/g, '\\|')} |`);
  const table = [
    `全仓 AI 对话残留注释扫描（${repoPath}）——只读报告，代码未改动`,
    `阈值 ${fs.threshold}：≥ 阈值为⚠警告（${warnCount}/${hits.length}）；全部命中位置如下，按分数降序`,
    '',
    '| 分数 | 位置 | 黑名单命中 | 白名单减分 | 注释内容 |',
    '|---|---|---|---|---|',
    ...(rows.length ? rows : ['| — | （无命中） | — | — | — |']),
  ].join('\n');
  return { ok: true, repo: repoPath, threshold: fs.threshold, scanned: files.length, totalComments, hits, warnCount, table };
}

/** 内置缺省 → 编译形态（规则包未配 fullScan 时的兜底） */
export function compileFullScan(def = FULLSCAN_DEFAULTS) {
  const safe = (arr, dfltScore) => (Array.isArray(arr) ? arr : []).map((k) => {
    let re = /(?!)/; // 永不匹配兜底
    try { re = new RegExp(k.pattern, k.flags || ''); } catch { /* 编译失败降级 */ }
    return { name: String(k.name || '(unnamed)'), re, score: Number(k.score) > 0 ? Number(k.score) : dfltScore };
  });
  return {
    threshold: Number(def.threshold) > 0 ? Number(def.threshold) : 60,
    keywords: safe(def.keywords, 40),
    protectWords: safe(def.protectWords, 30),
    signals: { ...FULLSCAN_DEFAULTS.signals, ...(def.signals || {}) },
  };
}
