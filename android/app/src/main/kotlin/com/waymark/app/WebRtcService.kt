/* ============================================================
   WebRtcService.kt — Foreground service for background WebRTC

   Keeps the OrchestratorPeer alive when the user switches away
   from the app so notifications can still arrive via the P2P mesh.

   Encrypted public-sheet architecture
   ------------------------------------
   1. The AES-256 signal key is stored ONLY in SharedPreferences
      (PREF_SIGNAL_KEY).  It is NEVER fetched from any Google Sheet.
      Key distribution happens exclusively over the WebRTC DataChannel.

   2. At service startup, OAuth is used ONCE to read .waymark-data.json
      from Google Drive so we can discover the publicSignalingSheetId.

   3. All ongoing WebRTC signaling is performed on the PUBLIC sheet
      (.waymark-public-signaling), with every cell value AES-256-GCM
      encrypted/decrypted using the key from SharedPreferences.

   4. If no key is in SharedPreferences, the peer connects without
      encryption (bootstrap mode) until a key is received over the
      DataChannel from another authenticated peer.

   5. Once a direct WebRTC DataChannel is established between Android
      and the orchestrator, notifications flow over the P2P channel
      without any further dependency on OAuth or Google Sheets.

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

        const val EXTRA_SHEET_ID  = "sheet_id"
        const val EXTRA_TOKEN     = "token"
        const val EXTRA_SIGNAL_KEY = "signalKey"
    }

    /* ---------- State ---------- */

    @Volatile private var currentSheetId: String? = null
    @Volatile private var peer: OrchestratorPeer? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    /** Reconnect when the device regains a capable network after Doze or WiFi handoff. */
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            val livePeer = peer
            if (livePeer == null || livePeer.destroyed || !livePeer.isInMesh) {
                Log.i(TAG, "Network available — reconnecting peer")
                scope.launch { resolveAndConnect() }
            }
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
                // Debug/test helper: clear the AES key via adb broadcast.
                // adb shell am broadcast -a com.waymark.app.action.CLEAR_SIGNAL_KEY
                val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit().remove(WaymarkConfig.PREF_SIGNAL_KEY).apply()
                Log.i(TAG, "Signal key cleared via adb broadcast — reconnecting in bootstrap mode")
                currentSheetId?.let { sheetId ->
                    disconnectPeer()
                    currentSheetId = null
                    connectToSheet(sheetId)
                } ?: scope.launch { resolveAndConnect() }
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
     * Resolves the public signaling sheet ID (via Drive) and connects.
     * The AES key comes ONLY from SharedPreferences — never from any Google Sheet.
     *
     * Discovery order:
     *  1. Return immediately if already connected to the correct public sheet.
     *  2. If public sheet ID is cached in SharedPreferences, connect immediately.
     *  3. Use OAuth to fetch the public sheet ID from .waymark-data.json on Drive.
     *  4. Connect; if no key is in SharedPreferences, connect in bootstrap (unencrypted) mode.
     */
    private suspend fun resolveAndConnect() = withContext(Dispatchers.IO) {
        val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)

        val cachedPublicId = prefs.getString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, "") ?: ""
        val cachedKeyHex   = prefs.getString(WaymarkConfig.PREF_SIGNAL_KEY, "") ?: ""

        // Already on the correct public sheet — nothing to do.
        if (currentSheetId != null && cachedPublicId.isNotBlank() && currentSheetId == cachedPublicId) {
            return@withContext
        }

        // On the wrong sheet (e.g. migrating after first provisioning).
        if (currentSheetId != null && cachedPublicId.isNotBlank() && currentSheetId != cachedPublicId) {
            Log.i(TAG, "Migrating: was on $currentSheetId, switching to public sheet $cachedPublicId")
            disconnectPeer()
        }

        if (cachedPublicId.isNotBlank()) {
            if (cachedKeyHex.isNotBlank()) {
                Log.i(TAG, "Using cached public sheet: $cachedPublicId (key cached)")
            } else {
                Log.w(TAG, "Using cached public sheet: $cachedPublicId (no key — bootstrap mode)")
            }
            connectToSheet(cachedPublicId)
            return@withContext
        }

        val token = prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: ""
        if (token.isBlank()) {
            Log.d(TAG, "No access token — waiting for user to open the app")
            return@withContext
        }

        try {
            // Discover the public sheet ID from Drive (.waymark-data.json).
            // Key is NOT fetched from any sheet — it lives in SharedPreferences only.
            val publicId = fetchPublicSheetIdFromDrive(token)

            if (publicId.isBlank()) {
                Log.d(TAG, "publicSignalingSheetId not set — open the web app to initialise signaling")
                return@withContext
            }

            prefs.edit()
                .putString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, publicId)
                .apply()

            val keyHex = prefs.getString(WaymarkConfig.PREF_SIGNAL_KEY, "") ?: ""
            if (keyHex.isBlank()) {
                Log.w(TAG, "No signal key in SharedPreferences — connecting in bootstrap mode")
            } else {
                Log.i(TAG, "Signal key found (${keyHex.length / 2} bytes) — connecting to public sheet with encryption")
            }
            connectToSheet(publicId)

        } catch (e: Exception) {
            Log.e(TAG, "resolveAndConnect failed: ${e.message}")
        }
    }

    /**
     * Reads .waymark-data.json from the user's Google Drive and returns
     * the publicSignalingSheetId.
     *
     * @throws IOException if Drive is unreachable or the file is missing/malformed
     */
    private fun fetchPublicSheetIdFromDrive(token: String): String {
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

        val files = JSONObject(searchBody).optJSONArray("files") ?: return ""
        if (files.length() == 0) return ""
        val fileId = files.getJSONObject(0).optString("id", "").ifBlank { return "" }

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
        return data.optString("publicSignalingSheetId", "")
    }

    /**
     * Called when OrchestratorPeer detects decryption failures indicating the
     * signal key has been cycled.  Clears the cached key and reconnects in
     * bootstrap mode until the new key is received over the DataChannel.
     */
    fun onSignalKeyStale() {
        Log.i(TAG, "Signal key stale — clearing cache and reconnecting in bootstrap mode")
        val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(WaymarkConfig.PREF_SIGNAL_KEY).apply()
        disconnectPeer()
        scope.launch { resolveAndConnect() }
    }

    /* ---------- Sheet connection ---------- */

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
