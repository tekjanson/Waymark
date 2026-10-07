/* ============================================================
   VoiceCommandManager.kt — Hands-free voice control

   Continuous on-device speech recognition for the vision/calibration
   flow so the operator can drive it without freeing a hand (one hand
   holds the phone, the other points). Recognizes a small fixed command
   grammar and reports matches to the caller.

   SpeechRecognizer must be created and driven on the main thread.
   ============================================================ */

package com.waymark.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import java.util.Locale

class VoiceCommandManager(
    private val context: Context,
    private val onCommand: (VoiceCommand) -> Unit,
    private val onListeningChanged: (Boolean) -> Unit = {},
) : RecognitionListener {

    enum class VoiceCommand { CALIBRATE, CAPTURE, CANCEL, EXIT, VISION_ON, RECENTER }

    companion object {
        private const val TAG = "WaymarkVoice"
        private const val RESTART_DELAY_MS = 300L
        private const val COMMAND_DEBOUNCE_MS = 1200L
    }

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    @Volatile private var active = false
    private var lastCommandAtMs = 0L

    val available: Boolean get() = SpeechRecognizer.isRecognitionAvailable(context)

    fun start() {
        if (active) return
        if (!available) { Log.w(TAG, "Speech recognition unavailable on this device"); return }
        active = true
        main.post { createAndListen() }
        onListeningChanged(true)
    }

    fun stop() {
        if (!active) return
        active = false
        main.post {
            recognizer?.destroy()
            recognizer = null
        }
        onListeningChanged(false)
    }

    private fun createAndListen() {
        if (!active) return
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(context).also {
                it.setRecognitionListener(this)
            }
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        }
        try {
            recognizer?.startListening(intent)
        } catch (t: Throwable) {
            Log.e(TAG, "startListening failed", t)
            scheduleRestart()
        }
    }

    private fun scheduleRestart() {
        if (!active) return
        main.postDelayed({
            if (active) { recognizer?.cancel(); createAndListen() }
        }, RESTART_DELAY_MS)
    }

    private fun handleResults(bundle: Bundle?) {
        val hits = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return
        for (phrase in hits) {
            val cmd = parseCommand(phrase) ?: continue
            val now = System.currentTimeMillis()
            if (now - lastCommandAtMs < COMMAND_DEBOUNCE_MS) return
            lastCommandAtMs = now
            onCommand(cmd)
            return
        }
    }

    /** Order matters: the most specific / most frequent commands win first. */
    private fun parseCommand(raw: String): VoiceCommand? {
        val t = raw.lowercase(Locale.getDefault())
        return when {
            Regex("\\b(capture|mark|next|got it|take it|snapshot|point)\\b").containsMatchIn(t) -> VoiceCommand.CAPTURE
            Regex("\\b(cancel|abort|stop calibrat)\\b").containsMatchIn(t) -> VoiceCommand.CANCEL
            Regex("\\b(recenter|re-?center|center|re-?sync|resync|reset)\\b").containsMatchIn(t) -> VoiceCommand.RECENTER
            Regex("\\b(calibrat\\w*|start calibrat\\w*)\\b").containsMatchIn(t) -> VoiceCommand.CALIBRATE
            Regex("\\b(exit|close|turn off|vision off|stop vision|finish|done)\\b").containsMatchIn(t) -> VoiceCommand.EXIT
            Regex("\\b(vision on|turn on|start vision|open vision)\\b").containsMatchIn(t) -> VoiceCommand.VISION_ON
            else -> null
        }
    }

    override fun onResults(results: Bundle?) {
        handleResults(results)
        scheduleRestart()
    }

    override fun onError(error: Int) {
        // No-match / timeout / busy are expected in continuous mode — keep going.
        scheduleRestart()
    }

    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onRmsChanged(rmsdB: Float) {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onPartialResults(partialResults: Bundle?) {}
    override fun onEvent(eventType: Int, params: Bundle?) {}
}
