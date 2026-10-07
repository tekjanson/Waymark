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

    // Ambient phone orientation (unit quaternion x,y,z,w) + calibration epoch,
    // stamped onto every payload so the glasses app can fuse IMU drift and know
    // when to re-sync its origin. Updated out-of-band by the vision loop.
    @Volatile private var oqx = 0f
    @Volatile private var oqy = 0f
    @Volatile private var oqz = 0f
    @Volatile private var oqw = 1f
    @Volatile private var hasOrientation = false
    @Volatile private var calEpoch = 0

    /** Update the ambient phone orientation (unit quaternion x,y,z,w). */
    fun setOrientation(x: Float, y: Float, z: Float, w: Float) {
        oqx = x; oqy = y; oqz = z; oqw = w; hasOrientation = true
    }

    /** Bump the calibration epoch — tells the glasses app to re-sync its fusion origin. */
    fun bumpCalEpoch() { calEpoch += 1 }

    /** Stamp ambient phone orientation + calibration epoch onto a payload. */
    private fun stamp(payload: JSONObject): JSONObject {
        if (hasOrientation) {
            payload.put("qx", oqx.toDouble())
                .put("qy", oqy.toDouble())
                .put("qz", oqz.toDouble())
                .put("qw", oqw.toDouble())
        }
        return payload.put("calEpoch", calEpoch)
    }

    @Synchronized
    fun writeLatest(
        label: String,
        confidence: Float,
        source: String = "vision",
        state: String = "identified",
        x: Float? = null,
        y: Float? = null,
        rawX: Float? = null,
        rawY: Float? = null,
        camW: Int? = null,
        camH: Int? = null,
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
        // Raw camera-frame hit (normalized 0..1) + frame dims let the glasses
        // app run its own dual-IMU unprojection instead of the static affine.
        if (rawX != null) payload.put("rx", rawX.toDouble())
        if (rawY != null) payload.put("ry", rawY.toDouble())
        if (camW != null) payload.put("cw", camW)
        if (camH != null) payload.put("ch", camH)
        stamp(payload)

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
        stamp(payload)

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
        stamp(payload)

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
