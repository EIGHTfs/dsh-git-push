/**
 * dsh-git-push 审计总入口：文件收集（gitignore 感知）
 *
 * 修 P0 教训：git 忽略文件默认排除（listTextFiles 支持 git check-ignore）。
 * - gitIgnoreRoot 为 git 仓库：git check-ignore --stdin 批量判定（Map 缓存）
 * - 非 git 目录：全量收集不报错
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { isTestExemptDir } from '../exempt/index.js';
import { SKIP_DIRS as HARDCODED_SKIP, getSkipSet } from '../skip-dirs.js';
import { parseGitignore, isIgnoredByRules } from './gitignore-match.js';

/** 跳过目录集合 = 硬编码基线(node_modules/.git) ∪ yml 黑名单关键词（加载一次缓存）。 */
const SKIP_DIRS = getSkipSet();

const TEXT_EXT = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'yml', 'yaml', 'md', 'txt', 'html', 'css',
  'sh', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'xml', 'toml', 'ini', 'cfg',
  'conf', 'env', 'gitignore', 'npmrc', 'properties', 'sql', 'vue', 'svelte',
]);
/** git 探活 / 忽略清单批量判定 / 单目录判定 的超时（毫秒）。 */
const GIT_PROBE_TIMEOUT_MS = 10_000;
const IGNORE_BATCH_TIMEOUT_MS = 60_000;
const IGNORE_SINGLE_TIMEOUT_MS = 5_000;
/** 单文件大小上限：超过 1MB 的文件跳过（防止读入大文件拖死扫描进程）。 */
const MAX_FILE_SIZE = 1024 * 1024;

/** git 忽略文件集合缓存（按 repo 根缓存：git 目录存忽略集，非 git 目录存 null）。 */
const ignoreCache = new Map();
/** git 工作树探活缓存（与 ignoreCache 分开：后者存忽略集，可为 null）。 */
const gitProbeCache = new Map();

/**
 * 该目录是否 git 工作树（带缓存，避免与 tryLoadGitIgnoreSet 重复 spawn）。
 *
 * 为什么要单独探活：`collectTextFiles` 的文件级豁免需要区分「git 仓库」与「非 git 兜底」，
 *   而 `gitIgnoreRoot` 在两者下都非空（非 git 但有 .auditignore 时也传 root）。
 * 探活结果按目录缓存；失败（git 不可用）按非 git 处理，即走兜底——兜底总是可用的。
 * @param {string} dir
 * @returns {boolean}
 */
function isGitWorkTree(dir) {
  if (gitProbeCache.has(dir)) return gitProbeCache.get(dir);
  let ok = false;
  try {
    const r = spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_PROBE_TIMEOUT_MS,
    });
    ok = r.status === 0 && String(r.stdout || '').trim() === 'true';
  } catch { ok = false; }
  gitProbeCache.set(dir, ok);
  return ok;
}

/**
 * 非 git 目录下用纯 JS 匹配 `.auditignore`，产出与 git 路径同构的「被忽略目录集」。
 *
 * 为什么要预计算目录集而非逐文件判定：`collectTextFiles` 的 walk 阶段用该集合做
 *   **目录级剪枝**（命中即整棵跳过），与 git 路径保持同一调用契约；逐文件判定会退化成
 *   全量遍历后再过滤，在大目录上明显更慢。
 *
 * 返回的 Set 同时含「被忽略的目录」与其下**任意层级的后代目录**吗？不含——下游
 *   walk 是逐目录判定的，父目录命中即整棵跳过，因此只需把命中的目录本身放进集合。
 * 但 `collectTextFiles` 的文件级兜底会再逐文件判定一次（见该函数），两处互补。
 *
 * @param {string} root 扫描根目录（非 git）
 * @returns {Set<string>|null} 被忽略的目录相对路径集合；无 .auditignore 时返回 null
 */
