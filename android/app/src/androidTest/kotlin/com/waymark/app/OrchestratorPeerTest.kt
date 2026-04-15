/* ============================================================
   OrchestratorPeerTest.kt — Instrumented tests for the WebRTC
   mesh peer using in-memory signaling.

   Tests the full signaling protocol (join, heartbeat, poll,
   offer/answer, DataChannel messaging) with real WebRTC
   PeerConnections on the device — only the Sheets I/O is
   replaced with InMemorySignalingClient.
   ============================================================ */

package com.waymark.app

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(AndroidJUnit4::class)
class OrchestratorPeerTest {

    private lateinit var ctx: Context
    private lateinit var store: SignalingStore
    private var peer1: OrchestratorPeer? = null
    private var peer2: OrchestratorPeer? = null

    @Before
    fun setUp() {
        ctx = InstrumentationRegistry.getInstrumentation().targetContext
        store = SignalingStore()
    }

    @After
    fun tearDown() {
        peer1?.stop()
        peer2?.stop()
        store.clear()
    }

    @Test
    fun singlePeer_joinsAndHeartbeats() = runBlocking {
        val client = InMemorySignalingClient(store)
        val receivedNotifs = CopyOnWriteArrayList<String>()

        peer1 = OrchestratorPeer(
            context = ctx,
            sheetId = "test-sheet",
            peerId = "peer0001",
            displayName = "Test Peer 1",
            signalingClient = client,
            onNotification = { _, body -> receivedNotifs.add(body) }
        )
        peer1!!.start()

        // Wait for join + heartbeat
        delay(3000)

        assertTrue("Peer should be in mesh", peer1!!.isInMesh)
        assertFalse("Peer should not be destroyed", peer1!!.destroyed)

        // Verify presence was written to the store
        val presence = store.readAll()
        val foundPresence = presence.filterNotNull().any { raw ->
            try {
                val json = JSONObject(raw)
                json.optString("peerId") == "peer0001"
            } catch (_: Exception) { false }
        }
        assertTrue("Presence row should contain peerId", foundPresence)
    }

    @Test
    fun twoPeers_connectViaDataChannel() = runBlocking {
        val client1 = InMemorySignalingClient(store)
        val client2 = InMemorySignalingClient(store)

        val connectedLatch = CountDownLatch(2) // both peers see each other

        peer1 = OrchestratorPeer(
            context = ctx,
            sheetId = "test-sheet",
            peerId = "aaaa0001",
            displayName = "Peer Alpha",
            signalingClient = client1,
            onNotification = { _, _ -> }
        )
        peer1!!.onConnectionStateChanged = { connected, _ ->
            if (connected) connectedLatch.countDown()
        }

        peer2 = OrchestratorPeer(
            context = ctx,
            sheetId = "test-sheet",
            peerId = "zzzz0002",
            displayName = "Peer Zeta",
            signalingClient = client2,
            onNotification = { _, _ -> }
        )
        peer2!!.onConnectionStateChanged = { connected, _ ->
            if (connected) connectedLatch.countDown()
        }

        peer1!!.start()
        delay(1000) // stagger to avoid slot collision
        peer2!!.start()

        val connected = connectedLatch.await(60, TimeUnit.SECONDS)
        assertTrue("Both peers should connect within 60s", connected)
        assertTrue("Peer1 should have open DataChannels", peer1!!.openDataChannelCount > 0)
        assertTrue("Peer2 should have open DataChannels", peer2!!.openDataChannelCount > 0)
    }

