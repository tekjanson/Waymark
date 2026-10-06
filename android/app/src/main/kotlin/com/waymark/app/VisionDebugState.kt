/* ============================================================
   VisionDebugState.kt — Per-frame analyzer diagnostics
   ============================================================ */

package com.waymark.app

import android.graphics.PointF

data class VisionDebugState(
    val lines: List<String>,
    val normalizedKnuckle: PointF? = null,
    val normalizedTip: PointF? = null,
)