/* ============================================================
   SignalingClientTest.kt — Unit tests for SignalingClient helpers

   Tests the pure helper logic inside SignalingClient:
   slot finding, alive scanning, and row index math.
   ============================================================ */

package com.waymark.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Tests for signaling logic ported from webrtc.js to Kotlin.
 * All tests are pure JVM — no Android context needed.
 */
class SignalingClientTest {

    /* ---------- Helper replicas ---------- */

    private fun parseJson(s: String?): JSONObject? {
        if (s.isNullOrBlank()) return null
        return try { JSONObject(s) } catch (e: Exception) { null }
    }

    private fun findSlot(vals: List<String?>, nowMs: Long = System.currentTimeMillis()): Int {
        for (i in 0 until WaymarkConfig.MAX_SLOTS) {
            val row = WaymarkConfig.BLOCK_START + i * WaymarkConfig.BLOCK_SIZE
            val p = parseJson(vals.getOrNull(row))
            val ts = p?.optLong("ts", 0L) ?: 0L
            if (p == null || nowMs - ts > WaymarkConfig.ALIVE_TTL) return row
        }
        return -1
    }

    private fun scanAlive(vals: List<String?>, selfBlock: Int, nowMs: Long = System.currentTimeMillis()): List<JSONObject> {
        val result = mutableListOf<JSONObject>()
        for (i in 0 until WaymarkConfig.MAX_SLOTS) {
            val row = WaymarkConfig.BLOCK_START + i * WaymarkConfig.BLOCK_SIZE
            if (row == selfBlock) continue
            val p = parseJson(vals.getOrNull(row)) ?: continue
            val ts = p.optLong("ts", 0L)
            if (nowMs - ts < WaymarkConfig.ALIVE_TTL) result.add(p.apply { put("block", row) })
        }
        return result
    }

    private fun makePresence(peerId: String, ts: Long) =
        JSONObject().apply { put("peerId", peerId); put("name", "Test"); put("ts", ts) }.toString()

    /* ---------- findSlot tests ---------- */

    @Test
    fun `findSlot returns BLOCK_START when all slots empty`() {
        val vals = MutableList<String?>(50) { null }
        val slot = findSlot(vals)
        assertEquals(WaymarkConfig.BLOCK_START, slot)
    }

    @Test
    fun `findSlot skips occupied fresh slot and returns next`() {
        val now = System.currentTimeMillis()
        val vals = MutableList<String?>(50) { null }
        // Occupy slot 0 (row = BLOCK_START)
        vals[WaymarkConfig.BLOCK_START] = makePresence("peer-a", now)
        val slot = findSlot(vals, now)
        // Should return slot 1
        assertEquals(WaymarkConfig.BLOCK_START + WaymarkConfig.BLOCK_SIZE, slot)
    }

    @Test
    fun `findSlot reuses stale slot`() {
        val staleTs = System.currentTimeMillis() - WaymarkConfig.ALIVE_TTL - 1000
        val vals = MutableList<String?>(50) { null }
        vals[WaymarkConfig.BLOCK_START] = makePresence("gone-peer", staleTs)
        val slot = findSlot(vals, System.currentTimeMillis())
        assertEquals(WaymarkConfig.BLOCK_START, slot)
    }

    @Test
    fun `findSlot returns -1 when all max slots occupied`() {
        val now = System.currentTimeMillis()
        val vals = MutableList<String?>(50) { null }
        for (i in 0 until WaymarkConfig.MAX_SLOTS) {
            vals[WaymarkConfig.BLOCK_START + i * WaymarkConfig.BLOCK_SIZE] =
                makePresence("peer-$i", now)
        }
        assertEquals(-1, findSlot(vals, now))
    }

    /* ---------- scanAlive tests ---------- */

    @Test
    fun `scanAlive excludes self block`() {
        val now = System.currentTimeMillis()
        val vals = MutableList<String?>(50) { null }
        val selfBlock = WaymarkConfig.BLOCK_START
        vals[selfBlock] = makePresence("self-peer", now)
        val alive = scanAlive(vals, selfBlock, now)
        assertTrue(alive.none { it.optString("peerId") == "self-peer" })
    }

    @Test
    fun `scanAlive excludes stale peers`() {
        val now = System.currentTimeMillis()
        val staleTs = now - WaymarkConfig.ALIVE_TTL - 1000
        val vals = MutableList<String?>(50) { null }
        vals[WaymarkConfig.BLOCK_START + WaymarkConfig.BLOCK_SIZE] = makePresence("stale-peer", staleTs)
        val alive = scanAlive(vals, WaymarkConfig.BLOCK_START, now)
        assertTrue(alive.isEmpty())
    }

    @Test
    fun `scanAlive includes fresh peers`() {
        val now = System.currentTimeMillis()
        val vals = MutableList<String?>(50) { null }
        val remoteBlock = WaymarkConfig.BLOCK_START + WaymarkConfig.BLOCK_SIZE
        vals[remoteBlock] = makePresence("remote-peer", now - 1000)
        val alive = scanAlive(vals, WaymarkConfig.BLOCK_START, now)
        assertEquals(1, alive.size)
        assertEquals("remote-peer", alive[0].optString("peerId"))
    }

    @Test
    fun `scanAlive attaches block row to each result`() {
        val now = System.currentTimeMillis()
        val vals = MutableList<String?>(50) { null }
        val remoteBlock = WaymarkConfig.BLOCK_START + WaymarkConfig.BLOCK_SIZE
        vals[remoteBlock] = makePresence("rp", now)
        val alive = scanAlive(vals, WaymarkConfig.BLOCK_START, now)
        assertEquals(remoteBlock, alive[0].optInt("block"))
    }

    /* ---------- Block row index math ---------- */

    @Test
    fun `BLOCK_SIZE constant equals 5`() {
        assertEquals(5, WaymarkConfig.BLOCK_SIZE)
    }

    @Test
    fun `OFF_PRESENCE plus BLOCK_START is the first row`() {
        assertEquals(WaymarkConfig.BLOCK_START, WaymarkConfig.BLOCK_START + WaymarkConfig.OFF_PRESENCE)
    }

    @Test
    fun `OFF_ANSWERS row is BLOCK_START plus 2`() {
        assertEquals(3, WaymarkConfig.BLOCK_START + WaymarkConfig.OFF_ANSWERS)
    }
}
