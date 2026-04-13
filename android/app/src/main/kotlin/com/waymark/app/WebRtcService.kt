/* ============================================================
   WebRtcService.kt — Foreground service for background WebRTC

   Keeps the OrchestratorPeer alive when the user switches away
   from the app so notifications can still arrive via the P2P mesh.

   Encrypted public-sheet architecture
   ------------------------------------
   1. At service startup, the user's OAuth access token is used
      ONCE to fetch the AES-256 signal key from the PRIVATE key
      sheet (Sheet1!A1:A2 of the .waymark-signaling spreadsheet).

   2. The signal key is cached in SharedPreferences.  All ongoing
      WebRTC signaling is performed on the PUBLIC signaling sheet
      (.waymark-public-signaling), with every cell value
      AES-256-GCM encrypted/decrypted using that key.

   3. Once a direct WebRTC DataChannel is established between
      Android and the orchestrator, notifications flow over the
      P2P channel without any further dependency on OAuth or
      Google Sheets.

   4. If the OAuth token expires while the app is backgrounded,
      the existing DataChannel connection stays alive.  If it drops,
      reconnection requires the user to re-open the app so the
      WebView can refresh the token.  No background token refresh
      loop is needed or desired.

   Actions:
     ACTION_CONNECT       — Start or switch to a new sheetId
     ACTION_UPDATE_TOKEN  — Refresh the access token in-place
     ACTION_STOP          — Disconnect and stop the service
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

        // Attempt to connect using cached credentials.  Fetches the AES signal
        // key from the private sheet (one-time OAuth call) then connects to the
        // public signaling sheet with encryption.  Once the DataChannel is open,
        // no further OAuth access to Google Sheets is needed.
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
     * Resolves the AES-256 signal key and public signaling sheet ID, then connects.
     *
     * Discovery order:
     *  1. Return immediately if already connected to the public sheet.
     *  2. If key + public sheet ID are cached, connect immediately.
     *  3. Use OAuth to fetch sheet IDs from Drive and key from private sheet.
     *  4. Connect to the public sheet with AES-256-GCM encrypted signaling.
     *
     * OAuth is used ONLY for this initial setup phase.  Once the WebRTC
     * DataChannel is established, no further OAuth is needed.
     */
    private suspend fun resolveAndConnect() = withContext(Dispatchers.IO) {
        if (currentSheetId != null) return@withContext

        val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)

        val cachedPublicId  = prefs.getString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, "") ?: ""
        val cachedKeyHex    = prefs.getString(WaymarkConfig.PREF_SIGNAL_KEY, "") ?: ""
        val cachedPrivateId = prefs.getString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, "") ?: ""

        if (cachedPublicId.isNotBlank() && cachedKeyHex.isNotBlank()) {
            Log.i(TAG, "Using cached public sheet: $cachedPublicId (key cached)")
            connectToSheet(cachedPublicId)
            return@withContext
        }

        val token = prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: ""
        if (token.isBlank()) {
            Log.d(TAG, "No access token — waiting for user to open the app")
            return@withContext
        }

        try {
            // Discover the private + public sheet IDs from Drive
            val (privateId, publicId) = if (cachedPrivateId.isNotBlank() && cachedPublicId.isNotBlank()) {
                Pair(cachedPrivateId, cachedPublicId)
            } else {
                fetchSheetIdsFromDrive(token)
            }

            if (privateId.isBlank() || publicId.isBlank()) {
                Log.d(TAG, "Sheet IDs not set — user may not have opened the web app yet")
                return@withContext
            }

            prefs.edit()
                .putString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, privateId)
                .putString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, publicId)
                .apply()

            // Fetch the AES signal key from the private sheet (one-time OAuth call)
            val keyHex = fetchSignalKey(token, privateId)
            if (keyHex.isBlank()) {
                Log.w(TAG, "Signal key not provisioned — connecting without encryption")
                connectToSheet(publicId)
                return@withContext
            }

            prefs.edit()
                .putString(WaymarkConfig.PREF_SIGNAL_KEY, keyHex)
                .putLong(WaymarkConfig.PREF_SIGNAL_KEY_VERSION, System.currentTimeMillis())
                .apply()

            Log.i(TAG, "Signal key fetched (${keyHex.length / 2} bytes) — connecting to public sheet")
            connectToSheet(publicId)

        } catch (e: Exception) {
            Log.e(TAG, "resolveAndConnect failed: ${e.message}")
        }
    }

    /**
     * Reads .waymark-data.json from the user's Google Drive and returns
     * (signalingSheetId, publicSignalingSheetId) — the private key sheet
     * and the public P2P signaling sheet.
     *
     * @throws IOException if Drive is unreachable or the file is missing/malformed
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
        return Pair(
            data.optString("signalingSheetId", ""),
            data.optString("publicSignalingSheetId", "")
        )
    }

    /**
     * Reads the AES-256 signal key from the PRIVATE key sheet.
     *
     * The web app writes the key to Sheet1!A1:A2:
     *   A1 = 64-char hex AES-256 key
     *   A2 = key version epoch ms
     *
     * @param token          Current OAuth access token
     * @param privateSheetId ID of the private .waymark-signaling sheet
     * @return 64-char hex key string, or empty string if not yet provisioned
     */
    private fun fetchSignalKey(token: String, privateSheetId: String): String {
        val url = URL(
            "${WaymarkConfig.SHEETS_BASE}/$privateSheetId/values/${WaymarkConfig.KEY_RANGE}"
        )
        val conn = url.openConnection() as HttpURLConnection
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        if (conn.responseCode != 200) {
            conn.disconnect()
            throw IOException("Signal key fetch returned ${conn.responseCode}")
        }
        val body = conn.inputStream.bufferedReader().readText()
        conn.disconnect()

        val rows = JSONObject(body).optJSONArray("values") ?: return ""
        val keyRow = if (rows.length() > 0) rows.optJSONArray(0) else null
        if (keyRow == null || keyRow.length() == 0) return ""
        return keyRow.optString(0, "").trim()
    }

    /**
     * Called when OrchestratorPeer detects decryption failures indicating the
     * signal key has been cycled.  Clears the cached key and reconnects.
     */
    fun onSignalKeyStale() {
        Log.i(TAG, "Signal key stale — clearing cache and reconnecting")
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
