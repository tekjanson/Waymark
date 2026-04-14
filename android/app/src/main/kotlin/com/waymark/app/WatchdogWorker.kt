/* ============================================================
   WatchdogWorker.kt — Periodic WorkManager worker that ensures
   WebRtcService is running even after aggressive OEM process kills.

   Scheduled every 15 minutes (Android WorkManager minimum).
   If the service was killed by the system or swiped away by the
   user and START_STICKY didn't fire, this worker restarts it.
   ============================================================ */

package com.waymark.app

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters

private const val TAG = "WatchdogWorker"

class WatchdogWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val prefs = applicationContext.getSharedPreferences(
            WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE
        )
        // Check that we have at least SOME sheet ID (public or private) or an
        // access token — meaning the user has logged in at least once.
        val hasPublic = (prefs.getString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, "") ?: "").isNotBlank()
        val hasPrivate = (prefs.getString(WaymarkConfig.PREF_SIGNALING_SHEET_ID, "") ?: "").isNotBlank()
        val hasToken = (prefs.getString(WaymarkConfig.PREF_ACCESS_TOKEN, "") ?: "").isNotBlank()

        if (!hasPublic && !hasPrivate && !hasToken) {
            Log.d(TAG, "No credentials cached — skipping watchdog restart")
            return Result.success()
        }

        Log.i(TAG, "Watchdog tick — ensuring WebRtcService is alive")
        // Use an actionless intent so the service re-runs resolveAndConnect()
        // through ConnectionManager, which always refreshes from Drive.
        // Using ACTION_CONNECT with a stale cached ID would bypass Drive refresh.
        val intent = Intent(applicationContext, WebRtcService::class.java)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            applicationContext.startForegroundService(intent)
        } else {
            applicationContext.startService(intent)
        }

        return Result.success()
    }
}
