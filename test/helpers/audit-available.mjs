/**
 * 「审计包是否在位」的探测 + 条件测试注册器（测试基础设施，非交付物）。
 *
 * 背景：审计是可热插拔的扩展能力。
 *   - 包在位 → 依赖它的集成测试正常跑
 *   - 包不在位 → 这些测试**带原因 skip**，而不是变红
 *   这样宿主 CI 不需要安装审计包（审计能力由审计包自己的 CI 验），
 *   而本地装了包的开发者仍会拿到完整覆盖。
 *
 * 注意：不要把「宿主如何消费审计结果」的核心断言也 skip 掉——
 *   那部分用 `test/helpers/mock-audit.mjs` 的假引擎验（不依赖真包）。
 */
import { test } from 'node:test';
import { resolveAuditSluiceEntry } from '../../lib/commit-push/pre-commit-engine.js';

const entry = resolveAuditSluiceEntry();

/** 审计包是否可用。 */
export const hasAuditPackage = entry.ok === true;

/** 审计包入口（不可用时为空串）。 */
export const auditPackagePath = entry.ok ? entry.path : '';

const SKIP_REASON = '审计包（audit-sluice）未安装：该用例验的是审计能力本身，由审计包自己的测试覆盖';

/**
 * 依赖审计包的测试注册器：包不在位时 skip 并写明原因。
 * 用法与 `test` 完全一致。
 */
export const auditTest = hasAuditPackage
  ? test
  : (name, fn) => test(name, { skip: SKIP_REASON }, fn);
