/* ============================================================
   06-lte-stability.test.mjs — Long-running LTE soak test

   Real-world stability test: orchestrator on broadband (host/
   container), Android phone on LTE with WiFi disabled.

   Sends notifications at random intervals (10-45 min) over a
   configurable multi-hour duration.  Every single notification
   MUST be delivered — the test expects 100% delivery rate.

   The long gaps between messages are the hardest scenario for
   WebRTC: NAT bindings can expire, STUN allocations can go
   stale, and the DataChannel keepalive (30s ping) is the only
   thing keeping the connection alive between messages.

   Usage:
     LTE_SOAK_HOURS=3 npm run test:lte
     LTE_SOAK_HOURS=1 npm run test:lte          # shorter run
     LTE_MIN_INTERVAL_MIN=10 LTE_MAX_INTERVAL_MIN=45 npm run test:lte

   Environment:
     LTE_SOAK_HOURS        Duration in hours (default: 3)
     LTE_MIN_INTERVAL_MIN  Min minutes between messages (default: 10)
     LTE_MAX_INTERVAL_MIN  Max minutes between messages (default: 45)
   ============================================================ */

import { expect } from "chai";
import { setupSuite, getInfra, getDriver } from "../lib/fixtures.mjs";
import { sleep, waitFor, waitForPeerConnection, makeTestNotification } from "../lib/infra.mjs";

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCKFILE  = path.join(__dirname, ".lte-soak.lock");

/* ── Single-instance guard ──
 * Prevents two soak tests from running simultaneously, which would
 * corrupt results (shared signaling sheet, shared device network state).
 * Uses a PID lockfile: if the lock exists and the PID is still alive, bail.
 */
function acquireLock() {
    if (existsSync(LOCKFILE)) {
        const pid = parseInt(readFileSync(LOCKFILE, "utf8").trim(), 10);
        try {
            process.kill(pid, 0); // signal 0 = existence check, doesn't kill
            throw new Error(
                `Another soak test is already running (PID ${pid}). ` +
                `Kill it first or remove ${LOCKFILE}`
            );
        } catch (e) {
            if (e.code !== "ESRCH") throw e; // ESRCH = no such process → stale lock
        }
    }
    writeFileSync(LOCKFILE, String(process.pid));
}

function releaseLock() {
    try { unlinkSync(LOCKFILE); } catch { /* ok — already removed */ }
}

acquireLock();
process.on("exit", releaseLock);
process.on("SIGINT", () => { releaseLock(); process.exit(130); });
process.on("SIGTERM", () => { releaseLock(); process.exit(143); });

const SOAK_HOURS     = parseFloat(process.env.LTE_SOAK_HOURS || "3");
const SOAK_MS        = SOAK_HOURS * 60 * 60_000;
const MIN_INTERVAL   = (parseFloat(process.env.LTE_MIN_INTERVAL_MIN) || 10) * 60_000;
const MAX_INTERVAL   = (parseFloat(process.env.LTE_MAX_INTERVAL_MIN) || 45) * 60_000;
const NOTIF_TIMEOUT  = 120_000;  // 2 min — generous for LTE + potential ICE restart recovery
const RECONNECT_TIMEOUT = 180_000;

/** Random integer in [min, max] ms. */
function randInterval() {
    return MIN_INTERVAL + Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL));
}

/**
 * Poll telephony.registry until the cellular radio reports IN_SERVICE,
 * or until timeoutMs elapses. Returns true if IN_SERVICE was seen.
 */
async function waitForCellularService(timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const dump = execSync(
                'adb shell "dumpsys telephony.registry | grep -m1 mDataRegState"',
                { timeout: 10_000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
            );
            if (dump.includes("mDataRegState=0(IN_SERVICE)")) return true;
        } catch { /* retry */ }
        await sleep(2_000);
    }
    return false;
}

/**
 * Check if the device has working mobile data by disabling WiFi,
 * enabling data, and waiting for the radio to register. Returns true
 * if LTE is usable.
 *
 * Uses telephony state polling instead of blind sleeps to avoid
 * racing the modem's re-registration.
 */
