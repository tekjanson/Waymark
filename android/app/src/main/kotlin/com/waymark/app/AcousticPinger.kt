/* ============================================================
   AcousticPinger.kt — Phone-speaker chirp for acoustic ranging

   Emits a short, band-limited linear chirp from the phone speaker so
   the glasses microphones (+ firmware direction-of-arrival tag) can
   measure the phone→glasses bearing during calibration. A low-weight
   spatial reference that complements the dominant IMU orientation.

   The chirp sits in the 3–6 kHz band so voice-optimized glasses mics
   still capture it; it is Hann-windowed to avoid clicks. Playback uses
   a static AudioTrack replayed on a fixed cadence while active.
   ============================================================ */

package com.waymark.app

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

class AcousticPinger {

    companion object {
        const val SAMPLE_RATE = 44_100
        const val F_START = 3_000.0        // Hz — inside the glasses voice-mic passband
        const val F_END = 6_000.0
        const val CHIRP_MS = 60
        private const val PERIOD_MS = 300L  // ~3.3 pings/sec while active
    }

    private val chirp: ShortArray = buildChirp()
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var track: AudioTrack? = null
    @Volatile private var active = false

    private val pingLoop = object : Runnable {
        override fun run() {
            if (!active) return
            emitOnce()
            main.postDelayed(this, PERIOD_MS)
        }
    }

    fun start() {
        if (active) return
        active = true
        main.post(pingLoop)
    }

    fun stop() {
        active = false
        main.removeCallbacks(pingLoop)
        track?.let { runCatching { it.stop() }; it.release() }
        track = null
    }

    /** Emit a single chirp (used both for repeating pings and one-shot pings). */
    fun ping() {
        if (!active) emitOnce()
    }

    private fun emitOnce() {
        val t = obtainTrack() ?: return
        runCatching {
            t.stop()
            t.reloadStaticData()
            t.play()
        }
    }

    private fun obtainTrack(): AudioTrack? {
        track?.let { return it }
        val bytes = chirp.size * 2
        val t = runCatching {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                )
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(bytes)
                .build()
        }.getOrNull() ?: return null
        t.write(chirp, 0, chirp.size)
        t.setVolume(AudioTrack.getMaxVolume())
        track = t
        return t
    }

    private fun buildChirp(): ShortArray {
        val n = SAMPLE_RATE * CHIRP_MS / 1000
        val out = ShortArray(n)
        val durSec = CHIRP_MS / 1000.0
        val k = (F_END - F_START) / durSec           // linear sweep rate
        for (i in 0 until n) {
            val tt = i.toDouble() / SAMPLE_RATE
            val phase = 2.0 * PI * (F_START * tt + 0.5 * k * tt * tt)
            val window = 0.5 * (1 - cos(2.0 * PI * i / (n - 1)))  // Hann
            out[i] = (sin(phase) * window * Short.MAX_VALUE * 0.9).toInt().toShort()
        }
        return out
    }
}
