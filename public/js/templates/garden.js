/* ============================================================
   templates/garden.js — Garden Planner template
   ============================================================ */

import { el, cell, editableCell, registerTemplate } from './shared.js';

/* ---------- Helpers ---------- */

/**
 * Return a representative emoji for the plant based on name keywords.
 * @param {string} name
 * @returns {string}
 */
export function plantIcon(name) {
  const n = (name || '').toLowerCase();
  if (/tomato|pepper|bean|pea|cucumber|zucchini|squash|corn|potato|carrot|radish|beet|broccoli|cauliflower|cabbage|kale|spinach|lettuce|chard|onion|garlic|leek|celery|parsnip|turnip|asparagus/.test(n)) return '🥦';
  if (/herb|basil|mint|thyme|oregano|rosemary|sage|dill|cilantro|parsley|chive|lavender/.test(n)) return '🌿';
  if (/strawberry|berry|blueberry|raspberry|blackberry|currant|gooseberry/.test(n)) return '🍓';
  if (/apple|pear|cherry|peach|plum|apricot|fig|quince/.test(n)) return '🍎';
  if (/citrus|lemon|lime|orange|grapefruit|mandarin/.test(n)) return '🍋';
  if (/grape|vine/.test(n)) return '🍇';
  if (/rose|tulip|sunflower|daisy|lily|peony|dahlia|marigold|zinnia|poppy|iris|pansy|geranium|begonia|petunia|fuchsia/.test(n)) return '🌸';
  if (/cactus|succulent|aloe/.test(n)) return '🌵';
  if (/tree|oak|maple|elm|birch|willow|pine|fir|spruce/.test(n)) return '🌳';
  if (/pumpkin|melon|watermelon|cantaloupe/.test(n)) return '🎃';
  return '🌱';
}

/**
 * Parse a YYYY-MM-DD date string, returning a Date at midnight UTC.
 * Returns null for empty/invalid input.
 * @param {string} str
 * @returns {Date|null}
 */
