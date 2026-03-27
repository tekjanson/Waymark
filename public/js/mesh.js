/* ============================================================
   mesh.js — Browser mesh peer-to-peer command channel

   Global mesh coordinator enabling opt-in P2P communication
   between browser tabs/windows. Built on WebRTC RTCDataChannel
   with BroadcastChannel fallback for same-origin tabs.

   ALL mesh features are DISABLED by default. Users must
   explicitly enable mesh via the settings UI before any
   WebRTC connections are established.

   Command protocol:
     Every message over the mesh is a JSON command with:
     { id, action, timestamp, from, payload }
     Commands are logged and deduplicated by ID for idempotent
     application across all peers.
   ============================================================ */

import * as storage from './storage.js';

/* ---------- Constants ---------- */

const BC_CHANNEL = 'waymark-mesh';

const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const ICE_GATHER_TIMEOUT = 2000;
const PEER_TTL = 50000;         // Consider peer dead after 50s silence
const MAX_COMMAND_LOG = 500;    // Keep last 500 commands for dedup

/* ---------- Module state ---------- */

let _enabled = false;
let _peerId = null;
let _displayName = 'Anonymous';
let _bc = null;
let _peers = new Map();           // peerId → { name, channel, lastSeen, role }
let _rtcPeers = new Map();        // peerId → { pc, dc, state }
let _commandLog = new Map();      // commandId → { action, timestamp, from }
let _commandHandlers = new Map(); // action → Set<handler>
let _heartTimer = null;
let _pruneTimer = null;
let _statusListeners = new Set();
let _peerListeners = new Set();

/* ---------- Public API ---------- */

/**
 * Initialise the mesh. Only starts connections if mesh is enabled
 * in storage. Call once during app boot.
 * @param {{ displayName?: string }} opts
 */
export function init(opts = {}) {
  _peerId = storage.getMeshPeerId();
  _displayName = opts.displayName || 'Anonymous';
  _enabled = storage.getMeshEnabled();

  if (!_enabled) return;
  _start();
}

/**
 * Enable or disable the mesh at runtime. Persists to storage.
 * @param {boolean} enabled
 */
export function setEnabled(enabled) {
  _enabled = !!enabled;
  storage.setMeshEnabled(_enabled);
  if (_enabled) {
    _start();
  } else {
    _stop();
  }
  _emitStatus();
}

/** @returns {boolean} */
export function isEnabled() { return _enabled; }

/** @returns {string} The local peer ID */
export function getPeerId() { return _peerId; }

/**
 * Broadcast a command to all connected peers.
 * @param {string} action — command type (e.g., 'cellUpdate', 'taskAssign')
 * @param {Object} payload — action-specific data
 * @returns {Object} The full command object
 */
export function broadcast(action, payload = {}) {
  if (!_enabled) return null;
  const cmd = _makeCommand(action, payload);
  _logCommand(cmd);
  _broadcastRaw(cmd);
  return cmd;
}

/**
 * Send a command to a specific peer.
 * @param {string} targetPeerId
 * @param {string} action
 * @param {Object} payload
 * @returns {Object|null}
 */
export function sendTo(targetPeerId, action, payload = {}) {
  if (!_enabled) return null;
  const cmd = _makeCommand(action, payload);
  cmd.to = targetPeerId;
  _logCommand(cmd);
  _sendToRaw(targetPeerId, cmd);
  return cmd;
}

/**
 * Register a handler for a specific command action.
 * @param {string} action
 * @param {(command: Object) => void} handler
 */
export function onCommand(action, handler) {
  if (!_commandHandlers.has(action)) {
    _commandHandlers.set(action, new Set());
  }
  _commandHandlers.get(action).add(handler);
}

/**
 * Un-register a command handler.
 * @param {string} action
 * @param {(command: Object) => void} handler
 */
export function offCommand(action, handler) {
  const set = _commandHandlers.get(action);
  if (set) set.delete(handler);
}

/**
 * Listen for mesh status changes.
 * @param {(status: Object) => void} fn
 */
export function onStatus(fn) { _statusListeners.add(fn); }
export function offStatus(fn) { _statusListeners.delete(fn); }

/**
 * Listen for peer list changes.
 * @param {(peers: Map) => void} fn
 */
export function onPeersChanged(fn) { _peerListeners.add(fn); }
export function offPeersChanged(fn) { _peerListeners.delete(fn); }

/**
 * Get the current peer list.
 * @returns {Map<string, {name: string, channel: string, lastSeen: number, role: string}>}
 */
