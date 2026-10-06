/* ============================================================
   SyntheticPointAndDetectAnalyzer.kt — Demo vision pipeline
   ============================================================ */

package com.waymark.app

import android.graphics.PointF
import android.graphics.RectF
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy

enum class SyntheticVisionScenario(val label: String) {
    POINTING("Pointing"),
    OK("OK"),
    SWEEP("Sweep"),
}

data class SyntheticVisionFrame(
    val frameWidth: Int,
    val frameHeight: Int,
    val landmarks: List<PointF>,
    val candidates: List<DetectedObjectCandidate>,
)

object SyntheticVisionFrames {

    private const val FRAME_WIDTH = 960
    private const val FRAME_HEIGHT = 1280

    fun frameFor(scenario: SyntheticVisionScenario, frameIndex: Int): SyntheticVisionFrame {
        return when (scenario) {
            SyntheticVisionScenario.POINTING -> pointingFrame(frameIndex)
            SyntheticVisionScenario.OK -> okFrame(frameIndex)
            SyntheticVisionScenario.SWEEP -> sweepFrame(frameIndex)
        }
    }

    private fun pointingFrame(frameIndex: Int): SyntheticVisionFrame {
        val wobbleX = ((frameIndex % 6) - 2.5f) * 0.006f
        val wobbleY = ((frameIndex % 5) - 2f) * 0.004f
        val landmarks = pointingHandPoints(offsetX = wobbleX, offsetY = wobbleY)
        val targetPoint = pointF((landmarks[8].x + 0.14f).coerceAtMost(0.90f), (landmarks[8].y + 0.03f).coerceIn(0.12f, 0.88f))
        return SyntheticVisionFrame(
            frameWidth = FRAME_WIDTH,
            frameHeight = FRAME_HEIGHT,
            landmarks = landmarks,
            candidates = listOf(
                syntheticCandidate("cup", targetPoint.x * FRAME_WIDTH, targetPoint.y * FRAME_HEIGHT, 180f, 160f),
                syntheticCandidate("lamp", 210f, 420f, 140f, 180f),
                syntheticCandidate("book", 760f, 740f, 160f, 130f),
            ),
        )
    }

    private fun okFrame(frameIndex: Int): SyntheticVisionFrame {
        val wobble = ((frameIndex % 4) - 1.5f) * 0.002f
        val landmarks = okHandPoints(offsetX = wobble, offsetY = 0f)
        val targetPoint = pointF((landmarks[4].x + landmarks[8].x) / 2f, (landmarks[4].y + landmarks[8].y) / 2f)
        return SyntheticVisionFrame(
            frameWidth = FRAME_WIDTH,
            frameHeight = FRAME_HEIGHT,
            landmarks = landmarks,
            candidates = listOf(
                syntheticCandidate("confirm", targetPoint.x * FRAME_WIDTH, targetPoint.y * FRAME_HEIGHT, 140f, 120f),
                syntheticCandidate("ignore", 980f, 140f, 90f, 90f),
            ),
        )
    }

    private fun sweepFrame(frameIndex: Int): SyntheticVisionFrame {
        val phase = (frameIndex % 12).toFloat() / 11f
        val moveX = -0.06f + phase * 0.16f
        val moveY = ((frameIndex % 5) - 2f) * 0.01f
        val landmarks = pointingHandPoints(offsetX = moveX, offsetY = moveY)
        val targetPoint = landmarks[8]
        return SyntheticVisionFrame(
            frameWidth = FRAME_WIDTH,
            frameHeight = FRAME_HEIGHT,
            landmarks = landmarks,
            candidates = listOf(
                syntheticCandidate("sweep-object", targetPoint.x * FRAME_WIDTH, targetPoint.y * FRAME_HEIGHT, 180f, 150f),
                syntheticCandidate("poster", 160f, 640f, 180f, 220f),
            ),
        )
    }

