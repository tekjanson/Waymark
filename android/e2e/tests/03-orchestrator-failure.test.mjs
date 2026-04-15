/* ============================================================
   03-orchestrator-failure.test.mjs — Orchestrator crash and
   restart recovery tests.

   Validates:
     - Orchestrator killed → Android stays alive → orchestrator
       restarts → Android reconnects → notifications flow
     - Orchestrator process bouncing (rapid restart)
     - Android alone on mesh (no orchestrator) → orchestrator
       joins late → connection established
   ============================================================ */

import { expect } from "chai";
import { setupSuite, getInfra, getDriver } from "../lib/fixtures.mjs";
import { sleep, waitFor, waitForPeerConnection, makeTestNotification } from "../lib/infra.mjs";

describe("Orchestrator Failure & Recovery", function () {
    setupSuite();

    async function setupConnection(infra) {
        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();

        const peer = await infra.startOrchestrator();
        const connected = await waitForPeerConnection(peer, 120_000);
        expect(connected).to.be.true;
        await sleep(10_000);

        // Verify connection survived stabilization — if ICE dropped during the
        // sleep, wait for the automatic rebuild before starting the test.
        if (peer.connectedPeers().length === 0) {
            console.log("    ⚠ Connection dropped during stabilization — waiting for rebuild...");
            const rebuilt = await waitForPeerConnection(peer, 120_000);
            expect(rebuilt, "Connection should rebuild after early drop").to.be.true;
            await sleep(5_000);
        }

        return peer;
    }

    it("orchestrator crash → restart → Android reconnects → notifications resume", async function () {
        this.timeout(600_000);
        const infra  = getInfra();
        const driver = getDriver();

        // Establish connection
        const peer1 = await setupConnection(infra);

        // Send baseline notification
        const baseline = makeTestNotification(1);
        peer1.broadcast(baseline);
        const baseOk = await waitFor(() => infra.hasNonce(baseline._testNonce), 30_000);
        expect(baseOk, "Baseline should arrive before crash").to.be.true;
        console.log("    ✓ Baseline notification delivered");

        // Kill the orchestrator (simulates crash)
        console.log("    Killing orchestrator (simulating crash)...");
        infra.stopOrchestrator();

        // Android is now alone on the mesh — it should keep heartbeating
        console.log("    Android alone on mesh for 30s...");
        await sleep(30_000);

        // Restart orchestrator — same sheet
        console.log("    Restarting orchestrator...");
        const peer2 = await infra.startOrchestrator();

        // Wait for Android to reconnect
        const reconnected = await waitForPeerConnection(peer2, 120_000);
        expect(reconnected, "Android should reconnect to restarted orchestrator").to.be.true;
        await sleep(10_000);
        console.log("    ✓ Android reconnected");

        // Send post-crash notification
        const postCrash = makeTestNotification(2);
        console.log(`    Sending post-crash notification (nonce=${postCrash._testNonce})...`);
        peer2.broadcast(postCrash);

        const received = await waitFor(() => infra.hasNonce(postCrash._testNonce), 30_000);
        expect(received, "Post-crash notification should arrive").to.be.true;
        console.log("    ✓ Post-crash notification delivered");

        // Verify notification was posted
        await infra.verifyNotificationPosted("E2E Test #2", 10_000);

        infra.stopOrchestrator();
    });

    it("rapid orchestrator bouncing (3 restarts in 60s) → system recovers", async function () {
        this.timeout(600_000);
        const infra  = getInfra();
        const driver = getDriver();

        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();
        await sleep(10_000);

        // Bounce orchestrator 3 times
        for (let i = 1; i <= 3; i++) {
            console.log(`    Bounce ${i}/3: starting orchestrator...`);
            const peer = await infra.startOrchestrator();
            await sleep(10_000);
            console.log(`    Bounce ${i}/3: killing orchestrator...`);
            infra.stopOrchestrator();
            await sleep(10_000);
        }

        // Start final stable orchestrator
        console.log("    Starting final stable orchestrator...");
        const peer = await infra.startOrchestrator();
        const connected = await waitForPeerConnection(peer, 120_000);
        expect(connected, "Should connect after repeated bouncing").to.be.true;
        await sleep(10_000);

        // Send notification
        const notif = makeTestNotification(10);
        peer.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000);
        expect(arrived, "Notification should arrive after bounce recovery").to.be.true;
        console.log("    ✓ System recovered from rapid orchestrator bouncing");

        infra.stopOrchestrator();
    });

    it("Android starts first → orchestrator joins late → connection established", async function () {
        this.timeout(300_000);
        const infra  = getInfra();
        const driver = getDriver();

        // Start Android FIRST with no orchestrator on the mesh
        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();
        console.log("    App launched — no orchestrator on mesh yet");

        // Wait 30s with no orchestrator
        await sleep(30_000);

        // Now start orchestrator
        console.log("    Starting orchestrator (joining late)...");
        const peer = await infra.startOrchestrator();

        // They should find each other
        const connected = await waitForPeerConnection(peer, 120_000);
        expect(connected, "Late-joining orchestrator should connect to Android").to.be.true;
        await sleep(10_000);

        // Verify with notification
        const notif = makeTestNotification(20);
        peer.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000);
        expect(arrived).to.be.true;
        console.log("    ✓ Late-join orchestrator notification delivered");

        infra.stopOrchestrator();
    });
});
