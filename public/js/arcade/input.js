/* ============================================================
   arcade/input.js — Keyboard, touch, and gamepad input capture
   ============================================================ */

/* ---------- State ---------- */

const _keys = new Set();
let _inputActive = false;
let _mousePos = { x: 0, y: 0 };
let _mouseDown = false;
let _mouseClicked = false;
let _pageToVirtual = null;   // coordinate converter function

/* ---------- Keyboard ---------- */

/**
 * Start capturing keyboard input.
 */
export function startInput() {
  if (_inputActive) return;
  _inputActive = true;
  document.addEventListener('keydown', _onKeyDown);
  document.addEventListener('keyup', _onKeyUp);
}

/**
 * Stop capturing keyboard input.
 */
export function stopInput() {
  _inputActive = false;
  _keys.clear();
  document.removeEventListener('keydown', _onKeyDown);
  document.removeEventListener('keyup', _onKeyUp);
}

function _onKeyDown(e) {
  // Don't capture if typing in an input field
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  _keys.add(e.code);
  // Prevent arrow keys and space from scrolling
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
}

function _onKeyUp(e) {
  _keys.delete(e.code);
}

/**
 * Check if a key is currently pressed.
 * @param {string} code — KeyboardEvent.code value
 * @returns {boolean}
 */
export function isKeyDown(code) {
  return _keys.has(code);
}

/* ---------- Default Key Mapping ---------- */

/**
 * @typedef {Object} KeyMap
 * @property {string} left
 * @property {string} right
 * @property {string} up
 * @property {string} down
 * @property {string} action1
 * @property {string} action2
 * @property {string} action3
 * @property {string} action4
 */

/** Default key bindings for player 1 (arrow keys + ZX). */
export const P1_KEYS = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  action1: 'KeyZ',
  action2: 'KeyX',
  action3: 'KeyC',
  action4: 'KeyV',
};

/** WASD key bindings for local player 2. */
export const P2_KEYS = {
  left: 'KeyA',
  right: 'KeyD',
  up: 'KeyW',
  down: 'KeyS',
  action1: 'KeyQ',
  action2: 'KeyE',
  action3: 'KeyR',
  action4: 'KeyF',
};

/* ---------- Input Bit Packing ---------- */

/**
 * Input bit positions.
 * Bit 0: left
 * Bit 1: right
 * Bit 2: up / jump
 * Bit 3: down
 * Bit 4: action1
 * Bit 5: action2
 * Bit 6: action3
 * Bit 7: action4
 */
export const INPUT = {
  LEFT:    0x01,
  RIGHT:   0x02,
  UP:      0x04,
  DOWN:    0x08,
  ACTION1: 0x10,
  ACTION2: 0x20,
  ACTION3: 0x40,
  ACTION4: 0x80,
};

/**
 * Sample current keyboard state as a packed input byte.
 * @param {KeyMap} [keyMap] — key mapping (defaults to P1_KEYS)
 * @returns {number} — packed input bits
 */
export function sampleInput(keyMap = P1_KEYS) {
  let bits = 0;
  if (_keys.has(keyMap.left))    bits |= INPUT.LEFT;
  if (_keys.has(keyMap.right))   bits |= INPUT.RIGHT;
  if (_keys.has(keyMap.up))      bits |= INPUT.UP;
  if (_keys.has(keyMap.down))    bits |= INPUT.DOWN;
  if (_keys.has(keyMap.action1)) bits |= INPUT.ACTION1;
  if (_keys.has(keyMap.action2)) bits |= INPUT.ACTION2;
  if (_keys.has(keyMap.action3)) bits |= INPUT.ACTION3;
  if (_keys.has(keyMap.action4)) bits |= INPUT.ACTION4;
  return bits;
}

/* ---------- Gamepad ---------- */

/**
 * Sample the first connected gamepad as packed input bits.
 * @returns {number}
 */
