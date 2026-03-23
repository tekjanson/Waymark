#!/usr/bin/env bash
# test.sh — Diagnostic test suite for the waymark-dev-worker container.
# Run from the host: ./dev-worker/test.sh
# Run a specific test: ./dev-worker/test.sh vnc auth watchdog
#
# Exit code: 0 = all tests passed, 1 = one or more failed

set -uo pipefail

CONTAINER="waymark-dev-worker"
PASS=0
FAIL=0
SKIP=0
FILTER=("${@}")   # optional: only run tests whose names match these args

# ── Helpers ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

pass() { echo -e "  ${GREEN}✓${RESET} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${RESET} $1"; FAIL=$((FAIL+1)); }
skip() { echo -e "  ${YELLOW}–${RESET} $1 (skipped)"; SKIP=$((SKIP+1)); }
header() { echo -e "\n${BOLD}$1${RESET}"; }

should_run() {
    [[ ${#FILTER[@]} -eq 0 ]] && return 0
    for f in "${FILTER[@]}"; do
        [[ "$1" == *"$f"* ]] && return 0
    done
    return 1
}

# Check container is running before anything else
if ! docker ps --filter "name=^${CONTAINER}$" --filter "status=running" \
        --format "{{.Names}}" | grep -q "^${CONTAINER}$"; then
    echo -e "${RED}ERROR${RESET}: container '${CONTAINER}' is not running."
    echo "  Start it with: docker compose -f dev-worker/docker-compose.yml up -d"
    exit 1
fi

exec_q() { docker exec "$CONTAINER" bash -c "$1" 2>/dev/null; }

# ── 1. Infrastructure ─────────────────────────────────────────────────────────
if should_run "infra"; then
header "1. Infrastructure"

    # 1a. All supervisor programs running
    RUNNING=$(exec_q "supervisorctl -c /etc/supervisord.conf status 2>/dev/null | grep RUNNING | wc -l" || echo "0")
    TOTAL=$(exec_q "supervisorctl -c /etc/supervisord.conf status 2>/dev/null | wc -l" || echo "0")
    if [[ "$RUNNING" -eq "$TOTAL" && "$TOTAL" -gt 0 ]]; then
        pass "All ${RUNNING}/${TOTAL} supervisor programs RUNNING"
    else
        fail "Only ${RUNNING}/${TOTAL} supervisor programs are RUNNING"
        exec_q "supervisorctl -c /etc/supervisord.conf status 2>/dev/null" | sed 's/^/    /'
    fi

    # 1b. /etc/agent-env.sh exists and has AGENT_COMMAND
    if exec_q "grep -q 'AGENT_COMMAND' /etc/agent-env.sh"; then
        AGENT_CMD=$(exec_q "grep AGENT_COMMAND /etc/agent-env.sh | head -1")
        pass "agent-env.sh present — ${AGENT_CMD}"
    else
        fail "agent-env.sh missing or lacks AGENT_COMMAND"
    fi

    # 1c. BROWSER= is set in agent-env.sh
    if exec_q "grep -q 'BROWSER=\"\"' /etc/agent-env.sh"; then
        pass "BROWSER='' in agent-env.sh (auth URL shown as copy-link)"
    else
        fail "BROWSER= not set in agent-env.sh — VS Code may try to open a browser inside the container"
    fi

    # 1d. globalStorage volume is NOT seeded with host tokens
    SEEDED_TOKENS=$(exec_q "find /root/.config/Code/User/globalStorage -name 'keychain*' -o -name 'secret*' 2>/dev/null | wc -l" || echo "0")
    if [[ "$SEEDED_TOKENS" -eq 0 ]]; then
        pass "globalStorage contains no host keychain/secret files (correct)"
    else
        fail "globalStorage has ${SEEDED_TOKENS} potential keychain files (host tokens may have been seeded)"
    fi
fi

# ── 2. VNC / desktop ──────────────────────────────────────────────────────────
if should_run "vnc"; then
header "2. VNC / Desktop"

    # 2a. Port 5901 is open on the host
    if python3 -c "import socket; s=socket.socket(); s.settimeout(3); s.connect(('localhost',5901)); s.close()" 2>/dev/null; then
        pass "Port 5901 (VNC) is open on localhost"
    else
        fail "Port 5901 (VNC) is not reachable"
    fi

    # 2b. VNC speaks RFB and offers SecurityType=None
    VNC_RESULT=$(python3 - <<'PYEOF'
import socket, struct, sys
try:
    s = socket.socket(); s.settimeout(5); s.connect(('localhost', 5901))
    banner = s.recv(12); s.send(b'RFB 003.008\n')
    n = struct.unpack('B', s.recv(1))[0]; types = list(s.recv(n))
    s.close()
    if b'RFB' in banner and 1 in types:
        print("OK")
    else:
        print(f"BAD: banner={banner!r} types={types}")
except Exception as e:
    print(f"ERROR: {e}")
PYEOF
)
    if [[ "$VNC_RESULT" == "OK" ]]; then
        pass "VNC offers SecurityType=None (no password required)"
    else
        fail "VNC check failed: ${VNC_RESULT}"
    fi

    # 2c. noVNC page is serving
    STATUS=$(python3 -c "import urllib.request; r=urllib.request.urlopen('http://localhost:6080/vnc.html'); print(r.status)" 2>/dev/null || echo "FAIL")
    if [[ "$STATUS" == "200" ]]; then
        pass "noVNC page serving at http://localhost:6080/vnc.html (HTTP 200)"
    else
        fail "noVNC page not reachable (got: ${STATUS})"
    fi

    # 2d. X display is running inside container
    if exec_q "DISPLAY=:1 xdpyinfo >/dev/null 2>&1"; then
        pass "X display :1 is running inside container"
    else
        fail "X display :1 not available inside container"
    fi
fi

# ── 3. VS Code ────────────────────────────────────────────────────────────────
if should_run "vscode"; then
header "3. VS Code"

    # 3a. VS Code process is running
    VSCODE_PID=$(exec_q "pgrep -f 'code.*--no-sandbox.*--user-data-dir' | head -1" || echo "")
    if [[ -n "$VSCODE_PID" ]]; then
        pass "VS Code process running (pid: ${VSCODE_PID})"
    else
        fail "VS Code process not found"
    fi

    # 3b. --password-store=basic flag is present
    if exec_q "pgrep -a code | grep -q 'password-store=basic'"; then
        pass "VS Code launched with --password-store=basic"
    else
        fail "VS Code NOT using --password-store=basic (tokens may try to use gnome-keyring)"
    fi

    # 3c. No safeStorage decryption errors in VS Code logs
    DECRYPT_ERRORS=$(exec_q "find /root/.config/Code/logs -name '*.log' 2>/dev/null | xargs grep -l 'decrypting the ciphertext' 2>/dev/null | wc -l" || echo "0")
    if [[ "$DECRYPT_ERRORS" -eq 0 ]]; then
        pass "No safeStorage decryption errors in VS Code logs"
    else
        fail "safeStorage decryption errors found in ${DECRYPT_ERRORS} log file(s) — host tokens leaked into globalStorage"
        fail "  Fix: docker compose down && docker volume rm dev-worker_waymark-vscode-auth && docker compose up -d"
    fi

    # 3d. VS Code window is visible on the display
    if exec_q "DISPLAY=:1 xdotool search --class 'Code' >/dev/null 2>&1"; then
        pass "VS Code window visible on display :1"
    else
        fail "VS Code window not found on display :1"
    fi

    # 3e. Copilot extension is installed
    if exec_q "ls /root/.vscode/extensions/ | grep -q 'github.copilot-'"; then
        COPILOT_VER=$(exec_q "ls /root/.vscode/extensions/ | grep 'github.copilot-[0-9]' | head -1")
        pass "GitHub Copilot extension installed: ${COPILOT_VER}"
    else
        fail "GitHub Copilot extension NOT installed"
    fi

    # 3f. Copilot Chat extension is installed
    if exec_q "ls /root/.vscode/extensions/ | grep -q 'github.copilot-chat'"; then
        CHAT_VER=$(exec_q "ls /root/.vscode/extensions/ | grep 'github.copilot-chat' | head -1")
        pass "GitHub Copilot Chat extension installed: ${CHAT_VER}"
    else
        fail "GitHub Copilot Chat extension NOT installed"
    fi
fi

# ── 4. GitHub Auth ────────────────────────────────────────────────────────────
if should_run "auth"; then
header "4. GitHub Auth"

    # 4a. globalStorage volume is writable
    if exec_q "touch /root/.config/Code/User/globalStorage/.write-test && rm /root/.config/Code/User/globalStorage/.write-test"; then
        pass "globalStorage volume is writable"
    else
        fail "globalStorage volume is NOT writable"
    fi

    # 4b. Look for GitHub auth token in VS Code's basic secret store.
    # With --password-store=basic, VS Code writes secrets to one of:
    #   globalStorage/state.vscdb  (encoded in SQLite)
    #   globalStorage/<extension>/  JSON files
    # Most reliably: look for a github.com token in any JSON under globalStorage
    TOKEN_COUNT=$(exec_q "find /root/.config/Code/User/globalStorage -name '*.json' -size +20c 2>/dev/null \
        | xargs grep -li 'token\|session\|github' 2>/dev/null | wc -l" || echo "0")
    TOKEN_COUNT="${TOKEN_COUNT%%$'\n'*}"
    if [[ "${TOKEN_COUNT:-0}" -gt 0 ]]; then
        pass "Auth token files found in globalStorage (${TOKEN_COUNT} file(s) with token data)"
    else
        skip "No auth token files yet — run: bash dev-worker/setup-auth.sh"
    fi

    # 4c. Check that VS Code state DB has github session data
    HAS_SESSION=$(exec_q "find /root/.config/Code/User/globalStorage -name 'vscode.github-authentication' -type d 2>/dev/null | wc -l" || echo "0")
    HAS_SESSION="${HAS_SESSION%%$'\n'*}"
    if [[ "${HAS_SESSION:-0}" -gt 0 ]]; then
        pass "vscode.github-authentication extension storage directory exists"
    else
        skip "No github-authentication storage dir yet — run: bash dev-worker/setup-auth.sh"
    fi
fi

# ── 5. Watchdog ───────────────────────────────────────────────────────────────
if should_run "watchdog"; then
header "5. Agent Watchdog"

    # 5a. Watchdog boot script has completed (oneshot — runs at container start, then exits)
    # Check for completion message in docker logs since agent-watchdog is now oneshot
    BOOT_DONE=$(exec_q "grep -c 'Boot complete' /proc/1/fd/1 2>/dev/null || \
        supervisorctl status agent-watchdog 2>/dev/null | grep -c 'EXITED'" || echo "0")
    BOOT_DONE="${BOOT_DONE%%$'\n'*}"
    if exec_q "supervisorctl status agent-watchdog 2>/dev/null | grep -qE 'RUNNING|EXITED'"; then
        pass "agent-watchdog.sh has run (oneshot boot script)"
    else
        fail "agent-watchdog.sh has NOT run"
    fi

    # 5b. AGENT_NAME is set (for multi-agent task claiming)
    AGENT_NAME_VAL=$(exec_q "grep AGENT_NAME /etc/agent-env.sh 2>/dev/null | cut -d'\"' -f2" || echo "")
    if [[ -n "$AGENT_NAME_VAL" ]]; then
        pass "AGENT_NAME is set: ${AGENT_NAME_VAL}"
    else
        skip "AGENT_NAME not set — single-agent mode"
    fi
fi

# ── 6. Workspace ──────────────────────────────────────────────────────────────
if should_run "workspace"; then
header "6. Workspace"

    # 6a. /workspace is mounted and has the right contents
    if exec_q "test -f /workspace/package.json"; then
        pass "/workspace/package.json exists (Waymark repo mounted correctly)"
    else
        fail "/workspace is empty or missing — check volume mount in docker-compose.yml"
    fi

    # 6b. Node.js is available
    NODE_VER=$(exec_q "node --version 2>/dev/null" || echo "NOT FOUND")
    if [[ "$NODE_VER" == v* ]]; then
        pass "Node.js available: ${NODE_VER}"
    else
        fail "Node.js not found inside container"
    fi

    # 6c. Google credentials file is mounted
    if exec_q "test -f \"\$GOOGLE_APPLICATION_CREDENTIALS\"" || exec_q "test -f /credentials/gsa-key.json"; then
        pass "Google service-account key is mounted at /credentials/gsa-key.json"
    else
        fail "Google service-account key NOT mounted — workboard scripts will fail"
    fi

    # 6d. Git is available and workspace has a valid git repo
    if exec_q "git -C /workspace rev-parse HEAD >/dev/null 2>&1"; then
        BRANCH=$(exec_q "git -C /workspace branch --show-current 2>/dev/null" || echo "unknown")
        pass "Git repo valid in /workspace (branch: ${BRANCH})"
    else
        fail "Git repo not valid in /workspace"
    fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════${RESET}"
TOTAL_RUN=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}All ${TOTAL_RUN} tests passed${RESET}${SKIP:+ (${SKIP} skipped)}"
else
    echo -e "${RED}${BOLD}${FAIL} test(s) FAILED${RESET} / ${PASS} passed / ${SKIP} skipped"
fi
echo -e "${BOLD}═══════════════════════════════════════${RESET}"
echo ""

[[ $FAIL -eq 0 ]]
