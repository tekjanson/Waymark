/* ============================================================
   templates/petcare.js — Pet Care Tracker template
   ============================================================ */

import { el, cell, editableCell, registerTemplate } from './shared.js';

/* ---------- Helpers ---------- */

const TYPE_ICONS = {
  dog: '🐕', cat: '🐈', rabbit: '🐇', fish: '🐠',
  bird: '🐦', hamster: '🐹', turtle: '🐢', guinea: '🐹',
};

/**
 * Return emoji icon for a pet type string.
 * @param {string} type
 * @returns {string}
 */
export function petIcon(type) {
  if (!type) return '🐾';
  const lower = type.toLowerCase();
  for (const [key, icon] of Object.entries(TYPE_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return '🐾';
}

/**
 * Format an ISO date string as 'Jan 15, 2026'.
 * @param {string} str
 * @returns {string}
 */
export function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Return CSS urgency class for an appointment date string.
 * @param {string} str — ISO date string
 * @returns {string}
 */
export function apptClass(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d.getTime())) return '';
  const days = (d.getTime() - Date.now()) / 86400000;
  if (days < 0) return 'petcare-due-overdue';
  if (days <= 7) return 'petcare-due-soon';
  if (days <= 30) return 'petcare-due-upcoming';
  return 'petcare-due-later';
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Pet Care Tracker',
  icon: '🐾',
  color: '#16a34a',
  priority: 35,
  itemNoun: 'Pet',
  defaultHeaders: ['Pet', 'Type', 'Vet Visit', 'Vaccination', 'Medication', 'Weight', 'Notes', 'Next Appointment'],

  /**
   * Detect: requires a "Pet" column + at least one care-tracking column.
   * @param {string[]} lower — lowercased headers
   * @returns {boolean}
   */
  detect(lower) {
    const hasPet  = lower.some(h => /^pet/.test(h));
    const hasCare = lower.some(h => /^(vet|vaccination|vaccine|medication|weight)/.test(h));
    return hasPet && hasCare;
  },

  /**
   * Map header positions to semantic column roles.
   * @param {string[]} lower
   * @returns {Object}
   */
  columns(lower) {
    const cols = { pet: -1, type: -1, vet: -1, vacc: -1, med: -1, weight: -1, notes: -1, appt: -1 };
    cols.pet    = lower.findIndex(h => /^pet/.test(h));
    if (cols.pet === -1) cols.pet = 0;
    cols.type   = lower.findIndex(h => /^type/.test(h));
    cols.vet    = lower.findIndex(h => /^vet/.test(h));
    cols.vacc   = lower.findIndex(h => /^(vacc|vaccine)/.test(h));
    cols.med    = lower.findIndex(h => /^med/.test(h));
    cols.weight = lower.findIndex(h => /^weight/.test(h));
    cols.notes  = lower.findIndex(h => /^notes?/.test(h));
    cols.appt   = lower.findIndex(h => /^(next|appoint)/.test(h));
    return cols;
  },

  /**
   * Add-row field definitions.
   * @param {Object} cols
   * @returns {Array}
   */
  addRowFields(cols) {
    return [
      { role: 'pet',    label: 'Pet Name',         colIndex: cols.pet,    type: 'text', placeholder: 'Pet name', required: true },
      { role: 'type',   label: 'Type',             colIndex: cols.type,   type: 'text', placeholder: 'Dog, Cat, Rabbit...' },
      { role: 'vet',    label: 'Last Vet Visit',   colIndex: cols.vet,    type: 'date', placeholder: 'YYYY-MM-DD' },
      { role: 'vacc',   label: 'Last Vaccination', colIndex: cols.vacc,   type: 'date', placeholder: 'YYYY-MM-DD' },
      { role: 'med',    label: 'Medication',       colIndex: cols.med,    type: 'text', placeholder: 'e.g. Heartworm monthly' },
      { role: 'weight', label: 'Weight',           colIndex: cols.weight, type: 'text', placeholder: 'e.g. 12 lbs' },
      { role: 'notes',  label: 'Notes',            colIndex: cols.notes,  type: 'text', placeholder: 'Health notes' },
      { role: 'appt',   label: 'Next Appointment', colIndex: cols.appt,   type: 'date', placeholder: 'YYYY-MM-DD' },
    ];
  },

  /**
   * Render pet cards into container.
   * @param {HTMLElement} container
   * @param {string[][]} rows
   * @param {Object} cols
   */
  render(container, rows, cols) {
    for (let i = 0; i < rows.length; i++) {
      const row    = rows[i];
      const rowIdx = i + 1;
      const name   = cell(row, cols.pet)    || row[0] || '—';
      const type   = cell(row, cols.type);
      const vet    = cell(row, cols.vet);
      const vacc   = cell(row, cols.vacc);
      const med    = cell(row, cols.med);
      const weight = cell(row, cols.weight);
      const notes  = cell(row, cols.notes);
      const appt   = cell(row, cols.appt);

      /* ---------- Header ---------- */
      const headLeft = [
        el('span', { className: 'petcare-icon' }, [petIcon(type)]),
        editableCell('span', { className: 'petcare-name' }, name, rowIdx, cols.pet),
      ];
      if (cols.type >= 0) {
        headLeft.push(editableCell('span', { className: 'petcare-type-badge' }, type, rowIdx, cols.type));
      }

      /* ---------- Appointment badge ---------- */
      const headRight = [];
      if (cols.appt >= 0) {
        const cls = apptClass(appt);
        if (appt) {
          headRight.push(
            el('div', { className: `petcare-appt-badge${cls ? ' ' + cls : ''}` }, [
              'Next: ',
              editableCell('span', {}, appt, rowIdx, cols.appt, {
                renderContent(w) { w.textContent = fmtDate(appt) || appt; },
                onCommit(v, w) { w.textContent = fmtDate(v) || v || '—'; },
              }),
            ])
          );
        } else {
          headRight.push(
            editableCell('span', { className: 'petcare-appt-badge petcare-due-later' }, '', rowIdx, cols.appt, {
              renderContent(w) { w.textContent = 'Set appointment'; },
              onCommit(v, w) { w.textContent = fmtDate(v) || v || 'Set appointment'; },
            })
          );
        }
      }

      /* ---------- Stats row ---------- */
      const stats = [];
      if (cols.vet >= 0) {
        stats.push(el('div', { className: 'petcare-stat' }, [
          el('span', { className: 'petcare-stat-label' }, ['Last Vet']),
          editableCell('span', { className: 'petcare-stat-value' }, vet, rowIdx, cols.vet, {
            renderContent(w) { w.textContent = fmtDate(vet) || vet || '—'; },
            onCommit(v, w) { w.textContent = fmtDate(v) || v || '—'; },
          }),
        ]));
      }
      if (cols.vacc >= 0) {
        stats.push(el('div', { className: 'petcare-stat' }, [
          el('span', { className: 'petcare-stat-label' }, ['Vaccinated']),
          editableCell('span', { className: 'petcare-stat-value' }, vacc, rowIdx, cols.vacc, {
            renderContent(w) { w.textContent = fmtDate(vacc) || vacc || '—'; },
            onCommit(v, w) { w.textContent = fmtDate(v) || v || '—'; },
          }),
        ]));
      }
      if (cols.weight >= 0) {
        stats.push(el('div', { className: 'petcare-stat' }, [
          el('span', { className: 'petcare-stat-label' }, ['Weight']),
          editableCell('span', { className: 'petcare-stat-value' }, weight, rowIdx, cols.weight),
        ]));
      }
      if (med) {
        stats.push(el('div', { className: 'petcare-stat' }, [
          el('span', { className: 'petcare-stat-label' }, ['Medication']),
          editableCell('span', { className: 'petcare-stat-value petcare-med-pill' }, med, rowIdx, cols.med),
        ]));
      }

      /* ---------- Card ---------- */
      container.append(
        el('div', { className: 'petcare-card' }, [
          el('div', { className: 'petcare-header' }, [
            el('div', { className: 'petcare-header-left' }, headLeft),
            ...(headRight.length ? [el('div', { className: 'petcare-header-right' }, headRight)] : []),
          ]),
          ...(stats.length ? [el('div', { className: 'petcare-stats' }, stats)] : []),
          ...(notes ? [editableCell('p', { className: 'petcare-notes' }, notes, rowIdx, cols.notes)] : []),
        ])
      );
    }
  },
};

registerTemplate('petcare', definition);
export default definition;
