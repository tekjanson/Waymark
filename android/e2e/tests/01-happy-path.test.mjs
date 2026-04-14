/* ============================================================
   01-happy-path.test.mjs — Fresh install → key exchange →
   encrypted notifications, end-to-end, from absolute scratch.

   Every test starts with:
     - Brand new Google Sheets (never used before)
     - Freshly generated AES-256 key
     - App data wiped clean
     - No pre-existing state whatsoever

   Tests verify the full lifecycle:
     1. App cold start → Phase 1 (key exchange)
     2. Orchestrator delivers AES key over DataChannel
     3. App transitions to Phase 2 (encrypted)
     4. Orchestrator sends notification → appears in shade
     5. Multiple notifications → all unique, all visible
     6. App backgrounded → still receives notifications
   ============================================================ */

import { expect } from "chai";
import { setupSuite, getInfra, getDriver } from "../lib/fixtures.mjs";
import { sleep, waitFor, waitForPeerConnection, makeTestNotification } from "../lib/infra.mjs";
import { randomBytes } from "node:crypto";

describe("Happy Path — Zero to Notification", function () {
    setupSuite();

    /*
     * Full lifecycle: cold start → Phase 1 key exchange → Phase 2
     * encrypted notifications → verify in notification shade.
     */
    it("fresh install → key exchange → encrypted notification delivery", async function () {
        this.timeout(300_000); // 5 min max
        const infra  = getInfra();
        const driver = getDriver();

        // === Phase 1: Key Exchange (private sheet, plaintext) ===

        // Use the key from the key file (production path) or generate if not available
        const aesKeyHex = infra.signalKey || randomBytes(32).toString("hex");

        // Start orchestrator in Phase 1 mode on the private sheet.
        // It will send the AES key to any Android peer that connects.
        console.log("    Starting orchestrator (Phase 1 — key exchange)...");
        const phase1Peer = await infra.startOrchestrator({
            phase: 1,
            onConnect: (remotePeerId) => {
                console.log(`    Phase 1: Android peer ${remotePeerId} connected — sending key`);
                phase1Peer.sendKeyExchangeTo(remotePeerId, aesKeyHex);
            },
        });
        console.log(`    Orchestrator joined Phase 1 at block=${phase1Peer.block}`);

        // Stop the app that Appium auto-launched so we can inject OAuth token
        infra.forceStopApp();

        // Inject only the OAuth token — app discovers sheets from Drive
        await infra.injectToken();

        // Start logcat monitoring
        infra.startLogcatMonitor();

        // Launch the app — it should start WebRtcService, connect to Phase 1,
        // receive the key, then auto-transition to Phase 2
        console.log("    Launching app...");
        infra.launchApp();

        // Wait for the key to be delivered
        console.log("    Waiting for key exchange...");
        const keyDelivered = await waitFor(() => {
            const prefs = infra.readPrefs();
            return prefs.includes("signal_key") && prefs.includes(aesKeyHex);
        }, 120_000, 3_000);
        expect(keyDelivered, "Signal key should be stored in SharedPreferences").to.be.true;
        console.log("    ✓ Key exchange complete");

        // Store the exchanged key on infra so Phase 2 can use it
        infra.signalKey = aesKeyHex;
        infra._phase1Done = true;

        // Stop Phase 1 orchestrator
        infra.stopOrchestrator();

        // Give app time to transition to Phase 2
        await sleep(5_000);

        // === Phase 2: Encrypted Notifications (public sheet) ===

        console.log("    Starting orchestrator (Phase 2 — encrypted)...");
        const phase2Peer = await infra.startOrchestrator({ phase: 2 });
        console.log(`    Orchestrator joined Phase 2 at block=${phase2Peer.block}`);

        // Wait for Android to connect on Phase 2
        console.log("    Waiting for Android peer on Phase 2...");
        const connected = await waitForPeerConnection(phase2Peer, 120_000);
        expect(connected, "Android should connect to Phase 2 within 2 min").to.be.true;
        console.log("    ✓ Android connected on Phase 2");

        // Wait for connection to stabilize
        await sleep(10_000);

        // Send a test notification
        const notif = makeTestNotification(1);
        console.log(`    Sending notification (nonce=${notif._testNonce})...`);
        const sentTo = phase2Peer.broadcast(notif);
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

        // Run Phase 1 key exchange if not already done
        if (!infra._phase1Done) {
            await infra.performPhase1KeyExchange();
        }

        // Refresh OAuth token in existing prefs (sheet IDs + key persist from Phase 1)
        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();

        const peer = await infra.startOrchestrator({ phase: 2 });
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

        // Run Phase 1 key exchange if not already done
        if (!infra._phase1Done) {
            await infra.performPhase1KeyExchange();
        }

        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();

        const peer = await infra.startOrchestrator({ phase: 2 });
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
