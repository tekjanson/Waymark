/* ============================================================
   mesh-config.js — Settings UI for Browser Mesh features

   Builds the mesh configuration section inside the settings
   modal. All DOM is constructed via el(). Settings are persisted
   via storage.js. Mesh features are opted-out by default.
   ============================================================ */

import { el, showToast } from './ui.js';
import * as storage from './storage.js';
import * as mesh from './mesh.js';

/* ---------- State ---------- */

let _container = null;
let _detailsContainer = null;
let _statusEl = null;
let _peerListEl = null;

/* ---------- Public API ---------- */

/**
 * Build and return the mesh settings section DOM.
 * Call once during settings modal init.
 * @returns {HTMLElement}
 */
export function buildMeshSettingsSection() {
  _container = el('div', { id: 'settings-mesh-section', className: 'settings-section' }, [
    el('h4', { className: 'settings-section-title' }, ['🌐 Browser Mesh']),
    el('p', { className: 'mesh-config-desc' }, [
      'Enable peer-to-peer connections between browser tabs to share work, ',
      'collaborate in real-time, and distribute tasks across multiple browsers. ',
      'When disabled, no WebRTC connections are made and no data is sent or received.',
    ]),
    _buildEnableToggle(),
  ]);

  _detailsContainer = el('div', { className: 'mesh-config-details hidden' });
  _container.append(_detailsContainer);

  _buildDetails();
  _syncUI();

  // Listen for mesh status changes
  mesh.onStatus(_onStatusChange);
  mesh.onPeersChanged(_onPeersChange);

  return _container;
}

/**
 * Synchronise the UI with current storage state.
 * Call when the settings modal is opened.
 */
export function syncMeshSettings() {
  _syncUI();
}

/**
 * Clean up listeners.
 */
export function destroyMeshSettings() {
  mesh.offStatus(_onStatusChange);
  mesh.offPeersChanged(_onPeersChange);
}

/* ---------- UI builders ---------- */

function _buildEnableToggle() {
  const toggle = el('input', {
    type: 'checkbox',
    id: 'settings-mesh-enabled',
    className: 'settings-toggle',
  });

  toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    mesh.setEnabled(enabled);
    _detailsContainer.classList.toggle('hidden', !enabled);
    if (enabled) {
      showToast('Browser Mesh enabled — listening for peers', 'success');
    } else {
      showToast('Browser Mesh disabled — all connections closed', 'info');
    }
    _syncUI();
  });

  return el('label', { className: 'settings-row' }, [
    el('span', { className: 'settings-label' }, ['Enable Mesh']),
    toggle,
  ]);
}

