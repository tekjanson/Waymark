/* ============================================================
   InMemorySignalingClient.kt — Test double for ISignalingClient

   A fast, in-memory signaling store used by instrumented tests.
   Two InMemorySignalingClients sharing the same [SignalingStore]
   simulate two peers on the same sheet — zero network I/O.
   ============================================================ */

package com.waymark.app

import java.util.concurrent.ConcurrentHashMap

/**
 * Shared backing store visible to all [InMemorySignalingClient] instances.
 * Simulates the Google Sheet's signaling column in memory.
 */
class SignalingStore {
    private val cells = ConcurrentHashMap<Int, String>()
    private val totalRows = WaymarkConfig.MAX_SLOTS * WaymarkConfig.BLOCK_SIZE + WaymarkConfig.BLOCK_START + 2

    fun get(row: Int): String? = cells[row]

    fun set(row: Int, value: String) {
        if (value.isEmpty()) cells.remove(row) else cells[row] = value
    }

    fun readAll(): List<String?> {
        return MutableList(totalRows) { i -> cells[i] }
    }

    fun clear() = cells.clear()
}

/**
 * In-memory [ISignalingClient] backed by a [SignalingStore].
 * No encryption is applied — tests verify signaling protocol logic,
 * not the AES-256-GCM implementation (covered by unit tests).
 */
class InMemorySignalingClient(
    private val store: SignalingStore
) : ISignalingClient {

    override var decryptFailureCount: Int = 0
        private set
    override var decryptSuccessCount: Int = 0
        private set

    override suspend fun readAll(): List<String?> {
        decryptFailureCount = 0
        decryptSuccessCount = 0
        return store.readAll()
    }

    override suspend fun writeCell(row: Int, value: String) {
        store.set(row, value)
    }

    override suspend fun clearPresence(blockRow: Int) {
        store.set(blockRow + WaymarkConfig.OFF_PRESENCE, "")
    }
}