export function getPeers() { return new Map(_peers); }

/**
 * Get mesh status summary.
 * @returns {{ enabled: boolean, peerId: string, peerCount: number, state: string }}
 */
export function getStatus() {
  return {
    enabled: _enabled,
    peerId: _peerId,
    peerCount: _peers.size,
    state: !_enabled ? 'disabled' : _peers.size > 0 ? 'connected' : 'listening',
  };
}

/**
 * Get the command log (for debugging/inspection).
 * @returns {Array<Object>}
 */
export function getCommandLog() {
  return Array.from(_commandLog.values());
}

/** Tear down the mesh completely. */
export function destroy() {
  _stop();
  _commandHandlers.clear();
  _statusListeners.clear();
  _peerListeners.clear();
}

/* ---------- Lifecycle ---------- */

function _start() {
  if (_bc) return; // Already running

  // BroadcastChannel for same-origin tabs
  _bc = new BroadcastChannel(BC_CHANNEL);
  _bc.onmessage = (e) => _onBCMessage(e.data);

  // Announce presence
  _bc.postMessage({ type: 'mesh:announce', peerId: _peerId, name: _displayName, ts: Date.now() });

  // Start heartbeat
  const hbInterval = storage.getMeshHeartbeat();
  _heartTimer = setInterval(() => _heartbeat(), hbInterval);

  // Start pruning dead peers
  _pruneTimer = setInterval(() => _prunePeers(), PEER_TTL / 2);

  _emitStatus();
}

function _stop() {
  // Announce departure
  if (_bc) {
    try { _bc.postMessage({ type: 'mesh:leave', peerId: _peerId }); } catch {}
    _bc.close();
    _bc = null;
  }

  clearInterval(_heartTimer);
  clearInterval(_pruneTimer);
  _heartTimer = null;
  _pruneTimer = null;

  // Close all RTC connections
  for (const [id] of _rtcPeers) _closeRtcPeer(id);
  _rtcPeers.clear();
  _peers.clear();
  _commandLog.clear();

  _emitStatus();
  _emitPeers();
}

/* ---------- BroadcastChannel handling ---------- */

function _onBCMessage(data) {
  if (!data || data.peerId === _peerId) return;

  switch (data.type) {
    case 'mesh:announce': {
      _peers.set(data.peerId, {
        name: data.name,
        channel: 'local',
        lastSeen: data.ts || Date.now(),
        role: data.role || 'peer',
      });
      // Respond with welcome so the announcer knows about us
      _bc.postMessage({
        type: 'mesh:welcome',
        peerId: _peerId,
        name: _displayName,
        to: data.peerId,
        ts: Date.now(),
      });
      _emitPeers();
      _emitStatus();
      // Initiate WebRTC if applicable
      _maybeInitiateRtc(data.peerId);
      break;
    }
    case 'mesh:welcome': {
      if (data.to !== _peerId) return;
      _peers.set(data.peerId, {
        name: data.name,
        channel: 'local',
        lastSeen: data.ts || Date.now(),
        role: data.role || 'peer',
      });
      _emitPeers();
      _emitStatus();
      _maybeInitiateRtc(data.peerId);
      break;
    }
    case 'mesh:heartbeat': {
      const p = _peers.get(data.peerId);
      if (p) {
        p.lastSeen = data.ts || Date.now();
        p.name = data.name || p.name;
      } else {
        _peers.set(data.peerId, {
          name: data.name || 'Peer',
          channel: 'local',
          lastSeen: data.ts || Date.now(),
          role: data.role || 'peer',
        });
        _emitPeers();
      }
      break;
    }
    case 'mesh:leave': {
      _peers.delete(data.peerId);
      _closeRtcPeer(data.peerId);
      _emitPeers();
      _emitStatus();
      break;
    }
    case 'mesh:command': {
      _handleIncomingCommand(data.command);
      break;
    }
    case 'mesh:rtc-offer':
    case 'mesh:rtc-answer':
    case 'mesh:rtc-ice': {
      if (data.to === _peerId) _handleRtcSignal(data);
      break;
    }
  }
}

/* ---------- Heartbeat ---------- */

function _heartbeat() {
  if (!_bc) return;
  _bc.postMessage({
    type: 'mesh:heartbeat',
    peerId: _peerId,
    name: _displayName,
    ts: Date.now(),
  });
}

/* ---------- Peer pruning ---------- */

