/**
 * 插件入口层 · 工具定义
 *
 * listTools 声明暴露给宿主的全部工具（名称/描述/参数 schema）。
 * 工具描述文本与 lib/app/handlers.js 的实际实现必须一一对应，增删工具改两处。
 */

import { name } from './constants.js';

/** 多个工具共用的 repo 参数描述（去重字面量）。 */
const REPO_PATH_DESC = 'git 仓库绝对路径';

/** 工具清单（名 + 说明 + 参数 spec；由 lib/plugin/normalizeParameters 转 DSH 形状注册）。 */
export function listTools() {
  return [
    { name: 'git_scan',
      description: '扫描 DSH workspace 下所有 git 仓库，返回每个仓库的分支/remote/未提交变更数/最近活动。'
        + '用于查看哪些仓库有未提交或未推送的改动。支持自由配置：root 传扫描根目录（默认 workspaceRoot，'
        + '传了则以它为准）、paths 传额外仓库绝对路径（逗号分隔，临时指定，无需改配置）、'
        + 'extraReposFile 传配置文件路径（每行一个仓库绝对路径，# 开头为注释，运行时实时读取即时生效）。',
      parameters: {
        root: { type: 'string', description: '扫描根目录（默认 workspaceRoot，传了则以它为准）' },
        paths: { type: 'string', description: '额外仓库绝对路径，逗号分隔（临时指定，无需改配置）' },
        extraReposFile: { type: 'string', description: 'extraRepos 配置文件路径（每行一个仓库绝对路径，# 开头为注释，实时读取生效）' },
      } },
    { name: 'git_commit_push',
      description: '对指定 git 仓库一键提交并推送：先审计（默认开，L0 静态检查语法/敏感信息/凭据/大文件/文档对话类措辞，'
        + '发现 blocker 拦截），再 git add -A → commit（message 必填）→ push origin <当前分支>。'
        + 'push 前自动 fetch 并检查 ahead/behind，远端领先时不推。repo 传仓库绝对路径（可用 git_scan 查）。'
        + 'audit=false 可关闭审计；dryRun=true 只模拟不写入。调用前需逐条核对开发者特殊要求（随插件内置清单，'
        + '可用 <插件配置目录>/requirements.json 外挂），全部达标才传 requirementsConfirmed=true，否则拦截。',
      parameters: {
        repo: { type: 'string', description: REPO_PATH_DESC },
        message: { type: 'string', description: 'commit message（必填）' },
        push: { type: 'boolean', description: '是否推送，默认 true' },
        audit: { type: 'boolean', description: '提交前审计，默认取插件配置 auditEnabled' },
        dryRun: { type: 'boolean', description: 'dry-run 只模拟不写入，默认 false' },
        force: { type: 'boolean', description: 'force 强推：覆盖远端历史（相当于 git push --force；SSH 通道 git push --force / API 通道重建 commit 去掉旧 parent）。默认 false，谨慎使用' },
        ignorePatterns: { type: 'string', description: '自定义忽略 pattern（逗号/换行分隔，追加进 .gitignore，幂等）' },
        requirementsConfirmed: { type: 'boolean', description: '已核对开发者特殊要求（随插件内置清单，可用 <插件配置目录>/requirements.json 外挂）：全部达标时 true，false 会被拦截' },
        pushConfirmed: { type: 'boolean', description: '推送门禁放行（设置侧边栏开启「推送门禁」后必填）：pushConfirmed=true 表示已取得显式放行，false 时本次 push 被拦截（commit 可落本地）。未开启门禁时忽略此参数' },
      } },
    { name: 'code_audit',
      description: '审计指定 git 仓库（L0 静态检查 + 10 维度质量评分）：语法/敏感信息/凭据/大文件/文档措辞 + 代码质量。'
        + 'scope=full 走全量扫描（非 git 目录自动全量）；ruleset 指向自定规则目录（放 audit-rules-<名>.yml 即整体替换规则包）；'
        + 'auditLevel 控强度（quick 跳 AST/语义重检查 / standard 全量 / deep）；weights 用 JSON 覆盖评分权重。'
        + 'includeIgnored=true 时全量扫描含 .gitignore 忽略文件（默认 false 跳过忽略）。'
        + '返回 summary（blocker/warning/notice）、quality（0-100 评分 + 等级）、findings。',
      parameters: {
        repo: { type: 'string', description: REPO_PATH_DESC },
        scope: { type: 'string', description: "扫描范围：'full'=全量 | 缺省/其他=仅本次变动" },
        llm: { type: 'boolean', description: '追加 LLM 深度审查（需配置 provider/model）' },
        ruleset: { type: 'string', description: '自定规则目录（含 audit-rules-<名>.yml；空=内置规则包）' },
        auditLevel: { type: 'string', description: '审计强度：quick | standard | deep（默认取插件配置）' },
        weights: { type: 'string', description: '权重覆盖 JSON，如 {"安全性":100}' },
        includeIgnored: { type: 'boolean', description: 'true=全量扫描也扫 .gitignore 忽略的文件（默认 false 跳过）' },
      } },
    { name: 'git_gen_readme',
      description: '对指定 git 仓库按模板生成 README。模板 = 插件 template/README.md（用户可改章节，存于插件根 template/）'
        + '或内置 readme.yml 章节模板；占位符 {{name}} {{description}} {{version}} {{toc}} {{versionTable}}。'
        + 'repo 传仓库绝对路径。writePath 可选指定写入路径（默认只返回内容不写文件）。',
      parameters: {
        repo: { type: 'string', description: REPO_PATH_DESC },
        writePath: { type: 'string', description: '可选：写入路径（直接写 README.md 传路径），默认只返回内容' },
      } },
    { name: 'git_clone',
      description: '从 GitHub 远端 clone 仓库到本地（只走 api.github.com Git Data API，不跟随 tarball 302、不直连 github.com）。'
        + 'target 传 owner/repo 或完整 URL；dest 传目标目录绝对路径（缺省放 workspaceRoot），已存在非空目录会拒绝防覆盖；'
        + 'branch 可选指定分支。',
      parameters: {
        target: { type: 'string', description: 'owner/repo 或完整 URL' },
        dest: { type: 'string', description: '目标目录绝对路径（缺省 workspaceRoot）' },
        branch: { type: 'string', description: '分支名（缺省远端默认分支）' },
      } },
    { name: 'git_remote_create',
      description: '按项目文件夹创建远程仓库：对本地 git 仓库取目录名做仓库名，检查 GitHub 是否已存在同名仓库，'
        + '不存在则用 token 自动创建（默认 private）并把 origin 设为 api.github.com 形式（不写 SSH/github.com）。dryRun=true 只探测预演。',
      parameters: {
        repo: { type: 'string', description: '本地 git 仓库绝对路径（项目文件夹）' },
        visibility: { type: 'string', description: 'public | private（默认 private）' },
        dryRun: { type: 'boolean', description: '只探测预演，不写 remote 不调创建 API' },
      } },
    { name: 'git_set_visibility',
      description: '切换 GitHub 仓库公开/私有状态：调 GitHub API PATCH private 字段，支持双向切换。'
        + '改 public 有敏感信息暴露风险（先确认无凭据/隐私），改 private 安全。',
      parameters: {
        repo: { type: 'string', description: '本地 git 仓库绝对路径' },
        visibility: { type: 'string', description: 'public | private（必填）' },
      } },
    { name: 'link_check',
      description: '检查文档链接有效性（md/markdown/txt 中的 URL），只报 warning 永不拦截提交。path 传文件或目录（缺省 workspaceRoot）。',
      parameters: {
        path: { type: 'string', description: '文件或目录路径（缺省 workspaceRoot）' },
      } },
    { name: 'git_account_check',
      description: '校验 GitHub 账号与凭据：token 在线校验（api.github.com /user）+ SSH 公钥指纹读取，返回登录态/用户名/公钥仓库数/套餐 + 可读块。'
        + 'token 不传则从环境/凭据文件自动解析。也支持顺带持久化 SSH 公钥（sshPub 参数）。',
      parameters: {
        token: { type: 'string', description: 'GitHub token（可选；不传自动解析环境变量/凭据文件）' },
        sshPub: { type: 'string', description: 'SSH 公钥内容（可选；非空先持久化到配置目录 *.pub 再校验）' },
      } },
    { name: 'git_gen_ssh_key',
      description: '按邮箱生成 SSH 密钥对（ssh-keygen -t rsa -b 4096 -C email，写入插件配置目录）。'
        + 'force=true 先备份旧密钥再覆盖。公钥整行回传（私钥永不离开本机）。',
      parameters: {
        email: { type: 'string', description: '邮箱（x@y.z 格式，必填）' },
        force: { type: 'boolean', description: '已存在私钥时强制覆盖（先改名备份，可恢复）' },
      } },
  ];
}
