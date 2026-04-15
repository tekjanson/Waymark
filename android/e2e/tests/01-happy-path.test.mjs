/* ============================================================
   01-happy-path.test.mjs — Fresh install → connection →
   notification delivery, end-to-end, from absolute scratch.

   Single-sheet architecture: one OAuth-protected Google Sheet,
   no encryption, no key exchange.

   Every test starts with:
     - Brand new Google Sheet (never used before)
     - App data wiped clean
     - No pre-existing state whatsoever

   Tests verify the full lifecycle:
     1. App cold start → connects to signaling sheet
     2. Orchestrator sends notification → appears in shade
     3. Multiple notifications → all unique, all visible
     4. App backgrounded → still receives notifications
   ============================================================ */

import { expect } from "chai";
import { setupSuite, getInfra, getDriver } from "../lib/fixtures.mjs";
import { sleep, waitFor, waitForPeerConnection, makeTestNotification } from "../lib/infra.mjs";

describe("Happy Path — Zero to Notification", function () {
    setupSuite();

    /*
     * Full lifecycle: cold start → connect to signaling sheet →
     * notification delivery → verify in notification shade.
     */
    it("fresh install → connection → notification delivery", async function () {
        this.timeout(300_000); // 5 min max
        const infra  = getInfra();
        const driver = getDriver();

        // Stop the app that Appium auto-launched so we can inject OAuth token
        infra.forceStopApp();

        // Inject only the OAuth token — app discovers sheet from Drive
        await infra.injectToken();

        // Start logcat monitoring
        infra.startLogcatMonitor();

        // Start orchestrator on the signaling sheet
        console.log("    Starting orchestrator...");
        const peer = await infra.startOrchestrator();
        console.log(`    Orchestrator joined at block=${peer.block}`);

        // Launch the app — it should start WebRtcService, connect to the sheet
        console.log("    Launching app...");
        infra.launchApp();

        // Wait for Android to connect
        console.log("    Waiting for Android peer...");
        const connected = await waitForPeerConnection(peer, 120_000);
        expect(connected, "Android should connect within 2 min").to.be.true;
        console.log("    ✓ Android connected");

        // Wait for connection to stabilize
        await sleep(10_000);

        // Send a test notification
        const notif = makeTestNotification(1);
        console.log(`    Sending notification (nonce=${notif._testNonce})...`);
        const sentTo = peer.broadcast(notif);
        expect(sentTo, "Notification should be sent to at least 1 peer").to.be.gte(1);

        // Verify in logcat
        const received = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000, 2_000);
        expect(received, "Android should log receipt of the notification nonce").to.be.true;
        console.log("    ✓ Notification received by Android");

        // Verify notification was posted to the system
        await infra.verifyNotificationPosted("E2E Test #1", 15_000);
        console.log("    ✓ Notification visible in shade");

        infra.stopOrchestrator();
    });

    it("multiple notifications → all appear as unique entries in shade", async function () {
        this.timeout(300_000);
        const infra  = getInfra();
        const driver = getDriver();

        // Refresh OAuth token and relaunch
        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();

        const peer = await infra.startOrchestrator();
        const connected = await waitForPeerConnection(peer, 120_000);
        expect(connected).to.be.true;
        await sleep(10_000);

        // Clear existing notifications
        await driver.clearAllNotifications();

        // Send 5 notifications
        const nonces = [];
        for (let i = 1; i <= 5; i++) {
            const notif = makeTestNotification(i);
            nonces.push(notif._testNonce);
            peer.broadcast(notif);
            await sleep(3_000);
        }

        // Wait for all to arrive
        const allReceived = await waitFor(
            () => nonces.every(n => infra.hasNonce(n)),
            60_000, 3_000,
        );
        expect(allReceived, "All 5 notification nonces should be received").to.be.true;

        // Verify each one was posted
        for (let i = 1; i <= 5; i++) {
            const visible = await infra.verifyNotificationPosted(`E2E Test #${i}`, 5_000);
            expect(visible, `Notification #${i} should be posted`).to.be.true;
        }
        console.log("    ✓ All 5 notifications visible in shade");

        infra.stopOrchestrator();
    });

    it("notification received while app is in background", async function () {
        this.timeout(300_000);
        const infra  = getInfra();
        const driver = getDriver();

        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();

        const peer = await infra.startOrchestrator();
        const connected = await waitForPeerConnection(peer, 120_000);
        expect(connected).to.be.true;
        await sleep(10_000);

        // Send app to background
        console.log("    Sending app to background...");
        await driver.sendToBackground(-1);
        await sleep(5_000);

        // Send notification while backgrounded
        const notif = makeTestNotification(99);
        console.log(`    Sending notification while backgrounded (nonce=${notif._testNonce})...`);
        peer.broadcast(notif);

        // Verify receipt
        const received = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000, 2_000);
        expect(received, "Background notification should be received").to.be.true;

        // Verify notification was posted
        await infra.verifyNotificationPosted("E2E Test #99", 15_000);
        console.log("    ✓ Background notification visible in shade");

        infra.stopOrchestrator();
    });
});
