/** dsh-skip-sensitive dsh-git-push v1.1.0 审计规则单测（内置自 dsh-code-audit，真实临时文件 + files 注入）
 * 文件头 dsh-skip-sensitive：本文件含 comment-wording 检测目标措辞（作为测试输入数据），
 * 豁免审计检测与提交前 autoClean 自动清理，防止测试输入被误删（2026-09-07 固化）。 */
import { auditRepo, cleanCommentWording } from '../lib/audit.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

const root = mkdtempSync(join(tmpdir(), 'gitpush-audit-test-'));
const repo = join(root, 'repo');
mkdirSync(repo, { recursive: true });
execSync('git init -b master', { cwd: repo, stdio: 'ignore' });
writeFileSync(join(repo, 'base.js'), 'export const base = 1;\n');
execSync('git add -A && git -c user.email=t@t -c user.name=t commit -m init', { cwd: repo, stdio: 'ignore' });

function audit(files, opts = {}) {
  for (const f of files) {
    const dir = join(repo, f.path).replace(/[^/]+$/, '');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(repo, f.path), f.content);
  }
  return auditRepo(repo, { ...opts, files: files.map((f) => ({ path: f.path, addedLines: f.addedLines ?? f.content.split('\n'), isBinary: false })) });
}

try {
  const r1 = audit([{ path: 'a.js', content: 'function ( {\n' }]);
  ok(r1.blocked === true && r1.findings.some((f) => f.rule === 'syntax' && f.level === 'blocker'), 'JS 语法错误 → blocker');

  const r2 = audit([{ path: 'b.js', content: 'export const ok = () => 1;\n' }]);
  ok(r2.passed === true && r2.findings.length === 0, '合法 JS 通过');

  const r3 = audit([{ path: 'c.js', content: 'const t = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";\n' }]);
  ok(r3.findings.some((f) => f.rule === 'secret'), 'GitHub PAT 检出');

  const r4 = audit([{ path: 'd.js', content: 'const k = "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz";\n' }]);
  ok(r4.findings.some((f) => f.rule === 'secret'), 'OpenAI sk- key 检出');

  const r5 = audit([{ path: 'e.js', content: 'const token = process.env.MY_TOKEN;\nconst x = { apiKey: "xxx", secret: "your-secret" };\n' }]);
  ok(!r5.findings.some((f) => f.rule === 'secret'), 'process.env 引用与占位符不误报');

  const r7 = audit([{ path: '.env', content: 'API_KEY=real\n' }]);
  ok(r7.findings.some((f) => f.rule === 'credential-file' && f.level === 'blocker'), '.env 入库检出 blocker');

  const r8 = audit([{ path: 'g.json', content: '{ bad json\n' }]);
  ok(r8.findings.some((f) => f.rule === 'json'), 'JSON 解析失败检出');

  const r9 = audit([{ path: 'h.yml', content: 'key1: value1\nthis is not yaml\n' }]);
  ok(r9.findings.some((f) => f.rule === 'yaml'), 'YAML 异常检出');

  const r10a = audit([{ path: 'i.js', content: 'function f() { debugger; return 1; }\n' }], { blockOn: 'any' });
  ok(r10a.findings.some((f) => f.rule === 'debugger' && f.level === 'warning'), 'debugger 检出（warning）');
  ok(r10a.blocked === true, 'blockOn=any 时 warning 也拦截');
  const r10b = audit([{ path: 'i.js', content: 'function f() { debugger; return 1; }\n' }], { blockOn: 'blocker' });
  ok(r10b.passed === true, 'blockOn=blocker 时仅 warning 放行');

  const many = Array.from({ length: 6 }, (_, i) => `console.log("log${i}");`).join('\n');
  const r11 = audit([{ path: 'j.js', content: many + '\n' }]);
  ok(r11.findings.some((f) => f.rule === 'console' && f.level === 'warning'), 'console.log≥5 检出（warning）');

  const r13 = auditRepo(repo, { files: [] });
  ok(r13.passed === true && r13.note === '无变更', '无变更直接通过');

  // npm 包文件拦截（blocker）
  const r14a = audit([{ path: 'node_modules/lodash/index.js', content: 'module.exports={}\n' }]);
  ok(r14a.findings.some((f) => f.rule === 'npm-package-file'), 'node_modules/ 文件检出 blocker');
  ok(r14a.blocked === true, 'node_modules/ 文件触发拦截');

  const r14b = audit([{ path: 'package-lock.json', content: '{"name":"test","lockfileVersion":3}\n' }]);
  ok(r14b.findings.some((f) => f.rule === 'npm-package-file'), 'package-lock.json 检出 blocker');

  const r14c = audit([{ path: 'yarn.lock', content: '# yarn lockfile v1\n' }]);
  ok(r14c.findings.some((f) => f.rule === 'npm-package-file'), 'yarn.lock 检出 blocker');

  const r14d = audit([{ path: 'pnpm-lock.yaml', content: 'lockfileVersion: "6.0"\n' }]);
  ok(r14d.findings.some((f) => f.rule === 'npm-package-file'), 'pnpm-lock.yaml 检出 blocker');

  const r14e = audit([{ path: 'bun.lockb', content: '\x00\x00bun lock\n' }]);
  ok(r14e.findings.some((f) => f.rule === 'npm-package-file'), 'bun.lock 检出 blocker');

  const r14f = audit([{ path: 'src/main.js', content: 'export default 1;\n' }]);
  ok(!r14f.findings.some((f) => f.rule === 'npm-package-file'), '普通 JS 文件不误报 npm-package-file');

  const r14g = audit([{ path: 'node_modules/.cache/foo.js', content: 'cache\n' }]);
  ok(r14g.findings.some((f) => f.rule === 'npm-package-file'), 'node_modules/.cache/ 也检出');

  // docs-conversation 规则（v1.4.0）：文档含「AI 与用户沟通记录」措辞 → blocker
  const r15a = audit([{ path: 'README.md', content: '# 项目\n\n按实现该功能（本会话完成）。\n' }]);
  ok(r15a.findings.some((f) => f.rule === 'docs-conversation' && f.level === 'blocker'), 'md 含沟通记录措辞 → blocker');
  ok(r15a.blocked === true, 'md 沟通记录触发拦截');

  const r15b = audit([{ path: 'README.md', content: '# 项目\n\n功能说明：支持批量导出、定时同步。\n' }]);
  ok(r15b.passed === true && !r15b.findings.some((f) => f.rule === 'docs-conversation'), '正常功能文档不误报');

  const r15c = audit([{ path: 'src/main.js', content: '// 本会话上下文\nconst a = 1;\n' }]);
  ok(!r15c.findings.some((f) => f.rule === 'docs-conversation'), '代码文件不误报 docs-conversation');

  const r15d = audit([{ path: 'docs/plan.md', content: '用户确认了方案，我同意后开工。\n' }]);
  ok(r15d.findings.some((f) => f.rule === 'docs-conversation'), '多种措辞命中均检出');

  const r15e = audit([{ path: 'README.md', content: '# 项目\n\n用户可在设置页开关该功能。\n' }]);
  ok(!r15e.findings.some((f) => f.rule === 'docs-conversation'), '正常描述用户操作不误报');

  // 豁免类型 v1.5.0：说明类（示例凭据）不报 secret
  const r16a = audit([{ path: 'README.md', content: '# 项目\n\n例如 password: "fake-pass"（仅演示格式，非真实凭据）\n' }]);
  ok(!r16a.findings.some((f) => f.rule === 'secret'), '示例词上下文整行豁免（举例凭据不报）');

  const r16b = audit([{ path: 'config.example.js', content: 'const cfg = { password: "fakepass", apiKey: "your-api-key" };\n' }]);
  ok(!r16b.findings.some((f) => f.rule === 'secret'), '假凭据值/占位符不报');

  const r16c = audit([{ path: 'README.md', content: '# 项目\n\npassword: "P@ssw0rd123!"\n' }]);
  ok(r16c.findings.some((f) => f.rule === 'secret'), '真实凭据仍拦截（无示例标记）');

  // 备份类豁免：exemptRepos 命中的仓库跳过敏感内容规则（secret/凭据文件/对话措辞）
  const r17a = audit([{ path: '.env', content: 'API_KEY=real\n' }], { exemptRepos: ['repo'] });
  ok(!r17a.findings.some((f) => f.rule === 'credential-file' || f.rule === 'secret'), '豁免仓库 .env 不报');
  ok(r17a.exempted === true, '结果标注 exempted=true');

  const r17b = audit([{ path: '.env', content: 'API_KEY=real\n' }]);
  ok(r17b.findings.some((f) => f.rule === 'credential-file'), '非豁免仓库 .env 仍拦截');

  const r17d = audit([{ path: 'handover.md', content: '按用户约定实现，本会话完成。\n' }], { exemptRepos: ['repo'] });
  ok(!r17d.findings.some((f) => f.rule === 'docs-conversation'), '豁免仓库对话措辞不报');

  const r17e = audit([{ path: 'handover.md', content: '按用户约定实现，本会话完成。\n' }]);
  ok(r17e.findings.some((f) => f.rule === 'docs-conversation'), '非豁免仓库对话措辞仍拦截');

  const r17f = audit([{ path: 'a.js', content: 'function ( {\n' }], { exemptRepos: ['repo'] });
  ok(r17f.findings.some((f) => f.rule === 'syntax'), '豁免仓库语法检查仍生效（只豁免敏感内容规则）');

  /* ==================== 代码注释措辞（comment-wording，gbmd 案例固化，2026-09-06） ==================== */
  // 检测规则：代码/前端标记文件注释行含「用户要求/用户原话/用户说/用户约定」等措辞 → blocker
  // （v1.27.2 恢复：v1.27.0 公开视角清理误把测试输入里的检测目标措辞当用户视角删除，11 用例失效；
  //   2026-09-07 补：文件头 dsh-skip-sensitive 豁免 autoClean 再删，见文件头注释）
  const r18 = audit([{ path: 'k.js', content: '// 2026-08-26 用户要求：导出搜索记录\nconst a = 1;\n' }]);
  ok(r18.findings.some((f) => f.rule === 'comment-wording' && f.level === 'blocker'), '代码注释「用户要求」检出 blocker');

  const r18b = audit([{ path: 'k.html', content: '<!-- 用户原话「导出搜索记录」 -->\n<div></div>\n' }]);
  ok(r18b.findings.some((f) => f.rule === 'comment-wording'), 'HTML 注释「用户原话」检出');

  const r18c = audit([{ path: 'k.css', content: '/* 用户约定白天模式 */\nbody { color: #fff }\n' }]);
  ok(r18c.findings.some((f) => f.rule === 'comment-wording'), 'CSS 注释「用户约定」检出');

  const r18d = audit([{ path: 'k.py', content: '# 用户说加个开关\nx = 1\n' }]);
  ok(r18d.findings.some((f) => f.rule === 'comment-wording'), 'Python 注释「用户说」检出');

  // 不误报：代码字符串/标识符里的「用户」不该报（只查注释行）
  const r18e = audit([{ path: 'k.js', content: 'const msg = "用户要求：xxx";\nconst userId = 1;\n' }]);
  ok(!r18e.findings.some((f) => f.rule === 'comment-wording'), '代码字符串/标识符中的「用户」不误报');

  // 块注释里面有措辞照报（判定 isCommentLine 只看行首）
  const r18f = audit([{ path: 'k.js', content: '/* 用户要求加回 */\n' }]);
  ok(r18f.findings.some((f) => f.rule === 'comment-wording'), '块注释「用户要求」检出');

  // 豁免：exemptRepos 命中跳过 comment-wording（敏感内容规则）
  const r18g = audit([{ path: 'k.js', content: '// 用户要求导出\n' }], { exemptRepos: ['repo'] });
  ok(!r18g.findings.some((f) => f.rule === 'comment-wording'), '豁免仓库 comment-wording 不报');

  // cleanCommentWording 纯函数：改写为中性说明，保留日期与语义
  const w1 = cleanCommentWording('// 2026-08-26 用户要求：导出搜索记录\n// 用户原话「结束不能比今天晚」\n// （用户要求清理进垃圾桶）\n// 用户约定初次未设密码只警告\n');
  ok(w1.count === 4, `cleanCommentWording 计数 4（实际 ${w1.count}）`);
  ok(w1.text.includes('// 2026-08-26：导出搜索记录'), '日期+ → 日期保留');
  ok(w1.text.includes('// 「结束不能比今天晚」'), '「…」 → 「…」保留内容');
  ok(w1.text.includes('// （清理进垃圾桶）'), '（…） → （…）');
  ok(w1.text.includes('// 初次未设密码只警告'), ' → 删除措辞');
  ok(!/用户/.test(w1.text), '清理后无「用户」残留');

  // cleanCommentWording 不碰代码字符串（无注释标记的行原样返回）
  const w2 = cleanCommentWording('const msg = "用户要求：xxx";\nlet userId = 1;\n');
  ok(w2.count === 0 && w2.text.includes('"用户要求：xxx"'), '字符串里的「用户」不清理');

  // 多段引号并列（「a」「b」→ 「a」「b」）——1 处措辞，2 段引号内容都保留
  const w3 = cleanCommentWording('// 用户原话「都是运行态json」「而且不止这两个json文件是运行态」\n');
  ok(w3.count === 1 && w3.text.includes('「都是运行态json」「而且不止这两个json文件是运行态」'), '多段引号并列清理');

  // 括注形态：：「内容」 → 「内容」；（内容） → （内容）
  const w4 = cleanCommentWording('// 保存功能作用：用户原话「搜索结果覆盖写入 search_cache.json」\n// （用户要求清理进垃圾桶）\n');
  ok(w4.count === 2, `括注形态计数 2（实际 ${w4.count}）`);
  ok(w4.text.includes('// 保存功能作用：「搜索结果覆盖写入 search_cache.json」'), '：「…」 → 「…」');
  ok(w4.text.includes('// （清理进垃圾桶）'), '（…） → （…）');

  // JSDoc/块注释多行中间行（* xxx 开头）同样清理——状态机跟踪 /* */ 开闭
  const w5 = cleanCommentWording('/**\n * 2026-08-30 用户要求：gif 下载前先 HEAD 获取大小\n * 用户原话「token无效」\n */\nconst gif = 1;\n');
  ok(w5.count === 2, `JSDoc 多行计数 2（实际 ${w5.count}）`);
  ok(w5.text.includes(' * 2026-08-30：gif 下载前先 HEAD 获取大小'), 'JSDoc 中间行 日期+用户要求 → 日期保留');
  ok(w5.text.includes(' * 「token无效」'), 'JSDoc 中间行 用户原话：「…」 → 「…」');

  // 块注释中间行之后的代码不被误伤
  const w6 = cleanCommentWording('/* 用户要求块注释 */\nconst code = "正常代码";\n');
  ok(w6.count === 1 && w6.text.includes('/* 块注释 */'), '单行块注释清理');
  ok(w6.text.includes('const code = "正常代码";'), '块注释后的代码原样');
  // ---- comment-wording 规则配置化（2026-09-06）：自定义规则注入 ----
  const customAudit = audit([{ path: 'k.js', content: '// 老板拍板：上灰度\n' }], {
    commentWordingPatterns: [{ name: '老板拍板', pattern: '老板拍板' }],
  });
  ok(customAudit.findings.some((f) => f.rule === 'comment-wording' && f.message.includes('老板拍板')), '注入自定义规则后检测命中');

  const builtinOnly = audit([{ path: 'k.js', content: '// 老板拍板：上灰度\n' }]);
  ok(!builtinOnly.findings.some((f) => f.rule === 'comment-wording'), '未注入时自定义措辞不报（内置规则不变）');

  const wExtra = cleanCommentWording('// 老板拍板：上灰度\n', [new RegExp('老板拍板')]);
  ok(wExtra.count === 1 && wExtra.text.includes('// 上灰度'), 'extraPatterns 自定义措辞清理');

  const r19 = audit([{ path: 'a.js', content: '// 用户要求x\n' }], {
    commentWordingPatterns: [{ name: '用户要求', pattern: '用户要求' }],
  });
  ok(r19.findings.some((f) => f.rule === 'comment-wording'), '内置规则经配置化通道注入仍生效');

  // ---- 文档凭据引用/明文警告（credential-ref，v1.27.0）----
  // 文档新增行出现旧凭据位置引用 → warning
  const r20 = audit([{ path: 'n.md', content: '凭据在 .ssh/credentials.md 里\n' }]);
  ok(r20.findings.some((f) => f.rule === 'credential-ref' && f.level === 'warning'), '文档旧凭据文件引用检出 warning');
  // 文档写凭据明文键值对 → warning
  const r21 = audit([{ path: 'n2.md', content: '密码: AR-26710\n' }]);
  ok(r21.findings.some((f) => f.rule === 'credential-ref' && f.level === 'warning'), '文档凭据明文检出 warning');
  // 示例词上下文豁免（例如/示例）
  const r22 = audit([{ path: 'n3.md', content: '例如 password: xxxxxx 是示例\n' }]);
  ok(!r22.findings.some((f) => f.rule === 'credential-ref'), '示例词上下文豁免');
  // 代码文件不适用该规则
  const r23 = audit([{ path: 'k.js', content: '// 密码: xxxxxx\nconst a = 1;\n' }]);
  ok(!r23.findings.some((f) => f.rule === 'credential-ref'), '代码文件不查 credential-ref');

} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
