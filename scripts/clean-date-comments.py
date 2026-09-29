#!/usr/bin/env python3
"""清理代码注释起始位置的日期前缀（YYYY-MM-DD），保留后续解释文字。
用法：python3 clean-date-comments.py <root> [--dry-run] [--write]
规则（只删注释起始位置的日期，不动正文中间日期）：
  1. 行首注释：^(\s*)(//|#|\*|/\*)\s*202\d[-/]\d{1,2}[-/]\d{1,2}\s*[:：]?\s*  →  $1$2（保留注释符+缩进）
  2. 行内注释：(//)\s*202\d[-/]\d{1,2}[-/]\d{1,2}\s*[:：]?\s*  →  $1（行尾注释删日期前缀）
  3. 特例：日期后紧接着引导词（修/修复/bugfix/补/改/新增/优化/豁免/合并等）+ 冒号 → 删日期保留引导词
安全：
  - 只在注释里删（匹配 // # * 前缀）；正文 "2026-01-01" 字符串不动
  - 只删注释**起始**的日期；"自 2026-09-14 起"式中间日期不动
  - dry-run 默认（只统计不写盘）
"""
import os
import re
import sys

# 行首注释日期前缀（//、#、*、/* 后紧跟日期）
LEADING_RE = re.compile(r'^(\s*)(//|#|\*|/\*)\s*20\d{2}[-/]\d{1,2}[-/]\d{1,2}\s*[:：]?\s*')
# 行内注释日期前缀（代码后 // 日期）
INLINE_RE = re.compile(r'(//)\s*20\d{2}[-/]\d{1,2}[-/]\d{1,2}\s*[:：]?\s*')
# 文件级豁免：这些文件允许日期（变更记录/版权）
EXEMPT_FILES = {'CHANGELOG.md', 'LICENSE', 'README.md', 'FUNCTIONS.md'}


def clean_line(line):
    changed = False
    new = line
    # 行首注释（独占注释行或行首）
    new, n1 = LEADING_RE.subn(r'\g<1>\g<2> ', new)
    changed = changed or n1 > 0
    if not changed:
        # 行内注释（代码行尾）——只在非行首位置找 // 日期
        new, n2 = INLINE_RE.subn(r'\g<1> ', new)
        changed = changed or n2 > 0
    return new, changed


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    dry_run = '--dry-run' in sys.argv or '--write' not in sys.argv
    write = '--write' in sys.argv
    total = 0
    changed_files = 0
    skipped = 0
    if os.path.isfile(root):
        # 单文件模式：直接处理该文件（不限扩展名白名单，方便单测）
        entries = [(os.path.dirname(root), [os.path.basename(root)])]
    else:
        entries = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in ('.git', 'node_modules', '.trash', 'dist', 'build', 'assets')]
            entries.append((dirpath, filenames))
    for dirpath, filenames in entries:
        for fn in filenames:
            if not os.path.isfile(os.path.join(dirpath, fn)):
                continue
            if not (os.path.isfile(root) or fn.endswith(('.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py'))):
                continue
            if fn in EXEMPT_FILES:
                continue
            full = os.path.join(dirpath, fn)
            try:
                with open(full, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
            except (UnicodeDecodeError, PermissionError):
                skipped += 1
                continue
            new_lines = []
            file_changed = 0
            for line in lines:
                nl, c = clean_line(line)
                if c:
                    file_changed += 1
                    total += 1
                new_lines.append(nl)
            if file_changed:
                changed_files += 1
                if write:
                    with open(full, 'w', encoding='utf-8') as f:
                        f.writelines(new_lines)
                else:
                    print(f'  {full}: {file_changed} 处')
    print(f'{"[dry-run] " if dry_run else ""}共 {total} 处日期前缀，{changed_files} 个文件（跳过 {skipped} 不可读）')
    if dry_run:
        print('dry-run 未写盘；加 --write 应用')


if __name__ == '__main__':
    main()