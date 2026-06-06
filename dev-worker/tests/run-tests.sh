#!/usr/bin/env bash
# run-tests.sh — Master E2E test runner for the dev-worker container.
#
# Runs all test suites in order (boot → auth → agent → browser → workspace).
# Each suite must pass before the next runs, because later tests depend on
# earlier ones (can't test the agent if auth is broken).
#
# All tests use REAL credentials — no mocks. The container must be running
# and authenticated before running this script.
#
# Usage:
#   bash dev-worker/tests/run-tests.sh
#   bash dev-worker/tests/run-tests.sh --container waymark-dev-worker-2
#   bash dev-worker/tests/run-tests.sh --only boot,auth
#   bash dev-worker/tests/run-tests.sh --skip workspace
#
# Exit code: 0 = all tests passed, 1 = one or more suites failed

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTAINER="waymark-dev-worker"
ONLY_SUITES=""    # comma-separated list to run exclusively
SKIP_SUITES=""    # comma-separated list to skip

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --container) CONTAINER="$2"; shift 2 ;;
        --only)      ONLY_SUITES="$2"; shift 2 ;;
        --skip)      SKIP_SUITES="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'
CYAN='\033[0;36m'

# ── Suite registry ────────────────────────────────────────────────────────────
# Format: "name:script:description"
# Order matters — later suites depend on earlier ones passing.
SUITES=(
    "boot:boot.test.sh:Container startup and infrastructure"
    "auth:auth.test.sh:Copilot CLI authentication (real creds)"
    "learn-repo:learn-repo.test.sh:Workspace introspection and AI tool configuration"
    "docker:docker.test.sh:Docker-outside-of-Docker (parallel container spawning)"
    "agent:agent.test.sh:Agent task execution (real CLI, no mocks)"
    "browser:browser.test.sh:Headed browser on Xvfb (real Chrome)"
    "workspace:workspace.test.sh:Workspace code operations (run tests, make changes)"
)

# ── Helpers ───────────────────────────────────────────────────────────────────
should_run() {
    local name="$1"
    if [[ -n "$ONLY_SUITES" ]]; then
        echo "$ONLY_SUITES" | tr ',' '\n' | grep -q "^${name}$"
        return $?
    fi
    if [[ -n "$SKIP_SUITES" ]]; then
        ! echo "$SKIP_SUITES" | tr ',' '\n' | grep -q "^${name}$"
        return $?
    fi
    return 0
}

# ── Preflight: container must be running ──────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║    Waymark Dev Worker — E2E Test Suite (real creds)      ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Container: ${CYAN}${CONTAINER}${RESET}"
echo -e "  Time:      $(date)"
echo ""

if ! docker ps --filter "name=^${CONTAINER}$" --filter "status=running" \
        --format "{{.Names}}" | grep -q "^${CONTAINER}$"; then
    echo -e "${RED}ERROR:${RESET} Container '${CONTAINER}' is not running."
    echo ""
    echo "  Start it:           make agent-start"
    echo "  Named agent:        make agent-start NAME=Alex"
    echo "  Then auth check:    make auth-check"
    exit 1
fi

# ── Run each suite ────────────────────────────────────────────────────────────
TOTAL_PASS=0
TOTAL_FAIL=0
SUITE_RESULTS=()
FAILED_SUITES=()

for suite_entry in "${SUITES[@]}"; do
    IFS=':' read -r name script description <<< "$suite_entry"

    if ! should_run "$name"; then
        echo -e "${YELLOW}  SKIP${RESET} ${name} — ${description}"
        SUITE_RESULTS+=("SKIP:${name}")
        continue
    fi

    SUITE_SCRIPT="${SCRIPT_DIR}/${script}"
    if [[ ! -f "$SUITE_SCRIPT" ]]; then
        echo -e "${RED}  MISS${RESET} ${name} — ${SUITE_SCRIPT} not found"
        SUITE_RESULTS+=("MISS:${name}")
        continue
    fi

    echo -e "${BOLD}━━━ ${name}: ${description} ━━━${RESET}"
    START=$(date +%s)

    # Run suite with container arg, capture exit code
    CONTAINER="$CONTAINER" bash "$SUITE_SCRIPT" "$CONTAINER"
    EXIT_CODE=$?

    END=$(date +%s)
    ELAPSED=$(( END - START ))

    if [[ $EXIT_CODE -eq 0 ]]; then
        echo -e "  ${GREEN}${BOLD}✓ Suite passed${RESET} (${ELAPSED}s)"
        SUITE_RESULTS+=("PASS:${name}")
        TOTAL_PASS=$(( TOTAL_PASS + 1 ))
    else
        echo -e "  ${RED}${BOLD}✗ Suite FAILED${RESET} (${ELAPSED}s)"
        SUITE_RESULTS+=("FAIL:${name}")
        TOTAL_FAIL=$(( TOTAL_FAIL + 1 ))
        FAILED_SUITES+=("$name")

        # Stop on first auth or boot failure — later tests are meaningless
        if [[ "$name" == "boot" || "$name" == "auth" ]]; then
            echo ""
            echo -e "${RED}${BOLD}Stopping early:${RESET} ${name} is a prerequisite for all other tests."
            break
        fi
    fi
    echo ""
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Results${RESET}"
echo ""
for result in "${SUITE_RESULTS[@]}"; do
    IFS=':' read -r status name <<< "$result"
    case "$status" in
        PASS) echo -e "  ${GREEN}✓${RESET} ${name}" ;;
        FAIL) echo -e "  ${RED}✗${RESET} ${name}" ;;
        SKIP) echo -e "  ${YELLOW}–${RESET} ${name} (skipped)" ;;
        MISS) echo -e "  ${YELLOW}?${RESET} ${name} (script not found)" ;;
    esac
done
echo ""
if [[ $TOTAL_FAIL -eq 0 ]]; then
    echo -e "  ${GREEN}${BOLD}All ${TOTAL_PASS} suite(s) passed${RESET}"
else
    echo -e "  ${RED}${BOLD}${TOTAL_FAIL} suite(s) FAILED${RESET} / ${TOTAL_PASS} passed"
    echo ""
    echo "  Failed suites: ${FAILED_SUITES[*]}"
    echo ""
    echo "  Debug tips:"
    echo "    make agent-logs                    # tail container output"
    echo "    make agent-shell                   # bash inside container"
    echo "    make auth-check                    # verify credentials"
fi
echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
echo ""

[[ $TOTAL_FAIL -eq 0 ]]
