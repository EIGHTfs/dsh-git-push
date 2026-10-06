// 非 git 目录的 .gitignore 生效回归：默认审计必须尊重 .gitignore，--include-ignored 才纳回。
//
// 事故（用户报告「审计 git 忽略的内容」）：非 git 目录（解压源码包 / 临时导出 / 克隆未完成）
//   的忽略过滤门控只认「git 仓库 or .auditignore」⇒ 这类目录的 `.gitignore` 被完全无视：
//   实测带 `.gitignore`(ignored/) 的目录里，默认审计与被忽略文件一起扫（2 文件→含 ignored/secret.js），
//   且默认结果与 `--include-ignored` **一模一样**（开关形同虚设）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { collectTextFiles } from '../lib/audit/collector.js';

const SANDBOX = mkdtempSync(join(tmpdir(), 'dshgp-gitignore-'));
// collectTextFiles 返回的是 { path, text } 对象（不是字符串），取 path 归一为相对路径
const rel = (list) => list.map((f) => String(f?.path ?? f).replace(SANDBOX + '/', '')).sort();

mkdirSync(join(SANDBOX, 'ignored'), { recursive: true });
mkdirSync(join(SANDBOX, 'keep'), { recursive: true });
writeFileSync(join(SANDBOX, '.gitignore'), 'ignored/\n*.log\n');
writeFileSync(join(SANDBOX, 'ignored', 'secret.js'), 'const dbPassword = "x";\n');
writeFileSync(join(SANDBOX, 'keep', 'ok.js'), 'const x = 1;\n');
writeFileSync(join(SANDBOX, 'app.log'), 'debug line\n');

after(() => rmSync(SANDBOX, { recursive: true, force: true }));

test('非 git 目录：默认审计尊重 .gitignore（被忽略目录不进）', async () => {
  const files = rel(await collectTextFiles(SANDBOX, { depth: 5, gitIgnoreRoot: SANDBOX }));
  assert.ok(!files.some((f) => f.startsWith('ignored/')),
    `被 .gitignore 忽略的 ignored/ 不该进审计（实得：${files.join(', ')}）`);
  assert.ok(files.includes('keep/ok.js'), '未忽略的文件仍应进');
});

test('--include-ignored 才纳回被忽略内容（开关与默认必须不同）', async () => {
  const files = rel(await collectTextFiles(SANDBOX, { depth: 5, gitIgnoreRoot: SANDBOX, includeIgnored: true }));
  assert.ok(files.some((f) => f.startsWith('ignored/')),
    `includeIgnored=true 时应纳回 ignored/（实得：${files.join(', ')}）`);
});
