#!/usr/bin/env bash
# ============================================================
# dsh-git-push 预览服务器启停脚本（模板源：bench-template/server/lib/preview/start.sh，下发改自用）
# 用法：
#   ./start.sh start [--port PORT]
#   ./start.sh restart [--port PORT]   # 默认命令
#   ./start.sh stop
#   ./start.sh status
#   ./start.sh --port PORT             # 兼容旧用法（等价 restart）
# PID：插件根 / dsh-git-push.pid（见 pid-file-at-project-root）
# ============================================================
set -uo pipefail

# 脚本落在 assets/（bench-template 下发）；ROOT 上溯到插件根
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="$(basename "$ROOT")"
# 服务工作目录 = 脚本所在目录（assets/，start-preview.mjs 在此）
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT/${PROJECT_NAME}.pid"
LOG_FILE="$SERVER_DIR/preview-server.log"
DEFAULT_PORT="${DEFAULT_PORT:-30999}"
LOG_ROTATE_BYTES=$((10 * 1024 * 1024))
STOP_WAIT_SEC=10
START_WAIT_SEC="${START_WAIT_SEC:-15}"

# ---------- 颜色 ----------
C_GREEN="" C_YELLOW="" C_RED="" C_DIM="" C_RESET=""
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_DIM=$'\033[2m'
  C_RESET=$'\033[0m'
fi
ok()   { printf '%s%s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
warn() { printf '%s%s%s\n' "$C_YELLOW" "$*" "$C_RESET"; }
err()  { printf '%s%s%s\n' "$C_RED" "$*" "$C_RESET"; }
dim()  { printf '%s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }

# 历史 PID 位置（迁移兼容）
legacy_pid_files() {
  printf '%s\n' \
    "$SERVER_DIR/app.pid" \
    "$SERVER_DIR/${PROJECT_NAME}.pid" \
    "/tmp/${PROJECT_NAME}.pid" \
    "/tmp/start-${PROJECT_NAME}.pid"
}

# ---------- Node 定位（独立可搬运，内联不 source）----------
find_node() {
  local c nvm
  for c in \
    "$ROOT/tool/node/bin/node" \
    /usr/local/bin/node \
    /opt/homebrew/bin/node \
    /opt/node/bin/node \
    /var/packages/Node.js_v24/target/usr/local/bin/node \
    /var/packages/Node.js_v22/target/usr/local/bin/node \
    /var/packages/Node.js_v20/target/usr/local/bin/node \
    /var/packages/DeepSeekHarness-NAS/target/bin/node \
    node; do
    if [ -x "$c" ]; then NODE_BIN="$c"; return 0; fi
    if command -v "$c" >/dev/null 2>&1; then NODE_BIN="$(command -v "$c")"; return 0; fi
  done
  for nvm in "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$nvm" ]; then NODE_BIN="$nvm"; return 0; fi
  done
  return 1
}

if ! find_node; then
  err "❌ 找不到 node。请安装 Node.js，或把官方二进制解压到 tool/node/"
  exit 1
fi
ok "✓ Node: $NODE_BIN ($("$NODE_BIN" -v 2>/dev/null))"

file_size() {
  local f="$1"
  [ -f "$f" ] || { echo 0; return; }
  stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null || wc -c < "$f"
}

human_size() {
  local n="$1"
  if [ "$n" -ge 1048576 ]; then awk -v n="$n" 'BEGIN{printf "%.1fMB", n/1048576}'; else awk -v n="$n" 'BEGIN{printf "%.1fKB", n/1024}'; fi
}

# ---------- token 解析：DSH_PREVIEW_TOKEN env > DSH_HOME 上级 DeepSeekHarness-NAS.log 最新 token ----------
resolve_token() {
  if [ -n "${DSH_PREVIEW_TOKEN:-}" ]; then printf '%s' "$DSH_PREVIEW_TOKEN"; return 0; fi
  local dsh_home="${DSH_HOME:-}"
  [ -n "$dsh_home" ] || dsh_home="$HOME/.dsh"
  local log_file="$dsh_home/../DeepSeekHarness-NAS.log"
  if [ -f "$log_file" ]; then
    grep -o 'token=[a-zA-Z0-9_-]\{20,\}' "$log_file" 2>/dev/null | tail -n1 | sed 's/^token=//'
    return 0
  fi
  return 0 # 找不到就空，start-preview.mjs 内部还有兜底
}

# ---------- 端口工具 ----------
port_in_use() {
  local port="$1" out=""
  if command -v ss >/dev/null 2>&1; then
    out="$(ss -tln 2>/dev/null)"
  elif command -v netstat >/dev/null 2>&1; then
    out="$(netstat -tln 2>/dev/null)"
  fi
  [ -n "$out" ] || return 1
  printf '%s\n' "$out" | awk -v p="$port" '
    $4 ~ ("[.:]" p "$") { found = 1; exit }
    END { exit(found ? 0 : 1) }'
}

port_pids() {
  local port="$1" out=""
  if command -v ss >/dev/null 2>&1; then
    out="$(ss -tlnp 2>/dev/null | awk -v p="$port" '$4 ~ ("[.:]" p "$") {print}')"
  elif command -v netstat >/dev/null 2>&1; then
    out="$(netstat -tlnp 2>/dev/null | awk -v p="$port" '$4 ~ ("[.:]" p "$") {print}')"
  fi
  [ -n "$out" ] || return 0
  printf '%s\n' "$out" | grep -o 'pid=[0-9]*' | cut -d= -f2
  printf '%s\n' "$out" | awk '{n=split($NF,a,"/"); if (n>1 && a[1] ~ /^[0-9]+$/) print a[1]}'
}

wait_port_free() {
  local port="$1" timeout="${2:-10}" i=0
  while [ "$i" -lt "$((timeout * 2))" ]; do
    port_in_use "$port" || return 0
    sleep 0.5
    i=$((i + 1))
  done
  return 1
}

listen_line() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -tln 2>/dev/null | awk -v p=":$port" '$0 ~ p {print; exit}'
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tln 2>/dev/null | awk -v p=":$port" '$0 ~ p {print; exit}'
  fi
}

