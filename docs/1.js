/**
 * ============================================================
 * 代码质量检查工具（单文件版）
 * ============================================================
 * 功能：静态扫描 JavaScript/TypeScript 代码，检查：
 *   - 函数名、变量名命名规范（camelCase）
 *   - 函数长度（建议 ≤ 50 行）
 *   - 文件总长度（建议 ≤ 400 行）
 *   - 变量名最小长度（建议 ≥ 2）
 *   - 注释占比（建议 5% ~ 30%）
 * 
 * 使用方法：
 *   node code-quality.js [目标目录]
 *   示例：node code-quality.js ./server
 * 
 * 输出：控制台打印报告 + 返回 JSON 格式结果
 * 
 * 设计思路：
 *   - 纯原生 Node.js，无任何外部依赖
 *   - 正则解析（简单场景够用，复杂场景建议换 AST）
 *   - 模块化结构，方便按需拆分
 * ============================================================
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// 一、配置区域（用户可根据项目调整）
// ============================================================
const CONFIG = {
  // 需要忽略的目录（不扫描）
  ignoreDirs: ['node_modules', 'dist', 'build', '.git', 'coverage', '.next'],
  // 支持的文件扩展名
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  // 规则阈值
  rules: {
    maxFunctionLength: 50,          // 函数最大行数
    maxFileLength: 400,             // 文件最大行数（含空行）
    variableNameMinLength: 2,       // 变量名最短字符数
    functionNamePattern: /^[a-z][a-zA-Z0-9]*$/,  // 函数名必须 camelCase
    variableNamePattern: /^[a-z][a-zA-Z0-9]*$/,  // 变量名必须 camelCase
    commentRatioMin: 0.05,          // 注释占比下限（5%）
    commentRatioMax: 0.30,          // 注释占比上限（30%）
  },
  // 严重级别：'error' 或 'warning'
  severity: {
    functionLength: 'warning',
    fileLength: 'error',
    variableNameLength: 'warning',
    functionNamePattern: 'warning',
    variableNamePattern: 'warning',
    commentRatio: 'warning',
  },
};

// ============================================================
// 二、文件扫描器
// ============================================================

/**
 * 递归扫描目录，返回所有符合条件的文件绝对路径
 * @param {string} dir - 起始目录
 * @param {string[]} fileList - 累加的文件列表（递归用）
 * @returns {string[]} 文件路径数组
 */
