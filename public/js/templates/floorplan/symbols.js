/* ============================================================
   floorplan/symbols.js — Top-down architectural symbol library

   Draws furniture, appliances, and fixtures the way they appear
   on a real floor plan (viewed from above) rather than as emoji.
   Every symbol is drawn centered on (0,0) inside a width×height
   bounding box so the caller can freely translate / rotate / flip
   it with a single SVG transform.
   ============================================================ */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* World scale: how many SVG units represent one real-world foot.
   10 units = 1 ft keeps the snap grid (10u) on clean 1-ft steps and
   the major grid lines (40u) on tidy 4-ft intervals. */
export const UNITS_PER_FOOT = 10;

const STROKE = '#334155';
const STROKE_SOFT = '#64748b';
const FILL = '#ffffff';
const ACCENT = '#e2e8f0';

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'className') node.setAttribute('class', val);
    else node.setAttribute(key, val);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/* ---------- Dimension formatting ---------- */

/** Convert SVG units to a human-friendly feet/inches string.
 * @param {number} units — length in SVG units
 * @returns {string} e.g. `12' 6"` or `8"`
 */
export function formatFeet(units) {
  const totalInches = Math.round((Math.abs(units) / UNITS_PER_FOOT) * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (feet <= 0) return `${inches}"`;
  if (inches === 0) return `${feet}'`;
  return `${feet}' ${inches}"`;
}

/* ---------- Primitive builders (centered coordinate space) ---------- */

const rect = (w, h, opts = {}) => svgEl('rect', {
  x: -w / 2,
  y: -h / 2,
  width: w,
  height: h,
  rx: opts.rx ?? 0,
  fill: opts.fill ?? FILL,
  stroke: opts.stroke ?? STROKE,
  'stroke-width': opts.sw ?? 1.5,
});

const box = (x, y, w, h, opts = {}) => svgEl('rect', {
  x, y, width: w, height: h,
  rx: opts.rx ?? 0,
  fill: opts.fill ?? 'none',
  stroke: opts.stroke ?? STROKE,
  'stroke-width': opts.sw ?? 1.2,
});

const circle = (cx, cy, r, opts = {}) => svgEl('circle', {
  cx, cy, r,
  fill: opts.fill ?? 'none',
  stroke: opts.stroke ?? STROKE,
  'stroke-width': opts.sw ?? 1.2,
});

const ellipse = (cx, cy, rx, ry, opts = {}) => svgEl('ellipse', {
  cx, cy, rx, ry,
  fill: opts.fill ?? 'none',
  stroke: opts.stroke ?? STROKE,
  'stroke-width': opts.sw ?? 1.2,
});

const line = (x1, y1, x2, y2, opts = {}) => svgEl('line', {
  x1, y1, x2, y2,
  stroke: opts.stroke ?? STROKE_SOFT,
  'stroke-width': opts.sw ?? 1,
  'stroke-linecap': 'round',
});

const path = (d, opts = {}) => svgEl('path', {
  d,
  fill: opts.fill ?? 'none',
  stroke: opts.stroke ?? STROKE,
  'stroke-width': opts.sw ?? 1.2,
  'stroke-linecap': 'round',
});

/* ---------- Symbol drawings (top-down) ----------
   Each builder receives (w, h) in units and returns an array of
   SVG nodes drawn around the origin. "Up" (−y) is the canonical
   front/approach side for directional pieces. */

const SYMBOL_DRAWERS = {
  couch(w, h) {
    const back = h * 0.26;
    return [
      rect(w, h, { rx: 6, fill: '#f1f5f9' }),
      // backrest along the bottom edge
      box(-w / 2, h / 2 - back, w, back, { fill: ACCENT, rx: 3 }),
      // armrests
      box(-w / 2, -h / 2, w * 0.14, h, { fill: ACCENT, rx: 3 }),
      box(w / 2 - w * 0.14, -h / 2, w * 0.14, h, { fill: ACCENT, rx: 3 }),
      // seat cushions
      line(-w / 6, -h / 2 + h * 0.12, -w / 6, h / 2 - back),
      line(w / 6, -h / 2 + h * 0.12, w / 6, h / 2 - back),
    ];
  },
  chair(w, h) {
    return [
      rect(w * 0.8, h * 0.8, { rx: 3, fill: '#f1f5f9' }),
      box(-w / 2, h * 0.12, w, h * 0.18, { fill: ACCENT, rx: 2 }),
    ];
  },
  'dining-table'(w, h) {
    const tw = w * 0.62;
    const th = h * 0.58;
    const nodes = [ellipse(0, 0, tw / 2, th / 2, { fill: '#f8fafc' })];
    const seats = [
      [0, -h / 2 + h * 0.08], [0, h / 2 - h * 0.08],
      [-tw / 2 - w * 0.06, 0], [tw / 2 + w * 0.06, 0],
      [-tw / 3, -th / 2 - h * 0.02], [tw / 3, -th / 2 - h * 0.02],
      [-tw / 3, th / 2 + h * 0.02], [tw / 3, th / 2 + h * 0.02],
    ];
    seats.forEach(([cx, cy]) => nodes.push(svgEl('rect', {
      x: cx - w * 0.07, y: cy - h * 0.055, width: w * 0.14, height: h * 0.11,
      rx: 2, fill: ACCENT, stroke: STROKE_SOFT, 'stroke-width': 1,
    })));
    return nodes;
  },
  'coffee-table'(w, h) {
    return [rect(w, h, { rx: 5, fill: '#f8fafc' }), rect(w * 0.7, h * 0.7, { rx: 3, stroke: STROKE_SOFT })];
  },
  bed(w, h) {
    const pillow = h * 0.16;
    return [
      rect(w, h, { rx: 4, fill: '#f8fafc' }),
      // blanket foot line
      line(-w / 2, h / 2 - h * 0.34, w / 2, h / 2 - h * 0.34),
      // pillows at the head (top)
      svgEl('rect', { x: -w / 2 + w * 0.08, y: -h / 2 + h * 0.05, width: w * 0.36, height: pillow, rx: 3, fill: ACCENT, stroke: STROKE_SOFT, 'stroke-width': 1 }),
      svgEl('rect', { x: w * 0.06 - w * 0.02, y: -h / 2 + h * 0.05, width: w * 0.36, height: pillow, rx: 3, fill: ACCENT, stroke: STROKE_SOFT, 'stroke-width': 1 }),
    ];
  },
  nightstand(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), line(-w / 2, -h * 0.1, w / 2, -h * 0.1), circle(0, h * 0.18, 1.3, { fill: STROKE_SOFT })];
  },
  dresser(w, h) {
    return [
      rect(w, h, { rx: 2, fill: '#f8fafc' }),
      line(0, -h / 2, 0, h / 2),
      circle(-w * 0.25, 0, 1.3, { fill: STROKE_SOFT }),
      circle(w * 0.25, 0, 1.3, { fill: STROKE_SOFT }),
    ];
  },
  desk(w, h) {
    return [
      box(-w / 2, -h / 2, w, h * 0.62, { fill: '#f8fafc', rx: 2 }),
      // chair tucked at the bottom
      svgEl('rect', { x: -w * 0.13, y: h * 0.07, width: w * 0.26, height: h * 0.3, rx: 3, fill: ACCENT, stroke: STROKE_SOFT, 'stroke-width': 1 }),
    ];
  },
  bookshelf(w, h) {
    const nodes = [rect(w, h, { rx: 1, fill: '#f8fafc' })];
    for (let i = 1; i < 4; i += 1) nodes.push(line(-w / 2, -h / 2 + (h * i) / 4, w / 2, -h / 2 + (h * i) / 4, { stroke: STROKE_SOFT }));
    return nodes;
  },
  tv(w, h) {
    return [rect(w, h, { rx: 1, fill: '#1e293b', stroke: '#0f172a' }), line(-w * 0.2, h / 2 + 1.5, w * 0.2, h / 2 + 1.5, { stroke: STROKE, sw: 2 })];
  },
  fridge(w, h) {
    return [rect(w, h, { rx: 3, fill: '#f8fafc' }), line(-w / 2, -h * 0.18, w / 2, -h * 0.18), line(w * 0.28, -h * 0.4, w * 0.28, -h * 0.26, { stroke: STROKE, sw: 2 }), line(w * 0.28, h * 0.05, w * 0.28, h * 0.3, { stroke: STROKE, sw: 2 })];
  },
  stove(w, h) {
    const r = Math.min(w, h) * 0.17;
    return [
      rect(w, h, { rx: 2, fill: '#f8fafc' }),
      circle(-w * 0.22, -h * 0.22, r), circle(w * 0.22, -h * 0.22, r),
      circle(-w * 0.22, h * 0.22, r), circle(w * 0.22, h * 0.22, r),
    ];
  },
  oven(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), box(-w * 0.34, -h * 0.3, w * 0.68, h * 0.6, { stroke: STROKE_SOFT, rx: 2 }), line(-w * 0.18, -h * 0.38, w * 0.18, -h * 0.38, { stroke: STROKE, sw: 2 })];
  },
  microwave(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), box(-w / 2 + 1.5, -h / 2 + 1.5, w * 0.62, h - 3, { stroke: STROKE_SOFT, rx: 1 }), circle(w * 0.34, 0, 1.3, { fill: STROKE_SOFT })];
  },
  dishwasher(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), box(-w * 0.34, -h * 0.34, w * 0.68, h * 0.68, { stroke: STROKE_SOFT, rx: 1 }), line(-w * 0.18, -h * 0.42, w * 0.18, -h * 0.42, { stroke: STROKE, sw: 2 })];
  },
  sink(w, h) {
    return [
      rect(w, h, { rx: 2, fill: '#f8fafc' }),
      box(-w * 0.36, -h * 0.3, w * 0.72, h * 0.6, { stroke: STROKE_SOFT, rx: 4, fill: '#eef2f9' }),
      circle(0, 0, Math.min(w, h) * 0.08, { fill: STROKE_SOFT }),
      circle(0, -h * 0.4, Math.min(w, h) * 0.08),
    ];
  },
  toilet(w, h) {
    return [
      // tank at the top
      box(-w * 0.34, -h / 2, w * 0.68, h * 0.24, { fill: '#f8fafc', rx: 2 }),
      // bowl
      ellipse(0, h * 0.12, w * 0.38, h * 0.32, { fill: '#f8fafc' }),
      ellipse(0, h * 0.12, w * 0.24, h * 0.2, { stroke: STROKE_SOFT }),
    ];
  },
  shower(w, h) {
    return [
      rect(w, h, { rx: 2, fill: '#eef2f9' }),
      line(-w / 2, -h / 2, w / 2, h / 2, { stroke: STROKE_SOFT }),
      line(w / 2, -h / 2, -w / 2, h / 2, { stroke: STROKE_SOFT }),
      circle(0, 0, Math.min(w, h) * 0.1, { fill: FILL }),
    ];
  },
  bathtub(w, h) {
    return [
      rect(w, h, { rx: 4, fill: '#f8fafc' }),
      box(-w * 0.4, -h * 0.34, w * 0.66, h * 0.68, { stroke: STROKE_SOFT, rx: 10, fill: '#eef2f9' }),
      circle(w * 0.3, 0, Math.min(w, h) * 0.08),
    ];
  },
  washer(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), circle(0, 0, Math.min(w, h) * 0.32), circle(0, 0, Math.min(w, h) * 0.12, { stroke: STROKE_SOFT })];
  },
  dryer(w, h) {
    return [rect(w, h, { rx: 2, fill: '#f8fafc' }), circle(0, 0, Math.min(w, h) * 0.32), circle(0, 0, Math.min(w, h) * 0.12, { stroke: STROKE_SOFT })];
  },
  lamp(w, h) {
    const r = Math.min(w, h) / 2;
    return [circle(0, 0, r * 0.92, { fill: '#fef9c3' }), circle(0, 0, r * 0.4, { fill: '#fde68a', stroke: STROKE_SOFT }), circle(0, 0, 1.3, { fill: STROKE })];
  },
  plant(w, h) {
    const r = Math.min(w, h) / 2;
    return [
      circle(0, 0, r * 0.95, { fill: '#dcfce7', stroke: '#16a34a' }),
      circle(0, 0, r * 0.5, { fill: '#bbf7d0', stroke: '#16a34a' }),
      circle(0, 0, 1.4, { fill: '#15803d' }),
    ];
  },
  trash(w, h) {
    return [rect(w * 0.8, h * 0.9, { rx: 3, fill: '#f1f5f9' }), line(-w * 0.3, -h * 0.28, w * 0.3, -h * 0.28, { stroke: STROKE_SOFT })];
  },
  cabinet(w, h) {
    // upper cabinet convention: rectangle crossed with an X
    return [rect(w, h, { rx: 1, fill: '#f8fafc', stroke: STROKE_SOFT }), line(-w / 2, -h / 2, w / 2, h / 2, { stroke: STROKE_SOFT }), line(w / 2, -h / 2, -w / 2, h / 2, { stroke: STROKE_SOFT })];
  },
  island(w, h) {
    return [rect(w, h, { rx: 4, fill: '#f8fafc' }), rect(w * 0.9, h * 0.78, { rx: 3, stroke: STROKE_SOFT })];
  },
  rug(w, h) {
    return [
      svgEl('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: 3, fill: '#faf5ff', stroke: '#a855f7', 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }),
      rect(w * 0.82, h * 0.72, { rx: 2, stroke: '#c084fc' }),
    ];
  },
  ac(w, h) {
    const nodes = [rect(w, h, { rx: 2, fill: '#eff6ff' })];
    for (let i = 1; i < 5; i += 1) nodes.push(line(-w / 2 + (w * i) / 5, -h / 2 + 1.5, -w / 2 + (w * i) / 5, h / 2 - 1.5, { stroke: '#60a5fa' }));
    return nodes;
  },
  'water-heater'(w, h) {
    const r = Math.min(w, h) / 2;
    return [circle(0, 0, r * 0.95, { fill: '#f8fafc' }), circle(0, 0, r * 0.5, { stroke: STROKE_SOFT }), circle(0, 0, 1.4, { fill: STROKE_SOFT })];
  },
  stairs(w, h) {
    const nodes = [rect(w, h, { rx: 1, fill: '#f8fafc' })];
    const treads = 6;
    for (let i = 1; i < treads; i += 1) nodes.push(line(-w / 2 + (w * i) / treads, -h / 2, -w / 2 + (w * i) / treads, h / 2, { stroke: STROKE_SOFT }));
    // up-direction arrow
    nodes.push(line(-w / 2 + w * 0.1, 0, w / 2 - w * 0.1, 0, { stroke: STROKE, sw: 1.4 }));
    nodes.push(path(`M ${w / 2 - w * 0.1} 0 L ${w / 2 - w * 0.22} ${-h * 0.14} M ${w / 2 - w * 0.1} 0 L ${w / 2 - w * 0.22} ${h * 0.14}`, { stroke: STROKE, sw: 1.4 }));
    return nodes;
  },
};

