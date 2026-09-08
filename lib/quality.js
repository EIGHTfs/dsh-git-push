/**
 * dsh-git-push — 代码质量审计（v1.39.0）
 *
 * 依据 docs/code-quality-checklist.yaml（优秀代码通用评估标准，AI 可解析版）：
 *   6 个 criteria（可读性/可维护性/健壮性/性能/安全性/测试覆盖）+ 3 附加维度 + 10 问 checklist
 *   + dimensions_weight 权重评分 + A/B/C/D 等级（summary.level_definition）。
 *
 * 本模块把 yaml 里**可在 L0 静态扫描落地的规则**做成纯函数（不依赖 ctx，可独立单测）：
 *   - 可读性：单函数体行数（>50 warning，>100 blocker）
 *   - 健壮性：静默吞错（空 catch / 仅注释 catch / catch(_){}）
 *   - 性能  ：async 路径中的 fs.*Sync 同步阻塞调用
 *   - 测试覆盖：仓库有源码变更但无测试文件
 * 其余维度（安全性/可维护性/可观测性/可部署性/文档）已有独立规则或需人工/LLM 判断，
 * 不在本模块重复；评分按 checklist.yaml dimensions_weight 计算，供 code_audit 附质量结论。
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** 质量规则开关（可经 auditRepo opts.quality=false 关闭） */
export const QUALITY_DEFAULTS = {
  enabled: true,
  funcLinesWarn: 50,   // 单函数行数 warning 阈值（yaml：单函数 ≤50 硬上限）
  funcLinesBlock: 100, // 单函数行数 blocker 阈值（极端大函数）
  silentCatchWarn: 3,  // 静默 catch 数量 warning 阈值
  syncInAsyncWarn: 1,  // async 中 fs.*Sync 数量 warning 阈值
  // v1.42.0（文件级评分 scoreFile）：行数/容量基准与扣分斜率、单维度扣分上限
  fileLinesBase: 200,  // 文件行数基准（超过按斜率扣分）
  fileLinesRate: 0.05, // 每超 1 行扣分
  fileLinesCap: 40,    // 行数扣分上限
  fileKbBase: 30,      // 文件容量基准（KB，超过按斜率扣分）
  fileKbRate: 0.2,     // 每超 1KB 扣分
  fileKbCap: 30,       // 容量扣分上限
};

/** 内置默认评分权重（yaml scoring.dimensions_weight 降级兜底） */
const DEFAULT_WEIGHTS = {
  可读性: 15,
  可维护性: 15,
  健壮性: 15,
  性能: 10,
  安全性: 20,
  测试覆盖: 10,
  可观测性: 5,
  可部署性: 5,
  文档: 3,
  开发者体验: 2,
};

/**
 * 解析 code-quality-checklist.yaml。
 * 不做完整 YAML 解析（无第三方依赖），用缩进 + 键值对提取需要的字段：
 *   scoring.dimensions_weight、summary.level_definition。
 * 解析失败返回内置默认（不影响审计主流程）。
 * @returns {{ weights: object, levels: object }}
 */
export function loadQualityYaml(yamlPath = '') {
  const fallback = { weights: DEFAULT_WEIGHTS, levels: {} };
  if (!yamlPath) return fallback;
  let text = '';
  try {
    text = readFileSync(yamlPath, 'utf8');
  } catch {
    return fallback;
  }
  const weights = { ...DEFAULT_WEIGHTS };
  const levels = {};
  let inWeight = false;
  let inLevel = false;
  let inLevelDef = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd(); // 去行注释
    if (!line.trim()) continue;
    if (/dimensions_weight\s*:/.test(line)) { inWeight = true; inLevel = false; inLevelDef = false; continue; }
    if (/level_definition\s*:/.test(line)) { inLevelDef = true; inWeight = false; inLevel = false; continue; }
    if (inWeight) {
      const m = /^(\S[^:]*?):\s*(\d+)\s*$/.exec(line.trim());
      if (m) weights[m[1].trim()] = Number(m[2]);
    }
    if (inLevelDef) {
      const m = /^([A-D])\s*:\s*["']?(.+?)["']?\s*$/.exec(line.trim());
      if (m) levels[m[1]] = m[2];
    }
  }
  return { weights, levels };
}

/** 依据仓库定位 checklist.yaml（dsh-git-push 仓 docs/ 下；找不到用默认权重） */
export function locateQualityYaml(pluginRoot = '') {
  if (!pluginRoot) return '';
  for (const p of [join(pluginRoot, 'docs', 'code-quality-checklist.yaml'), join(dirname(pluginRoot), 'dsh-git-push', 'docs', 'code-quality-checklist.yaml')]) {
    try { if (existsSync(p)) return p; } catch { /* 继续 */ }
  }
  return '';
}