function _prunePeers() {
  const now = Date.now();
  let changed = false;
  for (const [id, p] of _peers) {
    if (now - p.lastSeen > PEER_TTL) {
      _peers.delete(id);
      _closeRtcPeer(id);
      changed = true;
    }
  }
  if (changed) {
    _emitPeers();
    _emitStatus();
  }
}

/* ---------- Command protocol ---------- */

function _makeCommand(action, payload) {
  return {
    id: crypto.randomUUID(),
    action,
    timestamp: Date.now(),
    from: _peerId,
    payload,
  };
}

function _logCommand(cmd) {
  _commandLog.set(cmd.id, { action: cmd.action, timestamp: cmd.timestamp, from: cmd.from });
  // Trim old entries
  if (_commandLog.size > MAX_COMMAND_LOG) {
    const it = _commandLog.keys();
    for (let i = 0; i < _commandLog.size - MAX_COMMAND_LOG; i++) {
      _commandLog.delete(it.next().value);
    }
  }
}

function _handleIncomingCommand(cmd) {
  if (!cmd || !cmd.id || !cmd.action) return;
  // Dedup — skip if already seen
  if (_commandLog.has(cmd.id)) return;
  // Skip if targeted at someone else
  if (cmd.to && cmd.to !== _peerId) return;

  _logCommand(cmd);

  const handlers = _commandHandlers.get(cmd.action);
  if (handlers) {
    for (const fn of handlers) {
      try { fn(cmd); } catch (err) {
        console.warn('[mesh] Command handler error:', err);
      }
    }
  }

  // Also notify wildcard handlers
  const wildcardHandlers = _commandHandlers.get('*');
  if (wildcardHandlers) {
    for (const fn of wildcardHandlers) {
      try { fn(cmd); } catch {}
    }
  }
}

/* ---------- Command broadcasting ---------- */

function _broadcastRaw(cmd) {
  // Via BroadcastChannel
  if (_bc) {
    _bc.postMessage({ type: 'mesh:command', peerId: _peerId, command: cmd });
  }
  // Via all open DataChannels
  const msg = JSON.stringify({ type: 'mesh:command', command: cmd });
  for (const [, r] of _rtcPeers) {
    if (r.dc?.readyState === 'open') {
      try { r.dc.send(msg); } catch {}
    }
  }
}

function _sendToRaw(targetPeerId, cmd) {
  // Try DataChannel first
  const r = _rtcPeers.get(targetPeerId);
  if (r?.dc?.readyState === 'open') {
    try {
      r.dc.send(JSON.stringify({ type: 'mesh:command', command: cmd }));
      return;
    } catch {}
  }
  // Fall back to BroadcastChannel (recipient filters by cmd.to)
  if (_bc) {
    _bc.postMessage({ type: 'mesh:command', peerId: _peerId, command: cmd });
  }
}

/* ---------- WebRTC peer management ---------- */

function _getIceServers() {
  const custom = storage.getMeshIceServers();
  return custom.length > 0 ? custom : DEFAULT_ICE;
}

function _maybeInitiateRtc(remotePeerId) {
  if (_rtcPeers.has(remotePeerId)) return;
  const maxPeers = storage.getMeshMaxPeers();
  if (_rtcPeers.size >= maxPeers) return;

  // Deterministic initiator: lower peerId starts the connection
  if (_peerId < remotePeerId) {
    _createOffer(remotePeerId);
  }
}

async function _createOffer(remotePeerId) {
  const pc = new RTCPeerConnection({ iceServers: _getIceServers() });
  const dc = pc.createDataChannel('waymark-mesh', { ordered: true });
  const entry = { pc, dc, state: 'offering' };
  _rtcPeers.set(remotePeerId, entry);

  _wireRtcPeer(remotePeerId, pc);
  _wireDataChannel(remotePeerId, dc);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await _iceReady(pc);

    if (_bc) {
      _bc.postMessage({
        type: 'mesh:rtc-offer',
        peerId: _peerId,
        to: remotePeerId,
        sdp: pc.localDescription.sdp,
      });
    }
  } catch {
    _closeRtcPeer(remotePeerId);
  }
}