    private fun syntheticCandidate(label: String, centerX: Float, centerY: Float, width: Float, height: Float): DetectedObjectCandidate {
        return DetectedObjectCandidate(
            label = label,
            score = 0.95f,
            box = rectF(
                centerX - width / 2f,
                centerY - height / 2f,
                centerX + width / 2f,
                centerY + height / 2f,
            ),
        )
    }

    private fun pointingHandPoints(offsetX: Float, offsetY: Float): List<PointF> {
        return listOf(
            point(0.50f + offsetX, 0.90f + offsetY),
            point(0.46f + offsetX, 0.84f + offsetY),
            point(0.43f + offsetX, 0.79f + offsetY),
            point(0.41f + offsetX, 0.72f + offsetY),
            point(0.39f + offsetX, 0.66f + offsetY),
            point(0.48f + offsetX, 0.75f + offsetY),
            point(0.48f + offsetX, 0.62f + offsetY),
            point(0.48f + offsetX, 0.50f + offsetY),
            point(0.48f + offsetX, 0.36f + offsetY),
            point(0.55f + offsetX, 0.78f + offsetY),
            point(0.56f + offsetX, 0.74f + offsetY),
            point(0.56f + offsetX, 0.72f + offsetY),
            point(0.56f + offsetX, 0.71f + offsetY),
            point(0.63f + offsetX, 0.80f + offsetY),
            point(0.64f + offsetX, 0.76f + offsetY),
            point(0.64f + offsetX, 0.75f + offsetY),
            point(0.65f + offsetX, 0.74f + offsetY),
            point(0.71f + offsetX, 0.82f + offsetY),
            point(0.72f + offsetX, 0.78f + offsetY),
            point(0.73f + offsetX, 0.77f + offsetY),
            point(0.74f + offsetX, 0.76f + offsetY),
        )
    }

    private fun okHandPoints(offsetX: Float, offsetY: Float): List<PointF> {
        return listOf(
            point(0.50f + offsetX, 0.90f + offsetY),
            point(0.47f + offsetX, 0.82f + offsetY),
            point(0.44f + offsetX, 0.74f + offsetY),
            point(0.41f + offsetX, 0.66f + offsetY),
            point(0.45f + offsetX, 0.58f + offsetY),
            point(0.52f + offsetX, 0.76f + offsetY),
            point(0.51f + offsetX, 0.66f + offsetY),
            point(0.50f + offsetX, 0.57f + offsetY),
            point(0.49f + offsetX, 0.59f + offsetY),
            point(0.58f + offsetX, 0.74f + offsetY),
            point(0.59f + offsetX, 0.63f + offsetY),
            point(0.59f + offsetX, 0.53f + offsetY),
            point(0.59f + offsetX, 0.42f + offsetY),
            point(0.66f + offsetX, 0.77f + offsetY),
            point(0.67f + offsetX, 0.67f + offsetY),
            point(0.68f + offsetX, 0.58f + offsetY),
            point(0.69f + offsetX, 0.49f + offsetY),
            point(0.74f + offsetX, 0.80f + offsetY),
            point(0.75f + offsetX, 0.71f + offsetY),
            point(0.76f + offsetX, 0.62f + offsetY),
            point(0.77f + offsetX, 0.54f + offsetY),
        )
    }

    private fun point(x: Float, y: Float): PointF {
        return pointF(x.coerceIn(0f, 1f), y.coerceIn(0f, 1f))
    }
}

