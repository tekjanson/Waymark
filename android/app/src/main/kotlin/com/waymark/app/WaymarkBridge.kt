/* ============================================================
   WaymarkBridge.kt — JavaScript → Android interface

   Exposed to the WebView as `window.Android`. The web app calls
   these methods to hand off state to the native layer:

     Android.onAuthToken(token)      — Google access token for Sheets API
     Android.onSheetOpened(sheetId)  — The user opened a Waymark sheet
     Android.showNotification(title, body) — Direct notification request
     Android.onPeerMessage(json)     — WebRTC message from peer mesh
   ============================================================ */

package com.waymark.app

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject

/**
 * JavascriptInterface bridging the Waymark JavaScript app to
 * Android native services.
 *
 * @param context Activity context (needed for window operations)
 */
class WaymarkBridge(private val context: Context) {

    /** Reference to the hosting activity for window-level operations. */
    private val activity get() = context as? androidx.appcompat.app.AppCompatActivity

    /* ---------- Auth token handoff ---------- */

    /**
     * Called by the web app's auth.js when a fresh Google access token
     * is available. The token is forwarded to the WebRtcService so it
     * can use the Sheets API for signaling without prompting the user again.
     *
     * @param token Google OAuth access token
     */
    @JavascriptInterface
    fun onAuthToken(token: String) {
        if (token.isBlank()) return
        Log.i("WaymarkBridge", "onAuthToken called — token length=${token.length}")
        // Store token securely for the background service
        context.getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(WaymarkConfig.PREF_ACCESS_TOKEN, token)
            .putLong(WaymarkConfig.PREF_ACCESS_TOKEN_SET_MS, System.currentTimeMillis())
            .apply()

        // Start (or update) the WebRTC background service with the new token
        val intent = Intent(context, WebRtcService::class.java).apply {
            action = WebRtcService.ACTION_UPDATE_TOKEN
            putExtra(WebRtcService.EXTRA_TOKEN, token)
        }
        context.startService(intent)
    }

    /**
     * Called by the web app to provide OAuth refresh credentials so the
     * native foreground service can refresh its own access token when
     * the WebView is not active.
     *
     * Expected JSON: { "refresh_token": "...", "client_id": "...", "client_secret": "..." }
     * Optionally also: { "access_token": "...", "expiry_date": 1234567890000 }
     */
    @JavascriptInterface
    fun onAuthCredentials(credentialsJson: String) {
        try {
            val json = JSONObject(credentialsJson)
            val editor = context.getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE).edit()

            json.optString("refresh_token", "").takeIf { it.isNotBlank() }?.let {
                editor.putString(WaymarkConfig.PREF_REFRESH_TOKEN, it)
            }
            json.optString("client_id", "").takeIf { it.isNotBlank() }?.let {
                editor.putString(WaymarkConfig.PREF_CLIENT_ID, it)
            }
            json.optString("client_secret", "").takeIf { it.isNotBlank() }?.let {
                editor.putString(WaymarkConfig.PREF_CLIENT_SECRET, it)
            }
            json.optString("access_token", "").takeIf { it.isNotBlank() }?.let {
                editor.putString(WaymarkConfig.PREF_ACCESS_TOKEN, it)
                editor.putLong(WaymarkConfig.PREF_ACCESS_TOKEN_SET_MS, System.currentTimeMillis())
            }
            json.optLong("expiry_date", 0).takeIf { it > 0 }?.let {
                editor.putLong(WaymarkConfig.PREF_TOKEN_EXPIRY_MS, it)
            }

            editor.apply()
            Log.i("WaymarkBridge", "onAuthCredentials stored refresh credentials")
        } catch (e: Exception) {
            Log.e("WaymarkBridge", "Failed to parse auth credentials: ${e.message}")
        }
    }

    /* ---------- Active sheet tracking ---------- */

    /**
     * Called by the web app when the user opens a Waymark sheet.
     * The sheet ID is needed by the WebRTC service to subscribe to the
     * correct signaling rows for that sheet's peer mesh.
     *
     * @param sheetId Google Sheets spreadsheet ID
     */
    @JavascriptInterface
    fun onSheetOpened(sheetId: String) {
        if (sheetId.isBlank()) return
        // Track which content sheet is active for context purposes only.
        // The WebRtcService manages its own persistent connection to the
        // dedicated signaling sheet (resolved from .waymark-data.json at
        // startup and on token refresh) — triggering ACTION_CONNECT here
        // with the content-sheet ID would disconnect the orchestrator P2P
        // every time the user changes views, causing bad UX.
        context.getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(WaymarkConfig.PREF_ACTIVE_SHEET, sheetId)
            .apply()
    }

    /* ---------- Direct notification requests ---------- */

    /**
     * Called by the web app JavaScript when it wants to surface an
     * Android notification. Used for orchestrator messages received via
     * the WebRTC data channel inside the WebView.
     *
     * @param title Notification title
     * @param body  Notification body text
     */
    @JavascriptInterface
    fun showNotification(title: String, body: String) {
        if (title.isBlank() && body.isBlank()) return
        NotificationHelper.showMessage(context, title.take(80), body.take(240))
    }

    /* ---------- WebRTC peer message relay ---------- */

    /**
     * Called by the web app's webrtc.js when a message arrives on any
     * DataChannel. Allows the native layer to process orchestrator
     * control messages and Surface them as Android notifications.
     *
     * @param json JSON-encoded DataChannel message object
     */
    @JavascriptInterface
    fun onPeerMessage(json: String) {
        if (json.isBlank()) return
        try {
            val obj = JSONObject(json)
            val type = obj.optString("type")

            // Only process orchestrator notification messages
            if (type == "waymark-notification" || type == "orchestrator-alert") {
                val title = obj.optString("title", "Waymark")
                val body = obj.optString("body", obj.optString("message", ""))
                if (body.isNotBlank()) {
                    NotificationHelper.showMessage(context, title.take(80), body.take(240))
                }
            }
        } catch (ignored: Exception) {
            // Malformed JSON — discard silently
        }
    }

    /* ---------- Theme sync ---------- */

    /**
     * Called by the web app whenever the theme changes (dark/light).
     * Updates the Android status bar and navigation bar colors to match
     * the web app's surface color so they blend seamlessly.
     *
     * @param theme "dark" or "light"
     */
    @JavascriptInterface
    fun onThemeChanged(theme: String) {
        val isDark = theme == "dark"
        Handler(Looper.getMainLooper()).post {
            val act = activity ?: return@post
            val window = act.window
            // Surface colors mirror the CSS variables in base.css
            val surfaceColor = if (isDark) Color.parseColor("#1e293b") else Color.WHITE
            window.statusBarColor = surfaceColor
            window.navigationBarColor = surfaceColor
            val controller = WindowInsetsControllerCompat(window, window.decorView)
            controller.isAppearanceLightStatusBars = !isDark
            controller.isAppearanceLightNavigationBars = !isDark
        }
    }
}
