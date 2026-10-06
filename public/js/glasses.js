/* ============================================================
   glasses.js — Glasses & Spatial control panel

   A native-bridge-backed control surface for the Even G2 point-and-identify
   pipeline. Lives in the Waymark sidebar.

   Device work happens in the Android layer; this view drives it through the
   trusted bridge (platform.getAndroidBridge) and reflects the state it polls
   back. The panel ALWAYS renders its controls — when not running inside the
   Android app it shows a clear "not connected" banner and disables the controls,
   so it never looks blank or broken.
   ============================================================ */

import { el, showToast } from './ui.js';
import { getAndroidBridge } from './platform.js';

/* ---------- State ---------- */

let _viewEl = null;
let _built = false;
let _pollTimer = null;
let _connected = null;   // null = unknown, so the first refresh always applies state
const _nodes = {};

const POLL_MS = 600;
const BRIDGE_METHODS = [
  'glassesAvailable', 'getGlassesState', 'setPointMode',
  'startCalibration', 'cancelCalibration',
];

/* ---------- Bridge access ---------- */

/** The trusted Android bridge when glasses support is live, else null. */
function bridge() {
  const b = getAndroidBridge(BRIDGE_METHODS);
  if (!b) return null;
  try { return b.glassesAvailable() ? b : null; }
  catch { return null; }
}

function readState() {
  const b = bridge();
  if (!b) return null;
  try { return JSON.parse(b.getGlassesState() || '{}'); }
  catch { return {}; }
}

/* ---------- Public API ---------- */

/** Initialise the glasses module. Call once at app boot. */
export function init(container) {
  _viewEl = container;
}

/** Show the glasses view and begin polling native state. */
export function show(container) {
  _viewEl = container || _viewEl;
  if (!_viewEl) return;
  _viewEl.classList.remove('hidden');
  buildPanel();
  refresh();
  startPolling();
}

/** Hide the view and stop polling. */
export function hide() {
  stopPolling();
  if (_viewEl) _viewEl.classList.add('hidden');
}

/* ---------- Build (always renders the full panel) ---------- */

function buildPanel() {
  if (_built) return;
  _viewEl.replaceChildren();

  _viewEl.append(
    el('div', { className: 'glasses-header' }, [
      el('h2', {}, ['Glasses & Spatial']),
      el('p', { className: 'glasses-sub' }, [
        'Control the Even G2 point-and-identify pipeline and run spatial calibration.',
      ]),
    ]),
  );

  // Connection banner (shown only when the native bridge is unavailable)
  _nodes.banner = el('div', { className: 'glasses-banner hidden' }, [
    'Open Waymark in the Android app with your Even G2 glasses to use these controls.',
  ]);
  _viewEl.append(_nodes.banner);

  /* Point Mode card */
  _nodes.pmToggle = el('input', {
    type: 'checkbox', id: 'glasses-pointmode',
    className: 'glasses-switch-input',
    on: { change: onTogglePointMode },
  });
  _nodes.pmState = el('span', { className: 'glasses-stat-value' }, ['—']);
  _nodes.lastLabel = el('span', { className: 'glasses-stat-value' }, ['—']);

  _viewEl.append(
    el('div', { className: 'glasses-card' }, [
      el('div', { className: 'glasses-row' }, [
        el('div', { className: 'glasses-row-text' }, [
          el('div', { className: 'glasses-row-title' }, ['Point Mode']),
          el('div', { className: 'glasses-row-desc' }, ['Stream what you point at to the glasses.']),
        ]),
        el('label', { className: 'glasses-switch' }, [
          _nodes.pmToggle,
          el('span', { className: 'glasses-switch-track' }, []),
        ]),
      ]),
      el('div', { className: 'glasses-stats' }, [
        el('div', { className: 'glasses-stat' }, [el('span', { className: 'glasses-stat-label' }, ['Status']), _nodes.pmState]),
        el('div', { className: 'glasses-stat' }, [el('span', { className: 'glasses-stat-label' }, ['Last seen']), _nodes.lastLabel]),
      ]),
    ]),
  );

  /* Calibration card */
  _nodes.calStatus = el('div', { className: 'glasses-cal-status' }, ['Not calibrated yet.']);
  _nodes.calProgress = el('div', { className: 'glasses-cal-progress hidden' }, []);
  _nodes.calPrompt = el('div', { className: 'glasses-cal-prompt' }, []);
  _nodes.runBtn = el('button', { className: 'btn btn-primary glasses-run-btn', on: { click: onRunCalibration } }, ['Run Calibration']);
  _nodes.cancelBtn = el('button', { className: 'btn btn-secondary glasses-cancel-btn hidden', on: { click: onCancelCalibration } }, ['Cancel']);

  _viewEl.append(
    el('div', { className: 'glasses-card' }, [
      el('div', { className: 'glasses-row-title' }, ['Spatial Calibration']),
      el('p', { className: 'glasses-row-desc' }, [
        'Point at each dot shown on your glasses and hold. Waymark learns how where you point maps to your view, so highlights land where you expect.',
      ]),
      _nodes.calStatus,
      _nodes.calProgress,
      _nodes.calPrompt,
      el('div', { className: 'glasses-btn-row' }, [_nodes.runBtn, _nodes.cancelBtn]),
    ]),
  );

  /* Streaming card (experimental) */
  _nodes.snapBtn = el('button', { className: 'btn btn-secondary', on: { click: onSendSnapshot } }, ['Send snapshot to glasses']);
  _viewEl.append(
    el('div', { className: 'glasses-card' }, [
      el('div', { className: 'glasses-row-title' }, ['Stream to glasses']),
      el('p', { className: 'glasses-row-desc' }, ['Push the current camera view to the lenses. Experimental.']),
      el('div', { className: 'glasses-btn-row' }, [_nodes.snapBtn]),
    ]),
  );

  _built = true;
}

