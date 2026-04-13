/* ============================================================
   SignalingClient.kt — Google Sheets WebRTC signaling (encrypted)

   Replicates the row-based signaling protocol from webrtc.js.
   Each peer claims a 5-row block in signaling column 20.  Peers
   write their PRESENCE, OFFERS, and ANSWERS into their own block
   and read peer blocks to drive ICE negotiation.

   Block layout (per peer):
     Block+0  PRESENCE  { peerId, name, ts }
     Block+1  OFFERS    { targetPeerId: { sdp, ts }, ... }
     Block+2  ANSWERS   { toPeerId: { sdp, ts }, ... }

   All cell values written to the PUBLIC signaling sheet are
   AES-256-GCM encrypted using the key from [getKey].  Cells
   read from the sheet are decrypted transparently.  Cells that
   do not carry the encryption prefix are passed through as-is
   (backward compatibility during key provisioning).

   The client is stateless between polls; all data is fetched
   fresh on each poll cycle. Writes are single-cell updates.
   ============================================================ */

package com.waymark.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Reads and writes to the WebRTC signaling band (column 20) of the
 * PUBLIC Google Sheet using the Sheets REST v4 API.
 *
 * Cell values are AES-256-GCM encrypted/decrypted transparently using
 * the key supplied by [getKey].  When [getKey] returns null the client
 * falls back to writing plaintext (key not yet provisioned).
 *
 * @param sheetId   The public Google Sheets spreadsheet ID
 * @param getToken  Lambda returning the current OAuth access token (for Sheets API auth)
 * @param getKey    Lambda returning the 64-char hex AES-256 signal key, or null if not set
 */
class SignalingClient(
    private val sheetId: String,
    private val getToken: () -> String,
    private val getKey: () -> String? = { null }
) {

    /* ---------- HTTP client ---------- */

    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

    /* ---------- Constants ---------- */

    // Total rows to fetch: 8 peers × 5 rows = 40
    private val TOTAL_ROWS = WaymarkConfig.MAX_SLOTS * WaymarkConfig.BLOCK_SIZE + WaymarkConfig.BLOCK_START

    // Sheets range: signal column rows 1-41 (1-based in the API)
    private val RANGE = "Sheet1!T1:T${TOTAL_ROWS + 1}"

    /* ---------- Public API ---------- */

    /**
     * Reads the entire signaling column and returns it as a list
     * of nullable string values, indexed by 0-based row number.
     * Rows that are empty in the sheet appear as null.
     * Values are AES-256-GCM decrypted if a key is available.
     *
     * @throws IOException if the Sheets request fails
     */
    fun readAll(): List<String?> {
        val token = getToken().ifBlank { throw IOException("No access token") }
        val url = "${WaymarkConfig.SHEETS_BASE}/$sheetId/values/${RANGE}"

        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $token")
            .get()
            .build()

        val body = http.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("Sheets read ${resp.code}")
            resp.body?.string() ?: throw IOException("Empty Sheets response")
        }

        val root = JSONObject(body)
        val rows = root.optJSONArray("values") ?: JSONArray()
        val keyHex = getKey()

        // Pad the list to TOTAL_ROWS so callers can index safely
        val result = MutableList<String?>(TOTAL_ROWS + 2) { null }
        for (i in 0 until rows.length()) {
            val row = rows.getJSONArray(i)
            if (row.length() > 0) {
                val raw = row.getString(0)
                result[i + WaymarkConfig.BLOCK_START] = if (keyHex != null) {
                    SignalingEncryption.decrypt(raw, keyHex)
                } else {
                    raw
                }
            }
        }
        return result
    }

    /**
     * Writes [value] to the signaling column at [row] (0-based index).
     * An empty [value] clears the cell (never encrypted).
     * Non-empty values are AES-256-GCM encrypted if a key is available.
     *
     * @throws IOException if the Sheets request fails
     */
    fun writeCell(row: Int, value: String) {
        val token = getToken().ifBlank { throw IOException("No access token") }

        // Encrypt non-empty values when a key is available
        val keyHex = getKey()
        val cellValue = if (value.isNotEmpty() && keyHex != null) {
            SignalingEncryption.encrypt(value, keyHex)
        } else {
            value
        }

        // Row indices are already 1-based (BLOCK_START=1)
        val sheetsRow = row
        val range = "Sheet1!T$sheetsRow"

        val payload = JSONObject().apply {
            put("range", range)
            put("majorDimension", "ROWS")
            put("values", JSONArray().apply {
                put(JSONArray().apply { put(cellValue) })
            })
        }.toString()

        val url = "${WaymarkConfig.SHEETS_BASE}/$sheetId/values/${range}?valueInputOption=RAW"
        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $token")
            .put(payload.toRequestBody(JSON_MEDIA))
            .build()

        http.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("Sheets write ${resp.code}")
        }
    }

    /**
     * Clears the presence cell for [blockRow], signalling that this peer
     * has left the mesh gracefully.
     */
    fun clearPresence(blockRow: Int) {
        try {
            writeCell(blockRow + WaymarkConfig.OFF_PRESENCE, "")
        } catch (ignored: IOException) { /* best-effort on cleanup */ }
    }
}
