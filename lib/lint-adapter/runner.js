/**
 * 外部 linter 委托层 · 调用 + 适配
 *
 * 职责：跑被审项目自带的官方 linter（当前 ruff），把其 JSON 输出适配成统一 finding 结构。
 *
 * 两条硬约束（用户 2026-11-06 确立）：
 *   ① **只进评分与报告，绝不进拦截门禁**——所有外部 finding 的 severity 一律封顶 `warning`
 *     （isBlockerFinding 认 blocker/error 才拦，见 lib/audit/finding.js）。即 ruff 判 error 的规则
 *     （如语法错误 E9xx）在这里也只算警告，「别人的规则集」不裁决本仓库能否提交。
 *   ② **探不到/跑不动/超时/输出坏 ⇒ 一律降级返回空**，交回自研规则，绝不抛错中断审计（D5）。
 *
 * 去重：外部 finding 带 `source: 'linter:ruff'`，rule id 带 `ruff/` 前缀——与自研规则 id 天然不同名，
 *   同一处即便两侧都命中也是「两个来源各记一次」（口径与 ext-runner 一致），由评分层每文件每维度去重兜底。
 * noqa：ruff 自身遵守项目里的 `# noqa` / per-file-ignores（被抑制的项不输出），故本层不重复实现豁免。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** 单次委托的超时（毫秒）。ruff 是 Rust 实现，全仓扫描通常秒级；给足冗余但设上限防挂死。 */
const LINTER_TIMEOUT_MS = 60000;
/** stdout 上限（大仓库 JSON 可达数十 MB）。超限报错→降级，不误当「无问题」。 */
const LINTER_MAX_BUFFER = 64 * 1024 * 1024;

/** ruff 规则码前缀 → 本引擎维度（取最贴近的一项；未知前缀兜底可维护性）。 */
const RUFF_DIM_BY_PREFIX = [
  [/^E\d/, ['可读性']],           // pycodestyle Error：行宽/空白等格式
  [/^W\d/, ['可读性']],           // pycodestyle Warning
  [/^F\d/, ['健壮性', '可维护性']], // Pyflakes：未定义名/未用导入（真缺陷）
  [/^I\d/, ['可读性']],           // isort：导入排序
  [/^UP\d/, ['可维护性']],         // pyupgrade：过时写法
  [/^B\d/, ['健壮性']],           // bugbear：常见 bug 模式
  [/^C4/, ['性能']],              // comprehension 优化
  [/^SIM/, ['可维护性']],          // simplify
  [/^S\d/, ['安全性']],            // bandit 安全
  [/^RUF/, ['可维护性']],          // ruff 自有
];
function ruffDims(code) {
  const c = String(code || '');
  for (const [re, dims] of RUFF_DIM_BY_PREFIX) if (re.test(c)) return dims;
  return ['可维护性'];
}

/**
 * 把一条 ruff JSON 命中转成 finding（severity 恒为 warning——只报告不拦截）。
 * @returns {object|null} 结构不完整返回 null（丢弃该条，不影响其余）
 */
export function ruffItemToFinding(item, repoRoot) {
  if (!item || typeof item !== 'object') return null;
  const file = relFile(String(item.filename || ''), repoRoot);
  if (!file) return null;
  const code = item.code || 'ruff';
  const line = Number(item?.location?.row) || 1;
  return {
    file,
    line,
    rule: `ruff/${code}`,
    kind: 'linter',
    severity: 'warning',          // 硬约束①：封顶 warning，永不 blocker/error
    message: `${item.message || 'ruff 告警'}（ruff ${code}）`,
    dimensions: ruffDims(code),
    source: 'linter:ruff',
    scoreImpact: 1,               // 计入评分维度（这是委托层的意义：反映真实代码质量）
  };
}

/** 绝对路径 → 相对仓库根（与自研 finding 的 file 口径一致，均为正斜杠相对路径）。 */
function relFile(abs, repoRoot) {
  const norm = String(abs).replace(/\\/g, '/');
  const root = String(repoRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (root && norm.startsWith(`${root}/`)) return norm.slice(root.length + 1);
  // 相对路径（部分 linter/配置下输出相对）原样返回——压成 basename 会丢目录、与自研口径不一致
  const isAbsolute = norm.startsWith('/') || /^[A-Za-z]:\//.test(norm);
  if (!isAbsolute) return norm;
  // 绝对路径且在 root 之外：取文件名兜底，不把他人机器/其它挂载的绝对路径写进报告
  return norm.split('/').pop();
}

/** 解析 ruff JSON（数组或含 message 的对象）；非法返回 null。 */
function parseRuffJson(stdout) {
  const txt = String(stdout || '').trim();
  if (!txt) return [];
  try {
    const data = JSON.parse(txt);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * 对一个 linter 委托执行：调用 → 解析 → 适配。任何失败一律降级为 { findings: [], note }。
 * @param {{key:string, bin:string}} linter detect.js 的产出
 * @param {string} repoRoot 仓库根（作 cwd 与 target，ruff 从 cwd 读项目配置）
 * @returns {Promise<{findings: Array, note: string}>}
 */
export async function runLinter(linter, repoRoot) {
  if (linter.key !== 'ruff') return { findings: [], note: `未适配的 linter：${linter.key}` };
  let stdout = '';
  try {
    // --no-fix：委托层绝不改动被审文件（只读判定）。target=仓库根，ruff 递归并按项目配置过滤。
    const res = await execFileAsync(
      linter.bin,
      ['check', '--output-format', 'json', '--no-fix', '.'],
      { cwd: repoRoot, timeout: LINTER_TIMEOUT_MS, maxBuffer: LINTER_MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    stdout = res.stdout;
  } catch (e) {
    // ruff 退出码语义（实测其官方约定）：0=无问题、1=有 lint 问题（stdout 仍是合法 JSON）、
    //   ≥2=真错误（配置非法/崩溃）。execFile 在非零码时抛，只有 **code===1 且有 stdout** 才是可用产出；
    //   其余一律降级——否则「ruff 崩了、stdout 为空」会被当成「外部权威源判定无问题」，
    //   这是假阴性（危险且最隐蔽的一种失败）。
    if (e && e.code === 1 && e.stdout) {
      stdout = e.stdout;
    } else {
      const why = e?.killed
        ? `超时(${Math.round(LINTER_TIMEOUT_MS / 1000)}s)`
        : e?.code === 'ENOENT'
          ? '可执行缺失'
          : `退出码 ${e?.code ?? '?'}（ruff 真错误/崩溃）`;
      return { findings: [], note: `ruff 委托降级跳过（${why}），已回退自研规则` };
    }
  }
  const arr = parseRuffJson(stdout);
  if (arr === null) return { findings: [], note: 'ruff 输出非合法 JSON，降级跳过' };
  const out = [];
  for (const item of arr) {
    const f = ruffItemToFinding(item, repoRoot);
    if (f) out.push(f);
  }
  return { findings: out, note: `ruff 委托产出 ${out.length} 条（仅评分/报告，不拦截）` };
}
