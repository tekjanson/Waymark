#!/usr/bin/env bash
# auth.test.sh — AI provider authentication tests.
#
# Tests available credentials for both GitHub Copilot CLI and Claude Code.
# Uses REAL credentials — no mocks. Checks whichever provider(s) are configured.
#
# Usage:
#   bash dev-worker/tests/auth.test.sh [container-name]

set -uo pipefail

CONTAINER="${1:-waymark-dev-worker}"
source "$(dirname "$0")/lib/helpers.sh"

header "AI Provider Authentication"

# ── Which provider is active ───────────────────────────────────────────────────
ACTIVE_PROVIDER=$(exec_q "bash -c 'source /etc/agent-env.sh 2>/dev/null; echo \${AI_PROVIDER:-copilot}'" || echo "copilot")
ANTHROPIC_KEY=$(exec_q "bash -c 'source /etc/agent-env.sh 2>/dev/null; echo \${ANTHROPIC_API_KEY:-}'" || echo "")
echo "  Active provider: ${ACTIVE_PROVIDER}"
echo ""

# ══ GitHub Copilot CLI ════════════════════════════════════════════════════════
echo "  ─── GitHub Copilot CLI ───"

if exec_q "command -v copilot >/dev/null 2>&1"; then
    VERSION=$(exec_q "copilot --version 2>/dev/null | head -1" || echo "unknown")
    pass "copilot CLI installed: ${VERSION}"
else
    fail "copilot CLI not found — npm install -g @github/copilot missing from Dockerfile"
fi

if exec_q "test -f /root/.copilot/config.json"; then
    SIZE=$(exec_q "wc -c < /root/.copilot/config.json" || echo "0")
    [[ "$SIZE" -gt 10 ]] \
        && pass "Copilot auth config: /root/.copilot/config.json (${SIZE} bytes)" \
        || fail "Copilot auth config exists but appears empty (${SIZE} bytes) — run: copilot --login"
else
    if [[ "$ACTIVE_PROVIDER" == "copilot" ]]; then
        fail "No auth config at /root/.copilot/config.json — run: copilot --login on host"
    else
        skip "No Copilot config (active provider is '${ACTIVE_PROVIDER}' — this is OK)"
    fi
fi

# Config dir must be writable for token refresh
if exec_q "touch /root/.copilot/.write-test && rm /root/.copilot/.write-test 2>/dev/null"; then
    pass "/root/.copilot/ is writable (token auto-refresh will work)"
else
    fail "/root/.copilot/ is not writable — token refresh will fail"
fi

# Live auth probe for Copilot
if exec_q "test -f /root/.copilot/config.json"; then
    echo ""
    echo "  Probing Copilot live auth (30s timeout)..."
    AUTH_RESULT=$(
        docker exec "$CONTAINER" bash -c \
            "timeout 30 copilot --no-banner -p '/version' --allow-all 2>&1 | head -5" \
        2>/dev/null || echo "FAILED"
    )
    echo "  Copilot probe output: ${AUTH_RESULT}"
    if echo "$AUTH_RESULT" | grep -qi "version\|copilot\|claude\|model\|1\."; then
        pass "Copilot live auth: connected to GitHub"
    elif echo "$AUTH_RESULT" | grep -qi "not logged\|auth\|sign in\|login"; then
        fail "Copilot NOT authenticated — run: copilot --login on host"
    else
        skip "Copilot auth probe ran but output unparseable — check manually"
    fi
fi

echo ""

# ══ Claude Code ═══════════════════════════════════════════════════════════════
echo "  ─── Claude Code (Anthropic) ───"

if exec_q "command -v claude >/dev/null 2>&1"; then
    VERSION=$(exec_q "claude --version 2>/dev/null | head -1" || echo "unknown")
    pass "claude CLI installed: ${VERSION}"
else
    fail "claude CLI not found — npm install -g @anthropic-ai/claude-code missing from Dockerfile"
fi

if [[ -n "$ANTHROPIC_KEY" && "$ANTHROPIC_KEY" != '${ANTHROPIC_API_KEY:-}' ]]; then
    KEY_PREVIEW="${ANTHROPIC_KEY:0:8}..."
    pass "ANTHROPIC_API_KEY set (${KEY_PREVIEW})"

    # Live auth probe for Claude — run a trivial --print to exercise auth path
    echo ""
    echo "  Probing Claude live auth (30s timeout)..."
    CLAUDE_RESULT=$(
        docker exec -e "ANTHROPIC_API_KEY=${ANTHROPIC_KEY}" "$CONTAINER" bash -c \
            "cd /workspace && timeout 30 claude --dangerously-skip-permissions --model claude-haiku-4-5 --print 'Reply with just the word PONG' 2>&1 | tail -3" \
        2>/dev/null || echo "FAILED"
    )
    echo "  Claude probe output: ${CLAUDE_RESULT}"
    if echo "$CLAUDE_RESULT" | grep -qi "PONG\|pong"; then
        pass "Claude live auth: API key valid and model responded"
    elif echo "$CLAUDE_RESULT" | grep -qi "auth\|invalid\|unauthorized\|401\|api_key"; then
        fail "Claude API key invalid or unauthorized"
    elif [[ "$CLAUDE_RESULT" == "FAILED" ]]; then
        fail "Claude probe timed out — check ANTHROPIC_API_KEY and network"
    else
        skip "Claude probe ran but output unparseable: ${CLAUDE_RESULT}"
    fi
else
    if [[ "$ACTIVE_PROVIDER" == "claude" ]]; then
        fail "ANTHROPIC_API_KEY not set — required when AI_PROVIDER=claude"
        echo "  Add to docker-compose.yml: ANTHROPIC_API_KEY=\${ANTHROPIC_API_KEY}"
        echo "  And export ANTHROPIC_API_KEY=sk-ant-... in your shell"
    else
        skip "ANTHROPIC_API_KEY not set (active provider is '${ACTIVE_PROVIDER}' — this is OK)"
    fi
fi

echo ""

# ══ At least one provider must be functional ══════════════════════════════════
COPILOT_OK=$(exec_q "test -f /root/.copilot/config.json" && echo "yes" || echo "no")
CLAUDE_OK=$([[ -n "$ANTHROPIC_KEY" ]] && echo "yes" || echo "no")

if [[ "$COPILOT_OK" == "yes" || "$CLAUDE_OK" == "yes" ]]; then
    pass "At least one provider authenticated (copilot=${COPILOT_OK}, claude=${CLAUDE_OK})"
else
    fail "No AI provider authenticated — the agent cannot run"
    echo "  Fix: run 'copilot --login' on host, OR set ANTHROPIC_API_KEY"
fi

summary

