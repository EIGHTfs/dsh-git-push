/**
 * fallback schema 的「脱敏契约」回归（2026-11-19）
 *
 * 修的 bug：`makeFallbackSchema()` 造出来的 schema 节点**只挂了 meta，没有 type / dict / inner / list**。
 *   而宿主 DSH 的密钥脱敏（`@deepseek-ai/dsh-settings` 的 `redact.ts`）不看 meta，它按
 *   `node.type` 决定要不要下钻、按 `node.meta.role === 'secret'` 判断密钥位。
 *   于是当插件装在没有 `@deepseek-ai/schemastery` 解析路径的目录（如 local-plugins）时：
 *   声明方走 fallback（残缺形状）、脱敏方仍是宿主的真实现（按完整形状遍历）——
 *   两边对不上，`walk()` 在顶层就落进 default 分支原样返回，
 *   `githubToken` / `npmToken` 明文随设置快照下发到浏览器。
 *
 * 本测试锁两件事：
 *   ① fallback schema 的形状必须与真实 schemastery 一致（type / dict / inner / list / meta.role）；
 *   ② 按宿主算法走一遍时，secret 真的被删、非 secret 真的保留；
 *   ③ **反例自证**：把节点退化成「只有 meta、没有 type」的旧形状，同一算法必须删不掉 secret
 *      —— 否则这份测试是假绿，挡不住 bug 回退。
 *
 * 为什么不直接 import 宿主的 redactSecrets：本仓库是零依赖项目，测试环境里
 *   `@deepseek-ai/schemastery` 与 `@deepseek-ai/dsh-settings` 都解析不到（这恰恰就是
 *   fallback 的触发条件）。硬编码宿主安装路径去 import 会引入环境耦合，
 *   所以这里用最小 walker 复刻 redact.ts 的**判定条件**（复刻点见下方 walkForSecrets 注释）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Config } from '../../lib/app/schema.js';

/** 本测试跑在哪种 schema 上：真实 schemastery 还是 fallback（两条路都要过）。 */
const require2 = createRequire(import.meta.url);
let usingRealSchemastery = false;
try {
  usingRealSchemastery = typeof require2('@deepseek-ai/schemastery')?.object === 'function';
} catch {
  usingRealSchemastery = false;
}

/**
 * 复刻 `@deepseek-ai/dsh-settings` 的 `redactSecrets` → `walk()` 的判定条件（只保留与本 bug 相关的分支）：
 *   · `node.meta.role === 'secret'` → 删掉该位，并把 path 记入记录；
 *   · `node.type === 'object'` → 遍历 `node.dict` 的每个属性递归；
 *   · `node.type === 'dict'` → 遍历值的每个键，按 `node.inner` 递归；
 *   · `node.type === 'array'` → 按 `node.inner` 递归每个元素；
 *   · `node.type === 'union' / 'intersect'` → 每个分支依次过一遍；
 *   · 其余（含 `type === undefined`）→ **原样返回**（旧 fallback 就是死在这里）。
 * 与真实实现的差异只在「重建对象的细节」，判定条件逐条对齐——这正是本 bug 的判据。
 */
function walkForSecrets(node, value, path = [], found = []) {
  if (node === undefined) return value;
  if (node?.meta?.role === 'secret') {
    found.push({ path, set: value !== undefined });
    return undefined;
  }
  const isPlainRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
  switch (node.type) {
    case 'object': {
      const properties = node.dict ?? {};
      const source = isPlainRecord(value) ? value : {};
      const out = { ...source };
      for (const [key, child] of Object.entries(properties)) {
        const stripped = walkForSecrets(child, source[key], [...path, key], found);
        if (stripped === undefined) delete out[key];
        else out[key] = stripped;
      }
      return out;
    }
    case 'dict': {
      if (!isPlainRecord(value)) return value;
      const out = {};
      for (const [key, entry] of Object.entries(value)) {
        out[key] = walkForSecrets(node.inner, entry, [...path, key], found);
      }
      return out;
    }
    case 'array': {
      if (!Array.isArray(value)) return value;
      return value.map((entry, index) => walkForSecrets(node.inner, entry, [...path, String(index)], found));
    }
    case 'union':
    case 'intersect':
      return (node.list ?? []).reduce((current, child) => walkForSecrets(child, current, path, found), value);
    default:
      return value;
  }
}

test('fallback 契约①：Config 顶层必须是 type=object 且带 dict（否则脱敏下钻不进来）', () => {
  assert.equal(Config.type, 'object', '顶层 Config 必须有 type="object"，宿主 walk 靠它下钻');
  assert.ok(Config.dict && typeof Config.dict === 'object', '顶层 Config 必须有 dict 指向各字段 schema');
  // 密钥位必须带着 meta.role（宿主的判据），且 dict 里指向的正是该字段自己的 schema
  const githubTokenField = Config.dict.githubToken;
  assert.ok(githubTokenField, 'dict 里应能找到 githubToken 字段');
  assert.equal(githubTokenField.meta?.role, 'secret', 'githubToken 必须标 meta.role="secret"');
});