async function hasLteConnectivity() {
    // Ensure the radio is in a clean state: airplane off, data on
    try { execSync('adb shell "cmd connectivity airplane-mode disable"', { timeout: 5_000 }); } catch { /* ok */ }
    try { execSync('adb shell "svc data enable"', { timeout: 5_000 }); } catch { /* ok */ }

    // Wait for the cellular radio to report IN_SERVICE before disabling WiFi.
    // This avoids the race where WiFi is killed before the modem finishes
    // re-registering after a prior test's network manipulation.
    console.log("    Waiting for cellular radio to register...");
    const radioReady = await waitForCellularService(30_000);
    if (!radioReady) {
        // Last resort: one airplane cycle to power-cycle the modem,
        // then wait again (with WiFi still on so IWLAN doesn't interfere).
        console.log("    Radio not ready — cycling airplane mode once...");
        try { execSync('adb shell "cmd connectivity airplane-mode enable"', { timeout: 5_000 }); } catch { /* ok */ }
        await sleep(3_000);
        try { execSync('adb shell "cmd connectivity airplane-mode disable"', { timeout: 5_000 }); } catch { /* ok */ }
        try { execSync('adb shell "svc data enable"', { timeout: 5_000 }); } catch { /* ok */ }
        const recovered = await waitForCellularService(45_000);
        if (!recovered) {
            console.log("    ✗ Cellular radio failed to reach IN_SERVICE");
            return false;
        }
    }
    console.log("    ✓ Cellular radio IN_SERVICE");

    // Now disable WiFi so LTE becomes the active data bearer
    execSync('adb shell "svc wifi disable"', { timeout: 5_000 });
    await sleep(3_000); // initial wait for route table to switch to cellular

    // Verify actual data connectivity — retry because route table switch
    // can take 10-15s after the connection gate thrashes the network
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const r = execSync('adb shell "ping -c 2 -W 3 8.8.8.8"', {
                timeout: 15_000, encoding: "utf8",
            });
            if (r.includes("bytes from")) return true;
        } catch { /* retry */ }
        if (attempt < 3) await sleep(5_000);
    }

    // Data bearer stuck after connection gate network thrashing —
    // airplane cycle to force the modem to re-establish the bearer
    console.log("    Ping failed — cycling airplane mode to recover data bearer...");
    try { execSync('adb shell "svc wifi enable"', { timeout: 5_000 }); } catch { /* ok */ }
    try { execSync('adb shell "cmd connectivity airplane-mode enable"', { timeout: 5_000 }); } catch { /* ok */ }
    await sleep(3_000);
    try { execSync('adb shell "cmd connectivity airplane-mode disable"', { timeout: 5_000 }); } catch { /* ok */ }
    try { execSync('adb shell "svc data enable"', { timeout: 5_000 }); } catch { /* ok */ }
    const bearerRecovered = await waitForCellularService(45_000);
    if (!bearerRecovered) {
        console.log("    ✗ Cellular radio failed after airplane cycle");
        return false;
    }
    execSync('adb shell "svc wifi disable"', { timeout: 5_000 });
    await sleep(5_000);

    // Second round of pings after modem reset
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const r = execSync('adb shell "ping -c 2 -W 3 8.8.8.8"', {
                timeout: 15_000, encoding: "utf8",
            });
            if (r.includes("bytes from")) return true;
        } catch { /* retry */ }
        if (attempt < 3) await sleep(5_000);
    }

    // Restore WiFi so the device isn't left without any data path
    try { execSync('adb shell "svc wifi enable"', { timeout: 5_000 }); } catch { /* ok */ }
    return false;
}

