/**
 * dsh-git-push-v2 上下文注入入口
 * 给 AI 会话注入环境：工作目录映射 / 工具安装路径 / skill 清单。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 生成 AI 环境注入文本（注入 systemPrompt section）。 */
export function createEnvInjectionText({ cwd = '', projectRoot = '' } = {}) {
  const lines = [];
  lines.push('【dsh-git-push-v2 环境注入】');
  lines.push(`- 当前工作目录 cwd：${cwd}`);
  if (projectRoot) {
    lines.push(`- 项目实际目录（git 根）：${projectRoot}`);
    lines.push(`- skills 目录：${join(projectRoot, 'skills')}（存在：${existsSync(join(projectRoot, 'skills'))}）`);
  }
  return lines.join('\n');
}