/**
 * dsh-git-push v2 设置侧边栏（settings.section 独立页）
 * ============================================================================
 * 重写（三选项卡版）：
 *   - 纯中文：删 zh/en 键值对字典，用户可见文案直接硬编码中文（产品设计）。
 *   - 三选项卡（对齐插件市场 .tabs/.tab/.on 样式，参考 skill 记分板）：
 *       ① 账号信息（纯展示）：token/SSH 公钥检测 → GitHub 登录态/用户名/套餐
 *       ② 审计：审计开关 + 10 维度权重 + 规则包列表（上下调次序、下覆盖上、
 *          动态加载全部 yml（模板不显示）、规则名后直接显示 描述/作者/拦截/警告/通过 数量、
 *          单击整行切换禁用/启用（auditDisabledSlots，nodejs/private 安全红线不可禁用））
 *       ③ 设置：token / sshkey / 邮箱 + 一键生成（保存按钮在标题右侧、放弃已删）
 *   - 只保留 settings.section 注册；settings.plugin.item（插件配置卡）已删除。
 *
 * ⛔ 形态铁律（client-modules 聚合 bundle 兼容）：
 *   1. window.__ModuleLoader__.load 必须在文件第 1 行。
 *   2. 全部代码在 factory 函数体内，文件顶层【零声明】（防 combo 拼接撞名）。
 *   3. 内部命名专属前缀 dshgp_（防与其他插件同名声明撞名）。
 *   4. 手写 jsx-runtime（jsx/jsxs），禁止 JSX 构建步骤；零外部资源。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-push',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    const jsx = require('react/jsx-runtime');
    const react = require('react');
    const store = require('@deepseek-ai/dsh-client-store');

    const NS = 'git-push';
    const SETTINGS_NS = 'git-push';

