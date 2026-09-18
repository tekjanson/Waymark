/* ============================================================
   lib/gemini.js — Gemini API client with key-pool auto-rotation

   Thin wrapper over generativelanguage.googleapis.com that pulls its
   API key from the KeyManager pool. When a call returns 429 /
   RESOURCE_EXHAUSTED it rotates to the next key and retries the SAME
   payload automatically, so the 24/7 loop never stalls on a single
   exhausted key.

   Zero dependencies — uses the built-in global `fetch` (Node 18+).

   Usage:
     const { KeyManager } = require('../key-manager');
     const { GeminiClient } = require('./lib/gemini');
     const gemini = new GeminiClient(KeyManager.fromEnv());
     const text = await gemini.generate({ prompt: 'Write a haiku' });
     const obj  = await gemini.generateJSON({ prompt: '...schema...' });
   ============================================================ */

'use strict';

const { KeyManager } = require('../key-manager');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

class GeminiClient {
  /**
   * @param {KeyManager} keyManager
   * @param {Object} [opts]
   * @param {string} [opts.model]
   * @param {number} [opts.maxRetries] — extra key rotations before giving up
   */
  constructor(keyManager, opts = {}) {
    this.km = keyManager;
    this.model = opts.model || DEFAULT_MODEL;
    // Try every key at least once by default.
    this.maxRetries = opts.maxRetries ?? Math.max(1, keyManager.size);
    this.log = opts.log || (() => {});
  }

  /**
   * Low-level generateContent call. Handles key rotation + retry on rate
   * limits. Returns the raw candidate text.
   * @param {Object} req
   * @param {string} req.prompt
   * @param {string} [req.system] — system instruction
   * @param {number} [req.temperature]
   * @param {number} [req.maxOutputTokens]
   * @param {string} [req.responseMimeType] — e.g. 'application/json'
   * @param {string} [req.model] — override the default model
   * @returns {Promise<string>}
   */
  async generate(req) {
    const model = req.model || this.model;
    const body = {
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: req.maxOutputTokens ?? 8192,
        ...(req.responseMimeType ? { responseMimeType: req.responseMimeType } : {}),
      },
    };
    if (req.system) {
      body.systemInstruction = { parts: [{ text: req.system }] };
    }

    let attempt = 0;
    let lastErr = null;
    while (attempt <= this.maxRetries) {
      const keyIndex = this.km.index;
      const key = this.km.getKey();
      const url = `${API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (netErr) {
        // Transient network failure — brief backoff, same key.
        lastErr = netErr;
        await sleep(500 * (attempt + 1));
        attempt++;
        continue;
      }

      if (res.ok) {
        const data = await res.json();
        return { text: extractText(data), keyIndex, raw: data };
      }

      const errText = await res.text();
      lastErr = new Error(`Gemini ${res.status}: ${errText}`);

      // Rate limit / quota → rotate key and retry the same payload.
      if (KeyManager.isRateLimit(res.status) || KeyManager.isQuotaError(errText)) {
        const info = this.km.rotateKey(`HTTP ${res.status}`);
        this.log(
          `[gemini] key #${keyIndex} rate-limited (${res.status}) → rotated to #${info.rotatedTo}` +
            (info.allExhausted ? ' (ALL keys exhausted)' : '')
        );
        if (info.allExhausted) {
          const waitMs = Math.min(this.km.msUntilAvailable(), 5 * 60_000);
          if (waitMs > 0) {
            this.log(`[gemini] whole pool cooling — backing off ${Math.round(waitMs / 1000)}s`);
            await sleep(waitMs);
          }
        }
        attempt++;
        continue;
      }

      // Non-retryable (400 bad request, 500 server error, etc.)
      throw lastErr;
    }
    throw lastErr || new Error('Gemini: exhausted retries');
  }

  /**
   * Convenience: request JSON output and parse it. Retries once with a
   * "return ONLY valid JSON" nudge if the first parse fails.
   * @param {Object} req — same as generate()
   * @returns {Promise<{ data: any, keyIndex: number }>}
   */
  async generateJSON(req) {
    const first = await this.generate({ ...req, responseMimeType: 'application/json' });
    const parsed = tryParseJSON(first.text);
    if (parsed !== undefined) return { data: parsed, keyIndex: first.keyIndex };

    const retry = await this.generate({
      ...req,
      responseMimeType: 'application/json',
      prompt: `${req.prompt}\n\nReturn ONLY valid minified JSON. No prose, no markdown fences.`,
    });
    const reparsed = tryParseJSON(retry.text);
    if (reparsed !== undefined) return { data: reparsed, keyIndex: retry.keyIndex };
    throw new Error(`Gemini returned non-JSON output: ${retry.text.slice(0, 300)}`);
  }
}

/* ---------- Helpers ---------- */

function extractText(data) {
  const cand = data.candidates?.[0];
  if (!cand) {
    const reason = data.promptFeedback?.blockReason;
    if (reason) throw new Error(`Gemini blocked prompt: ${reason}`);
    return '';
  }
  return (cand.content?.parts || []).map((p) => p.text || '').join('');
}

function tryParseJSON(text) {
  if (!text) return undefined;
  // Strip accidental ```json fences before parsing.
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Last resort: grab the outermost {...} or [...] block.
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { GeminiClient, extractText, tryParseJSON };
