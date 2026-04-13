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
        val sheetId = prefs.getString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, "") ?: ""

        if (sheetId.isBlank()) {
            Log.d(TAG, "No sheet ID cached — skipping watchdog restart")
            return Result.success()
        }

        Log.i(TAG, "Watchdog tick — ensuring WebRtcService is alive")
        val intent = Intent(applicationContext, WebRtcService::class.java).apply {
            action = WebRtcService.ACTION_CONNECT
            putExtra(WebRtcService.EXTRA_SHEET_ID, sheetId)
        }

        // startForegroundService is exempt from background-start restrictions when
        // invoked from a JobScheduler-backed WorkManager worker (Android docs §10.3.5).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            applicationContext.startForegroundService(intent)
        } else {
            applicationContext.startService(intent)
        }

        return Result.success()
    }
}
