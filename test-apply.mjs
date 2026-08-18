/** dsh-git-push apply mock 测试：注册路由 + 工具 */
import { apply, name } from './lib/index.js';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

const routes = [];
const tools = [];
const webServer = { register: (d) => routes.push(d) };
const toolReg = { register: (d) => tools.push(d) };
const mockCtx = {
  config: { workspaceRoot: '/vol1/@appshare/DeepSeekHarness/workspace' },
  logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  get: (k) => (k === 'webServer' ? webServer : k === 'tools' ? toolReg : undefined),
  inject: async (deps, fn) => { await fn(mockCtx); },
};

await apply(mockCtx, mockCtx.config);
ok(name === 'dsh-git-push', '插件名正确');
ok(routes.length === 1 && routes[0].kind === 'prefix' && routes[0].path === '/api/git-push', '注册了 prefix 路由 /api/git-push');
ok(tools.length === 2, `注册了 ${tools.length} 个工具`);
ok(tools.map((t) => t.name).sort().join(',') === 'git_commit_push,git_scan', '工具名正确');

const scan = await tools.find((t) => t.name === 'git_scan').execute({});
const parsed = JSON.parse(scan);
ok(Array.isArray(parsed.repos) && parsed.repos.length >= 1, `git_scan 返回 ${parsed.repos?.length} 个仓库`);
ok(parsed.repos[0]?.branch, '仓库含 branch 字段');

const cp = tools.find((t) => t.name === 'git_commit_push');
const bad = JSON.parse(await cp.execute({ repo: '/no/such/repo', message: 'x' }));
ok(bad.ok === false, 'git_commit_push 对无效仓库报错');

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
