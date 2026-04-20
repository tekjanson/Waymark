/* ============================================================
   07-mesh-reconnection.test.mjs — Mesh re-join and slot recovery

   Validates the two reconnection bugs that previously required
   a full app restart to recover:

   BUG-2: After slot eviction, poll() sets block=-1 but the inner
   poll loop kept calling poll() as a no-op (block < 0 guards to
   return early) instead of breaking out to the outer loop where
   join() would be invoked. The app was stuck in a spin state.

   BUG-1: When join() found no free slot (full mesh), it called
   return@launch permanently terminating the start() coroutine.
   The app would never retry joining even after stale entries expired.

   Both bugs are fixed in OrchestratorPeer.start():
     • poll() result sets block=-1 → inner loop now breaks so the
       outer loop can call join() again.
     • join() with full mesh → retry with backoff instead of exit.
   ============================================================ */

import { expect } from "chai";
import { setupSuite, getInfra, getDriver } from "../lib/fixtures.mjs";
import { sleep, waitFor, waitForPeerConnection, makeTestNotification } from "../lib/infra.mjs";

describe("Mesh Reconnection — Slot Recovery", function () {
    setupSuite();

    afterEach(function () {
        const infra = getInfra();
        try { infra.stopOrchestrator(); } catch { /* ok */ }
        try { infra.setWifi(true); } catch { /* ok */ }
    });

    async function setupConnection(infra) {
        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();
        infra.launchApp();

        const peer = await infra.startOrchestrator();
        const connected = await waitForPeerConnection(peer, 120_000);
        expect(connected, "Initial connection should succeed").to.be.true;
        await sleep(10_000);

        if (peer.connectedPeers().length === 0) {
            console.log("    ⚠ Connection dropped during stabilization — waiting for rebuild...");
            const rebuilt = await waitForPeerConnection(peer, 120_000);
            expect(rebuilt, "Connection should rebuild after early drop").to.be.true;
            await sleep(5_000);
        }

        return peer;
    }

    it("slot eviction (signaling cleared) → app autonomously rejoins mesh", async function () {
        this.timeout(300_000);
        const infra = getInfra();

        const peer = await setupConnection(infra);

        // Baseline — verify a notification reaches the app before disruption
        const baseline = makeTestNotification(1);
        peer.broadcast(baseline);
        const baseOk = await waitFor(() => infra.hasNonce(baseline._testNonce), 30_000);
        expect(baseOk, "Baseline notification must arrive before eviction").to.be.true;
        console.log("    ✓ Baseline notification delivered");

        // Clear the signaling sheet — both the app's and orchestrator's presence rows
        // become empty.  The app must detect the eviction (3 poll misses × 5s ≈ 15s),
        // find a free slot, re-join the mesh, and re-establish the DataChannel.
        console.log("    Clearing signaling sheet (simulating slot eviction)...");
        await infra.clearSignaling();
        console.log("    Signaling column cleared — waiting for autonomous rejoin...");

        // The orchestrator's heartbeat fires within 15s and reclaims its slot.
        // The app detects its own slot is empty after 3 poll cycles, runs findSlot(),
        // and claims a different slot.  They then renegotiate the DataChannel.
        const reconnected = await waitForPeerConnection(peer, 180_000);
        expect(reconnected, "App must autonomously rejoin after slot eviction").to.be.true;
        console.log("    ✓ App rejoined mesh after slot eviction (BUG-2 fix verified)");

        await sleep(5_000);

        // Confirm notification delivery is fully restored
        const postEvict = makeTestNotification(2);
        peer.broadcast(postEvict);
        const arrived = await waitFor(() => infra.hasNonce(postEvict._testNonce), 30_000);
        expect(arrived, "Post-eviction notification must arrive").to.be.true;
        console.log("    ✓ Post-eviction notification delivered");

        await infra.verifyNotificationPosted("E2E Test #2", 10_000);

        infra.stopOrchestrator();
    });

    it("repeated slot evictions → app rejoins each time without restart", async function () {
        this.timeout(600_000);
        const infra = getInfra();

        const peer = await setupConnection(infra);

        for (let round = 1; round <= 2; round++) {
            console.log(`\n    === Eviction round ${round}/2 ===`);

            // Clear the signaling sheet to evict both peers
            console.log(`    Round ${round}: clearing signaling sheet...`);
            await infra.clearSignaling();

            // Wait for autonomous rejoin
            const reconnected = await waitForPeerConnection(peer, 180_000);
            expect(reconnected, `App must rejoin after eviction round ${round}`).to.be.true;
            console.log(`    ✓ Round ${round}: app rejoined mesh`);

            // Verify notification delivery after each rejoin
            await sleep(5_000);
            const notif = makeTestNotification(round);
            peer.broadcast(notif);
            const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000);
            expect(arrived, `Notification must arrive after eviction round ${round}`).to.be.true;
            console.log(`    ✓ Round ${round}: notification delivered`);

            // Short stabilization pause before next round
            await sleep(10_000);
        }
        console.log("    ✓ App recovered from repeated evictions without manual restart");
        infra.stopOrchestrator();
    });

    it("full mesh at join time → app retries and joins once slot opens", async function () {
        this.timeout(600_000); // fake presences expire at ALIVE_TTL (50s) + retries + ICE
        const infra = getInfra();

        infra.forceStopApp();
        await infra.refreshToken();
        infra.startLogcatMonitor();

        // Start the orchestrator first so it holds one slot.
        // Then fill the remaining 7 slots with fresh fake presences so the mesh
        // looks full when the app tries to join (BUG-1 scenario).
        console.log("    Starting orchestrator (claims 1 slot)...");
        const peer = await infra.startOrchestrator();
        // Give the orchestrator a moment to claim its slot before we fill the rest.
        await sleep(8_000);

        // Read orchestrator peer ID to exclude its slot from the fill
        const orchPeerId = peer.peerId;
        console.log(`    Orchestrator peer ID: ${orchPeerId}`);

        console.log("    Filling remaining 7 slots with fresh fake presences...");
        await infra.fillSignalingSlots({ excludePeerIds: [orchPeerId] });
        console.log("    All 8 signaling slots now occupied — launching app...");

        // Launch the app into a full mesh (BUG-1 path: join() returns block=-1).
        // With the fix, start() retries with backoff instead of permanently exiting.
        infra.launchApp();

        // The fake presences expire after ALIVE_TTL (50s).  The app's retry backoff
        // starts at 10s; it will retry join() approximately every 10s→20s→40s while
        // the mesh is full, then claim a slot once the fakes expire.
        // Allow up to 4 minutes for: fake expiry (50s) + retries + ICE negotiation.
        console.log("    Waiting for app to rejoin once fake slots expire (~50s)...");
        const connected = await waitForPeerConnection(peer, 240_000);
        expect(connected, "App must join mesh once stale slots expire (BUG-1 fix verified)").to.be.true;
        console.log("    ✓ App joined full mesh after fake slots expired");

        await sleep(5_000);

        const notif = makeTestNotification(1);
        peer.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000);
        expect(arrived, "Notification must arrive after joining a previously-full mesh").to.be.true;
        console.log("    ✓ Notification delivered after full-mesh join");

        infra.stopOrchestrator();
    });

    it("slot eviction while alone (no other peers) → app rejoins after orchestrator restarts", async function () {
        this.timeout(300_000);
        const infra = getInfra();

        const peer = await setupConnection(infra);

        // Kill the orchestrator — app is now alone on the mesh
        console.log("    Killing orchestrator — app alone on mesh...");
        infra.stopOrchestrator();
        await sleep(10_000);

        // Evict the app's slot
        console.log("    Clearing signaling sheet while app is alone...");
        await infra.clearSignaling();

        // Restart orchestrator — both sides need to rejoin and find each other
        console.log("    Restarting orchestrator...");
        const peer2 = await infra.startOrchestrator();

        const reconnected = await waitForPeerConnection(peer2, 180_000);
        expect(reconnected, "App must rejoin and reconnect after eviction-while-alone").to.be.true;
        console.log("    ✓ App rejoined and reconnected to restarted orchestrator");

        await sleep(5_000);
        const notif = makeTestNotification(1);
        peer2.broadcast(notif);
        const arrived = await waitFor(() => infra.hasNonce(notif._testNonce), 30_000);
        expect(arrived, "Notification must arrive after rejoin-while-alone recovery").to.be.true;
        console.log("    ✓ Notification delivered after rejoin-while-alone recovery");

        infra.stopOrchestrator();
    });
});
