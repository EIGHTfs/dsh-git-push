/**
 * 假审计引擎的注入助手（测试替身，非交付物）。
 *
 * 背景：审计是可热插拔的扩展能力，宿主测试不该要求真包安装。
 *   用本助手给 cfg 注入 `preCommit`，宿主就会 spawn 假 CLI 而不是真预处理实现，
 *   于是「宿主如何消费审计结果」这部分照样有守门，且宿主 CI 不需要预处理实现。
 *
 * 用法：
 *   await runAudit({ repoPath, cfg: withMockPreprocess({ auditEnabled: true }, 'blocked') });
 *   await callTool('git_commit_push', args, env, withMockPreprocess(cfg, 'ok'), ...);
 */
import { fileURLToPath } from 'node:url';

const MOCK_PROVIDER_CLI = fileURLToPath(new URL('../fixtures/mock-preprocess-cli.mjs', import.meta.url));

/**
 * 给配置注入「假审计引擎」。
 * @param {object} cfg 原始配置（其余键原样保留）
 * @param {'ok'|'blocked'|'fail'} mode 假引擎行为
 * @returns {object} 新配置（不改原对象）
 */
export function withMockPreprocess(cfg = {}, mode = 'ok') {
  return {
    ...cfg,
    preCommit: {
      command: process.execPath,
      args: [MOCK_PROVIDER_CLI, `--mode=${mode}`],
      timeoutMs: 30000,
    },
  };
}

export { MOCK_PROVIDER_CLI };
