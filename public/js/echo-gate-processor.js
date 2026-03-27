/**
 * EchoGateProcessor — AudioWorklet that gates remote audio based on local mic level.
 *
 * Runs on the audio rendering thread at 128-sample intervals (~2.9ms at 44.1kHz).
 * This is ~5× faster than requestAnimationFrame and doesn't pause when the tab
 * is backgrounded.
 *
 * Input 0: local mic post-processing (sidechain — read for RMS, not passed through)
 * Input 1: remote audio (gated by mic level and sent to output)
 * Output 0: gated remote audio → speakers
 *
 * AudioParams:
 *   suppression (0–1): 0 = off, 1 = full mute while speaking. Default 0.95.
 *   threshold (0–1): mic RMS above this triggers gating. Default 0.012.
 *   holdMs (0–2000): ms to stay gated after speech ends. Default 400.
 */
class EchoGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'suppression', defaultValue: 0.95, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: 0.012, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'holdMs', defaultValue: 400, minValue: 0, maxValue: 2000, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this._gain = 1.0;
    this._holdRemaining = 0; // samples remaining in hold window
  }

  process(inputs, outputs, parameters) {
    const mic = inputs[0];
    const remote = inputs[1];
    const output = outputs[0];

    if (!output[0]) return true;

    const suppression = parameters.suppression[0];
    const threshold = parameters.threshold[0];
    const holdSamples = (parameters.holdMs[0] / 1000) * sampleRate;
    const gainWhenDucked = Math.max(0, 1 - suppression);
    const blockSize = output[0].length;

    // Calculate mic RMS for this block
    let sum = 0;
    const micCh = mic?.[0];
    if (micCh) {
      for (let i = 0; i < micCh.length; i++) sum += micCh[i] * micCh[i];
    }
    const rms = Math.sqrt(sum / (micCh?.length || 128));

    // Update hold counter (in samples)
    if (rms > threshold) {
      this._holdRemaining = holdSamples;
    } else {
      this._holdRemaining = Math.max(0, this._holdRemaining - blockSize);
    }

    // Target gain: ducked while in hold window, full volume otherwise
    const target = this._holdRemaining > 0 ? gainWhenDucked : 1.0;

    // Per-sample smoothing for click-free transitions:
    //   Attack: 0.5 → 95% in ~6 samples (0.13ms) — near-instant muting
    //   Release: 0.001 → 95% in ~3000 samples (62ms) — smooth fade-in
    const rate = target < this._gain ? 0.5 : 0.001;

    for (let ch = 0; ch < output.length; ch++) {
      const src = remote?.[ch] ?? remote?.[0];
      for (let i = 0; i < output[ch].length; i++) {
        this._gain += (target - this._gain) * rate;
        if (Math.abs(this._gain - target) < 0.001) this._gain = target;
        output[ch][i] = (src?.[i] ?? 0) * this._gain;
      }
    }

    return true;
  }
}

registerProcessor('echo-gate', EchoGateProcessor);
