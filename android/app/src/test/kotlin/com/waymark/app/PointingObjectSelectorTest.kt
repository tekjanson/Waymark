/* ============================================================
   PointingObjectSelectorTest.kt — JVM tests for ray selection
   ============================================================ */

package com.waymark.app

import org.junit.Assert.*
import org.junit.Test

/**
 * Pure JVM tests for [PointingObjectSelector].
 */
class PointingObjectSelectorTest {

    private fun candidate(label: String, left: Float, top: Float, right: Float, bottom: Float, score: Float = 0.9f) =
        DetectedObjectCandidate(label, score, rectF(left, top, right, bottom))

    private fun point(x: Float, y: Float) = pointF(x, y)

    @Test
    fun `select returns candidate intersecting pointing ray`() {
        val knuckle = point(0.50f, 0.80f)
        val tip = point(0.50f, 0.35f)
        val target = candidate("cup", 440f, 280f, 560f, 420f)
        val miss = candidate("lamp", 120f, 120f, 220f, 220f)

        val selected = PointingObjectSelector.select(
            knuckle = knuckle,
            tip = tip,
            boxes = listOf(miss, target),
            imageWidth = 1000,
            imageHeight = 1000,
        )

        assertNotNull(selected)
        assertEquals("cup", selected!!.label)
    }

    @Test
    fun `select returns null when no box is near the ray`() {
        val selected = PointingObjectSelector.select(
            knuckle = point(0.25f, 0.80f),
            tip = point(0.25f, 0.35f),
            boxes = listOf(
                candidate("cup", 700f, 700f, 800f, 800f),
                candidate("lamp", 50f, 50f, 150f, 150f),
            ),
            imageWidth = 1000,
            imageHeight = 1000,
        )

        assertNull(selected)
    }

    @Test
    fun `select prefers intersecting candidate over nearby candidate`() {
        val selected = PointingObjectSelector.select(
            knuckle = point(0.50f, 0.80f),
            tip = point(0.50f, 0.35f),
            boxes = listOf(
                candidate("nearby", 520f, 260f, 620f, 360f, score = 0.99f),
                candidate("direct", 460f, 300f, 540f, 380f, score = 0.75f),
            ),
            imageWidth = 1000,
            imageHeight = 1000,
        )

        assertNotNull(selected)
        assertEquals("direct", selected!!.label)
    }
}
