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
 * 1. Adaptive noise floor — Continuously tracks ambient mic noise level using
 *    a dual-speed exponential tracker. The effective voice-activity threshold
 *    is max(paramThreshold, noiseFloor × 4). This prevents constant ambient
 *    noise from keeping the gate permanently closed.
 *
 * 2. Voice-activity gate — When mic is active (RMS > adaptive threshold),
 *    remote audio is hard-muted instantly. A hold timer keeps the gate closed
 *    after speech ends, covering typical WebRTC roundtrip delays.
 *
 * 3. Echo fingerprinting (safety net) — After the hold expires, cross-
 *    correlates remote RMS envelope against mic history to catch echo at
 *    delays beyond the base hold time.
 *
 * AudioParams:
 *   suppression (0–1): 0 = off, 1 = full mute while echo detected. Default 0.90.
 *   threshold (0–1): minimum mic RMS for gating (adaptive floor may raise it). Default 0.012.
 *   holdMs (0–8000): base hold after speech ends. Default 800.
 */
class EchoGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'suppression', defaultValue: 0.90, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: 0.012, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'holdMs', defaultValue: 800, minValue: 0, maxValue: 8000, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this._gain = 1.0;
    this._holdSamples = 0;

    // Adaptive noise floor tracking — uses a sliding-window minimum of
    // mic RMS. Speech has natural pauses that dip toward the noise floor,
    // while constant ambient noise stays level. The minimum over ~1 second
    // is a robust estimate of the ambient noise level.
    this._noiseFloor = 0.005;       // smoothed noise floor estimate
    this._minWindow = new Float32Array(375); // ~1s ring buffer
    this._minWindow.fill(1.0);              // start high so it converges down
    this._minW = 0;
    this._minFill = 0;

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

    // Diagnostics: report state to main thread ~4×/sec
    this._diagInterval = 0;
    this._diagEnabled = false;
    this.port.onmessage = (e) => {
      if (e.data?.type === 'enable-diag') this._diagEnabled = true;
      if (e.data?.type === 'disable-diag') this._diagEnabled = false;
    };
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

    // ── Layer 1: Adaptive noise floor ────────────────────
    // Track the minimum mic RMS over a ~1-second sliding window.
    // Speech contains natural pauses that dip to the noise floor;
    // constant ambient noise doesn't dip. The window minimum is a
    // robust estimate of ambient level without being pulled up by speech.
    this._minWindow[this._minW] = micRms;
    this._minW = (this._minW + 1) % this._minWindow.length;
    if (this._minFill < this._minWindow.length) this._minFill++;

    let windowMin = 1.0;
    for (let i = 0; i < this._minFill; i++) {
      if (this._minWindow[i] < windowMin) windowMin = this._minWindow[i];
    }
    // Smooth the noise floor toward the window minimum (avoids jitter)
    this._noiseFloor += (windowMin - this._noiseFloor) * 0.05;
    this._noiseFloor = Math.max(0.001, Math.min(0.15, this._noiseFloor));

    // Effective threshold: proportional + fixed offset above noise floor.
    // This ensures the gap between noise and threshold doesn't vanish at
    // high noise levels while staying responsive at low noise levels.
    const effectiveThreshold = Math.max(threshold, this._noiseFloor * 1.5 + 0.02);

    // ── Layer 2: Voice-activity hold ─────────────────────
    if (micRms > effectiveThreshold) {
      this._holdSamples = baseHoldSamples;
    } else {
      this._holdSamples = Math.max(0, this._holdSamples - N);
    }

    // ── Layer 3: Echo fingerprinting (safety net) ────────
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

    // Instant attack, smooth release for click-free audio.
    for (let ch = 0; ch < out.length; ch++) {
      const src = remote?.[ch] ?? remote?.[0];
      for (let i = 0; i < out[ch].length; i++) {
        if (target < this._gain) {
          this._gain = target;
        } else {
          this._gain += (target - this._gain) * 0.005;
          if (this._gain > target - 0.001) this._gain = target;
        }
        out[ch][i] = (src?.[i] ?? 0) * this._gain;
      }
    }

    // Diagnostic reporting (~4×/sec → every ~94 blocks at 48kHz)
    if (this._diagEnabled) {
      this._diagInterval++;
      if (this._diagInterval >= 94) {
        this._diagInterval = 0;
        this.port.postMessage({
          type: 'diag',
          micRms,
          remRms,
          gain: this._gain,
          gated,
          holdMs: (this._holdSamples / sampleRate) * 1000,
          echoHoldMs: (this._echoHoldSamples / sampleRate) * 1000,
          echoDelay: this._echoDelay,
          echoConf: this._echoConfidence,
          threshold: effectiveThreshold,
          noiseFloor: this._noiseFloor,
          paramThreshold: threshold,
        });
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
