/* ============================================================
   wayboard.js — Unified Wayboard home: widgets, Wayside social,
   and the 50 selectable layout architectures (mode-1 … mode-50).
   ============================================================ */

import { el, showToast } from './ui.js';
import { api } from './api-client.js';
import * as userData from './user-data.js';
import * as collab from './collab.js';
import { TEMPLATES } from './templates/index.js';

/* ---------- 50 architecture names (for the Profile selector) ---------- */

export const MODE_NAMES = {
  1: 'Markup Command Center (Classic 3-Col)', 2: 'Bento Grid + Story Pill Markers', 3: 'Top Multiplayer Social Pill', 4: 'Guild Left-Dock (Discord Style)',
  5: 'Spatial Glass + Floating Bottom Dock', 6: 'Warm Editorial Daylight', 7: 'Dual-Column Split', 8: 'Linear Timeline',
  9: 'Infinite Dot-Grid Tactile Pinboard', 10: 'AR Field Engineer HUD', 11: 'Bottom Comms Utility Tray', 12: 'Visual Gallery Grid',
  13: 'AI-First Prompt Stream', 14: '3D World Stage (Floorplan IS Background)', 15: 'Orbital Node Map', 16: 'Multiplayer Tavern Rooms',
  17: 'BOOX E-Ink Paper Tablet', 18: 'Horizontal Time River', 19: 'Floating OS Window Manager', 20: 'Sheet Matrix Control Plane',
  21: 'VS Code / Cursor 4-Pane IDE Split', 22: 'Apple CoverFlow 3D Perspective Carousel', 23: 'AutoCAD / Revit 4-Viewport Station',
  24: 'Swiss International Typographic Grid', 25: 'Arc Browser Floating Glass Frame', 26: 'Kanban 4-Column Vertical Swimlanes',
  27: 'Circular Radar / Sonar Concentric Station', 28: 'Isometric 3D Pitched Tabletop Board', 29: 'Dynamic Island Top Pill',
  30: 'Obsidian Bi-Directional Graph', 31: 'Node-RED / ComfyUI Patch-Cord Canvas', 32: 'Newspaper Multi-Column Broadsheet',
  33: 'Video-First 50/50 Split', 34: 'Hyprland / i3wm Tiling Window Manager', 35: 'Interactive Horizontal Accordion Slices',
  36: 'Smart Glasses Peripheral AR HUD', 37: 'Architectural Blueprint Sheet + Title Block', 38: '4-Quadrant Compass Rose',
  39: 'Split-Level Mezzanine', 40: 'Zen Spotlight Focus Mode', 41: 'Jupyter / Observable Notebook Cells',
  42: 'Teenage Engineering OP-1 Tactile Synth', 43: '3-Monitor Curved Ultrawide Cockpit', 44: 'Staggered Masonry Waterfall Grid',
  45: 'Subway / Metro Transit Line Topology', 46: 'Floating Organic Glass Orbs', 47: 'Dual-Brain Reverse Split',
  48: 'Detective Corkboard + Polaroids + Red String', 49: 'SpaceX / Bloomberg 5-Column Telemetry', 50: 'Spotlight Command-First Zero-Chrome',
};

/** Grouping used by the Profile selector. */
export const MODE_GROUPS = [
  { label: '1–20 Core & Unchained', range: [1, 20] },
  { label: '21–35 Spatial Architectures', range: [21, 35] },
  { label: '36–50 Experimental Mechanics', range: [36, 50] },
];

/* ---------- Mode application ---------- */

/**
 * Apply a home layout architecture to the Wayboard root.
 * @param {number} mode 1–50
 */
export function applyHomeMode(mode) {
  const root = document.getElementById('wayboard-root');
  if (!root) return;
  const n = (mode >= 1 && mode <= 50) ? mode : 1;
  root.className = `wayboard-root mode-${n}`;
}

/* ---------- Wayboard render ---------- */

let _navigate = null;
let _openExamples = null;

/**
 * One-time wiring of Wayboard navigation callbacks.
 * @param {{ navigate: Function, openExamples?: Function }} deps
 */
export function initWayboard(deps = {}) {
  _navigate = deps.navigate || null;
  _openExamples = deps.openExamples || null;
}

/**
 * Render the full Wayboard: status badges, dashboard widgets and the Wayside.
 * Pinned/recent markers are rendered by app.js into the existing containers.
 * @param {{ userName?: string }} [opts]
 */
