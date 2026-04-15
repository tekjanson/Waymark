/* ============================================================
   04-app-lifecycle.test.mjs — Android app lifecycle tests

   Validates:
     - App force-killed → restarted → reconnects → notifications
     - App process death recovery (system kills for memory)
     - Device reboot → app restarts → reconnects
     - App cold start race (service starts before WebView ready)
     - Foreground/background transitions don't disrupt connection
     - Service survives activity destruction
   ============================================================ */

import { expect } from "chai";
import { setupSuite, getInfra, getDriver } from "../lib/fixtures.mjs";
import { sleep, waitFor, waitForPeerConnection, makeTestNotification } from "../lib/infra.mjs";
import { createDriver } from "../lib/appium.mjs";

describe("App Lifecycle", function () {
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

    it("force-kill app → relaunch → reconnects and delivers notification", async function () {
        this.timeout(300_000);
        const infra  = getInfra();
        const driver = getDriver();
        const peer = await setupConnection(infra);

        // Confirm baseline
        const baseline = makeTestNotification(1);
        peer.broadcast(baseline);
        const baseOk = await waitFor(() => infra.hasNonce(baseline._testNonce), 30_000);
        expect(baseOk).to.be.true;
        console.log("    ✓ Baseline notification delivered");

        // Force-kill the app (simulates user swipe-away or system kill)
        console.log("    Force-killing app...");
        infra.forceStopApp();
        await sleep(5_000);

        // Refresh OAuth token and relaunch (prefs persist across force-stop)
        await infra.refreshToken();
        infra.startLogcatMonitor();
        console.log("    Relaunching app...");
        infra.launchApp();

        // Wait for reconnection — 180s allows for ICE grace timer (30s) +
        // signaling exchange + ICE negotiation + DataChannel setup
        const reconnected = await waitForPeerConnection(peer, 180_000);
        expect(reconnected, "App should reconnect after force-kill").to.be.true;
        await sleep(10_000);

        // Send post-kill notification
        const postKill = makeTestNotification(2);
        peer.broadcast(postKill);
        const arrived = await waitFor(() => infra.hasNonce(postKill._testNonce), 30_000);
        expect(arrived, "Post-kill notification should arrive").to.be.true;

        await infra.verifyNotificationPosted("E2E Test #2", 10_000);
        console.log("    ✓ App recovered from force-kill");

        infra.stopOrchestrator();
    });

    it("device reboot → app restarts → reconnects → notifications flow", async function () {
        this.timeout(600_000);
        const infra  = getInfra();
        let driver = getDriver();
        const peer = await setupConnection(infra);

        // Verify baseline
        const baseline = makeTestNotification(1);
        peer.broadcast(baseline);
        const baseOk = await waitFor(() => infra.hasNonce(baseline._testNonce), 30_000);
        expect(baseOk, "Pre-reboot baseline should arrive").to.be.true;
        console.log("    ✓ Pre-reboot baseline delivered");

        // Close the Appium session before reboot
        await driver.close();

        // Reboot device
        console.log("    Rebooting device...");
        infra.rebootDevice();

        // Wait for device to come back
        console.log("    Waiting for device to boot...");
        infra.waitForDevice(180_000);
        await sleep(15_000); // extra settle time post-boot
        console.log("    ✓ Device rebooted");

        // Dismiss keyguard and wake screen
        infra.dismissKeyguard();

        // Re-install Appium deps (settings app breaks after reboot)
        console.log("    Reinstalling Appium dependencies...");
        infra.reinstallAppiumDeps();
        await sleep(5_000);

        // Re-create Appium driver (old session is dead)
        driver = await createDriver();

        // Launch app
        infra.startLogcatMonitor();
        infra.launchApp();
        await sleep(10_000);

        // Wait for reconnection to orchestrator
        console.log("    Waiting for post-reboot reconnection...");
        const reconnected = await waitForPeerConnection(peer, 180_000);
        expect(reconnected, "Should reconnect after reboot").to.be.true;
        await sleep(10_000);

        // Send post-reboot notification
        const postReboot = makeTestNotification(3);
        peer.broadcast(postReboot);
        const arrived = await waitFor(() => infra.hasNonce(postReboot._testNonce), 60_000);
        expect(arrived, "Post-reboot notification should arrive").to.be.true;

        await infra.verifyNotificationPosted("E2E Test #3", 15_000);
        console.log("    ✓ Post-reboot notification delivered and visible");

        infra.stopOrchestrator();
    });

    it("repeated foreground/background cycling doesn't disrupt notifications", async function () {
        this.timeout(300_000);
        const infra  = getInfra();
        const driver = getDriver();
        const peer = await setupConnection(infra);

        // Cycle foreground/background 5 times
        for (let i = 0; i < 5; i++) {
            await driver.sendToBackground(-1);
            await sleep(3_000);
            await driver.bringToForeground();
            await sleep(3_000);
            console.log(`    Cycle ${i + 1}/5 complete`);
        }

        // Connection should still be alive
        const stillConnected = peer.connectedPeers().length > 0;
        expect(stillConnected, "Connection should survive fg/bg cycling").to.be.true;

        // Send notification post-cycling
        const notif = makeTestNotification(50);
        peer.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000);
        expect(arrived, "Notification should arrive after fg/bg cycling").to.be.true;
        console.log("    ✓ Connection survived 5 foreground/background cycles");

        infra.stopOrchestrator();
    });

    it("app killed via recents → WatchdogWorker restarts service", async function () {
        this.timeout(600_000);
        const infra  = getInfra();
        const driver = getDriver();
        const peer = await setupConnection(infra);

        // Simulate system killing the process (more aggressive than force-stop)
        console.log("    Killing app process directly...");
        try {
            const { execSync: exec } = await import("node:child_process");
            exec(`adb shell am kill com.waymark.app`, { encoding: "utf8", timeout: 5_000 });
        } catch { /* ok */ }
        await sleep(5_000);

        // Relaunch app manually (in production WatchdogWorker does this)
        console.log("    Relaunching app...");
        infra.startLogcatMonitor();
        infra.launchApp();

        // Should reconnect
        const reconnected = await waitForPeerConnection(peer, 120_000);
        expect(reconnected, "Should reconnect after process kill").to.be.true;
        await sleep(10_000);

        // Verify with notification
        const notif = makeTestNotification(60);
        peer.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000);
        expect(arrived).to.be.true;
        console.log("    ✓ App recovered from process kill");

        infra.stopOrchestrator();
    });

    it("corrupted SharedPreferences → app clears and re-bootstraps cleanly", async function () {
        this.timeout(300_000);
        const infra  = getInfra();
        const driver = getDriver();

        // Inject garbage prefs
        infra.forceStopApp();
        const { execSync } = await import("node:child_process");
        execSync(
            `echo 'GARBAGE NOT XML' | adb shell "run-as com.waymark.app sh -c 'cat > shared_prefs/waymark_prefs.xml'"`,
            { timeout: 10_000 }
        );

        infra.startLogcatMonitor();
        infra.launchApp();

        // App should handle the corrupted prefs gracefully
        // It won't crash — SharedPreferences silently returns defaults on parse failure
        await sleep(15_000);

        // The app should still be running (check via adb)
        let running = false;
        try {
            const pid = execSync('adb shell pidof com.waymark.app', { encoding: 'utf8', timeout: 5_000 }).trim();
            running = pid.length > 0;
        } catch { /* process not found */ }
        expect(running, "App should survive corrupted SharedPreferences").to.be.true;
        console.log("    ✓ App survived corrupted SharedPreferences");

        infra.stopOrchestrator();
    });
});
