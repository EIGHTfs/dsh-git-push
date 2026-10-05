// 五张事实清单的**纯函数扫描器**（规范 docs/ARCH-FACTS-SPEC.md 第 3.5 节）。
//
// 为什么单独成文件：清单是「事实的原始形态」，图（nodes/edges）只是它们的图视图。
//   扫描器做成**纯函数**（输入文件文本，输出清单条目）便于单测，也避免 extract.js 继续膨胀。
//   全部确定性：只认字面量与调用，不做任何猜测；取不到就是空数组。

/** 源码文件判定（与 extract.js 的 SRC_RE 口径一致）。 */
export const SRC_EXT_RE = /\.(m?js|cjs|ts|mts|jsx|tsx|py|sh|rb|go|rs|java)$/;

/**
 * URL 清单：扫源码里的 `https?://host/...` 字面量。
 * @returns {{url:string, host:string, file:string, line:number, module:string}[]}
 */
export function scanUrls(text, file, moduleId) {
  const out = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue; // 注释里的示例不算事实
    for (const m of line.matchAll(/https?:\/\/[^\s'"`)\]}>]+/g)) {
      const url = m[0].replace(/[.,;:]+$/, '');
      const host = (url.match(/^https?:\/\/([^/]+)/) || [])[1] || '';
      if (!host) continue;
      out.push({ url, host: host.toLowerCase(), file, line: i + 1, module: moduleId });
    }
  }
  return out;
}

/**
 * API 清单：扫源码里的路由字面量（`'/api/...'` 这类）+ 邻近的 HTTP 方法。
 *   通用口径：① 路径以 `/` 开头且含 `api` 或至少两段 ② 同行/上一行出现 GET/POST/... 即取该方法，
 *   取不到就留空字符串（不猜）。
 * @returns {{method:string, path:string, file:string, line:number, module:string}[]}
 */
export function scanApis(text, file, moduleId) {
  const out = [];
  const lines = String(text).split('\n');
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    for (const m of line.matchAll(/['"`](\/[A-Za-z0-9_\-./{}$:]{2,120})['"`]/g)) {
      const path = m[1];
      // 只认「像 API 路由」的：含 /api/ 或 /v1/ 之类版本段
      if (!/(^|\/)(api|v\d+)(\/|$)/i.test(path)) continue;
      // 方法只从**本行**取：先看 `app.post(` / `.get(` 这类 callee，再看本行有没有裸方法名。
      //   原来用「上一行+本行+下一行」的窗口，实测把上一行的 `GET` 误安到 `app.post(...)` 上（误判）；
      //   按规范「不猜」的口径收紧——本行取不到就留空字符串。
      const callee = (line.match(/\.\s*(get|post|put|patch|delete|head|options)\s*\(/i) || [])[1];
      const bare = METHODS.find((x) => new RegExp(`\\b${x}\\b`).test(line));
      const method = (callee || bare || '').toUpperCase();
      // 区分「**定义**」与「**引用**」：注册调用里出现的是路由定义，数组/测试里出现的是引用。
      //   实测依据：Pawchive 的 server.js:21 是端点自检数组（const endpoints=[...]），
      //   那些路径本就没有方法——留空是对的，但要标明它是引用而不是定义。
      const isDef = /\.\s*(get|post|put|patch|delete|head|options)\s*\(/i.test(line)
        || /\b(route|router|addRoute|register|handle)\s*\(/.test(line)
        || /\bcase\s*['"]/.test(line)
        || /\b(pathname|url)\s*===/.test(line);
      out.push({ method, path, file, line: i + 1, module: moduleId, role: isDef ? 'define' : 'reference' });
    }
  }
  return out;
}

/**
 * 函数清单：由 `scanFileFuncs` 的产出转成 IR 条目（**同一扫描器**，保证与 docs/FUNCTIONS.md 一致）。
 * @param {{file:string,funcs:{name:string,kind:string,defLine:number,endLine:number,lines:number}[]}} scan
 * @returns {{name:string,file:string,line:number,endLine:number,kind:string,lines:number,module:string}[]}
 */
export function functionsFromScan(scan, moduleId) {
  return (scan?.funcs || []).map((f) => ({
    name: f.name,
    file: scan.file,
    line: f.defLine ?? 0,
    endLine: f.endLine ?? 0,
    kind: f.kind || 'function',
    lines: f.lines ?? 0,
    module: moduleId,
  }));
}

/**
 * 文件清单：把「已收集文件 + 每文件的统计」整理成 IR 条目。
 * @param {{path:string, lines:number, funcs:number, isSource:boolean}[]} entries
 */
export function fileEntries(entries) {
  return entries.map((e) => ({
    path: e.path,
    lines: e.lines || 0,
    funcs: e.funcs || 0,
    isSource: !!e.isSource,
  }));
}
