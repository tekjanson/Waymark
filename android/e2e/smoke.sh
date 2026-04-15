#!/usr/bin/env bash
# Quick build → install → LTE smoke test (≈1 min)
# Usage: ./android/e2e/smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "=== Building & installing APK ==="
cd "$ROOT/android"
./gradlew installDebug 2>&1 | tail -5

echo ""
echo "=== Running LTE smoke test ==="
rm -f "$ROOT/android/e2e/.lte-soak.lock" 2>/dev/null || true

LTE_SOAK_HOURS=0.02 \
LTE_MIN_INTERVAL_MIN=0.1 \
LTE_MAX_INTERVAL_MIN=0.3 \
npx --prefix "$ROOT/android/e2e" mocha \
  --timeout 0 --slow 60000 --exit \
  "$ROOT/android/e2e/tests/06-lte-stability.test.mjs" 2>&1
