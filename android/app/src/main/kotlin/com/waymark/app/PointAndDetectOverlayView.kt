/* ============================================================
   PointAndDetectOverlayView.kt — Developer visualization overlay
   ============================================================ */

package com.waymark.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View

class PointAndDetectOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    var currentTarget: PointingTarget? = null
    var debugState: VisionDebugState = VisionDebugState(lines = listOf("Vision: waiting for frames"))
    var isDeveloperModeEnabled: Boolean = false
    var sourceFrameWidth: Int = 1
    var sourceFrameHeight: Int = 1

    private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(220, 65, 255, 150)
        style = Paint.Style.STROKE
        strokeWidth = 5f
    }

    private val boxFillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(70, 65, 255, 150)
        style = Paint.Style.FILL
    }

    private val rayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(240, 255, 84, 84)
        style = Paint.Style.STROKE
        strokeWidth = 7f
    }

    private val hitPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(255, 255, 220, 80)
        style = Paint.Style.FILL
    }

    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 32f
        style = Paint.Style.FILL
        setShadowLayer(6f, 0f, 0f, Color.BLACK)
    }

    private val debugPanelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(180, 5, 10, 20)
        style = Paint.Style.FILL
    }

    private val debugTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(255, 215, 240, 255)
        textSize = 28f
        style = Paint.Style.FILL
    }

    private val debugRayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(220, 255, 166, 77)
        style = Paint.Style.STROKE
        strokeWidth = 5f
    }

    private val debugPointPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(255, 255, 202, 64)
        style = Paint.Style.FILL
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (!isDeveloperModeEnabled) return

        drawDebugPanel(canvas)
        drawDebugHandRay(canvas)

        val target = currentTarget ?: return

        when (target.gestureType) {
            HandGestureType.POINTING -> {
                boxPaint.color = Color.argb(220, 65, 255, 150)
                boxFillPaint.color = Color.argb(70, 65, 255, 150)
                rayPaint.color = Color.argb(240, 255, 84, 84)
                hitPaint.color = Color.argb(255, 255, 220, 80)
            }
            HandGestureType.OK -> {
                boxPaint.color = Color.argb(220, 90, 190, 255)
                boxFillPaint.color = Color.argb(70, 90, 190, 255)
                rayPaint.color = Color.argb(240, 90, 190, 255)
                hitPaint.color = Color.argb(255, 255, 180, 60)
            }
        }

        val viewKnuckleX = target.normalizedKnuckle.x * width
        val viewKnuckleY = target.normalizedKnuckle.y * height
        val viewTipX = target.normalizedTip.x * width
        val viewTipY = target.normalizedTip.y * height
        val viewHitX = target.normalizedHitPoint.x * width
        val viewHitY = target.normalizedHitPoint.y * height

        val boxScaleX = width.toFloat() / sourceFrameWidth.coerceAtLeast(1)
        val boxScaleY = height.toFloat() / sourceFrameHeight.coerceAtLeast(1)
        val mappedLeft = target.boundingBox.left * boxScaleX
        val mappedTop = target.boundingBox.top * boxScaleY
        val mappedRight = target.boundingBox.right * boxScaleX
        val mappedBottom = target.boundingBox.bottom * boxScaleY

        val rect = RectF(mappedLeft, mappedTop, mappedRight, mappedBottom)

        canvas.drawRect(rect, boxFillPaint)
        canvas.drawRect(rect, boxPaint)
        canvas.drawLine(viewTipX, viewTipY, viewHitX, viewHitY, rayPaint)
        canvas.drawCircle(viewHitX, viewHitY, 18f, hitPaint)
        canvas.drawText(target.label, rect.left, (rect.top - 10f).coerceAtLeast(36f), labelPaint)

        canvas.drawLine(viewKnuckleX, viewKnuckleY, viewTipX, viewTipY, rayPaint)
    }

    private fun drawDebugPanel(canvas: Canvas) {
        val lines = debugState.lines.take(8)
        if (lines.isEmpty()) return

        val panelLeft = 16f
        val panelTop = 16f
        val panelRight = width - 16f
        val lineHeight = 34f
        val panelHeight = 16f + (lineHeight * lines.size)

        canvas.drawRoundRect(
            panelLeft,
            panelTop,
            panelRight,
            panelTop + panelHeight,
            14f,
            14f,
            debugPanelPaint,
        )

        var y = panelTop + 34f
        for (line in lines) {
            canvas.drawText(line, panelLeft + 16f, y, debugTextPaint)
            y += lineHeight
        }
    }

    private fun drawDebugHandRay(canvas: Canvas) {
        val knuckle = debugState.normalizedKnuckle ?: return
        val tip = debugState.normalizedTip ?: return

        val startX = knuckle.x * width
        val startY = knuckle.y * height
        val tipX = tip.x * width
        val tipY = tip.y * height

        canvas.drawLine(startX, startY, tipX, tipY, debugRayPaint)
        canvas.drawCircle(startX, startY, 10f, debugPointPaint)
        canvas.drawCircle(tipX, tipY, 10f, debugPointPaint)
    }
}
