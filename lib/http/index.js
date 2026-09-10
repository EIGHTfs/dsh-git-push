/**
 * dsh-git-push HTTP 总入口（鉴权中间件纯函数 + 端点处理器骨架）
 *
 * 0.1.7：HTTP 写端点鉴权逻辑抽为纯函数（不依赖真实服务器，可单测），
 * 1.0.0 接线时直接注入 req/res 使用：
 *   - Origin 校验：写请求（POST/PUT/PATCH/DELETE）无 Origin 或跨源 → 403
 *   - 写确认（confirm）：破坏性操作（rebuild/rollback 等）body 必须显式 confirm:true，否则 400
 *   - 413：请求体过大拒绝（5MB 上限，防恶意大 body 打爆内存）
 *   - GET 只读端点免 Origin 校验（CSRF 攻击面只存在于写请求）
 */
export const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB 上限（旧项目 A5 教训）

/** 写方法集合（CSRF/Origin 校验仅作用于写方法）。 */
export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 常用读方法。 */
export const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const ALLOWED_ORIGINS = new Set(['http://127.0.0.1', 'http://localhost', 'http://[::1]']);

/**
 * Origin 校验：写请求必须带同源 Origin（本地 GUI 来源），否则 403（防 CSRF）。
 * GET/OPTIONS 等只读请求免校验（读不产生副作用）。
 * @param {string} method HTTP 方法（大写）
 * @param {string} [origin] Origin 请求头值（可能 undefined）
 * @param {Set<string>} [allowed] 允许的源集合（默认本机回环，测试可注入）
 * @returns {{ok: boolean, status?: number, code?: string, message?: string}}
 *   ok=true 放行；ok=false 时带 status/code/message
 */
export function checkOrigin(method = '', origin = '', allowed = ALLOWED_ORIGINS) {
  const m = String(method || '').toUpperCase();
  if (!WRITE_METHODS.has(m) && !READ_METHODS.has(m)) {
    return { ok: false, status: 405, code: 'METHOD', message: `不支持的 HTTP 方法: ${method}` };
  }
  if (READ_METHODS.has(m)) return { ok: true }; // 只读免校验
  const o = String(origin || '').trim();
  if (!o) {
    return { ok: false, status: 403, code: 'NO_ORIGIN', message: '写请求缺少 Origin 头——拒绝（防 CSRF）' };
  }
  // 同源判定：比较 scheme://host（忽略端口与路径）——本地 GUI 端口任意，只校验主机同源
  const hostOf = (u) => {
    const m = /^(https?:\/\/)([^/:]+)(:\d+)?/.exec(String(u || '').trim());
    return m ? `${m[1]}${m[2]}` : '';
  };
  const oHost = hostOf(o);
  const allowedHit = !!oHost && [...allowed].some((a) => hostOf(a) === oHost);
  if (!allowedHit) {
    return { ok: false, status: 403, code: 'CROSS_ORIGIN', message: `跨源写请求被拒绝: ${o}` };
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
 * @param {object} req { method, origin, contentLength, isWriteConfirmOp }
 * @param {object} [opts] { allowedOrigins, bodyLimit, isWriteConfirmOp }
 * @returns {{ok: boolean, status?: number, code?: string, message?: string}}
 */
export function authPipeline({ method = '', origin = '', contentLength = 0, isWriteConfirmOp = false } = {}, opts = {}) {
  const originCheck = checkOrigin(method, origin, opts.allowedOrigins);
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
  let data = '';
  let over = false;
  const done = () => {
    if (over) return resolve(null);
    try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
  };
  req.on('data', (c) => {
    data += c;
    if (data.length > limit) {
      over = true;
      data = '';
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
  const originCheck = checkOrigin(method, req.origin);
  if (!originCheck.ok) return { status: originCheck.status, body: { ok: false, ...originCheck } };
  const sizeCheck = checkBodySize(Number(req.headers?.['content-length']) || 0);
  if (!sizeCheck.ok) return { status: sizeCheck.status, body: { ok: false, ...sizeCheck } };
  const result = handler({ req, url, method });
  return { status: 200, body: result };
}