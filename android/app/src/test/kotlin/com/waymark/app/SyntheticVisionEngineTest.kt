/* ============================================================
   SyntheticVisionEngineTest.kt — JVM tests for synthetic demo pipeline
   ============================================================ */

package com.waymark.app

import org.junit.Assert.*
import org.junit.Test

/**
 * Pure JVM tests for the synthetic pointing and OK demo path.
 */
class SyntheticVisionEngineTest {

    @Test
    fun `pointing scenario emits a pointing target after stabilization`() {
        val engine = SyntheticVisionEngine(SyntheticVisionScenario.POINTING)

        assertNull(engine.processNextFrame())
        val target = engine.processNextFrame()

        assertNotNull(target)
        assertEquals(HandGestureType.POINTING, target!!.gestureType)
        assertEquals("cup", target.label)
        assertTrue(target.normalizedHitPoint.x > 0.6f)
    }

    @Test
    fun `ok scenario emits an ok target after stabilization`() {
        val engine = SyntheticVisionEngine(SyntheticVisionScenario.OK)

        assertNull(engine.processNextFrame())
        val target = engine.processNextFrame()

        assertNotNull(target)
        assertEquals(HandGestureType.OK, target!!.gestureType)
        assertEquals("confirm", target.label)
        assertTrue(target.normalizedHitPoint.x > 0.4f)
    }

    @Test
    fun `sweep scenario emits a target and keeps moving`() {
        val engine = SyntheticVisionEngine(SyntheticVisionScenario.SWEEP)

        assertNull(engine.processNextFrame())
        val first = engine.processNextFrame()
        val second = engine.processNextFrame()

        assertNotNull(first)
        assertNotNull(second)
        assertEquals("sweep-object", first!!.label)
        assertEquals("sweep-object", second!!.label)
        assertTrue(first.normalizedHitPoint.x != second.normalizedHitPoint.x)
    }
}