function scanDirectory(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    // 跳过忽略目录
    if (entry.isDirectory() && CONFIG.ignoreDirs.includes(entry.name)) continue;
    if (entry.isDirectory()) {
      scanDirectory(fullPath, fileList);
    } else if (CONFIG.extensions.includes(path.extname(entry.name))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

// ============================================================
// 三、单文件分析器（核心解析逻辑）
// ============================================================

/**
 * 分析单个代码文件，提取函数、变量、行数等信息
 * @param {string} filePath - 文件绝对路径
 * @returns {object} 分析结果对象
 */
function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const result = {
    path: filePath,
    totalLines: lines.length,
    codeLines: 0,
    commentLines: 0,
    emptyLines: 0,
    functions: [],   // { name, startLine, endLine, length }
    variables: [],   // { name, line }
    maxFunctionLength: 0,
  };

  let inFunction = false;
  let funcName = '';
  let funcStart = 0;
  let funcBodyLines = 0;
  let braceDepth = 0;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // ---- 1. 统计空行 ----
    if (trimmed === '') {
      result.emptyLines++;
      continue;
    }

    // ---- 2. 统计注释行（支持块注释） ----
    // 注：字符串中的 '//' 可能会被误判，但简化版忽略这种情况
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || inBlockComment) {
      result.commentLines++;
      if (trimmed.includes('*/')) inBlockComment = false;
      if (trimmed.startsWith('/*')) inBlockComment = true;
      continue;
    }
    // 行尾注释（如 const a = 1; // 注释）——简化版不计为注释行，对结果影响不大
    // 如果需要更精确，可以额外检测行尾注释，这里为了性能省略

    result.codeLines++;

    // ---- 3. 提取函数定义 ----
    // 匹配：function name() {}  或  async function name() {}
    const funcMatch = trimmed.match(/^\s*(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(/);
    // 匹配：const name = () => {}  或  const name = function() {}
    const arrowMatch = trimmed.match(/^\s*(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/);
    // 匹配：name() { }  或  name : function() { }（对象方法，简单处理）
    const methodMatch = trimmed.match(/^\s*([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/);
    
    // 排除类方法中的静态/原型方法（已包含在 methodMatch 中，无需额外排除）
    // 注意：简单正则可能误匹配，如 'if (x) { ' 不会匹配因为圆括号后没有 {
    const isFunction = funcMatch || arrowMatch || methodMatch;
    if (isFunction) {
      const name = funcMatch?.[1] || arrowMatch?.[1] || methodMatch?.[1];
      // 避免误匹配如 'if (x) {' 或 'while (x) {'
      const isLikelyFunction = trimmed.includes('function') || trimmed.includes('=>') || 
                               (trimmed.includes('{') && !trimmed.includes('if') && !trimmed.includes('while') && !trimmed.includes('for'));
      if (isLikelyFunction) {
        inFunction = true;
        funcName = name;
        funcStart = i;
        funcBodyLines = 0;
        braceDepth = 0;
        // 计算第一行的括号深度
        for (let j = 0; j < trimmed.length; j++) {
          if (trimmed[j] === '{') braceDepth++;
          if (trimmed[j] === '}') braceDepth--;
        }
        // 如果这一行已经闭合了（如 function a() {} 一行写完），则直接记录
        if (braceDepth === 0 && trimmed.includes('{') && trimmed.includes('}')) {
          // 单行函数，长度为1
          result.functions.push({
            name: funcName,
            startLine: i + 1,
            endLine: i + 1,
            length: 1,
          });
          inFunction = false;
        }
        continue;
      }
    }

    // ---- 4. 如果当前在函数体内，累加行数 ----
    if (inFunction) {
      // 更新括号深度
      for (let j = 0; j < trimmed.length; j++) {
        if (trimmed[j] === '{') braceDepth++;
        if (trimmed[j] === '}') braceDepth--;
      }
      funcBodyLines++;
      
      // 如果括号深度为0，表示函数结束
      if (braceDepth === 0) {
        const length = i - funcStart + 1;
        result.functions.push({
          name: funcName,
          startLine: funcStart + 1,
          endLine: i + 1,
          length: length,
        });
        if (length > result.maxFunctionLength) {
          result.maxFunctionLength = length;
        }
        inFunction = false;
        funcName = '';
      }
    }

    // ---- 5. 提取变量定义（简单模式） ----
    // 匹配：const/let/var name = ...
    const varMatch = trimmed.match(/^(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=/);
    if (varMatch) {
      result.variables.push({
        name: varMatch[1],
        line: i + 1,
      });
    }
  }

  // 如果文件结束但函数未闭合（文件截断或解析错误），记录警告
  if (inFunction) {
    result.functions.push({
      name: funcName || '(anonymous)',
      startLine: funcStart + 1,
      endLine: lines.length,
      length: lines.length - funcStart,
      note: '⚠️ 函数可能未闭合（文件结尾）',
    });
  }

  return result;
}

// ============================================================
// 四、规则检查引擎
// ============================================================

/**
 * 根据配置的规则检查分析结果，生成问题列表
 * @param {object} analysis - analyzeFile 的返回结果
 * @returns {array} 问题数组，每项包含 { rule, severity, message, file, line }
 */
function checkRules(analysis) {
  const issues = [];
  const { rules, severity } = CONFIG;

  // ----- 规则1：函数长度 -----
  for (const fn of analysis.functions) {
    if (fn.length > rules.maxFunctionLength) {
      issues.push({
        rule: 'functionLength',
        severity: severity.functionLength,
        message: `函数 "${fn.name}" 长度为 ${fn.length} 行，超过建议上限 ${rules.maxFunctionLength} 行`,
        file: analysis.path,
        line: fn.startLine,
      });
    }
  }

  // ----- 规则2：文件总长度 -----
  if (analysis.totalLines > rules.maxFileLength) {
    issues.push({
      rule: 'fileLength',
      severity: severity.fileLength,
      message: `文件总行数 ${analysis.totalLines} 行，超过建议上限 ${rules.maxFileLength} 行`,
      file: analysis.path,
      line: null,
    });
  }

  // ----- 规则3：变量名长度和命名规范 -----
  for (const v of analysis.variables) {
    // 3.1 长度检查
    if (v.name.length < rules.variableNameMinLength) {
      issues.push({
        rule: 'variableNameLength',
        severity: severity.variableNameLength,
        message: `变量名 "${v.name}" 过短（${v.name.length} 个字符），建议至少 ${rules.variableNameMinLength} 个字符`,
        file: analysis.path,
        line: v.line,
      });
    }
    // 3.2 命名规范（camelCase）
    if (!rules.variableNamePattern.test(v.name)) {
      issues.push({
        rule: 'variableNamePattern',
        severity: severity.variableNamePattern,
        message: `变量名 "${v.name}" 不符合 camelCase 命名规范`,
        file: analysis.path,
        line: v.line,
      });
    }
  }

  // ----- 规则4：函数命名规范 -----
  for (const fn of analysis.functions) {
    if (fn.name && fn.name !== '(anonymous)' && !rules.functionNamePattern.test(fn.name)) {
      issues.push({
        rule: 'functionNamePattern',
        severity: severity.functionNamePattern,
        message: `函数名 "${fn.name}" 不符合 camelCase 命名规范`,
        file: analysis.path,
        line: fn.startLine,
      });
    }
  }

  // ----- 规则5：注释占比 -----
  const totalNonEmpty = analysis.codeLines + analysis.commentLines;
  if (totalNonEmpty > 0) {
    const ratio = analysis.commentLines / totalNonEmpty;
    if (ratio > rules.commentRatioMax) {
      issues.push({
        rule: 'commentRatio',
        severity: severity.commentRatio,
        message: `注释占比 ${(ratio * 100).toFixed(1)}%，超过建议上限 ${(rules.commentRatioMax * 100).toFixed(0)}%（注释过多）`,
        file: analysis.path,
        line: null,
      });
    } else if (ratio < rules.commentRatioMin) {
      issues.push({
        rule: 'commentRatio',
        severity: severity.commentRatio,
        message: `注释占比 ${(ratio * 100).toFixed(1)}%，低于建议下限 ${(rules.commentRatioMin * 100).toFixed(0)}%（注释不足）`,
        file: analysis.path,
        line: null,
      });
    }
  }

  return issues;
}

// ============================================================
// 五、报告生成器
// ============================================================

/**
 * 生成并打印报告，同时返回 JSON 结果
 * @param {array} allIssues - 所有问题的数组
 * @param {number} totalFiles - 扫描的文件总数
 * @returns {object} 汇总统计和分组详情
 */
function generateReport(allIssues, totalFiles) {
  // 按文件分组
  const grouped = {};
  let errorCount = 0, warningCount = 0;
  for (const issue of allIssues) {
    const key = issue.file;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(issue);
    if (issue.severity === 'error') errorCount++;
    else warningCount++;
  }

  const fileCount = Object.keys(grouped).length;

  // ---- 控制台输出 ----
  console.log('\n' + '='.repeat(70));
  console.log('  📊 代码质量检查报告');
  console.log('='.repeat(70));

  if (fileCount === 0) {
    console.log('\n  ✅ 所有文件通过检查！无任何问题。\n');
  } else {
    for (const [file, issues] of Object.entries(grouped)) {
      console.log(`\n📄 ${file}`);
      console.log('─'.repeat(60));
      for (const issue of issues) {
        const icon = issue.severity === 'error' ? '🔴' : '🟡';
        const prefix = issue.severity === 'error' ? '[ERROR]' : '[WARN] ';
        const lineInfo = issue.line ? `(第 ${issue.line} 行)` : '';
        console.log(`  ${icon} ${prefix} ${issue.message} ${lineInfo}`.trim());
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`  📈 汇总：共扫描 ${totalFiles} 个文件，${fileCount} 个文件有问题`);
  console.log(`  🔴 错误：${errorCount} 个，🟡 警告：${warningCount} 个`);
  console.log('='.repeat(70) + '\n');

  // ---- 返回结构化数据 ----
  return {
    summary: {
      totalFiles,
      filesWithIssues: fileCount,
      totalIssues: allIssues.length,
      errorCount,
      warningCount,
    },
    details: grouped,
  };
}

// ============================================================
// 六、主程序入口
// ============================================================

function main() {
  // 获取命令行参数：目标目录（默认当前目录）
  const targetDir = process.argv[2] || '.';
  console.log(`🔍 开始扫描目录: ${targetDir}`);

  try {
    // 1. 扫描文件
    const files = scanDirectory(targetDir);
    console.log(`📂 找到 ${files.length} 个代码文件\n`);

    // 2. 逐个分析并检查
    let allIssues = [];
    for (const file of files) {
      const analysis = analyzeFile(file);
      const issues = checkRules(analysis);
      allIssues = allIssues.concat(issues);
    }

    // 3. 生成报告
    const result = generateReport(allIssues, files.length);

    // 4. 可选：输出 JSON 到文件（便于集成）
    // fs.writeFileSync('code-quality-report.json', JSON.stringify(result, null, 2));
    // console.log('📁 完整报告已保存到 code-quality-report.json');

    // 如果存在错误（error 级别），退出码非 0，可用于 CI 门禁
    if (result.summary.errorCount > 0) {
      process.exit(1);  // CI 环境会认为失败
    }
  } catch (err) {
    console.error('❌ 执行过程中发生错误:', err.message);
    process.exit(1);
  }
}

// 如果作为脚本直接运行，则执行 main
if (require.main === module) {
  main();
}

// ============================================================
// 七、导出（供其他模块引用）
// ============================================================
module.exports = {
  CONFIG,
  scanDirectory,
  analyzeFile,
  checkRules,
  generateReport,
  main,
};

/**
 * ============================================================
 * 使用说明
 * ============================================================
 * 1. 直接运行：node code-quality.js ./server
 * 2. 自定义配置：修改 CONFIG 对象中的阈值和规则
 * 3. 扩展新规则：在 checkRules 函数中添加新的检查块
 * 4. 输出格式：控制台友好展示，同时返回 JSON 对象
 * 5. 作为模块：require('./code-quality.js') 导入各函数
 * ============================================================
 */