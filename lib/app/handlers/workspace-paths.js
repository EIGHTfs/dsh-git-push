/**
 * HTTP 处理层 · AI 自设工作区路径端点（workspace-paths）
 *
 * 一个端点两种方法（handleHttp 的 switch 按路径分发，方法在 ctx.method 里）：
 *   · GET  /api/git-push/workspace-paths
 *       读回当前自设清单 + 注入文本预览（AI 用它自查「我登记的路径对不对」✓）
 *   · POST /api/git-push/workspace-paths
 *       写自设清单。body 支持三种形态（都走同一套校验）：
 *         { "paths": ["<绝对路径>", …] }            默认 set（整份替换）
 *         { "paths": [...], "mode": "add" }         追加（去重）
 *         { "paths": [...], "mode": "remove" }      移除
 *         { "path": "<绝对路径>", "mode": "add" }   单条简写
 *       也支持 { "clear": true } 清空（回到「无自设 ⇒ 注入回退会话 cwd」）。
 *
 * 为什么要这个端点：环境注入里的 cwd 原先取自会话文件，实测会注入**陈旧路径**（本机注入出
 *   `…/0.1.6-alpha.1/工作区/…`，而真实工作区在别处）⇒ 让 AI 自己登记真实路径，注入优先显示它。
 *   这正是「AI 自己提醒自己」的实现方式：注入里显示的就是 AI 自己写下的那份 ✓
 */
import {
  loadWorkspacePaths, saveWorkspacePaths, workspacePathsInjectionText, workspacePathsFile, MAX_WORKSPACE_PATHS,
} from '../../core/workspace-paths.js';

/** 从 body 取待处理路径数组（paths 数组优先；兼容单条 path 字符串）。 */
function pathsFromBody(body) {
  if (Array.isArray(body?.paths)) return body.paths.map((x) => String(x || ''));
  if (typeof body?.path === 'string' && body.path.trim()) return [body.path];
  return [];
}

/** GET /api/git-push/workspace-paths —— 读自设清单 + 注入预览。 */
export function handleWorkspacePathsGet() {
  const cur = loadWorkspacePaths();
  const text = workspacePathsInjectionText();
  return {
    status: 200,
    body: {
      ok: true,
      paths: cur.paths,
      count: cur.paths.length,
      updatedAt: cur.updatedAt,
      updatedBy: cur.updatedBy,
      file: workspacePathsFile(),
      maxPaths: MAX_WORKSPACE_PATHS,
      injection: text,                       // 注入时会显示成什么样（AI 自查用 ✓）
      injectionActive: !!text,               // false = 无自设 ⇒ 注入回退会话 cwd
      usage: "POST 同路径写入：body {\"paths\":[\"<绝对路径>\", …], \"mode\":\"set|add|remove\"}；{\"clear\":true} 清空",
    },
  };
}

/** POST /api/git-push/workspace-paths —— 写自设清单（set / add / remove / clear）。 */
export function handleWorkspacePathsSet(ctx) {
  // body 容错：工具路径传的是**已解析对象**（tool-call 里 JSON.parse 后转字符串再交给 handleHttp），
  //   CLI 路径实测传进来的是**JSON 字符串**（`--body '{…}'` 原样）⇒ 两种都接受，
  //   否则 CLI 调用会报「缺少 paths」而实际是 body 没被解析 ✗（2026-10-15 实测踩到）。
  let body = ctx?.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch { body = {}; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  const mode = String(body.mode || 'set').toLowerCase();
  const cur = loadWorkspacePaths();

  if (body.clear === true || mode === 'clear') {
    const r = saveWorkspacePaths([], { by: 'ai' });
    return { status: r.ok ? 200 : 500, body: { ok: r.ok, mode: 'clear', paths: r.paths, error: r.rejected[0]?.reason } };
  }

  const input = pathsFromBody(body);
  if (!input.length) {
    return { status: 400, body: { ok: false, error: '缺少 paths（数组）或 path（字符串）；清空请传 {"clear":true}' } };
  }
  if (!['set', 'add', 'remove'].includes(mode)) {
    return { status: 400, body: { ok: false, error: `不支持的 mode: ${mode}（仅 set/add/remove/clear）` } };
  }

  if (mode === 'remove') {
    // 移除按「字符串相等」比对（用户/AI 写进来的原样路径），避免因 resolve 差异删不掉
    const want = new Set(input.map((x) => String(x).trim()).filter(Boolean));
    const kept = cur.paths.filter((p) => !want.has(p));
    const r = saveWorkspacePaths(kept, { by: 'ai' });
    return {
      status: r.ok ? 200 : 500,
      body: { ok: r.ok, mode, removed: cur.paths.length - kept.length, paths: r.paths, error: r.rejected[0]?.reason },
    };
  }

  const next = mode === 'add' ? [...cur.paths, ...input] : input;
  const r = saveWorkspacePaths(next, { by: 'ai' });
  // 全部条目被拒（如全是相对路径/不存在的目录）⇒ 必须报错，不能"成功但空"✗
  //   —— 否则调用方会以为写进去了，下一轮注入却什么都没有（实测过的误判形态）
  const allRejected = r.paths.length === 0 && input.length > 0;
  const okFinal = r.ok && !allRejected;
  return {
    status: okFinal ? 200 : 400,
    body: {
      ok: okFinal,
      mode,
      paths: r.paths,
      count: r.paths.length,
      rejected: r.rejected,                  // 被拒的路径 + 原因（相对路径 / 不存在 / 超上限）
      file: r.file,
      injection: workspacePathsInjectionText(),
      error: okFinal ? undefined : (r.rejected[0]?.reason || '写入失败'),
    },
  };
}
