/* ============================================================
   HandGestureStabilizer.kt — Gesture stability gate
   ============================================================ */

package com.waymark.app

import android.graphics.PointF

class HandGestureStabilizer {

    private var lastStableGesture: HandGestureObservation? = null
    private var stableGestureCount: Int = 0
    private var smoothedFocus: PointF? = null

    fun accept(observation: HandGestureObservation): HandGestureObservation? {
        val last = lastStableGesture
        val sameGesture = last?.gestureType == observation.gestureType
        stableGestureCount = if (sameGesture) {
            (stableGestureCount + 1).coerceAtMost(3)
        } else {
            1
        }

        lastStableGesture = observation
        smoothedFocus = if (smoothedFocus == null || !sameGesture) {
            observation.focusPoint
        } else {
            val prev = smoothedFocus!!
            val alpha = if (observation.gestureType == HandGestureType.POINTING) 0.45f else 0.3f
            pointF(
                prev.x + (observation.focusPoint.x - prev.x) * alpha,
                prev.y + (observation.focusPoint.y - prev.y) * alpha,
            )
        }

        if (stableGestureCount < 2) return null

        return observation.copy(focusPoint = smoothedFocus ?: observation.focusPoint)
    }

}