async function _handleRtcSignal(data) {
  switch (data.type) {
    case 'mesh:rtc-offer': {
      _closeRtcPeer(data.peerId); // Clean up any existing connection
      const pc = new RTCPeerConnection({ iceServers: _getIceServers() });
      const entry = { pc, dc: null, state: 'answering' };
      _rtcPeers.set(data.peerId, entry);

      pc.ondatachannel = (e) => {
        entry.dc = e.channel;
        _wireDataChannel(data.peerId, e.channel);
      };

      _wireRtcPeer(data.peerId, pc);

      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await _iceReady(pc);

        if (_bc) {
          _bc.postMessage({
            type: 'mesh:rtc-answer',
            peerId: _peerId,
            to: data.peerId,
            sdp: pc.localDescription.sdp,
          });
        }
      } catch {
        _closeRtcPeer(data.peerId);
      }
      break;
    }
    case 'mesh:rtc-answer': {
      const r = _rtcPeers.get(data.peerId);
      if (!r?.pc) return;
      try {
        await r.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        r.state = 'connected';
      } catch {
        _closeRtcPeer(data.peerId);
      }
      break;
    }
    case 'mesh:rtc-ice': {
      const r = _rtcPeers.get(data.peerId);
      if (!r?.pc) return;
      try { await r.pc.addIceCandidate(data.candidate); } catch {}
      break;
    }
  }
}

function _wireRtcPeer(remotePeerId, pc) {
  pc.onicecandidate = (e) => {
    if (e.candidate && _bc) {
      _bc.postMessage({
        type: 'mesh:rtc-ice',
        peerId: _peerId,
        to: remotePeerId,
        candidate: e.candidate,
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    if (s === 'failed' || s === 'closed') {
      _closeRtcPeer(remotePeerId);
      const p = _peers.get(remotePeerId);
      if (p && p.channel === 'rtc') {
        p.channel = 'local';
        _emitPeers();
      }
    }
  };
}

function _wireDataChannel(remotePeerId, dc) {
  dc.onopen = () => {
    const p = _peers.get(remotePeerId);
    if (p) {
      p.channel = 'rtc';
    } else {
      _peers.set(remotePeerId, {
        name: 'Peer',
        channel: 'rtc',
        lastSeen: Date.now(),
        role: 'peer',
      });
    }
    _emitPeers();
    _emitStatus();

    // Send a hello so the remote knows our name
    dc.send(JSON.stringify({
      type: 'mesh:hello',
      peerId: _peerId,
      name: _displayName,
    }));
  };

  dc.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'mesh:hello') {
        const p = _peers.get(msg.peerId);
        if (p) p.name = msg.name;
        _emitPeers();
      } else if (msg.type === 'mesh:command') {
        _handleIncomingCommand(msg.command);
      }
    } catch {}
  };

  dc.onclose = () => {
    const p = _peers.get(remotePeerId);
    if (p && p.channel === 'rtc') {
      p.channel = 'local';
      _emitPeers();
    }
  };
}

function _closeRtcPeer(peerId) {
  const r = _rtcPeers.get(peerId);
  if (!r) return;
  try { r.dc?.close(); } catch {}
  try { r.pc?.close(); } catch {}
  _rtcPeers.delete(peerId);
}

function _iceReady(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const t = setTimeout(resolve, ICE_GATHER_TIMEOUT);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    };
  });
}

/* ---------- Event emitters ---------- */

function _emitStatus() {
  const status = getStatus();
  for (const fn of _statusListeners) {
    try { fn(status); } catch {}
  }
}

function _emitPeers() {
  const peers = getPeers();
  for (const fn of _peerListeners) {
    try { fn(peers); } catch {}
  }
}

/* ---------- Pure helpers (exported for unit testing) ---------- */

/**
 * Create a command object (pure — no side effects).
 * @param {string} peerId
 * @param {string} action
 * @param {Object} payload
 * @returns {Object}
 */
export function createCommand(peerId, action, payload = {}) {
  return {
    id: crypto.randomUUID(),
    action,
    timestamp: Date.now(),
    from: peerId,
    payload,
  };
}

/**
 * Check whether a command ID is already in a log (Map).
 * @param {Map} log
 * @param {string} commandId
 * @returns {boolean}
 */
export function isDuplicate(log, commandId) {
  return log.has(commandId);
}

/**
 * Validate a command object shape.
 * @param {Object} cmd
 * @returns {boolean}
 */
export function isValidCommand(cmd) {
  return !!(cmd && typeof cmd.id === 'string' && typeof cmd.action === 'string'
    && typeof cmd.timestamp === 'number' && typeof cmd.from === 'string');
}

/**
 * Trim a command log to a maximum size, removing oldest entries.
 * @param {Map} log
 * @param {number} maxSize
 * @returns {Map} The same Map, mutated
 */
export function trimCommandLog(log, maxSize) {
  if (log.size <= maxSize) return log;
  const deleteCount = log.size - maxSize;
  const it = log.keys();
  for (let i = 0; i < deleteCount; i++) {
    log.delete(it.next().value);
  }
  return log;
}