pid_alive() {
  local p="$1"
  [ -n "$p" ] && kill -0 "$p" 2>/dev/null
}

read_pid_file() {
  local f="$1"
  [ -f "$f" ] && [ -s "$f" ] || return 1
  tr -d ' \t\r\n' < "$f"
}

collect_live_pids() {
  # 2026-09-20 修：端口必须随调用方实际端口走（--port 覆盖时查 DEFAULT_PORT 会抓错
  #   别的项目同端口进程 → 误报「已在运行」）。缺省仍用 DEFAULT_PORT 兼容旧调用。
  local f p seen=" " port="${1:-$DEFAULT_PORT}"
  for f in "$PID_FILE" $(legacy_pid_files); do
    p="$(read_pid_file "$f" 2>/dev/null || true)"
    if pid_alive "$p"; then
      case "$seen" in
        *" $p "*) ;;
        *) seen="$seen$p "; printf '%s\n' "$p" ;;
      esac
    fi
  done
  local lp
  lp="$(port_pids "$port")"
  for p in $lp; do
    case "$seen" in
      *" $p "*) ;;
      *) seen="$seen$p "; printf '%s\n' "$p" ;;
    esac
  done
}

rotate_log() {
  [ -f "$LOG_FILE" ] || return 0
  local sz
  sz="$(file_size "$LOG_FILE")"
  [ "$sz" -gt "$LOG_ROTATE_BYTES" ] || return 0
  local ts dest
  ts="$(date +%Y%m%d-%H%M%S)"
  dest="${LOG_FILE}.${ts}"
  mv "$LOG_FILE" "$dest" || return 0
  if command -v gzip >/dev/null 2>&1; then
    gzip -f "$dest" && dest="${dest}.gz"
  fi
  warn "⚠️  日志超过 10MB，已轮转: $dest ($(human_size "$sz"))"
}