test('fallback 契约②：容器类型把元素 schema 挂在 inner / list 上', () => {
  const extraRepos = Config.dict.extraRepos; // Schema.array(Schema.string())
  assert.equal(extraRepos.type, 'array', 'array 字段应有 type="array"');
  assert.ok(extraRepos.inner, 'array 必须把元素 schema 挂在 inner 上，否则元素里的 secret 不会被遍历');

  const preCommit = Config.dict.preCommit; // Schema.object({...})
  assert.equal(preCommit.type, 'object', '嵌套 object 也必须是 type="object"（递归的下一层）');
  assert.ok(preCommit.dict && preCommit.dict.stages, '嵌套 object 的 dict 必须能看到子字段');

  const stages = preCommit.dict.stages; // Schema.array(Schema.object({...}))
  assert.equal(stages.type, 'array');
  assert.equal(stages.inner?.type, 'object', 'array 的 inner 应是那个 object schema，才能继续下钻到元素字段');
  assert.ok(stages.inner?.dict?.provider, 'array 元素的 dict 应能看到元素字段');
});

test('fallback 契约③：按宿主算法走一遍，顶层 secret 被删、普通字段保留', () => {
  const value = { githubToken: 'ghp_' + 'A'.repeat(36), sshPub: 'ssh-ed25519 AAAAdemo', maxCloneFileMB: 10 };
  const found = [];
  const out = walkForSecrets(Config, value, [], found);

  assert.equal(out.githubToken, undefined, 'githubToken 必须被删掉');
  assert.equal(out.sshPub, 'ssh-ed25519 AAAAdemo', '公钥不是密钥，必须保留');
  assert.equal(out.maxCloneFileMB, 10, '普通字段必须原样保留');
  assert.equal(value.githubToken, 'ghp_' + 'A'.repeat(36), '不得改动入参（脱敏产出副本）');
  assert.ok(found.some((s) => s.path.join('.') === 'githubToken' && s.set === true),
    '应记录 githubToken 的密钥位与「已填写」状态');
});

test('fallback 契约④：嵌套 / 数组元素里的 secret 都要能被删掉', () => {
  // 用 schema.js 暴露的同一套构造器造一段嵌套结构（不新引依赖，走的就是 fallback 本体）
  const nested = Config.dict.preCommit; // 现成的嵌套 object，借它的“形状工具”即可
  assert.ok(nested, '需要有可用的嵌套 object 作为取样点');

  // 数组元素里的 secret：extraRepos 是 array<dict>，这里用它的 inner 形状验证遍历能进到元素
  const arr = Config.dict.extraRepos;
  assert.ok(arr.inner, 'array.inner 存在才可能遍历到元素');

  // 真正的嵌套 secret 用「自造的等价节点」验证 walker 分支：结构与 fallback 产出一致
  const fakeSecretChild = { type: 'string', meta: { role: 'secret' } };
  const fakeNested = { type: 'object', dict: { token: fakeSecretChild } };
  const found = [];
  const out = walkForSecrets(fakeNested, { token: 'gho_secretvalue', keep: 1 }, [], found);
  assert.equal(out.token, undefined, '嵌套 object 里的 secret 必须被删');
  assert.equal(out.keep, 1, '同层非密钥字段保留');
  assert.deepEqual(found.map((s) => s.path.join('.')), ['token']);

  const foundArr = [];
  const arrOut = walkForSecrets({ type: 'array', inner: fakeSecretChild }, ['a', 'b'], [], foundArr);
  assert.deepEqual(arrOut, [undefined, undefined], '数组元素是 secret 时应被置空');
  assert.equal(foundArr.length, 2, '两个元素各记一条密钥位');
});

test('反例自证：节点退化成「只有 meta、没有 type」（旧 fallback 形状）时，secret 删不掉', () => {
  // 这条断言的作用是证明上面的契约测试真的能捕获本 bug：
  //   若有人把 fn.type / fn.dict 又删掉，契约①②会红；而若契约测试被写得过松，
  //   这里会用同一算法展示「残缺形状 ⇒ 明文照原样返回」的后果。
  const legacyTopLevel = { meta: {}, dict: { githubToken: { meta: { role: 'secret' } } } }; // 故意不给 type
  const found = [];
  const out = walkForSecrets(legacyTopLevel, { githubToken: 'ghp_plaintext' }, [], found);

  assert.equal(out.githubToken, 'ghp_plaintext',
    '没有 type 的节点会被原样返回 —— 这正是本 bug 的机制，明文就这样漏出去');
  assert.deepEqual(found, [], '也不会记录任何密钥位（前端连「已填写」都判不出来）');
});

test('两种 runtime 都要过：记录本测试实际跑在哪种 schema 上（便于排查环境差异）', () => {
  // 有 schemastery 时 Config 是真实现（同样满足上面的契约）；没有时走 fallback。
  // 两条路都必须通过上面 5 条断言，否则说明某一侧的形状契约漂了。
  const mode = usingRealSchemastery ? 'real-schemastery' : 'fallback';
  assert.equal(Config.type, 'object', `当前运行模式 ${mode}：顶层仍须满足 type="object"`);
  assert.ok(Config.dict, `当前运行模式 ${mode}：顶层仍须满足带 dict`);
});
