/* ============================================================
   05-soak.test.mjs — Multi-hour stability / soak test

   Runs for a configurable duration (default 2 hours) with:
     - Continuous notification delivery (every 30-60s)
     - Periodic disruptions on a random schedule:
       · Network drops (WiFi off/on)
       · Orchestrator restarts
       · App force-stop + relaunch
       · Device screen off/on
     - Metrics tracking: delivered, lost, latency histogram
     - Final report with success rate and mean/p99 latency

   Usage:
     SOAK_DURATION_MIN=120 npm run test:soak
   ============================================================ */

import { expect } from "chai";
import { setupSuite, getInfra, getDriver } from "../lib/fixtures.mjs";
import { sleep, waitFor, waitForPeerConnection, makeTestNotification } from "../lib/infra.mjs";
import { createDriver } from "../lib/appium.mjs";
import { execSync } from "node:child_process";

const SOAK_DURATION_MS = (parseInt(process.env.SOAK_DURATION_MIN, 10) || 120) * 60_000;
const NOTIFICATION_INTERVAL_MS = 45_000;       // ~45s between notifications
const DISRUPTION_INTERVAL_MS  = 5  * 60_000;   // disruption every ~5 min
const NOTIFICATION_TIMEOUT_MS = 60_000;         // max wait per notif
const RECONNECT_TIMEOUT_MS    = 180_000;        // max wait to reconnect after disruption

