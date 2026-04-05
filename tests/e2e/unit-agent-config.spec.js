/* ============================================================
   unit-agent-config.spec.js — Unit tests for agent/config.js pure helpers
   Tests: pickBestKey, buildAgentSystemPrompt
   ============================================================ */
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------- buildAgentSystemPrompt ---------- */

test('buildAgentSystemPrompt returns base prompt when no context given', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { buildAgentSystemPrompt, BASE_SYSTEM_PROMPT } = await import('/js/agent/config.js');
    return buildAgentSystemPrompt() === BASE_SYSTEM_PROMPT;
  });
  expect(result).toBe(true);
});

test('buildAgentSystemPrompt appends context block with newlines', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { buildAgentSystemPrompt } = await import('/js/agent/config.js');
    return buildAgentSystemPrompt('Base prompt.', 'Context block.');
  });
  expect(result).toBe('Base prompt.\n\nContext block.');
});

test('buildAgentSystemPrompt accepts empty context without extra newlines', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { buildAgentSystemPrompt } = await import('/js/agent/config.js');
    return buildAgentSystemPrompt('Base.', '');
  });
  expect(result).toBe('Base.');
});

test('buildAgentSystemPrompt uses BASE_SYSTEM_PROMPT as default first argument', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { buildAgentSystemPrompt, BASE_SYSTEM_PROMPT } = await import('/js/agent/config.js');
    const built = buildAgentSystemPrompt(undefined, 'Some context.');
    return built.startsWith(BASE_SYSTEM_PROMPT);
  });
  expect(result).toBe(true);
});

/* ---------- pickBestKey — no keys ---------- */

test('pickBestKey returns empty array when no keys are configured', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { pickBestKey } = await import('/js/agent/config.js');
    return pickBestKey();
  });
  expect(result).toHaveLength(0);
});

test('pickBestKey includes server key as fallback when no user keys', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    window.__WAYMARK_API_KEY = 'server-key-test';
    const { pickBestKey } = await import('/js/agent/config.js');
    const keys = pickBestKey();
    window.__WAYMARK_API_KEY = undefined;
    return keys;
  });
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ key: 'server-key-test', idx: -1 });
});

/* ---------- pickBestKey — single key ---------- */

test('pickBestKey returns single user key when configured', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'key-a', requestsToday: 0, lastError: null, isBilled: false },
    ]));
    const { pickBestKey } = await import('/js/agent/config.js');
    const keys = pickBestKey();
    localStorage.removeItem('waymark_agent_keys');
    return keys;
  });
  expect(result).toHaveLength(1);
  expect(result[0].key).toBe('key-a');
  expect(result[0].idx).toBe(0);
});

/* ---------- pickBestKey — LRU ordering ---------- */

test('pickBestKey orders keys by fewest requests today (LRU first)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'heavy', requestsToday: 10, lastError: null, isBilled: false },
      { key: 'light', requestsToday: 2, lastError: null, isBilled: false },
      { key: 'fresh', requestsToday: 0, lastError: null, isBilled: false },
    ]));
    const { pickBestKey } = await import('/js/agent/config.js');
    const keys = pickBestKey();
    localStorage.removeItem('waymark_agent_keys');
    return keys.map(k => k.key);
  });
  expect(result[0]).toBe('fresh');
  expect(result[1]).toBe('light');
  expect(result[2]).toBe('heavy');
});

/* ---------- pickBestKey — error handling ---------- */

test('pickBestKey pushes recently-errored keys to end', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const recentError = new Date(Date.now() - 5000).toISOString(); // 5 seconds ago
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'errored', requestsToday: 0, lastError: recentError, isBilled: false },
      { key: 'healthy', requestsToday: 5, lastError: null, isBilled: false },
    ]));
    const { pickBestKey } = await import('/js/agent/config.js');
    const keys = pickBestKey();
    localStorage.removeItem('waymark_agent_keys');
    return keys.map(k => k.key);
  });
  // healthy key (even with more requests) should come before recently errored key
  expect(result[0]).toBe('healthy');
});

