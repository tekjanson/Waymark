#!/usr/bin/env node
/**
 * Offline test harness for EchoGateProcessor.
 *
 * Simulates the AudioWorklet process() method with synthetic audio signals,
 * measures echo leakage at various delays, and reports pass/fail.
 *
 * Usage: node scripts/test-echo-gate.js
 *
 * This does NOT require a browser — it loads the processor class directly
 * in Node.js by shimming the AudioWorkletProcessor global.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Shim AudioWorkletProcessor globals ──────────────────────
const processors = {};
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class AudioWorkletProcessor {
  constructor() {
    this.port = {
      onmessage: null,
      postMessage() {},
      addEventListener() {},
      removeEventListener() {},
      start() {},
    };
  }
};
globalThis.registerProcessor = (name, cls) => { processors[name] = cls; };

// Load the processor module
const src = readFileSync(join(ROOT, 'public/js/echo-gate-processor.js'), 'utf8');
new Function(src)();

const EchoGateProcessor = processors['echo-gate'];
if (!EchoGateProcessor) {
  console.error('FATAL: echo-gate processor not registered');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────
const SR = 48000;
const BLOCK = 128;
const BLOCKS_PER_SEC = SR / BLOCK; // 375

/** Generate a flat noise burst (constant amplitude) */
function noiseBurst(samples, amplitude) {
  const buf = new Float32Array(samples);
  for (let i = 0; i < samples; i++) buf[i] = (Math.random() * 2 - 1) * amplitude;
  return buf;
}

/**
 * Generate a speech-like signal: noise modulated by a slowly varying envelope.
 * Different seeds produce different amplitude patterns (simulating different speakers).
 * The block-level RMS varies significantly, enabling meaningful NCC correlation.
 */
function speechSignal(samples, amplitude, seed = 0) {
  const buf = new Float32Array(samples);
  // Deterministic pseudo-random based on seed for envelope parameters
  let rng = (seed + 1) * 2654435761 >>> 0;
  const nextRng = () => { rng = (rng * 16807 + 12345) >>> 0; return (rng & 0x7fffffff) / 0x7fffffff; };
  // Several modulation frequencies typical of speech prosody (2-12 Hz)
  const nFreqs = 4;
  const freqs = [], phases = [], amps = [];
  for (let f = 0; f < nFreqs; f++) {
    freqs.push(2 + nextRng() * 10);           // 2-12 Hz
    phases.push(nextRng() * Math.PI * 2);
    amps.push(0.1 + nextRng() * 0.4);         // modulation depth
  }
  for (let i = 0; i < samples; i++) {
    const t = i / SR;
    let env = 0.2;
    for (let f = 0; f < nFreqs; f++) {
      env += amps[f] * Math.abs(Math.sin(2 * Math.PI * freqs[f] * t + phases[f]));
    }
    env = Math.min(1.0, env);
    buf[i] = (Math.random() * 2 - 1) * amplitude * env;
  }
  return buf;
}

/** Create an attenuated copy of a signal (simulates echo returning) */
function attenuatedCopy(signal, gain) {
  const buf = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) buf[i] = signal[i] * gain;
  return buf;
}

/** Generate silence */
function silence(samples) {
  return new Float32Array(samples);
}

/** Concatenate Float32Arrays */
function concat(...bufs) {
  const total = bufs.reduce((s, b) => s + b.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const b of bufs) { out.set(b, off); off += b.length; }
  return out;
}

/** Run the processor block-by-block, return output buffer */
function runProcessor(micSignal, remoteSignal, params = {}) {
  const proc = new EchoGateProcessor();
  const totalBlocks = Math.ceil(Math.max(micSignal.length, remoteSignal.length) / BLOCK);
  const output = new Float32Array(totalBlocks * BLOCK);

  const p = {
    suppression: [params.suppression ?? 0.95],
    threshold: [params.threshold ?? 0.03],
    holdMs: [params.holdMs ?? 3000],
  };

  for (let b = 0; b < totalBlocks; b++) {
    const off = b * BLOCK;
    const micBlock = micSignal.slice(off, off + BLOCK);
    const remBlock = remoteSignal.slice(off, off + BLOCK);
    const outBlock = new Float32Array(BLOCK);

    // Pad to BLOCK size if needed
    const mc = new Float32Array(BLOCK);
    mc.set(micBlock);
    const rc = new Float32Array(BLOCK);
    rc.set(remBlock);

    proc.process(
      [[mc]],       // inputs[0] = mic (1 channel)
      [[rc]],       // inputs[1] = remote (1 channel)
      [[outBlock]],  // outputs[0]
      p,
    );

    // Wait — the API is process(inputs, outputs, parameters).
    // outputs[0] is the array of channels, and the processor writes to it.
    // Let me re-call correctly:
    output.set(outBlock, off);
  }

  return output;
}

