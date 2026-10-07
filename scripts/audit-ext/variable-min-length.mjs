/**
 * 审计扩展：variable-min-length（试点——内置审计规则抽出为独立脚本，统一动态入口）
 *
 * 试点：audit-rules-nodejs.yml 的 readability/variable-min-length 标 external: true
 *   ——内置执行链停跑（groupByKind 过滤），本脚本经 runAuditExt 统一加载（auditFull 自动并入）。
 * 复用 lib/ast 检查器函数（checkNameLengthAst）——实现不重复，仅换执行载体。
 * findings 格式与内置 checkMinLength 对齐（file 相对路径 / severity warning / scoreImpact 0）。
 */

export const auditExt = {
  name: 'variable-min-length',
  match: (repo) => Boolean(repo && repo !== '.'),
  run: async (repo) => {
    const { checkNameLengthAst } = await import('../../lib/ast/naming.js');
    // external 规则此前是「写了字段也不生效」：run(repo, opts) 只收到仓库路径，收不到规则对象，
    //   于是 min 硬编码 2、yml 里声明的 exceptions 形同虚设（自审实测：i/j/k/n/e/cb 若真出现也会报）。
    //   编排层调用契约改动面大，改为**脚本自己按 external 名查自己的规则**（自包含、不影响其它 ext），
    //   让 yml 声明的 min_length / exceptions / exclude_paths 真正生效。
    let rule = null;
    try {
      const { discoverRuleSlots, loadRuleFiles } = await import('../../lib/rule/loader.js');
      const slots = discoverRuleSlots().map((s) => s.name || s);
      const merged = loadRuleFiles(slots).merged || {};
      rule = (merged.rules || []).find((r) => String(r.external || r.external === true ? (r.external === true ? '' : r.external) : '') === 'variable-min-length') || null;
    } catch { rule = null; }
    const minLength = Number.isFinite(Number(rule?.min_length)) ? Number(rule.min_length) : 2;
    const allow = Array.isArray(rule?.exceptions) ? rule.exceptions.map(String) : [];
    const excludePaths = Array.isArray(rule?.exclude_paths) ? rule.exclude_paths.map(String) : [];
    const isExcludedPath = (rel) => {
      if (!excludePaths.length) return false;
      const norm = String(rel || '').replace(/\\/g, '/').replace(/^\.?\//, '');
      return excludePaths.some((e) => {
        const ee = String(e || '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
        return ee && (norm === ee || norm.startsWith(ee + '/'));
      });
    };
    // 修复：external 通道必须带内置的构建/混淆产物豁免（isBuildArtifactFile——
    //   hash 文件名/单行混淆）——否则单行混淆产物短名密爆（Pawchive hash 产物 5896 条误报）
    const { isBuildArtifactFile } = await import('../../lib/audit/audit-file.js');
    // 修复：external 通道必须尊重 .gitignore/.auditignore——ext 自 walk 文件
    //   不走 collector，此前把被 gitignore 忽略的上游克隆（Pawchive docs/.probe-ktoolbox
    //   KToolBox 源码 68607 文件）扫入审计（14 条短名泄漏）。复用内置匹配器判目录忽略。
    const { parseGitignore, isIgnoredByRules } = await import('../../lib/audit/gitignore-match.js');
    const { readFileSync, readdirSync, statSync, existsSync } = await import('node:fs');
    const { join, extname, relative } = await import('node:path');
    const CODE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
    // 排除目录（构建产物/依赖/测试/一次性工具——与内置 collector 忽略语义近似；精确忽略留给核心审计）
    const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'output', 'test', 'tests', '__tests__', 'spec', 'tools', 'scripts', '.trash']);
    // gitignore 规则（.gitignore + .auditignore 叠加）——目录级跳过；缺省空 = 不忽略
    let gitignoreRules = null;
    try {
      const giText = [];
      for (const giFile of ['.gitignore', '.auditignore']) {
        const p = join(repo, giFile);
        if (existsSync(p)) giText.push(readFileSync(p, 'utf8'));
      }
      if (giText.length) gitignoreRules = parseGitignore(giText.join('\n'));
    } catch { /* 读忽略文件失败 = 不忽略，保守放行 */ }
    const findings = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) {
          if (SKIP_DIRS.has(f)) continue;
          // gitignore 忽略目录（上游克隆/内部数据）跳过——与 collector 目录剪枝同语义
          if (gitignoreRules && isIgnoredByRules(gitignoreRules, relative(repo, p).replace(/\\/g, '/'), true)) continue;
          walk(p);
        } else if (CODE_EXTS.has(extname(f))) {
          try {
            const text = readFileSync(p, 'utf8');
            const rel = relative(repo, p) || p;
            if (isExcludedPath(rel)) continue; // 规则声明的路径白名单外（如 token 级判定层的惯用短名）
            if (isBuildArtifactFile(rel, text)) continue; // 构建/混淆产物跳过（行级规则必然误报）
            for (const hit of checkNameLengthAst(text, { min: minLength, allow })) {
              // 降级（按需求）：窄作用域（声明所在块行跨度 ≤ SCOPE_LINES）里的短别名
              //   仍列出来（聚合结果里能查到位置、便于人工核对），但不按 warning 告警——
              //   含义由紧邻上下文决定（c=chunk / h=header / m=method / d=data / q=query），
              //   报成 warning 只会制造噪声；宽作用域仍按 warning 报。
              const narrow = hit.narrowScope === true;
              const what = hit.type === 'function' ? '函数' : '变量';
              findings.push({
                file: rel, line: hit.line,
                rule: 'readability/variable-min-length', kind: 'min-length',
                severity: narrow ? 'notice' : 'warning',
                message: narrow
                  ? `${what}名「${hit.name}」过短（< ${minLength}）——窄作用域惯用短别名（已降级为提示，位置可查）`
                  : `${what}名「${hit.name}」过短（< ${minLength}）——应可读命名`,
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