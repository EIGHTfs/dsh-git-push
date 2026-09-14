/**
 * 插件入口层 · 默认扫描根解析
 *
 * 账号卡片本地扫描 / git_scan 未指定路径时的默认根，优先级（2026-09-14）：
 *   ① 插件配置 cfg.defaultScanRoot（设备侧边栏写入，非空即用它，无需重启）
 *   ② 自动识别 DSH 家根：DSH_HOME 的上一级，或 workspaceRoot/.dsh-home
 *      （.dsh 目录同级/上一级，覆盖 工作区/用户/profiles/workspace 下全部 git 仓库）
 * 全部动态来源，无写死绝对路径。
 */
import { join, dirname, isAbsolute } from 'node:path';

/** 取默认扫描根。cfg 传插件配置（含 defaultScanRoot），未传时按自动识别。 */
export function getDefaultScanRoot(env = {}, cfg = {}) {
  const configured = String(cfg?.defaultScanRoot || '').trim();
  if (configured) return configured; // 侧边栏配置优先
  if (env.dshHomeRoot) return env.dshHomeRoot;
  if (process.env.DSH_HOME) {
    const p = process.env.DSH_HOME; // 形如 <workspaceRoot>/.dsh-home/.dsh
    if (p && isAbsolute(p)) return dirname(p); // .dsh 上一级 = DSH 家根
  }
  if (env.workspaceRoot) return join(env.workspaceRoot, '.dsh-home'); // DSH 根 → DSH 家根
  return '.';
}