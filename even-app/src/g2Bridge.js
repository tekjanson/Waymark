/**
 * g2Bridge.js — Even Realities G2 SDK Bridge (persistent drawing)
 *
 * Display model
 * ─────────────
 * The G2 panel is 576×288, 4-bit greyscale. A single image container is capped
 * at 288×144 (a 576×288 container makes createStartUpPageContainer return
 * `1 = invalid` — verified in the simulator), so the screen is tiled 2×2:
 *
 *     ┌─────────────┬─────────────┐
 *     │ tile 3 (TL) │ tile 4 (TR) │   each 288×144
 *     ├─────────────┼─────────────┤
 *     │ tile 5 (BL) │ tile 6 (BR) │
 *     └─────────────┴─────────────┘
 *
 * Drawing model
 * ─────────────
 * There is ONE persistent 576×288 drawing layer that ACCUMULATES strokes. We
 * never clear it per-frame (that was the old bug: clearing every frame and
 * re-sending a tile as black deleted whatever was in that quadrant when the pen
 * crossed a boundary). Instead:
 *
 *   - strokeTo(x, y) draws a connected line segment onto the persistent layer
 *     and marks only the TILES that segment touched as "dirty".
 *   - A throttled flush sends only the dirty tiles (usually 1), so a stroke that
 *     crosses a quadrant boundary re-sends BOTH quadrants with their accumulated
 *     ink — the ink combines across quadrants instead of being deleted.
 *   - Because only changed tiles are sent, drawing is far less BLE traffic and
 *     noticeably faster than the old "send 4 full tiles every frame" approach.
 *
 * Encoding: updateImageRawData takes encoded PNG bytes; the SDK converts to
 * 4-bit greyscale internally (verified against the official image template).
 */

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  ImageContainerProperty,
  ImageRawDataUpdate,
} from '@evenrealities/even_hub_sdk';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const G2_WIDTH  = 576;
const G2_HEIGHT = 288;

const TILE_W = 288;
const TILE_H = 144;

const ID_EVENT_LAYER = 1;
const ID_STATUS      = 2;

// Image tiles laid out 2×2. col/row are grid coordinates.
const TILES = [
  { id: 3, col: 0, row: 0 },
  { id: 4, col: 1, row: 0 },
  { id: 5, col: 0, row: 1 },
  { id: 6, col: 1, row: 1 },
];

// ≈ 15 FPS ceiling on BLE frame sends
const MIN_FRAME_INTERVAL_MS = Math.floor(1000 / 15); // ~66 ms

// If two stroke points arrive more than this far apart in time, treat the new
// point as the START of a fresh stroke (pen lifted). This makes touch gaps and
// camera finger-loss break the line cleanly instead of drawing a jump.
const STROKE_GAP_MS = 250;

const STROKE_WIDTH = 6;

// Minimum time between distinct HUD repaints. Combined with content-signature
// dedup AND per-tile diffing (only changed tiles go over BLE), this keeps the
// stream smooth: a stable scene sends ZERO frames; a moving marker repaints
// cheaply (usually 1–2 tiles) at up to ~11×/sec.
const HUD_MIN_REDRAW_MS = 90;

// ─────────────────────────────────────────────────────────────────────────────
// G2Bridge
// ─────────────────────────────────────────────────────────────────────────────

