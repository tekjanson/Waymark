/* ============================================================
   PhoneBridgeStore.kt — On-device bridge payload persistence
   ============================================================ */

package com.waymark.app

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Flat-file storage for the latest point-and-identify text produced by Waymark.
 *
 * The Even app bridge polls the local HTTP endpoint which serves this file.
 */
class PhoneBridgeStore(context: Context) {
    companion object {
        private const val DIR_NAME = "phone-bridge"
        private const val FILE_NAME = "latest.json"
    }

    private val dir: File = File(context.filesDir, DIR_NAME).apply { mkdirs() }
    private val file: File = File(dir, FILE_NAME)

    @Volatile
    private var seq: Long = 0L

    @Synchronized
    fun writeLatest(
        label: String,
        confidence: Float,
        source: String = "vision",
        state: String = "identified",
        x: Float? = null,
        y: Float? = null,
    ): JSONObject {
        seq += 1L
        val now = System.currentTimeMillis()
        val payload = JSONObject()
            .put("ok", true)
            .put("seq", seq)
            .put("ts", now)
            .put("text", label.take(200))
            .put("confidence", confidence.toDouble())
            .put("source", source)
            .put("state", state)
        if (x != null) payload.put("x", x.toDouble())
        if (y != null) payload.put("y", y.toDouble())

        val tmp = File(dir, "$FILE_NAME.tmp")
        tmp.writeText(payload.toString(), Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.writeText(payload.toString(), Charsets.UTF_8)
            tmp.delete()
        }
        return payload
    }

    @Synchronized
    fun writeIdle(
        text: String = "Waiting for target",
        source: String = "vision",
        state: String = "idle",
    ): JSONObject {
        seq += 1L
        val now = System.currentTimeMillis()
        val payload = JSONObject()
            .put("ok", true)
            .put("seq", seq)
            .put("ts", now)
            .put("text", text.take(200))
            .put("confidence", 0.0)
            .put("source", source)
            .put("state", state)

        val tmp = File(dir, "$FILE_NAME.tmp")
        tmp.writeText(payload.toString(), Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.writeText(payload.toString(), Charsets.UTF_8)
            tmp.delete()
        }
        return payload
    }

    @Synchronized
    fun writeCalibration(
        targetX: Float,
        targetY: Float,
        prompt: String,
        step: Int,
        steps: Int,
        source: String = "waymark-vision",
    ): JSONObject {
        seq += 1L
        val now = System.currentTimeMillis()
        val payload = JSONObject()
            .put("ok", true)
            .put("seq", seq)
            .put("ts", now)
            .put("text", prompt.take(200))
            .put("confidence", 0.0)
            .put("source", source)
            .put("state", "calibrate")
            .put("cx", targetX.toDouble())
            .put("cy", targetY.toDouble())
            .put("step", step)
            .put("steps", steps)

        val tmp = File(dir, "$FILE_NAME.tmp")
        tmp.writeText(payload.toString(), Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.writeText(payload.toString(), Charsets.UTF_8)
            tmp.delete()
        }
        return payload
    }

    @Synchronized
    fun readLatest(): JSONObject {
        if (!file.exists()) {
            return JSONObject()
                .put("ok", true)
                .put("seq", seq)
                .put("ts", System.currentTimeMillis())
                .put("text", "Waiting for target")
                .put("confidence", 0.0)
                .put("source", "vision")
                .put("state", "idle")
        }

        return runCatching {
            val raw = file.readText(Charsets.UTF_8)
            JSONObject(raw)
        }.getOrElse {
            JSONObject()
                .put("ok", false)
                .put("error", "failed-to-parse-latest")
                .put("ts", System.currentTimeMillis())
        }
    }
}
