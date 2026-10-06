/* ============================================================
   HandGestureClassifierTest.kt — JVM tests for hand gestures
   ============================================================ */

package com.waymark.app

import android.graphics.PointF
import org.junit.Assert.*
import org.junit.Test

/**
 * Pure JVM tests for [HandGestureClassifier].
 */
class HandGestureClassifierTest {

    private fun point(x: Float, y: Float) = pointF(x, y)

    private fun openHandPoints(): List<PointF> {
        return listOf(
            point(0.50f, 0.90f), // wrist
            point(0.46f, 0.82f),
            point(0.43f, 0.72f),
            point(0.40f, 0.62f),
            point(0.37f, 0.54f), // thumb tip
            point(0.48f, 0.74f),
            point(0.48f, 0.62f),
            point(0.48f, 0.50f),
            point(0.48f, 0.38f), // index tip
            point(0.55f, 0.75f),
            point(0.56f, 0.63f),
            point(0.56f, 0.52f),
            point(0.56f, 0.40f), // middle tip
            point(0.63f, 0.77f),
            point(0.64f, 0.66f),
            point(0.65f, 0.56f),
            point(0.66f, 0.46f), // ring tip
            point(0.72f, 0.80f),
            point(0.74f, 0.70f),
            point(0.75f, 0.60f),
            point(0.76f, 0.50f), // pinky tip
        )
    }

    private fun pointingHandPoints(): List<PointF> {
        return listOf(
            point(0.50f, 0.90f), // wrist
            point(0.46f, 0.84f),
            point(0.43f, 0.79f),
            point(0.41f, 0.72f),
            point(0.39f, 0.66f), // thumb tip bent in
            point(0.48f, 0.75f),
            point(0.48f, 0.62f),
            point(0.48f, 0.50f),
            point(0.48f, 0.36f), // index tip extended
            point(0.55f, 0.78f),
            point(0.56f, 0.74f),
            point(0.56f, 0.72f),
            point(0.56f, 0.71f), // middle tip folded
            point(0.63f, 0.80f),
            point(0.64f, 0.76f),
            point(0.64f, 0.75f),
            point(0.65f, 0.74f), // ring tip folded
            point(0.71f, 0.82f),
            point(0.72f, 0.78f),
            point(0.73f, 0.77f),
            point(0.74f, 0.76f), // pinky tip folded
        )
    }

    private fun okHandPoints(): List<PointF> {
        return listOf(
            point(0.50f, 0.90f), // wrist
            point(0.47f, 0.82f),
            point(0.44f, 0.74f),
            point(0.41f, 0.66f),
            point(0.45f, 0.58f), // thumb tip near index tip
            point(0.52f, 0.76f),
            point(0.51f, 0.66f),
            point(0.50f, 0.57f),
            point(0.49f, 0.59f), // index tip near thumb tip
            point(0.58f, 0.74f),
            point(0.59f, 0.63f),
            point(0.59f, 0.53f),
            point(0.59f, 0.42f), // middle tip extended enough
            point(0.66f, 0.77f),
            point(0.67f, 0.67f),
            point(0.68f, 0.58f),
            point(0.69f, 0.49f), // ring tip extended enough
            point(0.74f, 0.80f),
            point(0.75f, 0.71f),
            point(0.76f, 0.62f),
            point(0.77f, 0.54f), // pinky tip extended enough
        )
    }

    @Test
    fun `classify returns pointing for extended index finger`() {
        val observation = HandGestureClassifier.classify(pointingHandPoints())
        assertNotNull(observation)
        assertEquals(HandGestureType.POINTING, observation!!.gestureType)
        assertTrue(observation.confidence >= 0.65f)
        assertTrue(observation.focusPoint.y < 0.5f)
    }

    @Test
    fun `classify returns ok for pinch pose`() {
        val observation = HandGestureClassifier.classify(okHandPoints())
        assertNotNull(observation)
        assertEquals(HandGestureType.OK, observation!!.gestureType)
        assertTrue(observation.confidence >= 0.65f)
        assertTrue(observation.focusPoint.x > 0.45f)
    }

    @Test
    fun `classify returns null for weak open hand when pose is not confident`() {
        val points = openHandPoints().toMutableList()
        points[8] = point(0.50f, 0.64f) // shorten index tip
        val observation = HandGestureClassifier.classify(points)
        assertNull(observation)
    }
}
