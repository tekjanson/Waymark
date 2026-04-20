#!/usr/bin/env bash
# ============================================================
# run_e2e_tests.sh — End-to-end test runner for Waymark P2P
#
# Runs Android instrumented tests on a connected device and
# optionally starts the test orchestrator for full cross-process
# notification testing.
#
# Usage:
#   # Run all instrumented tests (in-process, no orchestrator)
#   ./run_e2e_tests.sh
#
#   # Run with the test orchestrator for full E2E
#   ./run_e2e_tests.sh --with-orchestrator
#
# Prerequisites:
#   - Android device connected via adb
#   - For orchestrator mode: GOOGLE_APPLICATION_CREDENTIALS set
#   - POST_NOTIFICATIONS permission granted on device
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR"
PROJECT_DIR="$ANDROID_DIR/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

WITH_ORCHESTRATOR=false
for arg in "$@"; do
    case "$arg" in
        --with-orchestrator) WITH_ORCHESTRATOR=true ;;
    esac
done

echo -e "${YELLOW}=== Waymark P2P E2E Test Runner ===${NC}\n"

# Check adb connection
if ! adb devices | grep -q "device$"; then
    echo -e "${RED}ERROR: No Android device connected via adb${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Android device connected"

# Build the app + test APK
echo -e "\n${YELLOW}Building app and test APKs...${NC}"
cd "$ANDROID_DIR"
./gradlew assembleDebug assembleDebugAndroidTest 2>&1 | tail -5
echo -e "${GREEN}✓${NC} Build complete"
LOG_DIR="$PROJECT_DIR/.e2e-logs"
mkdir -p "$LOG_DIR"

# Start persistent logcat capture so we can inspect hangs
echo -e "\n${YELLOW}Starting adb logcat capture -> ${LOG_DIR}/logcat.log${NC}"
adb logcat -v time >"$LOG_DIR/logcat.log" 2>&1 &
LOGCAT_PID=$!
echo "Logcat PID=$LOGCAT_PID"

# Install both APKs using push + pm install to avoid hanging on streamed installs
echo -e "\n${YELLOW}Installing APKs on device (push + pm install)...${NC}"
APP_APK=app/build/outputs/apk/debug/app-debug.apk
TEST_APK=app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk

echo "Pushing $APP_APK -> /data/local/tmp/app-debug.apk" | tee "$LOG_DIR/install.log"
adb push "$APP_APK" /data/local/tmp/app-debug.apk 2>&1 | tee -a "$LOG_DIR/install.log"
echo "Running pm install -r /data/local/tmp/app-debug.apk" | tee -a "$LOG_DIR/install.log"
adb shell pm install -r /data/local/tmp/app-debug.apk 2>&1 | tee -a "$LOG_DIR/install.log"

echo "Pushing $TEST_APK -> /data/local/tmp/app-debug-androidTest.apk" | tee -a "$LOG_DIR/install.log"
adb push "$TEST_APK" /data/local/tmp/app-debug-androidTest.apk 2>&1 | tee -a "$LOG_DIR/install.log"
echo "Running pm install -r /data/local/tmp/app-debug-androidTest.apk" | tee -a "$LOG_DIR/install.log"
adb shell pm install -r /data/local/tmp/app-debug-androidTest.apk 2>&1 | tee -a "$LOG_DIR/install.log"

echo -e "${GREEN}✓${NC} APKs installed (logs: $LOG_DIR/install.log)"

# Grant notification permission (Android 13+)
echo -e "\n${YELLOW}Granting POST_NOTIFICATIONS permission...${NC}"
adb shell pm grant com.waymark.app android.permission.POST_NOTIFICATIONS 2>/dev/null || true
echo -e "${GREEN}✓${NC} Permission granted"

# Start test orchestrator if requested
ORCH_PID=""
if $WITH_ORCHESTRATOR; then
    echo -e "\n${YELLOW}Starting test orchestrator...${NC}"
    cd "$ANDROID_DIR/test_orchestrator"
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    ORCH_LOG="$LOG_DIR/orchestrator.log"
    echo "Starting orchestrator, logging to $ORCH_LOG"
    node test_orchestrator.mjs --mode=e2e --count=3 --timeout=180 >"$ORCH_LOG" 2>&1 &
    ORCH_PID=$!
    echo -e "${GREEN}✓${NC} Test orchestrator started (PID=$ORCH_PID)"
    # tail orchestrator logs so user sees live progress
    (tail -n +1 -f "$ORCH_LOG" &) ; TAIL_PID=$!
    echo "Orchestrator log tail PID=$TAIL_PID"
    cd "$ANDROID_DIR"

    # Give it a moment to join the mesh
    sleep 5
fi

# Run instrumented tests
echo -e "\n${YELLOW}Running instrumented tests on device...${NC}\n"

adb shell am instrument -w \
    -e class com.waymark.app.SignalingEncryptionTest \
    com.waymark.app.test/androidx.test.runner.AndroidJUnitRunner
RESULT1=$?

adb shell am instrument -w \
    -e class com.waymark.app.ConnectionStateTest \
    com.waymark.app.test/androidx.test.runner.AndroidJUnitRunner
RESULT2=$?

adb shell am instrument -w \
    -e class com.waymark.app.NotificationDeliveryTest \
    com.waymark.app.test/androidx.test.runner.AndroidJUnitRunner
RESULT3=$?

adb shell am instrument -w \
    -e class com.waymark.app.OrchestratorPeerTest \
    com.waymark.app.test/androidx.test.runner.AndroidJUnitRunner
RESULT4=$?

adb shell am instrument -w \
    -e class com.waymark.app.P2PEndToEndTest \
    com.waymark.app.test/androidx.test.runner.AndroidJUnitRunner
RESULT5=$?

# Cleanup
if [ -n "$ORCH_PID" ]; then
    kill "$ORCH_PID" 2>/dev/null || true
    wait "$ORCH_PID" 2>/dev/null || true
fi

# Kill background log processes
if [ -n "${TAIL_PID:-}" ]; then
    kill "$TAIL_PID" 2>/dev/null || true
fi
if [ -n "${LOGCAT_PID:-}" ]; then
    kill "$LOGCAT_PID" 2>/dev/null || true
fi

# Summary
echo -e "\n${YELLOW}=== Test Summary ===${NC}"
report() {
    if [ "$2" -eq 0 ]; then
        echo -e "  ${GREEN}✓${NC} $1"
    else
        echo -e "  ${RED}✗${NC} $1 (exit code $2)"
    fi
}
report "SignalingEncryptionTest" "$RESULT1"
report "ConnectionStateTest" "$RESULT2"
report "NotificationDeliveryTest" "$RESULT3"
report "OrchestratorPeerTest" "$RESULT4"
report "P2PEndToEndTest" "$RESULT5"

TOTAL=$((RESULT1 + RESULT2 + RESULT3 + RESULT4 + RESULT5))
if [ "$TOTAL" -eq 0 ]; then
    echo -e "\n${GREEN}✓ ALL TESTS PASSED${NC}"
    exit 0
else
    echo -e "\n${RED}✗ SOME TESTS FAILED${NC}"
    exit 1
fi
