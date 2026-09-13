/**
 * dsh-git-push 插件入口（DSH 接线，1.0.0）
 * dsh-skip-i18n: 插件为中文零依赖 CLI（无 i18n 框架需求），用户可见文案硬编码为产品设计
 *
 * 形态：`apply(ctx, config)`，接线全部走 lib/plugin/（Host 侧注册层）。
 * 职责：把 v2 十大总入口接到 DSH 运行时——
 *   1) 工具注册：ctx.inject(['tools']) → get('tools').register(defineTool(...))
 *   2) 上下文注入：ctx.inject(['systemPrompt']) → section({name, order, text:()=>同步})
 *   3) HTTP API：ctx.inject(['webServer']) → register({kind:'prefix', path, handler})
 *   4) 客户端（设置卡片/侧边栏）：**不在此注册**，由 package.json 的 dsh.client
 *      + exports["./client"] 自动发现（client.js）
 *
 * 本文件是**宿主 main 指向的入口**（package.json "main": "lib/index.js"），
 *   1.1.4 起只做再导出：实现全在 lib/app/*.js（schema / constants / slot-stats /
 *   tools / inject-text / tool-call / http-handlers / apply），本文件不含实现。
 * 业务能力仍全部在 lib/<入口>/：
 *   rule / audit / git / self / score / exempt / context / http / client / link-check。
 * 引擎可脱离 DSH 独立运行：`node cli.mjs <子命令>`。
 *
 * 为什么用 `export *` 而非逐名再导出：入口只负责「把 lib/app/ 的公开面原样转出去」，
 *   逐名列举会随功能新增而漂移（漏一个符号宿主就报 apply 缺失）；公开面由
 *   lib/app/index.js 单点定义。
 */
export * from './app/index.js';
