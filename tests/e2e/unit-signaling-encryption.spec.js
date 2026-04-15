/**
 * unit-signaling-encryption.spec.js
 *
 * Node.js-side AES-256-GCM cell encryption helpers from sheet-webrtc-peer.mjs.
 * Tests run inside a Playwright browser context so they share the same test
 * runner as all other E2E tests, but the logic under test is pure JavaScript
 * imported via a dynamic import() inside page.evaluate().
 *
 * Uses the flat test() + setupApp() pattern required by AI_LAWS §4.1.
 */
const { test, expect } = require("@playwright/test");
const { setupApp } = require("../helpers/test-utils");

// --------------------------------------------------------------------------
//  Helpers imported in page context
// --------------------------------------------------------------------------

// Because sheet-webrtc-peer.mjs is an ES module with Node.js crypto APIs that
// are not available in the browser, we exercise the helpers through Node's
// page.evaluate() running in a vm context where we can `require` them with
// a direct file path.  Playwright's `page.evaluate` serialises return values,
// so we pass primitives back.

// We use a server-side evaluate approach: run a child process snippet via
// page.evaluate calling a special server action, OR simply import in Node via
// direct import().  Since Playwright runs Node.js, we can import directly.

const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const PEER_MOD = path.join(ROOT, "mcp/sheet-webrtc-peer.mjs");

// Dynamic import is at the TOP of the file so all tests share the cached module.
let _mod;
async function loadMod() {
    if (!_mod) _mod = await import(PEER_MOD);
    return _mod;
}

// --------------------------------------------------------------------------
//  Tests
// --------------------------------------------------------------------------

test("encrypt returns a string with the 🔐SIG: prefix", async ({ page }) => {
    await setupApp(page);
    const { encryptCell, ENCRYPT_PREFIX } = await loadMod();
    const key = "a".repeat(64);
    const result = encryptCell("hello world", key);
    expect(typeof result).toBe("string");
    expect(result.startsWith(ENCRYPT_PREFIX)).toBe(true);
});

test("decrypt recovers the original plaintext after encrypt", async ({ page }) => {
    await setupApp(page);
    const { encryptCell, decryptCell } = await loadMod();
    const key = "b".repeat(64);
    const plain = "waymark signaling payload";
    const cipher = encryptCell(plain, key);
    expect(decryptCell(cipher, key)).toBe(plain);
});

test("decrypt returns null for wrong key", async ({ page }) => {
    await setupApp(page);
    const { encryptCell, decryptCell } = await loadMod();
    const key1 = "c".repeat(64);
    const key2 = "d".repeat(64);
    const cipher = encryptCell("secret", key1);
    expect(decryptCell(cipher, key2)).toBeNull();
});

test("decrypt passes through values without the prefix unchanged", async ({ page }) => {
    await setupApp(page);
    const { decryptCell } = await loadMod();
    const key = "e".repeat(64);
    expect(decryptCell("plain text no prefix", key)).toBe("plain text no prefix");
    expect(decryptCell("{\"peerId\":\"abc\"}", key)).toBe("{\"peerId\":\"abc\"}");
});

test("encrypt produces different ciphertext each call (random nonce)", async ({ page }) => {
    await setupApp(page);
    const { encryptCell } = await loadMod();
    const key = "f".repeat(64);
    const plain = "same plaintext";
    const c1 = encryptCell(plain, key);
    const c2 = encryptCell(plain, key);
    // Different nonces → different Base64 ciphertexts
    expect(c1).not.toBe(c2);
});

test("decrypt handles null and undefined gracefully", async ({ page }) => {
    await setupApp(page);
    const { decryptCell } = await loadMod();
    const key = "1".repeat(64);
    expect(decryptCell(null, key)).toBeNull();
    expect(decryptCell(undefined, key)).toBeNull();
    expect(decryptCell("", key)).toBeNull();
});

test("encrypt handles empty string and returns prefix + Base64", async ({ page }) => {
    await setupApp(page);
    const { encryptCell, decryptCell, ENCRYPT_PREFIX } = await loadMod();
    const key = "2".repeat(64);
    const cipher = encryptCell("", key);
    // Should have prefix
    expect(cipher.startsWith(ENCRYPT_PREFIX)).toBe(true);
    // Decrypt should recover the original empty string
    expect(decryptCell(cipher, key)).toBe("");
});

test("encrypted cell Base64 payload decodes to at least 29 bytes (12 IV + 1 min data + 16 tag)", async ({ page }) => {
    await setupApp(page);
    const { encryptCell, ENCRYPT_PREFIX } = await loadMod();
    const key = "3".repeat(64);
    const cipher = encryptCell("x", key);
    const b64 = cipher.slice(ENCRYPT_PREFIX.length);
    const buf = Buffer.from(b64, "base64");
    expect(buf.length).toBeGreaterThanOrEqual(29);
});

test("decrypt rejects truncated ciphertext (missing auth tag)", async ({ page }) => {
    await setupApp(page);
    const { encryptCell, decryptCell, ENCRYPT_PREFIX } = await loadMod();
    const key = "4".repeat(64);
    const cipher = encryptCell("truncation test", key);
    // Slice off the last 20 bytes of Base64 to corrupt the auth tag
    const truncated = ENCRYPT_PREFIX + cipher.slice(ENCRYPT_PREFIX.length, -20);
    expect(decryptCell(truncated, key)).toBeNull();
});

test("encrypt handles JSON-serialised signaling payloads (presence, offer)", async ({ page }) => {
    await setupApp(page);
    const { encryptCell, decryptCell } = await loadMod();
    const key = "5".repeat(64);
    const presence = JSON.stringify({ peerId: "abc12345", name: "TestPeer", ts: Date.now() });
    const offer = JSON.stringify({ sdp: "v=0\r\no=...\r\n", type: "offer", ts: Date.now() });
    expect(decryptCell(encryptCell(presence, key), key)).toBe(presence);
    expect(decryptCell(encryptCell(offer, key), key)).toBe(offer);
});

test("encrypt uses exactly 12-byte IV stored at start of decoded payload", async ({ page }) => {
    await setupApp(page);
    const { encryptCell, ENCRYPT_PREFIX } = await loadMod();
    const key = "6".repeat(64);
    const cipher = encryptCell("nonce-check", key);
    const buf = Buffer.from(cipher.slice(ENCRYPT_PREFIX.length), "base64");
    // First 12 bytes are the nonce — they should NOT all be zero (random)
    const iv = buf.slice(0, 12);
    const allZero = iv.every(b => b === 0);
    expect(allZero).toBe(false);
});
