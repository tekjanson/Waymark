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

        // Attempt to connect to the signaling sheet automatically.
        // Uses the cached sheet ID if available, otherwise queries the server.
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
                // Token was refreshed — retry sheet discovery if not yet connected.
                Log.d(TAG, "Token updated — retrying signaling sheet discovery")
                scope.launch { resolveAndConnect() }
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
     * 3. Falls back to GET /api/signaling-sheet on the Waymark server using
     *    the stored OAuth access token (set by WaymarkBridge.onAuthToken).
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

        // 2. Ask the server (needs a valid OAuth token)
        val token = prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: ""
        if (token.isBlank()) {
            Log.d(TAG, "No token yet — will retry signaling discovery after next auth")
            return@withContext
        }

        try {
            val url = URL("${WaymarkConfig.BASE_URL}api/signaling-sheet")
            val conn = url.openConnection() as HttpURLConnection
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            if (conn.responseCode == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                val sheetId = JSONObject(body).optString("sheetId", "")
                if (sheetId.isNotBlank()) {
                    Log.i(TAG, "Signaling sheet discovered from server: $sheetId")
                    prefs.edit().putString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, sheetId).apply()
                    connectToSheet(sheetId)
                } else {
                    Log.d(TAG, "Server has no signaling sheet yet — orchestrator may not have booted")
                }
            } else {
                Log.w(TAG, "Signaling sheet API returned ${conn.responseCode}")
            }
            conn.disconnect()
        } catch (e: Exception) {
            Log.e(TAG, "Signaling sheet discovery failed: ${e.message}")
        }
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

        peer = newPeer
        newPeer.start()
    }

    /* ---------- Disconnect ---------- */

    private fun disconnectPeer() {
        peer?.stop()
        peer = null
        currentSheetId = null
    }

    /* ---------- Helpers ---------- */

    /** Generates an 8-character hex peer ID that is stable for this service instance. */
    private fun generatePeerId(): String {
        val bytes = ByteArray(4)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