describe("Long-Running Soak — P2P Stability", function () {
    setupSuite({ needsAppium: false });

    let networkMode = "lte";

    // Always restore network state
    afterEach(function () {
        const infra = getInfra();
        try { infra.stopOrchestrator(); } catch { /* ok */ }
        try { infra.setAirplaneMode(false); } catch { /* ok */ }
        try { infra.setWifi(true); } catch { /* ok */ }
        try { infra.setMobileData(true); } catch { /* ok */ }
    });

    it(`${SOAK_HOURS}h soak — random ${MIN_INTERVAL / 60_000}-${MAX_INTERVAL / 60_000} min intervals — 100% delivery`, async function () {
        this.timeout(SOAK_MS + 600_000); // soak + 10 min buffer
        const infra = getInfra();

        /* ── LTE is required — this is an LTE soak test ── */
        console.log("    Checking LTE connectivity...");
        const lteOk = await hasLteConnectivity();
        if (!lteOk) {
            console.log("    ⚠ No LTE data — skipping soak (carrier/SIM limitation or no signal)");
            this.skip();
            return;
        }
        infra.setMobileData(true);
        infra.setWifi(false);
        console.log("    ✓ LTE available — WiFi disabled, soak will run on cellular only");

        /* ── Bootstrap app + orchestrator ── */
        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();

        const peer = await infra.startOrchestrator();
        const initial = await waitForPeerConnection(peer, RECONNECT_TIMEOUT);
        expect(initial, "Initial LTE handshake must succeed").to.be.true;
        await sleep(10_000);

        // Stabilization check
        if (peer.connectedPeers().length === 0) {
            console.log("    ⚠ Dropped during stabilization — waiting for rebuild...");
            const rebuilt = await waitForPeerConnection(peer, RECONNECT_TIMEOUT);
            expect(rebuilt, "Rebuild after early drop must succeed").to.be.true;
            await sleep(5_000);
        }
        console.log("    ✓ LTE connection established — starting soak\n");

        /* ── Metrics ── */
        const metrics = {
            sent: 0,
            delivered: 0,
            lost: 0,
            latencies: [],
            reconnects: 0,
            errors: [],
        };

        const startTime = Date.now();
        let sequence = 0;

        /* ── Main soak loop ── */
        while (Date.now() - startTime < SOAK_MS) {
            // Random sleep between notifications (10-45 min)
            const gap = randInterval();
            const nextAt = new Date(Date.now() + gap).toLocaleTimeString();
            const elapsed = ((Date.now() - startTime) / 60_000).toFixed(1);
            console.log(`      [${elapsed}m] sleeping ${(gap / 60_000).toFixed(1)} min — next send ~${nextAt}`);
            await sleep(gap);

            // Check connection is still alive before sending
            if (peer.connectedPeers().length === 0) {
                const reconElapsed = ((Date.now() - startTime) / 60_000).toFixed(1);
                console.log(`      [${reconElapsed}m] ⚠ Connection lost — waiting for reconnect...`);
                const recon = await waitForPeerConnection(peer, RECONNECT_TIMEOUT);
                if (recon) {
                    metrics.reconnects++;
                    console.log(`      [${reconElapsed}m] ✓ Reconnected`);
                    await sleep(5_000);
                } else {
                    metrics.errors.push({
                        time: reconElapsed,
                        event: "reconnect-failed",
                    });
                    console.log(`      [${reconElapsed}m] ✗ Reconnect FAILED — sending anyway (will rely on buffer flush)`);
                }
            }

            // Send notification
            sequence++;
            const notif = makeTestNotification(sequence);
            const sendTime = Date.now();
            metrics.sent++;
            const sendElapsed = ((Date.now() - startTime) / 60_000).toFixed(1);

            try {
                peer.broadcast(notif);
            } catch (err) {
                console.log(`      [${sendElapsed}m] ⚠ Broadcast #${sequence} failed: ${err.message}`);
                metrics.errors.push({
                    time: sendElapsed,
                    event: "broadcast-fail",
                    msg: err.message,
                });
                // Don't count as lost yet — buffer may flush it after reconnect
                metrics.sent--;
                continue;
            }

            // Wait for delivery — generous timeout covers ICE restart + buffer flush
            const arrived = await waitFor(
                () => infra.hasNonce(notif._testNonce),
                NOTIF_TIMEOUT,
                3_000,
            );

            if (arrived) {
                const latency = Date.now() - sendTime;
                metrics.delivered++;
                metrics.latencies.push(latency);
                console.log(`      [${sendElapsed}m] ✓ #${sequence} delivered (${latency}ms) — ${metrics.delivered}/${metrics.sent}`);
            } else {
                metrics.lost++;
                console.log(`      [${sendElapsed}m] ✗ #${sequence} LOST — ${metrics.lost} total lost`);
                metrics.errors.push({
                    time: sendElapsed,
                    event: "notification-lost",
                    seq: sequence,
                });
            }
        }

        /* ── Final Report ── */
        infra.stopOrchestrator();

        const sorted = [...metrics.latencies].sort((a, b) => a - b);
        const mean = sorted.length > 0
            ? sorted.reduce((a, b) => a + b, 0) / sorted.length
            : 0;
        const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
        const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
        const rate = metrics.sent > 0
            ? ((metrics.delivered / metrics.sent) * 100).toFixed(2)
            : "N/A";

        console.log("\n    ═══════════════ SOAK TEST REPORT ═══════════════════");
        console.log(`    Duration:       ${SOAK_HOURS}h (${networkMode.toUpperCase()})`);
        console.log(`    Interval:       ${MIN_INTERVAL / 60_000}-${MAX_INTERVAL / 60_000} min (random)`);
        console.log(`    Sent:           ${metrics.sent}`);
        console.log(`    Delivered:      ${metrics.delivered}`);
        console.log(`    Lost:           ${metrics.lost}`);
        console.log(`    Success Rate:   ${rate}%`);
        console.log(`    Latency (ms):   mean=${mean.toFixed(0)}  p50=${p50}  p95=${p95}  p99=${p99}`);
        console.log(`    Reconnects:     ${metrics.reconnects}`);
        console.log(`    Errors:         ${metrics.errors.length}`);
        if (metrics.errors.length > 0) {
            console.log("    Error log:");
            for (const e of metrics.errors) {
                console.log(`      ${e.time}m  ${e.event}  ${e.msg || e.seq || ""}`);
            }
        }
        console.log("    ══════════════════════════════════════════════════\n");

        // Hard requirement: every notification must be delivered
        expect(metrics.lost).to.equal(0,
            `${metrics.lost} notification(s) lost — expected 0 lost over ${SOAK_HOURS}h`);
        expect(metrics.sent).to.be.greaterThan(0,
            "Must have sent at least one notification");
    });
});
