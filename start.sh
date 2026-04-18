#!/usr/bin/env bash
# Start local dev: extension watch + Vite web app (repo root).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

WEBAPP_URL="${WEBAPP_URL:-http://127.0.0.1:5173/}"

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}

# Wait until the web app answers (Vite dev server). Falls back to a short sleep if curl is missing.
wait_for_webapp() {
  local url=$1
  local max_attempts=${2:-40}
  local i=0
  if ! command -v curl >/dev/null 2>&1; then
    sleep 2
    return 0
  fi
  while [ "$i" -lt "$max_attempts" ]; do
    if curl -sf -o /dev/null "$url"; then
      return 0
    fi
    sleep 0.5
    i=$((i + 1))
  done
  echo "Warning: web app did not respond at $url — opening browser anyway." >&2
}

open_in_chrome() {
  local url=$1
  case "$(uname -s)" in
    Darwin)
      if [ -d "/Applications/Google Chrome.app" ]; then
        open -a "Google Chrome" "$url" 2>/dev/null && return 0
      fi
      if [ -d "/Applications/Chromium.app" ]; then
        open -a "Chromium" "$url" 2>/dev/null && return 0
      fi
      open "$url" 2>/dev/null && return 0
      ;;
  esac
  if command -v google-chrome-stable >/dev/null 2>&1; then
    google-chrome-stable "$url" 2>/dev/null && return 0
  fi
  if command -v google-chrome >/dev/null 2>&1; then
    google-chrome "$url" 2>/dev/null && return 0
  fi
  if command -v chromium >/dev/null 2>&1; then
    chromium "$url" 2>/dev/null && return 0
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" 2>/dev/null && return 0
  fi
  echo "Warning: could not find a browser to open $url" >&2
  return 1
}

maybe_open_browser() {
  [ "${NO_OPEN:-0}" = "1" ] && return 0
  local mode=$1
  case "$mode" in
    all|webapp)
      (
        wait_for_webapp "$WEBAPP_URL"
        echo "Opening $WEBAPP_URL in Chrome (or default browser)."
        open_in_chrome "$WEBAPP_URL" || true
      ) &
      ;;
    extension)
      (
        sleep 1
        echo "Opening chrome://extensions (load unpacked from extension/dist if needed)."
        open_in_chrome "chrome://extensions" || true
      ) &
      ;;
  esac
}

PIDS=()
trap cleanup EXIT INT TERM

usage() {
  echo "Usage: $0 [extension|webapp|all]" >&2
  echo "  extension  — pnpm dev:extension only" >&2
  echo "  webapp     — pnpm dev:webapp only" >&2
  echo "  all        — both (default)" >&2
  echo "Environment:" >&2
  echo "  NO_OPEN=1     — do not open a browser tab" >&2
  echo "  WEBAPP_URL=… — URL to wait for / open (default $WEBAPP_URL)" >&2
}

MODE="${1:-all}"
case "$MODE" in
  extension)
    pnpm dev:extension &
    PIDS+=($!)
    ;;
  webapp)
    pnpm dev:webapp &
    PIDS+=($!)
    ;;
  all)
    pnpm dev:extension &
    PIDS+=($!)
    pnpm dev:webapp &
    PIDS+=($!)
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    usage
    exit 1
    ;;
esac

maybe_open_browser "$MODE"

echo "Started ($MODE). Press Ctrl+C to stop."
wait
