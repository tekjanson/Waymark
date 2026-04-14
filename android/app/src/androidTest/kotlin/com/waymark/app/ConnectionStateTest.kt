/* ============================================================
   ConnectionStateTest.kt — Tests for the ConnectionState
   sealed class to verify state machine transitions.
   ============================================================ */

package com.waymark.app

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ConnectionStateTest {

    @Test
    fun idle_hasNoActivePeer() {
        val state = ConnectionState.Idle
        assertNull(state.activePeer)
        assertNull(state.activeSheetId)
        assertFalse(state.isPhase1)
    }

    @Test
    fun connecting_hasNoActivePeer() {
        val state = ConnectionState.Connecting
        assertNull(state.activePeer)
        assertNull(state.activeSheetId)
        assertFalse(state.isPhase1)
    }

    @Test
    fun phase1_hasActivePeer() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val store = SignalingStore()
        val client = InMemorySignalingClient(store)
        val peer = OrchestratorPeer(
            context = ctx,
            sheetId = "test",
            peerId = "aaaa0001",
            displayName = "Test",
            signalingClient = client,
            onNotification = { _, _ -> }
        )

        val state = ConnectionState.Phase1("test-sheet-id", peer)
        assertSame(peer, state.activePeer)
        assertEquals("test-sheet-id", state.activeSheetId)
        assertTrue(state.isPhase1)

        peer.stop()
    }

    @Test
    fun phase2_hasActivePeer() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val store = SignalingStore()
        val client = InMemorySignalingClient(store)
        val peer = OrchestratorPeer(
            context = ctx,
            sheetId = "test",
            peerId = "aaaa0001",
            displayName = "Test",
            signalingClient = client,
            onNotification = { _, _ -> }
        )

        val state = ConnectionState.Phase2("public-sheet-id", peer)
        assertSame(peer, state.activePeer)
        assertEquals("public-sheet-id", state.activeSheetId)
        assertFalse(state.isPhase1)

        peer.stop()
    }

    @Test
    fun reconnecting_hasNoActivePeer() {
        val state = ConnectionState.Reconnecting
        assertNull(state.activePeer)
        assertNull(state.activeSheetId)
        assertFalse(state.isPhase1)
    }
}
