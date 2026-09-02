/**
 * dsh-code-audit — L1 LLM 深度审查（可选，默认关闭以省钱）
 *
 * 把变更 diff 喂给便宜模型（如 deepseek-chat），返回问题清单 + 修复建议。
 * 依赖 ctx.get('llm') 服务（DSH 已配置的 provider）。llm 不可用时跳过（不阻断）。
 */
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';

const AUDIT_SYSTEM = [
  '你是资深代码审查员，审查 AI 生成的代码变更（git diff）。',
  '找出真实问题：逻辑错误、边界条件、安全问题（注入/路径穿越/敏感信息）、未处理的错误、死代码、明显缺陷。',
  '只报告确定的问题，不要表扬、不要泛泛而谈。',
  '输出严格 JSON，不要任何其他文字、解释、Markdown 或代码块标记：',
  '{"findings":[{"file":"相对路径","line":行号或0,"level":"blocker|warning","message":"一句话问题","suggestion":"修复建议"}]}',
  '没有问题时输出 {"findings":[]}',
].join('\n');

/**
 * LLM 审查一个 diff。
 * @param {object} opts
 * @param {object} opts.llm - ctx.get('llm')
 * @param {string} opts.diff - git diff 文本
 * @param {object} opts.route - {provider, model}
 * @param {number} [opts.maxDiffBytes] - diff 截断上限
 * @param {string} [opts.sessionId]
 * @param {string} [opts.purpose]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ok:true, findings:Array}|{ok:false, error:string}>}
 */
export async function llmAudit({ llm, diff, route, maxDiffBytes = 6000, sessionId = 'code-audit', purpose = 'code-audit', signal } = {}) {
  if (!llm || !route?.provider || !route?.model) {
    return { ok: false, error: 'llm 服务或路由不可用' };
  }
  if (!diff || !diff.trim()) return { ok: true, findings: [] };
  const trimmed = diff.length > maxDiffBytes ? `${diff.slice(0, maxDiffBytes)}\n...(截断，共 ${diff.length} 字节)` : diff;

  const text = `以下是 AI 生成的代码变更 diff，请审查：\n\`\`\`diff\n${trimmed}\n\`\`\``;
  const options = {
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-code-audit' } })],
    system: AUDIT_SYSTEM,
    maxTokens: 1000,
    sessionId,
    purpose,
    ...(signal ? { signal } : {}),
  };

  try {
    const assembler = new BlockAssembler();
    for await (const chunk of llm.stream(options)) assembler.push(chunk);
    const raw = assembler.blocks().filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    const findings = parseFindingsJson(raw);
    return { ok: true, findings, raw };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** 解析 LLM 输出的严格 JSON（容忍代码块围栏与多余文本）。 */
export function parseFindingsJson(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    const list = Array.isArray(parsed.findings) ? parsed.findings : [];
    return list
      .filter((f) => f && typeof f.message === 'string')
      .map((f) => ({
        rule: 'llm',
        level: f.level === 'blocker' ? 'blocker' : 'warning',
        file: typeof f.file === 'string' ? f.file : '',
        line: Number(f.line) || 0,
        message: f.message.slice(0, 300),
        suggestion: typeof f.suggestion === 'string' ? f.suggestion.slice(0, 300) : '',
      }));
  } catch {
    return [];
  }
}