function _buildDetails() {
  // Status indicator
  _statusEl = el('div', { className: 'mesh-config-status' }, [
    el('span', { className: 'mesh-status-dot' }),
    el('span', { className: 'mesh-status-text' }, ['Disabled']),
  ]);

  // Peer list
  _peerListEl = el('div', { className: 'mesh-config-peers' }, [
    el('span', { className: 'mesh-config-peers-label' }, ['Connected peers: 0']),
  ]);

  // Connection settings
  const maxPeersInput = el('input', {
    type: 'number',
    id: 'settings-mesh-max-peers',
    className: 'settings-input mesh-config-input',
    min: '1',
    max: '50',
  });
  maxPeersInput.addEventListener('change', () => {
    storage.setMeshMaxPeers(parseInt(maxPeersInput.value, 10));
  });

  const timeoutInput = el('input', {
    type: 'number',
    id: 'settings-mesh-timeout',
    className: 'settings-input mesh-config-input',
    min: '5000',
    max: '120000',
    step: '1000',
  });
  timeoutInput.addEventListener('change', () => {
    storage.setMeshTimeout(parseInt(timeoutInput.value, 10));
  });

  const heartbeatInput = el('input', {
    type: 'number',
    id: 'settings-mesh-heartbeat',
    className: 'settings-input mesh-config-input',
    min: '5000',
    max: '60000',
    step: '1000',
  });
  heartbeatInput.addEventListener('change', () => {
    storage.setMeshHeartbeat(parseInt(heartbeatInput.value, 10));
  });

  // ICE servers
  const iceTextarea = el('textarea', {
    id: 'settings-mesh-ice',
    className: 'settings-input mesh-config-textarea',
    rows: '3',
    placeholder: 'stun:stun.l.google.com:19302\nstun:stun1.l.google.com:19302',
    spellcheck: 'false',
  });
  iceTextarea.addEventListener('change', () => {
    const lines = iceTextarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    const servers = lines.map(url => {
      if (url.startsWith('{')) {
        try { return JSON.parse(url); } catch { /* fall through */ }
      }
      return { urls: url };
    });
    storage.setMeshIceServers(servers);
    showToast('ICE servers updated', 'success');
  });

  // Sub-feature toggles
  const taskQueueToggle = _buildSubToggle(
    'settings-mesh-task-queue',
    'Distributed Task Queue',
    'Allow this browser to participate in distributed task execution.',
    storage.getMeshTaskQueueEnabled,
    storage.setMeshTaskQueueEnabled,
  );

  const crdtToggle = _buildSubToggle(
    'settings-mesh-crdt',
    'CRDT Collaborative Editing',
    'Enable real-time collaborative editing with conflict-free merging.',
    storage.getMeshCrdtEnabled,
    storage.setMeshCrdtEnabled,
  );

  const evalFarmToggle = _buildSubToggle(
    'settings-mesh-eval-farm',
    'Distributed Eval Farm',
    'Share AI evaluation workload across connected browsers.',
    storage.getMeshEvalFarmEnabled,
    storage.setMeshEvalFarmEnabled,
  );

  const swarmToggle = _buildSubToggle(
    'settings-mesh-swarm',
    'Headless Worker Swarm',
    'Accept connections from headless Playwright browser workers.',
    storage.getMeshSwarmEnabled,
    storage.setMeshSwarmEnabled,
  );

  // Worker concurrency
  const concurrencyInput = el('input', {
    type: 'number',
    id: 'settings-mesh-concurrency',
    className: 'settings-input mesh-config-input',
    min: '1',
    max: '20',
  });
  concurrencyInput.addEventListener('change', () => {
    storage.setMeshWorkerConcurrency(parseInt(concurrencyInput.value, 10));
  });

  _detailsContainer.append(
    _statusEl,
    _peerListEl,

    el('h5', { className: 'mesh-config-subhead' }, ['Connection Settings']),

    el('div', { className: 'settings-row' }, [
      el('span', { className: 'settings-label' }, ['Max peers']),
      maxPeersInput,
    ]),
    el('div', { className: 'settings-row' }, [
      el('span', { className: 'settings-label' }, ['Timeout (ms)']),
      timeoutInput,
    ]),
    el('div', { className: 'settings-row' }, [
      el('span', { className: 'settings-label' }, ['Heartbeat (ms)']),
      heartbeatInput,
    ]),

    el('h5', { className: 'mesh-config-subhead' }, ['ICE / STUN / TURN Servers']),
    el('p', { className: 'mesh-config-hint' }, [
      'One server URL per line. Default uses Google STUN. ',
      'For TURN, use JSON: {"urls":"turn:addr","username":"u","credential":"p"}',
    ]),
    iceTextarea,

    el('h5', { className: 'mesh-config-subhead' }, ['Features']),
    taskQueueToggle,
    crdtToggle,
    evalFarmToggle,
    swarmToggle,

    el('h5', { className: 'mesh-config-subhead' }, ['Worker Settings']),
    el('div', { className: 'settings-row' }, [
      el('span', { className: 'settings-label' }, ['Worker concurrency']),
      concurrencyInput,
    ]),
  );
}

