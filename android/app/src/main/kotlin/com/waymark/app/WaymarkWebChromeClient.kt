/* ============================================================
   WaymarkWebChromeClient.kt — WebChromeClient for Waymark WebView

   Handles browser-like features that Android's WebView does not
   provide by default: file chooser dialogs and permission grants
   for camera/microphone (needed for WebRTC calls in the web app).
   ============================================================ */

package com.waymark.app

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import android.webkit.*
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class WaymarkWebChromeClient(private val activity: Activity) : WebChromeClient() {

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCameraUri: Uri? = null
    private var pendingPermissionRequest: PermissionRequest? = null
    private var pendingAndroidPermissions: Array<String> = emptyArray()

    companion object {
        private const val FILE_CHOOSER_REQUEST = 1002
        private const val FILE_PROVIDER_SUFFIX = ".fileprovider"
        const val WEB_PERMISSION_REQUEST = 1003
    }

    /**
     * Deliver activity results back to the active file chooser callback.
     * Returns true when the request code belongs to this chrome client.
     */
    fun handleFileChooserResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != FILE_CHOOSER_REQUEST) return false
        val fallback = if (resultCode == Activity.RESULT_OK && data == null && pendingCameraUri != null) {
            arrayOf(pendingCameraUri!!)
        } else {
            null
        }
        val results = fallback ?: FileChooserParams.parseResult(resultCode, data)
        filePathCallback?.onReceiveValue(results)
        filePathCallback = null
        pendingCameraUri = null
        return true
    }

    /* ---------- File chooser ---------- */

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams
    ): Boolean {
        this.filePathCallback?.onReceiveValue(null)
        this.filePathCallback = filePathCallback

        val intent = buildChooserIntent(fileChooserParams)
        return try {
            activity.startActivityForResult(intent, FILE_CHOOSER_REQUEST)
            true
        } catch (e: Exception) {
            this.filePathCallback = null
            pendingCameraUri = null
            false
        }
    }

    private fun buildChooserIntent(params: FileChooserParams): Intent {
        if (params.isCaptureEnabled && acceptsImages(params)) {
            createCameraIntent()?.let { return it }
        }
        return params.createIntent()
    }

    private fun acceptsImages(params: FileChooserParams): Boolean {
        val acceptTypes = params.acceptTypes
        if (acceptTypes.isNullOrEmpty()) return true
        return acceptTypes.any { type ->
            val t = type?.trim()?.lowercase(Locale.US).orEmpty()
            t.isEmpty() || t == "*/*" || t == "image/*" || t.startsWith("image/")
        }
    }

    private fun createCameraIntent(): Intent? {
        val imageFile = createTempImageFile() ?: return null
        val authority = activity.packageName + FILE_PROVIDER_SUFFIX
        val outputUri = FileProvider.getUriForFile(activity, authority, imageFile)
        pendingCameraUri = outputUri

        return Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, outputUri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun createTempImageFile(): File? {
        val dir = activity.externalCacheDir ?: activity.cacheDir
        if (!dir.exists() && !dir.mkdirs()) return null
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        return File(dir, "waymark_capture_$stamp.jpg")
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

        val needed = permissions
            .distinct()
            .filter { perm ->
                ContextCompat.checkSelfPermission(activity, perm) != PackageManager.PERMISSION_GRANTED
            }

        if (needed.isEmpty()) {
            request.grant(request.resources)
            return
        }

        pendingPermissionRequest?.deny()
        pendingPermissionRequest = request
        pendingAndroidPermissions = needed.toTypedArray()
        ActivityCompat.requestPermissions(activity, pendingAndroidPermissions, WEB_PERMISSION_REQUEST)
    }

    fun handlePermissionResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray): Boolean {
        if (requestCode != WEB_PERMISSION_REQUEST) return false

        val req = pendingPermissionRequest
        pendingPermissionRequest = null
        pendingAndroidPermissions = emptyArray()

        if (req == null) return true

        val grantedAll = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        if (grantedAll) req.grant(req.resources) else req.deny()
        return true
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