export function parseGardenDate(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/**
 * Format a YYYY-MM-DD date string to a short readable form (Jun 15).
 * @param {string} str
 * @returns {string}
 */
export function fmtPlantDate(str) {
  const d = parseGardenDate(str);
  if (!d) return str || '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Determine the watering urgency class based on last-watered date and frequency.
 *
 * Frequency can be:
 *   - "daily" / "1" → every 1 day
 *   - "every 2 days" / "2" → every 2 days
 *   - "weekly" / "7" → every 7 days
 *   - "every N days" → N days
 * Returns:
 *   'garden-water-overdue' — watering is past due
 *   'garden-water-due'     — due today or tomorrow
 *   'garden-water-soon'    — within 2 days after due
 *   'garden-water-ok'      — watered recently, not due soon
 *   ''                     — unknown (no last-watered date)
 * @param {string} lastWatered  — YYYY-MM-DD
 * @param {string} frequency    — human-readable or numeric
 * @returns {string}
 */
export function waterUrgencyClass(lastWatered, frequency) {
  const last = parseGardenDate(lastWatered);
  if (!last) return '';

  let freqDays = 7; // default weekly
  if (frequency) {
    const f = String(frequency).toLowerCase().trim();
    if (/daily|every day|1\s*day/.test(f)) freqDays = 1;
    else if (/every\s*(\d+)\s*day/.test(f)) freqDays = parseInt(f.match(/every\s*(\d+)/)[1], 10);
    else if (/weekly|7/.test(f)) freqDays = 7;
    else if (/bi.?weekly|14/.test(f)) freqDays = 14;
    else {
      const n = parseInt(f, 10);
      if (!isNaN(n) && n > 0) freqDays = n;
    }
  }

  const now = Date.now();
  const msPerDay = 86400000;
  const daysSinceWatered = Math.floor((now - last.getTime()) / msPerDay);
  const daysUntilDue = freqDays - daysSinceWatered;

  if (daysUntilDue < 0) return 'garden-water-overdue';
  if (daysUntilDue <= 1) return 'garden-water-due';
  if (daysUntilDue <= 3) return 'garden-water-soon';
  return 'garden-water-ok';
}

/**
 * Calculate integer days until harvest date (negative = overdue).
 * Returns null if no valid date.
 * @param {string} harvestDate — YYYY-MM-DD
 * @returns {number|null}
 */
export function harvestDays(harvestDate) {
  const d = parseGardenDate(harvestDate);
  if (!d) return null;
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - todayUTC) / 86400000);
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Garden Planner',
  icon: '🌱',
  color: '#16a34a',
  priority: 34,
  itemNoun: 'Plant',
  defaultHeaders: ['Plant', 'Variety', 'Date Planted', 'Zone', 'Water Frequency', 'Last Watered', 'Harvest Date', 'Notes'],

  /**
   * Detect: requires a plant/crop column + at least one garden-specific column.
   * @param {string[]} lower
   * @returns {boolean}
   */
  detect(lower) {
    const hasPlant = lower.some(h => /^(plant|crop|flower|herb|tree|shrub|vegetable|veggie|seed)/.test(h));
    const hasGarden = lower.some(h => /^(zone|water|watered|harvest|planted|bed|row|plot|garden|germina)/.test(h));
    return hasPlant && hasGarden;
  },

  /**
   * Map header positions to semantic column roles.
   * @param {string[]} lower
   * @returns {Object}
   */
  columns(lower) {
    const cols = { plant: -1, variety: -1, planted: -1, zone: -1, waterFreq: -1, lastWatered: -1, harvest: -1, notes: -1 };
    cols.plant       = lower.findIndex(h => /^(plant|crop|flower|herb|tree|shrub|vegetable|veggie|name)/.test(h));
    if (cols.plant === -1) cols.plant = 0;
    cols.variety     = lower.findIndex(h => /^(variety|cultivar|type|species)/.test(h));
    cols.planted     = lower.findIndex(h => /^(date.planted|planted|sow|germination|start)/.test(h));
    cols.zone        = lower.findIndex(h => /^(zone|bed|row|plot|area|section|location)/.test(h));
    cols.waterFreq   = lower.findIndex(h => /^(water.freq|watering|water.sched|frequency|how.often)/.test(h));
    cols.lastWatered = lower.findIndex(h => /^(last.water|watered|last.irrigat)/.test(h));
    cols.harvest     = lower.findIndex(h => /^(harvest|ready|pick|maturity|expected)/.test(h));
    cols.notes       = lower.findIndex(h => /^(note|comment|remark|observation)/.test(h));
    return cols;
  },

  /**
   * Add-row field definitions.
   * @param {Object} cols
   * @returns {Array}
   */
  addRowFields(cols) {
    return [
      { role: 'plant',       label: 'Plant / Crop',      colIndex: cols.plant,       type: 'text',   placeholder: 'e.g. Tomato', required: true },
      { role: 'variety',     label: 'Variety',            colIndex: cols.variety,     type: 'text',   placeholder: 'e.g. Cherry' },
      { role: 'zone',        label: 'Zone / Bed',         colIndex: cols.zone,        type: 'text',   placeholder: 'e.g. Bed A' },
      { role: 'planted',     label: 'Date Planted',       colIndex: cols.planted,     type: 'date',   placeholder: 'YYYY-MM-DD' },
      { role: 'waterFreq',   label: 'Water Frequency',   colIndex: cols.waterFreq,   type: 'text',   placeholder: 'e.g. Every 3 days' },
      { role: 'lastWatered', label: 'Last Watered',       colIndex: cols.lastWatered, type: 'date',   placeholder: 'YYYY-MM-DD' },
      { role: 'harvest',     label: 'Harvest Date',       colIndex: cols.harvest,     type: 'date',   placeholder: 'YYYY-MM-DD' },
      { role: 'notes',       label: 'Notes',              colIndex: cols.notes,       type: 'text',   placeholder: 'Observations…' },
    ];
  },

  /**
   * Render plant cards grouped by zone.
   * @param {HTMLElement} container
   * @param {string[][]} rows
   * @param {Object} cols
   */
  render(container, rows, cols) {
    // Group rows by zone value (or 'Ungrouped' if no zone column)
    const groups = new Map();
    const UNGROUPED = 'Garden';

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const zone = cols.zone >= 0 ? (cell(row, cols.zone) || UNGROUPED) : UNGROUPED;
      if (!groups.has(zone)) groups.set(zone, []);
      groups.get(zone).push({ row, origIdx: i + 1 });
    }

    for (const [zone, entries] of groups) {
      const cards = entries.map(({ row, origIdx }) => buildCard(row, origIdx, cols));
      const groupEl = el('div', { className: 'garden-group' }, [
        el('h3', { className: 'garden-group-heading' }, [zone]),
        el('div', { className: 'garden-cards' }, cards),
      ]);
      container.append(groupEl);
    }
  },
};

