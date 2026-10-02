// 规则「路径白名单」（include_paths）回归：规则只该对指定文件生效。
//
// 事故：npm/version-format-triple 本意只查 package.json（version 必须 SemVer 三段），
//   却因 exts:["json"] 扫所有 json——第三方资源仓库（实测 0 个 package.json）被报 1435 条 error。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filterRulesByPath } from '../lib/checks/filter.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('filterRulesByPath：include_paths 只放行命中文件（文件名 / 路径后缀两种语义）', () => {
  const grouped = {
    regex: [
      { id: 'npm/version-format-triple', includePaths: ['package.json'] },
      { id: 'other', exts: ['json'] },
    ],
  };
  assert.equal(filterRulesByPath(grouped, 'sub/dir/package.json').regex.length, 2,
    'package.json：白名单规则与其它规则都该跑');
  assert.deepEqual(filterRulesByPath(grouped, 'assets/model.json').regex.map((r) => r.id), ['other'],
    'model.json：白名单规则不该跑（正是 1435 条误报的来源）');

  const byPath = { regex: [{ id: 'x', includePaths: ['src/lib'] }] };
  assert.equal(filterRulesByPath(byPath, 'src/lib/a.js').regex.length, 1, '含 / 的按路径后缀匹配');
  assert.equal(filterRulesByPath(byPath, 'other/a.js').regex.length, 0, '不命中路径的直接过滤掉');
});

test('结构契约：regex 编译器透传 include_paths，npm 版本规则限定 package.json', () => {
  const compiler = readFileSync(join(ROOT, 'lib/rule/compilers/regex.js'), 'utf8');
  assert.match(compiler, /includePaths:\s*Array\.isArray\(r\.include_paths\)/,
    'regex 编译器必须透传 include_paths（否则规则白名单形同虚设）');
  const yml = readFileSync(join(ROOT, 'lib/audit-rules/audit-rules-npm.yml'), 'utf8');
  assert.match(yml, /include_paths:\s*\["package\.json"\]/,
    'npm 版本格式规则必须限定 package.json');
});
