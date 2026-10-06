/* ============================================================
   PointFUtils.kt — Shared PointF factory for JVM-safe tests
   ============================================================ */

package com.waymark.app

import android.graphics.PointF
import android.graphics.RectF

fun pointF(x: Float, y: Float): PointF {
    return PointF().apply {
        this.x = x
        this.y = y
    }
}

fun rectF(left: Float, top: Float, right: Float, bottom: Float): RectF {
    return RectF().apply {
        this.left = left
        this.top = top
        this.right = right
        this.bottom = bottom
    }
}