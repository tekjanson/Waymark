/* ============================================================
   calorie/weight.js — Weight-over-time tracking for the Calorie tracker.

   Weight lives in a dedicated "Weight" tab in the same workbook, ONE ROW PER
   WEIGH-IN (Date | Time | Weight | Unit | Notes, AI_LAWS §4.7). Every weigh-in
   is APPENDED — nothing is ever overwritten — so the tab is a full history log.

   The tracker and the profile's current weight stay in sync:
     • logging a weigh-in updates the profile's weight (via onProfileWeight), and
     • editing the profile weight appends a weigh-in (see calorie/index.js).

   The parser is header-aware, so legacy 4-column tabs (Date | Weight | Unit |
   Notes) are read correctly and transparently upgraded to the 5-column layout
   on the next write.

   Everything here is DEFENSIVE: rendering is wrapped so a failure can never
   break the calorie dashboard, and every write is best-effort.
   ============================================================ */

import { el, showToast, readSheetTab, writeSheetTab } from '../shared.js';

export const WEIGHT_TAB = 'Weight';
const WEIGHT_HEADERS = ['Date', 'Time', 'Weight', 'Unit', 'Notes'];
const LB_PER_KG = 2.2046226218;

/* ---------- Data model ---------- */

/** Locate columns in a Weight tab header (handles legacy 4-col + new 5-col). */
function weightCols(header) {
  const lower = (header || []).map((h) => String(h || '').toLowerCase().trim());
  const find = (re) => lower.findIndex((h) => re.test(h));
  const cols = {
    date: find(/^(date|day|when)/),
    time: find(/^time/),
    weight: find(/^(weight|weigh|mass|lbs|kgs?)/),
    unit: find(/^unit/),
    notes: find(/^(note|comment)/),
  };
  if (cols.date < 0) cols.date = 0;
  // Legacy minimal layout: Date | Weight | Unit | Notes (no Time column).
  if (cols.weight < 0) cols.weight = cols.time >= 0 ? 2 : 1;
  return cols;
}

/** Sortable epoch ms from an entry's date (+ optional time). */
function tsOf(e) {
  const time = /^\d{1,2}:\d{2}/.test(e.time || '') ? e.time : '00:00';
  const ms = Date.parse(`${e.date}T${time.length === 4 ? '0' + time : time}`);
  return Number.isFinite(ms) ? ms : (Date.parse(e.date) || 0);
}

/** Parse the workbook's Weight tab into typed, chronologically-sorted entries. */
export function parseWeightEntries(tabs) {
  const tab = readSheetTab(tabs, WEIGHT_TAB);
  if (!tab || !Array.isArray(tab.values) || tab.values.length < 2) return [];
  const c = weightCols(tab.values[0] || []);
  const entries = tab.values.slice(1).map((row) => {
    const r = row || [];
    return {
      date: String(r[c.date] || '').trim(),
      time: c.time >= 0 ? String(r[c.time] || '').trim() : '',
      weight: parseFloat(r[c.weight]) || 0,
      unit: c.unit >= 0 ? (String(r[c.unit] || 'kg').trim() || 'kg') : 'kg',
      notes: c.notes >= 0 ? String(r[c.notes] || '').trim() : '',
    };
  }).filter((e) => e.weight > 0 && e.date);
  entries.sort((a, b) => tsOf(a) - tsOf(b));
  return entries;
}

/** Serialize entries into the human-readable 5-column layout. */
function entriesToRows(entries) {
  return [
    WEIGHT_HEADERS.slice(),
    ...entries.map((e) => [e.date, e.time || '', String(e.weight), e.unit || 'kg', e.notes || '']),
  ];
}

function nowParts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Convert a displayed weight to kilograms (for the profile link). */
export function toKg(weight, unit) {
  const w = Number(weight) || 0;
  return unit === 'lbs' ? Math.round((w / LB_PER_KG) * 10) / 10 : Math.round(w * 10) / 10;
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
  if (readSheetTab(tabs, WEIGHT_TAB)) return false;              // already present
  const kg = profile && Number(profile.weightKg);
  if (!kg || kg <= 0) return false;                             // nothing to seed
  const imperial = profile && profile.units === 'imperial';
  const unit = imperial ? 'lbs' : 'kg';
  const weight = imperial ? Math.round(kg * LB_PER_KG * 10) / 10 : Math.round(kg * 10) / 10;
  const { date, time } = nowParts();
  const rows = entriesToRows([{ date, time, weight, unit, notes: 'Imported from profile' }]);
  try {
    await writeSheetTab(sheetId, WEIGHT_TAB, rows);
    tabs.push({ title: WEIGHT_TAB, numericSheetId: -1, values: rows });
    return true;
  } catch {
    return false;   // best-effort; the card still offers manual logging
  }
}

/**
 * APPEND a weigh-in to the history (never overwrites). Each call adds a new
 * timestamped row, so logging multiple times — even on the same day — keeps
 * every entry. Creates the tab if it doesn't exist and upgrades a legacy
 * 4-column tab to the 5-column layout on write.
 */
export async function logWeight({ sheetId, tabs, weight, unit, notes }) {
  if (!sheetId) { showToast('Open this sheet from your library to log', 'error'); return false; }
  const w = Number(weight) || 0;
  if (w <= 0) return false;
  const { date, time } = nowParts();
  const entries = parseWeightEntries(tabs);          // keep ALL existing history
  entries.push({ date, time, weight: Math.round(w * 10) / 10, unit: unit || 'kg', notes: notes || '' });
  entries.sort((a, b) => tsOf(a) - tsOf(b));
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
 * @param {{sheetId:string, tabs:Array, profile:Object, onChange:Function,
 *          onProfileWeight:Function}} ctx
 */
export function renderWeightCard(container, { sheetId, tabs, profile, onChange, onProfileWeight } = {}) {
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
      on: { click: () => openLogWeightModal({ sheetId, tabs, unit, onChange, onProfileWeight }) },
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

    // History log — every weigh-in, newest first (this is the durable record).
    if (entries.length) {
      const recent = entries.slice(-8).reverse();
      card.append(el('div', { className: 'calorie-weight-history' }, [
        el('div', { className: 'calorie-weight-history-title' }, ['History']),
        ...recent.map((e) => el('div', { className: 'calorie-weight-row' }, [
          el('span', { className: 'calorie-weight-row-when' }, [e.time ? `${e.date} · ${e.time}` : e.date]),
          el('span', { className: 'calorie-weight-row-val' }, [`${e.weight} ${e.unit}`]),
        ])),
      ]));
    }

    container.append(card);
  } catch (err) {
    // Never let the weight card break the calorie dashboard.
    console.error('[calorie/weight] render skipped:', err && err.message);
  }
}

/** Small overlay modal to enter a weigh-in (always appends — never overwrites). */
function openLogWeightModal({ sheetId, tabs, unit, onChange, onProfileWeight }) {
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
      const weight = Math.round(w * 10) / 10;
      await logWeight({ sheetId, tabs, weight, unit });
      // Keep the profile's current weight in sync with the newest weigh-in.
      if (typeof onProfileWeight === 'function') {
        await Promise.resolve(onProfileWeight(toKg(weight, unit))).catch(() => {});
      }
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
    el('div', { className: 'calorie-weight-modal-title' }, ['Log a weigh-in']),
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
