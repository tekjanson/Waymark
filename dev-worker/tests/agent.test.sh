#!/usr/bin/env bash
# agent.test.sh — Real Copilot CLI agent task execution tests.
#
# Gives the agent concrete, verifiable tasks and asserts the outcomes.
# These are ZERO-MOCK tests: real Copilot credentials, real CLI, real file I/O.
#
# Test design: each task runs in an isolated temporary workspace inside the
# container so it doesn't interfere with any running agent session.
#
# Test cases:
#   1. File creation — agent creates a file with specific content
#   2. File reading  — agent reads an existing file and echoes its content
#   3. Code execution — agent runs a Node.js script and captures output
#   4. Multi-step task — agent reads, modifies, and writes a file
#   5. Git operations — agent initializes a git repo, makes a commit
#
# Prerequisites:
#   - Container running with valid Copilot auth (pass auth.test.sh first)
#   - Network access from inside the container
#
# Usage:
#   bash dev-worker/tests/agent.test.sh [container-name]

set -uo pipefail

CONTAINER="${1:-waymark-dev-worker}"
source "$(dirname "$0")/lib/helpers.sh"

# ── Shared setup ─────────────────────────────────────────────────────────────
TEST_DIR="/tmp/agent-test-$$"
TASK_TIMEOUT=120   # seconds per task — agent needs time to think and act
MODEL="${AGENT_TEST_MODEL:-claude-sonnet-4.6}"

header "Agent Task Execution (real Copilot CLI, no mocks)"
echo "  Test workspace: ${TEST_DIR}"
echo "  Model: ${MODEL}"
echo "  Timeout per task: ${TASK_TIMEOUT}s"

# Create isolated test workspace
exec_q "mkdir -p '${TEST_DIR}'"

run_agent_task() {
    local task_name="$1"
    local prompt="$2"
    docker exec "$CONTAINER" bash -c \
        "timeout ${TASK_TIMEOUT} copilot \
            --no-banner \
            --allow-all \
            --autopilot \
            --model '${MODEL}' \
            --add-dir '${TEST_DIR}' \
            -p '${prompt}' \
        2>&1" 2>/dev/null
}

# ── Test 1: File creation ─────────────────────────────────────────────────────
header "  Task 1: File Creation"

ARTIFACT="${TEST_DIR}/hello.txt"
EXPECTED_CONTENT="agent-test-complete-$(date +%s)"

echo "  Prompt: create file hello.txt with unique content..."
TASK1_OUTPUT=$(run_agent_task "file-create" \
    "Create a file at ${ARTIFACT} containing exactly this text and nothing else: ${EXPECTED_CONTENT}" \
    || echo "TASK_FAILED")

if [[ "$TASK1_OUTPUT" == "TASK_FAILED" ]]; then
    fail "Task 1: agent invocation timed out or crashed"
elif exec_q "test -f '${ARTIFACT}'"; then
    ACTUAL=$(exec_q "cat '${ARTIFACT}'" | tr -d '[:space:]')
    EXPECTED_TRIMMED=$(echo "$EXPECTED_CONTENT" | tr -d '[:space:]')
    if [[ "$ACTUAL" == *"$EXPECTED_TRIMMED"* ]]; then
        pass "Task 1: file created with correct content"
    else
        fail "Task 1: file created but content mismatch"
        echo "    Expected to contain: ${EXPECTED_TRIMMED}"
        echo "    Actual: ${ACTUAL}"
    fi
else
    fail "Task 1: file not created"
    echo "  Agent output (last 5 lines):"
    echo "$TASK1_OUTPUT" | tail -5 | sed 's/^/    /'
fi

# ── Test 2: File reading and output ───────────────────────────────────────────
header "  Task 2: File Reading"

INPUT_FILE="${TEST_DIR}/input.txt"
OUTPUT_FILE="${TEST_DIR}/output.txt"
INPUT_CONTENT="WAYMARK_TEST_INPUT_42"
exec_q "echo '${INPUT_CONTENT}' > '${INPUT_FILE}'"

echo "  Prompt: read file and write its content to another file..."
TASK2_OUTPUT=$(run_agent_task "file-read" \
    "Read the file at ${INPUT_FILE} and write its exact content to ${OUTPUT_FILE}" \
    || echo "TASK_FAILED")

if [[ "$TASK2_OUTPUT" == "TASK_FAILED" ]]; then
    fail "Task 2: agent invocation timed out or crashed"