// Actually the process method signature is process(inputs, outputs, parameters)
// where inputs = [input0Channels, input1Channels, ...], outputs = [output0Channels, ...]
// Let me fix the runner:

function runProcessorFixed(micSignal, remoteSignal, params = {}) {
  const proc = new EchoGateProcessor();
  const totalSamples = Math.max(micSignal.length, remoteSignal.length);
  const totalBlocks = Math.ceil(totalSamples / BLOCK);
  const output = new Float32Array(totalBlocks * BLOCK);

  const p = {
    suppression: [params.suppression ?? 0.90],
    threshold: [params.threshold ?? 0.012],
    holdMs: [params.holdMs ?? 800],
  };

  for (let b = 0; b < totalBlocks; b++) {
    const off = b * BLOCK;

    const mc = new Float32Array(BLOCK);
    const sub1 = micSignal.subarray(
      Math.min(off, micSignal.length),
      Math.min(off + BLOCK, micSignal.length),
    );
    mc.set(sub1);

    const rc = new Float32Array(BLOCK);
    const sub2 = remoteSignal.subarray(
      Math.min(off, remoteSignal.length),
      Math.min(off + BLOCK, remoteSignal.length),
    );
    rc.set(sub2);

    const outCh = new Float32Array(BLOCK);

    proc.process(
      [[mc], [rc]],    // inputs: [mic_channels, remote_channels]
      [[outCh]],       // outputs: [output_channels]
      p,
    );

    output.set(outCh, off);
  }

  return output;
}

/** Debug variant: runs processor and returns block-by-block trace of internal state */
function runWithTrace(micSignal, remoteSignal, params = {}) {
  const proc = new EchoGateProcessor();
  const totalSamples = Math.max(micSignal.length, remoteSignal.length);
  const totalBlocks = Math.ceil(totalSamples / BLOCK);
  const output = new Float32Array(totalBlocks * BLOCK);
  const trace = [];

  const p = {
    suppression: [params.suppression ?? 0.90],
    threshold: [params.threshold ?? 0.012],
    holdMs: [params.holdMs ?? 800],
  };

  for (let b = 0; b < totalBlocks; b++) {
    const off = b * BLOCK;
    const mc = new Float32Array(BLOCK);
    mc.set(micSignal.subarray(Math.min(off, micSignal.length), Math.min(off + BLOCK, micSignal.length)));
    const rc = new Float32Array(BLOCK);
    rc.set(remoteSignal.subarray(Math.min(off, remoteSignal.length), Math.min(off + BLOCK, remoteSignal.length)));
    const outCh = new Float32Array(BLOCK);
    proc.process([[mc], [rc]], [[outCh]], p);
    output.set(outCh, off);
    trace.push({
      block: b,
      time: (b * BLOCK / SR).toFixed(3),
      holdSamples: proc._holdSamples,
      echoHold: proc._echoHoldSamples,
      echoDelay: proc._echoDelay,
      echoConf: proc._echoConfidence,
      gain: proc._gain,
      noiseFloor: proc._noiseFloor,
      consecutiveRemote: proc._consecutiveRemoteSpeech,
    });
  }

  return { output, trace };
}

/** Calculate RMS of a buffer segment */
function rms(buf, start = 0, end = buf.length) {
  let sum = 0;
  const len = end - start;
  for (let i = start; i < end; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / len);
}

/** Calculate peak absolute value */
function peak(buf, start = 0, end = buf.length) {
  let max = 0;
  for (let i = start; i < end; i++) max = Math.max(max, Math.abs(buf[i]));
  return max;
}

// ── Test scenarios ──────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('\n🔊 Echo Gate Processor — Offline Test Harness\n');
console.log(`   Sample rate: ${SR} Hz, Block size: ${BLOCK}`);
console.log(`   Blocks/sec: ${BLOCKS_PER_SEC}\n`);

