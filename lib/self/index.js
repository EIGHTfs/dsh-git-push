/**
 * dsh-git-push 自身总入口
 * 版本控制（单一事实源）/ README 模板（独立，不走拦截 yml）/ yml 模板 / 独立运行能力（CLI）。
 */
export const VERSION = '1.1.3'; // 单一事实源：package.json 由 scan-version 校验一致性

/** 读取 README 模板（独立：README 生成不是规则拦截，故不在规则 yml 下）。 */
export function readmeTemplate() {
  // 1.1.4 接入：模板渲染（{{name}} {{version}} {{versionTable}} 占位符）
  return { ok: true, template: 'placeholder', version: VERSION };
}

/** yml 规则模板（新规则示范：显式 kind + dimensions 绑定）。 */
export function yamlTemplate() {
  return [
    `# 规则模板示范`,
    `- id: category/rule-name`,
    `  kind: regex            # 可省略：按字段自动指派`,
    `  name: "规则显示名称"`,
    `  category: "readability"`,
    `  severity: "warning"    # error→blocker / warning→提醒 / info→pass`,
    `  pattern: "..."`,
    `  dimensions: ["可读性", "可维护性"]  # 10 维度绑定，支持一字段多维度`,
    ``,
  ].join('\n');
}

/** 独立运行能力：CLI 版本自检（cli.mjs 调用）。 */
export function selfVersion() {
  return VERSION;
}