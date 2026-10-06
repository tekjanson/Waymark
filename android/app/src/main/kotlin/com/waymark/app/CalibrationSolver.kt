/* ============================================================
   CalibrationSolver.kt — Spatial pointing → glasses mapping

   Solves a 2D affine transform that maps a pointing hit-point in
   camera-normalized space (where the user's finger lands in the
   phone camera frame) to the corresponding position in the glasses
   display space (0..1). The transform is fitted by least squares
   from a set of calibration correspondences captured while the user
   points at on-glasses targets.

       gx = a*hx + b*hy + c
       gy = d*hx + e*hy + f

   Pure JVM logic — no Android dependencies — so it is unit-testable.
   ============================================================ */

package com.waymark.app

import kotlin.math.sqrt

/** One captured calibration point: pointing hit (h*) ↔ glasses target (g*). */
data class CalibrationSample(
    val hx: Float,
    val hy: Float,
    val gx: Float,
    val gy: Float,
)

/**
 * A fitted affine transform plus a quality metric (RMS residual in
 * glasses-space units, 0..~1). Lower rms = better calibration.
 */
data class AffineFit(
    val a: Float,
    val b: Float,
    val c: Float,
    val d: Float,
    val e: Float,
    val f: Float,
    val rms: Float,
) {
    /** Map a pointing hit-point to glasses space. */
    fun apply(hx: Float, hy: Float): Pair<Float, Float> {
        val gx = a * hx + b * hy + c
        val gy = d * hx + e * hy + f
        return gx to gy
    }

    fun toJsonObject(): org.json.JSONObject = org.json.JSONObject()
        .put("a", a.toDouble()).put("b", b.toDouble()).put("c", c.toDouble())
        .put("d", d.toDouble()).put("e", e.toDouble()).put("f", f.toDouble())
        .put("rms", rms.toDouble())

    companion object {
        fun fromJsonObject(o: org.json.JSONObject): AffineFit = AffineFit(
            a = o.optDouble("a", 1.0).toFloat(),
            b = o.optDouble("b", 0.0).toFloat(),
            c = o.optDouble("c", 0.0).toFloat(),
            d = o.optDouble("d", 0.0).toFloat(),
            e = o.optDouble("e", 1.0).toFloat(),
            f = o.optDouble("f", 0.0).toFloat(),
            rms = o.optDouble("rms", 0.0).toFloat(),
        )
    }
}

object CalibrationSolver {

    /** Minimum correspondences required to fit an affine transform. */
    const val MIN_SAMPLES = 3

    /**
     * Fit an affine transform from the samples by least squares.
     * Returns null if there are too few samples or the points are
     * degenerate (e.g., collinear → singular normal equations).
     */
    fun solve(samples: List<CalibrationSample>): AffineFit? {
        if (samples.size < MIN_SAMPLES) return null

        // Build the symmetric normal matrix AᵀA for design rows [hx, hy, 1].
        var sxx = 0.0; var sxy = 0.0; var sx = 0.0
        var syy = 0.0; var sy = 0.0
        val n = samples.size.toDouble()

        // Right-hand sides for the x- and y-parameter systems.
        var txx = 0.0; var txy = 0.0; var tx = 0.0   // Aᵀ · gx
        var tyx = 0.0; var tyy = 0.0; var ty = 0.0   // Aᵀ · gy

        for (s in samples) {
            val hx = s.hx.toDouble(); val hy = s.hy.toDouble()
            val gx = s.gx.toDouble(); val gy = s.gy.toDouble()
            sxx += hx * hx; sxy += hx * hy; sx += hx
            syy += hy * hy; sy += hy
            txx += hx * gx; txy += hy * gx; tx += gx
            tyx += hx * gy; tyy += hy * gy; ty += gy
        }

        // AᵀA (3×3 symmetric):
        //   [ sxx sxy sx ]
        //   [ sxy syy sy ]
        //   [ sx  sy  n  ]
        val m = arrayOf(
            doubleArrayOf(sxx, sxy, sx),
            doubleArrayOf(sxy, syy, sy),
            doubleArrayOf(sx, sy, n),
        )

        val px = solve3x3(m, doubleArrayOf(txx, txy, tx)) ?: return null
        val py = solve3x3(m, doubleArrayOf(tyx, tyy, ty)) ?: return null

        val fit = AffineFit(
            a = px[0].toFloat(), b = px[1].toFloat(), c = px[2].toFloat(),
            d = py[0].toFloat(), e = py[1].toFloat(), f = py[2].toFloat(),
            rms = 0f,
        )

        // Residual RMS in glasses space across both axes.
        var sumSq = 0.0
        for (s in samples) {
            val (gx, gy) = fit.apply(s.hx, s.hy)
            val dx = gx - s.gx; val dy = gy - s.gy
            sumSq += dx * dx + dy * dy
        }
        val rms = sqrt(sumSq / (samples.size * 2)).toFloat()

        return fit.copy(rms = rms)
    }

    /** Solve a 3×3 linear system m·p = rhs via Cramer's rule. Null if singular. */
    private fun solve3x3(m: Array<DoubleArray>, rhs: DoubleArray): DoubleArray? {
        val det = det3(m)
        if (kotlin.math.abs(det) < 1e-9) return null

        val mx = arrayOf(m[0].copyOf(), m[1].copyOf(), m[2].copyOf())
        val result = DoubleArray(3)
        for (col in 0 until 3) {
            // Replace column `col` with rhs, compute det, divide.
            val saved = doubleArrayOf(mx[0][col], mx[1][col], mx[2][col])
            mx[0][col] = rhs[0]; mx[1][col] = rhs[1]; mx[2][col] = rhs[2]
            result[col] = det3(mx) / det
            mx[0][col] = saved[0]; mx[1][col] = saved[1]; mx[2][col] = saved[2]
        }
        return result
    }

    private fun det3(m: Array<DoubleArray>): Double =
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
}
