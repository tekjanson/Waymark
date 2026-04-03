// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------- Helpers ---------- */

/**
 * Instantiate WaymarkConnect in the browser for testing its encryption methods.
 * Uses a stub signal adaptor so no real Sheets API calls occur.
 */
async function makeConnect(page, opts = {}) {
  return page.evaluate(async (options) => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    // Stub signal — no-ops
    const signal = {
      readAll: async () => [],
      writeCell: async () => {},
    };
    const wc = new WaymarkConnect('test-sheet-id', { ...options, signal });
    return { sheetId: wc.sheetId, hasPassword: !!wc._password };
  }, opts);
}

/* ---------- Encryption round-trip ---------- */

test('webrtc: _encryptSignal returns plaintext unchanged when no password is set', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const wc = new WaymarkConnect('sheet-x', {
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    return wc._encryptSignal('{"hello":"world"}');
  });
  expect(result).toBe('{"hello":"world"}');
});

test('webrtc: _encryptSignal returns empty string unchanged', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const wc = new WaymarkConnect('sheet-x', {
      password: 'secret',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    return wc._encryptSignal('');
  });
  expect(result).toBe('');
});

test('webrtc: _encryptSignal produces encrypted string with HND prefix when password is set', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const wc = new WaymarkConnect('sheet-x', {
      password: 'testpassword',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    return wc._encryptSignal('{"sdp":"test-sdp"}');
  });
  expect(result).toMatch(/^\u{1F510}HND:/u);
  expect(result).not.toContain('test-sdp');
});

test('webrtc: round-trip encrypt/decrypt with same password recovers plaintext', async ({ page }) => {
  await setupApp(page);
  const plaintext = '{"offers":{"peer1":{"sdp":"v=0\\r\\no=- 123456789","ts":1234567890}}}';
  const result = await page.evaluate(async (pt) => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const wc = new WaymarkConnect('sheet-abc', {
      password: 'my-session-pw',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    const encrypted = await wc._encryptSignal(pt);
    const decrypted = await wc._decryptSignal(encrypted);
    return { encrypted, decrypted };
  }, plaintext);
  expect(result.encrypted).toMatch(/^\u{1F510}HND:/u);
  expect(result.decrypted).toBe(plaintext);
});

test('webrtc: _decryptSignal returns null when password is wrong', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const encryptor = new WaymarkConnect('sheet-abc', {
      password: 'correct-password',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    const decryptor = new WaymarkConnect('sheet-abc', {
      password: 'wrong-password',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    const encrypted = await encryptor._encryptSignal('{"hello":"world"}');
    const result = await decryptor._decryptSignal(encrypted);
    return result;
  });
  expect(result).toBeNull();
});

test('webrtc: _decryptSignal returns plaintext unchanged if no HND prefix', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const wc = new WaymarkConnect('sheet-x', {
      password: 'mypassword',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    return wc._decryptSignal('{"plain":"data"}');
  });
  expect(result).toBe('{"plain":"data"}');
});

test('webrtc: _decryptSignal returns null for HND-prefixed data when no password is set', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const encryptor = new WaymarkConnect('sheet-x', {
      password: 'some-password',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    const noPassword = new WaymarkConnect('sheet-x', {
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    const encrypted = await encryptor._encryptSignal('sensitive-data');
    const result = await noPassword._decryptSignal(encrypted);
    return result;
  });
  expect(result).toBeNull();
});

test('webrtc: setPassword updates password and clears cached key', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const wc = new WaymarkConnect('sheet-x', {
      password: 'initial-password',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    // Trigger key derivation to populate cache
    await wc._deriveHandshakeKey();
    const hadKey1 = wc._handshakeKey !== null;

    // Update password — should clear cache
    wc.setPassword('new-password');
    const hadKey2 = wc._handshakeKey === null;
    const newPw = wc._password;

    return { hadKey1, hadKey2, newPw };
  });
  expect(result.hadKey1).toBe(true);
  expect(result.hadKey2).toBe(true); // cache cleared
  expect(result.newPw).toBe('new-password');
});

test('webrtc: setPassword(null) disables encryption', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const wc = new WaymarkConnect('sheet-x', {
      password: 'some-password',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    wc.setPassword(null);
    // Encrypting without a password should return plaintext
    const encrypted = await wc._encryptSignal('plain-data');
    return { encrypted, password: wc._password };
  });
  expect(result.encrypted).toBe('plain-data');
  expect(result.password).toBeNull();
});

test('webrtc: same password on different sheetIds produces different ciphertexts', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const wc1 = new WaymarkConnect('sheet-111', {
      password: 'shared-password',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    const wc2 = new WaymarkConnect('sheet-222', {
      password: 'shared-password',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    const plaintext = '{"candidate":"test"}';
    const enc1 = await wc1._encryptSignal(plaintext);
    const enc2 = await wc2._encryptSignal(plaintext);
    // Same password on different sheets should use different keys (different salts)
    const crossDecrypt = await wc2._decryptSignal(enc1);
    return { enc1, enc2, crossDecrypt };
  });
  // Encrypted values should differ (different keys from different salts)
  expect(result.enc1).not.toBe(result.enc2);
  // Cross-decryption should fail (different sheet salt makes different key)
  expect(result.crossDecrypt).toBeNull();
});

test('webrtc: two encrypt calls with same plaintext produce different ciphertexts (random IV)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { WaymarkConnect } = await import('/js/webrtc.js');
    const wc = new WaymarkConnect('sheet-x', {
      password: 'my-password',
      signal: { readAll: async () => [], writeCell: async () => {} },
    });
    const plaintext = '{"offer":"same-content"}';
    const enc1 = await wc._encryptSignal(plaintext);
    const enc2 = await wc._encryptSignal(plaintext);
    // Both should be decryptable
    const dec1 = await wc._decryptSignal(enc1);
    const dec2 = await wc._decryptSignal(enc2);
    return { enc1, enc2, dec1, dec2 };
  });
  // Different IVs should produce different ciphertexts
  expect(result.enc1).not.toBe(result.enc2);
  // But both should decrypt correctly
  expect(result.dec1).toBe('{"offer":"same-content"}');
  expect(result.dec2).toBe('{"offer":"same-content"}');
});
