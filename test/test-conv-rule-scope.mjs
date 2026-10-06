// 「对话残留」两条规则的作用域收口回归：代码归注释规则、文档归文档规则，不得重叠报同一位置。
//
// 事故：conv-user-decision（文档规则）的 exts 里混进了代码扩展名（js/mjs/ts/jsx/html 等），
//   与 documentation/comment-suspicious-detection（代码注释规则，带 blacklist + AST 精筛）
//   报同一批位置——实测 archify 上两条各报 7 条、(file:line) 交集 5 条，
//   同一条注释被两个 blocker 各拦一次（阻断项虚高）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const yml = readFileSync(join(ROOT, 'lib/audit-rules/audit-rules-comment.yml'), 'utf8');

/** 取某规则条目的 exts 数组（yml 文本解析，够用且不引依赖）。 */
function extsOf(id) {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^\\s*-\\s*id:\\s*${id.replace('/', '\\/')}\\s*$`).test(l));
  assert.ok(start >= 0, `应能找到规则 ${id}`);
  for (let i = start; i < Math.min(start + 20, lines.length); i++) {
    const m = lines[i].match(/^\s*exts:\s*\[(.*)\]\s*$/);
    if (m) return m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    if (i > start && /^\s*-\s*id:/.test(lines[i])) break; // 进入下一条规则
  }
  return [];
}

const CODE_EXTS = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'html', 'htm'];

test('conv-user-decision 只查文档扩展名（不得再含代码扩展名）', () => {
  const exts = extsOf('conv-user-decision');
  assert.ok(exts.length > 0, '应声明 exts');
  for (const e of CODE_EXTS) {
    assert.ok(!exts.includes(e), `conv-user-decision 不应含代码扩展名 ${e}（会与 comment-suspicious-detection 重复报）`);
  }
  assert.ok(exts.includes('md'), '文档规则应至少覆盖 md');
});

test('两条规则作用域不重叠（代码 vs 文档各管各域）', () => {
  const doc = extsOf('conv-user-decision');
  const code = extsOf('documentation/comment-suspicious-detection');
  const overlap = doc.filter((e) => code.includes(e));
  assert.deepEqual(overlap, [], `两条规则的 exts 不得有交集（实得 ${JSON.stringify(overlap)}）`);
});
