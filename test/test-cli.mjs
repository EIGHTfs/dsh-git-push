/**
 * dsh-skip-sensitive dsh-git-push v1.1.0 独立 CLI 单测（v1.44.0）
 * 文件头 dsh-skip-sensitive：本文件含 comment-wording 检测目标措辞（作为测试输入数据），提交前豁免敏感内容扫描。
 * 覆盖：help / ruleset（编译计数）/ full-scan（表格与退出码）/ commit 门禁（--req-confirm）
 * 运行：node test/test-cli.mjs（子进程方式调 cli.mjs，不污染主进程）
 */

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');
let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}
function run(args, cwd = tmpdir()) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

console.log('  help / ruleset');
{
  const r = run(['help']);
  ok(r.code === 0 && r.out.includes('git-sluice v1.60.2'), 'help 打印且退出 0');
  const r2 = run(['ruleset', 'nodejs,frontend,comment']);
  ok(r2.code === 0 && r2.out.includes('编译 OK') && r2.out.includes('"secret": 4'), 'ruleset 槽位顺序编译计数正确');
  const r3 = run(['ruleset', '', '--json']);
  const j = JSON.parse(r3.out);
  ok(j.ok === true && j.counts.docConversation === 5 && j.counts.fullScan.threshold === 60 && j.counts.secret === 4, 'ruleset --json 输出结构');
}

console.log('  full-scan / commit（tmp 仓库端到端）');
const d = mkdtempSync(join(tmpdir(), 'cli-'));
try {
  writeFileSync(join(d, 'a.js'), '// 用户指示：这里要加缓存\nexport const a = 1;\n');
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q', '-b', 'master'], { cwd: d });
  execFileSync('git', ['add', '-A'], { cwd: d });
  execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=d@l', 'commit', '-q', '-m', 'init'], { cwd: d });

  // v1.47.0：YAML 引擎下「用户指示」= 门禁措辞（blocker）+ full-scan 高分（85 = 用户指示 40+指示 15+短 10+上下文 20）
  // 全仓扫描是只读报告通道，不因 comment-wording 拦截而影响输出
  const fs = run(['full-scan', d]);
  ok(fs.code === 0 && fs.out.includes('a.js:1') && /\b85\b/.test(fs.out) && fs.out.includes('⚠'), 'full-scan 表格 + 命中 85 分 + ⚠ 标记');
  const fsJ = run(['full-scan', d, '--json']);
  const fj = JSON.parse(fsJ.out);
  ok(fj.ok === true && fj.warnCount === 1 && fj.hits[0].score === 85, 'full-scan --json warnCount=1');

  const gate = run(['commit', d, '-m', 'gate-test'], d);
  ok(gate.code === 2 && gate.out.includes('"ok": false'), 'commit 不带 --req-confirm 被门禁拒绝（退出 2）');

  const ok1 = run(['commit', d, '-m', 'feat: cli commit', '--req-confirm'], d);
  ok(ok1.code === 0, 'commit --req-confirm 成功（退出 0）');
  const log = execFileSync('git', ['log', '--oneline'], { cwd: d, encoding: 'utf8' });
  ok(log.includes('feat: cli commit'), '提交真实落库');
} finally {
  rmSync(d, { recursive: true, force: true });
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
