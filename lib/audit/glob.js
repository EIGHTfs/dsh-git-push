/**
 * dsh-git-push glob → RegExp 转换（1.0.4，private-files 匹配用）
 *
 * 支持子集：`**`（任意层级）、`*`（单层任意）、`?`（单字符）、
 * `{a,b}`（任选一，可含通配）、`[abc]`（字符类）、`\`（转义）。
 * 语义对齐 gitignore：「** + / + id_ed25519」匹配任意深度；`*.key` 匹配任意层级的 .key。
 * 不依赖 minimatch（零依赖铁律），实现 ≤40 行，可单测。
 */
export function globToRegex(glob, anchored = true) {
  if (typeof glob !== 'string' || !glob) return null;
  let out = '';
  let i = 0;
  const s = glob;
  while (i < s.length) {
    const c = s[i];
    if (c === '*') {
      // ** 跨层级（含零级）；* 单层级内任意
      if (s[i + 1] === '*') {
        while (s[i + 1] === '*') i++; // 吸收连续星：i 停最后一个 *
        if (s[i + 1] === '/') { out += '(?:.*/)?'; i += 2; } // i 跳至 '/' 后
        else { out += '.*'; i++; }
      } else {
        out += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      out += '[^/]';
      i++;
    } else if (c === '{') {
      // {a,b} → (?:a|b)，最省实现：找配对 }
      const end = s.indexOf('}', i);
      if (end === -1) { out += '\\{'; i++; continue; }
      const inner = s.slice(i + 1, end).split(',').filter(Boolean);
      const parts = inner.map((p) => { const r = globToRegex(p, false); return r ? r.source : ''; }).filter(Boolean);
      if (parts.length) out += `(?:${parts.join('|')})`;
      i = end + 1;
    } else if (c === '[') {
      const end = s.indexOf(']', i);
      if (end === -1) { out += '\\['; i++; continue; }
      let cls = s.slice(i + 1, end).replace(/\\/g, '\\\\');
      if (cls.startsWith('!')) cls = '^' + cls.slice(1);
      out += `[${cls}]`;
      i = end + 1;
    } else if ('.+()^$|'.includes(c)) {
      out += `\\${c}`;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  try {
    return new RegExp(anchored ? `^${out}$` : out);
  } catch {
    return null; // 非法 glob → 调用方跳过
  }
}

/** 一行 glob 是否触及当前路径（供批量匹配）。 */
export function globMatch(glob, path) {
  const re = globToRegex(glob);
  return !!re && re.test(String(path));
}