/**
 * vision.js — Computer Vision Module
 *
 * Responsibilities:
 *   1. Open the rear-facing phone camera (environment-facing)
 *   2. Initialise MediaPipe Hands with single-hand detection
 *   3. On each frame, detect hand landmarks and extract the index finger tip
 *      (landmark index 8)
 *   4. Call a user-supplied callback with the finger's pixel coordinates
 *   5. Mirror the camera feed + landmarks onto a fullscreen debug <canvas>
 *      so the operator can see exactly what MediaPipe is tracking
 *
 * MediaPipe Hands landmark indices (21 points, 0-based):
 *   0  = wrist
 *   4  = thumb tip
 *   8  = index finger tip  ← primary tracking point
 *   12 = middle finger tip
 *   16 = ring finger tip
 *   20 = pinky tip
 */

/**
 * MediaPipe Hands is NOT a proper ES module — it writes onto window globals
 * (window.Hands, window.HAND_CONNECTIONS) via a UMD bundle loaded by the
 * <script> tag in index.html (served locally, not from a CDN).
 *
 * We access it lazily at start() time so this module can be imported before
 * that script finishes executing, as long as start() is only called after
 * DOMContentLoaded (which main.js guarantees).
 */

// MediaPipe Hands is served LOCALLY from /public/mediapipe/hands/ (see
// index.html for why: the Even WebView blocks non-whitelisted CDN requests).
// locateFile resolves the WASM / model / data files to that same local path.
const MEDIAPIPE_LOCAL_BASE = '/mediapipe/hands';

// Index into multiHandLandmarks[] for the index finger tip
const INDEX_FINGER_TIP = 8;

// ─────────────────────────────────────────────────────────────────────────────
// VisionTracker class
// ─────────────────────────────────────────────────────────────────────────────

