import { runChecks } from './checks.js';
import { exemptForFinding } from '../exempt/index.js';
import { hasExternalCallTimeout, hasMkdirInSameFunction } from './file-context.js';
import { CODE_EXTS } from './finding.js';

/**
 * 单文件审计：读文件 → 跑检查 → 豁免过滤（注册表驱动，7 标记全消费）。
 * 豁免判定：exemptForFinding 统一处理「文件头整文件 / 行内单点」两种位置语义；
 * 外加两类语义豁免：
 *   1) residue/style 检查只对代码文件生效（md/yml 文档里出现 debugger 字样是写作/定义，非残留）
 *   2) 规则定义文件（audit-rules-*.yml）自动豁免规则驱动命中（pattern 字符串被自家 regex 自举命中）
 */
/**
 * 构建/混淆产物判定（抽导出——审计扩展脚本复用，避免复制判定漂移）：
 *   ①单行混淆（任一行 >5000 字符——压缩产物）；②hash 文件名（Vite/webpack assets
 *   *-<HASH>.js 连字符形态 与 *.<HASH>.js / *.<HASH>.chunk.js 点分隔形态（webpack/CRA
 *   标准产物如 runtime-main.d37830b0.js / main.83b810ac.chunk.js）——hash 段 ≥6 字符
 *   大小写混合；纯小写连字符词如 env-compat 非产物）；③html 产物（引用 hash 命名
 *   静态资源——<script src="*.HASH.js"> / <link href="*.HASH.css">，docusaurus/CRA
 *   生成的 index.html）。
 *   产物不可改，行级规则（复杂度/魔数/命名/重复）必然爆炸误报——调用方跳过/降级。
 */
const JS_EXTS = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'];

// DSH 客户端入口推导已迁到**中立模块** lib/audit/client-entry.js（避免
//   dispatch → audit-file → checks → dispatch 的循环依赖）；此处**再导出**以保持既有导入路径可用。
export { resolveDshClientEntries } from './client-entry.js';

function isMinifiedOneLine(text) {
  let maxLine = 0; let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      if (i - start > maxLine) maxLine = i - start;
      start = i + 1;
    }
    if (maxLine > 5000) return true;
  }
  return false;
}

/** hash 段判定：≥6 字符且大小写/数字混合（[A-Z0-9] 与 [a-z] 都出现——数字算大写侧）。
 *  d37830b0 / 83b810ac / CRnoCikG 均通过；纯小写词 env-compat/benchmark 不通过。 */
function isHashSegment(seg) {
  return Boolean(seg && seg.length >= 6 && /[A-Z0-9]/.test(seg) && /[a-z]/.test(seg));
}

