/* ============================================================
   WebRtcService.kt — Foreground service for background WebRTC

   Keeps the OrchestratorPeer alive when the user switches away
   from the app so notifications can still arrive via the P2P mesh.

   Two-phase encrypted architecture
   ---------------------------------
   Phase 1 — Key Exchange (private sheet, plaintext, OAuth-protected):
     When no AES key exists in SharedPreferences, the service connects
     to the PRIVATE sheet (.waymark-signaling) in plaintext mode.
     The sheet itself is OAuth-protected so plaintext signaling is safe.
     Once a DataChannel opens with the orchestrator, it sends a
     waymark-key-exchange message containing the AES-256 key.
     Android stores the key in SharedPreferences and disconnects.

   Phase 2 — Encrypted Notifications (public sheet, AES-256-GCM):
     With the key in SharedPreferences, the service connects to the
     PUBLIC sheet (.waymark-public-signaling) with all signaling cells
     AES-256-GCM encrypted.  Notifications flow over the P2P DataChannel.

   Key lifecycle:
     - Key is NEVER stored in any Google Sheet.
     - Key is created at runtime by the orchestrator and distributed
       exclusively over the WebRTC DataChannel.
     - If the key becomes stale (decrypt failures), the service clears
       it and falls back to Phase 1 to receive a fresh key.

   Actions:
     ACTION_CONNECT          — Start or switch to a new sheetId
     ACTION_UPDATE_TOKEN     — Refresh the access token in-place
     ACTION_STOP             — Disconnect and stop the service
     ACTION_SET_SIGNAL_KEY   — (debug/test) Set the AES key via adb broadcast
     ACTION_CLEAR_SIGNAL_KEY — (debug/test) Clear the AES key via adb broadcast
   ============================================================ */

package com.waymark.app

