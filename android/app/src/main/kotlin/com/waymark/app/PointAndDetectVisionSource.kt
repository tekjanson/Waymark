/* ============================================================
   PointAndDetectVisionSource.kt — Shared vision pipeline contract
   ============================================================ */

package com.waymark.app

interface PointAndDetectVisionSource : AutoCloseable {
    var latestFrameWidth: Int
    var latestFrameHeight: Int

    fun requestFeedbackSnapshot() = Unit
}
