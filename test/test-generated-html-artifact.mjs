// 生成物识别回归：带 <meta name="generator"> 的 HTML 视作生成产物，跳过行级规则。
//
// 事故：archify（图表生成器）的自包含产物 HTML（.archify/archify.html 813K、examples/*.html、
//   docs/cases/*.html）带内联 <script>——那是它的**产物形态**，却被 security/script-unsafe-inline
//   按「管理界面 XSS」报 error 83 条；同时这些生成页还贡献了大量行级噪声（按钮无事件等）。
//   既有识别只认「引用 hash 命名静态资源」，自包含产物无外部引用 ⇒ 识别不到。
//   修法：HTML 标准的 <meta name="generator"> 是任何代码生成器都会写的通用信号，据此判生成物。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isBuildArtifactFile } from '../lib/audit/audit-file.js';

const GENERATED = [
  '<!DOCTYPE html><html><head><meta name="generator" content="archify 3.0.1"><script>var a=1;</script></head></html>',
  "<meta name='generator' content='Hugo 0.120'>",
  '<meta  name = "generator" content="Sphinx">',
];

test('带 generator meta 的 HTML 判为生成物（任何代码生成器都写它）', () => {
  for (const text of GENERATED) {
    assert.equal(isBuildArtifactFile('out/page.html', text), true, `应判为生成物：${text.slice(0, 50)}`);
  }
});

test('手写 HTML 不因本规则被豁免（防误伤）', () => {
  const handwritten = '<!DOCTYPE html><html><head><title>手写页</title></head><body><script>init();</script></body></html>';
  assert.equal(isBuildArtifactFile('site/index.html', handwritten), false, '无 generator 声明的手写页不得判为生成物');
  // 既有能力保留：引用 hash 命名静态资源的产物仍能识别
  const built = '<html><head><script src="/assets/main.83b810ac.js"></script></head></html>';
  assert.equal(isBuildArtifactFile('dist/index.html', built), true, 'hash 命名资源引用仍应判为产物');
});
