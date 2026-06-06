#!/usr/bin/env bash
# helpers.sh — Shared test utilities for dev-worker E2E tests.
#
# Source this file at the top of each test:
#   source "$(dirname "$0")/lib/helpers.sh"
#
# Provides: pass, fail, skip, header, summary, exec_q, exec_timeout

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Counters (module-level, accumulate across the script) ─────────────────────
_PASS=0
_FAIL=0
_SKIP=0

pass() { echo -e "  ${GREEN}✓${RESET} $1"; _PASS=$((_PASS+1)); }
fail() { echo -e "  ${RED}✗${RESET} $1"; _FAIL=$((_FAIL+1)); }
skip() { echo -e "  ${YELLOW}–${RESET} $1"; _SKIP=$((_SKIP+1)); }
header() { echo -e "\n${BOLD}$1${RESET}"; }

# Exported so run-tests.sh can aggregate results
export_results() {
    echo "PASS=${_PASS} FAIL=${_FAIL} SKIP=${_SKIP}"
}

# Exit 0 if no failures, 1 otherwise — used by individual test scripts
summary() {
    echo ""
    local total=$((_PASS + _FAIL))
    if [[ $_FAIL -eq 0 ]]; then
        echo -e "  ${GREEN}${BOLD}${total} passed${RESET}${_SKIP:+ (${_SKIP} skipped)}"
    else
        echo -e "  ${RED}${BOLD}${_FAIL} FAILED${RESET} / ${_PASS} passed / ${_SKIP} skipped"
    fi
    [[ $_FAIL -eq 0 ]]
}

# ── Docker exec helpers ───────────────────────────────────────────────────────

# CONTAINER can be set by the caller (default: waymark-dev-worker)
CONTAINER="${CONTAINER:-waymark-dev-worker}"

# exec_q: run a command in the container, suppress stderr
exec_q() {
    docker exec "$CONTAINER" bash -c "$1" 2>/dev/null
}

# exec_timeout: run a command in the container with a timeout
# Usage: exec_timeout <seconds> <command>
exec_timeout() {
    local timeout="$1"; shift
    docker exec "$CONTAINER" bash -c "timeout ${timeout} $*" 2>/dev/null
}

# exec_with_output: run a command and capture both stdout and exit code
# Returns: stdout to stdout, exit code as function return value
exec_with_output() {
    docker exec "$CONTAINER" bash -c "$1" 2>&1
}

# wait_for_log: poll docker logs until a pattern appears or timeout expires
# Usage: wait_for_log <pattern> <timeout_seconds>
wait_for_log() {
    local pattern="$1" timeout="${2:-60}"
    local count=0
    while [[ $count -lt $timeout ]]; do
        if docker logs "$CONTAINER" 2>&1 | grep -q "$pattern"; then
            return 0
        fi
        sleep 1
        count=$((count + 1))
    done
    return 1
}

# wait_for_file: poll for a file to appear in the container
# Usage: wait_for_file <path> <timeout_seconds>
wait_for_file() {
    local path="$1" timeout="${2:-30}"
    local count=0
    while [[ $count -lt $timeout ]]; do
        if exec_q "test -f '${path}'"; then
            return 0
        fi
        sleep 1
        count=$((count + 1))
    done
    return 1
}
