/* ============================================================
   02-network-resilience.test.mjs — Network disruption tests

   Validates the P2P notification system recovers gracefully
   from every network failure mode:
     - WiFi drops and reconnects
     - Full airplane mode cycles
     - Rapid network flapping (toggle 5x in 30s)
     - Extended offline periods (2+ min)
     - Network change during active notification delivery
     - Mobile data fallback
   ============================================================ */

import { expect } from "chai";
import { setupSuite, getInfra, getDriver } from "../lib/fixtures.mjs";
import { sleep, waitFor, waitForPeerConnection, makeTestNotification } from "../lib/infra.mjs";

describe("Network Resilience", function () {
    setupSuite();

    // Safety net: restore network + stop orchestrator after every test
    afterEach(function () {
        const infra = getInfra();
        try { infra.stopOrchestrator(); } catch { /* ok */ }
        try { infra.setAirplaneMode(false); } catch { /* ok */ }
        try { infra.setWifi(true); } catch { /* ok */ }
    });

    /**
     * Helper: establish connection to signaling sheet + orchestrator
     * for the actual test.
     */
    async function setupConnection(infra) {
        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();

        const peer = await infra.startOrchestrator();
        const connected = await waitForPeerConnection(peer, 120_000);
        expect(connected, "Initial connection should succeed").to.be.true;
        await sleep(10_000); // stabilize

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

    it("WiFi drop → reconnect → notification still delivered", async function () {
        this.timeout(300_000);
        const infra  = getInfra();
        const driver = getDriver();
        const peer = await setupConnection(infra);

        // Confirm baseline: send a notification before disruption
        const baseline = makeTestNotification(0);
        peer.broadcast(baseline);
        const baseOk = await waitFor(() => infra.hasNonce(baseline._testNonce), 30_000);
        expect(baseOk, "Baseline notification should arrive pre-disruption").to.be.true;
        console.log("    ✓ Baseline notification received");

        // Drop WiFi
        console.log("    Dropping WiFi...");
        infra.setWifi(false);
        await sleep(10_000);

        // Notification should NOT arrive while WiFi is off
        const during = makeTestNotification(1);
        peer.broadcast(during);
        console.log(`    Sent notification during WiFi outage (nonce=${during._testNonce})`);
        await sleep(5_000);
        expect(infra.hasNonce(during._testNonce), "Should not arrive while WiFi is off").to.be.false;

        // Restore WiFi — the app's WebRtcService.onAvailable() detects networkLost=true
        // and calls requestConnect().  resolveAndConnect() sees the peer is still in-mesh
        // and short-circuits.  The peer's own poll() loop resumes polling once HTTP works;
        // the ICE zombie check handles any stale STUN bindings and rebuilds if needed.
        console.log("    Restoring WiFi...");
        infra.setWifi(true);

        // Wait for the app to autonomously reconnect to the SAME orchestrator peer
        const reconnected = await waitForPeerConnection(peer, 120_000);
        expect(reconnected, "App should autonomously reconnect after WiFi restored").to.be.true;
        console.log("    ✓ Android reconnected after WiFi restore (production recovery)");

        // Send a new notification post-recovery
        await sleep(5_000);
        const after = makeTestNotification(2);
        peer.broadcast(after);
        const afterOk = await waitFor(() => infra.hasNonce(after._testNonce), 30_000);
        expect(afterOk, "Post-recovery notification should arrive").to.be.true;
        console.log("    ✓ Post-recovery notification received");

        await infra.verifyNotificationPosted("E2E Test #2", 10_000);
        console.log("    ✓ Notification visible after recovery");
    });

    it("airplane mode cycle → full recovery", async function () {
        this.timeout(300_000);
        const infra  = getInfra();
        const driver = getDriver();
        const peer = await setupConnection(infra);

        // Enable airplane mode (kills all radios)
        console.log("    Enabling airplane mode...");
        infra.setAirplaneMode(true);
        await sleep(10_000);

        // Disable airplane mode — app should detect network recovery and re-bootstrap
        console.log("    Disabling airplane mode...");
        infra.setAirplaneMode(false);
        await sleep(5_000);
        // Re-enable WiFi explicitly (airplane mode may have disabled it)
        infra.setWifi(true);

        // Wait for the app to autonomously reconnect
        const reconnected = await waitForPeerConnection(peer, 120_000);
        expect(reconnected, "App should autonomously reconnect after airplane mode").to.be.true;
        console.log("    ✓ Android reconnected after airplane mode (production recovery)");

        // Verify notification delivery works after recovery
        await sleep(5_000);
        const notif = makeTestNotification(10);
        peer.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000);
        expect(arrived, "Notification should arrive after airplane mode recovery").to.be.true;
        console.log("    ✓ Notification received after airplane mode recovery");
    });

    it("rapid network flapping (5 toggles in 30s) → recovers and delivers", async function () {
        this.timeout(600_000); // 10 min — needs time to stabilize
        const infra  = getInfra();
        const driver = getDriver();
        const peer = await setupConnection(infra);

        // Rapid flap WiFi 5 times
        console.log("    Starting network flap sequence...");
        for (let i = 0; i < 5; i++) {
            infra.setWifi(false);
            await sleep(3_000);
            infra.setWifi(true);
            await sleep(3_000);
            console.log(`    Flap ${i + 1}/5 complete`);
        }

        // The app should autonomously recover after the flapping stops.
        // onAvailable calls requestConnect() → resolveAndConnect() no-ops (peer still in mesh).
        // The peer's poll() loop resumes; the ICE zombie check detects any stale STUN
        // bindings and rebuilds the connection within the same signaling slot.
        console.log("    Waiting for app to autonomously recover...");
        const reconnected = await waitForPeerConnection(peer, 180_000);
        expect(reconnected, "App should autonomously recover after network flapping").to.be.true;
        console.log("    ✓ Android reconnected after flapping (production recovery)");

        // Send notification post-flap
        await sleep(5_000);
        const notif = makeTestNotification(20);
        peer.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 60_000, 3_000);
        expect(arrived, "Notification should arrive after network flapping").to.be.true;
        console.log("    ✓ System recovered from rapid network flapping");
    });

    it("extended offline (2 min) → recovery → notification delivered", async function () {
        this.timeout(600_000);
        const infra  = getInfra();
        const driver = getDriver();
        const peer = await setupConnection(infra);

        // Go offline
        console.log("    Going offline for 2 minutes...");
        infra.setAirplaneMode(true);

        // Wait the full 2 minutes offline
        await sleep(120_000);

        // Come back online — app should autonomously re-bootstrap
        console.log("    Coming back online...");
        infra.setAirplaneMode(false);
        await sleep(5_000);
        infra.setWifi(true);

        // Wait for the app to autonomously reconnect
        const reconnected = await waitForPeerConnection(peer, 180_000);
        expect(reconnected, "App should autonomously reconnect after 2 min offline").to.be.true;
        console.log("    ✓ Android reconnected after 2 min offline (production recovery)");

        // Send notification after recovery
        await sleep(5_000);
        const notif = makeTestNotification(30);
        peer.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000);
        expect(arrived, "Notification should arrive after extended offline recovery").to.be.true;
        console.log("    ✓ Post-recovery notification delivered after 2 min offline");
    });

    it("network drops mid-notification → app recovers and delivers new notification", async function () {
        this.timeout(300_000);
        const infra  = getInfra();
        const driver = getDriver();
        const peer = await setupConnection(infra);

        // Send notification and IMMEDIATELY kill WiFi
        const notif = makeTestNotification(40);
        peer.broadcast(notif);
        infra.setWifi(false);
        console.log(`    Sent notification + killed WiFi simultaneously (nonce=${notif._testNonce})`);

        await sleep(10_000);

        // Restore WiFi — app should autonomously re-bootstrap
        infra.setWifi(true);
        console.log("    WiFi restored");

        // Wait for the app to autonomously reconnect to the SAME orchestrator
        const reconnected = await waitForPeerConnection(peer, 120_000);
        expect(reconnected, "App should autonomously reconnect after mid-flight WiFi drop").to.be.true;
        console.log("    ✓ Android reconnected after mid-notification drop (production recovery)");

        // Send fresh notification after recovery
        await sleep(5_000);
        const recovery = makeTestNotification(41);
        peer.broadcast(recovery);
        const arrived = await waitFor(() => infra.hasNonce(recovery._testNonce), 30_000);
        expect(arrived, "Post-recovery notification should arrive").to.be.true;
        console.log("    ✓ Post-recovery notification delivered after mid-flight drop");
    });
});
