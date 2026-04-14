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

# Install both APKs
echo -e "\n${YELLOW}Installing APKs on device...${NC}"
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
echo -e "${GREEN}✓${NC} APKs installed"

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
    node test_orchestrator.mjs --mode=e2e --count=3 --timeout=180 &
    ORCH_PID=$!
    echo -e "${GREEN}✓${NC} Test orchestrator started (PID=$ORCH_PID)"
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
