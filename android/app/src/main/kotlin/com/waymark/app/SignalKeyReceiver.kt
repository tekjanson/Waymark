package com.waymark.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

private const val TAG = "SignalKeyReceiver"

/**
 * Debug / test helper — receives adb broadcast intents to set or clear the AES
 * signal key without requiring a Google Sheets round-trip.
 *
 * The AES-256 key MUST NEVER be written to any Google Sheet.  This receiver
 * provides the test harness with a safe, local-only path to set the key that
 * mirrors what would happen in production via the WebRTC DataChannel.
 *
 * Usage:
 *   Set key:
 *     adb shell am broadcast -n com.waymark.app/.SignalKeyReceiver \
 *         -a com.waymark.app.action.SET_SIGNAL_KEY --es signalKey <64-char hex>
 *
 *   Clear key (bootstrap mode):
 *     adb shell am broadcast -n com.waymark.app/.SignalKeyReceiver \
 *         -a com.waymark.app.action.CLEAR_SIGNAL_KEY
 */
class SignalKeyReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val prefs = context.getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)

        when (intent.action) {
            WebRtcService.ACTION_SET_SIGNAL_KEY -> {
                val keyHex = intent.getStringExtra(WebRtcService.EXTRA_SIGNAL_KEY) ?: ""
                if (keyHex.length != 64) {
                    Log.w(TAG, "SET_SIGNAL_KEY: invalid key length ${keyHex.length}, expected 64")
                    return
                }
                prefs.edit()
                    .putString(WaymarkConfig.PREF_SIGNAL_KEY, keyHex)
                    .putLong(WaymarkConfig.PREF_SIGNAL_KEY_VERSION, System.currentTimeMillis())
                    .apply()
                Log.i(TAG, "Signal key set via adb broadcast (${keyHex.length / 2} bytes)")

                // Restart the service so it reconnects with the new key
                restartService(context)
            }

            WebRtcService.ACTION_CLEAR_SIGNAL_KEY -> {
                prefs.edit().remove(WaymarkConfig.PREF_SIGNAL_KEY).apply()
                Log.i(TAG, "Signal key cleared via broadcast — triggering Phase 1 re-bootstrap")
                // Send REBOOTSTRAP so the service disconnects and re-resolves
                // (no key → Phase 1 on private sheet → key exchange via DataChannel)
                rebootstrapService(context)
            }
        }
    }

    private fun restartService(context: Context) {
        val cachedSheet = context.getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(WaymarkConfig.PREF_PUBLIC_SIGNALING_ID, "") ?: ""
        if (cachedSheet.isBlank()) return

        val svcIntent = Intent(context, WebRtcService::class.java).apply {
            action = WebRtcService.ACTION_CONNECT
            putExtra(WebRtcService.EXTRA_SHEET_ID, cachedSheet)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(svcIntent)
        } else {
            context.startService(svcIntent)
        }
    }

    private fun rebootstrapService(context: Context) {
        val svcIntent = Intent(context, WebRtcService::class.java).apply {
            action = WebRtcService.ACTION_REBOOTSTRAP
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(svcIntent)
        } else {
            context.startService(svcIntent)
        }
    }
}