/** Build a single plant card element. */
function buildCard(row, origIdx, cols) {
  const name       = cell(row, cols.plant)       || row[0] || '—';
  const variety    = cell(row, cols.variety);
  const planted    = cell(row, cols.planted);
  const lastWater  = cell(row, cols.lastWatered);
  const waterFreq  = cell(row, cols.waterFreq);
  const harvest    = cell(row, cols.harvest);
  const notes      = cell(row, cols.notes);

  const icon = plantIcon(name);
  const urgency = waterUrgencyClass(lastWater, waterFreq);
  const hDays = harvestDays(harvest);

  /* Water badge */
  const waterBadgeLabel = urgency === 'garden-water-overdue' ? 'Water now!'
    : urgency === 'garden-water-due' ? 'Water today'
    : urgency === 'garden-water-soon' ? 'Water soon'
    : lastWater ? 'Watered'
    : '';

  const waterBadge = waterBadgeLabel
    ? el('span', { className: `garden-badge garden-water-badge ${urgency}` }, [
        el('span', { className: 'garden-badge-icon' }, ['💧']),
        waterBadgeLabel,
      ])
    : null;

  /* Harvest badge */
  let harvestBadge = null;
  if (harvest) {
    const harvestText = hDays === null ? fmtPlantDate(harvest)
      : hDays < 0 ? `Ready! ${Math.abs(hDays)}d ago`
      : hDays === 0 ? 'Harvest today!'
      : `${hDays}d to harvest`;
    const harvestClass = hDays !== null && hDays <= 0 ? 'garden-harvest-ready'
      : hDays !== null && hDays <= 7 ? 'garden-harvest-soon'
      : 'garden-harvest-later';
    harvestBadge = el('span', { className: `garden-badge garden-harvest-badge ${harvestClass}` }, [
      el('span', { className: 'garden-badge-icon' }, ['🌾']),
      harvestText,
    ]);
  }

  /* Planted date chip */
  const plantedChip = planted
    ? el('span', { className: 'garden-planted-chip' }, [
        el('span', { className: 'garden-chip-label' }, ['Planted ']),
        fmtPlantDate(planted),
      ])
    : null;

  /* Card header: icon + name + variety */
  const header = el('div', { className: 'garden-card-header' }, [
    el('span', { className: 'garden-plant-icon' }, [icon]),
    el('div', { className: 'garden-plant-meta' }, [
      editableCell('div', { className: 'garden-plant-name' }, name, origIdx, cols.plant),
      variety
        ? editableCell('div', { className: 'garden-plant-variety' }, variety, origIdx, cols.variety)
        : null,
    ].filter(Boolean)),
  ]);

  /* Badges row */
  const badgesEl = el('div', { className: 'garden-card-badges' }, [
    waterBadge,
    harvestBadge,
    plantedChip,
  ].filter(Boolean));

  /* Water detail row */
  const waterDetail = (lastWater || waterFreq)
    ? el('div', { className: 'garden-water-detail' }, [
        cols.lastWatered >= 0 && lastWater
          ? editableCell('span', { className: 'garden-water-last' }, lastWater, origIdx, cols.lastWatered, {
              renderContent(w) { w.textContent = `💧 ${fmtPlantDate(lastWater)}`; },
              onCommit(v, w) { w.textContent = `💧 ${fmtPlantDate(v)}`; },
            })
          : null,
        cols.waterFreq >= 0 && waterFreq
          ? editableCell('span', { className: 'garden-water-freq' }, waterFreq, origIdx, cols.waterFreq, {
              renderContent(w) { w.textContent = `↻ ${waterFreq}`; },
              onCommit(v, w) { w.textContent = `↻ ${v}`; },
            })
          : null,
      ].filter(Boolean))
    : null;

  /* Notes */
  const notesEl = notes
    ? editableCell('div', { className: 'garden-card-notes' }, notes, origIdx, cols.notes)
    : null;

  return el('div', { className: 'garden-card' }, [
    header,
    badgesEl.children.length ? badgesEl : null,
    waterDetail,
    notesEl,
  ].filter(Boolean));
}

registerTemplate('garden', definition);
export default definition;
