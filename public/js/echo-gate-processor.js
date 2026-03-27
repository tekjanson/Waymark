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
 * Two-layer echo suppression:
 *
 * 1. Voice-activity gate — When mic is active (RMS > threshold), remote audio
 *    is hard-muted instantly (gain = 0 on the very first sample). A base hold
 *    timer (default 3000ms) keeps the gate closed after speech ends, covering
 *    typical WebRTC roundtrip delays.
 *
 * 2. Echo fingerprinting (safety net) — After the base hold expires, if remote
 *    audio is still present, the worklet cross-correlates the remote RMS envelope
 *    against mic history. If a match is found (NCC > threshold over a long
 *    pattern), the hold is extended. This catches unusually long delays that
 *    exceed the base hold. Uses 200-block patterns (~533ms) for near-zero
 *    false-positive rate.
 *
 * AudioParams:
 *   suppression (0–1): 0 = off, 1 = full mute while echo detected. Default 0.95.
 *   threshold (0–1): mic RMS above this triggers gating. Default 0.012.
 *   holdMs (0–8000): base hold after speech ends. Default 3000.
 */
class EchoGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'suppression', defaultValue: 0.95, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: 0.012, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'holdMs', defaultValue: 3000, minValue: 0, maxValue: 8000, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this._gain = 1.0;
    this._holdSamples = 0;

    // Mic RMS history: ~5s at 128-sample blocks (1900 blocks)
    this._micHist = new Float32Array(1900);
    this._micW = 0;
    this._micFill = 0;

    // Remote RMS ring buffer for pattern matching (200 blocks ≈ 533ms)
    this._remHist = new Float32Array(200);
    this._remW = 0;
    this._remFill = 0;

    // Echo detection state
    this._echoDelay = 0;
    this._echoConfidence = 0;
    this._echoHoldSamples = 0;
    this._checkCooldown = 0;
    this._consecutiveRemoteSpeech = 0;
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
    const N = out[0].length;

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

    if (remRms > 0.004) {
      this._consecutiveRemoteSpeech++;
    } else {
      this._consecutiveRemoteSpeech = 0;
    }

    // ── Layer 1: Voice-activity hold ─────────────────────
    if (micRms > threshold) {
      this._holdSamples = baseHoldSamples;
    } else {
      this._holdSamples = Math.max(0, this._holdSamples - N);
    }

    // ── Layer 2: Echo fingerprinting (safety net) ────────
    // ONLY runs after base hold has expired — the base hold covers typical
    // delays. This layer catches unusually long delays (> holdMs).
    if (this._checkCooldown > 0) this._checkCooldown--;

    if (this._holdSamples <= 0 && remRms > 0.004
        && this._checkCooldown === 0 && this._micFill > 200) {
      this._detectEcho();
      this._checkCooldown = 8;
    }

    this._echoHoldSamples = Math.max(0, this._echoHoldSamples - N);

    // ── Final gate decision ──────────────────────────────
    const gated = suppression > 0 && (this._holdSamples > 0 || this._echoHoldSamples > 0);
    const target = gated ? gainTarget : 1.0;

    // Instant attack, slow release for click-free audio.
    for (let ch = 0; ch < out.length; ch++) {
      const src = remote?.[ch] ?? remote?.[0];
      for (let i = 0; i < out[ch].length; i++) {
        if (target < this._gain) {
          this._gain = target;
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
   * Cross-correlate remote RMS envelope with mic history to detect echo.
   * Uses long patterns (200 blocks ≈ 533ms) for near-zero false-positive rate.
   * Only called after base hold expires as a safety net for long delays.
   */
  _detectEcho() {
    const patLen = Math.min(200, this._consecutiveRemoteSpeech);
    if (patLen < 100 || this._micFill < patLen + 50) return;

    // Build recent remote RMS pattern
    const pat = new Float32Array(patLen);
    for (let i = 0; i < patLen; i++) {
      pat[i] = this._remHist[(this._remW - patLen + i + this._remHist.length) % this._remHist.length];
    }

    // Skip if remote is essentially flat/silent
    let patEnergy = 0;
    for (let i = 0; i < patLen; i++) patEnergy += pat[i];
    if (patEnergy / patLen < 0.003) return;

    let patMean = patEnergy / patLen;
    let patVar = 0;
    for (let i = 0; i < patLen; i++) patVar += (pat[i] - patMean) ** 2;
    const patStd = Math.sqrt(patVar / patLen);
    if (patStd < 0.004) return;

    const maxSearch = Math.min(this._micFill - patLen, this._micHist.length - patLen);
    let bestNcc = 0;
    let bestOff = 0;

    // If we know the delay, search narrowly around it
    if (this._echoDelay > 0) {
      const lo = Math.max(3, this._echoDelay - 150);
      const hi = Math.min(maxSearch, this._echoDelay + 150);
      this._searchRange(pat, patLen, patMean, patStd, lo, hi, (ncc, off) => {
        if (ncc > bestNcc) { bestNcc = ncc; bestOff = off; }
      });
    }

    // Wide sweep if narrow search didn't find a match
    if (bestNcc < 0.80) {
      this._searchRange(pat, patLen, patMean, patStd, 3, maxSearch, (ncc, off) => {
        if (ncc > bestNcc) { bestNcc = ncc; bestOff = off; }
      }, 3);
    }

    if (bestNcc > 0.80) {
      this._echoDelay = bestOff;
      this._echoConfidence = bestNcc;
      const delayBlocks = bestOff + patLen;
      const safetyBlocks = Math.ceil(sampleRate / 128); // 1 second safety
      this._echoHoldSamples = Math.max(
        this._echoHoldSamples,
        (delayBlocks + safetyBlocks) * 128,
      );
    }
  }

  /** Slide NCC window over mic history within [lo, hi). */
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
      if (micStd < 0.002) continue;
      const ncc = cross / (patLen * patStd * micStd);
      onResult(ncc, off);
    }
  }
}

registerProcessor('echo-gate', EchoGateProcessor);
