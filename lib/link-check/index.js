/**
 * dsh-git-push 链接判断总入口（link-check kind，0.2.0）
 *
 * 分级扣分（只 warning，**永不 blocker**——网络不可靠不应拦提交）：
 *   404 / 403 / 410  → 大扣分（-3，链接确实失效）
 *   DNS 失败         → 中扣分（-2，域名解析不了，多半是死链接）
 *   超时 / 连接失败  → 小扣分（-1，可能只是网络抖动）
 *   5xx              → 小扣分（-1，服务端临时故障）
 * flaky 域名（github.com / api.github.com / raw.githubusercontent.com / npmjs 系）：
 *   网络类错误（DNS/超时/连接）扣分 ×0.2（这些站点在受限网络下常误报）
 *
 * 检查对象：md 文档里的 http(s) 链接；去重后并发探测（默认并发 10、超时 5s，
 * 100 链接 ≤30 秒）。断网/无网络时全部判为网络类错误 → 只降级 warning，不拦提交。
 */
export const LINK_SEVERITY_SCORE = { dead: -3, dns: -2, transient: -1, ok: 0 };

/** flaky 域名后缀（网络错误扣分打折 ×0.2）。 */
export const FLAKY_HOSTS = [
  'github.com', 'api.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com',
  'codeload.github.com', 'npmjs.com', 'registry.npmjs.org', 'npm.im',
];

/** 大扣分状态码（链接确实失效）。 */
export const DEAD_STATUSES = [404, 403, 410, 451];

/** 小扣分状态码（服务端临时故障）。 */
export const TRANSIENT_STATUSES = [408, 425, 429, 500, 502, 503, 504];

/** 默认检查参数。 */
export const DEFAULT_OPTS = { concurrency: 10, timeoutMs: 5000, maxLinks: 200 };

/**
 * 判定主机是否 flaky（网络错误打折）。
 * @param {string} host 主机名（可含端口）
 * @returns {boolean}
 */
export function isFlakyHost(host = '') {
  const h = String(host).toLowerCase().split(':')[0].replace(/^www\./, '');
  return FLAKY_HOSTS.some((f) => h === f || h.endsWith('.' + f));
}

/**
 * 从文本提取 http(s) 链接（去重、去尾部标点、跳过锚点/占位符）。
 * @param {string} text 文件全文
 * @returns {Array<{url: string, line: number}>}
 */
export function extractLinks(text = '') {
  const out = [];
  const seen = new Set();
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/https?:\/\/[^\s)\]}"'`<>，。；]+/g)) {
      let url = m[0].replace(/[.,;:!?)]+$/, '');
      if (/[<>{}$]/.test(url)) continue; // 占位符/模板链接跳过
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, line: i + 1 });
    }
  }
  return out;
}

/**
 * 按探测结果分级（纯函数，便于单测）。
 * @param {object} r { status?, error?: 'dns'|'timeout'|'conn'|'other' }
 * @param {string} url 原始 URL（用于 flaky 判定）
 * @returns {{level: 'ok'|'dead'|'dns'|'transient', score: number, reason: string, flaky: boolean}}
 */
export function gradeResult(url = '', r = {}) {
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  const flaky = isFlakyHost(host);
  const status = Number(r.status || 0);
  if (status >= 200 && status < 400) {
    return { level: 'ok', score: 0, reason: `HTTP ${status}`, flaky };
  }
  if (DEAD_STATUSES.includes(status)) {
    return { level: 'dead', score: LINK_SEVERITY_SCORE.dead, reason: `HTTP ${status}（链接已失效）`, flaky };
  }
  if (TRANSIENT_STATUSES.includes(status)) {
    // 5xx/429 属"服务端临时故障"：flaky 域名打折
    const base = LINK_SEVERITY_SCORE.transient;
    const score = flaky ? Number((base * 0.2).toFixed(2)) : base;
    return { level: 'transient', score, reason: `HTTP ${status}（服务端临时故障）`, flaky };
  }
  if (status >= 400) {
    const score = flaky ? Number((LINK_SEVERITY_SCORE.dead * 0.2).toFixed(2)) : LINK_SEVERITY_SCORE.dead;
    return { level: 'dead', score, reason: `HTTP ${status}`, flaky };
  }
  // 无状态码 → 网络类错误
  const kind = r.error || 'other';
  const base = kind === 'dns' ? LINK_SEVERITY_SCORE.dns
    : (kind === 'timeout' || kind === 'conn') ? LINK_SEVERITY_SCORE.transient
      : LINK_SEVERITY_SCORE.transient;
  const score = flaky ? Number((base * 0.2).toFixed(2)) : base;
  const level = kind === 'dns' ? 'dns' : 'transient';
  return { level, score, reason: kind === 'dns' ? 'DNS 解析失败' : kind === 'timeout' ? '请求超时' : '连接失败', flaky };
}