/**
 * 可读性：检测文本里的函数体行数。
 * 匹配 function 关键字 / 箭头函数 / 类方法，粗算到下一个同缩进/右括号的平衡区间。
 * 精确到「函数体行数」是启发式的：用花括号平衡在函数定义处向后数行。
 * @param {string} text 文件全文
 * @returns {Array<{line:number, len:number}>} 超阈值函数
 */
export function checkFunctionLength(text, { warn = 50, block = 100 } = {}) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  const lines = text.split('\n');
  const fnStart = /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|(?:^|\s)(?:export\s+)?(?:async\s+)?\([^)]*\)\s*=>|(?:^|\s)(?:async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!fnStart.test(line)) continue;
    // 找函数体起点（本行内 { 或下一行 {）
    let depth = 0;
    let start = -1;
    for (let j = i; j < Math.min(i + 4, lines.length); j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth++; if (start === -1) start = j; }
        else if (ch === '}') depth--;
      }
      if (depth > 0) { if (start === -1) start = j; break; }
      if (start !== -1 && depth === 0) break;
    }
    if (start === -1) continue;
    // 从 start 数到花括号闭合
    let d = 0;
    let end = start;
    let foundOpen = false;
    for (let j = start; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') { d++; foundOpen = true; }
        else if (ch === '}') d--;
      }
      if (foundOpen && d <= 0) { end = j; break; }
    }
    const len = end - start + 1;
    if (len > warn) {
      out.push({ line: i + 1, len, level: len > block ? 'blocker' : 'warning' });
    }
    i = end; // 跳过已统计区间
  }
  return out;
}

/**
 * 健壮性：检测静默吞错——catch 块为空 / 仅注释。
 * 覆盖形态：catch(_){} / catch(e){} / catch{} / catch(e) { 仅注释 }
 * （catch 行与闭合 } 在同两行内；多行有实质语句的 catch 不误报）。
 * @returns {Array<{line:number}>}
 */