start_server() {
  # --port 覆盖时全局 PORT 已在 main 入口解析（stop/restart/status 同端口语义），
  #   这里保留原内联解析兜底（兼容直接调用函数），但统一用全局 PORT。
  local port_opt=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --port) port_opt="${2:-}"; shift 2 ;;
      *) shift ;;
    esac
  done
  local port="${PORT:-${port_opt:-$DEFAULT_PORT}}"
  local live
  live="$(collect_live_pids "$port" | head -n 1 || true)"
  if [ -n "$live" ]; then
    warn "⚠️  已在运行 (PID $live, 端口 $port)。如需重启: ./start.sh restart"
    return 1
  fi
  if port_in_use "$port"; then
    warn "⏳ 端口 $port 仍被占用，等待释放（最多 ${START_WAIT_SEC}s）..."
    if ! wait_port_free "$port" "$START_WAIT_SEC"; then
      err "❌ 端口 $port 等待 ${START_WAIT_SEC}s 仍未释放，放弃启动。"
      err "   排查：netstat -tlnp | grep :$port   或换端口: ./start.sh --port <新端口>"
      return 1
    fi
    ok "✓ 端口 $port 已释放"
  fi
  rm -f "$PID_FILE"
  mkdir -p "$SERVER_DIR"
  rotate_log
  local token
  token="$(resolve_token)"
  local cmd=("$NODE_BIN" start-preview.mjs --port "$port" --no-open)
  if [ -n "$token" ]; then cmd+=("--token" "$token"); fi
  cd "$SERVER_DIR" || exit 1
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup "${cmd[@]}" >> "$LOG_FILE" 2>&1 < /dev/null &
  else
    nohup "${cmd[@]}" >> "$LOG_FILE" 2>&1 < /dev/null &
  fi
  echo $! > "$PID_FILE"
  local new_pid okflag=0 i
  new_pid="$(cat "$PID_FILE")"

  for i in $(seq 1 8); do
    sleep 1
    if curl -sf -m 3 "http://127.0.0.1:$port/preview-ping" > /dev/null 2>&1; then
      okflag=1
      break
    fi
    pid_alive "$new_pid" || break
  done
  if [ "$okflag" = 1 ]; then
    ok "✅ 启动成功  PID=$new_pid  端口=$port"
    echo "   页面: http://<本机IP>:$port"
    echo "   日志: $LOG_FILE"
    echo "   PID:  $PID_FILE"
  else
    err "❌ 启动失败（8 秒内未通过健康检查），最近日志："
    tail -15 "$LOG_FILE" 2>/dev/null
    return 1
  fi
}

stop_one() {
  local pid="$1"
  warn "⏹  SIGTERM  PID=$pid （最多等 ${STOP_WAIT_SEC}s）"
  kill "$pid" 2>/dev/null || true
  local i
  for i in $(seq 1 "$STOP_WAIT_SEC"); do
    if ! pid_alive "$pid"; then
      ok "✓ PID $pid 已在 ${i}s 内退出"
      return 0
    fi
    sleep 1
  done
  if pid_alive "$pid"; then
    warn "⚠️  ${STOP_WAIT_SEC}s 未退出，SIGKILL PID=$pid"
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
  if pid_alive "$pid"; then
    err "❌ PID $pid 仍在，请检查"
    return 1
  fi
  ok "✓ PID $pid 已强制结束"
}

stop_server() {
  local pids
  pids="$(collect_live_pids "$PORT" || true)"
  if [ -z "$pids" ]; then
    warn "⚠️  未运行（无有效 PID）"
    rm -f "$PID_FILE"
    local f
    for f in $(legacy_pid_files); do rm -f "$f"; done
    return 0
  fi
  local rc=0
  for p in $pids; do
    stop_one "$p" || rc=1
  done
  rm -f "$PID_FILE"
  local f
  for f in $(legacy_pid_files); do rm -f "$f"; done
  if [ "$rc" = 0 ]; then
    ok "✅ 已停止"
  else
    err "❌ 停止未完成"
  fi
  return "$rc"
}

