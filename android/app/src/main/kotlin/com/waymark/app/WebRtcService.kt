/* ============================================================
   WebRtcService.kt — Foreground service for background WebRTC

   Keeps the Waymark P2P mesh alive when the user switches away
   so notifications can still arrive via DataChannel.

   This is a thin shell — all connection logic lives in
   [ConnectionManager] which provides Mutex-protected, debounced
   state management.

   Two-phase encrypted architecture
   ---------------------------------
   Phase 1 — Key Exchange (private sheet, plaintext, OAuth-protected):
     No AES key → connect to the PRIVATE sheet in plaintext.
     Orchestrator sends the AES-256 key over the DataChannel.

   Phase 2 — Encrypted Notifications (public sheet, AES-256-GCM):
     Key cached → connect to the PUBLIC sheet with encryption.
     Notifications flow over the P2P DataChannel.
   ============================================================ */

package com.waymark.app

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

private const val TAG = "WebRtcService"

class WebRtcService : LifecycleService() {

    companion object {
        const val ACTION_CONNECT          = "com.waymark.app.action.CONNECT"
        const val ACTION_UPDATE_TOKEN     = "com.waymark.app.action.UPDATE_TOKEN"
        const val ACTION_STOP             = "com.waymark.app.action.STOP"
        const val ACTION_SET_SIGNAL_KEY   = "com.waymark.app.action.SET_SIGNAL_KEY"
        const val ACTION_CLEAR_SIGNAL_KEY = "com.waymark.app.action.CLEAR_SIGNAL_KEY"
        const val ACTION_REBOOTSTRAP      = "com.waymark.app.action.REBOOTSTRAP"

        const val EXTRA_SHEET_ID   = "sheet_id"
        const val EXTRA_TOKEN      = "token"
        const val EXTRA_SIGNAL_KEY = "signalKey"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var connectionManager: ConnectionManager

    @Volatile private var networkLost = false

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            if (networkLost) {
                networkLost = false
                Log.i(TAG, "Network recovered after loss — re-bootstrapping to rebuild WebRTC")
                connectionManager.requestRebootstrap()
                return
            }
            val peer = connectionManager.state.activePeer
            if (peer == null || peer.destroyed || !peer.isInMesh) {
                Log.i(TAG, "Network available — requesting connect")
                connectionManager.requestConnect()
            }
        }

        override fun onLost(network: Network) {
            Log.i(TAG, "Network lost — will reconnect when available")
            networkLost = true
        }
    }

    /* ---------- Lifecycle ---------- */

    override fun onCreate() {
        super.onCreate()

        connectionManager = ConnectionManager(
            appContext = applicationContext,
            scope = scope,
            onStateChange = { state -> updateForegroundNotification(state) }
        )

        startForeground(
            NotificationHelper.NOTIFICATION_ID_SERVICE,
            NotificationHelper.buildServiceNotification(this)
        )
        Log.i(TAG, "Service created")

        (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager)
            .registerNetworkCallback(
                NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build(),
                networkCallback
            )

        connectionManager.requestConnectNow()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)

        when (intent?.action) {
            ACTION_CONNECT -> {
                connectionManager.requestConnect()
            }

            ACTION_UPDATE_TOKEN -> {
                // Token is already in SharedPreferences (written by WebView JS bridge).
                // Only reconnect if we're not already in a healthy mesh.
                val peer = connectionManager.state.activePeer
                if (peer == null || peer.destroyed || !peer.isInMesh) {
                    Log.d(TAG, "Token updated — peer unhealthy, requesting reconnect")
                    connectionManager.requestConnect(debounceMs = 500)
                } else {
                    Log.d(TAG, "Token updated — peer already healthy, no reconnect needed")
                }
            }

            ACTION_STOP -> {
                scope.launch {
                    connectionManager.disconnect()
                    stopSelf()
                }
            }

            ACTION_SET_SIGNAL_KEY -> {
                val keyHex = intent.getStringExtra(EXTRA_SIGNAL_KEY) ?: ""
                if (keyHex.length == 64) {
                    val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
                    prefs.edit()
                        .putString(WaymarkConfig.PREF_SIGNAL_KEY, keyHex)
                        .putLong(WaymarkConfig.PREF_SIGNAL_KEY_VERSION, System.currentTimeMillis())
                        .apply()
                    Log.i(TAG, "Signal key updated via intent (${keyHex.length / 2} bytes)")
                    connectionManager.requestRebootstrap()
                } else {
                    Log.w(TAG, "ACTION_SET_SIGNAL_KEY: invalid key length ${keyHex.length}")
                }
            }

            ACTION_CLEAR_SIGNAL_KEY -> {
                val prefs = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit().remove(WaymarkConfig.PREF_SIGNAL_KEY).apply()
                Log.i(TAG, "Signal key cleared — re-bootstrapping via Phase 1")
                connectionManager.requestRebootstrap()
            }

            ACTION_REBOOTSTRAP -> {
                Log.i(TAG, "Re-bootstrap requested")
                connectionManager.requestRebootstrap()
            }

            null -> {
                // Service restarted by system (START_STICKY) or started without action
                connectionManager.requestConnect()
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        try { cm.unregisterNetworkCallback(networkCallback) } catch (_: IllegalArgumentException) {}
        runBlocking { connectionManager.disconnect() }
        scope.cancel()
        Log.i(TAG, "Service destroyed")
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    /* ---------- Foreground notification ---------- */

    private fun updateForegroundNotification(state: ConnectionState) {
        val peer = state.activePeer
        val connected = peer != null && !peer.destroyed && peer.isInMesh
        val peerCount = peer?.openDataChannelCount ?: 0

        try {
            startForeground(
                NotificationHelper.NOTIFICATION_ID_SERVICE,
                NotificationHelper.buildServiceNotification(applicationContext, connected, peerCount)
            )
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update foreground notification: ${e.message}")
        }
    }
}
