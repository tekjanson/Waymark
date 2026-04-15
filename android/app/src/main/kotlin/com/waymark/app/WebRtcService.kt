/* ============================================================
   WebRtcService.kt — Foreground service for background WebRTC

   Keeps the Waymark P2P mesh alive when the user switches away
   so notifications can still arrive via DataChannel.

   This is a thin shell — all connection logic lives in
   [ConnectionManager] which provides Mutex-protected, debounced
   state management.

   Single-sheet architecture
   -------------------------
   The app connects to one OAuth-protected signaling sheet
   (resolved from .waymark-data.json on Drive) and exchanges
   WebRTC signaling in plaintext.  OAuth token refresh keeps
   the connection alive indefinitely.
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
        const val ACTION_REBOOTSTRAP      = "com.waymark.app.action.REBOOTSTRAP"

        const val EXTRA_SHEET_ID   = "sheet_id"
        const val EXTRA_TOKEN      = "token"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var connectionManager: ConnectionManager

    @Volatile private var networkLost = false

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            if (networkLost) {
                networkLost = false
                // Don't re-bootstrap — the existing peer keeps its slot and resumes
                // polling once HTTP calls succeed.  Re-bootstrapping would create a
                // new peer (new sessionNonce) which triggers a nonce-flap loop on
                // the remote side while the new peer is still joining the mesh.
                Log.i(TAG, "Network recovered after loss — requesting reconnect")
                connectionManager.requestConnect()
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
        val inMesh = peer != null && !peer.destroyed && peer.isInMesh
        val peerCount = peer?.openDataChannelCount ?: 0
        // Show "Connected" only when we actually have open DataChannels.
        // isInMesh alone just means we have a signaling slot — not that we
        // can actually reach anyone. Showing "Connected · 0 peer(s)" is
        // misleading; show "Waiting" instead so the user knows we're trying.
        val connected = inMesh && peerCount > 0

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