test('pickBestKey allows stale-errored keys (older than 60 seconds)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const oldError = new Date(Date.now() - 120000).toISOString(); // 2 minutes ago
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'old-err', requestsToday: 0, lastError: oldError, isBilled: false },
      { key: 'heavy', requestsToday: 8, lastError: null, isBilled: false },
    ]));
    const { pickBestKey } = await import('/js/agent/config.js');
    const keys = pickBestKey();
    localStorage.removeItem('waymark_agent_keys');
    return keys.map(k => k.key);
  });
  // old-err has 0 requests so LRU puts it first (error timeout has passed)
  expect(result[0]).toBe('old-err');
});

test('pickBestKey returns single fallback when all keys have recent errors', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const recentError = new Date(Date.now() - 5000).toISOString();
    const slightlyOlder = new Date(Date.now() - 10000).toISOString();
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'a', requestsToday: 0, lastError: recentError, isBilled: false },
      { key: 'b', requestsToday: 0, lastError: slightlyOlder, isBilled: false },
    ]));
    const { pickBestKey } = await import('/js/agent/config.js');
    const keys = pickBestKey();
    localStorage.removeItem('waymark_agent_keys');
    return keys.map(k => k.key);
  });
  // When all keys have errors, oldest error is returned first
  expect(result).toHaveLength(1);
  expect(result[0]).toBe('b');
});

/* ---------- pickBestKey — billed key preference for pro models ---------- */

test('pickBestKey prefers billed keys for pro models', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'free-key', requestsToday: 0, lastError: null, isBilled: false },
      { key: 'billed-key', requestsToday: 5, lastError: null, isBilled: true },
    ]));
    localStorage.setItem('waymark_agent_model', JSON.stringify('gemini-pro'));
    const { pickBestKey } = await import('/js/agent/config.js');
    const keys = pickBestKey({ model: 'gemini-pro' });
    localStorage.removeItem('waymark_agent_keys');
    localStorage.removeItem('waymark_agent_model');
    return keys.map(k => k.key);
  });
  expect(result[0]).toBe('billed-key');
});

test('pickBestKey uses LRU for non-pro models (not billed preference)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'free-light', requestsToday: 1, lastError: null, isBilled: false },
      { key: 'billed-heavy', requestsToday: 8, lastError: null, isBilled: true },
    ]));
    const { pickBestKey } = await import('/js/agent/config.js');
    const keys = pickBestKey({ model: 'gemini-flash-latest' });
    localStorage.removeItem('waymark_agent_keys');
    return keys.map(k => k.key);
  });
  // For flash model, billed preference doesn't apply — free-light wins by LRU
  expect(result[0]).toBe('free-light');
});

/* ---------- pickBestKey — server key as last resort ---------- */

test('pickBestKey appends server key after user keys', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'user-key', requestsToday: 0, lastError: null, isBilled: false },
    ]));
    window.__WAYMARK_API_KEY = 'server-fallback';
    const { pickBestKey } = await import('/js/agent/config.js');
    const keys = pickBestKey();
    localStorage.removeItem('waymark_agent_keys');
    window.__WAYMARK_API_KEY = undefined;
    return keys.map(k => ({ key: k.key, idx: k.idx }));
  });
  expect(result[0].key).toBe('user-key');
  expect(result[0].idx).toBe(0);
  expect(result[result.length - 1].key).toBe('server-fallback');
  expect(result[result.length - 1].idx).toBe(-1);
});

/* ---------- generateText — key rotation via shared.js ---------- */

test('generateText in shared.js uses pickBestKey (fetch called once per key)', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    // Seed two keys
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'key1', requestsToday: 0, lastError: null, isBilled: false },
      { key: 'key2', requestsToday: 1, lastError: null, isBilled: false },
    ]));

    const calls = [];
    const originalFetch = window.fetch;

    // Mock fetch: first key returns 429, second key returns success
    window.fetch = async (url, init) => {
      const headers = init?.headers || {};
      calls.push(headers['X-goog-api-key']);
      if (headers['X-goog-api-key'] === 'key1') {
        return { ok: false, status: 429, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'AI response' }] } }],
        }),
      };
    };

    let response;
    try {
      const { generateText } = await import('/js/templates/shared.js');
      response = await generateText('System prompt', 'User message');
    } finally {
      window.fetch = originalFetch;
      localStorage.removeItem('waymark_agent_keys');
    }

    return { response, calls };
  });

  // Should have tried key1 first (LRU), then key2 on 429
  expect(result.calls[0]).toBe('key1');
  expect(result.calls[1]).toBe('key2');
  expect(result.response).toBe('AI response');
});
