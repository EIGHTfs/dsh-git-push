/**
 * 检查层 · 调度（runChecks）
 *
 * ⚠️ 本文件只写「引用」——按 kind 依次调用各检查器并汇总结果，不含任何检查逻辑。
 *   检查逻辑在 lib/checks/* 各模块；AST 判定在 lib/ast/*。
 *   往这里加检查时：只加一行「按 kind 调用」，不要在调度里实现判定。
 *
 * 调度前统一做三件事（顺序不能反）：
 *   ① exts 过滤：规则声明目标扩展名时按当前文件裁剪（如 patch 规则只查 yml/yaml）
 *   ② 路径过滤：exclude_paths 声明的目录整规则跳过（如只查浏览器侧的规则排除 server/）
 *   ③ 文件内容初筛：file_patterns 声明的规则先做 L1 正则预筛——未命中 = 非候选文件，
 *      该规则剔除，不进 L2 AST 精查（三层审计 L1，2026-09-14）
 *   三者都在此生效，是「规则作用域」的落地点——漏了就会出现 yml 声明被静默忽略。
 *
 * quick 档跳过需要解析的检查（AST 类），只跑正则/黑名单，用于高频轻量审计。
 */
import { checkRegexRules, checkPathRegexRules, checkBlacklist } from './regex.js';
import { checkFuncLines, checkSyncFsInFile, checkEmptyCatch, checkMinLength, checkComplexity, checkDepth, checkMaxLines, checkRepeated } from './structural.js';
import { checkSemantic, checkPatchInsert } from './semantic.js';
import { checkCredentialFiles } from './credential-file.js';
import { checkNpmJson } from './npm-json.js';
import { checkFolderRules } from './folder.js';
import { checkPrivateFiles } from './private.js';
import { checkButtonBindings } from './button-bind.js';
import { checkMagicNumberSmart } from './magic-number.js';
import { checkDataflow } from './dataflow.js';
import { checkFileHealth } from './file-health.js';
import { filterRulesByExt, filterRulesByPath, filterRulesByFileText } from './filter.js';

export function runChecks({ file, relPath, text, grouped }, opts = {}) {
  const quick = opts.level === 'quick';
  // exts 过滤：规则声明目标扩展名时按当前文件裁剪（如 patch 规则只查 yml/yaml）
  grouped = filterRulesByExt(grouped, relPath || file || '');
  // 2026-09-13：路径级过滤——exclude_paths 声明排除的目录整规则跳过（如 server/ lib/ test/）
  grouped = filterRulesByPath(grouped, relPath || file || '');
  // 2026-09-14：三层审计 L1——file_patterns 文件内容级初筛（未命中 = 非候选，剔除进 L2）
  grouped = filterRulesByFileText(grouped, text);
  let findings = [];
  if (grouped['[FUNC]']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['[FUNC]'], repoPath: opts?.repoPath }));
  if (grouped['credential-ref']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['credential-ref'], repoPath: opts?.repoPath }));
  if (grouped['regex']) findings = findings.concat(checkRegexRules({ file, text, rules: grouped['regex'], repoPath: opts?.repoPath }));
  if (grouped['path-regex']) findings = findings.concat(checkPathRegexRules({ file, relPath, rules: grouped['path-regex'] }));
  if (!quick && grouped['func-lines']) findings = findings.concat(checkFuncLines({ file, text, rules: grouped['func-lines'] }));
  // 此前 9 个 kind 编译后无人消费（死桶）
  if (!quick && grouped['credential-file']) findings = findings.concat(checkCredentialFiles({ file, relPath, rules: grouped['credential-file'] }));
  if (!quick && grouped['min-length']) findings = findings.concat(checkMinLength({ file, text, rules: grouped['min-length'] }));
  if (!quick && grouped['max-complexity']) findings = findings.concat(checkComplexity({ file, text, rules: grouped['max-complexity'] }));
  if (!quick && grouped['max-depth']) findings = findings.concat(checkDepth({ file, text, rules: grouped['max-depth'] }));
  if (!quick && grouped['max-lines']) findings = findings.concat(checkMaxLines({ file, text, rules: grouped['max-lines'] }));
  // 1.0.13：文件健康度矩阵（行数/大小/行长三维评分）
  if (!quick && grouped['file-health']) findings = findings.concat(checkFileHealth({ file, relPath, text, rules: grouped['file-health'] }));
  if (!quick && grouped['repeated-string']) findings = findings.concat(checkRepeated({ file, text, rules: grouped['repeated-string'] }));
  if (!quick && grouped['min-occurrences']) findings = findings.concat(checkRepeated({ file, text, rules: grouped['min-occurrences'] }));
  if (!quick && grouped['semantic']) findings = findings.concat(checkSemantic({ file, relPath, rules: grouped['semantic'], repoLevelRules: opts?.repoLevelRules }));
  if (grouped['blacklist']) findings = findings.concat(checkBlacklist({ file, text, rules: grouped['blacklist'] }));
  if (grouped['npm-json']) findings = findings.concat(checkNpmJson({ file, text, rules: grouped['npm-json'], repoHasJsYamlImport: opts?.repoHasJsYamlImport, repoPath: opts?.repoPath }));
  // patch insert 语义检查（yml 文件 insert/覆盖 id 冲突才报）
  if (grouped['patch-insert']) findings = findings.concat(checkPatchInsert({ file, text, rules: grouped['patch-insert'] }));
  // 1.0.5：按钮事件绑定交叉比对（油猴脚本/扩展——HTML 在 JS 字符串，事件在 JS 绑定）
  if (grouped['button-bind']) findings = findings.concat(checkButtonBindings({ file, text, rules: grouped['button-bind'] }));
  // 1.0.7：硬编码魔数检测（版本号豁免版——版本号/日期/HTTP 状态码/常见合法常量/状态枚举自动豁免）
  if (grouped['magic-number-smart']) findings = findings.concat(checkMagicNumberSmart({ file, text, rules: grouped['magic-number-smart'] }));
  // 2026-09-14：三层审计 L2——数据流检查（kind=dataflow，如 clear-then-access 同函数清空后访问）
  //   L1 已在 filterRulesByFileText 初筛：file_patterns 未命中的文件这里 grouped 已空，空规则短路
  if (!quick && grouped['dataflow']) findings = findings.concat(checkDataflow({ file, text, rules: grouped['dataflow'] }));
  findings = findings.concat(checkEmptyCatch({ file, text }));
  findings = findings.concat(checkSyncFsInFile({ file, text }));
  return findings;
}
