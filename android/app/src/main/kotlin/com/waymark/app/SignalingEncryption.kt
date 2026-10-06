/* ============================================================
   SignalingEncryption.kt — AES-256-GCM signaling cell helpers
   ============================================================ */

package com.waymark.app

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object SignalingEncryption {

    const val ENCRYPT_PREFIX = "\uD83D\udd10SIG:"

    private const val IV_LENGTH = 12
    private const val TAG_LENGTH_BITS = 128
    private const val KEY_LENGTH_BYTES = 32

    private val secureRandom = SecureRandom()

    fun generateKeyHex(): String {
        val bytes = ByteArray(KEY_LENGTH_BYTES)
        secureRandom.nextBytes(bytes)
        return bytesToHex(bytes)
    }

    fun hexToBytes(hex: String): ByteArray {
        val clean = hex.trim()
        require(clean.length % 2 == 0) { "Hex string must have even length" }
        val bytes = ByteArray(clean.length / 2)
        for (index in clean.indices step 2) {
            val hi = clean[index].digitToIntOrNull(16) ?: throw IllegalArgumentException("Invalid hex string")
            val lo = clean[index + 1].digitToIntOrNull(16) ?: throw IllegalArgumentException("Invalid hex string")
            bytes[index / 2] = ((hi shl 4) + lo).toByte()
        }
        return bytes
    }

    fun bytesToHex(bytes: ByteArray): String {
        return buildString(bytes.size * 2) {
            for (byte in bytes) {
                append("%02x".format(byte))
            }
        }
    }

    fun encrypt(plaintext: String?, hexKey: String): String {
        validateKey(hexKey)
        val iv = ByteArray(IV_LENGTH).also(secureRandom::nextBytes)
        val keyBytes = hexToBytes(hexKey)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(TAG_LENGTH_BITS, iv))
        val ciphertext = cipher.doFinal((plaintext ?: "").toByteArray(Charsets.UTF_8))
        val combined = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(ciphertext, 0, combined, iv.size, ciphertext.size)
        return ENCRYPT_PREFIX + Base64.getEncoder().encodeToString(combined)
    }

    fun decrypt(value: String?, hexKey: String): String? {
        if (value.isNullOrEmpty()) return null
        if (!value.startsWith(ENCRYPT_PREFIX)) return value

        return try {
            validateKey(hexKey)
            val combined = Base64.getDecoder().decode(value.removePrefix(ENCRYPT_PREFIX))
            if (combined.size < IV_LENGTH + 16) return null
            val iv = combined.copyOfRange(0, IV_LENGTH)
            val ciphertext = combined.copyOfRange(IV_LENGTH, combined.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                SecretKeySpec(hexToBytes(hexKey), "AES"),
                GCMParameterSpec(TAG_LENGTH_BITS, iv),
            )
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (_: Throwable) {
            null
        }
    }

    private fun validateKey(hexKey: String) {
        require(hexKey.length == KEY_LENGTH_BYTES * 2) { "AES-256 key must be 64 hex characters" }
    }
}