describe("Soak / Long-running Stability", function () {
    setupSuite();

    it(`continuous operation for ${(SOAK_DURATION_MS / 60_000).toFixed(0)} minutes with periodic disruptions`, async function () {
        this.timeout(SOAK_DURATION_MS + 600_000); // extra buffer
        const infra  = getInfra();
        let   driver = getDriver();

        /* ---- Metrics ---- */
        const metrics = {
            sent: 0,
            delivered: 0,
            lost: 0,
            latencies: [],
            disruptions: 0,
            reconnects: 0,
            errors: [],
        };

        /* ---- Disruption types ---- */
        const disruptions = [
            {
                name: "WiFi drop",
                async run() {
                    console.log("      ⚡ Disruption: WiFi off");
                    infra.setWifi(false);
                    await sleep(15_000 + Math.random() * 15_000);
                    infra.setWifi(true);
                    console.log("      ⚡ WiFi restored");
                },
            },
            {
                name: "Orchestrator restart",
                async run() {
                    console.log("      ⚡ Disruption: Orchestrator restart");
                    infra.stopOrchestrator();
                    await sleep(10_000);
                    currentPeer = await infra.startOrchestrator({ phase: 2 });
                    console.log("      ⚡ Orchestrator restarted");
                },
            },
            {
                name: "App force-stop",
                async run() {
                    console.log("      ⚡ Disruption: App force-stop");
                    infra.forceStopApp();
                    await sleep(5_000);
                    await infra.refreshToken();
                    infra.startLogcatMonitor();
                    infra.launchApp();
                    console.log("      ⚡ App relaunched");
                },
            },
            {
                name: "Screen off/on",
                async run() {
                    console.log("      ⚡ Disruption: Screen off");
                    execSync("adb shell input keyevent KEYCODE_SLEEP", { timeout: 5_000 });
                    await sleep(30_000 + Math.random() * 30_000);
                    execSync("adb shell input keyevent KEYCODE_WAKEUP", { timeout: 5_000 });
                    infra.dismissKeyguard();
                    console.log("      ⚡ Screen back on");
                },
            },
            {
                name: "Airplane mode cycle",
                async run() {
                    console.log("      ⚡ Disruption: Airplane mode on");
                    infra.setAirplaneMode(true);
                    await sleep(20_000);
                    infra.setAirplaneMode(false);
                    await sleep(5_000);
                    infra.setWifi(true);
                    console.log("      ⚡ Airplane mode off");
                },
            },
        ];

        function pickDisruption() {
            return disruptions[Math.floor(Math.random() * disruptions.length)];
        }

        /* ---- Bootstrap: Phase 1 key exchange then Phase 2 ---- */
        if (!infra._phase1Done) {
            await infra.performPhase1KeyExchange();
        }

        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();

        let currentPeer = await infra.startOrchestrator({ phase: 2 });
        const peerOk = await waitForPeerConnection(currentPeer, 120_000);
        expect(peerOk, "Initial connection should succeed").to.be.true;
        await sleep(10_000);
        console.log("    ✓ Initial connection established — beginning soak");

        const startTime = Date.now();
        let lastDisruption = Date.now();
        let sequence = 0;

        /* ---- Main loop ---- */
        while (Date.now() - startTime < SOAK_DURATION_MS) {
            const elapsed = ((Date.now() - startTime) / 60_000).toFixed(1);

            /* -- Maybe trigger disruption -- */
            if (Date.now() - lastDisruption > DISRUPTION_INTERVAL_MS) {
                const d = pickDisruption();
                metrics.disruptions++;
                try {
                    await d.run();
                    // Wait for reconnection
                    const recon = await waitForPeerConnection(currentPeer, RECONNECT_TIMEOUT_MS);
                    if (recon) {
                        metrics.reconnects++;
                        await sleep(10_000);
                    } else {
                        console.log(`      ⚠ Reconnect failed after ${d.name}`);
                        metrics.errors.push({ time: elapsed, event: `reconnect-fail-after-${d.name}` });
                    }
                } catch (err) {
                    console.log(`      ⚠ Disruption error: ${err.message}`);
                    metrics.errors.push({ time: elapsed, event: `disruption-error-${d.name}`, msg: err.message });
                }
                lastDisruption = Date.now();
            }

            /* -- Send notification -- */
            sequence++;
            const notif = makeTestNotification(sequence);
            const sendTime = Date.now();
            metrics.sent++;

            try {
                currentPeer.broadcast(notif);
            } catch (err) {
                console.log(`      [${elapsed}m] ⚠ Broadcast failed: ${err.message}`);
                metrics.errors.push({ time: elapsed, event: "broadcast-fail", msg: err.message });
                await sleep(NOTIFICATION_INTERVAL_MS);
                continue;
            }

            const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), NOTIFICATION_TIMEOUT_MS);
            if (arrived) {
                const latency = Date.now() - sendTime;
                metrics.delivered++;
                metrics.latencies.push(latency);
                if (sequence % 10 === 0) {
                    console.log(`      [${elapsed}m] #${sequence} delivered (${latency}ms) — ${metrics.delivered}/${metrics.sent} ok`);
                }
            } else {
                metrics.lost++;
                console.log(`      [${elapsed}m] #${sequence} LOST — ${metrics.lost} total lost`);
                metrics.errors.push({ time: elapsed, event: `notification-lost`, seq: sequence });
            }

            /* -- Variable sleep with jitter -- */
            const jitter = (Math.random() - 0.5) * 20_000; // ±10s
            await sleep(Math.max(5_000, NOTIFICATION_INTERVAL_MS + jitter));
        }

        /* ---- Final Report ---- */
        infra.stopOrchestrator();

        const sorted = [...metrics.latencies].sort((a, b) => a - b);
        const mean = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
        const p50  = sorted[Math.floor(sorted.length * 0.50)] || 0;
        const p95  = sorted[Math.floor(sorted.length * 0.95)] || 0;
        const p99  = sorted[Math.floor(sorted.length * 0.99)] || 0;
        const rate = metrics.sent > 0 ? ((metrics.delivered / metrics.sent) * 100).toFixed(2) : 0;

        console.log("\n    ═══════════════ SOAK TEST REPORT ═══════════════");
        console.log(`    Duration:      ${(SOAK_DURATION_MS / 60_000).toFixed(0)} min`);
        console.log(`    Sent:          ${metrics.sent}`);
        console.log(`    Delivered:     ${metrics.delivered}`);
        console.log(`    Lost:          ${metrics.lost}`);
        console.log(`    Success Rate:  ${rate}%`);
        console.log(`    Latency (ms):  mean=${mean.toFixed(0)}  p50=${p50}  p95=${p95}  p99=${p99}`);
        console.log(`    Disruptions:   ${metrics.disruptions}`);
        console.log(`    Reconnects:    ${metrics.reconnects}`);
        console.log(`    Errors:        ${metrics.errors.length}`);
        if (metrics.errors.length > 0) {
            console.log("    Error log:");
            metrics.errors.forEach(e => console.log(`      ${e.time}m  ${e.event}  ${e.msg || ""}`));
        }
        console.log("    ═══════════════════════════════════════════════\n");

        // Soak test success criteria: ≥95% delivery rate
        expect(parseFloat(rate)).to.be.at.least(95,
            `Delivery rate ${rate}% is below 95% threshold`);
    });
});
