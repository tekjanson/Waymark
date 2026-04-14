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

/**
 * Manages the Waymark P2P connection lifecycle — Phase 1 (key exchange) and
 * Phase 2 (encrypted notifications) — on behalf of [WebRtcService].
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
     * situations where latency matters (e.g., Phase 1→2 transition).
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
     * Disconnect and then resolve fresh sheet IDs. Used by onAloneTimeout,
     * onSignalKeyStale, ACTION_REBOOTSTRAP, etc.
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
        // Save the previous state BEFORE any transition — needed for idempotency checks
        val previousState = state

        val token = prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: ""

        // Always re-fetch sheet IDs from Drive when we have a token
        if (token.isNotBlank()) {
            try {
                val (freshPublicId, freshPrivateId) = fetchSheetIdsFromDrive(token)
                if (freshPublicId.isNotBlank() || freshPrivateId.isNotBlank()) {
                    prefs.edit().apply {
                        if (freshPublicId.isNotBlank()) putString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, freshPublicId)
                        if (freshPrivateId.isNotBlank()) putString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, freshPrivateId)
                        apply()
                    }
                    Log.i(TAG, "Drive refresh: public=$freshPublicId private=$freshPrivateId")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Drive refresh failed (using cache): ${e.message}")
            }
        }

        val cachedPublicId = prefs.getString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, "") ?: ""
        // cachedPrivateId not currently needed for routing
        val cachedKeyHex = prefs.getString(WaymarkConfig.PREF_SIGNAL_KEY, "") ?: ""

        // Phase 2: have key + public sheet
        if (cachedKeyHex.isNotBlank() && cachedPublicId.isNotBlank()) {
            val peer = previousState.activePeer
            if (previousState is ConnectionState.Phase2
                && previousState.activeSheetId == cachedPublicId
                && peer != null && !peer.destroyed && peer.isInMesh
            ) {
                Log.d(TAG, "Already on Phase 2 sheet $cachedPublicId \u2014 no-op")
                return@withLock
            }
            transitionTo(ConnectionState.Connecting)
            tearDownCurrentPeer()
            startPhase2(cachedPublicId)
            return@withLock
        }

        // Phase 2 blocked: have key but no public sheet yet — wait for orchestrator
        if (cachedKeyHex.isNotBlank() && cachedPublicId.isBlank() && token.isNotBlank()) {
            Log.w(TAG, "Have signal key but no public sheet ID — waiting for orchestrator")
            transitionTo(ConnectionState.Connecting)
            for (attempt in 1..3) {
                delay(5_000L)
                try {
                    val (freshPublicId, _) = fetchSheetIdsFromDrive(token)
                    if (freshPublicId.isNotBlank()) {
                        prefs.edit().putString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, freshPublicId).apply()
                        Log.i(TAG, "Public sheet appeared on Drive: $freshPublicId")
                        tearDownCurrentPeer()
                        startPhase2(freshPublicId)
                        return@withLock
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Drive retry $attempt/3 failed: ${e.message}")
                }
            }
            Log.w(TAG, "Public sheet still missing — clearing key, falling back to Phase 1")
            prefs.edit().remove(WaymarkConfig.PREF_SIGNAL_KEY).apply()
        }

        // Phase 1: no key — connect to private sheet
        val finalPrivateId = prefs.getString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, "") ?: ""
        if (finalPrivateId.isNotBlank()) {
            val peer = previousState.activePeer
            if (previousState is ConnectionState.Phase1
                && previousState.activeSheetId == finalPrivateId
                && peer != null && !peer.destroyed && peer.isInMesh
            ) {
                Log.d(TAG, "Already on Phase 1 sheet $finalPrivateId \u2014 no-op")
                return@withLock
            }
            transitionTo(ConnectionState.Connecting)
            tearDownCurrentPeer()
            startPhase1(finalPrivateId)
            return@withLock
        }

        // Nothing to connect to
        if (token.isBlank()) {
            Log.d(TAG, "No access token — waiting for user to open the app")
        } else {
            Log.d(TAG, "No signaling sheets found — open the web app to initialise signaling")
        }
        transitionTo(ConnectionState.Idle)
    }

    /* ---------- Phase 1: key exchange on private sheet ---------- */

    private fun startPhase1(sheetId: String) {
        Log.i(TAG, "Phase 1: connecting to private sheet $sheetId (plaintext, OAuth-protected)")

        val signalingClient = SheetsSignalingClient(
            sheetId = sheetId,
            getToken = { prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: "" },
            getKey = { null } // Phase 1: no encryption
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

        // Key received → store and transition to Phase 2
        // Posted to the MANAGER'S scope (not the peer's) to avoid self-cancellation
        var keyTransitionFired = false
        newPeer.onKeyReceived = { keyHex ->
            if (!keyTransitionFired) {
                keyTransitionFired = true
                scope.launch {
                    Log.i(TAG, "Phase 1: received signal key (${keyHex.length / 2} bytes)")
                    prefs.edit()
                        .putString(WaymarkConfig.PREF_SIGNAL_KEY, keyHex)
                        .putLong(WaymarkConfig.PREF_SIGNAL_KEY_VERSION, System.currentTimeMillis())
                        .apply()
                    resolveAndConnect()
                }
            } else {
                Log.d(TAG, "Phase 1: ignoring duplicate key-exchange (transition already fired)")
            }
        }

        newPeer.onConnectionStateChanged = { _, _ ->
            onStateChange(state) // re-fire to update notification
        }

        newPeer.onAloneTimeout = {
            Log.i(TAG, "Alone timeout on Phase 1 — re-bootstrapping")
            requestRebootstrap()
        }

        newPeer.start()
        transitionTo(ConnectionState.Phase1(sheetId, newPeer))
    }

    /* ---------- Phase 2: encrypted notifications on public sheet ---------- */

    private fun startPhase2(sheetId: String) {
        Log.i(TAG, "Phase 2: connecting to public sheet $sheetId (encrypted)")

        val signalingClient = SheetsSignalingClient(
            sheetId = sheetId,
            getToken = { prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: "" },
            getKey = { prefs.getString(WaymarkConfig.PREF_SIGNAL_KEY, null) }
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

        newPeer.onSignalKeyStale = {
            Log.i(TAG, "Signal key stale — clearing cache, re-bootstrapping via Phase 1")
            prefs.edit().remove(WaymarkConfig.PREF_SIGNAL_KEY).apply()
            requestRebootstrap()
        }

        newPeer.onConnectionStateChanged = { _, _ ->
            onStateChange(state)
        }

        newPeer.onAloneTimeout = {
            Log.i(TAG, "Alone timeout on Phase 2 — re-bootstrapping")
            requestRebootstrap()
        }

        newPeer.start()
        transitionTo(ConnectionState.Phase2(sheetId, newPeer))
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
     * (publicSignalingSheetId, signalingSheetId).
     */
    private suspend fun fetchSheetIdsFromDrive(token: String): Pair<String, String> =
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

            val files = JSONObject(searchBody).optJSONArray("files") ?: return@withContext Pair("", "")
            if (files.length() == 0) return@withContext Pair("", "")
            val fileId = files.getJSONObject(0).optString("id", "").ifBlank { return@withContext Pair("", "") }

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
            Pair(
                data.optString("publicSignalingSheetId", ""),
                data.optString("signalingSheetId", "")
            )
        }
}
