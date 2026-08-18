/** dsh-git-push v1.1.0 审计规则单测（内置自 dsh-code-audit，真实临时文件 + files 注入） */
import { auditRepo } from './lib/audit.js';
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
  for (const f of files) writeFileSync(join(repo, f.path), f.content);
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
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
