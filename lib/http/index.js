/**
 * dsh-git-push HTTP 总入口（鉴权中间件纯函数 + 端点处理器骨架）
 * dsh-skip-i18n: 插件为中文零依赖 CLI（无 i18n 框架需求），用户可见文案硬编码为产品设计
 *
 * 0.1.7：HTTP 写端点鉴权逻辑抽为纯函数（不依赖真实服务器，可单测），
 * 1.0.0 接线时直接注入 req/res 使用：
 *   - Origin 校验：写请求（POST/PUT/PATCH/DELETE）无 Origin 或跨源 → 403
 *   - 写确认（confirm）：破坏性操作（rebuild/rollback 等）body 必须显式 confirm:true，否则 400
 *   - 413：请求体过大拒绝（5MB 上限，防恶意大 body 打爆内存）
 *   - GET 只读端点免 Origin 校验（CSRF 攻击面只存在于写请求）
 */
export const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB 上限

/** 写方法集合（CSRF/Origin 校验仅作用于写方法）。 */
export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 常用读方法。 */
export const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const ALLOWED_ORIGINS = new Set(['http://127.0.0.1', 'http://localhost', 'http://[::1]']);

/**
 * 从 Origin / Host 值里取主机名：去 scheme、去端口、剥 IPv6 方括号。
 * 为什么不用简单的 `^([^/:]+)`：那会在 `http://[::1]:3080` 上止步于 `[`，
 *   把 IPv6 回环判成未知主机（同源判定失效）。
 * @param {string} value 如 "http://127.0.0.1:3080" / "10.10.10.4:3080" / "dsh-app://app"
 * @returns {string} 主机名（取不到返回空串）
 */
export function hostNameOf(value = '') {
  const text = String(value || '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  if (!text) return '';
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    return end > 0 ? text.slice(1, end) : '';
  }
  const match = /^([^/:]+)(?::\d+)?/.exec(text);
  return match ? match[1] : '';
}

/**
 * 是否本机回环主机（127.0.0.1 / localhost / ::1）。
 * 用途：无 Origin 的写请求只允许来自「本机」——桌面壳转发的目标恒是回环地址，
 *   而局域网直连（Host 是 10.x/192.168.x）不享受该放行，避免给局域网开 CSRF 口子。
 * @param {string} value Origin 或 Host 值
 * @returns {boolean}
 */
export function isLoopbackHost(value = '') {
  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
  // ① 先按**裸地址**判：`socket.remoteAddress` 给的就是裸形态（`127.0.0.1` / `::1` /
  //    `::ffff:127.0.0.1`），没有 scheme、没有方括号、IPv6 也不带端口。
  //    hostNameOf 的 `^([^/:]+)` 对裸 IPv6（以 `:` 开头）会解析成空串 ⇒ 必须先在这里判。
  const raw = String(value || '').trim().toLowerCase();
  const bare = raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw;
  if (LOOPBACK.has(bare)) return true;
  // ② 再退回 hostNameOf：处理带 scheme / 端口 / IPv6 方括号的 Origin 与 Host 头。
  let name = hostNameOf(value).toLowerCase();
  if (name.startsWith('::ffff:')) name = name.slice('::ffff:'.length);
  return LOOPBACK.has(name);
}

/**
 * 是否 JSON 请求体（忽略 charset 等参数）。
 * 用途：无 Origin 写请求的放行判据——跨站表单设不出 application/json。
 * @param {string} contentType Content-Type 头值
 * @returns {boolean}
 */
export function isJsonContentType(contentType = '') {
  return String(contentType || '').toLowerCase().split(';')[0].trim() === 'application/json';
}

/**
 * Origin 校验：写请求必须带同源 Origin（可信页面来源），否则 403（防 CSRF）。
 * GET/OPTIONS 等只读请求免校验（读不产生副作用）。
 *
 * 1.0.5 侧边栏按钮（账号检查/生成 SSH 密钥）：客户端 fetch 写端点需要放行
 * **部署环境真实 Origin**——本机回环白名单只覆盖 127.0.0.1/localhost，局域网
 * GUI（如 http://10.10.10.4:3080）下会误 403。改为 CSRF 防护的标准语义：
 * Origin 主机与请求 Host 头一致 = 同源可信来源 → 放行（跨站 Origin 仍拒）。
 * 本机回环白名单保留兜底（无 Host 头/解析失败时仍可用）。
 * @param {string} method HTTP 方法（大写）
 * @param {string} [origin] Origin 请求头值（可能 undefined）
 * @param {Set<string>} [allowed] 允许的源集合（默认本机回环，测试可注入）
 * @param {string} [host] 请求 Host 头值（如 "10.10.10.4:3080"；同源放行依据）
 * @param {string} [contentType] Content-Type 请求头值（无 Origin 时的放行判据之一）
 * @param {string} [remoteAddress] TCP 对端地址（`req.socket.remoteAddress`；**比 Host 头可信**）
 * @returns {{ok: boolean, status?: number, code?: string, message?: string}}
 *   ok=true 放行；ok=false 时带 status/code/message
 */