/* ---------- Actions ---------- */

function onTogglePointMode(e) {
  const b = bridge();
  if (!b) { e.target.checked = !e.target.checked; return; }
  try { b.setPointMode(!!e.target.checked); } catch { /* no-op */ }
  refresh();
}

function onRunCalibration() {
  const b = bridge();
  if (!b) return;
  try { b.startCalibration(); showToast('Calibration started — look at your glasses and point at each dot.', 'info'); }
  catch { showToast('Could not start calibration', 'error'); }
  refresh();
}

function onCancelCalibration() {
  const b = bridge();
  if (!b) return;
  try { b.cancelCalibration(); } catch { /* no-op */ }
  refresh();
}

function onSendSnapshot() {
  const b = bridge();
  if (!b || typeof b.sendSnapshotToGlasses !== 'function') return;
  try { b.sendSnapshotToGlasses(); } catch { /* no-op */ }
}

/* ---------- Polling + render ---------- */

function startPolling() {
  stopPolling();
  _pollTimer = setInterval(refresh, POLL_MS);
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function setControlsEnabled(enabled) {
  _nodes.pmToggle.disabled = !enabled;
  _nodes.runBtn.disabled = !enabled;
  _nodes.cancelBtn.disabled = !enabled;
  _nodes.snapBtn.disabled = !enabled;
  _viewEl.classList.toggle('glasses-disconnected', !enabled);
}

function refresh() {
  if (!_built) return;
  const s = readState();
  const connected = !!s;

  if (connected !== _connected) {
    _connected = connected;
    _nodes.banner.classList.toggle('hidden', connected);
    setControlsEnabled(connected);
  }

  if (!connected) {
    _nodes.pmState.textContent = 'Not connected';
    return;
  }

  const pointMode = !!s.pointMode;
  if (document.activeElement !== _nodes.pmToggle) _nodes.pmToggle.checked = pointMode;
  _nodes.pmState.textContent = pointMode ? 'On' : 'Off';
  _nodes.lastLabel.textContent = s.lastLabel ? String(s.lastLabel) : '—';

  const calibrating = !!s.calibrating;
  const calibrated = !!s.calibrated;

  if (calibrating) {
    const step = Number(s.step || 0) + 1;
    const steps = Number(s.steps || 0);
    _nodes.calProgress.classList.remove('hidden');
    _nodes.calProgress.textContent = `Step ${Math.min(step, steps)} of ${steps} · captured ${Number(s.captured || 0)}`;
    _nodes.calPrompt.textContent = s.prompt ? String(s.prompt) : 'Point at the dot on your glasses and hold.';
    _nodes.calStatus.textContent = 'Calibrating…';
    _nodes.runBtn.classList.add('hidden');
    _nodes.cancelBtn.classList.remove('hidden');
  } else {
    _nodes.calProgress.classList.add('hidden');
    _nodes.calPrompt.textContent = '';
    _nodes.runBtn.classList.remove('hidden');
    _nodes.cancelBtn.classList.add('hidden');
    if (calibrated) {
      const q = Number(s.quality);
      const accuracy = Number.isFinite(q) ? Math.round((1 - Math.min(Math.max(q, 0), 1)) * 100) : null;
      _nodes.calStatus.textContent = accuracy != null
        ? `Calibrated ✓  accuracy ${accuracy}%`
        : 'Calibrated ✓';
      _nodes.calStatus.classList.add('glasses-calibrated');
    } else {
      _nodes.calStatus.textContent = 'Not calibrated yet.';
      _nodes.calStatus.classList.remove('glasses-calibrated');
    }
  }
}
