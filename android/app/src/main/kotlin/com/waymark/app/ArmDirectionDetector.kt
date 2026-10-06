/* ============================================================
   ArmDirectionDetector.kt — Landmark-free pointing direction

   Estimates where an arm/hand is pointing WITHOUT MediaPipe hand
   landmarks. Designed for the "behind the shoulder" vest-mounted
   perspective where the hand is foreshortened and the landmark
   model fails.

   Calibrated against the real captured frames in
   app/src/test/resources/vision-fixtures (see ArmDirectionDetectorTest).
   In those frames the arm is usually a blue-gray SLEEVE with a skin
   HAND at the tip, while the background is full of warm wood window
   frames (skin-colored) and foliage. So "arm-ish" = sleeve OR skin,
   and the geometry rejects thin wood strips, foliage, and blowout.

   NOTE: single-frame pixel heuristics cannot separate a pointing arm
   from a torso/face close-up or a gray deck (their geometry overlaps).
   The live pipeline adds temporal motion gating on top of this to
   suppress static-background false positives.
   ============================================================ */

package com.waymark.app

import android.graphics.Bitmap
import android.graphics.PointF
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class ArmDirectionDetector {

    data class ArmDirection(
        val entry: PointF,
        val tip: PointF,
        val confidence: Float,
        val coverage: Float,
    )

    companion object {
        private const val SAMPLE_COLS = 48
        private const val SAMPLE_ROWS = 64
        private const val BLACK_BRIGHT = 30f
        private const val BRIGHT_MAX = 205f
        private const val GREEN_MARGIN = 16f
        private const val MIN_AREA_CELLS = 70
        private const val MAX_COVERAGE = 0.80f
        private const val MIN_LEN_CELLS = 10f
        private const val MIN_THICKNESS = 3.2f
        private const val MAX_ELONGATION = 6.0f
    }

    fun detect(bitmap: Bitmap): ArmDirection? {
        val width = bitmap.width
        val height = bitmap.height
        if (width <= 0 || height <= 0) return null

        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        return detectFromPixels(pixels, width, height)
    }

    /** Pure, Bitmap-free core so the geometry can be unit tested on the JVM. */
    fun detectFromPixels(pixels: IntArray, width: Int, height: Int): ArmDirection? {
        val gridW = SAMPLE_COLS
        val gridH = SAMPLE_ROWS
        val cellW = width / gridW
        val cellH = height / gridH
        if (cellW <= 0 || cellH <= 0) return null

        val mask = BooleanArray(gridW * gridH)
        var armCount = 0
        for (gy in 0 until gridH) {
            for (gx in 0 until gridW) {
                val px = (gx * cellW + cellW / 2).coerceIn(0, width - 1)
                val py = (gy * cellH + cellH / 2).coerceIn(0, height - 1)
                if (isArmish(pixels[py * width + px])) {
                    mask[gy * gridW + gx] = true
                    armCount++
                }
            }
        }

        val totalCells = gridW * gridH
        val coverage = armCount.toFloat() / totalCells
        if (armCount < MIN_AREA_CELLS || coverage > MAX_COVERAGE) return null

        val component = largestComponent(mask, gridW, gridH) ?: return null
        if (component.size < MIN_AREA_CELLS) return null

        val edgeCells = component.filter { idx ->
            val gx = idx % gridW
            val gy = idx / gridW
            gx == 0 || gy == 0 || gx == gridW - 1 || gy == gridH - 1
        }
        if (edgeCells.isEmpty()) return null

        var ex = 0f
        var ey = 0f
        edgeCells.forEach { idx ->
            ex += (idx % gridW).toFloat()
            ey += (idx / gridW).toFloat()
        }
        ex /= edgeCells.size
        ey /= edgeCells.size

        var tipIdx = component.first()
        var bestDist = -1f
        component.forEach { idx ->
            val gx = (idx % gridW).toFloat()
            val gy = (idx / gridW).toFloat()
            val d = (gx - ex) * (gx - ex) + (gy - ey) * (gy - ey)
            if (d > bestDist) {
                bestDist = d
                tipIdx = idx
            }
        }

        val armLength = sqrt(bestDist)
        if (armLength < MIN_LEN_CELLS) return null

        val thickness = component.size.toFloat() / (armLength + 1f)
        if (thickness < MIN_THICKNESS) return null

        val elongation = armLength / (thickness + 0.01f)
        if (elongation > MAX_ELONGATION) return null // thin long strip = wood mullion

        val tx = (tipIdx % gridW).toFloat()
        val ty = (tipIdx / gridW).toFloat()

        val lengthScore = (armLength / max(gridW, gridH).toFloat()).coerceIn(0f, 1f)
        val sizeScore = (component.size.toFloat() / (totalCells * 0.35f)).coerceIn(0f, 1f)
        val confidence = (0.45f + lengthScore * 0.35f + sizeScore * 0.20f).coerceIn(0f, 0.9f)

        val entryNorm = pointF(
            ((ex + 0.5f) / gridW).coerceIn(0f, 1f),
            ((ey + 0.5f) / gridH).coerceIn(0f, 1f),
        )
        val tipNorm = pointF(
            ((tx + 0.5f) / gridW).coerceIn(0f, 1f),
            ((ty + 0.5f) / gridH).coerceIn(0f, 1f),
        )

        return ArmDirection(
            entry = entryNorm,
            tip = tipNorm,
            confidence = confidence,
            coverage = coverage,
        )
    }

    private fun largestComponent(mask: BooleanArray, w: Int, h: Int): List<Int>? {
        val visited = BooleanArray(mask.size)
        var best: MutableList<Int>? = null
        val stack = ArrayDeque<Int>()

        for (start in mask.indices) {
            if (!mask[start] || visited[start]) continue
            val comp = mutableListOf<Int>()
            stack.addLast(start)
            visited[start] = true
            while (stack.isNotEmpty()) {
                val idx = stack.removeLast()
                comp.add(idx)
                val gx = idx % w
                val gy = idx / w
                if (gx > 0) pushIf(mask, visited, stack, idx - 1)
                if (gx < w - 1) pushIf(mask, visited, stack, idx + 1)
                if (gy > 0) pushIf(mask, visited, stack, idx - w)
                if (gy < h - 1) pushIf(mask, visited, stack, idx + w)
            }
            if (best == null || comp.size > best.size) best = comp
        }
        return best
    }

    private fun pushIf(mask: BooleanArray, visited: BooleanArray, stack: ArrayDeque<Int>, idx: Int) {
        if (mask[idx] && !visited[idx]) {
            visited[idx] = true
            stack.addLast(idx)
        }
    }

    private fun isArmish(color: Int): Boolean {
        val r = (color shr 16) and 0xFF
        val g = (color shr 8) and 0xFF
        val b = color and 0xFF
        val bright = (r + g + b) / 3f

        if (bright < BLACK_BRIGHT) return false      // black frame / deep shadow
        if (bright > BRIGHT_MAX) return false        // window / sky blowout
        if (g >= r && g >= b && g - max(r, b) > GREEN_MARGIN) return false // foliage

        val mx = max(r, max(g, b))
        val mn = min(r, min(g, b))
        val sat = if (mx == 0) 0f else (mx - mn).toFloat() / mx

        // Sleeve: blue-gray / slate / denim / fleece. Blue not strongly red-dominated.
        val sleeve = b >= g - 12 && b >= r - 22 && bright >= 45f && bright <= 185f && sat <= 0.55f

        // Skin (hand): YCbCr skin locus, covers light-to-dark tones (no brightness bias).
        val cb = 128f - 0.168736f * r - 0.331264f * g + 0.5f * b
        val cr = 128f + 0.5f * r - 0.418688f * g - 0.081312f * b
        val skin = cb >= 80f && cb <= 125f && cr >= 135f && cr <= 173f && bright >= 50f

        return sleeve || skin
    }
}
