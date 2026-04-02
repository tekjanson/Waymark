/* ============================================================
   arcade/renderer.js — Canvas 2D rendering primitives
   ============================================================ */

/* ---------- Constants ---------- */

export const VIRTUAL_W = 640;
export const VIRTUAL_H = 360;

/* ---------- State ---------- */

let _canvas = null;
let _ctx = null;
let _scale = 1;

/* ---------- Init & Resize ---------- */

/**
 * Initialise the renderer with a canvas element.
 * @param {HTMLCanvasElement} canvasEl
 */
export function initRenderer(canvasEl) {
  _canvas = canvasEl;
  _ctx = canvasEl.getContext('2d');
  _ctx.imageSmoothingEnabled = false;
  resize();
  window.addEventListener('resize', resize);
}

/**
 * Recalculate canvas size to fit parent while preserving virtual resolution.
 */
export function resize() {
  if (!_canvas) return;
  const parent = _canvas.parentElement;
  if (!parent) return;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  const scaleX = w / VIRTUAL_W;
  const scaleY = h / VIRTUAL_H;
  _scale = Math.min(scaleX, scaleY);
  const dpr = window.devicePixelRatio || 1;
  _canvas.width = Math.floor(VIRTUAL_W * _scale * dpr);
  _canvas.height = Math.floor(VIRTUAL_H * _scale * dpr);
  _canvas.style.width = Math.floor(VIRTUAL_W * _scale) + 'px';
  _canvas.style.height = Math.floor(VIRTUAL_H * _scale) + 'px';
  _ctx.setTransform(_scale * dpr, 0, 0, _scale * dpr, 0, 0);
  _ctx.imageSmoothingEnabled = false;
}

/**
 * Clean up the renderer (remove resize listener).
 */
export function destroyRenderer() {
  window.removeEventListener('resize', resize);
  _canvas = null;
  _ctx = null;
}

/* ---------- Coordinate Conversion ---------- */

/**
 * Convert a page-space coordinate to virtual-space.
 * @param {number} pageX
 * @param {number} pageY
 * @returns {{ x: number, y: number }}
 */
export function pageToVirtual(pageX, pageY) {
  if (!_canvas) return { x: 0, y: 0 };
  const rect = _canvas.getBoundingClientRect();
  return {
    x: (pageX - rect.left) / _scale,
    y: (pageY - rect.top) / _scale,
  };
}

/* ---------- Drawing Primitives ---------- */

/**
 * Clear the canvas with a solid colour.
 * @param {string} [color='#000']
 */
export function clear(color = '#000') {
  if (!_ctx) return;
  _ctx.fillStyle = color;
  _ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
}

/**
 * Draw a filled circle.
 * @param {number} x — centre x (virtual coords)
 * @param {number} y — centre y (virtual coords)
 * @param {number} r — radius (virtual coords)
 * @param {string} color
 */
export function drawCircle(x, y, r, color) {
  if (!_ctx) return;
  _ctx.beginPath();
  _ctx.arc(x, y, r, 0, Math.PI * 2);
  _ctx.fillStyle = color;
  _ctx.fill();
}

/**
 * Draw a circle outline.
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {string} color
 * @param {number} [lineWidth=1]
 */
export function strokeCircle(x, y, r, color, lineWidth = 1) {
  if (!_ctx) return;
  _ctx.beginPath();
  _ctx.arc(x, y, r, 0, Math.PI * 2);
  _ctx.strokeStyle = color;
  _ctx.lineWidth = lineWidth;
  _ctx.stroke();
}

/**
 * Draw a filled rectangle.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} color
 */
export function drawRect(x, y, w, h, color) {
  if (!_ctx) return;
  _ctx.fillStyle = color;
  _ctx.fillRect(x, y, w, h);
}

/**
 * Draw a rectangle outline.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} color
 * @param {number} [lineWidth=1]
 */
export function strokeRect(x, y, w, h, color, lineWidth = 1) {
  if (!_ctx) return;
  _ctx.strokeStyle = color;
  _ctx.lineWidth = lineWidth;
  _ctx.strokeRect(x, y, w, h);
}

