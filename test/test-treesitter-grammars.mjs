// 多语言 AST 接通自检：每个语言的映射、真机解析、精筛判定，以及**取不到语法时的回退**。
//
// 为什么需要这层测试（而不只是「映射表写对了」）：
//   ① 语法名写错（如把 C# 写成 csharp 而不是 c_sharp）不会报错，只会**静默回退**到 token 级 ——
//      表现是「规则好像接不通」，靠肉眼看不出来，必须拿 wasms 包 out/ 的真实文件名逐个核对。
//   ② 语法与运行时 ABI 不匹配时同样静默回退（历史实测：web-tree-sitter@0.27.1 + 本套语法
//      在 getDylinkMetadata 处报空消息错误），只有真机解析一遍才能发现。
//   ③ 精筛要证明的是「注释/字符串里的干扰不算代码」——尤其**原始字符串里带引号**这类形态：
//      token 级判定会在内层引号处提前收尾、把剩余部分当代码 ⇒ 报出假命中；语法树能正确整段判为字符串。
//      只用「注释干扰」的样本两条路径结果相同，测不出语法树到底有没有在跑。
//   ④ D5 铁律：资产/依赖缺失只许回退，不许抛错、不许整体失效。用 env 覆盖到不存在的目录跑同一批断言，
//      此时用例改为验证**回退契约**（parseText 返回 null、confirmHits 返回 used:false），而不是宽松跳过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  EXT_TO_GRAMMAR, parseText, confirmHits, availableGrammars, treesitterAvailable,
} from '../lib/ast/treesitter.js';
import { TEXT_EXT } from '../lib/audit/collector.js';

const REPO_ROOT = process.cwd();

/** 是否处于「显式指定了不存在的资产目录」的回退实验（D5 验证用）。 */
const ASSETS_OVERRIDE = process.env.DSH_GIT_PUSH_TS_ASSETS || '';
const FALLBACK_ARM = Boolean(ASSETS_OVERRIDE) && !existsSync(ASSETS_OVERRIDE);
/** 语法资产是否真的可用（依赖装好 + wasm 齐全）。 */
const ASSETS_READY = !FALLBACK_ARM && treesitterAvailable();

/**
 * 每语言一条样本，三条命中位置各代表一种形态：
 *   hit0 注释行（两种判定都应丢弃）、hit1 **原始/逐字字符串内**（只语法树能正确丢弃）、hit2 真实代码（必须保留）。
 * `root` 是该语法的根节点类型——写错说明拿到的根本不是这个语言的语法。
 */
const CASES = [
  {
    lang: 'C#', ext: 'cs', grammar: 'c_sharp', root: 'compilation_unit',
    hitLines: [1, 2, 3],
    lines: [
      '// 注释干扰：while (true) { } 只是说明文字',
      'class A { const string S = @"他说 ""while (true) { }"" 在逐字字符串里"; }',
      'class B { void F() { while (true) { } } }',
    ],
  },
  {
    lang: 'C', ext: 'c', grammar: 'c', root: 'translation_unit',
    hitLines: [1, 2, 3],
    lines: [
      '/* 注释干扰：while (true) { } */',
      'const char* s = "他说 \\"while (true) { }\\" 在字符串里";',
      'void f(void) { while (true) { } }',
    ],
  },
  {
    lang: 'C++', ext: 'cpp', grammar: 'cpp', root: 'translation_unit',
    hitLines: [1, 2, 3],
    lines: [
      '// 注释干扰：while (true) { }',
      'const char* s = R"(他说 "while (true) { }" 在原始字符串里)";',
      'void f() { while (true) { } }',
    ],
  },
  {
    lang: 'Go', ext: 'go', grammar: 'go', root: 'source_file',
    hitLines: [1, 3, 4],
    lines: [
      '// 注释干扰：while (true) { }',
      'package demo',
      'var s = "他说 \\"while (true) { }\\" 在字符串里"',
      'func f() { for { } }',
    ],
  },
  {
    lang: 'Java', ext: 'java', grammar: 'java', root: 'program',
    hitLines: [1, 2, 3],
    lines: [
      '// 注释干扰：while (true) { }',
      'class S { String s = "他说 \\"while (true) { }\\" 在字符串里"; }',
      'class A { void f() { while (true) { } } }',
    ],
  },
  {
    lang: 'Kotlin', ext: 'kt', grammar: 'kotlin', root: 'source_file',
    hitLines: [1, 2, 3],
    lines: [
      '// 注释干扰：while (true) { }',
      'val s = "他说 \\"while (true) { }\\" 在字符串里"',
      'fun f() { while (true) { } }',
    ],
  },
  {
    lang: 'PHP', ext: 'php', grammar: 'php', root: 'program',
    hitLines: [1, 2, 3],
    lines: [
      '<?php // 注释干扰：while (true) { }',
      '$s = "他说 \\"while (true) { }\\" 在字符串里";',
      'while (true) { }',
    ],
  },
  {
    lang: 'Rust', ext: 'rs', grammar: 'rust', root: 'source_file',
    hitLines: [1, 2, 3],
    lines: [
      '// 注释干扰：while (true) { }',
      'const S: &str = r##"他说 "while (true) { }" 在原始字符串里"##;',
      'fn f() { while (true) { } }',
    ],
  },
  {
    lang: 'Swift', ext: 'swift', grammar: 'swift', root: 'source_file',
    hitLines: [1, 2, 3],
    lines: [
      '// 注释干扰：while (true) { }',
      'let s = "他说 \\"while (true) { }\\" 在字符串里"',
      'func f() { while true { } }',
    ],
  },
];

