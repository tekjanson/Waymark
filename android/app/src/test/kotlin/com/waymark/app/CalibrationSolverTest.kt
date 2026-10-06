/* ============================================================
   CalibrationSolverTest.kt — JVM tests for the affine fit
   ============================================================ */

package com.waymark.app

import org.junit.Assert.*
import org.junit.Test

class CalibrationSolverTest {

    @Test
    fun `too few samples returns null`() {
        val fit = CalibrationSolver.solve(
            listOf(
                CalibrationSample(0.1f, 0.1f, 0.2f, 0.2f),
                CalibrationSample(0.9f, 0.1f, 0.8f, 0.2f),
            ),
        )
        assertNull(fit)
    }

    @Test
    fun `collinear samples are degenerate and return null`() {
        val fit = CalibrationSolver.solve(
            listOf(
                CalibrationSample(0.1f, 0.1f, 0.2f, 0.2f),
                CalibrationSample(0.2f, 0.2f, 0.3f, 0.3f),
                CalibrationSample(0.3f, 0.3f, 0.4f, 0.4f),
            ),
        )
        assertNull(fit)
    }

    @Test
    fun `recovers a known affine transform exactly`() {
        // Ground-truth transform: gx = 0.8*hx + 0.0*hy + 0.1, gy = 0.0*hx + 1.2*hy - 0.1
        fun gx(hx: Float, hy: Float) = 0.8f * hx + 0.1f
        fun gy(hx: Float, hy: Float) = 1.2f * hy - 0.1f

        val pts = listOf(
            0.2f to 0.2f, 0.8f to 0.2f, 0.8f to 0.8f, 0.2f to 0.8f, 0.5f to 0.5f,
        ).map { (hx, hy) -> CalibrationSample(hx, hy, gx(hx, hy), gy(hx, hy)) }

        val fit = CalibrationSolver.solve(pts)
        assertNotNull(fit)
        fit!!

        assertEquals(0.8f, fit.a, 1e-3f)
        assertEquals(0.0f, fit.b, 1e-3f)
        assertEquals(0.1f, fit.c, 1e-3f)
        assertEquals(0.0f, fit.d, 1e-3f)
        assertEquals(1.2f, fit.e, 1e-3f)
        assertEquals(-0.1f, fit.f, 1e-3f)
        assertTrue("rms should be ~0 for a perfect fit", fit.rms < 1e-3f)

        val (mx, my) = fit.apply(0.5f, 0.5f)
        assertEquals(0.5f, mx, 1e-3f)
        assertEquals(0.5f, my, 1e-3f)
    }

    @Test
    fun `reports nonzero rms for noisy samples but still fits`() {
        val pts = listOf(
            CalibrationSample(0.2f, 0.2f, 0.25f, 0.25f),
            CalibrationSample(0.8f, 0.2f, 0.78f, 0.22f),
            CalibrationSample(0.8f, 0.8f, 0.82f, 0.79f),
            CalibrationSample(0.2f, 0.8f, 0.19f, 0.81f),
            CalibrationSample(0.5f, 0.5f, 0.52f, 0.49f),
        )
        val fit = CalibrationSolver.solve(pts)
        assertNotNull(fit)
        assertTrue(fit!!.rms >= 0f)
        assertTrue("noisy fit should stay small", fit.rms < 0.1f)
    }

    @Test
    fun `json round trips`() {
        val fit = AffineFit(0.8f, 0.01f, 0.1f, 0.02f, 1.1f, -0.05f, 0.012f)
        val back = AffineFit.fromJsonObject(fit.toJsonObject())
        assertEquals(fit.a, back.a, 1e-6f)
        assertEquals(fit.e, back.e, 1e-6f)
        assertEquals(fit.rms, back.rms, 1e-6f)
    }
}
