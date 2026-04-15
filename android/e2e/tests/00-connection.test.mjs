/* ============================================================
   00-connection.test.mjs — Fast WebRTC connection gate test

   Lightweight test that verifies the core WebRTC pipeline works
   WITHOUT Appium. Must pass before any other E2E test runs.

   Tests (in order):
     1. WebRTC handshake completes on WiFi
     2. Notification delivered via DataChannel
     3. Connection survives 30s idle
     4. WiFi drop → reconnect → notification delivered
     5. Orchestrator restart → Android reconnects

   Each test is fast (<2 min) and uses only adb + logcat.
   ============================================================ */

import { expect } from "chai";
import { setupSuite, getInfra } from "../lib/fixtures.mjs";
import { sleep, waitFor, waitForPeerConnection, makeTestNotification } from "../lib/infra.mjs";

describe("Connection Gate — WebRTC pipeline health", function () {
    setupSuite({ needsAppium: false });

    async function freshConnection(infra) {
        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();

        const peer = await infra.startOrchestrator();
        const connected = await waitForPeerConnection(peer, 120_000);
        expect(connected, "WebRTC handshake must complete").to.be.true;
        await sleep(5_000);

        if (peer.connectedPeers().length === 0) {
            const rebuilt = await waitForPeerConnection(peer, 60_000);
            expect(rebuilt, "Connection must stabilize").to.be.true;
            await sleep(3_000);
        }

        return peer;
    }

    afterEach(function () {
        const infra = getInfra();
        try { infra.stopOrchestrator(); } catch { /* ok */ }
        try { infra.setAirplaneMode(false); } catch { /* ok */ }
        try { infra.setWifi(true); } catch { /* ok */ }
        try { infra.setMobileData(true); } catch { /* ok */ }
    });

    it("WebRTC handshake + notification delivery", async function () {
        this.timeout(180_000);
        const infra = getInfra();
        const peer = await freshConnection(infra);

        const notif = makeTestNotification(1);
        peer.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000, 2_000);
        expect(arrived, "Notification must arrive via DataChannel").to.be.true;
        console.log("    ✓ Handshake + delivery OK");
    });

    it("connection survives 30s idle", async function () {
        this.timeout(180_000);
        const infra = getInfra();
        const peer = await freshConnection(infra);

        console.log("    Idle for 30s...");
        await sleep(30_000);

        expect(peer.connectedPeers().length, "Connection must survive idle").to.be.gte(1);

        const notif = makeTestNotification(2);
        peer.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000, 2_000);
        expect(arrived, "Post-idle notification must arrive").to.be.true;
        console.log("    ✓ Idle survival OK");
    });

    it("WiFi drop → reconnect → delivery", async function () {
        this.timeout(240_000);
        const infra = getInfra();
        const peer = await freshConnection(infra);

        console.log("    Dropping WiFi...");
        infra.setWifi(false);
        await sleep(15_000);

        console.log("    Restoring WiFi...");
        infra.setWifi(true);

        const reconnected = await waitForPeerConnection(peer, 120_000);
        expect(reconnected, "Must reconnect after WiFi drop").to.be.true;
        await sleep(5_000);

        const notif = makeTestNotification(3);
        peer.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000, 2_000);
        expect(arrived, "Post-WiFi-drop notification must arrive").to.be.true;
        console.log("    ✓ WiFi recovery OK");
    });

    it("orchestrator restart → Android reconnects", async function () {
        this.timeout(240_000);
        const infra = getInfra();
        const peer1 = await freshConnection(infra);

        console.log("    Killing orchestrator...");
        infra.stopOrchestrator();
        await sleep(15_000);

        console.log("    Restarting orchestrator...");
        const peer2 = await infra.startOrchestrator();
        const reconnected = await waitForPeerConnection(peer2, 120_000);
        expect(reconnected, "Must reconnect to new orchestrator").to.be.true;
        await sleep(5_000);

        const notif = makeTestNotification(4);
        peer2.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000, 2_000);
        expect(arrived, "Post-restart notification must arrive").to.be.true;
        console.log("    ✓ Orchestrator restart recovery OK");
    });
});
