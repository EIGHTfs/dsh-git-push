/** dsh-skip-sensitive dsh-git-push 提交历史查看器数据层单测（v1.24.0，真实临时 git 仓库） */
import { getCommitHistory, getCommitDiff, parseDiffLines, resolveViewerRepo, renderViewerPage } from './lib/viewer.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

const root = mkdtempSync(join(tmpdir(), 'git-push-viewer-'));
const repo = join(root, 'repo-v');
mkdirSync(repo, { recursive: true });
execSync('git init -b master', { cwd: repo, stdio: 'ignore' });
const commit = (msg) => execSync(`git add -A && git -c user.email=t@t -c user.name=t commit -m ${JSON.stringify(msg)}`, { cwd: repo, stdio: 'ignore' });

try {
  // 根提交（无父提交，diff 走 git show 分支）
  writeFileSync(join(repo, 'init.txt'), 'line1\nline2\n');
  commit('init');

  // 第二个提交：feat + 多文件 + message 含 | 字符（验证按前 5 个分隔符解析）
  writeFileSync(join(repo, 'feat.txt'), 'a\nb\nc\n');
  writeFileSync(join(repo, 'init.txt'), 'line1\nline2\nline3\n');
  commit('feat: 新增功能 | 带管道符说明');

  // 第三个提交：fix（删除行）
  writeFileSync(join(repo, 'feat.txt'), 'a\nc\n');
  commit('fix: 删掉 b');

  // ---------- getCommitHistory ----------
  const commits = getCommitHistory(repo, 100);
  ok(commits.length === 3, `getCommitHistory 返回 ${commits.length} 条提交`);
  ok(commits[0].type === 'fix' && commits[1].type === 'feat', '提交类型按 message 前缀归类');
  ok(commits[1].message === 'feat: 新增功能 | 带管道符说明', 'message 含 | 完整保留');
  ok(commits[1].files.length === 2, `feat 提交含 2 个文件（实际 ${commits[1].files.length}）`);
  ok(commits[1].files.find((f) => f.name === 'init.txt')?.added === 1, 'numstat 统计新增行');
  ok(commits[2].files.some((f) => f.name === 'init.txt') && commits[2].files[0].added >= 0, '根提交文件也进清单（无父时不报错）');
  ok(commits[0].stats.files === 1 && commits[0].stats.added === 0 && commits[0].stats.removed === 1, 'fix 提交删 1 行（0+/1-）');
  ok(commits.every((c) => /^[0-9a-f]{40}$/.test(c.id)) && commits.every((c) => c.shortId.length >= 7), 'id/shortId 合规');
  ok(commits.every((c) => c.author === 't' && c.date.length > 10), 'author/date 字段');

  const limited = getCommitHistory(repo, 1);
  ok(limited.length === 1, 'limit 生效');
  ok(getCommitHistory(repo, 0).length === 3, 'limit=0 回退默认上限');
  ok(getCommitHistory(repo, 9999).length === 3, 'limit 超上限截断到仓库实际条数');

  // ---------- getCommitDiff ----------
  const fixDiff = getCommitDiff(repo, commits[0].id, 'feat.txt');
  ok(fixDiff.ok === true && fixDiff.parsed.removed === 1 && fixDiff.parsed.added === 0, '非根提交 diff 正确（-1/+0）');
  ok(fixDiff.parsed.lines.some((l) => l.type === 'removed' && l.content === 'b'), 'diff 行级内容含删除的 b');

  const featDiff = getCommitDiff(repo, commits[1].id, 'feat.txt');
  ok(featDiff.ok === true && featDiff.parsed.added === 3, '新增文件 diff +3');

  const rootId = commits[commits.length - 1].id;
  const rootDiff = getCommitDiff(repo, rootId, 'init.txt');
  ok(rootDiff.ok === true && rootDiff.parsed.added === 2, '根提交回退 git show 成功（+2）');

  const badCommit = getCommitDiff(repo, 'abc;rm -rf /tmp/x', 'feat.txt');
  ok(badCommit.ok === false && /不合法/.test(badCommit.error), '非法 commit id 被拒绝（防注入）');
  const noParam = getCommitDiff(repo, '', '');
  ok(noParam.ok === false, '空参数被拒绝');

  // ---------- parseDiffLines（纯函数） ----------
  const parsed = parseDiffLines('diff --git a/x b/x\nindex 000..111\n--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n ctx\n+add\n-rm\n rem\nBinary files differ\n');
  ok(parsed.added === 1 && parsed.removed === 1, 'parseDiffLines 统计 +/-');
  ok(parsed.lines.some((l) => l.type === 'hunk') && parsed.lines.some((l) => l.type === 'context'), '含 hunk/context');
  ok(!parsed.lines.some((l) => l.content === 'Binary files differ'), '二进制头被跳过');
  ok(parseDiffLines('').added === 0 && parseDiffLines(undefined).lines.length === 0, '空输入安全');

  // ---------- resolveViewerRepo（安全匹配） ----------
  ok(resolveViewerRepo(repo, { root, depth: 2 }) === repo, 'path 精确匹配');
  ok(resolveViewerRepo('repo-v', { root, depth: 2 }) === repo, 'name 匹配');
  ok(resolveViewerRepo('/etc/passwd', { root, depth: 2 }) === null, '扫描范围外路径拒绝（防任意路径）');
  ok(resolveViewerRepo('../repo-v', { root, depth: 2 }) === null, '相对路径拒绝');

  // ---------- renderViewerPage ----------
  const page = renderViewerPage({ workspaceRoot: root, depth: 2, extraRepos: [], version: '1.24.0' });
  ok(page.includes('<title>Git 提交历史查看器'), '页面标题');
  ok(page.includes('/api/git-push/repos') && page.includes('/api/git-push/commits') && page.includes('/api/git-push/diff'), '页面引用只读 API');
  ok(!page.includes('/api/push') && !page.includes('doPush'), '页面无任何 push 能力');
  ok(page.includes('只读查看器'), '页面明示只读');
  ok(page.includes('v1.24.0'), '页面带版本号');
  // 内嵌 script 结束标签闭合正确（无提前闭合导致的语法破坏）
  const open = page.split('<script>').length - 1;
  const close = page.split('</script>').length - 1;
  ok(open === 1 && close === 1, `script 标签配对（open=${open} close=${close}）`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);