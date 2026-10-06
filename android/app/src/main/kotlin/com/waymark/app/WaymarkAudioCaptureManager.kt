/* ============================================================
   WaymarkAudioCaptureManager.kt — Multi-mic capture manager
   ============================================================ */

package com.waymark.app

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

class WaymarkAudioCaptureManager(
    context: Context,
    private val scope: CoroutineScope,
) {
    companion object {
        private const val TAG = "WaymarkAudio"
        private const val SAMPLE_RATE = 48_000
        private const val CHANNEL_MASK = AudioFormat.CHANNEL_IN_MONO
        private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
    }

    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val isRecording = AtomicBoolean(false)
    private val recordJobs = mutableListOf<Job>()
    private val activeRecords = mutableListOf<AudioRecord>()
    private val latestBuffers = ConcurrentHashMap<Int, ShortArray>()
    private var primaryDeviceId: Int? = null

    fun getAvailableMicrophones(): List<AudioDeviceInfo> {
        return audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .filter { it.isSource }
    }

    @SuppressLint("MissingPermission")
    fun startCapture(primaryMic: AudioDeviceInfo, referenceMics: List<AudioDeviceInfo>) {
        stopCapture()

        val devices = listOf(primaryMic) + referenceMics
        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_MASK, ENCODING)
        if (minBuffer <= 0) {
            Log.e(TAG, "AudioRecord min buffer size invalid: $minBuffer")
            return
        }

        primaryDeviceId = primaryMic.id
        isRecording.set(true)

        devices.forEach { mic ->
            val record = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                CHANNEL_MASK,
                ENCODING,
                minBuffer * 2,
            )

            if (record.state != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "Failed to initialize AudioRecord for device ${mic.id}")
                record.release()
                return@forEach
            }

            val preferred = record.setPreferredDevice(mic)
            if (!preferred) {
                Log.w(TAG, "Preferred device assignment rejected for ${mic.id}")
            }

            record.startRecording()
            activeRecords.add(record)

            val job = scope.launch(Dispatchers.IO) {
                val localBuffer = ShortArray(minBuffer)
                while (isActive && isRecording.get()) {
                    val read = record.read(localBuffer, 0, localBuffer.size)
                    if (read <= 0) {
                        continue
                    }

                    val frame = localBuffer.copyOf(read)
                    latestBuffers[mic.id] = frame

                    val primary = primaryDeviceId?.let { latestBuffers[it] }
                    if (primary != null) {
                        val references = latestBuffers
                            .filterKeys { it != primaryDeviceId }
                            .values
                            .map { it.copyOf() }
                        processVoiceIsolation(primary.copyOf(), references)
                    }
                }
            }
            recordJobs.add(job)
        }
    }

    fun stopCapture() {
        isRecording.set(false)

        recordJobs.forEach { it.cancel() }
        recordJobs.clear()

        activeRecords.forEach { record ->
            try {
                if (record.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    record.stop()
                }
            } catch (_: IllegalStateException) {
                // Recorder can already be torn down by the system.
            }
            record.release()
        }
        activeRecords.clear()
        latestBuffers.clear()
    }

    fun processVoiceIsolation(primary: ShortArray, references: List<ShortArray>) {
        // Stub for future C++ JNI / WebRTC audio processing integration.
        val voiceLevel = calculateVoiceLevel(primary)
        InteractionSignals.updateVoiceLevel(voiceLevel)

        if (references.isEmpty()) return
        Log.v(TAG, "processVoiceIsolation primary=${primary.size} refs=${references.size}")
    }

    private fun calculateVoiceLevel(samples: ShortArray): Float {
        if (samples.isEmpty()) return 0f
        var sumSquares = 0.0
        for (sample in samples) {
            val normalized = sample.toDouble() / Short.MAX_VALUE.toDouble()
            sumSquares += normalized * normalized
        }
        val rms = kotlin.math.sqrt(sumSquares / samples.size.toDouble())
        return rms.toFloat().coerceIn(0f, 1f)
    }
}
