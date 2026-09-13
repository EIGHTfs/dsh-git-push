/**
 * Git 执行层 · 敏感信息扫描
 *
 * 职责：提交推送前扫描待入库内容里的密钥/凭据/私密文件，命中即拦。
 * 占位符与示例上下文豁免（SENSITIVE_PLACEHOLDER_VALUE / SENSITIVE_EXAMPLE_CONTEXT）
 *   保证文档里的示范值不被误报成真实凭据。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isTestExemptDir } from '../exempt/index.js';

/* ───────────────────────── 敏感文件自动 .gitignore ───────────────────────── */

const SENSITIVE_NAMES = new Set(['.env', '.env.local', 'github-token', '.git-push-token', 'id_rsa', 'id_ed25519', 'id_ecdsa', '*.pem', '*.key']);

/** 扫描仓库内敏感文件（相对路径列表）。 */
/** 递归扫描跳过的目录（与 npm 屏蔽同源 + 常见构建/缓存）。 */
const SENSITIVE_SKIP_DIRS = new Set(['.git', 'node_modules', 'node_modules.orig', '.dsh', '.trash', 'cache-gifs', 'uploads', 'dist', 'build']);

/** 明显二进制/图片/压缩/媒体扩展名，不当作文本扫描。 */
const SENSITIVE_BINARY_EXT = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','svg','zip','7z','rar','gz','tar','xz','pdf','exe','dll','so','dylib','bin','woff','woff2','ttf','otf','mp4','mp3','ogg','wav','flac','db','sqlite','ico']);

/** 敏感字段（cookie / 设备 / 用户名 / 密码 / token-secret），键名大小写不敏感。 */
const SENSITIVE_KEYS = [
  { name: 'cookie',     keys: ['cookie', 'cookies'],                                  valueMin: 4 },
  { name: 'device',     keys: ['device_id','device-id','deviceid','device_name','device-info','machine_id','machine-id','hardware_id','hardware-id','imei','serial_number','serial-number'], valueMin: 2 },
  { name: 'username',   keys: ['username','user_name','user-name','login_name','login-name'], valueMin: 2 },
  { name: 'password',   keys: ['password','passwd','pass_word','pass-word','pwd'],    valueMin: 3 },
  { name: 'token/secret', keys: ['api_key','api-key','apikey','api_secret','api-secret','access_key','access-key','auth_token','auth-token','refresh_token','refresh-token','secret_key','secret-key','client_secret','client-secret'], valueMin: 6 },
];

/** 占位符/示例值：值看起来是假的就不报（防 README/示例误伤）。 */
const SENSITIVE_PLACEHOLDER_VALUE = /^(your[-_ ]?[a-z]+|xxx+\.?\.?|example|changeme|dummy|sample|demo|placeholder|<[^>]+>|\$\{?[A-Z_][A-Z0-9_]*}?|process\.env\.[A-Z_]+|env\.[A-Z_]+|undefined|null|true|false)$/i;

/** 行内示例上下文：出现即整行豁免（举例/示例/演示）。 */
const SENSITIVE_EXAMPLE_CONTEXT = /(例如|举例|示例|样例|演示|比如|fake|sample|demo|example|illustration)/i;

/** 豁免标记：行尾注释豁免单行 / 文件头（前 3 行）声明豁免整文件（大小写不敏感）。 */
const SENSITIVE_EXEMPT_RE = /dsh-skip-sensitive/i;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 单行敏感字段匹配：返回字段名或 null（跳过豁免注释/示例行/占位符值）。 */
function sensitiveLineMatch(line) {
  if (SENSITIVE_EXEMPT_RE.test(line)) return null; // 行内注释豁免
  if (SENSITIVE_EXAMPLE_CONTEXT.test(line)) return null;
  const clean = line.replace(/^[#;/\*\s]+/, ''); // 去掉行首注释标记与空白
  for (const k of SENSITIVE_KEYS) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9_])(?:${k.keys.map(escapeRegExp).join('|')})\\s*[:=]\\s*(.*)$`, 'i');
    const m = clean.match(re);
    if (m) {
      // 值必须是「纯净字符串字面量」才算硬编码凭据：变量/函数调用/表达式/拼接/插值不算
      const raw = m[1].trim();
      const qm = raw.match(/^(["'`])([\s\S]*?)\1\s*[,;)\]}\s]*$/);
      if (!qm) continue;
      let val = qm[2].trim();
      if (/\+|\$\{/.test(val)) continue; // 拼接/模板插值 = 表达式
      if (/[\u4e00-\u9fff]/.test(val)) continue; // 值含中文 = UI 文案/说明，不是凭据（如 account: '账号检查'）
      if (val.length >= k.valueMin && !SENSITIVE_PLACEHOLDER_VALUE.test(val)) return k.name;
    }
  }
  return null;
}

/**
 * 扫描仓库全部文本文件，找出含敏感字段（cookie/device/username/password/token-secret）的文件。
 * 内容级检测：键值对 + 字符串字面量判定 + 占位符/示例/豁免注释；≤512KB、跳过二进制/图片/忽略目录。
 * 补充文件名黑名单（.env/id_rsa/*.pem 等）——名字本身就是凭据载体，无需读内容。
 * @returns {{path: string, fields: string[]}[]}
 */
export function scanSensitiveFiles(repoPath) {
  const hits = [];
  const walk = (dir, rel) => {
    let items;
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const relPath = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory()) {
        if (SENSITIVE_SKIP_DIRS.has(it.name)) continue;
        // .test 空文件豁免：整目录敏感扫描跳过（含子目录）
        if (relPath && isTestExemptDir(repoPath, relPath)) continue;
        walk(join(dir, it.name), relPath);
      } else if (it.isFile()) {
        // 文件名黑名单：名字本身就是凭据载体
        for (const n of SENSITIVE_NAMES) {
          if (n.includes('*')) {
            if (new RegExp(`^${n.replace('*', '.*')}$`).test(it.name)) { hits.push({ path: relPath, fields: ['filename'] }); break; }
          } else if (it.name === n) { hits.push({ path: relPath, fields: ['filename'] }); break; }
        }
        // 内容级：文本文件内敏感键值检测
        try {
          const st = statSync(join(dir, it.name));
          if (st.size > 512 * 1024) continue;
        } catch { continue; }
        const dot = it.name.lastIndexOf('.');
        const ext = dot >= 0 ? it.name.slice(dot + 1).toLowerCase() : '';
        if (SENSITIVE_BINARY_EXT.has(ext)) continue;
        let text;
        try { text = readFileSync(join(dir, it.name), 'utf8'); } catch { continue; }
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) continue; // 二进制内容
        if (SENSITIVE_EXEMPT_RE.test(text.split('\n').slice(0, 3).join('\n'))) continue; // 文件头豁免整文件
        const fields = [];
        for (const line of text.split('\n')) {
          const r = sensitiveLineMatch(line);
          if (r && !fields.includes(r)) fields.push(r);
          if (fields.length === SENSITIVE_KEYS.length) break;
        }
        if (fields.length) hits.push({ path: relPath, fields });
      }
    }
  };
  walk(repoPath, '');
  return hits;
}
