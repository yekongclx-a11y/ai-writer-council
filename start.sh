#!/usr/bin/env bash
set -e

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

# 优先使用 uv，否则退回到系统 python
if command -v uv &>/dev/null; then
  exec uv run uvicorn backend.main:app --host "$HOST" --port "$PORT" "$@"
else
  exec python -m uvicorn backend.main:app --host "$HOST" --port "$PORT" "$@"
fi
