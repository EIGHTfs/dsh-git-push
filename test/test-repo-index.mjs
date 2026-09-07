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
  resolveRepoIndexFile,
  formatRepoIndexInjection,
} from '../lib/repo-index.js';

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

const indexJson = await buildRepoIndex({ workspaceRoot: wsRoot, depth: 2, tokenPath: '' });
const idx = JSON.parse(indexJson);
ok(Array.isArray(idx.repos) && idx.repos.some((r) => r.name === 'dsh-aaa'), '生成 JSON 索引包含仓库对象');
ok(idx.repos.some((r) => r.name === 'dsh-aaa' && r.skills.includes('dsh-aaa-skill')), 'skills 字段自动填充');
ok(Array.isArray(idx.localOnly) && idx.localOnly.includes('dsh-local-only'), 'localOnly 包含无 remote 目录');
ok(idx.note && idx.note.includes('DO NOT EDIT MANUALLY'), '含自动生成标记');
ok(typeof idx.owner === 'string' && idx.owner.length > 0, '含 owner 账号变量');
ok(idx.version === 1 && idx.generatedAt, '含 version/generatedAt 元数据');

// ---------- 6. syncRepoIndex（v1.27.1：默认目标 = userDir/<owner>/dsh-repo-index.json）----------
const tgt = join(root, 'tgt.md');
const sync = syncRepoIndex({ content: '# x\n', userDir: root, owner: 'EIGHTfs', syncTarget: tgt });
ok(sync.ok && sync.written.length === 1 && sync.written[0] === tgt, 'syncRepoIndex 显式 syncTarget 写入');
const sync2 = syncRepoIndex({ content: '{"a":1}\n', userDir: root, owner: 'EIGHTfs' });
ok(sync2.ok && sync2.written.length === 1 && sync2.written[0].endsWith('EIGHTfs/dsh-repo-index.json'), '默认目标 = userDir/<owner>/dsh-repo-index.json（账号文件夹下）');

// ---------- 7. detectSkillsDir ----------
ok(typeof detectSkillsDir() === 'string' && detectSkillsDir().length > 0, 'detectSkillsDir 返回路径');

// ---------- 8. formatRepoIndexInjection（v1.35.0：默认文件名 / 开关正文）----------
const userDir = join(root, 'dsh-git-push-User');
const accDir = join(userDir, 'EIGHTfs');
mkdirSync(accDir, { recursive: true });
writeFileSync(join(accDir, 'dsh-repo-index.json'), JSON.stringify({ name: 'dsh-repo-index', repos: [{ name: 'demo' }] }, null, 2) + '\n');
const idxPath = resolveRepoIndexFile({ syncTarget: join(accDir, 'dsh-repo-index.json') });
ok(idxPath.endsWith('dsh-repo-index.json'), `resolveRepoIndexFile=${idxPath}`);
const nameOnly = formatRepoIndexInjection({ syncTarget: idxPath, full: false });
ok(nameOnly.includes('dsh-repo-index.json') && !nameOnly.includes('"repos"'), '默认只注入文件名，不含 JSON 正文');
const fullText = formatRepoIndexInjection({ syncTarget: idxPath, full: true });
ok(fullText.includes('"repos"') && fullText.includes('demo'), '开关打开注入 JSON 正文');
const missing = formatRepoIndexInjection({ syncTarget: join(accDir, 'no-such.json'), full: false });
ok(missing.includes('尚未生成') || missing.includes('文件：'), '缺文件时仍注入路径提示');

try {
  rmSync(root, { recursive: true, force: true });
} catch { /* 清理失败忽略 */ }

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