/** 收集语法树里的 ERROR / MISSING 节点（hasError 只覆盖 ERROR，MISSING 要自己走一遍）。 */
function countBrokenNodes(tree) {
  let broken = 0;
  const walk = (node) => {
    if (!node) return;
    if (node.isError || node.isMissing || node.type === 'ERROR') broken += 1;
    for (let i = 0; i < node.childCount; i += 1) walk(node.child(i));
  };
  walk(tree.rootNode);
  return broken;
}

const textOf = (c) => c.lines.join('\n');
/** 某行里第一次出现 needle 的列号（1 基，命中位置按列定位需要）。 */
const colOf = (c, lineIdx, needle = 'while') => c.lines[lineIdx - 1].indexOf(needle) + 1;

test('映射表：10 个语言族的扩展名都指向语法名，且语法名在 wasms 包里真实存在', () => {
  // 期望映射（按实际语法能力确定，.h 归 cpp 的理由见 treesitter.js 注释）
  const expected = {
    cs: 'c_sharp', c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
    go: 'go', java: 'java', kt: 'kotlin', php: 'php', phtml: 'php', rs: 'rust', swift: 'swift',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', py: 'python',
  };
  for (const [ext, grammar] of Object.entries(expected)) {
    assert.equal(EXT_TO_GRAMMAR[ext], grammar, `扩展名 .${ext} 应映射到 ${grammar}`);
  }
  if (FALLBACK_ARM) return; // 回退实验里读不到 wasms 目录，语法名存在性无从核对（见下一条）
  const available = availableGrammars();
  assert.ok(available.length > 0, 'wasms 包应至少提供一个语法');
  for (const grammar of new Set(Object.values(EXT_TO_GRAMMAR))) {
    assert.ok(available.includes(grammar), `EXT_TO_GRAMMAR 里的语法 ${grammar} 在 wasms 包 out/ 里不存在（写错名会静默回退）`);
  }
});

test('门禁：EXT_TO_GRAMMAR 的每个扩展名都必须在 TEXT_EXT 收集白名单里', () => {
  // 「映射了语法」与「放行收集」是两处必须同时改的开关，但它俩只靠人记：
  //   历史两次漏改（php/swift 只补了规则包、mts/cts 只映射了语法）都表现为「规则写了永远 0 命中」，
  //   排查成本极高（要看收集层才能发现）。这条断言把该约束变成回归红灯。
  // 反向不设断言：TEXT_EXT 有、EXT_TO_GRAMMAR 没有是合法的——那些扩展名走 token 级回退。
  const missing = Object.keys(EXT_TO_GRAMMAR).filter((ext) => !TEXT_EXT.has(ext));
  assert.deepEqual(missing, [], `这些扩展名映射了语法却没进收集白名单（文件不会进管道）：${missing.join(', ')}`);
});

