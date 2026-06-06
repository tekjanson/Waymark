#!/usr/bin/env bash
# workspace.test.sh — Real workspace operation tests.
#
# Tests the agent's ability to operate on a real code repository:
#   - Read and understand code files
#   - Run tests (npm test)
#   - Make and validate code changes
#   - Work with a fresh cloned repo (REPO_URL mode)
#
# These tests exercise the complete dev-worker use case end-to-end:
# the agent acting as a developer who reads, changes, and validates code.
#
# Usage:
#   bash dev-worker/tests/workspace.test.sh [container-name]

set -uo pipefail

CONTAINER="${1:-waymark-dev-worker}"
source "$(dirname "$0")/lib/helpers.sh"

MODEL="${AGENT_TEST_MODEL:-claude-sonnet-4.6}"
TASK_TIMEOUT=180   # workspace tasks are heavier

header "Workspace / Code Operations"

# ── Workspace has real code ────────────────────────────────────────────────────
if exec_q "test -f /workspace/package.json"; then
    PKG_NAME=$(exec_q "node -e 'console.log(require(\"/workspace/package.json\").name)' 2>/dev/null" || echo "unknown")
    pass "Workspace has package.json — project: ${PKG_NAME}"
else
    skip "No package.json in /workspace — skipping workspace-specific tests"
    summary; exit 0
fi

# ── npm install (idempotent, fast if node_modules exists) ─────────────────────
echo "  Ensuring dependencies are installed..."
INSTALL_RESULT=$(exec_timeout 120 "cd /workspace && npm install --silent 2>&1 | tail -3" || echo "FAILED")
if [[ "$INSTALL_RESULT" != "FAILED" ]]; then
    pass "npm install completed"
else
    fail "npm install failed or timed out"
    echo "  Output: ${INSTALL_RESULT}"
fi

# ── Agent can read and summarize code ─────────────────────────────────────────
header "  Task: Code Understanding"

SUMMARY_FILE="/tmp/code-summary-$$.txt"
echo "  Asking agent to describe the project structure..."
SUMMARY_OUTPUT=$(
    docker exec "$CONTAINER" bash -c \
        "timeout ${TASK_TIMEOUT} copilot \
            --no-banner \
            --allow-all \
            --autopilot \
            --model '${MODEL}' \
            --add-dir /workspace \
            -p 'Read the README.md and package.json in /workspace. In one sentence, describe what this project does. Write your answer to ${SUMMARY_FILE}' \
        2>&1" 2>/dev/null || echo "TASK_FAILED"
)

if [[ "$SUMMARY_OUTPUT" == "TASK_FAILED" ]]; then
    fail "Code understanding task: agent timed out or crashed"
elif exec_q "test -f '${SUMMARY_FILE}' && test -s '${SUMMARY_FILE}'"; then
    SUMMARY=$(exec_q "cat '${SUMMARY_FILE}'" | head -3)
    pass "Agent summarized the project:"
    echo "    \"${SUMMARY}\""
else
    fail "Code understanding task: agent did not produce output file"
    echo "  Agent output (last 3 lines):"
    echo "$SUMMARY_OUTPUT" | tail -3 | sed 's/^/    /'
fi
exec_q "rm -f '${SUMMARY_FILE}'" 2>/dev/null || true

# ── Agent can run npm test (real test suite) ───────────────────────────────────
header "  Task: Run Tests"

TEST_RESULT_FILE="/tmp/test-result-$$.txt"
echo "  Asking agent to run npm test and report result (this may take a while)..."
TEST_OUTPUT=$(
    docker exec "$CONTAINER" bash -c \
        "timeout ${TASK_TIMEOUT} copilot \
            --no-banner \
            --allow-all \
            --autopilot \
            --model '${MODEL}' \
            --add-dir /workspace \
            -p 'Run npm test in /workspace. After the tests complete, write a single line to ${TEST_RESULT_FILE}: either PASSED or FAILED, followed by the test count. Example: \"PASSED 247 tests\"' \
        2>&1" 2>/dev/null || echo "TASK_FAILED"
)

if [[ "$TEST_OUTPUT" == "TASK_FAILED" ]]; then
    fail "Run tests task: agent timed out"
    skip "Consider increasing TASK_TIMEOUT (currently ${TASK_TIMEOUT}s)"
elif exec_q "test -f '${TEST_RESULT_FILE}'"; then
    RESULT=$(exec_q "cat '${TEST_RESULT_FILE}'" | head -1)
    if echo "$RESULT" | grep -qi "PASSED"; then
        pass "Tests passed: ${RESULT}"
    elif echo "$RESULT" | grep -qi "FAILED"; then
        fail "Tests failed: ${RESULT}"
    else
        skip "Test result file exists but content unclear: ${RESULT}"
    fi
else
    fail "Run tests task: agent did not write result file"
fi
exec_q "rm -f '${TEST_RESULT_FILE}'" 2>/dev/null || true

# ── Agent can make a code change ──────────────────────────────────────────────
header "  Task: Code Change (reversible)"

# Create a new test-only file that doesn't affect real code
TEST_FILE="/workspace/.agent-test-$(date +%s).md"
VERIFY_CONTENT="agent-workspace-test-$(date +%s)"

echo "  Asking agent to create a markdown file in the workspace..."
CHANGE_OUTPUT=$(
    docker exec "$CONTAINER" bash -c \
        "timeout ${TASK_TIMEOUT} copilot \
            --no-banner \
            --allow-all \
            --autopilot \
            --model '${MODEL}' \
            --add-dir /workspace \
            -p 'Create a file at ${TEST_FILE} containing exactly: ${VERIFY_CONTENT}' \
        2>&1" 2>/dev/null || echo "TASK_FAILED"
)

if [[ "$CHANGE_OUTPUT" == "TASK_FAILED" ]]; then
    fail "Code change task: agent timed out or crashed"
elif exec_q "test -f '${TEST_FILE}'"; then
    ACTUAL=$(exec_q "cat '${TEST_FILE}'" | tr -d '[:space:]')
    if echo "$ACTUAL" | grep -q "$VERIFY_CONTENT"; then
        pass "Code change task: file created in workspace with correct content"
        # Clean up — remove the test file so it doesn't pollute the workspace
        exec_q "rm '${TEST_FILE}'" 2>/dev/null || true
    else
        fail "Code change task: file created but content wrong"
        exec_q "rm '${TEST_FILE}'" 2>/dev/null || true
    fi
else
    fail "Code change task: agent did not create the file"
fi

summary
