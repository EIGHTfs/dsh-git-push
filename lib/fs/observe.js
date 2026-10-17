/**
 * 宿主观测台账补发（探针 / 可选增强）
 *
 * 【背景】宿主原生的 write/edit 有一道「改动前必须先读过」的门禁：
 *   packages/fs/fs-observation-policy 记录 WeakMap<owner, Map<targetKey, observation>>，
 *   而观测只由**宿主自己的 fs 读路径**发出：ctx.emit('fs/observed', target, {kind, version}, exec)。
 *   于是内容一旦来自别处（我们的 edit_after_read / cat / grep / 其它 actor / 其它调用方），
 *   原生写就会报：cannot modify "…": file has not been read — read the file, then retry。
 *   另注意两条错误的区别（实测）：版本对不上时报的是 file changed since it was read（另一条），
 *   即观测**有效到文件版本再变为止**，变了需要重新观测（我们的工具每次成功写完会自动补发 ✓）。
 *
 * 【本模块做什么】按官方同一 recipe 补发一条「present + 当前 version」的观测：
 *   1) target = await ctx.fs.resolve(path, { cwd?, signal })   ← cwd 取 exec.agent 的工作目录
 *   2) info   = await ctx.fs.stat(target, signal)              ← 拿到权威 version
 *   3) ctx.emit('fs/observed', target, { kind:'present', version: info.version }, exec)
 *   actor（第三参 exec）必须用**本次工具调用自己的 exec** —— 台账按 owner 隔离，
 *   拿错 actor 等于替别人记账（不会让当前调用方的原生写放行）。
 *
 * 【语义正当性】只在「我们工具确实读过/刚写完该文件」之后调用 ⇒ 记的是真实观测，不是伪造 ✓
 * 【失败不阻断】任何一步异常都返回 {ok:false, error}，绝不影响主流程（编辑已成功写入）✓
 *
 * @param {object} ctx  已 inject('fs') 的插件上下文（提供 fs 服务与 emit）
 * @param {object} exec 宿主工具执行上下文（含 agent/signal；即 emit 的 actor）
 * @param {string} hostPath 目标文件路径（绝对或相对会话 cwd）
 * @returns {{ok:boolean, target?:string, version?:*, error?:string}}
 */
export async function observeFileForHost(ctx, exec, hostPath) {
  if (!ctx?.emit || typeof hostPath !== 'string' || !hostPath) return { ok: false, error: '缺少 ctx/路径' };
  const fs = ctx.get?.('fs') || ctx.fs;
  if (!fs?.resolve || !fs?.stat) return { ok: false, error: 'fs 服务不可用（插件未 inject fs）' };
  try {
    // 会话 cwd：与官方 sessionResolveOptions 同口径（拿不到就按绝对路径解析）
    let cwd;
    const wd = ctx.get?.('workingDirectory');
    if (exec?.agent && wd?.ensure) {
      try { cwd = await wd.ensure(exec.agent, exec.signal); } catch { cwd = undefined; }
    }
    const target = await fs.resolve(hostPath, { ...(cwd ? { cwd } : {}), signal: exec?.signal });
    const info = await fs.stat(target, exec?.signal);
    if (!info) return { ok: false, error: '目标不存在，未发观测' };
    ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec);
    return { ok: true, target: target.displayPath, version: info.version };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
