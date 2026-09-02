/** dsh-git-push — dsh-repo-index 维护模块单测（纯函数 + 临时 git 仓库） */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  parseMdFrontmatterName,
  collectProjectSkills,
  parseManualVisibility,
  remoteToRepoInfo,
  buildRepoIndex,
  syncRepoIndex,
  detectSkillsDir,
} from './lib/repo-index.js';

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${l}`); };

// ---------- 1. frontmatter 解析 ----------
const md = '---\nname: dsh-abc\ndescription: xxx\n---\n# body';
ok(parseMdFrontmatterName(md) === 'dsh-abc', 'parseMdFrontmatterName 解析 name');
ok(parseMdFrontmatterName('# no frontmatter') === '', '无 frontmatter 返回空');

// ---------- 2. collectProjectSkills ----------
const root = mkdtempSync(join(tmpdir(), 'repo-index-test-'));
const repoA = join(root, 'repo-a');
mkdirSync(join(repoA, 'skills'), { recursive: true });
writeFileSync(join(repoA, 'package.json'), JSON.stringify({
  dsh: { skills: ['./skills/skill-a.md', './skills/skill-b.md'] },
}));
writeFileSync(join(repoA, 'skills', 'skill-a.md'), '---\nname: skill-a\n---\n');
writeFileSync(join(repoA, 'skills', 'skill-b.md'), '---\nname: skill-b\n---\n');
writeFileSync(join(repoA, 'skills', 'skill-c.md'), '---\nname: skill-c\n---\n'); // 未声明，应被目录扫描补上
const skillsA = collectProjectSkills(repoA);
ok(skillsA.includes('skill-a') && skillsA.includes('skill-b'), 'package.json dsh.skills 声明被收集');
ok(skillsA.includes('skill-c'), 'skills/ 目录未声明 skill 被扫描补上');
ok(!skillsA.includes('skill-a') || skillsA.indexOf('skill-a') === skillsA.indexOf('skill-a'), '无重复');

const repoNoPkg = join(root, 'repo-nopkg');
mkdirSync(join(repoNoPkg, 'skills'), { recursive: true });
writeFileSync(join(repoNoPkg, 'skills', 'only-skill.md'), '---\nname: only-skill\n---\n');
ok(collectProjectSkills(repoNoPkg).includes('only-skill'), '无 package.json 仅 skills/ 目录也能收集');

// ---------- 3. parseManualVisibility ----------
const existing = `| dsh-link-bridge | \`git@github.com:EIGHTfs/dsh-link-bridge.git\` | **私有** | ... | dsh-link-bridge |
| dsh-git-rescue | \`...\` | 公开 | ... | ... |`;
const vm = parseManualVisibility(existing);
ok(vm['dsh-link-bridge'] === '私有', '手工可见性解析：私有');
ok(vm['dsh-git-rescue'] === '公开', '手工可见性解析：公开');

// ---------- 4. remoteToRepoInfo（v1.17.0：归一化为 api.github.com + git_clone） ----------
const pub = remoteToRepoInfo('git@github.com:EIGHTfs/dsh-git-rescue.git', '公开');
ok(pub.repoUrl === 'https://api.github.com/repos/EIGHTfs/dsh-git-rescue', 'EIGHTfs ssh remote 归一化为 api.github.com');
ok(pub.cloneCmd.includes('git_clone') && pub.cloneCmd.includes('EIGHTfs/dsh-git-rescue'), '公开 clone 走 git_clone');
const priv = remoteToRepoInfo('https://github.com/EIGHTfs/dsh-link-bridge.git', '私有');
ok(priv.cloneCmd.includes('git_clone') && priv.cloneCmd.includes('私有'), '私有 clone 走 git_clone 并标注私有');
ok(priv.repoUrl === 'https://api.github.com/repos/EIGHTfs/dsh-link-bridge', 'https remote 归一化为 api.github.com');
const other = remoteToRepoInfo('git@github.com:other/repo.git', '公开');
ok(other.repoUrl === 'https://api.github.com/repos/other/repo', '非 EIGHTfs remote 也写成 api.github.com');
const apiOrigin = remoteToRepoInfo('https://api.github.com/repos/EIGHTfs/dsh-git-push', '公开');
ok(apiOrigin.repoUrl === 'https://api.github.com/repos/EIGHTfs/dsh-git-push', 'api.github.com origin 原样解析');

// ---------- 5. buildRepoIndex 端到端 ----------
const wsRoot = join(root, 'workspace');
mkdirSync(wsRoot, { recursive: true });
const wsRepo = join(wsRoot, 'dsh-aaa');
mkdirSync(join(wsRepo, 'skills'), { recursive: true });
writeFileSync(join(wsRepo, 'package.json'), JSON.stringify({ name: 'dsh-aaa', dsh: { skills: ['./skills/dsh-aaa-skill.md'] } }));
writeFileSync(join(wsRepo, 'skills', 'dsh-aaa-skill.md'), '---\nname: dsh-aaa-skill\n---\n');
execSync('git init -b main -q', { cwd: wsRepo, stdio: 'ignore' });
execSync('git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -qm init', { cwd: wsRepo, stdio: 'ignore' });

const localOnly = join(wsRoot, 'dsh-local-only');
mkdirSync(localOnly, { recursive: true });

const indexMd = await buildRepoIndex({ workspaceRoot: wsRoot, depth: 2, tokenPath: '' });
ok(indexMd.includes('| dsh-aaa |'), '生成索引包含仓库行');
ok(indexMd.includes('dsh-aaa-skill'), '「对应 skill」列自动填充');
ok(indexMd.includes('dsh-local-only'), '本地 only 部分包含无 remote 目录');
ok(indexMd.includes('DO NOT EDIT MANUALLY'), '含自动生成标记');
ok(indexMd.includes('dsh-git-push 插件'), '含维护方声明');

// ---------- 6. syncRepoIndex ----------
const src = join(root, 'src.md');
const tgt = join(root, 'tgt.md');
const sync = syncRepoIndex({ content: '# x\n', sourcePath: src, syncTarget: tgt });
ok(sync.ok && sync.written.length === 2, '同步写入权威源 + 生效副本');

// ---------- 7. detectSkillsDir ----------
ok(typeof detectSkillsDir() === 'string' && detectSkillsDir().length > 0, 'detectSkillsDir 返回路径');

try {
  rmSync(root, { recursive: true, force: true });
} catch { /* 清理失败忽略 */ }

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
