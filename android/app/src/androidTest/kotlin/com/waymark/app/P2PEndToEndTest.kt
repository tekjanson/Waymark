/* ============================================================
   P2PEndToEndTest.kt — Full end-to-end notification test

   This test is designed to run together with the Node.js test
   orchestrator (test_orchestrator/test_orchestrator.mjs).

   The test:
     1. Starts the WebRtcService
     2. Waits for the test orchestrator to connect
     3. The test orchestrator sends test notifications
     4. Verifies that Android notifications appear in the system

   Prerequisites:
     - Device must have a valid OAuth token cached
     - test_orchestrator.mjs must be running with --mode=e2e
     - Device must have POST_NOTIFICATIONS permission granted

   For the in-process tests (no external orchestrator needed),
   see [OrchestratorPeerTest] and [NotificationDeliveryTest].
   ============================================================ */

package com.waymark.app

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Integration test that exercises the full notification pipeline
 * from P2P DataChannel message → NotificationHelper → system tray.
 *
 * Uses the in-memory signaling  client for the local peer + a
 * simulated remote peer (also in-memory) to send test notifications.
 */
@RunWith(AndroidJUnit4::class)
class P2PEndToEndTest {

    private lateinit var ctx: Context
    private lateinit var nm: NotificationManager
    private lateinit var store: SignalingStore
    private var localPeer: OrchestratorPeer? = null
    private var remotePeer: OrchestratorPeer? = null

    @Before
    fun setUp() {
        ctx = InstrumentationRegistry.getInstrumentation().targetContext
        NotificationHelper.createChannels(ctx)
        nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancelAll()
        store = SignalingStore()
    }

    @After
    fun tearDown() {
        localPeer?.stop()
        remotePeer?.stop()
        store.clear()
        nm.cancelAll()
    }

    /**
     * Full pipeline test:
     * remote peer → DataChannel → local peer → onNotification → NotificationHelper → system tray
     *
     * Uses two real OrchestratorPeers with in-memory signaling to establish
     * a real WebRTC DataChannel, then sends a notification message through it.
     */
    @Test
    fun notificationFlowsThroughEntirePipeline() = runBlocking {
        val notificationReceived = CountDownLatch(1)
        var receivedBody = ""

        val localClient = InMemorySignalingClient(store)
        val remoteClient = InMemorySignalingClient(store)

        // "Remote" peer — simulates the orchestrator
        remotePeer = OrchestratorPeer(
            context = ctx,
            sheetId = "e2e-test",
            peerId = "aaaa0001",  // lower ID → will be the initiator
            displayName = "Remote Orchestrator",
            signalingClient = remoteClient,
            onNotification = { _, _ -> }
        )

        // "Local" peer — simulates the Android device
        localPeer = OrchestratorPeer(
            context = ctx,
            sheetId = "e2e-test",
            peerId = "zzzz0002",  // higher ID → will wait for offers
            displayName = "Local Android",
            signalingClient = localClient,
            onNotification = { title, body ->
                receivedBody = body
                NotificationHelper.showMessage(ctx, title, body)
                notificationReceived.countDown()
            }
        )

        val dcOpen = CountDownLatch(1)
        remotePeer!!.onConnectionStateChanged = { connected, _ ->
            if (connected) dcOpen.countDown()
        }

        remotePeer!!.start()
        delay(1500) // let remote join first
        localPeer!!.start()

        // Wait for DataChannel to open between the two peers
        assertTrue(
            "DataChannel should open within 60s",
            dcOpen.await(60, TimeUnit.SECONDS)
        )

        // Give DCs a moment to stabilize
        delay(3000)

        // Now comes the tricky part: we need the remote peer to send a notification
        // message through the DataChannel. OrchestratorPeer doesn't expose a "send"
        // API (messages come from the orchestrator), so we access the DC directly
        // through the peers map. In production, the orchestrator uses broadcast().
        // For this test, we simulate it by accessing the internal data channel.

        // We'll verify the pipeline by checking that the local peer's onNotification
        // callback fires AND that a system notification is posted.

        // Send a waymark-notification from remote → local via DataChannel
        val testNonce = java.security.SecureRandom().let {
            val b = ByteArray(4); it.nextBytes(b)
            b.joinToString("") { "%02x".format(it) }
        }
        val notifJson = """{"type":"waymark-notification","title":"E2E Test","body":"Pipeline test [$testNonce]"}"""

        // Access remote peer's internal DC to local peer
        val sentOk = sendViaDataChannel(remotePeer!!, "zzzz0002", notifJson)
        assertTrue("Should be able to send via DataChannel", sentOk)

        // Wait for the notification to arrive
        assertTrue(
            "Notification should be received within 10s",
            notificationReceived.await(10, TimeUnit.SECONDS)
        )

        assertEquals("Pipeline test [$testNonce]", receivedBody)

        // Verify it's in the system notification tray
        delay(1000)
        val active = nm.activeNotifications
        val inTray = active.any { sbn ->
            val text = sbn.notification.extras.getCharSequence("android.text")?.toString() ?: ""
            text.contains(testNonce)
        }
        assertTrue(
            "Notification should appear in system tray. Active: ${active.size}",
            inTray
        )
    }

