/* ============================================================
   MainActivity.kt — Waymark Android main activity

   Hosts a full-screen WebView that loads the Waymark web app.
   Registers WaymarkBridge as a JavascriptInterface so the web
   app can trigger Android notifications and hand off auth tokens
   to the native WebRTC service.
   ============================================================ */

package com.waymark.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.util.Size
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.widget.SwitchCompat
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import android.hardware.camera2.CameraCharacteristics
import androidx.core.content.PermissionChecker
import androidx.lifecycle.lifecycleScope
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import java.util.concurrent.TimeUnit
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity(), GlassesController {

    private data class RearCameraOption(
        val logicalCameraId: String,
        val physicalCameraId: String?,
        val focalLength: Float,
    )

    /* ---------- Constants ---------- */

    companion object {
        private const val PERMISSION_REQUEST_NOTIFICATIONS = 1001
        private const val TARGET_STALE_TIMEOUT_MS = 900L
        private const val BRIDGE_IDLE_PUBLISH_INTERVAL_MS = 450L
        private const val CAPTURE_DEBOUNCE_MS = 600L
        private const val PREF_GLASSES_CALIBRATION = "glasses_calibration_affine"
    }

    /* ---------- State ---------- */

    private lateinit var webView: WebView
    private lateinit var bridge: WaymarkBridge
    private lateinit var cameraPreview: PreviewView
    private lateinit var pointOverlay: PointAndDetectOverlayView
    private lateinit var nativeVisionContainer: View
    private lateinit var switchVisionOverlay: SwitchCompat
    private lateinit var textBleState: TextView
    private lateinit var textSyntheticState: TextView
    private lateinit var inputDeviceName: EditText
    private lateinit var inputServiceUuid: EditText
    private lateinit var inputCharUuid: EditText
    private lateinit var inputChunkSize: EditText
    private lateinit var inputChunkDelayMs: EditText
    private lateinit var inputHudTestText: EditText
    private lateinit var buttonConnectG2: Button
    private lateinit var buttonSendHudText: Button
    private lateinit var buttonOpenG2Docs: Button
    private lateinit var buttonDemoPointing: Button
    private lateinit var buttonDemoOk: Button
    private lateinit var buttonDemoSweep: Button
    private lateinit var buttonUseLiveVision: Button
    private lateinit var buttonExitOverlay: Button
    private lateinit var buttonCaptureFeedbackFrame: Button
    private lateinit var buttonSwitchCamera: Button
    private lateinit var buttonOverlayPower: Button
    private lateinit var textG2Notice: TextView
    private lateinit var buttonShowNativePanel: Button
    private lateinit var buttonHideNativePanel: Button
    private lateinit var switchSyntheticDemo: SwitchCompat
    private lateinit var pointModeBar: View
    private lateinit var pointModeLabel: TextView
    private lateinit var switchPointMode: SwitchCompat
    private lateinit var buttonCalibrate: Button
    private lateinit var calibrationStartBar: View
    private lateinit var buttonStartCalibration: Button
    private lateinit var calibrationPanel: View
    private lateinit var calibrationTitle: TextView
    private lateinit var calibrationPrompt: TextView
    private lateinit var calibrationActionBar: View
    private lateinit var buttonCapturePoint: Button
    private lateinit var buttonCancelCalibration: Button
    private lateinit var buttonVoiceToggle: Button
    private lateinit var voiceHint: TextView
    private var latestVisionDebugState: VisionDebugState = VisionDebugState(lines = listOf("Vision: waiting for frames"))
    private var imageAnalyzer: PointAndDetectVisionSource? = null
    private var cameraExecutor: ExecutorService? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private val rearCameraOptions = mutableListOf<RearCameraOption>()
    private var activeRearCameraIndex: Int = 0
    private var syntheticVisionEnabled = false
    private var syntheticVisionScenario = SyntheticVisionScenario.POINTING
    private var lastTargetUpdateAtMs: Long = 0L
    private var lastBridgeIdleText: String = ""
    private var lastBridgeIdleState: String = "idle"
    private var lastBridgeIdlePublishAtMs: Long = 0L
    private var pointModeEnabled = true
    @Volatile private var calibrationOffsetX = 0f
    @Volatile private var calibrationOffsetY = 0f
    @Volatile private var lastHitX = 0.5f
    @Volatile private var lastHitY = 0.5f
    @Volatile private var calibrationFit: AffineFit? = null
    @Volatile private var glassesStateCache: String = "{}"
    @Volatile private var lastPublishedLabel: String = ""
    private lateinit var calibrationController: CalibrationController
    @Volatile private var calStep = 0
    @Volatile private var calTotal = 0
    @Volatile private var calPrompt = ""
    private var lastCaptureAtMs = 0L

    private val nativeScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var phoneBridgeStore: PhoneBridgeStore
    private var phoneBridgeServer: PhoneBridgeServer? = null
    private var audioCaptureManager: WaymarkAudioCaptureManager? = null
    private var phoneOrientationTracker: PhoneOrientationTracker? = null
    private var voiceCommandManager: VoiceCommandManager? = null
    private var voiceEnabled = false
    private val acousticPinger = AcousticPinger()
    private var g2GlassesManager: G2GlassesManager? = null
    private var bleStateJob: Job? = null
    private lateinit var g2ProtocolStore: G2ProtocolConfigStore
    private var hasStartedNativePipelines = false
    private val publicDocsOnlyMode = true

    /** Reference to the WebChromeClient so we can deliver file chooser results. */
    private lateinit var chromeClient: WaymarkWebChromeClient

    private val permissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grantMap ->
        val cameraGranted = grantMap[Manifest.permission.CAMERA] == true
        val micGranted = grantMap[Manifest.permission.RECORD_AUDIO] == true

        if (!cameraGranted || !micGranted) {
            Toast.makeText(this, "Camera and microphone permissions are required", Toast.LENGTH_LONG).show()
            return@registerForActivityResult
        }
        startNativePipelines()
    }

    private val blePermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grantMap ->
        val bleGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            grantMap[Manifest.permission.BLUETOOTH_SCAN] == true && grantMap[Manifest.permission.BLUETOOTH_CONNECT] == true
        } else {
            grantMap[Manifest.permission.ACCESS_FINE_LOCATION] == true || grantMap[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        }

        if (!bleGranted) {
            Toast.makeText(this, "Bluetooth permission is required for G2 connect", Toast.LENGTH_LONG).show()
            return@registerForActivityResult
        }

        reconnectG2()
    }

    /* ---------- Lifecycle ---------- */

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        NotificationHelper.createChannels(this)
        requestNotificationPermission()
        requestBatteryOptimizationExemption()
        scheduleWatchdog()

        bridge = WaymarkBridge(this)
        phoneBridgeStore = PhoneBridgeStore(this)
        phoneBridgeStore.writeIdle("Waiting for target", source = "waymark-vision", state = "idle")
        phoneOrientationTracker = PhoneOrientationTracker(this)
        startPhoneBridgeServer()
        calibrationController = CalibrationController(object : CalibrationListener {
            override fun onCalibrationStep(step: Int, total: Int, targetX: Float, targetY: Float, prompt: String) {
                calStep = step + 1
                calTotal = total
                calPrompt = prompt
                lifecycleScope.launch(Dispatchers.IO) {
                    phoneBridgeStore.writeCalibration(targetX, targetY, prompt, step + 1, total)
                }
                updateGlassesState()
                runOnUiThread { updateCalibrationUi() }
            }

            override fun onCalibrationFinished(fit: AffineFit?, capturedCount: Int) {
                acousticPinger.stop()
                calibrationFit = fit
                if (fit != null) persistCalibration(fit)
                // A successful fit re-establishes the camera↔glasses anchor; tell
                // the glasses app to re-sync its IMU fusion origin.
                if (fit != null) phoneBridgeStore.bumpCalEpoch()
                lifecycleScope.launch(Dispatchers.IO) {
                    phoneBridgeStore.writeIdle(
                        if (fit != null) "Calibration complete" else "Calibration failed",
                        source = "waymark-vision",
                        state = "idle",
                    )
                }
                runOnUiThread {
                    val msg = if (fit != null) {
                        "Calibration complete — accuracy ${"%.0f".format((1f - fit.rms.coerceIn(0f, 1f)) * 100)}%"
                    } else {
                        "Calibration failed — try again"
                    }
                    Toast.makeText(this@MainActivity, msg, Toast.LENGTH_LONG).show()
                    updateCalibrationUi()
                }
                updateGlassesState()
            }
        })
        calibrationFit = loadCalibration()
        bridge.glassesController = this
        updateGlassesState()
        g2ProtocolStore = G2ProtocolConfigStore(this)
        webView = findViewById(R.id.webView)
        nativeVisionContainer = findViewById(R.id.nativeVisionContainer)
        cameraPreview = findViewById(R.id.cameraPreviewView)
        cameraPreview.scaleType = PreviewView.ScaleType.FIT_CENTER
        pointOverlay = findViewById(R.id.pointDetectOverlay)
        switchVisionOverlay = findViewById(R.id.switchVisionOverlay)
        textBleState = findViewById(R.id.textBleState)
        textSyntheticState = findViewById(R.id.textSyntheticState)
        inputDeviceName = findViewById(R.id.inputDeviceName)
        inputServiceUuid = findViewById(R.id.inputServiceUuid)
        inputCharUuid = findViewById(R.id.inputCharUuid)
        inputChunkSize = findViewById(R.id.inputChunkSize)
        inputChunkDelayMs = findViewById(R.id.inputChunkDelayMs)
        inputHudTestText = findViewById(R.id.inputHudTestText)
        buttonConnectG2 = findViewById(R.id.buttonConnectG2)
        buttonSendHudText = findViewById(R.id.buttonSendHudText)
        buttonOpenG2Docs = findViewById(R.id.buttonOpenG2Docs)
        buttonDemoPointing = findViewById(R.id.buttonDemoPointing)
        buttonDemoOk = findViewById(R.id.buttonDemoOk)
        buttonDemoSweep = findViewById(R.id.buttonDemoSweep)
        buttonUseLiveVision = findViewById(R.id.buttonUseLiveVision)
        buttonExitOverlay = findViewById(R.id.buttonExitOverlay)
        buttonCaptureFeedbackFrame = findViewById(R.id.buttonCaptureFeedbackFrame)
        buttonSwitchCamera = findViewById(R.id.buttonSwitchCamera)
        buttonOverlayPower = findViewById(R.id.buttonOverlayPower)
        textG2Notice = findViewById(R.id.textG2Notice)
        buttonShowNativePanel = findViewById(R.id.buttonShowNativePanel)
        buttonHideNativePanel = findViewById(R.id.buttonHideNativePanel)
        switchSyntheticDemo = findViewById(R.id.switchSyntheticDemo)
        pointModeBar = findViewById(R.id.pointModeBar)
        pointModeLabel = findViewById(R.id.pointModeLabel)
        switchPointMode = findViewById(R.id.switchPointMode)
        buttonCalibrate = findViewById(R.id.buttonCalibrate)
        calibrationStartBar = findViewById(R.id.calibrationStartBar)
        buttonStartCalibration = findViewById(R.id.buttonStartCalibration)
        calibrationPanel = findViewById(R.id.calibrationPanel)
        calibrationTitle = findViewById(R.id.calibrationTitle)
        calibrationPrompt = findViewById(R.id.calibrationPrompt)
        calibrationActionBar = findViewById(R.id.calibrationActionBar)
        buttonCapturePoint = findViewById(R.id.buttonCapturePoint)
        buttonCancelCalibration = findViewById(R.id.buttonCancelCalibration)
        buttonVoiceToggle = findViewById(R.id.buttonVoiceToggle)
        voiceHint = findViewById(R.id.voiceHint)

        pointOverlay.isDeveloperModeEnabled = false
        pointOverlay.debugState = latestVisionDebugState
        nativeVisionContainer.visibility = View.GONE
        updateKeepScreenOn(false)
        updateSyntheticStateLabel()
        setupWebView()
        setupNativeControlPanel()
        setupPointModeControls()
        setupCalibrationOverlay()
        setupVoiceControls()

        webView.loadUrl(WaymarkConfig.BASE_URL)

        // Start the background WebRTC service so the orchestrator signaling
        // peer connects even before the user opens a sheet.
        startService(Intent(this, WebRtcService::class.java))

        // Start native vision pipeline on launch so phone bridge emits live
        // updates without requiring manual native panel interaction.
        if (pointModeEnabled) {
            if (hasRequiredNativePermissions()) {
                startNativePipelines()
            } else {
                requestNativeRuntimePermissions()
            }
        }
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

        // Native G2/CV tools are opt-in. Keep Waymark WebView as the default UX.
    }

    override fun onDestroy() {
        super.onDestroy()
        stopPhoneBridgeServer()
        updateKeepScreenOn(false)
        stopVisionPipeline()
        audioCaptureManager?.stopCapture()
        voiceCommandManager?.stop()
        g2GlassesManager?.disconnect()
        bleStateJob?.cancel()
        nativeScope.cancel()
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

    private fun requestNativeRuntimePermissions() {
        val required = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
        )

        if (!publicDocsOnlyMode) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                required += Manifest.permission.BLUETOOTH_SCAN
                required += Manifest.permission.BLUETOOTH_CONNECT
            } else {
                required += Manifest.permission.BLUETOOTH
                required += Manifest.permission.BLUETOOTH_ADMIN
                required += Manifest.permission.ACCESS_FINE_LOCATION
            }
        }

        val missing = required.filter {
            ContextCompat.checkSelfPermission(this, it) != PermissionChecker.PERMISSION_GRANTED
        }

        if (missing.isEmpty()) {
            startNativePipelines()
            return
        }

        permissionsLauncher.launch(missing.toTypedArray())
    }

    private fun hasRequiredNativePermissions(): Boolean {
        val baseGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PermissionChecker.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PermissionChecker.PERMISSION_GRANTED
        if (!baseGranted) return false

        if (publicDocsOnlyMode) return true

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) == PermissionChecker.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PermissionChecker.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH) == PermissionChecker.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_ADMIN) == PermissionChecker.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PermissionChecker.PERMISSION_GRANTED
        }
    }

    private fun hasRequiredBlePermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) == PermissionChecker.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) == PermissionChecker.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PermissionChecker.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PermissionChecker.PERMISSION_GRANTED
        }
    }

    private fun requestBlePermissions() {
        val required = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT,
            )
        } else {
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            )
        }
        blePermissionsLauncher.launch(required)
    }

    private fun startNativePipelines() {
        if (!hasStartedNativePipelines) {
            hasStartedNativePipelines = true
            updateKeepScreenOn(true)

            initAudioPipeline()
            if (!publicDocsOnlyMode) {
                initG2Pipeline()
            }
        }

        initVisionPipeline()
        phoneOrientationTracker?.start()
    }

    private fun initVisionPipeline() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val provider = providerFuture.get()
            cameraProvider = provider
            ensureRearCameraInventory(provider)
            val selectedCamera = currentRearCameraOption()

            val previewBuilder = Preview.Builder()
                .setTargetResolution(Size(960, 1280))
            selectedCamera?.physicalCameraId?.let { physicalId ->
                Camera2Interop.Extender(previewBuilder).setPhysicalCameraId(physicalId)
            }

            val preview = previewBuilder.build().also {
                it.setSurfaceProvider(cameraPreview.getSurfaceProvider())
            }

            val targetHandler: (PointingTarget) -> Unit = { target ->
                val hitX = target.normalizedHitPoint.x
                val hitY = target.normalizedHitPoint.y
                lastHitX = hitX
                lastHitY = hitY
                if (!calibrationController.active) {
                    // During calibration we don't publish identifications — the
                    // glasses show the target dot; the user taps Capture to record.
                    val (gx, gy) = mapHitToGlasses(hitX, hitY)
                    lastPublishedLabel = target.label
                    val camW = imageAnalyzer?.latestFrameWidth ?: 0
                    val camH = imageAnalyzer?.latestFrameHeight ?: 0
                    lifecycleScope.launch(Dispatchers.IO) {
                        phoneBridgeStore.writeLatest(
                            label = target.label,
                            confidence = target.confidence,
                            source = "waymark-vision",
                            state = "identified",
                            x = gx,
                            y = gy,
                            rawX = hitX,
                            rawY = hitY,
                            camW = if (camW > 0) camW else null,
                            camH = if (camH > 0) camH else null,
                        )
                    }
                }

                lifecycleScope.launch(Dispatchers.Main) {
                    val sourceAnalyzer = imageAnalyzer
                    if (sourceAnalyzer != null) {
                        pointOverlay.sourceFrameWidth = sourceAnalyzer.latestFrameWidth
                        pointOverlay.sourceFrameHeight = sourceAnalyzer.latestFrameHeight
                    }
                    pointOverlay.currentTarget = target
                    lastTargetUpdateAtMs = System.currentTimeMillis()
                    pointOverlay.debugState = latestVisionDebugState
                    pointOverlay.invalidate()
                    g2GlassesManager?.sendTextToHUD(target.label)
                }
            }

            val debugHandler: (VisionDebugState) -> Unit = { debugState ->
                phoneOrientationTracker?.let {
                    if (it.hasReading) phoneBridgeStore.setOrientation(it.x, it.y, it.z, it.w)
                }
                lifecycleScope.launch(Dispatchers.Main) {
                    latestVisionDebugState = debugState
                    val sourceAnalyzer = imageAnalyzer
                    if (sourceAnalyzer != null) {
                        pointOverlay.sourceFrameWidth = sourceAnalyzer.latestFrameWidth
                        pointOverlay.sourceFrameHeight = sourceAnalyzer.latestFrameHeight
                    }
                    pointOverlay.debugState = debugState
                    val shouldClearTarget = shouldClearCurrentTarget(debugState)
                    val targetStale = pointOverlay.currentTarget != null &&
                        (System.currentTimeMillis() - lastTargetUpdateAtMs) > TARGET_STALE_TIMEOUT_MS
                    val idleText = bridgeIdleTextFor(debugState)
                    val idleState = bridgeIdleStateFor(debugState)
                    if (shouldClearTarget || targetStale) {
                        pointOverlay.currentTarget = null
                        lifecycleScope.launch(Dispatchers.IO) {
                            publishBridgeIdleIfNeeded(
                                text = idleText,
                                state = idleState,
                                force = true,
                            )
                        }
                    } else {
                        lifecycleScope.launch(Dispatchers.IO) {
                            publishBridgeIdleIfNeeded(
                                text = idleText,
                                state = idleState,
                            )
                        }
                    }
                    pointOverlay.invalidate()
                }
            }

            val visionSource: PointAndDetectVisionSource = if (syntheticVisionEnabled) {
                SyntheticPointAndDetectAnalyzer(syntheticVisionScenario, targetHandler, debugHandler)
            } else {
                PointAndDetectAnalyzer(this, targetHandler, debugHandler)
            }
            imageAnalyzer = visionSource

            cameraExecutor?.shutdown()
            cameraExecutor = Executors.newSingleThreadExecutor()
            val analysisBuilder = ImageAnalysis.Builder()
                .setTargetResolution(Size(960, 1280))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            selectedCamera?.physicalCameraId?.let { physicalId ->
                Camera2Interop.Extender(analysisBuilder).setPhysicalCameraId(physicalId)
            }

            val analysis = analysisBuilder
                .build()
                .also {
                    it.setAnalyzer(cameraExecutor!!, visionSource as ImageAnalysis.Analyzer)
                }

            try {
                provider.unbindAll()
                provider.bindToLifecycle(
                    this,
                    currentCameraSelector(),
                    preview,
                    analysis,
                )
            } catch (t: Throwable) {
                hasStartedNativePipelines = false
                val leakedAnalyzer = imageAnalyzer
                imageAnalyzer = null
                cameraProvider?.unbindAll()
                val leakedExecutor = cameraExecutor
                cameraExecutor = null
                leakedExecutor?.shutdown()
                leakedAnalyzer?.close()
                Toast.makeText(this, "Failed to start camera pipeline: ${t.message}", Toast.LENGTH_LONG).show()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun initAudioPipeline() {
        val manager = WaymarkAudioCaptureManager(this, nativeScope)
        audioCaptureManager = manager

        val microphones = manager.getAvailableMicrophones()
        val primary = microphones.firstOrNull() ?: return
        val references = microphones.drop(1)
        manager.startCapture(primary, references)
    }

    private fun initG2Pipeline() {
        val manager = G2GlassesManager(this, nativeScope, currentProtocolSpec())
        g2GlassesManager = manager
        manager.connect()

        bleStateJob?.cancel()
        bleStateJob = lifecycleScope.launch {
            manager.state.collectLatest { state ->
                textBleState.text = "BLE: $state"
            }
        }
    }

    private fun setupNativeControlPanel() {
        val nativePanel = findViewById<View>(R.id.nativeControlPanel)
        nativePanel.visibility = View.GONE

        val config = g2ProtocolStore.load()
        inputDeviceName.setText(config.deviceNameHint)
        inputServiceUuid.setText(config.serviceUuid)
        inputCharUuid.setText(config.characteristicUuid)
        inputChunkSize.setText(config.chunkSizeBytes.toString())
        inputChunkDelayMs.setText(config.interChunkDelayMs.toString())
        inputHudTestText.setText("Hello from Waymark")

        if (publicDocsOnlyMode) {
            textBleState.text = "Even bridge: public docs only"
            textSyntheticState.text = "Synthetic demo: off"
            inputDeviceName.visibility = View.GONE
            inputServiceUuid.visibility = View.GONE
            inputCharUuid.visibility = View.GONE
            inputChunkSize.visibility = View.GONE
            inputChunkDelayMs.visibility = View.GONE
            inputHudTestText.visibility = View.GONE
            buttonConnectG2.text = "Open Even Setup Guide"
            buttonSendHudText.visibility = View.GONE
            textG2Notice.text = "Waymark keeps the server for sign-in and web sync, while the phone handles camera, audio, and the Even bridge setup. Install and pair the glasses in the Even app, then return here."
        }

        switchSyntheticDemo.isChecked = syntheticVisionEnabled
        switchSyntheticDemo.setOnCheckedChangeListener { _, isChecked ->
            syntheticVisionEnabled = isChecked
            updateSyntheticStateLabel()
            if (nativeVisionContainer.visibility == View.VISIBLE) {
                restartVisionPipeline()
            }
        }

        buttonDemoPointing.setOnClickListener {
            syntheticVisionEnabled = true
            syntheticVisionScenario = SyntheticVisionScenario.POINTING
            switchSyntheticDemo.isChecked = true
            updateSyntheticStateLabel()
            restartVisionPipeline()
            if (nativeVisionContainer.visibility != View.VISIBLE) {
                switchVisionOverlay.isChecked = true
            }
        }

        buttonDemoOk.setOnClickListener {
            syntheticVisionEnabled = true
            syntheticVisionScenario = SyntheticVisionScenario.OK
            switchSyntheticDemo.isChecked = true
            updateSyntheticStateLabel()
            restartVisionPipeline()
            if (nativeVisionContainer.visibility != View.VISIBLE) {
                switchVisionOverlay.isChecked = true
            }
        }

        buttonDemoSweep.setOnClickListener {
            syntheticVisionEnabled = true
            syntheticVisionScenario = SyntheticVisionScenario.SWEEP
            switchSyntheticDemo.isChecked = true
            updateSyntheticStateLabel()
            restartVisionPipeline()
            if (nativeVisionContainer.visibility != View.VISIBLE) {
                switchVisionOverlay.isChecked = true
            }
        }

        buttonUseLiveVision.setOnClickListener {
            syntheticVisionEnabled = false
            switchSyntheticDemo.isChecked = false
            updateSyntheticStateLabel()
            restartVisionPipeline()
        }

        switchVisionOverlay.isChecked = false
        switchVisionOverlay.visibility = View.GONE
        switchVisionOverlay.setOnCheckedChangeListener { _, isChecked ->
            nativeVisionContainer.visibility = if (isChecked) View.VISIBLE else View.GONE
            updateKeepScreenOn(isChecked)
            pointOverlay.isDeveloperModeEnabled = isChecked
            pointOverlay.debugState = latestVisionDebugState
            pointOverlay.invalidate()
            buttonOverlayPower.text = if (isChecked) "Turn Vision Off" else "Turn Vision On"

            if (isChecked && !hasRequiredNativePermissions()) {
                requestNativeRuntimePermissions()
            } else if (isChecked) {
                startNativePipelines()
            } else {
                stopVisionPipeline()
            }
            if (!isChecked && calibrationController.active) cancelCalibrationRoutine()
            updateCalibrationUi()
        }

        buttonConnectG2.setOnClickListener {
            if (publicDocsOnlyMode) {
                showEvenSetupGuide()
                return@setOnClickListener
            }
            g2ProtocolStore.save(readProtocolConfigFromUi())
            if (hasRequiredBlePermissions()) {
                reconnectG2()
            } else {
                requestBlePermissions()
            }
        }

        buttonSendHudText.setOnClickListener {
            if (publicDocsOnlyMode) {
                Toast.makeText(this, "Public docs only: raw HUD writes are disabled", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            val message = inputHudTestText.text?.toString().orEmpty().trim()
            if (message.isBlank()) {
                Toast.makeText(this, "Enter HUD text first", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            g2GlassesManager?.sendTextToHUD(message)
        }

        buttonOpenG2Docs.setOnClickListener {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://hub.evenrealities.com/docs/get-started/overview")))
        }

        buttonShowNativePanel.setOnClickListener {
            switchVisionOverlay.isChecked = !switchVisionOverlay.isChecked
        }
        buttonShowNativePanel.visibility = View.GONE

        buttonHideNativePanel.setOnClickListener {
            switchVisionOverlay.isChecked = false
            nativeVisionContainer.visibility = View.GONE
            stopVisionPipeline()
            updateKeepScreenOn(false)
        }
        buttonHideNativePanel.visibility = View.GONE

        buttonExitOverlay.setOnClickListener {
            switchVisionOverlay.isChecked = false
            nativeVisionContainer.visibility = View.GONE
            stopVisionPipeline()
            updateKeepScreenOn(false)
        }
        buttonExitOverlay.visibility = View.GONE

        buttonCaptureFeedbackFrame.setOnClickListener {
            val sourceAnalyzer = imageAnalyzer
            if (sourceAnalyzer == null) {
                Toast.makeText(this, "Vision pipeline is not active", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            sourceAnalyzer.requestFeedbackSnapshot()
            Toast.makeText(this, "Feedback snapshot queued", Toast.LENGTH_SHORT).show()
        }
        buttonCaptureFeedbackFrame.visibility = View.GONE

        buttonSwitchCamera.setOnClickListener {
            val provider = cameraProvider
            if (provider != null) {
                ensureRearCameraInventory(provider)
            }

            if (rearCameraOptions.size <= 1) {
                Toast.makeText(this, "Only one rear camera available", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            val nextOption = cycleRearCamera()

            if (nativeVisionContainer.visibility == View.VISIBLE) {
                restartVisionPipeline()
            }

            val label = nextOption?.let { option ->
                val focal = String.format("%.2f", option.focalLength)
                val physical = option.physicalCameraId ?: option.logicalCameraId
                "id $physical, f=$focal"
            } ?: "unknown"
            val position = activeRearCameraIndex + 1
            val count = rearCameraOptions.size
            Toast.makeText(this, "Rear camera $position/$count ($label)", Toast.LENGTH_SHORT).show()
        }
        buttonSwitchCamera.visibility = View.GONE

        buttonOverlayPower.text = "Turn Vision On"
        buttonOverlayPower.setOnClickListener {
            switchVisionOverlay.isChecked = !switchVisionOverlay.isChecked
        }
        buttonOverlayPower.setOnLongClickListener {
            val provider = cameraProvider
            if (provider != null) {
                ensureRearCameraInventory(provider)
            }

            if (rearCameraOptions.size <= 1) {
                Toast.makeText(this, "Only one rear camera available", Toast.LENGTH_SHORT).show()
                return@setOnLongClickListener true
            }

            val nextOption = cycleRearCamera()
            if (switchVisionOverlay.isChecked) {
                restartVisionPipeline()
            }

            val label = nextOption?.let { option ->
                val focal = String.format("%.2f", option.focalLength)
                val physical = option.physicalCameraId ?: option.logicalCameraId
                "id $physical, f=$focal"
            } ?: "unknown"
            val position = activeRearCameraIndex + 1
            val count = rearCameraOptions.size
            Toast.makeText(this, "Rear camera $position/$count ($label)", Toast.LENGTH_SHORT).show()
            true
        }

        if (publicDocsOnlyMode) {
            textG2Notice.visibility = View.GONE
            textBleState.visibility = View.GONE
            textSyntheticState.visibility = View.GONE
        }
    }

    @Synchronized
    private fun ensureRearCameraInventory(provider: ProcessCameraProvider) {
        val cameraManager = getSystemService(CameraManager::class.java)
        if (cameraManager == null) {
            rearCameraOptions.clear()
            activeRearCameraIndex = 0
            return
        }

        val backInfos = provider.availableCameraInfos.filter { info ->
            val lensFacing = Camera2CameraInfo.from(info).getCameraCharacteristic(CameraCharacteristics.LENS_FACING)
            lensFacing == CameraCharacteristics.LENS_FACING_BACK
        }

        if (backInfos.isEmpty()) {
            rearCameraOptions.clear()
            activeRearCameraIndex = 0
            return
        }

        val previousKey = currentRearCameraOption()?.let { option ->
            "${option.logicalCameraId}:${option.physicalCameraId ?: ""}"
        }

        val discovered = mutableListOf<RearCameraOption>()
        val seenKeys = mutableSetOf<String>()

        backInfos.forEach { info ->
            val logicalId = Camera2CameraInfo.from(info).cameraId
            val logicalChars = runCatching { cameraManager.getCameraCharacteristics(logicalId) }.getOrNull()
            val logicalFocal = logicalChars
                ?.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
                ?.minOrNull()
                ?: Float.MAX_VALUE

            val physicalIds = logicalChars?.physicalCameraIds?.toList().orEmpty()
            if (physicalIds.isEmpty()) {
                val key = "$logicalId:"
                if (seenKeys.add(key)) {
                    discovered += RearCameraOption(
                        logicalCameraId = logicalId,
                        physicalCameraId = null,
                        focalLength = logicalFocal,
                    )
                }
                return@forEach
            }

            physicalIds.forEach physicalLoop@{ physicalId ->
                val physicalChars = runCatching { cameraManager.getCameraCharacteristics(physicalId) }.getOrNull()
                val facing = physicalChars?.get(CameraCharacteristics.LENS_FACING)
                if (facing != CameraCharacteristics.LENS_FACING_BACK) return@physicalLoop

                val physicalFocal = physicalChars
                    .get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
                    ?.minOrNull()
                    ?: logicalFocal

                val key = "$logicalId:$physicalId"
                if (seenKeys.add(key)) {
                    discovered += RearCameraOption(
                        logicalCameraId = logicalId,
                        physicalCameraId = physicalId,
                        focalLength = physicalFocal,
                    )
                }
            }
        }

        val ordered = discovered.sortedWith(
            compareBy<RearCameraOption> { it.focalLength }
                .thenBy { it.logicalCameraId }
                .thenBy { it.physicalCameraId ?: "" },
        )

        rearCameraOptions.clear()
        rearCameraOptions.addAll(ordered)

        activeRearCameraIndex = if (!previousKey.isNullOrBlank()) {
            rearCameraOptions.indexOfFirst { option ->
                "${option.logicalCameraId}:${option.physicalCameraId ?: ""}" == previousKey
            }.takeIf { it >= 0 } ?: 0
        } else {
            0
        }
    }

    @Synchronized
    private fun currentRearCameraOption(): RearCameraOption? {
        if (rearCameraOptions.isEmpty()) return null
        if (activeRearCameraIndex !in rearCameraOptions.indices) {
            activeRearCameraIndex = 0
        }
        return rearCameraOptions[activeRearCameraIndex]
    }

    @Synchronized
    private fun cycleRearCamera(): RearCameraOption? {
        if (rearCameraOptions.isEmpty()) return null
        activeRearCameraIndex = (activeRearCameraIndex + 1) % rearCameraOptions.size
        return rearCameraOptions[activeRearCameraIndex]
    }

    private fun shouldClearCurrentTarget(debugState: VisionDebugState): Boolean {
        val lines = debugState.lines.joinToString(" ").lowercase()
        return lines.contains("lock: none") ||
            lines.contains("shape: unknown") ||
            lines.contains("hand: no landmarks")
    }

    @Synchronized
    private fun publishBridgeIdleIfNeeded(text: String, state: String, force: Boolean = false) {
        // While calibrating, the bridge must hold the "calibrate" target dot so
        // the glasses keep drawing it. Never let the per-frame vision loop
        // overwrite it with an idle "waiting" state.
        if (calibrationController.active) return
        val now = System.currentTimeMillis()
        val textChanged = text != lastBridgeIdleText || state != lastBridgeIdleState
        val timedOut = (now - lastBridgeIdlePublishAtMs) >= BRIDGE_IDLE_PUBLISH_INTERVAL_MS
        if (!force && !textChanged && !timedOut) return

        phoneBridgeStore.writeIdle(text = text, source = "waymark-vision", state = state)
        lastBridgeIdleText = text
        lastBridgeIdleState = state
        lastBridgeIdlePublishAtMs = now
    }

    private fun bridgeIdleTextFor(debugState: VisionDebugState): String {
        val lines = debugState.lines.joinToString(" ").lowercase()
        return when {
            lines.contains("hand: no landmarks") -> "No hand detected"
            lines.contains("shape: unknown") -> "Show pointing gesture"
            lines.contains("lock: none") -> "Aiming..."
            else -> "Waiting for target"
        }
    }

    private fun bridgeIdleStateFor(debugState: VisionDebugState): String {
        val lines = debugState.lines.joinToString(" ").lowercase()
        return when {
            lines.contains("hand: no landmarks") -> "no-hand"
            lines.contains("shape: unknown") -> "gesture-unknown"
            lines.contains("lock: none") -> "tracking"
            else -> "idle"
        }
    }

    private fun currentCameraSelector(): CameraSelector {
        val selectedRear = currentRearCameraOption()
        val selectedLogicalId = selectedRear?.logicalCameraId
        if (selectedLogicalId.isNullOrBlank()) {
            return CameraSelector.Builder()
                .requireLensFacing(CameraSelector.LENS_FACING_BACK)
                .build()
        }

        return CameraSelector.Builder()
            .requireLensFacing(CameraSelector.LENS_FACING_BACK)
            .addCameraFilter { infos ->
                val matching = infos.filter { info ->
                    Camera2CameraInfo.from(info).cameraId == selectedLogicalId
                }
                if (matching.isNotEmpty()) matching else infos
            }
            .build()
    }

    private fun updateKeepScreenOn(enabled: Boolean) {
        if (enabled) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            cameraPreview.keepScreenOn = true
            nativeVisionContainer.keepScreenOn = true
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            cameraPreview.keepScreenOn = false
            nativeVisionContainer.keepScreenOn = false
        }
    }

    private fun startPhoneBridgeServer() {
        if (phoneBridgeServer != null) return
        val server = PhoneBridgeServer(phoneBridgeStore, PhoneBridgeServer.DEFAULT_PORT)
        try {
            server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            phoneBridgeServer = server
            Log.i("PhoneBridge", "Local bridge started on :${PhoneBridgeServer.DEFAULT_PORT}")
        } catch (t: Throwable) {
            Log.e("PhoneBridge", "Failed to start local bridge", t)
            Toast.makeText(this, "Phone bridge failed: ${t.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun stopPhoneBridgeServer() {
        phoneBridgeServer?.stop()
        phoneBridgeServer = null
    }

    /* ---------- Point Mode (native control) ---------- */

    private fun setupPointModeControls() {
        pointModeBar.visibility = View.VISIBLE
        switchPointMode.isChecked = pointModeEnabled
        switchPointMode.setOnCheckedChangeListener { _, checked -> setPointMode(checked) }
        // Tap runs the full guided point-at-target routine; long-press does a
        // quick centre calibration. Both work natively so the pipeline is
        // testable with `make android-install` (no web deploy needed).
        buttonCalibrate.setOnClickListener { enterCalibrationOverlay() }
        buttonCalibrate.setOnLongClickListener { calibratePointMode(); true }
        updatePointModeUi()
    }

    /**
     * Toggle the on-phone vision producer. ON streams identifications to the
     * Even bridge; OFF stops the camera pipeline and parks the bridge so the
     * glasses show a clear "off" state.
     */
    private fun setPointMode(enabled: Boolean) {
        pointModeEnabled = enabled
        if (enabled) {
            if (hasRequiredNativePermissions()) {
                startNativePipelines()
            } else {
                requestNativeRuntimePermissions()
            }
            phoneBridgeStore.writeIdle("Point mode on", source = "waymark-vision", state = "idle")
        } else {
            stopVisionPipeline()
            phoneBridgeStore.writeIdle("Point mode off", source = "waymark-vision", state = "off")
        }
        updatePointModeUi()
    }

    /**
     * Calibrate the highlight so the object currently under the pointer maps to
     * the center of the glasses view. Captures the offset applied to every
     * subsequent published position.
     */
    private fun calibratePointMode() {
        calibrationOffsetX = 0.5f - lastHitX
        calibrationOffsetY = 0.5f - lastHitY
        Toast.makeText(this, "Calibrated — pointer centered on glasses", Toast.LENGTH_SHORT).show()
    }

    private fun updatePointModeUi() {
        pointModeLabel.text = if (pointModeEnabled) "Point Mode" else "Point Mode (off)"
        buttonCalibrate.isEnabled = pointModeEnabled
        buttonCalibrate.alpha = if (pointModeEnabled) 1f else 0.5f
    }

    /* ---------- Spatial calibration + glasses web bridge ---------- */

    /** Map a camera pointing hit to glasses space via the fitted affine (or offset fallback). */
    private fun mapHitToGlasses(hx: Float, hy: Float): Pair<Float, Float> {
        val fit = calibrationFit
        return if (fit != null) {
            val (gx, gy) = fit.apply(hx, hy)
            gx.coerceIn(0f, 1f) to gy.coerceIn(0f, 1f)
        } else {
            (hx + calibrationOffsetX).coerceIn(0f, 1f) to (hy + calibrationOffsetY).coerceIn(0f, 1f)
        }
    }

    private fun startCalibrationRoutine() {
        if (!pointModeEnabled) setPointMode(true)
        if (!hasRequiredNativePermissions()) {
            requestNativeRuntimePermissions()
            Toast.makeText(this, "Grant camera access, then start calibration", Toast.LENGTH_LONG).show()
            return
        }
        calibrationController.start()
        // The chirp shares the audio channel with voice; only ping when the mic
        // isn't being used for speech, so it can't false-trigger a command.
        if (!voiceEnabled) acousticPinger.start()
        updateGlassesState()
        updateCalibrationUi()
    }

    private fun cancelCalibrationRoutine() {
        calibrationController.cancel()
        acousticPinger.stop()
        lifecycleScope.launch(Dispatchers.IO) {
            phoneBridgeStore.writeIdle("Calibration cancelled", source = "waymark-vision", state = "idle")
        }
        updateGlassesState()
        updateCalibrationUi()
    }

    private fun setupCalibrationOverlay() {
        buttonStartCalibration.setOnClickListener { startCalibrationRoutine() }
        buttonCapturePoint.setOnClickListener { captureCalibrationPoint() }
        buttonCancelCalibration.setOnClickListener { cancelCalibrationRoutine() }
    }

    /* ---------- Voice control (hands-free) ---------- */

    private fun setupVoiceControls() {
        voiceCommandManager = VoiceCommandManager(
            context = this,
            onCommand = { cmd -> runOnUiThread { onVoiceCommand(cmd) } },
            onListeningChanged = { listening ->
                runOnUiThread {
                    buttonVoiceToggle.text = if (listening) "\uD83C\uDFA4 Listening\u2026" else "\uD83C\uDFA4 Voice"
                    voiceHint.visibility = if (listening) View.VISIBLE else View.GONE
                }
            },
        )
        buttonVoiceToggle.setOnClickListener { toggleVoice() }
        if (voiceCommandManager?.available != true) {
            buttonVoiceToggle.isEnabled = false
            buttonVoiceToggle.alpha = 0.5f
        }
    }

    private fun toggleVoice() {
        if (voiceEnabled) { stopVoice(); return }
        if (!hasRequiredNativePermissions()) {
            requestNativeRuntimePermissions()
            Toast.makeText(this, "Grant microphone access for voice control", Toast.LENGTH_LONG).show()
            return
        }
        // Speech recognition owns the mic; park the raw capture stub and the
        // acoustic chirp (which the mic would otherwise hear as a command).
        audioCaptureManager?.stopCapture()
        acousticPinger.stop()
        voiceEnabled = true
        voiceCommandManager?.start()
    }

    private fun stopVoice() {
        if (!voiceEnabled) return
        voiceEnabled = false
        voiceCommandManager?.stop()
    }

    private fun onVoiceCommand(cmd: VoiceCommandManager.VoiceCommand) {
        when (cmd) {
            VoiceCommandManager.VoiceCommand.VISION_ON ->
                if (nativeVisionContainer.visibility != View.VISIBLE) switchVisionOverlay.isChecked = true
            VoiceCommandManager.VoiceCommand.EXIT -> {
                if (calibrationController.active) cancelCalibrationRoutine()
                switchVisionOverlay.isChecked = false
            }
            VoiceCommandManager.VoiceCommand.CALIBRATE ->
                if (nativeVisionContainer.visibility != View.VISIBLE) enterCalibrationOverlay()
                else if (!calibrationController.active) startCalibrationRoutine()
            VoiceCommandManager.VoiceCommand.CAPTURE ->
                if (calibrationController.active) captureCalibrationPoint()
            VoiceCommandManager.VoiceCommand.CANCEL ->
                if (calibrationController.active) cancelCalibrationRoutine()
            VoiceCommandManager.VoiceCommand.RECENTER -> {
                phoneBridgeStore.bumpCalEpoch()
                Toast.makeText(this, "Recentered \u2014 glasses re-synced to current pose", Toast.LENGTH_SHORT).show()
            }
        }
        voiceHint.text = "Heard: ${cmd.name.lowercase()}"
    }

    /** Open the full-screen vision overlay ready to calibrate. */
    private fun enterCalibrationOverlay() {
        if (!hasRequiredNativePermissions()) {
            requestNativeRuntimePermissions()
            Toast.makeText(this, "Grant camera access to calibrate", Toast.LENGTH_LONG).show()
            return
        }
        if (!pointModeEnabled) setPointMode(true)
        switchVisionOverlay.isChecked = true   // reveals the camera overlay + starts the pipeline
        updateCalibrationUi()
    }

    /** Record the current pointing position for the active calibration target. */
    private fun captureCalibrationPoint() {
        if (!calibrationController.active) return
        // Debounce: a double-fire would silently skip a calibration target and
        // degrade the fit. Ignore taps that land within the guard window.
        val now = System.currentTimeMillis()
        if (now - lastCaptureAtMs < CAPTURE_DEBOUNCE_MS) return
        lastCaptureAtMs = now
        buttonCapturePoint.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
        calibrationController.captureManual(lastHitX, lastHitY)
    }

    /** Reflect overlay + calibration state in the native vision-overlay controls. */
    private fun updateCalibrationUi() {
        val overlayOn = nativeVisionContainer.visibility == View.VISIBLE
        val calibrating = calibrationController.active
        // buttonOverlayPower is the topmost root view; hide it while the overlay
        // is open so it never covers the in-overlay calibration controls.
        buttonOverlayPower.visibility = if (overlayOn) View.GONE else View.VISIBLE
        buttonVoiceToggle.visibility = if (overlayOn) View.VISIBLE else View.GONE
        pointModeBar.visibility = if (overlayOn) View.GONE else View.VISIBLE
        buttonExitOverlay.visibility = if (overlayOn && !calibrating) View.VISIBLE else View.GONE
        calibrationStartBar.visibility = if (overlayOn && !calibrating) View.VISIBLE else View.GONE
        calibrationPanel.visibility = if (overlayOn && calibrating) View.VISIBLE else View.GONE
        calibrationActionBar.visibility = if (overlayOn && calibrating) View.VISIBLE else View.GONE
        if (calibrating) {
            calibrationTitle.text = "Calibration · Point $calStep of $calTotal"
            if (calPrompt.isNotBlank()) calibrationPrompt.text = calPrompt
        }
    }

    private fun persistCalibration(fit: AffineFit) {
        getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(PREF_GLASSES_CALIBRATION, fit.toJsonObject().toString()).apply()
    }

    private fun loadCalibration(): AffineFit? {
        val s = getSharedPreferences(WaymarkConfig.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(PREF_GLASSES_CALIBRATION, null) ?: return null
        return runCatching { AffineFit.fromJsonObject(JSONObject(s)) }.getOrNull()
    }

    @Synchronized
    private fun updateGlassesState() {
        val o = JSONObject()
            .put("pointMode", pointModeEnabled)
            .put("calibrating", calibrationController.active)
            .put("step", calibrationController.step)
            .put("steps", calibrationController.total)
            .put("captured", calibrationController.capturedCount)
            .put("calibrated", calibrationFit != null)
            .put("lastLabel", lastPublishedLabel)
        calibrationController.currentTarget?.let { o.put("prompt", it.prompt) }
        calibrationFit?.let { o.put("quality", it.rms.toDouble()) }
        glassesStateCache = o.toString()
    }

    /* GlassesController — invoked from the JS bridge (background thread). */

    override fun glassesSetPointMode(enabled: Boolean) {
        runOnUiThread { setPointMode(enabled); updateGlassesState() }
    }

    override fun glassesIsPointModeEnabled(): Boolean = pointModeEnabled

    override fun glassesStartCalibration() {
        runOnUiThread { startCalibrationRoutine() }
    }

    override fun glassesCancelCalibration() {
        runOnUiThread { cancelCalibrationRoutine() }
    }

    override fun glassesStateJson(): String = glassesStateCache

    override fun glassesSendSnapshot() {
        runOnUiThread {
            Toast.makeText(this, "Snapshot streaming is coming soon", Toast.LENGTH_SHORT).show()
        }
    }

    private fun updateSyntheticStateLabel() {
        textSyntheticState.text = if (syntheticVisionEnabled) {
            "Synthetic demo: ${syntheticVisionScenario.label}"
        } else {
            "Synthetic demo: off"
        }
    }

    private fun restartVisionPipeline() {
        stopVisionPipeline()
        if (nativeVisionContainer.visibility == View.VISIBLE) {
            startNativePipelines()
        }
    }

    private fun stopVisionPipeline() {
        val analyzer = imageAnalyzer
        imageAnalyzer = null
        cameraProvider?.unbindAll()

        val executor = cameraExecutor
        cameraExecutor = null
        executor?.shutdown()
        if (executor != null) {
            try {
                executor.awaitTermination(750, TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }

        analyzer?.close()
        latestVisionDebugState = VisionDebugState(lines = listOf("Vision: stopped"))
        pointOverlay.currentTarget = null
        pointOverlay.debugState = latestVisionDebugState
        pointOverlay.invalidate()
        phoneOrientationTracker?.stop()
        stopVoice()
        acousticPinger.stop()
    }

    private fun showEvenSetupGuide() {
        val guideText = buildString {
            appendLine("1. Install the Even Realities app on your phone from the official app store.")
            appendLine("2. Pair the G2 glasses inside the Even app first.")
            appendLine("3. Use the Even app / SDK bridge path for glasses integration.")
            appendLine("4. Return to Waymark after the glasses are paired.")
            appendLine("5. If the vision overlay is black, grant camera permission and enable the Vision Overlay switch after opening the native tools.")
        }

        AlertDialog.Builder(this)
            .setTitle("Even Setup Guide")
            .setMessage(guideText)
            .setPositiveButton("Open Even Docs") { _, _ ->
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://hub.evenrealities.com/docs/get-started/overview")))
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun reconnectG2() {
        g2GlassesManager?.disconnect()
        val manager = G2GlassesManager(this, nativeScope, currentProtocolSpec())
        g2GlassesManager = manager
        bleStateJob?.cancel()
        bleStateJob = lifecycleScope.launch {
            manager.state.collectLatest { state ->
                textBleState.text = "BLE: $state"
            }
        }
        manager.connect()
    }

    private fun readProtocolConfigFromUi(): G2ProtocolConfigStore.Config {
        val chunkSize = inputChunkSize.text?.toString()?.toIntOrNull() ?: 20
        val chunkDelay = inputChunkDelayMs.text?.toString()?.toLongOrNull() ?: 35L
        return G2ProtocolConfigStore.Config(
            deviceNameHint = inputDeviceName.text?.toString().orEmpty().trim(),
            serviceUuid = inputServiceUuid.text?.toString().orEmpty().trim(),
            characteristicUuid = inputCharUuid.text?.toString().orEmpty().trim(),
            chunkSizeBytes = chunkSize,
            interChunkDelayMs = chunkDelay,
        )
    }

    private fun currentProtocolSpec(): G2GlassesManager.G2ProtocolSpec {
        val config = readProtocolConfigFromUi().let {
            if (it.deviceNameHint.isBlank() && it.serviceUuid.isBlank() && it.characteristicUuid.isBlank()) {
                g2ProtocolStore.load()
            } else {
                it
            }
        }
        return g2ProtocolStore.toProtocolSpec(config)
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
