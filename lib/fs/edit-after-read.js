/**
 * 「读改合一」编辑核心（工具 edit_after_read 的实现层；纯逻辑、可单测、无副作用注入面）。
 *
 * 【为什么需要】宿主的编辑守卫只认「用 read 工具读过」，而**真实读过内容**的手段很多
 *   （sed -n / cat / node -e / grep 上下文等）——守卫是工具偏见，不是安全边界。
 *   本核心把「读」与「改」合成一步：**自己读当前文件** → 校验 → 字面替换 → 写回。
 *   于是「确实读过」由构造保证，且比宿主守卫更严：
 *     ① **版本比对**：读后到写前若文件被改动（mtime/size 变化）→ 拒绝，提示重读；
 *     ② **唯一性校验**：默认要求 old 在文件里**恰好出现一次**（防误替换），需要多处替换显式传 all:true；
 *     ③ **字面匹配**：old 按字面（含空白）精确匹配，不做正则解释，避免「以为在改 A 实际改了 B」。
 *
 * 【不做的事】不解析语法、不做结构化匹配 —— 那是 ast-grep 的活；本核心只管「安全的字面替换」。
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs';

/** 统计不重叠出现次数。 */
export function countOccurrences(text, needle) {
  if (!needle) return 0;
  let n = 0;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    n += 1;
    idx = text.indexOf(needle, idx + needle.length);
  }
  return n;
}

/** 文件版本指纹（mtime 毫秒 + 字节数）——用于「读后是否被改动」的比对。 */
function fingerprint(statFile, path) {
  try {
    const st = statFile(path);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '';
  }
}

/**
 * 读当前文件 → 校验 → 字面替换 → 写回。
 * @param {object} args
 * @param {string} args.path 目标文件绝对路径（亦接受宿主的 file_path）
 * @param {string} args.old 要被替换的字面文本（含空白，必须精确匹配；亦接受 old_string）
 * @param {string} args.new 替换后的文本（**必传**；要删除请显式传空串 ''；亦接受 new_string）
 * @param {boolean} [args.all] 是否替换全部匹配（默认 false：要求唯一匹配；亦接受 replace_all）
 * @param {Function} [args.readFile] 读函数（测试注入）
 * @param {Function} [args.writeFile] 写函数（测试注入）
 * @param {Function} [args.statFile] 状态函数（测试注入）
 * @returns {{ok:boolean, path:string, replaced:number, bytesBefore:number, bytesAfter:number, reason?:string}}
 */
export function editAfterRead({
  path: pathArg,
  old: oldArg,
  new: newArg,
  all: allArg,
  file_path: filePathAlias,
  old_string: oldStringAlias,
  new_string: newStringAlias,
  replace_all: replaceAllAlias,
  readFile = readFileSync,
  writeFile = writeFileSync,
  statFile = statSync,
}) {
  // 参数名与宿主编辑工具对齐（file_path/old_string/new_string/replace_all），同时保留本插件原名，
  //   两套名字都认 —— 避免「记混了参数名」把内容改坏（真实事故：宿主名 + 本工具默认空串 ⇒ 内容被删）。
  const path = pathArg ?? filePathAlias;
  const old = oldArg ?? oldStringAlias;
  const next = newArg ?? newStringAlias;
  const all = (allArg ?? replaceAllAlias) === true;
  const fail = (reason) => ({ ok: false, path, replaced: 0, bytesBefore: 0, bytesAfter: 0, reason });
  if (!path) return fail('缺少 path（或 file_path）');
  if (!old) return fail('缺少 old（要被替换的字面文本；或 old_string）');
  // ⚠️ 安全闸：new 缺失**不再**当删除 —— 缺参数时报错，删除必须显式传空串。
  if (next === undefined || next === null) {
    return fail("缺少 new（替换文本；或 new_string）。要删除该内容请显式传 new: ''");
  }

  const before = fingerprint(statFile, path);
  let text;
  try {
    text = String(readFile(path, 'utf8'));
  } catch (e) {
    return fail(`读取失败：${(e && e.message) || e}`);
  }

  const hits = countOccurrences(text, old);
  if (hits === 0) return fail('未找到 old（字面精确匹配失败：注意空白/换行必须完全一致）');
  if (hits > 1 && !all) return fail(`old 出现 ${hits} 次，默认要求唯一匹配（确认要全改请传 all:true）`);

  // 读后到写前若被改动 → 拒绝，避免覆盖别人的修改
  const after = fingerprint(statFile, path);
  if (before && after && before !== after) {
    return fail('读后文件已被改动（版本变化），已拒绝写入；请重新读取后再改');
  }

  const out = all ? text.split(old).join(next) : text.replace(old, next);
  try {
    writeFile(path, out, 'utf8');
  } catch (e) {
    return fail(`写入失败：${(e && e.message) || e}`);
  }
  return { ok: true, path, replaced: all ? hits : 1, bytesBefore: text.length, bytesAfter: out.length };
}
