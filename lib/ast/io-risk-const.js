/**
 * dsh-git-push — I/O 风险分级：常量与档位工具
 *
 * 职责：定义「哪些调用算 I/O」「算什么操作类别」「风险如何升档」三类纯数据，
 *   以及依赖它们的档位工具函数（raise）。不含任何 token 分析逻辑。
 *
 * 分层：lib/ast/io-risk.js 的从属模块（由该文件再导出），调用方不应直接 import。
 */
/** 同步 fs 调用名（带 Sync 后缀）→ 统一视为阻塞调用。 */
export const SYNC_FS_FNS = new Set([
  'readFileSync', 'writeFileSync', 'appendFileSync', 'existsSync', 'statSync', 'lstatSync',
  'readdirSync', 'mkdirSync', 'rmdirSync', 'rmSync', 'unlinkSync', 'renameSync',
  'copyFileSync', 'chmodSync', 'chownSync', 'openSync', 'closeSync', 'readSync',
  'writeSync', 'truncateSync', 'realpathSync', 'symlinkSync', 'linkSync', 'accessSync',
]);

/** 异步 fs 调用名（无 Sync 后缀的常见形态）。 */
export const ASYNC_FS_FNS = new Set([
  'readFile', 'writeFile', 'appendFile', 'stat', 'lstat', 'readdir', 'mkdir', 'rmdir',
  'rm', 'unlink', 'rename', 'copyFile', 'chmod', 'chown', 'open', 'close', 'read',
  'write', 'truncate', 'realpath', 'symlink', 'link', 'access', 'createReadStream',
  'createWriteStream', 'watch', 'opendir',
]);

/** 操作类别：写 / 删 / 改名 涉及数据安全，风险加权。 */
export const KIND_BY_FN = {
  writeFileSync: 'write', writeFile: 'write', appendFileSync: 'write', appendFile: 'write',
  createWriteStream: 'write', writeSync: 'write', write: 'write', truncateSync: 'write',
  truncate: 'write',
  unlinkSync: 'delete', unlink: 'delete', rmSync: 'delete', rm: 'delete',
  rmdirSync: 'delete', rmdir: 'delete',
  renameSync: 'rename', rename: 'rename', copyFileSync: 'rename', copyFile: 'rename',
};

/**
 * 元数据/查询/幂等目录操作（2026-09-23，io-risk 优化——对照诊断「97% 误报」）：
 *   单文件 stat/exists/readdir/access 微秒级、mkdir(recursive)/rmdir 幂等——不搬运数据内容，
 *   请求路径上不构成阻塞风险 → 降为 low（不再按「请求路径 I/O」一律 medium）。
 *   循环内的仍走循环分级（循环内逐次 stat 累积由循环规则判定，不受本档豁免）。
 */
export const META_FS_FNS = new Set([
  'existsSync', 'statSync', 'lstatSync', 'readdirSync', 'accessSync', 'realpathSync',
  'exists', 'stat', 'lstat', 'readdir', 'access', 'realpath',
  'mkdirSync', 'rmdirSync', 'mkdir', 'rmdir',
]);

/** 循环体识别：for/while/do 关键字与数组迭代方法。 */
export const LOOP_KEYWORDS = new Set(['for', 'while', 'do']);
export const LOOP_METHODS = new Set([
  'forEach', 'map', 'filter', 'reduce', 'reduceRight', 'flatMap', 'some', 'every',
  'find', 'findIndex', 'findLast', 'findLastIndex',
]);

/** 请求处理路径特征（在函数体内出现任一即认定）。 */
export const REQUEST_PATTERNS = [
  /\b(?:req|request)\.(?:headers|method|url|body|on)\b/,
  /\bres\.(?:writeHead|write|end|setHeader|statusCode)\b/,
  /\b(?:handle|route|onRequest)[A-Za-z_$]*\s*\(/,
  /\bcreateServer\s*\(\s*(?:async\s*)?\(?\s*(?:req|request)\s*,/,
  /\(\s*(?:req|request)\s*,\s*(?:res|response)\s*\)/,
];

/** 风险档位（数值越大越高）。 */
export const LEVELS = ['safe', 'low', 'medium', 'high'];

/** 徽标。 */
export const RISK_BADGE = { high: '🔴', medium: '🟠', low: '🟡', safe: '🟢' };

/** 风险中文名。 */
export const RISK_LABEL = { high: '高', medium: '中', low: '低', safe: '安全' };

/**
 * 是否循环头：for/while/do 关键字，或 `.forEach(` / `.map(` 等方法调用。
 *
 * 方法形态**必须**校验前导 `.`：`LOOP_METHODS` 里的名字（map/find/filter/some/…）
 *   同样是极其常见的普通变量名/参数名。早先只做 `LOOP_METHODS.has(value)`
 *   而不看前一个 token，导致 `JSON.stringify(map, null, 2)` 里的参数 `map`、
 *   `const map = new Map()` 里的 `map` 都被当成循环头 —— 实测全仓 1109 个「循环头」
 *   里有 44 个是这种裸标识符（4.0%），既凭空造出循环范围（把无关行的 I/O
 *   误标成「循环内」），也让真正的循环范围互相干扰。
 *
 * @param {object} t 当前 token
 * @param {object} [prev] 前一个 token；方法调用形态须满足 `prev.value === '.'`
 * @returns {boolean}
 */
export function isLoopHead(t, prev) {
  if (LOOP_KEYWORDS.has(t.value)) return true;
  return LOOP_METHODS.has(t.value) && prev?.value === '.';
}

/** 档位提升 n 级（用于写/删加权）。 */
export function raise(level, n = 1) {
  const i = LEVELS.indexOf(level);
  return LEVELS[Math.min(LEVELS.length - 1, i + n)];
}