import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
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
        const val ACTION_CONNECT            = "com.waymark.app.action.CONNECT"
        const val ACTION_UPDATE_TOKEN       = "com.waymark.app.action.UPDATE_TOKEN"
        const val ACTION_STOP               = "com.waymark.app.action.STOP"
        /** Debug/test: set AES key via  adb shell am broadcast -a com.waymark.app.action.SET_SIGNAL_KEY --es signalKey <hex> */
        const val ACTION_SET_SIGNAL_KEY     = "com.waymark.app.action.SET_SIGNAL_KEY"
        /** Debug/test: clear AES key via adb shell am broadcast -a com.waymark.app.action.CLEAR_SIGNAL_KEY */
        const val ACTION_CLEAR_SIGNAL_KEY   = "com.waymark.app.action.CLEAR_SIGNAL_KEY"
        /** Disconnect and re-resolve from scratch (Phase 1 if no key). */
        const val ACTION_REBOOTSTRAP        = "com.waymark.app.action.REBOOTSTRAP"

        const val EXTRA_SHEET_ID  = "sheet_id"
        const val EXTRA_TOKEN     = "token"
        const val EXTRA_SIGNAL_KEY = "signalKey"
    }

    /* ---------- State ---------- */

    @Volatile private var currentSheetId: String? = null
    @Volatile private var peer: OrchestratorPeer? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /** Set when we lose a network — cleared on the next onAvailable. */
    @Volatile private var networkLost = false

    /** Reconnect when the device regains a capable network after Doze or WiFi handoff. */
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            if (networkLost) {
                // Network transition (WiFi → cellular or vice versa).
                // Old ICE candidates are bound to the dead interface — tear down
                // and rebuild immediately on the new network.
                networkLost = false
                Log.i(TAG, "Network recovered after loss — forcing full reconnect")
                disconnectPeer()
                scope.launch { resolveAndConnect() }
                return
            }
            val livePeer = peer
            if (livePeer == null || livePeer.destroyed || !livePeer.isInMesh) {
                Log.i(TAG, "Network available — reconnecting peer")
                scope.launch { resolveAndConnect() }
            }
        }

        override fun onLost(network: Network) {
            Log.i(TAG, "Network lost — will force reconnect when a new network appears")
            networkLost = true
        }
    }

    /* ---------- Lifecycle ---------- */

    override fun onCreate() {
        super.onCreate()
        startForeground(
            NotificationHelper.NOTIFICATION_ID_SERVICE,
            NotificationHelper.buildServiceNotification(this)
        )
        Log.i(TAG, "Service created")

        // Register for network-available events so Doze maintenance-window resumption
        // and WiFi→mobile handoffs trigger an immediate reconnect rather than waiting
        // for the poll loop to recover on its own.
        (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager)
            .registerNetworkCallback(
                NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build(),
                networkCallback
            )

        // Attempt to connect using cached credentials.  Key comes from SharedPreferences only —
        // NEVER fetched from any Google Sheet.  Once the DataChannel is open, no further
        // OAuth access to Google Sheets is needed.
        scope.launch { resolveAndConnect() }
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
            ACTION_SET_SIGNAL_KEY -> {
                // Debug/test helper: push the AES key directly via adb broadcast.
                // adb shell am broadcast -a com.waymark.app.action.SET_SIGNAL_KEY --es signalKey <hex>
                val keyHex = intent.getStringExtra(EXTRA_SIGNAL_KEY) ?: ""
                if (keyHex.length == 64) {
                    val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
                    prefs.edit()
                        .putString(WaymarkConfig.PREF_SIGNAL_KEY, keyHex)
                        .putLong(WaymarkConfig.PREF_SIGNAL_KEY_VERSION, System.currentTimeMillis())
                        .apply()
                    Log.i(TAG, "Signal key updated via adb broadcast (${keyHex.length / 2} bytes)")
                    // Reconnect so the peer picks up the new key
                    currentSheetId?.let { sheetId ->
                        disconnectPeer()
                        currentSheetId = null
                        connectToSheet(sheetId)
                    } ?: scope.launch { resolveAndConnect() }
                } else {
                    Log.w(TAG, "ACTION_SET_SIGNAL_KEY: invalid key length ${keyHex.length} (expected 64 hex chars)")
                }
            }
            ACTION_CLEAR_SIGNAL_KEY -> {
                val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit().remove(WaymarkConfig.PREF_SIGNAL_KEY).apply()
                Log.i(TAG, "Signal key cleared \u2014 re-bootstrapping via Phase 1")
                disconnectPeer()
                scope.launch { resolveAndConnect() }
            }
            ACTION_REBOOTSTRAP -> {
                Log.i(TAG, "Re-bootstrap requested \u2014 disconnecting and re-resolving")
                disconnectPeer()
                scope.launch { resolveAndConnect() }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        try { cm.unregisterNetworkCallback(networkCallback) } catch (_: IllegalArgumentException) {}
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
     * Two-phase WebRTC connection:
     *
     * Phase 1 (no key): Connect to the PRIVATE sheet (.waymark-signaling) in plaintext.
     *   The sheet is OAuth-protected so plaintext signaling is safe. Once a DataChannel
     *   opens, the orchestrator sends a waymark-key-exchange message with the AES key.
     *   On receipt, store the key in SharedPreferences, disconnect, and proceed to Phase 2.
     *
     * Phase 2 (has key): Connect to the PUBLIC sheet (.waymark-public-signaling) with
     *   AES-256-GCM encryption. Normal notification traffic flows here.
     *
     * Discovery order:
     *  1. Return immediately if already connected to the correct sheet.
     *  2. If cached IDs exist in SharedPreferences, use them.
     *  3. Use OAuth to fetch both sheet IDs from .waymark-data.json on Drive.
     */
    private suspend fun resolveAndConnect() = withContext(Dispatchers.IO) {
        val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)

        val token = prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: ""

        // ── Always re-fetch sheet IDs from Drive when we have a token ──
        // Cached IDs can become stale when the user re-provisions signaling
        // sheets from the web app.  Drive is the source of truth.
        if (token.isNotBlank()) {
            try {
                val (freshPublicId, freshPrivateId) = fetchSheetIdsFromDrive(token)
                if (freshPublicId.isNotBlank() || freshPrivateId.isNotBlank()) {
                    prefs.edit().apply {
                        if (freshPublicId.isNotBlank())  putString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, freshPublicId)
                        if (freshPrivateId.isNotBlank()) putString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, freshPrivateId)
                        apply()
                    }
                    Log.i(TAG, "Drive refresh: public=$freshPublicId private=$freshPrivateId")
                }
            } catch (e: Exception) {
                Log.w(TAG, "Drive refresh failed (using cache): ${e.message}")
            }
        }

        // Re-read prefs after potential Drive update
        val cachedPublicId  = prefs.getString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, "") ?: ""
        val cachedPrivateId = prefs.getString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, "") ?: ""
        val cachedKeyHex    = prefs.getString(WaymarkConfig.PREF_SIGNAL_KEY, "") ?: ""

        // ── Phase 2: Already have key — connect to public sheet ──
        if (cachedKeyHex.isNotBlank() && cachedPublicId.isNotBlank()) {
            if (currentSheetId == cachedPublicId) return@withContext  // already connected
            if (currentSheetId != null) {
                Log.i(TAG, "Switching from $currentSheetId to public sheet $cachedPublicId")
                disconnectPeer()
            }
            Log.i(TAG, "Phase 2: connecting to public sheet $cachedPublicId (key cached)")
            connectToSheet(cachedPublicId)
            return@withContext
        }

        // ── Phase 1: No key — connect to private sheet for key exchange ──
        if (cachedPrivateId.isNotBlank()) {
            if (currentSheetId == cachedPrivateId) return@withContext  // already waiting for key
            if (currentSheetId != null) disconnectPeer()
            Log.i(TAG, "Phase 1: connecting to private sheet $cachedPrivateId for key exchange")
            connectToPrivateSheet(cachedPrivateId)
            return@withContext
        }

        // ── No token — nothing we can do ──
        if (token.isBlank()) {
            Log.d(TAG, "No access token — waiting for user to open the app")
        } else {
            Log.d(TAG, "No signaling sheets found — open the web app to initialise signaling")
        }
    }

    /**
     * Reads .waymark-data.json from the user's Google Drive and returns
     * the publicSignalingSheetId and signalingSheetId (private).
     *
     * @throws IOException if Drive is unreachable or the file is missing/malformed
     * @return Pair(publicSignalingSheetId, signalingSheetId) — either may be blank
     */
    private fun fetchSheetIdsFromDrive(token: String): Pair<String, String> {
        val drive = WaymarkConfig.DRIVE_BASE

        val q = "name='.waymark-data.json' and mimeType='application/json' and trashed=false"
        val searchUrl = URL(
            "$drive/files?q=${java.net.URLEncoder.encode(q, "UTF-8")}&fields=files(id)&pageSize=1&spaces=drive"
        )
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

        val files = JSONObject(searchBody).optJSONArray("files") ?: return Pair("", "")
        if (files.length() == 0) return Pair("", "")
        val fileId = files.getJSONObject(0).optString("id", "").ifBlank { return Pair("", "") }

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

        val data = JSONObject(content)
        val publicId  = data.optString("publicSignalingSheetId", "")
        val privateId = data.optString("signalingSheetId", "")
        return Pair(publicId, privateId)
    }

    /**
     * Called when OrchestratorPeer detects decryption failures indicating the
     * signal key has been cycled.  Clears the cached key and reconnects via
     * the private sheet to receive the new key over the DataChannel.
     */
    fun onSignalKeyStale() {
        Log.i(TAG, "Signal key stale — clearing cache and reconnecting via private sheet for new key")
        val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(WaymarkConfig.PREF_SIGNAL_KEY).apply()
        disconnectPeer()
        scope.launch { resolveAndConnect() }
    }

    /* ---------- Sheet connection ---------- */

    /**
     * Phase 1 connection: connect to the PRIVATE sheet (.waymark-signaling) in
     * plaintext mode (no AES key). The sheet is OAuth-protected, so plaintext
     * signaling is safe. When the orchestrator sends a waymark-key-exchange
     * message over the DataChannel, store the key and switch to the public sheet.
     */
    private fun connectToPrivateSheet(sheetId: String) {
        if (sheetId == currentSheetId) return
        Log.i(TAG, "Phase 1: connecting to private sheet $sheetId (plaintext, OAuth-protected)")

        disconnectPeer()
        currentSheetId = sheetId

        val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)

        val signalingClient = SignalingClient(
            sheetId  = sheetId,
            getToken = { prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: "" },
            getKey   = { null }  // Phase 1: NO encryption — plaintext signaling
        )

        val displayName = prefs.getString(WaymarkConfig.PREF_DISPLAY_NAME, "Waymark Android")
            ?: "Waymark Android"

        val newPeer = OrchestratorPeer(
            context         = applicationContext,
            sheetId         = sheetId,
            peerId          = getOrCreatePeerId(),
            displayName     = displayName,
            signalingClient = signalingClient,
            onNotification  = { title, body ->
                NotificationHelper.showMessage(applicationContext, title, body)
            }
        )

        // When the orchestrator sends the key over the DataChannel:
        // The callback fires on a WebRTC thread, so post the Phase 1→2
        // transition to our IO scope to avoid calling disconnectPeer() /
        // connectToSheet() / startForeground() from the DC callback thread.
        newPeer.onKeyReceived = { keyHex ->
            scope.launch {
                Log.i(TAG, "Phase 1: received signal key (${keyHex.length / 2} bytes) — switching to public sheet")
                prefs.edit()
                    .putString(WaymarkConfig.PREF_SIGNAL_KEY, keyHex)
                    .putLong(WaymarkConfig.PREF_SIGNAL_KEY_VERSION, System.currentTimeMillis())
                    .apply()
                // Disconnect from private sheet and connect to public sheet (Phase 2)
                disconnectPeer()
                val publicId = prefs.getString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, "") ?: ""
                if (publicId.isNotBlank()) {
                    connectToSheet(publicId)
                } else {
                    // Public sheet ID not cached yet — re-run full resolution
                    resolveAndConnect()
                }
            }
        }

        newPeer.onConnectionStateChanged = { connected, count ->
            startForeground(
                NotificationHelper.NOTIFICATION_ID_SERVICE,
                NotificationHelper.buildServiceNotification(applicationContext, connected, count)
            )
        }

        peer = newPeer
        newPeer.start()
    }

    private fun connectToSheet(sheetId: String) {
        if (sheetId == currentSheetId) return
        Log.i(TAG, "Connecting to public sheet $sheetId")

        disconnectPeer()
        currentSheetId = sheetId

        val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)

        val signalingClient = SignalingClient(
            sheetId  = sheetId,
            getToken = { prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: "" },
            getKey   = { prefs.getString(WaymarkConfig.PREF_SIGNAL_KEY, null) }
        )

        val displayName = prefs.getString(WaymarkConfig.PREF_DISPLAY_NAME, "Waymark Android")
            ?: "Waymark Android"

        val newPeer = OrchestratorPeer(
            context         = applicationContext,
            sheetId         = sheetId,
            peerId          = getOrCreatePeerId(),
            displayName     = displayName,
            signalingClient = signalingClient,
            onNotification  = { title, body ->
                NotificationHelper.showMessage(applicationContext, title, body)
            }
        )
        newPeer.onSignalKeyStale = { onSignalKeyStale() }

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
