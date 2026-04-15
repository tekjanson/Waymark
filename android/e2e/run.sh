#!/usr/bin/env bash
# ============================================================
# Comprehensive E2E test runner
#
# Usage:
#   ./android/e2e/run.sh              # full pipeline (connection → lte smoke)
#   ./android/e2e/run.sh --skip-build # skip APK build/install
#   ./android/e2e/run.sh --soak       # run full 3h soak after gates pass
#   ./android/e2e/run.sh --only=connection  # run just one stage
#   ./android/e2e/run.sh --only=lte
#
# Pipeline order:
#   1. Build & install APK
#   2. Gate: 00-connection (no Appium, <3 min)
#   3. Gate: 06-lte-stability smoke (1 min)
#   4. (--soak only) Full LTE soak (3h)
#
# Streams logcat alongside test output for real-time debugging.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
E2E="$ROOT/android/e2e"
SKIP_BUILD=0
RUN_SOAK=0
ONLY=""

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --soak)       RUN_SOAK=1 ;;
    --only=*)     ONLY="${arg#--only=}" ;;
    -h|--help)
      head -17 "$0" | tail -15
      exit 0
      ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

pass() { echo -e "${GREEN}${BOLD}✓ PASS${NC} $1"; }
fail() { echo -e "${RED}${BOLD}✗ FAIL${NC} $1"; }
info() { echo -e "${YELLOW}▸${NC} $1"; }
hdr()  { echo -e "\n${BOLD}════════════════════════════════════════${NC}"; echo -e "${BOLD}  $1${NC}"; echo -e "${BOLD}════════════════════════════════════════${NC}\n"; }

# ── Background logcat stream ──────────────────────────────────
# Streams relevant Android logs to stderr so they interleave with
# test output. Killed on script exit.
LOGCAT_PID=""

start_logcat() {
  adb logcat -c 2>/dev/null || true
  adb logcat -s \
    OrchestratorPeer:* \
    ConnectionManager:* \
    NotificationHelper:* \
    WebRtcService:* \
  2>/dev/null | sed 's/^/  [logcat] /' >&2 &
  LOGCAT_PID=$!
}

stop_logcat() {
  if [[ -n "$LOGCAT_PID" ]]; then
    kill "$LOGCAT_PID" 2>/dev/null || true
    wait "$LOGCAT_PID" 2>/dev/null || true
    LOGCAT_PID=""
  fi
}

cleanup() {
  stop_logcat
  # Restore network just in case
  adb shell svc wifi enable 2>/dev/null || true
  adb shell settings put global airplane_mode_on 0 2>/dev/null || true
}
trap cleanup EXIT

# ── Run a mocha test and capture exit code ──────────────────
# $1 = label, $2+ = mocha arguments
run_test() {
  local label="$1"; shift
  info "Running: $label"
  set +e
  npx --prefix "$E2E" mocha --timeout 0 --slow 30000 --exit "$@" 2>&1
  local rc=$?
  set -e
  if [[ $rc -eq 0 ]]; then
    pass "$label"
  else
    fail "$label"
    echo ""
    echo -e "${RED}Pipeline stopped — fix production code and rerun.${NC}"
    exit $rc
  fi
  return 0
}

# ────────────────────────────────────────────────────────────
# Stage 0: Build & Install
# ────────────────────────────────────────────────────────────
if [[ "$ONLY" == "" || "$ONLY" == "build" ]]; then
  if [[ $SKIP_BUILD -eq 0 ]]; then
    hdr "Stage 0: Build & Install APK"
    cd "$ROOT/android"
    ./gradlew installDebug 2>&1 | tail -10
    pass "APK built and installed"
    cd "$ROOT"
  else
    info "Skipping build (--skip-build)"
  fi
fi

# ── Start streaming logcat ──
start_logcat

# ────────────────────────────────────────────────────────────
# Stage 1: Connection Gate (no Appium, fast)
# ────────────────────────────────────────────────────────────
if [[ "$ONLY" == "" || "$ONLY" == "connection" ]]; then
  hdr "Stage 1: Connection Gate (no Appium)"
  run_test "00-connection" "$E2E/tests/00-connection.test.mjs"
fi

# ────────────────────────────────────────────────────────────
# Stage 2: LTE Smoke (1 min, no Appium)
# ────────────────────────────────────────────────────────────
if [[ "$ONLY" == "" || "$ONLY" == "lte" ]]; then
  hdr "Stage 2: LTE Smoke (1 min)"
  rm -f "$E2E/.lte-soak.lock" 2>/dev/null || true
  LTE_SOAK_HOURS=0.02 \
  LTE_MIN_INTERVAL_MIN=0.1 \
  LTE_MAX_INTERVAL_MIN=0.3 \
  run_test "06-lte-stability (smoke)" "$E2E/tests/06-lte-stability.test.mjs"
fi

# ────────────────────────────────────────────────────────────
# Stage 3: Full LTE Soak (3h, only with --soak)
# ────────────────────────────────────────────────────────────
if [[ "$RUN_SOAK" -eq 1 ]]; then
  if [[ "$ONLY" == "" || "$ONLY" == "soak" ]]; then
    hdr "Stage 3: Full LTE Soak (3h)"
    rm -f "$E2E/.lte-soak.lock" 2>/dev/null || true
    LTE_SOAK_HOURS=3 \
    run_test "06-lte-stability (3h soak)" "$E2E/tests/06-lte-stability.test.mjs"
  fi
fi

# ── Summary ──
echo ""
hdr "All gates passed"
if [[ "$RUN_SOAK" -eq 0 ]]; then
  info "Run with --soak to include the 3-hour soak test."
fi