export function renderWayboard(opts = {}) {
  applyHomeMode(userData.getHomeTemplateMode());
  renderStatusBadges();
  renderWidgets();
  renderWayside().catch(() => {});

  const addWidget = document.getElementById('wayboard-add-widget');
  if (addWidget && !addWidget._wired) {
    addWidget._wired = true;
    addWidget.addEventListener('click', () => {
      if (_openExamples) _openExamples();
      else if (_navigate) _navigate('explorer');
    });
  }
}

function renderStatusBadges() {
  const host = document.getElementById('home-status-badges');
  if (!host) return;
  host.innerHTML = '';
  const ledgers = userData.getShareLedgers().length;
  host.append(
    el('span', { className: 'badge' }, [`🔒 ${ledgers} Share Ledger${ledgers !== 1 ? 's' : ''}`]),
    el('span', { className: 'badge blue' }, ['✨ Gemini Enrich: ON']),
  );
}

/* ---------- Dashboard widgets ---------- */

function widgetCard(className, children) {
  return el('div', { className: `widget ${className}` }, children);
}

function renderWidgets() {
  const grid = document.getElementById('wayboard-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const go = (type, id, name) => () => { if (_navigate) _navigate(type, id, name); };

  // Hero: live floorplan stage with the Gemini-enrich + seed-lock pipeline.
  grid.append(widgetCard('hero', [
    el('div', { className: 'widget-head' }, [
      el('b', {}, ['📐 Floorplan Live Stage']),
      el('span', { className: 'badge' }, ['Strict Geometry + Seed Lock']),
    ]),
    el('div', { className: 'viewport-box' }, [
      el('div', { style: 'font-size:28px;margin-bottom:4px;' }, ['🏗️']),
      el('div', {}, ['Interactive 3D / Photoreal Stage']),
      el('small', {}, ['Gemini Enrich locks walls, doors & fixtures to the drawing JSON']),
    ]),
    el('div', { className: 'widget-foot' }, [
      el('span', { style: 'font-size:10px;color:var(--muted);' }, ['Zero-Hallucination Pipeline']),
      el('button', { className: 'btn', on: { click: go('sheet', 'sheet-075', 'House Layout') } }, ['✨ Gemini Enrich & Render']),
    ]),
  ]));

  // Interactive to-do checklist widget.
  grid.append(widgetCard('tall', [
    el('b', {}, ['✔️ To-Do Checklist']),
    el('div', { className: 'widget-list' }, [
      el('label', {}, [el('input', { type: 'checkbox', checked: 'checked' }), ' Save OpenAI Key to Vault Sheet']),
      el('label', {}, [el('input', { type: 'checkbox' }), ' Auto-Provision Contact Share Sheet']),
      el('label', {}, [el('input', { type: 'checkbox' }), ' Pick a Home Layout in Profile']),
    ]),
    el('button', { className: 'btn', on: { click: go('sheet', 'sheet-001', 'Checklist') } }, ['Open checklist →']),
  ]));

  // Calorie counter widget.
  grid.append(widgetCard('', [
    el('b', {}, ['🔥 Calorie Counter']),
    el('div', { style: 'font-size:22px;font-weight:800;color:var(--green);margin:4px 0;' }, ['1,840 ', el('span', { style: 'font-size:10px;color:var(--muted);font-weight:400;' }, ['/ 2,400 kcal'])]),
    el('button', { className: 'btn', on: { click: go('sheet', 'sheet-072', 'Calorie Counter') } }, ['Log a meal →']),
  ]));

  // AI agent widget.
  grid.append(widgetCard('', [
    el('b', {}, ['🔀 AI Agent']),
    el('div', { style: 'font-size:10px;color:var(--accent);margin:4px 0;padding:6px;background:rgba(0,0,0,0.2);border-radius:5px;' }, ['Drawing ➔ Gemini Enrich ➔ Seed Render']),
    el('button', { className: 'btn', on: { click: () => { if (_navigate) _navigate('agent'); } } }, ['Ask AI →']),
  ]));
}

/* ---------- The Wayside (social) ---------- */

let _activeTarget = null; // { group? , contactEmail? , label }

/**
 * Discover Wayfarer Crews (contact groups) and contacts from the user's
 * Contacts Waymarks (pinned/recent).
 * @returns {Promise<{ crews: Array<{name:string}>, people: Array<{name:string, email:string, group:string}> }>}
 */
async function discoverCrews() {
  const pool = [...userData.getPinnedSheets(), ...userData.getRecentSheets()];
  const seen = new Set();
  const books = pool.filter(s => s && s.templateKey === 'contacts' && !seen.has(s.id) && seen.add(s.id));
  const crews = new Map();
  const people = [];
  const emailSeen = new Set();
  for (const book of books) {
    try {
      const data = await api.sheets.getSpreadsheet(book.id);
      const tab = (data.tabs && data.tabs[0]) || null;
      const values = (tab && tab.values) || data.values || [];
      if (values.length < 2) continue;
      const lower = (values[0] || []).map(h => (h || '').toLowerCase().trim());
      const cols = TEMPLATES.contacts.columns(lower);
      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        const name = (cols.name >= 0 ? row[cols.name] : '') || '';
        const email = ((cols.email >= 0 ? row[cols.email] : '') || '').trim();
        const group = ((cols.group >= 0 ? row[cols.group] : '') || '').trim();
        if (group) crews.set(group, true);
        if (email && !emailSeen.has(email.toLowerCase())) {
          emailSeen.add(email.toLowerCase());
          people.push({ name: name.trim() || email, email, group });
        }
      }
    } catch { /* skip */ }
  }
  return { crews: [...crews.keys()].map(name => ({ name })), people };
}

