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

        // Auto-connect to the orchestrator signaling sheet so notifications
        // can arrive even before the user opens any sheet in the WebView.
        val signalingSheet = WaymarkConfig.WAYMARK_SIGNALING_SHEET_ID
        if (signalingSheet.isNotBlank()) {
            Log.i(TAG, "Auto-connecting to orchestrator signaling sheet")
            connectToSheet(signalingSheet)
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
                // The token is stored in SharedPreferences by WaymarkBridge —
                // no explicit hand-off needed; SignalingClient reads via lambda.
                Log.d(TAG, "Token updated — signaling will pick it up on next poll")
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