export function checkSilentCatch(text) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  const lines = text.split('\n');
  // 匹配任意 catch 起始（含可选参数、可选左花括号在同一行）
  const catchStartRe = /\bcatch\s*(?:\([^)]*\))?\s*\{?/;
  // 判断某行是否只剩注释（去除引号字符串/注释后为空）
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/['"`][^'"`]*['"`]/g, '').trim();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!catchStartRe.test(line)) continue;
    // 取 catch 行 + 下一行（单行形态或两行形态）
    const scope = (lines[i + 1] !== undefined ? line + ' ' + lines[i + 1] : line).replace(/\s+/g, ' ');
    // 提取 catch 之后、闭合 } 之前的内容
    const m = /catch\s*(?:\([^)]*\))?\s*\{?\s*([\s\S]*?)\}\s*$/.exec(scope);
    if (!m) continue;
    const body = m[1];
    if (!body) { out.push({ line: i + 1 }); continue; } // catch (_) {} / catch {} / catch (e) {}
    // 有内容但只剩注释（去注释后为空）
    if (stripComments(body) === '') { out.push({ line: i + 1 }); continue; }
    // 有实质语句 → 不报
  }
  return out;
}

/**
 * 性能：async 函数/await 路径里的 fs.*Sync 同步阻塞调用。
 * @returns {Array<{line:number, call:string}>}
 */
export function checkSyncInAsync(text) {
  const out = [];
  if (typeof text !== 'string' || !text) return out;
  const lines = text.split('\n');
  const asyncRe = /\basync\b|\bawait\b/;
  const syncRe = /\bfs\.(?:readFileSync|readdirSync|writeFileSync|existsSync|statSync|mkdirSync|rmSync|unlinkSync|readlinkSync)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!syncRe.test(line)) continue;
    // 本行或向上 8 行内出现 async/await → 判定为 async 路径
    let inAsync = false;
    for (let j = Math.max(0, i - 8); j <= i; j++) {
      if (asyncRe.test(lines[j])) { inAsync = true; break; }
    }
    if (inAsync) {
      const m = syncRe.exec(line);
      out.push({ line: i + 1, call: m ? m[0].replace('fs.', '') : 'fs.*Sync' });
    }
  }
  return out;
}

/**
 * 测试覆盖：仓库是否有测试文件（test* 目录 / *.test.* / *.spec.*）。
 * @param {string} repoPath 仓库根
 * @returns {boolean} 有测试文件
 */
export function hasTestFiles(repoPath) {
  if (!repoPath) return false;
  try {
    const entries = readdirSync(repoPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && /^(test|tests|__tests__|spec)$/.test(e.name)) return true;
      if (e.isFile() && /\.(test|spec)\.(js|mjs|cjs|ts|tsx|jsx)$/.test(e.name)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * v1.42.0：文件级自动评分（行数/容量两维，A/B/C/D 等级与既有审计同门槛）。
 * 阈值可由规则包 quality 字段覆盖（见 QUALITY_DEFAULTS file* 键）。
 * @param {string} content 文件全文（utf8）
 * @param {object} [opts] { fileLinesBase, fileLinesRate, fileLinesCap, fileKbBase, fileKbRate, fileKbCap }
 * @returns {{score:number, deductions:string[], lines:number, kb:number, grade:'A'|'B'|'C'|'D'}}
 */
export function scoreFile(content, opts = {}) {
  const o = { ...QUALITY_DEFAULTS, ...opts };
  const text = String(content ?? '');
  const lines = text === '' ? 0 : text.split('\n').length;
  const kb = Buffer.byteLength(text, 'utf8') / 1024;
  let score = 100;
  const deductions = [];
  if (lines > o.fileLinesBase) {
    const penalty = Math.min((lines - o.fileLinesBase) * o.fileLinesRate, o.fileLinesCap);
    score -= penalty;
    deductions.push(`行数 ${lines} 行（基准${o.fileLinesBase}行），扣 ${penalty.toFixed(1)} 分`);
  }
  if (kb > o.fileKbBase) {
    const penalty = Math.min((kb - o.fileKbBase) * o.fileKbRate, o.fileKbCap);
    score -= penalty;
    deductions.push(`大小 ${kb.toFixed(1)}KB（基准${o.fileKbBase}KB），扣 ${penalty.toFixed(1)} 分`);
  }
  score = Math.max(0, Math.round(score));
  return { score, deductions, lines, kb: Math.round(kb * 10) / 10, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D' };
}

/**
 * 汇总质量评分：按 checklist.yaml dimensions_weight 权重。
 * 本模块只给「能在静态扫描落地的维度」打分（其余维度记为不扣分的中间值），
 * 得到 0-100 分与 A/B/C/D 等级。
 * @param {object} counts { readability: number, robustness: number, performance: number, testing: boolean }
 * @param {object} opts { weights, levels }
 */
export function scoreQuality(counts = {}, opts = {}) {
  const weights = opts.weights || DEFAULT_WEIGHTS;
  const levels = opts.levels || {};
  // 各维度 0-10 分：问题越多越低
  const dims = {};
  const clamp = (v) => Math.max(0, Math.min(10, v));
  // 可读性：每 1 个大函数 -2 分
  dims['可读性'] = clamp(10 - (counts.readability || 0) * 2);
  // 可维护性：静态难判，给中间值 8（若有大函数/重复则降）
  dims['可维护性'] = clamp(8 - (counts.readability || 0) * 1);
  // 健壮性：每 1 个静默 catch -1.5 分
  dims['健壮性'] = clamp(10 - (counts.robustness || 0) * 1.5);
  // 性能：每 1 个 sync-in-async -2 分
  dims['性能'] = clamp(10 - (counts.performance || 0) * 2);
  // 安全性：无静态新发现时给 9（有 secret/凭据由现有规则拦截，此处不重复扣）
  dims['安全性'] = 9;
  // 测试覆盖：有测试 10 分；无测试 3 分（核心逻辑变更无测试）
  dims['测试覆盖'] = counts.testing ? 10 : 3;
  // 附加维度：静态难判，给中间值
  dims['可观测性'] = 7;
  dims['可部署性'] = 7;
  dims['文档'] = 7;
  dims['开发者体验'] = 7;
  // 加权总分
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 100;
  let score = 0;
  for (const [dim, w] of Object.entries(weights)) {
    const d = dims[dim];
    if (d === undefined) continue;
    score += (d / 10) * w;
  }
  score = Math.round((score / totalWeight) * 100);
  const level = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 40 ? 'C' : 'D';
  return {
    score,
    level,
    levelDesc: levels[level] || (level === 'A' ? '功能完整，逻辑正确，用户体验良好' : level === 'B' ? '代码可读，有基本模块划分，少量技术债' : level === 'C' ? '可读性差，重复代码多，安全/性能隐患，零测试' : '无法启动或核心功能不可用'),
    dimensions: dims,
  };
}
