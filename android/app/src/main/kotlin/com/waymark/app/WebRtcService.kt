/* ============================================================
   WebRtcService.kt — Foreground service for background WebRTC

   Keeps the OrchestratorPeer alive when the user switches away
   from the app so notifications can still arrive via the P2P mesh.

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
import java.util.HexFormat

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

    /* ---------- Lifecycle ---------- */

    override fun onCreate() {
        super.onCreate()
        startForeground(
            NotificationHelper.NOTIFICATION_ID_SERVICE,
            NotificationHelper.buildServiceNotification(this)
        )
        Log.i(TAG, "Service created")

        // Only auto-connect on start if the cached token is still fresh.
        // If stale, wait for the WebView to load and call onAuthToken() —
        // that triggers ACTION_UPDATE_TOKEN which will connect with a fresh token.
        val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
        val tokenAge = System.currentTimeMillis() -
                prefs.getLong(WaymarkConfig.PREF_ACCESS_TOKEN_SET_MS, 0L)
        if (tokenAge < WaymarkConfig.ACCESS_TOKEN_TTL_MS) {
            scope.launch { resolveAndConnect() }
        } else {
            Log.d(TAG, "Cached token is stale (${ tokenAge / 1000 }s old) — waiting for fresh token from WebView")
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
                // If we have a cached sheet ID but the peer died, restart it now
                // with the fresh token. resolveAndConnect() exits early when
                // currentSheetId is already set, so we need to handle this case.
                val cachedSheet = currentSheetId
                if (cachedSheet != null && (peer == null || peer?.destroyed == true)) {
                    Log.i(TAG, "Peer was dead — restarting with fresh token")
                    currentSheetId = null  // allow connectToSheet to proceed
                    connectToSheet(cachedSheet)
                } else {
                    scope.launch { resolveAndConnect() }
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
     * Resolves the signaling sheet ID with no manual configuration:
     * 1. Returns immediately if already connected.
     * 2. Reads the cached ID from SharedPreferences.
     * 3. Falls back to reading .waymark-data.json directly from the user's
     *    Google Drive using the stored OAuth access token — no server involvement.
     * Called on service start and whenever the OAuth token is refreshed.
     */
    private suspend fun resolveAndConnect() = withContext(Dispatchers.IO) {
        if (currentSheetId != null) return@withContext

        val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)

        // 1. Cached from a previous session
        val cached = prefs.getString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, "") ?: ""
        if (cached.isNotBlank()) {
            Log.i(TAG, "Signaling sheet from cache: $cached")
            connectToSheet(cached)
            return@withContext
        }

        // 2. Read .waymark-data.json directly from the user's Drive.
        //    The web app creates this file on first boot (user-data.js) and
        //    writes signalingSheetId into it.  The server is never involved.
        val token = prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: ""
        if (token.isBlank()) {
            Log.d(TAG, "No token yet — will retry signaling discovery after next auth")
            return@withContext
        }

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
            peerId        = generatePeerId(),
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

    /** Generates an 8-character hex peer ID that is stable for this service instance. */
    private fun generatePeerId(): String {
        val bytes = ByteArray(4)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
