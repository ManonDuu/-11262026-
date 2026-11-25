#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "未找到 Node.js / npm。请先安装 Node.js 24 LTS，再重新打开终端。"
  exit 1
fi
node scripts/check-node.mjs
if [ ! -d node_modules ]; then npm ci --no-audit --no-fund; fi
HOST=127.0.0.1
PORT="${PORT:-5180}"
echo "拼多多工作台02版：http://$HOST:$PORT/（关闭本终端停止服务）"
exec npm run dev -- --host "$HOST" --port "$PORT" --strictPort
