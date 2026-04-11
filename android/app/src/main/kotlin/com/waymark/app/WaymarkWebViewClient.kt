/* ============================================================
   WaymarkWebViewClient.kt — WebView navigation handler

   Handles navigation events inside the WebView:
   - Opens external URLs in the default browser
   - Handles the Google OAuth flow redirect
   ============================================================ */

package com.waymark.app

import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * WebViewClient for the main Waymark WebView.
 * Keeps Waymark URLs inside the WebView and redirects external
 * links (e.g. Google OAuth consent screen) to the system browser
 * so they can be handled by the OAuth redirect deep-link.
 */
class WaymarkWebViewClient : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()

        // Google OAuth consent screen — open in external browser.
        // The server's /auth/callback runs there, then redirects to
        // com.waymark.app://auth_success?nonce=X which onNewIntent catches.
        // The WebView then loads /auth/exchange to claim the session cookie.
        if (url.startsWith("https://accounts.google.com/")) {
            view.context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            return true
        }

        // Keep all Waymark app URLs inside the WebView
        if (url.startsWith(WaymarkConfig.BASE_URL) || url.startsWith("about:")) {
            return false
        }

        // Other external URLs open in the browser
        try {
            view.context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (ignored: Exception) { /* no handler installed */ }
        return true
    }
}
