/* ============================================================
   party/helpers.js — Party Planning Dashboard: constants & pure helpers

   The dashboard is rendered from a MULTI-TAB workbook (the Waymark
   "multi sheet data structure"). Each planning category lives in its own
   named tab so the backend data stays clean and human-editable (§4.7):

     Details       Party | Guest of Honor | Date | Theme | Venue | Host
     Guests        Guest | RSVP | Party Size | Notes
     Menu          Dish | Course | Assigned To | Status | Notes
     Budget        Item | Category | Estimated | Actual | Paid
     Decorations   Decoration | Location | Bought | Hung | Notes
     Links         Label | URL | Type
     Layout        Setting | Value   (internal: section order + collapsed)
   ============================================================ */

/* ---------- Tab titles ---------- */

export const META_TAB = 'Details';
export const LINKS_TAB = 'Links';
export const LAYOUT_TAB = 'Layout';

/** Ordered meta fields shown in the hero header. */
export const META_FIELDS = [
  { key: 'party', label: 'Party' },
  { key: 'guestOfHonor', label: 'Guest of Honor' },
  { key: 'date', label: 'Date' },
  { key: 'theme', label: 'Theme' },
  { key: 'venue', label: 'Venue' },
  { key: 'host', label: 'Host' },
];

export const META_HEADER = META_FIELDS.map(f => f.label);

/* ---------- Field types ----------
   text   — free text input
   status — click-to-cycle badge (options[])
   yesno  — Yes/No toggle chip
   money  — numeric text formatted as currency
------------------------------------- */

/** Link type → emoji icon (for external tool chips). */
export const LINK_TYPES = ['Registry', 'Pinterest', 'Playlist', 'Invite', 'Venue', 'Other'];
export const LINK_ICONS = {
  registry: '🎁',
  pinterest: '📌',
  playlist: '🎵',
  invite: '✉️',
  venue: '📍',
  other: '🔗',
};

/**
 * Category definitions. Each maps to a workbook tab and knows how to
 * measure its own completion. `progress(rows)` returns { done, total, pct }.
 */
