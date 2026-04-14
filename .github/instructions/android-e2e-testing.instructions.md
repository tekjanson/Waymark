---
description: "Use when writing, debugging, or modifying Android E2E tests, Appium tests, network resilience tests, P2P notification tests, or any test in the Waymark/android/e2e/ directory. Covers the hard laws for stateless testing and production-first test philosophy."
applyTo: "Waymark/android/e2e/**"
---

# Android E2E Testing — AI Laws

> These laws are non-negotiable. Every test must obey them.
> When a test fails, the FIRST question is "what production bug does this expose?"
> — NEVER "how do I patch the test to pass?"

---

## LAW 1: FIX THE CODE, NOT THE TEST

If a test fails because the production code doesn't handle a scenario (network
recovery, stale signaling, ICE failure cleanup), the fix goes into the **Kotlin
production code** (`OrchestratorPeer.kt`, `ConnectionManager.kt`,
`WebRtcService.kt`, etc.) — not into the test as a workaround.

**FORBIDDEN patterns (test workarounds that mask production bugs):**

```javascript
// ❌ Restarting the orchestrator with a fresh peer ID to avoid stale state
infra.stopOrchestrator();
peer = await infra.startOrchestrator({ phase: 2 });

// ❌ Clearing the signaling sheet from the test to unblock handshakes
await infra.clearSignaling();

// ❌ Force-stopping and relaunching the app to reset WebRTC state
infra.forceStopApp();
infra.launchApp();

// ❌ Adding sleep/retry loops that paper over reconnection failures
await sleep(15_000); // "wait for things to settle"
```

**REQUIRED pattern:**

```javascript
// ✅ The production code handles recovery — the test just observes
infra.setWifi(false);
await sleep(10_000);
infra.setWifi(true);
// The app's ConnectionManager/WebRtcService should detect network
// recovery and rebuild WebRTC connections autonomously.
// The test waits for the SAME orchestrator peer to reconnect.
const reconnected = await waitForPeerConnection(peer, 120_000);
expect(reconnected).to.be.true;
```

If the app can't recover without test-side intervention, that's a production
bug. File it, fix it, then the test passes naturally.

---

## LAW 2: STATELESS TESTING

Tests must not depend on state from previous tests. Every test starts from a
known state and cleans up after itself.

- `bootstrap()` wipes app data, installs a fresh APK, clears signaling sheets
- Each test uses `setupPhase2()` which runs Phase 1 key exchange if needed
- The `afterEach` hook restores network and stops the orchestrator
- No test assumes another test ran first
- No shared mutable state leaks between tests

---

## LAW 3: PRODUCTION CODE PATHS ONLY

The tests exercise the **real** P2P notification pipeline. The Android app must
do its own work through production code paths.

