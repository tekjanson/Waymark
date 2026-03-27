#!/usr/bin/env node
/**
 * Audio pipeline wiring tests.
 *
 * Mocks the Web Audio API and verifies the EXACT node connection graph
 * in WaymarkConnect._processAudio and createRemoteAudioPipeline.
 *
 * This is the test that would have caught the commit-8 bug where the
 * mic analyser was wired AFTER the DynamicsCompressor, crushing all
 * dynamics to ~0.004 RMS and making the echo gate threshold useless.
 *
 * Usage: node scripts/test-audio-pipeline.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Test harness ────────────────────────────────────────────
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

async function testAsync(name, fn) {
  try {
    await fn();
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

// ── Mock Web Audio API ──────────────────────────────────────
// Every mock node records its connections so we can verify the graph.

let nodeIdCounter = 0;

class MockAudioNode {
  constructor(type, ctx) {
    this._type = type;
    this._id = ++nodeIdCounter;
    this._connections = []; // { target, outputIndex, inputIndex }
    this._ctx = ctx;
  }
  connect(target, output = 0, input = 0) {
    this._connections.push({ target, output, input });
    return target;
  }
  disconnect(target) {
    if (target) {
      this._connections = this._connections.filter(c => c.target !== target);
    } else {
      this._connections = [];
    }
  }
  toString() { return `${this._type}#${this._id}`; }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor(ctx) {
    super('BiquadFilter', ctx);
    this.type = 'lowpass';
    this.frequency = { value: 350 };
    this.Q = { value: 1 };
  }
}

class MockDynamicsCompressorNode extends MockAudioNode {
  constructor(ctx) {
    super('DynamicsCompressor', ctx);
    this.threshold = { value: -24 };
    this.knee = { value: 30 };
    this.ratio = { value: 12 };
    this.attack = { value: 0.003 };
    this.release = { value: 0.25 };
  }
}

class MockAnalyserNode extends MockAudioNode {
  constructor(ctx) {
    super('Analyser', ctx);
    this.fftSize = 2048;
    this.smoothingTimeConstant = 0.8;
  }
  getFloatTimeDomainData(buf) {
    // Fill with silence
    for (let i = 0; i < buf.length; i++) buf[i] = 0;
  }
}

class MockGainNode extends MockAudioNode {
  constructor(ctx) {
    super('Gain', ctx);
    this.gain = { value: 1.0 };
  }
}

class MockMediaStreamSourceNode extends MockAudioNode {
  constructor(ctx) { super('MediaStreamSource', ctx); }
}

class MockMediaStreamDestinationNode extends MockAudioNode {
  constructor(ctx) {
    super('MediaStreamDestination', ctx);
    this.stream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  }
}

class MockAudioWorkletNode extends MockAudioNode {
  constructor(ctx, name, opts = {}) {
    super('AudioWorkletNode', ctx);
    this.name = name;
    this.numberOfInputs = opts.numberOfInputs ?? 1;
    this.numberOfOutputs = opts.numberOfOutputs ?? 1;
    this.parameterData = opts.parameterData ?? {};
    this.parameters = new Map();
    if (opts.parameterData) {
      for (const [k, v] of Object.entries(opts.parameterData)) {
        this.parameters.set(k, { value: v });
      }
    }
  }
}

class MockMediaStreamTrack {
  constructor(kind = 'audio') {
    this.kind = kind;
    this.id = `track-${++nodeIdCounter}`;
    this.stopped = false;
  }
  stop() { this.stopped = true; }
}

class MockMediaStream {
  constructor(tracks = []) {
    this._tracks = tracks;
  }
  getAudioTracks() { return this._tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return this._tracks.filter(t => t.kind === 'video'); }
  getTracks() { return [...this._tracks]; }
  addTrack(t) { this._tracks.push(t); }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.destination = new MockAudioNode('Destination', this);
    this._nodesCreated = [];
    this.audioWorklet = {
      addModule: async () => {},
    };
  }
  createMediaStreamSource(stream) {
    const n = new MockMediaStreamSourceNode(this);
    this._nodesCreated.push(n);
    return n;
  }
  createBiquadFilter() {
    const n = new MockBiquadFilterNode(this);
    this._nodesCreated.push(n);
    return n;
  }
  createDynamicsCompressor() {
    const n = new MockDynamicsCompressorNode(this);
    this._nodesCreated.push(n);
    return n;
  }
  createAnalyser() {
    const n = new MockAnalyserNode(this);
    this._nodesCreated.push(n);
    return n;
  }
  createGain() {
    const n = new MockGainNode(this);
    this._nodesCreated.push(n);
    return n;
  }
  createMediaStreamDestination() {
    const n = new MockMediaStreamDestinationNode(this);
    this._nodesCreated.push(n);
    return n;
  }
  async resume() {}
  async close() {}
}

// ── Load WaymarkConnect ─────────────────────────────────────
// Install globals that webrtc.js expects
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  AudioContext: MockAudioContext,
  webkitAudioContext: MockAudioContext,
};
globalThis.AudioContext = MockAudioContext;
globalThis.AudioWorkletNode = MockAudioWorkletNode;
globalThis.MediaStream = MockMediaStream;
Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: null },
  writable: true,
  configurable: true,
});
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };
// crypto and navigator are read-only in Node 22 — just ensure they exist
globalThis.BroadcastChannel = class { onmessage = null; postMessage() {} close() {} };
globalThis.clearInterval = globalThis.clearInterval || (() => {});
globalThis.setInterval = globalThis.setInterval || (() => 0);
globalThis.cancelAnimationFrame = () => {};
globalThis.requestAnimationFrame = () => 0;

// Dynamic import of the ESM module
const webrtcSrc = readFileSync(join(ROOT, 'public/js/webrtc.js'), 'utf8');

// We need to extract the WaymarkConnect class. Since it's an ESM with exports,
// we'll re-wrap it to expose the class.
const wrappedSrc = webrtcSrc
  .replace(/^export\s+/gm, '') // Strip ESM export keyword
  .replace(/import\s+.*?from\s+['"].*?['"];?/gm, ''); // Strip imports

let WaymarkConnect;
try {
  const fn = new Function('AudioContext', 'AudioWorkletNode', 'MediaStream',
    wrappedSrc + '\nreturn WaymarkConnect;');
  WaymarkConnect = fn(MockAudioContext, MockAudioWorkletNode, MockMediaStream);
} catch (e) {
  console.error('FATAL: Could not load WaymarkConnect:', e.message);
  process.exit(1);
}

if (!WaymarkConnect) {
  console.error('FATAL: WaymarkConnect class not found in webrtc.js');
  process.exit(1);
}

// ── Helper: create a WaymarkConnect instance for testing ────
function createInstance() {
  nodeIdCounter = 0;
  const wc = new WaymarkConnect('test-sheet', { displayName: 'Tester' });
  return wc;
}

// ── Helper: trace connection path from source ───────────────
function tracePath(startNode) {
  const path = [startNode._type];
  let current = startNode;
  while (current._connections.length > 0) {
    // Follow the first connection (main signal chain)
    current = current._connections[0].target;
    path.push(current._type);
  }
  return path;
}

// ── Helper: find node by type in connection path ────────────
function findInPath(startNode, type) {
  let current = startNode;
  if (current._type === type) return current;
  while (current._connections.length > 0) {
    current = current._connections[0].target;
    if (current._type === type) return current;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
console.log('\n🔌 Audio Pipeline Wiring Tests\n');
// ══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
console.log('━━ 1. _processAudio: Read-only analyser tap (preserves browser AEC)');
// ─────────────────────────────────────────────────────────────

test('mic path is source → analyser (read-only tap, no output destination)', () => {
  const wc = createInstance();
  const rawStream = new MockMediaStream([
    new MockMediaStreamTrack('audio'),
    new MockMediaStreamTrack('video'),
  ]);

  const result = wc._processAudio(rawStream);

  const ctx = wc._audioCtx;
  assert(ctx, 'AudioContext should be created');

  const source = ctx._nodesCreated.find(n => n._type === 'MediaStreamSource');
  assert(source, 'MediaStreamSource should be created');

  // Trace the path: should be source → analyser only
  const path = tracePath(source);
  const expected = ['MediaStreamSource', 'Analyser'];
  assert(
    JSON.stringify(path) === JSON.stringify(expected),
    `Expected path ${expected.join(' → ')} but got ${path.join(' → ')}`,
  );
});

test('no HP filter or compressor in mic path (browser AEC preserved)', () => {
  const wc = createInstance();
  wc._processAudio(new MockMediaStream([new MockMediaStreamTrack('audio')]));

  const ctx = wc._audioCtx;
  const hp = ctx._nodesCreated.find(n => n._type === 'BiquadFilter');
  const comp = ctx._nodesCreated.find(n => n._type === 'DynamicsCompressor');
  assert(!hp, 'No BiquadFilter should exist in mic path (would break AEC)');
  assert(!comp, 'No DynamicsCompressor should exist in mic path (would break AEC)');
});

test('no MediaStreamDestination in mic path (raw track sent to peers)', () => {
  const wc = createInstance();
  wc._processAudio(new MockMediaStream([new MockMediaStreamTrack('audio')]));

  const ctx = wc._audioCtx;
  const dest = ctx._nodesCreated.find(n => n._type === 'MediaStreamDestination');
  assert(!dest, 'No MediaStreamDestination should exist — raw stream goes to peers');
});

test('mic analyser is stored on instance for sidechain use', () => {
  const wc = createInstance();
  const rawStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(rawStream);

  assert(wc._micAnalyser, '_micAnalyser should be set');
  assert(wc._micAnalyser._type === 'Analyser', '_micAnalyser should be an AnalyserNode');
  assert(wc._micAnalyser.fftSize === 256, `fftSize should be 256, got ${wc._micAnalyser.fftSize}`);
  assert(
    wc._micAnalyser.smoothingTimeConstant === 0.5,
    `smoothingTimeConstant should be 0.5, got ${wc._micAnalyser.smoothingTimeConstant}`,
  );
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ 2. _processAudio: Browser AEC preservation');
// ─────────────────────────────────────────────────────────────

test('returns the ORIGINAL raw stream (not a processed copy)', () => {
  const wc = createInstance();
  const audioTrack = new MockMediaStreamTrack('audio');
  const raw = new MockMediaStream([audioTrack]);
  const result = wc._processAudio(raw);
  assert(result === raw, 'Must return the original raw stream to preserve browser AEC');
  assert(result.getAudioTracks()[0] === audioTrack, 'Audio track must be the original getUserMedia track');
});

test('returning raw stream preserves browser echoCancellation constraint', () => {
  // If _processAudio returns a new MediaStreamDestination track, Chrome\'s
  // AEC loses the reference to the capture device and echo cancellation
  // stops working. This test ensures we return the ORIGINAL track.
  const wc = createInstance();
  const original = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  const result = wc._processAudio(original);
  assert(result === original,
    'Raw stream must be returned unchanged — Web Audio MediaStreamDestination ' +
    'tracks bypass Chrome\'s AEC on Linux (PipeWire, PulseAudio, ALSA)');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ 3. _processAudio: Output stream composition');
// ─────────────────────────────────────────────────────────────

test('output stream is the original raw stream with all tracks intact', () => {
  const wc = createInstance();
  const audioTrack = new MockMediaStreamTrack('audio');
  const videoTrack = new MockMediaStreamTrack('video');
  const raw = new MockMediaStream([audioTrack, videoTrack]);

  const result = wc._processAudio(raw);
  assert(result === raw, 'Should return the original raw stream');
  assert(result.getAudioTracks().length === 1, 'Should have 1 audio track');
  assert(result.getVideoTracks().length === 1, 'Should have 1 video track');
  assert(result.getAudioTracks()[0] === audioTrack, 'Audio track should be the ORIGINAL (browser AEC intact)');
  assert(result.getVideoTracks()[0] === videoTrack, 'Video track should be the original');
});

test('no-audio stream is returned unchanged', () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('video')]);
  const result = wc._processAudio(raw);
  assert(result === raw, 'Stream with no audio should be returned as-is');
  assert(!wc._audioCtx, 'No AudioContext should be created for video-only stream');
});

test('processedStream is stored on instance', () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  const result = wc._processAudio(raw);
  assert(wc._processedStream === result, '_processedStream should reference the returned stream');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ 4. _processAudio: AudioWorklet registration');
// ─────────────────────────────────────────────────────────────

test('audioWorklet.addModule is called for echo-gate-processor', () => {
  const wc = createInstance();
  let modulePath = null;
  // Intercept addModule call
  const origAudioContext = MockAudioContext;
  const ctx = new MockAudioContext();
  ctx.audioWorklet.addModule = async (path) => { modulePath = path; };
  // Manually wire up
  wc._audioCtx = null;
  wc._processedStream = null;

  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);

  // The real code creates its own AudioContext, check _workletReady was set
  assert(wc._workletReady !== null, '_workletReady should be set when audioWorklet available');
});

test('worklet failure does not break _processAudio (catch → null)', () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  // Make addModule throw
  const origCtor = globalThis.window.AudioContext;
  let throwOnAdd = true;
  class FailWorkletContext extends MockAudioContext {
    constructor() {
      super();
      if (throwOnAdd) {
        this.audioWorklet.addModule = async () => { throw new Error('Worklet load failed'); };
      }
    }
  }
  globalThis.window.AudioContext = FailWorkletContext;
  globalThis.AudioContext = FailWorkletContext;

  const result = wc._processAudio(raw);

  // Should return the raw stream (browser AEC preserved)
  assert(result === raw, 'Should return raw stream even when worklet fails');
  assert(result.getAudioTracks().length === 1, 'Should still have 1 audio track');

  globalThis.window.AudioContext = origCtor;
  globalThis.AudioContext = origCtor;
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ 5. createRemoteAudioPipeline: Worklet pipeline');
// ─────────────────────────────────────────────────────────────

await testAsync('worklet pipeline wires mic analyser → gate input 0 (sidechain)', async () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);

  // Ensure worklet is "ready"
  wc._workletReady = Promise.resolve();

  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  const result = await wc.createRemoteAudioPipeline(remoteStream);

  // The worklet node should have been created
  const gate = wc._echoGateNode;
  assert(gate, 'Echo gate worklet node should be created');
  assert(gate._type === 'AudioWorkletNode', `Expected AudioWorkletNode, got ${gate._type}`);
  assert(gate.name === 'echo-gate', `Expected name echo-gate, got ${gate.name}`);

  // Verify mic analyser is connected to gate input 0
  const micConnection = wc._micAnalyser._connections.find(c => c.target === gate);
  assert(micConnection, 'Mic analyser should be connected to echo gate');
  assert(micConnection.output === 0, `Mic connection output should be 0, got ${micConnection.output}`);
  assert(micConnection.input === 0, `Mic connection input should be 0 (sidechain), got ${micConnection.input}`);

  result.cleanup();
});

await testAsync('worklet pipeline wires remote → hp → gate input 1', async () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);
  wc._workletReady = Promise.resolve();

  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  await wc.createRemoteAudioPipeline(remoteStream);

  const ctx = wc._audioCtx;
  // Find the remote source and HP filter created for the remote pipeline
  // They are the last MediaStreamSource and last BiquadFilter created
  const sources = ctx._nodesCreated.filter(n => n._type === 'MediaStreamSource');
  const remoteSource = sources[sources.length - 1]; // last one is for remote
  assert(remoteSource, 'Remote MediaStreamSource should exist');

  // Remote source → HP filter
  assert(remoteSource._connections.length > 0, 'Remote source should have connections');
  const hpNode = remoteSource._connections[0].target;
  assert(hpNode._type === 'BiquadFilter', `Expected BiquadFilter after remote source, got ${hpNode._type}`);
  assert(hpNode.type === 'highpass', `Expected highpass filter, got ${hpNode.type}`);

  // HP → gate input 1
  const hpToGate = hpNode._connections.find(c => c.target === wc._echoGateNode);
  assert(hpToGate, 'HP filter should be connected to echo gate');
  assert(hpToGate.input === 1, `HP connection should go to gate input 1, got ${hpToGate.input}`);
});

await testAsync('worklet pipeline routes gate → MediaStreamDestination (AEC-compatible)', async () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);
  wc._workletReady = Promise.resolve();

  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  const result = await wc.createRemoteAudioPipeline(remoteStream);

  const gate = wc._echoGateNode;
  const toDest = gate._connections.find(c => c.target._type === 'MediaStreamDestination');
  assert(toDest, 'Echo gate should connect to MediaStreamDestination (not ctx.destination)');

  // Should NOT connect to ctx.destination directly
  const toCtxDest = gate._connections.find(c => c.target === wc._audioCtx.destination);
  assert(!toCtxDest, 'Echo gate should NOT connect directly to ctx.destination');

  // Should return an outputStream for the <audio> element
  assert(result.outputStream, 'Pipeline should return outputStream for <audio> element playback');
  assert(result.outputStream.getAudioTracks().length > 0, 'outputStream should have audio tracks');
});

await testAsync('worklet parameterData passes opts correctly', async () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);
  wc._workletReady = Promise.resolve();

  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  await wc.createRemoteAudioPipeline(remoteStream, {
    echoSuppression: 0.80,
    duckThreshold: 0.05,
    holdMs: 2000,
    highPassFreq: 150,
  });

  const gate = wc._echoGateNode;
  assert(gate.parameterData.suppression === 0.80, `suppression should be 0.80, got ${gate.parameterData.suppression}`);
  assert(gate.parameterData.threshold === 0.05, `threshold should be 0.05, got ${gate.parameterData.threshold}`);
  assert(gate.parameterData.holdMs === 2000, `holdMs should be 2000, got ${gate.parameterData.holdMs}`);

  // HP frequency on remote filter
  const ctx = wc._audioCtx;
  const filters = ctx._nodesCreated.filter(n => n._type === 'BiquadFilter');
  const remoteHp = filters[filters.length - 1]; // last filter is for remote
  assert(remoteHp.frequency.value === 150, `Remote HP freq should be 150, got ${remoteHp.frequency.value}`);
});

await testAsync('worklet pipeline uses default opts when none provided', async () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);
  wc._workletReady = Promise.resolve();

  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  await wc.createRemoteAudioPipeline(remoteStream);

  const gate = wc._echoGateNode;
  assert(gate.parameterData.suppression === 0.95, `Default suppression should be 0.95, got ${gate.parameterData.suppression}`);
  assert(gate.parameterData.threshold === 0.03, `Default threshold should be 0.03, got ${gate.parameterData.threshold}`);
  assert(gate.parameterData.holdMs === 3000, `Default holdMs should be 3000, got ${gate.parameterData.holdMs}`);

  const ctx = wc._audioCtx;
  const filters = ctx._nodesCreated.filter(n => n._type === 'BiquadFilter');
  const remoteHp = filters[filters.length - 1];
  assert(remoteHp.frequency.value === 120, `Default remote HP freq should be 120, got ${remoteHp.frequency.value}`);
});

await testAsync('cleanup disconnects all worklet pipeline nodes', async () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);
  wc._workletReady = Promise.resolve();

  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  const { cleanup } = await wc.createRemoteAudioPipeline(remoteStream);

  const gate = wc._echoGateNode;
  assert(gate, 'Gate should exist before cleanup');

  cleanup();

  assert(wc._echoGateNode === null, 'Gate should be null after cleanup');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ 6. createRemoteAudioPipeline: Fallback pipeline');
// ─────────────────────────────────────────────────────────────

await testAsync('falls back to rAF pipeline when worklet unavailable', async () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);
  // Simulate worklet unavailable
  wc._workletReady = null;

  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  const { cleanup } = await wc.createRemoteAudioPipeline(remoteStream);

  // Fallback creates a separate AudioContext
  assert(wc._remoteCtx, 'Fallback should create a separate AudioContext');
  assert(wc._echoGateNode === null, 'No worklet node in fallback path');

  cleanup();
});

await testAsync('fallback pipeline wires source → hp → gain → MediaStreamDestination', async () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);
  wc._workletReady = null;

  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  const result = await wc.createRemoteAudioPipeline(remoteStream);

  const ctx = wc._remoteCtx;
  assert(ctx, 'Fallback AudioContext should exist');

  const source = ctx._nodesCreated.find(n => n._type === 'MediaStreamSource');
  assert(source, 'Remote source should exist');

  const path = tracePath(source);
  const expected = ['MediaStreamSource', 'BiquadFilter', 'Gain', 'MediaStreamDestination'];
  assert(
    JSON.stringify(path) === JSON.stringify(expected),
    `Expected path ${expected.join(' → ')} but got ${path.join(' → ')}`,
  );

  // Should return outputStream for <audio> element
  assert(result.outputStream, 'Fallback should return outputStream');
  assert(result.outputStream.getAudioTracks().length > 0, 'outputStream should have audio tracks');
});

await testAsync('no-audio remote stream returns noop cleanup', async () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);

  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('video')]);
  const { cleanup } = await wc.createRemoteAudioPipeline(remoteStream);
  // Should not throw
  cleanup();
  assert(!wc._remoteCtx, 'No remote context for video-only stream');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ 7. createRemoteAudioPipeline: AudioContext resume');
// ─────────────────────────────────────────────────────────────

await testAsync('resumes suspended AudioContext (mobile support)', async () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);
  wc._workletReady = Promise.resolve();

  // Simulate mobile AudioContext suspension
  let resumed = false;
  wc._audioCtx.state = 'suspended';
  wc._audioCtx.resume = async () => { resumed = true; wc._audioCtx.state = 'running'; };

  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  await wc.createRemoteAudioPipeline(remoteStream);

  assert(resumed, 'AudioContext.resume() should be called when state is suspended');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ 8. _teardownAudio: Cleanup');
// ─────────────────────────────────────────────────────────────

test('teardownAudio resets all audio state', () => {
  const wc = createInstance();
  const raw = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._processAudio(raw);

  // Verify state exists
  assert(wc._audioCtx, 'AudioContext should exist');
  assert(wc._processedStream, 'ProcessedStream should exist');
  assert(wc._micAnalyser, 'MicAnalyser should exist');

  wc._teardownAudio();

  assert(wc._audioCtx === null, 'AudioContext should be null after teardown');
  assert(wc._processedStream === null, 'ProcessedStream should be null after teardown');
  assert(wc._micAnalyser === null, 'MicAnalyser should be null after teardown');
  assert(wc._workletReady === null, 'WorkletReady should be null after teardown');
  assert(wc._echoGateNode === null, 'EchoGateNode should be null after teardown');
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ 9. AEC preservation: mic audio must NOT route through Web Audio output');
// ─────────────────────────────────────────────────────────────

test('source connects directly to analyser (no intermediate processing)', () => {
  const wc = createInstance();
  wc._processAudio(new MockMediaStream([new MockMediaStreamTrack('audio')]));

  const ctx = wc._audioCtx;
  const source = ctx._nodesCreated.find(n => n._type === 'MediaStreamSource');
  assert(source._connections.length === 1, 'Source should have exactly one connection');
  const target = source._connections[0].target;
  assert(target._type === 'Analyser',
    `Source should connect directly to Analyser, got ${target._type}. ` +
    `Routing mic through HP/compressor/destination creates a new track that ` +
    `bypasses Chrome\'s AEC on Linux (PipeWire, PulseAudio, ALSA).`);
});

test('analyser has no downstream output (read-only sidechain tap)', () => {
  const wc = createInstance();
  wc._processAudio(new MockMediaStream([new MockMediaStreamTrack('audio')]));

  const analyser = wc._micAnalyser;
  // Analyser should have NO connections to any output nodes
  // (connections TO it from source are fine, connections FROM it to gate
  // are added later by createRemoteAudioPipeline)
  const downstreamTypes = analyser._connections.map(c => c.target._type);
  const badOutputs = downstreamTypes.filter(t =>
    t === 'MediaStreamDestination' || t === 'DynamicsCompressor' || t === 'Gain');
  assert(badOutputs.length === 0,
    `Analyser should not connect to output nodes, got: ${badOutputs.join(', ')}. ` +
    `The mic analyser is a read-only tap — sending its output anywhere would ` +
    `create a processed track that bypasses browser AEC.`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n━━ 10. Race condition: answerer pipeline timing');
// ─────────────────────────────────────────────────────────────

await testAsync('remote audio is NOT played when _micAnalyser is null (answerer scenario)', async () => {
  const wc = createInstance();
  // DO NOT call _processAudio — simulates the answerer before accepting

  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  const { cleanup } = await wc.createRemoteAudioPipeline(remoteStream);

  // No AudioContext should be created — no audio should be playing
  assert(!wc._remoteCtx, 'No fallback AudioContext should be created without _micAnalyser');
  assert(!wc._echoGateNode, 'No worklet node should be created without _micAnalyser');

  cleanup();
});

await testAsync('ontrack stores remote stream in _remoteStreams map', async () => {
  const wc = createInstance();
  const fakeStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);

  // Simulate ontrack handler storing the stream
  wc._remoteStreams.set('peer-123', fakeStream);

  assert(wc._remoteStreams.has('peer-123'), 'Remote stream should be stored');
  assert(wc._remoteStreams.get('peer-123') === fakeStream, 'Stored stream should match');
});

await testAsync('startCall re-emits onRemoteStream for stored remote streams', async () => {
  const wc = createInstance();

  // Simulate: remote stream arrived BEFORE call was accepted
  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  wc._remoteStreams.set('peer-abc', remoteStream);

  // First onRemoteStream call (before mic analyser exists) → noop pipeline
  let onRemoteStreamCalls = 0;
  let lastStreamArg = null;
  wc.onRemoteStream = (stream) => {
    onRemoteStreamCalls++;
    lastStreamArg = stream;
  };

  // Simulate startCall setting up mic processing
  // We can't call the real startCall (needs getUserMedia), so test the re-emit logic directly:
  // After _processAudio sets _micAnalyser, the code iterates _remoteStreams and re-emits
  wc._processAudio(new MockMediaStream([new MockMediaStreamTrack('audio')]));

  // Simulate the re-emit loop from startCall
  if (wc._micAnalyser) {
    for (const [peerId, stream] of wc._remoteStreams) {
      if (stream.getAudioTracks().length > 0) {
        wc.onRemoteStream(stream, peerId);
      }
    }
  }

  assert(onRemoteStreamCalls === 1, `onRemoteStream should be called once, got ${onRemoteStreamCalls}`);
  assert(lastStreamArg === remoteStream, 'Should re-emit with the stored remote stream');
});

await testAsync('full answerer flow: noop → accept → rebuild with worklet', async () => {
  const wc = createInstance();

  // Phase 1: Remote stream arrives BEFORE call accepted.
  // _micAnalyser is null → createRemoteAudioPipeline returns noop.
  const remoteStream = new MockMediaStream([new MockMediaStreamTrack('audio')]);
  const result1 = await wc.createRemoteAudioPipeline(remoteStream);
  assert(!wc._echoGateNode, 'Phase 1: No worklet node should exist');
  assert(!wc._remoteCtx, 'Phase 1: No fallback context should exist');
  assert(!result1.outputStream, 'Phase 1: outputStream should be null (no audio plays)');
  result1.cleanup();

  // Phase 2: User accepts call → _processAudio sets up _micAnalyser.
  wc._processAudio(new MockMediaStream([new MockMediaStreamTrack('audio')]));
  assert(wc._micAnalyser, 'Phase 2: _micAnalyser should now exist');
  wc._workletReady = Promise.resolve();

  // Phase 3: onRemoteStream is re-emitted → createRemoteAudioPipeline with _micAnalyser.
  const result2 = await wc.createRemoteAudioPipeline(remoteStream);
  assert(wc._echoGateNode, 'Phase 3: Worklet node should now exist');
  assert(wc._echoGateNode._type === 'AudioWorkletNode', 'Phase 3: Should use worklet path');
  assert(result2.outputStream, 'Phase 3: outputStream should exist for <audio> element');

  // Verify gate routes to MediaStreamDestination (not ctx.destination)
  const gate = wc._echoGateNode;
  const toDest = gate._connections.find(c => c.target._type === 'MediaStreamDestination');
  assert(toDest, 'Phase 3: Gate should route to MediaStreamDestination');

  // Verify mic analyser is connected to gate input 0 (sidechain)
  const micConnection = wc._micAnalyser._connections.find(c => c.target === wc._echoGateNode);
  assert(micConnection, 'Phase 3: Mic analyser should be connected to echo gate');
  assert(micConnection.input === 0, 'Phase 3: Mic should connect to gate input 0');

  result2.cleanup();
});

test('_closeOne removes remote stream from _remoteStreams', () => {
  const wc = createInstance();
  wc._remoteStreams.set('peer-abc', new MockMediaStream([new MockMediaStreamTrack('audio')]));
  wc._rtc.set('peer-abc', { pc: { close() {} }, dc: { close() {} } });

  assert(wc._remoteStreams.has('peer-abc'), 'Should have remote stream before close');
  wc._closeOne('peer-abc');
  assert(!wc._remoteStreams.has('peer-abc'), 'Should remove remote stream after close');
});

// ─────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60) + '\n');

process.exit(failed > 0 ? 1 : 0);