export const CATEGORIES = [
  {
    key: 'guests',
    tab: 'Guests',
    title: 'Guest List & RSVPs',
    icon: '🎟️',
    accent: '#ec4899',
    noun: 'guest',
    header: ['Guest', 'RSVP', 'Party Size', 'Notes'],
    fields: [
      { role: 'name', label: 'Guest', col: 0, type: 'text', primary: true, required: true },
      { role: 'rsvp', label: 'RSVP', col: 1, type: 'status', options: ['Yes', 'No', 'Pending'] },
      { role: 'size', label: 'Party Size', col: 2, type: 'text', placeholder: '1' },
      { role: 'notes', label: 'Notes', col: 3, type: 'text', placeholder: 'Dietary, +1, etc.' },
    ],
    progress(rows) {
      const total = rows.length;
      const done = rows.filter(r => /^(yes|no)$/i.test((r[1] || '').trim())).length;
      return { done, total, pct: pct(done, total) };
    },
    summary(rows) {
      const yes = rows.filter(r => /^yes$/i.test((r[1] || '').trim()));
      const heads = yes.reduce((n, r) => n + (parseInt(r[2], 10) || 1), 0);
      return `${yes.length} attending · ${heads} heads · ${rows.length} invited`;
    },
  },
  {
    key: 'menu',
    tab: 'Menu',
    title: 'Menu & Food',
    icon: '🍽️',
    accent: '#f59e0b',
    noun: 'dish',
    header: ['Dish', 'Course', 'Assigned To', 'Status', 'Notes'],
    fields: [
      { role: 'dish', label: 'Dish', col: 0, type: 'text', primary: true, required: true },
      { role: 'course', label: 'Course', col: 1, type: 'status', options: ['Appetizer', 'Main', 'Side', 'Dessert', 'Drink'] },
      { role: 'assigned', label: 'Assigned To', col: 2, type: 'text', placeholder: 'Who brings it' },
      { role: 'status', label: 'Status', col: 3, type: 'status', options: ['Idea', 'Planned', 'Confirmed'] },
      { role: 'notes', label: 'Notes', col: 4, type: 'text', placeholder: 'Recipe, allergens…' },
    ],
    progress(rows) {
      const total = rows.length;
      const done = rows.filter(r => /^confirmed$/i.test((r[3] || '').trim())).length;
      return { done, total, pct: pct(done, total) };
    },
    summary(rows) {
      const confirmed = rows.filter(r => /^confirmed$/i.test((r[3] || '').trim())).length;
      return `${confirmed} of ${rows.length} dishes confirmed`;
    },
  },
  {
    key: 'budget',
    tab: 'Budget',
    title: 'Budget',
    icon: '💰',
    accent: '#10b981',
    noun: 'expense',
    header: ['Item', 'Category', 'Estimated', 'Actual', 'Paid'],
    fields: [
      { role: 'item', label: 'Item', col: 0, type: 'text', primary: true, required: true },
      { role: 'category', label: 'Category', col: 1, type: 'status', options: ['Venue', 'Food', 'Decor', 'Entertainment', 'Gifts', 'Other'] },
      { role: 'estimated', label: 'Estimated', col: 2, type: 'money', placeholder: '0' },
      { role: 'actual', label: 'Actual', col: 3, type: 'money', placeholder: '0' },
      { role: 'paid', label: 'Paid', col: 4, type: 'yesno' },
    ],
    progress(rows) {
      const total = rows.length;
      const done = rows.filter(r => isYes(r[4])).length;
      return { done, total, pct: pct(done, total) };
    },
    summary(rows) {
      const est = rows.reduce((n, r) => n + money(r[2]), 0);
      const act = rows.reduce((n, r) => n + money(r[3]), 0);
      return `Est ${fmtMoney(est)} · Actual ${fmtMoney(act)}`;
    },
  },
  {
    key: 'decorations',
    tab: 'Decorations',
    title: 'Decorations',
    icon: '🎈',
    accent: '#8b5cf6',
    noun: 'decoration',
    header: ['Decoration', 'Location', 'Bought', 'Hung', 'Notes'],
    fields: [
      { role: 'name', label: 'Decoration', col: 0, type: 'text', primary: true, required: true },
      { role: 'location', label: 'Location', col: 1, type: 'text', placeholder: 'Where it goes' },
      { role: 'bought', label: 'Bought', col: 2, type: 'yesno' },
      { role: 'hung', label: 'Hung', col: 3, type: 'yesno' },
      { role: 'notes', label: 'Notes', col: 4, type: 'text', placeholder: 'Store, qty…' },
    ],
    // Two-step task: buying AND hanging each count toward completion.
    progress(rows) {
      const total = rows.length * 2;
      const done = rows.reduce((n, r) => n + (isYes(r[2]) ? 1 : 0) + (isYes(r[3]) ? 1 : 0), 0);
      return { done, total, pct: pct(done, total) };
    },
    summary(rows) {
      const bought = rows.filter(r => isYes(r[2])).length;
      const hung = rows.filter(r => isYes(r[3])).length;
      return `${bought} bought · ${hung} hung · ${rows.length} items`;
    },
  },
];

/** Category keys in their default order. */
export const CATEGORY_KEYS = CATEGORIES.map(c => c.key);

/** Lookup a category definition by key. */
export function categoryByKey(key) {
  return CATEGORIES.find(c => c.key === key) || null;
}

/* ---------- Number & money helpers ---------- */