### CAN inject (not under test):
- **OAuth access_token** into SharedPreferences (we're testing P2P, not login)

### MUST use production code paths (under test):
- Sheet discovery from Drive (`.waymark-data.json`)
- Phase 1 key exchange via DataChannel on the private sheet
- Phase 2 encrypted notifications on the public sheet
- State machine transitions (`Idle → Phase1 → Phase2`, stale key cycling)
- Reconnection and recovery after network/process disruptions
- Notification display via `NotificationHelper`

### MUST NOT inject or bypass:
- Sheet IDs (app discovers from Drive)
- Signal key (app receives via Phase 1 DataChannel)
- Peer ID (app generates locally on first run)
- Phase transitions (app drives its own state machine)

### CAN build unique states for specific scenarios:
- Wrong signal key → test stale key detection
- Corrupted SharedPreferences → test graceful recovery
- Missing prefs → test cold-start behavior

These are set up **before** the test via `setPrefsState()`, then the
**production code** handles recovery.

---

## LAW 4: TEST ORCHESTRATOR = PRODUCTION ORCHESTRATOR

The test orchestrator uses the **same** `SheetWebRtcPeer` class from
`mcp/sheet-webrtc-peer.mjs` with the **same** OAuth token and **real**
signaling sheets. It is a legitimate peer on the mesh — not a mock.

The orchestrator peer ID is fresh per `startOrchestrator()` call (avoids
"dead peer" rejection), but the sheets, encryption, and signaling protocol
are identical to production.

---

## LAW 5: WHEN A TEST NEEDS A WORKAROUND, STOP

If you find yourself writing any of these patterns in a test:

1. **Clearing signaling sheets mid-test** → Production bug: `stop()` or ICE failure handler doesn't clean up offers/answers
2. **Restarting the app mid-test** → Production bug: `ConnectionManager` doesn't rebuild WebRTC after network recovery
3. **Creating a new orchestrator to reconnect** → Production bug: app marks peers as permanently dead instead of allowing reconnection
4. **Adding long sleeps "to let things settle"** → Production bug: missing or broken recovery trigger
5. **Retrying operations in a loop** → Production bug: the operation should succeed on the first attempt after recovery

**Instead:** Identify the root cause in the Kotlin code, fix it, rebuild the
APK, and re-run. The test should pass with minimal orchestration.

---

## LAW 6: KNOWN PRODUCTION BUGS TO WATCH FOR

These are recurring categories of bugs discovered during E2E testing. When a
test exhibits these symptoms, check these locations first:

| Symptom | Root Cause Location | What to Fix |
|---------|-------------------|-------------|
| App doesn't reconnect after WiFi restore | `WebRtcService.kt` `onAvailable()` → calls `requestConnect()` which no-ops | Should call `requestRebootstrap()` after `networkLost=true` |
| `requestConnect()` says "already connected" but DataChannels are dead | `ConnectionManager.kt` idempotency check | Must verify `openDataChannelCount > 0`, not just `isInMesh` |
| Stale SDP offers/answers block new handshakes for 3 min | `OrchestratorPeer.kt` `stop()` only clears presence | Must also clear offers (offset 1) and answers (offset 2) |
| ICE FAILED doesn't trigger signaling cleanup | `OrchestratorPeer.kt` ICE callback | Should schedule offers/answers cleanup after disposing peer |
| Stale offers from alive-but-disconnected peers persist | `OrchestratorPeer.kt` poll() cleanup loop | Only cleans offers for dead peers — must also clean for peers with failed ICE |

---

## LAW 7: TEST STRUCTURE

```
Waymark/android/e2e/
├── lib/
│   ├── infra.mjs        # Bootstrap, TestInfra class, ADB helpers, wait helpers
│   ├── appium.mjs        # WaymarkDriver (Appium/UiAutomator2 wrapper)
│   └── fixtures.mjs      # Mocha before/after hooks
├── tests/
│   ├── 01-happy-path.test.mjs       # Phase 1→2 basic flow
│   ├── 02-network-resilience.test.mjs  # WiFi, airplane, flapping
│   ├── 03-orchestrator-failure.test.mjs # Crash, bounce, late join
│   ├── 04-app-lifecycle.test.mjs     # Force-kill, reboot, corruption
│   └── 05-soak.test.mjs             # Multi-hour random disruptions
├── setup.mjs             # Environment verification (12 checks)
├── runner.mjs            # Sequential suite runner
└── package.json
```

Every test file follows the same pattern:

1. `setupSuite()` → calls `bootstrap()` in `before`, `teardown()` in `after`
2. `setupPhase2(infra)` → runs Phase 1 if needed, then establishes Phase 2
3. Individual tests create a disruption and observe recovery
4. `afterEach` restores network state and stops the orchestrator

---

## SUMMARY

```
TEST FAILS?
  ├─ Is the app supposed to handle this? → YES → Fix production code
  ├─ Is the test creating an impossible state? → Redesign the test
  └─ Is the test flaky due to timing? → Add proper waitFor(), not sleep()

NEVER: patch the test to tolerate broken production behavior.
ALWAYS: fix the production code so the test passes naturally.
```
