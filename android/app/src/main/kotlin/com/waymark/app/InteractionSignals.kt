/* ============================================================
   InteractionSignals.kt — Cross-pipeline intent signals
   ============================================================ */

package com.waymark.app

import java.util.concurrent.atomic.AtomicLong

object InteractionSignals {
    private val lastVoiceActiveAtMs = AtomicLong(0L)
    private val lastVoiceLevelPermille = AtomicLong(0L)

    fun updateVoiceLevel(level: Float, nowMs: Long = System.currentTimeMillis()) {
        val clamped = level.coerceIn(0f, 1f)
        val permille = (clamped * 1000f).toLong()
        lastVoiceLevelPermille.set(permille)
        if (clamped >= 0.08f) {
            lastVoiceActiveAtMs.set(nowMs)
        }
    }

    fun isVoiceRecentlyActive(windowMs: Long, nowMs: Long = System.currentTimeMillis()): Boolean {
        return (nowMs - lastVoiceActiveAtMs.get()) <= windowMs
    }

    fun latestVoiceLevel(): Float {
        return (lastVoiceLevelPermille.get().toFloat() / 1000f).coerceIn(0f, 1f)
    }
}
