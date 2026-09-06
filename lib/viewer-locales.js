/**
 * dsh-git-push — 提交历史查看器多语言配置文件（v1.25.0）
 *
 * 查看器页面（/git-push/viewer）的全部 UI 文案集中在此配置，默认中文（DEFAULT_LOCALE='zh'）。
 * 新增语言 = 在此文件加一个语言键（键集合必须与其它语言完全一致，test-viewer 校验）。
 * 页面脚本通过 window.__VIEWER_I18N（renderViewerPage 注入）读取，支持运行时切换（localStorage 记忆）。
 */

export const DEFAULT_LOCALE = 'zh';

export const VIEWER_LOCALES = {
  zh: {
    // 侧边栏
    sidebarTitle: '仓库列表',
    searchPlaceholder: '搜索仓库…',
    manualTitle: '手动选择本地仓库',
    manualPlaceholder: '仓库绝对路径或目录（只读扫描）',
    manualAdd: '添加',
    manualAdding: '扫描中…',
    manualEmpty: '未在该路径找到 git 仓库',
    manualOk: '已添加 {n} 个仓库',
    footerRepos: '{n} 个仓库',
    footerLoading: '加载中…',
    manualBadge: '手动',
    // 顶栏
    topbarCommits: '{n} 个提交',
    filterAll: '全部',
    refresh: '刷新',
    langToggle: 'EN',
    // 统计
    statCommits: '提交',
    statFiles: '文件',
    statAdded: '新增',
    statRemoved: '删除',
    // 提交列表
    commitLoading: '加载提交中…',
    commitEmpty: '暂无提交',
    commitLoadFailed: '加载提交失败: {err}',
    commitFilterEmpty: '没有匹配的提交',
    noRepoSelected: '选择一个仓库查看提交',
    repoLoadFailed: '加载仓库列表失败: {err}',
    pagePrev: '上一页',
    pageNext: '下一页',
    commitChanges: '{n} 个变更',
    commitFiles: '{n} 个文件',
    today: '今天',
    yesterday: '昨天',
    daysAgo: '{n} 天前',
    dateLocale: 'zh-CN',
    // 展开详情
    filesChanged: '变更文件（{n}）— 点击查看 diff',
    selectFileHint: '选择文件查看变更',
    infoHash: '提交哈希',
    infoAuthor: '作者',
    infoDate: '日期',
    // diff
    diffLoading: '加载 diff 中…',
    diffEmpty: '无可用 diff',
    diffFailed: '加载 diff 失败: {err}',
    // 提示条
    note: '只读查看器：仅展示提交历史与文件 diff，不做任何推送/提交操作。配置：{config}',
    noteRoot: '根目录',
    noteDepth: '深度',
    noteNone: '无',
  },
  en: {
    sidebarTitle: 'Repositories',
    searchPlaceholder: 'Search repos…',
    manualTitle: 'Add local repository',
    manualPlaceholder: 'Absolute repo path or directory (read-only scan)',
    manualAdd: 'Add',
    manualAdding: 'Scanning…',
    manualEmpty: 'No git repo found at that path',
    manualOk: 'Added {n} repos',
    footerRepos: '{n} repos',
    footerLoading: 'Loading…',
    manualBadge: 'manual',
    topbarCommits: '{n} commits',
    filterAll: 'All',
    refresh: 'Refresh',
    langToggle: '中',
    statCommits: 'Commits',
    statFiles: 'Files',
    statAdded: 'Added',
    statRemoved: 'Removed',
    commitLoading: 'Loading commits…',
    commitEmpty: 'No commits found',
    commitLoadFailed: 'Failed to load commits: {err}',
    commitFilterEmpty: 'No commits match filter',
    noRepoSelected: 'Select a repository to view commits',
    repoLoadFailed: 'Failed to load repos: {err}',
    pagePrev: 'Prev',
    pageNext: 'Next',
    commitChanges: '{n} changes',
    commitFiles: '{n} files',
    today: 'today',
    yesterday: 'yesterday',
    daysAgo: '{n} days ago',
    dateLocale: 'en-US',
    filesChanged: 'Files changed ({n}) — click to view diff',
    selectFileHint: 'Select a file to view changes',
    infoHash: 'Hash',
    infoAuthor: 'Author',
    infoDate: 'Date',
    diffLoading: 'Loading diff…',
    diffEmpty: 'No diff available',
    diffFailed: 'Failed to load diff: {err}',
    note: 'Read-only viewer: commit history & file diffs only, no push or commit. Config: {config}',
    noteRoot: 'Root',
    noteDepth: 'Depth',
    noteNone: 'none',
  },
};

/** 取语言字典（未知语言回退默认中文）。 */
export function localeOf(locale) {
  return VIEWER_LOCALES[locale] ? locale : DEFAULT_LOCALE;
}