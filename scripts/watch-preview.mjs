/**
 * dsh-git-push — preview.html 自动重生成监听（2026-09-14）
 *
 * 监听会改变预览内容的源码，变更即自动重跑 assets/preview-gen.mjs 更新 preview.html，
 * 无需手动重生成——浏览器刷新即见新代码。
 *
 * 监听文件：
 *   - client.js（主 UI 源码，界面任何改动）
 *   - assets/preview-gen.mjs（生成器本身）
 *   - lib/client/index.js（配置 schema / 侧边栏设置项）
 *
 * 用法：
 *   node scripts/watch-preview.mjs            # 前台常驻，Ctrl+C 停
 *   node scripts/watch-preview.mjs &          # 后台
 *   配合真实后端测试：
 *     node scripts/preview-server.mjs --port 8090
 *     浏览器开 assets/preview.html?backend=http://127.0.0.1:8090
 */
import { watch } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = resolve(ROOT, 'assets/preview-gen.mjs');
const OUT = resolve(ROOT, 'assets/preview.html');

// 变更即重生成的源码（相对项目根）
const TARGETS = [
  resolve(ROOT, 'client.js'),
  resolve(ROOT, 'assets/preview-gen.mjs'),
  resolve(ROOT, 'lib/client/index.js'),
];

function regen() {
  try {
    const t0 = Date.now();
    execSync(`node ${JSON.stringify(GEN)}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`[watch] ${new Date().toTimeString().slice(0, 8)} 已重新生成 preview.html (${Date.now() - t0}ms) → 浏览器 Ctrl+R 刷新`);
  } catch (e) {
    console.error('[watch] 重新生成失败:', String(e && e.message || e).split('\n')[0]);
  }
}

let timer = null;
for (const f of TARGETS) {
  watch(f, { persistent: true }, () => {
    // debounce：避免保存时多次触发
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; regen(); }, 300);
  });
}

const ports = [
  {
    cmd: 'scripts/preview-server.mjs',
    hint: '接真实后端测试可用：node scripts/preview-server.mjs --port 8090，然后浏览器开',
    url: 'assets/preview.html?backend=http://127.0.0.1:8090',
  },
];
console.log('[watch] 监听源码变更，自动重生成 ' + OUT);
console.log('[watch] 纯离线 mock：直接开 ' + join('assets', 'preview.html') + '（无 ?backend=）');
console.log('[watch] 接真实后端：' + ports[0].hint + '\n  ' + ports[0].url);
console.log('[watch] Ctrl+C 停止监听');
// 启动时先跑一次，确保输出是最新
regen();