/**
 * Draw a line.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {string} color
 * @param {number} [lineWidth=1]
 */
export function drawLine(x1, y1, x2, y2, color, lineWidth = 1) {
  if (!_ctx) return;
  _ctx.beginPath();
  _ctx.moveTo(x1, y1);
  _ctx.lineTo(x2, y2);
  _ctx.strokeStyle = color;
  _ctx.lineWidth = lineWidth;
  _ctx.stroke();
}

/**
 * Draw text.
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {Object} [opts]
 * @param {string} [opts.color='#fff']
 * @param {number} [opts.size=16]
 * @param {string} [opts.align='left']
 * @param {string} [opts.baseline='alphabetic']
 * @param {string} [opts.font='monospace']
 * @param {boolean} [opts.bold=false]
 */
export function drawText(text, x, y, opts = {}) {
  if (!_ctx) return;
  const {
    color = '#fff',
    size = 16,
    align = 'left',
    baseline = 'alphabetic',
    font = 'monospace',
    bold = false,
  } = opts;
  _ctx.fillStyle = color;
  _ctx.font = `${bold ? 'bold ' : ''}${size}px ${font}`;
  _ctx.textAlign = align;
  _ctx.textBaseline = baseline;
  _ctx.fillText(text, x, y);
}

/**
 * Measure text width in virtual pixels.
 * @param {string} text
 * @param {number} [size=16]
 * @param {string} [font='monospace']
 * @returns {number}
 */
export function measureText(text, size = 16, font = 'monospace') {
  if (!_ctx) return 0;
  _ctx.font = `${size}px ${font}`;
  return _ctx.measureText(text).width;
}

/**
 * Draw an image (sprite).
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {number} sx — source x
 * @param {number} sy — source y
 * @param {number} sw — source width
 * @param {number} sh — source height
 * @param {number} dx — dest x (virtual)
 * @param {number} dy — dest y (virtual)
 * @param {number} dw — dest width (virtual)
 * @param {number} dh — dest height (virtual)
 */
export function drawSprite(img, sx, sy, sw, sh, dx, dy, dw, dh) {
  if (!_ctx || !img) return;
  _ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * Draw a filled half-circle (for slime characters).
 * @param {number} x — centre x
 * @param {number} y — centre y (base of half-circle)
 * @param {number} r — radius
 * @param {string} color
 */
export function drawHalfCircle(x, y, r, color) {
  if (!_ctx) return;
  _ctx.beginPath();
  _ctx.arc(x, y, r, Math.PI, 0);
  _ctx.fillStyle = color;
  _ctx.fill();
}

/**
 * Draw a rounded rectangle.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r — corner radius
 * @param {string} color
 */
export function drawRoundRect(x, y, w, h, r, color) {
  if (!_ctx) return;
  _ctx.beginPath();
  _ctx.roundRect(x, y, w, h, r);
  _ctx.fillStyle = color;
  _ctx.fill();
}

/* ---------- State Save/Restore ---------- */

/**
 * Save canvas state (for clipping, transforms, etc.).
 */
export function save() {
  if (_ctx) _ctx.save();
}

/**
 * Restore canvas state.
 */
export function restore() {
  if (_ctx) _ctx.restore();
}

/**
 * Set a clipping rectangle.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
export function clip(x, y, w, h) {
  if (!_ctx) return;
  _ctx.beginPath();
  _ctx.rect(x, y, w, h);
  _ctx.clip();
}

/**
 * Set global alpha.
 * @param {number} a — 0..1
 */
export function setAlpha(a) {
  if (_ctx) _ctx.globalAlpha = a;
}

/**
 * Get current drawing context (escape hatch for advanced rendering).
 * @returns {CanvasRenderingContext2D|null}
 */
export function getCtx() {
  return _ctx;
}

/**
 * Get current scale factor.
 * @returns {number}
 */
export function getScale() {
  return _scale;
}
