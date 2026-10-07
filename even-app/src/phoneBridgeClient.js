/**
 * phoneBridgeClient.js — Phone-local Waymark bridge client
 *
 * Polls the Waymark Android app's localhost bridge endpoint.
 */

const DEFAULT_BASES = [
  'http://127.0.0.1:8787',
  'http://localhost:8787',
];

export async function fetchLatestBridgeMessage({ bases = DEFAULT_BASES, timeoutMs = 1200 } = {}) {
  let lastError = null;
  for (const base of bases) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${base}/latest`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        lastError = new Error(`bridge ${base} failed: ${res.status}`);
        continue;
      }

      const payload = await res.json();
      return {
        ok: true,
        base,
        payload,
      };
    } catch (err) {
      lastError = err;
    }
  }

  return {
    ok: false,
    error: lastError ? String(lastError.message || lastError) : 'bridge unavailable',
  };
}

export { DEFAULT_BASES as PHONE_BRIDGE_BASES };
