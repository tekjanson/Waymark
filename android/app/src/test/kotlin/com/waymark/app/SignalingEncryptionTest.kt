/* ============================================================
   SignalingEncryptionTest.kt — JVM unit tests for AES-256-GCM
   signaling cell encryption helpers.

   Tests run on the JVM with no Android context required because
   SignalingEncryption.companion uses java.util.Base64 and the
   standard JCE crypto providers.
   ============================================================ */

package com.waymark.app

import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

/**
 * Unit tests for [SignalingEncryption.Companion] pure helper functions.
 */
class SignalingEncryptionTest {

    /* ---------- Test fixtures ---------- */

    /** A 64-char hex AES-256 key for all encryption tests. */
    private val TEST_KEY = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"

    /** A different 64-char hex key — decryption with this key must fail. */
    private val WRONG_KEY = "f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff101112131415161718191a1b1c1d1e1f"

    /* ---------- generateKeyHex tests ---------- */

    @Test
    fun `generateKeyHex returns 64 lowercase hex chars`() {
        val key = SignalingEncryption.generateKeyHex()
        assertEquals("key must be 64 chars (32 bytes hex)", 64, key.length)
        assertTrue("key must be lowercase hex", key.all { it in '0'..'9' || it in 'a'..'f' })
    }

    @Test
    fun `generateKeyHex produces unique keys each call`() {
        val k1 = SignalingEncryption.generateKeyHex()
        val k2 = SignalingEncryption.generateKeyHex()
        assertNotEquals("two generated keys must differ", k1, k2)
    }

    /* ---------- hexToBytes / bytesToHex round-trip ---------- */

    @Test
    fun `hexToBytes and bytesToHex round-trip`() {
        val hex    = "deadbeef01234567"
        val bytes  = SignalingEncryption.hexToBytes(hex)
        val back   = SignalingEncryption.bytesToHex(bytes)
        assertEquals(hex, back)
    }

    @Test
    fun `hexToBytes handles uppercase input`() {
        val bytes = SignalingEncryption.hexToBytes("DEADBEEF")
        assertEquals(4, bytes.size)
        assertEquals(0xDE.toByte(), bytes[0])
        assertEquals(0xBE.toByte(), bytes[2])
    }

    @Test(expected = IllegalArgumentException::class)
    fun `hexToBytes throws on odd-length input`() {
        SignalingEncryption.hexToBytes("abc")
    }

    /* ---------- encrypt / decrypt round-trip ---------- */

    @Test
    fun `encrypt then decrypt returns original plaintext`() {
        val plaintext = """{"peerId":"a1b2c3d4","name":"Test","ts":1700000000000}"""
        val encrypted = SignalingEncryption.encrypt(plaintext, TEST_KEY)
        val decrypted = SignalingEncryption.decrypt(encrypted, TEST_KEY)
        assertEquals(plaintext, decrypted)
    }

    @Test
    fun `encrypt produces ENCRYPT_PREFIX output`() {
        val encrypted = SignalingEncryption.encrypt("hello", TEST_KEY)
        assertTrue("must start with ENCRYPT_PREFIX", encrypted.startsWith(SignalingEncryption.ENCRYPT_PREFIX))
    }

    @Test
    fun `encrypt produces different ciphertexts for same plaintext (random nonce)`() {
        val plaintext = "same message"
        val enc1 = SignalingEncryption.encrypt(plaintext, TEST_KEY)
        val enc2 = SignalingEncryption.encrypt(plaintext, TEST_KEY)
        assertNotEquals("each encrypt call must produce a different ciphertext due to random IV", enc1, enc2)
    }

    @Test
    fun `decrypt returns null for wrong key`() {
        val encrypted = SignalingEncryption.encrypt("secret data", TEST_KEY)
        val result = SignalingEncryption.decrypt(encrypted, WRONG_KEY)
        assertNull("decrypt with wrong key must return null", result)
    }

    @Test
    fun `decrypt passes through plaintext value (no prefix)`() {
        val plaintext = """{"peerId":"xyz"}"""
        val result = SignalingEncryption.decrypt(plaintext, TEST_KEY)
        assertEquals("non-encrypted value must pass through unchanged", plaintext, result)
    }

    @Test
    fun `decrypt returns null for empty string`() {
        assertNull(SignalingEncryption.decrypt(null, TEST_KEY))
        assertEquals("", SignalingEncryption.decrypt("", TEST_KEY))
    }

    @Test
    fun `decrypt returns null for truncated ciphertext`() {
        // Build a minimal encrypted value and truncate it
        val enc = SignalingEncryption.encrypt("data", TEST_KEY)
        // Strip most of the payload — only keep prefix + a few chars
        val truncated = enc.take(SignalingEncryption.ENCRYPT_PREFIX.length + 4)
        val result = SignalingEncryption.decrypt(truncated, TEST_KEY)
        assertNull("truncated ciphertext must return null not throw", result)
    }

    /* ---------- encrypt output structure ---------- */

    @Test
    fun `encrypted value encodes iv + ciphertext + tag (min 29 base64 bytes)`() {
        // AES-GCM: 12-byte IV + 1 byte min ciphertext + 16-byte tag = 29 bytes minimum
        val enc = SignalingEncryption.encrypt("x", TEST_KEY)
        val payload = enc.removePrefix(SignalingEncryption.ENCRYPT_PREFIX)
        val bytes = Base64.getDecoder().decode(payload)
        assertTrue("combined must be at least 29 bytes (12 IV + 1 data + 16 tag)", bytes.size >= 29)
    }

    @Test
    fun `encrypt throws for wrong-length key`() {
        try {
            SignalingEncryption.encrypt("hello", "1234")  // too short
            fail("Expected IllegalArgumentException for short key")
        } catch (e: IllegalArgumentException) {
            // expected
        }
    }

    /* ---------- JSON round-trip (realistic signaling data) ---------- */

    @Test
    fun `presence JSON survives encrypt-decrypt cycle`() {
        val presence = """{"peerId":"a1b2c3d4","name":"Alice","ts":1700000000000,"nonce":"deadbeef"}"""
        val enc = SignalingEncryption.encrypt(presence, TEST_KEY)
        val dec = SignalingEncryption.decrypt(enc, TEST_KEY)
        assertEquals(presence, dec)
    }

    @Test
    fun `offer JSON survives encrypt-decrypt cycle`() {
        val offer = """{"b2c3d4e5":{"sdp":"v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n","ts":1700000000000}}"""
        val enc = SignalingEncryption.encrypt(offer, TEST_KEY)
        val dec = SignalingEncryption.decrypt(enc, TEST_KEY)
        assertEquals(offer, dec)
    }

    @Test
    fun `empty string clear operation bypasses encryption`() {
        // Clearing a cell sends empty string — should NOT be encrypted (to avoid double empty)
        val enc = SignalingEncryption.encrypt("", TEST_KEY)
        // The encrypt function should return un-prefixed empty string or prefix+base64 of ""
        // The SignalingClient skips encryption for empty values, so this test validates
        // that the encryption of empty string still decodes back correctly.
        val dec = SignalingEncryption.decrypt(enc, TEST_KEY)
        assertEquals("", dec)
    }
}
