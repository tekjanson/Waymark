/* ============================================================
   ConnectionState.kt — Formal state machine for the P2P connection

   Replaces the ad-hoc combination of @Volatile flags with a single
   sealed hierarchy protected by a Mutex in ConnectionManager.

   States:
     Idle          — Service running but not connected
     Connecting    — Drive lookup / sheet resolution in progress
     Connected     — Signaling on the OAuth-protected sheet
     Reconnecting  — Tearing down → resolving → reconnecting
   ============================================================ */

package com.waymark.app

/**
 * Exhaustive states for the Waymark P2P connection lifecycle.
 * Only [ConnectionManager] should create or transition between these.
 */
sealed class ConnectionState {

    /** Service is alive but no connection attempt has been made or the peer was stopped. */
    data object Idle : ConnectionState()

    /** Actively resolving sheet IDs from Drive and deciding whether to connect. */
    data object Connecting : ConnectionState()

    /** Connected to the signaling sheet (OAuth-protected).
     *  @param sheetId  The signaling sheet ID
     *  @param peer     The active OrchestratorPeer */
    data class Connected(
        val sheetId: String,
        val peer: OrchestratorPeer
    ) : ConnectionState()

    /** Transitioning: old connection is being torn down before a fresh resolve. */
    data object Reconnecting : ConnectionState()

    /** Returns the active peer if connected, null otherwise. */
    val activePeer: OrchestratorPeer?
        get() = when (this) {
            is Connected -> peer
            else -> null
        }

    /** Returns the current sheet ID if connected, null otherwise. */
    val activeSheetId: String?
        get() = when (this) {
            is Connected -> sheetId
            else -> null
        }
}
