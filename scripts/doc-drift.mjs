#!/usr/bin/env node
// dsh-skip-i18n: CLI 输出硬编码中文为产品行为（无 i18n 需求）
/**
 * doc-drift.mjs — 文档计数与代码实际值的一致性校验（只读，不写盘）
 *
 * 为什么需要它（2026-10-11 实测）：同一事实在多处手写必然分叉——
 *   · README 写「14 个规则包 / 14 个规则槽位」，实际 `lib/audit-rules/` 有 21 个 yml；
 *   · `docs/功能-审计规则体系.md` 写「124 条规则」、`docs/SPEC.md` 写「122 条规则」，
 *     而实际规则条数是 125（`^  - id:` 两空格缩进的规则行）。
 *   三份文档三个数字，改一处不会带动其它处 ⇒ 本脚本把它变成"提交前机器能拦"。
 *
 * 计数口径（单一事实源）：
 *   · 槽位数 = `lib/audit-rules/*.yml` 文件数（目录即清单，放文件即生效）；
 *   · 规则条数 = 所有 yml 里 `^  - id:` 行数（rules 列表下两空格缩进的正规规则行）。
 *
 * 用法：
 *   node scripts/doc-drift.mjs            # 校验（不一致 exit 1）
 *   node scripts/doc-drift.mjs --json     # 机器可读
 *   node scripts/doc-drift.mjs --quiet    # 只输出结论
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const quiet = argv.includes('--quiet');

/** 统计槽位（yml 文件）与规则条数（`^  - id:`）。 */
export function countRules(root = ROOT) {
  const dir = join(root, 'lib', 'audit-rules');
  if (!existsSync(dir)) return { slots: 0, rules: 0, files: [] };
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml')).sort();
  let rules = 0;
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    rules += (text.match(/^ {2}- id:/gm) || []).length;
  }
  return { slots: files.length, rules, files };
}

/** 待校验的文档（存在才查）。 */
function docFiles(root = ROOT) {
  const cands = [
    join(root, 'README.md'),
    join(root, 'docs', 'SPEC.md'),
    join(root, 'docs', '功能-审计规则体系.md'),
    join(root, 'docs', 'FUNCTIONS.md'),
  ];
  return cands.filter((p) => existsSync(p));
}

/**
 * 扫描文档里手写的计数并比对实际值。
 * 覆盖**全部出现处**（README 里"14 个规则包"曾出现在多行，只查第一处会漏）。
 * @returns {Array<{file:string,line:number,text:string,kind:string,doc:number,actual:number}>}
 */
export function findCountDrift(root = ROOT, actual = countRules(root), toolCount = null) {
  const issues = [];
  // ①「N 个规则包 / N 个规则槽位 / N 个槽位」→ 比槽位数
  const slotRe = /(\d+)\s*个(?:规则)?(?:包|槽位)/g;
  // ②「N 条规则」→ 比规则条数
  const ruleRe = /(\d+)\s*条规则/g;
  // ③「N 个工具」→ 比 listTools() 条数（**用真实 API 取口径**，不用正则数代码）
  const toolRe = /(\d+)\s*个工具/g;
  const tools = toolCount;
  for (const file of docFiles(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      const pairs = [[slotRe, '槽位数', actual.slots], [ruleRe, '规则条数', actual.rules]];
      if (tools !== null) pairs.push([toolRe, '工具数', tools]);
      for (const [re, kind, want] of pairs) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          const doc = Number(m[1]);
          if (doc !== want) {
            issues.push({ file: relative(root, file), line: i + 1, text: m[0], kind, doc, actual: want });
          }
        }
      }
    });
  }
  return issues;
}

/**
 * 工具数（真实口径）：直接调用插件自己的 `listTools()`——它是宿主注册表的唯一出口，
 * 比用正则数代码里的 `name:` 可靠（本次实测：正则数不出，API 一调就是 16）。
 * 取不到（环境缺依赖等）返回 null，调用方跳过该项校验（不误报）。
 */
export async function countToolsAsync(root = ROOT) {
  try {
    const mod = await import('file://' + join(root, 'lib', 'app', 'tools.js'));
    const list = typeof mod.listTools === 'function' ? mod.listTools() : null;
    return Array.isArray(list) ? list.length : null;
  } catch {
    return null;
  }
}

async function main() {
  const actual = countRules(ROOT);
  const toolCount = await countToolsAsync(ROOT);
  const issues = findCountDrift(ROOT, actual, toolCount);
  if (asJson) {
    console.log(JSON.stringify({ ok: issues.length === 0, actual, issues }, null, 2));
    process.exit(issues.length ? 1 : 0);
  }
  if (!quiet) console.log(`实际值：${actual.slots} 个槽位 / ${actual.rules} 条规则（lib/audit-rules/）`);
  if (!issues.length) {
    console.log('文档计数一致性 ✅');
    process.exit(0);
  }
  console.error('文档计数与代码不一致 ❌（改代码后请同步这些位置，或改为脚本生成）：');
  for (const it of issues) {
    console.error(`  ${it.file}:${it.line}  写的「${it.text}」→ 实际 ${it.kind} ${it.actual}`);
  }
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