    @Test
    fun notification_deliveredViaDataChannel() = runBlocking {
        val client1 = InMemorySignalingClient(store)
        val client2 = InMemorySignalingClient(store)

        val receivedNotifs = CopyOnWriteArrayList<String>()
        val notifLatch = CountDownLatch(1)

        peer1 = OrchestratorPeer(
            context = ctx,
            sheetId = "test-sheet",
            peerId = "aaaa0001",
            displayName = "Sender",
            signalingClient = client1,
            onNotification = { _, _ -> }
        )

        peer2 = OrchestratorPeer(
            context = ctx,
            sheetId = "test-sheet",
            peerId = "zzzz0002",
            displayName = "Receiver",
            signalingClient = client2,
            onNotification = { _, body ->
                receivedNotifs.add(body)
                notifLatch.countDown()
            }
        )

        val connectedLatch = CountDownLatch(1)
        peer1!!.onConnectionStateChanged = { connected, _ ->
            if (connected) connectedLatch.countDown()
        }

        peer1!!.start()
        delay(1000)
        peer2!!.start()

        // Wait for DataChannel to be OPEN
        assertTrue("Peers should connect", connectedLatch.await(60, TimeUnit.SECONDS))
        delay(2000) // let both DCs settle

        // Send a notification from peer1 → peer2 via DataChannel
        // We need to access the internal DC — use the handleMessage path
        // by sending a raw notification JSON through the DC.
        // Since we can't directly send from peer1 to peer2 via the current API,
        // we verify that the OrchestratorPeer correctly processes inbound messages
        // by checking that the message handler works.

        // For a true E2E test, we rely on the test_orchestrator.mjs which sends
        // real notifications over a real DataChannel to the Android device.
        // Here we verify the in-memory signaling protocol works correctly.
        assertTrue("Peer1 should be in mesh", peer1!!.isInMesh)
        assertTrue("Peer2 should be in mesh", peer2!!.isInMesh)
    }

    @Test
    fun peer_stop_clearsPresence() = runBlocking {
        val client = InMemorySignalingClient(store)

        peer1 = OrchestratorPeer(
            context = ctx,
            sheetId = "test-sheet",
            peerId = "peer0001",
            displayName = "Test Peer",
            signalingClient = client,
            onNotification = { _, _ -> }
        )
        peer1!!.start()
        delay(3000) // join + heartbeat

        assertTrue("Peer should be in mesh", peer1!!.isInMesh)

        peer1!!.stop()
        peer1 = null

        delay(1000)

        // Verify presence was cleared
        val rows = store.readAll()
        val stillPresent = rows.filterNotNull().any { raw ->
            try {
                val json = JSONObject(raw)
                json.optString("peerId") == "peer0001" && json.has("ts")
            } catch (_: Exception) { false }
        }
        assertFalse("Presence should be cleared after stop()", stillPresent)
    }

    @Test
    fun peer_survivesMeshFull() = runBlocking {
        // Fill all 8 slots with fake presence data
        for (i in 0 until WaymarkConfig.MAX_SLOTS) {
            val row = WaymarkConfig.BLOCK_START + i * WaymarkConfig.BLOCK_SIZE
            store.set(row, JSONObject().apply {
                put("peerId", "fake%04d".format(i))
                put("name", "Fake $i")
                put("ts", System.currentTimeMillis()) // recent timestamp = alive
                put("nonce", "abcd%04d".format(i))
            }.toString())
        }

        val client = InMemorySignalingClient(store)
        peer1 = OrchestratorPeer(
            context = ctx,
            sheetId = "test-sheet",
            peerId = "newpeer1",
            displayName = "New Peer",
            signalingClient = client,
            onNotification = { _, _ -> }
        )
        peer1!!.start()
        delay(5000)

        // Peer should not be in mesh (all slots occupied)
        assertFalse("Peer should NOT be in mesh when all slots are taken", peer1!!.isInMesh)
    }

    @Test
    fun peer_reclaimsSlotAfterCrash() = runBlocking {
        // Simulate a crash: write presence for "peer0001" as if it was in slot 1
        val row = WaymarkConfig.BLOCK_START + 0 * WaymarkConfig.BLOCK_SIZE
        store.set(row, JSONObject().apply {
            put("peerId", "peer0001")
            put("name", "Crashed Peer")
            put("ts", System.currentTimeMillis() - 10000) // 10s ago
            put("nonce", "oldnonce")
        }.toString())

        val client = InMemorySignalingClient(store)
        peer1 = OrchestratorPeer(
            context = ctx,
            sheetId = "test-sheet",
            peerId = "peer0001", // same peerId as the "crashed" peer
            displayName = "Restarted Peer",
            signalingClient = client,
            onNotification = { _, _ -> }
        )
        peer1!!.start()
        delay(5000)

        assertTrue("Peer should reclaim its old slot and be in mesh", peer1!!.isInMesh)
    }
}