/**
 * 单链接探测（可注入 fetcher 单测；真实实现用 globalThis.fetch + AbortSignal.timeout）。
 * @param {string} url
 * @param {object} [opts] { timeoutMs, fetcher }
 * @returns {Promise<object>} gradeResult 输出 + url/status/error
 */
export async function probeLink(url, { timeoutMs = DEFAULT_OPTS.timeoutMs, fetcher } = {}) {
  const fetchImpl = fetcher || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { url, status: 0, error: 'other', ...gradeResult(url, { error: 'other' }) };
  }
  try {
    const res = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    return { url, status: res.status, ...gradeResult(url, { status: res.status }) };
  } catch (e) {
    const msg = String(e?.message || e).toLowerCase();
    const name = String(e?.name || '');
    const error = /timeout|abort|timed out/.test(msg) || name === 'TimeoutError' ? 'timeout'
      : /enotfound|dns|getaddrinfo/.test(msg) ? 'dns'
        : /econnrefused|econnreset|fetch failed|network/.test(msg) ? 'conn'
          : 'other';
    return { url, status: 0, error, ...gradeResult(url, { error }) };
  }
}

/**
 * 批量探测（并发受限），保持输入顺序返回。
 * @param {Array<{url:string,line:number}>} links
 * @param {object} [opts] { concurrency, timeoutMs, fetcher }
 * @returns {Promise<Array<object>>}
 */
export async function probeLinks(links = [], { concurrency = DEFAULT_OPTS.concurrency, timeoutMs = DEFAULT_OPTS.timeoutMs, fetcher } = {}) {
  const results = new Array(links.length);
  let next = 0;
  const workers = new Array(Math.max(1, Math.min(concurrency, links.length || 1))).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= links.length) return;
      const item = links[i];
      const r = await probeLink(item.url, { timeoutMs, fetcher });
      results[i] = { ...r, line: item.line };
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

/**
 * 检查文本中的链接 → 统一问题对象（只 warning/notice，永不 blocker）。
 * @param {object} p { file, text, fetcher, concurrency, timeoutMs, maxLinks }
 * @returns {Promise<Array>} findings
 */
export async function checkLinks({ file = '', text = '', fetcher, concurrency, timeoutMs, maxLinks = DEFAULT_OPTS.maxLinks } = {}) {
  let links = extractLinks(text);
  if (links.length > maxLinks) links = links.slice(0, maxLinks);
  if (links.length === 0) return [];
  const probed = await probeLinks(links, { concurrency, timeoutMs, fetcher });
  const findings = [];
  for (const r of probed) {
    if (r.level === 'ok') continue;
    findings.push({
      file,
      line: r.line,
      rule: 'link-check',
      kind: 'link-check',
      severity: 'warning', // 永不 blocker：网络不可靠不应拦提交
      message: `链接检查：${r.reason}（扣分 ${Math.abs(r.score)}${r.flaky ? '，flaky 域名已打折' : ''}）`,
      dimensions: ['文档', '可维护性'],
      exemptHint: 'dsh-skip-doc（文件头=整文件免链接检查）',
      scoreImpact: Math.abs(r.score),
      url: r.url,
      linkLevel: r.level,
      flaky: r.flaky,
    });
  }
  return findings;
}

/** 汇总扣分（评分总入口消费）。 */
export function sumLinkPenalty(findings = []) {
  return Number(findings.reduce((n, f) => n + (f.scoreImpact || 0), 0).toFixed(2));
}