function _buildSubToggle(id, label, desc, getter, setter) {
  const toggle = el('input', {
    type: 'checkbox',
    id,
    className: 'settings-toggle',
  });
  toggle.addEventListener('change', () => {
    setter(toggle.checked);
    showToast(`${label} ${toggle.checked ? 'enabled' : 'disabled'}`, 'info');
  });

  return el('label', { className: 'settings-row mesh-config-feature-row' }, [
    el('div', { className: 'mesh-config-feature-label' }, [
      el('span', { className: 'settings-label' }, [label]),
      el('span', { className: 'mesh-config-feature-desc' }, [desc]),
    ]),
    toggle,
  ]);
}

/* ---------- Sync UI with storage ---------- */

function _syncUI() {
  const enabled = storage.getMeshEnabled();

  // Main toggle
  const mainToggle = document.getElementById('settings-mesh-enabled');
  if (mainToggle) mainToggle.checked = enabled;

  // Show/hide details
  if (_detailsContainer) {
    _detailsContainer.classList.toggle('hidden', !enabled);
  }

  // Connection settings
  const maxPeersInput = document.getElementById('settings-mesh-max-peers');
  if (maxPeersInput) maxPeersInput.value = storage.getMeshMaxPeers();

  const timeoutInput = document.getElementById('settings-mesh-timeout');
  if (timeoutInput) timeoutInput.value = storage.getMeshTimeout();

  const heartbeatInput = document.getElementById('settings-mesh-heartbeat');
  if (heartbeatInput) heartbeatInput.value = storage.getMeshHeartbeat();

  // ICE servers
  const iceTextarea = document.getElementById('settings-mesh-ice');
  if (iceTextarea) {
    const servers = storage.getMeshIceServers();
    iceTextarea.value = servers.map(s => {
      if (typeof s === 'string') return s;
      if (s.username || s.credential) return JSON.stringify(s);
      return s.urls || '';
    }).join('\n');
  }

  // Sub-feature toggles
  _syncToggle('settings-mesh-task-queue', storage.getMeshTaskQueueEnabled());
  _syncToggle('settings-mesh-crdt', storage.getMeshCrdtEnabled());
  _syncToggle('settings-mesh-eval-farm', storage.getMeshEvalFarmEnabled());
  _syncToggle('settings-mesh-swarm', storage.getMeshSwarmEnabled());

  // Concurrency
  const concurrencyInput = document.getElementById('settings-mesh-concurrency');
  if (concurrencyInput) concurrencyInput.value = storage.getMeshWorkerConcurrency();

  // Status
  _updateStatus(mesh.getStatus());
  _updatePeerList(mesh.getPeers());
}

function _syncToggle(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
}

/* ---------- Status updates ---------- */

function _onStatusChange(status) {
  _updateStatus(status);
}

function _onPeersChange(peers) {
  _updatePeerList(peers);
}

function _updateStatus(status) {
  if (!_statusEl) return;
  const dot = _statusEl.querySelector('.mesh-status-dot');
  const text = _statusEl.querySelector('.mesh-status-text');
  if (dot) {
    dot.className = 'mesh-status-dot';
    dot.classList.add('mesh-status-' + status.state);
  }
  if (text) {
    const labels = {
      disabled: 'Disabled',
      listening: `Listening (Peer ID: ${status.peerId})`,
      connected: `Connected — ${status.peerCount} peer${status.peerCount !== 1 ? 's' : ''} (ID: ${status.peerId})`,
    };
    text.textContent = labels[status.state] || status.state;
  }
}

function _updatePeerList(peers) {
  if (!_peerListEl) return;
  _peerListEl.innerHTML = '';

  const label = el('span', { className: 'mesh-config-peers-label' }, [
    `Connected peers: ${peers.size}`,
  ]);
  _peerListEl.append(label);

  if (peers.size > 0) {
    const list = el('ul', { className: 'mesh-config-peer-list' });
    for (const [id, p] of peers) {
      list.append(el('li', { className: 'mesh-config-peer-item' }, [
        el('span', { className: 'mesh-config-peer-name' }, [p.name || id]),
        el('span', { className: 'mesh-config-peer-channel' }, [` (${p.channel})`]),
      ]));
    }
    _peerListEl.append(list);
  }
}
