/* ============================================================
   VisionDebugRecorder.kt — Persist frame snapshots + metadata
   ============================================================ */

package com.waymark.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PointF
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class VisionDebugRecorder(
    context: Context,
) {
    companion object {
        private const val TAG = "PointAndDetect"
        private const val MAX_SNAPSHOTS = 220
        private const val MIN_CAPTURE_INTERVAL_MS = 350L
    }

    private val outputDir = File(context.getExternalFilesDir(null), "vision-debug")
    private val timestampFormat = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US)
    private var lastCaptureAtMs: Long = 0L

    init {
        if (!outputDir.exists()) {
            outputDir.mkdirs()
        }
    }

    fun record(
        bitmap: Bitmap,
        landmarks: List<PointF>?,
        observation: HandGestureObservation?,
        stable: Boolean,
        candidates: List<DetectedObjectCandidate>,
        selected: DetectedObjectCandidate?,
        reason: String,
        force: Boolean = false,
    ) {
        val now = System.currentTimeMillis()
        if (!force && now - lastCaptureAtMs < MIN_CAPTURE_INTERVAL_MS) return
        lastCaptureAtMs = now

        runCatching {
            if (!outputDir.exists()) {
                outputDir.mkdirs()
            }

            pruneOldSnapshots()

            val stamp = timestampFormat.format(Date(now))
            val baseName = "frame_${stamp}_${reason}"
            val imageFile = File(outputDir, "$baseName.jpg")
            val metaFile = File(outputDir, "$baseName.json")

            FileOutputStream(imageFile).use { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 82, out)
            }

            val metadata = JSONObject().apply {
                put("timestampMs", now)
                put("reason", reason)
                put("frameWidth", bitmap.width)
                put("frameHeight", bitmap.height)
                put("stable", stable)
                put("gesture", observation?.gestureType?.name ?: JSONObject.NULL)
                put("confidence", observation?.confidence?.toDouble() ?: JSONObject.NULL)
                put("selectedLabel", selected?.label ?: JSONObject.NULL)
                put("selectedScore", selected?.score?.toDouble() ?: JSONObject.NULL)
                put("candidateCount", candidates.size)
                put("landmarkCount", landmarks?.size ?: 0)
                put("landmarks", pointsToJsonArray(landmarks))
                put("candidates", candidatesToJsonArray(candidates))
            }

            metaFile.writeText(metadata.toString(2))
            Log.d(TAG, "snapshot saved: ${imageFile.name}")
        }.onFailure {
            Log.w(TAG, "snapshot save failed", it)
        }
    }

    private fun pruneOldSnapshots() {
        val files = outputDir.listFiles()?.sortedBy { it.lastModified() } ?: return
        if (files.size <= MAX_SNAPSHOTS * 2) return

        val deleteCount = files.size - (MAX_SNAPSHOTS * 2)
        files.take(deleteCount).forEach { it.delete() }
    }

    private fun pointsToJsonArray(points: List<PointF>?): JSONArray {
        val arr = JSONArray()
        points?.forEach { p ->
            arr.put(
                JSONObject().apply {
                    put("x", p.x.toDouble())
                    put("y", p.y.toDouble())
                },
            )
        }
        return arr
    }

    private fun candidatesToJsonArray(candidates: List<DetectedObjectCandidate>): JSONArray {
        val arr = JSONArray()
        candidates.forEach { c ->
            arr.put(
                JSONObject().apply {
                    put("label", c.label)
                    put("score", c.score.toDouble())
                    put("left", c.box.left.toDouble())
                    put("top", c.box.top.toDouble())
                    put("right", c.box.right.toDouble())
                    put("bottom", c.box.bottom.toDouble())
                },
            )
        }
        return arr
    }
}