test('真机解析：每个语言 0 个 ERROR/MISSING 节点，根节点类型符合预期', async (t) => {
  if (!ASSETS_READY) {
    // D5：资产不可用时只许回退，不许抛错。这里把断言改成**回退契约**，而不是跳过。
    const tree = await parseText(CASES[0].lines.join('\n'), CASES[0].grammar);
    assert.equal(tree, null, '无资产时 parseText 应返回 null（调用方据此回退），而不是抛错');
    t.diagnostic('回退实验：语法资产不可用，已按 D5 断言回退契约（未校验解析结果）');
    return;
  }
  for (const c of CASES) {
    const tree = await parseText(textOf(c), c.grammar);
    assert.ok(tree, `${c.lang} 应能解析出语法树（拿不到树 ⇒ 该语言静默回退成 token 级）`);
    assert.equal(tree.rootNode.type, c.root, `${c.lang} 根节点类型应为 ${c.root}`);
    assert.equal(countBrokenNodes(tree), 0, `${c.lang} 样本不应有 ERROR/MISSING 节点`);
  }
});

test('精筛判定：注释与（带引号的）原始字符串不算代码，真实代码保留', async (t) => {
  if (!ASSETS_READY) {
    const r = await confirmHits({ text: textOf(CASES[0]), ext: CASES[0].ext, hits: [{ line: 3, col: 30 }] });
    assert.equal(r.used, false, '无资产时 confirmHits 必须返回 used:false 让调用方回退（D5）');
    t.diagnostic('回退实验：已断言 confirmHits 走回退契约');
    return;
  }
  for (const c of CASES) {
    const hits = c.hitLines.map((line) => ({ line, col: colOf(c, line) }));
    const r = await confirmHits({ text: textOf(c), ext: c.ext, hits });
    assert.equal(r.used, true, `${c.lang} 应使用语法树判定`);
    assert.deepEqual(r.keep, [false, false, true],
      `${c.lang}：注释行与带引号的原始字符串应被丢弃、真实代码应保留（token 级会在内层引号处误判为代码）`);
  }
});

/** 造临时 git 仓库（审计的文件收集走 git ⇒ 必须 add）。 */
function makeRepo(files) {
  const sandbox = mkdtempSync(join(tmpdir(), 'dsh-ts-grammars-'));
  execFileSync('git', ['init', '-q'], { cwd: sandbox });
  mkdirSync(join(sandbox, 'src'), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(sandbox, 'src', name), content, 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: sandbox });
  return sandbox;
}

/** 端到端：跑一次审计，返回指定规则命中的文件名（排序）。 */
function auditRuleHits(repo, rule) {
  const code = `
    import { auditWithScope } from ${JSON.stringify(join(REPO_ROOT, 'lib/audit/orchestrate.js'))};
    const r = await auditWithScope(${JSON.stringify(repo)}, { scope: 'full', maxScanFiles: 1000 });
    const out = (r.findings || []).filter((f) => f.rule === ${JSON.stringify(rule)})
      .map((f) => String(f.file).replace(/\\\\/g, '/').split('/').pop()).sort();
    console.log('HITS=' + JSON.stringify(out));
  `;
  const res = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: REPO_ROOT, env: process.env, encoding: 'utf8', timeout: 180000,
  });
  const line = res.split('\n').find((l) => l.startsWith('HITS=')) || 'HITS=[]';
  return JSON.parse(line.slice(5));
}

test('端到端：原始字符串里的 while(true) 在有树时不报（C++/Rust/C# 三个新语言）', () => {
  const sandbox = makeRepo({
    'raw.cpp': 'void f() { const char* s = R"(他说 "while (true) { }" 在原始字符串里)"; }\n',
    'raw.rs': 'const S: &str = r##"他说 "while (true) { }" 在原始字符串里"##;\n',
    'raw.cs': 'class A { const string S = @"他说 ""while (true) { }"" 在逐字字符串里"; }\n',
  });
  try {
    const hits = auditRuleHits(sandbox, 'performance/busy-wait-loop');
    if (ASSETS_READY) {
      assert.deepEqual(hits, [], '有语法树时这三段都只是字符串 ⇒ 不该报死循环');
    } else {
      // 回退实验：token 级判定会在内层引号处收尾、把剩余部分当代码 ⇒ 报回来，正好证明回退生效且不崩
      assert.ok(hits.length > 0, '无语法树时回退到 token 级应报出假命中（证明回退生效、审计未被拖垮）');
    }
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});
