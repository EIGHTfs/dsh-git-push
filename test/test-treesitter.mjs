// tree-sitter 接线回归（方案 C 阶段 2）：语法路径 + **回退路径**。
//
// 三条断言，各有不可替代的作用：
//   ① 加载器单元：资产可用、confirmHits 判定正确（字符串/注释 ⇒ 丢弃，真实代码 ⇒ 保留）
//   ② 端到端（有资产）：字符串字面量里的 while(true) 不报、真实空体死循环仍报（双向）
//   ③ **能区分两条路径的判别用例**：正则字面量 `/while (true) {}/` ——
//      token 级（2.8.9）**抓不到**（tokenizer 不认识正则字面量 ⇒ 该行被当普通代码行 ✗），
//      语法树**能抓到**（节点类型 regex_pattern ⇒ 不透明 ⇒ 丢弃 ✓）。
//      ⇒ 有资产时不报、无资产时报回来，才能证明「语法路径真的在跑」且「回退真的生效」✓
//      （只跑①的样本两条路径结果相同，测不出接线是否生效 ✗）
//
// 回退用**子进程 + env 覆盖**（ASSETS_DIR 在模块加载时求值 ⇒ 同进程 import 换不掉 ✗）：
//   DSH_GIT_PUSH_TS_ASSETS=<临时目录下不存在的路径>（用 join(tmpdir(),...) 计算，避免绝对路径字面量 ✗）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = process.cwd();

/** 造一个临时 git 仓库（审计的文件收集走 git ⇒ 必须 add，否则收不到 ✗）。 */
function makeRepo(files) {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-ts-'));
  execFileSync('git', ['init', '-q'], { cwd: tmp });
  mkdirSync(join(tmp, 'src'), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(tmp, 'src', name), content, 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: tmp });
  return tmp;
}

/** 子进程里跑一次审计，返回 busy-wait-loop 命中文件名（排序）。 */
function auditHits(repo, extraEnv = {}) {
  const code = `
    import { auditWithScope } from ${JSON.stringify(join(REPO_ROOT, 'lib/audit/orchestrate.js'))};
    const r = await auditWithScope(${JSON.stringify(repo)}, { scope: 'full', maxScanFiles: 1000, disabledSlots: [] });
    const out = (r.findings || [])
      .filter((f) => f.rule === 'performance/busy-wait-loop')
      .map((f) => String(f.file).replace(/\\\\/g, '/').split('/').pop())
      .sort();
    console.log('HITS=' + JSON.stringify(out));
  `;
  const res = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: REPO_ROOT, env: { ...process.env, ...extraEnv }, encoding: 'utf8', timeout: 120000,
  });
  const line = res.split('\n').find((l) => l.startsWith('HITS=')) || 'HITS=[]';
  return JSON.parse(line.slice(5));
}

const NO_ASSETS = { DSH_GIT_PUSH_TS_ASSETS: join(tmpdir(), 'dsh-no-such-assets-dir') };

test('① 加载器：资产可用 + confirmHits 判定正确（列/节点）', async () => {
  assert.ok(existsSync(join(REPO_ROOT, 'assets/tree-sitter/tree-sitter.js')), '运行时 JS 应已落库');
  const { treesitterAvailable, availableGrammars, confirmHits } = await import('../lib/ast/treesitter.js');
  assert.equal(treesitterAvailable(), true, '资产应就位');
  const grams = availableGrammars();
  for (const g of ['javascript', 'typescript', 'python']) assert.ok(grams.includes(g), `应有 ${g} 语法`);

  const lines = [
    "export const s = { script: 'while (true) {}' };",
    'export function f() { while (true) {} }',
    '// while (true) {} 注释',
  ];
  const text = lines.join('\n');
  const col = (n, needle) => lines[n - 1].indexOf(needle) + 1;
  const r = await confirmHits({
    text, ext: 'mjs',
    hits: [{ line: 1, col: col(1, 'while') }, { line: 2, col: col(2, 'while') }, { line: 3, col: col(3, 'while') }],
  });
  assert.equal(r.used, true, '有语法时应使用语法树');
  assert.deepEqual(r.keep, [false, true, false], '字符串/注释内 ⇒ 丢弃；真实代码 ⇒ 保留');
});

test('② 端到端（有资产）：字符串内不报、真实空体死循环仍报', () => {
  const tmp = makeRepo({
    'str.mjs': "export const s = { script: 'while (true) {}' };\n",
    'real.mjs': 'export function f() { while (true) {} }\n',
  });
  try {
    assert.deepEqual(auditHits(tmp), ['real.mjs'], '应只报真实死循环');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('③ 判别用例：正则字面量里的 while(true)——有资产不报、无资产报回来（证明语法路径在跑 + 回退生效）', () => {
  const tmp = makeRepo({ 're.mjs': 'export const re = /while (true) {};/;\n' });
  try {
    const withAssets = auditHits(tmp);
    const withoutAssets = auditHits(tmp, NO_ASSETS);
    assert.deepEqual(withAssets, [], '有语法树时应识别出这是正则字面量 ⇒ 不报');
    assert.deepEqual(withoutAssets, ['re.mjs'], '无资产时回退 token 级 ⇒ tokenizer 不认识正则字面量 ⇒ 报回来（证明回退生效）');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
