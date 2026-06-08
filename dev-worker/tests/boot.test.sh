#!/usr/bin/env bash
# boot.test.sh — Container boot and infrastructure tests.
#
# Verifies the container started correctly, supervisord is managing all
# processes, and Xvfb is providing a usable virtual display.
#
# All tests run via `docker exec` — real container state, no mocks.
#
# Usage:
#   bash dev-worker/tests/boot.test.sh [container-name]

set -uo pipefail

CONTAINER="${1:-waymark-dev-worker}"
source "$(dirname "$0")/lib/helpers.sh"

header "Boot / Infrastructure"

# ── Container is actually running ─────────────────────────────────────────────
if docker ps --filter "name=^${CONTAINER}$" --filter "status=running" \
       --format "{{.Names}}" | grep -q "^${CONTAINER}$"; then
    pass "Container '${CONTAINER}' is running"
else
    fail "Container '${CONTAINER}' is NOT running"
    echo "  Start it: docker compose -f dev-worker/docker-compose.yml up -d"
    exit 1
fi

# ── supervisord is managing programs ──────────────────────────────────────────
RUNNING=$(exec_q "supervisorctl -c /etc/supervisord.conf status 2>/dev/null | grep RUNNING | wc -l")
TOTAL=$(exec_q "supervisorctl -c /etc/supervisord.conf status 2>/dev/null | wc -l")
if [[ "$RUNNING" -eq "$TOTAL" && "$TOTAL" -gt 0 ]]; then
    pass "All ${RUNNING}/${TOTAL} supervisor programs RUNNING"
    exec_q "supervisorctl -c /etc/supervisord.conf status 2>/dev/null" | sed 's/^/    /'
else
    fail "Only ${RUNNING}/${TOTAL} supervisor programs RUNNING"
    exec_q "supervisorctl -c /etc/supervisord.conf status 2>/dev/null" | sed 's/^/    /'
fi

# ── agent-env.sh written by entrypoint ────────────────────────────────────────
if exec_q "test -f /etc/agent-env.sh && grep -q AGENT_COMMAND /etc/agent-env.sh"; then
    AGENT_CMD=$(exec_q "grep AGENT_COMMAND /etc/agent-env.sh | head -1")
    pass "agent-env.sh present — ${AGENT_CMD}"
else
    fail "agent-env.sh missing or empty"
fi

# ── Xvfb process is running ───────────────────────────────────────────────────
if exec_q "pgrep -x Xvfb >/dev/null 2>&1"; then
    pass "Xvfb process is running"
else
    fail "Xvfb is NOT running (Playwright browser tests will fail)"
fi

# ── Display :99 is usable ─────────────────────────────────────────────────────
if exec_q "DISPLAY=:99 xdpyinfo >/dev/null 2>&1"; then
    RES=$(exec_q "DISPLAY=:99 xdpyinfo 2>/dev/null | grep dimensions" | xargs)
    pass "DISPLAY=:99 usable — ${RES}"
else
    fail "DISPLAY=:99 not usable"
fi

# ── /workspace is mounted and non-empty ───────────────────────────────────────
if exec_q "test -d /workspace && ls /workspace | grep -q ."; then
    FILE_COUNT=$(exec_q "ls /workspace | wc -l")
    pass "/workspace mounted and has ${FILE_COUNT} entries"
else
    fail "/workspace is empty or not mounted"
fi

# ── Git is functional in workspace ────────────────────────────────────────────
if exec_q "git -C /workspace rev-parse HEAD >/dev/null 2>&1"; then
    BRANCH=$(exec_q "git -C /workspace branch --show-current 2>/dev/null" || echo "detached")
    COMMIT=$(exec_q "git -C /workspace rev-parse --short HEAD 2>/dev/null")
    pass "Git repo valid in /workspace — branch: ${BRANCH}, HEAD: ${COMMIT}"
else
    # REPO_URL mode: workspace may have just been cloned (no git history issue)
    # or workspace is a fresh dir (agent will set it up)
    skip "No git repo in /workspace — expected if REPO_URL clone is in progress"
fi

# ── Node.js available ─────────────────────────────────────────────────────────
NODE_VER=$(exec_q "node --version 2>/dev/null" || echo "NOT FOUND")
if [[ "$NODE_VER" == v* ]]; then
    pass "Node.js: ${NODE_VER}"
else
    fail "Node.js not found"
fi

# ── Google credentials available (optional) ───────────────────────────────────
if exec_q "test -f /credentials/gsa-key.json"; then
    pass "Google SA key mounted at /credentials/gsa-key.json"
else
    skip "No Google SA key — workboard scripts will not function"
fi

# ── SSH keys available (optional) ─────────────────────────────────────────────
if exec_q "test -d /root/.ssh-rw && ls /root/.ssh-rw/id_* >/dev/null 2>&1"; then
    pass "SSH keys available at /root/.ssh-rw/"
else
    skip "No SSH keys — git push over SSH will fail"
fi

summary