export function sampleGamepad() {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = gamepads[0];
  if (!gp) return 0;
  let bits = 0;
  if (gp.axes[0] < -0.5) bits |= INPUT.LEFT;
  if (gp.axes[0] > 0.5)  bits |= INPUT.RIGHT;
  if (gp.axes[1] < -0.5) bits |= INPUT.UP;
  if (gp.axes[1] > 0.5)  bits |= INPUT.DOWN;
  if (gp.buttons[0] && gp.buttons[0].pressed) bits |= INPUT.ACTION1;
  if (gp.buttons[1] && gp.buttons[1].pressed) bits |= INPUT.ACTION2;
  if (gp.buttons[2] && gp.buttons[2].pressed) bits |= INPUT.ACTION3;
  if (gp.buttons[3] && gp.buttons[3].pressed) bits |= INPUT.ACTION4;
  return bits;
}

/* ---------- Mouse / Click (for board games) ---------- */

/**
 * Attach mouse listeners to a canvas for board game input.
 * @param {HTMLCanvasElement} canvas
 * @param {function} pageToVirtualFn — (pageX, pageY) => { x, y }
 */
export function startMouseInput(canvas, pageToVirtualFn) {
  _pageToVirtual = pageToVirtualFn;
  canvas.addEventListener('mousemove', _onMouseMove);
  canvas.addEventListener('mousedown', _onMouseDown);
  canvas.addEventListener('mouseup', _onMouseUp);
  canvas.addEventListener('click', _onClick);
  canvas.addEventListener('touchstart', _onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', _onTouchMove, { passive: false });
  canvas.addEventListener('touchend', _onTouchEnd);
}

/**
 * Remove mouse listeners from a canvas.
 * @param {HTMLCanvasElement} canvas
 */
export function stopMouseInput(canvas) {
  canvas.removeEventListener('mousemove', _onMouseMove);
  canvas.removeEventListener('mousedown', _onMouseDown);
  canvas.removeEventListener('mouseup', _onMouseUp);
  canvas.removeEventListener('click', _onClick);
  canvas.removeEventListener('touchstart', _onTouchStart);
  canvas.removeEventListener('touchmove', _onTouchMove);
  canvas.removeEventListener('touchend', _onTouchEnd);
}

function _onMouseMove(e) {
  if (_pageToVirtual) _mousePos = _pageToVirtual(e.pageX, e.pageY);
}

function _onMouseDown() {
  _mouseDown = true;
}

function _onMouseUp() {
  _mouseDown = false;
}

function _onClick(e) {
  if (_pageToVirtual) {
    _mousePos = _pageToVirtual(e.pageX, e.pageY);
  }
  _mouseClicked = true;
}

function _onTouchStart(e) {
  e.preventDefault();
  const t = e.touches[0];
  if (_pageToVirtual && t) _mousePos = _pageToVirtual(t.pageX, t.pageY);
  _mouseDown = true;
}

function _onTouchMove(e) {
  e.preventDefault();
  const t = e.touches[0];
  if (_pageToVirtual && t) _mousePos = _pageToVirtual(t.pageX, t.pageY);
}

function _onTouchEnd() {
  _mouseDown = false;
  _mouseClicked = true;
}

/**
 * Get the current mouse position in virtual coords.
 * @returns {{ x: number, y: number }}
 */
export function getMousePos() {
  return { ..._mousePos };
}

/**
 * Check if mouse button is currently held.
 * @returns {boolean}
 */
export function isMouseDown() {
  return _mouseDown;
}

/**
 * Check and consume a mouse click (returns true only once per click).
 * @returns {boolean}
 */
export function consumeClick() {
  if (_mouseClicked) {
    _mouseClicked = false;
    return true;
  }
  return false;
}

/* ---------- Combined Input ---------- */

/**
 * Sample all input sources (keyboard + gamepad) as a combined byte.
 * @param {KeyMap} [keyMap]
 * @returns {number}
 */
export function sampleAll(keyMap = P1_KEYS) {
  return sampleInput(keyMap) | sampleGamepad();
}