status_server() {
  local port="${PORT:-$DEFAULT_PORT}"
  echo "======== $PROJECT_NAME 预览服务器 ========"
  echo "根目录: $ROOT"
  echo "PID文件: $PID_FILE$([ -f "$PID_FILE" ] && echo " (存在)" || echo " (无)")"

  local p
  p="$(read_pid_file "$PID_FILE" 2>/dev/null || true)"
  if pid_alive "$p"; then
    ok "进程:   ✓ PID $p"
    ps -o pid=,ppid=,etime=,rss=,stat=,args= -p "$p" 2>/dev/null | while IFS= read -r line; do
      dim "        $line"
    done
  elif [ -n "$p" ]; then
    err "进程:   ✗ PID 文件有 $p 但进程已退出"
  else
    err "进程:   ✗ 未运行"
  fi

  local lis
  lis="$(listen_line "$port")"
  if [ -n "$lis" ]; then
    ok "监听:   ✓ 端口 $port"
    dim "        $lis"
  else
    warn "监听:   未发现 :$port"
  fi

  local curlout code time
  curlout="$(curl -sS -m 5 -o /tmp/${PROJECT_NAME}-status.body -w '%{http_code} %{time_total}' "http://127.0.0.1:$port/preview-ping" 2>/dev/null || echo "000 0")"
  code="${curlout%% *}"
  time="${curlout#* }"
  if [ "$code" = "200" ]; then
    ok "HTTP:   ✓ GET /preview-ping  $code  ${time}s"
    head -c 80 "/tmp/${PROJECT_NAME}-status.body" 2>/dev/null; echo
  else
    err "HTTP:   ✗ GET /preview-ping  HTTP $code"
  fi
  rm -f "/tmp/${PROJECT_NAME}-status.body"

  if [ -f "$LOG_FILE" ]; then
    local sz mtime
    sz="$(file_size "$LOG_FILE")"
    mtime="$(date -r "$LOG_FILE" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || stat -c %y "$LOG_FILE" 2>/dev/null | cut -d. -f1)"
    echo "日志:   $LOG_FILE  $(human_size "$sz")  更新 $mtime"
    echo "-------- 最近 8 行 --------"
    tail -8 "$LOG_FILE" 2>/dev/null
  else
    warn "日志:   尚无 $LOG_FILE"
  fi
}

CMD="${1:-restart}"
if [ "$CMD" = "--port" ]; then
  CMD="restart"
elif [ "$CMD" = "start" ] || [ "$CMD" = "stop" ] || [ "$CMD" = "restart" ] || [ "$CMD" = "status" ]; then
  shift
else
  CMD="restart"
fi

# 全局端口解析（2026-09-20 修）：start/restart 带 --port 时，stop/status 必须按同一端口
#   收集存活进程——否则 restart --port X 会先按默认端口停掉**别的项目**的同端口服务（SIGTERM→SIGKILL 误杀）。
PORT="${DEFAULT_PORT:-30999}"
if [ $# -ge 2 ]; then
  for ((i = 1; i <= $#; i++)); do
    if [ "${!i}" = "--port" ] && [ $((i + 1)) -le $# ]; then
      PORT="${@:$((i + 1)):1}"
      break
    fi
  done
fi

case "$CMD" in
  start)   start_server "$@" ;;
  stop)    stop_server ;;
  restart)
    stop_server
    sleep 1
    start_server "$@"
    ;;
  status)  status_server ;;
  *)
    err "❌ 未知命令: $CMD"
    echo "可用命令: start, stop, restart, status"
    exit 1
    ;;
esac