import { runChecks } from './checks.js';
import { exemptForFinding } from '../exempt/index.js';
import { hasExternalCallTimeout, hasMkdirInSameFunction, isVersionInPathContext } from './file-context.js';
import { CODE_EXTS } from './finding.js';

/**
 * 单文件审计：读文件 → 跑检查 → 豁免过滤（注册表驱动，7 标记全消费）。
 * 豁免判定：exemptForFinding 统一处理「文件头整文件 / 行内单点」两种位置语义；
 * 外加两类语义豁免：
 *   1) residue/style 检查只对代码文件生效（md/yml 文档里出现 debugger 字样是写作/定义，非残留）
 *   2) 规则定义文件（audit-rules-*.yml）自动豁免规则驱动命中（pattern 字符串被自家 regex 自举命中）
 */
export function auditFile({ file, relPath, text, grouped }, opts = {}) {
  if (!text) return [];
  const ext = String(relPath || file || '').split('.').pop().toLowerCase();
  const isCode = CODE_EXTS.has(ext);
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
    if (isRuleDefFile && f.rule !== 'quality/empty-catch' && f.rule !== 'quality/sync-fs') return false;
    // 技能/规则文档豁免（2026-09-13）：skills/ 下的 skill 文档与 rules/ 文档里的
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
    // 版本号路径上下文豁免：v0.x.y 出现在安装路径/文件名（如 dsh-v0.1.2 目录）而非版本标记
    if ((f.rule === 'version/embedded-major-zero' || f.rule === 'version/readme-zero-title')
      && isVersionInPathContext(fileLines[Math.max(0, (Number(f.line) || 1) - 1)] || '')) return false;
    // loader 契约语义豁免：已按统一 ModuleLoader 契约注册
    if (f.rule === 'dsh/client-module-loader-id' && hasLoaderContract) return false;
    // DSH 插件语义豁免：name 以 dsh- 开头的插件不发布 npm（工作区/市场安装），
    //   private:true 是刻意配置（防误发布），npm/private-true-conflict 不报
    if (f.rule === 'npm/private-true-conflict' && /"name"\s*:\s*"dsh-/.test(text)) return false;
    return !exemptForFinding(f, text);
  });
  return findings;
}
