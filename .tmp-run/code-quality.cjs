#!/usr/bin/env node

/**
 * ============================================================
 * 代码质量评估工具 (Code Quality Checker)
 * 作者：DeepSeek
 * 版本：1.0.0
 * 描述：基于 code-quality-checklist.yaml 对项目进行质量评估
 * 用法：
 *   node code-quality.js [--file checklist.yaml] [--output report.md]
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const yaml = require('js-yaml');

// ---------- 配置 ----------
const CONFIG = {
  checklistFile: process.argv.find(arg => arg.startsWith('--file='))?.split('=')[1] || 'code-quality-checklist.yaml',
  outputFile: process.argv.find(arg => arg.startsWith('--output='))?.split('=')[1] || 'quality-report.md',
  interactive: !process.argv.includes('--auto'),
};

// ---------- 加载 YAML ----------
function loadChecklist(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = yaml.load(content);
    return data;
  } catch (err) {
    console.error(`❌ 加载失败: ${filePath}`, err.message);
    process.exit(1);
  }
}

// ---------- 交互式问答 ----------
function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(`${question} (0-10): `, (answer) => {
      const score = parseFloat(answer);
      if (isNaN(score) || score < 0 || score > 10) {
        console.log('⚠️ 请输入 0-10 之间的数字');
        resolve(askQuestion(rl, question));
      } else {
        resolve(score);
      }
    });
  });
}

// ---------- 评估核心 ----------
async function evaluate(checklist, options = {}) {
  const { interactive = true } = options;
  const rl = interactive ? createInterface() : null;

  console.log('\n📊 代码质量评估');
  console.log('='.repeat(60));
  console.log(`📋 清单: ${CONFIG.checklistFile}`);
  console.log(`📁 评估维度: ${Object.keys(checklist.criteria || {}).length} 个核心维度 + ${Object.keys(checklist.additional || {}).length} 个附加维度`);
  console.log('='.repeat(60));

  const results = {};
  let totalScore = 0;
  let totalWeight = 0;
  const weights = checklist.scoring?.dimensions_weight || {};

  // ----- 评估核心维度 -----
  if (checklist.criteria) {
    console.log('\n📌 核心维度评估:');
    for (const [key, dim] of Object.entries(checklist.criteria)) {
      const weight = weights[key] || 10;
      const score = interactive
        ? await askQuestion(rl, `  ${dim.name} (标准: ${dim.standard})`)
        : 7; // 自动模式使用默认分
      
      results[key] = { name: dim.name, score, weight, standard: dim.standard };
      totalScore += score * weight;
      totalWeight += weight;
      
      if (interactive) {
        console.log(`    ✅ ${dim.name}: ${score}/10 (权重: ${weight})`);
      }
    }
  }

  // ----- 评估附加维度 -----
  if (checklist.additional) {
    console.log('\n📌 附加维度评估:');
    for (const dim of checklist.additional) {
      const weight = weights[dim.id] || 5;
      const score = interactive
        ? await askQuestion(rl, `  ${dim.name} (标准: ${dim.standard})`)
        : 6;
      
      results[dim.id] = { name: dim.name, score, weight, standard: dim.standard };
      totalScore += score * weight;
      totalWeight += weight;
      
      if (interactive) {
        console.log(`    ✅ ${dim.name}: ${score}/10 (权重: ${weight})`);
      }
    }
  }

  // ----- 快速自查清单（不评分，用于补充） -----
  if (checklist.checklist) {
    console.log('\n📋 快速自查清单（供参考）:');
    for (const item of checklist.checklist) {
      console.log(`  □ ${item.question} (${item.dimension})`);
    }
  }

  // ----- 计算总分 -----
  const finalScore = totalWeight > 0 ? Math.round((totalScore / totalWeight) * 10) / 10 : 0;
  
  // ----- 评级 -----
  const level = getLevel(finalScore, checklist.scoring?.interpretation);

  console.log('\n' + '='.repeat(60));
  console.log('📊 评估结果');
  console.log('='.repeat(60));
  console.log(`  总分: ${finalScore}/100`);
  console.log(`  评级: ${level}`);
  
  const passing = checklist.scoring?.passing || 70;
  console.log(`  状态: ${finalScore >= passing ? '✅ 通过' : '❌ 未通过 (需 ≥ ${passing} 分)'}`);
  
  if (rl) rl.close();

  // ----- 生成报告 -----
  if (CONFIG.outputFile) {
    generateReport(finalScore, level, results, checklist, CONFIG.outputFile);
    console.log(`\n📄 详细报告已保存: ${CONFIG.outputFile}`);
  }

  return { score: finalScore, level, results };
}

// ---------- 评级函数 ----------
function getLevel(score, interpretation) {
  if (!interpretation) {
    if (score >= 80) return 'A (优秀)';
    if (score >= 60) return 'B (良好)';
    if (score >= 40) return 'C (及格)';
    return 'D (不合格)';
  }
  
  for (const [range, desc] of Object.entries(interpretation)) {
    const [min, max] = range.split('-').map(Number);
    if (score >= min && score <= max) {
      return `${range}分: ${desc}`;
    }
  }
  return '未评级';
}

// ---------- 生成 Markdown 报告 ----------
function generateReport(score, level, results, checklist, outputFile) {
  const lines = [];
  
  lines.push('# 代码质量评估报告');
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push(`> 评估工具: code-quality.js v1.0`);
  lines.push(`> 清单版本: ${checklist.metadata?.version || '1.0'}`);
  lines.push('');
  lines.push('## 📊 总览');
  lines.push('');
  lines.push(`| 项目 | 结果 |`);
  lines.push(`|------|------|`);
  lines.push(`| **总分** | **${score}/100** |`);
  lines.push(`| **评级** | **${level}** |`);
  
  const passing = checklist.scoring?.passing || 70;
  lines.push(`| **状态** | ${score >= passing ? '✅ 通过' : '❌ 未通过'} |`);
  lines.push('');
  
  // ----- 各维度得分 -----
  lines.push('## 📌 各维度得分');
  lines.push('');
  lines.push('| 维度 | 得分 | 权重 | 加权分 | 标准 |');
  lines.push('|------|------|------|--------|------|');
  
  for (const [key, r] of Object.entries(results)) {
    const weighted = (r.score * r.weight / 10).toFixed(1);
    lines.push(`| ${r.name} | ${r.score}/10 | ${r.weight}% | ${weighted} | ${r.standard || '-'} |`);
  }
  lines.push('');
  
  // ----- 快速自查清单 -----
  if (checklist.checklist) {
    lines.push('## 📋 快速自查清单');
    lines.push('');
    lines.push('| 检查项 | 维度 | 状态 |');
    lines.push('|--------|------|------|');
    for (const item of checklist.checklist) {
      lines.push(`| ${item.question} | ${item.dimension} | ⬜ 待检查 |`);
    }
    lines.push('');
  }
  
  // ----- 改进建议 -----
  const weakAreas = Object.entries(results)
    .filter(([, r]) => r.score < 6)
    .map(([, r]) => r.name);
  
  if (weakAreas.length > 0) {
    lines.push('## 💡 改进建议');
    lines.push('');
    lines.push('以下维度得分偏低（<6分），建议优先改进：');
    lines.push('');
    for (const name of weakAreas) {
      lines.push(`- 🔴 **${name}**`);
    }
    lines.push('');
  }
  
  // ----- 总结 -----
  if (checklist.summary?.rule_of_thumb) {
    lines.push('## 💎 核心标准');
    lines.push('');
    lines.push(`> ${checklist.summary.rule_of_thumb}`);
  }
  
  fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');
}

// ---------- 主程序 ----------
async function main() {
  console.log('🚀 代码质量评估工具 v1.0\n');
  
  // 检查文件是否存在
  if (!fs.existsSync(CONFIG.checklistFile)) {
    console.error(`❌ 找不到清单文件: ${CONFIG.checklistFile}`);
    console.log('💡 请确保 code-quality-checklist.yaml 在当前目录，或使用 --file= 指定路径');
    process.exit(1);
  }
  
  // 加载清单
  const checklist = loadChecklist(CONFIG.checklistFile);
  
  // 执行评估
  const result = await evaluate(checklist, {
    interactive: CONFIG.interactive,
  });
  
  console.log('\n✅ 评估完成！');
}

// ---------- 导出 ----------
module.exports = { loadChecklist, evaluate, generateReport };

// ---------- 运行 ----------
if (require.main === module) {
  main().catch(console.error);
}
