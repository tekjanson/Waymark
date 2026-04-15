/* ============================================================
   ISignalingClient.kt — Interface for WebRTC signaling I/O

   Decouples OrchestratorPeer from the concrete Google Sheets
   implementation so that:
     1. Unit tests can inject a fast in-memory stub
     2. E2E tests can inject a real-but-local signaling store
     3. Future transports (WebSocket, Firebase) can be swapped in
   ============================================================ */

package com.waymark.app

/**
 * Contract for reading and writing signaling data (presence, offers, answers)
 * used by [OrchestratorPeer] during the WebRTC session.
 *
 * Implementations must be safe to call from coroutines on [Dispatchers.IO].
 * All methods are suspend functions — blocking I/O must be wrapped internally.
 */
interface ISignalingClient {

    /**
     * Read the entire signaling column, returning a list of nullable strings
     * indexed by 0-based row number.  Empty rows appear as null.
     *
     * @throws java.io.IOException on network/API failure after all retries
     */
    suspend fun readAll(): List<String?>

    /**
     * Write [value] to the signaling column at [row] (0-based index).
     * Empty values clear the cell.
     *
     * @throws java.io.IOException on network/API failure after all retries
     */
    suspend fun writeCell(row: Int, value: String)

    /**
     * Clear the presence cell for [blockRow], signalling a graceful departure.
     * Best-effort — failures are swallowed.
     */
    suspend fun clearPresence(blockRow: Int)
}