elif exec_q "test -f '${OUTPUT_FILE}'"; then
    RESULT=$(exec_q "cat '${OUTPUT_FILE}'" | tr -d '[:space:]')
    if [[ "$RESULT" == *"$INPUT_CONTENT"* ]]; then
        pass "Task 2: file read and echoed correctly"
    else
        fail "Task 2: output file content incorrect"
        echo "    Expected to contain: ${INPUT_CONTENT}"
        echo "    Actual: ${RESULT}"
    fi
else
    fail "Task 2: output file not created"
fi

# ── Test 3: Code execution ────────────────────────────────────────────────────
header "  Task 3: Code Execution"

CODE_FILE="${TEST_DIR}/compute.js"
RESULT_FILE="${TEST_DIR}/result.txt"

echo "  Prompt: write and run a Node.js script..."
TASK3_OUTPUT=$(run_agent_task "code-exec" \
    "Write a Node.js script at ${CODE_FILE} that computes 7 * 6 and writes the result to ${RESULT_FILE}, then run it" \
    || echo "TASK_FAILED")

if [[ "$TASK3_OUTPUT" == "TASK_FAILED" ]]; then
    fail "Task 3: agent invocation timed out or crashed"
elif exec_q "test -f '${RESULT_FILE}'"; then
    RESULT=$(exec_q "cat '${RESULT_FILE}'" | tr -d '[:space:]')
    if echo "$RESULT" | grep -q "42"; then
        pass "Task 3: computed 7*6=42 and wrote result correctly"
    else
        fail "Task 3: result file doesn't contain 42"
        echo "    Actual result file content: ${RESULT}"
    fi
elif exec_q "test -f '${CODE_FILE}'"; then
    fail "Task 3: script was written but not executed (result file missing)"
    echo "    Script content: $(exec_q "cat '${CODE_FILE}'")"
else
    fail "Task 3: neither script nor result file created"
    echo "  Agent output (last 5 lines):"
    echo "$TASK3_OUTPUT" | tail -5 | sed 's/^/    /'
fi

# ── Test 4: Multi-step task (read → transform → write) ───────────────────────
header "  Task 4: Multi-Step Transform"

SOURCE="${TEST_DIR}/source.json"
DEST="${TEST_DIR}/transformed.json"
exec_q "echo '{\"value\": 10, \"multiplier\": 5}' > '${SOURCE}'"

echo "  Prompt: read JSON, compute product, write result..."
TASK4_OUTPUT=$(run_agent_task "multi-step" \
    "Read ${SOURCE} as JSON, multiply value by multiplier, write {\"result\": <product>} to ${DEST}" \
    || echo "TASK_FAILED")

if [[ "$TASK4_OUTPUT" == "TASK_FAILED" ]]; then
    fail "Task 4: agent invocation timed out or crashed"
elif exec_q "test -f '${DEST}'"; then
    RESULT=$(exec_q "cat '${DEST}'" | tr -d '[:space:]')
    if echo "$RESULT" | grep -q "50"; then
        pass "Task 4: JSON transformed correctly (10 × 5 = 50)"
    else
        fail "Task 4: transformed JSON doesn't contain expected result (50)"
        echo "    Actual: ${RESULT}"
    fi
else
    fail "Task 4: output JSON not created"
fi

# ── Test 5: Git operations ────────────────────────────────────────────────────
header "  Task 5: Git Operations"

GIT_DIR="${TEST_DIR}/git-test"
exec_q "mkdir -p '${GIT_DIR}'"

echo "  Prompt: initialize git repo and make a commit..."
TASK5_OUTPUT=$(run_agent_task "git-ops" \
    "In the directory ${GIT_DIR}: initialize a git repo, create a README.md with the text 'test repo', and make an initial commit with the message 'init'" \
    || echo "TASK_FAILED")

if [[ "$TASK5_OUTPUT" == "TASK_FAILED" ]]; then
    fail "Task 5: agent invocation timed out or crashed"
elif exec_q "git -C '${GIT_DIR}' log --oneline 2>/dev/null | grep -q ."; then
    COMMIT=$(exec_q "git -C '${GIT_DIR}' log --oneline | head -1")
    pass "Task 5: git repo initialized with commit: ${COMMIT}"
elif exec_q "test -d '${GIT_DIR}/.git'"; then
    fail "Task 5: git repo initialized but no commits made"
else
    fail "Task 5: git repo not initialized"
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
exec_q "rm -rf '${TEST_DIR}'" 2>/dev/null || true

summary
