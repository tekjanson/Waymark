/* ============================================================
   BootReceiver.kt — Restart WebRtcService after device reboot.

   Without this, the background P2P service never starts after
   a reboot unless the user manually opens the app.
   ============================================================ */

package com.waymark.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

private const val TAG = "BootReceiver"

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            // HTC/Huawei fast-boot variant
            "android.intent.action.QUICKBOOT_POWERON",
            // Restart after an app update so the service picks up the new binary
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Log.i(TAG, "Boot/update event (${intent.action}) — starting WebRtcService")
                val serviceIntent = Intent(context, WebRtcService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
            }
        }
    }
}
