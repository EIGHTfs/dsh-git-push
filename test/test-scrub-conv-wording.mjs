// scrubConvWording 回归用例（release-docs-rule：公开文档不写许可 / 决策来源 / 商量转述）。
//
// 事故（2026-10-09）：dsh-theme-mediascape 版本表里 1.1.0 行残留「按用户确认删除」——该表内容源自
//   **git log 提交标题**，生成时由 scrubConvWording 清洗 ⇒ 全量审计在 docs/版本记录.md 报
//   conv-user-decision 拦截，而且改表格没用（每轮重生成都会复发）。
//   根因是词库只覆盖「括号内短语 + 用户同意/要求/许可」四类裸词，裸的「按用户确认…」漏网（覆盖不全，非设计如此）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubConvWording } from '../scripts/readme-gen.mjs';

test('裸的「按/经用户确认」被清洗，且不留「按」残字', () => {
  assert.equal(scrubConvWording('1.1.0 命名空间清理（按用户确认删除旧键迁移）'), '1.1.0 命名空间清理（删除旧键迁移）');
  assert.ok(!scrubConvWording('按用户确认删除旧键').includes('按'), '不应残留孤立的「按」');
  assert.ok(!scrubConvWording('经用户确认后推送').includes('用户'), '「经用户确认」应完整清除');
});

test('决策来源类裸短语均被清洗（决定 / 指示 / 反馈 / 指出 / 建议 / 选择）', () => {
  for (const w of ['用户决定', '用户指示', '用户反馈', '用户指出', '用户建议', '用户选择']) {
    const out = scrubConvWording(`改 X（${w}这样做）`);
    assert.ok(!out.includes('用户'), `${w} 未被清洗：${out}`);
  }
});

test('既有的括号内许可类短语清洗不回归', () => {
  assert.equal(scrubConvWording('修 X（用户要求）'), '修 X');
  assert.equal(scrubConvWording('改 Y（用户许可升版）'), '改 Y');
  assert.equal(scrubConvWording('收尾（用户同意）'), '收尾');
});

test('正常文案不被误伤', () => {
  const keep = ['默认 1.1.2 收尾', '修复 Range 直通', '新增日志分层配置', '媒体请求带 token'];
  for (const s of keep) assert.equal(scrubConvWording(s), s, `不该改动正常文案：${s}`);
});