export class VisionTracker {
  /**
   * @param {HTMLCanvasElement} debugCanvas
   *   Fullscreen canvas element where the camera feed + overlay is drawn.
   */
  constructor(debugCanvas) {
    this._debugCanvas = debugCanvas;
    this._debugCtx    = debugCanvas.getContext('2d');

    /** @type {HTMLVideoElement | null} Hidden video element for camera feed */
    this._videoEl = null;

    /** @type {MediaStream | null} The single camera stream */
    this._stream = null;

    /** @type {number | null} requestAnimationFrame handle for the pump loop */
    this._rafId = null;

    /** @type {any} MediaPipe Hands solution */
    this._hands = null;

    /** @type {any} Separate MediaPipe Hands instance for still-image capture */
    this._stillHands = null;

    /** @type {((x: number, y: number, w: number, h: number) => void) | null} */
    this._onFingerTracked = null;

    /** @type {boolean} */
    this._running = false;

    // Latest raw landmark data kept for debug overlay
    this._lastLandmarks = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register the callback that fires whenever a finger tip is detected.
   *
   * @param {(x: number, y: number, width: number, height: number) => void} cb
   *   Called with pixel coordinates on the camera frame and the frame's
   *   dimensions so the caller can compute normalized position independently.
   */
  onFingerTracked(cb) {
    this._onFingerTracked = cb;
  }

  /**
   * Gather camera diagnostics WITHOUT throwing — used to explain failures on
   * screen. Reports secure-context, permission state, and enumerable devices.
   *
   * @returns {Promise<object>}
   */
  static async diagnose() {
    const out = {
      secureContext: (typeof isSecureContext !== 'undefined') ? isSecureContext : 'unknown',
      hasMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      permissionState: 'unknown',
      videoInputs: 0,
      userAgent: navigator.userAgent,
    };
    try {
      if (navigator.permissions?.query) {
        const p = await navigator.permissions.query({ name: 'camera' });
        out.permissionState = p.state;
      }
    } catch (_) { /* not all engines support the camera permission name */ }
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const devs = await navigator.mediaDevices.enumerateDevices();
        out.videoInputs = devs.filter(d => d.kind === 'videoinput').length;
      }
    } catch (_) { /* ignore */ }
    return out;
  }

  /**
   * Start the camera and hand-tracking pipeline.
   *
   * Opens ONE camera stream (rear preferred, falls back to any camera), binds
   * it to a hidden <video>, then drives MediaPipe Hands from that single video
   * element via requestAnimationFrame. We deliberately do NOT use MediaPipe's
   * Camera helper because it opens a SECOND getUserMedia stream — some Android
   * WebViews reject a second concurrent handle to the same camera.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this._running) return;

    // ── Secure context check ─────────────────────────────────────────────────
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        'Camera unavailable: getUserMedia missing (not a secure context). ' +
        'Serve over HTTPS — run `npm run dev:android`.',
      );
    }

    // ── Create hidden video element ──────────────────────────────────────────
    this._videoEl = document.createElement('video');
    this._videoEl.setAttribute('playsinline', '');
    this._videoEl.setAttribute('autoplay', '');
    this._videoEl.muted = true;
    this._videoEl.style.display = 'none';
    document.body.appendChild(this._videoEl);

    // ── Open a single camera stream (rear preferred) ─────────────────────────
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      try {
        // Loosest possible constraint
        this._stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err2) {
        this._cleanupVideo();
        const name = err2?.name || err?.name || 'Error';
        const msg  = err2?.message || err?.message || 'camera access failed';
        const e = new Error(`${name}: ${msg}`);
        e.name = name;
        throw e;
      }
    }

    this._videoEl.srcObject = this._stream;
    await this._videoEl.play().catch(() => { /* some WebViews autoplay-block; ignore */ });

    // ── Build MediaPipe Hands ────────────────────────────────────────────────
    const HandsCtor = window.Hands;
    if (!HandsCtor) {
      this._teardownStream();
      throw new Error('MediaPipe Hands global not found (CDN <script> not loaded).');
    }

    this._hands = new HandsCtor({
      locateFile: (file) => `${MEDIAPIPE_LOCAL_BASE}/${file}`,
    });
    this._hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6,
    });
    this._hands.onResults((results) => this._onResults(results));

    // ── Drive MediaPipe from our single video element via rAF ────────────────
    this._running = true;
    const pump = async () => {
      if (!this._running) return;
      // Only send frames once the video has real dimensions
      if (this._videoEl && this._videoEl.videoWidth > 0) {
        try { await this._hands.send({ image: this._videoEl }); }
        catch (err) { console.warn('[VisionTracker] hands.send failed:', err); }
      }
      this._rafId = requestAnimationFrame(pump);
    };
    this._rafId = requestAnimationFrame(pump);

    console.log('[VisionTracker] Camera and hand tracking started (single-stream)');
  }

  /**
   * Track the index-finger tip in a SINGLE still image and draw the overlay to
   * the debug canvas. This is the ONLY camera path that works inside the Even
   * app WebView, because that WebView does not implement getUserMedia — it only
   * exposes the SDK's single-shot `captureImageFromCamera()`. We feed the
   * captured photo through the same MediaPipe Hands model used for live video.
   *
   * @param {HTMLImageElement | HTMLCanvasElement} image  decoded still image
   * @returns {Promise<{ x: number, y: number, width: number, height: number } | null>}
   *   fingertip pixel coordinates + image dimensions, or null if no hand found
   */
  async trackStillImage(image) {
    const HandsCtor = window.Hands;
    if (!HandsCtor) {
      throw new Error('MediaPipe Hands global not found (local <script> not loaded).');
    }

    // Lazily build a dedicated Hands instance for still-image mode. We keep it
    // separate from the live-video instance so the two modes never interfere.
    if (!this._stillHands) {
      this._stillHands = new HandsCtor({
        locateFile: (file) => `${MEDIAPIPE_LOCAL_BASE}/${file}`,
      });
      this._stillHands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        // Static images benefit from a higher detection threshold and no
        // temporal tracking (each capture is independent).
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
        staticImageMode: true,
      });
    }

    const camW = image.naturalWidth  || image.width  || 1280;
    const camH = image.naturalHeight || image.height || 720;

    // MediaPipe's send() resolves before onResults fires, so capture the result
    // via a one-shot promise.
    const result = await new Promise((resolve) => {
      const handler = (res) => resolve(res);
      this._stillHands.onResults(handler);
      this._stillHands.send({ image }).catch(() => resolve(null));
    });

    // Draw the captured frame + overlay so the operator sees what was tracked.
    this._drawStillOverlay(image, result, camW, camH);

    const lm = result?.multiHandLandmarks?.[0]?.[INDEX_FINGER_TIP];
    if (!lm) return null;
    return { x: lm.x * camW, y: lm.y * camH, width: camW, height: camH };
  }

  /** Render a captured still + its landmark overlay onto the debug canvas. */
  _drawStillOverlay(image, result, camW, camH) {
    if (
      this._debugCanvas.width  !== this._debugCanvas.offsetWidth ||
      this._debugCanvas.height !== this._debugCanvas.offsetHeight
    ) {
      this._debugCanvas.width  = this._debugCanvas.offsetWidth;
      this._debugCanvas.height = this._debugCanvas.offsetHeight;
    }
    const dw = this._debugCanvas.width;
    const dh = this._debugCanvas.height;
    const ctx = this._debugCtx;
    ctx.save();
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(image, 0, 0, dw, dh);

    const landmarks = result?.multiHandLandmarks?.[0];
    if (landmarks) {
      const sx = dw / camW, sy = dh / camH;
      for (const p of landmarks) {
        ctx.fillStyle = 'rgba(0,200,255,0.9)';
        ctx.beginPath();
        ctx.arc(p.x * camW * sx, p.y * camH * sy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      const tip = landmarks[INDEX_FINGER_TIP];
      if (tip) {
        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(tip.x * camW * sx, tip.y * camH * sy, 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = 'rgba(255,200,0,0.85)';
      ctx.font = '16px monospace';
      ctx.fillText('No hand detected in capture', 16, dh - 16);
    }
    ctx.restore();
  }

  /** Stop camera and free resources. */
  async stop() {
    if (!this._running) return;
    this._running = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._hands) { try { await this._hands.close(); } catch (_) {} this._hands = null; }
    this._teardownStream();
    this._cleanupVideo();
  }

  _teardownStream() {
    if (this._stream) {
      for (const t of this._stream.getTracks()) t.stop();
      this._stream = null;
    }
  }

  _cleanupVideo() {
    if (this._videoEl) {
      try { this._videoEl.srcObject = null; } catch (_) {}
      this._videoEl.remove();
      this._videoEl = null;
    }
  }

  get running() { return this._running; }

  // ── Private: MediaPipe results handler ─────────────────────────────────────

  /**
   * Called by MediaPipe Hands on every processed frame.
   *
   * @param {import('@mediapipe/hands').Results} results
   */
  _onResults(results) {
    const video = this._videoEl;
    const camW  = video?.videoWidth  || 1280;
    const camH  = video?.videoHeight || 720;

    // ── Update debug canvas size to match actual camera feed ─────────────────
    if (
      this._debugCanvas.width  !== this._debugCanvas.offsetWidth ||
      this._debugCanvas.height !== this._debugCanvas.offsetHeight
    ) {
      this._debugCanvas.width  = this._debugCanvas.offsetWidth;
      this._debugCanvas.height = this._debugCanvas.offsetHeight;
    }

    const dw  = this._debugCanvas.width;
    const dh  = this._debugCanvas.height;
    const ctx = this._debugCtx;

    // ── Draw camera feed (scaled to fill the debug canvas) ───────────────────
    ctx.save();
    ctx.clearRect(0, 0, dw, dh);

    // Draw raw camera image from results.image (already processed by MediaPipe)
    if (results.image) {
      ctx.drawImage(results.image, 0, 0, dw, dh);
    }

    // ── Draw landmarks overlay ────────────────────────────────────────────────
    const scaleX = dw / camW;
    const scaleY = dh / camH;

    this._lastLandmarks = results.multiHandLandmarks?.[0] ?? null;

    if (this._lastLandmarks) {
      // Draw skeleton connections
      ctx.strokeStyle = 'rgba(0, 255, 128, 0.7)';
      ctx.lineWidth   = 2;
      for (const [a, b] of (window.HAND_CONNECTIONS ?? [])) {
        const lmA = this._lastLandmarks[a];
        const lmB = this._lastLandmarks[b];
        if (!lmA || !lmB) continue;
        ctx.beginPath();
        ctx.moveTo(lmA.x * camW * scaleX, lmA.y * camH * scaleY);
        ctx.lineTo(lmB.x * camW * scaleX, lmB.y * camH * scaleY);
        ctx.stroke();
      }

      // Draw all landmark dots
      for (const lm of this._lastLandmarks) {
        ctx.fillStyle = 'rgba(0, 200, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(lm.x * camW * scaleX, lm.y * camH * scaleY, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Highlight the index finger tip with a larger, brighter dot
      const tip = this._lastLandmarks[INDEX_FINGER_TIP];
      if (tip) {
        const tipScreenX = tip.x * camW * scaleX;
        const tipScreenY = tip.y * camH * scaleY;

        ctx.strokeStyle = '#ff4444';
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.arc(tipScreenX, tipScreenY, 12, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 68, 68, 0.6)';
        ctx.fill();

        // Label
        ctx.fillStyle   = '#ffffff';
        ctx.font        = 'bold 13px monospace';
        ctx.fillText(`(${Math.round(tip.x * camW)}, ${Math.round(tip.y * camH)})`,
          tipScreenX + 15, tipScreenY - 5);
      }

      // ── Fire the finger-tracked callback ───────────────────────────────────
      const tipLm = this._lastLandmarks[INDEX_FINGER_TIP];
      if (tipLm && this._onFingerTracked) {
        // Convert normalized [0,1] coordinates → pixel coordinates
        const pixelX = tipLm.x * camW;
        const pixelY = tipLm.y * camH;
        this._onFingerTracked(pixelX, pixelY, camW, camH);
      }

    } else {
      // No hand detected — show a subtle indicator
      ctx.fillStyle = 'rgba(255, 200, 0, 0.7)';
      ctx.font      = '16px monospace';
      ctx.fillText('No hand detected', 16, dh - 16);
    }

    ctx.restore();
  }
}
