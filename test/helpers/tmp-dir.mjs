/**
 * 测试用一次性目录/仓库 —— **自动清理**，不依赖调用方记得 try/finally。
 *
 * 【为什么单独成 helper】实测问题：测试里 `mkdtempSync(join(tmpdir(), 'x-'))` 建的目录，
 *   在「断言失败被 node:test 中断」「进程被 timeout/kill 掉」时 `finally` 不会执行 → /tmp 里越堆越多。
 *   本模块用两层兜底：
 *     ① 进程退出钩子（process.on('exit')）——断言失败、提前 return、正常结束都会清；
 *     ② 可选把 node:test 的用例上下文传进来（`{ t }`）→ 该用例一结束就清（更早释放）。
 *   进程被 SIGKILL 时任何钩子都救不了，所以另有 sweepStaleTempDirs() 在整轮测试开始时清扫陈旧目录。
 *
 * 【约定】所有一次性目录都放在 `$TMPDIR/dshgp-test-*` 下，便于统一清扫与排查来源（前缀写明是哪个测试）。
 */
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** 统一前缀根：清扫与排查都以它为准。 */
export const TEMP_ROOT_PREFIX = 'dshgp-test-';

const created = new Set();
let exitHookInstalled = false;

/** 安装进程退出兜底（只装一次）。 */
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const dir of created) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* 退出阶段失败不阻塞 */ }
    }
  });
}

/** 删除一个临时目录（幂等，失败不抛）。 */
export function removeTempDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  created.delete(dir);
}

/**
 * `mkdtempSync` 的**drop-in 替代**（同样的「前缀路径」签名）——建目录并登记自动清理。
 * 存量测试只要把 `mkdtempSync(` 换成 `mkdtempTracked(` 即可获得清理，不必改其它逻辑。
 *
 * 目录会**统一落在 `dshgp-test-` 前缀下**（标签取自调用方前缀，便于排查来源）：这样即使进程被
 * SIGKILL（兜底钩子也跑不了），sweepStaleTempDirs() 仍能按统一前缀把陈旧的清掉 —— 否则各测试
 * 前缀五花八门（audit-ext- / ctx- / repo- …），清扫器认不全。
 * @param {string} prefixPath 前缀路径（如 `join(tmpdir(), 'x-')`）
 * @returns {string} 目录绝对路径
 */
export function mkdtempTracked(prefixPath) {
  installExitHook();
  const label = basename(String(prefixPath || 'tmp')).replace(/[^\w.-]/g, '_') || 'tmp';
  const dir = mkdtempSync(join(tmpdir(), TEMP_ROOT_PREFIX + label));
  created.add(dir);
  return dir;
}

/**
 * 建一次性临时目录（自动清理）。
 * @param {string} label 用途标签（写进目录名，便于 /tmp 里认出是哪个测试留下的）
 * @param {{t?:object}} [opts] t：node:test 用例上下文（传了就额外在用例结束时清）
 * @returns {string} 目录绝对路径
 */
export function tempDir(label = 'tmp', { t = null } = {}) {
  installExitHook();
  const dir = mkdtempSync(join(tmpdir(), TEMP_ROOT_PREFIX + String(label).replace(/[^\w.-]/g, '_') + '-'));
  created.add(dir);
  if (t && typeof t.after === 'function') t.after(() => removeTempDir(dir));
  return dir;
}

/**
 * 建一次性临时 git 仓库（git init + 可选局部身份，自动清理）。
 * @param {string} label 用途标签
 * @param {{t?:object, name?:string, email?:string}} [opts] name/email：写入仓库局部 user 配置
 * @returns {string} 仓库目录绝对路径
 */
export function tempRepo(label = 'repo', { t = null, name = '', email = '' } = {}) {
  const dir = tempDir(label, { t });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (name) execFileSync('git', ['config', '--local', 'user.name', name], { cwd: dir });
  if (email) execFileSync('git', ['config', '--local', 'user.email', email], { cwd: dir });
  return dir;
}

/**
 * 清扫**陈旧的**一次性目录（默认 60 分钟前创建、名字以 dshgp-test- 开头的），
 * 用来收拾「进程被强杀、退出钩子没跑」留下的残留。整轮测试开始时调一次即可。
 * @param {{maxAgeMs?:number, log?:(m:string)=>void}} [opts]
 * @returns {string[]} 被清掉的目录
 */
export function sweepStaleTempDirs({ maxAgeMs = 60 * 60 * 1000, log = null } = {}) {
  // 两个根都扫：本机 os.tmpdir() 常被会话 TMPDIR 指到别处（实测 = <DSH_HOME>/tmp），
  //   而裸 shell 里跑测试时又是 /tmp —— 只扫一个必然漏掉另一半。
  const roots = [...new Set([tmpdir(), '/tmp'])];
  const now = Date.now();
  const removed = [];
  for (const root of roots) {
    let entries = [];
    try { entries = readdirSync(root); } catch { continue; }
    for (const name of entries) {
      if (!name.startsWith(TEMP_ROOT_PREFIX)) continue;
      const full = join(root, name);
      try {
        const st = statSync(full);
        if (!st.isDirectory()) continue;
        if (now - st.mtimeMs < maxAgeMs) continue; // 新目录可能正被其它测试用着，别动
        rmSync(full, { recursive: true, force: true });
        removed.push(full);
      } catch { /* 被并发删掉/权限问题：跳过 */ }
    }
  }
  if (removed.length && typeof log === 'function') log(`清扫陈旧测试临时目录 ${removed.length} 个`);
  return removed;
}
