/* ============================================================
   WaymarkTypes.kt — Shared CV/BLE data contracts
   ============================================================ */

package com.waymark.app

import android.graphics.PointF
import android.graphics.RectF

enum class HandGestureType {
    POINTING,
    OK,
}

data class PointingTarget(
    val label: String,
    val confidence: Float,
    val boundingBox: RectF,
    val normalizedKnuckle: PointF,
    val normalizedTip: PointF,
    val normalizedHitPoint: PointF,
    val gestureType: HandGestureType,
)

enum class G2ConnectionState {
    DISCONNECTED,
    SCANNING,
    CONNECTING,
    CONNECTED,
    READY,
    ERROR,
}
