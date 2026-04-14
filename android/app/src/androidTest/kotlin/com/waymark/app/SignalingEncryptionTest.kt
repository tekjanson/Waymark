/* ============================================================
   SignalingEncryptionTest.kt — Unit tests for AES-256-GCM
   encryption/decryption used in signaling cells.

   Runs on the device to validate the JVM crypto implementation
   matches the expected format.
   ============================================================ */

package com.waymark.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SignalingEncryptionTest {

    @Test
    fun generateKeyHex_returns64CharHex() {
        val key = SignalingEncryption.generateKeyHex()
        assertEquals(64, key.length)
        assertTrue("Key should be hex", key.matches(Regex("[0-9a-f]{64}")))
    }

    @Test
    fun encryptDecrypt_roundTrip() {
        val key = SignalingEncryption.generateKeyHex()
        val plaintext = """{"peerId":"abcd1234","name":"Test","ts":1234567890}"""
        val encrypted = SignalingEncryption.encrypt(plaintext, key)

        assertTrue("Should start with prefix", encrypted.startsWith(SignalingEncryption.ENCRYPT_PREFIX))
        assertNotEquals(plaintext, encrypted)

        val decrypted = SignalingEncryption.decrypt(encrypted, key)
        assertEquals(plaintext, decrypted)
    }

    @Test
    fun decrypt_wrongKey_returnsNull() {
        val key1 = SignalingEncryption.generateKeyHex()
        val key2 = SignalingEncryption.generateKeyHex()
        val encrypted = SignalingEncryption.encrypt("hello", key1)

        val result = SignalingEncryption.decrypt(encrypted, key2)
        assertNull("Wrong key should return null", result)
    }

    @Test
    fun decrypt_plaintext_returnsUnchanged() {
        val key = SignalingEncryption.generateKeyHex()
        val plaintext = """{"peerId":"abcd1234"}"""

        val result = SignalingEncryption.decrypt(plaintext, key)
        assertEquals("Plaintext should pass through unchanged", plaintext, result)
    }

    @Test
    fun decrypt_null_returnsNull() {
        val key = SignalingEncryption.generateKeyHex()
        val result = SignalingEncryption.decrypt(null, key)
        assertNull(result)
    }

    @Test
    fun decrypt_empty_returnsEmpty() {
        val key = SignalingEncryption.generateKeyHex()
        val result = SignalingEncryption.decrypt("", key)
        assertEquals("", result)
    }

    @Test
    fun encrypt_differentNonceEachTime() {
        val key = SignalingEncryption.generateKeyHex()
        val plaintext = "same input"
        val enc1 = SignalingEncryption.encrypt(plaintext, key)
        val enc2 = SignalingEncryption.encrypt(plaintext, key)

        assertNotEquals("Same plaintext should produce different ciphertext (random nonce)", enc1, enc2)

        // Both should decrypt to the same value
        assertEquals(plaintext, SignalingEncryption.decrypt(enc1, key))
        assertEquals(plaintext, SignalingEncryption.decrypt(enc2, key))
    }

    @Test
    fun hexToBytes_and_bytesToHex_roundTrip() {
        val original = "0123456789abcdef"
        val bytes = SignalingEncryption.hexToBytes(original)
        val hex = SignalingEncryption.bytesToHex(bytes)
        assertEquals(original, hex)
    }
}