// ─────────────────────────────────────────────────────────────
console.log('━━ Test 1: Basic gating — mic active, remote should be muted');
// ─────────────────────────────────────────────────────────────
test('remote muted while mic is active (simultaneous)', () => {
  // 2 seconds: mic and remote both have signal simultaneously
  const dur = SR * 2;
  const mic = speechSignal(dur, 0.3, 1);
  const remote = speechSignal(dur, 0.3, 2);
  const out = runProcessorFixed(mic, remote);

  // Output should be nearly silent (suppression = 0.90 → gain 0.10)
  const outRms = rms(out, BLOCK, dur); // skip first block for init
  const remRms = rms(remote, BLOCK, dur);
  const suppression = 1 - (outRms / remRms);
  console.log(`     Remote RMS: ${remRms.toFixed(4)}, Output RMS: ${outRms.toFixed(4)}, Suppression: ${(suppression * 100).toFixed(1)}%`);
  assert(suppression > 0.85, `Suppression ${(suppression*100).toFixed(1)}% should be >85%`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ Test 2: Self-call echo — remote is delayed copy of mic');
// ─────────────────────────────────────────────────────────────
const delays = [50, 200, 500, 800]; // ms — all within base hold timer

for (const delayMs of delays) {
  test(`echo blocked at ${delayMs}ms delay`, () => {
    const delaySamples = Math.round(delayMs / 1000 * SR);
    // Mic: 1s speech, then silence
    const speechDur = SR; // 1 second
    const totalDur = speechDur + delaySamples + SR; // speech + delay + 1s extra
    const micSpeech = speechSignal(speechDur, 0.3, 10 + delayMs);
    const mic = concat(micSpeech, silence(delaySamples + SR));
    // Remote: delayed, attenuated copy of mic signal (real echo)
    const remote = concat(silence(delaySamples), attenuatedCopy(micSpeech, 0.67), silence(SR));

    const out = runProcessorFixed(mic, remote);

    // Measure leakage in the echo window (where remote has signal)
    const echoStart = delaySamples;
    const echoEnd = delaySamples + speechDur;
    const outRms = rms(out, echoStart, echoEnd);
    const remRms = rms(remote, echoStart, echoEnd);
    const leakage = outRms / remRms;
    const blocked = 1 - leakage;
    console.log(`     Echo window: ${echoStart}-${echoEnd} samples, Remote RMS: ${remRms.toFixed(4)}, Output RMS: ${outRms.toFixed(4)}, Blocked: ${(blocked * 100).toFixed(1)}%`);
    assert(blocked > 0.85, `Only ${(blocked*100).toFixed(1)}% blocked — need >85%`);
  });
}

// Test echo detection for delays that exceed the base hold timer (800ms).
// The echo fingerprinting safety net should catch longer delays.
// With a 2s speech burst, the detection has enough data to correlate.
test('echo partially blocked at 1500ms delay (fingerprint safety net)', () => {
  const delaySamples = Math.round(1500 / 1000 * SR);
  const speechDur = SR * 2; // 2 seconds of speech for longer echo
  const micSpeech = speechSignal(speechDur, 0.3, 1500);
  const mic = concat(micSpeech, silence(delaySamples + SR));
  const remote = concat(silence(delaySamples), attenuatedCopy(micSpeech, 0.67), silence(SR));

  const out = runProcessorFixed(mic, remote);

  // Echo window: starts at delaySamples, lasts speechDur
  // Hold covers up to 0.8s after mic stops (at 2s) = 2.8s total
  // Echo starts at 1.5s. Most of the echo is within hold.
  const echoStart = delaySamples;
  const echoEnd = delaySamples + speechDur;
  const outRms = rms(out, echoStart, echoEnd);
  const remRms = rms(remote, echoStart, echoEnd);
  const blocked = 1 - (outRms / remRms);
  console.log(`     Echo window: ${echoStart}-${echoEnd} samples, Blocked: ${(blocked * 100).toFixed(1)}%`);
  assert(blocked > 0.50, `Only ${(blocked*100).toFixed(1)}% blocked — need >50% (fingerprint safety net)`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ Test 3: Real conversation — remote person should be audible when mic is silent');
// ─────────────────────────────────────────────────────────────
test('remote audio passes through when mic is silent', () => {
  // 1s silence on mic, remote has speech
  const dur = SR;
  const mic = silence(dur + SR); // 2s silence
  const remote = concat(silence(SR), noiseBurst(dur, 0.3)); // 1s silent, 1s speech
  const out = runProcessorFixed(mic, remote);

  // After hold timer expires, remote should pass through
  // Given 1500ms hold, after 1s of silence on mic the hold is long expired
  // (it was never triggered because mic was always silent)
  const measureStart = SR + Math.round(SR * 0.1); // 100ms into remote speech
  const measureEnd = SR * 2;
  const outRms = rms(out, measureStart, measureEnd);
  const remRms = rms(remote, measureStart, measureEnd);
  const passthrough = outRms / remRms;
  console.log(`     Remote RMS: ${remRms.toFixed(4)}, Output RMS: ${outRms.toFixed(4)}, Passthrough: ${(passthrough * 100).toFixed(1)}%`);
  assert(passthrough > 0.80, `Only ${(passthrough*100).toFixed(1)}% passthrough — should be >80%`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ Test 4: Alternating conversation (half-duplex test)');
// ─────────────────────────────────────────────────────────────
test('conversation: hear remote during their turn, muted during yours', () => {
  // With holdMs=800, the gate stays closed 0.8s after mic stops.
  // Mic speaks 0-1s, hold expires at 1.8s.
  // Their speech starts at 2.0s (0.2s after hold expires) to allow fade-in.
  const yourSpeech = speechSignal(SR, 0.3, 42);
  const theirSpeechSig = speechSignal(SR * 2, 0.3, 99); // 2s of their speech
  const yourSpeech2 = speechSignal(SR, 0.3, 77);
  const mic = concat(
    yourSpeech,               // 0-1s: you talk
    silence(SR * 3),          // 1-4s: silence (through their speech and pause)
    yourSpeech2,              // 4-5s: you talk again
  );
  const remote = concat(
    silence(SR * 2),          // 0-2s: silent (hold expired at 1.8s)
    theirSpeechSig,           // 2-4s: they talk (independent speaker)
    silence(SR),              // 4-5s: silent (you're talking)
  );

  const out = runProcessorFixed(mic, remote);

  // Measure: their speech from 2.2s to 4s (0.2s after start for fade-in)
  const theirStart = Math.round(SR * 2.2);
  const theirEnd = Math.round(SR * 4);
  const outRms = rms(out, theirStart, theirEnd);
  const remRms = rms(remote, theirStart, theirEnd);
  const passthrough = outRms / remRms;
  console.log(`     Their speech passthrough: ${(passthrough * 100).toFixed(1)}%`);
  assert(passthrough > 0.70, `Only ${(passthrough*100).toFixed(1)}% passthrough for their speech — should be >70%`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ Test 5: Suppression OFF (0%) should pass everything through');
// ─────────────────────────────────────────────────────────────
test('suppression=0 passes remote through unmodified', () => {
  const dur = SR;
  const mic = speechSignal(dur, 0.3, 50);
  const remote = speechSignal(dur, 0.3, 51);
  const out = runProcessorFixed(mic, remote, { suppression: 0 });
  const outRms = rms(out, 0, dur);
  const remRms = rms(remote, 0, dur);
  const ratio = outRms / remRms;
  console.log(`     Passthrough ratio: ${(ratio * 100).toFixed(1)}%`);
  assert(ratio > 0.95, `Passthrough ${(ratio*100).toFixed(1)}% should be >95% when suppression=0`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ Test 6: Full mute (suppression=1.0) should be absolute silence when speaking');
// ─────────────────────────────────────────────────────────────
test('suppression=1.0 gives zero output while mic active', () => {
  const dur = SR;
  const mic = speechSignal(dur, 0.3, 60);
  const remote = speechSignal(dur, 0.3, 61);
  const out = runProcessorFixed(mic, remote, { suppression: 1.0 });
  const maxSample = peak(out, BLOCK, dur); // skip first block
  console.log(`     Peak output sample: ${maxSample.toFixed(6)}`);
  assert(maxSample < 0.001, `Peak ${maxSample.toFixed(6)} should be <0.001 at 100% suppression`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ Test 7: Edge cases — threshold sensitivity');
// ─────────────────────────────────────────────────────────────

test('mic signal well above threshold (0.3 amplitude) triggers gate', () => {
  // Clear speech signal — should always trigger gate regardless of adaptive floor
  const dur = SR * 2;
  const mic = speechSignal(dur, 0.3, 70);
  const remote = speechSignal(dur, 0.3, 71);
  const out = runProcessorFixed(mic, remote);
  const outRms = rms(out, BLOCK, dur);
  const remRms = rms(remote, BLOCK, dur);
  const suppression = 1 - (outRms / remRms);
  console.log(`     Speech-level suppression: ${(suppression * 100).toFixed(1)}%`);
  assert(suppression > 0.80, `Suppression ${(suppression*100).toFixed(1)}% should be >80%`);
});

test('mic signal below base threshold (0.005 RMS) does NOT trigger gate', () => {
  // Very quiet mic signal — well below threshold 0.012, gate should stay open
  const dur = SR * 2;
  const mic = noiseBurst(dur, 0.008); // RMS ~0.005 < threshold 0.012
  const remote = speechSignal(dur, 0.3, 72);
  const out = runProcessorFixed(mic, remote);
  const outRms = rms(out, BLOCK, dur);
  const remRms = rms(remote, BLOCK, dur);
  const passthrough = outRms / remRms;
  console.log(`     Below-threshold passthrough: ${(passthrough * 100).toFixed(1)}%`);
  assert(passthrough > 0.80, `Passthrough ${(passthrough*100).toFixed(1)}% should be >80% — mic below threshold`);
});

test('custom threshold=0.10 ignores moderate mic signal', () => {
  // With a high threshold, moderate mic signal should not trigger the gate
  const dur = SR * 2;
  const mic = speechSignal(dur, 0.15, 73); // RMS ~0.07 < threshold 0.10
  const remote = speechSignal(dur, 0.3, 74);
  const out = runProcessorFixed(mic, remote, { threshold: 0.10 });
  const outRms = rms(out, BLOCK, dur);
  const remRms = rms(remote, BLOCK, dur);
  const passthrough = outRms / remRms;
  console.log(`     High-threshold passthrough: ${(passthrough * 100).toFixed(1)}%`);
  assert(passthrough > 0.70, `Passthrough ${(passthrough*100).toFixed(1)}% should be >70% — mic below high threshold`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ Test 8: Edge cases — rapid speech transitions');
// ─────────────────────────────────────────────────────────────

test('rapid on/off speech (200ms bursts) still suppresses', () => {
  // Quick talker: 200ms bursts with 200ms gaps, over 4 seconds
  const burstLen = Math.round(SR * 0.2);
  const gapLen = Math.round(SR * 0.2);
  const cycles = 10;
  const micParts = [];
  for (let i = 0; i < cycles; i++) {
    micParts.push(speechSignal(burstLen, 0.3, 80 + i));
    micParts.push(silence(gapLen));
  }
  const mic = concat(...micParts);
  const remote = speechSignal(mic.length, 0.3, 90);
  const out = runProcessorFixed(mic, remote);
  const outRms = rms(out, BLOCK, mic.length);
  const remRms = rms(remote, BLOCK, mic.length);
  const suppression = 1 - (outRms / remRms);
  console.log(`     Rapid-burst suppression: ${(suppression * 100).toFixed(1)}%`);
  // The 800ms hold bridges 200ms gaps easily
  assert(suppression > 0.80, `Suppression ${(suppression*100).toFixed(1)}% should be >80% — hold bridges short gaps`);
});

test('long silence after speech allows full recovery', () => {
  // Speak for 1s, then 3s silence — gate should fully open well before 3s
  // With holdMs=800, hold expires at 1.8s.
  const mic = concat(speechSignal(SR, 0.3, 95), silence(SR * 3));
  const remote = concat(silence(SR * 2), speechSignal(SR * 2, 0.3, 96));
  const out = runProcessorFixed(mic, remote);
  // Remote speech starts at 2s. Hold expires at 1.8s. Should be open by 2s.
  const measureStart = Math.round(SR * 2.2);
  const measureEnd = Math.round(SR * 4);
  const outRms = rms(out, measureStart, measureEnd);
  const remRms = rms(remote, measureStart, measureEnd);
  const passthrough = outRms / remRms;
  console.log(`     Recovery passthrough: ${(passthrough * 100).toFixed(1)}%`);
  assert(passthrough > 0.70, `Passthrough ${(passthrough*100).toFixed(1)}% should be >70% after long silence`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ Test 9: Edge cases — extreme amplitudes');
// ─────────────────────────────────────────────────────────────

test('very loud mic (amplitude 1.0) triggers gate', () => {
  const dur = SR;
  const mic = speechSignal(dur, 1.0, 100);
  const remote = speechSignal(dur, 0.3, 101);
  const out = runProcessorFixed(mic, remote);
  const outRms = rms(out, BLOCK, dur);
  const remRms = rms(remote, BLOCK, dur);
  const suppression = 1 - (outRms / remRms);
  console.log(`     Loud-mic suppression: ${(suppression * 100).toFixed(1)}%`);
  assert(suppression > 0.85, `Suppression ${(suppression*100).toFixed(1)}% should be >85%`);
});

test('very loud remote (amplitude 1.0) is still gated', () => {
  const dur = SR;
  const mic = speechSignal(dur, 0.3, 102);
  const remote = speechSignal(dur, 1.0, 103);
  const out = runProcessorFixed(mic, remote);
  const outRms = rms(out, BLOCK, dur);
  const remRms = rms(remote, BLOCK, dur);
  const suppression = 1 - (outRms / remRms);
  console.log(`     Loud-remote suppression: ${(suppression * 100).toFixed(1)}%`);
  assert(suppression > 0.90, `Suppression ${(suppression*100).toFixed(1)}% should be >90%`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ Test 10: Edge cases — holdMs behavior');
// ─────────────────────────────────────────────────────────────

test('holdMs=0 releases immediately after speech stops', () => {
  // With holdMs=0, gate should open as soon as mic goes silent.
  // Remote starts 0.5s after mic stops — should mostly pass through.
  const mic = concat(speechSignal(SR, 0.3, 110), silence(SR * 2));
  const remote = concat(silence(Math.round(SR * 1.5)), speechSignal(Math.round(SR * 1.5), 0.3, 111));
  const out = runProcessorFixed(mic, remote, { holdMs: 0 });
  // Measure from 1.6s to 3s (remote speech after mic ended at 1s)
  const start = Math.round(SR * 1.6);
  const end = Math.round(SR * 3);
  const outRms = rms(out, start, end);
  const remRms = rms(remote, start, end);
  const passthrough = outRms / remRms;
  console.log(`     holdMs=0 passthrough: ${(passthrough * 100).toFixed(1)}%`);
  assert(passthrough > 0.60, `Passthrough ${(passthrough*100).toFixed(1)}% should be >60% with holdMs=0`);
});

test('holdMs=8000 (max) blocks echo for 8 seconds after speech', () => {
  // Long hold blocks even remote speech that starts 5s after mic stops
  const mic = concat(speechSignal(SR, 0.3, 120), silence(SR * 7));
  const remote = concat(silence(SR * 5), speechSignal(SR * 3, 0.3, 121));
  const out = runProcessorFixed(mic, remote, { holdMs: 8000, threshold: 0.03 });
  // Remote speech at 5-8s. Mic stopped at 1s. Hold keeps gate closed until 9s.
  const start = Math.round(SR * 5.1);
  const end = Math.round(SR * 8);
  const outRms = rms(out, start, end);
  const remRms = rms(remote, start, end);
  const suppression = 1 - (outRms / remRms);
  console.log(`     holdMs=8000 suppression: ${(suppression * 100).toFixed(1)}%`);
  assert(suppression > 0.85, `Suppression ${(suppression*100).toFixed(1)}% should be >85% with 8s hold`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ Test 11: Edge cases — mobile AGC simulation');
// ─────────────────────────────────────────────────────────────

test('AGC-boosted mic (fluctuating amplitude) still triggers gate', () => {
  // Simulate mobile AGC: amplitude ramps from 0.1 to 0.5 over 2 seconds
  const dur = SR * 2;
  const mic = new Float32Array(dur);
  for (let i = 0; i < dur; i++) {
    const t = i / dur;
    const amp = 0.1 + t * 0.4; // ramp from 0.1 to 0.5
    mic[i] = (Math.random() * 2 - 1) * amp;
  }
  const remote = speechSignal(dur, 0.3, 130);
  const out = runProcessorFixed(mic, remote);
  const outRms = rms(out, BLOCK, dur);
  const remRms = rms(remote, BLOCK, dur);
  const suppression = 1 - (outRms / remRms);
  console.log(`     AGC-boosted suppression: ${(suppression * 100).toFixed(1)}%`);
  assert(suppression > 0.80, `Suppression ${(suppression*100).toFixed(1)}% should be >80% with AGC boost`);
});

test('constant ambient noise (0.03 RMS) does NOT keep gate permanently closed', () => {
  // THIS IS THE KEY REALISTIC TEST: constant background noise at RMS ~0.03
  // With a fixed threshold of 0.03, this would keep the gate perpetually
  // closed. The adaptive noise floor should detect this is ambient noise
  // and raise the threshold above it.
  const dur = SR * 5; // 5 seconds for noise floor to settle
  const mic = noiseBurst(dur, 0.05); // amplitude 0.05 → RMS ~0.03
  const remote = concat(silence(SR * 2), speechSignal(SR * 3, 0.3, 131));
  const out = runProcessorFixed(mic, remote);
  // Measure remote passthrough from 3s to 5s (noise floor should be settled by then)
  const measureStart = Math.round(SR * 3);
  const measureEnd = Math.round(SR * 5);
  const outRms = rms(out, measureStart, measureEnd);
  const remRms = rms(remote, measureStart, measureEnd);
  const passthrough = outRms / remRms;
  console.log(`     Noisy-mic passthrough: ${(passthrough * 100).toFixed(1)}%`);
  assert(passthrough > 0.50, `Passthrough ${(passthrough*100).toFixed(1)}% should be >50% — adaptive floor should ignore ambient noise`);
});

test('higher ambient noise (0.05 RMS) with speech still gates', () => {
  // Even with high ambient noise, speech should still trigger the gate
  // because speech RMS ~0.15 is much higher than noise floor ~0.05
  const dur = SR * 4;
  const noise = noiseBurst(dur, 0.08); // RMS ~0.05
  const speech = speechSignal(dur, 0.3, 132); // RMS ~0.15
  // First 2s: noise only. Next 2s: noise + speech
  const mic = new Float32Array(dur);
  for (let i = 0; i < dur; i++) {
    mic[i] = i < SR * 2 ? noise[i] : noise[i] + speech[i];
  }
  const remote = speechSignal(dur, 0.3, 133);
  const out = runProcessorFixed(mic, remote);
  // During noise-only period (0-2s), gate should be mostly open
  // During speech period (2-4s), gate should close
  const noisePeriodRms = rms(out, Math.round(SR * 1), Math.round(SR * 2));
  const noisePeriodRef = rms(remote, Math.round(SR * 1), Math.round(SR * 2));
  const speechPeriodRms = rms(out, Math.round(SR * 2.5), Math.round(SR * 4));
  const speechPeriodRef = rms(remote, Math.round(SR * 2.5), Math.round(SR * 4));
  const noisePassthrough = noisePeriodRef > 0 ? noisePeriodRms / noisePeriodRef : 1;
  const speechSuppression = speechPeriodRef > 0 ? 1 - (speechPeriodRms / speechPeriodRef) : 0;
  console.log(`     Noise-only passthrough: ${(noisePassthrough * 100).toFixed(1)}%, Speech suppression: ${(speechSuppression * 100).toFixed(1)}%`);
  assert(speechSuppression > 0.60, `Speech suppression ${(speechSuppression*100).toFixed(1)}% should be >60% even with noisy background`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ Test 12: Edge cases — empty/missing inputs');
// ─────────────────────────────────────────────────────────────

test('empty mic + empty remote produces silence', () => {
  const dur = SR;
  const mic = silence(dur);
  const remote = silence(dur);
  const out = runProcessorFixed(mic, remote);
  const maxSample = peak(out, 0, dur);
  assert(maxSample === 0, `Peak should be exactly 0, got ${maxSample}`);
});

test('empty mic + active remote passes remote through', () => {
  const dur = SR;
  const mic = silence(dur);
  const remote = speechSignal(dur, 0.3, 140);
  const out = runProcessorFixed(mic, remote);
  const outRms = rms(out, 0, dur);
  const remRms = rms(remote, 0, dur);
  const passthrough = outRms / remRms;
  console.log(`     Empty-mic passthrough: ${(passthrough * 100).toFixed(1)}%`);
  assert(passthrough > 0.90, `Passthrough ${(passthrough*100).toFixed(1)}% should be >90%`);
});

// ─────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60) + '\n');

process.exit(failed > 0 ? 1 : 0);
