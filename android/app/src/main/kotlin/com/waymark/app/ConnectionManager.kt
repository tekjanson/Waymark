/* ============================================================
   ConnectionManager.kt — Centralized P2P connection lifecycle

   Replaces the fragmented connection logic scattered across
   WebRtcService's 11 resolveAndConnect() call sites with a
   single Mutex-protected state machine.

   Key guarantees:
     • Only ONE connection attempt runs at a time (Mutex)
     • Reconnect triggers are debounced (1 s)
     • State transitions are atomic and logged
     • Callback-initiated disconnects are safe (posted to
       the manager's scope, not the peer's scope)
     • The old peer's clearPresence completes BEFORE a new
       peer claims the same slot
   ============================================================ */

package com.waymark.app

import android.content.Context
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom

private const val TAG = "ConnectionManager"

/** Google's OAuth2 token endpoint for refresh_token exchange. */
private const val OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"

/** Refresh the access token if it's within this many ms of expiry. */
private const val TOKEN_REFRESH_MARGIN_MS = 5 * 60_000L  // 5 minutes before expiry

/**
 * Manages the Waymark P2P connection lifecycle on behalf of [WebRtcService].
 *
 * Single-sheet architecture: all signaling happens on one OAuth-protected
 * Google Sheet discovered from `.waymark-data.json` on Drive.
 *
 * Thread-safe: all state transitions go through [mutex]. External callers
 * use [requestConnect] which debounces rapid-fire triggers.
 *
 * @param appContext     Application context for SharedPreferences, PeerConnectionFactory
 * @param scope          CoroutineScope tied to the service's lifetime
 * @param onStateChange  Fires whenever the formal [ConnectionState] changes
 */
