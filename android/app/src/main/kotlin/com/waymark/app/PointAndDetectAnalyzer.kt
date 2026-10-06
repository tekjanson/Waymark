/* ============================================================
   PointAndDetectAnalyzer.kt — Point-and-ask CV analyzer
   ============================================================ */

package com.waymark.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.PointF
import android.graphics.RectF
import android.graphics.Rect
import android.os.SystemClock
import android.graphics.YuvImage
import android.util.Log
import androidx.annotation.OptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector
import java.io.ByteArrayOutputStream
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class PointAndDetectAnalyzer(
    context: Context,
    private val onTargetIsolated: (PointingTarget) -> Unit,
    private val onDebugState: (VisionDebugState) -> Unit = {},
) : ImageAnalysis.Analyzer, PointAndDetectVisionSource {

    private data class SelectedHand(
        val landmarks: List<PointF>,
        val observation: HandGestureObservation?,
    )

    private data class HandDetectionResult(
        val selectedHand: SelectedHand,
        val usedRoiRecovery: Boolean,
    )

    companion object {
        private const val TAG = "PointAndDetect"
        private const val HAND_LANDMARKER_MODEL = "hand_landmarker.task"
        private const val OBJECT_DETECTOR_MODEL = "efficientdet-lite0.tflite"
        private const val REQUIRED_STABLE_FRAMES = 2
        private const val MIN_HAND_DETECTION_CONFIDENCE = 0.15f
        private const val MIN_HAND_TRACKING_CONFIDENCE = 0.15f
        private const val MIN_HAND_PRESENCE_CONFIDENCE = 0.15f
        private const val AUTO_FEEDBACK_INTERVAL_MS = 1000L
        private const val MOTION_DISTANCE_THRESHOLD = 0.02f
        private const val MOTION_ACTIVE_WINDOW_MS = 1200L
        private const val HAND_PERSISTENCE_GRACE_MS = 1400L
        private const val HAND_MAX_CONSECUTIVE_MISSES = 10
        private const val LABEL_MEMORY_WINDOW = 8
        private const val HAND_ROI_GRACE_MS = 2500L
        private const val HAND_ROI_EXPAND_FACTOR = 1.85f
        private const val HAND_ROI_MIN_SIZE_FRACTION = 0.26f
        private const val VOICE_ACTIVITY_WINDOW_MS = 1400L
        private const val ARM_MIN_CONFIDENCE = 0.62f
        private const val ARM_MIN_CONFIDENCE_VOICE = 0.50f
        private const val ARM_REQUIRED_CONSECUTIVE = 2
        private const val ARM_ENGAGE_WINDOW_MS = 2500L
        private const val ARM_MOTION_THRESHOLD = 0.03f
    }

    private val handLandmarker: HandLandmarker
    private val objectDetector: ObjectDetector
    private val detectorLock = Any()
    private val isClosed = AtomicBoolean(false)
    private val stabilizer = HandGestureStabilizer()
    private val armDirectionDetector = ArmDirectionDetector()
    private val recorder = VisionDebugRecorder(context)
    private val feedbackSnapshotRequested = AtomicBoolean(false)
    private val recentLockedLabels = ArrayDeque<String>()
    private var lastMotionFocusPoint: PointF? = null
    private var motionActiveUntilMs: Long = 0L
    private var lastAutoFeedbackAtMs: Long = 0L
    private var lastPointingObservation: HandGestureObservation? = null
    private var lastPointingKnuckle: PointF? = null
    private var lastPointingTarget: DetectedObjectCandidate? = null
    private var lastPointingSeenAtMs: Long = 0L
    private var consecutiveMissedHandFrames: Int = 0
    private var lastHandBounds: RectF? = null
    private var lastHandSeenAtMs: Long = 0L
    private var lastVisionTimestampMs: Long = 0L
    private var armConsecutive: Int = 0
    private var lastArmTip: PointF? = null
    private var lastArmMoveAtMs: Long = 0L

    override var latestFrameWidth: Int = 1

    override var latestFrameHeight: Int = 1

    override fun requestFeedbackSnapshot() {
        feedbackSnapshotRequested.set(true)
    }

    init {
        handLandmarker = createHandLandmarker(context)
        objectDetector = createObjectDetector(context)
    }

    override fun analyze(imageProxy: ImageProxy) {
        try {
            if (isClosed.get()) return

            val bitmap = imageProxyToBitmap(imageProxy) ?: return
            latestFrameWidth = bitmap.width
            latestFrameHeight = bitmap.height
            val mpImage = BitmapImageBuilder(bitmap).build()
            val frameTimestampMs = nextVisionTimestampMs()
            val debugLines = mutableListOf(
                "Mode: Live camera",
                "Frame: ${bitmap.width}x${bitmap.height}",
            )

            val handDetection = detectBestHandWithRecovery(bitmap, mpImage, frameTimestampMs)
            val selectedHand = handDetection?.selectedHand
            if (selectedHand == null) {
                consecutiveMissedHandFrames += 1

                val held = maybeEmitTrackingHold(
                    bitmap = bitmap,
                    debugLines = debugLines,
                    reason = "no_landmarks",
                )
                if (held) {
                    return
                }

                val voiceActive = InteractionSignals.isVoiceRecentlyActive(VOICE_ACTIVITY_WINDOW_MS)
                if (tryArmDirectionFallback(bitmap, mpImage, frameTimestampMs, debugLines, voiceActive)) {
                    return
                }

                debugLines += "Hand: no landmarks"
                onDebugState(VisionDebugState(lines = debugLines))
                recorder.record(
                    bitmap = bitmap,
                    landmarks = null,
                    observation = null,
                    stable = false,
                    candidates = emptyList(),
                    selected = null,
                    reason = "no_landmarks",
                )
                recordFeedbackSnapshotIfRequested(
                    bitmap = bitmap,
                    landmarks = null,
                    observation = null,
                    stable = false,
                    candidates = emptyList(),
                    selected = null,
                    stage = "no_landmarks",
                )
                return
            }
            consecutiveMissedHandFrames = 0

            val landmarks = selectedHand.landmarks
            updateLastHandMemory(landmarks)

            if (handDetection.usedRoiRecovery) {
                debugLines += "Hand: roi-recovery"
            }

            debugLines += "Hand: ${landmarks.size} landmarks"

            var observation = selectedHand.observation ?: HandGestureClassifier.classify(landmarks)
            val voiceActive = InteractionSignals.isVoiceRecentlyActive(VOICE_ACTIVITY_WINDOW_MS)
            if (voiceActive) {
                debugLines += "Voice: active ${"%.2f".format(InteractionSignals.latestVoiceLevel())}"
            }
            if (observation == null) {
                observation = inferLikelyPointingFromLandmarks(landmarks)
                if (observation != null) {
                    debugLines += "Shape: inferred-pointing"
                }
            }
            if (observation == null && voiceActive) {
                observation = inferDirectionalIntentFromLandmarks(landmarks)
                if (observation != null) {
                    debugLines += "Shape: directional-intent"
                }
            }
            if (observation == null) {
                debugLines += "Shape: unknown"
                Log.d(TAG, "frame verdict=shape_unknown landmarks=${landmarks.size}")

                val held = maybeEmitTrackingHold(
                    bitmap = bitmap,
                    debugLines = debugLines,
                    reason = "shape_unknown",
                    landmarks = landmarks,
                )
                if (held) {
                    return
                }

                onDebugState(
                    VisionDebugState(
                        lines = debugLines,
                        normalizedKnuckle = landmarks[0],
                        normalizedTip = landmarks.getOrNull(8),
                    ),
                )
                recorder.record(
                    bitmap = bitmap,
                    landmarks = landmarks,
                    observation = null,
                    stable = false,
                    candidates = emptyList(),
                    selected = null,
                    reason = "shape_unknown",
                )
                maybeRecordAutoMotionSnapshot(
                    bitmap = bitmap,
                    landmarks = landmarks,
                    observation = null,
                    stable = false,
                    candidates = emptyList(),
                    selected = null,
                    stage = "shape_unknown",
                )
                recordFeedbackSnapshotIfRequested(
                    bitmap = bitmap,
                    landmarks = landmarks,
                    observation = null,
                    stable = false,
                    candidates = emptyList(),
                    selected = null,
                    stage = "shape_unknown",
                )
                return
            }

            debugLines += "Shape: ${observation.gestureType}"
            debugLines += "Gesture conf: ${"%.2f".format(observation.confidence)}"

            val now = System.currentTimeMillis()
            if (observation.gestureType == HandGestureType.POINTING) {
                lastPointingObservation = observation
                lastPointingKnuckle = landmarks[0]
                lastPointingSeenAtMs = now
            }

            val stableObservation = stabilizer.accept(observation)
            if (stableObservation == null) {
                if (voiceActive && observation.gestureType == HandGestureType.POINTING) {
                    debugLines += "Stability: voice-assisted"
                    val immediate = observation
                    processStableObservation(
                        bitmap = bitmap,
                        landmarks = landmarks,
                        stableObservation = immediate,
                        debugLines = debugLines,
                        mpImage = mpImage,
                        frameTimestampMs = frameTimestampMs,
                    )
                    return
                }

                debugLines += "Stability: acquiring"
                Log.d(TAG, "frame verdict=stabilizing gesture=${observation.gestureType} conf=${"%.2f".format(observation.confidence)}")
                onDebugState(
                    VisionDebugState(
                        lines = debugLines,
                        normalizedKnuckle = landmarks[0],
                        normalizedTip = observation.focusPoint,
                    ),
                )
                recorder.record(
                    bitmap = bitmap,
                    landmarks = landmarks,
                    observation = observation,
                    stable = false,
                    candidates = emptyList(),
                    selected = null,
                    reason = "stabilizing",
                )
                maybeRecordAutoMotionSnapshot(
                    bitmap = bitmap,
                    landmarks = landmarks,
                    observation = observation,
                    stable = false,
                    candidates = emptyList(),
                    selected = null,
                    stage = "stabilizing",
                )
                recordFeedbackSnapshotIfRequested(
                    bitmap = bitmap,
                    landmarks = landmarks,
                    observation = observation,
                    stable = false,
                    candidates = emptyList(),
                    selected = null,
                    stage = "stabilizing",
                )
                return
            }

            processStableObservation(
                bitmap = bitmap,
                landmarks = landmarks,
                stableObservation = stableObservation,
                debugLines = debugLines,
                mpImage = mpImage,
                frameTimestampMs = frameTimestampMs,
            )
            return

        } catch (t: Throwable) {
            onDebugState(VisionDebugState(lines = listOf("Analyzer error: ${t.message ?: "unknown"}")))
            Log.e(TAG, "Analyze frame failed", t)
        } finally {
            imageProxy.close()
        }
    }

    private fun processStableObservation(
        bitmap: Bitmap,
        landmarks: List<PointF>,
        stableObservation: HandGestureObservation,
        debugLines: MutableList<String>,
        mpImage: com.google.mediapipe.framework.image.MPImage,
        frameTimestampMs: Long,
    ) {

            debugLines += "Stability: locked"

            var candidatesForDebug: List<DetectedObjectCandidate> = emptyList()
            val selectedTarget = if (stableObservation.gestureType == HandGestureType.POINTING) {
                val detections = synchronized(detectorLock) {
                    if (isClosed.get()) return
                    objectDetector.detectForVideo(mpImage, frameTimestampMs)
                }
                val candidates = extractTargets(detections)
                candidatesForDebug = candidates
                debugLines += "Objects: ${candidates.size}"
                candidates.sortedByDescending { it.score }.take(3).forEachIndexed { index, candidate ->
                    debugLines += "Obj${index + 1}: ${candidate.label} ${"%.2f".format(candidate.score)}"
                }
                PointingObjectSelector.select(
                    knuckle = landmarks[0],
                    tip = stableObservation.focusPoint,
                    boxes = candidates,
                    imageWidth = bitmap.width,
                    imageHeight = bitmap.height,
                )
            } else {
                debugLines += "Objects: skipped (OK gesture)"
                null
            }

            val target = selectedTarget
            if (target == null) {
                val fallbackTarget = if (stableObservation.gestureType == HandGestureType.POINTING) {
                    buildFallbackPointingTarget(
                        knuckle = landmarks[0],
                        tip = stableObservation.focusPoint,
                        imageWidth = bitmap.width,
                        imageHeight = bitmap.height,
                    )
                } else {
                    null
                }

                if (fallbackTarget != null) {
                    val smoothedFallback = smoothTargetLabel(fallbackTarget)
                    debugLines += "Lock: fallback region"
                    onDebugState(
                        VisionDebugState(
                            lines = debugLines,
                            normalizedKnuckle = landmarks[0],
                            normalizedTip = stableObservation.focusPoint,
                        ),
                    )
                    recorder.record(
                        bitmap = bitmap,
                        landmarks = landmarks,
                        observation = stableObservation,
                        stable = true,
                        candidates = candidatesForDebug,
                        selected = smoothedFallback,
                        reason = "locked_fallback",
                    )
                    maybeRecordAutoMotionSnapshot(
                        bitmap = bitmap,
                        landmarks = landmarks,
                        observation = stableObservation,
                        stable = true,
                        candidates = candidatesForDebug,
                        selected = smoothedFallback,
                        stage = "locked_fallback",
                    )
                    rememberPointingLock(stableObservation, landmarks[0], smoothedFallback)

                    onTargetIsolated(
                        PointingTarget(
                            label = smoothedFallback.label,
                            confidence = smoothedFallback.score,
                            boundingBox = smoothedFallback.box,
                            normalizedKnuckle = landmarks[0],
                            normalizedTip = stableObservation.focusPoint,
                            normalizedHitPoint = pointF(
                                ((smoothedFallback.box.left + smoothedFallback.box.right) / 2f) / bitmap.width,
                                ((smoothedFallback.box.top + smoothedFallback.box.bottom) / 2f) / bitmap.height,
                            ),
                            gestureType = stableObservation.gestureType,
                        ),
                    )
                    return
                }

                debugLines += "Lock: none"
                Log.d(TAG, "frame verdict=no_lock gesture=${stableObservation.gestureType}")
                onDebugState(
                    VisionDebugState(
                        lines = debugLines,
                        normalizedKnuckle = landmarks[0],
                        normalizedTip = stableObservation.focusPoint,
                    ),
                )
                recorder.record(
                    bitmap = bitmap,
                    landmarks = landmarks,
                    observation = stableObservation,
                    stable = true,
                    candidates = candidatesForDebug,
                    selected = null,
                    reason = "no_lock",
                )
                maybeRecordAutoMotionSnapshot(
                    bitmap = bitmap,
                    landmarks = landmarks,
                    observation = stableObservation,
                    stable = true,
                    candidates = candidatesForDebug,
                    selected = null,
                    stage = "no_lock",
                )
                recordFeedbackSnapshotIfRequested(
                    bitmap = bitmap,
                    landmarks = landmarks,
                    observation = stableObservation,
                    stable = true,
                    candidates = candidatesForDebug,
                    selected = null,
                    stage = "no_lock",
                )
                return
            }

            val smoothedTarget = smoothTargetLabel(target)

            debugLines += "Lock: ${smoothedTarget.label} ${"%.2f".format(smoothedTarget.score)}"
            Log.d(TAG, "frame verdict=locked target=${smoothedTarget.label} score=${"%.2f".format(smoothedTarget.score)}")
            onDebugState(
                VisionDebugState(
                    lines = debugLines,
                    normalizedKnuckle = landmarks[0],
                    normalizedTip = stableObservation.focusPoint,
                ),
            )
            recorder.record(
                bitmap = bitmap,
                landmarks = landmarks,
                observation = stableObservation,
                stable = true,
                candidates = listOf(smoothedTarget),
                selected = smoothedTarget,
                reason = "locked",
            )
            maybeRecordAutoMotionSnapshot(
                bitmap = bitmap,
                landmarks = landmarks,
                observation = stableObservation,
                stable = true,
                candidates = candidatesForDebug,
                selected = smoothedTarget,
                stage = "locked",
            )
            recordFeedbackSnapshotIfRequested(
                bitmap = bitmap,
                landmarks = landmarks,
                observation = stableObservation,
                stable = true,
                candidates = candidatesForDebug,
                selected = smoothedTarget,
                stage = "locked",
            )
            rememberPointingLock(stableObservation, landmarks[0], smoothedTarget)

            onTargetIsolated(
                PointingTarget(
                    label = smoothedTarget.label,
                    confidence = smoothedTarget.score,
                    boundingBox = smoothedTarget.box,
                    normalizedKnuckle = landmarks[0],
                    normalizedTip = stableObservation.focusPoint,
                    normalizedHitPoint = pointF(
                        ((smoothedTarget.box.left + smoothedTarget.box.right) / 2f) / bitmap.width,
                        ((smoothedTarget.box.top + smoothedTarget.box.bottom) / 2f) / bitmap.height,
                    ),
                    gestureType = stableObservation.gestureType,
                )
            )
    }

    /**
     * Landmark-free pointing path for the behind-the-shoulder perspective.
     * When MediaPipe finds no hand, we read the arm as a skin region entering
     * the frame and point along its axis. Voice activity lowers the bar since
     * a talking user with an outstretched arm is very likely pointing.
     */
    private fun tryArmDirectionFallback(
        bitmap: Bitmap,
        mpImage: com.google.mediapipe.framework.image.MPImage,
        frameTimestampMs: Long,
        debugLines: MutableList<String>,
        voiceActive: Boolean,
    ): Boolean {
        val arm = armDirectionDetector.detect(bitmap)
        if (arm == null) {
            armConsecutive = 0
            lastArmTip = null
            return false
        }

        val minConfidence = if (voiceActive) ARM_MIN_CONFIDENCE_VOICE else ARM_MIN_CONFIDENCE
        if (arm.confidence < minConfidence) {
            armConsecutive = 0
            lastArmTip = null
            return false
        }

        // Temporal engagement gate: a real point is a transient gesture (the arm
        // moves into position), while a static torso / face / window blob sits
        // still. Require recent motion OR voice, plus a couple of frames of
        // persistence, before emitting a lock. This kills static-background FPs.
        val now = System.currentTimeMillis()
        val prevTip = lastArmTip
        val moved = prevTip == null || motionDistance(prevTip, arm.tip) > ARM_MOTION_THRESHOLD
        if (moved) lastArmMoveAtMs = now
        lastArmTip = arm.tip
        armConsecutive = (armConsecutive + 1).coerceAtMost(10)

        val engaged = voiceActive || (now - lastArmMoveAtMs) <= ARM_ENGAGE_WINDOW_MS
        if (armConsecutive < ARM_REQUIRED_CONSECUTIVE || !engaged) {
            debugLines += "Arm: present, awaiting intent (static)"
            onDebugState(
                VisionDebugState(
                    lines = debugLines,
                    normalizedKnuckle = arm.entry,
                    normalizedTip = arm.tip,
                ),
            )
            return true
        }

        val boosted = (arm.confidence + if (voiceActive) 0.15f else 0f).coerceIn(0f, 0.95f)
        debugLines += "Arm: direction cue ${"%.2f".format(arm.confidence)}"
        if (voiceActive) {
            debugLines += "Arm: voice-assisted"
        }

        val observation = HandGestureObservation(
            gestureType = HandGestureType.POINTING,
            confidence = boosted,
            focusPoint = arm.tip,
            boundingBox = rectF(
                min(arm.entry.x, arm.tip.x),
                min(arm.entry.y, arm.tip.y),
                max(arm.entry.x, arm.tip.x),
                max(arm.entry.y, arm.tip.y),
            ),
        )

        processStableObservation(
            bitmap = bitmap,
            landmarks = listOf(arm.entry, arm.tip),
            stableObservation = observation,
            debugLines = debugLines,
            mpImage = mpImage,
            frameTimestampMs = frameTimestampMs,
        )
        return true
    }

    override fun close() {
        if (!isClosed.compareAndSet(false, true)) return
        synchronized(detectorLock) {
            handLandmarker.close()
            objectDetector.close()
        }
    }

    private fun createHandLandmarker(context: Context): HandLandmarker {
        val common = HandLandmarker.HandLandmarkerOptions.builder()
            .setBaseOptions(
                BaseOptions.builder()
                    .setModelAssetPath(HAND_LANDMARKER_MODEL)
                    .setDelegate(Delegate.GPU)
                    .build(),
            )
            .setNumHands(2)
            .setMinHandDetectionConfidence(MIN_HAND_DETECTION_CONFIDENCE)
            .setMinTrackingConfidence(MIN_HAND_TRACKING_CONFIDENCE)
            .setMinHandPresenceConfidence(MIN_HAND_PRESENCE_CONFIDENCE)
            .setRunningMode(RunningMode.VIDEO)

        return runCatching {
            HandLandmarker.createFromOptions(context, common.build())
        }.getOrElse {
            Log.w(TAG, "GPU hand landmarker unavailable, falling back to CPU", it)
            HandLandmarker.createFromOptions(
                context,
                HandLandmarker.HandLandmarkerOptions.builder()
                    .setBaseOptions(
                        BaseOptions.builder()
                            .setModelAssetPath(HAND_LANDMARKER_MODEL)
                            .setDelegate(Delegate.CPU)
                            .build(),
                    )
                    .setNumHands(2)
                        .setMinHandDetectionConfidence(MIN_HAND_DETECTION_CONFIDENCE)
                        .setMinTrackingConfidence(MIN_HAND_TRACKING_CONFIDENCE)
                        .setMinHandPresenceConfidence(MIN_HAND_PRESENCE_CONFIDENCE)
                    .setRunningMode(RunningMode.VIDEO)
                    .build(),
            )
        }
    }

    private fun createObjectDetector(context: Context): ObjectDetector {
        val common = ObjectDetector.ObjectDetectorOptions.builder()
            .setBaseOptions(
                BaseOptions.builder()
                    .setModelAssetPath(OBJECT_DETECTOR_MODEL)
                    .setDelegate(Delegate.GPU)
                    .build(),
            )
            .setRunningMode(RunningMode.VIDEO)
            .setMaxResults(5)

        return runCatching {
            ObjectDetector.createFromOptions(context, common.build())
        }.getOrElse {
            Log.w(TAG, "GPU object detector unavailable, falling back to CPU", it)
            ObjectDetector.createFromOptions(
                context,
                ObjectDetector.ObjectDetectorOptions.builder()
                    .setBaseOptions(
                        BaseOptions.builder()
                            .setModelAssetPath(OBJECT_DETECTOR_MODEL)
                            .setDelegate(Delegate.CPU)
                            .build(),
                    )
                    .setRunningMode(RunningMode.VIDEO)
                    .setMaxResults(5)
                    .build(),
            )
        }
    }

    private fun nextVisionTimestampMs(): Long {
        val now = SystemClock.elapsedRealtime()
        val monotonic = if (now > lastVisionTimestampMs) now else (lastVisionTimestampMs + 1L)
        lastVisionTimestampMs = monotonic
        return monotonic
    }

    @OptIn(ExperimentalGetImage::class)
    private fun imageProxyToBitmap(imageProxy: ImageProxy): Bitmap? {
        val image = imageProxy.image ?: return null
        if (image.format != ImageFormat.YUV_420_888) {
            return null
        }

        val yBuffer = image.planes[0].buffer
        val uBuffer = image.planes[1].buffer
        val vBuffer = image.planes[2].buffer

        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()

        val nv21 = ByteArray(ySize + uSize + vSize)
        yBuffer.get(nv21, 0, ySize)
        vBuffer.get(nv21, ySize, vSize)
        uBuffer.get(nv21, ySize + vSize, uSize)

        val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), 90, out)
        val bytes = out.toByteArray()
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        val rotation = imageProxy.imageInfo.rotationDegrees
        if (rotation == 0) return decoded

        val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
        return Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    }

    private fun extractBestHand(handResult: Any): SelectedHand? {
        val landmarksMethod = handResult.javaClass.methods.firstOrNull { it.name == "landmarks" } ?: return null
        val handLandmarks = landmarksMethod.invoke(handResult) as? List<*> ?: return null

        var firstValid: SelectedHand? = null
        var bestGesture: SelectedHand? = null

        for (rawHand in handLandmarks) {
            val hand = rawHand as? List<*> ?: continue
            if (hand.size < 21) continue

            val points = mutableListOf<PointF>()
            var valid = true
            for (landmark in hand) {
                if (landmark == null) {
                    valid = false
                    break
                }
                val lm = landmark
                val x = invokeFloat(lm, "x")
                val y = invokeFloat(lm, "y")
                if (x == null || y == null) {
                    valid = false
                    break
                }
                points += pointF(x, y)
            }
            if (!valid || points.size < 21) continue

            val observation = HandGestureClassifier.classify(points)
            val candidate = SelectedHand(landmarks = points, observation = observation)

            if (firstValid == null) firstValid = candidate

            if (observation != null) {
                if (bestGesture == null) {
                    bestGesture = candidate
                } else {
                    val currentBest = bestGesture
                    val bestType = currentBest.observation?.gestureType
                    val isBetterType =
                        observation.gestureType == HandGestureType.POINTING && bestType != HandGestureType.POINTING
                    val isHigherConfidence = observation.confidence > (currentBest.observation?.confidence ?: -1f)
                    if (isBetterType || isHigherConfidence) {
                        bestGesture = candidate
                    }
                }
            }
        }

        return bestGesture ?: firstValid
    }

    private fun detectBestHandWithRecovery(
        bitmap: Bitmap,
        fullImage: com.google.mediapipe.framework.image.MPImage,
        frameTimestampMs: Long,
    ): HandDetectionResult? {
        val selectedFullFrame = synchronized(detectorLock) {
            if (isClosed.get()) return null
            extractBestHand(handLandmarker.detectForVideo(fullImage, frameTimestampMs))
        }

        if (selectedFullFrame != null) {
            return HandDetectionResult(selectedHand = selectedFullFrame, usedRoiRecovery = false)
        }

        if (!shouldTryHandRoiRecovery()) {
            return null
        }

        val roiBounds = lastHandBounds ?: return null
        val cropRect = buildRoiCropRect(bitmap.width, bitmap.height, roiBounds)
        if (cropRect.width() < 2 || cropRect.height() < 2) {
            return null
        }

        val cropped = Bitmap.createBitmap(bitmap, cropRect.left, cropRect.top, cropRect.width(), cropRect.height())
        val roiImage = BitmapImageBuilder(cropped).build()
        val roiTimestampMs = nextVisionTimestampMs()

        val roiSelected = synchronized(detectorLock) {
            if (isClosed.get()) return null
            extractBestHand(handLandmarker.detectForVideo(roiImage, roiTimestampMs))
        } ?: return null

        val mappedLandmarks = roiSelected.landmarks.map { point ->
            pointF(
                ((cropRect.left + point.x * cropRect.width()) / bitmap.width.toFloat()).coerceIn(0f, 1f),
                ((cropRect.top + point.y * cropRect.height()) / bitmap.height.toFloat()).coerceIn(0f, 1f),
            )
        }

        val mappedObservation = roiSelected.observation?.let { observation ->
            val mappedFocus = pointF(
                ((cropRect.left + observation.focusPoint.x * cropRect.width()) / bitmap.width.toFloat()).coerceIn(0f, 1f),
                ((cropRect.top + observation.focusPoint.y * cropRect.height()) / bitmap.height.toFloat()).coerceIn(0f, 1f),
            )

            val mappedBox = rectF(
                ((cropRect.left + observation.boundingBox.left * cropRect.width()) / bitmap.width.toFloat()).coerceIn(0f, 1f),
                ((cropRect.top + observation.boundingBox.top * cropRect.height()) / bitmap.height.toFloat()).coerceIn(0f, 1f),
                ((cropRect.left + observation.boundingBox.right * cropRect.width()) / bitmap.width.toFloat()).coerceIn(0f, 1f),
                ((cropRect.top + observation.boundingBox.bottom * cropRect.height()) / bitmap.height.toFloat()).coerceIn(0f, 1f),
            )

            observation.copy(focusPoint = mappedFocus, boundingBox = mappedBox)
        }

        return HandDetectionResult(
            selectedHand = SelectedHand(mappedLandmarks, mappedObservation),
            usedRoiRecovery = true,
        )
    }

    private fun shouldTryHandRoiRecovery(): Boolean {
        val lastBounds = lastHandBounds ?: return false
        if (lastBounds.width() <= 0f || lastBounds.height() <= 0f) return false
        return (System.currentTimeMillis() - lastHandSeenAtMs) <= HAND_ROI_GRACE_MS
    }

    private fun updateLastHandMemory(landmarks: List<PointF>) {
        if (landmarks.isEmpty()) return

        val minX = landmarks.minOf { it.x }
        val maxX = landmarks.maxOf { it.x }
        val minY = landmarks.minOf { it.y }
        val maxY = landmarks.maxOf { it.y }
        val padding = 0.06f

        lastHandBounds = rectF(
            (minX - padding).coerceIn(0f, 1f),
            (minY - padding).coerceIn(0f, 1f),
            (maxX + padding).coerceIn(0f, 1f),
            (maxY + padding).coerceIn(0f, 1f),
        )
        lastHandSeenAtMs = System.currentTimeMillis()
    }

    private fun buildRoiCropRect(imageWidth: Int, imageHeight: Int, bounds: RectF): Rect {
        val minWidth = imageWidth * HAND_ROI_MIN_SIZE_FRACTION
        val minHeight = imageHeight * HAND_ROI_MIN_SIZE_FRACTION
        val roiWidth = max(minWidth, bounds.width() * imageWidth * HAND_ROI_EXPAND_FACTOR)
        val roiHeight = max(minHeight, bounds.height() * imageHeight * HAND_ROI_EXPAND_FACTOR)

        val centerX = (bounds.left + bounds.right) * 0.5f * imageWidth
        val centerY = (bounds.top + bounds.bottom) * 0.5f * imageHeight

        val maxLeft = (imageWidth - roiWidth).coerceAtLeast(0f)
        val maxTop = (imageHeight - roiHeight).coerceAtLeast(0f)

        val left = (centerX - roiWidth * 0.5f).coerceIn(0f, maxLeft)
        val top = (centerY - roiHeight * 0.5f).coerceIn(0f, maxTop)
        val right = (left + roiWidth).coerceAtMost(imageWidth.toFloat())
        val bottom = (top + roiHeight).coerceAtMost(imageHeight.toFloat())

        return Rect(left.toInt(), top.toInt(), right.toInt(), bottom.toInt())
    }

    private fun extractTargets(objectResult: Any): List<DetectedObjectCandidate> {
        val detectionsMethod = objectResult.javaClass.methods.firstOrNull { it.name == "detections" }
            ?: return emptyList()
        val detections = detectionsMethod.invoke(objectResult) as? List<*> ?: return emptyList()

        val bestByLabel = mutableMapOf<String, DetectedObjectCandidate>()

        detections.forEach { detection ->
            detection ?: return@forEach
            val categoriesMethod = detection.javaClass.methods.firstOrNull { it.name == "categories" }
            val boxMethod = detection.javaClass.methods.firstOrNull { it.name == "boundingBox" }
            val rawCategories = categoriesMethod?.invoke(detection) as? List<*>
            val topCategory = rawCategories?.firstOrNull()
            val rawLabel = topCategory?.let { invokeString(it, "categoryName") } ?: "object"
            val score = topCategory?.let { invokeFloat(it, "score") } ?: 0f
            val label = DetectedItemLibrary.normalizeLabel(rawLabel)

            val boxObj = boxMethod?.invoke(detection) ?: return@forEach
            val rectF = when (boxObj) {
                is android.graphics.RectF -> boxObj
                is android.graphics.Rect -> android.graphics.RectF(boxObj)
                else -> null
            } ?: return@forEach

            if (label.lowercase() == "person") return@forEach
            if (!DetectedItemLibrary.shouldKeep(label, score)) return@forEach

            val candidate = DetectedObjectCandidate(label = label, score = score, box = rectF)
            val existing = bestByLabel[label]
            if (existing == null || candidate.score > existing.score) {
                bestByLabel[label] = candidate
            }
        }

        return bestByLabel.values.sortedByDescending { it.score }
    }

    private fun invokeFloat(target: Any, methodName: String): Float? {
        return runCatching {
            val method = target.javaClass.methods.firstOrNull { it.name == methodName } ?: return null
            (method.invoke(target) as? Number)?.toFloat()
        }.getOrNull()
    }

    private fun invokeString(target: Any, methodName: String): String? {
        return runCatching {
            val method = target.javaClass.methods.firstOrNull { it.name == methodName } ?: return null
            method.invoke(target)?.toString()
        }.getOrNull()
    }

    private fun buildFallbackPointingTarget(
        knuckle: PointF,
        tip: PointF,
        imageWidth: Int,
        imageHeight: Int,
    ): DetectedObjectCandidate {
        val kx = knuckle.x * imageWidth
        val ky = knuckle.y * imageHeight
        val tx = tip.x * imageWidth
        val ty = tip.y * imageHeight

        val ex = tx + (tx - kx) * 0.35f
        val ey = ty + (ty - ky) * 0.35f
        val cx = ex.coerceIn(0f, imageWidth.toFloat())
        val cy = ey.coerceIn(0f, imageHeight.toFloat())

        val size = max(96f, minOf(imageWidth, imageHeight) * 0.18f)
        val half = size / 2f

        return DetectedObjectCandidate(
            label = "pointed-area",
            score = 0.18f,
            box = RectF(
                (cx - half).coerceAtLeast(0f),
                (cy - half).coerceAtLeast(0f),
                (cx + half).coerceAtMost(imageWidth.toFloat()),
                (cy + half).coerceAtMost(imageHeight.toFloat()),
            ),
        )
    }

    private fun inferLikelyPointingFromLandmarks(landmarks: List<PointF>): HandGestureObservation? {
        if (landmarks.size < 21) return null
        val wrist = landmarks[0]
        val indexTip = landmarks[8]
        val middleTip = landmarks[12]
        val ringTip = landmarks[16]
        val pinkyTip = landmarks[20]

        val indexDist = motionDistance(wrist, indexTip)
        val middleDist = motionDistance(wrist, middleTip)
        val ringDist = motionDistance(wrist, ringTip)
        val pinkyDist = motionDistance(wrist, pinkyTip)
        val maxOther = max(middleDist, max(ringDist, pinkyDist))

        if (indexDist < maxOther * 1.02f) return null
        if (abs(indexTip.x - wrist.x) < 0.02f && abs(indexTip.y - wrist.y) < 0.02f) return null

        val minX = landmarks.minOf { it.x }
        val maxX = landmarks.maxOf { it.x }
        val minY = landmarks.minOf { it.y }
        val maxY = landmarks.maxOf { it.y }
        val padding = 0.04f

        return HandGestureObservation(
            gestureType = HandGestureType.POINTING,
            confidence = 0.68f,
            focusPoint = indexTip,
            boundingBox = rectF(
                (minX - padding).coerceAtLeast(0f),
                (minY - padding).coerceAtLeast(0f),
                (maxX + padding).coerceAtMost(1f),
                (maxY + padding).coerceAtMost(1f),
            ),
        )
    }

    private fun inferDirectionalIntentFromLandmarks(landmarks: List<PointF>): HandGestureObservation? {
        if (landmarks.size < 21) return null

        val wrist = landmarks[0]
        val indexTip = landmarks[8]
        val indexMcp = landmarks[5]
        val middleTip = landmarks[12]

        val dx = indexTip.x - wrist.x
        val dy = indexTip.y - wrist.y
        val span = motionDistance(wrist, indexTip)
        if (span < 0.11f) return null

        val directional = kotlin.math.abs(dx) > 0.05f || dy < -0.04f
        if (!directional) return null

        val indexLead = motionDistance(wrist, indexTip) - motionDistance(wrist, middleTip)
        if (indexLead < 0.01f) return null

        val minX = landmarks.minOf { it.x }
        val maxX = landmarks.maxOf { it.x }
        val minY = landmarks.minOf { it.y }
        val maxY = landmarks.maxOf { it.y }

        return HandGestureObservation(
            gestureType = HandGestureType.POINTING,
            confidence = 0.57f,
            focusPoint = pointF((indexTip.x + indexMcp.x) / 2f, (indexTip.y + indexMcp.y) / 2f),
            boundingBox = rectF(
                (minX - 0.05f).coerceIn(0f, 1f),
                (minY - 0.05f).coerceIn(0f, 1f),
                (maxX + 0.05f).coerceIn(0f, 1f),
                (maxY + 0.05f).coerceIn(0f, 1f),
            ),
        )
    }

    private fun maybeEmitTrackingHold(
        bitmap: Bitmap,
        debugLines: MutableList<String>,
        reason: String,
        landmarks: List<PointF>? = null,
    ): Boolean {
        val target = lastPointingTarget ?: return false
        val observation = lastPointingObservation ?: return false
        val now = System.currentTimeMillis()

        if (consecutiveMissedHandFrames > HAND_MAX_CONSECUTIVE_MISSES) return false
        if (now - lastPointingSeenAtMs > HAND_PERSISTENCE_GRACE_MS) return false

        val decayed = target.copy(score = (target.score * 0.90f).coerceAtLeast(0.18f))
        val knuckle = lastPointingKnuckle ?: pointF(0.5f, 0.5f)
        val tip = observation.focusPoint

        debugLines += "Tracking: hold (${reason})"
        debugLines += "Hold age: ${now - lastPointingSeenAtMs}ms"
        onDebugState(
            VisionDebugState(
                lines = debugLines,
                normalizedKnuckle = knuckle,
                normalizedTip = tip,
            ),
        )

        recorder.record(
            bitmap = bitmap,
            landmarks = landmarks,
            observation = observation,
            stable = false,
            candidates = emptyList(),
            selected = decayed,
            reason = "tracking_hold_$reason",
        )

        onTargetIsolated(
            PointingTarget(
                label = decayed.label,
                confidence = decayed.score,
                boundingBox = decayed.box,
                normalizedKnuckle = knuckle,
                normalizedTip = tip,
                normalizedHitPoint = pointF(
                    ((decayed.box.left + decayed.box.right) / 2f) / bitmap.width,
                    ((decayed.box.top + decayed.box.bottom) / 2f) / bitmap.height,
                ),
                gestureType = HandGestureType.POINTING,
            ),
        )
        return true
    }

    private fun rememberPointingLock(
        observation: HandGestureObservation,
        knuckle: PointF,
        target: DetectedObjectCandidate,
    ) {
        lastPointingObservation = observation
        lastPointingKnuckle = knuckle
        lastPointingTarget = target
        lastPointingSeenAtMs = System.currentTimeMillis()
    }

    private fun smoothTargetLabel(target: DetectedObjectCandidate): DetectedObjectCandidate {
        if (target.label == "pointed-area") return target

        recentLockedLabels.addLast(target.label)
        while (recentLockedLabels.size > LABEL_MEMORY_WINDOW) {
            recentLockedLabels.removeFirst()
        }

        val counts = recentLockedLabels.groupingBy { it }.eachCount()
        val best = counts.maxByOrNull { it.value } ?: return target
        val bestLabel = best.key
        val bestCount = best.value

        if (bestCount < 2 || bestLabel == target.label) return target
        if (target.score >= 0.72f) return target

        return target.copy(label = bestLabel, score = max(target.score, 0.22f))
    }

    private fun maybeRecordAutoMotionSnapshot(
        bitmap: Bitmap,
        landmarks: List<PointF>,
        observation: HandGestureObservation?,
        stable: Boolean,
        candidates: List<DetectedObjectCandidate>,
        selected: DetectedObjectCandidate?,
        stage: String,
    ) {
        val focus = observation?.focusPoint ?: landmarks.getOrNull(8) ?: return
        val now = System.currentTimeMillis()

        val moved = lastMotionFocusPoint?.let { motionDistance(it, focus) > MOTION_DISTANCE_THRESHOLD } ?: false
        if (moved) {
            motionActiveUntilMs = now + MOTION_ACTIVE_WINDOW_MS
        }
        lastMotionFocusPoint = focus

        if (now > motionActiveUntilMs) return
        if (now - lastAutoFeedbackAtMs < AUTO_FEEDBACK_INTERVAL_MS) return

        lastAutoFeedbackAtMs = now
        recorder.record(
            bitmap = bitmap,
            landmarks = landmarks,
            observation = observation,
            stable = stable,
            candidates = candidates,
            selected = selected,
            reason = "feedback_auto_motion_$stage",
            force = true,
        )
        Log.d(TAG, "auto feedback snapshot captured stage=$stage")
    }

    private fun motionDistance(a: PointF, b: PointF): Float {
        val dx = a.x - b.x
        val dy = a.y - b.y
        return sqrt(dx * dx + dy * dy)
    }

    private fun recordFeedbackSnapshotIfRequested(
        bitmap: Bitmap,
        landmarks: List<PointF>?,
        observation: HandGestureObservation?,
        stable: Boolean,
        candidates: List<DetectedObjectCandidate>,
        selected: DetectedObjectCandidate?,
        stage: String,
    ) {
        if (!feedbackSnapshotRequested.compareAndSet(true, false)) return
        recorder.record(
            bitmap = bitmap,
            landmarks = landmarks,
            observation = observation,
            stable = stable,
            candidates = candidates,
            selected = selected,
            reason = "feedback_manual_$stage",
            force = true,
        )
        Log.d(TAG, "manual feedback snapshot captured stage=$stage")
    }
}
