/* ============================================================
   SignalingEncryption.kt — AES-256-GCM cell encryption for the
   public signaling sheet.

   All peer presence, offers, and answers written to the public
   signaling sheet are AES-256-GCM encrypted before being stored.
   The 256-bit key is fetched once from the private key sheet
   (which requires OAuth) and cached in SharedPreferences.

   Encrypted cell format:
     ENCRYPT_PREFIX + Base64( nonce[12] + ciphertext + authTag[16] )

   Cells that do not start with ENCRYPT_PREFIX are returned as-is
   (forward-compatibility with any unencrypted rows written before
   the key was provisioned).

   All methods are in a companion object so they can be invoked
   in JVM unit tests without an Android context.
   ============================================================ */

package com.waymark.app

import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import java.security.SecureRandom

/**
 * AES-256-GCM encryption helpers for public signaling sheet cells.
 *
 * The static [companion object] interface allows these pure functions to be
 * unit-tested on the JVM without an Android runtime dependency.
 */
object SignalingEncryption {

    companion object {

        /** Marker prefix for encrypted signaling cell values. Matches Node.js peer. */
        const val ENCRYPT_PREFIX = "\uD83D\uDD10SIG:"  // 🔐SIG:

        private const val ALGO         = "AES/GCM/NoPadding"
        private const val KEY_LEN      = 32   // 256-bit key → 64 hex chars
        private const val IV_LEN       = 12   // 96-bit GCM nonce
        private const val TAG_LEN_BITS = 128  // 128-bit GCM authentication tag

        /**
         * Encrypt [plaintext] with AES-256-GCM using [keyHex].
         *
         * @param plaintext  Raw JSON string to encrypt (signaling cell value)
         * @param keyHex     64-char hex-encoded AES-256 key from the private key sheet
         * @return           ENCRYPT_PREFIX + Base64(nonce[12] + ciphertext + authTag[16])
         * @throws IllegalArgumentException if [keyHex] is not a valid 32-byte key
         */
        fun encrypt(plaintext: String, keyHex: String): String {
            val keyBytes = hexToBytes(keyHex)
            require(keyBytes.size == KEY_LEN) { "Signal key must be 32 bytes (64 hex chars)" }

            val iv = ByteArray(IV_LEN).also { SecureRandom().nextBytes(it) }
            val secretKey = SecretKeySpec(keyBytes, "AES")
            val cipher = Cipher.getInstance(ALGO)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, GCMParameterSpec(TAG_LEN_BITS, iv))
            // doFinal returns ciphertext + 16-byte auth tag (GCM mode appends tag)
            val ciphertextWithTag = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

            val combined = ByteArray(IV_LEN + ciphertextWithTag.size)
            System.arraycopy(iv, 0, combined, 0, IV_LEN)
            System.arraycopy(ciphertextWithTag, 0, combined, IV_LEN, ciphertextWithTag.size)

            return ENCRYPT_PREFIX + Base64.getEncoder().encodeToString(combined)
        }

        /**
         * Decrypt a value produced by [encrypt].
         *
         * If [encoded] does not start with [ENCRYPT_PREFIX], it is returned
         * unchanged (plaintext passthrough for backwards compatibility).
         *
         * @param encoded  Cell value from the sheet (encrypted or plaintext)
         * @param keyHex   64-char hex-encoded AES-256 key
         * @return         Decrypted plaintext, the original [encoded] value if not
         *                 encrypted, or null on decryption failure (wrong key / corrupt)
         */
        fun decrypt(encoded: String?, keyHex: String): String? {
            if (encoded.isNullOrBlank()) return encoded
            if (!encoded.startsWith(ENCRYPT_PREFIX)) return encoded  // plaintext passthrough

            return try {
                val keyBytes = hexToBytes(keyHex)
                val combined = Base64.getDecoder().decode(encoded.substring(ENCRYPT_PREFIX.length))
                if (combined.size < IV_LEN + 1) return null

                val iv = combined.copyOfRange(0, IV_LEN)
                // Remaining bytes = ciphertext + authTag (GCM tag is the last 16 bytes)
                val ciphertextWithTag = combined.copyOfRange(IV_LEN, combined.size)

                val secretKey = SecretKeySpec(keyBytes, "AES")
                val cipher = Cipher.getInstance(ALGO)
                cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(TAG_LEN_BITS, iv))
                String(cipher.doFinal(ciphertextWithTag), Charsets.UTF_8)
            } catch (e: Exception) {
                null // Wrong key or corrupted ciphertext → signal key may have been cycled
            }
        }

        /**
         * Generate a new random AES-256 key as a 64-char hex string.
         * Used when provisioning or cycling the signal key.
         *
         * @return 64-character lowercase hex string
         */
        fun generateKeyHex(): String {
            val bytes = ByteArray(KEY_LEN)
            SecureRandom().nextBytes(bytes)
            return bytesToHex(bytes)
        }

        /**
         * Decode a lowercase or uppercase hex string to a byte array.
         *
         * @throws IllegalArgumentException if [hex] has odd length or invalid characters
         */
        fun hexToBytes(hex: String): ByteArray {
            require(hex.length % 2 == 0) { "Hex string must have even length, got ${hex.length}" }
            return ByteArray(hex.length / 2) { i ->
                val hi = hex[i * 2].digitToInt(16)
                val lo = hex[i * 2 + 1].digitToInt(16)
                ((hi shl 4) or lo).toByte()
            }
        }

        /** Encode a byte array to a lowercase hex string. */
        fun bytesToHex(bytes: ByteArray): String =
            bytes.joinToString("") { "%02x".format(it) }
    }
}
