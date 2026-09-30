/**
 * 审计扩展：variable-min-length（试点——内置审计规则抽出为独立脚本，统一动态入口）
 *
 * 2026-09-30 试点：audit-rules-nodejs.yml 的 readability/variable-min-length 标 external: true
 *   ——内置执行链停跑（groupByKind 过滤），本脚本经 runAuditExt 统一加载（auditFull 自动并入）。
 * 复用 lib/ast 检查器函数（checkNameLengthAst）——实现不重复，仅换执行载体。
 * findings 格式与内置 checkMinLength 对齐（file 相对路径 / severity warning / scoreImpact 0）。
 */

export const auditExt = {
  name: 'variable-min-length',
  match: (repo) => Boolean(repo && repo !== '.'),
  run: async (repo) => {
    const { checkNameLengthAst } = await import('../../lib/ast/naming.js');
    // 2026-10-05 修复：external 通道必须带内置的构建/混淆产物豁免（isBuildArtifactFile——
    //   hash 文件名/单行混淆）——否则单行混淆产物短名密爆（Pawchive hash 产物 5896 条误报）
    const { isBuildArtifactFile } = await import('../../lib/audit/audit-file.js');
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join, extname, relative } = await import('node:path');
    const CODE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
    // 排除目录（构建产物/依赖/测试——与内置 collector 忽略语义近似；精确忽略留给核心审计）
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'output', 'test', 'tests', '__tests__', 'spec', '.trash']);
    const findings = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) {
          if (!SKIP_DIRS.has(f)) walk(p);
        } else if (CODE_EXTS.has(extname(f))) {
          try {
            const text = readFileSync(p, 'utf8');
            if (isBuildArtifactFile(relative(repo, p), text)) continue; // 构建/混淆产物跳过（行级规则必然误报）
            for (const hit of checkNameLengthAst(text, { min: 2 })) {
              findings.push({
                file: relative(repo, p) || p, line: hit.line,
                rule: 'readability/variable-min-length', kind: 'min-length',
                severity: 'warning',
                message: `${hit.type === 'function' ? '函数' : '变量'}名「${hit.name}」过短（< 2）——应可读命名`,
                dimensions: ['可读性'],
                exemptHint: 'dsh-skip-quality（文件头=整文件）',
                scoreImpact: 0,
              });
            }
          } catch { /* 单文件读取失败跳过 */ }
        }
      }
    };
    try { walk(repo); } catch { /* 仓库不可遍历返回空 */ }
    return findings;
  },
};