/* ============================================================
   ConnectionState.kt — Formal state machine for the P2P connection

   Replaces the ad-hoc combination of @Volatile flags (currentSheetId,
   isPhase1, peer, networkLost, keyTransitionInFlight) with a single
   sealed hierarchy protected by a Mutex in ConnectionManager.

   States:
     Idle          — Service running but not connected
     Connecting    — Drive lookup / sheet resolution in progress
     Phase1        — Key exchange on private sheet (plaintext, OAuth)
     Phase2        — Encrypted notifications on public sheet
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

    /** Actively resolving sheet IDs from Drive and deciding which phase to enter. */
    data object Connecting : ConnectionState()

    /** Phase 1 — connected to the PRIVATE sheet for AES key exchange.
     *  @param sheetId  The private signaling sheet ID
     *  @param peer     The active OrchestratorPeer on the private sheet */
    data class Phase1(
        val sheetId: String,
        val peer: OrchestratorPeer
    ) : ConnectionState()

    /** Phase 2 — connected to the PUBLIC sheet with AES-256-GCM encryption.
     *  @param sheetId  The public signaling sheet ID
     *  @param peer     The active OrchestratorPeer on the public sheet */
    data class Phase2(
        val sheetId: String,
        val peer: OrchestratorPeer
    ) : ConnectionState()

    /** Transitioning: old connection is being torn down before a fresh resolve. */
    data object Reconnecting : ConnectionState()

    /** Returns the active peer if in Phase1 or Phase2, null otherwise. */
    val activePeer: OrchestratorPeer?
        get() = when (this) {
            is Phase1 -> peer
            is Phase2 -> peer
            else -> null
        }

    /** Returns the current sheet ID if connected, null otherwise. */
    val activeSheetId: String?
        get() = when (this) {
            is Phase1 -> sheetId
            is Phase2 -> sheetId
            else -> null
        }

    /** True when the peer is on the private (plaintext) sheet for key exchange. */
    val isPhase1: Boolean get() = this is Phase1
}
