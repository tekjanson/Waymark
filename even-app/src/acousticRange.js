/**
 * acousticRange.js — Glasses-side acoustic ranging
 *
 * The Waymark phone emits a 3–6 kHz chirp from its speaker during
 * calibration (AcousticPinger). Here we open the G2 microphone, detect
 * that chirp in the PCM stream (band-energy ratio via Goertzel), and read
 * the firmware's per-frame `direction` tag as the phone→glasses bearing.
 *
 * This is a LOW-WEIGHT spatial reference: orientation (dual-IMU) dominates
 * AR alignment, so the acoustic bearing is only ever a gentle, confidence-
 * gated nudge. The detector math here is pure + unit-tested; the live class
 * wires it to the Even SDK audio stream.
 */

import { AudioInputSource } from '@evenrealities/even_hub_sdk';

// Chirp band emitted by AcousticPinger.kt (3-6 kHz). We measure the fraction of
// signal energy inside this band via a bandpass biquad (geometric-mean center).
export const CHIRP_CENTER = Math.sqrt(3000 * 6000);  // ~4243 Hz
export const CHIRP_Q = 1.4;                          // ~3 kHz -3dB bandwidth
// Assumed glasses mic PCM format (voice mic). Tune if the firmware differs.
export const ASSUMED_SAMPLE_RATE = 16000;
// Fraction of in-band energy above which we call it "our chirp".
export const CHIRP_RATIO_THRESHOLD = 0.45;

/**
 * Normalize an SDK audioPcm payload to Int16Array (little-endian PCM16).
 * The host may deliver a Uint8Array, a plain number[], or a base64 string.
 * @param {Uint8Array|number[]|string} pcm
 * @returns {Int16Array}
 */
export function toInt16(pcm) {
  let bytes;
  if (typeof pcm === 'string') {
    const bin = typeof atob === 'function' ? atob(pcm) : Buffer.from(pcm, 'base64').toString('binary');
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else if (pcm instanceof Uint8Array) {
    bytes = pcm;
  } else if (Array.isArray(pcm)) {
    bytes = Uint8Array.from(pcm);
  } else {
    return new Int16Array(0);
  }
  const n = bytes.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const lo = bytes[i * 2], hi = bytes[i * 2 + 1];
    out[i] = (hi << 8) | lo;        // little-endian
  }
  return out;
}

/**
 * Goertzel power of a single frequency over a sample block.
 * @param {Int16Array|Float64Array|number[]} samples
 * @param {number} freq
 * @param {number} sampleRate
 * @returns {number} power (unnormalized, >= 0)
 */
export function goertzelPower(samples, freq, sampleRate) {
  const n = samples.length;
  if (n === 0) return 0;
  const k = Math.round((n * freq) / sampleRate);
  const w = (2 * Math.PI * k) / n;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/**
 * Energy passing a 2nd-order RBJ bandpass biquad (constant 0 dB peak gain).
 * Correctly measures in-band energy for a swept chirp, unlike discrete bins.
 * @param {Int16Array|number[]} samples
 * @param {number} f0  center frequency (Hz)
 * @param {number} sampleRate
 * @param {number} q   quality factor
 * @returns {number} summed squared filtered output
 */
export function bandpassEnergy(samples, f0, sampleRate, q) {
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, energy = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;   // b1 = 0
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    energy += y * y;
  }
  return energy;
}

/**
 * Detect the calibration chirp in a PCM block via the ratio of energy in the
 * chirp band to total signal energy.
 * @param {Int16Array} samples
 * @param {number} [sampleRate=ASSUMED_SAMPLE_RATE]
 * @returns {{ present: boolean, strength: number, ratio: number }}
 */
export function detectChirp(samples, sampleRate = ASSUMED_SAMPLE_RATE) {
  const n = samples.length;
  if (n < 64) return { present: false, strength: 0, ratio: 0 };

  let total = 0;
  for (let i = 0; i < n; i++) total += samples[i] * samples[i];
  if (total <= 0) return { present: false, strength: 0, ratio: 0 };

  const band = bandpassEnergy(samples, CHIRP_CENTER, sampleRate, CHIRP_Q);
  const ratio = Math.min(1, band / total);
  const present = ratio >= CHIRP_RATIO_THRESHOLD;
  return { present, strength: ratio, ratio };
}

/**
 * Live glasses-mic acoustic ranger. Opens the G2 microphone, listens for the
 * phone chirp, and exposes the most recent bearing + confidence.
 */
export class AcousticRanger {
  /** @param {import('@evenrealities/even_hub_sdk').EvenAppBridge} bridge */
  constructor(bridge) {
    this._bridge = bridge;
    this._active = false;
    this._unsub = null;
    /** @type {{ bearing: number|null, strength: number, confidence: number, ts: number }} */
    this._latest = { bearing: null, strength: 0, confidence: 0, ts: 0 };
  }

  get active() { return this._active; }

  async start() {
    if (this._active) return true;
    this._active = true;   // optimistic — stops the poll loop re-entering before the await resolves
    let ok = false;
    try {
      ok = await this._bridge.audioControl(true, AudioInputSource.Glasses);
    } catch (err) {
      this._active = false;
      console.warn('[AcousticRanger] audioControl(glasses) failed:', err);
      return false;
    }
    this._unsub = this._bridge.onEvenHubEvent((event) => this._onEvent(event));
    console.log('[AcousticRanger] glasses mic open (audioControl ->', ok, ')');
    return true;
  }

  async stop() {
    if (!this._active) return;
    this._active = false;
    if (this._unsub) { try { this._unsub(); } catch { /* ignore */ } this._unsub = null; }
    try { await this._bridge.audioControl(false); } catch { /* ignore */ }
    this._latest = { bearing: null, strength: 0, confidence: 0, ts: 0 };
  }

  /** @returns {{ bearing: number|null, strength: number, confidence: number, ts: number }} */
  getLatest() { return this._latest; }

  _onEvent(event) {
    const audio = event?.audioEvent;
    if (!audio || audio.source !== AudioInputSource.Glasses) return;
    const samples = toInt16(audio.audioPcm);
    const { present, strength } = detectChirp(samples);
    if (!present) return;
    // Firmware direction-of-arrival tag = phone bearing in the head frame.
    const bearing = (typeof audio.direction === 'number') ? audio.direction : this._latest.bearing;
    // Confidence scales how far above threshold we are.
    const confidence = Math.max(0, Math.min(1,
      (strength - CHIRP_RATIO_THRESHOLD) / (1 - CHIRP_RATIO_THRESHOLD)));
    this._latest = { bearing, strength, confidence, ts: Date.now() };
  }
}