async function renderWayside() {
  const host = document.getElementById('home-wayside');
  if (!host) return;
  host.innerHTML = '';

  host.append(el('div', { className: 'wayside-head' }, [
    el('b', {}, ['🧭 The Wayside']),
    el('span', { className: 'wayside-webrtc' }, ['● WebRTC Ready']),
  ]));

  const { crews, people } = await discoverCrews();

  // Wayfarer Crews
  const crewsBlock = el('div', { className: 'crews-block' }, [
    el('div', { className: 'wayside-label' }, ['WAYFARER CREWS (SHARE LEDGERS)']),
  ]);
  if (!crews.length) {
    crewsBlock.append(el('div', { className: 'wayside-empty' }, ['Add a Contacts Waymark with a Group column to form crews.']));
  }
  for (const crew of crews) {
    const ledger = userData.getShareLedgerFor(`group:${crew.name.toLowerCase()}`);
    const row = el('div', { className: 'crew-row', dataset: { group: crew.name } }, [
      el('span', {}, [`🏠 ${crew.name}`]),
      ledger
        ? el('a', { className: 'share-chip', href: `#/sheet/${ledger.sheetId}` }, ['🔗 Sheet ↗'])
        : el('span', { className: 'share-chip', title: 'Provisioned on first share' }, ['🔗 New']),
    ]);
    row.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      selectTarget({ group: crew.name, label: crew.name }, host);
    });
    crewsBlock.append(row);
  }
  host.append(crewsBlock);

  // Online Wayfarers
  const onlineBlock = el('div', {}, [
    el('div', { className: 'wayside-label' }, ['ONLINE WAYFARERS']),
  ]);
  const avatarRow = el('div', { className: 'avatar-row' });
  for (const p of people.slice(0, 8)) {
    const initials = (p.name || p.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
    const av = el('div', { className: 'avatar', title: `${p.name} (${p.email})` }, [initials || '?']);
    av.addEventListener('click', () => selectTarget({ contactEmail: p.email, label: p.name }, host));
    avatarRow.append(av);
  }
  if (!people.length) avatarRow.append(el('div', { className: 'wayside-empty' }, ['No wayfarers yet.']));
  onlineBlock.append(avatarRow);
  host.append(onlineBlock);

  // Chat box
  const chatBox = el('div', { className: 'chat-box' }, [
    el('div', { className: 'chat-box-head' }, [
      el('b', { id: 'wayside-crew-title' }, ['💬 Wayside']),
      el('div', { className: 'chat-box-actions' }, [
        el('button', { className: 'btn', id: 'wayside-call-btn', title: 'Start a WebRTC call' }, ['📹 Call']),
        el('button', { className: 'btn btn-muted', id: 'wayside-sheet-btn', title: 'Open the social sheet' }, ['🔗 Sheet']),
      ]),
    ]),
    el('div', { className: 'chat-sheet-line', id: 'wayside-sheet-line' }, ['Pick a crew or wayfarer to chat']),
    el('div', { className: 'chat-log', id: 'wayside-chat-log' }),
    el('input', {
      type: 'text', className: 'chat-input', id: 'wayside-chat-input',
      placeholder: 'Send a wave…',
      on: { keydown: (e) => { if (e.key === 'Enter') sendWaysideChat(); } },
    }),
  ]);
  host.append(chatBox);

  const callBtn = chatBox.querySelector('#wayside-call-btn');
  callBtn.addEventListener('click', () => startCall());
  const sheetBtn = chatBox.querySelector('#wayside-sheet-btn');
  sheetBtn.addEventListener('click', () => openSocialSheet());

  // Auto-select the first crew / wayfarer.
  if (crews.length) selectTarget({ group: crews[0].name, label: crews[0].name }, host);
  else if (people.length) selectTarget({ contactEmail: people[0].email, label: people[0].name }, host);
}

