/* ============================================================
   PointingObjectSelector.kt — Pure pointing target selection
   ============================================================ */

package com.waymark.app

import android.graphics.PointF
import android.graphics.RectF
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

data class DetectedObjectCandidate(
    val label: String,
    val score: Float,
    val box: RectF,
)

object PointingObjectSelector {

    fun select(
        knuckle: PointF,
        tip: PointF,
        boxes: List<DetectedObjectCandidate>,
        imageWidth: Int,
        imageHeight: Int,
    ): DetectedObjectCandidate? {
        if (boxes.isEmpty()) return null

        val kx = knuckle.x * imageWidth
        val ky = knuckle.y * imageHeight
        val tx = tip.x * imageWidth
        val ty = tip.y * imageHeight

        val dx = tx - kx
        val dy = ty - ky
        val rayLength = kotlin.math.sqrt(dx * dx + dy * dy)
        if (rayLength <= 0f) return null

        val ux = dx / rayLength
        val uy = dy / rayLength
        val extendedLength = max(imageWidth, imageHeight) * 0.75f
        val ex = tx + ux * extendedLength
        val ey = ty + uy * extendedLength

        val maxDimension = max(imageWidth, imageHeight).toFloat()

        val scored = boxes.mapNotNull { target ->
            val centerX = (target.box.left + target.box.right) / 2f
            val centerY = (target.box.top + target.box.bottom) / 2f
            val aheadDot = ((centerX - tx) * ux) + ((centerY - ty) * uy)
            if (aheadDot < -maxDimension * 0.03f) {
                return@mapNotNull null
            }

            val distanceToRay = distancePointToSegment(centerX, centerY, tx, ty, ex, ey)
            val boxHalfWidth = (target.box.right - target.box.left) / 2f
            val boxHalfHeight = (target.box.bottom - target.box.top) / 2f
            val acceptanceRadius = max(boxHalfWidth, boxHalfHeight) + maxDimension * 0.03f

            if (distanceToRay <= acceptanceRadius) {
                val normalizedDistance = (distanceToRay / maxDimension).coerceIn(0f, 1f)
                val score = (normalizedDistance * 0.85f) + ((1f - target.score) * 0.15f)
                ScoredTarget(target = target, score = score)
            } else {
                null
            }
        }

        return scored.minWithOrNull(
            compareBy<ScoredTarget> { it.score }
                .thenByDescending { it.target.score }
        )?.target
    }

    private data class ScoredTarget(
        val target: DetectedObjectCandidate,
        val score: Float,
    )

    private fun distancePointToSegment(px: Float, py: Float, x1: Float, y1: Float, x2: Float, y2: Float): Float {
        val dx = x2 - x1
        val dy = y2 - y1
        if (dx == 0f && dy == 0f) {
            val sx = px - x1
            val sy = py - y1
            return sqrt(sx * sx + sy * sy)
        }

        val lengthSquared = dx * dx + dy * dy
        val t = (((px - x1) * dx) + ((py - y1) * dy)) / lengthSquared
        val clampedT = min(1f, max(0f, t))
        val closestX = x1 + clampedT * dx
        val closestY = y1 + clampedT * dy
        val sx = px - closestX
        val sy = py - closestY
        return sqrt(sx * sx + sy * sy)
    }

}