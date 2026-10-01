/**
 * 审计扩展契约示例——演示如何写一个自动接入的独立审计脚本。
 *
 * 契约（复制本文件骨架即可新增扩展）：
 *   export const auditExt = {
 *     name: '扩展名',                 // findings 里 source 标记 `ext:<name>`
 *     match: (repo) => true,         // 是否适用该仓库（返回 false 跳过）
 *     run: async (repo, opts) => [], // 返回 findings 数组
 *   };
 *
 * 自动接入：放进 scripts/audit-ext/ 即被统一入口动态加载——
 *   auditFull/auditWithScope 自动并入 + `node scripts/audit-runner.mjs <repo>` 独立跑。
 *
 * 本示例：检查仓库根有没有 README.md（找不到给 info 提示）——演示 match/run 用法。
 */

export const auditExt = {
  name: 'example-readme-present',
  match: (repo) => Boolean(repo && repo !== '.'),
  run: async (repo) => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const findings = [];
    if (!existsSync(join(repo, 'README.md'))) {
      findings.push({
        file: 'README.md', line: 1, rule: 'ext/readme-present',
        severity: 'info', scoreImpact: 0,
        message: '仓库根缺 README.md（示例审计扩展：演示契约接入）',
        dimensions: ['文档'],
      });
    }
    return findings;
  },
};