/* ============================================================
   calorie/weight.js — Weight-over-time tracking for the Calorie tracker.

   Weight lives in a dedicated "Weight" tab in the same workbook (row-per-entry,
   AI_LAWS §4.7). A one-time migration seeds it from the profile's current
   weight so existing trackers immediately have a starting data point.

   Everything here is DEFENSIVE: rendering is wrapped so a failure can never
   break the calorie dashboard, and every write is best-effort.
   ============================================================ */

import { el, showToast, readSheetTab, writeSheetTab } from '../shared.js';

export const WEIGHT_TAB = 'Weight';
const WEIGHT_HEADERS = ['Date', 'Weight', 'Unit', 'Notes'];

/* ---------- Data model ---------- */

/** Parse the workbook's Weight tab into typed, date-sorted entries. */
export function parseWeightEntries(tabs) {
  const tab = readSheetTab(tabs, WEIGHT_TAB);
  if (!tab || !Array.isArray(tab.values) || tab.values.length < 2) return [];
  const entries = tab.values.slice(1).map((r) => ({
    date: String((r && r[0]) || '').trim(),
    weight: parseFloat(r && r[1]) || 0,
    unit: String((r && r[2]) || 'kg').trim() || 'kg',
    notes: String((r && r[3]) || '').trim(),
  })).filter((e) => e.weight > 0 && e.date);
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));
  return entries;
}

/** Serialize entries into human-readable rows for the Weight tab. */
function entriesToRows(entries) {
  return [WEIGHT_HEADERS.slice(), ...entries.map((e) => [e.date, String(e.weight), e.unit || 'kg', e.notes || ''])];
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * One-time migration to the new data structure: if the workbook has no Weight
 * tab yet but the profile carries a current weight, seed the tab with that
 * value so existing trackers start with a real data point. Idempotent — a
 * no-op once the Weight tab exists. Mutates the in-memory `tabs` snapshot on
 * success. Returns true only when it actually wrote.
 */
export async function migrateWeightIfNeeded({ sheetId, tabs, profile }) {
  if (!sheetId || !Array.isArray(tabs)) return false;
  if (readSheetTab(tabs, WEIGHT_TAB)) return false;              // already migrated
  const kg = profile && Number(profile.weightKg);
  if (!kg || kg <= 0) return false;                             // nothing to seed
  const imperial = profile && profile.units === 'imperial';
  const unit = imperial ? 'lbs' : 'kg';
  const weight = imperial ? Math.round(kg * 2.2046 * 10) / 10 : Math.round(kg * 10) / 10;
  const rows = entriesToRows([{ date: todayISO(), weight, unit, notes: 'Imported from profile' }]);
  try {
    await writeSheetTab(sheetId, WEIGHT_TAB, rows);
    tabs.push({ title: WEIGHT_TAB, numericSheetId: -1, values: rows });
    return true;
  } catch {
    return false;   // best-effort; the card still offers manual logging
  }
}

/**
 * Record a weigh-in and persist the Weight tab (one entry per day — logging
 * again on the same date replaces it). Creates the tab if it doesn't exist,
 * so manual logging also works as a migration path.
 */
export async function logWeight({ sheetId, tabs, date, weight, unit, notes }) {
  if (!sheetId) { showToast('Open this sheet from your library to log', 'error'); return false; }
  const entries = parseWeightEntries(tabs).filter((e) => e.date !== date);
  entries.push({ date, weight, unit: unit || 'kg', notes: notes || '' });
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));
  const rows = entriesToRows(entries);
  await writeSheetTab(sheetId, WEIGHT_TAB, rows);
  const existing = readSheetTab(tabs, WEIGHT_TAB);
  if (existing) existing.values = rows;
  else if (Array.isArray(tabs)) tabs.push({ title: WEIGHT_TAB, numericSheetId: -1, values: rows });
  return true;
}

/* ---------- UI ---------- */

/**
 * Build + append the weight-tracking card to the calorie dashboard. Fully
 * defensive: any failure is swallowed so it can never break the dashboard.
 * @param {HTMLElement} container
 * @param {{sheetId:string, tabs:Array, profile:Object, onChange:Function}} ctx
 */