function tryLoadAuditIgnoreFallback(root) {
  const auditIgnorePath = join(root, '.auditignore');
  if (!existsSync(auditIgnorePath)) return null;
  let rules;
  try {
    rules = parseGitignore(readFileSync(auditIgnorePath, 'utf8'));
  } catch {
    return null;
  }
  if (!rules.length) return null;
  const ignored = new Set();
  const walkDirs = (dir) => {
    let entries;
    try { entries = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const en of entries) {
      if (!en.isDirectory()) continue;
      // 与 git 路径一致：枚举阶段只用硬编码基线跳过（yml 黑名单在此跳过会让白名单恢复失效）
      if (HARDCODED_SKIP.has(en.name)) continue;
      const rel = (dir ? `${dir}/${en.name}` : en.name);
      if (isIgnoredByRules(rules, rel, true)) { ignored.add(rel); continue; } // 命中即整棵剪枝
      walkDirs(rel);
    }
  };
  walkDirs('');
  return ignored;
}

/**
 * 收集 git 忽略文件相对路径集合（git check-ignore --stdin 批量判定）。
 * 修复 1.0.4 缺陷：原实现以空 stdin 调用 check-ignore，从未传入文件路径 → 忽略集恒空 → gitignore 感知失效
 * （被忽略文件全被扫入，大仓库性能爆炸 + 私密文件误入）。按 full-scan 语义正确实现：
 *   1) git rev-parse 探活（非 git 目录返回 null = 不启用忽略判定）
 *   2) 递归收集全部文件相对路径，一次性喂给 check-ignore --stdin（尊重 .gitignore 全部语法含 negation）
 *   3) 输出 = 被忽略的路径集合；按 repo 根缓存，避免递归重复 spawn
 * @param {string} root git 仓库根目录
 * @returns {Set<string>|null} 被忽略路径集合；非 git 目录/失败返回 null
 */
function tryLoadGitIgnoreSet(root) {
  if (ignoreCache.has(root)) return ignoreCache.get(root);
  let ignoreSet = null;
  try {
    const probe = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_PROBE_TIMEOUT_MS,
    });
    if (probe.status !== 0 || String(probe.stdout || '').trim() !== 'true') {
      // 2026-09-18：非 git 目录的 `.auditignore` 兜底。原先此处直接返回 null，
      //   导致 `.auditignore` 仅在 git 仓库生效——同一个 `*.sh` 规则在 git init 前后行为相反，
      //   解压的源码包/临时导出目录/未 init 的工程里该文件形同不存在（实测确认）。
      //   改为用纯 JS 匹配器（lib/audit/gitignore-match.js）解析 `.auditignore`，
      //   按**目录**预计算忽略集，与 git 路径返回同构的 Set，下游无感知。
      const fallback = tryLoadAuditIgnoreFallback(root);
      ignoreCache.set(root, fallback);
      return fallback;
    }
    // 2026-09-16：`.auditignore` 审计豁免文件（复用 .gitignore 解析方式）——根目录存在该文件时，
    //   把它作为 git core.excludesFile 追加进 check-ignore 判定（与 .gitignore 叠加生效；
    //   实测 .gitignore 的 node_modules/ 与 .auditignore 的 generated/ 同时被忽略）。
    //   语法 = gitignore 语法（目录规则 generated/ 整棵豁免、`*.lock` 文件豁免、`!` 白名单恢复）。
    const auditIgnorePath = join(root, '.auditignore');
    const hasAuditIgnore = existsSync(auditIgnorePath);
    const ignoreExtraArgs = hasAuditIgnore ? ['-c', `core.excludesFile=${auditIgnorePath}`] : [];
    // 2026-09-16 修复（大仓库忽略失效）：原实现枚举**全部文件**路径喂 check-ignore——大仓
    //   （如 DeepSeekHarness-NAS 9.9 万个文件）输入过大导致 spawnSync 超时被 SIGTERM，status=null
    //   时仍用**残缺的 stdout** 构造忽略集合 → 忽略集不完整 → 被 .gitignore 忽略的 src/ 等
    //   整棵子树漏进审计（用户看到「全量扫描有 /src」）。
    //   改为：① 只枚举**目录**（数量少一个量级）② 逐个目录用 check-ignore -q 判定
    //   ③ 命中即整棵跳过；文件级再兜一次判定，保证「子文件夹也忽略」。
    const ignoredDirs = new Set();
    const allDirs = [];
    const walkDirs = (dir) => {
      let es;
      try { es = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return; }
      for (const en of es) {
        if (!en.isDirectory()) continue;
        // 枚举忽略集时只用**硬编码基线**（node_modules/.git）：yml 黑名单（build 等）不能在此跳过——
        //   否则 build/keep（白名单恢复）与 build/drop（真黑名单）都不会被枚举，gitignore 判定全错。
        if (HARDCODED_SKIP.has(en.name)) continue;
        const rel = join(dir, en.name).split(sep).join('/');
        allDirs.push(rel);
        walkDirs(join(dir, en.name));
      }
    };
    walkDirs('');
    // 批量判定：一次 check-ignore --stdin 喂**目录**路径（目录数比文件数少一个量级，不会超时）；
    //   目录规则（/src/）与「父目录被忽略」两种情形都能命中，命中即整棵子树跳过。
    if (allDirs.length) {
      const r = spawnSync('git', ['-C', root, ...ignoreExtraArgs, 'check-ignore', '--stdin', '--no-index'], {
        input: allDirs.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: IGNORE_BATCH_TIMEOUT_MS,
      });
      // status 为 null（超时/被杀）时**不采信残缺输出**：保守视为无忽略信息，避免「漏忽略」
      if (r.status === 0 || r.status === 1) {
        for (const line of String(r.stdout || '').split('\n')) {
          const t = line.trim().replace(/\/+$/, '');
          if (t) ignoredDirs.add(t);
        }
      } else {
        // 兜底：批量失败则逐个目录判定（只在异常路径触发，保证正确性优先）
        for (const dirRel of allDirs) {
          const probeResult = spawnSync('git', ['-C', root, ...ignoreExtraArgs, 'check-ignore', '-q', '--', dirRel], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: IGNORE_SINGLE_TIMEOUT_MS,
          });
          if (probeResult.status === 0) ignoredDirs.add(dirRel);
        }
      }
    }
    ignoreSet = ignoredDirs;
  } catch {
    ignoreSet = null;
  }
  ignoreCache.set(root, ignoreSet);
  return ignoreSet;
}

