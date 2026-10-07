/* ============================================================
   CalibrationController.kt — Guided point-at-target routine

   Drives a short spatial-calibration routine: the user is asked to
   point at a sequence of on-glasses targets. For each target we
   collect pointing hit-points, wait until they are spatially stable,
   capture the median correspondence, then advance. When all targets
   are captured we fit an affine transform (CalibrationSolver) that
   maps future pointing to the glasses view.

   Pure logic (no Android deps) so the state machine is testable.
   ============================================================ */

package com.waymark.app

import kotlin.math.abs

interface CalibrationListener {
    /** A new target is active — show it on the glasses and prompt the user. */
    fun onCalibrationStep(step: Int, total: Int, targetX: Float, targetY: Float, prompt: String)

    /** The routine finished. [fit] is null if too few points were captured. */
    fun onCalibrationFinished(fit: AffineFit?, capturedCount: Int)
}

class CalibrationController(private val listener: CalibrationListener) {

    data class Target(val gx: Float, val gy: Float, val prompt: String)

    private val targets = listOf(
        Target(0.50f, 0.50f, "Point at the center dot and hold"),
        Target(0.22f, 0.28f, "Point at the top-left dot and hold"),
        Target(0.78f, 0.28f, "Point at the top-right dot and hold"),
        Target(0.78f, 0.72f, "Point at the bottom-right dot and hold"),
        Target(0.22f, 0.72f, "Point at the bottom-left dot and hold"),
    )

    @Volatile var active = false
        private set
    @Volatile var step = 0
        private set
    @Volatile var lastFit: AffineFit? = null
        private set

    private val window = ArrayDeque<Pair<Float, Float>>()
    private val captured = ArrayList<CalibrationSample>()

    val total get() = targets.size
    val capturedCount get() = captured.size
    val currentTarget: Target? get() = targets.getOrNull(step)

    fun start() {
        active = true
        step = 0
        window.clear()
        captured.clear()
        lastFit = null
        emitStep()
    }

    fun cancel() {
        active = false
        window.clear()
    }

    /**
     * Feed a pointing hit-point (camera-normalized 0..1). When the recent
     * window is spatially stable, the current step is captured and the
     * routine advances.
     */
    @Synchronized
    fun onPointing(hx: Float, hy: Float) {
        if (!active) return
        window.addLast(hx to hy)
        while (window.size > SAMPLE_WINDOW) window.removeFirst()
        if (window.size >= MIN_STABLE && isStable()) {
            captureStep()
        }
    }

    /**
     * Force-capture the current step from whatever samples exist (used on a
     * per-step timeout). If no samples are present the step is skipped.
     */
    @Synchronized
    fun forceCapture() {
        if (!active) return
        if (window.isNotEmpty()) captureStep() else advance()
    }

    /**
     * Manually record the correspondence for the current target using the
     * caller-supplied pointing hit (user tapped "Capture" while aligned).
     */
    @Synchronized
    fun captureManual(hx: Float, hy: Float) {
        if (!active) return
        val target = targets.getOrNull(step) ?: return
        captured.add(CalibrationSample(hx, hy, target.gx, target.gy))
        advance()
    }

    private fun captureStep() {
        val target = targets.getOrNull(step) ?: return
        val (mx, my) = median(window)
        captured.add(CalibrationSample(mx, my, target.gx, target.gy))
        advance()
    }

    private fun advance() {
        window.clear()
        step += 1
        if (step >= targets.size) finish() else emitStep()
    }

    private fun finish() {
        active = false
        val fit = CalibrationSolver.solve(captured)
        lastFit = fit
        listener.onCalibrationFinished(fit, captured.size)
    }

    private fun emitStep() {
        val t = targets[step]
        listener.onCalibrationStep(step, targets.size, t.gx, t.gy, t.prompt)
    }

    /** Stable when all samples lie within a small radius of the median. */
    private fun isStable(): Boolean {
        val (mx, my) = median(window)
        return window.all { (x, y) -> abs(x - mx) <= STABLE_RADIUS && abs(y - my) <= STABLE_RADIUS }
    }

    private fun median(points: Collection<Pair<Float, Float>>): Pair<Float, Float> {
        val xs = points.map { it.first }.sorted()
        val ys = points.map { it.second }.sorted()
        return xs[xs.size / 2] to ys[ys.size / 2]
    }

    companion object {
        const val SAMPLE_WINDOW = 12
        const val MIN_STABLE = 6
        const val STABLE_RADIUS = 0.06f
    }
}
