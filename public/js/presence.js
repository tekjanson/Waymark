/* ============================================================
   presence.js — P2P Presence & Live Cursors

   Tracks all collaborators viewing the same sheet in real time.
   Each peer broadcasts a heartbeat every 2 s:
     { type: "presence", peerId, displayName, activeRow, activeCol, t }

   Transport (in priority order):
   1. BroadcastChannel  — same-browser tabs (instant, zero overhead)
   2. WaymarkConnect DC — cross-device (when a chat session is open)

   Usage (via checklist.js):
     presence.init(sheetId, itemsEl, displayName)   on sheet open
     presence.retag()                                after each re-render
     presence.destroy()                              on sheet hide

   The module self-wires to any WaymarkConnect instance by listening
   for the 'waymark:connect-ready' window event dispatched by chat.js.
   ============================================================ */

import { el } from './ui.js';

/* ---------- Constants ---------- */

const BEAT_MS  = 2000;   // Heartbeat interval (2 s as per spec)
const TTL_MS   = 6500;   // Peer expires after 6.5 s without a beat (> 3× beat)
const PRUNE_MS = 1000;   // How often to prune dead peers

const PEER_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#ec4899', '#0ea5e9', '#84cc16',
];

/* ---------- Module state ---------- */

let _sheetId     = null;
let _container   = null;   // #checklist-items
let _displayName = '';
let _peerId      = null;
let _activeRow   = -1;
let _activeCol   = -1;
let _bc          = null;
let _beatTimer   = null;
let _pruneTimer  = null;
let _bar         = null;
let _externalWC  = null;  // WaymarkConnect instance (optional, set by event)
let _peers       = new Map(); // peerId → { displayName, activeRow, activeCol, t, colorIdx }
let _colorIdx    = 0;

/* ---------- Public API ---------- */

/**
 * Initialise presence for a sheet view.
 * @param {string} sheetId
 * @param {HTMLElement} container — #checklist-items
 * @param {string} displayName — local user display name
 * @param {Object} [opts]
 * @param {string} [opts.peerId] — stable random ID (default: generated)
 */
export function init(sheetId, container, displayName, opts = {}) {
  destroy(); // clean up any previous session

  _sheetId     = sheetId;
  _container   = container;
  _displayName = displayName || 'Anonymous';
  _peerId      = opts.peerId || ('wm_p_' + Math.random().toString(36).slice(2, 10));
  _peers       = new Map();
  _colorIdx    = 0;
  _activeRow   = -1;
  _activeCol   = -1;

  // BroadcastChannel for same-browser presence (instant, no network overhead)
  if (typeof BroadcastChannel !== 'undefined') {
    _bc = new BroadcastChannel(`waymark-presence-${sheetId}`);
    _bc.onmessage = (e) => _handleBeat(e.data);
  }

  // Attach row-hover tracking to the container
  container.addEventListener('mouseover', _onMouseOver);

  // Tag any rows already rendered (called again by retag() on each re-render)
  _tagPresenceRows(container);

  // Build and insert the presence bar above the items container
  _bar = _buildBar();
  container.parentElement?.insertBefore(_bar, container);

  // Announce immediately, then start periodic heartbeats
  _sendBeat();
  _beatTimer  = setInterval(_sendBeat, BEAT_MS);
  _pruneTimer = setInterval(_pruneDeadPeers, PRUNE_MS);
}

/**
 * Re-tag rendered rows for tracking after a template re-render.
 * Must be called by checklist.js after every template.render() call.
 */
export function retag() {
  if (!_container) return;
  _tagPresenceRows(_container);
}

/**
 * Tear down presence — called by checklist.js on sheet hide.
 */
export function destroy() {
  clearInterval(_beatTimer);
  clearInterval(_pruneTimer);
  _beatTimer = _pruneTimer = null;

  // Broadcast a leave signal so peers remove us immediately
  const leaveMsg = {
    type: 'presence', peerId: _peerId,
    displayName: _displayName, activeRow: -1, activeCol: -1, t: -1,
  };
  if (_bc) {
    try { _bc.postMessage(leaveMsg); } catch {}
    _bc.close();
    _bc = null;
  }
  if (_externalWC) {
    try { _externalWC.broadcastPresence(-1, -1); } catch {}
  }

  // Remove row hover listener
  if (_container) {
    _container.removeEventListener('mouseover', _onMouseOver);
  }

  // Remove presence bar from DOM
  _bar?.remove();
  _bar = null;

  // Remove row highlights
  _clearAllHighlights();

  // Detach from WaymarkConnect (do NOT destroy it — it's owned by chat.js)
  if (_externalWC) {
    _externalWC.onPresence = null;
    _externalWC = null;
  }

  _peers.clear();
  _sheetId = _container = null;
}

/* ---------- Internal — heartbeats ---------- */

function _sendBeat() {
  if (!_sheetId) return;
  const msg = {
    type: 'presence',
    peerId: _peerId,
    displayName: _displayName,
    activeRow: _activeRow,
    activeCol: _activeCol,
    t: Date.now(),
  };
  // Same-browser tabs via dedicated presence channel
  if (_bc) { try { _bc.postMessage(msg); } catch {} }
  // Cross-device peers via WaymarkConnect DataChannels + its own BC
  if (_externalWC) { try { _externalWC.broadcastPresence(_activeRow, _activeCol); } catch {} }
}

