/* ============================================================
   WaymarkWebChromeClient.kt — WebChromeClient for Waymark WebView

   Handles browser-like features that Android's WebView does not
   provide by default: file chooser dialogs and permission grants
   for camera/microphone (needed for WebRTC calls in the web app).
   ============================================================ */

package com.waymark.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.*
import androidx.core.app.ActivityCompat

class WaymarkWebChromeClient(private val activity: Activity) : WebChromeClient() {

    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    companion object {
        private const val FILE_CHOOSER_REQUEST = 1002
    }

    /* ---------- File chooser ---------- */

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams
    ): Boolean {
        this.filePathCallback?.onReceiveValue(null)
        this.filePathCallback = filePathCallback

        val intent = fileChooserParams.createIntent()
        return try {
            activity.startActivityForResult(intent, FILE_CHOOSER_REQUEST)
            true
        } catch (e: Exception) {
            this.filePathCallback = null
            false
        }
    }

    /* ---------- Permission requests (camera + mic for WebRTC) ---------- */

    override fun onPermissionRequest(request: PermissionRequest) {
        val permissions = mutableListOf<String>()

        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources) {
            permissions.add(Manifest.permission.RECORD_AUDIO)
        }
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources) {
            permissions.add(Manifest.permission.CAMERA)
        }

        if (permissions.isEmpty()) {
            request.deny()
            return
        }

        ActivityCompat.requestPermissions(activity, permissions.toTypedArray(), 1003)
        // Grant to the WebView directly — the app-level permission request above
        // shows the system dialog; once granted, the framework won't re-show it.
        request.grant(request.resources)
    }

    /* ---------- Console messages forwarded to Android logcat ---------- */

    override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
        android.util.Log.d(
            "WaymarkWebView",
            "${consoleMessage.sourceId()}:${consoleMessage.lineNumber()} — ${consoleMessage.message()}"
        )
        return true
    }
}