class SyntheticVisionEngine(
    private val scenario: SyntheticVisionScenario,
) {
    private val stabilizer = HandGestureStabilizer()
    private var frameIndex = 0
    var latestDebugState: VisionDebugState = VisionDebugState(lines = listOf("Synthetic: idle"))
        private set

    fun processNextFrame(): PointingTarget? {
        val currentIndex = frameIndex++
        val frame = SyntheticVisionFrames.frameFor(scenario, currentIndex)
        val debugLines = mutableListOf(
            "Mode: Synthetic ${scenario.label}",
            "Frame: ${frame.frameWidth}x${frame.frameHeight}",
        )

        if (currentIndex > 4 && (scenario == SyntheticVisionScenario.POINTING || scenario == SyntheticVisionScenario.SWEEP)) {
            if (currentIndex % 9 == 0) {
                debugLines += "Hand: no landmarks"
                latestDebugState = VisionDebugState(lines = debugLines)
                return null
            }
            if (currentIndex % 13 == 0) {
                debugLines += "Hand: 21 landmarks"
                debugLines += "Shape: unknown"
                latestDebugState = VisionDebugState(
                    lines = debugLines,
                    normalizedKnuckle = frame.landmarks[0],
                    normalizedTip = frame.landmarks.getOrNull(8),
                )
                return null
            }
        }

        debugLines += "Hand: ${frame.landmarks.size} landmarks"

        val observation = HandGestureClassifier.classify(frame.landmarks)
        if (observation == null) {
            debugLines += "Shape: unknown"
            latestDebugState = VisionDebugState(
                lines = debugLines,
                normalizedKnuckle = frame.landmarks[0],
                normalizedTip = frame.landmarks.getOrNull(8),
            )
            return null
        }

        debugLines += "Shape: ${observation.gestureType}"
        debugLines += "Gesture conf: ${"%.2f".format(observation.confidence)}"

        val stableObservation = stabilizer.accept(observation)
        if (stableObservation == null) {
            debugLines += "Stability: acquiring"
            latestDebugState = VisionDebugState(
                lines = debugLines,
                normalizedKnuckle = frame.landmarks[0],
                normalizedTip = observation.focusPoint,
            )
            return null
        }

        debugLines += "Stability: locked"
        debugLines += "Objects: ${frame.candidates.size}"
        frame.candidates.sortedByDescending { it.score }.take(3).forEachIndexed { index, candidate ->
            debugLines += "Obj${index + 1}: ${candidate.label} ${"%.2f".format(candidate.score)}"
        }

        val selectedTarget = PointingObjectSelector.select(
            knuckle = frame.landmarks[0],
            tip = stableObservation.focusPoint,
            boxes = frame.candidates,
            imageWidth = frame.frameWidth,
            imageHeight = frame.frameHeight,
        ) ?: frame.candidates.firstOrNull() ?: return null

        debugLines += "Lock: ${selectedTarget.label} ${"%.2f".format(selectedTarget.score)}"
        latestDebugState = VisionDebugState(
            lines = debugLines,
            normalizedKnuckle = frame.landmarks[0],
            normalizedTip = stableObservation.focusPoint,
        )

        return PointingTarget(
            label = selectedTarget.label,
            confidence = selectedTarget.score,
            boundingBox = selectedTarget.box,
            normalizedKnuckle = frame.landmarks[0],
            normalizedTip = stableObservation.focusPoint,
            normalizedHitPoint = pointF(
                ((selectedTarget.box.left + selectedTarget.box.right) / 2f) / frame.frameWidth,
                ((selectedTarget.box.top + selectedTarget.box.bottom) / 2f) / frame.frameHeight,
            ),
            gestureType = stableObservation.gestureType,
        )
    }
}

class SyntheticPointAndDetectAnalyzer(
    scenario: SyntheticVisionScenario,
    private val onTargetIsolated: (PointingTarget) -> Unit,
    private val onDebugState: (VisionDebugState) -> Unit = {},
) : ImageAnalysis.Analyzer, PointAndDetectVisionSource {

    private val engine = SyntheticVisionEngine(scenario)

    override var latestFrameWidth: Int = 960

    override var latestFrameHeight: Int = 1280

    override fun analyze(imageProxy: ImageProxy) {
        try {
            latestFrameWidth = 960
            latestFrameHeight = 1280
            engine.processNextFrame()?.let(onTargetIsolated)
            onDebugState(engine.latestDebugState)
        } finally {
            imageProxy.close()
        }
    }

    override fun close() = Unit
}
