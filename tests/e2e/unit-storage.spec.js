const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------- storage.js — Key Ring Functions ---------- */

test('getAgentKeys returns empty array when no keys stored', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getAgentKeys } = await import('/js/storage.js');
    return getAgentKeys();
  });
  expect(result).toEqual([]);
});

test('setAgentKeys stores and retrieves key ring array', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getAgentKeys, setAgentKeys } = await import('/js/storage.js');
    const keys = [
      { key: 'abc123', nickname: 'Test', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ];
    setAgentKeys(keys);
    return getAgentKeys();
  });
  expect(result).toHaveLength(1);
  expect(result[0].key).toBe('abc123');
  expect(result[0].nickname).toBe('Test');
});

test('setAgentKeys with empty array clears storage', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getAgentKeys, setAgentKeys } = await import('/js/storage.js');
    setAgentKeys([{ key: 'temp', nickname: 'X', addedAt: '', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false }]);
    setAgentKeys([]);
    return getAgentKeys();
  });
  expect(result).toEqual([]);
});

test('getAgentKeys auto-migrates legacy single key', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    // Set legacy format directly in localStorage
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('legacy-key-value'));
    const { getAgentKeys } = await import('/js/storage.js');
    const keys = getAgentKeys();
    // Legacy key should be removed
    const legacyGone = localStorage.getItem('waymark_agent_api_key') === null;
    return { keys, legacyGone };
  });
  expect(result.keys).toHaveLength(1);
  expect(result.keys[0].key).toBe('legacy-key-value');
  expect(result.keys[0].nickname).toBe('Key 1');
  expect(result.legacyGone).toBe(true);
});

test('getAgentApiKey returns first key from ring (backward compat)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getAgentApiKey, setAgentKeys } = await import('/js/storage.js');
    setAgentKeys([
      { key: 'first-key', nickname: 'A', addedAt: '', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
      { key: 'second-key', nickname: 'B', addedAt: '', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]);
    return getAgentApiKey();
  });
  expect(result).toBe('first-key');
});

test('getAgentApiKey returns empty string when no keys', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getAgentApiKey } = await import('/js/storage.js');
    return getAgentApiKey();
  });
  expect(result).toBe('');
});

test('setAgentApiKey migrates single key into ring', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { setAgentApiKey, getAgentKeys } = await import('/js/storage.js');
    setAgentApiKey('my-new-key');
    return getAgentKeys();
  });
  expect(result).toHaveLength(1);
  expect(result[0].key).toBe('my-new-key');
  expect(result[0].nickname).toBe('Key 1');
});

test('setAgentApiKey with empty string clears all keys', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { setAgentApiKey, setAgentKeys, getAgentKeys } = await import('/js/storage.js');
    setAgentKeys([{ key: 'x', nickname: 'X', addedAt: '', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false }]);
    setAgentApiKey('');
    return getAgentKeys();
  });
  expect(result).toEqual([]);
});

test('recordKeyUsage increments request count and sets lastUsed', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { setAgentKeys, getAgentKeys, recordKeyUsage } = await import('/js/storage.js');
    setAgentKeys([
      { key: 'k1', nickname: 'A', addedAt: '', requestsToday: 5, lastUsed: null, lastError: '2026-01-01', isBilled: false },
    ]);
    recordKeyUsage(0);
    const keys = getAgentKeys();
    return {
      count: keys[0].requestsToday,
      hasLastUsed: keys[0].lastUsed !== null,
      errorCleared: keys[0].lastError === null,
    };
  });
  expect(result.count).toBe(6);
  expect(result.hasLastUsed).toBe(true);
  expect(result.errorCleared).toBe(true);
});

test('recordKeyUsage is safe with out-of-range index', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { setAgentKeys, getAgentKeys, recordKeyUsage } = await import('/js/storage.js');
    setAgentKeys([{ key: 'k1', nickname: 'A', addedAt: '', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false }]);
    recordKeyUsage(99); // out of range — should not crash
    return getAgentKeys();
  });
  expect(result).toHaveLength(1);
  expect(result[0].requestsToday).toBe(0); // unchanged
});

test('recordKeyError sets lastError timestamp', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { setAgentKeys, getAgentKeys, recordKeyError } = await import('/js/storage.js');
    setAgentKeys([
      { key: 'k1', nickname: 'A', addedAt: '', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]);
    recordKeyError(0);
    return getAgentKeys()[0].lastError;
  });
  expect(result).not.toBeNull();
  // Should be a valid ISO date string
  expect(new Date(result).getTime()).toBeGreaterThan(0);
});

test('resetDailyKeyCounters zeroes all request counts', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { setAgentKeys, getAgentKeys, resetDailyKeyCounters } = await import('/js/storage.js');
    setAgentKeys([
      { key: 'k1', nickname: 'A', addedAt: '', requestsToday: 15, lastUsed: null, lastError: null, isBilled: false },
      { key: 'k2', nickname: 'B', addedAt: '', requestsToday: 8, lastUsed: null, lastError: null, isBilled: true },
    ]);
    resetDailyKeyCounters();
    return getAgentKeys().map(k => k.requestsToday);
  });
  expect(result).toEqual([0, 0]);
});
