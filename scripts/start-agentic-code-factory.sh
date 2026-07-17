#!/usr/bin/env bash
set -euo pipefail

OLLAMA_ROOT="${OLLAMA_ROOT:-/home/tekjanson/Documents/Code/ollama}"
WAYMARK_ROOT="${WAYMARK_ROOT:-/home/tekjanson/Documents/Code/Waymark}"
WAYMARK_UI_URL="${WAYMARK_UI_URL:-https://swiftirons.com/waymark}"
START_AGENTS="${START_AGENTS:-1}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but was not found in PATH" >&2
  exit 1
fi

if [[ ! -d "$OLLAMA_ROOT" ]]; then
  echo "Ollama repo not found at $OLLAMA_ROOT" >&2
  exit 1
fi

if [[ ! -d "$WAYMARK_ROOT" ]]; then
  echo "Waymark repo not found at $WAYMARK_ROOT" >&2
  exit 1
fi

echo "Starting local Ollama + Open WebUI..."
(cd "$OLLAMA_ROOT" && bash scripts/bootstrap.sh)

if [[ "$START_AGENTS" == "1" ]]; then
  echo "Starting Waymark agents..."
  (cd "$WAYMARK_ROOT" && make fleet-start)
else
  echo "Skipping agent startup (START_AGENTS=0)."
fi

echo "Opening Waymark UI..."
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$WAYMARK_UI_URL" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "$WAYMARK_UI_URL" >/dev/null 2>&1 || true
fi

echo "Waymark UI: $WAYMARK_UI_URL"
echo "Open WebUI: http://localhost:3000"
