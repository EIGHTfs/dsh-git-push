#!/usr/bin/env bash
# dsh-plugin mini-host 一键启动 —— 本地跑本插件服务端代码，**改完代码刷新页面即生效**，
# 既不用重启 DSH 宿主、也不用重启本服务（每个请求 fork 一次性子进程，插件模块天然新鲜）。
#
# 依赖通用工具：dsh-plugin-minihost.mjs（+ dsh-plugin-minihost-child.mjs）
#   位置：技能仓库 ai-work-archive/skills/，或运行时目录 <DSH_HOME>/skills/
# 用法：
#   bash assets/minihost.sh                 # 默认端口 31100
#   bash assets/minihost.sh --port 31200    # 换端口（其余参数透传给 mini-host）
# 环境变量：
#   DSH_SKILLS_DIR  指定含通用工具的 skills 目录（默认 $DSH_HOME/skills 或 ~/.dsh/skills）
#   PORT            默认端口（默认 31100）
#   NODE_BIN        指定 node（默认 PATH 里的 node）
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_DIR="${DSH_SKILLS_DIR:-${DSH_HOME:-$HOME/.dsh}/skills}"
TOOL="$SKILLS_DIR/dsh-plugin-minihost.mjs"
if [ ! -f "$TOOL" ]; then
  echo "找不到通用工具：$TOOL"
  echo "请设置 DSH_SKILLS_DIR 指向含 dsh-plugin-minihost.mjs 的 skills 目录"
  exit 2
fi
ARGS=(--plugin "$ROOT" --port "${PORT:-31100}")
# 预览页是**生成产物**（.gitignore 已忽略，不入库）：缺失时先自动生成一次，
#   否则 --preview 分支会**静默跳过**（页面打开是 404/无预览页，且没有任何报错）。
PREVIEW_HTML="$ROOT/assets/preview.html"
PREVIEW_GEN="$ROOT/scripts/preview-gen.mjs"
if [ ! -f "$PREVIEW_HTML" ] && [ -f "$PREVIEW_GEN" ]; then
  echo "[minihost] 预览页缺失，先生成一次：node scripts/preview-gen.mjs"
  "${NODE_BIN:-node}" "$PREVIEW_GEN" >/dev/null 2>&1 \
    || echo "[minihost] 预览页生成失败（继续启动，但不带预览页）"
fi
[ -f "$PREVIEW_HTML" ] && ARGS+=(--preview "$PREVIEW_HTML")
[ -d "$ROOT/lib" ] && ARGS+=(--static "$ROOT/lib")
exec "${NODE_BIN:-node}" "$TOOL" "${ARGS[@]}" "$@"
