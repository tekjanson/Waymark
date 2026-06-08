/* ============================================================
   WaymarkWebChromeClient.kt — WebChromeClient for Waymark WebView

   Handles browser-like features that Android's WebView does not
   provide by default: file chooser dialogs and permission grants
   for camera/microphone (needed for WebRTC calls and AI photo
   capture in the web app).
   ============================================================ */

package com.waymark.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.webkit.*
import androidx.core.app.ActivityCompat
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class WaymarkWebChromeClient(private val activity: Activity) : WebChromeClient() {

    /** Pending callback to deliver file URIs back to the WebView. */
    internal var filePathCallback: ValueCallback<Array<Uri>>? = null

    /** URI of the temp file created for a native camera capture, if any. */
    internal var cameraImageUri: Uri? = null

    companion object {
        internal const val FILE_CHOOSER_REQUEST = 1002
    }

    /* ---------- File chooser ---------- */

    /**
     * Called when JavaScript triggers a file picker (e.g. `<input type="file">`).
     *
     * For capture="environment" inputs we launch the native camera app directly so
     * the user gets a full-screen camera experience instead of a file-chooser dialog.
     * All other inputs use the standard chooser intent.
     */
    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams
    ): Boolean {
        // Cancel any in-flight callback first.
        this.filePathCallback?.onReceiveValue(null)
        this.filePathCallback = filePathCallback
        this.cameraImageUri = null

        val acceptImages = fileChooserParams.acceptTypes.any { it.contains("image") }

        return if (fileChooserParams.isCaptureEnabled && acceptImages) {
            // `capture="environment"` — open camera directly.
            launchNativeCamera()
        } else {
            // Standard chooser — include a camera shortcut when the input accepts images.
            val chooserIntent = buildChooserIntent(fileChooserParams, includeCamera = acceptImages)
            try {
                activity.startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST)
                true
            } catch (e: Exception) {
                this.filePathCallback = null
                false
            }
        }
    }

    /**
     * Launch the device camera directly and store the captured image in a
     * temp file so we can pass its URI back to the WebView.
     */
    private fun launchNativeCamera(): Boolean {
        return try {
            val photoFile = createTempImageFile()
            val photoUri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                photoFile
            )
            cameraImageUri = photoUri

            val cameraIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, photoUri)
            }
            activity.startActivityForResult(cameraIntent, FILE_CHOOSER_REQUEST)
            true
        } catch (e: Exception) {
            android.util.Log.e("WaymarkWebView", "Could not launch camera: ${e.message}")
            filePathCallback = null
            false
        }
    }

    /**
     * Build a chooser intent. When [includeCamera] is true, an ACTION_IMAGE_CAPTURE
     * option is prepended so the user can choose the camera or a gallery app.
     */
    private fun buildChooserIntent(
        fileChooserParams: FileChooserParams,
        includeCamera: Boolean
    ): Intent {
        val fileIntent = fileChooserParams.createIntent()

        if (!includeCamera) return fileIntent

        return try {
            val photoFile = createTempImageFile()
            val photoUri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                photoFile
            )
            cameraImageUri = photoUri

            val cameraIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, photoUri)
            }
            Intent.createChooser(fileIntent, "Select or take a photo").apply {
                putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(cameraIntent))
            }
        } catch (e: Exception) {
            fileIntent
        }
    }

    private fun createTempImageFile(): File {
        val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val storageDir = activity.getExternalFilesDir(Environment.DIRECTORY_PICTURES)
        return File.createTempFile("WAYMARK_${timestamp}_", ".jpg", storageDir)
    }

    /* ---------- Permission requests (camera + mic for WebRTC / getUserMedia) ---------- */

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