/** Percent (0–100, integer) of done/total, guarding div-by-zero. */
export function pct(done, total) {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

/** Parse a money-ish string ("$1,200.50") into a number. */
export function money(raw) {
  if (raw == null) return 0;
  const n = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Format a number as a compact currency string. */
export function fmtMoney(n) {
  const v = Math.round(n * 100) / 100;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Truthy Yes test for yes/no columns. */
export function isYes(v) {
  return /^(yes|y|true|✓|done|paid)$/i.test((v || '').trim());
}

/** CSS bar class from a percent (low / mid / high / done). */
export function barClass(p) {
  if (p >= 100) return 'party-bar-done';
  if (p >= 60) return 'party-bar-high';
  if (p >= 30) return 'party-bar-mid';
  return 'party-bar-low';
}

/* ---------- Tab parsing ---------- */

/**
 * Read the party meta object from the Details tab values.
 * Header-driven so column order in the sheet doesn't matter.
 * @param {string[][]} values  2D rows (header + one data row)
 * @returns {Object} meta keyed by META_FIELDS.key
 */
export function metaFromValues(values) {
  const meta = {};
  for (const f of META_FIELDS) meta[f.key] = '';
  if (!Array.isArray(values) || values.length === 0) return meta;
  const header = (values[0] || []).map(h => (h || '').toLowerCase().trim());
  const row = values[1] || [];
  for (const f of META_FIELDS) {
    const i = header.findIndex(h => h === f.label.toLowerCase());
    if (i >= 0) meta[f.key] = (row[i] || '').trim();
  }
  return meta;
}

/** Serialize a meta object back into Details-tab rows. */
export function metaToValues(meta) {
  return [META_HEADER, META_FIELDS.map(f => meta[f.key] || '')];
}

/**
 * Parse a category tab's values into a clean list of data rows padded to
 * the category's column count. Header row is dropped.
 * @param {Object} cat  category definition
 * @param {string[][]} values
 * @returns {string[][]}
 */
export function rowsFromTab(cat, values) {
  const width = cat.header.length;
  const src = Array.isArray(values) ? values.slice(1) : [];
  return src
    .filter(r => Array.isArray(r) && r.some(c => (c || '').trim() !== ''))
    .map(r => {
      const row = [];
      for (let i = 0; i < width; i++) row[i] = (r[i] || '').trim();
      return row;
    });
}

/** Build a full tab values array (header + rows) for persistence. */
export function tabValues(cat, rows) {
  return [cat.header.slice(), ...rows.map(r => r.slice())];
}

/* ---------- Links ---------- */

/** Parse the Links tab into { label, url, type } objects. */
export function linksFromTab(values) {
  const src = Array.isArray(values) ? values.slice(1) : [];
  return src
    .filter(r => Array.isArray(r) && (r[0] || r[1]))
    .map(r => ({ label: (r[0] || '').trim(), url: (r[1] || '').trim(), type: (r[2] || 'Other').trim() }));
}

/** Serialize link objects back into Links-tab rows. */
export function linksToValues(links) {
  return [['Label', 'URL', 'Type'], ...links.map(l => [l.label, l.url, l.type || 'Other'])];
}

/** Emoji icon for a link type. */
export function linkIcon(type) {
  return LINK_ICONS[(type || 'other').toLowerCase()] || LINK_ICONS.other;
}

/** Ensure a URL has a protocol so it opens correctly in a new tab. */
export function normalizeUrl(url) {
  const u = (url || '').trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/* ---------- Layout (order + collapsed) ---------- */

/** Parse the Layout tab (Setting/Value) into { order[], collapsed[] }. */
export function layoutFromTab(values) {
  const out = { order: [], collapsed: [] };
  if (!Array.isArray(values)) return out;
  for (let i = 1; i < values.length; i++) {
    const [key, val] = values[i] || [];
    if (!key) continue;
    const parts = (val || '').split(',').map(s => s.trim()).filter(Boolean);
    if (/^order$/i.test(key)) out.order = parts;
    else if (/^collapsed$/i.test(key)) out.collapsed = parts;
  }
  return out;
}

/** Serialize order + collapsed set back into Layout-tab rows. */
export function layoutToValues(order, collapsedSet) {
  return [
    ['Setting', 'Value'],
    ['order', order.join(',')],
    ['collapsed', Array.from(collapsedSet).join(',')],
  ];
}

/**
 * Reconcile a persisted order with the known section keys: keep persisted
 * order for keys that still exist, then append any new keys.
 * @param {string[]} persisted
 * @returns {string[]}
 */
export function resolveOrder(persisted) {
  const known = CATEGORY_KEYS.concat('links');
  const seen = new Set();
  const order = [];
  for (const k of persisted || []) {
    if (known.includes(k) && !seen.has(k)) { order.push(k); seen.add(k); }
  }
  for (const k of known) {
    if (!seen.has(k)) order.push(k);
  }
  return order;
}