class ConnectionManager(
    private val appContext: Context,
    private val scope: CoroutineScope,
    private val onStateChange: (ConnectionState) -> Unit
) {

    /* ---------- State ---------- */

    private val mutex = Mutex()

    @Volatile
    var state: ConnectionState = ConnectionState.Idle
        private set

    /** Current debounced connect job — cancelled when a newer request arrives. */
    private var connectJob: Job? = null

    private val prefs get() = appContext.getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)

    /* ---------- Token management ---------- */

    /**
     * Returns the current access token, refreshing it first if it's near-expiry
     * and stored refresh credentials are available.
     *
     * Called by [SheetsSignalingClient] on every API request via the getToken lambda.
     */
    private fun getTokenWithRefresh(): String {
        val p = prefs
        val token = p.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: ""
        val expiryMs = p.getLong(WaymarkConfig.PREF_TOKEN_EXPIRY_MS, 0L)

        // Proactive refresh: if we know the expiry time and we're within the margin, refresh now
        if (expiryMs > 0 && System.currentTimeMillis() > expiryMs - TOKEN_REFRESH_MARGIN_MS) {
            val refreshed = refreshTokenNatively()
            if (refreshed != null) return refreshed
        }

        // Fallback: if no expiry stored, use the set-time heuristic (tokens live ~60 min)
        if (expiryMs == 0L && token.isNotBlank()) {
            val setMs = p.getLong(WaymarkConfig.PREF_ACCESS_TOKEN_SET_MS, 0L)
            if (setMs > 0 && System.currentTimeMillis() - setMs > 55 * 60_000L) {
                val refreshed = refreshTokenNatively()
                if (refreshed != null) return refreshed
            }
        }

        return token
    }

    /**
     * Callback for [SheetsSignalingClient] when it receives HTTP 401/403.
     * Attempts a native token refresh using stored credentials.
     * Returns true if the token was refreshed (caller should retry).
     */
    private fun handleAuthExpired(): Boolean {
        val refreshed = refreshTokenNatively()
        return refreshed != null
    }

    /**
     * Exchange the stored refresh_token for a fresh access_token via
     * Google's OAuth2 token endpoint.  Updates SharedPreferences atomically
     * on success so both the signaling client and Drive calls pick up the
     * new token immediately.
     *
     * @return the new access token, or null if refresh credentials aren't stored
     *         or the refresh request failed.
     */
    @Synchronized
    private fun refreshTokenNatively(): String? {
        val p = prefs
        val refreshToken = p.getString(WaymarkConfig.PREF_REFRESH_TOKEN, "") ?: ""
        val clientId     = p.getString(WaymarkConfig.PREF_CLIENT_ID, "") ?: ""
        val clientSecret = p.getString(WaymarkConfig.PREF_CLIENT_SECRET, "") ?: ""

        if (refreshToken.isBlank() || clientId.isBlank() || clientSecret.isBlank()) {
            Log.d(TAG, "No refresh credentials stored — cannot refresh token natively")
            return null
        }

        return try {
            val conn = (URL(OAUTH_TOKEN_URL).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 10_000
                readTimeout = 10_000
                setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            }

            val body = "grant_type=refresh_token" +
                "&refresh_token=${java.net.URLEncoder.encode(refreshToken, "UTF-8")}" +
                "&client_id=${java.net.URLEncoder.encode(clientId, "UTF-8")}" +
                "&client_secret=${java.net.URLEncoder.encode(clientSecret, "UTF-8")}"

            conn.outputStream.use { it.write(body.toByteArray()) }

            if (conn.responseCode != 200) {
                Log.w(TAG, "Token refresh failed: HTTP ${conn.responseCode}")
                conn.disconnect()
                return null
            }

            val respBody = conn.inputStream.bufferedReader().readText()
            conn.disconnect()

            val json = JSONObject(respBody)
            val newToken = json.optString("access_token", "")
            val expiresIn = json.optLong("expires_in", 3600)

            if (newToken.isBlank()) {
                Log.w(TAG, "Token refresh returned empty access_token")
                return null
            }

            val now = System.currentTimeMillis()
            p.edit()
                .putString(WaymarkConfig.PREF_ACCESS_TOKEN, newToken)
                .putLong(WaymarkConfig.PREF_ACCESS_TOKEN_SET_MS, now)
                .putLong(WaymarkConfig.PREF_TOKEN_EXPIRY_MS, now + expiresIn * 1000)
                .apply()

            Log.i(TAG, "Token refreshed natively — expires in ${expiresIn}s")
            newToken
        } catch (e: Exception) {
            Log.w(TAG, "Token refresh error: ${e.message}")
            null
        }
    }

    /* ---------- Public API ---------- */

    /**
     * Request a (re)connection. Safe to call from any thread, any number of times.
     * Rapid-fire calls within [debounceMs] are coalesced into a single attempt.
     */
    fun requestConnect(debounceMs: Long = 1_000L) {
        connectJob?.cancel()
        connectJob = scope.launch {
            delay(debounceMs)
            resolveAndConnect()
        }
    }

    /**
     * Request an immediate connect (no debounce). Used for first boot and
     * situations where latency matters (e.g., ACTION_TOKEN_UPDATED).
     */
    fun requestConnectNow() {
        connectJob?.cancel()
        connectJob = scope.launch { resolveAndConnect() }
    }

    /**
     * Tear down the current connection and return to Idle.
     * Blocks until the old peer's cleanup (including clearPresence) completes.
     */
    suspend fun disconnect() = mutex.withLock {
        tearDownCurrentPeer()
        transitionTo(ConnectionState.Idle)
    }

    /**
     * Disconnect and then resolve fresh sheet IDs. Used by onAloneTimeout
     * and ACTION_REBOOTSTRAP.
     */
    fun requestRebootstrap() {
        connectJob?.cancel()
        connectJob = scope.launch {
            mutex.withLock { tearDownCurrentPeer() }
            resolveAndConnect()
        }
    }

    /* ---------- Core resolution logic (Mutex-protected) ---------- */

    private suspend fun resolveAndConnect() = mutex.withLock {
        val previousState = state
        val token = getTokenWithRefresh()

        // Fetch the signaling sheet ID from Drive
        if (token.isNotBlank()) {
            try {
                val freshId = fetchSignalingSheetId(token)
                if (freshId.isNotBlank()) {
                    prefs.edit().putString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, freshId).apply()
                    Log.i(TAG, "Drive refresh: signalingSheet=$freshId")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Drive refresh failed (using cache): ${e.message}")
            }
        }

        val cachedSheetId = prefs.getString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, "") ?: ""

        if (cachedSheetId.isNotBlank()) {
            // Already connected to this sheet with a healthy peer — no-op
            val peer = previousState.activePeer
            if (previousState is ConnectionState.Connected
                && previousState.activeSheetId == cachedSheetId
                && peer != null && !peer.destroyed && peer.isInMesh
            ) {
                // Nudge the peer's retry loop instead of doing nothing — if the peer
                // is sleeping in an exponential backoff after a Sheets IO failure
                // (e.g., WiFi was off), this wakes it immediately so polls resume.
                Log.d(TAG, "Already connected to sheet $cachedSheetId — nudging retry")
                peer.nudgeRetry()
                return@withLock
            }
            transitionTo(ConnectionState.Connecting)
            tearDownCurrentPeer()
            startConnection(cachedSheetId)
            return@withLock
        }

        // Nothing to connect to
        if (token.isBlank()) {
            Log.d(TAG, "No access token — waiting for user to open the app")
        } else {
            Log.d(TAG, "No signaling sheet found — open the web app to initialise signaling")
        }
        transitionTo(ConnectionState.Idle)
    }

    /* ---------- Connection: signaling on OAuth-protected sheet ---------- */

    private fun startConnection(sheetId: String) {
        Log.i(TAG, "Connecting to signaling sheet $sheetId (OAuth-protected)")

        val signalingClient = SheetsSignalingClient(
            sheetId = sheetId,
            getToken = { getTokenWithRefresh() },
            onAuthExpired = { handleAuthExpired() }
        )

        val displayName = prefs.getString(WaymarkConfig.PREF_DISPLAY_NAME, "Waymark Android")
            ?: "Waymark Android"

        val newPeer = OrchestratorPeer(
            context = appContext,
            sheetId = sheetId,
            peerId = getOrCreatePeerId(),
            displayName = displayName,
            signalingClient = signalingClient,
            onNotification = { title, body ->
                NotificationHelper.showMessage(appContext, title, body)
            }
        )

        newPeer.onConnectionStateChanged = { _, _ ->
            onStateChange(state)
        }

        newPeer.onAloneTimeout = {
            Log.i(TAG, "Alone timeout — re-bootstrapping")
            requestRebootstrap()
        }

        newPeer.start()
        transitionTo(ConnectionState.Connected(sheetId, newPeer))
    }

    /* ---------- Teardown ---------- */

    /**
     * Stop the current peer and wait for its cleanup to finish.
     * MUST be called while holding [mutex] to prevent races.
     */
    private suspend fun tearDownCurrentPeer() {
        val peer = state.activePeer ?: return
        // stop() is synchronous for the important parts (sets destroyed=true,
        // cancels scope, clears maps). The clearPresence is awaited inline
        // to prevent the race where a new peer reclaims the same slot
        // before the old peer's presence is cleared.
        peer.stop()
    }

    /* ---------- Helpers ---------- */

    private fun transitionTo(newState: ConnectionState) {
        val old = state
        state = newState
        Log.i(TAG, "State: ${old::class.simpleName} → ${newState::class.simpleName}")
        onStateChange(newState)
    }

    fun getOrCreatePeerId(): String {
        val stored = prefs.getString(WaymarkConfig.PREF_PEER_ID, null)
        if (!stored.isNullOrBlank()) return stored
        val bytes = ByteArray(4)
        SecureRandom().nextBytes(bytes)
        val newId = bytes.joinToString("") { "%02x".format(it) }
        prefs.edit().putString(WaymarkConfig.PREF_PEER_ID, newId).apply()
        Log.i(TAG, "Generated permanent peerId: $newId")
        return newId
    }

    /**
     * Reads .waymark-data.json from Google Drive and returns
     * the signaling sheet ID.
     */
    private suspend fun fetchSignalingSheetId(token: String): String =
        withContext(Dispatchers.IO) {
            val drive = WaymarkConfig.DRIVE_BASE
            val q = "name='.waymark-data.json' and mimeType='application/json' and trashed=false"
            val searchUrl = URL(
                "$drive/files?q=${java.net.URLEncoder.encode(q, "UTF-8")}&fields=files(id)&pageSize=1&spaces=drive"
            )
            val searchConn = (searchUrl.openConnection() as HttpURLConnection).apply {
                setRequestProperty("Authorization", "Bearer $token")
                connectTimeout = 10_000
                readTimeout = 10_000
            }
            if (searchConn.responseCode != 200) {
                searchConn.disconnect()
                throw IOException("Drive search returned ${searchConn.responseCode}")
            }
            val searchBody = searchConn.inputStream.bufferedReader().readText()
            searchConn.disconnect()

            val files = JSONObject(searchBody).optJSONArray("files") ?: return@withContext ""
            if (files.length() == 0) return@withContext ""
            val fileId = files.getJSONObject(0).optString("id", "").ifBlank { return@withContext "" }

            val dlUrl = URL("$drive/files/$fileId?alt=media")
            val dlConn = (dlUrl.openConnection() as HttpURLConnection).apply {
                setRequestProperty("Authorization", "Bearer $token")
                connectTimeout = 10_000
                readTimeout = 15_000
            }
            if (dlConn.responseCode != 200) {
                dlConn.disconnect()
                throw IOException("Drive download returned ${dlConn.responseCode}")
            }
            val content = dlConn.inputStream.bufferedReader().readText()
            dlConn.disconnect()

            val data = JSONObject(content)
            // Support both old two-sheet format and new single-sheet format
            data.optString("signalingSheetId", "")
        }
}
