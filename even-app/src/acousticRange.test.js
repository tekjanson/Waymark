/**
 * acousticRange.test.js — Unit tests for the glasses-side chirp detector.
 *
 * Run with: node --test
 *
 * Validates the pure DSP that can't be eyeballed on hardware:
 *   - PCM byte parsing (little-endian Int16)
 *   - Goertzel picks out a pure tone
 *   - the 3–6 kHz chirp is detected; noise and out-of-band tones are rejected
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toInt16,
  goertzelPower,
  detectChirp,
  CHIRP_RATIO_THRESHOLD,
} from './acousticRange.js';

const SR = 16000;

/** Build a Hann-windowed linear chirp matching AcousticPinger.kt. */
function makeChirp(ms = 60, f0 = 3000, f1 = 6000, sampleRate = SR) {
  const n = Math.round((sampleRate * ms) / 1000);
  const out = new Int16Array(n);
  const dur = n / sampleRate;
  const k = (f1 - f0) / dur;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * (f0 * t + 0.5 * k * t * t);
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    out[i] = Math.round(Math.sin(phase) * w * 30000);
  }
  return out;
}

function makeTone(freq, ms = 60, sampleRate = SR) {
  const n = Math.round((sampleRate * ms) / 1000);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 30000);
  }
  return out;
}

function makeNoise(ms = 60, sampleRate = SR, seed = 1) {
  const n = Math.round((sampleRate * ms) / 1000);
  const out = new Int16Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;      // LCG — deterministic
    out[i] = ((s % 65536) - 32768);
  }
  return out;
}

test('toInt16 parses little-endian PCM16 from a Uint8Array', () => {
  // 0x0100 -> 1, 0xFFFF -> -1
  const bytes = new Uint8Array([0x01, 0x00, 0xff, 0xff]);
  const s = toInt16(bytes);
  assert.equal(s.length, 2);
  assert.equal(s[0], 1);
  assert.equal(s[1], -1);
});

test('toInt16 also accepts a plain number[]', () => {
  const s = toInt16([0x00, 0x10]);   // 0x1000 = 4096
  assert.equal(s[0], 4096);
});

test('goertzelPower peaks at the tone frequency', () => {
  const tone = makeTone(4000);
  const atTone = goertzelPower(tone, 4000, SR);
  const offTone = goertzelPower(tone, 1000, SR);
  assert.ok(atTone > offTone * 10, `on=${atTone} off=${offTone}`);
});

test('detectChirp detects the 3-6 kHz calibration chirp', () => {
  const { present, strength } = detectChirp(makeChirp(), SR);
  assert.equal(present, true, `strength=${strength}`);
  assert.ok(strength >= CHIRP_RATIO_THRESHOLD);
});

test('detectChirp rejects white noise', () => {
  const noise = detectChirp(makeNoise(), SR);
  const chirp = detectChirp(makeChirp(), SR);
  assert.equal(noise.present, false, `noise strength=${noise.strength}`);
  assert.ok(chirp.strength > noise.strength);
});

test('detectChirp rejects an out-of-band (1 kHz) tone', () => {
  const { present } = detectChirp(makeTone(1000), SR);
  assert.equal(present, false);
});

test('detectChirp handles empty / tiny input safely', () => {
  assert.equal(detectChirp(new Int16Array(0), SR).present, false);
  assert.equal(detectChirp(new Int16Array(10), SR).present, false);
});