    @Test
    fun keyExchange_receivedViaDataChannel() = runBlocking {
        val keyReceived = CountDownLatch(1)
        var receivedKey = ""

        val localClient = InMemorySignalingClient(store)
        val remoteClient = InMemorySignalingClient(store)

        remotePeer = OrchestratorPeer(
            context = ctx,
            sheetId = "key-test",
            peerId = "aaaa0001",
            displayName = "Key Provider",
            signalingClient = remoteClient,
            onNotification = { _, _ -> }
        )

        localPeer = OrchestratorPeer(
            context = ctx,
            sheetId = "key-test",
            peerId = "zzzz0002",
            displayName = "Key Receiver",
            signalingClient = localClient,
            onNotification = { _, _ -> }
        )

        localPeer!!.onKeyReceived = { keyHex ->
            receivedKey = keyHex
            keyReceived.countDown()
        }

        val dcOpen = CountDownLatch(1)
        remotePeer!!.onConnectionStateChanged = { connected, _ ->
            if (connected) dcOpen.countDown()
        }

        remotePeer!!.start()
        delay(1500)
        localPeer!!.start()

        assertTrue("DataChannel should open", dcOpen.await(60, TimeUnit.SECONDS))
        delay(2000)

        // Send key exchange
        val testKey = SignalingEncryption.generateKeyHex()
        val keyExchangeJson = """{"type":"waymark-key-exchange","key":"$testKey"}"""
        sendViaDataChannel(remotePeer!!, "zzzz0002", keyExchangeJson)

        assertTrue("Key should be received within 10s", keyReceived.await(10, TimeUnit.SECONDS))
        assertEquals(testKey, receivedKey)
    }

    /**
     * Sends a message through an OrchestratorPeer's DataChannel to a specific remote.
     * Uses reflection to access the internal peers map — this is a test-only utility.
     */
    private fun sendViaDataChannel(peer: OrchestratorPeer, targetPeerId: String, json: String): Boolean {
        return try {
            val peersField = OrchestratorPeer::class.java.getDeclaredField("peers")
            peersField.isAccessible = true
            @Suppress("UNCHECKED_CAST")
            val peersMap = peersField.get(peer) as java.util.concurrent.ConcurrentHashMap<String, Any>
            val entry = peersMap[targetPeerId] ?: return false

            val dcField = entry::class.java.getDeclaredField("dc")
            dcField.isAccessible = true
            val dc = dcField.get(entry) as? org.webrtc.DataChannel ?: return false

            if (dc.state() != org.webrtc.DataChannel.State.OPEN) return false

            val bytes = json.toByteArray(Charsets.UTF_8)
            dc.send(org.webrtc.DataChannel.Buffer(java.nio.ByteBuffer.wrap(bytes), false))
            true
        } catch (e: Exception) {
            false
        }
    }
}
