#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export DEBIAN_FRONTEND=noninteractive

log() {
  echo "[setup-dev-env] $*"
}

detect_browser() {
  local candidate
  for candidate in \
    "/snap/bin/chromium" \
    "/usr/bin/chromium" \
    "/usr/bin/chromium-browser" \
    "/usr/bin/google-chrome" \
    "/usr/bin/google-chrome-stable"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v chromium >/dev/null 2>&1; then
    command -v chromium
    return 0
  fi

  return 1
}

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  log "Installing Node.js and npm via apt..."
  sudo apt-get update
  sudo apt-get install -y nodejs npm
else
  log "Node.js and npm already present"
fi

log "Node.js: $(node --version)"
log "npm: $(npm --version)"

log "Installing project dependencies..."
npm install

if [ -f package.json ]; then
  log "Checking Playwright browser runtime..."
  if browser_path="$(detect_browser)"; then
    log "Found browser at $browser_path"
    export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$browser_path"
    export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
    if ! grep -q "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH" "$HOME/.bashrc" 2>/dev/null; then
      printf '\n# Waymark Playwright browser path\nexport PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=%s\nexport PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1\n' "$browser_path" >> "$HOME/.bashrc"
    fi
  else
    log "No system Chromium browser found. Trying Playwright's bundled installer..."
    if ! npx playwright install --with-deps chromium; then
      log "Playwright browser install is unavailable on this distro; continuing because the app can still run in mock mode."
      log "If browser tests are needed later, install Chromium manually and rerun the test suite."
    fi
  fi
fi

log "Setup complete."
log "Run: npm run dev"