async function selectTarget(target, host) {
  _activeTarget = target;
  const title = host.querySelector('#wayside-crew-title');
  if (title) title.textContent = `💬 ${target.label}`;
  host.querySelectorAll('.crew-row').forEach(r => r.classList.toggle('active', r.dataset.group === target.group));

  // Load existing chat/presence WITHOUT provisioning a ledger (viewing is read-only).
  // Presence is only published once a ledger already exists for this target
  // (i.e. after the first share), so merely opening Home never creates sheets.
  try {
    const key = target.group ? `group:${target.group.toLowerCase()}` : `contact:${(target.contactEmail || '').toLowerCase()}`;
    const ledger = userData.getShareLedgerFor(key);
    const sheetLine = host.querySelector('#wayside-sheet-line');
    if (sheetLine) sheetLine.textContent = ledger ? `Linked: ${ledger.sheetId}` : 'Linked on first share';
    if (ledger) {
      await collab.publishPresence(target, { status: 'online', activeWaymarkId: 'home' });
    }
    await refreshWaysideChat();
    await refreshPresenceRings(host);
  } catch { /* social is best-effort */ }
}

async function refreshWaysideChat() {
  const log = document.getElementById('wayside-chat-log');
  if (!log || !_activeTarget) return;
  try {
    const me = collab.currentEmail();
    const messages = await collab.readChat(_activeTarget);
    log.innerHTML = '';
    for (const m of messages.slice(-30)) {
      const who = (m.sender || '').toLowerCase() === me ? 'You' : (m.sender || '').split('@')[0];
      log.append(el('div', { className: (who === 'You' ? 'chat-self' : 'chat-peer') }, [
        el('b', {}, [`${who}: `]), m.text,
      ]));
    }
    log.scrollTop = log.scrollHeight;
  } catch { /* ignore */ }
}

async function refreshPresenceRings(host) {
  if (!_activeTarget) return;
  try {
    const presence = await collab.readPresence(_activeTarget);
    const byEmail = new Map(presence.map(p => [p.email, p.status]));
    host.querySelectorAll('.avatar').forEach(av => {
      const title = (av.getAttribute('title') || '').toLowerCase();
      const m = title.match(/\(([^)]+)\)/);
      const email = m ? m[1] : '';
      const status = byEmail.get(email);
      av.classList.remove('avatar-online', 'avatar-away', 'avatar-offline');
      if (status) av.classList.add(`avatar-${status}`);
    });
  } catch { /* ignore */ }
}

async function sendWaysideChat() {
  const input = document.getElementById('wayside-chat-input');
  if (!input || !input.value.trim() || !_activeTarget) return;
  const text = input.value.trim();
  input.value = '';
  try {
    await collab.sendChat(_activeTarget, text);
    await refreshWaysideChat();
  } catch (err) {
    showToast(`Could not send: ${err.message}`, 'error');
  }
}

async function startCall() {
  if (!_activeTarget) { showToast('Pick a crew or wayfarer first', 'info'); return; }
  try {
    const target = await collab.getSignalingTarget(_activeTarget);
    showToast(`📹 Call ready — signaling on ${target.tab} of the shared ledger`, 'success');
  } catch (err) {
    showToast(`Could not start call: ${err.message}`, 'error');
  }
}

async function openSocialSheet() {
  if (!_activeTarget) return;
  try {
    const { sheetId } = await collab.getSocialTarget(_activeTarget);
    window.location.hash = `#/sheet/${sheetId}`;
  } catch (err) {
    showToast(`Could not open sheet: ${err.message}`, 'error');
  }
}
