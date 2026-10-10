// dsh-skip-i18n: 本文件为规则实现，输出文案硬编码中文为产品行为（无 i18n 需求）
/**
 * 检查层 · 硬编码绝对路径精筛（paths 槽位 / astConfirmKind: "hardcoded-abs-path"）
 *
 * 为什么需要精筛（正则做不到的两件事）：
 *   ① **可访问性判断**——同一个绝对路径在本机可能存在（说明是"这台机器的真实路径"，换机必失效）
 *      也可能不存在（别人机器/历史遗留写法），两者的处置不同，只有 fs 才能判断；
 *   ② **相对路径换算**——把绝对路径换算成相对该文件所在目录的路径（用户确认的基准），
 *      供修复时直接替换；这需要文件路径上下文。
 *
 * 与正则的分工（引擎既有形态）：规则的 patterns 只做**初筛**（跨系统字面量形状），
 *   本模块给出**允许报出的行号集合**（allow 语义）+ 行号→详情（供 finding message 用）。
 *
 * 唯一实现声明：本模块是"硬编码绝对路径"检测的**唯一实现**——脚本（scripts/scan-hardcoded-paths.mjs）
 *   必须调用它，不得自带第二份 PATTERNS（同一事实两份实现 ⇒ 必然分叉）。
 */
import { existsSync } from 'node:fs';
import { relative, dirname, isAbsolute, join } from 'node:path';

/** 跨系统硬编码绝对路径的识别（只取"像绝对路径"的形状，避免把相对路径/URL 误判）。 */
const PATH_RES = [
  // Linux / macOS：/volume1 /home /Users /var /usr /opt /tmp /mnt /srv /etc /root /Applications /Volumes
  /(?:^|["'`(\s=:])(\/(?:volume\d+|home|Users|var|usr|opt|tmp|mnt|srv|etc|root|Applications|Volumes)\/[^\s"'`)\]},;]*)/g,
  // Windows：C:\ 或 C:/
  /(?:^|["'`(\s=:])([A-Za-z]:[\\/][^\s"'`)\]},;]*)/g,
  // UNC：\\server\share\...
  /(?:^|["'`(\s=:])(\\\\[A-Za-z0-9_.-]+\\[^\s"'`)\]},;]*)/g,
  // file:///...
  /(file:\/\/\/[^\s"'`)\]},;]*)/g,
];

/**
 * 扫描文本里的硬编码绝对路径（引擎侧唯一实现）。
 * @param {string} text 文件全文
 * @param {string} filePath 文件路径（用于换算相对路径；缺省时不做换算）
 * @returns {Array<{line:number, raw:string, accessible:boolean, relative:string, os:string}>}
 */
export function hardcodedAbsPathHits(text, filePath = '', baseDir = '') {
  const hits = [];
  // 审计传进来的 file 可能是**相对审计根**的路径（如 src/sample.mjs）⇒ 必须用 repoPath 补成绝对路径，
  //   否则 relative('src', '/tmp/x') 会算出一串 ../../（实测踩到：message 里出现 ../../../../../../tmp/…）。
  const absFile = filePath ? (isAbsolute(filePath) ? filePath : join(String(baseDir || ''), filePath)) : '';
  const lines = String(text || '').split('\n');
  lines.forEach((line, i) => {
    PATH_RES.forEach((re, idx) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const raw = m[1];
        if (!raw) continue;
        const accessible = existsSync(raw);
        hits.push({
          line: i + 1,
          raw,
          accessible,
          // 可访问才换算：不可访问的路径（别人机器/已删除）无从确定基准，只提示不改写
          relative: accessible && absFile ? relative(dirname(absFile), raw).split('\\').join('/') : '',
          os: ['posix', 'windows', 'unc', 'file-url'][idx] || 'unknown',
        });
      }
    });
  });
  return hits;
}

/** astConfirmKind: "hardcoded-abs-path" 的集合取值——报出的行号（allow 语义：全部命中都报）。 */
export function hardcodedAbsPathLines(text, filePath = '', baseDir = '') {
  return new Set(hardcodedAbsPathHits(text, filePath, baseDir).map((h) => h.line));
}

/** astConfirmKind: "hardcoded-abs-path" 的行号→详情（供 finding message：可访问者附相对路径）。 */
export function hardcodedAbsPathDetail(text, filePath = '', baseDir = '') {
  const out = new Map();
  for (const h of hardcodedAbsPathHits(text, filePath, baseDir)) {
    const prev = out.get(h.line);
    // 同一行多个路径时优先展示"可访问"的那条（可操作：能直接换成相对路径）
    if (!prev || (!prev.accessible && h.accessible)) out.set(h.line, h);
  }
  return out;
}

/** 人类可读的一句话说明（可访问 ⇒ 附相对路径；不可访问 ⇒ 仅警告）。 */
export function describeHardcodedAbsPath(hit) {
  if (!hit) return '硬编码绝对路径';
  return hit.accessible && hit.relative
    ? `硬编码绝对路径 ${hit.raw}（本机可访问）⇒ 建议改为相对路径 ${hit.relative}`
    : `硬编码绝对路径 ${hit.raw}（本机不可访问）⇒ 仅警告，无法换算相对路径`;
}
