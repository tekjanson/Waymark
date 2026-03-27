/**
 * EchoGateProcessor — AudioWorklet with adaptive echo fingerprinting.
 *
 * Runs on the audio rendering thread at 128-sample intervals (~2.9ms at 48kHz).
 * This is ~5× faster than requestAnimationFrame and doesn't pause when the tab
 * is backgrounded.
 *
 * Architecture:
 *   Input 0: local mic post-processing (sidechain — read for level, not passed through)
 *   Input 1: remote audio (gated and sent to output)
 *   Output 0: echo-suppressed remote audio → speakers
 *
 * Three-layer echo suppression:
 *
 * 1. Voice-activity gate — When mic is active (RMS > threshold), remote audio
 *    is hard-muted instantly (gain = 0 on the very first sample). A base hold
 *    timer keeps the gate closed through natural speech pauses.
 *
 * 2. Echo fingerprinting — A ring buffer stores mic RMS history (~5 seconds).
 *    When the gate is about to open, the worklet cross-correlates the recent
 *    remote energy envelope with the mic history. If a correlation peak is
 *    found (i.e. the remote audio matches what we sent, time-shifted), the
 *    gate stays closed and the echo delay is learned.
 *
 * 3. Adaptive hold — Once the echo delay is learned, the hold timer auto-
 *    extends to cover the full roundtrip + safety margin. This means even
 *    multi-second delays are handled after the first detection.
 *
 * AudioParams:
 *   suppression (0–1): 0 = off, 1 = full mute while echo detected. Default 0.95.
 *   threshold (0–1): mic RMS above this triggers gating. Default 0.012.
 *   holdMs (0–5000): base hold after speech ends. Default 1500.
 */
class EchoGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'suppression', defaultValue: 0.95, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: 0.012, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'holdMs', defaultValue: 1500, minValue: 0, maxValue: 5000, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this._gain = 1.0;
    this._holdSamples = 0;

    // Mic RMS history: ~5s at 128-sample blocks.
    // 48000/128 = 375 blocks/sec → 5s = 1875 blocks (round to 1900)
    this._micHist = new Float32Array(1900);
    this._micW = 0;     // write cursor
    this._micFill = 0;  // how many valid entries

    // Remote RMS pattern buffer for correlation (last ~58ms = 20 blocks)
    this._remHist = new Float32Array(20);
    this._remW = 0;
    this._remFill = 0;

    // Echo detection state
    this._echoDelay = 0;       // learned delay in blocks
    this._echoConfidence = 0;  // 0–1
    this._echoHoldSamples = 0; // extra hold from echo detection
    this._checkCooldown = 0;   // blocks until next correlation check
  }

  process(inputs, outputs, parameters) {
    const mic = inputs[0];
    const remote = inputs[1];
    const out = outputs[0];
    if (!out[0]) return true;

    const suppression = parameters.suppression[0];
    const threshold = parameters.threshold[0];
    const baseHoldSamples = (parameters.holdMs[0] / 1000) * sampleRate;
    const gainTarget = Math.max(0, 1 - suppression);
    const N = out[0].length; // block size (128)

    // ── Mic RMS ──────────────────────────────────────────
    let micSum = 0;
    const mc = mic?.[0];
    if (mc) { for (let i = 0; i < mc.length; i++) micSum += mc[i] * mc[i]; }
    const micRms = Math.sqrt(micSum / (mc?.length || 128));

    this._micHist[this._micW] = micRms;
    this._micW = (this._micW + 1) % this._micHist.length;
    if (this._micFill < this._micHist.length) this._micFill++;

    // ── Remote RMS ───────────────────────────────────────
    let remSum = 0;
    const rc = remote?.[0];
    if (rc) { for (let i = 0; i < rc.length; i++) remSum += rc[i] * rc[i]; }
    const remRms = Math.sqrt(remSum / (rc?.length || 128));

    this._remHist[this._remW] = remRms;
    this._remW = (this._remW + 1) % this._remHist.length;
    if (this._remFill < this._remHist.length) this._remFill++;

    // ── Layer 1: Voice-activity hold ─────────────────────
    if (micRms > threshold) {
      this._holdSamples = baseHoldSamples;
    } else {
      this._holdSamples = Math.max(0, this._holdSamples - N);
    }

    // ── Layer 2: Echo fingerprinting ─────────────────────
    // Run correlation when base hold is about to expire and we haven't
    // checked recently. This amortizes CPU cost.
    if (this._checkCooldown > 0) this._checkCooldown--;
    if (this._holdSamples > 0 && this._holdSamples < N * 30 && this._checkCooldown === 0) {
      this._detectEcho(remRms);
      this._checkCooldown = 15; // don't recheck for ~44ms
    }

    // ── Layer 3: Adaptive hold from echo detection ───────
    this._echoHoldSamples = Math.max(0, this._echoHoldSamples - N);

    // ── Final gate decision ──────────────────────────────
    const gated = suppression > 0 && (this._holdSamples > 0 || this._echoHoldSamples > 0);
    const target = gated ? gainTarget : 1.0;

    // Instant attack (jump to target immediately when ducking).
    // Slow release (smooth fade-in when un-ducking) for click-free audio.
    for (let ch = 0; ch < out.length; ch++) {
      const src = remote?.[ch] ?? remote?.[0];
      for (let i = 0; i < out[ch].length; i++) {
        if (target < this._gain) {
          this._gain = target; // instant mute — zero latency
        } else {
          this._gain += (target - this._gain) * 0.0008;
          if (this._gain > target - 0.001) this._gain = target;
        }
        out[ch][i] = (src?.[i] ?? 0) * this._gain;
      }
    }

    return true;
  }

  /**
   * Cross-correlate recent remote energy envelope with mic history to detect echo.
   * Uses normalized cross-correlation (NCC) over a short pattern window.
   * If a correlation peak > 0.55 is found, it flags the delay and extends hold.
   */
  _detectEcho() {
    const patLen = Math.min(15, this._remFill);
    if (patLen < 8 || this._micFill < 100) return;

    // Build recent remote RMS pattern
    const pat = new Float32Array(patLen);
    for (let i = 0; i < patLen; i++) {
      pat[i] = this._remHist[(this._remW - patLen + i + this._remHist.length) % this._remHist.length];
    }

    // Skip if remote is essentially silent (no echo to detect)
    let patEnergy = 0;
    for (let i = 0; i < patLen; i++) patEnergy += pat[i];
    if (patEnergy / patLen < 0.004) return;

    // Normalize pattern
    let patMean = patEnergy / patLen;
    let patVar = 0;
    for (let i = 0; i < patLen; i++) patVar += (pat[i] - patMean) ** 2;
    const patStd = Math.sqrt(patVar / patLen);
    if (patStd < 0.0005) return; // flat, can't correlate

    // Search mic history for correlation peak.
    // If we have a previous echo delay, search narrowly around it first.
    const maxSearch = Math.min(this._micFill - patLen, this._micHist.length - patLen);
    let bestNcc = 0;
    let bestOff = 0;

    // Narrow search around known delay (±60 blocks ≈ ±175ms)
    if (this._echoDelay > 0) {
      const lo = Math.max(5, this._echoDelay - 60);
      const hi = Math.min(maxSearch, this._echoDelay + 60);
      this._searchRange(pat, patLen, patMean, patStd, lo, hi, (ncc, off) => {
        if (ncc > bestNcc) { bestNcc = ncc; bestOff = off; }
      });
    }

    // If narrow search didn't find a strong match, do a wider sweep
    // (every 3rd offset for speed — 5 to maxSearch)
    if (bestNcc < 0.55) {
      this._searchRange(pat, patLen, patMean, patStd, 5, maxSearch, (ncc, off) => {
        if (ncc > bestNcc) { bestNcc = ncc; bestOff = off; }
      }, 3);
    }

    if (bestNcc > 0.55) {
      this._echoDelay = bestOff;
      this._echoConfidence = bestNcc;
      // Extend hold by 2× the detected echo delay + 500ms safety margin
      const safetyBlocks = Math.ceil(500 / 1000 * sampleRate / 128);
      this._echoHoldSamples = (bestOff * 2 + safetyBlocks) * 128;
    }
  }

  /** Slide correlation window over mic history within [lo, hi). */
  _searchRange(pat, patLen, patMean, patStd, lo, hi, onResult, step = 1) {
    const hist = this._micHist;
    const hLen = hist.length;
    const w = this._micW;

    for (let off = lo; off < hi; off += step) {
      let micMean = 0;
      for (let i = 0; i < patLen; i++) {
        micMean += hist[(w - off - patLen + i + hLen) % hLen];
      }
      micMean /= patLen;

      let micVar = 0, cross = 0;
      for (let i = 0; i < patLen; i++) {
        const mv = hist[(w - off - patLen + i + hLen) % hLen] - micMean;
        micVar += mv * mv;
        cross += (pat[i] - patMean) * mv;
      }
      const micStd = Math.sqrt(micVar / patLen);
      if (micStd < 0.0005) continue;
      const ncc = cross / (patLen * patStd * micStd);
      onResult(ncc, off);
    }
  }
}

registerProcessor('echo-gate', EchoGateProcessor);
