/* ============================================================
   MainActivity.kt — Waymark Android main activity

   Hosts a full-screen WebView that loads the Waymark web app.
   Registers WaymarkBridge as a JavascriptInterface so the web
   app can trigger Android notifications and hand off auth tokens
   to the native WebRTC service.
   ============================================================ */

package com.waymark.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    /* ---------- Constants ---------- */

    companion object {
        private const val PERMISSION_REQUEST_NOTIFICATIONS = 1001
        private const val PERMISSION_REQUEST_CAMERA = 1004
    }

    /* ---------- State ---------- */

    private lateinit var webView: WebView
    private lateinit var bridge: WaymarkBridge

    /** Reference to the WebChromeClient so we can deliver file chooser results. */
    private lateinit var chromeClient: WaymarkWebChromeClient

    /* ---------- Lifecycle ---------- */

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        NotificationHelper.createChannels(this)
        requestNotificationPermission()
        requestCameraPermission()
        requestBatteryOptimizationExemption()
        scheduleWatchdog()

        bridge = WaymarkBridge(this)
        webView = findViewById(R.id.webView)
        setupWebView()

        webView.loadUrl(WaymarkConfig.BASE_URL)

        // Start the background WebRTC service so the orchestrator signaling
        // peer connects even before the user opens a sheet.
        startService(Intent(this, WebRtcService::class.java))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val data = intent.data ?: return
        if (data.scheme != "com.waymark.app") return

        when (data.host) {
            "auth_success" -> {
                // The server completed OAuth in the system browser and stored the
                // refresh token behind a one-time nonce.  Load /auth/exchange in
                // the WebView so the server can set the httpOnly cookie here.
                val nonce = data.getQueryParameter("nonce")
                if (!nonce.isNullOrBlank()) {
                    val exchangeUrl = Uri.parse(WaymarkConfig.BASE_URL + "/auth/exchange")
                        .buildUpon()
                        .appendQueryParameter("nonce", nonce)
                        .build()
                        .toString()
                    webView.loadUrl(exchangeUrl)
                }
            }
            "auth_error" -> {
                // Redirect the WebView to the app root with the error fragment so
                // the JS error handler can show a message to the user.
                webView.loadUrl(WaymarkConfig.BASE_URL + "#auth_error")
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Ensure WebRtcService is running whenever the app comes to the foreground.
        // The service may have been killed by Doze/battery optimization while in background,
        // so we restart it here to guarantee reconnection attempts resume.
        startService(Intent(this, WebRtcService::class.java))
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    /**
     * Deliver file-chooser results (including native camera captures) back to the WebView.
     * Without this override the filePathCallback from WaymarkWebChromeClient is never called
     * and every file/photo picker silently returns nothing.
     */
    @Deprecated("Required for file chooser — startActivityForResult is still the correct API here.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode != WaymarkWebChromeClient.FILE_CHOOSER_REQUEST) return

        val callback = chromeClient.filePathCallback ?: return
        chromeClient.filePathCallback = null

        if (resultCode != RESULT_OK) {
            callback.onReceiveValue(null)
            return
        }

        val results: Array<Uri>? = when {
            // Native camera wrote to a temp file — return that URI.
            data?.data == null && chromeClient.cameraImageUri != null -> {
                arrayOf(chromeClient.cameraImageUri!!)
            }
            // Single URI from gallery / camera chooser.
            data?.data != null -> arrayOf(data.data!!)
            // Multiple URIs from a multi-select.
            data?.clipData != null -> {
                val clip = data.clipData!!
                Array(clip.itemCount) { clip.getItemAt(it).uri }
            }
            // Fallback: try WebChromeClient parse.
            else -> WebChromeClient.FileChooserParams.parseResult(resultCode, data)
        }

        chromeClient.cameraImageUri = null
        callback.onReceiveValue(results)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_NOTIFICATIONS &&
            grantResults.isNotEmpty() &&
            grantResults[0] != PackageManager.PERMISSION_GRANTED
        ) {
            Toast.makeText(this, getString(R.string.notification_denied), Toast.LENGTH_LONG).show()
        }
    }

    /* ---------- WebView setup ---------- */

    @Suppress("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings = webView.settings

        // Enable JavaScript for the web app
        settings.javaScriptEnabled = true

        // Storage APIs required by the web app
        settings.domStorageEnabled = true
        settings.databaseEnabled = true

        // Allow the WebView to show a file chooser for uploads
        settings.allowFileAccess = false   // filesystem access not needed
        settings.allowContentAccess = false

        // Zoom controls off — the web app is responsive
        settings.setSupportZoom(false)
        settings.displayZoomControls = false
        settings.builtInZoomControls = false

        // Viewport meta tag support
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        // Cache
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // Media: allow auto-play (needed for WebRTC in the web app)
        settings.mediaPlaybackRequiresUserGesture = false

        // Append a token to the User-Agent so the server reliably identifies
        // requests from this WebView as the Android app — even if the frontend
        // code hasn't been updated — and uses the correct (cookie-free) OAuth flow.
        settings.userAgentString = "${settings.userAgentString} WaymarkAndroid/1.0"

        // Register the native bridge accessible as `Android` in JavaScript
        webView.addJavascriptInterface(bridge, "Android")

        webView.webViewClient = WaymarkWebViewClient()
        chromeClient = WaymarkWebChromeClient(this)
        webView.webChromeClient = chromeClient
    }

    /* ---------- Permission helpers ---------- */

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    PERMISSION_REQUEST_NOTIFICATIONS
                )
            }
        }
    }

    private fun requestCameraPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.CAMERA),
                PERMISSION_REQUEST_CAMERA
            )
        }
    }

    /**
     * Ask the user to exempt Waymark from battery optimization (Doze).
     *
     * Without this exemption, Android can block network access for foreground
     * services during Doze windows, which silently kills the P2P connection.
     * The system dialog is shown at most once — Android remembers the choice.
     */
    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                try {
                    startActivity(
                        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                            data = Uri.parse("package:$packageName")
                        }
                    )
                } catch (_: Exception) {
                    // Some OEMs remove this dialog — fail silently
                }
            }
        }
    }

    /**
     * Schedule a periodic watchdog that restarts [WebRtcService] every 15 minutes.
     * Survives aggressive OEM process kills where START_STICKY doesn't fire.
     * KEEP policy ensures we don't reset the schedule on every activity launch.
     */
    private fun scheduleWatchdog() {
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "waymark_watchdog",
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<WatchdogWorker>(15, TimeUnit.MINUTES).build()
        )
    }
}
