/* ============================================================
   WebRtcService.kt — Foreground service for background WebRTC

   Keeps the OrchestratorPeer alive when the user switches away
   from the app so notifications can still arrive via the P2P mesh.

   Two-tier token strategy
   -----------------------
   Tier 1 (primary): Use cached OAuth access token from SharedPreferences.
     Works for ~55 minutes after the WebView last refreshed it.

   Tier 2 (silent refresh): When Tier 1 is stale (or approaching expiry),
     TokenRefresher reads the waymark_refresh cookie from the WebView's
     CookieManager and POSTs it to the server's /auth/refresh endpoint.
     This keeps the background service connected indefinitely without
     requiring the user to reopen the app.

   Actions:
     ACTION_CONNECT       — Start or switch to a new sheetId
     ACTION_UPDATE_TOKEN  — Refresh the access token in-place
     ACTION_STOP          — Disconnect and stop the service
   ============================================================ */

package com.waymark.app

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.lifecycle.LifecycleService
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.io.IOException
import java.security.SecureRandom

private const val TAG = "WebRtcService"

class WebRtcService : LifecycleService() {

    /* ---------- Intent actions ---------- */

    companion object {
        const val ACTION_CONNECT      = "com.waymark.app.action.CONNECT"
        const val ACTION_UPDATE_TOKEN = "com.waymark.app.action.UPDATE_TOKEN"
        const val ACTION_STOP         = "com.waymark.app.action.STOP"

        const val EXTRA_SHEET_ID = "sheet_id"
        const val EXTRA_TOKEN    = "token"
    }

    /* ---------- State ---------- */

    @Volatile private var currentSheetId: String? = null
    @Volatile private var peer: OrchestratorPeer? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /** Tier 2: silent token refresh using the WebView's refresh cookie. */
    private val tokenRefresher by lazy { TokenRefresher(applicationContext) }

    /* ---------- Lifecycle ---------- */

