/* ============================================================
   NotificationHelper.kt — Android notification channel setup
   and message display utilities.
   ============================================================ */

package com.waymark.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.concurrent.atomic.AtomicInteger

object NotificationHelper {

    /* ---------- Channel IDs ---------- */

    const val CHANNEL_MESSAGES = "waymark_messages"
    const val CHANNEL_SERVICE  = "waymark_service"

    private const val TAG = "NotificationHelper"

    /* ---------- Notification IDs ---------- */

    /** Auto-incrementing ID so each message gets a distinct notification. */
    private val _nextId = AtomicInteger(2000)

    /** Fixed ID for the foreground service persistent notification. */
    const val NOTIFICATION_ID_SERVICE = 1001

    /* ---------- Channel creation (call once at app start) ---------- */

    /**
     * Creates the notification channels required by Android 8+.
     * Safe to call multiple times — existing channels are not modified.
     */
    fun createChannels(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Peer messages / orchestrator alerts
        val msgChannel = NotificationChannel(
            CHANNEL_MESSAGES,
            "Waymark Messages",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Notifications from Waymark sheets and the orchestrator"
            enableVibration(true)
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
        }
        nm.createNotificationChannel(msgChannel)

        // Foreground service — minimal importance so it stays silent
        val svcChannel = NotificationChannel(
            CHANNEL_SERVICE,
            "Waymark Background Sync",
            NotificationManager.IMPORTANCE_MIN
        ).apply {
            description = "Shows while Waymark is syncing in the background"
            setShowBadge(false)
        }
        nm.createNotificationChannel(svcChannel)
    }

    /* ---------- Show a peer / orchestrator message notification ---------- */

    /**
     * Posts a notification for a message received from a peer or the
     * orchestrator. Tapping it opens the main Waymark activity.
     *
     * @param context Application context
     * @param title   Notification title (already truncated by caller)
     * @param body    Notification body  (already truncated by caller)
     */
    fun showMessage(context: Context, title: String, body: String) {
        val launchIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title.ifBlank { "Waymark" })
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        // Acquire a brief partial wake lock BEFORE posting so the CPU stays
        // awake long enough to render the notification in the status bar.
        // Without this, Doze can sleep the CPU between notify() and delivery.
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        @Suppress("DEPRECATION")
        val wl = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "waymark:notif_delivery"
        )
        wl.acquire(2_000L) // auto-releases after 2 s

        try {
            NotificationManagerCompat.from(context)
                .notify(_nextId.getAndIncrement(), notification)
        } catch (e: SecurityException) {
            Log.w(TAG, "POST_NOTIFICATIONS denied — notification dropped: title=\"$title\"")
        }
    }

    /* ---------- Foreground service notification ---------- */

    /**
     * Builds the persistent notification that is required to keep the
     * WebRtcService alive in the foreground.  The body updates dynamically
     * to reflect the current P2P connection state.
     *
     * @param context   Service context
     * @param connected True when at least one DataChannel peer is OPEN
     * @param peerCount Number of currently connected peers
     * @returns Notification shown in the status bar while the service runs
     */
    fun buildServiceNotification(
        context: Context,
        connected: Boolean = false,
        peerCount: Int = 0
    ): Notification {
        val launchIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE
        )

        // "Cycle Key" action — clears the cached AES key and triggers Phase 1
        // re-bootstrap so a fresh key is fetched over the DataChannel.
        val cycleKeyIntent = Intent(context, WebRtcService::class.java).apply {
            action = WebRtcService.ACTION_CLEAR_SIGNAL_KEY
        }
        val cycleKeyPending = PendingIntent.getService(
            context,
            1,
            cycleKeyIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val body = if (connected)
            context.getString(R.string.service_notif_connected, peerCount)
        else
            context.getString(R.string.service_notif_waiting)

        return NotificationCompat.Builder(context, CHANNEL_SERVICE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.service_notification_title))
            .setContentText(body)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .addAction(0, "Cycle Key", cycleKeyPending)
            .build()
    }

    /**
     * Updates the live foreground service notification in-place to reflect
     * the current P2P connection state.  Safe to call from any thread.
     *
     * @param context   Service context
     * @param connected True when at least one DataChannel peer is OPEN
     * @param peerCount Number of currently connected peers
     */
    fun updateServiceNotification(context: Context, connected: Boolean, peerCount: Int) {
        try {
            NotificationManagerCompat.from(context)
                .notify(NOTIFICATION_ID_SERVICE, buildServiceNotification(context, connected, peerCount))
        } catch (e: SecurityException) {
            Log.w(TAG, "POST_NOTIFICATIONS denied — service notification update dropped")
        }
    }
}