/**
 * 递归收集文本文件。
 * @param {string} dir 扫描目录
 * @param {object} opts { depth, gitIgnoreRoot, includeIgnored }
 * @returns {Array<{path, ext, full}>}
 */
export async function collectTextFiles(dir, { depth = 10, gitIgnoreRoot = null, includeIgnored = false, testExemptRoot = null } = {}) {
  const out = [];
  await walk(dir, 0);
  // 2026-09-16：`.auditignore` **文件级**豁免（目录级已在 walk 剪枝）——收集完成后把
  //   已收集的文件路径批量喂 check-ignore（带 core.excludesFile 追加 .auditignore），
  //   命中 `src/vendor.js` / `*.lock` 等文件级规则即剔除（收集到的文本文件数少，一次 spawn 可接受）。
  //   目录规则（generated/）已由 tryLoadGitIgnoreSet 的目录集整棵跳过，此处只补文件级。
  if (!includeIgnored && gitIgnoreRoot && existsSync(join(gitIgnoreRoot, '.auditignore')) && out.length) {
    const auditIgnorePath = join(gitIgnoreRoot, '.auditignore');
    const relOf = (full) => relative(gitIgnoreRoot, full).replace(/\\/g, '/');
    if (isGitWorkTree(gitIgnoreRoot)) {
      // git 路径：批量喂 check-ignore（一次 spawn 判完，最省进程）
      try {
        const rels = out.map((f) => relOf(f.full));
        const r = spawnSync(
          'git', ['-C', gitIgnoreRoot, '-c', `core.excludesFile=${auditIgnorePath}`, 'check-ignore', '--stdin', '--no-index'],
          { input: rels.join('\n'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: IGNORE_BATCH_TIMEOUT_MS },
        );
        if (r.status === 0 || r.status === 1) {
          const ignored = new Set(String(r.stdout || '').split('\n').filter(Boolean));
          for (let i = out.length - 1; i >= 0; i -= 1) if (ignored.has(relOf(out[i].full))) out.splice(i, 1);
        }
      } catch { /* 判定失败保留原结果 */ }
    } else {
      // 非 git 兜底（2026-09-18）：原先此路径不存在，`.auditignore` 非 git 下形同不存在。
      //   用纯 JS 匹配器逐文件剔除；文件已读入内存，逐个正则判定代价可接受。
      try {
        const rules = parseGitignore(readFileSync(auditIgnorePath, 'utf8'));
        if (rules.length) {
          for (let i = out.length - 1; i >= 0; i -= 1) {
            if (isIgnoredByRules(rules, relOf(out[i].full), false)) out.splice(i, 1);
          }
        }
      } catch { /* 判定失败保留原结果 */ }
    }
  }
  return out;

  // 递归遍历改异步：大仓库上逐目录 readdirSync + 逐项 statSync 会阻塞事件循环
  async function walk(cur, level) {
    if (level > depth) return;
    // .test 空文件豁免（1.0.5）：整目录扫描跳过（含子目录），专为测试 fixture 目录设计
    if (testExemptRoot && cur !== testExemptRoot && isTestExemptDir(testExemptRoot, relative(testExemptRoot, cur))) return;
    let entries;
    try { entries = await readdir(cur); } catch { return; }
    for (const name of entries) {
      const full = join(cur, name);
      let st;
      try { st = await stat(full); } catch { continue; }
      if (st.isDirectory()) {
        // 2026-09-16「黑名单初筛 + 白名单补充」：
        //   1) 硬编码基线（node_modules/.git）**绝对跳过**——机器依赖/内部元数据目录，
        //      不受 gitignore 白名单影响（npm 包树里 node_modules 恒不该进审计）。
        //   2) yml 黑名单关键词（build/dist 等）候选跳过；若 gitignore 判定该目录**未忽略**
        //      （被 ! 白名单恢复，如 server/project/* + !blueprint/、/build/* + !/build/keep/），
        //      则保留进入——黑名单不能压过 gitignore 白名单。
        if (HARDCODED_SKIP.has(name)) continue;
        const inYmlBlacklist = SKIP_DIRS.has(name);
        let ignoredByGit = false;
        if (!includeIgnored && gitIgnoreRoot) {
          const relDir = relative(gitIgnoreRoot, full).replace(/\\/g, '/');
          const igSet = tryLoadGitIgnoreSet(gitIgnoreRoot);
          ignoredByGit = !!(igSet && igSet.has(relDir));
        }
        if (inYmlBlacklist) {
          // yml 黑名单命中：git 仓库里未被 gitignore 忽略（白名单恢复）→ 保留；否则跳过
          if (gitIgnoreRoot && !ignoredByGit) { await walk(full, level + 1); continue; }
          continue;
        }
        // 非黑名单目录：被 gitignore 忽略 → 整棵跳过（原逻辑）
        if (ignoredByGit) continue;
        await walk(full, level + 1);
        continue;
      }
      if (!st.isFile()) continue;
      // 1MB 上限：超大文件（会话归档/大 JSON/二进制伪装文本）跳过，防读入拖死进程
      if (st.size > MAX_FILE_SIZE) continue;
      const ext = extname(full).replace(/^\./, '');
      const isText = name.endsWith('.gitignore') || name.endsWith('.npmrc') || TEXT_EXT.has(ext);
      if (!isText) continue;
      // gitignore 感知（文件级兜底）：父目录若在忽略集内也应跳过（目录遍历已整棵跳过，
      //   此处兜住「直接以被忽略目录为扫描根」等边界）
      if (!includeIgnored && gitIgnoreRoot) {
        const rel = relative(gitIgnoreRoot, full).replace(/\\/g, '/');
        const set = tryLoadGitIgnoreSet(gitIgnoreRoot);
        if (set) {
          if (set.has(rel)) continue;
          const seg = rel.split('/');
          let hit = false;
          for (let i = seg.length - 1; i > 0; i -= 1) {
            if (set.has(seg.slice(0, i).join('/'))) { hit = true; break; }
          }
          if (hit) continue;
        }
      }
      out.push({ path: relative(dir, full).replace(/\\/g, '/'), ext, full });
    }
  }
}

/** 判断目录是否为 git 仓库（有 .git）。 */
export function isGitRepo(dir) {
  return existsSync(join(dir, '.git')) || existsSync(join(dir, '.git', 'HEAD'));
}

/**
 * 收集 git 仓库工作区变动文件（git status --porcelain）。
 * @param {string} repoPath git 仓库目录
 * @returns {Array<{rel, full, status}>|null} 非 git 仓库或 git 失败返回 null（调用方退化为 full）
 * status：A=新增 M=修改 D=删除 R=重命名 ??=未跟踪
 */
export function collectChangedFiles(repoPath) {
  if (!isGitRepo(repoPath)) return null;
  try {
    // 2026-09-16：显式捕获 stderr（execFileSync 未设 stdio 时异常会把 git stderr 直通父进程）
    const out = execFileSync('git', ['-C', repoPath, 'status', '--porcelain'], {
      encoding: 'utf8', timeout: GIT_PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const files = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const status = line.slice(0, 2).trim() || 'M';
      let rel = line.slice(3);
      // 引号包裹（含空格/非 ASCII）：取引号内内容（不处理 \ooo 转义，中文文件名原样）
      const quoted = rel.match(/^"((?:[^"\\]|\\.)*)"/);
      if (quoted) rel = quoted[1].replace(/\\([\\"])/g, '$1');
      else if (rel.includes(' -> ')) rel = rel.split(' -> ').pop(); // 重命名取新路径
      if (!rel) continue;
      // 未跟踪目录（?? dir/）：git status --porcelain 只显示目录本身，需展开为目录内文件，
      // 否则审计漏掉整目录（对齐 getDiff 用 git ls-files --others 展开的行为）。
      if (status === '??' && rel.endsWith('/')) {
        const inside = execFileSync('git', ['-C', repoPath, 'ls-files', '--others', '--exclude-standard', '--', rel], {
          encoding: 'utf8', timeout: GIT_PROBE_TIMEOUT_MS,
        });
        for (const p of inside.split('\n').filter(Boolean)) {
          files.push({ rel: p, full: join(repoPath, p), status });
        }
        continue;
      }
      files.push({ rel, full: join(repoPath, rel), status });
    }
    // 2026-09-14：.test 空文件目录豁免对 changed 审计同样生效——与全仓收集
    //   （collectTextFiles testExemptRoot）对齐：test fixture 目录（故意构造的坏样本）
    //   在 diff 审计里也应完全跳过，否则「改过 test 文件 → 整个文件进 changed 范围 →
    //   黑名单词样本/超长函数样本被扫出」误拦提交。
    return files.filter((f) => !isTestExemptDir(repoPath, f.rel));
  } catch {
    return null; // git 不可用 → 调用方退化为 full
  }
}

/** 判定是否为文本文件（TEXT_EXT 白名单 + 1MB 上限；png/jpg 等二进制扩展名 → false）。 */
export function isTextFile(full) {
  try {
    const st = statSync(full);
    if (st.size > MAX_FILE_SIZE) return false;
  } catch { return false; }
  const ext = extname(full).replace(/^\./, '');
  const base = full.split('/').pop() || '';
  // 2026-09-14 bugfix：点文件（.env/.env.local 等）extname 对它们取的是最后一段
  //   （.env.local → '.local'），触发 ext 白名单匹配错误；同时 .tmp-x.js 这类
  //   「点开头但带真实扩展名」的文件不能误伤（extname 已能取到 .js）。
  //   判定顺序：①extname 有合法扩展名且命中白名单 → true（.tmp-x.js / .foo.yaml）
  //   ②extname 为空或未命中 → 点文件取「去首点后第一段」（.env → env；.env.local → env）
  //   ③仍不中 → false。
  const extHit = TEXT_EXT.has(ext);
  const effExt = extHit
    ? ext
    : (base.startsWith('.') ? base.slice(1).split('.')[0] : '');
  return base.endsWith('.gitignore') || base.endsWith('.npmrc') || TEXT_EXT.has(effExt);
}

/** 读文件（UTF-8，失败返回 null）。 */
export function readText(full) {
  try { return readFileSync(full, 'utf8'); } catch { return null; }
}