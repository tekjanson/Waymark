/* ============================================================
   WaymarkBridgeTest.kt — Unit tests for WaymarkBridge

   Tests the JavascriptInterface parsing and filtering logic
   without requiring an Android runtime (pure JVM).
   ============================================================ */

package com.waymark.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * Pure logic tests covering the message-type filtering applied
 * in WaymarkBridge.onPeerMessage() before raising a notification.
 */
class WaymarkBridgeTest {

    /* ---------- Helper: replicate the onPeerMessage parsing ---------- */

    private data class ParseResult(val raised: Boolean, val title: String, val body: String)

    private fun parseMessage(json: String): ParseResult {
        if (json.isBlank()) return ParseResult(false, "", "")
        return try {
            val obj = JSONObject(json)
            val type = obj.optString("type")
            if (type == "waymark-notification" || type == "orchestrator-alert") {
                val title = obj.optString("title", "Waymark")
                val body  = obj.optString("body", obj.optString("message", ""))
                ParseResult(body.isNotBlank(), title, body)
            } else {
                ParseResult(false, "", "")
            }
        } catch (e: Exception) {
            ParseResult(false, "", "")
        }
    }

    /* ---------- Tests ---------- */

    @Test
    fun `waymark-notification type raises notification`() {
        val json = """{"type":"waymark-notification","title":"Test","body":"Hello"}"""
        val result = parseMessage(json)
        assertTrue(result.raised)
        assertEquals("Test", result.title)
        assertEquals("Hello", result.body)
    }

    @Test
    fun `orchestrator-alert type raises notification`() {
        val json = """{"type":"orchestrator-alert","title":"Alert","body":"Task done"}"""
        val result = parseMessage(json)
        assertTrue(result.raised)
        assertEquals("Alert", result.title)
        assertEquals("Task done", result.body)
    }

    @Test
    fun `chat message type does not raise notification`() {
        val json = """{"type":"chat","peerId":"abc12345","text":"Hey there"}"""
        val result = parseMessage(json)
        assertFalse(result.raised)
    }

    @Test
    fun `call-start type does not raise notification`() {
        val json = """{"type":"call-start","peerId":"abc12345"}"""
        val result = parseMessage(json)
        assertFalse(result.raised)
    }

    @Test
    fun `message field used as fallback when body is absent`() {
        val json = """{"type":"waymark-notification","title":"Waymark","message":"Fallback body"}"""
        val result = parseMessage(json)
        assertTrue(result.raised)
        assertEquals("Fallback body", result.body)
    }

    @Test
    fun `empty body does not raise notification`() {
        val json = """{"type":"waymark-notification","title":"Title","body":""}"""
        val result = parseMessage(json)
        assertFalse(result.raised)
    }

    @Test
    fun `blank json string does not raise notification`() {
        val result = parseMessage("   ")
        assertFalse(result.raised)
    }

    @Test
    fun `malformed json does not raise notification`() {
        val result = parseMessage("{not valid json}")
        assertFalse(result.raised)
    }

    @Test
    fun `default title is Waymark when title absent`() {
        val json = """{"type":"waymark-notification","body":"Something happened"}"""
        val result = parseMessage(json)
        assertTrue(result.raised)
        assertEquals("Waymark", result.title)
    }
}
