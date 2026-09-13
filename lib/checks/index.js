/**
 * 检查层 · 统一出口
 *
 * 分层位置（三层审计架构第三层）：
 *   ① 规则声明 → lib/audit-rules/*.yml
 *   ② 具体实现 → lib/ast/*（token 级判定）
 *   ③ 调用包装 → lib/checks/*（本目录，把判定转成 finding）
 *   ④ 编排调度 → lib/audit/*（收集文件、按 kind 调度、汇总）
 *
 * 本文件只做再导出。模块划分按「检查对象/机制」：
 *   common.js         公共设施（豁免提示、severity 封顶、精筛集合取值）
 *   dispatch.js       调度（runChecks，只写引用、不含逻辑）
 *   filter.js         规则作用域过滤（exts / exclude_paths）
 *   regex.js          正则类规则（含 astConfirm 精筛消费）
 *   structural.js     结构类（函数长度/复杂度/嵌套/文件行数/同步 fs/空 catch）
 *   semantic.js       语义类（yml 声明的语义检查、patch insert）
 *   npm-json.js       package.json 规范
 *   folder.js         目录级检查
 *   credential-file.js 凭据文件
 *   private.js        私密文件
 *   button-bind.js    按钮事件绑定交叉比对
 *   magic-number.js   魔数（薄包装 ast/magic-number.js）
 *   file-health.js    文件健康度
 */

export { HINT_QUALITY, capSeverity, groupByKind } from './common.js';
export { runChecks } from './dispatch.js';
export { filterRulesByExt, filterRulesByPath } from './filter.js';
export { checkRegexRules, checkPathRegexRules, checkBlacklist } from './regex.js';
export {
  checkFuncLines, checkSyncFsInFile, checkEmptyCatch, checkMinLength,
  checkComplexity, checkDepth, checkMaxLines, checkRepeated,
} from './structural.js';
export { checkSemantic, isRepoLevelSemanticRule, checkPatchInsert } from './semantic.js';
export { checkCredentialFiles } from './credential-file.js';
export { checkNpmJson } from './npm-json.js';
export { checkFolderRules } from './folder.js';
export { checkPrivateFiles } from './private.js';
export { checkButtonBindings } from './button-bind.js';
export { checkMagicNumberSmart } from './magic-number.js';
export { checkFileHealth } from './file-health.js';