export function isBuildArtifactFile(relPathOrFile = '', text = '') {
  const rel = String(relPathOrFile || '');
  const ext = rel.split('.').pop().toLowerCase();
  if (JS_EXTS.includes(ext) && text && isMinifiedOneLine(text)) return true;
  if (rel.endsWith('.js')) {
    // 连字符形态：*-<HASH>.js    点分隔形态：*.<HASH>.js / *.<HASH>.chunk.js
    const match = rel.match(/(^|[\/])[^\/]+(?:-([A-Za-z0-9]{6,})|\.([A-Za-z0-9]{6,})(?:\.[A-Za-z0-9]+)?)\.js$/);
    if (match && isHashSegment(match[2] || match[3])) return true;
  }
  // html 产物：引用 hash 命名静态资源（docusaurus/CRA 的 index.html——生成物非手写页）。
  //   hash 段判定复用 isHashSegment：从引用 URL 末尾提取「主文件名段」（main.83b810ac.chunk.js
  //   → 取最后一个 ≥6 混排段 83b810ac；runtime-main.d37830b0.js → d37830b0）。
  if (ext === 'html') {
    // ① 声明了生成器：HTML 标准的 <meta name="generator" content="...">——任何代码生成器
    //   （archify / docusaurus / hugo / Sphinx…）都会写它。生成物不可手改，行级规则（内联脚本、
    //   按钮无事件、复杂度…）在它上面必然误报（实测：archify 的自包含产物 813K、内联 <script>
    //   是其**产物形态**，却按「管理界面 XSS」报 error 83 条）。
    //   注意容忍 HTML 允许的写法差异：<meta name="generator"> / <meta  name = "generator"> / 单引号。
    if (/<meta\s+[^>]*name\s*=\s*["']generator["']/i.test(String(text || ''))) return true;
    // ② 引用 hash 命名静态资源（docusaurus/CRA 的 index.html——生成物非手写页）。
    //   hash 段判定复用 isHashSegment：从引用 URL 末尾提取「主文件名段」（main.83b810ac.chunk.js
    //   → 取最后一个 ≥6 混排段 83b810ac；runtime-main.d37830b0.js → d37830b0）。
    const refs = String(text || '').match(/(?:src|href)=["']([^"']+\.(?:js|css))["']/gi) || [];
    if (refs.some((r) => {
      const match = r.match(/([A-Za-z0-9]{6,})(?:\.[A-Za-z0-9]+)*\.(?:js|css)["']?$/);
      if (!match) return false;
      return isHashSegment(match[1]);
    })) return true;
  }
  return false;
}

export function auditFile({ file, relPath, text, grouped }, opts = {}) {
  if (!text) return [];
  const ext = String(relPath || file || '').split('.').pop().toLowerCase();
  const isCode = CODE_EXTS.has(ext);
  // 混淆构建产物识别——Vite/webpack 压缩的 .js 单行可达 10万+ 字符
  //   （heroui-kGyYtjDh.js 单行 308K、index-BjhIkylN.js 单行 107K；正常源码最大 ~250）。
  //   这类文件是第三方构建产物（非本项目手写代码），行级规则（复杂度/函数长/魔数/
  //   重复串/命名）在单行 10万字符上必然爆炸误报且无意义（产物不可改）。
  //   处理：跳过行级规则，保留文件级（长度/健康度）与凭据扫描（产物若含真凭据仍报）。
  let isMinified = false;
  if (isCode && (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'ts' || ext === 'tsx' || ext === 'jsx')) {
    // 判据：任一单行 > 5000 字符（混淆压缩产物）。不要求总大小——41K 的
    //   icon-runtime 与 567B 的 rolldown-runtime 都是单行混淆（行长=文件大小）；
    //   正常手写代码单行不可能 5000+（实测源码最大 ~250）。
    isMinified = (() => {
      let maxLine = 0; let start = 0;
      for (let i = 0; i <= text.length; i++) {
        if (i === text.length || text[i] === '\n') {
          if (i - start > maxLine) maxLine = i - start;
          start = i + 1;
        }
        if (maxLine > 5000) return true;
      }
      return false;
    })();
  }
  // 构建产物 hash 文件名豁免（Vite/webpack assets：*-<HASH>.js——
  //   hash 段大写开头且 ≥6 字符，如 SensitiveMedia-BV5WWa1r.js / AboutPage-fPxR3xhp.js；
  //   不误伤手写文件——env-compat/benchmark 等小写段不匹配）。与单行混淆同层处理：
  //   构建产物非本项目手写代码，行级规则（复杂度/魔数/重复/命名）必然误报且产物不可改。
  const isBuildArtifact = isBuildArtifactFile(relPath || file, text);
  if (isBuildArtifact) {
    // 混淆/构建产物：只保留文件级检查（file-health）+ 凭据/路径安全（产物若含真凭据仍报）。
    // 屏蔽全部行级规则（正则/AST 在单行 10万+ 字符上必然爆炸误报且产物不可改）。
    const scoped = {};
    for (const [kind, rules] of Object.entries(grouped || {})) {
      if (!Array.isArray(rules)) { scoped[kind] = rules; continue; }
      // 保留：凭据类（secret/credential/security 硬编码）+ file-health + max-lines（文件级）
      // empty-catch 屏蔽：混淆单行里 `catch{}` 模式天然密集（压缩产物），不是真实空 catch
      const keep = rules.filter((r) => /^secret-|^cred|security\/no-hardcoded-credentials|security\/no-path-traversal|max-lines|max-file-length/.test(String(r?.id || ''))
        && !/no-empty-catch/.test(String(r?.id || '')));
      if (keep.length) scoped[kind] = keep;
    }
    let findings = runChecks({ file, relPath, text, grouped: scoped }, { level: opts?.level, repoHasJsYamlImport: opts?.repoHasJsYamlImport, repoLevelRules: opts?.repoLevelRules, repoPath: opts?.repoPath });
    // 产物超长是属性非问题；内置行级检查（quality/empty-catch 等）与残余行级规则也屏蔽——
    //   混淆单行 10万+ 字符上 catch{} 等模式天然密集，非真实缺陷。
    const keepRule = /^secret-|^cred|security\/no-hardcoded-credentials|security\/no-path-traversal/; // 构建/混淆产物：健康度（行长/大小）是产物属性非问题，只留凭据/路径安全
    findings = findings.filter((f) => keepRule.test(String(f.rule || '')));
    return findings.filter((f) => exemptForFinding(f, text) === false);
  }
  // 文档/配置（md/yml 等）不做重复串检查：反引号代码段、版本号、路径引用重复属正常书写，
  // 按「硬编码文本」报会造成大面积噪音（maintainability 规则只对代码文件生效）
  // 测试目录同理：fixture 会故意构造重复样本与 mock 值，重复是测试语义的一部分
  const isTestFile = /(^|[/\\])(test|tests|__tests__|spec)[/\\]|\.(test|spec)\.(js|mjs|cjs|ts)$/i.test(String(relPath || file));
  const maintainabilityScoped = !isCode || isTestFile;
  const scopedGrouped = maintainabilityScoped ? { ...grouped, 'repeated-string': undefined, 'min-occurrences': undefined } : grouped;
  let findings = runChecks({ file, relPath, text, grouped: scopedGrouped }, { level: opts?.level, repoHasJsYamlImport: opts?.repoHasJsYamlImport, repoLevelRules: opts?.repoLevelRules, repoPath: opts?.repoPath });
  const isRuleDefFile = /(^|[/\\])audit-rules-[a-z0-9-]+\.ya?ml$/i.test(String(relPath || file));
  const fileLines = String(text || '').split('\n');
  // 语义级豁免：纯 regex 规则看不到的上下文在此兜底——
  // 1) timeout-on-external-api：命中调用内已设 AbortSignal.timeout/AbortController/timeout
  // 2) client-module-loader-id：文件已按 window.__ModuleLoader__ 的 load 契约（{id, factory} 模块表）注册
  //    （pattern 匹配到的是契约调用本身；规则本意是「缺契约才报」，已用契约即通过）
  const hasLoaderContract = /window\.__ModuleLoader__\.load\s*\(\s*\{\s*id\s*:/.test(text);
  // 豁免过滤（dsh-skip-* 注册表统一消费，覆盖 sensitive/size/func-length/syntax/quality/residue/style）
  findings = findings.filter((f) => {
    // 规则定义文件：规则驱动命中（secret/regex/path-regex/func-lines 等 yml 规则）全豁免
    if (isRuleDefFile && f.rule !== 'quality/empty-catch' && f.rule !== 'robustness/io-risk') return false;
 // 技能/规则文档豁免：skills/ 下的 skill 文档与 rules/ 文档里的
    // 沟通措辞是「触发场景/规则描述」设计文本（如 whenToUse 触发场景描述），非代码残留——comment 规则不拦；
    // version 规则同理：版本规则文档自身描述 0.x 例外（如 versioning-rule §二「内置模块从 0 开始」），
    //   文档里的版本号示例是规则文本而非违规版本标记
    const isSkillDoc = /(^|[/\\])skills([/\\]|$)/.test(String(relPath || file));
    const isRulesDoc = /(^|[/\\])rules([/\\]|$)/.test(String(relPath || file));
    const isCommentRule = f.rule === 'documentation/comment-suspicious-detection' || /^conv-/.test(f.rule || '');
    const isVersionDocRule = /^version\//.test(f.rule || '');
    if ((isSkillDoc || isRulesDoc) && !isCode && (isCommentRule || isVersionDocRule)) return false;
    // residue/style：非代码文件豁免（文档/配置里的 debugger/console/风格字样非残留）
    if (!isCode && (f.kind === 'regex')) {
      const residueLike = /debugger|console|todo/i.test(f.rule);
      if (residueLike) return false;
    }
    // timeout 语义豁免：外部调用已设超时
    if (f.rule === 'robustness/timeout-on-external-api') {
      const idx = Math.max(0, (Number(f.line) || 1) - 1);
      if (hasExternalCallTimeout(fileLines[idx] || '', fileLines, idx)) return false;
      // githubFetch 是唯一网络出口（api.js），内部统一 AbortSignal.timeout(timeout) 默认 60s——
      //   调用处无需重复设置（纯 regex 规则看不到包装内部）
      if (/githubFetch\s*\(/.test(fileLines[idx] || '')) return false;
    }
    // mkdir 语义豁免：写文件前同函数已建目录（ensureDataDir 模式）
    if (f.rule === 'robustness/mkdir-before-write') {
      const idx = Math.max(0, (Number(f.line) || 1) - 1);
      if (hasMkdirInSameFunction(fileLines, idx)) return false;
    }
    // loader 契约语义豁免：已按统一 ModuleLoader 契约注册
    if (f.rule === 'dsh/client-module-loader-id' && hasLoaderContract) return false;
    // DSH 插件语义豁免：name 以 dsh- 开头的插件不发布 npm（工作区/市场安装），
    //   private:true 是刻意配置（防误发布），npm/private-true-conflict 不报
    if (f.rule === 'npm/private-true-conflict' && /"name"\s*:\s*"dsh-/.test(text)) return false;
    return !exemptForFinding(f, text);
  });
  return findings;
}