    override fun onCreate() {
        super.onCreate()
        startForeground(
            NotificationHelper.NOTIFICATION_ID_SERVICE,
            NotificationHelper.buildServiceNotification(this)
        )
        Log.i(TAG, "Service created")

        // Attempt to connect immediately.  ensureFreshToken() implements the
        // two-tier strategy: Tier 1 uses the cached access token; if stale,
        // Tier 2 silently refreshes via the WebView's refresh cookie.
        scope.launch { resolveAndConnect() }

        // Periodic preemptive Tier 2 refresh — runs before the token expires
        // so signaling is never interrupted by a mid-cycle 401.
        // Calculate the initial delay from the current token age so that if the
        // service starts with a token that is already 45 min old, the first
        // preemptive refresh fires in ~5 min rather than ~50 min.
        scope.launch {
            val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
            val tokenAge = System.currentTimeMillis() -
                    prefs.getLong(WaymarkConfig.PREF_ACCESS_TOKEN_SET_MS, 0L)
            val preemptThreshold = WaymarkConfig.ACCESS_TOKEN_TTL_MS - WaymarkConfig.ACCESS_TOKEN_PREEMPT_MS
            val initialDelay = maxOf(0L, preemptThreshold - tokenAge)
            Log.d(TAG, "Preemptive refresh loop starts in ${initialDelay / 1000}s")
            delay(initialDelay)
            while (true) {
                Log.d(TAG, "Preemptive token refresh cycle")
                val freshToken = tokenRefresher.refresh()
                if (freshToken != null) {
                    Log.i(TAG, "Preemptive refresh succeeded — signaling uninterrupted")
                } else {
                    Log.d(TAG, "Preemptive refresh unavailable — waiting for WebView auth")
                }
                delay(WaymarkConfig.ACCESS_TOKEN_TTL_MS - WaymarkConfig.ACCESS_TOKEN_PREEMPT_MS)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)

        when (intent?.action) {
            ACTION_CONNECT -> {
                val sheetId = intent.getStringExtra(EXTRA_SHEET_ID) ?: return START_STICKY
                connectToSheet(sheetId)
            }
            ACTION_UPDATE_TOKEN -> {
                Log.d(TAG, "Token updated")
                val cachedSheet = currentSheetId
                val livePeer    = peer
                when {
                    cachedSheet != null && (livePeer == null || livePeer.destroyed) -> {
                        // Peer died — restart with the fresh token
                        Log.i(TAG, "Peer was dead — restarting with fresh token")
                        currentSheetId = null
                        connectToSheet(cachedSheet)
                    }
                    cachedSheet != null && livePeer != null && !livePeer.isInMesh -> {
                        // Peer is alive but never joined the mesh — likely stuck in a retry
                        // backoff because the previous token was expired.  Reconnect now.
                        Log.i(TAG, "Peer not in mesh — reconnecting immediately with fresh token")
                        currentSheetId = null
                        connectToSheet(cachedSheet)
                    }
                    else -> scope.launch { resolveAndConnect() }
                }
            }
            ACTION_STOP -> {
                disconnectPeer()
                stopSelf()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        disconnectPeer()
        scope.cancel()
        Log.i(TAG, "Service destroyed")
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    /* ---------- Auto-discovery ---------- */

    /**
     * Resolves the signaling sheet ID with no manual configuration.
     * Implements the two-tier token strategy before attempting Drive discovery:
     *
     *  Tier 1: Use the cached access token if it is still within its TTL.
     *  Tier 2: If stale, attempt a silent refresh via [TokenRefresher] before
     *          giving up — this keeps the service connected without the
     *          user having to reopen the app.
     *
     * Discovery order:
     * 1. Returns immediately if already connected.
     * 2. Reads the cached sheet ID from SharedPreferences.
     * 3. Ensures a valid token (Tier 1 → Tier 2 fallback).
     * 4. Reads .waymark-data.json from the user's Google Drive.
     */
    private suspend fun resolveAndConnect() = withContext(Dispatchers.IO) {
        if (currentSheetId != null) return@withContext

        val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)

        // 1. Cached sheet ID from a previous session
        val cached = prefs.getString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, "") ?: ""
        if (cached.isNotBlank()) {
            Log.i(TAG, "Signaling sheet from cache: $cached")
            // Still need a valid token even for the cached sheet path
            val token = ensureFreshToken(prefs)
            if (token.isNotBlank()) {
                connectToSheet(cached)
            }
            return@withContext
        }

        // 2. Ensure we have a valid access token (Tier 1 / Tier 2 strategy)
        val token = ensureFreshToken(prefs)
        if (token.isBlank()) {
            Log.d(TAG, "No valid token available — will retry after next auth event")
            return@withContext
        }

        // 3. Read .waymark-data.json directly from the user's Drive.
        //    The web app creates this file on first boot (user-data.js) and
        //    writes signalingSheetId into it.  The server is never involved.
        try {
            val sheetId = fetchSignalingSheetIdFromDrive(token)
            if (sheetId.isNotBlank()) {
                Log.i(TAG, "Signaling sheet discovered from Drive: $sheetId")
                prefs.edit().putString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, sheetId).apply()
                connectToSheet(sheetId)
            } else {
                Log.d(TAG, "signalingSheetId not set yet — user may not have opened the web app")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Signaling sheet Drive discovery failed: ${e.message}")
        }
    }

    /**
     * Returns a valid OAuth access token using the two-tier strategy:
     *
     *  Tier 1 (primary): Return the cached token if it is fresh enough
     *    (age < ACCESS_TOKEN_TTL_MS - ACCESS_TOKEN_PREEMPT_MS).
     *
     *  Tier 2 (silent refresh): If the cached token is stale or approaching
     *    expiry, ask [TokenRefresher] to silently obtain a new one using the
     *    `waymark_refresh` cookie stored in the WebView's CookieManager.
     *
     * Returns an empty string if both tiers fail (no cookie, server unreachable).
     */
    private suspend fun ensureFreshToken(prefs: android.content.SharedPreferences): String {
        val cachedToken = prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: ""

        // Tier 1: cached token is fresh — use it directly
        if (cachedToken.isNotBlank() && !tokenRefresher.isRefreshNeeded()) {
            return cachedToken
        }

        // Tier 2: token is stale or missing — attempt silent refresh
        if (cachedToken.isBlank()) {
            Log.d(TAG, "Tier 1 unavailable (no cached token) — attempting Tier 2 silent refresh")
        } else {
            val age = System.currentTimeMillis() - prefs.getLong(WaymarkConfig.PREF_ACCESS_TOKEN_SET_MS, 0L)
            Log.d(TAG, "Tier 1 token stale (${age / 1000}s old) — attempting Tier 2 silent refresh")
        }

        val freshToken = tokenRefresher.refresh()
        if (freshToken != null) {
            Log.i(TAG, "Tier 2 silent refresh succeeded")
            return freshToken
        }

        // Both tiers failed — return whatever we have (may be stale; caller will handle 401)
        Log.d(TAG, "Tier 2 unavailable — proceeding with cached token if present")
        return cachedToken
    }

    /**
     * Reads .waymark-data.json from the user's Google Drive and returns the
     * signalingSheetId field written there by the web app's user-data.js.
     * All Drive access uses the user's own OAuth token — no server proxy.
     */
    private fun fetchSignalingSheetIdFromDrive(token: String): String {
        val drive = WaymarkConfig.DRIVE_BASE

        // Search for .waymark-data.json by name
        val q = "name='.waymark-data.json' and mimeType='application/json' and trashed=false"
        val searchUrl = URL("$drive/files?q=${java.net.URLEncoder.encode(q, "UTF-8")}&fields=files(id)&pageSize=1&spaces=drive")
        val searchConn = searchUrl.openConnection() as HttpURLConnection
        searchConn.setRequestProperty("Authorization", "Bearer $token")
        searchConn.connectTimeout = 10_000
        searchConn.readTimeout = 10_000
        if (searchConn.responseCode != 200) {
            searchConn.disconnect()
            throw IOException("Drive search returned ${searchConn.responseCode}")
        }
        val searchBody = searchConn.inputStream.bufferedReader().readText()
        searchConn.disconnect()

        val files = JSONObject(searchBody).optJSONArray("files") ?: return ""
        if (files.length() == 0) return ""
        val fileId = files.getJSONObject(0).optString("id", "").ifBlank { return "" }

        // Download the file content
        val dlUrl = URL("$drive/files/$fileId?alt=media")
        val dlConn = dlUrl.openConnection() as HttpURLConnection
        dlConn.setRequestProperty("Authorization", "Bearer $token")
        dlConn.connectTimeout = 10_000
        dlConn.readTimeout = 15_000
        if (dlConn.responseCode != 200) {
            dlConn.disconnect()
            throw IOException("Drive download returned ${dlConn.responseCode}")
        }
        val content = dlConn.inputStream.bufferedReader().readText()
        dlConn.disconnect()

        return JSONObject(content).optString("signalingSheetId", "")
    }

    /* ---------- Sheet connection ---------- */

    private fun connectToSheet(sheetId: String) {
        if (sheetId == currentSheetId) return
        Log.i(TAG, "Connecting to sheet $sheetId")

        disconnectPeer()
        currentSheetId = sheetId

        val signalingClient = SignalingClient(sheetId) {
            getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
                .getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: ""
        }

        val displayName = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(WaymarkConfig.PREF_DISPLAY_NAME, "Waymark Android") ?: "Waymark Android"

        val newPeer = OrchestratorPeer(
            context       = applicationContext,
            sheetId       = sheetId,
            peerId        = getOrCreatePeerId(),
            displayName   = displayName,
            signalingClient = signalingClient,
            onNotification = { title, body ->
                NotificationHelper.showMessage(applicationContext, title, body)
            }
        )

        newPeer.onConnectionStateChanged = { connected, count ->
            startForeground(
                NotificationHelper.NOTIFICATION_ID_SERVICE,
                NotificationHelper.buildServiceNotification(applicationContext, connected, count)
            )
        }

        peer = newPeer
        newPeer.start()
    }

    /* ---------- Disconnect ---------- */

    private fun disconnectPeer() {
        peer?.stop()
        peer = null
        currentSheetId = null
        startForeground(
            NotificationHelper.NOTIFICATION_ID_SERVICE,
            NotificationHelper.buildServiceNotification(this, false, 0)
        )
    }

    /* ---------- Helpers ---------- */

    /**
     * Returns the stable 8-char hex peer ID for this device.
     * Generated with SecureRandom on first call and stored in SharedPreferences forever.
     * A stable ID means remote peers (Node.js workers, other Android devices) can
     * reconnect without re-doing the full ICE handshake each time the service restarts.
     */
    private fun getOrCreatePeerId(): String {
        val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
        val stored = prefs.getString(WaymarkConfig.PREF_PEER_ID, null)
        if (!stored.isNullOrBlank()) return stored
        val bytes = ByteArray(4)
        SecureRandom().nextBytes(bytes)
        val newId = bytes.joinToString("") { "%02x".format(it) }
        prefs.edit().putString(WaymarkConfig.PREF_PEER_ID, newId).apply()
        Log.i(TAG, "Generated permanent peerId: $newId")
        return newId
    }
}