export function renderWeightCard(container, { sheetId, tabs, profile, onChange } = {}) {
  try {
    const entries = parseWeightEntries(tabs);
    const latest = entries[entries.length - 1] || null;
    const first = entries[0] || null;
    const unit = latest ? latest.unit : (profile && profile.units === 'imperial' ? 'lbs' : 'kg');
    const diff = latest && first && entries.length > 1
      ? Math.round((latest.weight - first.weight) * 10) / 10 : 0;
    const diffLabel = diff === 0 ? '±0' : diff > 0 ? `+${diff}` : `${diff}`;

    const logBtn = el('button', {
      className: 'calorie-weight-log',
      on: { click: () => openLogWeightModal({ sheetId, tabs, unit, onChange }) },
    }, ['＋ Log weight']);

    const body = latest
      ? el('div', { className: 'calorie-weight-stats' }, [
          _stat(String(latest.weight), `Latest (${unit})`),
          _stat(diffLabel, 'Change'),
          _stat(String(entries.length), 'Weigh-ins'),
        ])
      : el('div', { className: 'calorie-weight-empty' }, ['No weigh-ins yet — log your first to start tracking.']);

    const card = el('div', { className: 'calorie-weight-card' }, [
      el('div', { className: 'calorie-weight-head' }, [
        el('span', { className: 'calorie-weight-title' }, ['⚖️ Weight']),
        logBtn,
      ]),
      body,
    ]);

    const spark = _sparkline(entries.map((e) => e.weight));
    if (spark) card.append(el('div', { className: 'calorie-weight-chart' }, [spark]));

    container.append(card);
  } catch (err) {
    // Never let the weight card break the calorie dashboard.
    console.error('[calorie/weight] render skipped:', err && err.message);
  }
}

/** Small overlay modal to enter today's weigh-in. */
function openLogWeightModal({ sheetId, tabs, unit, onChange }) {
  const input = el('input', {
    type: 'number', step: '0.1', min: '0',
    className: 'calorie-weight-input', placeholder: `Weight (${unit})`,
  });

  const overlay = el('div', {
    className: 'calorie-weight-modal-overlay',
    on: { click: (e) => { if (e.target === overlay) close(); } },
  });
  function close() { overlay.remove(); }

  async function save() {
    const w = parseFloat(input.value);
    if (!w || w <= 0) { showToast('Enter a valid weight', 'error'); return; }
    try {
      await logWeight({ sheetId, tabs, date: todayISO(), weight: Math.round(w * 10) / 10, unit });
      showToast('Weigh-in saved', 'success');
      close();
      if (typeof onChange === 'function') onChange();
    } catch (err) {
      showToast((err && err.message) || 'Could not save weigh-in', 'error');
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') close();
  });

  overlay.append(el('div', { className: 'calorie-weight-modal' }, [
    el('div', { className: 'calorie-weight-modal-title' }, ["Log today's weigh-in"]),
    input,
    el('div', { className: 'calorie-weight-modal-actions' }, [
      el('button', { className: 'calorie-weight-cancel', on: { click: close } }, ['Cancel']),
      el('button', { className: 'calorie-weight-save', on: { click: save } }, ['Save']),
    ]),
  ]));

  document.body.append(overlay);
  setTimeout(() => { try { input.focus(); } catch { /* noop */ } }, 0);
}

/* ---------- helpers ---------- */

function _stat(value, label) {
  return el('div', { className: 'calorie-weight-stat' }, [
    el('span', { className: 'calorie-weight-stat-value' }, [value]),
    el('span', { className: 'calorie-weight-stat-label' }, [label]),
  ]);
}

/** Dependency-free inline SVG sparkline of the weigh-in series (or null). */
function _sparkline(values) {
  const nums = (values || []).filter((v) => typeof v === 'number' && v > 0);
  if (nums.length < 2) return null;
  const w = 600, h = 70, pad = 6;
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const step = (w - pad * 2) / (nums.length - 1);
  const points = nums
    .map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`)
    .join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'calorie-weight-spark');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', points);
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', '#ef4444');
  poly.setAttribute('stroke-width', '2');
  poly.setAttribute('stroke-linejoin', 'round');
  poly.setAttribute('stroke-linecap', 'round');
  svg.appendChild(poly);
  return svg;
}
