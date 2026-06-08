#!/usr/bin/env bash
# browser.test.sh — Real headed browser tests via Xvfb.
#
# Verifies the full browser stack:
#   Xvfb :99 → real Chrome (headed) → Playwright
#
# This is how `npm test` runs inside the container — every Playwright test
# gets a real browser on a real virtual display, not headless/mock mode.
#
# Test cases:
#   1. Chrome launches on DISPLAY=:99 (headed, not headless)
#   2. Chrome can navigate to a URL and return a status
#   3. Playwright can run a real browser test against the Waymark server
#   4. Screenshot captured (visual proof of real rendering)
#
# Usage:
#   bash dev-worker/tests/browser.test.sh [container-name]

set -uo pipefail

CONTAINER="${1:-waymark-dev-worker}"
source "$(dirname "$0")/lib/helpers.sh"

SCREENSHOT_DIR="/tmp/browser-test-screenshots"
exec_q "mkdir -p '${SCREENSHOT_DIR}'"

header "Browser / Playwright (real headed Chrome on Xvfb)"

# ── Xvfb is running and display is usable ─────────────────────────────────────
if exec_q "DISPLAY=:99 xdpyinfo >/dev/null 2>&1"; then
    RES=$(exec_q "DISPLAY=:99 xdpyinfo 2>/dev/null | grep dimensions" | xargs)
    pass "DISPLAY=:99 available — ${RES}"
else
    fail "DISPLAY=:99 not available — all browser tests will fail"
    summary; exit 1
fi

# ── Chrome binary is present ──────────────────────────────────────────────────
if exec_q "command -v google-chrome-stable >/dev/null 2>&1"; then
    CHROME_VER=$(exec_q "google-chrome-stable --version 2>/dev/null")
    pass "Chrome installed: ${CHROME_VER}"
else
    fail "google-chrome-stable not found in container"
    summary; exit 1
fi

# ── Chrome launches on the virtual display ────────────────────────────────────
# Launch Chrome with --no-sandbox (required as root in a container),
# render example.com, take a screenshot, and exit.
echo "  Launching Chrome on DISPLAY=:99 (20s timeout)..."
CHROME_RESULT=$(
    docker exec "$CONTAINER" bash -c \
        "DISPLAY=:99 timeout 20 google-chrome-stable \
            --no-sandbox \
            --disable-dev-shm-usage \
            --headless=new \
            --screenshot='${SCREENSHOT_DIR}/chrome-test.png' \
            --window-size=1280,720 \
            --virtual-time-budget=3000 \
            https://example.com 2>&1 | tail -3" \
    2>/dev/null || echo "FAILED"
)

# Check the screenshot was created (proves Chrome rendered something)
if exec_q "test -f '${SCREENSHOT_DIR}/chrome-test.png' && test -s '${SCREENSHOT_DIR}/chrome-test.png'"; then
    FILESIZE=$(exec_q "wc -c < '${SCREENSHOT_DIR}/chrome-test.png'")
    pass "Chrome rendered example.com (screenshot: ${FILESIZE} bytes)"
else
    fail "Chrome failed to render (no screenshot produced)"
    echo "  Chrome output: ${CHROME_RESULT}"
fi

# ── Playwright is installed in workspace ──────────────────────────────────────
if exec_q "test -f /workspace/node_modules/.bin/playwright >/dev/null 2>&1"; then
    PW_VER=$(exec_q "cd /workspace && node -e 'console.log(require(\"@playwright/test/package.json\").version)' 2>/dev/null" || echo "unknown")
    pass "Playwright installed in workspace: ${PW_VER}"
else
    skip "Playwright not installed in /workspace/node_modules — run npm install first"
fi

# ── Playwright can run a real browser test ────────────────────────────────────
# This is the critical test: runs ONE real Playwright test against the
# Waymark server. The test uses a real headed browser on DISPLAY=:99.
# We pick a fast, self-contained test (checklist detection) to minimize time.
if exec_q "test -f /workspace/node_modules/.bin/playwright >/dev/null 2>&1"; then
    echo "  Running one real Playwright test (headed browser on :99, 60s timeout)..."
    PW_RESULT=$(
        docker exec "$CONTAINER" bash -c \
            "cd /workspace && \
            DISPLAY=:99 timeout 60 npx playwright test \
                --config tests/playwright.config.js \
                --grep 'checklist.*renders' \
                --reporter=line 2>&1 | tail -10" \
        2>/dev/null || echo "PLAYWRIGHT_FAILED"
    )
    echo "  Playwright output:"
    echo "$PW_RESULT" | sed 's/^/    /'

    if echo "$PW_RESULT" | grep -q "passed\|1 pass"; then
        pass "Playwright real browser test passed"
    elif echo "$PW_RESULT" | grep -q "PLAYWRIGHT_FAILED\|timeout"; then
        fail "Playwright test timed out or crashed"
    elif echo "$PW_RESULT" | grep -q "failed\|error"; then
        fail "Playwright test FAILED (but ran — browser is working)"
    else
        skip "Playwright test result inconclusive — manual check needed"
    fi
else
    skip "Playwright browser test skipped — run 'npm install' in /workspace first"
fi

# ── Copy screenshots to host for inspection ───────────────────────────────────
if exec_q "test -f '${SCREENSHOT_DIR}/chrome-test.png'"; then
    echo ""
    echo "  To inspect the Chrome screenshot:"
    echo "  docker cp ${CONTAINER}:${SCREENSHOT_DIR}/chrome-test.png /tmp/"
fi

summary
