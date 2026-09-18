/* ============================================================
   key-manager.js — Gemini API key pool with rotation + cooldown

   The 24/7 Dream-RSI loop burns through Gemini free-tier quota fast.
   This module manages a POOL of API keys and rotates to the next
   available key whenever the active one hits a rate limit (HTTP 429 /
   RESOURCE_EXHAUSTED). The exhausted key is parked on a 1-hour cooldown
   and becomes eligible again after it elapses.

   Design goals:
     • Zero dependencies — pure Node, runs anywhere in the container.
     • Deterministic + testable — the clock is injectable so cooldown
       math can be unit-tested without waiting an hour.
     • Stateless-friendly — pool comes from GEMINI_KEY_POOL so N workers
       can each hold the same pool config and scale horizontally.

   Usage:
     const { KeyManager } = require('./key-manager');
     const km = KeyManager.fromEnv();
     const key = km.getKey();
     // ...call Gemini...
     if (KeyManager.isRateLimit(status)) km.rotateKey('429');

   Env:
     GEMINI_KEY_POOL        — comma- OR newline-separated API keys
     GEMINI_KEY_COOLDOWN_MS — cooldown per key (default: 3600000 = 1h)
   ============================================================ */

'use strict';

const ONE_HOUR_MS = 60 * 60 * 1000;

/* ---------- Pool parsing ---------- */

/**
 * Parse a raw pool string into a clean, de-duplicated key array.
 * Accepts commas, newlines, or whitespace as separators so operators can
 * paste keys however is convenient (single line CSV or one-per-line).
 * @param {string} raw
 * @returns {string[]}
 */
function parsePool(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const seen = new Set();
  const keys = [];
  for (const part of raw.split(/[\s,]+/)) {
    const key = part.trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/* ---------- KeyManager ---------- */

class KeyManager {
  /**
   * @param {string[]} keys — the API key pool
   * @param {Object} [opts]
   * @param {number} [opts.cooldownMs] — cooldown per exhausted key (default 1h)
   * @param {() => number} [opts.now] — clock injection for tests
   */
  constructor(keys, opts = {}) {
    this.keys = Array.isArray(keys) ? keys.slice() : [];
    this.cooldownMs = opts.cooldownMs || ONE_HOUR_MS;
    this._now = opts.now || Date.now;
    this.index = 0;
    /** @type {Map<number, number>} keyIndex → cooldown-until epoch ms */
    this.cooldowns = new Map();
    /** @type {Map<number, number>} keyIndex → times rotated off */
    this.rotations = new Map();
  }

  /** Build a KeyManager from the process environment. */
  static fromEnv(env = process.env) {
    const keys = parsePool(env.GEMINI_KEY_POOL);
    const cooldownMs = parseInt(env.GEMINI_KEY_COOLDOWN_MS || String(ONE_HOUR_MS), 10);
    return new KeyManager(keys, { cooldownMs });
  }

  /** True when the pool holds at least one key. */
  get size() {
    return this.keys.length;
  }

  /** Is a given key index currently cooling down? */
  _onCooldown(index) {
    const until = this.cooldowns.get(index);
    return until !== undefined && until > this._now();
  }

  /**
   * Number of keys eligible to use right now (not on cooldown).
   * @returns {number}
   */
  availableCount() {
    let n = 0;
    for (let i = 0; i < this.keys.length; i++) {
      if (!this._onCooldown(i)) n++;
    }
    return n;
  }

  /**
   * Return the active API key. If the current key is on cooldown, advance
   * to the next available one. If EVERY key is on cooldown, return the key
   * whose cooldown expires soonest (best-effort — the caller may still get
   * a 429 and should back off).
   * @returns {string}
   */
  getKey() {
    if (this.keys.length === 0) {
      throw new Error('GEMINI_KEY_POOL is empty — no API keys configured');
    }
    if (!this._onCooldown(this.index)) {
      return this.keys[this.index];
    }
    // Current key is cooling down — find the next available one.
    const next = this._firstAvailableFrom(this.index);
    if (next !== -1) {
      this.index = next;
      return this.keys[this.index];
    }
    // All keys cooling down — pick the soonest to recover.
    this.index = this._soonestToRecover();
    return this.keys[this.index];
  }

  /**
   * Park the current key on cooldown and advance to the next available key.
   * Call this when the active key returns a rate-limit / quota error.
   * @param {string} [reason] — logged reason (e.g. '429', 'RESOURCE_EXHAUSTED')
   * @returns {{ rotatedFrom: number, rotatedTo: number, allExhausted: boolean, cooldownUntil: number }}
   */
  rotateKey(reason = 'rate-limit') {
    if (this.keys.length === 0) {
      throw new Error('GEMINI_KEY_POOL is empty — cannot rotate');
    }
    const from = this.index;
    const cooldownUntil = this._now() + this.cooldownMs;
    this.cooldowns.set(from, cooldownUntil);
    this.rotations.set(from, (this.rotations.get(from) || 0) + 1);

    const next = this._firstAvailableFrom(from + 1);
    const allExhausted = next === -1;
    this.index = allExhausted ? this._soonestToRecover() : next;

    return {
      rotatedFrom: from,
      rotatedTo: this.index,
      reason,
      allExhausted,
      cooldownUntil,
    };
  }

  /**
   * Milliseconds until at least one key is available again. Returns 0 when a
   * key is available now. The 24/7 loop uses this to sleep instead of
   * hammering the API when the whole pool is exhausted.
   * @returns {number}
   */
  msUntilAvailable() {
    if (this.availableCount() > 0) return 0;
    let soonest = Infinity;
    for (const until of this.cooldowns.values()) {
      if (until < soonest) soonest = until;
    }
    return soonest === Infinity ? 0 : Math.max(0, soonest - this._now());
  }

  /** Find the first non-cooling key at or after `start` (wraps around). */
  _firstAvailableFrom(start) {
    const n = this.keys.length;
    for (let step = 0; step < n; step++) {
      const i = (start + step) % n;
      if (!this._onCooldown(i)) return i;
    }
    return -1;
  }

  /** Index of the key whose cooldown expires soonest. */
  _soonestToRecover() {
    let bestIdx = 0;
    let bestUntil = Infinity;
    for (let i = 0; i < this.keys.length; i++) {
      const until = this.cooldowns.get(i) || 0;
      if (until < bestUntil) {
        bestUntil = until;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /**
   * A redacted snapshot of pool state for logging / the Discovery_Tree.
   * Never exposes the raw keys.
   * @returns {Object}
   */
  status() {
    return {
      total: this.keys.length,
      available: this.availableCount(),
      activeIndex: this.index,
      cooling: [...this.cooldowns.entries()]
        .filter(([i]) => this._onCooldown(i))
        .map(([i, until]) => ({ index: i, secondsLeft: Math.round((until - this._now()) / 1000) })),
    };
  }

  /* ---------- Static rate-limit detectors ---------- */

  /** True for HTTP statuses that mean "rotate the key". */
  static isRateLimit(status) {
    return status === 429 || status === 403;
  }

  /**
   * Inspect a Gemini error body (or Error) for quota / rate-limit signals.
   * @param {any} err — response JSON, string, or Error
   * @returns {boolean}
   */
  static isQuotaError(err) {
    if (!err) return false;
    const text =
      typeof err === 'string'
        ? err
        : JSON.stringify(err.body || err.message || err.error || err);
    return /RESOURCE_EXHAUSTED|rate.?limit|quota|too many requests|429/i.test(text || '');
  }
}

module.exports = { KeyManager, parsePool, ONE_HOUR_MS };