export function checkOrigin(method = '', origin = '', allowed = ALLOWED_ORIGINS, host = '', contentType = '', remoteAddress = '') {
  const methodUpper = String(method || '').toUpperCase();
  if (!WRITE_METHODS.has(methodUpper) && !READ_METHODS.has(methodUpper)) {
    return { ok: false, status: 405, code: 'METHOD', message: `不支持的 HTTP 方法: ${method}` };
  }
  if (READ_METHODS.has(methodUpper)) return { ok: true }; // 只读免校验
  const originStr = String(origin || '').trim();
  if (!originStr) {
    // 桌面端（dsh-app:// 自定义协议）放行通道。
    //   桌面壳 forwardWebRequest 转发 /api/* 到后端时**显式剥离 Origin**
    //   （headers.delete('origin')，只补 cookie），于是写请求到这里 Origin 恒为空。
    //   若不特判，桌面版设置页的**所有保存/开关/按钮**都会 403，而 GET 免校验照常
    //   —— 表现为「页面能打开、保存永不生效、回显旧值」，且拒绝发生在 handler 之前
    //   连日志都不留，用户无从自查（外部报告已完整复现并定位到桌面壳源码）。
    // 放行判据取三条同时成立，CSRF 防护不降级：
    //   ① **Content-Type 是 application/json**：浏览器跨站表单（text/plain /
    //      urlencoded / multipart）设不出这个 CT；fetch/XHR 设 JSON CT 属非简单请求 →
    //      触发 CORS 预检，而本 API 从不回 CORS 许可头 ⇒ 预检失败，真实请求发不出去。
    //   ② **Host 是回环地址**：桌面壳转发目标是 127.0.0.1:<port>；服务若监听
    //      0.0.0.0，局域网上的机器发「无 Origin + JSON」的写请求仍会被拒，CSRF 面不扩大。
    //   ③ 浏览器发起的写请求**必带 Origin** ⇒ 走下方既有同源/跨源判定，不受本分支影响。
    //    ②' **本机判定以 TCP 对端地址为准，Host 只作补充**：
    //      Host 头是客户端可控的（构造 `Host: 127.0.0.1` 即可伪造），
    //      而 `socket.remoteAddress` 由内核给出、无法伪造 ⇒ 有 remoteAddress 时以它定论。
    //      只在拿不到 remoteAddress（进程内/测试调用）时才退回看 Host。
    //      顺带覆盖「某些转发链路会丢 Host」的场景（实测宿主转发后 host 可能为空）。
    const fromLoopback = remoteAddress
      ? isLoopbackHost(remoteAddress)
      : isLoopbackHost(host);
    if (isJsonContentType(contentType) && fromLoopback) return { ok: true };
    return { ok: false, status: 403, code: 'NO_ORIGIN', message: '写请求缺少 Origin 头——拒绝（防 CSRF）' };
  }
  // 主机名解析：兼容带协议（Origin）与不带协议（Host 头）两种输入，忽略端口
  //   用模块级 hostNameOf（支持 IPv6 方括号与任意 scheme，如 dsh-app://）
  const hostOf = hostNameOf;
  const oHost = hostOf(originStr);
  // 同源放行（1.0.5）：Origin 主机与请求 Host 一致 = 可信页面自身发起的请求（防跨站 CSRF 的核心）
  const hHost = hostOf(host);
  if (oHost && hHost && oHost === hHost) return { ok: true };
  // 白名单兜底（本机回环；无 Host 头或解析失败场景）
  const allowedHit = !!oHost && [...allowed].some((a) => hostOf(a) === oHost);
  if (!allowedHit) {
    return { ok: false, status: 403, code: 'CROSS_ORIGIN', message: `跨源写请求被拒绝: ${originStr}` };
  }
  return { ok: true };
}

/**
 * 写确认校验：破坏性操作端点（rebuild/rollback/drop-versions 等）body 必须显式 confirm:true。
 * @param {object} body 已解析的请求体
 * @param {boolean} [forceHttpSafe] 测试可注入：false 时非 confirm 拒绝（默认按真实逻辑）
 * @returns {{ok: boolean, status?: number, code?: string, message?: string}}
 */