/* ---------- Label → symbol-key inference ---------- */

const LABEL_ALIASES = [
  [/sofa|couch|loveseat|sectional/, 'couch'],
  [/dining\s*table|kitchen\s*table/, 'dining-table'],
  [/coffee\s*table/, 'coffee-table'],
  [/night\s*stand/, 'nightstand'],
  [/dresser|wardrobe|armoire/, 'dresser'],
  [/book\s*shelf|bookcase|shelf/, 'bookshelf'],
  [/fridge|refrigerator/, 'fridge'],
  [/micro\s*wave/, 'microwave'],
  [/dish\s*washer/, 'dishwasher'],
  [/wash(er|ing)/, 'washer'],
  [/dry(er)?/, 'dryer'],
  [/toilet|wc|water\s*closet/, 'toilet'],
  [/bath\s*tub|tub/, 'bathtub'],
  [/kitchen\s*island|island/, 'island'],
  [/water\s*heater/, 'water-heater'],
  [/\bac\b|air\s*condition/, 'ac'],
  [/\btv\b|television/, 'tv'],
  [/\bbed\b/, 'bed'],
  [/\bchair\b/, 'chair'],
  [/\bdesk\b/, 'desk'],
  [/\bstove|range\b/, 'stove'],
  [/\boven\b/, 'oven'],
  [/\bsink\b|basin/, 'sink'],
  [/\bshower\b/, 'shower'],
  [/\blamp\b|light\s*fixture/, 'lamp'],
  [/\bplant\b|fern/, 'plant'],
  [/\btrash\b|bin|waste/, 'trash'],
  [/\bcabinet\b|cupboard|pantry/, 'cabinet'],
  [/\brug\b|carpet/, 'rug'],
  [/\bstair/, 'stairs'],
  [/\bstove\b/, 'stove'],
];

/** Guess a symbol key from a fixture's label/type text.
 * @param {string} text — combined label + type
 * @returns {string|null} symbol key or null when nothing matches
 */
export function inferSymbolKey(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return null;
  for (const [pattern, key] of LABEL_ALIASES) {
    if (pattern.test(lower)) return key;
  }
  return null;
}

/** Whether a given key has a dedicated top-down drawing. */
export function hasSymbolDrawing(key) {
  return Boolean(SYMBOL_DRAWERS[key]);
}

/** Build a centered top-down symbol graphic.
 * @param {string} key — symbol key (e.g. 'couch')
 * @param {number} width — bounding width in units
 * @param {number} height — bounding height in units
 * @returns {SVGGElement|null} a <g> group centered on (0,0), or null
 */
export function buildSymbolGraphic(key, width, height) {
  const drawer = SYMBOL_DRAWERS[key];
  if (!drawer) return null;
  const w = Math.max(6, Number(width) || 16);
  const h = Math.max(6, Number(height) || 16);
  const group = svgEl('g', { className: 'floorplan-symbol-graphic' });
  for (const node of drawer(w, h)) {
    if (node) group.append(node);
  }
  return group;
}