export class G2Bridge {
  constructor() {
    /** @type {import('@evenrealities/even_hub_sdk').EvenAppBridge | null} */
    this._bridge = null;
    this._initialized = false;

    // Persistent drawing layer (accumulates strokes)
    this._draw = document.createElement('canvas');
    this._draw.width = G2_WIDTH;
    this._draw.height = G2_HEIGHT;
    this._drawCtx = this._draw.getContext('2d', { willReadFrequently: true });
    this._clearLayer();

    // Small scratch canvas for extracting one tile → PNG
    this._tileCanvas = document.createElement('canvas');
    this._tileCanvas.width = TILE_W;
    this._tileCanvas.height = TILE_H;
    this._tileCtx = this._tileCanvas.getContext('2d', { willReadFrequently: true });

    // Dirty-tile tracking
    this._dirty = new Set();      // tile ids needing (re)send
    this._flushing = false;
    this._flushTimer = null;
    this._lastSendMs = 0;
    this._tileHash = {};          // tile id → last-sent content hash (skip unchanged)

    // Pen state for connected strokes
    this._penDown = false;
    this._lastX = null;
    this._lastY = null;
    this._lastStrokeMs = 0;

    // Diagnostics
    this._pageCreateResult = null;
    this._sendCount = 0;          // total tiles sent (for QC/perf checks)

    // HUD streaming state (dedup + throttle so the stream feels smooth)
    this._hudSignature = null;    // last rendered content signature
    this._hudRenderedMs = 0;      // perf timestamp of last HUD paint
    this._calib = { dx: 0, dy: 0 }; // normalized calibration offset for markers
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initialise the SDK, register the page, render Hello World.
   * @param {object} [injectedBridge] Test hook: bypass waitForEvenAppBridge and
   *   use the provided bridge-like object (used by the visual-QC harness).
   */
  async init(injectedBridge = null) {
    if (this._initialized) return this._bridge;

    if (injectedBridge) {
      this._bridge = injectedBridge;
    } else {
      console.log('[G2Bridge] Waiting for EvenAppBridge…');
      this._bridge = await waitForEvenAppBridge();
      console.log('[G2Bridge] Bridge ready');
    }

    await this._registerPage();
    this._initialized = true;

    await this.helloWorld();
    return this._bridge;
  }

  /** Render a visible test pattern across all tiles to prove the pipeline. */
  async helloWorld() {
    if (!this._bridge) return;
    this._tileHash = {};   // force the connect splash to actually send

    const ctx = this._drawCtx;
    this._clearLayer();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, G2_WIDTH - 8, G2_HEIGHT - 8);

    const cx = G2_WIDTH / 2, cy = G2_HEIGHT / 2;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy); ctx.lineTo(cx + 40, cy);
    ctx.moveTo(cx, cy - 40); ctx.lineTo(cx, cy + 40);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText('G2 LINK OK', cx, cy - 80);
    ctx.font = '22px sans-serif';
    ctx.fillText('AR Drawing Ready', cx, cy + 80);

    this._markAllDirty();
    await this.flushNow();

    // Reset pen so the first real stroke starts fresh
    this._penDown = false;
    this._lastX = this._lastY = null;

