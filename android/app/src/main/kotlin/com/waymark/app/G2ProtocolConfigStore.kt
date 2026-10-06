/* ============================================================
   G2ProtocolConfigStore.kt — Persistent protocol configuration
   ============================================================ */

package com.waymark.app

import android.content.Context
import java.util.UUID

class G2ProtocolConfigStore(context: Context) {
    companion object {
        private const val PREFS = "waymark_g2_protocol"
        private const val KEY_NAME = "device_name"
        private const val KEY_SERVICE = "service_uuid"
        private const val KEY_CHAR = "char_uuid"
        private const val KEY_CHUNK = "chunk_size"
        private const val KEY_DELAY = "chunk_delay_ms"
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    data class Config(
        val deviceNameHint: String,
        val serviceUuid: String,
        val characteristicUuid: String,
        val chunkSizeBytes: Int,
        val interChunkDelayMs: Long,
    )

    fun load(): Config {
        return Config(
            deviceNameHint = prefs.getString(KEY_NAME, "Even Realities G2") ?: "Even Realities G2",
            serviceUuid = prefs.getString(KEY_SERVICE, "") ?: "",
            characteristicUuid = prefs.getString(KEY_CHAR, "") ?: "",
            chunkSizeBytes = prefs.getInt(KEY_CHUNK, 20),
            interChunkDelayMs = prefs.getLong(KEY_DELAY, 35L),
        )
    }

    fun save(config: Config) {
        prefs.edit()
            .putString(KEY_NAME, config.deviceNameHint)
            .putString(KEY_SERVICE, config.serviceUuid)
            .putString(KEY_CHAR, config.characteristicUuid)
            .putInt(KEY_CHUNK, config.chunkSizeBytes)
            .putLong(KEY_DELAY, config.interChunkDelayMs)
            .apply()
    }

    fun toProtocolSpec(config: Config): G2GlassesManager.G2ProtocolSpec {
        return G2GlassesManager.G2ProtocolSpec(
            deviceNameHint = config.deviceNameHint.ifBlank { "Even Realities G2" },
            serviceUuid = config.serviceUuid.toUuidOrNull(),
            textCharacteristicUuid = config.characteristicUuid.toUuidOrNull(),
            chunkSizeBytes = config.chunkSizeBytes.coerceAtLeast(1),
            interChunkDelayMs = config.interChunkDelayMs.coerceAtLeast(0L),
        )
    }

    private fun String.toUuidOrNull(): UUID? {
        return runCatching { UUID.fromString(trim()) }.getOrNull()
    }
}