function _handleBeat(msg) {
  if (!msg || msg.type !== 'presence') return;
  if (!_sheetId) return;
  if (msg.peerId === _peerId) return; // own echo

  // Leave signal (t === -1)
  if (msg.t === -1) {
    _peers.delete(msg.peerId);
    _renderBar();
    _applyRowHighlights();
    return;
  }

  const existed = _peers.has(msg.peerId);
  let peer = _peers.get(msg.peerId);

  if (!peer) {
    peer = { colorIdx: _colorIdx++ % PEER_COLORS.length };
  }
  peer.displayName = msg.displayName;
  peer.activeRow   = msg.activeRow;
  peer.activeCol   = msg.activeCol;
  peer.t           = msg.t;

  _peers.set(msg.peerId, peer);

  // New peer arrived — announce ourselves back so they see us immediately
  if (!existed) _sendBeat();

  _renderBar();
  _applyRowHighlights();
}

function _pruneDeadPeers() {
  if (!_peers.size) return;
  const cutoff = Date.now() - TTL_MS;
  let changed = false;
  for (const [id, p] of _peers) {
    if (p.t < cutoff) { _peers.delete(id); changed = true; }
  }
  if (changed) { _renderBar(); _applyRowHighlights(); }
}

/* ---------- Internal — row tracking ---------- */

function _onMouseOver(e) {
  const rowEl = e.target.closest('[data-presence-row]');
  if (!rowEl) return;
  const row = parseInt(rowEl.dataset.presenceRow, 10);
  if (row === _activeRow) return;
  _activeRow = row;
  _activeCol = -1;
  // Debounce: don't spam beats on every pixel — the periodic timer handles it
}

/**
 * Add data-presence-row attributes to renderable row elements inside container.
 * Works for both table-based templates (uses <tr>) and card/list templates
 * (uses direct children).
 * @param {HTMLElement} container
 */
function _tagPresenceRows(container) {
  // Remove stale tags first
  for (const el of container.querySelectorAll('[data-presence-row]')) {
    delete el.dataset.presenceRow;
  }

  // Table: use <tr> elements, skip header rows containing <th>
  const trs = container.querySelectorAll('tr');
  if (trs.length > 0) {
    let rowIdx = 1;
    for (const tr of trs) {
      if (tr.querySelector('th')) continue;
      tr.dataset.presenceRow = rowIdx++;
    }
    return;
  }

  // Non-table: tag direct children (one per data row for most templates)
  let rowIdx = 1;
  for (const child of container.children) {
    // Skip form elements (add-row, migration-banner, cross-feature-bar)
    if (
      child.classList.contains('add-row-root') ||
      child.classList.contains('migration-banner') ||
      child.classList.contains('cross-feature-bar') ||
      child.classList.contains('presence-bar')
    ) continue;
    child.dataset.presenceRow = rowIdx++;
  }
}

/* ---------- Internal — DOM ---------- */

function _buildBar() {
  return el('div', {
    className: 'presence-bar hidden',
    'aria-label': 'Live collaborators',
  }, [
    el('span', { className: 'presence-bar-label' }, ['Live:']),
  ]);
}

function _renderBar() {
  if (!_bar) return;
  // Clear existing chips (acceptable container-clear per AI laws §3.4)
  _bar.innerHTML = '';
  _bar.append(el('span', { className: 'presence-bar-label' }, ['Live:']));

  if (_peers.size === 0) {
    _bar.classList.add('hidden');
    return;
  }

  _bar.classList.remove('hidden');
  for (const [peerId, peer] of _peers) {
    _bar.append(_buildChip(peerId, peer));
  }
}

function _buildChip(peerId, peer) {
  const color   = PEER_COLORS[peer.colorIdx % PEER_COLORS.length];
  const initial = (peer.displayName || '?')[0].toUpperCase();
  const posLabel = peer.activeRow > 0 ? `Row ${peer.activeRow}` : '';

  const avatar = el('span', {
    className: 'presence-chip-avatar',
    style: `background:${color}`,
    'aria-hidden': 'true',
  }, [initial]);

  const name = el('span', { className: 'presence-chip-name' }, [peer.displayName]);

  const chip = el('div', {
    className: 'presence-chip',
    'data-peer-id': peerId,
    title: posLabel ? `${peer.displayName} — ${posLabel}` : peer.displayName,
  }, [avatar, name]);

  if (posLabel) {
    chip.append(el('span', { className: 'presence-chip-pos' }, [posLabel]));
  }

  return chip;
}

function _applyRowHighlights() {
  if (!_container) return;
  _clearAllHighlights();
  for (const [, peer] of _peers) {
    if (peer.activeRow <= 0) continue;
    const rowEl = _container.querySelector(`[data-presence-row="${peer.activeRow}"]`);
    if (!rowEl) continue;
    rowEl.classList.add('presence-row-highlight');
    rowEl.style.setProperty('--presence-color', PEER_COLORS[peer.colorIdx % PEER_COLORS.length]);
  }
}

function _clearAllHighlights() {
  if (!_container) return;
  for (const rowEl of _container.querySelectorAll('.presence-row-highlight')) {
    rowEl.classList.remove('presence-row-highlight');
    rowEl.style.removeProperty('--presence-color');
  }
}

/* ---------- WaymarkConnect integration ---------- */

// Listen for a WaymarkConnect instance becoming available (dispatched by chat.js)
window.addEventListener('waymark:connect-ready', (e) => {
  const wc = e?.detail?.connect;
  if (!wc || !_sheetId) return;
  _externalWC = wc;
  wc.onPresence = _handleBeat;
  // Announce immediately so cross-device peers see us right away
  _sendBeat();
});

// Detach when WaymarkConnect is torn down
window.addEventListener('waymark:connect-destroyed', () => {
  if (_externalWC) {
    _externalWC.onPresence = null;
    _externalWC = null;
  }
});
