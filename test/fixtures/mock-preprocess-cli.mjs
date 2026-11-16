#!/usr/bin/env node
/**
 * 假审计 CLI（测试替身，非交付物）。
 *
 * 为什么需要它：审计是可热插拔的扩展能力，宿主测试不该依赖真包存在——
 *   否则扩展一拔掉，宿主自己的功能（拦截、工具、端点）就没人守了。
 *   本替身只实现「宿主真正消费的那部分契约」：
 *     stdout 单行 JSON { ok, scope, summary, quality, findings, blocked, files }
 *     exit 0/1/2
 *
 * 行为由环境变量 MOCK_AUDIT_MODE 控制：
 *   ok（缺省）  无问题      → exit 0, blocked []
 *   blocked     有 1 条拦截 → exit 1, blocked 1 条
 *   fail        执行失败    → exit 2, stderr 一条说明
 */
// 模式优先从命令行读（--mode=blocked）：env 是进程级的，测试并行会互相污染；
//   参数随每次 spawn 独立传递，才能做到「同一次跑里不同用例要不同结果」。
const argMode = (process.argv.find((a) => a.startsWith('--mode=')) || '').slice('--mode='.length);
const MODE = argMode || process.env.MOCK_AUDIT_MODE || 'ok';

const base = {
  ok: true,
  scope: 'diff',
  summary: { blocker: 0, warning: 0, notice: 0, total: 0 },
  quality: { score: 100, level: 'A', dims: {}, counts: {} },
  findings: [],
  blocked: [],
  files: 1,
  sampleExemptCount: 0,
};

const emit = (payload, code) => {
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exit(code);
};

if (MODE === 'ok') emit(base, 0);
else if (MODE === 'blocked') {
  const finding = { file: 'src/bad.js', line: 1, rule: 'mock/blocker', severity: 'blocker', message: '假审计拦截' };
  emit({
    ...base,
    ok: false,
    summary: { blocker: 1, warning: 0, notice: 0, total: 1 },
    quality: { score: 40, level: 'E', dims: {}, counts: {} },
    findings: [finding],
    blocked: [{ file: finding.file, line: finding.line, rule: finding.rule, message: finding.message }],
  }, 1);
} else if (MODE === 'fail') {
  process.stderr.write('mock audit cli: 模拟引擎执行失败\n');
  process.exit(2);
} else {
  process.stderr.write(`mock audit cli: 未知模式 ${MODE}\n`);
  process.exit(2);
}
