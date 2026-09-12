/**
 * dsh-git-push 上下文注入入口
 * 给 AI 会话注入环境：工作目录映射 / 工具安装路径 / skill 清单。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 默认工具清单（探测结果可覆盖）。 */
export const DEFAULT_TOOLS = {
  git: '/usr/bin/git',
  node: '/usr/bin/node',
  npm: '/usr/bin/npm',
  python3: '/usr/bin/python3',
  curl: '/usr/bin/curl',
};

/** 生成 AI 环境注入文本（注入 systemPrompt section）。 */
export function createEnvInjectionText({ cwd = '', projectRoot = '', tools = DEFAULT_TOOLS } = {}) {
  const lines = [];
  lines.push('【dsh-git-push 环境注入】');
  lines.push(`- 当前工作目录 cwd：${cwd}`);
  if (projectRoot) {
    lines.push(`- 项目实际目录（git 根）：${projectRoot}`);
    lines.push(`- skills 目录：${join(projectRoot, 'skills')}（存在：${existsSync(join(projectRoot, 'skills'))}）`);
  }
  lines.push(`- 工具：${Object.entries(tools).map(([k, v]) => `${k}=${v}`).join(' / ')}`);
  return lines.join('\n');
}

/**
 * 路径归属判定：确认 `target` 是否位于 `root` 之下（防目录穿越，跨主机定位用）。
 * @param {string} root 根目录绝对路径
 * @param {string} target 待判定路径
 * @returns {boolean} true=属于该根（或等于根）
 */
export function isWithinRoot(root = '', target = '') {
  const r = String(root || '').replace(/\/+$/, '');
  const t = String(target || '').replace(/\/+$/, '');
  if (!r || !t) return false;
  return t === r || t.startsWith(r + '/');
}

/**
 * 提取注入段落的键值结构（机器可读，供解析测试）。
 * @param {string} text createEnvInjectionText 输出
 * @returns {object} { cwd, projectRoot, skillsDir, tools: {k:v} }
 */
export function parseEnvInjection(text = '') {
  const out = { tools: {} };
  for (const line of String(text).split('\n')) {
    const m = /^\- ([^：:]+)：(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    if (key === '当前工作目录 cwd') out.cwd = val;
    else if (key.startsWith('项目实际目录')) out.projectRoot = val;
    else if (key.startsWith('skills 目录')) out.skillsDir = val.replace(/（存在：.*）$/, '');
    else if (key === '工具') {
      for (const pair of val.split(' / ')) {
        const [k, v] = pair.split('=');
        if (k && v !== undefined) out.tools[k.trim()] = v.trim();
      }
    }
  }
  return out;
}