export function checkWriteConfirm(body = {}) {
  if (body && body.confirm === true) return { ok: true };
  return {
    ok: false, status: 400, code: 'NEED_CONFIRM',
    message: '破坏性操作需 body 显式 confirm:true（防误触）',
  };
}

/**
 * 请求体大小校验：超 5MB → 413（防恶意大 body 打爆内存）。
 * @param {number} byteLength 请求体字节数
 * @param {number} [limit] 上限（默认 MAX_BODY_BYTES）
 * @returns {{ok: boolean, status?: number, code?: string, message?: string, limit?: number}}
 */
export function checkBodySize(byteLength = 0, limit = MAX_BODY_BYTES) {
  if (typeof byteLength !== 'number' || Number.isNaN(byteLength) || byteLength < 0) {
    return { ok: false, status: 400, code: 'BAD_LENGTH', message: '请求体长度非法' };
  }
  if (byteLength > limit) {
    return { ok: false, status: 413, code: 'TOO_LARGE', message: `请求体超过 ${Math.round(limit / 1024 / 1024)}MB 上限`, limit };
  }
  return { ok: true };
}

/**
 * 组装端点响应体 JSON（统一形状）。
 * @param {boolean} ok
 * @param {object} [extra] 附加字段
 * @returns {object}
 */
export function httpOk(ok = true, extra = {}) {
  return { ok, ...extra };
}

/**
 * 统一鉴权流水线：Origin → 方法 → 写确认 → 体大小，全部通过返回 {ok:true}。
 * @param {object} req { method, origin, host, contentType, contentLength, isWriteConfirmOp }
 * @param {object} [opts] { allowedOrigins, bodyLimit, isWriteConfirmOp }
 * @returns {{ok: boolean, status?: number, code?: string, message?: string}}
 */
export function authPipeline({ method = '', origin = '', host = '', contentType = '', contentLength = 0, isWriteConfirmOp = false } = {}, opts = {}) {
  // host / contentType 一并传入：无 Origin 的桌面端转发判据需要它们（见 checkOrigin）
  const originCheck = checkOrigin(method, origin, opts.allowedOrigins, host, contentType);
  if (!originCheck.ok) return originCheck;
  if (opts.isWriteConfirmOp ?? isWriteConfirmOp) {
    // 写确认由调用方在解析 body 后判定（body.confirm），这里只占位返回 ok
  }
  const sizeCheck = checkBodySize(contentLength, opts.bodyLimit);
  if (!sizeCheck.ok) return sizeCheck;
  return { ok: true };
}

/**
 * 读取请求体并做 413 防护（流式累计，超限即终止）。
 * @param {object} req 可读流（.on/.destroy）
 * @param {function} resolve 完成回调（解析失败给 null）
 * @param {number} [limit]
 */
export function readJsonBody(req, resolve = () => {}, limit = MAX_BODY_BYTES) {
  let bodyText = '';
  let over = false;
  const done = () => {
    if (over) return resolve(null);
    try { resolve(JSON.parse(bodyText || '{}')); } catch { resolve({}); }
  };
  req.on('data', (c) => {
    bodyText += c;
    if (bodyText.length > limit) {
      over = true;
      bodyText = '';
      try { req.destroy(); } catch { /* 已断开 */ }
    }
  });
  req.on('end', done);
  req.on('error', () => resolve({}));
}

/**
 * 端点处理器骨架：按方法 + 路径分发，先跑鉴权再执行。
 * 1.0.0 接线真实 server 时作为路由，测试直接构造 req 对象调用。
 * @param {object} req 简化请求对象 { method, url, origin, headers }
 * @param {object} handlers 路由表 { 'GET /api/x': fn, 'POST /api/y': fn, ... }
 * @returns {{status: number, body: object}}
 */
export function routeRequest(req = {}, handlers = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  const url = String(req.url || '/');
  const path = url.split('?')[0];
  const key = `${method} ${path}`;
  const handler = handlers[key];
  if (!handler) {
    return { status: 404, body: { ok: false, code: 'NOT_FOUND', message: `无此端点: ${method} ${path}` } };
  }
  // host / content-type 一并传入：桌面端（dsh-app://）转发剥离 Origin，靠这两个头判定放行
  const originCheck = checkOrigin(method, req.origin, undefined, req.headers?.host, req.headers?.['content-type']);
  if (!originCheck.ok) return { status: originCheck.status, body: { ok: false, ...originCheck } };
  const sizeCheck = checkBodySize(Number(req.headers?.['content-length']) || 0);
  if (!sizeCheck.ok) return { status: sizeCheck.status, body: { ok: false, ...sizeCheck } };
  const handlerOut = handler({ req, url, method });
  return { status: 200, body: handlerOut };
}