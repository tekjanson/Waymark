/* ============================================================
   HandGestureClassifier.kt — Pure hand gesture classification
   ============================================================ */

package com.waymark.app

import android.graphics.PointF
import android.graphics.RectF
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sqrt

data class HandGestureObservation(
    val gestureType: HandGestureType,
    val confidence: Float,
    val focusPoint: PointF,
    val boundingBox: RectF,
)

object HandGestureClassifier {

    private const val OK_PINCH_THRESHOLD = 0.26f

    fun classify(points: List<PointF>): HandGestureObservation? {
        if (points.size < 21) return null

        val wrist = points[0]
        val indexMcp = points[5]
        val indexTip = points[8]
        val middleMcp = points[9]
        val middleTip = points[12]
        val ringMcp = points[13]
        val ringTip = points[16]
        val pinkyMcp = points[17]
        val pinkyTip = points[20]
        val thumbTip = points[4]

        fun dist(a: PointF, b: PointF): Float {
            val dx = a.x - b.x
            val dy = a.y - b.y
            return sqrt(dx * dx + dy * dy)
        }

        fun extensionRatio(mcp: PointF, tip: PointF, palmScale: Float): Float {
            return dist(mcp, tip) / max(palmScale, 0.001f)
        }

        val thumbIndexGap = dist(thumbTip, indexTip)
        val handSpan = dist(wrist, middleMcp).coerceAtLeast(0.001f)
        val pinchRatio = thumbIndexGap / handSpan

        val indexExt = extensionRatio(indexMcp, indexTip, handSpan)
        val middleExt = extensionRatio(middleMcp, middleTip, handSpan)
        val ringExt = extensionRatio(ringMcp, ringTip, handSpan)
        val pinkyExt = extensionRatio(pinkyMcp, pinkyTip, handSpan)

        val indexWristDist = dist(wrist, indexTip)
        val middleWristDist = dist(wrist, middleTip)
        val ringWristDist = dist(wrist, ringTip)
        val pinkyWristDist = dist(wrist, pinkyTip)

        val foldedAverage = (middleExt + ringExt + pinkyExt) / 3f
        val indexDominance = indexExt - foldedAverage
        val foldedFingerCount = listOf(middleExt, ringExt, pinkyExt).count { it < 0.90f }
        val maxOtherWristDist = max(middleWristDist, max(ringWristDist, pinkyWristDist))
        val perspectivePointing =
            indexWristDist > maxOtherWristDist * 1.05f &&
                indexWristDist > handSpan * 0.65f &&
                foldedFingerCount >= 2

        val gestureType = when {
            indexExt > 0.64f &&
                indexDominance > 0.10f &&
                foldedFingerCount >= 2 -> HandGestureType.POINTING
            perspectivePointing -> HandGestureType.POINTING
            pinchRatio < OK_PINCH_THRESHOLD &&
                abs(thumbTip.y - indexTip.y) < 0.12f &&
                middleExt > 0.55f &&
                ringExt > 0.52f &&
                pinkyExt > 0.50f -> HandGestureType.OK
            else -> return null
        }

        val focusPoint = when (gestureType) {
            HandGestureType.POINTING -> indexTip
            HandGestureType.OK -> pointF((thumbTip.x + indexTip.x) / 2f, (thumbTip.y + indexTip.y) / 2f)
        }

        val minX = points.minOf { it.x }
        val maxX = points.maxOf { it.x }
        val minY = points.minOf { it.y }
        val maxY = points.maxOf { it.y }
        val padding = 0.04f
        val box = rectF(
            (minX - padding).coerceAtLeast(0f),
            (minY - padding).coerceAtLeast(0f),
            (maxX + padding).coerceAtMost(1f),
            (maxY + padding).coerceAtMost(1f),
        )

        return HandGestureObservation(
            gestureType = gestureType,
            confidence = when (gestureType) {
                HandGestureType.POINTING -> 0.9f
                HandGestureType.OK -> 0.85f
            },
            focusPoint = focusPoint,
            boundingBox = box,
        )
    }
}