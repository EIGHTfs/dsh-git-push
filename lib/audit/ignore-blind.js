/**
 * 审计「静默失明」检测（2026-09-18）。
 *
 * 为什么需要：审计的文件收集走 `git check-ignore`，而该判定会采信
 *   `.git/info/exclude`——这是 git 的**本地私有排除**层，不随仓库分发，却
 *   优先级等同于 .gitignore。实测一个被写成单行 `*` 的 `.git/info/exclude`
 *   能让整仓文件被判定为「已忽略」：审计只收集到 5 个文件（其余 21 个全跳过），
 *   而**不报错、不告警、退出码正常**——调用方看到的是「这个仓库很干净」。
 *
 *   这比误报危险得多：误报会被人发现并纠正，静默失明不会。且该文件属于本机
 *   配置，CI/他人机器上不存在——同一份代码在不同机器上审计结论不同。
 *
 * 判据（两者取或，均可独立触发）：
 *   ① 静态：`.git/info/exclude` 含「全仓通配」条目（`*` / `/*` / `**` / `**​/*`）
 *   ② 行为：git 跟踪的文件里，被判定为忽略的比例 ≥ 90% 且数量 ≥ 20
 *      （正常仓库的 info/exclude 只排除少量本地产物；接近全量说明配置异常）
 *
 * 只报 warning 不阻断：仓库可能真的有意排除本机文件，交由人确认。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';

/** 判定为「全仓通配」的模式（这些会让整仓不可见）。 */
const BROAD_PATTERNS = new Set(['*', '/*', '**', '**/*', '.']);

/**
 * 取仓库的 `.git/info/exclude` 绝对路径（兼容 .git 为文件的工作树/submodule）。
 * @param {string} root 仓库根
 * @returns {string} 路径（可能不存在）
 */
function excludePathOf(root) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--git-dir'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  });
  if (r.status !== 0) return '';
  let gitDir = String(r.stdout || '').trim();
  if (!gitDir) return '';
  if (!isAbsolute(gitDir)) gitDir = join(root, gitDir);
  return join(gitDir, 'info', 'exclude');
}

/**
 * 检测审计是否可能因本地 git 排除配置而静默失明。
 * @param {string} root 仓库根目录
 * @returns {{broad: string[], ignoreRatio: number, tracked: number}|null} null = 非 git 或无异常
 */
export function detectIgnoreBlindSpot(root) {
  const probe = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  });
  if (probe.status !== 0 || String(probe.stdout || '').trim() !== 'true') return null;

  // ① 静态判据：info/exclude 里的全仓通配
  const broad = [];
  try {
    const p = excludePathOf(root);
    if (p && existsSync(p)) {
      for (const raw of readFileSync(p, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        if (BROAD_PATTERNS.has(line)) broad.push(line);
      }
    }
  } catch { /* 读不到则跳过静态判据，行为判据仍生效 */ }

  // ② 行为判据：被忽略的跟踪文件占比
  let tracked = 0;
  let ignored = 0;
  try {
    const ls = spawnSync('git', ['-C', root, 'ls-files'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
    });
    if (ls.status === 0) {
      const files = String(ls.stdout || '').split('\n').filter(Boolean);
      tracked = files.length;
      if (tracked) {
        // 必须带 --no-index：对**已跟踪**文件，check-ignore 默认不报（它们按定义不被忽略），
        //   而我们要问的正是「这些文件在审计收集时会不会被跳过」。实测不带该参数时
        //   被 `*` 污染的仓库仍返回 0 条，行为判据形同失效。
        const ci = spawnSync('git', ['-C', root, 'check-ignore', '--stdin', '--no-index'], {
          input: files.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20_000,
        });
        if (ci.status === 0 || ci.status === 1) {
          ignored = String(ci.stdout || '').split('\n').filter(Boolean).length;
        }
      }
    }
  } catch { /* 判据不可用则按未命中处理 */ }

  const ignoreRatio = tracked ? ignored / tracked : 0;
  const ratioHit = tracked >= 20 && ignoreRatio >= 0.9;
  if (!broad.length && !ratioHit) return null;
  return { broad, ignoreRatio, tracked };
}
