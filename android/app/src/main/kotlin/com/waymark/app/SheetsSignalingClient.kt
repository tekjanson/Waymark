/* ============================================================
   SheetsSignalingClient.kt — Google Sheets signaling (suspend)

   Concrete implementation of [ISignalingClient] that reads/writes
   the WebRTC signaling column (column T) via the Sheets REST v4 API.

   Replaces the old blocking SignalingClient with proper suspend
   functions using OkHttp async + kotlinx.coroutines integration.
   ============================================================ */

package com.waymark.app

import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Reads and writes the WebRTC signaling band (column T) of a Google Sheet
 * using the Sheets REST v4 API with AES-256-GCM transparent encryption.
 *
 * All public methods are suspend functions — they use OkHttp's async
 * [enqueue] internally so they never block a dispatcher thread during
 * backoff or network waits.
 *
 * @param sheetId   The Google Sheets spreadsheet ID
 * @param getToken  Lambda returning the current OAuth access token
 * @param getKey    Lambda returning the 64-char hex AES key, or null if not set
 */
class SheetsSignalingClient(
    private val sheetId: String,
    private val getToken: () -> String,
    private val getKey: () -> String? = { null }
) : ISignalingClient {

    override var decryptFailureCount: Int = 0
        private set

    override var decryptSuccessCount: Int = 0
        private set

    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

    // Total rows: 8 peers × 5 rows + BLOCK_START
    private val TOTAL_ROWS = WaymarkConfig.MAX_SLOTS * WaymarkConfig.BLOCK_SIZE + WaymarkConfig.BLOCK_START
    private val RANGE = "Sheet1!T1:T${TOTAL_ROWS + 1}"

    private companion object {
        const val MAX_RETRIES = 4
    }

    override suspend fun readAll(): List<String?> {
        val token = getToken().ifBlank { throw IOException("No access token") }
        val url = "${WaymarkConfig.SHEETS_BASE}/$sheetId/values/$RANGE"

        var lastErr: IOException? = null
        for (attempt in 0 until MAX_RETRIES) {
            if (attempt > 0) delay(2000L * attempt) // non-blocking unlike Thread.sleep

            val request = Request.Builder()
                .url(url)
                .addHeader("Authorization", "Bearer $token")
                .get()
                .build()

            val resp = try {
                http.awaitCall(request)
            } catch (e: IOException) {
                lastErr = e
                continue
            }

            if (resp.code == 429) {
                resp.close()
                lastErr = IOException("Sheets read 429")
                continue
            }

            val body = resp.use { r ->
                if (!r.isSuccessful) throw IOException("Sheets read ${r.code}")
                r.body?.string() ?: throw IOException("Empty Sheets response")
            }

            val root = JSONObject(body)
            val rows = root.optJSONArray("values") ?: JSONArray()
            val keyHex = getKey()

            val result = MutableList<String?>(TOTAL_ROWS + 2) { null }
            var failures = 0
            var successes = 0
            for (i in 0 until rows.length()) {
                val row = rows.getJSONArray(i)
                if (row.length() > 0) {
                    val raw = row.getString(0)
                    if (keyHex != null) {
                        val dec = SignalingEncryption.decrypt(raw, keyHex)
                        if (raw.startsWith(SignalingEncryption.ENCRYPT_PREFIX)) {
                            if (dec == null) failures++ else successes++
                        }
                        result[i + WaymarkConfig.BLOCK_START] = dec
                    } else {
                        result[i + WaymarkConfig.BLOCK_START] = raw
                    }
                }
            }
            decryptFailureCount = failures
            decryptSuccessCount = successes
            return result
        }
        throw lastErr ?: IOException("Sheets read failed after $MAX_RETRIES attempts")
    }

    override suspend fun writeCell(row: Int, value: String) {
        val token = getToken().ifBlank { throw IOException("No access token") }

        val keyHex = getKey()
        val cellValue = if (value.isNotEmpty() && keyHex != null) {
            SignalingEncryption.encrypt(value, keyHex)
        } else {
            value
        }

        val sheetsRow = row
        val range = "Sheet1!T$sheetsRow"
        val payload = JSONObject().apply {
            put("range", range)
            put("majorDimension", "ROWS")
            put("values", JSONArray().apply {
                put(JSONArray().apply { put(cellValue) })
            })
        }.toString()

        val url = "${WaymarkConfig.SHEETS_BASE}/$sheetId/values/$range?valueInputOption=RAW"

        var lastErr: IOException? = null
        for (attempt in 0 until MAX_RETRIES) {
            if (attempt > 0) delay(2000L * attempt)

            val request = Request.Builder()
                .url(url)
                .addHeader("Authorization", "Bearer $token")
                .put(payload.toRequestBody(JSON_MEDIA))
                .build()

            val resp = try {
                http.awaitCall(request)
            } catch (e: IOException) {
                lastErr = e
                continue
            }

            if (resp.code == 429) {
                resp.close()
                lastErr = IOException("Sheets write 429")
                continue
            }
            resp.use { r ->
                if (!r.isSuccessful) throw IOException("Sheets write ${r.code}")
            }
            return
        }
        throw lastErr ?: IOException("Sheets write failed after $MAX_RETRIES attempts")
    }

    override suspend fun clearPresence(blockRow: Int) {
        try {
            writeCell(blockRow + WaymarkConfig.OFF_PRESENCE, "")
        } catch (_: IOException) { /* best-effort */ }
    }
}

/**
 * OkHttp extension: execute a [Request] asynchronously and resume
 * the calling coroutine when the response arrives.
 *
 * Cancellation of the coroutine cancels the OkHttp call.
 */
private suspend fun OkHttpClient.awaitCall(request: Request): Response =
    suspendCancellableCoroutine { cont ->
        val call = newCall(request)
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (cont.isActive) cont.resumeWithException(e)
            }
            override fun onResponse(call: Call, response: Response) {
                if (cont.isActive) cont.resume(response)
            }
        })
    }