    await this.setStatus('G2 connected - Hello World rendered');
  }

  /** Update the on-glasses status text line. */
  async setStatus(text) {
    if (!this._bridge) return;
    try {
      await this._bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID: ID_STATUS,
          containerName: 'status',
          content: String(text).slice(0, 200),
        }),
      );
    } catch (err) {
      console.warn('[G2Bridge] setStatus failed:', err);
    }
  }

  /**
   * Unified HUD renderer — the single smooth path for streaming identifications.
   *
   * Draws a large label and (optionally) a highlight bracket at a mapped object
   * position. It deduplicates on a content signature and throttles repaints, so:
   *   - a stable scene (same text, same spot) sends NOTHING over BLE, and
   *   - a moving/ changing scene repaints at most ~6×/sec.
   * This is what makes the on-lens view feel smooth instead of choppy.
   *
   * @param {object} opts
   * @param {string} [opts.text]    Label to show (identified object / status)
   * @param {number} [opts.nx]      Normalized object X (0..1) from Waymark
   * @param {number} [opts.ny]      Normalized object Y (0..1) from Waymark
   * @param {boolean} [opts.marker] Draw the highlight bracket at (nx, ny)
   */
  async renderHud({ text = '', nx = null, ny = null, marker = false } = {}) {
    if (!this._bridge) return;

    const label = String(text || '').trim();

    // Map normalized → G2 pixels (with calibration). Snap to a 12px grid so
    // sub-pixel jitter never triggers a redundant BLE frame.
    let mx = null, my = null, cellKey = 'none';
    const showMarker = marker && Number.isFinite(nx) && Number.isFinite(ny);
    if (showMarker) {
      mx = clamp(Math.round((nx + this._calib.dx) * (G2_WIDTH - 1)), 0, G2_WIDTH - 1);
      my = clamp(Math.round((ny + this._calib.dy) * (G2_HEIGHT - 1)), 0, G2_HEIGHT - 1);
      cellKey = `${Math.round(mx / 12)}:${Math.round(my / 12)}`;
    }

    const signature = `${label}|${cellKey}`;
    if (signature === this._hudSignature) return; // nothing changed → no BLE

    const now = performance.now();
    if ((now - this._hudRenderedMs) < HUD_MIN_REDRAW_MS) return; // too soon; next tick repaints

    this._hudSignature = signature;
    this._hudRenderedMs = now;

    const ctx = this._drawCtx;
    this._clearLayer();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (mx !== null) {
      // AR annotation: bracket the object and label it right beside the bracket
      // (not at a fixed top-center spot, which collided with high markers).
      this._drawMarker(ctx, mx, my);
      const label2 = label.length > 22 ? `${label.slice(0, 21)}…` : label;
      ctx.font = 'bold 30px sans-serif';
      const halfW = ctx.measureText(label2).width / 2;
      const cxLabel = clamp(mx, halfW + 10, G2_WIDTH - halfW - 10);
      const above = my - 46 - 22;           // 46 = bracket half-size
      const labelY = above > 16 ? above : (my + 46 + 24);
      if (label2) ctx.fillText(label2, cxLabel, labelY);
    } else {
      // Status / message: one big line in the upper HUD band (keeps the centre
      // of view clear and touches only the top two tiles — half the BLE cost).
      const line = label.length > 34 ? `${label.slice(0, 31)}…` : (label || '…');
      ctx.font = 'bold 44px sans-serif';
      ctx.fillText(line, G2_WIDTH / 2, 100);
    }

    this._markAllDirty();
    await this.flushNow();
  }

  /** Draw a camera-style highlight bracket + center dot around (x, y). */
  _drawMarker(ctx, x, y) {
    const r = 46;  // bracket half-size
    const b = 18;  // corner leg length
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r + b); ctx.lineTo(x - r, y - r); ctx.lineTo(x - r + b, y - r); // TL
    ctx.moveTo(x + r - b, y - r); ctx.lineTo(x + r, y - r); ctx.lineTo(x + r, y - r + b); // TR
    ctx.moveTo(x + r, y + r - b); ctx.lineTo(x + r, y + r); ctx.lineTo(x + r - b, y + r); // BR
    ctx.moveTo(x - r + b, y + r); ctx.lineTo(x - r, y + r); ctx.lineTo(x - r, y + r - b); // BL
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Force the next renderHud to paint even if content is unchanged. */
  resetHud() {
    this._hudSignature = null;
    this._hudRenderedMs = 0;
  }

  /** Set the normalized calibration offset applied to marker positions. */
  setCalibration(dx, dy) {
    this._calib = { dx: Number(dx) || 0, dy: Number(dy) || 0 };
    this.resetHud();
  }

  /**
   * Clear the lenses to black cleanly. Per-tile diffing means only tiles that
   * still hold ink are actually sent; a second clear is a no-op over BLE.
   */
  async clearGlasses() {
    if (!this._bridge) return;
    this.resetHud();
    this._clearLayer();
    this._penDown = false;
    this._lastX = this._lastY = null;
    this._markAllDirty();
    await this.flushNow();
  }

  /** Backward-compatible alias — a plain message with no marker. */
  async showHudMessage(text) {
    return this.renderHud({ text });
  }

  /**
   * Render a calibration target reticle at a glasses-space position with a
   * prompt. Used by the guided calibration routine. Deduplicated so a held
   * target does not re-flood BLE.
   *
   * @param {number} nx     Target X in glasses space (0..1)
   * @param {number} ny     Target Y in glasses space (0..1)
   * @param {string} prompt Instruction text
   * @param {number} step   1-based step index
   * @param {number} steps  total steps
   */
  async showCalibrationTarget(nx, ny, prompt = '', step = 0, steps = 0) {
    if (!this._bridge) return;
    const cx = clamp(Math.round(nx * (G2_WIDTH - 1)), 0, G2_WIDTH - 1);
    const cy = clamp(Math.round(ny * (G2_HEIGHT - 1)), 0, G2_HEIGHT - 1);

    const signature = `cal|${step}/${steps}|${Math.round(cx / 8)}:${Math.round(cy / 8)}`;
    if (signature === this._hudSignature) return;
    const now = performance.now();
    if ((now - this._hudRenderedMs) < HUD_MIN_REDRAW_MS) return;
    this._hudSignature = signature;
    this._hudRenderedMs = now;

    const ctx = this._drawCtx;
    this._clearLayer();

    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 48, cy); ctx.lineTo(cx - 40, cy);
    ctx.moveTo(cx + 40, cy); ctx.lineTo(cx + 48, cy);
    ctx.moveTo(cx, cy - 48); ctx.lineTo(cx, cy - 40);
    ctx.moveTo(cx, cy + 40); ctx.lineTo(cx, cy + 48);
    ctx.stroke();

    const label = steps ? `${prompt}  (${step}/${steps})`.trim() : String(prompt || '');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Text block goes on the opposite half from the reticle so they never
    // overlap. The step counter is its own line so it is never truncated.
    const topHalf = cy < G2_HEIGHT / 2;
    const stepY   = topHalf ? G2_HEIGHT - 48 : 30;
    const promptY = topHalf ? G2_HEIGHT - 20 : 58;

    if (steps > 0) {
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(`Step ${step} / ${steps}`, G2_WIDTH / 2, stepY);
    }
    const promptLine = prompt.length > 44 ? `${prompt.slice(0, 43)}…` : String(prompt || '');
    ctx.font = '20px sans-serif';
    if (promptLine) ctx.fillText(promptLine, G2_WIDTH / 2, promptY);

    this._markAllDirty();
    await this.flushNow();
  }

  /**
   * Clear the whole drawing to black and flush all tiles.
   * @param {boolean} [immediate=true] await a full flush before returning
   */
  async clearDrawing(immediate = true) {
    this._clearLayer();
    this._penDown = false;
    this._lastX = this._lastY = null;
    this._markAllDirty();
    if (immediate) await this.flushNow();
    else this._scheduleFlush();
  }

  /**
   * Draw a connected stroke to (x, y) on the persistent layer. If the pen was
   * lifted (or too much time elapsed), this starts a new stroke with a dot.
   *
   * @param {number} x 0..575
   * @param {number} y 0..287
   */
  strokeTo(x, y) {
    if (!this._initialized) return;

    const px = clamp(x, 0, G2_WIDTH - 1);
    const py = clamp(y, 0, G2_HEIGHT - 1);
    const now = performance.now();

    const ctx = this._drawCtx;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const continuing =
      this._penDown &&
      this._lastX !== null &&
      (now - this._lastStrokeMs) <= STROKE_GAP_MS;

    if (continuing) {
      // Connect from the previous point
      ctx.beginPath();
      ctx.moveTo(this._lastX, this._lastY);
      ctx.lineTo(px, py);
      ctx.stroke();
      this._markSegmentDirty(this._lastX, this._lastY, px, py);
    } else {
      // Start a new stroke with a dot
      ctx.beginPath();
      ctx.arc(px, py, STROKE_WIDTH / 2, 0, Math.PI * 2);
      ctx.fill();
      this._markSegmentDirty(px, py, px, py);
    }

    this._penDown = true;
    this._lastX = px;
    this._lastY = py;
    this._lastStrokeMs = now;

    this._scheduleFlush();
  }

  /** Lift the pen so the next strokeTo starts a fresh stroke. */
  endStroke() {
    this._penDown = false;
    this._lastX = this._lastY = null;
  }

  /**
   * Backward-compatible alias — a lone point is just a one-point stroke.
   * Kept so existing callers / the autotest keep working.
   */
  drawToGlasses(x, y) {
    this.strokeTo(x, y);
  }

  get bridge() { return this._bridge; }
  get initialized() { return this._initialized; }
  get pageCreateResult() { return this._pageCreateResult; }
  get sendCount() { return this._sendCount; }

  /**
   * Capture a single photo using the Even app's NATIVE camera (the only camera
   * path supported inside the Even WebView — getUserMedia is not implemented
   * there). Returns a data URL suitable for an <img>, or null if the user
   * cancelled / no camera.
   *
   * @returns {Promise<string | null>}
   */
  async captureCameraImage() {
    if (!this._bridge?.captureImageFromCamera) {
      throw new Error('SDK camera capture unavailable (not running inside the Even app).');
    }
    const asset = await this._bridge.captureImageFromCamera();
    if (!asset || !asset.base64) return null;
    const mime = asset.mimeType || 'image/jpeg';
    return `data:${mime};base64,${asset.base64}`;
  }

  // ── Private: SDK setup ─────────────────────────────────────────────────────

  async _registerPage() {
    const eventLayer = new TextContainerProperty({
      xPosition: 0, yPosition: 0, width: G2_WIDTH, height: G2_HEIGHT,
      borderWidth: 0, borderColor: 0, paddingLength: 0,
      containerID: ID_EVENT_LAYER, containerName: 'eventLayer',
      content: ' ', isEventCapture: 1,
    });

    const status = new TextContainerProperty({
      xPosition: 0, yPosition: 258, width: G2_WIDTH, height: 30,
      borderWidth: 0, borderColor: 0, paddingLength: 2,
      containerID: ID_STATUS, containerName: 'status',
      content: 'Connecting…', isEventCapture: 0,
    });

    const images = TILES.map(t => new ImageContainerProperty({
      xPosition: t.col * TILE_W,
      yPosition: t.row * TILE_H,
      width: TILE_W, height: TILE_H,
      containerID: t.id, containerName: 'tile' + t.id,
    }));

    const page = new CreateStartUpPageContainer({
      containerTotalNum: 2 + TILES.length,
      textObject: [eventLayer, status],
      imageObject: images,
    });

    try {
      const result = await this._bridge.createStartUpPageContainer(page);
      this._pageCreateResult = result;
      console.log('[G2Bridge] createStartUpPageContainer result:', result);
      if (result !== 0 && result !== 'success') {
        console.warn('[G2Bridge] Page creation returned non-success:', result);
      }
    } catch (err) {
      console.error('[G2Bridge] Failed to register page:', err);
      throw err;
    }
  }

  // ── Private: drawing helpers ────────────────────────────────────────────────

  _clearLayer() {
    this._drawCtx.fillStyle = '#000000';
    this._drawCtx.fillRect(0, 0, G2_WIDTH, G2_HEIGHT);
  }

  _markAllDirty() {
    for (const t of TILES) this._dirty.add(t.id);
  }

  /** Mark every tile a fattened segment bounding-box overlaps. */
  _markSegmentDirty(x0, y0, x1, y1) {
    const r = STROKE_WIDTH; // pad by full stroke width to be safe
    const minx = Math.min(x0, x1) - r;
    const maxx = Math.max(x0, x1) + r;
    const miny = Math.min(y0, y1) - r;
    const maxy = Math.max(y0, y1) + r;

    for (const t of TILES) {
      const tx0 = t.col * TILE_W, tx1 = tx0 + TILE_W;
      const ty0 = t.row * TILE_H, ty1 = ty0 + TILE_H;
      const overlaps = minx < tx1 && maxx >= tx0 && miny < ty1 && maxy >= ty0;
      if (overlaps) this._dirty.add(t.id);
    }
  }

  // ── Private: flush scheduling ───────────────────────────────────────────────

  _scheduleFlush() {
    if (this._flushing || this._flushTimer) return;
    if (this._dirty.size === 0) return;
    const wait = Math.max(0, MIN_FRAME_INTERVAL_MS - (performance.now() - this._lastSendMs));
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flushDirty().catch(err => console.warn('[G2Bridge] flush error:', err));
    }, wait);
  }

  /** Force an immediate flush of all dirty tiles (used by helloWorld/clear/QC). */
  async flushNow() {
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
    // Wait out any in-flight flush, then flush remaining
    while (this._flushing) await sleep(5);
    await this._flushDirty();
    // A stroke may have dirtied more tiles during the send; drain those too
    while (this._dirty.size > 0) {
      while (this._flushing) await sleep(5);
      await this._flushDirty();
    }
  }

  async _flushDirty() {
    if (this._flushing) return;
    if (this._dirty.size === 0) return;
    this._flushing = true;
    this._lastSendMs = performance.now();

    const ids = [...this._dirty];
    this._dirty.clear();

    try {
      for (const id of ids) {
        const tile = TILES.find(t => t.id === id);
        if (tile) await this._sendTile(tile);
      }
    } finally {
      this._flushing = false;
    }

    // If more became dirty while sending, schedule another pass
    if (this._dirty.size > 0) this._scheduleFlush();
  }

  // ── Private: tile extract + send ────────────────────────────────────────────

  async _sendTile(tile) {
    if (!this._bridge) return;

    this._tileCtx.clearRect(0, 0, TILE_W, TILE_H);
    this._tileCtx.drawImage(
      this._draw,
      tile.col * TILE_W, tile.row * TILE_H, TILE_W, TILE_H,
      0, 0, TILE_W, TILE_H,
    );

    // Per-tile diffing: if this tile's pixels are identical to what we last
    // sent, skip the PNG encode AND the BLE write entirely. This is the single
    // biggest smoothness win — stable regions cost nothing.
    const hash = this._hashTile();
    if (this._tileHash[tile.id] === hash) return;
    this._tileHash[tile.id] = hash;

    const bytes = await this._tileToPng();
    const result = await this._bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: tile.id,
        containerName: 'tile' + tile.id,
        imageData: bytes,
      }),
    );
    this._sendCount++;
    if (result !== 'success' && result !== 0) {
      console.warn(`[G2Bridge] tile ${tile.id} updateImageRawData:`, result);
    }
  }

  _tileToPng() {
    return new Promise((resolve, reject) => {
      this._tileCanvas.toBlob(async (blob) => {
        if (!blob) { reject(new Error('tile toBlob null')); return; }
        try { resolve(new Uint8Array(await blob.arrayBuffer())); }
        catch (err) { reject(err); }
      }, 'image/png');
    });
  }

  /** Cheap deterministic content hash of the tile scratch canvas (FNV-1a / R). */
  _hashTile() {
    const d = this._tileCtx.getImageData(0, 0, TILE_W, TILE_H).data;
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < d.length; i += 4) {
      h ^= d[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
}

// ── module helpers ────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Singleton
let _instance = null;
export function getG2Bridge() {
  if (!_instance) _instance = new G2Bridge();
  return _instance;
}
